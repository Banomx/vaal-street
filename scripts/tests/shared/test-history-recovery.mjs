// A successful collector can be newer than Pages after a failed site build.
// Recovery must union its observations without rolling back current quotes.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), "vaal-history-recovery-"));
const target = path.join(temp, "target");
const cache = path.join(temp, "cache");
const at = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();
const [old, shared, fresh] = [at(4), at(3), at(2)];
async function seed(dir, timestamps, values, generatedAt, exalted) {
  const game = path.join(dir, "poe2");
  const league = path.join(game, "test-league");
  await mkdir(league, { recursive: true });
  await writeFile(path.join(game, "index.json"), JSON.stringify({
    schemaVersion: 2, generatedAt, leagues: [{ name: "Test League", slug: "test-league" }],
  }));
  await writeFile(path.join(league, "price-history.json"), JSON.stringify({
    schemaVersion: 1, league: "Test League", generatedAt, timestamps,
    divineExalted: timestamps.map(() => 400), series: { Item: values },
  }));
  await writeFile(path.join(league, "prices.json"), JSON.stringify({
    generatedAt, league: "Test League", prices: { Item: { exalted } },
  }));
}
await seed(target, [old, shared], [10, 20], shared, 20);
await seed(cache, [shared, fresh], [20, 30], fresh, 30);
const cachedFile = path.join(cache, "poe2/test-league/price-history.json");
const originalCache = await readFile(cachedFile, "utf8");
const merge = () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts/tools/merge-pages-artifact.mjs"), cache], {
    cwd: root, env: { ...process.env, DATA_ROOT: target }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
};
merge();
const historyFile = path.join(target, "poe2/test-league/price-history.json");
const merged = JSON.parse(await readFile(historyFile, "utf8"));
assert.deepEqual(merged.timestamps, [old, shared, fresh]);
assert.deepEqual(merged.series.Item, [10, 20, 30]);
const prices = JSON.parse(await readFile(path.join(target, "poe2/test-league/prices.json"), "utf8"));
assert.equal(prices.generatedAt, fresh);
assert.equal(prices.prices.Item.exalted, 30);
assert.equal(await readFile(cachedFile, "utf8"), originalCache, "recovery sources remain untouched");
merge();
assert.deepEqual(JSON.parse(await readFile(historyFile, "utf8")), merged, "repeated restore is idempotent");
console.log("Saved history survives a failed site deployment and repeated restore.");
