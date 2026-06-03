#!/usr/bin/env node
// Zero-dependency lexical scorer for the elliottsencan.com personal wiki.
//
// Vendored into arbitrary repos and invoked from a hook, a slash command, and a
// lab. It must be fully self-contained (no external deps, not even js-yaml) and
// must NEVER throw on bad or missing input — every failure path returns empty
// results / prints usage and exits 0.
//
// API:
//   loadConcepts(wikiDir) -> [{ slug, title, aliases[], summary, body }]
//   score(query, concepts, opts) -> [{ slug, title, summary, url, score }]
//   query(text, opts) -> score(text, loadConcepts(opts.wikiDir ?? env), opts)

const fs = require('fs');
const os = require('os');
const path = require('path');

// --- scoring config ----------------------------------------------------------

const WEIGHTS = { alias: 5, slug: 5, title: 3, summary: 2, body: 1 };
const MAX_TOKEN_WEIGHT = 5; // the biggest weight a single query token can earn
const MIN_TOKEN_LEN = 3;

// Tiny stopword set — common words that carry no retrieval signal.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'how', 'what', 'why', 'who', 'when', 'where',
  'are', 'was', 'were', 'this', 'that', 'these', 'those', 'from', 'into',
  'your', 'you', 'our', 'its', 'their', 'them', 'they', 'has', 'have', 'had',
  'can', 'will', 'would', 'should', 'could', 'about', 'over', 'under', 'than',
  'then', 'but', 'not', 'all', 'any', 'some', 'such', 'via', 'per', 'use',
  'using', 'get', 'got', 'out', 'off',
]);

// --- helpers -----------------------------------------------------------------

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (_e) {
    return [];
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_e) {
    return false;
  }
}

function safeReadFile(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (_e) {
    return '';
  }
}

// kebab-case slug -> Title Case fallback title.
function slugToTitle(slug) {
  const s = String(slug || '').replace(/[-_]+/g, ' ').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function tokenize(text) {
  if (typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t));
}

// --- frontmatter parsing -----------------------------------------------------

// Tolerant, hand-rolled frontmatter reader. We only need title/aliases/summary
// plus the body. Anything unexpected is ignored rather than thrown.
function parseFrontmatter(raw) {
  const result = { title: '', aliases: [], summary: '', body: '' };
  if (typeof raw !== 'string' || raw.length === 0) return result;

  // Normalize newlines so \r\n files behave.
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (!text.startsWith('---')) {
    // No frontmatter at all — treat the whole file as body.
    result.body = text.trim();
    return result;
  }

  const lines = text.split('\n');
  // lines[0] is the opening '---'. Find the closing '---'.
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closeIdx = i;
      break;
    }
  }

  if (closeIdx === -1) {
    // Unterminated frontmatter — bail out gracefully, everything is body.
    result.body = text.trim();
    return result;
  }

  const fmLines = lines.slice(1, closeIdx);
  result.body = lines.slice(closeIdx + 1).join('\n').trim();

  // A "top-level key" line starts at column 0 (no leading whitespace) and looks
  // like `key:` or `key: value`.
  const topKeyRe = /^([A-Za-z0-9_-]+):(.*)$/;

  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    const m = line.match(topKeyRe);
    if (!m) continue; // continuation line handled by its owning key below
    const key = m[1];
    const inlineRaw = m[2].trim();

    if (key === 'title') {
      result.title = stripQuotes(inlineRaw);
      continue;
    }

    if (key === 'aliases') {
      // Inline flow list: aliases: [a, b]
      if (inlineRaw.startsWith('[')) {
        result.aliases = parseInlineList(inlineRaw);
      }
      // Block list: subsequent `  - value` lines.
      for (let j = i + 1; j < fmLines.length; j++) {
        const item = fmLines[j];
        const im = item.match(/^\s+-\s+(.*)$/);
        if (im) {
          const v = stripQuotes(im[1].trim());
          if (v) result.aliases.push(v);
          continue;
        }
        // Stop at the next top-level key or any non-list, non-blank line.
        if (item.trim() === '') continue;
        if (topKeyRe.test(item)) break;
        // Indented non-list content under aliases is unexpected; stop.
        break;
      }
      continue;
    }

    if (key === 'summary') {
      // Folded/literal block scalar: summary: >- (or >, |, |-)
      if (/^[>|][-+]?\s*$/.test(inlineRaw) || inlineRaw === '') {
        const parts = [];
        for (let j = i + 1; j < fmLines.length; j++) {
          const cont = fmLines[j];
          if (cont.trim() === '') {
            // Blank line inside a block scalar — paragraph break.
            if (parts.length) parts.push('');
            continue;
          }
          // Continuation must be indented; a top-level key ends the block.
          if (/^\s+/.test(cont)) {
            parts.push(cont.trim());
            continue;
          }
          break;
        }
        // Folded scalars join with spaces; blank entries become paragraph breaks.
        result.summary = parts
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      } else {
        // Plain single-line summary.
        result.summary = stripQuotes(inlineRaw);
      }
      continue;
    }
  }

  return result;
}

function stripQuotes(v) {
  const s = String(v == null ? '' : v).trim();
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function parseInlineList(raw) {
  const inner = String(raw).replace(/^\[/, '').replace(/\]$/, '');
  return inner
    .split(',')
    .map((x) => stripQuotes(x.trim()))
    .filter(Boolean);
}

// --- public: loadConcepts ----------------------------------------------------

function resolveCorpusDir(wikiDir) {
  if (!wikiDir || typeof wikiDir !== 'string') return null;
  const nested = path.join(wikiDir, 'src', 'content', 'wiki');
  if (isDir(nested)) return nested;
  if (isDir(wikiDir)) return wikiDir;
  return null;
}

function loadConcepts(wikiDir) {
  try {
    const dir = resolveCorpusDir(wikiDir);
    if (!dir) return [];
    const files = safeReadDir(dir).filter((f) => f.toLowerCase().endsWith('.md'));
    const concepts = [];
    for (const file of files) {
      const slug = file.replace(/\.md$/i, '');
      const raw = safeReadFile(path.join(dir, file));
      const fm = parseFrontmatter(raw);
      concepts.push({
        slug,
        title: fm.title || slugToTitle(slug),
        aliases: Array.isArray(fm.aliases) ? fm.aliases.filter(Boolean) : [],
        summary: fm.summary || '',
        body: fm.body || '',
      });
    }
    return concepts;
  } catch (_e) {
    return [];
  }
}

// --- public: score -----------------------------------------------------------

// Build the set of token-strings a query token can match against an alias.
// We match an alias whole-token ("ai-coordination" -> token "coordination"
// from query "coordination" should hit) AND as a hyphen segment.
function aliasTokenSet(aliases) {
  const set = new Set();
  for (const a of aliases || []) {
    const lower = String(a).toLowerCase();
    set.add(lower); // whole alias, e.g. "ai-coordination"
    for (const seg of lower.split(/[-_]+/)) {
      if (seg) set.add(seg); // segment, e.g. "ai", "coordination"
    }
  }
  return set;
}

function slugTokenSet(slug) {
  const set = new Set();
  const lower = String(slug).toLowerCase();
  set.add(lower);
  for (const seg of lower.split(/[-_]+/)) {
    if (seg) set.add(seg);
  }
  return set;
}

// --- IDF weighting (experimental, opt-in) ------------------------------------
//
// The baseline scorer treats every query token as equally informative, so a token
// that appears in most entries (e.g. "agent") can clear the threshold on its own —
// a precision leak. IDF down-weights such common tokens using corpus document
// frequency. OFF by default (WIKI_IDF_STRENGTH / opts.idfStrength = 0), in which
// case every weight is exactly 1 and score() is byte-identical to the baseline.
//
// strength s tunes the effect: weight(t) = idf(t) ** s, with the smoothed
// idf(t) = ln((N + 1) / (df(t) + 1)) + 1  (always >= 1). s = 0 -> all weights 1
// (baseline); larger s -> common tokens contribute progressively less.

// The combined match-token set for one concept — the union the scorer can hit, so
// document frequency is computed over exactly what query tokens are matched against.
function conceptTokenSet(c) {
  const set = new Set();
  for (const t of slugTokenSet(String(c && c.slug ? c.slug : ''))) set.add(t);
  for (const t of aliasTokenSet(c && Array.isArray(c.aliases) ? c.aliases : [])) set.add(t);
  for (const t of tokenize(String(c && c.title ? c.title : ''))) set.add(t);
  for (const t of tokenize(String(c && c.summary ? c.summary : ''))) set.add(t);
  for (const t of tokenize(String(c && c.body ? c.body : ''))) set.add(t);
  return set;
}

// Memoize df by corpus identity: the eval runs hundreds of queries over one
// corpus, and a live hook would reuse the same cached concept array per process.
const DF_CACHE = new WeakMap();
function documentFrequencies(list) {
  let cached = DF_CACHE.get(list);
  if (cached) return cached;
  const df = new Map();
  for (const c of list) {
    for (const t of conceptTokenSet(c)) df.set(t, (df.get(t) || 0) + 1);
  }
  cached = { df, n: list.length };
  DF_CACHE.set(list, cached);
  return cached;
}

function resolveIdfStrength(opts) {
  const raw = Number(opts && opts.idfStrength != null ? opts.idfStrength : process.env.WIKI_IDF_STRENGTH);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function score(query, concepts, opts = {}) {
  try {
    const options = opts && typeof opts === 'object' ? opts : {};
    const limit = Number.isFinite(options.limit) ? options.limit : 5;
    const threshold = Number.isFinite(options.threshold) ? options.threshold : 0;

    const queryTokens = tokenize(query);
    const list = Array.isArray(concepts) ? concepts : [];

    // No usable query tokens -> nothing scores above zero.
    if (queryTokens.length === 0) {
      return [];
    }

    // Per-token weights. With IDF off (default) every weight is 1, so denom and
    // raw reduce exactly to the baseline (queryTokens.length * MAX_TOKEN_WEIGHT).
    const idfStrength = resolveIdfStrength(options);
    let tokenWeights;
    if (idfStrength > 0) {
      const { df, n } = documentFrequencies(list);
      tokenWeights = queryTokens.map((t) => {
        const idf = Math.log((n + 1) / ((df.get(t) || 0) + 1)) + 1; // >= 1
        return Math.pow(idf, idfStrength);
      });
    } else {
      tokenWeights = queryTokens.map(() => 1);
    }
    const denom = MAX_TOKEN_WEIGHT * tokenWeights.reduce((a, b) => a + b, 0);

    const scored = list.map((c) => {
      const slug = String(c && c.slug ? c.slug : '');
      const title = String(c && c.title ? c.title : '');
      const summary = String(c && c.summary ? c.summary : '');
      const body = String(c && c.body ? c.body : '');
      const aliases = c && Array.isArray(c.aliases) ? c.aliases : [];

      const slugSet = slugTokenSet(slug);
      const aliasSet = aliasTokenSet(aliases);
      const titleTokens = new Set(tokenize(title));
      const summaryTokens = new Set(tokenize(summary));
      const bodyTokens = new Set(tokenize(body));

      let raw = 0;
      for (let i = 0; i < queryTokens.length; i++) {
        const qt = queryTokens[i];
        // Each token earns at most MAX_TOKEN_WEIGHT (the best field it hits),
        // keeping the normalization bound tight and deterministic.
        let best = 0;
        if (slugSet.has(qt)) best = Math.max(best, WEIGHTS.slug);
        if (aliasSet.has(qt)) best = Math.max(best, WEIGHTS.alias);
        if (titleTokens.has(qt)) best = Math.max(best, WEIGHTS.title);
        if (summaryTokens.has(qt)) best = Math.max(best, WEIGHTS.summary);
        if (bodyTokens.has(qt)) best = Math.max(best, WEIGHTS.body);
        // IDF scales each token's contribution; weight is 1 when IDF is off.
        raw += best * tokenWeights[i];
      }

      const normalized = denom > 0 ? Math.min(raw / denom, 1) : 0;
      return {
        slug,
        title: title || slugToTitle(slug),
        summary,
        url: `/wiki/${slug}`,
        score: normalized,
      };
    });

    // Drop zero-score noise always; with a positive threshold, drop below it.
    return scored
      .filter((r) => r.score > 0 && r.score >= threshold)
      .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
      .slice(0, Math.max(0, limit));
  } catch (_e) {
    return [];
  }
}

// --- public: query -----------------------------------------------------------

function query(text, opts = {}) {
  try {
    const options = opts && typeof opts === 'object' ? opts : {};
    // opts.cache === false forces a direct local-dir read (used by tests and any
    // caller that wants to bypass the cache); otherwise go through the cache.
    if (options.cache === false) {
      const wikiDir = options.wikiDir != null
        ? options.wikiDir
        : process.env.ELLIOTTSENCAN_WIKI_DIR;
      return score(text, loadConcepts(wikiDir), options);
    }
    return score(text, loadConceptsCached(options), options);
  } catch (_e) {
    return [];
  }
}

// --- cached index loader -----------------------------------------------------
//
// The hot path (a per-prompt hook) must never block on the network and must work
// offline, but the local wiki clone goes stale because synthesis happens in CI.
// So we read a locally-cached index synchronously and refresh it in the
// background from the post-synthesis artifact (elliottsencan.com/wiki.json),
// always serving whatever is on disk — fresh or stale — to the caller.

const DEFAULT_INDEX_URL = 'https://elliottsencan.com/wiki.json';
const DEFAULT_TTL_SECONDS = 6 * 60 * 60; // refresh roughly four times a day
const REFRESH_LOCK_TTL_MS = 60 * 1000; // collapse refresh stampedes within a minute
const FETCH_TIMEOUT_MS = 5000;

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir() || '/tmp', '.claude');
}

function resolveCacheDir(opts) {
  if (opts && typeof opts.cacheDir === 'string' && opts.cacheDir) return opts.cacheDir;
  if (process.env.WIKI_CACHE_DIR) return process.env.WIKI_CACHE_DIR;
  return path.join(configDir(), 'wiki-cache');
}

// Remote index URL, or '' to disable remote entirely. An explicit empty string
// (opt or env) means "local only"; an unset env falls back to the default.
function resolveIndexUrl(opts) {
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'indexUrl')) {
    return typeof opts.indexUrl === 'string' ? opts.indexUrl.trim() : '';
  }
  if (Object.prototype.hasOwnProperty.call(process.env, 'ELLIOTTSENCAN_WIKI_INDEX_URL')) {
    return String(process.env.ELLIOTTSENCAN_WIKI_INDEX_URL || '').trim();
  }
  return DEFAULT_INDEX_URL;
}

function resolveTtlMs(opts) {
  const fromOpt = opts && Number.isFinite(opts.ttl) ? opts.ttl : NaN;
  const fromEnv = Number(process.env.WIKI_INDEX_TTL);
  const sec = Number.isFinite(fromOpt) && fromOpt > 0
    ? fromOpt
    : Number.isFinite(fromEnv) && fromEnv > 0
      ? fromEnv
      : DEFAULT_TTL_SECONDS;
  return sec * 1000;
}

// Accept either a bare array or a wrapped { concepts: [...] } payload, so the
// client works against both a dedicated index and the site's existing
// /wiki.json (which nests the entries under `concepts`).
function toConceptArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.concepts)) {
    return parsed.concepts;
  }
  return null;
}

// Coerce a parsed JSON index into the same concept shape loadConcepts produces,
// so score() can't tell the difference between a cached entry and a local one.
function normalizeConcepts(parsed) {
  const list = toConceptArray(parsed);
  if (!list) return [];
  const out = [];
  for (const c of list) {
    const slug = String(c && c.slug ? c.slug : '');
    if (!slug) continue;
    out.push({
      slug,
      title: (c && c.title ? String(c.title) : '') || slugToTitle(slug),
      aliases: c && Array.isArray(c.aliases) ? c.aliases.filter(Boolean) : [],
      summary: c && c.summary ? String(c.summary) : '',
      body: c && c.body ? String(c.body) : '',
    });
  }
  return out;
}

function readCache(cacheDir) {
  try {
    return normalizeConcepts(JSON.parse(fs.readFileSync(path.join(cacheDir, 'index.json'), 'utf8')));
  } catch (_e) {
    return null;
  }
}

function readMeta(cacheDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(cacheDir, 'meta.json'), 'utf8'));
    return m && typeof m === 'object' ? m : {};
  } catch (_e) {
    return {};
  }
}

function writeMeta(cacheDir, meta) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'meta.json'), JSON.stringify(meta));
  } catch (_e) {
    /* never throw */
  }
}

function isStale(meta, ttlMs) {
  const fetchedAt = meta && Number.isFinite(meta.fetchedAt) ? meta.fetchedAt : 0;
  return Date.now() - fetchedAt >= ttlMs;
}

// Record a refresh failure into meta.json WITHOUT bumping fetchedAt, so the
// cache stays "stale" and keeps retrying — and the reason is inspectable. The
// detached worker runs stdio:'ignore', so meta.json is its only breadcrumb;
// without this a persistent failure (404, schema drift, 200-serving-HTML) would
// leave a permanently stale wiki with no signal anywhere. `extra` lets a caller
// also adjust fields like the validators (e.g. clear a now-useless etag).
function recordFailure(cacheDir, meta, reason, extra) {
  writeMeta(
    cacheDir,
    Object.assign({}, meta, extra, { lastError: String(reason || 'error'), lastErrorAt: Date.now() }),
  );
}

// Fire a detached child that refreshes the cache for *next* time. Throttled by a
// lock file whose mtime gates the next spawn: a burst of prompts spawns at most
// one refresher per REFRESH_LOCK_TTL_MS. Crucially the child does NOT delete the
// lock — letting it age out is what enforces the throttle even on the failure
// path (where the cache stays stale and every prompt would otherwise re-spawn).
// The same mtime window also self-heals a lock left behind by a hard-killed
// worker. Returns whether a spawn was started (for tests); never throws. The
// spawn fn is injectable so tests can assert throttle behavior without forking.
function maybeSpawnRefresh(cacheDir, indexUrl, spawnFn) {
  try {
    if (!indexUrl || typeof fetch !== 'function') return false;
    const lockPath = path.join(cacheDir, 'refresh.lock');
    try {
      const st = fs.statSync(lockPath);
      if (Date.now() - st.mtimeMs < REFRESH_LOCK_TTL_MS) return false; // throttled
    } catch (_e) {
      /* no lock yet (or too old to read) — fall through and (re)create it */
    }
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(lockPath, String(Date.now()));
    const spawn = spawnFn || require('child_process').spawn;
    const child = spawn(process.execPath, [__filename, '--refresh-cache'], {
      detached: true,
      stdio: 'ignore',
      env: Object.assign({}, process.env, {
        ELLIOTTSENCAN_WIKI_INDEX_URL: indexUrl,
        WIKI_CACHE_DIR: cacheDir,
      }),
    });
    if (child && typeof child.unref === 'function') child.unref();
    return true;
  } catch (_e) {
    return false; // never throw on the hot path
  }
}

// Fetch the index (conditional GET) and atomically replace the cache on a
// change; on a 304 just bump fetchedAt. Returns true when the cache is current
// (refreshed or confirmed unchanged), false on any failure. Never throws. Run in
// the detached child via --refresh-cache. Does not touch the refresh lock — the
// lock is owned by maybeSpawnRefresh and ages out by mtime (see there).
async function refreshCache(opts = {}) {
  const cacheDir = resolveCacheDir(opts);
  const indexUrl = resolveIndexUrl(opts);
  let meta = {};
  try {
    if (!indexUrl || typeof fetch !== 'function') return false;
    fs.mkdirSync(cacheDir, { recursive: true });
    meta = readMeta(cacheDir);
    const headers = {};
    if (meta.etag) headers['If-None-Match'] = String(meta.etag);
    if (meta.lastModified) headers['If-Modified-Since'] = String(meta.lastModified);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(indexUrl, { headers, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 304) {
      // A 304 means "you still have it" — only honor that if we actually do. If
      // the body went missing/corrupt, the validators are lying; drop them so the
      // next cycle does an unconditional GET that can repopulate the cache.
      const have = readCache(cacheDir);
      if (have && have.length) {
        writeMeta(cacheDir, Object.assign({}, meta, { fetchedAt: Date.now() }));
        return true;
      }
      recordFailure(cacheDir, meta, '304 but cached body missing', { etag: '', lastModified: '' });
      return false;
    }
    if (!res.ok) {
      recordFailure(cacheDir, meta, `http ${res.status}`);
      return false;
    }

    // Parse outside the network catch: a 200 serving non-JSON (captive portal,
    // CDN error page, the SPA shell) is a server/config bug, not connectivity —
    // record it distinctly rather than masking it as a network failure.
    let parsed;
    try {
      parsed = JSON.parse(await res.text());
    } catch (_e) {
      recordFailure(cacheDir, meta, 'malformed json');
      return false;
    }
    const arr = toConceptArray(parsed);
    if (!arr) {
      recordFailure(cacheDir, meta, 'payload not an array');
      return false;
    }

    // Write to a temp file then rename so a reader never sees a half-written index.
    const tmp = path.join(cacheDir, `index.json.tmp-${process.pid}`);
    fs.writeFileSync(tmp, JSON.stringify(parsed));
    fs.renameSync(tmp, path.join(cacheDir, 'index.json'));
    const getHeader = (k) => (res.headers && typeof res.headers.get === 'function' ? res.headers.get(k) : null);
    // Fresh meta with no lastError — a successful refresh clears the breadcrumb.
    writeMeta(cacheDir, {
      fetchedAt: Date.now(),
      etag: getHeader('etag') || '',
      lastModified: getHeader('last-modified') || '',
      url: indexUrl,
      count: arr.length,
    });
    return true;
  } catch (e) {
    recordFailure(cacheDir, meta, (e && e.message) || 'network error');
    return false;
  }
}

// Public: like loadConcepts, but backed by the background-refreshed cache.
// Read order: cached index (served even when stale) -> local clone fallback.
// A stale or missing cache schedules a non-blocking refresh for next time.
function loadConceptsCached(opts = {}) {
  try {
    const options = opts && typeof opts === 'object' ? opts : {};
    const cacheDir = resolveCacheDir(options);
    const indexUrl = resolveIndexUrl(options);
    const ttlMs = resolveTtlMs(options);
    const allowRefresh = options.refresh !== false && !!indexUrl;

    const cached = readCache(cacheDir);
    if (cached && cached.length) {
      if (allowRefresh && isStale(readMeta(cacheDir), ttlMs)) {
        maybeSpawnRefresh(cacheDir, indexUrl, options.spawn);
      }
      return cached; // serve cache, fresh or stale — never block
    }

    // Cold start: nothing cached yet. Warm the cache for next time and serve the
    // local clone in the meantime (or [] if that isn't configured either).
    if (allowRefresh) maybeSpawnRefresh(cacheDir, indexUrl, options.spawn);
    const wikiDir = options.wikiDir != null ? options.wikiDir : process.env.ELLIOTTSENCAN_WIKI_DIR;
    return loadConcepts(wikiDir);
  } catch (_e) {
    return [];
  }
}

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv) {
  const out = { text: '', wikiDir: undefined, json: false, limit: 5, threshold: 0 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') {
      out.json = true;
    } else if (a === '--wiki-dir') {
      out.wikiDir = argv[++i];
    } else if (a.startsWith('--wiki-dir=')) {
      out.wikiDir = a.slice('--wiki-dir='.length);
    } else if (a === '--limit') {
      const n = Number(argv[++i]);
      if (Number.isFinite(n)) out.limit = n;
    } else if (a.startsWith('--limit=')) {
      const n = Number(a.slice('--limit='.length));
      if (Number.isFinite(n)) out.limit = n;
    } else if (a === '--threshold') {
      const n = Number(argv[++i]);
      if (Number.isFinite(n)) out.threshold = n;
    } else if (a.startsWith('--threshold=')) {
      const n = Number(a.slice('--threshold='.length));
      if (Number.isFinite(n)) out.threshold = n;
    } else if (!a.startsWith('--')) {
      positional.push(a);
    }
  }
  out.text = positional.join(' ').trim();
  return out;
}

function truncate(s, n) {
  const str = String(s || '');
  if (str.length <= n) return str;
  return str.slice(0, n - 1).trimEnd() + '…';
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

    if (!args.text) {
      process.stderr.write(
        'wiki-query: no query text.\n' +
          'usage: node wiki-query.cjs "<query text>" [--wiki-dir DIR] [--json] [--limit N] [--threshold T]\n',
      );
      console.log(args.json ? '[]' : '');
      return;
    }

    // An explicit --wiki-dir reads that clone directly; otherwise go through the
    // background-refreshed cache (which falls back to ELLIOTTSENCAN_WIKI_DIR).
    const concepts = args.wikiDir != null
      ? loadConcepts(args.wikiDir)
      : loadConceptsCached({});
    if (!concepts.length) {
      process.stderr.write(
        'wiki-query: no entries available. Set ELLIOTTSENCAN_WIKI_INDEX_URL (default ' +
          `${DEFAULT_INDEX_URL}) or ELLIOTTSENCAN_WIKI_DIR, or pass --wiki-dir DIR.\n`,
      );
      console.log(args.json ? '[]' : '');
      return;
    }

    const results = score(args.text, concepts, {
      limit: args.limit,
      threshold: args.threshold,
    });

    if (args.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (!results.length) {
      console.log('(no matches)');
      return;
    }

    const out = results
      .map(
        (r) =>
          `${r.score.toFixed(2)}  ${r.title} — ${truncate(r.summary, 100)}  (/wiki/${r.slug})`,
      )
      .join('\n');
    console.log(out);
  } catch (e) {
    // Last-resort guard: never crash, never exit non-zero.
    try {
      process.stderr.write(`wiki-query: ${e && e.message ? e.message : 'error'}\n`);
    } catch (_ignored) {
      // ignore
    }
    console.log('');
  }
}

if (require.main === module) {
  if (process.argv.includes('--refresh-cache')) {
    // Detached refresh worker (spawned by maybeSpawnRefresh). Never throws and
    // always exits 0 so a failed refresh can't surface as a hook error.
    refreshCache({}).then(
      () => process.exit(0),
      () => process.exit(0),
    );
  } else {
    main();
  }
} else {
  module.exports = {
    loadConcepts,
    loadConceptsCached,
    refreshCache,
    maybeSpawnRefresh,
    resolveIndexUrl,
    resolveTtlMs,
    resolveCacheDir,
    score,
    query,
  };
}
