#!/usr/bin/env node
/**
 * SessionStart drift reminder — plugin-side, operator-only.
 *
 * Only the plugin owner runs this (it lives in the plugin's hooks, not in any
 * target repo). It emits at most one terse line, injected as additionalContext,
 * and is silent in every other case. Two independent checks:
 *
 *   1. Repo drift  — the current repo's stamped config is older than the plugin
 *                    you have installed  → "run /setup to refresh".
 *   2. Plugin drift — your installed plugin is older than the latest published
 *                     version           → "run claude plugin update".
 *
 * The published check is cached for 24h, hard-times-out at 1.5s, fails silent,
 * and can be disabled with CCH_NO_UPDATE_CHECK=1.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

// This project's published manifest, served from the GitHub CDN (no auth, no
// API rate limit). Mirrors what `claude plugin update` would pull.
const PUBLISHED_URL = 'https://raw.githubusercontent.com/elliottsencan/2ts-claude/main/plugins/2ts-claude/plugin.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

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

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function getInstalledVersion(pluginRoot) {
  return (pluginRoot && (readJson(path.join(pluginRoot, 'plugin.json')) || {}).version) || null;
}

function getRepoVersion(projectDir) {
  return (readJson(path.join(projectDir, '.claude', '.2ts-claude.json')) || {}).pluginVersion || null;
}

// ---- check 1: repo vs installed plugin ----
function checkStale(projectDir, pluginRoot) {
  const repoVersion = getRepoVersion(projectDir);
  const installed = getInstalledVersion(pluginRoot);
  if (repoVersion && installed && compareVersions(repoVersion, installed) < 0) {
    return `2ts-claude defaults in this repo are stale (repo ${repoVersion} → plugin ${installed}). Run /setup to refresh.`;
  }
  return null;
}

// ---- check 2: installed plugin vs latest published ----
function cachePath() {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir() || '/tmp', '.claude');
  return path.join(dir, '.2ts-claude-update-check.json');
}

function fetchLatest(url = PUBLISHED_URL, timeoutMs = FETCH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let req;
    try {
      req = https.get(url, { timeout: timeoutMs, headers: { 'User-Agent': '2ts-claude' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body).version || null);
          } catch {
            resolve(null);
          }
        });
      });
    } catch {
      return resolve(null);
    }
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

// Cached published version. Hits the network at most once per TTL; falls back to
// a stale cache on failure; never throws.
async function getLatestPublished({ now = Date.now(), fetcher = fetchLatest } = {}) {
  const cache = readJson(cachePath());
  if (cache && cache.checkedAt && now - cache.checkedAt < CACHE_TTL_MS) {
    return cache.latest || null;
  }
  const latest = await fetcher();
  if (latest) {
    try {
      fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
      fs.writeFileSync(cachePath(), JSON.stringify({ checkedAt: now, latest }));
    } catch {}
    return latest;
  }
  return cache ? cache.latest || null : null;
}

function buildPublishedReminder(installed, latest) {
  if (installed && latest && compareVersions(installed, latest) < 0) {
    return `A newer 2ts-claude is available (installed ${installed} → latest ${latest}). Run: claude plugin update 2ts-claude@2ts-claude`;
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

  const parts = [];
  const repoMsg = checkStale(projectDir, pluginRoot);
  if (repoMsg) parts.push(repoMsg);

  if (process.env.CCH_NO_UPDATE_CHECK !== '1') {
    const latest = await getLatestPublished();
    const pubMsg = buildPublishedReminder(getInstalledVersion(pluginRoot), latest);
    if (pubMsg) parts.push(pubMsg);
  }

  if (parts.length) {
    return console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: parts.join(' ') } }));
  }
  console.log('{}');
}

if (require.main === module) {
  main();
} else {
  module.exports = { compareVersions, checkStale, getLatestPublished, buildPublishedReminder, fetchLatest };
}
