#!/usr/bin/env node
// Deterministic PR-description scaffold: fills the repo's PR template structurally
// from commits + changed files (no LLM). Used by the pr-describe-scaffold workflow.
//
// renderScaffold is pure (inputs are plain data) so it is unit-tested; main()
// gathers commits/files/branch via git and locates the template.
//
// Usage (CI): node pr-describe-generate.cjs > /tmp/pr-description.md

const fs = require('fs');
const { execFileSync } = require('child_process');

const TEMPLATE_CANDIDATES = [
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
];

// Mirrors assets/github/pull_request_template.md — used when the repo has none.
const DEFAULT_TEMPLATE = [
  '## Summary',
  '',
  '## Changes',
  '',
  '-',
  '',
  '## Testing / how to verify',
  '',
  '-',
  '',
  '## Risk & rollback',
  '',
  '## Linked issues',
  '',
  'Closes #',
  '',
].join('\n');

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch (_e) {
    return '';
  }
}

function findTemplate() {
  for (const p of TEMPLATE_CANDIDATES) {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch (_e) {
      /* try next */
    }
  }
  return '';
}

// Group changed files by top-level directory for a readable "Changes" list.
function groupFiles(files) {
  const groups = new Map();
  for (const f of files) {
    if (!f) continue;
    const top = f.includes('/') ? f.slice(0, f.indexOf('/')) : '(root)';
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push(f);
  }
  return groups;
}

function renderChanges(files) {
  const groups = groupFiles(files);
  if (groups.size === 0) return '-';
  const out = [];
  for (const [dir, list] of groups) {
    out.push(`- **${dir}** — ${list.length} file${list.length === 1 ? '' : 's'}`);
    for (const f of list) out.push(`  - \`${f}\``);
  }
  return out.join('\n');
}

// Extract distinct #N issue references (from branch name + commit subjects).
function parseCloses(text) {
  const out = [];
  const seen = new Set();
  const re = /#(\d+)\b/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

// Split a template into sections keyed by their markdown heading line. Leading
// content before the first heading is returned with an empty header.
function splitSections(template) {
  const lines = String(template || '').replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let cur = { header: '', body: [] };
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      sections.push(cur);
      cur = { header: line, body: [] };
    } else {
      cur.body.push(line);
    }
  }
  sections.push(cur);
  return sections;
}

// Fill a known section by heading keyword; keep custom sections' bodies as-is.
function fillSection(header, originalBody, ctx) {
  const h = header.toLowerCase();
  const kept = originalBody.replace(/^\n+|\n+$/g, '');
  if (/summary/.test(h)) return ctx.summary;
  if (/change/.test(h)) return ctx.changes;
  if (/link|issue/.test(h)) return ctx.closes;
  if (/test|verif|risk|rollback/.test(h)) return kept || '-';
  return kept; // unknown/custom section — leave the template's body untouched
}

// Pure: build the scaffold body from plain data.
function renderScaffold({ commits = [], files = [], branch = '', template = '' } = {}) {
  const tpl = template && template.trim() ? template : DEFAULT_TEMPLATE;
  const summaryLines = ['<!-- scaffolded from commits + changed files; edit me -->'];
  for (const c of commits) summaryLines.push(`- ${c}`);
  const closesNums = parseCloses(`${branch} ${commits.join(' ')}`);
  const ctx = {
    summary: summaryLines.join('\n'),
    changes: renderChanges(files),
    closes: closesNums.length ? closesNums.map((n) => `Closes #${n}`).join('\n') : 'Closes #',
  };

  const parts = [];
  for (const s of splitSections(tpl)) {
    const body = s.body.join('\n');
    if (!s.header) {
      const pre = body.trim();
      if (pre) parts.push(pre);
      continue;
    }
    parts.push(`${s.header}\n\n${fillSection(s.header, body, ctx)}`.trim());
  }
  return parts.join('\n\n').trim() + '\n';
}

function main() {
  const base = process.env.GITHUB_BASE_REF || 'main';
  const range = `origin/${base}...HEAD`;
  const commits = git(['log', '--format=%s', range]).split('\n').filter(Boolean);
  const files = git(['diff', '--name-only', range]).split('\n').filter(Boolean);
  const branch = process.env.GITHUB_HEAD_REF || git(['rev-parse', '--abbrev-ref', 'HEAD']);
  process.stdout.write(renderScaffold({ commits, files, branch, template: findTemplate() }));
}

if (require.main === module) {
  main();
} else {
  module.exports = { renderScaffold, groupFiles, renderChanges, parseCloses, splitSections, fillSection };
}
