import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { retainLeague } from "../../poe1/retainLeague.mjs";
import { usesThreads } from "../../../src/games/poe1/leagueRules.js";
const root = await mkdtemp(path.join(tmpdir(), "vs-retain-"));
try {
 const final = path.join(root,"final"), stage = path.join(root,"stage");
 for (const dir of [final,stage]) await mkdir(path.join(dir,"old"),{recursive:true});
 await writeFile(path.join(final,"old","history.json"), '{"points":[1,2,3]}');
 await writeFile(path.join(stage,"old","history.json"), '{"points":[4]}');
 await writeFile(path.join(stage,"old","partial.json"), '{}');
 assert.equal(await retainLeague(final,stage,"old"),true);
 assert.equal(await readFile(path.join(stage,"old","history.json"),"utf8"),'{"points":[1,2,3]}');
 assert.deepEqual(await readdir(path.join(stage,"old")),["history.json"]);
 await assert.rejects(retainLeague(final,stage,".."));
 await assert.rejects(retainLeague(final,final,"old"));
 assert.equal(await retainLeague(final,stage,"absent"),false);
 for (const name of ["Covens","Hardcore Covens","HC Ruthless Covens","Umbra"]) assert.equal(usesThreads(name),true,name);
 assert.equal(usesThreads("Allflame"),false);
 console.log("League-isolated restore and live Covens names passed.");
} finally { await rm(root,{recursive:true,force:true}); }
