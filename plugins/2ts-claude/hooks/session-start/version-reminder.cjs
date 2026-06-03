#!/usr/bin/env node
/**
 * SessionStart drift reminder — plugin-side, operator-only.
 *
 * Only the plugin owner runs this (it lives in the plugin's hooks, not in any
 * target repo). When the current repo's stamped 2ts-claude config is older than
 * the installed plugin, it emits ONE terse line suggesting `/setup`. Silent in
 * every other case — no nag, no per-session noise.
 */

const fs = require('fs');
const path = require('path');

// Compare dotted versions. Returns -1 if a<b, 0 if equal, 1 if a>b.
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Returns a reminder string if the repo is behind the plugin, else null.
function checkStale(projectDir, pluginRoot) {
  const manifestPath = path.join(projectDir, '.claude', '.2ts-claude.json');
  if (!fs.existsSync(manifestPath)) return null;
  let repoVersion;
  try {
    repoVersion = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).pluginVersion;
  } catch {
    return null;
  }
  if (!repoVersion || !pluginRoot) return null;
  let installed;
  try {
    installed = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8')).version;
  } catch {
    return null;
  }
  if (!installed) return null;
  if (compareVersions(repoVersion, installed) < 0) {
    return `2ts-claude defaults in this repo are stale (repo ${repoVersion} → plugin ${installed}). Run /setup to refresh.`;
  }
  return null;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let data = {};
  try {
    data = JSON.parse(input || '{}');
  } catch {}

  const projectDir = process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd();
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '../..');

  const reminder = checkStale(projectDir, pluginRoot);
  if (reminder) {
    return console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: reminder } }));
  }
  console.log('{}');
}

if (require.main === module) {
  main();
} else {
  module.exports = { compareVersions, checkStale };
}
