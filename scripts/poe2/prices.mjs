function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeName(value) {
  return String(value || "").trim();
}

export function normalizeItemClass(value) {
  const text = normalizeName(value);
  if (!text) return null;
  const linked = [...text.matchAll(/\[[^\]|]+\|([^\]]+)]/g)].at(-1)?.[1];
  if (linked) return normalizeName(linked);
  const bracketed = [...text.matchAll(/\[([^\]]+)]/g)].at(-1)?.[1];
  return normalizeName(bracketed || text) || null;
}

function baseItemIndex(baseItems) {
  const byName = new Map();
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
    if (!existing || rank(metadata) > rank(existing)) byName.set(item.name, metadata);
  }
  return byName;
}

export function enrichPriceMetadata(prices, baseItems) {
  const byName = baseItemIndex(baseItems);
  for (const [name, entry] of Object.entries(prices || {})) {
    const metadata = baseItems?.[entry.itemId] || baseItems?.[entry.baseType];
    const matched = metadata ? {
      metadataPath: typeof entry.itemId === "string" && entry.itemId.startsWith("Metadata/") ? entry.itemId : null,
      itemClass: normalizeItemClass(metadata.item_class || metadata.itemClass),
      tags: Array.isArray(metadata.tags) ? metadata.tags : [],
      inheritsFrom: metadata.inherits_from || metadata.inheritsFrom || null,
    } : byName.get(entry.baseType) || byName.get(name);
    if (!matched) continue;
    if ((!entry.itemClass || /^(Fragments?|Currency|Weapon|Armour|Accessory)$/i.test(entry.itemClass)) && matched.itemClass) entry.itemClass = matched.itemClass;
    if ((!entry.tags || !entry.tags.length) && matched.tags.length) entry.tags = matched.tags;
    if (!entry.metadataPath && matched.metadataPath) entry.metadataPath = matched.metadataPath;
    if (!entry.inheritsFrom && matched.inheritsFrom) entry.inheritsFrom = matched.inheritsFrom;
  }
  return prices;
}

export function exchangeToPrices(payload, marketFamily = null) {
  const items = new Map([...(payload?.core?.items || []), ...(payload?.items || [])]
    .map((item) => [String(item.id), item]));
  const primary = String(payload?.core?.primary || "divine").toLowerCase();
  const rates = payload?.core?.rates || {};
  const divineExalted = primary === "divine"
    ? finite(rates.exalted)
    : finite(rates.divine) > 0 ? 1 / finite(rates.divine) : 0;
  const prices = {};

  for (const line of payload?.lines || []) {
    const item = items.get(String(line.id));
    const name = normalizeName(item?.name || line.name);
    const primaryValue = finite(line.primaryValue, NaN);
    if (!name || !Number.isFinite(primaryValue) || primaryValue <= 0 || divineExalted <= 0) continue;
    prices[name] = {
      exalted: primary === "divine" ? primaryValue * divineExalted : primaryValue,
      listingCount: finite(line.count || line.listingCount),
      source: "poe.ninja exchange",
      itemId: item?.id || line.id || null,
      type: item?.category || item?.type || null,
      itemClass: normalizeItemClass(item?.itemClass || item?.category || item?.type),
      marketFamily,
    };
  }
  return { prices, divineExalted };
}

export function stashToPrices(payload, fallbackType = null) {
  const primary = String(payload?.core?.primary || "exalted").toLowerCase();
  const primaryExalted = primary === "exalted" ? 1 : finite(payload?.core?.rates?.exalted);
  const prices = {};
  for (const line of payload?.lines || []) {
    const name = normalizeName(line.name || line.baseType);
    const primaryValue = finite(line.primaryValue, NaN);
    const exalted = primaryValue * primaryExalted;
    if (!name || !Number.isFinite(exalted) || exalted <= 0) continue;
    const candidate = {
      exalted,
      listingCount: finite(line.listingCount || line.count),
      source: "poe.ninja stash",
      itemId: line.id || line.detailsId || null,
      type: line.itemClass || line.category || line.type || fallbackType,
      itemClass: normalizeItemClass(line.itemClass || line.category || line.type),
      marketFamily: fallbackType,
      baseType: line.baseType || null,
      variant: line.variant || null,
    };
    const existing = prices[name];
    const tabletBaseline = fallbackType === "PrecursorTablets";
    const candidateIsNormal = String(candidate.variant).toLowerCase() === "normal";
    const existingIsNormal = String(existing?.variant).toLowerCase() === "normal";
    if (!existing
      || (tabletBaseline && candidateIsNormal && !existingIsNormal)
      || (tabletBaseline ? candidateIsNormal === existingIsNormal : true) && candidate.exalted < existing.exalted) {
      prices[name] = candidate;
    }
  }
  return prices;
}

export function scoutToPrices(payload) {
  const prices = {};
  for (const item of Array.isArray(payload) ? payload : []) {
    const name = normalizeName(item?.Name || item?.name || item?.Text || item?.text);
    const exalted = finite(item?.CurrentPrice ?? item?.currentPrice, NaN);
    if (!name || !Number.isFinite(exalted) || exalted <= 0) continue;
    const candidate = {
      exalted,
      listingCount: finite(item?.CurrentQuantity ?? item?.currentQuantity),
      source: "PoE2Scout",
      itemId: item?.Id || item?.id || item?.ItemId || item?.itemId || null,
      type: item?.CategoryApiId || item?.categoryApiId || item?.Type || item?.type || null,
      itemClass: normalizeItemClass(item?.ItemClass || item?.itemClass),
      marketFamily: item?.CategoryApiId || item?.categoryApiId || null,
    };
    const existing = prices[name];
    if (!existing || candidate.exalted < existing.exalted) prices[name] = candidate;
  }
  return prices;
}

export function mergePrices(target, incoming) {
  const rank = (entry) => entry?.source === "GGG completed trades" ? 4
    : entry?.source === "poe.ninja exchange" ? 3
      : entry?.source === "poe.ninja stash" ? 2
        : entry?.source === "PoE2Scout" ? 1 : 0;
  for (const [name, value] of Object.entries(incoming || {})) {
    const existing = target[name];
    if (!existing || rank(value) >= rank(existing)) {
      target[name] = {
        ...value,
        ...(value.itemId == null && existing?.itemId != null ? { itemId: existing.itemId } : {}),
        ...(value.type == null && existing?.type != null ? { type: existing.type } : {}),
        ...(value.baseType == null && existing?.baseType != null ? { baseType: existing.baseType } : {}),
        ...(value.variant == null && existing?.variant != null ? { variant: existing.variant } : {}),
        ...(value.itemClass == null && existing?.itemClass != null ? { itemClass: existing.itemClass } : {}),
        ...(!value.tags?.length && existing?.tags?.length ? { tags: existing.tags } : {}),
        ...(value.marketFamily == null && existing?.marketFamily != null ? { marketFamily: existing.marketFamily } : {}),
        ...(value.metadataPath == null && existing?.metadataPath != null ? { metadataPath: existing.metadataPath } : {}),
        ...(value.inheritsFrom == null && existing?.inheritsFrom != null ? { inheritsFrom: existing.inheritsFrom } : {}),
      };
    }
  }
  return target;
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
