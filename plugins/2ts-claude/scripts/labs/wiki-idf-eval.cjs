#!/usr/bin/env node
/**
 * wiki-idf-eval — measure IDF weighting vs the baseline scorer.
 *
 * This is a dev/lab tool, NOT part of the hook path. It answers one question:
 * does down-weighting common tokens (WIKI_IDF_STRENGTH) improve retrieval, or
 * just move scores around? It reports two objective axes against the real index:
 *
 *   1. POSITIVE recall@1 — synthetic on-topic prompts built from each concept's
 *      own title/aliases/summary. "Correct" = that concept ranks #1. This guards
 *      the true-positive case (does IDF break prompts that genuinely name a topic?).
 *   2. NEGATIVE firing rate — hand-authored off-topic prompts and "generic-token
 *      traps" (a common wiki word used in a non-wiki sense). These SHOULD stay
 *      silent; firing is a false positive. This is the precision axis IDF targets.
 *
 * Because IDF lowers all scores, comparing at one fixed threshold conflates "IDF
 * is better" with "IDF wants a different threshold". So we sweep strength ×, and
 * also compute an iso-recall operating point: per strength, the threshold whose
 * positive recall matches the baseline@0.15, then compare negative firing there.
 *
 * Run:  node plugins/2ts-claude/scripts/labs/wiki-idf-eval.cjs [--index <path>]
 * Default index: ~/.claude/wiki-cache/index.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { score } = require('../../assets/wiki/wiki-query.cjs');

const STRENGTHS = [0, 0.5, 1.0, 1.5];
const THRESHOLDS = [0.1, 0.15, 0.2, 0.25, 0.3];
const LIVE_THRESHOLD = 0.15; // the shipped default

// --- load corpus -------------------------------------------------------------

function loadConcepts() {
  const argIdx = process.argv.indexOf('--index');
  const p = argIdx >= 0 ? process.argv[argIdx + 1] : path.join(os.homedir(), '.claude', 'wiki-cache', 'index.json');
  const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  const arr = Array.isArray(parsed) ? parsed : parsed.concepts || parsed.entries || [];
  if (!arr.length) throw new Error(`no concepts found in ${p}`);
  return { concepts: arr, path: p };
}

// --- synthetic prompt generation --------------------------------------------

// A light tokenizer just for building positive prompts; the scorer re-tokenizes.
const STOP = new Set(
  ('the and for with how what why who when where are was were this that these those from into your you our its ' +
    'their them they has have had can will would should could about over under than then but not all any some such ' +
    'via per use using get got out off').split(' '),
);
const words = (s) =>
  String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));

// Build several on-topic prompts per concept, each labeled with its slug. We mix
// trivial (title) and harder (summary-keyword-only, no title words) phrasings so
// the metric isn't saturated by exact-title hits.
function positives(concepts) {
  const out = [];
  for (const c of concepts) {
    const slug = String(c.slug || '');
    if (!slug) continue;
    const titleWords = new Set(words(c.title));
    const prompts = new Set();
    if (c.title) prompts.add(String(c.title));
    if (c.title) prompts.add(`how should I think about ${c.title}`);
    for (const a of c.aliases || []) prompts.add(String(a).replace(/[-_]+/g, ' '));
    // Summary-keyword query that deliberately excludes title words -> forces the
    // match to come from non-title fields, which is exactly where IDF bites.
    const summaryOnly = words(c.summary).filter((w) => !titleWords.has(w)).slice(0, 4);
    if (summaryOnly.length >= 2) prompts.add(summaryOnly.join(' '));
    for (const p of prompts) if (p.trim()) out.push({ prompt: p, slug });
  }
  return out;
}

// Off-topic and generic-token-trap negatives: these must stay silent. The traps
// embed a single common wiki token (agent, system, model, data, context, …) in a
// clearly non-wiki sentence — the precision case the baseline leaks on.
const NEGATIVES = [
  'what is a good sourdough hydration ratio for baking bread',
  'how do I prune tomato plants in late summer',
  'best hiking trails near the pacific northwest coast',
  'my travel agent booked the wrong connecting flight',
  'the fashion model walked down the runway in paris',
  'I need to data entry these paper receipts by friday',
  'the heating system in my apartment is making noise',
  'what context did the teacher give for the history exam',
  'recommend a dentist who is good with anxious patients',
  'how much should I tip the movers for a studio apartment',
  'the soccer agent negotiated a transfer to madrid',
  'help me plan a birthday party for a ten year old',
  'why is my car making a grinding noise when I brake',
  'translate this italian menu into english for me',
  'what is the best fertilizer for indoor succulents',
  'the model train set needs a new transformer',
  'how do I remove a red wine stain from carpet',
  'what time does the farmers market open on saturday',
];

// --- metrics -----------------------------------------------------------------

function run(concepts) {
  const pos = positives(concepts);
  const neg = NEGATIVES.map((p) => ({ prompt: p }));

  // Pre-score every prompt once per strength at threshold 0 (full ranking), then
  // derive threshold behavior by filtering — score() is deterministic in score.
  const byStrength = new Map();
  for (const s of STRENGTHS) {
    const posRanked = pos.map((x) => ({
      ...x,
      top: score(x.prompt, concepts, { limit: 1, threshold: 0, idfStrength: s })[0] || null,
    }));
    const negRanked = neg.map((x) => ({
      ...x,
      top: score(x.prompt, concepts, { limit: 1, threshold: 0, idfStrength: s })[0] || null,
    }));
    byStrength.set(s, { posRanked, negRanked });
  }

  // (1) Ranking recall@1 — correct concept is #1 regardless of threshold.
  const rankingRecall = (s) => {
    const { posRanked } = byStrength.get(s);
    const hit = posRanked.filter((x) => x.top && x.top.slug === x.slug).length;
    return hit / posRanked.length;
  };

  // Effective positive recall at a threshold: correct AND fires.
  const posRecallAt = (s, th) => {
    const { posRanked } = byStrength.get(s);
    const hit = posRanked.filter((x) => x.top && x.top.slug === x.slug && x.top.score >= th).length;
    return hit / posRanked.length;
  };
  // Negative firing rate at a threshold: any surface at all.
  const negFireAt = (s, th) => {
    const { negRanked } = byStrength.get(s);
    const fired = negRanked.filter((x) => x.top && x.top.score >= th).length;
    return fired / negRanked.length;
  };

  return { pos, neg, byStrength, rankingRecall, posRecallAt, negFireAt };
}

// --- reporting ---------------------------------------------------------------

const pct = (x) => (x * 100).toFixed(0).padStart(3) + '%';

function main() {
  const { concepts, path: idxPath } = loadConcepts();
  const m = run(concepts);
  console.log(`index: ${idxPath}`);
  console.log(`concepts: ${concepts.length} | positive prompts: ${m.pos.length} | negative prompts: ${m.neg.length}\n`);

  console.log('=== Ranking recall@1 (correct concept is #1, threshold-independent) ===');
  for (const s of STRENGTHS) console.log(`  strength ${s.toFixed(1)}:  ${pct(m.rankingRecall(s))}`);
  console.log();

  console.log('=== Sweep: positive-recall@th  /  negative-firing@th ===');
  console.log('            ' + THRESHOLDS.map((t) => `th=${t}`.padStart(12)).join(''));
  for (const s of STRENGTHS) {
    const cells = THRESHOLDS.map((t) => `${pct(m.posRecallAt(s, t))}/${pct(m.negFireAt(s, t))}`.padStart(12)).join('');
    console.log(`  s=${s.toFixed(1)}    ` + cells);
  }
  console.log('  (each cell = on-topic recall / off-topic false-fire; want high left, low right)\n');

  // (2) Iso-recall operating point: for each strength, pick the lowest threshold
  // whose positive recall >= baseline's recall at the live 0.15 threshold, then
  // compare negative firing there. Apples-to-apples on the precision axis.
  const baseRecall = m.posRecallAt(0, LIVE_THRESHOLD);
  const baseNeg = m.negFireAt(0, LIVE_THRESHOLD);
  console.log('=== Iso-recall comparison (match baseline recall, compare false-fires) ===');
  console.log(`  baseline @ th=${LIVE_THRESHOLD}: recall ${pct(baseRecall)}, off-topic firing ${pct(baseNeg)}`);
  const FINE = [];
  for (let t = 0.05; t <= 0.6001; t += 0.01) FINE.push(Math.round(t * 1000) / 1000);
  for (const s of STRENGTHS) {
    if (s === 0) continue;
    // lowest threshold achieving >= baseRecall (recall is non-increasing in th)
    let chosen = null;
    for (const t of FINE) {
      if (m.posRecallAt(s, t) >= baseRecall) chosen = t;
      else break;
    }
    if (chosen == null) {
      console.log(`  s=${s.toFixed(1)}: cannot reach baseline recall at any threshold`);
      continue;
    }
    const neg = m.negFireAt(s, chosen);
    const delta = neg - baseNeg;
    const verdict = delta < 0 ? `BETTER (${pct(-delta)} fewer false-fires)` : delta > 0 ? `worse` : 'same';
    console.log(`  s=${s.toFixed(1)}: th=${chosen.toFixed(2)} matches recall ${pct(m.posRecallAt(s, chosen))}, off-topic firing ${pct(neg)}  -> ${verdict}`);
  }
  console.log();

  // (3) Disagreement dump at the live threshold, baseline vs IDF s=1.
  console.log(`=== Disagreements at th=${LIVE_THRESHOLD}: baseline vs IDF s=1.0 ===`);
  const b = m.byStrength.get(0);
  const i = m.byStrength.get(1.0);
  const fired = (top) => top && top.score >= LIVE_THRESHOLD;
  let shown = 0;
  console.log('  -- negatives that change (silent is correct) --');
  for (let k = 0; k < m.neg.length; k++) {
    const bf = fired(b.negRanked[k].top);
    const inf = fired(i.negRanked[k].top);
    if (bf !== inf) {
      const bt = b.negRanked[k].top, it = i.negRanked[k].top;
      console.log(`    "${m.neg[k].prompt}"`);
      console.log(`        base: ${bf ? bt.slug + ' @' + bt.score.toFixed(3) : 'silent'}   ->   idf: ${inf ? it.slug + ' @' + it.score.toFixed(3) : 'silent'}`);
      shown++;
    }
  }
  if (!shown) console.log('    (none)');
  shown = 0;
  console.log('  -- positives that change (correct+fired is good) --');
  for (let k = 0; k < m.pos.length; k++) {
    const bGood = b.posRanked[k].top && b.posRanked[k].top.slug === m.pos[k].slug && fired(b.posRanked[k].top);
    const iGood = i.posRanked[k].top && i.posRanked[k].top.slug === m.pos[k].slug && fired(i.posRanked[k].top);
    if (bGood !== iGood) {
      console.log(`    [${m.pos[k].slug}] "${m.pos[k].prompt}"  ${bGood ? 'base✓' : 'base✗'} ${iGood ? 'idf✓' : 'idf✗'}`);
      shown++;
    }
  }
  if (!shown) console.log('    (none)');
}

main();
