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

/* A run that crashed before promoting leaves its staging directory behind.
   Clearing them at the start of the next run keeps that from accumulating,
   and the name pattern means only this script's own leftovers are touched. */
export async function clearAbandonedStages(finalDir) {
  const parent = path.dirname(finalDir);
  const base = path.basename(finalDir);
  let entries;
  try { entries = await readdir(parent, { withFileTypes: true }); }
  catch { return 0; }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(`${base}${STAGE_SUFFIX}`) && !entry.name.startsWith(`${base}${PREVIOUS_SUFFIX}`)) continue;
    await rm(path.join(parent, entry.name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
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
    warnings: warnings?.length ? warnings : null,
  };
  if (observedAt) {
    const observedMs = Date.parse(observedAt);
    if (Number.isFinite(observedMs)) record.freshnessMinutes = Math.max(0, Math.round((Date.now() - observedMs) / 60000));
  }
  for (const [key, value] of Object.entries(record)) if (value === null) delete record[key];
  return record;
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
