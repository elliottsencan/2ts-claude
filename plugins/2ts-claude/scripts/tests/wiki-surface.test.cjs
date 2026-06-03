#!/usr/bin/env node
/**
 * Tests for wiki-surface.cjs (UserPromptSubmit hook).
 * Run: node --test
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '../../assets/wiki/wiki-surface.cjs');

// Spawn the hook with a given stdin payload and environment. The hook resolves
// its sibling scorer (wiki-query.cjs) from its own dir, so running the source
// file Just Works.
function runHook(payload, env) {
    return new Promise((resolve, reject) => {
        const child = spawn('node', [SCRIPT], { env: { ...env, PATH: process.env.PATH } });
        let stdout = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.on('close', () => {
            try {
                resolve(JSON.parse(stdout.trim() || '{}'));
            } catch (e) {
                reject(new Error(`unparseable: ${stdout}`));
            }
        });
        child.stdin.write(typeof payload === 'string' ? payload : JSON.stringify(payload));
        child.stdin.end();
    });
}

let wikiRoot;
before(() => {
    // Build a tiny fixture corpus the scorer can resolve (<root>/src/content/wiki/*.md).
    wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-surface-'));
    const dir = path.join(wikiRoot, 'src', 'content', 'wiki');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'flaky-tests.md'),
        '---\ntitle: Flaky tests\nsummary: Tests that pass and fail nondeterministically and how to quarantine them.\naliases:\n  - test-flakiness\n---\nFlaky tests undermine trust in CI.\n',
    );
});
after(() => {
    if (wikiRoot) fs.rmSync(wikiRoot, { recursive: true, force: true });
});

describe('wiki-surface hook', () => {
    it('is a silent no-op when ELLIOTTSENCAN_WIKI_DIR is unset', async () => {
        const env = { ...process.env };
        delete env.ELLIOTTSENCAN_WIKI_DIR;
        const out = await runHook({ prompt: 'my flaky tests keep failing in CI', session_id: 't' }, env);
        assert.deepStrictEqual(out, {});
    });

    it('is silent on an empty prompt', async () => {
        const out = await runHook({ prompt: '   ', session_id: 't' }, { ...process.env, ELLIOTTSENCAN_WIKI_DIR: wikiRoot });
        assert.deepStrictEqual(out, {});
    });

    it('surfaces a strongly-matching concept as additionalContext', async () => {
        const out = await runHook(
            { prompt: 'how do I deal with flaky tests in my CI pipeline', session_id: 't' },
            { ...process.env, ELLIOTTSENCAN_WIKI_DIR: wikiRoot },
        );
        assert.equal(out.hookSpecificOutput?.hookEventName, 'UserPromptSubmit');
        assert.match(out.hookSpecificOutput.additionalContext, /Flaky tests/);
        assert.match(out.hookSpecificOutput.additionalContext, /\/wiki\/flaky-tests/);
    });

    it('stays silent on an off-topic prompt (below threshold)', async () => {
        const out = await runHook(
            { prompt: 'what is a good sourdough hydration ratio for baking', session_id: 't' },
            { ...process.env, ELLIOTTSENCAN_WIKI_DIR: wikiRoot },
        );
        assert.deepStrictEqual(out, {});
    });

    it('honors a raised WIKI_SURFACE_THRESHOLD to suppress weak (body-only) matches', async () => {
        // "undermine" only appears in the body (weight 1 -> score ~0.2), so a
        // high threshold filters it out.
        const out = await runHook(
            { prompt: 'undermine', session_id: 't' },
            { ...process.env, ELLIOTTSENCAN_WIKI_DIR: wikiRoot, WIKI_SURFACE_THRESHOLD: '0.9' },
        );
        assert.deepStrictEqual(out, {});
    });

    it('never throws on malformed stdin', async () => {
        const out = await runHook('not json', { ...process.env, ELLIOTTSENCAN_WIKI_DIR: wikiRoot });
        assert.deepStrictEqual(out, {});
    });
});
