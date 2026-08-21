/* Merge one or more downloaded GitHub Pages artifacts into public/data.

   Run: node scripts/tools/merge-pages-artifact.mjs <data-dir> [<data-dir> ...]

   Each <data-dir> is the `data/` folder inside an extracted Pages artifact
   (`artifact/data`), oldest first. The checked-in tree is treated as one more
   source and is always part of the union.

   Why this exists: accumulated history lives in exactly two places, the live
   deployment and the checked-in tree. Move the repository and the first build
   finds nothing deployed, silently restarts every curve from the checked-in
   seed, and the old Pages site takes the only other copy with it. Recovering
   from a downloaded artifact then has to be a reviewable, repeatable operation
   rather than a hand edit.

   Rules:
     - raw accumulated points and backfills are unioned by timestamp;
     - PoE 2 price and exchange timelines go through the same merge the fetcher
       uses, so alignment and gap semantics are identical;
     - current snapshots (prices, per-family, catalogue, index) take the newest
       `generatedAt`, since they describe one moment rather than accumulating;
     - derived PoE 1 curves are not merged, they are rebuilt from the merged raw
       points afterwards — splicing two day axes produces a curve that never
       existed;
     - leagues present in any source are kept. A league missing from the newest
       deployment is far more often a bad response than a retirement.

   Nothing is deleted and no source directory is written to. */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SIGNED_HISTORY_KEYS, mergeBackfill, mergeSelfHistory, rebuildDerivedHistory } from "../poe1/history.mjs";
import { mergePriceHistories } from "../poe2/history.mjs";
import { mergeExchangeHistories } from "../poe2/exchange-history.mjs";
import { isPlaceholderName } from "../poe2/prices.mjs";
import { CATEGORIES } from "../../src/games/poe1/catalogue/categories.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TARGET = process.env.DATA_ROOT || path.join(ROOT, "public", "data");
const DERIVED_KEYS = [...CATEGORIES.map((c) => c.key), "gems"];

const isSelfHistory = (file) => /(^|-)selfhistory\.json$/.test(file);
const isBackfill = (file) => /(^|-)backfill\.json$/.test(file);
const isDerived = (file) => /(^|-)history\.json$/.test(file) && !isSelfHistory(file);

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

async function listDirs(dir) {
  try { return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
}

async function listFiles(dir) {
  try { return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name); }
  catch { return []; }
}

const generatedMs = (doc) => Date.parse(doc?.generatedAt ?? "") || 0;

/* A point set only counts as recovered if it is actually usable: an unparseable
   or impossible timestamp in a recovery seed would be copied forward for the
   life of the league. */
function validSelfPoints(doc, label, warnings, { dropNonPositive = true } = {}) {
  const points = Array.isArray(doc?.points) ? doc.points : [];
  const kept = [];
  const future = Date.now() + 2 * 3600_000;
  const seen = new Set();
  let dropped = 0;
  for (const point of points) {
    const ms = Date.parse(point?.t);
    if (!isFinite(ms)) { warnings.push(`${label}: dropped a point with an unparseable timestamp`); continue; }
    if (ms > future) { warnings.push(`${label}: dropped a point dated ${point.t} in the future`); continue; }
    if (seen.has(point.t)) continue;
    seen.add(point.t);
    // A zero is never a real price — it is what two-decimal rounding did to an
    // item worth a thousandth of a chaos — and a zero in a curve draws a crash
    // that never happened. Drop the value, keep the point. Gem history is
    // exempt: it stores signed levelling profit, so a loss is an observation.
    if (!dropNonPositive) { kept.push(point); continue; }
    const values = {};
    for (const [name, value] of Object.entries(point.values || {})) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) values[name] = value;
      else dropped += 1;
    }
    kept.push({ ...point, values });
  }
  if (dropped) warnings.push(`${label}: dropped ${dropped} non-positive stored value(s)`);
  kept.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  return { ...doc, points: kept };
}

/* Current snapshots get the same rule: an entry whose price is not a usable
   number is removed rather than published as zero, because absent means unknown
   and zero means free. */
function sanitizeCurrent(file, doc, label, warnings) {
  if (file === "prices.json" && doc?.prices) {
    const prices = {};
    let dropped = 0;
    let placeholders = 0;
    for (const [name, entry] of Object.entries(doc.prices)) {
      // PoE 1 quotes chaos as `c`, PoE 2 quotes Exalted as `exalted`.
      const quote = entry?.c ?? entry?.exalted;
      if (isPlaceholderName(name)) { placeholders += 1; continue; }
      if (quote === undefined || (Number.isFinite(quote) && quote > 0)) prices[name] = entry;
      else dropped += 1;
    }
    if (dropped) warnings.push(`${label}: dropped ${dropped} entry/entries priced at zero or worse`);
    if (placeholders) warnings.push(`${label}: dropped ${placeholders} placeholder item name(s)`);
    return { ...doc, prices };
  }
  if (Array.isArray(doc?.items)) {
    const items = doc.items.filter((item) => Number.isFinite(item?.chaosValue) && item.chaosValue > 0);
    if (items.length !== doc.items.length) warnings.push(`${label}: dropped ${doc.items.length - items.length} unpriced item(s)`);
    return { ...doc, items };
  }
  return doc;
}

function mergeDocuments(file, docs, label, warnings) {
  if (isSelfHistory(file)) {
    /* Two sources holding the same timestamp normally hold the same point, so
       the fetcher's rule — the newer authority wins — is right there. Recovery
       is the case where they differ: one copy may have been thinned, or had
       values stripped by an earlier pass. Keep the point that carries more
       observations, so a merge can only ever add. */
    const richest = new Map();
    for (const doc of docs) {
      for (const point of doc?.points || []) {
        if (!Number.isFinite(Date.parse(point?.t))) continue;
        const held = richest.get(point.t);
        const size = Object.keys(point.values || {}).length;
        if (!held || size > Object.keys(held.values || {}).length) richest.set(point.t, point);
      }
    }
    const merged = mergeSelfHistory({ points: [...richest.values()] }, { points: [] });
    return validSelfPoints(merged, label, warnings, { dropNonPositive: !SIGNED_HISTORY_KEYS.has(file.replace("-selfhistory.json", "")) });
  }
  if (isBackfill(file)) return docs.reduce((acc, doc) => mergeBackfill(acc, doc), { series: {} });
  if (file === "price-history.json") return mergePriceHistories(...docs);
  if (file === "exchange-history.json") return mergeExchangeHistories(...docs);
  // One moment, not an accumulation: the freshest description wins outright.
  const newest = [...docs].sort((a, b) => generatedMs(a) - generatedMs(b)).at(-1);
  return sanitizeCurrent(file, newest, label, warnings);
}

function mergeIndex(docs) {
  const leagues = new Map();
  for (const doc of docs) {
    for (const league of doc?.leagues || []) {
      if (league?.slug) leagues.set(league.slug, { ...leagues.get(league.slug), ...league });
    }
  }
  const newest = [...docs].sort((a, b) => generatedMs(a) - generatedMs(b)).at(-1) || {};
  return { ...newest, leagues: [...leagues.values()] };
}

function pointCount(file, doc) {
  if (isSelfHistory(file)) return doc?.points?.length || 0;
  if (file === "price-history.json") return doc?.timestamps?.length || 0;
  if (file === "exchange-history.json") return doc?.snapshots?.length || 0;
  if (isBackfill(file)) return Object.values(doc?.series || {}).reduce((n, s) => n + (s?.length || 0), 0);
  return 0;
}

async function mergeGame(game, sources, warnings) {
  const roots = [...sources.map((s) => path.join(s, game)), path.join(TARGET, game)];
  const slugs = [...new Set((await Promise.all(roots.map(listDirs))).flat())];
  const report = [];

  for (const slug of slugs) {
    const dirs = roots.map((root) => path.join(root, slug));
    const files = [...new Set((await Promise.all(dirs.map(listFiles))).flat())];
    for (const file of files) {
      if (game === "poe1" && isDerived(file)) continue; // rebuilt below
      const docs = (await Promise.all(dirs.map((dir) => readJson(path.join(dir, file))))).filter(Boolean);
      if (!docs.length) continue;
      const label = `${game}/${slug}/${file}`;
      const merged = mergeDocuments(file, docs, label, warnings);
      if (!merged) continue;
      const before = pointCount(file, await readJson(path.join(TARGET, game, slug, file)));
      const after = pointCount(file, merged);
      if (after < before) { warnings.push(`${label}: merge would lose points (${before} -> ${after}), kept as-is`); continue; }
      await mkdir(path.join(TARGET, game, slug), { recursive: true });
      await writeFile(path.join(TARGET, game, slug, file), JSON.stringify(merged));
      if (after > before) report.push(`${label}: ${before} -> ${after}`);
    }
  }

  const indexes = (await Promise.all(roots.map((root) => readJson(path.join(root, "index.json"))))).filter(Boolean);
  if (indexes.length) {
    await mkdir(path.join(TARGET, game), { recursive: true });
    await writeFile(path.join(TARGET, game, "index.json"), JSON.stringify(mergeIndex(indexes)));
  }
  return { slugs, report };
}

async function main() {
  const sources = process.argv.slice(2);
  if (!sources.length) {
    console.error("usage: node scripts/tools/merge-pages-artifact.mjs <artifact data dir> [more dirs, oldest first]");
    process.exit(2);
  }
  const warnings = [];
  const poe1 = await mergeGame("poe1", sources, warnings);
  const poe2 = await mergeGame("poe2", sources, warnings);

  let rebuilt = 0;
  let rateless = [];
  for (const slug of poe1.slugs) {
    const result = await rebuildDerivedHistory(path.join(TARGET, "poe1", slug), DERIVED_KEYS);
    rebuilt += result.rebuilt;
    if (result.rebuilt && !result.ratePoints) rateless.push(slug);
  }

  for (const line of [...poe1.report, ...poe2.report]) console.log(`  ${line}`);
  console.log(`Merged ${sources.length} artifact(s) into ${TARGET}.`);
  console.log(`Rebuilt ${rebuilt} derived PoE 1 history file(s) from the merged raw points.`);
  if (rateless.length) console.log(`No rate curve for: ${rateless.join(", ")} (no rate-bearing raw points).`);
  for (const warning of warnings) console.warn(`WARN ${warning}`);
}

await main();
