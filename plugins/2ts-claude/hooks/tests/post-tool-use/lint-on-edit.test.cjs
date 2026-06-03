#!/usr/bin/env node
/**
 * Tests for lint-on-edit.cjs
 *
 * Run: node --test
 * Or:  npm test
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { LINTABLE_EXTENSIONS, shouldSkip, resolveEslint } = require('../../post-tool-use/lint-on-edit.cjs');

const SCRIPT_PATH = path.join(__dirname, '../../post-tool-use/lint-on-edit.cjs');

function runHook(toolName, toolInput, cwd = '/tmp') {
    return new Promise((resolve, reject) => {
        const child = spawn('node', [SCRIPT_PATH]);
        let stdout = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.on('close', () => {
            try {
                resolve({ output: JSON.parse(stdout.trim() || '{}') });
            } catch (e) {
                reject(new Error(`Failed to parse: ${stdout}`));
            }
        });
        child.stdin.write(JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: toolName, tool_input: toolInput, session_id: 'test', cwd }));
        child.stdin.end();
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit: lintable extensions + skip dirs
// ─────────────────────────────────────────────────────────────────────────────

describe('Unit: extensions and skip dirs', () => {
    it('lints JS/TS extensions, not others', () => {
        assert.ok(LINTABLE_EXTENSIONS.has('.ts'));
        assert.ok(LINTABLE_EXTENSIONS.has('.cjs'));
        assert.ok(!LINTABLE_EXTENSIONS.has('.md'));
        assert.ok(!LINTABLE_EXTENSIONS.has('.json'));
    });

    it('skips vendored/build dirs', () => {
        assert.ok(shouldSkip('/repo/node_modules/foo/index.js'));
        assert.ok(shouldSkip('/repo/dist/bundle.js'));
        assert.ok(!shouldSkip('/repo/src/index.ts'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit: resolveEslint — only resolvable when binary AND config both present
// ─────────────────────────────────────────────────────────────────────────────

describe('Unit: resolveEslint()', () => {
    let dir;
    before(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-on-edit-'));
        fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    });
    after(() => {
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    it('returns null when no eslint binary exists', () => {
        fs.writeFileSync(path.join(dir, 'eslint.config.js'), 'module.exports = [];\n');
        assert.equal(resolveEslint(dir), null);
    });

    it('returns null when a binary exists but no config is present', () => {
        fs.rmSync(path.join(dir, 'eslint.config.js'));
        fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'node_modules', '.bin', 'eslint'), '#!/bin/sh\n');
        assert.equal(resolveEslint(dir), null);
    });

    it('resolves when both a local binary and a config are present', () => {
        fs.writeFileSync(path.join(dir, 'eslint.config.js'), 'module.exports = [];\n');
        assert.equal(resolveEslint(dir), path.join(dir, 'node_modules', '.bin', 'eslint'));
    });

    it('accepts an eslintConfig key in package.json as config', () => {
        fs.rmSync(path.join(dir, 'eslint.config.js'));
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ eslintConfig: { rules: {} } }));
        assert.equal(resolveEslint(dir), path.join(dir, 'node_modules', '.bin', 'eslint'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: stdin/stdout hook flow — never throws, always emits {}
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: stdin/stdout hook flow', () => {
    it('returns {} for a non-Edit/Write tool', async () => {
        const { output } = await runHook('Read', { file_path: '/tmp/test.ts' });
        assert.deepStrictEqual(output, {});
    });

    it('returns {} when file_path is missing', async () => {
        const { output } = await runHook('Edit', { old_string: 'a', new_string: 'b' });
        assert.deepStrictEqual(output, {});
    });

    it('returns {} for a lintable file in a repo without eslint (silent no-op)', async () => {
        const { output } = await runHook('Write', { file_path: '/tmp/nonexistent-lint-test.ts', content: 'x' });
        assert.deepStrictEqual(output, {});
    });

    it('returns {} for a non-lintable extension', async () => {
        const { output } = await runHook('Edit', { file_path: '/tmp/README.md', old_string: 'a', new_string: 'b' });
        assert.deepStrictEqual(output, {});
    });

    it('handles malformed JSON without throwing', async () => {
        const child = spawn('node', [SCRIPT_PATH]);
        let stdout = '';
        const result = await new Promise((resolve) => {
            child.stdout.on('data', (d) => (stdout += d));
            child.on('close', () => resolve(stdout.trim()));
            child.stdin.write('not json');
            child.stdin.end();
        });
        assert.strictEqual(result, '{}');
    });
});
