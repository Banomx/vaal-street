/* Publication gates for a generated PoE 1 dataset.

   Run: node scripts/poe1/validate.mjs [dir] [--previous <dir>]

   Three levels, three consequences. `failure` means the tree is unsafe to
   publish and the run must exit non-zero, leaving the previous deployment live.
   `degraded` means publish it but the UI has to say it is incomplete.
   `warning` means notable drift somebody should look at.

   The comparisons that matter are rolling ones. Item counts move every league,
   so a fixed expectation is either wrong or useless within a month; what is
   always wrong is a source that answered for 4,900 names last hour and 12 now.

   Everything here reads files only. Nothing is fetched and nothing is written. */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  QualityReport, collapsed, isFinitePositive, isIsoTimestamp, isNotFuture, orderedUnique, readJsonFile, writeJsonFile,
} from "../shared/dataset.mjs";
import { CATEGORIES } from "../../src/games/poe1/catalogue/categories.js";

export const POE1_SCHEMA_VERSION = 1;
export const SUPPORTED_SCHEMA_VERSIONS = [1];

const FAMILY_KEYS = CATEGORIES.map((category) => category.key);
/* A price this far from parity means the exchange calibration is wrong, and
   every bulk item in the file is wrong with it by the same factor. */
const CHAOS_SELF_CHECK_TOLERANCE = 0.02;
const DIVINE_RATE_BOUNDS = [20, 20000];
/* Carried official prices state their own age; anything past this is a bug in
   the carry rule rather than a thin market. */
const MAX_STALE_HOURS = Math.max(1, Number(process.env.GGG_THIN_PRICE_MAX_AGE_HOURS) || 24);

async function listLeagueDirs(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch { return []; }
}

function checkSnapshotEnvelope(report, label, doc) {
  if (!doc) return false;
  const version = doc.schemaVersion;
  if (version !== undefined && !SUPPORTED_SCHEMA_VERSIONS.includes(version)) {
    report.fail("schema-version", `${label} declares unsupported schemaVersion ${version}`);
    return false;
  }
  if (doc.generatedAt === undefined) {
    /* Missing is unknown, not wrong. A file carried forward from an older
       deployment can predate the field; the UI shows it as undated rather than
       the run refusing to publish a league over it. */
    report.degrade("generated-at-missing", `${label} carries no generatedAt, so its age cannot be shown`);
    return true;
  }
  if (!isIsoTimestamp(doc.generatedAt)) {
    report.fail("generated-at", `${label} has a generatedAt that is not a timestamp: ${JSON.stringify(doc.generatedAt)}`);
    return false;
  }
  if (!isNotFuture(doc.generatedAt)) {
    report.fail("generated-at", `${label} is dated ${doc.generatedAt}, in the future`);
    return false;
  }
  return true;
}

/* "Missing is unknown, never zero" — so a price that is absent is a different
   thing from one that is present and zero. The first is allowed to exist and
   the consumer decides; the second is a bug that must not reach the site. */
function checkPrices(report, label, prices) {
  const entries = Object.entries(prices || {});
  const invalid = [];
  for (const [name, entry] of entries) {
    if (entry?.c === undefined) continue; // absent is unknown, and legal
    if (!isFinitePositive(entry.c)) invalid.push(`${name}=${JSON.stringify(entry.c)}`);
  }
  if (invalid.length) {
    report.fail("price-not-positive", `${label} has ${invalid.length} non-positive or non-finite price(s)`,
      invalid.slice(0, 12));
  }
  return entries.length;
}

function checkSelfHistory(report, label, doc) {
  const points = Array.isArray(doc?.points) ? doc.points : [];
  if (!points.length) return { points: 0, rated: 0 };
  const problems = orderedUnique(points.map((point) => point.t));
  if (problems.length) {
    report.fail("history-timestamps", `${label}: ${problems.length} timestamp problem(s)`, problems.slice(0, 8));
  }
  const future = points.filter((point) => !isNotFuture(point.t));
  if (future.length) report.fail("history-future", `${label} holds ${future.length} point(s) dated in the future`);
  const negative = [];
  for (const point of points) {
    for (const [name, value] of Object.entries(point.values || {})) {
      if (value === null) continue; // an explicit gap
      if (!isFinitePositive(value)) negative.push(`${name}@${point.t}`);
    }
  }
  if (negative.length) {
    report.fail("history-values", `${label} holds ${negative.length} non-positive stored value(s)`, negative.slice(0, 8));
  }
  return { points: points.length, rated: points.filter((point) => isFinitePositive(point.rate)).length };
}

function checkDerivedHistory(report, label, doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return 0;
  let total = 0;
  const unsorted = [];
  for (const [name, series] of Object.entries(doc)) {
    if (!Array.isArray(series)) {
      report.fail("history-shape", `${label}: series "${name}" is not an array`);
      continue;
    }
    total += series.length;
    for (let index = 1; index < series.length; index += 1) {
      if (series[index].day < series[index - 1].day) { unsorted.push(name); break; }
    }
    if (series.some((point) => !isFinitePositive(point?.value) || !Number.isFinite(point?.day))) {
      report.fail("history-values", `${label}: series "${name}" holds a non-finite day or value`);
    }
  }
  if (unsorted.length) report.fail("history-order", `${label}: ${unsorted.length} series are not ordered by day`, unsorted.slice(0, 8));
  return total;
}

/* The failure this exists for: a family shipping an 83-point raw curve beside a
   one-point rate line, because something restored the raw points and never
   rebuilt what is projected from them. */
function checkRateHistory(report, label, snapshot, ratedPoints) {
  const rate = Array.isArray(snapshot?.rateHistory) ? snapshot.rateHistory : [];
  if (rate.some((point) => !isFinitePositive(point?.rate) || !Number.isFinite(point?.day))) {
    report.fail("rate-history", `${label} rateHistory holds a non-finite point`);
  }
  for (let index = 1; index < rate.length; index += 1) {
    if (rate[index].day < rate[index - 1].day) {
      report.fail("rate-history", `${label} rateHistory is not ordered by day`);
      break;
    }
  }
  if (ratedPoints >= 3 && rate.length < 2) {
    report.fail("rate-history-collapsed",
      `${label} has ${ratedPoints} rate-bearing raw points but emits ${rate.length} rate point(s) — the derived files were not rebuilt`);
  } else if (ratedPoints >= 8 && rate.length < ratedPoints * 0.5) {
    report.warn("rate-history-thin",
      `${label} emits ${rate.length} rate points from ${ratedPoints} rate-bearing raw points`);
  }
}

/* A source strip that names a feed which supplied nothing is a lie on screen,
   and it is the kind of lie nobody notices for weeks. */
function checkSourceLabel(report, label, snapshot) {
  const claimed = String(snapshot?.priceSource || "");
  if (!claimed) return;
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  if (!items.length) return;
  const usedGgg = items.some((item) => item.exchangeSource === "GGG");
  if (/GGG Currency Exchange/.test(claimed) && !usedGgg) {
    report.warn("source-label", `${label} credits GGG but no selected item carries a GGG observation`);
  }
  if (!/GGG Currency Exchange/.test(claimed) && usedGgg) {
    report.warn("source-label", `${label} does not credit GGG though ${items.filter((i) => i.exchangeSource === "GGG").length} item(s) came from it`);
  }
}

function checkStaleCarry(report, label, prices) {
  const tooOld = Object.entries(prices || {})
    .filter(([, entry]) => Number.isFinite(entry?.staleHours) && entry.staleHours > MAX_STALE_HOURS)
    .map(([name, entry]) => `${name} ${entry.staleHours}h`);
  if (tooOld.length) {
    report.fail("stale-carry", `${label} carries ${tooOld.length} official price(s) past the ${MAX_STALE_HOURS}h limit`, tooOld.slice(0, 8));
  }
}

export async function validatePoe1(dir, { previousDir = null, report = new QualityReport({ game: "poe1" }) } = {}) {
  const index = await readJsonFile(path.join(dir, "index.json"));
  if (!index) {
    report.fail("index-missing", `${dir}/index.json is missing or unparseable`);
    return report;
  }
  if (index.schemaVersion !== undefined && !SUPPORTED_SCHEMA_VERSIONS.includes(index.schemaVersion)) {
    report.fail("schema-version", `index.json declares unsupported schemaVersion ${index.schemaVersion}`);
  }
  if (!isIsoTimestamp(index.generatedAt) || !isNotFuture(index.generatedAt)) {
    report.fail("generated-at", `index.json generatedAt is missing, unparseable or in the future`);
  }
  const leagues = Array.isArray(index.leagues) ? index.leagues : [];
  if (!leagues.length) {
    report.fail("index-empty", "index.json advertises no leagues");
    return report;
  }
  const slugs = leagues.map((league) => league?.slug);
  if (new Set(slugs).size !== slugs.length) report.fail("index-duplicate", "index.json lists a league slug twice");

  const previousIndex = previousDir ? await readJsonFile(path.join(previousDir, "index.json")) : null;
  const previousLeagues = Array.isArray(previousIndex?.leagues) ? previousIndex.leagues.length : 0;
  if (collapsed(leagues.length, previousLeagues, { minRatio: 0.75, floor: 2 })) {
    report.fail("league-collapse",
      `league count fell from ${previousLeagues} to ${leagues.length} — a source list glitch must not retire leagues`);
  }

  const fresh = leagues.filter((league) => !league.stale).length;
  if (!fresh) report.fail("all-stale", "every advertised league is stale");
  else if (fresh < leagues.length) {
    report.degrade("stale-leagues", `${leagues.length - fresh} of ${leagues.length} league(s) are stale`,
      leagues.filter((league) => league.stale).map((league) => league.name));
  }

  const onDisk = new Set(await listLeagueDirs(dir));
  for (const league of leagues) {
    const label = league.name || league.slug;
    if (!onDisk.has(league.slug)) {
      report.fail("league-files-missing", `${label}: index advertises ${league.slug}/ but the directory does not exist`);
      continue;
    }
    const leagueDir = path.join(dir, league.slug);

    /* The index is the browser's map of the tree: it names every file the app
       is allowed to ask for. A manifest that names a file which is not there
       sends the page after a 404 it cannot tell apart from a family that was
       never generated, so the two have to agree before this publishes. */
    const manifest = league.files && typeof league.files === "object" ? league.files : null;
    if (!manifest) {
      report.degrade("index-manifest", `${label}: index entry lists no files map, so the app has to guess filenames`);
    } else {
      const named = [...new Set(Object.values(manifest).filter((name) => typeof name === "string" && name))];
      const absent = [];
      for (const name of named) if (!(await readJsonFile(path.join(leagueDir, name)))) absent.push(name);
      if (absent.length) {
        report.fail("index-manifest-missing",
          `${label}: index names ${absent.length} file(s) that are missing or unparseable`, absent.slice(0, 8));
      }
      if (!named.includes("prices.json")) {
        report.fail("index-manifest-prices", `${label}: index manifest does not name prices.json`);
      }
    }

    const broad = await readJsonFile(path.join(leagueDir, "prices.json"));
    if (!broad) {
      report.fail("prices-missing", `${label}: prices.json is missing or unparseable`);
    } else if (checkSnapshotEnvelope(report, `${label}/prices.json`, broad)) {
      const count = checkPrices(report, `${label}/prices.json`, broad.prices);
      checkStaleCarry(report, `${label}/prices.json`, broad.prices);
      const chaos = broad.prices?.["Chaos Orb"]?.c;
      if (isFinitePositive(chaos) && Math.abs(chaos - 1) > CHAOS_SELF_CHECK_TOLERANCE) {
        report.fail("chaos-self-check", `${label}: Chaos Orb prices itself at ${chaos}c — the exchange calibration is wrong`);
      }
      if (broad.divineRate !== undefined
        && !(isFinitePositive(broad.divineRate) && broad.divineRate >= DIVINE_RATE_BOUNDS[0] && broad.divineRate <= DIVINE_RATE_BOUNDS[1])) {
        report.fail("divine-rate", `${label}: divineRate ${broad.divineRate} is outside the plausible band`);
      }
      const previousBroad = previousDir ? await readJsonFile(path.join(previousDir, league.slug, "prices.json")) : null;
      const previousCount = Object.keys(previousBroad?.prices || {}).length;
      if (collapsed(count, previousCount)) {
        report.fail("price-collapse", `${label}: priced names fell from ${previousCount} to ${count}`);
      }
    }

    for (const key of FAMILY_KEYS) {
      const snapshot = await readJsonFile(path.join(leagueDir, `${key}.json`));
      if (!snapshot) continue; // a family a league genuinely has no market for
      if (!checkSnapshotEnvelope(report, `${label}/${key}.json`, snapshot)) continue;
      const items = Array.isArray(snapshot.items) ? snapshot.items : [];
      const names = items.map((item) => item.name);
      const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
      if (duplicates.length) {
        report.fail("duplicate-item-key", `${label}/${key}.json lists ${duplicates.length} duplicate item name(s)`,
          [...new Set(duplicates)].slice(0, 8));
      }
      const badValues = items.filter((item) => !isFinitePositive(item.chaosValue)).map((item) => item.name);
      if (badValues.length) {
        report.fail("price-not-positive", `${label}/${key}.json holds ${badValues.length} non-positive chaosValue(s)`, badValues.slice(0, 8));
      }
      checkSourceLabel(report, `${label}/${key}.json`, snapshot);

      const self = await readJsonFile(path.join(leagueDir, `${key}-selfhistory.json`));
      const { rated } = checkSelfHistory(report, `${label}/${key}-selfhistory.json`, self);
      checkRateHistory(report, `${label}/${key}`, snapshot, rated);
      checkDerivedHistory(report, `${label}/${key}-history.json`, await readJsonFile(path.join(leagueDir, `${key}-history.json`)));

      /* The current snapshot and the newest stored point describe the same
         moment, so a mismatch means one of the two files came from a different
         run — which is exactly the inconsistency reuse mode used to publish. */
      const latest = Array.isArray(self?.points) ? self.points[self.points.length - 1] : null;
      if (latest && items.length) {
        const drift = items.filter((item) => {
          const stored = latest.values?.[item.name];
          return isFinitePositive(stored) && Math.abs(stored - item.chaosValue) > Math.max(0.02, item.chaosValue * 0.02);
        });
        if (drift.length > items.length * 0.25) {
          report.warn("snapshot-history-drift",
            `${label}/${key}: ${drift.length}/${items.length} current prices disagree with the newest stored point`);
        }
      }
    }

    const gems = await readJsonFile(path.join(leagueDir, "gems.json"));
    if (gems) checkSnapshotEnvelope(report, `${label}/gems.json`, gems);
  }

  return report;
}

/* Curated boss and Delve inputs are the coverage that actually degrades a
   feature when it slips, so it is measured against the previous run rather than
   a fixed list that would need editing every league. */
export async function checkCuratedCoverage(dir, previousDir, report, { league }) {
  const [{ BOSSES }, { DELVE_BOSSES, FOSSILS }] = await Promise.all([
    import("../../src/games/poe1/features/bosses/bossData.js"),
    import("../../src/games/poe1/features/delve/delveData.js"),
  ]);
  const names = new Set(FOSSILS.map((fossil) => fossil.name));
  for (const boss of [...BOSSES, ...DELVE_BOSSES]) {
    for (const line of boss.entry || []) if (line.item) names.add(line.item);
    for (const group of boss.groups || []) for (const line of group.drops || []) if (line.item && !line.item.startsWith("@")) names.add(line.item);
  }
  const priced = async (root) => {
    const doc = await readJsonFile(path.join(root, league, "prices.json"));
    return [...names].filter((name) => isFinitePositive(doc?.prices?.[name]?.c)).length;
  };
  const now = await priced(dir);
  const before = previousDir ? await priced(previousDir) : 0;
  if (before && now < before * 0.9) {
    report.warn("curated-coverage",
      `${league}: curated boss/Delve coverage fell from ${before}/${names.size} to ${now}/${names.size}`);
  } else {
    report.pass("curated-coverage", `${league}: ${now}/${names.size} curated names priced`);
  }
  return { total: names.size, priced: now };
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
    || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data", "poe1");
  const report = await validatePoe1(target, { previousDir });
  report.print();
  // `--write` emits the manifest the UI reads, for local runs that generated
  // data without going through the fetcher's own gate.
  if (args.includes("--write")) await writeJsonFile(path.join(target, "quality.json"), report.toJSON());
  process.exit(report.publishable ? 0 : 1);
}
