// Reward pools reviewed against the PoE Wiki on 2026-11-22.
// Attribute means the passive replaced, not the tattoo's tribe.
export const KINGSMARCH_SOURCES = [
  "https://www.poewiki.net/wiki/Kingsmarch",
  "https://www.poewiki.net/wiki/List_of_tattoos",
  "https://www.poewiki.net/wiki/Runegraft",
];

const tattoos = (tribe, names) => names.map((name) => `Tattoo of the ${tribe} ${name}`);
const commonRunegrafts = ["Runegraft of the Fortress", "Runegraft of Gemcraft", "Runegraft of the Angler"];

export const KINGSMARCH_PORTS = [
  { id: "tattoo-str", port: "Ngakanu", kind: "tattoos", attribute: "STR", items: [
    ...tattoos("Kitava", ["Blood Drinker", "Rebel", "Shaman", "Warrior"]),
    ...tattoos("Ngamahu", ["Firewalker", "Shaman", "Warmonger", "Warrior", "Woodcarver"]),
    ...tattoos("Rongokurai", ["Brute", "Goliath", "Guard", "Warrior"]),
    ...tattoos("Tasalio", ["Bladedancer"]),
    ...tattoos("Tukohama", ["Brawler", "Shaman", "Warcaller", "Warmonger", "Warrior"]),
    ...tattoos("Valako", ["Shieldbearer"]), "Journey Tattoo of the Body",
  ] },
  { id: "tattoo-dex", port: "Te Onui", kind: "tattoos", attribute: "DEX", items: [
    ...tattoos("Arohongui", ["Moonwarden", "Scout", "Warrior"]),
    ...tattoos("Ramako", ["Archer", "Fleetfoot", "Scout", "Shaman", "Sniper"]),
    ...tattoos("Tasalio", ["Scout", "Tideshifter", "Warrior"]),
    ...tattoos("Tawhoa", ["Herbalist", "Naturalist", "Scout"]), "Journey Tattoo of the Mind",
  ] },
  { id: "tattoo-int", port: "Moti Aro", kind: "tattoos", attribute: "INT", items: [
    ...tattoos("Arohongui", ["Shaman", "Warmonger"]),
    ...tattoos("Hinekora", ["Deathwarden", "Shaman", "Storyteller", "Warmonger", "Warrior"]),
    ...tattoos("Kitava", ["Heart Eater"]), ...tattoos("Rongokurai", ["Turtle"]),
    ...tattoos("Tasalio", ["Shaman"]), ...tattoos("Tawhoa", ["Shaman", "Warrior"]),
    ...tattoos("Valako", ["Scout", "Shaman", "Stormrider", "Warrior"]), "Journey Tattoo of the Soul",
  ] },
  { id: "runegraft-dex", port: "Riben Fell", kind: "runegrafts", attribute: "DEX", items: [
    "Runegraft of the Sinistral", "Runegraft of the Bound", "Runegraft of Refraction",
    "Runegraft of the Imbued", "Runegraft of the Agile", "Runegraft of Suffering",
    "Runegraft of Quaffing", "Runegraft of Rotblood", ...commonRunegrafts,
  ] },
  { id: "runegraft-int", port: "Pondium", kind: "runegrafts", attribute: "INT", items: [
    "Runegraft of Connection", "Runegraft of Resurgence", "Runegraft of the Spellbound",
    "Runegraft of the Novamark", "Runegraft of the Witchmark", "Runegraft of Loyalty",
    "Runegraft of Treachery", "Runegraft of Time", "Runegraft of Blasphemy",
    "Runegraft of the Warp", ...commonRunegrafts,
  ] },
  { id: "runegraft-str", port: "Kalguur", kind: "runegrafts", attribute: "STR", items: [
    "Runegraft of the River", "Runegraft of the Combatant", "Runegraft of the Soulwick",
    "Runegraft of Restitching", "Runegraft of Bellows", "Runegraft of the Jeweller",
    "Runegraft of Stability", "Runegraft of Consecration", "Runegraft of Fury",
    "Runegraft of Rallying", ...commonRunegrafts,
  ] },
];

export const KINGSMARCH_ITEM_NAMES = [...new Set(KINGSMARCH_PORTS.flatMap((port) => port.items))];
