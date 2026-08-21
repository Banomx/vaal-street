function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeName(value) {
  return String(value || "").trim();
}

/* Rows that are not items. PoE2Scout has shipped a literal `INCOMPLETE` row,
   and a bare number or an empty name is the same class of thing: upstream
   filler that would put a fictional market on the page and, worse, accumulate
   its own price history. Rejected at parse time and counted, so a feed that
   starts emitting them is visible rather than silently priced. */
export const PLACEHOLDER_NAMES = [/^incomplete$/i, /^unknown$/i, /^n\/?a$/i, /^null$/i, /^undefined$/i, /^-+$/, /^\d+$/];

export function isPlaceholderName(value) {
  const text = normalizeName(value);
  return !text || PLACEHOLDER_NAMES.some((pattern) => pattern.test(text));
}

/* Every parser reports what it threw away and why, so `rejected` counts can
   reach the quality manifest instead of dying in a local variable. */
/* poe.ninja spells it `sparkLine` on stash rows and `sparkline` on exchange
   rows. Stored rounded and only when it carries at least two usable points —
   one point is not a trend and the array costs bytes in every browser's
   hourly download. */
export function sparkline(line) {
  const raw = (line?.sparkline || line?.sparkLine || {}).data;
  if (!Array.isArray(raw)) return null;
  const data = raw.filter((value) => value != null && Number.isFinite(Number(value)))
    .map((value) => Math.round(Number(value) * 10) / 10);
  return data.length >= 2 ? data : null;
}

function rejectionLog() {
  const reasons = {};
  return {
    reasons,
    reject(reason) { reasons[reason] = (reasons[reason] || 0) + 1; },
    get total() { return Object.values(reasons).reduce((sum, count) => sum + count, 0); },
  };
}

export function normalizeItemClass(value) {
  const text = normalizeName(value);
  if (!text) return null;
  const linked = [...text.matchAll(/\[[^\]|]+\|([^\]]+)]/g)].at(-1)?.[1];
  if (linked) return normalizeName(linked);
  const bracketed = [...text.matchAll(/\[([^\]]+)]/g)].at(-1)?.[1];
  return normalizeName(bracketed || text) || null;
}

/* Name -> metadata, plus the names that are ambiguous.

   Several Metadata paths can share a display name, so a name match is a weaker
   identity than a path match and has to be reported as such. Quest and hidden
   variants lose to the real item; anything still tied is recorded as ambiguous
   and used only as a last resort, with its confidence stated. */
function baseItemIndex(baseItems) {
  const byName = new Map();
  const ambiguous = new Set();
  for (const [id, item] of Object.entries(baseItems || {})) {
    if (!item?.name) continue;
    const metadata = {
      metadataPath: id,
      itemClass: normalizeItemClass(item.item_class || item.itemClass),
      tags: Array.isArray(item.tags) ? item.tags : [],
      inheritsFrom: item.inherits_from || item.inheritsFrom || null,
    };
    const existing = byName.get(item.name);
    const rank = (value) => value?.itemClass === "QuestItem" ? 0 : value?.itemClass === "HiddenItem" ? 1 : 2;
    if (!existing) { byName.set(item.name, metadata); continue; }
    if (rank(metadata) > rank(existing)) { byName.set(item.name, metadata); continue; }
    if (rank(metadata) === rank(existing)) ambiguous.add(item.name);
  }
  return { byName, ambiguous };
}

/* Enrich every entry the run selected, not only the ones a particular source
   happened to identify by path. Match by Metadata path first — that is the
   strong identity — and fall back to display name only as a reported,
   lower-confidence match. The counts are what make coverage measurable instead
   of assumed. */
export function enrichPriceMetadata(prices, baseItems) {
  const { byName, ambiguous } = baseItemIndex(baseItems);
  const coverage = { total: 0, byPath: 0, byName: 0, ambiguous: 0, unmatched: 0, ambiguousNames: [], unmatchedNames: [] };
  for (const [name, entry] of Object.entries(prices || {})) {
    coverage.total += 1;
    const direct = baseItems?.[entry.itemId] || baseItems?.[entry.metadataPath] || baseItems?.[entry.baseType];
    let matched = null;
    let confidence = null;
    if (direct) {
      matched = {
        metadataPath: typeof entry.itemId === "string" && entry.itemId.startsWith("Metadata/") ? entry.itemId
          : typeof entry.metadataPath === "string" ? entry.metadataPath : null,
        itemClass: normalizeItemClass(direct.item_class || direct.itemClass),
        tags: Array.isArray(direct.tags) ? direct.tags : [],
        inheritsFrom: direct.inherits_from || direct.inheritsFrom || null,
      };
      confidence = "metadata-path";
      coverage.byPath += 1;
    } else {
      matched = byName.get(entry.baseType) || byName.get(name) || null;
      if (matched) {
        const key = byName.has(entry.baseType) ? entry.baseType : name;
        confidence = ambiguous.has(key) ? "name-ambiguous" : "name";
        if (confidence === "name-ambiguous") {
          coverage.ambiguous += 1;
          if (coverage.ambiguousNames.length < 40) coverage.ambiguousNames.push(name);
        } else coverage.byName += 1;
      }
    }
    if (!matched) {
      coverage.unmatched += 1;
      if (coverage.unmatchedNames.length < 40) coverage.unmatchedNames.push(name);
      continue;
    }
    if ((!entry.itemClass || /^(Fragments?|Currency|Weapon|Armour|Accessory)$/i.test(entry.itemClass)) && matched.itemClass) entry.itemClass = matched.itemClass;
    if ((!entry.tags || !entry.tags.length) && matched.tags.length) entry.tags = matched.tags;
    if (!entry.metadataPath && matched.metadataPath) entry.metadataPath = matched.metadataPath;
    if (!entry.inheritsFrom && matched.inheritsFrom) entry.inheritsFrom = matched.inheritsFrom;
    if (confidence && !entry.identityConfidence) entry.identityConfidence = confidence;
  }
  return coverage;
}

export function exchangeToPrices(payload, marketFamily = null) {
  const items = new Map([...(payload?.core?.items || []), ...(payload?.items || [])]
    .map((item) => [String(item.id), item]));
  const primary = String(payload?.core?.primary || "divine").toLowerCase();
  const primaryCurrency = payload?.core?.primary ? String(payload.core.primary) : null;
  const rates = payload?.core?.rates || {};
  const divineExalted = primary === "divine"
    ? finite(rates.exalted)
    : finite(rates.divine) > 0 ? 1 / finite(rates.divine) : 0;
  const prices = {};
  const rejected = rejectionLog();
  let rawRows = 0;

  for (const line of payload?.lines || []) {
    rawRows += 1;
    const item = items.get(String(line.id));
    const name = normalizeName(item?.name || line.name);
    const primaryValue = finite(line.primaryValue, NaN);
    if (isPlaceholderName(name)) { rejected.reject("placeholder_name"); continue; }
    if (!Number.isFinite(primaryValue) || primaryValue <= 0) { rejected.reject("invalid_price"); continue; }
    if (divineExalted <= 0) { rejected.reject("no_conversion_rate"); continue; }
    const toExalted = primary === "divine" ? divineExalted : 1;
    /* Liquidity evidence, kept rather than discarded. `volumePrimaryValue` is
       what actually changed hands, and `maxVolumeCurrency`/`maxVolumeRate` name
       the pair that carried most of it — which is the difference between a
       price backed by a real market and one backed by a single quote. Without
       these an exchange entry says nothing about whether it can be filled. */
    const volume = finite(line.volumePrimaryValue, NaN);
    const maxVolumeRate = finite(line.maxVolumeRate, NaN);
    const spark = sparkline(line);
    prices[name] = {
      exalted: primaryValue * toExalted,
      listingCount: finite(line.count || line.listingCount),
      source: "poe.ninja exchange",
      itemId: item?.id || line.id || null,
      sourceId: line.id ?? item?.id ?? null,
      type: item?.category || item?.type || null,
      itemClass: normalizeItemClass(item?.itemClass || item?.category || item?.type),
      marketFamily,
      ...(Number.isFinite(volume) && volume > 0 ? { volumeExalted: volume * toExalted } : {}),
      ...(line.maxVolumeCurrency ? { maxVolumeCurrency: String(line.maxVolumeCurrency) } : {}),
      ...(Number.isFinite(maxVolumeRate) && maxVolumeRate > 0 ? { maxVolumeRate } : {}),
      ...(spark ? { sparkline: spark } : {}),
      ...(primaryCurrency ? { quotedIn: primaryCurrency } : {}),
    };
  }
  return { prices, divineExalted, rawRows, accepted: Object.keys(prices).length, rejected: rejected.total, rejectedReasons: rejected.reasons };
}

/* Item-state identity for PoE 2 stash rows.

   Two quotes describe the same item only when the state a buyer receives is the
   same. Variant, corruption and level requirement are the parts of that state
   the feed exposes, so they form the key; anything else about a row (listing
   count, icon) describes the listing rather than the item.

   Returns null when a row carries no state at all, which is the ordinary case
   for currency and fragments — there is only one of those. */
export function itemStateKey(entry) {
  const parts = [
    String(entry?.variant || "").trim().toLowerCase(),
    entry?.corrupted === true ? "corrupted" : "",
    entry?.levelRequired ? `ilvl${entry.levelRequired}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("|") : null;
}

export function stashToPrices(payload, fallbackType = null) {
  const primary = String(payload?.core?.primary || "exalted").toLowerCase();
  const primaryExalted = primary === "exalted" ? 1 : finite(payload?.core?.rates?.exalted);
  const prices = {};
  const rejected = rejectionLog();
  let rawRows = 0;
  for (const line of payload?.lines || []) {
    rawRows += 1;
    const name = normalizeName(line.name || line.baseType);
    const primaryValue = finite(line.primaryValue, NaN);
    const exalted = primaryValue * primaryExalted;
    if (isPlaceholderName(name)) { rejected.reject("placeholder_name"); continue; }
    if (!Number.isFinite(exalted) || exalted <= 0) { rejected.reject("invalid_price"); continue; }
    /* Item state travels with the price. A price without its variant,
       corruption or level requirement cannot be compared with another quote for
       "the same" item, because they may not be the same item at all. */
    const spark = sparkline(line);
    const candidate = {
      exalted,
      listingCount: finite(line.listingCount || line.count),
      source: "poe.ninja stash",
      itemId: line.itemId ?? line.id ?? line.detailsId ?? null,
      sourceId: line.id ?? null,
      detailsId: line.detailsId || null,
      type: line.itemClass || line.category || line.type || fallbackType,
      itemClass: normalizeItemClass(line.itemClass || line.category || line.type),
      marketFamily: fallbackType,
      baseType: line.baseType || null,
      variant: line.variant || null,
      ...(line.category ? { sourceCategory: String(line.category) } : {}),
      ...(line.corrupted === true ? { corrupted: true } : {}),
      ...(Number.isFinite(Number(line.levelRequired)) && Number(line.levelRequired) > 0 ? { levelRequired: Number(line.levelRequired) } : {}),
      ...(line.icon ? { icon: String(line.icon) } : {}),
      ...(spark ? { sparkline: spark } : {}),
    };
    const existing = prices[name];
    const tabletBaseline = fallbackType === "PrecursorTablets";
    const candidateIsNormal = String(candidate.variant).toLowerCase() === "normal";
    const existingIsNormal = String(existing?.variant).toLowerCase() === "normal";
    /* A corrupted copy is a different item, not a cheaper one: it cannot be
       modified further and its price says so. Letting it win the headline is
       how "the cheapest quote" quietly becomes "a quote for something else". */
    const candidateCorrupt = candidate.corrupted === true;
    const existingCorrupt = existing?.corrupted === true;
    const wins = !existing
      || (tabletBaseline && candidateIsNormal && !existingIsNormal)
      || (!candidateCorrupt && existingCorrupt)
      || (candidateCorrupt === existingCorrupt
        && (tabletBaseline ? candidateIsNormal === existingIsNormal : true)
        && candidate.exalted < existing.exalted);
    const variants = { ...(existing?.variants || {}) };
    const key = itemStateKey(candidate);
    if (key) {
      const held = variants[key];
      if (!held || candidate.exalted < held.exalted) {
        variants[key] = {
          exalted: candidate.exalted,
          ...(candidate.listingCount ? { listingCount: candidate.listingCount } : {}),
          ...(candidate.corrupted ? { corrupted: true } : {}),
          ...(candidate.levelRequired ? { levelRequired: candidate.levelRequired } : {}),
        };
      }
    }
    // Accumulated on every row; single-state entries are trimmed after the loop,
    // because dropping it here would lose the previous row's state.
    prices[name] = { ...(wins ? candidate : existing), variants };
  }
  /* One state is just the headline under another name; two or more is a real
     choice a consumer may need to make, so only the latter is published. */
  for (const entry of Object.values(prices)) {
    if (Object.keys(entry.variants || {}).length <= 1) delete entry.variants;
  }
  Object.defineProperty(prices, "__parse", {
    value: { rawRows, accepted: Object.keys(prices).length, rejected: rejected.total, rejectedReasons: rejected.reasons },
    enumerable: false,
  });
  return prices;
}

export function scoutToPrices(payload) {
  const prices = {};
  const rejected = rejectionLog();
  let rawRows = 0;
  for (const item of Array.isArray(payload) ? payload : []) {
    rawRows += 1;
    const name = normalizeName(item?.Name || item?.name || item?.Text || item?.text);
    const exalted = finite(item?.CurrentPrice ?? item?.currentPrice, NaN);
    /* Scout is gap-fill, so it gets the strictest reading of a row: a name that
       is not an item, or a price that is not a number, is dropped rather than
       carried in the hope that something downstream notices. */
    if (isPlaceholderName(name)) { rejected.reject("placeholder_name"); continue; }
    if (!Number.isFinite(exalted) || exalted <= 0) { rejected.reject("invalid_price"); continue; }
    const observedAt = item?.LastUpdated || item?.lastUpdated || item?.UpdatedAt || item?.updatedAt || null;
    const candidate = {
      exalted,
      listingCount: finite(item?.CurrentQuantity ?? item?.currentQuantity),
      source: "PoE2Scout",
      itemId: item?.Id || item?.id || item?.ItemId || item?.itemId || null,
      type: item?.CategoryApiId || item?.categoryApiId || item?.Type || item?.type || null,
      itemClass: normalizeItemClass(item?.ItemClass || item?.itemClass),
      marketFamily: item?.CategoryApiId || item?.categoryApiId || null,
      ...(observedAt ? { observedAt: String(observedAt) } : {}),
      ...(item?.LowConfidence === true || item?.lowConfidence === true ? { thin: true } : {}),
    };
    const existing = prices[name];
    if (!existing || candidate.exalted < existing.exalted) prices[name] = candidate;
  }
  Object.defineProperty(prices, "__parse", {
    value: { rawRows, accepted: Object.keys(prices).length, rejected: rejected.total, rejectedReasons: rejected.reasons },
    enumerable: false,
  });
  return prices;
}

/* Precedence, then evidence.

   The winner's own quote is what the site shows — `exalted`, `source` and the
   liquidity figures that belong to that observation. Everything descriptive the
   loser knew and the winner does not is carried across, because item identity
   and item state are properties of the item rather than of whichever feed
   happened to price it this hour.

   The carried set is derived rather than listed, so a new evidence field added
   to a parser is preserved automatically instead of being silently dropped the
   first time a better-ranked source wins the name. */
const QUOTE_FIELDS = new Set([
  "exalted", "source", "listingCount", "volumeExalted", "volume1H",
  "maxVolumeCurrency", "maxVolumeRate", "sparkline", "quotedIn", "marketHour",
  "low", "high", "lowStock", "highStock", "thin", "observedAt",
]);

export function mergePrices(target, incoming) {
  const rank = (entry) => entry?.source === "GGG completed trades" ? 4
    : entry?.source === "poe.ninja exchange" ? 3
      : entry?.source === "poe.ninja stash" ? 2
        : entry?.source === "PoE2Scout" ? 1 : 0;
  for (const [name, value] of Object.entries(incoming || {})) {
    const existing = target[name];
    if (existing && rank(value) < rank(existing)) continue;
    const merged = { ...value };
    for (const [key, previous] of Object.entries(existing || {})) {
      if (QUOTE_FIELDS.has(key)) continue;
      const own = merged[key];
      const empty = own == null || (Array.isArray(own) && !own.length);
      if (empty && previous != null) merged[key] = previous;
    }
    target[name] = merged;
  }
  return target;
}

/* The credit line has to be derived from what actually answered. A constant
   string is a claim the data does not back, and it is exactly the kind of claim
   nobody notices is wrong. */
const SOURCE_LABELS = [
  ["GGG completed trades", "GGG completed trades"],
  ["poe.ninja exchange", "poe.ninja"],
  ["poe.ninja stash", "poe.ninja"],
  ["PoE2Scout", "PoE2Scout gap-fill"],
];

export function describePriceSources(prices) {
  const used = new Set(Object.values(prices || {}).map((entry) => entry?.source).filter(Boolean));
  const labels = [];
  for (const [source, label] of SOURCE_LABELS) {
    if (used.has(source) && !labels.includes(label)) labels.push(label);
  }
  if (!labels.length) return "no source answered";
  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")}, then ${labels.at(-1)}`;
}

export function slugifyLeague(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function selectTrackedLeagues(leagues, limit = 2) {
  const names = (leagues || []).map((league) => typeof league === "string" ? league : league?.name).filter(Boolean);
  const standard = names.find((name) => name.toLowerCase() === "standard");
  const challenge = names.find((name) => !/hardcore|standard/i.test(name));
  return [...new Set([challenge, standard, ...names].filter(Boolean))].slice(0, limit);
}
