/* Catalogue drift between two snapshots of the same market category.

   New items need no help: every category is fetched by type plus a name
   regex, so an item GGG adds to an existing family shows up on the next run.
   A *renamed* item is the problem. From the outside it looks like one name
   disappearing and an unrelated one arriving, which silently restarts that
   item's accumulated history and quietly unprices anything the curated boss
   and Delve datasets reference by the old name.

   Renames are only followed when a stable id says so. poe.watch carries real
   numeric item ids; the poe.ninja exchange derives its id from the name
   itself, so an id that is not a number carries no continuity and is ignored
   here. Name similarity alone is not enough to act on — "Ritual Scarab of
   Wisps" and "Ritual Scarab of Abundance" share three of four tokens, so a
   sibling being added the same hour an old one is retired would pair with it
   and produce confidently wrong percentages. Similarity therefore only ever
   produces a *suspected* rename for a human to confirm. */

export const SUSPECT_MIN_SCORE = 0.5;

/** A stable id is one the source assigns, not one derived from the name. */
export function stableId(item) {
  const id = item?.id;
  if (typeof id === "number" && Number.isFinite(id)) return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  return null;
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

  const currById = new Map();
  for (const item of curr) {
    const id = stableId(item);
    if (id != null) currById.set(id, item);
  }

  const renamed = [];
  const renamedFrom = new Set();
  const renamedTo = new Set();
  for (const item of prev) {
    if (currNames.has(item.name)) continue;
    const id = stableId(item);
    if (id == null) continue;
    const match = currById.get(id);
    if (!match || prevNames.has(match.name) || match.name === item.name) continue;
    renamed.push({ from: item.name, to: match.name, id });
    renamedFrom.add(item.name);
    renamedTo.add(match.name);
  }

  const gone = [...prevNames].filter((name) => !currNames.has(name) && !renamedFrom.has(name));
  const fresh = [...currNames].filter((name) => !prevNames.has(name) && !renamedTo.has(name));
  const { pairs, usedFrom, usedTo } = pairBySimilarity(gone, fresh, minScore);

  return {
    added: fresh.filter((name) => !usedTo.has(name)).sort(),
    removed: gone.filter((name) => !usedFrom.has(name)).sort(),
    renamed: renamed.sort((a, b) => (a.from < b.from ? -1 : 1)),
    suspected: pairs.sort((a, b) => (a.from < b.from ? -1 : 1)),
    count: currNames.size,
  };
}

/** Rewrite accumulated self-history keys so an id-confirmed rename keeps its
    curve instead of restarting blank. Only ever called with `diff.renamed`:
    grafting a sibling's price curve onto the wrong item on the strength of a
    guess is worse than a day of empty percentages. An existing key for the new
    name wins, since that is real data for the name we are keeping. */
export function applyRenames(points, renames) {
  for (const { from, to } of renames || []) {
    for (const point of points || []) {
      const values = point?.values;
      if (values && values[from] != null && values[to] == null) {
        values[to] = values[from];
        delete values[from];
      }
    }
  }
  return points;
}

/** True when a diff contains nothing worth telling anyone about. */
export function isQuiet(diff) {
  return !diff.added.length && !diff.removed.length && !diff.renamed.length && !diff.suspected.length;
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
  return `${key}: ${diff.count} items, ${parts.join(", ")}`;
}
