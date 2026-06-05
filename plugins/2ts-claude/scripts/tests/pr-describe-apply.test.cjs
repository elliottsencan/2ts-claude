#!/usr/bin/env node
// Tests for the PR-description envelope (composeBody) — pure, no gh. Run: node --test

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '..', 'assets', 'github', 'pr-describe', 'apply-description.cjs');
const { composeBody, GEN_BEGIN, GEN_END, ORIG_BEGIN, ORIG_END } = require(SCRIPT);

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

describe('composeBody', () => {
  it('first run wraps the original and inserts the generated section above it', () => {
    const out = composeBody('Original body here.', '## Summary\nNew.');
    assert.ok(out.includes(GEN_BEGIN) && out.includes(GEN_END), 'has generated markers');
    assert.ok(out.includes('## Summary\nNew.'), 'has generated content');
    assert.ok(out.includes(ORIG_BEGIN) && out.includes(ORIG_END), 'has original markers');
    assert.ok(out.includes('Original body here.'), 'preserves original content');
    assert.ok(out.includes('<details>'), 'collapses the original');
    assert.ok(out.indexOf(GEN_BEGIN) < out.indexOf(ORIG_BEGIN), 'generated comes before original');
  });

  it('re-run replaces only the generated section and preserves the original', () => {
    const first = composeBody('ORIGINAL', 'GEN-ONE');
    const second = composeBody(first, 'GEN-TWO');
    assert.ok(second.includes('GEN-TWO'), 'new generated content present');
    assert.ok(!second.includes('GEN-ONE'), 'old generated content gone');
    assert.ok(second.includes('ORIGINAL'), 'original preserved');
    assert.equal(count(second, GEN_BEGIN), 1, 'exactly one generated block');
    assert.equal(count(second, ORIG_BEGIN), 1, 'exactly one original block (no stacking)');
  });

  it('captures the original verbatim once, across multiple re-runs', () => {
    let body = composeBody('THE ORIGINAL', 'g1');
    body = composeBody(body, 'g2');
    body = composeBody(body, 'g3');
    assert.equal(count(body, 'THE ORIGINAL'), 1, 'original captured once');
    assert.equal(count(body, ORIG_BEGIN), 1);
    assert.ok(body.includes('g3') && !body.includes('g1') && !body.includes('g2'));
  });

  it('is stable when re-run with the same generated section', () => {
    const first = composeBody('orig', 'same');
    assert.equal(composeBody(first, 'same'), first);
  });

  it('omits the original block when there was no prior body', () => {
    const out = composeBody('', 'GEN');
    assert.ok(out.includes('GEN'));
    assert.ok(!out.includes(ORIG_BEGIN), 'no original markers');
    assert.ok(!out.includes('<details>'), 'no collapsed section');
  });

  it('captures the true original when a stray generated block exists but no original block', () => {
    const stray = `${GEN_BEGIN}\nstale gen\n${GEN_END}\n\nReal original text.`;
    const out = composeBody(stray, 'fresh');
    assert.ok(out.includes('fresh'));
    assert.ok(!out.includes('stale gen'), 'stray generated block not captured as original');
    assert.ok(out.includes('Real original text.'));
  });

  it('never throws on non-string input', () => {
    assert.doesNotThrow(() => composeBody(null, null));
    assert.doesNotThrow(() => composeBody(undefined, 123));
  });
});
