/* The app's file contracts, checked against the data the generator actually
   writes.

   This exists because of a bug that produced no error anywhere: the gem tab
   asked `gems.json` for an `items` array, the file holds `gems`, so every
   valid snapshot was refused as unreadable and the tab showed its "no snapshot
   yet, it appears after the next refresh" empty state. Nothing was broken in a
   way anyone could see — the page simply told people to wait for data that was
   already there.

   Both halves of the contract are therefore read from source: the required
   fields come from each game's `config.js` (the same constant the components
   use) and the files come from `public/data`. A rename on either side fails
   here instead of silently emptying a tab in production. */

import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFile } from "../../shared/dataset.mjs";
import { POE1_FILE_CONTRACTS, POE1_LEAGUE_FILES } from "../../../src/games/poe1/config.js";
import { POE2_FILE_CONTRACTS, POE2_LEAGUE_FILES } from "../../../src/games/poe2/config.js";
import { checkDocument, READY } from "../../../src/shared/data/snapshot.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DATA = path.join(ROOT, "public", "data");

async function leaguesOf(game) {
  const index = await readJsonFile(path.join(DATA, game, "index.json"));
  return Array.isArray(index?.leagues) ? index.leagues.filter((entry) => entry?.slug) : [];
}

/* Every contract key must name a file the app can address, and every file it
   addresses must satisfy the contract. A key with no filename is a contract
   nothing can ever use. */
async function checkGame({ game, contracts, files, supported }) {
  const leagues = await leaguesOf(game);
  assert.ok(leagues.length, `${game}: index.json advertises at least one league`);

  let checked = 0;
  for (const [key, required] of Object.entries(contracts)) {
    const filename = files[key];
    assert.ok(filename, `${game}: contract "${key}" names no file in the league file map`);

    for (const league of leagues) {
      const doc = await readJsonFile(path.join(DATA, game, league.slug, filename));
      if (!doc) continue; // a family this league genuinely has no market for
      const verdict = checkDocument(doc, { supported, required });
      assert.equal(verdict.state, READY,
        `${game}/${league.slug}/${filename} fails the contract the app applies to it: ${verdict.reason || verdict.state}`
        + ` (asked for ${required.join(", ")}; file holds ${Object.keys(doc).slice(0, 8).join(", ")})`);
      checked += 1;
    }
  }
  assert.ok(checked > 0, `${game}: no files were checked — is public/data populated?`);
  return { leagues: leagues.length, checked };
}

/* The manifest each league publishes has to name real files too: the app reads
   filenames from it, so a name that is not on disk is a 404 the page cannot
   tell apart from a family that was never generated. */
async function checkManifests(game) {
  let named = 0;
  for (const league of await leaguesOf(game)) {
    const manifest = league.files;
    assert.ok(manifest && typeof manifest === "object",
      `${game}/${league.slug}: index entry publishes no files map, so the app has to guess filenames`);
    const onDisk = new Set(await readdir(path.join(DATA, game, league.slug)).catch(() => []));
    for (const filename of Object.values(manifest)) {
      assert.ok(onDisk.has(filename), `${game}/${league.slug}: manifest names ${filename}, which is not there`);
      named += 1;
    }
    assert.ok(Object.values(manifest).includes("prices.json"),
      `${game}/${league.slug}: manifest does not name prices.json`);
  }
  return named;
}

const poe1 = await checkGame({
  game: "poe1", contracts: POE1_FILE_CONTRACTS, files: POE1_LEAGUE_FILES, supported: [1],
});
const poe2 = await checkGame({
  game: "poe2", contracts: POE2_FILE_CONTRACTS, files: POE2_LEAGUE_FILES, supported: [1],
});

/* The exact regression: `gems.json` holds `gems`, and the tab that reads it
   must ask for that. Spelled out so a future edit to the contract map cannot
   quietly reintroduce it. */
assert.deepEqual(POE1_FILE_CONTRACTS.gems, ["generatedAt", "gems"]);
assert.ok(POE1_FILE_CONTRACTS.scarabs.includes("items"));

const manifests = await checkManifests("poe1") + await checkManifests("poe2");

console.log(`File contract tests passed (${poe1.checked + poe2.checked} files across `
  + `${poe1.leagues + poe2.leagues} leagues, ${manifests} manifest entries).`);
