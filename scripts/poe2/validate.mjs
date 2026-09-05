/* Publication gates for a generated PoE 2 dataset.

   Run: node scripts/poe2/validate.mjs [dir] [--previous <dir>]

   Same three levels as the PoE 1 gates: `failure` means do not publish and exit
   non-zero, `degraded` means publish but say it is incomplete, `warning` means
   drift worth a look. The checks are PoE 2's own, because the units, the
   endpoint families and the file set are PoE 2's own.

   Reads files only. Nothing is fetched and nothing is written. */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  QualityReport, checkMetadataCoverage, checkSourceRecords, collapsed, isFinitePositive, isIsoTimestamp, isNotFuture,
  orderedUnique, readJsonFile, writeJsonFile,
} from "../shared/dataset.mjs";
import { isPlaceholderName } from "./prices.mjs";

export const POE2_SCHEMA_VERSION = 2;
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2];

/* Exalted is the unit every PoE 2 price is quoted in, so its own price is 1 by
   construction. Anything else means a conversion ran the wrong way and every
   number in the file is wrong by the same factor. */
const EXALTED_SELF_CHECK_TOLERANCE = 0.01;
const DIVINE_EXALTED_BOUNDS = [1, 100000];
async function listLeagueDirs(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch { return []; }
}

function checkPrices(report, label, snapshot) {
  const entries = Object.entries(snapshot?.prices || {});
  if (!entries.length) {
    report.fail("prices-empty", `${label} holds no prices`);
    return 0;
  }
  const invalid = [];
  const placeholders = [];
  for (const [name, entry] of entries) {
    if (isPlaceholderName(name)) placeholders.push(name);
    if (!isFinitePositive(entry?.exalted)) invalid.push(`${name}=${JSON.stringify(entry?.exalted)}`);
  }
  if (invalid.length) {
    report.fail("price-not-positive", `${label} holds ${invalid.length} non-positive or non-finite price(s)`, invalid.slice(0, 12));
  }
  if (placeholders.length) {
    report.fail("placeholder-item", `${label} holds ${placeholders.length} placeholder item name(s)`, placeholders.slice(0, 12));
  }

  const exalted = snapshot.prices["Exalted Orb"]?.exalted;
  if (exalted !== undefined && Math.abs(exalted - 1) > EXALTED_SELF_CHECK_TOLERANCE) {
    report.fail("exalted-self-check", `${label}: Exalted Orb prices itself at ${exalted} — the conversion is inverted`);
  }
  if (snapshot.divineExalted === undefined || snapshot.divineExalted === null) {
    report.degrade("divine-rate-missing",
      `${label}: no completed Divine/Exalted rate yet; Exalted prices remain usable`);
  } else {
    const rate = snapshot.divineExalted;
    if (!(isFinitePositive(rate) && rate >= DIVINE_EXALTED_BOUNDS[0] && rate <= DIVINE_EXALTED_BOUNDS[1])) {
      report.fail("divine-rate", `${label}: divineExalted ${rate} is outside the plausible band`);
    }
  }

  /* The strip must credit the sources that actually supplied selected prices.
     A constant string is a claim the data does not back. */
  const claimed = String(snapshot.priceSource || "");
  const used = new Set(entries.map(([, entry]) => entry?.source).filter(Boolean));
  for (const [needle, source] of [["GGG", "GGG completed trades"], ["poe.ninja", "poe.ninja"], ["PoE2Scout", "PoE2Scout"]]) {
    const credited = claimed.includes(needle);
    const present = [...used].some((value) => value.includes(source.split(" ")[0]));
    if (credited && !present) report.warn("source-label", `${label} credits ${needle} but no selected price came from it`);
    if (!credited && present && claimed) report.warn("source-label", `${label} does not credit ${needle} though selected prices came from it`);
  }
  return entries.length;
}

function checkPriceHistory(report, label, history, snapshot) {
  const timestamps = Array.isArray(history?.timestamps) ? history.timestamps : [];
  if (!timestamps.length) {
    report.degrade("history-empty", `${label} holds no points`);
    return 0;
  }
  const problems = orderedUnique(timestamps);
  if (problems.length) report.fail("history-timestamps", `${label}: ${problems.length} timestamp problem(s)`, problems.slice(0, 8));
  const future = timestamps.filter((value) => !isNotFuture(value));
  if (future.length) report.fail("history-future", `${label} holds ${future.length} point(s) dated in the future`);

  const rates = Array.isArray(history.divineExalted) ? history.divineExalted : [];
  if (rates.length !== timestamps.length) {
    report.fail("history-alignment", `${label}: divineExalted has ${rates.length} entries for ${timestamps.length} timestamps`);
  }
  const misaligned = [];
  const badValues = [];
  for (const [name, series] of Object.entries(history.series || {})) {
    if (!Array.isArray(series) || series.length !== timestamps.length) { misaligned.push(name); continue; }
    // null is an explicit gap and is the correct way to say "no quote".
    if (series.some((value) => value !== null && !isFinitePositive(value))) badValues.push(name);
  }
  if (misaligned.length) {
    report.fail("history-alignment", `${label}: ${misaligned.length} series do not align with the timestamp axis`, misaligned.slice(0, 8));
  }
  if (badValues.length) {
    report.fail("history-values", `${label}: ${badValues.length} series hold a non-positive, non-null value`, badValues.slice(0, 8));
  }

  /* The newest stored point and the current snapshot describe the same moment.
     A disagreement means the two files came from different runs. */
  if (snapshot?.generatedAt && timestamps[timestamps.length - 1] !== snapshot.generatedAt) {
    const gapMinutes = Math.abs(Date.parse(timestamps[timestamps.length - 1]) - Date.parse(snapshot.generatedAt)) / 60000;
    if (Number.isFinite(gapMinutes) && gapMinutes > 90) {
      report.warn("history-current-drift",
        `${label}: newest point is ${Math.round(gapMinutes)} minutes from the current snapshot`);
    }
  }
  return timestamps.length;
}

function checkExchangeMarkets(report, label, markets) {
  const pairs = Array.isArray(markets?.pairs) ? markets.pairs : [];
  if (!pairs.length) { report.degrade("exchange-empty", `${label} holds no completed pairs`); return 0; }
  const items = markets.items || {};
  const unknown = new Set();
  let outOfBounds = 0;
  for (const pair of pairs) {
    if (!items[pair.left]) unknown.add(pair.left);
    if (!items[pair.right]) unknown.add(pair.right);
    if (!isFinitePositive(pair.rightPerLeft) || !isFinitePositive(pair.leftVolume) || !isFinitePositive(pair.rightVolume)) {
      report.fail("exchange-values", `${label}: pair ${pair.id} holds a non-positive rate or volume`);
      continue;
    }
    // The volume-weighted mean has to sit inside the hour's own observed band.
    const low = pair.lowRightPerLeft ?? pair.rightPerLeft;
    const high = pair.highRightPerLeft ?? pair.rightPerLeft;
    if (pair.rightPerLeft < low * 0.999 || pair.rightPerLeft > high * 1.001) outOfBounds += 1;
  }
  if (unknown.size) {
    report.fail("exchange-items", `${label}: ${unknown.size} pair leg(s) reference an item the file does not describe`, [...unknown].slice(0, 8));
  }
  if (outOfBounds) {
    report.warn("exchange-bounds", `${label}: ${outOfBounds} pair(s) quote a mean outside their own low/high band`);
  }
  if (markets.marketHour && !isIsoTimestamp(markets.marketHour)) {
    report.fail("market-hour", `${label}: marketHour ${markets.marketHour} is not a timestamp`);
  }
  return pairs.length;
}

function checkExchangeHistory(report, label, history) {
  const snapshots = Array.isArray(history?.snapshots) ? history.snapshots : [];
  if (!snapshots.length) { report.degrade("exchange-history-empty", `${label} holds no snapshots`); return 0; }
  const problems = orderedUnique(snapshots.map((snapshot) => snapshot.at));
  if (problems.length) report.fail("history-timestamps", `${label}: ${problems.length} timestamp problem(s)`, problems.slice(0, 8));
  const keys = Array.isArray(history.pairKeys) ? history.pairKeys : [];
  if (new Set(keys).size !== keys.length) report.fail("exchange-keys", `${label}: pairKeys contains a duplicate`);
  let bad = 0;
  for (const snapshot of snapshots) {
    for (const row of snapshot.pairs || []) {
      const index = Number(row?.[0]);
      if (!Number.isInteger(index) || index < 0 || index >= keys.length) { bad += 1; continue; }
      if (row.slice(1).some((value) => !isFinitePositive(value))) bad += 1;
    }
  }
  if (bad) report.fail("exchange-history-rows", `${label}: ${bad} stored pair row(s) are malformed`);
  return snapshots.length;
}

export async function validatePoe2(dir, { previousDir = null, report = new QualityReport({ game: "poe2" }) } = {}) {
  const index = await readJsonFile(path.join(dir, "index.json"));
  if (!index) {
    report.fail("index-missing", `${dir}/index.json is missing or unparseable`);
    return report;
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(index.schemaVersion)) {
    report.fail("schema-version", `index.json declares schemaVersion ${index.schemaVersion}, which this build does not support`);
  }
  if (!isIsoTimestamp(index.generatedAt) || !isNotFuture(index.generatedAt)) {
    report.fail("generated-at", "index.json generatedAt is missing, unparseable or in the future");
  }
  const leagues = Array.isArray(index.leagues) ? index.leagues : [];
  if (!leagues.length) {
    report.fail("index-empty", "index.json advertises no leagues");
    return report;
  }
  const slugs = leagues.map((league) => league?.slug);
  if (new Set(slugs).size !== slugs.length) report.fail("index-duplicate", "index.json lists a league slug twice");

  const previousIndex = previousDir ? await readJsonFile(path.join(previousDir, "index.json")) : null;
  if (collapsed(leagues.length, previousIndex?.leagues?.length, { minRatio: 0.75, floor: 2 })) {
    report.fail("league-collapse", `league count fell from ${previousIndex.leagues.length} to ${leagues.length}`);
  }

  const onDisk = new Set(await listLeagueDirs(dir));
  for (const league of leagues) {
    const label = league.name || league.slug;
    if (!onDisk.has(league.slug)) {
      report.fail("league-files-missing", `${label}: index advertises ${league.slug}/ but the directory does not exist`);
      continue;
    }
    const files = league.files || {};
    if (!files.prices || !files.priceHistory) {
      report.fail("index-files", `${label}: index entry has no files map — the browser cannot follow it`);
    }
    const leagueDir = path.join(dir, league.slug);

    const snapshot = await readJsonFile(path.join(leagueDir, files.prices || "prices.json"));
    if (!snapshot) {
      report.fail("prices-missing", `${label}: ${files.prices || "prices.json"} is missing or unparseable`);
      continue;
    }
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(snapshot.schemaVersion)) {
      report.fail("schema-version", `${label}/prices.json declares schemaVersion ${snapshot.schemaVersion}`);
    }
    if (!isIsoTimestamp(snapshot.generatedAt) || !isNotFuture(snapshot.generatedAt)) {
      report.fail("generated-at", `${label}/prices.json generatedAt is missing, unparseable or in the future`);
    }
    if (snapshot.league && league.name && snapshot.league !== league.name) {
      report.fail("league-mismatch", `${label}: prices.json says league "${snapshot.league}"`);
    }
    const count = checkPrices(report, `${label}/prices.json`, snapshot);
    const previousSnapshot = previousDir ? await readJsonFile(path.join(previousDir, league.slug, "prices.json")) : null;
    if (snapshot.schemaVersion >= 2) {
      const requiredPrefixes = [];
      const used = new Set(Object.values(snapshot.prices || {}).map((entry) => entry?.source).filter(Boolean));
      if (used.has("GGG completed trades")) requiredPrefixes.push("ggg.poe2", "repoe.poe2");
      if ([...used].some((source) => source.startsWith("poe.ninja"))) requiredPrefixes.push("ninja.poe2");
      if (used.has("PoE2Scout")) requiredPrefixes.push("poe2scout");
      checkSourceRecords(report, `${label}/prices.json`, snapshot.sources, { requiredPrefixes });
      checkMetadataCoverage(report, `${label}/prices.json`, snapshot.metadataCoverage, {
        previous: previousSnapshot?.metadataCoverage,
      });
    }
    if (collapsed(count, Object.keys(previousSnapshot?.prices || {}).length)) {
      report.fail("price-collapse", `${label}: priced names fell from ${Object.keys(previousSnapshot.prices).length} to ${count}`);
    }

    const history = await readJsonFile(path.join(leagueDir, files.priceHistory || "price-history.json"));
    if (!history) {
      report.degrade("history-missing", `${label}: no price history — the UI must present this as current-only`);
    } else {
      const points = checkPriceHistory(report, `${label}/price-history.json`, history, snapshot);
      const previousPoints = previousDir
        ? (await readJsonFile(path.join(previousDir, league.slug, "price-history.json")))?.timestamps?.length ?? 0
        : 0;
      if (previousPoints > 2 && points < previousPoints) {
        report.fail("history-shrank", `${label}: price history fell from ${previousPoints} to ${points} point(s)`);
      }
    }

    const markets = await readJsonFile(path.join(leagueDir, files.exchangeMarkets || "exchange-markets.json"));
    if (markets) checkExchangeMarkets(report, `${label}/exchange-markets.json`, markets);
    const exchangeHistory = await readJsonFile(path.join(leagueDir, files.exchangeHistory || "exchange-history.json"));
    if (exchangeHistory) {
      const snapshots = checkExchangeHistory(report, `${label}/exchange-history.json`, exchangeHistory);
      const previousSnapshots = previousDir
        ? (await readJsonFile(path.join(previousDir, league.slug, "exchange-history.json")))?.snapshots?.length ?? 0
        : 0;
      if (previousSnapshots > 2 && snapshots < previousSnapshots) {
        report.fail("history-shrank", `${label}: exchange history fell from ${previousSnapshots} to ${snapshots} snapshot(s)`);
      }
    }
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const previousIndex = args.indexOf("--previous");
  const previousDir = previousIndex >= 0 ? args[previousIndex + 1] : null;
  /* Only the value that follows `--previous` is not the target. With no
     `--previous` at all, indexOf returns -1 and `previousIndex + 1` is 0 —
     which silently swallowed the first positional argument, so passing a
     directory validated the default tree instead and reported it as clean. */
  const consumed = previousIndex >= 0 ? previousIndex + 1 : -1;
  const target = args.find((arg, index) => !arg.startsWith("--") && index !== consumed)
    || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data", "poe2");
  const report = await validatePoe2(target, { previousDir });
  report.print();
  // `--write` emits the manifest the UI reads, for local runs that generated
  // data without going through the fetcher's own gate.
  if (args.includes("--write")) await writeJsonFile(path.join(target, "quality.json"), report.toJSON());
  process.exit(report.publishable ? 0 : 1);
}
