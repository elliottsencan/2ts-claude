#!/usr/bin/env node
// Compose a PR body that keeps the original description as a collapsed reference
// and (re)places a generated section between stable markers. Shared by both the
// AI and the deterministic PR-describe workflows.
//
// The body transform (composeBody) is a pure function so it is unit-tested
// without gh; the CLI wraps it: read the live body via `gh pr view`, compose,
// write it back via `gh pr edit --body-file`.
//
// Usage (CI): node pr-describe-apply.cjs <pr-number> <generated-file>

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const GEN_BEGIN = '<!-- 2ts-claude:pr-description -->';
const GEN_END = '<!-- /2ts-claude:pr-description -->';
const ORIG_BEGIN = '<!-- 2ts-claude:original-description -->';
const ORIG_END = '<!-- /2ts-claude:original-description -->';

// Return the text between begin/end markers, or null if the pair isn't present.
function sectionBetween(body, begin, end) {
  const b = body.indexOf(begin);
  const e = body.indexOf(end);
  if (b === -1 || e === -1 || e < b) return null;
  return body.slice(b + begin.length, e).replace(/^\n/, '').replace(/\n$/, '');
}

// Remove a begin..end region (markers included) from body. No-op if absent.
function stripBetween(body, begin, end) {
  const b = body.indexOf(begin);
  const e = body.indexOf(end);
  if (b === -1 || e === -1 || e < b) return body;
  return body.slice(0, b) + body.slice(e + end.length);
}

// Pure: given the current PR body and a freshly generated section, return the new
// body. The original description is captured verbatim on the FIRST run and
// preserved untouched thereafter; only the generated section is replaced, so
// re-running never stacks blocks.
function composeBody(currentBody, generated) {
  const cur = typeof currentBody === 'string' ? currentBody : '';
  const gen = String(generated == null ? '' : generated).trim();
  const genBlock = `${GEN_BEGIN}\n${gen}\n${GEN_END}`;

  // Already processed once? Keep whatever was captured as the original.
  const existingOriginal = sectionBetween(cur, ORIG_BEGIN, ORIG_END);
  const originalBody =
    existingOriginal != null
      ? existingOriginal
      : // First run: everything currently in the body is the original. Strip any
        // stray generated block first so we never nest our own markers.
        stripBetween(cur, GEN_BEGIN, GEN_END).trim();

  if (!originalBody) return `${genBlock}\n`;

  const origBlock = `${ORIG_BEGIN}\n${originalBody}\n${ORIG_END}`;
  return `${genBlock}\n\n<details>\n<summary>📄 Original description</summary>\n\n${origBlock}\n\n</details>\n`;
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function main() {
  const pr = process.argv[2];
  const genFile = process.argv[3];
  if (!pr || !genFile) {
    process.stderr.write('usage: pr-describe-apply.cjs <pr-number> <generated-file>\n');
    process.exit(2);
  }
  const generated = fs.readFileSync(genFile, 'utf8');
  let current = '';
  try {
    current = (JSON.parse(gh(['pr', 'view', pr, '--json', 'body'])).body || '');
  } catch (_e) {
    current = '';
  }
  const next = composeBody(current, generated);
  const tmp = path.join(process.env.RUNNER_TEMP || '/tmp', `pr-body-${pr}.md`);
  fs.writeFileSync(tmp, next);
  gh(['pr', 'edit', pr, '--body-file', tmp]);
  process.stdout.write(`updated PR #${pr} description\n`);
}

if (require.main === module) {
  main();
} else {
  module.exports = { composeBody, sectionBetween, stripBetween, GEN_BEGIN, GEN_END, ORIG_BEGIN, ORIG_END };
}
