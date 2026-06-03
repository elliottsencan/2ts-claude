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
  return JSON.parse(fs.readFileSync(p, 'utf8'));
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

// ---------- engine context: lazily-loaded working copies of mutated files ----------
function makeContext(repoRoot, pluginRoot) {
  return {
    repoRoot,
    pluginRoot,
    manifest: manifestLib.read(repoRoot),
    touched: new Set(),
    _settings: undefined,
    _claudeMd: undefined,
    _mcp: undefined,
    get settings() {
      if (this._settings === undefined) {
        this._settings = readJsonOr(path.join(repoRoot, '.claude', 'settings.json'), {});
      }
      return this._settings;
    },
    get claudeMd() {
      if (this._claudeMd === undefined) {
        this._claudeMd = readFileOr(path.join(repoRoot, 'CLAUDE.md'), '');
      }
      return this._claudeMd;
    },
    set claudeMd(v) {
      this._claudeMd = v;
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

// ---------- op handlers ----------
// Each returns a planned-op descriptor: { type, target, action, conflict, conflictKey, detail }.
// In apply mode, when `write` is true it mutates ctx (honoring `decision` for conflicts).

function planVendorFile(ctx, op) {
  const destAbs = path.join(ctx.repoRoot, op.dest);
  const newContent = fs.readFileSync(srcAbs(ctx, op.src), 'utf8');
  const newHash = merge.sha256(newContent);
  let action = 'create';
  let conflict = false;
  if (fs.existsSync(destAbs)) {
    const existingHash = merge.sha256(fs.readFileSync(destAbs, 'utf8'));
    const rec = manifestLib.fileEntry(ctx.manifest, op.dest);
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
  if (planned.action === 'noop') return;
  if (planned.conflict && decision !== 'overwrite') return; // skip
  fs.mkdirSync(path.dirname(planned._destAbs), { recursive: true });
  fs.writeFileSync(planned._destAbs, planned._newContent);
  if (planned._executable) fs.chmodSync(planned._destAbs, 0o755);
  const existing = manifestLib.fileEntry(ctx.manifest, planned.target);
  if (existing) existing.sha256 = planned._newHash;
  else ctx.manifest.files.push({ path: planned.target, sha256: planned._newHash });
}

function planClaudeMdBlock(ctx, op) {
  const blockBody = fs.readFileSync(srcAbs(ctx, op.src), 'utf8').replace(/\n+$/, '');
  const content = ctx.claudeMd;
  const currentBody = merge.readBlockBody(content, op.id);
  const upsert = merge.upsertBlock(content, op.id, blockBody);
  let conflict = false;
  if (currentBody !== null) {
    const rec = ctx.manifest.claudeMd[op.id];
    if (rec && rec.sha256 !== merge.sha256(currentBody)) conflict = true; // user edited inside our block
  }
  return { type: 'claudeMdBlock', target: 'CLAUDE.md', action: conflict ? 'conflict' : upsert.action, conflict, conflictKey: `claudemd:${op.id}`, _id: op.id, _content: upsert.content, _blockBody: blockBody };
}
function applyClaudeMdBlock(ctx, planned, decision) {
  if (planned.action === 'noop') return;
  if (planned.conflict && decision !== 'overwrite') return;
  ctx.claudeMd = planned._content;
  ctx.touched.add('claudeMd');
  // Store hash of what readBlockBody will return next time, so re-runs are stable.
  const writtenBody = merge.readBlockBody(planned._content, planned._id);
  ctx.manifest.claudeMd[planned._id] = { sha256: merge.sha256(writtenBody) };
}

function planMergeSettings(ctx, op) {
  const defaults = readJsonOr(srcAbs(ctx, op.src), {});
  const s = ctx.settings;
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
  const defaults = planned._defaults;
  const s = ctx.settings;
  if (!s.permissions) s.permissions = {};
  if (s.$schema == null && defaults.$schema) s.$schema = defaults.$schema;
  const dPerms = defaults.permissions || {};
  for (const key of ['allow', 'deny']) {
    if (Array.isArray(dPerms[key])) {
      const { result, added } = merge.unionArray(s.permissions[key] || [], dPerms[key]);
      s.permissions[key] = result;
      if (added.length) ctx.manifest.settings[key] = merge.unionArray(ctx.manifest.settings[key], added).result;
    }
  }
  if (dPerms.defaultMode != null) {
    const cur = s.permissions.defaultMode;
    if (cur == null) {
      s.permissions.defaultMode = dPerms.defaultMode;
      ctx.manifest.settings.scalars['permissions.defaultMode'] = dPerms.defaultMode;
    } else if (cur !== dPerms.defaultMode && decision === 'overwrite') {
      s.permissions.defaultMode = dPerms.defaultMode;
      ctx.manifest.settings.scalars['permissions.defaultMode'] = dPerms.defaultMode;
    }
  }
  ctx.touched.add('settings');
}

function planSettingsScalar(ctx, op) {
  const cur = getPath(ctx.settings, op.keyPath);
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
  if (planned.action === 'noop') return;
  if (planned.conflict && decision !== 'overwrite') return;
  setPath(ctx.settings, op.keyPath, op.value);
  ctx.manifest.settings.scalars[op.keyPath] = op.value;
  ctx.touched.add('settings');
}

function planHookWire(ctx, op) {
  const s = ctx.settings;
  const entries = (s.hooks && s.hooks[op.event]) || [];
  const present = entries.some((e) => (e.hooks || []).some((h) => h.command === op.command));
  return { type: 'hookWire', target: `.claude/settings.json (${op.event})`, action: present ? 'noop' : 'add', conflict: false, detail: op.matcher, _op: op };
}
function applyHookWire(ctx, planned) {
  if (planned.action === 'noop') return;
  const op = planned._op;
  const s = ctx.settings;
  if (!s.hooks) s.hooks = {};
  if (!Array.isArray(s.hooks[op.event])) s.hooks[op.event] = [];
  s.hooks[op.event].push({ matcher: op.matcher, hooks: [{ type: 'command', command: op.command }] });
  ctx.manifest.settings.hooks.push({ event: op.event, command: op.command });
  ctx.touched.add('settings');
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
  claudeMdBlock: planClaudeMdBlock,
  mergeSettings: planMergeSettings,
  settingsScalar: planSettingsScalar,
  hookWire: planHookWire,
  mergeMcp: planMergeMcp,
};
const APPLIERS = {
  vendorFile: applyVendorFile,
  claudeMdBlock: applyClaudeMdBlock,
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
    for (const op of comp.ops) {
      const planned = PLANNERS[op.type](ctx, op);
      planned.component = id;
      ops.push(planned);
    }
  }
  const conflicts = ops.filter((o) => o.conflict).map((o) => ({ key: o.conflictKey, component: o.component, type: o.type, target: o.target, detail: o.detail }));
  return { ops, conflicts };
}

function flush(ctx) {
  const claudeDir = path.join(ctx.repoRoot, '.claude');
  if (ctx.touched.has('settings')) {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(ctx.settings, null, 2) + '\n');
  }
  if (ctx.touched.has('claudeMd')) {
    fs.writeFileSync(path.join(ctx.repoRoot, 'CLAUDE.md'), ctx.claudeMd);
  }
  if (ctx.touched.has('mcp')) {
    fs.writeFileSync(path.join(ctx.repoRoot, '.mcp.json'), JSON.stringify(ctx.mcp, null, 2) + '\n');
  }
}

function applyPlan(ctx, plan, componentIds, opts) {
  const resolutions = opts.resolutions || {};
  for (const planned of plan.ops) {
    const decision = planned.conflict ? (opts.force ? 'overwrite' : resolutions[planned.conflictKey] || 'skip') : null;
    APPLIERS[planned.type](ctx, planned, decision);
  }
  ctx.manifest.components = merge.unionArray(ctx.manifest.components, componentIds).result;
  ctx.manifest.schema = manifestLib.SCHEMA_VERSION;
  flush(ctx);
  manifestLib.write(ctx.repoRoot, ctx.manifest);
}

// ---------- remove ----------
function removeAll(ctx) {
  const m = ctx.manifest;
  const removed = [];
  const kept = [];
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
  // Settings.
  const s = readJsonOr(path.join(ctx.repoRoot, '.claude', 'settings.json'), null);
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
    fs.writeFileSync(path.join(ctx.repoRoot, '.claude', 'settings.json'), JSON.stringify(s, null, 2) + '\n');
  }
  // CLAUDE.md blocks (only if unchanged).
  const cmPath = path.join(ctx.repoRoot, 'CLAUDE.md');
  if (fs.existsSync(cmPath)) {
    let content = fs.readFileSync(cmPath, 'utf8');
    for (const [id, rec] of Object.entries(m.claudeMd)) {
      const body = merge.readBlockBody(content, id);
      if (body !== null && merge.sha256(body) === rec.sha256) content = merge.removeBlock(content, id);
      else if (body !== null) kept.push(`CLAUDE.md:${id}`);
    }
    if (content.trim() === '') fs.rmSync(cmPath);
    else fs.writeFileSync(cmPath, content);
  }
  // MCP servers.
  const mcpPath = path.join(ctx.repoRoot, '.mcp.json');
  if (fs.existsSync(mcpPath) && m.mcp.length) {
    const mcp = readJsonOr(mcpPath, { mcpServers: {} });
    for (const name of m.mcp) if (mcp.mcpServers) delete mcp.mcpServers[name];
    fs.writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + '\n');
  }
  // Drop the manifest.
  const manifestAbs = manifestLib.manifestPath(ctx.repoRoot);
  if (fs.existsSync(manifestAbs)) fs.rmSync(manifestAbs);
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
    lines.push(`  [${op.component}] ${op.type} → ${op.target}: ${flag}${detail}`);
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
      ops: plan.ops.map((o) => ({ component: o.component, type: o.type, target: o.target, action: o.action, conflict: o.conflict, conflictKey: o.conflictKey, detail: o.detail })),
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
