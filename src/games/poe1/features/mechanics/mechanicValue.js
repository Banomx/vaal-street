// Tracked reward baskets, not a drop table or assumed yield. Names match prices.json.
export const MECHANICS = [
  { id: "harvest", name: "Harvest", drops: ["Wild Crystallised Lifeforce", "Vivid Crystallised Lifeforce", "Primal Crystallised Lifeforce"] },
  { id: "expedition", name: "Expedition", drops: ["Exotic Coinage", "Burial Medallion", "Logbook (Black Scythe Mercenaries)"] },
  { id: "delirium", name: "Delirium", drops: ["Simulacrum Splinter", "Skittering Delirium Orb", "Diviner's Delirium Orb"] },
  { id: "blight", name: "Blight", drops: ["Golden Oil", "Silver Oil", "Opalescent Oil"] },
  { id: "essence", name: "Essence", drops: ["Essence of Horror", "Essence of Delirium", "Deafening Essence of Loathing"] },
  { id: "ritual", name: "Ritual", drops: ["Ritual Vessel", "Omen of Fortune", "Omen of Connections"] },
  { id: "legion", name: "Legion", drops: ["Timeless Maraketh Emblem", "Timeless Templar Emblem", "Timeless Eternal Emblem"] },
  { id: "delve", name: "Delve", drops: ["Fractured Fossil", "Glyphic Fossil", "Hollow Fossil"] },
];

const DAY_MS = 86400e3;
const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
function input(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function valueMechanic(mechanic, snapshot, sample = {}) {
  const snapshotAt = Date.parse(snapshot?.generatedAt);
  const digestAt = Date.parse(snapshot?.gggHour);
  const drops = mechanic.drops.map((name) => {
    const quote = snapshot?.prices?.[name];
    const tradeAt = Date.parse(quote?.marketHour);
    const carried = quote?.stale === true || positive(quote?.staleHours) || (Number.isFinite(snapshotAt) && Number.isFinite(tradeAt) && snapshotAt - tradeAt > DAY_MS);
    const price = positive(quote?.c) ? quote.c : null;
    const flow = !carried && price !== null && quote?.exchangeSource === "GGG"
      && Number.isFinite(digestAt) && tradeAt === digestAt && positive(quote.volume1H)
      ? price * quote.volume1H : null;
    return { name, price, carried, flow: positive(flow) ? flow : null, quantity: input(sample.counts?.[name]) };
  });
  const quoted = drops.filter((drop) => drop.price !== null).length;
  const flows = drops.filter((drop) => drop.flow !== null);
  const runs = input(sample.runs);
  const minutes = input(sample.minutes);
  const cost = input(sample.cost);
  const complete = !!snapshot?.prices && Number.isSafeInteger(runs) && runs > 0 && minutes > 0 && cost !== null
    && drops.every((drop) => Number.isSafeInteger(drop.quantity) && (drop.quantity === 0 || (drop.price !== null && !drop.carried)));
  const gross = complete ? drops.reduce((total, drop) => total + (drop.quantity === 0 ? 0 : drop.quantity * drop.price), 0) : null;
  const net = complete ? gross - cost : null;
  const netPerHour = complete && Number.isFinite(net * 60 / minutes) ? net * 60 / minutes : null;
  return {
    ...mechanic, drops, quoted, runs, minutes, cost,
    flow: flows.length ? flows.reduce((total, drop) => total + drop.flow, 0) : null,
    flowCoverage: flows.length, netPerHour,
    netPerRun: netPerHour !== null ? net / runs : null,
  };
}

export function rankMechanics(rows, key) {
  return [...rows].sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity) || a.name.localeCompare(b.name));
}
