/* poe.ninja normalization for PoE 1: turning one response row into one
   candidate observation, and nothing else.

   Pure by design. `fetch-data.mjs` takes a snapshot the moment it is imported,
   so anything that lives there cannot be reached by a test — and these are
   exactly the rules worth pinning, because the failures they cause are silent.
   Reading fragments from the wrong endpoint, losing the direction of the chaos
   calibration, or dropping the liquidity evidence behind a quote all produce
   numbers that look perfectly plausible.

   Endpoint shapes are documented at https://poe.ninja/docs/api and the accepted
   type lists live in ../endpoints.mjs. */

import { roundPrice } from "../../shared/dataset.mjs";

const SMALL_WORDS = new Set(["of", "the", "a", "and", "in"]);
export function slugToName(slug) {
  if (!slug || typeof slug !== "string") return null;
  const out = [];
  for (const [i, w] of slug.split("-").entries()) {
    // "the-maven-s-writ" -> "The Maven's Writ": a lone "s" is a possessive
    // that lost its apostrophe on the way into the slug.
    if (w === "s" && out.length) { out[out.length - 1] += "'s"; continue; }
    out.push((i > 0 && SMALL_WORDS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1));
  }
  return out.join(" ");
}


/* Slugs can't round-trip every name — "awakeners-orb" is really
   "Awakener's Orb" and no amount of guessing recovers that apostrophe. The
   stash currency overview does carry real names, so we borrow those as a
   dictionary and match on letters-and-digits only. Names only; its prices
   are not what we quote against. */
export const normKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");


export function isBaseVariant(type, l) {
  if (type === "SkillGem") {
    return !l.corrupted && (l.gemLevel ?? 1) <= 1 && (l.gemQuality ?? 0) === 0;
  }
  return !l.variant && !(l.links > 0);
}

export function exchangeNamesById(j) {
  const byId = {};
  for (const it of (j.core?.items || [])) {
    if (it.id != null) byId[it.id] = it.name;
    if (it.itemId != null) byId[it.itemId] = it.name;
  }
  return byId;
}

/* Compact evidence keys, matching the file's existing short-key convention
   (`c`, `lo`, `hi`, `n`). `prices.json` is downloaded by every browser every
   hour, so each field has to earn its bytes: these are the ones a consumer can
   act on — who said it, how much traded, how many listings stood behind it, and
   what item state was actually priced.

     sid  the source's own id for the row (source-scoped, not global)
     did  poe.ninja detailsId
     bt   base type, when it differs from the display name
     lc   listing count, summed over the rows behind the quote
     cnt  stack/row count where the feed supplies one
     vol  volume traded in the primary currency, converted to chaos
     mvc  the currency that carried most of that volume
     mvr  its rate
     cor  corrupted, lk links, gl gem level, gq gem quality — item state

   Icons and sparklines are deliberately NOT here: 5,000 icon URLs is half a
   megabyte in every page load. They live on the per-family snapshots, which
   hold ~125 items each. */
export function evidenceFrom(line, { divisor = 1 } = {}) {
  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const volume = number(line.volumePrimaryValue);
  const ev = {};
  const id = line.id ?? line.itemId;
  if (id != null) ev.sid = id;
  if (line.detailsId) ev.did = line.detailsId;
  if (line.baseType && line.baseType !== line.name) ev.bt = line.baseType;
  const listings = number(line.listingCount);
  if (listings) ev.lc = listings;
  const count = number(line.count);
  if (count) ev.cnt = count;
  if (volume) {
    ev.vol = roundPrice(volume / (divisor || 1)) ?? undefined;
    if (line.maxVolumeCurrency) ev.mvc = String(line.maxVolumeCurrency);
    const rate = number(line.maxVolumeRate);
    if (rate) ev.mvr = rate;
  }
  if (line.corrupted === true) ev.cor = 1;
  const links = number(line.links);
  if (links) ev.lk = links;
  const gemLevel = number(line.gemLevel);
  if (gemLevel) ev.gl = gemLevel;
  const gemQuality = number(line.gemQuality);
  if (gemQuality) ev.gq = gemQuality;
  return Object.keys(ev).length ? ev : null;
}

/* The stash currency overview is the only endpoint that publishes both sides of
   the book plus a per-name identity block. Both were being discarded, so a
   currency row could not say how deep either side was or which trade id it
   belonged to. */

export function currencyEvidence(line, detail = null) {
  const side = (block) => {
    const value = Number(block?.value);
    const listings = Number(block?.count ?? block?.listing_count);
    if (!Number.isFinite(value) || value <= 0) return null;
    return { v: roundPrice(value), ...(Number.isFinite(listings) && listings > 0 ? { n: listings } : {}) };
  };
  const pay = side(line?.pay);
  const receive = side(line?.receive);
  const ev = {
    ...(detail?.id != null ? { sid: detail.id } : {}),
    ...(line?.detailsId ? { did: line.detailsId } : {}),
    ...(detail?.tradeId ? { tid: detail.tradeId } : {}),
    ...(pay ? { pay } : {}),
    ...(receive ? { recv: receive } : {}),
  };
  return Object.keys(ev).length ? ev : null;
}

export function exchangeRows(j, dict = null, { divisor = 1 } = {}) {
  if (!j || !Array.isArray(j.lines)) return [];
  const byId = exchangeNamesById(j);
  return j.lines
    .map((l) => {
      const id = l.id ?? l.itemId;
      let name = byId[id] || l.name || slugToName(id);
      if (dict && name) name = dict[normKey(name)] || name;
      return { name, primaryValue: l.primaryValue ?? 0, evidence: evidenceFrom(l, { divisor }) };
    })
    .filter((r) => r.name && r.primaryValue > 0);
}


/* Divide every exchange primaryValue by this to get chaos. */
export function chaosDivisor(currencyJson) {
  if (!currencyJson) return null;
  const names = exchangeNamesById(currencyJson);
  const primaryName = names[currencyJson.core?.primary];
  if (primaryName && /^chaos orb$/i.test(primaryName)) return 1;
  const chaos = exchangeRows(currencyJson).find((r) => /^chaos orb$/i.test(r.name));
  if (chaos && chaos.primaryValue > 0) return chaos.primaryValue;
  return null;
}


export function changesFromSparkline(sp) {
  const data = ((sp && sp.data) || []).filter((v) => v != null);
  const last = data.length ? data[data.length - 1] : 0;
  const p24 = data.length > 1 ? data[data.length - 2] : last;
  const p48 = data.length > 2 ? data[data.length - 3] : p24;
  return { change24: last - p24, change48: last - p48 };
}

