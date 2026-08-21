import { bossDropKey } from "./bossData.js";

const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const norm = (value) => String(value || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

function variantMatch(entry, variant, allowBaseVariantPrice = false) {
  if (!variant) return true;
  if (allowBaseVariantPrice && !entry?.variant) return true;
  return norm(entry?.variant).includes(norm(variant));
}

export function makePriceResolver(priceMap = {}, overrides = {}) {
  const exact = priceMap || {};
  const loose = new Map(Object.entries(exact).map(([name, value]) => [norm(name), { name, value }]));

  return (lineOrName) => {
    const line = typeof lineOrName === "string" ? { item: lineOrName } : lineOrName;
    const item = line.item;
    const manual = finite(overrides[item], NaN);
    if (manual > 0) return { found: true, exalted: manual, manual: true, name: item, listingCount: null };

    const candidates = [item, ...(line.aliases || [])];
    let found = null;
    for (const name of candidates) {
      const direct = exact[name];
      if (direct && variantMatch(direct, line.variant, line.allowBaseVariantPrice)) { found = { name, value: direct }; break; }
      const fuzzy = loose.get(norm(name));
      if (fuzzy && variantMatch(fuzzy.value, line.variant, line.allowBaseVariantPrice)) { found = fuzzy; break; }
    }
    if (!found) return { found: false, exalted: 0, manual: false, name: item, listingCount: 0 };
    return {
      found: finite(found.value.exalted) > 0,
      exalted: Math.max(0, finite(found.value.exalted)),
      manual: false,
      name: found.name,
      listingCount: found.value.listingCount ?? null,
      source: found.value.source || null,
      icon: found.value.icon || null,
    };
  };
}

export function effectiveRate(boss, group, line, rateOverrides = {}) {
  const key = bossDropKey(boss.id, group.id, line);
  const override = finite(rateOverrides[key], NaN);
  return Math.max(0, Number.isFinite(override) ? override : finite(line.rate));
}

export function computeBoss(boss, resolve, { rateOverrides = {}, ttkSeconds = null } = {}) {
  const entryLines = (boss.entry || []).map((line) => {
    const price = resolve(line);
    const qty = Math.max(0, finite(line.qty, 1));
    return { ...line, qty, price, value: price.exalted * qty };
  });
  const entryUnknown = entryLines.some((line) => line.qty > 0 && !line.price.found);
  const entryCost = entryLines.reduce((sum, line) => sum + line.value, 0);

  const groups = (boss.groups || []).map((group) => {
    const rawRates = group.drops.map((line) => effectiveRate(boss, group, line, rateOverrides));
    const rateTotal = rawRates.reduce((sum, value) => sum + value, 0);
    const lines = group.drops.map((line, index) => {
      const rawRate = rawRates[index];
      const chance = group.kind === "pool" ? (rateTotal > 0 ? rawRate / rateTotal : 0)
        : group.kind === "fixed" ? 1 : rawRate;
      const quantity = group.kind === "fixed" ? rawRate : chance;
      const price = resolve(line);
      return {
        ...line,
        key: bossDropKey(boss.id, group.id, line),
        rawRate,
        chance,
        quantity,
        price,
        value: price.exalted * quantity,
      };
    });
    const missing = lines.filter((line) => !line.price.found && line.quantity > 0);
    return {
      ...group,
      rateTotal,
      normalized: group.kind === "pool" && Math.abs(rateTotal - 1) > .0001,
      lines,
      missing,
      subtotal: lines.reduce((sum, line) => sum + line.value, 0),
    };
  });

  const allLines = groups.flatMap((group) => group.lines);
  const missing = groups.flatMap((group) => group.missing);
  const gross = groups.reduce((sum, group) => sum + group.subtotal, 0);
  const net = entryUnknown ? null : gross - entryCost;
  const ttk = finite(ttkSeconds) > 0 ? finite(ttkSeconds) : null;
  return {
    boss,
    groups,
    allLines,
    entryLines,
    entryCost,
    entryUnknown,
    gross,
    net,
    ttkSeconds: ttk,
    profitPerHour: net != null && ttk ? net * 3600 / ttk : null,
    missing,
    estimatedCount: allLines.filter((line) => line.basis === "estimate").length,
    pricedCount: allLines.length - missing.length,
  };
}

export function computeBosses(bosses, priceMap, settings = {}) {
  const resolve = makePriceResolver(priceMap, settings.priceOverrides);
  const profile = (settings.ttkProfiles || []).find((candidate) => candidate.id === settings.activeTtkProfileId);
  return bosses.map((boss) => computeBoss(boss, resolve, {
    ...settings,
    ttkSeconds: profile?.times?.[boss.id],
  }));
}

export function summarizePriceCoverage(rows = []) {
  const targets = new Map();
  const add = (row, line, kind) => {
    const quantity = kind === "entry" ? line.qty : line.quantity;
    if (!(quantity > 0)) return;
    const variant = String(line.variant || "").trim();
    const key = `${norm(line.item)}|${norm(variant)}`;
    const current = targets.get(key) || {
      item: line.item,
      variant,
      kinds: new Set(),
      bosses: new Set(),
      found: false,
    };
    current.kinds.add(kind);
    current.bosses.add(row.boss.name);
    current.found ||= Boolean(line.price?.found);
    targets.set(key, current);
  };

  for (const row of rows) {
    for (const line of row.entryLines || []) add(row, line, "entry");
    for (const line of row.allLines || []) add(row, line, "drop");
  }

  const items = [...targets.values()].map((target) => ({
    ...target,
    kinds: [...target.kinds],
    bosses: [...target.bosses],
  })).sort((a, b) => a.item.localeCompare(b.item) || a.variant.localeCompare(b.variant));
  const missing = items.filter((item) => !item.found);
  return { total: items.length, priced: items.length - missing.length, missing };
}

export function sanitizeSettings(input = {}) {
  const cleanMap = (value, { max = Infinity } = {}) => {
    const out = {};
    for (const [key, raw] of Object.entries(value || {})) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) out[key] = Math.min(max, n);
    }
    return out;
  };
  const ttkProfiles = (Array.isArray(input.ttkProfiles) ? input.ttkProfiles : []).slice(0, 20).map((profile, index) => {
    const times = {};
    for (const [bossId, raw] of Object.entries(profile?.times || {})) {
      const seconds = Math.round(Number(raw));
      if (Number.isFinite(seconds) && seconds > 0) times[bossId] = Math.min(86400, seconds);
    }
    return {
      id: String(profile?.id || `profile-${index + 1}`).slice(0, 80),
      name: String(profile?.name || `TTK profile ${index + 1}`).trim().slice(0, 60) || `TTK profile ${index + 1}`,
      times,
    };
  }).filter((profile, index, all) => all.findIndex((candidate) => candidate.id === profile.id) === index);
  const activeTtkProfileId = ttkProfiles.some((profile) => profile.id === input.activeTtkProfileId)
    ? input.activeTtkProfileId : null;
  return {
    rateOverrides: cleanMap(input.rateOverrides, { max: 10 }),
    priceOverrides: cleanMap(input.priceOverrides, { max: 1e9 }),
    ttkProfiles,
    activeTtkProfileId,
  };
}

export function fmtPct(value) {
  if (!Number.isFinite(value)) return "—";
  const pct = value * 100;
  if (pct >= 10) return `${pct.toFixed(pct % 1 ? 1 : 0)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2)}%`;
}

export function fmtExalted(value) {
  const n = finite(value);
  if (Math.abs(n) >= 10000) return `${(n / 1000).toFixed(1)}k ex`;
  if (Math.abs(n) >= 100) return `${Math.round(n)} ex`;
  if (Math.abs(n) >= 10) return `${n.toFixed(1)} ex`;
  return `${n.toFixed(2)} ex`;
}

export function fmtDivine(value) {
  const n = finite(value);
  if (Math.abs(n) >= 100) return `${Math.round(n)} div`;
  if (Math.abs(n) >= 10) return `${n.toFixed(1)} div`;
  return `${n.toFixed(2)} div`;
}

export function fmtPrice(exalted, currency, divineExalted, chaosExalted = 0) {
  const rate = finite(divineExalted);
  const chaosRate = finite(chaosExalted);
  if (currency === "chaos" && chaosRate > 0) {
    const chaos = exalted / chaosRate;
    if (Math.abs(chaos) >= 100) return `${Math.round(chaos)} chaos`;
    if (Math.abs(chaos) >= 10) return `${chaos.toFixed(1)} chaos`;
    return `${chaos.toFixed(2)} chaos`;
  }
  const useDivine = currency === "divine" || (currency === "smart" && rate > 0 && Math.abs(exalted) >= rate * .5);
  return useDivine && rate > 0 ? fmtDivine(exalted / rate) : fmtExalted(exalted);
}
