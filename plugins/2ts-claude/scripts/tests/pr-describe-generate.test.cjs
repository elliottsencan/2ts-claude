#!/usr/bin/env node
// Tests for the deterministic PR-description scaffold (renderScaffold). Run: node --test

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '..', 'assets', 'github', 'pr-describe', 'generate.cjs');
const { renderScaffold, parseCloses } = require(SCRIPT);

describe('renderScaffold', () => {
  it('fills the sections from commits and changed files', () => {
    const out = renderScaffold({
      commits: ['feat: add thing', 'fix: bug'],
      files: ['src/a.ts', 'src/b.ts', 'README.md'],
      branch: 'feat/x',
    });
    assert.match(out, /## Summary/);
    assert.match(out, /- feat: add thing/);
    assert.match(out, /## Changes/);
    assert.match(out, /\*\*src\*\* — 2 files/);
    assert.match(out, /`README\.md`/); // root-level file grouped under (root)
    assert.match(out, /Closes #/);
  });

  it('parses distinct Closes #N from branch + commits', () => {
    assert.deepEqual(parseCloses('feat/foo #12 ... fixes #34 #12'), ['12', '34']);
    const out = renderScaffold({ commits: ['fix: thing (#7)'], files: [], branch: 'x' });
    assert.match(out, /Closes #7/);
  });

  it('uses the repo template structure when provided and keeps custom sections', () => {
    const template = '## Summary\n\n## Why\n\nkeep me\n\n## Linked issues\n\nCloses #';
    const out = renderScaffold({ commits: ['c'], files: ['x'], branch: 'b', template });
    assert.match(out, /## Why\n\nkeep me/); // custom section body preserved verbatim
    assert.match(out, /## Summary/);
    assert.match(out, /Closes #/);
  });

  it('falls back to the default template when none is provided', () => {
    const out = renderScaffold({ commits: [], files: [], branch: '' });
    assert.match(out, /## Summary/);
    assert.match(out, /## Testing \/ how to verify/);
    assert.match(out, /## Risk & rollback/);
  });

  it('does not throw on empty/missing input', () => {
    assert.doesNotThrow(() => renderScaffold());
    assert.doesNotThrow(() => renderScaffold({}));
  });
});
