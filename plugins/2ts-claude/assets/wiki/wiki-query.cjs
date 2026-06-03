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

    const denom = queryTokens.length * MAX_TOKEN_WEIGHT;

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
      for (const qt of queryTokens) {
        // Each token earns at most MAX_TOKEN_WEIGHT (the best field it hits),
        // keeping the normalization bound tight and deterministic.
        let best = 0;
        if (slugSet.has(qt)) best = Math.max(best, WEIGHTS.slug);
        if (aliasSet.has(qt)) best = Math.max(best, WEIGHTS.alias);
        if (titleTokens.has(qt)) best = Math.max(best, WEIGHTS.title);
        if (summaryTokens.has(qt)) best = Math.max(best, WEIGHTS.summary);
        if (bodyTokens.has(qt)) best = Math.max(best, WEIGHTS.body);
        raw += best;
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
    const wikiDir = options.wikiDir != null
      ? options.wikiDir
      : process.env.ELLIOTTSENCAN_WIKI_DIR;
    return score(text, loadConcepts(wikiDir), options);
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
    const wikiDir = args.wikiDir != null
      ? args.wikiDir
      : process.env.ELLIOTTSENCAN_WIKI_DIR;

    if (!args.text) {
      process.stderr.write(
        'wiki-query: no query text.\n' +
          'usage: node wiki-query.cjs "<query text>" [--wiki-dir DIR] [--json] [--limit N] [--threshold T]\n',
      );
      console.log(args.json ? '[]' : '');
      return;
    }

    if (!wikiDir) {
      process.stderr.write(
        'wiki-query: no wiki directory. Pass --wiki-dir DIR or set ELLIOTTSENCAN_WIKI_DIR.\n',
      );
      console.log(args.json ? '[]' : '');
      return;
    }

    const concepts = loadConcepts(wikiDir);
    if (!concepts.length) {
      process.stderr.write(
        `wiki-query: no concepts found under ${wikiDir} (looked for src/content/wiki/*.md or *.md).\n`,
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
  main();
} else {
  module.exports = { loadConcepts, score, query };
}
