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
});
