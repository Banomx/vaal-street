/* Catalogue drift between two snapshots of the same market category.

   New items need no help: every category is fetched by type plus a name
   regex, so an item GGG adds to an existing family shows up on the next run.
   A *renamed* item is the problem. From the outside it looks like one name
   disappearing and an unrelated one arriving, which silently restarts that
   item's accumulated history and quietly unprices anything the curated boss
   and Delve datasets reference by the old name.

   Renames are only followed when a stable identity says so. Two things count:
   a GGG Metadata path, which is the game's own identity and survives a display
   name changing under it, and a numeric id the source assigns, which is real
   continuity but only within that source. The poe.ninja exchange derives its id
   from the display name itself, so "ritual-scarab-of-wisps" is the name again
   in a different coat and confirms nothing.

   Name similarity alone is not enough to act on — "Ritual Scarab of Wisps" and
   "Ritual Scarab of Abundance" share three of four tokens, so a sibling being
   added the same hour an old one is retired would pair with it and produce
   confidently wrong percentages. Similarity therefore only ever produces a
   *suspected* rename for a human to confirm.

   Two further things are reported and never acted on: an identity that answers
   to more than one current name (`collisions`), and two current items sharing a
   display name (`duplicateNames`). History is keyed by name, so both would
   quietly merge two items into one series. */

export const SUSPECT_MIN_SCORE = 0.5;

/** Identity, strongest first.

    1. `metadata` — a GGG/RePoE Metadata path. This is the game's own identity
       for the item: it survives display-name changes, it is the same string
       across leagues and across sources, and GGG renaming an item does not
       change it. It is the best continuity evidence available.
    2. `source` — a numeric id the source assigns. Real continuity, but only
       within that source: poe.watch's 4211 and poe.ninja's 4211 are unrelated,
       so the scope prefix is part of the key rather than decoration.

    Anything else is not identity. The poe.ninja exchange derives its id from
    the display name itself, so "ritual-scarab-of-wisps" is the name again in a
    different coat and carries no continuity whatsoever. */
export const IDENTITY_KINDS = ["metadata", "source"];

export function stableId(item, { source = "source" } = {}) {
  /* A Metadata path only counts when the source stated it. A path recovered by
     matching display names is the display name again with extra steps, so using
     it as continuity evidence would be circular. `identity` records how the
     path was obtained; see scripts/poe1/enrich.mjs. */
  const derivedByName = item?.identity === "name" || item?.identity === "name-ambiguous";
  const path = item?.gggId ?? (derivedByName ? null : item?.metadataPath);
  if (typeof path === "string" && path.startsWith("Metadata/")) return `metadata:${path}`;
  const id = item?.id;
  if (typeof id === "string" && id.startsWith("Metadata/")) return `metadata:${id}`;
  if (typeof id === "number" && Number.isFinite(id)) return `${source}:${id}`;
  if (typeof id === "string" && /^\d+$/.test(id)) return `${source}:${Number(id)}`;
  return null;
}

/** Which of the two produced a key, for reporting. */
export function identityKind(key) {
  if (typeof key !== "string") return null;
  return key.startsWith("metadata:") ? "metadata" : "source";
}

export function nameTokens(name) {
  return new Set(String(name ?? "").toLowerCase().match(/[a-z0-9]+/g) || []);
}

/** Shared tokens over the larger name, so a short name cannot score highly
    against a long one just by being a subset of it. */
export function similarity(a, b) {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / Math.max(left.size, right.size);
}

function pairBySimilarity(gone, fresh, minScore) {
  const scored = [];
  for (const from of gone) {
    for (const to of fresh) {
      const score = similarity(from, to);
      if (score >= minScore) scored.push({ from, to, score: Math.round(score * 100) / 100 });
    }
  }
  // Greedy on the best score and one-to-one, so a family-wide rename does not
  // collapse every retired name onto the same new one.
  scored.sort((a, b) => b.score - a.score || (a.from < b.from ? -1 : 1));
  const usedFrom = new Set();
  const usedTo = new Set();
  const pairs = [];
  for (const pair of scored) {
    if (usedFrom.has(pair.from) || usedTo.has(pair.to)) continue;
    usedFrom.add(pair.from);
    usedTo.add(pair.to);
    pairs.push(pair);
  }
  return { pairs, usedFrom, usedTo };
}

/** Compare two item lists of the same category.

    Returns `renamed` (id-confirmed, safe to act on), `suspected` (name
    similarity only, report and leave alone), and the plain `added` / `removed`
    remainder. */
export function diffCatalogue(previous, current, { minScore = SUSPECT_MIN_SCORE } = {}) {
  const prev = (previous || []).filter((item) => item?.name);
  const curr = (current || []).filter((item) => item?.name);
  const prevNames = new Set(prev.map((item) => item.name));
  const currNames = new Set(curr.map((item) => item.name));

  /* Keyed by identity, but holding every current item that claims it — a
     duplicate is a fact about the feed, and silently keeping the last one seen
     is how a collision turns into a confidently wrong rename. */
  const currById = new Map();
  for (const item of curr) {
    const id = stableId(item);
    if (id == null) continue;
    if (!currById.has(id)) currById.set(id, []);
    currById.get(id).push(item);
  }

  const renamed = [];
  const collisions = [];
  const renamedFrom = new Set();
  const renamedTo = new Set();
  for (const item of prev) {
    if (currNames.has(item.name)) continue;
    const id = stableId(item);
    if (id == null) continue;
    const matches = currById.get(id);
    if (!matches) continue;
    /* One identity answering to two current names is not a rename, it is a
       broken identity. Acting on it would graft one item's curve onto another;
       reporting it is the only safe response. */
    if (matches.length > 1) {
      collisions.push({ id, from: item.name, to: matches.map((entry) => entry.name).sort() });
      continue;
    }
    const match = matches[0];
    if (prevNames.has(match.name) || match.name === item.name) continue;
    renamed.push({ from: item.name, to: match.name, id, identity: identityKind(id) });
    renamedFrom.add(item.name);
    renamedTo.add(match.name);
  }

  const gone = [...prevNames].filter((name) => !currNames.has(name) && !renamedFrom.has(name));
  const fresh = [...currNames].filter((name) => !prevNames.has(name) && !renamedTo.has(name));
  const { pairs, usedFrom, usedTo } = pairBySimilarity(gone, fresh, minScore);

  /* Two current items sharing a display name is its own problem: history is
     keyed by name, so the two would accumulate into one series. */
  const duplicateNames = [...new Set(curr.map((item) => item.name)
    .filter((name, index, all) => all.indexOf(name) !== index))].sort();

  return {
    added: fresh.filter((name) => !usedTo.has(name)).sort(),
    removed: gone.filter((name) => !usedFrom.has(name)).sort(),
    renamed: renamed.sort((a, b) => (a.from < b.from ? -1 : 1)),
    suspected: pairs.sort((a, b) => (a.from < b.from ? -1 : 1)),
    collisions: collisions.sort((a, b) => (a.from < b.from ? -1 : 1)),
    duplicateNames,
    count: currNames.size,
  };
}

/** Rewrite accumulated self-history keys so an id-confirmed rename keeps its
    curve instead of restarting blank. Only ever called with `diff.renamed`:
    grafting a sibling's price curve onto the wrong item on the strength of a
    guess is worse than a day of empty percentages. An existing key for the new
    name wins, since that is real data for the name we are keeping. */
export function applyRenames(points, renames) {
  migrateHistoryKeys(points, renames);
  return points;
}

/** The same move, reported.

    Accumulated history is keyed by display name, which is why a rename has to
    be followed at all. The rules that keep that safe:

    - a rename is applied only where the old key holds data and the new one does
      not. A new key that already holds data is real data for the name being
      kept, and overwriting it would destroy an observation to satisfy a
      bookkeeping change;
    - two renames pointing at the same new name are a collision. Neither is
      applied, because there is no way to tell which curve belongs there;
    - a series whose name no longer exists anywhere is left exactly where it is
      and reported. Deleting it is irreversible and a name can come back;
    - nothing here guesses. Only id-confirmed renames reach this function.

    Returns counts and the names involved so a run can say what it did rather
    than silently rewriting the only copy of a league's history. */
export function migrateHistoryKeys(points, renames) {
  const list = (renames || []).filter((entry) => entry?.from && entry?.to);
  const byTarget = new Map();
  for (const entry of list) {
    if (!byTarget.has(entry.to)) byTarget.set(entry.to, []);
    byTarget.get(entry.to).push(entry.from);
  }
  const contested = new Set([...byTarget.entries()].filter(([, from]) => from.length > 1).map(([to]) => to));

  const moved = new Set();
  const blocked = new Set();
  for (const { from, to } of list) {
    if (contested.has(to)) continue;
    for (const point of points || []) {
      const values = point?.values;
      if (!values || values[from] == null) continue;
      if (values[to] != null) { blocked.add(`${from} -> ${to}`); continue; }
      values[to] = values[from];
      delete values[from];
      moved.add(`${from} -> ${to}`);
    }
  }
  return {
    moved: [...moved].sort(),
    blocked: [...blocked].sort(),
    contested: [...contested].sort(),
  };
}

/** Names a history holds that the current catalogue no longer has.

    Reported rather than removed: a series is the only copy of what an item did,
    a name can come back, and "this league stopped listing it" and "the feed had
    a bad hour" look identical from here. */
export function unresolvedSeries(points, currentNames) {
  const current = currentNames instanceof Set ? currentNames : new Set(currentNames || []);
  const seen = new Set();
  for (const point of points || []) {
    for (const name of Object.keys(point?.values || {})) if (!current.has(name)) seen.add(name);
  }
  return [...seen].sort();
}

/** True when a diff contains nothing worth telling anyone about. */
export function isQuiet(diff) {
  return !diff.added.length && !diff.removed.length && !diff.renamed.length && !diff.suspected.length
    && !(diff.collisions || []).length && !(diff.duplicateNames || []).length;
}

/** Names that vanished (or moved) and are referenced by curated data, which is
    the subset that actually breaks something rather than merely changing. */
export function breakingNames(diff, curatedNames) {
  const curated = curatedNames instanceof Set ? curatedNames : new Set(curatedNames || []);
  const gone = [
    ...diff.removed,
    ...diff.renamed.map((pair) => pair.from),
    ...diff.suspected.map((pair) => pair.from),
  ];
  return [...new Set(gone.filter((name) => curated.has(name)))].sort();
}

/** One line per category, for the Actions log. */
export function describeDiff(key, diff) {
  if (isQuiet(diff)) return `${key}: ${diff.count} items, no catalogue change`;
  const parts = [];
  if (diff.added.length) parts.push(`+${diff.added.length} new (${diff.added.join(", ")})`);
  if (diff.renamed.length) parts.push(`${diff.renamed.length} renamed (${diff.renamed.map((p) => `${p.from} -> ${p.to}`).join("; ")})`);
  if (diff.suspected.length) parts.push(`${diff.suspected.length} possible rename (${diff.suspected.map((p) => `${p.from} -> ${p.to}? ${p.score}`).join("; ")})`);
  if (diff.removed.length) parts.push(`-${diff.removed.length} gone (${diff.removed.join(", ")})`);
  if (diff.collisions?.length) {
    parts.push(`${diff.collisions.length} identity collision (${diff.collisions.map((c) => `${c.id} -> ${c.to.join(" / ")}`).join("; ")})`);
  }
  if (diff.duplicateNames?.length) parts.push(`${diff.duplicateNames.length} duplicate display name (${diff.duplicateNames.join(", ")})`);
  return `${key}: ${diff.count} items, ${parts.join(", ")}`;
}
