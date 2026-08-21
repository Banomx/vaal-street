/* What the browser is allowed to believe about a file it just downloaded.

   The snapshots are written by scripts/<game>/fetch-data.mjs and served as
   static files, which means the page can be handed anything: a 404 while a
   deployment is mid-swap, a half-written file behind a CDN, a document from a
   future schema after a rollback, or an hour-old tree that a failed run left
   in place. None of those are the same problem, and the previous code treated
   all of them as "no data" — or worse, quietly substituted something invented.

   Every read therefore returns a *state* rather than throwing or yielding
   null:

     ready         parsed, schema understood, required fields present
     missing       the server said 404 — the run never wrote this file
     offline       the request itself failed — network, CORS, DNS
     corrupt       downloaded but not parseable, or missing required fields
     incompatible  a schemaVersion this build does not know how to read

   `missing` and `incompatible` are deliberately distinct: an absent history is
   normal for a league on its first hour, while an unreadable one means this
   build is older than the data and rendering it would be a guess. Nothing here
   invents a value to paper over any of them. */

export const READY = "ready";
export const MISSING = "missing";
export const OFFLINE = "offline";
export const CORRUPT = "corrupt";
export const INCOMPATIBLE = "incompatible";

/* Worst-first, so a set of documents can be reduced to the single state worth
   telling someone about. `ready` sorts lowest because it is the absence of a
   problem. */
export const STATE_RANK = { [READY]: 0, [MISSING]: 1, [OFFLINE]: 2, [CORRUPT]: 3, [INCOMPATIBLE]: 4 };

export function worstState(states) {
  let worst = READY;
  for (const state of states || []) {
    if (!(state in STATE_RANK)) continue;
    if (STATE_RANK[state] > STATE_RANK[worst]) worst = state;
  }
  return worst;
}

export function isUsable(result) {
  return result?.state === READY && result.data != null;
}

/** Fetch and parse, converting every failure mode into a state.

    Never throws and never returns a bare `null` that a caller could mistake
    for an empty dataset. An aborted request (league switched, component
    unmounted) is reported as such so a caller can ignore it instead of
    rendering "offline" over a view the user already left. */
export async function readJson(url, { fetchImpl, signal, cache = "no-cache" } = {}) {
  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return { state: OFFLINE, url, error: "no fetch implementation" };
  let response;
  try {
    response = await doFetch(url, { cache, signal });
  } catch (error) {
    if (error?.name === "AbortError") return { state: OFFLINE, url, aborted: true, error: "aborted" };
    return { state: OFFLINE, url, error: String(error?.message || error) };
  }
  if (response.status === 404) return { state: MISSING, url, status: 404 };
  if (!response.ok) return { state: OFFLINE, url, status: response.status, error: `HTTP ${response.status}` };
  try {
    return { state: READY, url, status: response.status, data: await response.json() };
  } catch (error) {
    /* A 200 that will not parse is the dangerous case: a proxy error page, a
       truncated upload, an index.html served for a missing path. Treating it
       as "no data" would hide a broken deployment behind an empty chart. */
    return { state: CORRUPT, url, status: response.status, error: `unparseable JSON: ${String(error?.message || error)}` };
  }
}

/** Check a parsed document against this build's contract.

    `supported` lists the schema versions this build knows. A document with no
    `schemaVersion` at all predates versioning — it is accepted, because the
    carry-forward path can still be serving files written by an older run, but
    it is flagged `legacy` so the caller can say the data is older than the
    contract rather than pretending it was checked. */
export function checkDocument(data, { supported = [1], required = [], allowLegacy = true, versioned = true } = {}) {
  if (data == null) return { state: MISSING };
  if (typeof data !== "object" || Array.isArray(data)) {
    return { state: CORRUPT, reason: `expected an object, got ${Array.isArray(data) ? "an array" : typeof data}` };
  }
  /* Some files are bare maps by design — a derived history is `{ name:
     [points] }` and has nowhere to put an envelope. Those are declared
     `versioned: false` at the call site rather than being reported forever as
     "older than the contract". */
  if (!versioned) {
    const missing = required.filter((field) => data[field] == null);
    if (missing.length) return { state: CORRUPT, missing, reason: `missing ${missing.join(", ")}` };
    return { state: READY };
  }
  const version = data.schemaVersion;
  if (version == null) {
    if (!allowLegacy) return { state: INCOMPATIBLE, reason: "no schemaVersion" };
    const missing = required.filter((field) => data[field] == null);
    if (missing.length) return { state: CORRUPT, legacy: true, missing, reason: `missing ${missing.join(", ")}` };
    return { state: READY, legacy: true };
  }
  if (!supported.includes(version)) {
    return { state: INCOMPATIBLE, schemaVersion: version, reason: `schemaVersion ${version}, this build reads ${supported.join(", ")}` };
  }
  const missing = required.filter((field) => data[field] == null);
  if (missing.length) return { state: CORRUPT, schemaVersion: version, missing, reason: `missing ${missing.join(", ")}` };
  return { state: READY, schemaVersion: version };
}

/** Read a file and check it in one step. The result carries `data` only when
    the state is `ready`, so a caller cannot accidentally render a document
    that failed its contract. */
export async function loadDocument(url, { supported, required, allowLegacy, versioned, fetchImpl, signal, cache } = {}) {
  if (!url) return { state: MISSING, reason: "not listed in the snapshot index" };
  const read = await readJson(url, { fetchImpl, signal, cache });
  if (read.state !== READY) return read;
  const check = checkDocument(read.data, { supported, required, allowLegacy, versioned });
  if (check.state !== READY) return { ...read, ...check, data: undefined };
  return { ...read, ...check };
}

/* Every league entry in an index names its own files. Older indexes (and the
   PoE 1 index before this change) do not, so a caller supplies the defaults it
   expects; a name the index does state always wins. Files are addressed
   through this one function so a rename in the generator only has to be
   reflected in the index it already writes. */
export function leagueFile(league, key, defaults = {}) {
  const named = league?.files?.[key];
  return typeof named === "string" && named ? named : defaults[key] || null;
}

export function leagueFileUrl(base, league, key, defaults = {}) {
  const name = leagueFile(league, key, defaults);
  if (!name) return null;
  const slug = league?.slug || league?.name;
  if (!slug) return null;
  return `${base}/${encodeURIComponent(slug)}/${name}`;
}

/** How old a snapshot is, and whether that is worth saying out loud.

    The workflow fetches hourly, so a few hours behind is a hiccup and a day
    behind means the job has been failing. Both are reported; neither is
    hidden, because a stale price shown as current is the one failure mode a
    market tool must never have. */
export function freshness(generatedAt, { now = Date.now(), staleAfterHours = 6, deadAfterHours = 36 } = {}) {
  const stamp = Date.parse(generatedAt ?? "");
  if (!Number.isFinite(stamp)) return { generatedAt: null, ageHours: null, level: "unknown" };
  const ageHours = (now - stamp) / 3_600_000;
  /* A snapshot stamped in the future is a clock problem somewhere, not fresh
     data. Say so rather than reporting a negative age. */
  if (ageHours < -0.5) return { generatedAt, ageHours, level: "future" };
  if (ageHours >= deadAfterHours) return { generatedAt, ageHours, level: "dead" };
  if (ageHours >= staleAfterHours) return { generatedAt, ageHours, level: "stale" };
  return { generatedAt, ageHours, level: "fresh" };
}

export function describeAge(ageHours) {
  if (!Number.isFinite(ageHours)) return "at an unknown time";
  if (ageHours < 1.5) return "in the last hour";
  if (ageHours < 48) return `${Math.round(ageHours)} hours ago`;
  return `${Math.round(ageHours / 24)} days ago`;
}

/* Human wording for a document that did not come back clean. `what` names the
   thing in the sentence, so the same phrasing serves the index, a price file
   and a history file. */
export function describeState(state, what, detail) {
  const suffix = detail ? ` (${detail})` : "";
  switch (state) {
    case MISSING: return `${what} has not been generated yet${suffix}.`;
    case OFFLINE: return `${what} could not be downloaded${suffix}.`;
    case CORRUPT: return `${what} is unreadable and was not used${suffix}.`;
    case INCOMPATIBLE: return `${what} uses a newer data format than this page${suffix}. Reload to pick up the current build.`;
    default: return `${what} loaded${suffix}.`;
  }
}

/* Severity for the UI. Anything that is not `ready` is at least a notice; the
   states that mean "what you are looking at may be wrong" are errors. */
export const LEVELS = ["ok", "notice", "warning", "error"];

export function levelFor(state) {
  if (state === READY) return "ok";
  if (state === MISSING) return "notice";
  if (state === OFFLINE) return "warning";
  return "error";
}

export function worstLevel(levels) {
  let worst = "ok";
  for (const level of levels || []) {
    if (LEVELS.indexOf(level) > LEVELS.indexOf(worst)) worst = level;
  }
  return worst;
}

/** Fold a quality.json report (written by the publication gates) into notes.

    The generator already decided what counts as a warning, a degradation or a
    failure; the browser's job is to repeat it, not to re-derive it. A report
    that is itself missing is not an error — it only exists from this build
    onwards. */
export function qualityNotes(quality, { game } = {}) {
  if (!quality || typeof quality !== "object") return [];
  const notes = [];
  /* Field names come from `QualityReport.toJSON()` in
     scripts/shared/dataset.mjs: each check is `{ level, code, message }`.
     scripts/tests/shared/test-snapshot.mjs builds its fixture from a real
     report rather than a hand-written object, because reading the wrong field
     here fails silently — the banner simply never mentions a degraded run. */
  const checks = Array.isArray(quality.checks) ? quality.checks : [];
  const label = game ? `${game} ` : "";
  for (const check of checks) {
    if (check?.level === "failure") notes.push({ level: "error", text: `${label}${check.code}: ${check.message}` });
    else if (check?.level === "degraded") notes.push({ level: "warning", text: `${label}${check.code}: ${check.message}` });
  }
  const degraded = checks.filter((check) => check?.level === "degraded").length;
  const warnings = checks.filter((check) => check?.level === "warning").length;
  if (!notes.length && warnings) {
    notes.push({ level: "notice", text: `${warnings} data quality warning${warnings > 1 ? "s" : ""} in the last run.` });
  }
  if (degraded && notes.length > 3) notes.length = 3; // the banner is a summary, not the report
  return notes;
}

/** One structured verdict for a league's worth of documents.

    `documents` is `{ label: result }`. Required documents contribute their
    state; optional ones only contribute when they came back worse than
    missing, because "no history yet" is an ordinary state for a new league and
    not something to shout about. */
export function summarize({ documents = {}, required = [], quality, generatedAt, game, now, staleAfterHours, deadAfterHours } = {}) {
  const notes = [];
  const states = [];
  for (const [label, result] of Object.entries(documents)) {
    if (!result) continue;
    const isRequired = required.includes(label);
    if (result.aborted) continue;
    if (result.state === READY) {
      if (result.legacy) notes.push({ level: "notice", text: `${label} predates the current data format and was read as-is.` });
      continue;
    }
    if (!isRequired && result.state === MISSING) {
      notes.push({ level: "notice", text: describeState(MISSING, label) });
      continue;
    }
    states.push(result.state);
    notes.push({ level: levelFor(result.state), text: describeState(result.state, label, result.reason || result.error) });
  }

  const age = freshness(generatedAt, { now, staleAfterHours, deadAfterHours });
  if (age.level === "stale" || age.level === "dead") {
    notes.push({
      level: age.level === "dead" ? "warning" : "notice",
      text: `Prices were last updated ${describeAge(age.ageHours)}; the hourly snapshot job may be failing.`,
    });
  }
  if (age.level === "future") notes.push({ level: "notice", text: "This snapshot is stamped in the future — check the clock on whatever generated it." });

  notes.push(...qualityNotes(quality, { game }));

  const state = worstState(states);
  const level = worstLevel([levelFor(state), ...notes.map((note) => note.level)]);
  return { state, level, notes, freshness: age, usable: state !== INCOMPATIBLE && state !== CORRUPT };
}
