#!/usr/bin/env node
// apply.cjs — the deterministic engine. Selectively, idempotently, and
// non-destructively materializes components into a target repo's committed
// config (CLAUDE.md, .claude/). See components.cjs for the operation vocabulary.
//
// Usage:
//   apply.cjs [--plan|--apply|--remove] [--components a,b,c|--all]
//             [--repo DIR] [--plugin-root DIR]
//             [--resolutions FILE] [--force] [--json]
//
// --plan (default) computes and prints changes/conflicts without writing.
// --apply writes; conflicts default to "skip" unless --force or a resolution says otherwise.
// --remove undoes what the manifest recorded.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const merge = require('./lib/merge.cjs');
const manifestLib = require('./lib/manifest.cjs');
const components = require('./components.cjs');

// ---------- arg parsing ----------
function parseArgs(argv) {
  const out = { mode: 'plan', selection: null, repo: null, pluginRoot: null, resolutions: null, force: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plan') out.mode = 'plan';
    else if (a === '--apply') out.mode = 'apply';
    else if (a === '--remove') out.mode = 'remove';
    else if (a === '--all') out.selection = 'all';
    else if (a === '--components') out.selection = argv[++i];
    else if (a === '--repo') out.repo = argv[++i];
    else if (a === '--plugin-root') out.pluginRoot = argv[++i];
    else if (a === '--resolutions') out.resolutions = argv[++i];
    else if (a === '--force') out.force = true;
    else if (a === '--json') out.json = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

function resolveRepoRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

function resolvePluginRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.CLAUDE_PLUGIN_ROOT) return process.env.CLAUDE_PLUGIN_ROOT;
  return path.resolve(__dirname, '..');
}

// ---------- small helpers ----------
function readFileOr(p, fallback) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : fallback;
}
function readJsonOr(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`Could not parse JSON at ${p}: ${err.message}`);
  }
}
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function getPath(obj, keyPath) {
  return keyPath.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, keyPath, value) {
  const keys = keyPath.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

function readPluginVersion(pluginRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}

// ---------- engine context: lazily-loaded working copies of mutated files ----------
function makeContext(repoRoot, pluginRoot) {
  const textCache = new Map(); // relPath -> content
  const manifests = {
    shared: manifestLib.read(repoRoot, 'shared'),
    local: manifestLib.read(repoRoot, 'local'),
  };
  return {
    repoRoot,
    pluginRoot,
    // Both manifests are loaded; `manifest` stays the shared one for back-compat.
    get manifest() {
      return manifests.shared;
    },
    manifestFor(scope) {
      return scope === 'local' ? manifests.local : manifests.shared;
    },
    touched: new Set(), // 'settings' | 'settingsLocal' | 'mcp'
    touchedText: new Set(), // relative paths of text files to flush
    _settings: undefined,
    _settingsLocal: undefined,
    _mcp: undefined,
    // Generic lazily-loaded text file (CLAUDE.md, AGENTS.md, ...).
    text(rel) {
      if (!textCache.has(rel)) textCache.set(rel, readFileOr(path.join(repoRoot, rel), ''));
      return textCache.get(rel);
    },
    setText(rel, content) {
      textCache.set(rel, content);
      this.touchedText.add(rel);
    },
    settingsFor(scope) {
      if (scope === 'local') {
        if (this._settingsLocal === undefined) {
          this._settingsLocal = readJsonOr(path.join(repoRoot, '.claude', 'settings.local.json'), {});
        }
        return this._settingsLocal;
      }
      if (this._settings === undefined) {
        this._settings = readJsonOr(path.join(repoRoot, '.claude', 'settings.json'), {});
      }
      return this._settings;
    },
    // Shared settings accessor preserved for unrelated code/tests.
    get settings() {
      return this.settingsFor('shared');
    },
    get mcp() {
      if (this._mcp === undefined) {
        this._mcp = readJsonOr(path.join(repoRoot, '.mcp.json'), { mcpServers: {} });
      }
      return this._mcp;
    },
  };
}

function srcAbs(ctx, rel) {
  return path.join(ctx.pluginRoot, rel);
}

// Per-scope routing for the settings file: the `touched` flag the flush keys on
// and the repo-relative path it writes to.
function settingsTouchKey(scope) {
  return scope === 'local' ? 'settingsLocal' : 'settings';
}
function settingsRel(scope) {
  return path.join('.claude', scope === 'local' ? 'settings.local.json' : 'settings.json');
}

// ---------- op handlers ----------
// Each returns a planned-op descriptor: { type, target, action, conflict, conflictKey, detail }.
// In apply mode, when `write` is true it mutates ctx (honoring `decision` for conflicts).

function planVendorFile(ctx, op, scope) {
  const destAbs = path.join(ctx.repoRoot, op.dest);
  const newContent = fs.readFileSync(srcAbs(ctx, op.src), 'utf8');
  const newHash = merge.sha256(newContent);
  let action = 'create';
  let conflict = false;
  if (fs.existsSync(destAbs)) {
    const existingHash = merge.sha256(fs.readFileSync(destAbs, 'utf8'));
    const rec = manifestLib.fileEntry(ctx.manifestFor(scope), op.dest);
    if (existingHash === newHash) action = 'noop';
    else if (rec && rec.sha256 === existingHash) action = 'update';
    else {
      action = 'conflict';
      conflict = true;
    }
  }
  return { type: 'vendorFile', target: op.dest, action, conflict, conflictKey: `file:${op.dest}`, _newContent: newContent, _newHash: newHash, _destAbs: destAbs, _executable: !!op.executable };
}
function applyVendorFile(ctx, planned, decision) {
  const m = ctx.manifestFor(planned.scope);
  if (planned.action === 'noop') {
    // Local scope only: record the entry so the managed .claude/.gitignore block
    // stays accurate even when the file was already on disk identical. Shared
    // scope keeps its "own only what we wrote" invariant.
    if (planned.scope === 'local' && !manifestLib.fileEntry(m, planned.target)) {
      m.files.push({ path: planned.target, sha256: planned._newHash });
    }
    return;
  }
  if (planned.conflict && decision !== 'overwrite') return; // skip
  fs.mkdirSync(path.dirname(planned._destAbs), { recursive: true });
  fs.writeFileSync(planned._destAbs, planned._newContent);
  if (planned._executable) fs.chmodSync(planned._destAbs, 0o755);
  const existing = manifestLib.fileEntry(m, planned.target);
  if (existing) existing.sha256 = planned._newHash;
  else m.files.push({ path: planned.target, sha256: planned._newHash });
}

const AGENTS_IMPORT_ID = 'agents-import';

function hasAgentsImport(claudeMd) {
  return /(^|\n)@AGENTS\.md(\s|$)/.test(claudeMd) || merge.readBlockBody(claudeMd, AGENTS_IMPORT_ID) !== null;
}

// Conventions block: if the repo uses AGENTS.md, write the block there (the
// cross-tool source of truth) and ensure CLAUDE.md imports it via @AGENTS.md;
// otherwise write the block straight into CLAUDE.md.
function planConventions(ctx, op) {
  const blockBody = fs.readFileSync(srcAbs(ctx, op.src), 'utf8').replace(/\n+$/, '');
  const agentsExists = fs.existsSync(path.join(ctx.repoRoot, 'AGENTS.md'));
  const targetRel = agentsExists ? 'AGENTS.md' : 'CLAUDE.md';

  // Where does our managed block currently live? If a prior run recorded a
  // different file (e.g. CLAUDE.md before AGENTS.md appeared), the block must
  // migrate to the new target rather than be duplicated/orphaned.
  const rec = ctx.manifest.claudeMd[op.id];
  const recFile = rec && rec.file;
  const oldFile = recFile && recFile !== targetRel && merge.readBlockBody(ctx.text(recFile), op.id) !== null ? recFile : null;
  const existingFile = oldFile || targetRel;
  const currentBody = merge.readBlockBody(ctx.text(existingFile), op.id);

  // Conflict iff the block that currently exists was edited since we wrote it —
  // checked against wherever it actually lives (old file during a migration).
  const conflict = currentBody !== null && rec && rec.sha256 !== merge.sha256(currentBody);

  const upsert = merge.upsertBlock(ctx.text(targetRel), op.id, blockBody);
  const needImport = agentsExists && !hasAgentsImport(ctx.text('CLAUDE.md'));
  const target = agentsExists ? 'AGENTS.md (+CLAUDE.md @import)' : 'CLAUDE.md';

  let action;
  if (conflict) action = 'conflict';
  else if (oldFile) action = 'move';
  else action = needImport && upsert.action === 'noop' ? 'merge' : upsert.action;

  const detail = [oldFile ? `move from ${oldFile}` : '', needImport ? 'add @AGENTS.md import' : ''].filter(Boolean).join(', ');
  return {
    type: 'conventions',
    target,
    action,
    conflict,
    conflictKey: `conventions:${op.id}`,
    detail,
    _id: op.id,
    _targetRel: targetRel,
    _blockBody: blockBody,
    _needImport: needImport,
    _oldFile: oldFile,
  };
}
function applyConventions(ctx, planned, decision) {
  const { _id: id, _targetRel: targetRel, _blockBody: blockBody, _oldFile: oldFile } = planned;
  if (!(planned.conflict && decision !== 'overwrite')) {
    const upsert = merge.upsertBlock(ctx.text(targetRel), id, blockBody);
    if (upsert.action !== 'noop') ctx.setText(targetRel, upsert.content);
    // Migration: strip the orphaned block from its previous file.
    if (oldFile) ctx.setText(oldFile, merge.removeBlock(ctx.text(oldFile), id));
    const writtenBody = merge.readBlockBody(ctx.text(targetRel), id);
    ctx.manifest.claudeMd[id] = { sha256: merge.sha256(writtenBody), file: targetRel };
  }
  if (planned._needImport) {
    const upsert = merge.upsertBlock(ctx.text('CLAUDE.md'), AGENTS_IMPORT_ID, '@AGENTS.md');
    ctx.setText('CLAUDE.md', upsert.content);
    const writtenBody = merge.readBlockBody(upsert.content, AGENTS_IMPORT_ID);
    ctx.manifest.claudeMd[AGENTS_IMPORT_ID] = { sha256: merge.sha256(writtenBody), file: 'CLAUDE.md' };
  }
}

function planMergeSettings(ctx, op, scope) {
  const defaults = readJsonOr(srcAbs(ctx, op.src), {});
  const s = ctx.settingsFor(scope);
  const details = [];
  let conflict = false;
  let conflictKey = null;
  const dPerms = defaults.permissions || {};
  for (const key of ['allow', 'deny']) {
    if (Array.isArray(dPerms[key])) {
      const cur = (s.permissions && s.permissions[key]) || [];
      const { added } = merge.unionArray(cur, dPerms[key]);
      if (added.length) details.push(`permissions.${key}: +${added.length}`);
    }
  }
  if (dPerms.defaultMode != null) {
    const cur = s.permissions && s.permissions.defaultMode;
    if (cur == null) details.push(`permissions.defaultMode=${dPerms.defaultMode}`);
    else if (cur !== dPerms.defaultMode) {
      conflict = true;
      conflictKey = 'setting:permissions.defaultMode';
      details.push(`permissions.defaultMode: keep "${cur}" vs "${dPerms.defaultMode}"`);
    }
  }
  const action = conflict ? 'conflict' : details.length ? 'merge' : 'noop';
  return { type: 'mergeSettings', target: '.claude/settings.json', action, conflict, conflictKey, detail: details.join(', '), _defaults: defaults };
}
function applyMergeSettings(ctx, planned, decision) {
  const scope = planned.scope;
  const defaults = planned._defaults;
  const s = ctx.settingsFor(scope);
  const m = ctx.manifestFor(scope);
  if (!s.permissions) s.permissions = {};
  if (s.$schema == null && defaults.$schema) s.$schema = defaults.$schema;
  const dPerms = defaults.permissions || {};
  for (const key of ['allow', 'deny']) {
    if (Array.isArray(dPerms[key])) {
      const { result, added } = merge.unionArray(s.permissions[key] || [], dPerms[key]);
      s.permissions[key] = result;
      if (added.length) m.settings[key] = merge.unionArray(m.settings[key], added).result;
    }
  }
  if (dPerms.defaultMode != null) {
    const cur = s.permissions.defaultMode;
    if (cur == null) {
      s.permissions.defaultMode = dPerms.defaultMode;
      m.settings.scalars['permissions.defaultMode'] = dPerms.defaultMode;
    } else if (cur !== dPerms.defaultMode && decision === 'overwrite') {
      s.permissions.defaultMode = dPerms.defaultMode;
      m.settings.scalars['permissions.defaultMode'] = dPerms.defaultMode;
    }
  }
  ctx.touched.add(settingsTouchKey(scope));
}

function planSettingsScalar(ctx, op, scope) {
  const cur = getPath(ctx.settingsFor(scope), op.keyPath);
  let action;
  let conflict = false;
  if (cur == null) action = 'set';
  else if (deepEqual(cur, op.value)) action = 'noop';
  else {
    action = 'conflict';
    conflict = true;
  }
  return { type: 'settingsScalar', target: '.claude/settings.json', action, conflict, conflictKey: `setting:${op.keyPath}`, detail: op.keyPath, _op: op };
}
function applySettingsScalar(ctx, planned, decision) {
  const op = planned._op;
  const scope = planned.scope;
  if (planned.action === 'noop') return;
  if (planned.conflict && decision !== 'overwrite') return;
  setPath(ctx.settingsFor(scope), op.keyPath, op.value);
  ctx.manifestFor(scope).settings.scalars[op.keyPath] = op.value;
  ctx.touched.add(settingsTouchKey(scope));
}

function planHookWire(ctx, op, scope) {
  const s = ctx.settingsFor(scope);
  const entries = (s.hooks && s.hooks[op.event]) || [];
  const present = entries.some((e) => (e.hooks || []).some((h) => h.command === op.command));
  const file = scope === 'local' ? '.claude/settings.local.json' : '.claude/settings.json';
  return { type: 'hookWire', target: `${file} (${op.event})`, action: present ? 'noop' : 'add', conflict: false, detail: op.matcher, _op: op };
}
function applyHookWire(ctx, planned) {
  if (planned.action === 'noop') return;
  const op = planned._op;
  const scope = planned.scope;
  const s = ctx.settingsFor(scope);
  if (!s.hooks) s.hooks = {};
  if (!Array.isArray(s.hooks[op.event])) s.hooks[op.event] = [];
  s.hooks[op.event].push({ matcher: op.matcher, hooks: [{ type: 'command', command: op.command }] });
  ctx.manifestFor(scope).settings.hooks.push({ event: op.event, command: op.command });
  ctx.touched.add(settingsTouchKey(scope));
}

function planMergeMcp(ctx, op) {
  const src = readJsonOr(srcAbs(ctx, op.src), { mcpServers: {} });
  const servers = src.mcpServers || {};
  const cur = ctx.mcp.mcpServers || {};
  const adds = [];
  let conflict = false;
  let conflictKey = null;
  for (const [name, def] of Object.entries(servers)) {
    if (cur[name] == null) adds.push(name);
    else if (!deepEqual(cur[name], def)) {
      conflict = true;
      conflictKey = `mcp:${name}`;
    }
  }
  const action = conflict ? 'conflict' : adds.length ? 'merge' : 'noop';
  return { type: 'mergeMcp', target: '.mcp.json', action, conflict, conflictKey, detail: adds.join(', '), _servers: servers };
}
function applyMergeMcp(ctx, planned, decision) {
  const servers = planned._servers;
  if (!ctx.mcp.mcpServers) ctx.mcp.mcpServers = {};
  for (const [name, def] of Object.entries(servers)) {
    const cur = ctx.mcp.mcpServers[name];
    if (cur == null) {
      ctx.mcp.mcpServers[name] = def;
      if (!ctx.manifest.mcp.includes(name)) ctx.manifest.mcp.push(name);
    } else if (!deepEqual(cur, def) && decision === 'overwrite') {
      ctx.mcp.mcpServers[name] = def;
      if (!ctx.manifest.mcp.includes(name)) ctx.manifest.mcp.push(name);
    }
  }
  ctx.touched.add('mcp');
}

const PLANNERS = {
  vendorFile: planVendorFile,
  conventions: planConventions,
  mergeSettings: planMergeSettings,
  settingsScalar: planSettingsScalar,
  hookWire: planHookWire,
  mergeMcp: planMergeMcp,
};
const APPLIERS = {
  vendorFile: applyVendorFile,
  conventions: applyConventions,
  mergeSettings: applyMergeSettings,
  settingsScalar: applySettingsScalar,
  hookWire: applyHookWire,
  mergeMcp: applyMergeMcp,
};

// ---------- planning + apply ----------
function buildPlan(ctx, componentIds) {
  const ops = [];
  for (const id of componentIds) {
    const comp = components.COMPONENTS[id];
    // conventions/mergeMcp target committed files and are shared-only by nature.
    const compScope = components.scopeOf(id);
    for (const op of comp.ops) {
      const scope = op.type === 'conventions' || op.type === 'mergeMcp' ? 'shared' : compScope;
      // A local vendored file must live under .claude/ so the managed
      // .claude/.gitignore can actually cover it — otherwise it would silently
      // leak into commits, defeating the point of local scope.
      if (scope === 'local' && op.type === 'vendorFile' && !op.dest.replace(/\\/g, '/').startsWith('.claude/')) {
        throw new Error(`Local component "${id}" vendors "${op.dest}" outside .claude/ — local files must live under .claude/ to stay git-ignored.`);
      }
      const planned = PLANNERS[op.type](ctx, op, scope);
      planned.component = id;
      planned.scope = scope;
      ops.push(planned);
    }
  }
  const conflicts = ops.filter((o) => o.conflict).map((o) => ({ key: o.conflictKey, component: o.component, type: o.type, target: o.target, detail: o.detail }));
  return { ops, conflicts };
}

// ---------- managed .claude/.gitignore for local artifacts ----------
// We use `#`-style comment markers (NOT merge.cjs's HTML-comment markers, which
// are wrong for a .gitignore). The block is recomputed from the local manifest
// each apply so it stays accurate and never duplicates.
const GITIGNORE_BEGIN = '# BEGIN 2ts-claude:local';
const GITIGNORE_END = '# END 2ts-claude:local';
const GITIGNORE_REL = path.join('.claude', '.gitignore');

// Entries are paths relative to .claude/ (where the .gitignore lives).
function localGitignoreEntries(ctx) {
  const entries = ['settings.local.json', '.2ts-claude.local.json'];
  for (const f of ctx.manifestFor('local').files) {
    // f.path is repo-relative (e.g. .claude/local/x.cjs) -> relative to .claude/.
    const rel = path.relative('.claude', f.path).split(path.sep).join('/');
    entries.push(rel);
  }
  // De-dupe, preserve order.
  return Array.from(new Set(entries));
}

// Replace (or insert) the managed block within an existing .gitignore body,
// preserving any user lines outside the markers. Returns the new content.
function upsertGitignoreBlock(existing, entries) {
  const block = [GITIGNORE_BEGIN, ...entries, GITIGNORE_END].join('\n');
  if (!existing) return block + '\n';
  const lines = existing.split('\n');
  const beginIdx = lines.indexOf(GITIGNORE_BEGIN);
  const endIdx = lines.indexOf(GITIGNORE_END);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx >= beginIdx) {
    const before = lines.slice(0, beginIdx);
    const after = lines.slice(endIdx + 1);
    const merged = [...before, ...block.split('\n'), ...after].join('\n');
    return merged.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  }
  const sep = existing.endsWith('\n') ? '' : '\n';
  return `${existing}${sep}${block}\n`;
}

// Remove the managed block, preserving user lines. Returns the new content
// (may be empty/whitespace, in which case the caller deletes the file).
function removeGitignoreBlock(existing) {
  if (!existing) return existing;
  const lines = existing.split('\n');
  const beginIdx = lines.indexOf(GITIGNORE_BEGIN);
  const endIdx = lines.indexOf(GITIGNORE_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return existing;
  const before = lines.slice(0, beginIdx);
  const after = lines.slice(endIdx + 1);
  return [...before, ...after].join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}

function hasLocalArtifacts(ctx) {
  const lm = ctx.manifestFor('local');
  return (
    lm.files.length > 0 ||
    ctx.touched.has('settingsLocal') ||
    (lm.settings && (lm.settings.allow.length || lm.settings.deny.length || lm.settings.hooks.length || Object.keys(lm.settings.scalars).length))
  );
}

function flush(ctx) {
  const claudeDir = path.join(ctx.repoRoot, '.claude');
  if (ctx.touched.has('settings')) {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(ctx.settingsFor('shared'), null, 2) + '\n');
  }
  if (ctx.touched.has('settingsLocal')) {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.local.json'), JSON.stringify(ctx.settingsFor('local'), null, 2) + '\n');
  }
  if (ctx.touched.has('mcp')) {
    fs.writeFileSync(path.join(ctx.repoRoot, '.mcp.json'), JSON.stringify(ctx.mcp, null, 2) + '\n');
  }
  for (const rel of ctx.touchedText) {
    const abs = path.join(ctx.repoRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, ctx.text(rel));
  }
  // Managed .claude/.gitignore — only when local artifacts exist.
  if (hasLocalArtifacts(ctx)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    const giAbs = path.join(ctx.repoRoot, GITIGNORE_REL);
    const existing = readFileOr(giAbs, '');
    fs.writeFileSync(giAbs, upsertGitignoreBlock(existing, localGitignoreEntries(ctx)));
  }
}

function applyPlan(ctx, plan, componentIds, opts) {
  const resolutions = opts.resolutions || {};
  for (const planned of plan.ops) {
    const decision = planned.conflict ? (opts.force ? 'overwrite' : resolutions[planned.conflictKey] || 'skip') : null;
    APPLIERS[planned.type](ctx, planned, decision);
  }

  // Route each applied component id into its own scope's manifest.
  const sharedIds = componentIds.filter((id) => components.scopeOf(id) !== 'local');
  const localIds = componentIds.filter((id) => components.scopeOf(id) === 'local');
  const pluginVersion = readPluginVersion(ctx.pluginRoot);

  const shared = ctx.manifestFor('shared');
  const local = ctx.manifestFor('local');

  // Did we actually touch each manifest? Stamp + write only those.
  const sharedTouched = sharedIds.length > 0 || ctx.touched.has('settings') || ctx.touched.has('mcp');
  const localTouched = localIds.length > 0;

  if (sharedTouched) {
    shared.components = merge.unionArray(shared.components, sharedIds).result;
    shared.schema = manifestLib.SCHEMA_VERSION;
    shared.pluginVersion = pluginVersion;
  }
  if (localTouched) {
    local.components = merge.unionArray(local.components, localIds).result;
    local.schema = manifestLib.SCHEMA_VERSION;
    local.pluginVersion = pluginVersion;
  }

  flush(ctx);

  if (sharedTouched) manifestLib.write(ctx.repoRoot, shared, 'shared');
  // Only create/write the local manifest when a local component was applied.
  if (localTouched) manifestLib.write(ctx.repoRoot, local, 'local');
}

// ---------- remove ----------
// Reverse the vendored files + settings (allow/deny/hooks/scalars) recorded in
// one scope's manifest, against the matching settings file. Shared scope also
// reverses claudeMd blocks + mcp (handled by the caller).
function removeScope(ctx, scope, removed, kept) {
  const m = ctx.manifestFor(scope);
  // Vendored files: delete only if unchanged from what we wrote.
  for (const f of m.files) {
    const abs = path.join(ctx.repoRoot, f.path);
    if (!fs.existsSync(abs)) continue;
    if (merge.sha256(fs.readFileSync(abs, 'utf8')) === f.sha256) {
      fs.rmSync(abs);
      pruneEmptyDirs(path.dirname(abs), path.join(ctx.repoRoot, '.claude'));
      removed.push(f.path);
    } else kept.push(f.path);
  }
  // Settings (settings.json for shared, settings.local.json for local).
  const settingsAbs = path.join(ctx.repoRoot, settingsRel(scope));
  const s = readJsonOr(settingsAbs, null);
  if (s) {
    if (s.permissions) {
      for (const key of ['allow', 'deny']) {
        if (Array.isArray(s.permissions[key]) && m.settings[key].length) {
          const drop = new Set(m.settings[key].map((v) => JSON.stringify(v)));
          s.permissions[key] = s.permissions[key].filter((v) => !drop.has(JSON.stringify(v)));
        }
      }
    }
    if (s.hooks) {
      for (const rec of m.settings.hooks) {
        const arr = s.hooks[rec.event];
        if (!Array.isArray(arr)) continue;
        for (const entry of arr) entry.hooks = (entry.hooks || []).filter((h) => h.command !== rec.command);
        s.hooks[rec.event] = arr.filter((e) => (e.hooks || []).length > 0);
        if (s.hooks[rec.event].length === 0) delete s.hooks[rec.event];
      }
    }
    for (const [keyPath, val] of Object.entries(m.settings.scalars)) {
      if (deepEqual(getPath(s, keyPath), val)) deletePath(s, keyPath);
    }
    // If stripping our entries reduced the file to no meaningful content (only
    // empty objects/arrays remain), delete it rather than leaving a stray `{}`.
    // This matters most for the local scope: once the managed .claude/.gitignore
    // block is also removed, a leftover settings.local.json would be committable.
    if (isEffectivelyEmpty(s)) {
      fs.rmSync(settingsAbs);
      pruneEmptyDirs(path.dirname(settingsAbs), path.join(ctx.repoRoot, '.claude'));
    } else {
      fs.writeFileSync(settingsAbs, JSON.stringify(s, null, 2) + '\n');
    }
  }
}

// True when an object has no keys, or every value is itself an empty object or
// empty array (one level deep — e.g. `{ permissions: {}, hooks: {} }`). Any
// scalar, non-empty array, or non-empty nested object counts as real content.
function isEffectivelyEmpty(obj) {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return false;
  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      if (val.length > 0) return false;
    } else if (val != null && typeof val === 'object') {
      if (Object.keys(val).length > 0) return false;
    } else {
      // scalar (string/number/boolean/null) is meaningful content
      return false;
    }
  }
  return true;
}

function removeAll(ctx) {
  const removed = [];
  const kept = [];
  const shared = ctx.manifestFor('shared');

  // Reverse both scopes' vendored files + settings.
  removeScope(ctx, 'shared', removed, kept);
  removeScope(ctx, 'local', removed, kept);

  // Shared-only: marker blocks in CLAUDE.md / AGENTS.md (only if unchanged),
  // using the file recorded for each block.
  for (const [id, rec] of Object.entries(shared.claudeMd)) {
    const fileRel = rec.file || 'CLAUDE.md';
    const abs = path.join(ctx.repoRoot, fileRel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, 'utf8');
    const body = merge.readBlockBody(content, id);
    if (body === null) continue;
    if (merge.sha256(body) === rec.sha256) {
      const stripped = merge.removeBlock(content, id);
      if (stripped.trim() === '') fs.rmSync(abs);
      else fs.writeFileSync(abs, stripped);
    } else {
      kept.push(`${fileRel}:${id}`);
    }
  }
  // Shared-only: MCP servers.
  const mcpPath = path.join(ctx.repoRoot, '.mcp.json');
  if (fs.existsSync(mcpPath) && shared.mcp.length) {
    const mcp = readJsonOr(mcpPath, { mcpServers: {} });
    for (const name of shared.mcp) if (mcp.mcpServers) delete mcp.mcpServers[name];
    fs.writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + '\n');
  }
  // Strip the managed block from .claude/.gitignore; delete the file if it
  // becomes empty/only-whitespace.
  const giAbs = path.join(ctx.repoRoot, GITIGNORE_REL);
  if (fs.existsSync(giAbs)) {
    const stripped = removeGitignoreBlock(fs.readFileSync(giAbs, 'utf8'));
    if (stripped.trim() === '') fs.rmSync(giAbs);
    else fs.writeFileSync(giAbs, stripped.endsWith('\n') ? stripped : stripped + '\n');
  }
  // Drop both manifest files.
  for (const scope of ['shared', 'local']) {
    const manifestAbs = manifestLib.manifestPath(ctx.repoRoot, scope);
    if (fs.existsSync(manifestAbs)) fs.rmSync(manifestAbs);
  }
  return { removed, kept };
}
function deletePath(obj, keyPath) {
  const keys = keyPath.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o == null) return;
    o = o[keys[i]];
  }
  if (o) delete o[keys[keys.length - 1]];
}
function pruneEmptyDirs(dir, stopAt) {
  let cur = dir;
  while (cur.startsWith(stopAt) && cur !== stopAt) {
    try {
      if (fs.readdirSync(cur).length === 0) {
        fs.rmdirSync(cur);
        cur = path.dirname(cur);
      } else break;
    } catch {
      break;
    }
  }
}

// ---------- reporting ----------
function printHuman(plan, ctx, mode) {
  const lines = [];
  lines.push(`Repo:   ${ctx.repoRoot}`);
  lines.push(`Plugin: ${ctx.pluginRoot}`);
  lines.push(`Mode:   ${mode}`);
  lines.push('');
  for (const op of plan.ops) {
    const flag = op.conflict ? '⚠ CONFLICT' : op.action;
    const detail = op.detail ? ` — ${op.detail}` : '';
    const tag = op.scope === 'local' ? `${op.component}/local` : op.component;
    lines.push(`  [${tag}] ${op.type} → ${op.target}: ${flag}${detail}`);
  }
  if (plan.conflicts.length) {
    lines.push('');
    lines.push(`${plan.conflicts.length} conflict(s) need a decision (skip|overwrite):`);
    for (const c of plan.conflicts) lines.push(`  - ${c.key}  (${c.target})`);
  }
  process.stderr.write(lines.join('\n') + '\n');
}

// ---------- main ----------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot(opts.repo);
  const pluginRoot = resolvePluginRoot(opts.pluginRoot);

  if (opts.mode === 'remove') {
    const ctx = makeContext(repoRoot, pluginRoot);
    const result = removeAll(ctx);
    if (opts.json) process.stdout.write(JSON.stringify({ mode: 'remove', repoRoot, ...result }, null, 2) + '\n');
    else process.stderr.write(`Removed ${result.removed.length} file(s); kept ${result.kept.length} user-modified item(s).\n`);
    return;
  }

  const componentIds = components.resolve(opts.selection);
  const ctx = makeContext(repoRoot, pluginRoot);
  const plan = buildPlan(ctx, componentIds);

  let resolutions = {};
  if (opts.resolutions) resolutions = readJsonOr(opts.resolutions, {});

  if (opts.mode === 'apply') {
    applyPlan(ctx, plan, componentIds, { resolutions, force: opts.force });
  }

  if (opts.json) {
    const payload = {
      mode: opts.mode,
      repoRoot,
      pluginRoot,
      components: componentIds,
      ops: plan.ops.map((o) => ({ component: o.component, scope: o.scope, type: o.type, target: o.target, action: o.action, conflict: o.conflict, conflictKey: o.conflictKey, detail: o.detail })),
      conflicts: plan.conflicts,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    printHuman(plan, ctx, opts.mode);
    if (opts.mode === 'apply') process.stderr.write('\nApplied. Review `git diff`, then commit so teammates get it.\n');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { parseArgs, makeContext, buildPlan, applyPlan, removeAll, resolveRepoRoot, resolvePluginRoot };
