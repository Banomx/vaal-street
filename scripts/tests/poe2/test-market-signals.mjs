import assert from "node:assert/strict";
import { buildUnusualActivity, buildRouteConsistency, canonicalPairKey, EXALTED_ID } from "../../../src/games/poe2/features/exchange/exchangeDesk.js";
import { evaluateWatch, sanitizeWatchlist, watchlistStore } from "../../../src/games/poe2/features/watchlist/watchlist.js";

const ITEM = "Metadata/Test/Item";
const QUOTE = "Metadata/Test/Quote";
const keys = [canonicalPairKey(ITEM, EXALTED_ID), canonicalPairKey(ITEM, QUOTE), canonicalPairKey(QUOTE, EXALTED_ID)];
function pair(index, item, units, rate) {
  const direct = keys[index].split("|")[0] === item;
  return direct ? [index, units, units * rate, rate, rate * .99, rate * 1.01]
    : [index, units * rate, units, 1 / rate, 1 / (rate * 1.01), 1 / (rate * .99)];
}
const start = Date.parse("2026-09-20T00:00:00Z");
const history = {
  items: { [ITEM]: {name:"Test Item"}, [QUOTE]: {name:"Test Quote"} }, pairKeys: keys,
  snapshots: Array.from({length:10}, (_, hour) => ({
    at: new Date(start + hour * 3600e3).toISOString(),
    pairs: [pair(0, ITEM, hour === 9 ? 4000 : 1000, 10),
      pair(1, ITEM, hour === 9 ? 4000 : 1000, 6), pair(2, QUOTE, 10000, 2)],
  })),
};
const activity = buildUnusualActivity(history);
const surge = activity.rows.find((row) => row.itemId === ITEM);
assert.equal(surge.multiple, 4);
assert.equal(surge.samples, 9);
assert.equal(surge.priceChange, 0, "price confirmation is independent of a volume surge");
assert.equal(buildUnusualActivity({...history, snapshots: history.snapshots.slice(-6)}).rows.length, 0, "six total observations have only five baseline hours");
assert.equal(buildUnusualActivity(history, {minimumMultiple:5}).rows.length, 0);
const missingLatest = {...history, snapshots: history.snapshots.map((s,i) => i===9 ? {...s,pairs:[]} : s)};
assert.equal(buildUnusualActivity(missingLatest).rows.length, 0, "missing latest pair is not an activity signal");
const duplicated = {...history, snapshots: [...history.snapshots, history.snapshots.at(-1)]};
assert.equal(buildUnusualActivity(duplicated).rows.find((r)=>r.itemId===ITEM).samples,9, "duplicate hours are not extra baseline evidence");
const result = buildRouteConsistency(history, ITEM, QUOTE);
assert.equal(result.samples,10);
assert.equal(result.score,1);
assert.equal(result.streak,10);
assert.ok(Math.abs(result.medianEdge-.2)<1e-9);
assert.equal(buildRouteConsistency(history,ITEM,QUOTE,{side:"buy"}).score,0, "sell premium is a buy disadvantage");
assert.equal(buildRouteConsistency(history,ITEM,EXALTED_ID).score,null,"direct quote is a baseline, not a 100% win");
assert.equal(buildRouteConsistency(history,ITEM,QUOTE,{minItemVolume:5000}).score,null,"both legs obey depth eligibility");
const gap={...history,snapshots:history.snapshots.filter((_,i)=>i!==8)};
assert.equal(buildRouteConsistency(gap,ITEM,QUOTE).streak,1,"missing hours break streaks");
assert.equal(buildRouteConsistency(missingLatest,ITEM,QUOTE).streak,0,"streak must end at the latest dataset hour");
assert.equal(buildRouteConsistency({...history,snapshots:history.snapshots.slice(-5)},ITEM,QUOTE).score,null);
const noDirect={...history,snapshots:history.snapshots.map(s=>({...s,pairs:s.pairs.filter(p=>p[0]!==0)}))};
assert.equal(buildRouteConsistency(noDirect,ITEM,QUOTE).samples,0,"no direct same-hour baseline means no fabricated comparison");
assert.equal(buildUnusualActivity(null).latestAt,null);
assert.equal(buildRouteConsistency(null,ITEM,QUOTE).score,null);

const now=Date.parse("2026-09-20T12:00:00Z");
const snapshot={generatedAt:"2026-09-20T11:00:00Z",divineExalted:400,prices:{"Test Item":{exalted:20},"Chaos Orb":{exalted:10}}};
const entry={name:"Test Item",target:2,direction:"below",unit:"chaos"};
assert.equal(evaluateWatch(entry,snapshot,now).reached,true,"inclusive threshold after currency conversion");
assert.equal(evaluateWatch({...entry,direction:"above"},snapshot,now).reached,true);
assert.equal(evaluateWatch({...entry,target:null},snapshot,now).state,"Watching");
assert.equal(evaluateWatch(entry,{...snapshot,generatedAt:"2026-09-19T00:00:00Z"},now).reached,false);
assert.equal(evaluateWatch(entry,{...snapshot,prices:{}},now).state,"No quote");
assert.equal(evaluateWatch({...entry,unit:"divine"},{...snapshot,divineExalted:0},now).value,null);
assert.equal(evaluateWatch(entry,{...snapshot,prices:{...snapshot.prices,"Test Item":{exalted:20,marketHour:"2026-09-19T00:00:00Z"}}},now).state,"Stale quote");
assert.deepEqual(sanitizeWatchlist([entry,entry,{name:"",target:5},null,{name:"Other",target:-1,unit:"invalid"}]),
 [entry,{name:"Other",direction:"below",unit:"exalted",target:null}]);
const memory=new Map();
const storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};
const a=watchlistStore("League A",storage), b=watchlistStore("League B",storage);
a.save([entry]);
assert.deepEqual(a.load(),[entry],"reload preserves watchlist");
assert.deepEqual(b.load([]),[],"leagues never share targets");
assert.notEqual(a.key,b.key);
assert.deepEqual(watchlistStore("Private",{getItem(){throw Error("blocked")}}).load([]),[]);
console.log("Market activity, route consistency and league-scoped watchlists passed.");
