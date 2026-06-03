#!/usr/bin/env node
/**
 * Wiki Surface - UserPromptSubmit Hook
 * Quietly checks each prompt against your personal wiki (elliottsencan.com) and,
 * ONLY when a concept clears a confidence threshold, injects a one-line pointer
 * as additional context. Invisible until it helps: silent on weak/no matches,
 * and a complete no-op when the wiki isn't configured/present.
 *
 * Threshold defaults to 0.15 — the value the wiki-surface-precision lab found
 * drives the false-positive (nag) rate to ~0 while keeping recall highest.
 * Override with WIKI_SURFACE_THRESHOLD.
 *
 * Reads the wiki via the sibling scorer (wiki-query.cjs), pointed at
 * $ELLIOTTSENCAN_WIKI_DIR. Never blocks, never throws.
 *
 * Logs to: ~/.claude/hooks-logs/
 *
 * Setup in .claude/settings.local.json (local scope — personal, git-ignored):
 * {
 *   "hooks": {
 *     "UserPromptSubmit": [{
 *       "hooks": [{ "type": "command", "command": "node .claude/local/hooks/wiki-surface.cjs" }]
 *     }]
 *   }
 * }
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_THRESHOLD = 0.15;
// Surface only the single best match: the lab (wiki-surface-precision) measured
// precision@1, and a marginal second suggestion is exactly the low-grade noise
// the "invisible until it helps" rubric says to cut.
const MAX_SUGGESTIONS = 1;

const LOG_DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '/tmp', '.claude'), 'hooks-logs');

function log(data) {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
        fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: 'wiki-surface', ...data }) + '\n');
    } catch {}
}

function loadScorer() {
    // The scorer is vendored alongside this hook (.claude/local/hooks/).
    try {
        return require(path.join(__dirname, 'wiki-query.cjs'));
    } catch {
        return null;
    }
}

function resolveThreshold() {
    const raw = Number(process.env.WIKI_SURFACE_THRESHOLD);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_THRESHOLD;
}

async function main() {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;

    try {
        const data = JSON.parse(input);
        const prompt = data && typeof data.prompt === 'string' ? data.prompt : '';
        const sessionId = data && data.session_id;

        const wikiDir = process.env.ELLIOTTSENCAN_WIKI_DIR;
        if (!wikiDir || !prompt.trim()) return console.log('{}'); // not configured / nothing to match

        const scorer = loadScorer();
        if (!scorer || typeof scorer.query !== 'function') {
            log({ level: 'SKIP', reason: 'scorer unavailable', session_id: sessionId });
            return console.log('{}');
        }

        const threshold = resolveThreshold();
        const matches = scorer.query(prompt, { wikiDir, limit: MAX_SUGGESTIONS, threshold });
        if (!matches.length) return console.log('{}'); // below threshold -> stay silent

        const lines = matches.map((m) => `- [${m.title}](${m.url})${m.summary ? ` — ${m.summary}` : ''}`).join('\n');
        const additionalContext = `📚 Possibly relevant from your wiki (elliottsencan.com):\n${lines}`;

        log({ level: 'SURFACED', count: matches.length, top: matches[0].slug, score: matches[0].score, session_id: sessionId });
        console.log(
            JSON.stringify({
                hookSpecificOutput: {
                    hookEventName: 'UserPromptSubmit',
                    additionalContext,
                },
            }),
        );
    } catch (e) {
        log({ level: 'ERROR', error: e.message });
        console.log('{}');
    }
}

if (require.main === module) {
    // Last-resort guard: a stdin stream error must never become an unhandled
    // rejection (which would surface a hook error on every prompt).
    main().catch(() => console.log('{}'));
} else {
    module.exports = { resolveThreshold, DEFAULT_THRESHOLD };
}
