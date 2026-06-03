#!/usr/bin/env node
// Hermetic tests for the wiki lexical scorer. Run: node --test
// Builds its own temp fixture corpus — never depends on the real wiki, which
// won't exist in CI.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(
  __dirname,
  '..',
  '..',
  'assets',
  'wiki',
  'wiki-query.cjs',
);
const { loadConcepts, score, query } = require(SCRIPT);

// --- fixture ---------------------------------------------------------------

let fixtureDir; // the wikiDir root (contains src/content/wiki/*.md)
let wikiSubdir;
let emptyDir;

// Concept A: folded `>-` summary + block aliases (one hyphenated).
const FILE_A = `---
title: Context engineering
summary: >-
  Deliberate construction and management of the information fed into an LLM's
  context window, treated as a first-class engineering problem spanning
  retrieval strategy and token efficiency.
aliases:
  - context-window
  - prompt-context
sources:
  - some-source
---
Context engineering decides what information an LLM sees and in what form.
It treats the context window as a surface to be designed.
`;

// Concept B: minimal — no summary, no aliases, derive nothing special.
const FILE_B = `---
title: Kubernetes
---
Kubernetes is a container orchestration platform for deploying workloads.
`;

// Concept C: body-only keywords; the distinctive term "biomimetic" lives only
// in the prose, not the title/summary.
const FILE_C = `---
title: Memory systems
summary: Persistent agent memory across sessions.
---
Hindsight uses biomimetic data structures and multi-strategy retrieval so
agents accumulate knowledge across many sessions.
`;

before(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-fixture-'));
  wikiSubdir = path.join(fixtureDir, 'src', 'content', 'wiki');
  fs.mkdirSync(wikiSubdir, { recursive: true });
  fs.writeFileSync(path.join(wikiSubdir, 'context-engineering.md'), FILE_A);
  fs.writeFileSync(path.join(wikiSubdir, 'kubernetes.md'), FILE_B);
  fs.writeFileSync(path.join(wikiSubdir, 'memory-systems.md'), FILE_C);

  emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-empty-'));
});

after(() => {
  try {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(emptyDir, { recursive: true, force: true });
  } catch (_e) {
    /* ignore cleanup errors */
  }
});

// --- loadConcepts ----------------------------------------------------------

describe('loadConcepts', () => {
  it('resolves the nested src/content/wiki dir and parses all files', () => {
    const concepts = loadConcepts(fixtureDir);
    assert.equal(concepts.length, 3);
    const slugs = concepts.map((c) => c.slug).sort();
    assert.deepEqual(slugs, ['context-engineering', 'kubernetes', 'memory-systems']);
  });

  it('parses the folded >- summary into a single joined line', () => {
    const c = loadConcepts(fixtureDir).find((x) => x.slug === 'context-engineering');
    assert.equal(c.title, 'Context engineering');
    assert.match(c.summary, /^Deliberate construction and management/);
    assert.match(c.summary, /token efficiency\.$/);
    // Folded: continuation newlines collapse to spaces.
    assert.ok(!c.summary.includes('\n'), 'folded summary has no newlines');
  });

  it('parses block aliases including a hyphenated one', () => {
    const c = loadConcepts(fixtureDir).find((x) => x.slug === 'context-engineering');
    assert.deepEqual(c.aliases, ['context-window', 'prompt-context']);
  });

  it('handles the missing-aliases / missing-summary case', () => {
    const c = loadConcepts(fixtureDir).find((x) => x.slug === 'kubernetes');
    assert.deepEqual(c.aliases, []);
    assert.equal(c.summary, '');
    assert.equal(c.title, 'Kubernetes');
  });

  it('captures the body after the closing ---', () => {
    const c = loadConcepts(fixtureDir).find((x) => x.slug === 'memory-systems');
    assert.match(c.body, /biomimetic data structures/);
    assert.equal(c.summary, 'Persistent agent memory across sessions.');
  });

  it('derives a Title Case title from the slug when title is absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-notitle-'));
    const sub = path.join(dir, 'src', 'content', 'wiki');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'distributed-systems.md'), '---\n---\nbody\n');
    const c = loadConcepts(dir)[0];
    assert.equal(c.title, 'Distributed systems');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads flat *.md when there is no nested wiki dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-flat-'));
    fs.writeFileSync(path.join(dir, 'flat-concept.md'), '---\ntitle: Flat\n---\nbody\n');
    const concepts = loadConcepts(dir);
    assert.equal(concepts.length, 1);
    assert.equal(concepts[0].slug, 'flat-concept');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] for a missing/garbage dir without throwing', () => {
    assert.deepEqual(loadConcepts('/no/such/path/at/all'), []);
    assert.deepEqual(loadConcepts(undefined), []);
    assert.deepEqual(loadConcepts(null), []);
    assert.deepEqual(loadConcepts(123), []);
  });
});

// --- score -----------------------------------------------------------------

describe('score', () => {
  const concepts = () => loadConcepts(fixtureDir);

  it('ranks an alias-matching query to the right slug', () => {
    // "prompt-context" is an alias of context-engineering; the segment "prompt"
    // appears nowhere else.
    const results = score('prompt context window', concepts());
    assert.ok(results.length > 0);
    assert.equal(results[0].slug, 'context-engineering');
    assert.ok(results[0].score > 0 && results[0].score <= 1);
  });

  it('ranks a title-term query to the right concept', () => {
    const results = score('kubernetes orchestration', concepts());
    assert.equal(results[0].slug, 'kubernetes');
  });

  it('matches a body-only keyword', () => {
    // "biomimetic" appears only in memory-systems' prose, not any title/summary.
    const results = score('biomimetic accumulate', concepts());
    assert.equal(results[0].slug, 'memory-systems');
  });

  it('gives off-topic queries a low/zero top score (threshold-filterable)', () => {
    const results = score('pizza recipe gardening', concepts(), { threshold: 0 });
    assert.equal(results.length, 0);
  });

  it('produces a url and normalized score in [0,1]', () => {
    const results = score('context engineering', concepts());
    for (const r of results) {
      assert.equal(r.url, `/wiki/${r.slug}`);
      assert.ok(r.score >= 0 && r.score <= 1);
    }
  });

  it('respects the limit option', () => {
    const results = score('context kubernetes memory', concepts(), { limit: 1 });
    assert.equal(results.length, 1);
  });

  it('respects the threshold option', () => {
    const all = score('context engineering retrieval', concepts());
    assert.ok(all.length >= 1);
    const top = all[0].score;
    const filtered = score('context engineering retrieval', concepts(), {
      threshold: top + 0.0001,
    });
    assert.equal(filtered.length, 0);
  });

  it('is deterministic across runs', () => {
    const a = score('context window retrieval', concepts());
    const b = score('context window retrieval', concepts());
    assert.deepEqual(a, b);
  });

  it('returns [] for empty / garbage queries without throwing', () => {
    assert.deepEqual(score('', concepts()), []);
    assert.deepEqual(score('   ', concepts()), []);
    assert.deepEqual(score('!! ?? --', concepts()), []);
    assert.deepEqual(score(null, concepts()), []);
    assert.deepEqual(score(undefined, concepts()), []);
    assert.deepEqual(score(42, concepts()), []);
  });

  it('returns [] for an empty corpus without throwing', () => {
    assert.deepEqual(score('anything at all', []), []);
    assert.deepEqual(score('anything', loadConcepts(emptyDir)), []);
    assert.deepEqual(score('anything', null), []);
  });
});

// --- query convenience -----------------------------------------------------

describe('query', () => {
  it('combines loadConcepts + score via opts.wikiDir', () => {
    const results = query('kubernetes orchestration', { wikiDir: fixtureDir });
    assert.equal(results[0].slug, 'kubernetes');
  });

  it('does not throw with no wikiDir available', () => {
    const saved = process.env.ELLIOTTSENCAN_WIKI_DIR;
    delete process.env.ELLIOTTSENCAN_WIKI_DIR;
    try {
      assert.deepEqual(query('anything'), []);
    } finally {
      if (saved !== undefined) process.env.ELLIOTTSENCAN_WIKI_DIR = saved;
    }
  });
});

// --- CLI -------------------------------------------------------------------

describe('CLI', () => {
  it('runs with a query + --wiki-dir + --json, exits 0, prints parseable JSON', () => {
    const res = spawnSync(
      process.execPath,
      [SCRIPT, 'prompt context window', '--wiki-dir', fixtureDir, '--json'],
      { encoding: 'utf8' },
    );
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.length > 0);
    assert.equal(parsed[0].slug, 'context-engineering');
  });

  it('runs in default text mode and exits 0', () => {
    const res = spawnSync(
      process.execPath,
      [SCRIPT, 'kubernetes orchestration', '--wiki-dir', fixtureDir],
      { encoding: 'utf8' },
    );
    assert.equal(res.status, 0);
    assert.match(res.stdout, /\/wiki\/kubernetes/);
  });

  it('exits 0 (does not crash) with no args', () => {
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(res.status, 0);
  });

  it('exits 0 with a query but no wiki dir', () => {
    const env = Object.assign({}, process.env);
    delete env.ELLIOTTSENCAN_WIKI_DIR;
    const res = spawnSync(process.execPath, [SCRIPT, 'some query', '--json'], {
      encoding: 'utf8',
      env,
    });
    assert.equal(res.status, 0);
    assert.deepEqual(JSON.parse(res.stdout), []);
  });
});
