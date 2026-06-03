#!/usr/bin/env node
/**
 * Lint On Edit - PostToolUse Hook for Edit|Write
 * Runs `eslint --fix` on the file just edited so Claude observes the linted result.
 * Sibling to format-on-edit.cjs (which runs Prettier).
 *
 * Invisible-until-it-helps: only runs when eslint is genuinely resolvable in the
 * project — a local eslint binary AND an eslint config both present — and the
 * file extension is lintable. Any repo without eslint is a silent no-op, so this
 * never nags. Never blocks: PostToolUse runs after the edit and we only log.
 *
 * Logs to: ~/.claude/hooks-logs/
 *
 * Setup in .claude/settings.json:
 * {
 *   "hooks": {
 *     "PostToolUse": [{
 *       "matcher": "Edit|Write",
 *       "hooks": [{ "type": "command", "command": "node .claude/hooks/post-tool-use/lint-on-edit.cjs" }]
 *     }]
 *   }
 * }
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LINTABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs']);

// Skip files under these directories even if extension matches.
const SKIP_DIR_PATTERNS = [
    /(?:^|\/)node_modules\//,
    /(?:^|\/)target\//,
    /(?:^|\/)dist\//,
    /(?:^|\/)\.git\//,
];

// Flat-config and legacy eslintrc filenames that signal eslint is configured.
const ESLINT_CONFIG_FILES = [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc.yml',
    '.eslintrc.yaml',
];

const TIMEOUT_MS = 15000;

const LOG_DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '/tmp', '.claude'), 'hooks-logs');

function log(data) {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
        fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: 'lint-on-edit', ...data }) + '\n');
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

// eslint is "resolvable" only when a local binary exists AND a config is present.
// Either missing -> silent no-op (no nag for repos that don't use eslint).
function resolveEslint(projectRoot) {
    const eslintBin = path.join(projectRoot, 'node_modules', '.bin', 'eslint');
    if (!fs.existsSync(eslintBin)) return null;
    const hasConfigFile = ESLINT_CONFIG_FILES.some((f) => fs.existsSync(path.join(projectRoot, f)));
    let hasPkgConfig = false;
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
        hasPkgConfig = pkg && pkg.eslintConfig != null;
    } catch {}
    if (!hasConfigFile && !hasPkgConfig) return null;
    return eslintBin;
}

function runEslint(projectRoot, eslintBin, absPath) {
    execFileSync(eslintBin, ['--fix', absPath], {
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
        if (!LINTABLE_EXTENSIONS.has(ext)) {
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

        const eslintBin = resolveEslint(projectRoot);
        if (!eslintBin) {
            // No eslint binary/config -> nothing to do. Stay invisible.
            return console.log('{}');
        }

        try {
            runEslint(projectRoot, eslintBin, absPath);
            log({ level: 'LINTED', file: absPath, tool: tool_name, session_id });
        } catch (e) {
            // eslint exits non-zero on unfixable lint errors. Don't block — Claude
            // can see the diagnostic later.
            log({
                level: 'ESLINT_ERROR',
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
    module.exports = { LINTABLE_EXTENSIONS, SKIP_DIR_PATTERNS, ESLINT_CONFIG_FILES, findProjectRoot, shouldSkip, resolveEslint };
}
