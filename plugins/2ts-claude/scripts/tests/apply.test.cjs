#!/usr/bin/env node
// Integration tests for the apply engine, run against throwaway temp repos.
// Run: node --test

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const engine = require('../apply.cjs');
const components = require('../components.cjs');
const merge = require('../lib/merge.cjs');

const PLUGIN_ROOT = path.resolve(__dirname, '../..');

let repo;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), '2ts-apply-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function apply(selection, opts = {}) {
  const ctx = engine.makeContext(repo, PLUGIN_ROOT);
  const ids = components.resolve(selection);
  const plan = engine.buildPlan(ctx, ids);
  engine.applyPlan(ctx, plan, ids, { resolutions: opts.resolutions || {}, force: !!opts.force });
  return plan;
}
function plan(selection) {
  const ctx = engine.makeContext(repo, PLUGIN_ROOT);
  return engine.buildPlan(ctx, components.resolve(selection));
}
function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'));
}
function read(rel) {
  return fs.readFileSync(path.join(repo, rel), 'utf8');
}

describe('new repo', () => {
  it('creates committed config from scratch', () => {
    apply('all');
    assert.ok(fs.existsSync(path.join(repo, 'CLAUDE.md')));
    assert.ok(fs.existsSync(path.join(repo, '.claude/settings.json')));
    assert.ok(fs.existsSync(path.join(repo, '.claude/.2ts-claude.json')));
    assert.ok(fs.existsSync(path.join(repo, '.claude/hooks/pre-tool-use/protect-secrets.cjs')));
  });

  it('wires hooks with the repo-relative CLAUDE_PROJECT_DIR placeholder', () => {
    apply(['safety-hooks']);
    const s = readJson('.claude/settings.json');
    const cmd = s.hooks.PreToolUse[0].hooks[0].command;
    assert.match(cmd, /\$\{CLAUDE_PROJECT_DIR}\/\.claude\/hooks\//);
  });
});

describe('idempotency', () => {
  it('produces all-noop and no duplicate hook entries on re-apply', () => {
    apply('all');
    const second = plan('all');
    assert.equal(second.conflicts.length, 0);
    assert.ok(second.ops.every((o) => o.action === 'noop'), 'every op is noop on re-run');
    const s = readJson('.claude/settings.json');
    // Applying twice must not duplicate the wired hooks.
    apply('all');
    const s2 = readJson('.claude/settings.json');
    assert.deepEqual(s2.hooks, s.hooks);
  });
});

describe('non-clobber merge', () => {
  beforeEach(() => {
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# House rules\n\nuser wrote this\n');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.claude/settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(make:*)'], defaultMode: 'acceptEdits' } }, null, 2)
    );
  });

  it('unions permissions.allow and preserves the user entry', () => {
    apply(['settings']);
    const s = readJson('.claude/settings.json');
    assert.ok(s.permissions.allow.includes('Bash(make:*)'), 'user entry kept');
    assert.ok(s.permissions.allow.includes('Bash(git status:*)'), 'ours added');
  });

  it('unions permissions.deny defaults', () => {
    apply(['settings']);
    const s = readJson('.claude/settings.json');
    assert.ok(Array.isArray(s.permissions.deny), 'deny present');
    assert.ok(s.permissions.deny.includes('Read(./.env)'), 'deny default added');
  });

  it('preserves a user deny entry and does not duplicate an overlapping default', () => {
    fs.writeFileSync(
      path.join(repo, '.claude/settings.json'),
      JSON.stringify({ permissions: { deny: ['Read(./.env)', 'Read(./custom-secret)'] } }, null, 2)
    );
    apply(['settings']);
    const deny = readJson('.claude/settings.json').permissions.deny;
    assert.ok(deny.includes('Read(./custom-secret)'), 'user deny kept');
    assert.equal(deny.filter((d) => d === 'Read(./.env)').length, 1, 'overlapping default not duplicated');
  });

  it('flags a scalar collision as a conflict and keeps the user value by default', () => {
    const p = plan(['settings']);
    assert.ok(p.conflicts.some((c) => c.key === 'setting:permissions.defaultMode'));
    apply(['settings']); // no force
    assert.equal(readJson('.claude/settings.json').permissions.defaultMode, 'acceptEdits');
  });

  it('overwrites a scalar collision only with an explicit resolution', () => {
    apply(['settings'], { resolutions: { 'setting:permissions.defaultMode': 'overwrite' } });
    assert.equal(readJson('.claude/settings.json').permissions.defaultMode, 'plan');
  });

  it('appends the CLAUDE.md block without touching user prose', () => {
    apply(['conventions']);
    const cm = read('CLAUDE.md');
    assert.match(cm, /user wrote this/);
    assert.match(cm, /BEGIN 2ts-claude:conventions/);
  });
});

describe('AGENTS.md interop', () => {
  it('targets AGENTS.md for conventions and adds @AGENTS.md import to CLAUDE.md', () => {
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Agents\n\nexisting agent rules\n');
    apply(['conventions']);
    const agents = read('AGENTS.md');
    assert.match(agents, /existing agent rules/, 'user AGENTS.md content kept');
    assert.match(agents, /BEGIN 2ts-claude:conventions/, 'block written into AGENTS.md');
    const cm = read('CLAUDE.md');
    assert.match(cm, /@AGENTS\.md/, 'CLAUDE.md imports AGENTS.md');
    assert.doesNotMatch(cm, /BEGIN 2ts-claude:conventions/, 'conventions not duplicated in CLAUDE.md');
  });

  it('is idempotent with AGENTS.md present', () => {
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Agents\n');
    apply(['conventions']);
    const p = plan(['conventions']);
    assert.equal(p.conflicts.length, 0);
    assert.ok(p.ops.every((o) => o.action === 'noop'), 'all noop on re-run');
  });

  it('targets CLAUDE.md when no AGENTS.md exists', () => {
    apply(['conventions']);
    assert.match(read('CLAUDE.md'), /BEGIN 2ts-claude:conventions/);
    assert.ok(!fs.existsSync(path.join(repo, 'AGENTS.md')), 'no AGENTS.md created');
  });

  it('does not duplicate an existing @AGENTS.md import the user wrote', () => {
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Agents\n');
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '@AGENTS.md\n\n# mine\n');
    apply(['conventions']);
    const cm = read('CLAUDE.md');
    assert.equal((cm.match(/@AGENTS\.md/g) || []).length, 1, 'import not duplicated');
    assert.doesNotMatch(cm, /BEGIN 2ts-claude:agents-import/, 'no managed import block added');
  });

  it('keeps the import block to exactly one across re-applies', () => {
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Agents\n');
    apply(['conventions']);
    apply(['conventions']);
    const cm = read('CLAUDE.md');
    assert.equal((cm.match(/@AGENTS\.md/g) || []).length, 1, 'single import after two applies');
  });
});

describe('conventions migration (CLAUDE.md -> AGENTS.md)', () => {
  it('moves the block to AGENTS.md and leaves no orphan in CLAUDE.md', () => {
    apply(['conventions']); // no AGENTS.md yet -> lands in CLAUDE.md
    assert.match(read('CLAUDE.md'), /BEGIN 2ts-claude:conventions/);

    fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Agents\n');
    const p = plan(['conventions']);
    assert.ok(p.ops.some((o) => o.type === 'conventions' && o.action === 'move'), 'planned as a move');
    apply(['conventions']);

    assert.match(read('AGENTS.md'), /BEGIN 2ts-claude:conventions/, 'block now in AGENTS.md');
    assert.doesNotMatch(read('CLAUDE.md'), /BEGIN 2ts-claude:conventions/, 'orphan removed from CLAUDE.md');
    assert.match(read('CLAUDE.md'), /@AGENTS\.md/, 'import added');
    assert.equal(readJson('.claude/.2ts-claude.json').claudeMd.conventions.file, 'AGENTS.md', 'manifest tracks new file');
  });

  it('flags a hand-edited old block as a conflict instead of abandoning it', () => {
    apply(['conventions']); // -> CLAUDE.md
    // User edits inside the managed block, then AGENTS.md appears.
    const edited = read('CLAUDE.md').replace('## Conventions', '## Conventions (my edits)');
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), edited);
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Agents\n');

    const p = plan(['conventions']);
    assert.ok(p.conflicts.some((c) => c.key === 'conventions:conventions'), 'edited old block is a conflict');

    apply(['conventions']); // no force -> skip
    assert.match(read('CLAUDE.md'), /my edits/, 'user edits preserved on skip');
    assert.doesNotMatch(read('AGENTS.md'), /BEGIN 2ts-claude:conventions/, 'nothing written to AGENTS.md on skip');
  });
});

describe('conventions conflict inside AGENTS.md', () => {
  beforeEach(() => {
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Agents\n');
    apply(['conventions']);
    // Hand-edit inside the managed block in AGENTS.md.
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), read('AGENTS.md').replace('## Conventions', '## Conventions (edited)'));
  });

  it('detects the edit and skips by default', () => {
    const p = plan(['conventions']);
    assert.ok(p.conflicts.some((c) => c.key === 'conventions:conventions'));
    apply(['conventions']);
    assert.match(read('AGENTS.md'), /edited/, 'user edit kept');
  });

  it('overwrites with an explicit resolution', () => {
    apply(['conventions'], { resolutions: { 'conventions:conventions': 'overwrite' } });
    assert.doesNotMatch(read('AGENTS.md'), /edited/, 'ours restored');
  });
});

describe('vendored-file conflict', () => {
  it('detects a user-modified vendored file and does not overwrite it by default', () => {
    fs.mkdirSync(path.join(repo, '.claude/hooks/pre-tool-use'), { recursive: true });
    const hookPath = path.join(repo, '.claude/hooks/pre-tool-use/protect-secrets.cjs');
    fs.writeFileSync(hookPath, '// mine\n');
    const p = plan(['safety-hooks']);
    assert.ok(p.conflicts.some((c) => c.key.includes('protect-secrets.cjs')));
    apply(['safety-hooks']); // no force
    assert.equal(fs.readFileSync(hookPath, 'utf8'), '// mine\n', 'user file untouched');
    apply(['safety-hooks'], { force: true });
    assert.match(fs.readFileSync(hookPath, 'utf8'), /^#!/, 'force overwrote with ours');
  });
});

describe('remove', () => {
  it('reverses additions but keeps user content', () => {
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Mine\n\nkeep\n');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(make:*)'] } }, null, 2));
    apply(['safety-hooks', 'conventions', 'settings']);

    const ctx = engine.makeContext(repo, PLUGIN_ROOT);
    engine.removeAll(ctx);

    assert.match(read('CLAUDE.md'), /keep/, 'user prose kept');
    assert.doesNotMatch(read('CLAUDE.md'), /BEGIN 2ts-claude/, 'block removed');
    const s = readJson('.claude/settings.json');
    assert.ok(s.permissions.allow.includes('Bash(make:*)'), 'user allow kept');
    assert.ok(!s.permissions.allow.includes('Bash(git status:*)'), 'our allow removed');
    assert.ok(!fs.existsSync(path.join(repo, '.claude/hooks/pre-tool-use/protect-secrets.cjs')), 'vendored hook removed');
    assert.ok(!fs.existsSync(path.join(repo, '.claude/.2ts-claude.json')), 'manifest dropped');
  });

  it('keeps a vendored file the user modified after install', () => {
    apply(['safety-hooks']);
    const hookPath = path.join(repo, '.claude/hooks/pre-tool-use/protect-secrets.cjs');
    fs.writeFileSync(hookPath, '// edited after install\n');
    const ctx = engine.makeContext(repo, PLUGIN_ROOT);
    engine.removeAll(ctx);
    assert.ok(fs.existsSync(hookPath), 'user-modified file preserved on remove');
  });

  it('removes the conventions block from AGENTS.md and the import from CLAUDE.md, keeping user prose', () => {
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Agents\n\nkeep my agent rules\n');
    apply(['conventions']);
    const ctx = engine.makeContext(repo, PLUGIN_ROOT);
    engine.removeAll(ctx);
    assert.match(read('AGENTS.md'), /keep my agent rules/, 'user prose kept');
    assert.doesNotMatch(read('AGENTS.md'), /BEGIN 2ts-claude:conventions/, 'block removed from AGENTS.md');
    // CLAUDE.md held only the import, so removing it leaves an empty file that is deleted.
    const cmPath = path.join(repo, 'CLAUDE.md');
    assert.ok(!fs.existsSync(cmPath) || !/@AGENTS\.md/.test(read('CLAUDE.md')), 'import removed from CLAUDE.md');
  });

  it('removes the user deny defaults we added but keeps the user deny entry', () => {
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.claude/settings.json'),
      JSON.stringify({ permissions: { deny: ['Read(./custom-secret)'] } }, null, 2)
    );
    apply(['settings']);
    const ctx = engine.makeContext(repo, PLUGIN_ROOT);
    engine.removeAll(ctx);
    const deny = readJson('.claude/settings.json').permissions.deny;
    assert.ok(deny.includes('Read(./custom-secret)'), 'user deny kept');
    assert.ok(!deny.includes('Read(./.env)'), 'our deny default removed');
  });
});

describe('durable repo-file components', () => {
  const cases = [
    { id: 'editorconfig', dest: '.editorconfig' },
    { id: 'gitattributes', dest: '.gitattributes' },
    { id: 'pr-template', dest: '.github/pull_request_template.md' },
    { id: 'dependabot', dest: '.github/dependabot.yml' },
    { id: 'command-pr', dest: '.claude/commands/pr.md' },
  ];

  for (const { id, dest } of cases) {
    it(`${id}: lands the file, records its hash, re-runs as noop, and removes cleanly`, () => {
      apply([id]);

      // File lands.
      const abs = path.join(repo, dest);
      assert.ok(fs.existsSync(abs), `${dest} created`);

      // Manifest records the file with the correct hash.
      const m = readJson('.claude/.2ts-claude.json');
      const entry = m.files.find((f) => f.path === dest);
      assert.ok(entry, `${dest} recorded in manifest`);
      assert.equal(entry.sha256, merge.sha256(read(dest)), 'manifest hash matches file');
      assert.ok(m.components.includes(id), 'component recorded');

      // Re-running is fully idempotent.
      const second = plan([id]);
      assert.equal(second.conflicts.length, 0);
      assert.ok(second.ops.every((o) => o.action === 'noop'), 're-run is all noop');

      // Remove reverses it.
      const ctx = engine.makeContext(repo, PLUGIN_ROOT);
      engine.removeAll(ctx);
      assert.ok(!fs.existsSync(abs), `${dest} removed`);
      assert.ok(!fs.existsSync(path.join(repo, '.claude/.2ts-claude.json')), 'manifest dropped');
    });
  }

  it('keeps a user-modified durable file on remove', () => {
    apply(['editorconfig']);
    const abs = path.join(repo, '.editorconfig');
    fs.writeFileSync(abs, 'root = true\n# my edits\n');
    const ctx = engine.makeContext(repo, PLUGIN_ROOT);
    engine.removeAll(ctx);
    assert.ok(fs.existsSync(abs), 'user-modified file preserved on remove');
  });
});

describe('manifest', () => {
  it('stamps the plugin version on apply', () => {
    apply(['conventions']);
    const pluginVersion = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'plugin.json'), 'utf8')).version;
    assert.equal(readJson('.claude/.2ts-claude.json').pluginVersion, pluginVersion);
  });

  it('refuses to operate on a corrupt manifest instead of silently resetting', () => {
    apply(['conventions']);
    fs.writeFileSync(path.join(repo, '.claude/.2ts-claude.json'), '{ this is not json <<<<<<< HEAD');
    assert.throws(() => engine.makeContext(repo, PLUGIN_ROOT), /unparseable|MANIFEST_CORRUPT|manifest/i);
  });
});
