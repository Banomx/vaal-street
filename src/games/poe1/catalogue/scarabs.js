/* ================================================================
   SCARAB CATALOGUE
   ----------------------------------------------------------------
   Pure data, no React, so scripts/tests/poe1/test-catalogue.mjs can check it.

   Nothing here decides what the site shows — prices come from the
   feeds and groupForName() falls back to a regex, so a scarab GGG
   adds tomorrow still lands in the right mechanic without a code
   change. What this list is for: demo mode builds from it, and it
   pins the mechanic for the handful of names a regex would guess
   wrong.
   ================================================================ */

/* The 118 scarabs that currently drop, checked against poedb's Scarab item
   class — generated from the game files, where the wiki lags a league behind. */
export const GROUPS = {
  Breach: ["Breach Scarab of the Hive", "Breach Scarab of Instability", "Breach Scarab of the Marshal", "Breach Scarab of the Incensed Swarm", "Breach Scarab of Resonant Cascade"],
  Kalguuran: ["Kalguuran Scarab", "Kalguuran Scarab of Guarded Riches", "Kalguuran Scarab of Refinement", "Kalguuran Scarab of Enriching"],
  Cartography: ["Cartography Scarab of Escalation", "Cartography Scarab of Risk", "Cartography Scarab of the Multitude", "Cartography Scarab of Corruption"],
  Titanic: ["Titanic Scarab", "Titanic Scarab of Treasures", "Titanic Scarab of Legend"],
  Bestiary: ["Bestiary Scarab", "Bestiary Scarab of Duplicating", "Bestiary Scarab of the Herd"],
  Influence: ["Influencing Scarab of the Shaper", "Influencing Scarab of the Elder", "Influencing Scarab of Interference", "Influencing Scarab of Hordes"],
  Sulphite: ["Sulphite Scarab", "Sulphite Scarab of Fumes"],
  Divination: ["Divination Scarab of The Cloister", "Divination Scarab of Pilfering", "Divination Scarab of Plenty"],
  Torment: ["Torment Scarab", "Torment Scarab of Peculiarity", "Torment Scarab of Possession"],
  Ambush: ["Ambush Scarab", "Ambush Scarab of Hidden Compartments", "Ambush Scarab of Potency", "Ambush Scarab of Containment", "Ambush Scarab of Discernment"],
  Expedition: ["Expedition Scarab", "Expedition Scarab of Runefinding", "Expedition Scarab of Verisium Powder", "Expedition Scarab of Archaeology", "Expedition Scarab of Infusion"],
  Legion: ["Legion Scarab", "Legion Scarab of Officers", "Legion Scarab of Treasures", "Legion Scarab of Eternal Conflict"],
  // 3.29 reworked Abyss: "of Edifice" and "of Profound Depth" are gone from
  // the item class, replaced by these two.
  Abyss: ["Abyss Scarab", "Abyss Scarab of Multitudes", "Abyss Scarab of Crystals", "Abyss Scarab of Descending", "Abyss Scarab of the Consort"],
  Anarchy: ["Anarchy Scarab", "Anarchy Scarab of Gigantification", "Anarchy Scarab of Partnership", "Anarchy Scarab of the Exceptional"],
  Essence: ["Essence Scarab", "Essence Scarab of Ascent", "Essence Scarab of Calcification", "Essence Scarab of Stability", "Essence Scarab of Adaptation"],
  Domination: ["Domination Scarab", "Domination Scarab of Apparitions", "Domination Scarab of Evolution", "Domination Scarab of Terrors"],
  Ritual: ["Ritual Scarab of Selectiveness", "Ritual Scarab of Wisps", "Ritual Scarab of Abundance", "Ritual Scarab of Corpses"],
  Harvest: ["Harvest Scarab", "Harvest Scarab of Cornucopia", "Harvest Scarab of Doubling"],
  Incursion: ["Incursion Scarab", "Incursion Scarab of Invasion", "Incursion Scarab of Timelines", "Incursion Scarab of Champions"],
  Betrayal: ["Betrayal Scarab", "Betrayal Scarab of the Allflame", "Betrayal Scarab of Unbreaking", "Betrayal Scarab of Reinforcements"],
  Beyond: ["Beyond Scarab", "Beyond Scarab of Haemophilia", "Beyond Scarab of the Invasion", "Beyond Scarab of Resurgence"],
  Ultimatum: ["Ultimatum Scarab", "Ultimatum Scarab of Bribing", "Ultimatum Scarab of Dueling", "Ultimatum Scarab of Catalysing", "Ultimatum Scarab of Inscription"],
  Delirium: ["Delirium Scarab", "Delirium Scarab of Mania", "Delirium Scarab of Paranoia", "Delirium Scarab of Neuroses", "Delirium Scarab of Delusions"],
  Blight: ["Blight Scarab", "Blight Scarab of the Blightheart", "Blight Scarab of Blooming", "Blight Scarab of Invigoration"],
  Trarthan: ["Trarthan Scarab", "Trarthan Scarab of Infamy", "Trarthan Scarab of Renown", "Trarthan Scarab of Surprising Alliances"],
  Horned: ["Horned Scarab of Bloodlines", "Horned Scarab of Nemeses", "Horned Scarab of Preservation", "Horned Scarab of Awakening", "Horned Scarab of Tradition", "Horned Scarab of Glittering", "Horned Scarab of Pandemonium"],
  Universal: ["Scarab of Monstrous Lineage", "Scarab of Adversaries", "Scarab of Divinity", "Scarab of Hunted Traitors", "Scarab of Stability", "Scarab of the Commander", "Scarab of Evolution", "Scarab of Wisps", "Scarab of the Sinistral", "Scarab of the Dextral", "Scarab of Radiant Storms"],
};

/* Anything the feeds price that is NOT in the list above cannot drop any more.
   The old Breach set is the clearest case: poe.ninja still quotes Breach
   Scarab, of Splintering, of Lordship and of Snares alongside the five that
   replaced them, because they still sit in stashes and still trade in the
   permanent leagues. Nine rows under one mechanic, four of which nobody can
   farm.

   This is a rule rather than a list of retired names on purpose — a list only
   ever covers the retirements someone remembered to write down, and every
   league adds more. The cost is the other direction: a scarab GGG adds
   mid-league reads as legacy until this catalogue is updated, so the UI shows
   how many rows it is holding back instead of hiding them silently. */
export const CURRENT_SCARABS = new Set(Object.values(GROUPS).flat());

export function isCurrentScarab(name) {
  return CURRENT_SCARABS.has(name);
}

/* Assign any scarab name (incl. ones poe.ninja adds later) to a group. */
export function groupForName(name) {
  for (const [g, list] of Object.entries(GROUPS)) if (list.includes(name)) return g;
  if (/^Horned Scarab/.test(name)) return "Horned";
  if (/^Scarab of/.test(name)) return "Universal";
  if (/^Influencing Scarab/.test(name)) return "Influence";
  const m = name.match(/^(\w+) Scarab/);
  return m ? m[1] : "Universal";
}
