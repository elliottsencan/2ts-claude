#!/usr/bin/env node
/**
 * Format On Edit - PostToolUse Hook for Edit|Write
 * Runs Prettier on the file just edited so Claude observes the formatted result.
 * Mirrors .config/lintstaged.config.cjs (Prettier covers TS/HTML/JSON/MD/CSS/SCSS/Java).
 * ESLint --fix is intentionally skipped here because it is slow; husky pre-commit still runs it.
 *
 * Logs to: ~/.claude/hooks-logs/
 * Non-blocking: never returns a deny decision (PostToolUse runs after the edit).
 *
 * Setup in .claude/settings.json:
 * {
 *   "hooks": {
 *     "PostToolUse": [{
 *       "matcher": "Edit|Write",
 *       "hooks": [{ "type": "command", "command": "node .claude/hooks/post-tool-use/format-on-edit.cjs" }]
 *     }]
 *   }
 * }
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FORMATTABLE_EXTENSIONS = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.cjs',
    '.mjs',
    '.html',
    '.json',
    '.md',
    '.yml',
    '.yaml',
    '.css',
    '.scss',
    '.java',
]);

// Skip files under these directories even if extension matches.
const SKIP_DIR_PATTERNS = [
    /(?:^|\/)node_modules\//,
    /(?:^|\/)target\//,
    /(?:^|\/)dist\//,
    /(?:^|\/)\.git\//,
    /(?:^|\/)generated-types\.ts$/,
];

const PRETTIER_CONFIG = '.config/prettier.config.js';
const PRETTIER_IGNORE = '.config/.prettierignore';
const TIMEOUT_MS = 15000;

const LOG_DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '/tmp', '.claude'), 'hooks-logs');

function log(data) {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
        fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: 'format-on-edit', ...data }) + '\n');
    } catch {}
}

function findProjectRoot(startDir) {
    let dir = startDir;
    while (dir && dir !== path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
        dir = path.dirname(dir);
    }
    return null;
}

function shouldSkip(absPath) {
    for (const pattern of SKIP_DIR_PATTERNS) {
        if (pattern.test(absPath)) return true;
    }
    return false;
}

function runPrettier(projectRoot, absPath) {
    const configPath = path.join(projectRoot, PRETTIER_CONFIG);
    const ignorePath = path.join(projectRoot, PRETTIER_IGNORE);
    const prettierBin = path.join(projectRoot, 'node_modules', '.bin', 'prettier');

    const useLocalBin = fs.existsSync(prettierBin);
    const cmd = useLocalBin ? prettierBin : 'pnpm';
    const baseArgs = ['--write'];
    if (fs.existsSync(configPath)) baseArgs.push('--config', configPath);
    if (fs.existsSync(ignorePath)) baseArgs.push('--ignore-path', ignorePath);
    baseArgs.push(absPath);

    const args = useLocalBin ? baseArgs : ['exec', 'prettier', ...baseArgs];

    execFileSync(cmd, args, {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: TIMEOUT_MS,
    });
}

async function main() {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;

    try {
        const data = JSON.parse(input);
        const { tool_name, tool_input, session_id, cwd } = data;

        if (!['Edit', 'Write'].includes(tool_name)) {
            return console.log('{}');
        }

        const filePath = tool_input?.file_path;
        if (!filePath) return console.log('{}');

        const absPath = path.isAbsolute(filePath) ? filePath : path.join(cwd || process.cwd(), filePath);

        if (!fs.existsSync(absPath)) {
            log({ level: 'SKIP', reason: 'file missing', file: absPath, session_id });
            return console.log('{}');
        }

        const ext = path.extname(absPath).toLowerCase();
        if (!FORMATTABLE_EXTENSIONS.has(ext)) {
            return console.log('{}');
        }

        if (shouldSkip(absPath)) {
            log({ level: 'SKIP', reason: 'excluded dir', file: absPath, session_id });
            return console.log('{}');
        }

        const projectRoot = findProjectRoot(path.dirname(absPath));
        if (!projectRoot) {
            log({ level: 'SKIP', reason: 'no project root', file: absPath, session_id });
            return console.log('{}');
        }

        try {
            runPrettier(projectRoot, absPath);
            log({ level: 'FORMATTED', file: absPath, tool: tool_name, session_id });
        } catch (e) {
            // Prettier failure (e.g., parse error). Don't block — Claude can see the diagnostic later.
            log({
                level: 'PRETTIER_ERROR',
                file: absPath,
                error: (e.stderr?.toString() || e.message || '').slice(0, 500),
                session_id,
            });
        }

        console.log('{}');
    } catch (e) {
        log({ level: 'ERROR', error: e.message });
        console.log('{}');
    }
}

if (require.main === module) {
    main();
} else {
    module.exports = { FORMATTABLE_EXTENSIONS, SKIP_DIR_PATTERNS, findProjectRoot, shouldSkip };
}
