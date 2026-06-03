#!/usr/bin/env node
// Unit tests for the pure merge helpers. Run: node --test

const { describe, it } = require('node:test');
const assert = require('node:assert');
const merge = require('../lib/merge.cjs');

describe('upsertBlock', () => {
  it('creates a block in an empty file', () => {
    const { content, action } = merge.upsertBlock('', 'conventions', 'hello');
    assert.equal(action, 'create');
    assert.match(content, /<!-- BEGIN 2ts-claude:conventions -->\nhello\n<!-- END 2ts-claude:conventions -->/);
  });

  it('appends without touching existing user content', () => {
    const existing = '# My rules\n\nkeep me\n';
    const { content, action } = merge.upsertBlock(existing, 'conventions', 'block body');
    assert.equal(action, 'append');
    assert.ok(content.startsWith('# My rules\n\nkeep me\n'), 'user content preserved');
    assert.match(content, /block body/);
  });

  it('replaces only the block body, preserving surrounding content', () => {
    const before = 'TOP\n<!-- BEGIN 2ts-claude:c -->\nold\n<!-- END 2ts-claude:c -->\nBOTTOM\n';
    const { content, action } = merge.upsertBlock(before, 'c', 'new');
    assert.equal(action, 'replace');
    assert.ok(content.startsWith('TOP\n'));
    assert.ok(content.endsWith('BOTTOM\n'));
    assert.match(content, /\nnew\n/);
    assert.doesNotMatch(content, /old/);
  });

  it('is a noop when the body is unchanged', () => {
    const before = '<!-- BEGIN 2ts-claude:c -->\nsame\n<!-- END 2ts-claude:c -->\n';
    const { action } = merge.upsertBlock(before, 'c', 'same');
    assert.equal(action, 'noop');
  });
});

describe('readBlockBody', () => {
  it('returns the body or null', () => {
    const content = 'x\n<!-- BEGIN 2ts-claude:c -->\nbody here\n<!-- END 2ts-claude:c -->\ny\n';
    assert.equal(merge.readBlockBody(content, 'c'), 'body here');
    assert.equal(merge.readBlockBody(content, 'missing'), null);
    assert.equal(merge.readBlockBody('', 'c'), null);
  });
});

describe('removeBlock', () => {
  it('strips the block but keeps surrounding content', () => {
    const before = 'TOP\n\n<!-- BEGIN 2ts-claude:c -->\nbody\n<!-- END 2ts-claude:c -->\n\nBOTTOM\n';
    const out = merge.removeBlock(before, 'c');
    assert.match(out, /TOP/);
    assert.match(out, /BOTTOM/);
    assert.doesNotMatch(out, /body/);
    assert.doesNotMatch(out, /BEGIN 2ts-claude/);
  });
});

describe('unionArray', () => {
  it('dedupes and reports only the newly added items', () => {
    const { result, added } = merge.unionArray(['a', 'b'], ['b', 'c']);
    assert.deepEqual(result, ['a', 'b', 'c']);
    assert.deepEqual(added, ['c']);
  });

  it('treats a missing base as empty', () => {
    const { result, added } = merge.unionArray(undefined, ['x']);
    assert.deepEqual(result, ['x']);
    assert.deepEqual(added, ['x']);
  });
});
