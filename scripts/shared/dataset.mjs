/* Game-neutral plumbing for generating a published dataset.

   Only things that are genuinely not PoE-specific live here: staging a run so a
   half-built tree can never replace a healthy one, reading and writing JSON,
   the shape a source uses to describe itself, and the report that decides
   whether the result may be published. Accepted endpoint types, normalization,
   currency units, precedence and every price formula stay in the game's own
   scripts, where they belong.

   The staging model is the important part. GitHub Pages only uploads after the
   workflow succeeds, so a run that cannot produce a good dataset should fail
   loudly and leave the previous deployment live. Generating in place makes that
   impossible: by the time you know the run is bad, you have already overwritten
   the thing you would have fallen back to. */

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/* Who is calling, in one place.

   Every feed this project reads is somebody else's server, and several of them
   ask politely that a client identify itself and stay contactable. One constant
   means the string cannot drift between fetchers, and a feed owner who needs to
   reach us finds the same repository from any of them. */
export const USER_AGENT = "vaal-street-snapshot/0.5 (contact: github.com/Banomx/vaal-street)";

export const JSON_HEADERS = { "User-Agent": USER_AGENT, Accept: "application/json" };

/* ---------------- JSON ---------------- */

export async function readJsonFile(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch { return null; }
}

export async function writeJsonFile(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value), "utf8");
}

export function contentHash(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `sha256:${createHash("sha256").update(text).digest("hex").slice(0, 32)}`;
}

/* ---------------- staging and promotion ----------------

   Windows cannot rename a directory onto an existing one, and both Windows and
   Linux can briefly refuse a rename while another process holds a handle, so
   promotion is: move the live tree aside, move staging into place, then delete
   the tree that was moved aside. If the second move fails the first is undone,
   which leaves the live tree exactly as it was.

   Every path this deletes is one it constructed itself from `finalDir` plus a
   known suffix. Nothing here removes a path it was handed. */

const STAGE_SUFFIX = ".staging-";
const PREVIOUS_SUFFIX = ".previous-";

async function exists(target) {
  try { await stat(target); return true; }
  catch { return false; }
}

async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  let entries;
  try { entries = await readdir(from, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    else if (entry.isFile()) await copyFile(source, target);
  }
}

async function retryRename(from, to, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try { return await rename(from, to); }
    catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}

/* `seed` copies the live tree into staging first. Retention rules — keep the
   last good file when a feed fails this hour — are written against a populated
   output directory, so seeding is what lets them work unchanged while the run
   still cannot damage anything until it passes its gates. */
export async function createStage(finalDir, { seed = true } = {}) {
  const dir = `${finalDir}${STAGE_SUFFIX}${process.pid}-${Date.now()}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  if (seed) await copyTree(finalDir, dir);

  let settled = false;
  return {
    dir,
    async promote() {
      if (settled) throw new Error("staging directory already settled");
      settled = true;
      const previous = `${finalDir}${PREVIOUS_SUFFIX}${process.pid}-${Date.now()}`;
      const hadFinal = await exists(finalDir);
      if (hadFinal) await retryRename(finalDir, previous);
      try {
        await retryRename(dir, finalDir);
      } catch (error) {
        if (hadFinal) await retryRename(previous, finalDir); // put the live tree back
        throw error;
      }
      if (hadFinal) await rm(previous, { recursive: true, force: true });
    },
    async discard() {
      if (settled) return;
      settled = true;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/* A run that crashed before promoting leaves its staging directory behind. A
   crash in the narrow window after the live tree moved aside can also leave a
   `.previous-*` directory with no final directory. In that case the previous
   tree is the recovery copy, not garbage: restore the newest one before
   removing other leftovers. */
export async function clearAbandonedStages(finalDir) {
  const parent = path.dirname(finalDir);
  const base = path.basename(finalDir);
  let entries;
  try { entries = await readdir(parent, { withFileTypes: true }); }
  catch { return { removed: 0, recovered: false }; }
  const candidates = entries.filter((entry) => entry.isDirectory());
  const previous = candidates.filter((entry) => entry.name.startsWith(`${base}${PREVIOUS_SUFFIX}`));
  let recovered = false;
  if (!await exists(finalDir) && previous.length) {
    const dated = await Promise.all(previous.map(async (entry) => ({
      entry,
      modified: (await stat(path.join(parent, entry.name))).mtimeMs,
    })));
    dated.sort((a, b) => b.modified - a.modified);
    await retryRename(path.join(parent, dated[0].entry.name), finalDir);
    recovered = true;
  }
  let removed = 0;
  for (const entry of candidates) {
    if (!entry.name.startsWith(`${base}${STAGE_SUFFIX}`) && !entry.name.startsWith(`${base}${PREVIOUS_SUFFIX}`)) continue;
    const target = path.join(parent, entry.name);
    if (!await exists(target)) continue; // the selected previous tree was restored
    await rm(target, { recursive: true, force: true });
    removed += 1;
  }
  return { removed, recovered };
}

/* ---------------- source provenance ----------------

   Every source answers the same questions, so the quality strip can say what
   actually happened rather than what the code hoped would happen: which
   endpoint, when it was asked, what moment the data describes, how many rows
   arrived, how many survived, and why the rest did not. */
export function sourceRecord({
  id,
  endpointFamily = null,
  requestedType = null,
  url = null,
  requestedAt = null,
  observedAt = null,
  ok = true,
  status = null,
  etag = null,
  lastModified = null,
  version = null,
  hash = null,
  rawRows = null,
  accepted = null,
  rejected = null,
  rejectedReasons = null,
  skipped = null,
  skippedReasons = null,
  warnings = null,
} = {}) {
  const record = {
    id,
    endpointFamily,
    requestedType,
    url,
    requestedAt,
    observedAt,
    ok: !!ok,
    status,
    etag,
    lastModified,
    version,
    hash,
    rawRows,
    accepted,
    rejected,
    rejectedReasons: rejectedReasons && Object.keys(rejectedReasons).length ? rejectedReasons : null,
    skipped,
    skippedReasons: skippedReasons && Object.keys(skippedReasons).length ? skippedReasons : null,
    warnings: warnings?.length ? warnings : null,
  };
  if (observedAt) {
    const observedMs = Date.parse(observedAt);
    if (Number.isFinite(observedMs)) record.freshnessMinutes = Math.max(0, Math.round((Date.now() - observedMs) / 60000));
  }
  for (const [key, value] of Object.entries(record)) if (value === null) delete record[key];
  return record;
}

/* Publication-time checks for the diagnostic envelopes emitted by both games.
   Adapters remain game-specific; these checks only enforce the common claims
   every source record makes. */
export function checkSourceRecords(report, label, records, { requiredPrefixes = [] } = {}) {
  if (!Array.isArray(records) || !records.length) {
    report.fail("sources-missing", `${label} contains no source provenance`);
    return;
  }
  const malformed = [];
  const failed = [];
  const rejectionHeavy = [];
  for (const record of records) {
    if (!record?.id || !record?.endpointFamily || !record?.url
      || !isIsoTimestamp(record?.requestedAt) || !isNotFuture(record.requestedAt)
      || typeof record?.ok !== "boolean") {
      malformed.push(record?.id || "unnamed");
      continue;
    }
    if (!record.ok) failed.push(record.id);
    const raw = Number(record.rawRows);
    const rejected = Number(record.rejected);
    const accepted = Number(record.accepted);
    const skipped = Number(record.skipped);
    if (Number.isFinite(raw) && raw < 0 || Number.isFinite(rejected) && rejected < 0
      || Number.isFinite(accepted) && accepted < 0 || Number.isFinite(skipped) && skipped < 0) {
      malformed.push(record.id);
    }
    if (Number.isFinite(raw) && Number.isFinite(rejected) && rejected > raw) malformed.push(record.id);
    if (Number.isFinite(raw) && Number.isFinite(skipped) && skipped > raw) malformed.push(record.id);
    /* PoE2Scout enumerates the whole item catalogue for every league. A row
       with no positive price is an expected unpriced market, especially in
       Standard, not a malformed row. Schema-2 snapshots written before the
       dedicated `skipped` field recorded those rows as `invalid_price`, so the
       compatibility subtraction also lets code-only reuse assess them fairly. */
    const legacyScoutUnpriced = record.id === "poe2scout.items"
      ? Number(record.rejectedReasons?.invalid_price) || 0 : 0;
    const concerningRejected = Math.max(0, rejected - legacyScoutUnpriced);
    if (raw >= 20 && concerningRejected / raw > 0.5) {
      rejectionHeavy.push(`${record.id} ${concerningRejected}/${raw}`);
    }
  }
  if (malformed.length) report.fail("sources-shape", `${label} has ${malformed.length} malformed source record(s)`, malformed.slice(0, 12));
  if (failed.length) report.warn("source-request-failed", `${label} records ${failed.length} failed request(s)`, failed.slice(0, 12));
  if (rejectionHeavy.length) report.warn("source-rejections", `${label} rejected more than half the rows from ${rejectionHeavy.length} request(s)`, rejectionHeavy.slice(0, 12));
  for (const prefix of requiredPrefixes) {
    if (!records.some((record) => record?.ok && String(record.id).startsWith(prefix))) {
      report.fail("selected-source-untracked", `${label} selected ${prefix} data but has no successful matching provenance record`);
    }
  }
}

export function checkMetadataCoverage(report, label, coverage, { classifications = [], previous = null } = {}) {
  const rows = Array.isArray(coverage) ? coverage : coverage ? [coverage] : [];
  const previousRows = Array.isArray(previous) ? previous : previous ? [previous] : [];
  const previousByFamily = new Map(previousRows.map((row) => [row.family || "prices", row]));
  if (!rows.length) {
    report.warn("metadata-coverage-missing", `${label} reports no metadata coverage`);
    return;
  }
  for (const row of rows) {
    const family = row.family || "prices";
    const total = Number(row.total) || 0;
    const accounted = [row.byPath, row.byName, row.ambiguous, row.unmatched]
      .reduce((sum, value) => sum + (Number(value) || 0), 0);
    if (total < 0 || accounted !== total) {
      report.fail("metadata-coverage-shape", `${label}/${family}: coverage accounts for ${accounted} of ${total} entries`);
      continue;
    }
    if (total >= 10) {
      const unresolved = ((Number(row.ambiguous) || 0) + (Number(row.unmatched) || 0)) / total;
      if (unresolved > 0.5) report.degrade("metadata-unresolved", `${label}/${family}: ${Math.round(unresolved * 100)}% of identities are ambiguous or unmatched`);
      else if (unresolved > 0.1) report.warn("metadata-unresolved", `${label}/${family}: ${Math.round(unresolved * 100)}% of identities are ambiguous or unmatched`);
      const before = previousByFamily.get(family);
      const beforeTotal = Number(before?.total) || 0;
      if (beforeTotal >= 10) {
        const beforeUnresolved = ((Number(before.ambiguous) || 0) + (Number(before.unmatched) || 0)) / beforeTotal;
        const beforeByPath = (Number(before.byPath) || 0) / beforeTotal;
        const nowByPath = (Number(row.byPath) || 0) / total;
        if (unresolved > beforeUnresolved + 0.15) {
          report.warn("metadata-coverage-regressed", `${label}/${family}: unresolved identity rose from ${Math.round(beforeUnresolved * 100)}% to ${Math.round(unresolved * 100)}%`);
        }
        if (beforeByPath > nowByPath + 0.2) {
          report.warn("metadata-path-regressed", `${label}/${family}: Metadata-path identity fell from ${Math.round(beforeByPath * 100)}% to ${Math.round(nowByPath * 100)}%`);
        }
      }
    }
  }
  for (const row of classifications || []) {
    const total = Number(row.total) || 0;
    const accounted = [row.metadata, row.exception, row.name].reduce((sum, value) => sum + (Number(value) || 0), 0);
    if (total < 0 || accounted !== total) {
      report.fail("classification-coverage-shape", `${label}/${row.family || "family"}: classification accounts for ${accounted} of ${total} entries`);
    } else if (total >= 10 && Number(row.name) / total > 0.8) {
      report.warn("classification-name-fallback", `${label}/${row.family || "family"}: ${Math.round(Number(row.name) / total * 100)}% of classification relies on names`);
    }
  }
}

/* ---------------- quality ---------------- */

export const QUALITY_LEVELS = ["ok", "warning", "degraded", "failure"];
const RANK = Object.fromEntries(QUALITY_LEVELS.map((level, index) => [level, index]));

/* Three levels, three different consequences:
     warning  — notable drift, publish and tell someone;
     degraded — publishable but visibly incomplete, and the UI must say so;
     failure  — unsafe to publish, exit non-zero and keep the last deployment. */
export class QualityReport {
  constructor({ game, generatedAt = new Date().toISOString() } = {}) {
    this.game = game;
    this.generatedAt = generatedAt;
    this.checks = [];
  }

  record(level, code, message, detail) {
    this.checks.push({ level, code, message, ...(detail === undefined ? {} : { detail }) });
    return this;
  }

  pass(code, message, detail) { return this.record("ok", code, message, detail); }
  warn(code, message, detail) { return this.record("warning", code, message, detail); }
  degrade(code, message, detail) { return this.record("degraded", code, message, detail); }
  fail(code, message, detail) { return this.record("failure", code, message, detail); }

  /* `condition` true means the check passed; false raises it to `level`. */
  expect(condition, level, code, message, detail) {
    return condition ? this.pass(code, message) : this.record(level, code, message, detail);
  }

  at(level) { return this.checks.filter((check) => check.level === level); }
  get failures() { return this.at("failure"); }
  get publishable() { return this.failures.length === 0; }

  get state() {
    return this.checks.reduce((worst, check) => (RANK[check.level] > RANK[worst] ? check.level : worst), "ok");
  }

  merge(other) {
    for (const check of other?.checks || []) this.checks.push(check);
    return this;
  }

  summary() {
    const counts = Object.fromEntries(QUALITY_LEVELS.map((level) => [level, this.at(level).length]));
    return `${this.state} (${QUALITY_LEVELS.filter((l) => l !== "ok").map((l) => `${counts[l]} ${l}`).join(", ")})`;
  }

  toJSON() {
    return {
      schemaVersion: 1,
      game: this.game,
      generatedAt: this.generatedAt,
      state: this.state,
      counts: Object.fromEntries(QUALITY_LEVELS.map((level) => [level, this.at(level).length])),
      // Passing checks are the boring majority; the manifest carries what needs
      // acting on, and the counts above still prove the checks ran.
      checks: this.checks.filter((check) => check.level !== "ok"),
    };
  }

  print(log = console.log) {
    for (const check of this.checks) {
      if (check.level === "ok") continue;
      log(`  [${check.level}] ${check.code}: ${check.message}`);
    }
    log(`Quality: ${this.summary()}`);
  }
}

/* ---------------- generic value checks ----------------

   Deliberately small. "Missing is unknown, never zero" is the rule these exist
   to enforce, so nothing here coerces: a value either is a usable number or it
   is not one, and the caller decides what that means. */

export const isFinitePositive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;

/* Rounding a price must never turn it into zero.

   Two decimals is fine for a scarab and catastrophic for a Rogue's Marker: at
   0.001c it rounded to 0, and a zero price is not a cheap item, it is a claim
   that the item is free. That is how `c: 0` entries reached published files for
   Rogue's Marker, Alch/Aug/Transmute shards and several divination cards, and
   how The Catalyst wrote 31 zero points into its own accumulated history.

   Precision therefore scales with magnitude, and a positive input always
   returns a positive number. A value that is not a usable price returns null —
   the caller decides what absent means, because absent and zero are different
   answers. */
export function roundPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const places = number >= 10 ? 2 : number >= 1 ? 3 : number >= 0.01 ? 4 : 6;
  const rounded = Math.round(number * 10 ** places) / 10 ** places;
  return rounded > 0 ? rounded : Number(number.toPrecision(3));
}

export function isIsoTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/* Clock skew between a runner and a source is normal; a timestamp hours ahead
   is a parsing bug or a corrupted file. */
export function isNotFuture(value, { nowMs = Date.now(), toleranceMs = 2 * 3600_000 } = {}) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= nowMs + toleranceMs;
}

export function orderedUnique(timestamps) {
  const problems = [];
  let previous = -Infinity;
  const seen = new Set();
  for (const value of timestamps) {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) { problems.push(`unparseable timestamp ${value}`); continue; }
    if (ms < previous) problems.push(`out of order at ${value}`);
    if (seen.has(value)) problems.push(`duplicate timestamp ${value}`);
    seen.add(value);
    previous = ms;
  }
  return problems;
}

/* Rolling comparisons beat fixed expectations: item counts move every league,
   but a source that answered for 4,900 names yesterday and 12 today is broken
   whatever the absolute numbers are. */
export function collapsed(current, previous, { minRatio = 0.5, floor = 20 } = {}) {
  if (!Number.isFinite(previous) || previous < floor) return false;
  if (!Number.isFinite(current)) return true;
  return current < previous * minRatio;
}
