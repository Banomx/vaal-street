export const MARKET_CATEGORIES = [
  ["all", "All items"], ["currency", "Currency"], ["crafting", "Crafting materials"], ["gems", "Gems"],
  ["equipment", "Unique gear"], ["jewels", "Jewels & relics"], ["maps", "Maps & tablets"],
  ["fragments", "Fragments & keys"], ["league", "League items"], ["other", "Other"],
];

export const MARKET_SUBCATEGORIES = {
  currency: [["orbs", "Orbs"], ["shards", "Shards"], ["quality", "Quality currency"], ["other", "Other currency"]],
  crafting: [["essences", "Essences"], ["runes", "Runes"], ["catalysts", "Catalysts"], ["soul-cores", "Soul Cores"], ["delirium", "Delirium liquids"], ["infusers", "Infusers"], ["metals", "Metals, ores & flux"], ["other", "Other crafting"]],
  gems: [["uncut", "Uncut gems"], ["lineage", "Lineage supports"]],
  equipment: [
    ["weapons", "Weapons"], ["body-armour", "Body armour"], ["helmets", "Helmets"], ["gloves", "Gloves"], ["boots", "Boots"],
    ["offhands", "Shields & offhands"], ["rings", "Rings"], ["amulets", "Amulets"], ["belts", "Belts"],
    ["flasks", "Flasks"], ["charms", "Charms"], ["other", "Other unique gear"],
  ],
  jewels: [["jewels", "Jewels"], ["relics", "Sanctum relics"]],
  maps: [["maps", "Maps"], ["tablets", "Tablets"]],
  fragments: [["splinters", "Splinters"], ["reliquary", "Reliquary keys"], ["encounter", "Encounter keys"], ["fates", "Fates & invitations"], ["fragments", "Fragments"]],
  league: [
    ["omens", "Omens"], ["ritual", "Ritual"], ["breach", "Breach"], ["abyss", "Abyss"],
    ["expedition", "Expedition"], ["incursion", "Incursion"], ["vaal", "Vaal"],
    ["ultimatum", "Ultimatum"], ["idols", "Idols"], ["other", "Other league items"],
  ],
};

const compact = (value) => String(value || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const metadata = (entry) => compact([
  entry.itemClass, entry.type, entry.marketFamily,
  ...(Array.isArray(entry.tags) ? entry.tags : []),
].filter(Boolean).join(" "));
const structuralMetadata = (entry) => compact([metadata(entry), entry.metadataPath, entry.inheritsFrom].filter(Boolean).join(" "));

const WEAPON = /\b(claw|dagger|flail|bow|crossbow|mace|sword|axe|spear|staff|warstaff|wand|sceptre|fishing rod|weapon)\b/;
const ARMOUR = /\b(body armour|helmet|gloves|boots|shield|buckler|focus|quiver|armour|armor)\b/;
const ACCESSORY = /\b(ring|amulet|belt|talisman|accessor)/;
const FLASK_CHARM = /\b(life flask|mana flask|utility flask|flask|charm)\b/;
const EQUIPMENT_FAMILY = /\b(unique ?weapons|unique ?armours|unique ?accessories|unique ?flasks|unique ?charms)\b/;
const JEWEL_RELIC = /\b(unique ?jewels|unique ?sanctum ?relics|jewel|relic|sanctum special relic)\b/;
const MAP_TABLET = /\b(unique ?tablets|precursor ?tablets|map|tower augmentation|tablet)\b/;
const GEM = /\b(active skill gem|support skill gem|meta skill gem|uncut ?skill ?gems?|uncut ?support ?gems?|uncut ?reservation ?gems?|lineage ?support ?gems?)\b/;
const FRAGMENT_KEY = /\b(map fragment|unique fragment|vault ?keys?|pinnacle ?keys?|ultimatum ?keys?|breachstone|fragments?|key)\b/;
const CRAFTING = /\b(essence|rune|catalyst|soul ?core|delirium|infuser|alloy|ore|flux|verisium)\b/;
const LEAGUE = /\b(abyss|breach|expedition|idol|incursion|ritual|ultimatum|vaal|omen)\b/;

export function marketCategory(name, entry = {}) {
  const fields = metadata(entry);
  const itemName = compact(name);
  if (GEM.test(fields) || /^(uncut (skill|spirit|support) gem)\b/.test(itemName)) return "gems";
  if (EQUIPMENT_FAMILY.test(fields) || WEAPON.test(fields) || ARMOUR.test(fields) || ACCESSORY.test(fields) || FLASK_CHARM.test(fields)) return "equipment";
  if (/\bidol\b/.test(itemName)) return "league";
  if (FRAGMENT_KEY.test(fields) || /\b(fragment|splinter|key|breachstone|fate|invitation|audience|simulacrum)\b/.test(itemName)) return "fragments";
  if (MAP_TABLET.test(fields)) return "maps";
  // Specific crafting identity must beat broad structural tags such as
  // `jewel_catalyst`, which GGG uses for refined catalysts.
  if (CRAFTING.test(fields) || /\b(essence|rune|catalyst|infuser|soul core|liquid|alloy|ore|flux|verisium)\b/.test(itemName)) return "crafting";
  if (JEWEL_RELIC.test(fields)) return "jewels";
  if (LEAGUE.test(fields) || /\b(omen|idol|logbook|artifact|jawbone|rib|collarbone|cranium|petition|saga)\b/.test(itemName)) return "league";
  if (/\b(stackable currency|currency exchange|currency)\b/.test(fields) || /\b(orb|shard|scroll|scrap|whetstone|etcher|bauble|prism)\b/.test(itemName)) return "currency";
  return "other";
}

export function marketSubcategory(category, name, entry = {}) {
  const fields = metadata(entry);
  const itemName = compact(name);
  const combined = `${fields} ${itemName}`;
  const structural = structuralMetadata(entry);
  if (category === "currency") {
    if (/\bshard\b/.test(itemName)) return "shards";
    if (/\b(quality currency|scrap|whetstone|etcher|bauble|prism)\b/.test(combined)) return "quality";
    if (/\borb\b/.test(itemName)) return "orbs";
  }
  if (category === "crafting") {
    if (/\bcatalyst/.test(combined)) return "catalysts";
    if (/\bessence/.test(combined)) return "essences";
    if (/\brune/.test(combined)) return "runes";
    if (/\bsoul ?core/.test(combined)) return "soul-cores";
    if (/\binfuser/.test(itemName)) return "infusers";
    if (/\b(alloy|ore|flux|verisium)\b/.test(`${structural} ${itemName}`)) return "metals";
    if (/\b(delirium|mushrune|liquid)\b/.test(`${structural} ${itemName}`)) return "delirium";
  }
  if (category === "gems") return /\buncut\b/.test(combined) ? "uncut" : "lineage";
  if (category === "equipment") {
    if (WEAPON.test(fields)) return "weapons";
    if (/\bbody armour\b/.test(fields)) return "body-armour";
    if (/\bhelmet\b/.test(fields)) return "helmets";
    if (/\bgloves\b/.test(fields)) return "gloves";
    if (/\bboots\b/.test(fields)) return "boots";
    if (/\b(shield|buckler|focus|quiver)\b/.test(fields)) return "offhands";
    if (/\bring\b/.test(fields)) return "rings";
    if (/\b(amulet|talisman)\b/.test(fields)) return "amulets";
    if (/\bbelt\b/.test(fields)) return "belts";
    if (/\bflask\b/.test(fields)) return "flasks";
    if (/\bcharm\b/.test(fields)) return "charms";
  }
  if (category === "jewels") return /\b(relic|sanctum)\b/.test(fields) ? "relics" : "jewels";
  if (category === "maps") return /\b(tablet|tower augmentation)\b/.test(combined) ? "tablets" : "maps";
  if (category === "fragments") {
    if (/\bsplinter\b/.test(itemName)) return "splinters";
    if (/\breliquary key\b/.test(itemName)) return "reliquary";
    if (/\bfragment\b/.test(itemName)) return "fragments";
    if (/\b(fate|invitation|audience)\b/.test(itemName)) return "fates";
    if (/\b(vault ?keys?|pinnacle ?keys?|ultimatum ?keys?|key)\b/.test(`${structural} ${itemName}`)) return "encounter";
    if (/\b(fragments?|unique fragment)\b/.test(combined)) return "fragments";
    return "fragments";
  }
  if (category === "league") {
    if (/\bidol\b/.test(combined)) return "idols";
    if (/\bomen\b/.test(combined)) return "omens";
    if (/\babyss(?:al)?\b/.test(structural)) return "abyss";
    if (/\bbreach\b/.test(structural)) return "breach";
    if (/\bexpedition\b/.test(structural)) return "expedition";
    if (/\bincursion\b/.test(structural)) return "incursion";
    if (/\britual\b/.test(structural)) return "ritual";
    if (/\bultimatum\b/.test(structural)) return "ultimatum";
    if (/\bvaal\b/.test(structural)) return "vaal";
  }
  return "other";
}

export function groupMarkets(names, prices = {}) {
  const groups = Object.fromEntries(MARKET_CATEGORIES.map(([id]) => [id, []]));
  groups.subgroups = Object.fromEntries(Object.entries(MARKET_SUBCATEGORIES).map(([category, definitions]) => [category, Object.fromEntries(definitions.map(([id]) => [id, []]))]));
  for (const name of names) {
    const category = marketCategory(name, prices[name]);
    groups.all.push(name);
    groups[category].push(name);
    if (groups.subgroups[category]) groups.subgroups[category][marketSubcategory(category, name, prices[name])].push(name);
  }
  return groups;
}
