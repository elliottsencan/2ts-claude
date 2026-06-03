#!/usr/bin/env node
// Hermetic tests for the wiki lexical scorer. Run: node --test
// Builds its own temp fixture corpus — never depends on the real wiki, which
// won't exist in CI.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const SCRIPT = path.join(
  __dirname,
  '..',
  '..',
  'assets',
  'wiki',
  'wiki-query.cjs',
);
const {
  loadConcepts,
  loadConceptsCached,
  refreshCache,
  maybeSpawnRefresh,
  resolveIndexUrl,
  resolveTtlMs,
  resolveCacheDir,
  score,
  query,
} = require(SCRIPT);

// Keep the legacy local-dir tests hermetic: disable remote so loadConceptsCached
// can't reach the network, and isolate the cache so it can't read a developer's
// real ~/.claude/wiki-cache. (Cache-specific tests below set their own values.)
const SAVED_ENV = {
  url: process.env.ELLIOTTSENCAN_WIKI_INDEX_URL,
  cacheDir: process.env.WIKI_CACHE_DIR,
};
process.env.ELLIOTTSENCAN_WIKI_INDEX_URL = '';

// --- fixture ---------------------------------------------------------------

let fixtureDir; // the wikiDir root (contains src/content/wiki/*.md)
let wikiSubdir;
let emptyDir;
let isolatedCacheDir; // empty dir so the default cache read misses in legacy tests

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

  isolatedCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-cache-iso-'));
  process.env.WIKI_CACHE_DIR = isolatedCacheDir;
});

after(() => {
  try {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(emptyDir, { recursive: true, force: true });
    fs.rmSync(isolatedCacheDir, { recursive: true, force: true });
  } catch (_e) {
    /* ignore cleanup errors */
  }
  // Restore the env we borrowed.
  if (SAVED_ENV.url === undefined) delete process.env.ELLIOTTSENCAN_WIKI_INDEX_URL;
  else process.env.ELLIOTTSENCAN_WIKI_INDEX_URL = SAVED_ENV.url;
  if (SAVED_ENV.cacheDir === undefined) delete process.env.WIKI_CACHE_DIR;
  else process.env.WIKI_CACHE_DIR = SAVED_ENV.cacheDir;
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

// --- IDF weighting (opt-in) -------------------------------------------------

describe('score IDF weighting', () => {
  // "shared" is in every doc (common -> low IDF); "rare" is in only one
  // (distinctive -> high IDF). Body-only matches keep the arithmetic simple.
  const corpus = [
    { slug: 'a', title: '', summary: '', body: 'shared rare', aliases: [] },
    { slug: 'b', title: '', summary: '', body: 'shared', aliases: [] },
    { slug: 'c', title: '', summary: '', body: 'shared', aliases: [] },
  ];

  it('is byte-identical to the baseline when off (default and strength 0)', () => {
    const q = 'shared rare';
    const base = score(q, corpus, { threshold: 0 });
    assert.ok(base.length > 0);
    assert.deepEqual(score(q, corpus, { threshold: 0, idfStrength: 0 }), base);
  });

  it('a single-token query is invariant to IDF (the weight cancels in raw/denom)', () => {
    const base = score('shared', corpus, { threshold: 0 });
    assert.deepEqual(score('shared', corpus, { threshold: 0, idfStrength: 1 }), base);
  });

  it('demotes a match that hit only a common token, leaving a distinctive match intact', () => {
    const base = score('shared rare', corpus, { threshold: 0 });
    const idf = score('shared rare', corpus, { threshold: 0, idfStrength: 1 });
    const s = (rs, slug) => rs.find((r) => r.slug === slug).score;
    // 'a' matched the rare high-IDF token -> unchanged; 'b' matched only the
    // common low-IDF token -> pushed down.
    assert.ok(Math.abs(s(idf, 'a') - s(base, 'a')) < 1e-9, 'distinctive match unchanged');
    assert.ok(s(idf, 'b') < s(base, 'b') - 1e-9, 'common-only match demoted');
  });

  it('keeps scores normalized in [0,1] and preserves the correct #1', () => {
    const r = score('shared rare', corpus, { threshold: 0, idfStrength: 1.5 });
    for (const x of r) assert.ok(x.score >= 0 && x.score <= 1);
    assert.equal(r[0].slug, 'a');
  });

  it('reads strength from WIKI_IDF_STRENGTH when opts omit it', () => {
    const saved = process.env.WIKI_IDF_STRENGTH;
    try {
      process.env.WIKI_IDF_STRENGTH = '1';
      assert.deepEqual(
        score('shared rare', corpus, { threshold: 0 }),
        score('shared rare', corpus, { threshold: 0, idfStrength: 1 }),
      );
    } finally {
      if (saved === undefined) delete process.env.WIKI_IDF_STRENGTH;
      else process.env.WIKI_IDF_STRENGTH = saved;
    }
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

// --- cached index loader ---------------------------------------------------

describe('loadConceptsCached', () => {
  let cacheRoot;
  before(() => {
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-cache-'));
  });
  after(() => {
    try {
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    } catch (_e) {
      /* ignore */
    }
  });

  // Seed a cache dir with an index + meta. metaExtra overrides (e.g. an ancient
  // fetchedAt) let a test force the stale path.
  function seedCache(concepts, metaExtra) {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'c-'));
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(concepts));
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      JSON.stringify(Object.assign({ fetchedAt: Date.now() }, metaExtra)),
    );
    return dir;
  }

  it('serves a fresh cache and ignores the local clone', () => {
    const dir = seedCache([{ slug: 'cached-only', title: 'Cached only', summary: 's' }]);
    // wikiDir points at the real fixture, but the cache must win.
    const concepts = loadConceptsCached({ cacheDir: dir, wikiDir: fixtureDir, indexUrl: '', refresh: false });
    assert.deepEqual(concepts.map((c) => c.slug), ['cached-only']);
  });

  it('serves a stale cache synchronously without throwing (refresh suppressed)', () => {
    const dir = seedCache([{ slug: 'stale-entry', title: 'Stale' }], { fetchedAt: 1 });
    const concepts = loadConceptsCached({ cacheDir: dir, indexUrl: 'http://example.invalid/i.json', ttl: 1, refresh: false });
    assert.deepEqual(concepts.map((c) => c.slug), ['stale-entry']);
  });

  it('falls back to the local clone on a cold cache', () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'empty-'));
    const concepts = loadConceptsCached({ cacheDir: dir, wikiDir: fixtureDir, indexUrl: '', refresh: false });
    assert.equal(concepts.length, 3);
  });

  it('returns [] on a cold cache with no clone, without throwing', () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'empty2-'));
    assert.deepEqual(loadConceptsCached({ cacheDir: dir, indexUrl: '', refresh: false }), []);
  });

  it('normalizes cached entries (title fallback, drops slugless rows)', () => {
    const dir = seedCache([{ slug: 'no-title' }, { slug: '' }, { notslug: 1 }]);
    const concepts = loadConceptsCached({ cacheDir: dir, indexUrl: '', refresh: false });
    assert.equal(concepts.length, 1);
    assert.equal(concepts[0].slug, 'no-title');
    assert.equal(concepts[0].title, 'No title');
    assert.deepEqual(concepts[0].aliases, []);
  });

  it('survives a corrupt index without throwing', () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'corrupt-'));
    fs.writeFileSync(path.join(dir, 'index.json'), 'not json{');
    // Cold (unreadable) cache -> local fallback.
    const concepts = loadConceptsCached({ cacheDir: dir, wikiDir: fixtureDir, indexUrl: '', refresh: false });
    assert.equal(concepts.length, 3);
  });

  it('scores against the cached corpus via query()', () => {
    const dir = seedCache([
      { slug: 'kubernetes', title: 'Kubernetes', summary: 'container orchestration' },
      { slug: 'memory-systems', title: 'Memory systems' },
    ]);
    const results = query('kubernetes orchestration', { cacheDir: dir, indexUrl: '', refresh: false });
    assert.equal(results[0].slug, 'kubernetes');
  });

  it('unwraps a { concepts: [...] } payload (the site\'s /wiki.json shape)', () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'wrap-'));
    fs.writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify({
        generated_at: '2026-01-01T00:00:00.000Z',
        count: 1,
        concepts: [{ slug: 'wrapped', title: 'Wrapped', summary: 'from a wrapper' }],
      }),
    );
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ fetchedAt: Date.now() }));
    const concepts = loadConceptsCached({ cacheDir: dir, indexUrl: '', refresh: false });
    assert.deepEqual(concepts.map((c) => c.slug), ['wrapped']);
  });
});

describe('resolveIndexUrl', () => {
  const KEY = 'ELLIOTTSENCAN_WIKI_INDEX_URL';
  let saved;
  before(() => {
    saved = process.env[KEY];
  });
  after(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it('uses the default when the env is unset', () => {
    delete process.env[KEY];
    assert.equal(resolveIndexUrl({}), 'https://elliottsencan.com/wiki.json');
  });

  it('treats an explicit empty env as disabled (local only)', () => {
    process.env[KEY] = '';
    assert.equal(resolveIndexUrl({}), '');
  });

  it('lets an opt override the env, including disabling', () => {
    process.env[KEY] = 'https://env.example/i.json';
    assert.equal(resolveIndexUrl({ indexUrl: 'https://opt.example/i.json' }), 'https://opt.example/i.json');
    assert.equal(resolveIndexUrl({ indexUrl: '' }), '');
  });
});

describe('refreshCache (mocked fetch)', () => {
  let cacheRoot;
  let realFetch;
  before(() => {
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-refresh-'));
    realFetch = global.fetch;
  });
  after(() => {
    global.fetch = realFetch;
    try {
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    } catch (_e) {
      /* ignore */
    }
  });

  const headers = (map) => ({ get: (k) => map[String(k).toLowerCase()] || null });

  it('writes the index and meta on a 200', async () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'ok-'));
    global.fetch = async () => ({
      status: 200,
      ok: true,
      headers: headers({ etag: '"v1"' }),
      text: async () => JSON.stringify([{ slug: 'x', title: 'X' }]),
    });
    const ok = await refreshCache({ cacheDir: dir, indexUrl: 'https://example/i.json' });
    assert.equal(ok, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'))[0].slug, 'x');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    assert.equal(meta.etag, '"v1"');
    assert.ok(Number.isFinite(meta.fetchedAt));
  });

  it('sends If-None-Match and keeps the cached body on a 304', async () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'nm-'));
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify([{ slug: 'keep', title: 'Keep' }]));
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ etag: '"v1"', fetchedAt: 1 }));
    let sent = null;
    global.fetch = async (_url, init) => {
      sent = init.headers;
      return { status: 304, ok: false, headers: headers({}), text: async () => '' };
    };
    const ok = await refreshCache({ cacheDir: dir, indexUrl: 'https://example/i.json' });
    assert.equal(ok, true);
    assert.equal(sent['If-None-Match'], '"v1"');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'))[0].slug, 'keep');
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).fetchedAt > 1);
  });

  it('returns false and never throws on a network error', async () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'err-'));
    global.fetch = async () => {
      throw new Error('boom');
    };
    assert.equal(await refreshCache({ cacheDir: dir, indexUrl: 'https://example/i.json' }), false);
  });

  it('accepts a { concepts: [...] } wrapper body', async () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'wrap-'));
    global.fetch = async () => ({
      status: 200,
      ok: true,
      headers: headers({}),
      text: async () => JSON.stringify({ count: 1, concepts: [{ slug: 'w', title: 'W' }] }),
    });
    assert.equal(await refreshCache({ cacheDir: dir, indexUrl: 'https://example/i.json' }), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).count, 1);
    // The cached body round-trips through normalization on read.
    assert.deepEqual(
      loadConceptsCached({ cacheDir: dir, indexUrl: '', refresh: false }).map((c) => c.slug),
      ['w'],
    );
  });

  it('returns false (and writes nothing) on a non-array body', async () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'bad-'));
    global.fetch = async () => ({
      status: 200,
      ok: true,
      headers: headers({}),
      text: async () => '{"not":"an array"}',
    });
    assert.equal(await refreshCache({ cacheDir: dir, indexUrl: 'https://example/i.json' }), false);
    assert.equal(fs.existsSync(path.join(dir, 'index.json')), false);
  });

  it('does NOT touch the refresh lock (owned by maybeSpawnRefresh, ages by mtime)', async () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'lock-'));
    fs.writeFileSync(path.join(dir, 'refresh.lock'), '123');
    global.fetch = async () => ({
      status: 200,
      ok: true,
      headers: headers({}),
      text: async () => JSON.stringify([{ slug: 'y' }]),
    });
    await refreshCache({ cacheDir: dir, indexUrl: 'https://example/i.json' });
    // Deleting the lock here would defeat the ≤1/min throttle on the failure path.
    assert.equal(fs.existsSync(path.join(dir, 'refresh.lock')), true);
  });

  it('does not honor a 304 when the cached body is missing (avoids a permanent empty wedge)', async () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, '304-empty-'));
    // meta claims an etag, but there is NO index.json on disk.
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ etag: '"v1"', fetchedAt: 1 }));
    global.fetch = async () => ({ status: 304, ok: false, headers: headers({}), text: async () => '' });
    assert.equal(await refreshCache({ cacheDir: dir, indexUrl: 'https://example/i.json' }), false);
    assert.equal(fs.existsSync(path.join(dir, 'index.json')), false);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    assert.equal(meta.etag, ''); // validators dropped so the next GET is unconditional
    assert.equal(meta.fetchedAt, 1); // NOT bumped -> stays stale and keeps retrying
    assert.ok(meta.lastError);
  });

  it('records a failure breadcrumb in meta on a non-ok status, without bumping fetchedAt', async () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'breadcrumb-'));
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ etag: '"v1"', fetchedAt: 42 }));
    global.fetch = async () => ({ status: 404, ok: false, headers: headers({}), text: async () => 'nope' });
    assert.equal(await refreshCache({ cacheDir: dir, indexUrl: 'https://example/i.json' }), false);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    assert.match(meta.lastError, /404/);
    assert.ok(Number.isFinite(meta.lastErrorAt));
    assert.equal(meta.fetchedAt, 42); // preserved -> cache still counts as stale
    assert.equal(meta.etag, '"v1"'); // etag preserved for the next conditional GET
  });

  it('distinguishes a malformed (non-JSON) 200 body from a network error', async () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'htmlbody-'));
    global.fetch = async () => ({ status: 200, ok: true, headers: headers({}), text: async () => '<!DOCTYPE html>' });
    assert.equal(await refreshCache({ cacheDir: dir, indexUrl: 'https://example/i.json' }), false);
    assert.equal(fs.existsSync(path.join(dir, 'index.json')), false);
    assert.match(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).lastError, /malformed/);
  });

  it('clears a prior lastError on a successful refresh', async () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'recover-'));
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ lastError: 'http 404', lastErrorAt: 1, fetchedAt: 1 }));
    global.fetch = async () => ({
      status: 200,
      ok: true,
      headers: headers({ etag: '"ok"' }),
      text: async () => JSON.stringify([{ slug: 'recovered' }]),
    });
    assert.equal(await refreshCache({ cacheDir: dir, indexUrl: 'https://example/i.json' }), true);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    assert.equal(meta.lastError, undefined);
    assert.equal(meta.count, 1);
  });
});

describe('maybeSpawnRefresh (throttle, injected spawn)', () => {
  let cacheRoot;
  before(() => {
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-spawn-'));
  });
  after(() => {
    try {
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    } catch (_e) {
      /* ignore */
    }
  });

  // A fake child that records the call; never forks a real process.
  function recorder() {
    const calls = [];
    const fn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { unref() {} };
    };
    fn.calls = calls;
    return fn;
  }

  it('spawns once, writes the lock, and then throttles a burst', () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'burst-'));
    const spawn = recorder();
    assert.equal(maybeSpawnRefresh(dir, 'https://example/i.json', spawn), true);
    assert.equal(spawn.calls.length, 1);
    assert.equal(fs.existsSync(path.join(dir, 'refresh.lock')), true);
    // Immediately again: a fresh lock throttles the spawn.
    assert.equal(maybeSpawnRefresh(dir, 'https://example/i.json', spawn), false);
    assert.equal(spawn.calls.length, 1);
  });

  it('spawns again once the lock has aged past the TTL', () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'aged-'));
    const spawn = recorder();
    maybeSpawnRefresh(dir, 'https://example/i.json', spawn);
    // Backdate the lock well beyond REFRESH_LOCK_TTL_MS (60s).
    const old = Date.now() / 1000 - 3600;
    fs.utimesSync(path.join(dir, 'refresh.lock'), old, old);
    assert.equal(maybeSpawnRefresh(dir, 'https://example/i.json', spawn), true);
    assert.equal(spawn.calls.length, 2);
  });

  it('does not spawn when remote is disabled (empty url)', () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'nourl-'));
    const spawn = recorder();
    assert.equal(maybeSpawnRefresh(dir, '', spawn), false);
    assert.equal(spawn.calls.length, 0);
    assert.equal(fs.existsSync(path.join(dir, 'refresh.lock')), false);
  });

  it('passes the url + cache dir to the child via env and detaches it', () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'env-'));
    const spawn = recorder();
    maybeSpawnRefresh(dir, 'https://example/i.json', spawn);
    const { args, opts } = spawn.calls[0];
    assert.ok(args.includes('--refresh-cache'));
    assert.equal(opts.detached, true);
    assert.equal(opts.stdio, 'ignore');
    assert.equal(opts.env.ELLIOTTSENCAN_WIKI_INDEX_URL, 'https://example/i.json');
    assert.equal(opts.env.WIKI_CACHE_DIR, dir);
  });

  it('loadConceptsCached schedules a refresh on a stale cache but not a fresh one', () => {
    const fresh = fs.mkdtempSync(path.join(cacheRoot, 'fresh-'));
    fs.writeFileSync(path.join(fresh, 'index.json'), JSON.stringify([{ slug: 'a' }]));
    fs.writeFileSync(path.join(fresh, 'meta.json'), JSON.stringify({ fetchedAt: Date.now() }));
    const s1 = recorder();
    loadConceptsCached({ cacheDir: fresh, indexUrl: 'https://example/i.json', ttl: 3600, spawn: s1 });
    assert.equal(s1.calls.length, 0, 'fresh cache should not schedule a refresh');

    const stale = fs.mkdtempSync(path.join(cacheRoot, 'stale-'));
    fs.writeFileSync(path.join(stale, 'index.json'), JSON.stringify([{ slug: 'a' }]));
    fs.writeFileSync(path.join(stale, 'meta.json'), JSON.stringify({ fetchedAt: 1 }));
    const s2 = recorder();
    const out = loadConceptsCached({ cacheDir: stale, indexUrl: 'https://example/i.json', ttl: 1, spawn: s2 });
    assert.deepEqual(out.map((c) => c.slug), ['a'], 'still serves the stale body');
    assert.equal(s2.calls.length, 1, 'stale cache should schedule exactly one refresh');
  });

  it('loadConceptsCached schedules a refresh on a cold cache and falls back locally', () => {
    const cold = fs.mkdtempSync(path.join(cacheRoot, 'cold-'));
    const spawn = recorder();
    const out = loadConceptsCached({ cacheDir: cold, wikiDir: fixtureDir, indexUrl: 'https://example/i.json', spawn });
    assert.equal(out.length, 3, 'falls back to the local clone meanwhile');
    assert.equal(spawn.calls.length, 1);
  });
});

describe('resolveTtlMs', () => {
  const KEY = 'WIKI_INDEX_TTL';
  let saved;
  before(() => {
    saved = process.env[KEY];
  });
  after(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it('defaults to 6h (in milliseconds) when unset', () => {
    delete process.env[KEY];
    assert.equal(resolveTtlMs({}), 6 * 60 * 60 * 1000);
  });

  it('reads WIKI_INDEX_TTL (seconds) from the env', () => {
    process.env[KEY] = '120';
    assert.equal(resolveTtlMs({}), 120 * 1000);
  });

  it('lets opts.ttl override the env', () => {
    process.env[KEY] = '120';
    assert.equal(resolveTtlMs({ ttl: 5 }), 5000);
  });

  it('ignores zero/negative/NaN and falls through to the default', () => {
    process.env[KEY] = '0';
    assert.equal(resolveTtlMs({}), 6 * 60 * 60 * 1000);
    process.env[KEY] = 'abc';
    assert.equal(resolveTtlMs({}), 6 * 60 * 60 * 1000);
    process.env[KEY] = '-5';
    assert.equal(resolveTtlMs({}), 6 * 60 * 60 * 1000);
  });
});

describe('resolveCacheDir', () => {
  const KEY = 'WIKI_CACHE_DIR';
  let saved;
  before(() => {
    saved = process.env[KEY];
  });
  after(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it('prefers opts.cacheDir over the env', () => {
    process.env[KEY] = '/env/cache';
    assert.equal(resolveCacheDir({ cacheDir: '/opt/cache' }), '/opt/cache');
  });

  it('uses WIKI_CACHE_DIR when no opt is given', () => {
    process.env[KEY] = '/env/cache';
    assert.equal(resolveCacheDir({}), '/env/cache');
  });

  it('falls back to <config>/wiki-cache when neither is set', () => {
    delete process.env[KEY];
    assert.match(resolveCacheDir({}), /wiki-cache$/);
  });
});

describe('--refresh-cache entrypoint', () => {
  const http = require('http');
  let cacheRoot;
  before(() => {
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-entry-'));
  });
  after(() => {
    try {
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    } catch (_e) {
      /* ignore */
    }
  });

  // Async spawn (not spawnSync): the success test runs an in-process HTTP server,
  // and spawnSync would block this process's event loop so the server could never
  // answer the child's fetch.
  function runRefresh(env) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, '--refresh-cache'], {
        stdio: 'ignore',
        env: Object.assign({}, process.env, env),
      });
      child.on('close', (status) => resolve({ status }));
    });
  }

  it('exits 0 and writes nothing when remote is disabled', async () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'off-'));
    const res = await runRefresh({ WIKI_CACHE_DIR: dir, ELLIOTTSENCAN_WIKI_INDEX_URL: '' });
    assert.equal(res.status, 0);
    assert.equal(fs.existsSync(path.join(dir, 'index.json')), false);
  });

  it('exits 0 and populates the cache from a live endpoint', async () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'live-'));
    const body = JSON.stringify({ count: 1, concepts: [{ slug: 'k', title: 'K', summary: 'orchestration' }] });
    const server = http.createServer((_req, res) => {
      res.setHeader('ETag', '"e1"');
      res.setHeader('Content-Type', 'application/json');
      res.end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
      const res = await runRefresh({ WIKI_CACHE_DIR: dir, ELLIOTTSENCAN_WIKI_INDEX_URL: `http://127.0.0.1:${port}/wiki.json` });
      assert.equal(res.status, 0);
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).concepts[0].slug, 'k');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).etag, '"e1"');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('exits 0 (never non-zero) even when the endpoint is unreachable', async () => {
    const dir = fs.mkdtempSync(path.join(cacheRoot, 'down-'));
    // Port 9 (discard) refuses fast; the worker must still exit 0.
    const res = await runRefresh({ WIKI_CACHE_DIR: dir, ELLIOTTSENCAN_WIKI_INDEX_URL: 'http://127.0.0.1:9/x.json' });
    assert.equal(res.status, 0);
    assert.equal(fs.existsSync(path.join(dir, 'index.json')), false);
  });
});
