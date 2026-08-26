# Architecture

## Market snapshot pipeline

The React app is static and reads generated JSON from `public/data/<game>/`.
PoE 1 snapshots live under `public/data/poe1/`; PoE 2 prices live under
`public/data/poe2/`. GitHub Actions runs both game-specific snapshot jobs at 10
minutes past every hour, builds the site and deploys it to GitHub Pages. The
PoE 1 cadence matches the source: GGG
publishes one digest per completed hour and the run asks for the last completed
one, so a skipped hour is a price that cannot be recovered afterwards.

Price selection starts with this trust order:

1. GGG's public Currency Exchange hourly digest for completed exchange trades.
2. poe.ninja — the exchange overview for everything fungible, the stash item
   overview for everything else in the game. This is the half GGG does not
   price, and it is also where roll-variant detail comes from.
3. poe.watch for what poe.ninja does not carry. That is a short list by name
   count but a load-bearing one: the unidentified markets exist nowhere else,
   and the boss tab prices drops off them.
4. For configured boss items still unpriced by those sources, the most recent
   completed GGG trade hour within the preceding 24 hours, but only when the
   current GGG market data recognizes the item.
5. Explicit, dated fallback values in the boss/Delve datasets when all market
   sources lack the item.

That order is a prior, not an unconditional overwrite. Each game scores a quote
using retained liquidity, listing depth, spread, freshness and thin-market
flags, and refuses to compare explicitly incompatible item states. A deeply
traded fresh lower-priority observation can therefore beat a stale or extremely
thin higher-priority one. Descriptive metadata is merged only after the quote
winner is known.

`scripts/poe1/sources/ggg-exchange.mjs` requests the previous completed UTC hour from
`https://web.poecdn.com/api/currency-exchange/<timestamp>`. If that hour has not
reached the CDN, it retries one hour earlier. The response contains internal
Metadata paths and aggregate quantities, not display names or ready-made item
prices.

For a direct item/Chaos pair, the hourly volume-weighted price is:

```text
chaos price = chaos volume traded / item volume traded
```

When only a direct item/Divine pair exists, that rate is multiplied by the same
hour's direct Divine/Chaos rate. Arbitrary multi-hop conversions are not used.
Zero-volume markets are ignored.

A zero-volume market can still identify a thin supported item. For configured
boss-price gaps only, the snapshot first retains a still-recent official entry
from the preceding deployment, then searches up to 24 older completed GGG
digests for unresolved names. Names absent from the current Currency Exchange
market do not widen the search. Recovered entries carry their actual
`marketHour` and `staleHours`; they expire rather than becoming permanent
hand-set prices.

RePoE's `base_items.min.json` maps GGG Metadata paths to display names and tags.
It contributes no prices. If either the GGG digest or the name mapping is
unavailable, the snapshot completes with poe.ninja and poe.watch instead.

Each deployed JSON file records `schemaVersion` and `generatedAt`; files using
GGG also record `gggHour`, the newest completed market hour used by the
snapshot. Individual GGG entries record `marketHour`, which differs when a thin
boss item came from a recent earlier hour.

## Publication: stage, gate, promote

Neither fetcher writes into `public/data/<game>/` while it runs. `createStage()`
in `scripts/shared/dataset.mjs` makes a sibling `.staging-<pid>-<n>` directory,
the run generates into that, and only a run that passes its own gates is
promoted over the published tree by an atomic rename. A run that fails discards
its staging directory, exits non-zero and leaves the previous deployment live —
GitHub Pages only uploads after a successful workflow, so failing loudly is
strictly safer than publishing damage. Abandoned staging directories from a
killed run are cleared at the start of the next one. If a process died after
moving the live tree to `.previous-*` but before installing staging, the newest
previous tree is restored first; it is never deleted as ordinary scratch data
while the final tree is absent.

The gates are `scripts/poe1/validate.mjs` and `scripts/poe2/validate.mjs`, both
runnable on their own against the checked-in tree:

```bash
npm run validate            # both games
node scripts/poe1/validate.mjs --previous <dir> --write
```

They report at three levels, and only the third stops a deploy:

| level | meaning |
|---|---|
| `warning` | worth reading in the log; publishes |
| `degraded` | the dataset is publishable but visibly worse — stale leagues, a missing envelope field |
| `failure` | not published: a collapsed price count, a non-finite value, a history that lost points, an index naming files that do not exist |

Several gates are *comparisons against the previous published tree* rather than
fixed thresholds, because the only reliable definition of "this run broke
something" is "it is much worse than the last one": `collapsed()` fails a run
whose priced-name count, league count or history depth drops sharply. The
report is written to `public/data/<game>/quality.json` and read by the browser.

### Carried-forward data is cleaned on the way in

Reuse mode and the per-family fallback both copy files from the live
deployment, which was written by whatever code was running at the time. It can
therefore hold values the current gates reject — the sub-0.005c prices that
two-decimal rounding turned into `0` sat in every league's `prices.json` and in
The Catalyst's stored history.

Carrying those forward unchanged makes the gates unsatisfiable: the gate is
right that a zero must not be published, and a reuse run cannot produce a
better number, so the run fails every time and the deployment freezes. This
happened on the first code deploy after the gates were added.

`sanitizeCarried()` (`scripts/poe1/history.mjs`) and `sanitizeCarriedPrices()`
(`scripts/poe2/prices.mjs`) apply the same rule the recovery tool uses: drop
the false value, keep the observation. A zero price is removed from the map, a
zero stored value is removed from its point while the point itself stays, and
PoE 2 placeholder names (`INCOMPLETE` and friends) are dropped. Gem history is
exempt because it stores signed levelling profit. Every run logs what it
cleaned. Absent means unknown; zero would mean free.

Every run also records where its numbers came from. `sourceRecord()` captures a
feed's URL, fetch time, endpoint family/type, success, row/rejection counts and,
where available, ETag/Last-Modified, observation time and a content hash. RePoE
publishes no version or manifest, so a content hash is the only way to notice
its dictionary changed. PoE 1 writes one `sources.json` per league; PoE 2 keeps
the records in `prices.json`. Both include Metadata coverage. Publication fails
when a selected source has no successful matching provenance record; coverage
accounting, high ambiguity/name-fallback rates and rejection spikes are also
surfaced in `quality.json`.

New snapshots use schema version 2 for these stronger provenance contracts.
Readers and validators continue accepting version 1 while checked-in and older
deployed snapshots age out naturally.

## Snapshot contract in the browser

`src/shared/data/snapshot.js` is the only place the app decides whether a
downloaded file may be rendered. Every read returns a state instead of throwing
or yielding `null`:

| state | means |
|---|---|
| `ready` | parsed, schema understood, required fields present |
| `missing` | 404 — the run never wrote this file |
| `offline` | the request itself failed |
| `corrupt` | a 200 that will not parse, or a document missing required fields |
| `incompatible` | a `schemaVersion` this build does not read |

The distinctions matter: an absent history is ordinary for a league in its first
hour, while an unreadable one means the build is older than the data and drawing
it would be a guess. `summarize()` folds a league's documents, its freshness and
`quality.json` into one verdict, which `SnapshotNotice.jsx` renders. Bare maps
with no envelope — the derived `<key>-history.json` files — are read with
`versioned: false` so they are not reported as pre-contract forever.

Two rules follow from this and are enforced by
`scripts/tests/shared/test-snapshot.mjs`:

- **Nothing is invented.** A PoE 2 league with no stored timeline gets an
  explicit "current snapshot only" banner; it used to be given a fabricated
  one-point history, which renders as a flat line and a 0% move — a claim about
  the market rather than an admission that nothing has been recorded.
- **A production build reads snapshots only.** `src/shared/data/dataMode.js`
  resolves the mode from `?data=` and the dev flag: `static` in production,
  `auto` (static → live → demo) in development. The live poe.ninja API and the
  sample dataset are unreachable from a deployed page unless asked for by URL,
  so a broken deployment can never be silently answered with sample prices.

Which files exist is not guessed either. Each league entry in `index.json`
carries a `files` map (`{ scarabs: "scarabs.json", … }`, keys camel-cased from
the filenames) describing what that run actually published; the app addresses
every file through it, with the names in each game's `config.js` as the fallback
for a tree written before the map existed. The gates fail a run whose manifest
names a file that is not there.

## Repository boundaries

`src/app/App.jsx` owns the selected game and renders one game workspace at a
time. It does not contain league, pricing, or feature logic. The canonical
application layout is:

```text
src/
  app/                         boot and game selection
  shared/
    data/                      path helpers, snapshot contract, data-mode rule
    storage/                   versioned, scoped browser storage
    ui/                        game-neutral UI controls, incl. SnapshotNotice
  games/
    poe1/
      Poe1App.jsx              PoE 1 shell, navigation, data loading and styles
      config.js                PoE 1 endpoints, schema versions, file fallbacks
      catalogue/               market-family and scarab catalogues
      features/<feature>/      UI, calculations and curated data together
    poe2/
      Poe2App.jsx              PoE 2 shell, league/currency controls
      config.js                PoE 2 data namespace, schema versions, files
      shared/                  reusable PoE 2-only UI such as the market browser
      features/overview/       PoE 2 landing briefing and feature registry
      features/bosses/         PoE 2 boss UI, EV model and curated rates
      features/farms/          tablet entry cost against mechanic return indices
      features/exchange/       completed-pair analysis and Currency Exchange UI
      features/pricing/        PoE 2 market timeline UI and selectors
```

A module may import from its own game or from `src/shared`; game directories do
not import from each other. Similar PoE 1 and PoE 2 concepts remain separate
until the common part is demonstrably game-neutral. This prevents a change to a
PoE 1 league rule or item shape from silently changing PoE 2.

The PoE 2 workspace opens on its own Overview. That page follows the shared
briefing pattern—feature signal, decision desk, and data-quality row—but its
registry contains only native PoE 2 features. Adding a PoE 2 tab also adds its
overview signal within `features/overview/`; PoE 1 overview code is not reused.

PoE 1 feature folders are `bosses`, `delve`, `gems`, `overview`, `pricing`, and
`strategies`. A feature keeps its React view, pure calculation layer, and
curated dataset beside each other so maintenance starts from one directory.

Static API snapshots use `public/data/<game>/<league>/`. Keep large generated
datasets here as split JSON files: JSON is portable, cacheable and a good fit
for a static site. Do not put bulk market history in `localStorage`; it is
synchronous and quota-limited. `src/shared/storage/jsonStore.js` provides versioned,
game-scoped JSON storage for small user settings and saved inputs. If a PoE 2
feature needs large mutable client-side data, use IndexedDB; shared or queried
data belongs in a database/API.

The PoE 2 pipeline is intentionally separate. `scripts/poe2/fetch-data.mjs`
writes a normalized current market catalogue and a compact price timeline for
the active challenge league and Standard:

```text
prices.json           merged current prices plus independent source quotes
price-history.json    aligned timestamps, Divine rates, and per-item Exalted series
exchange-markets.json canonical current GGG pair graph with volumes/ranges/stocks
exchange-history.json compact completed-pair metrics by official market hour
```

The current catalogue is the reusable input for feature calculations. The
history file is column-oriented: every item series is aligned to one timestamp
array, so item names and times are not repeated for every quote. A missing quote
is stored as `null`, not carried forward as a stale price. The current
`prices.json` entry remains the source of descriptive and liquidity metadata.
Normalization keeps the upstream market family separate from GGG's item class,
tags, Metadata path, inheritance path, and base type. The RePoE dictionary
enriches every merged source by Metadata id or base type; poe.ninja's stash
category supplies the exact GGG class for uniques. Category browsing is a
rule-based projection of those fields. Display-name checks are limited to
distinctions the item class does not encode, such as Reliquary Key versus other
fragment items, so newly added items in GGG's existing classes need no catalogue edit. The history
file deliberately stores only the values needed for time-series analysis.

The GGG adapter also preserves every active completed pair instead of reducing
the digest to item/Exalted prices. Pair ids are canonical regardless of the
feed's order. Each pair retains both completed volumes, the volume-weighted mean,
normalized low/high completed ratios, and low/high stock observations.
`exchange-history.json` uses one pair-key dictionary and compact numeric arrays
per official hour so Metadata ids are not repeated for every observation.
`prices.json.sourcePrices` keeps poe.ninja and PoE2Scout quotes even when GGG
wins the merged price; this is required for an independent GGG-versus-poe.ninja
comparison.

It uses GGG's public hourly PoE 2 Currency Exchange digest first, with the PoE 2
RePoE export as its Metadata-path name dictionary. poe.ninja's documented PoE 2
exchange and stash endpoints fill gaps and price non-exchange items. PoE2Scout's
league item endpoint is the final gap-fill and never replaces a price from GGG
or poe.ninja. poe.ninja exchange and stash values are converted from the
response's declared primary currency to Exalted with its own core rate;
PoE2Scout item values are already denominated in Exalted. Curated drop rates remain in
`src/games/poe2/features/bosses/bossData.js`: wiki sample rates, community
rates, and inferred estimates are distinct data states. Every non-fixed drop
rate and market price can be clicked and manually overridden; reset restores
their curated or pipeline values. Source notes remain available beside the
rate. The table keeps `Drop`, `Chance / qty`, `Market price`, and `Adds to EV`
so both each line's contribution and the per-pool total remain visible. The Boss profit
page derives one price-coverage summary from its computed entry and drop lines.
Independent drop tables are named and split by their real item family. This
prevents runes, Lineage Supports, reliquary keys, and Vaal currencies from
sharing a misleading generic table while leaving guaranteed pools unchanged.
External PoE 2 requests use a bounded timeout so one slow optional source cannot
stall the scheduled snapshot. Missing market items are listed and count as zero EV until the pipeline
or a league-scoped manual price supplies a quote. The snapshot job logs the same
coverage after each league refresh. A deterministic conversion may declare a
price proxy in the curated line: Depleted Mana Rune uses the exchange quote for
Runeseeker's Call. Megalomaniac's two- and three-notable variants deliberately
use poe.ninja's normal item quote as a conservative floor and carry a Gamble
warning because valuable notable combinations can sell far above that floor.
Custom PoE 2 TTK profiles have no built-in/default profile;
profit/hour exists only for boss ids with a user-entered time. Rate edits,
league-scoped manual prices, and TTK profiles use the game-scoped browser store.

The PoE 2 Popular farms view pairs what a league mechanic costs to enter with
what its markets return. It consumes `PrecursorTablets` and `UniqueTablets` for
the entry side and the mechanic's own output markets for the return side, all
from the same normalized snapshot.

Normal precursor-tablet quotes are retained as each mechanic's baseline even
when a cheaper Magic or Rare quote exists. In practice Normal is the only
rarity any source quotes — neither the published prices nor the raw
`sourcePrices` carry a rolled tablet — so every entry cost the view shows is a
**floor**, and it says so rather than implying it is the price of a tablet
someone would run. GGG tablet tags assign the league card; unique tablets appear
only as context. Baseline histories use the shared aligned PoE 2 timeline and
can calculate Divine-adjusted movement from the Divine/Exalted rate at both
endpoints. When a history first adopts the Normal-tablet contract,
`tabletBaselineVersion` removes older tablet series that represented the
cheapest rarity; subsequent Normal points then accumulate normally without a
false parser-change spike.

### Mechanic identity

`src/games/poe2/features/farms/mechanics.js` decides which markets belong to
which mechanic. It asserts membership and never a drop rate. Matchers run in
source-trust order: GGG's own exchange `marketFamily`, then a `metadataPath`
prefix, then item tags.

The source check is not decoration. `marketFamily` carries two different
vocabularies — GGG's exchange category and PoE2Scout's `CategoryApiId` — and
the second one files Soul Cores under `expedition` and Idols under `ritual`.
Only a value from `GGG completed trades` is read as a mechanic name, so a rune
is never counted as Expedition output. Incursion has no GGG family at all; its
pool is the `CurrencyIncursion` and `Thesis` metadata paths.

Uniques need curation, because nothing structural connects Xoph's Blood to
Breach. A short per-mechanic name list, verified against poe2db.tw, supplies
them. That is membership only, the same trade `catalogue/scarabs.js` makes in
PoE 1, and it carries the same rename risk: `curatedCoverage` reports any
curated name that matched no market instead of letting it vanish.

Overseer and Irradiated have no attributable output market and are labelled that
way. Their cards show entry cost alone.

### Entry cost: tablet, or logbook

A tablet covers the maps in its tower radius, roughly ten of them; an Expedition
Logbook grants roughly ten maps of Expedition. One block of access either way,
so the two quotes compare directly and neither is divided down to a per-map
figure — "around ten" is too soft to bake into an absolute number the page
shows.

Most mechanics are entered through their precursor tablet, which
`buildTabletFamilies` resolves. Expedition is the exception: no source prices an
Expedition Tablet, so `ENTRY_SOURCES` in `mechanics.js` declares the logbook
instead, matched on its `expedition_logbook` tag rather than its display name so
a rename does not silently unprice the entry side. A declared source that
matches nothing reports an unknown entry rather than substituting another
market. The timeline splits by kind, because `tabletFamilyTimeline` carries
`tabletBaselineVersion` handling that only applies to a Normal precursor tablet;
a logbook reads `buildPriceTimeline` directly.

The logbook is deliberately left in the Expedition return basket as well, where
it holds about 15% of the supply weight. Expeditions drop logbooks, so sustain
is part of what the mechanic returns and excluding it would understate
Expedition. The cost is that one item sits on both sides of that card and damps
the spread a little — measured at +11.9% against +12.1% with it held out — so
the card states the double role rather than leaving a reader to assume the two
sides are independent measurements.

### The return index

`farmIndex.js` builds a fixed-weight (Laspeyres) basket per mechanic, rebased to
100 at the start of the window. Weights are taken once from the latest snapshot,
so index movement is price movement and never weight churn. Three weightings are
offered: traded supply (cleared units, the default), traded value, and equal.

Traded supply is a market measurement used as the closest observable stand-in
for how often an item is produced. It is labelled as such and is **not** a drop
rate; no drop rate appears anywhere in this feature.

The three rules that keep a summed basket honest are the ones
`poe1/features/strategies/stratHistory.js` already documents: a member with no
stored history is excluded and named rather than back-filled, the plotted window
is the members' overlap, and a member missing one hourly sample inside that
window contributes its nearest one. Below three surviving members there is no
index and the card says why.

Stash-quoted uniques stay out of the basket. GGG cleared volume and poe.ninja
listing counts are not the same measurement, so giving a stash-priced unique a
share of a volume-weighted basket would mean inventing the weight. They render
as a separate chase-item list instead.

Return against entry is reported as a ratio, `(1 + return) / (1 + entry) - 1`,
not as a difference of two percentages. Subtracting breaks down as soon as
either side is large: a tablet up 486% against a basket down 6% is not
-492%.

A card is drawn whenever either half exists. A mechanic with an output pool and
no tablet quote still renders, with the entry cost stated as unknown — Runes of
Aldur prices no Expedition Tablet while Expedition clears more than any other
mechanic, and keying the list off tablet families alone hid it completely.

### Reading a pool: three views, one traversal

Movers were originally the top three risers and fallers by percentage change.
That was actively misleading. Percentage systematically favours the cheapest
markets, so Ritual headlined three omens worth under 2 Exalted while Omen of
Chance at 5,635 never appeared anywhere on the card — a reader could only
conclude the farm dropped junk. Breach did the same, listing sub-3-Exalted
catalysts while Refined Sibilant Catalyst sat at 2,020.

`poolContributions` walks each pool once and the card renders three views of
the result, so opening the table costs no extra history reading.

**Most valuable drops** is a plain price sort. The point of the list is that a
mechanic's best output is visible, and ranking it by turnover would push the
rare expensive items back out of sight. Several of them clear once an hour, so
the cleared volume travels with every row and `liquidity` tiers it: the caveat
is shown rather than the item hidden, since hiding it caused the original bug.

**What moved the index** ranks by each market's contribution to the index move.
For a fixed-weight index that decomposes exactly:

```
contribution_i = w_i * (price_i(t) - price_i(0)) / SUM_j w_j * price_j(0)
```

and the contributions sum to the index change, so the list explains the number
already on the card. This is deliberately *not* weight times percentage change,
which is not additive in a price index — that version summed to 38 points
against a 2.88% move. The percentage stays beside the contribution, so a market
up 241% that moved the index by nothing reads as exactly that.

Only the mover shortlists apply a liquidity gate. **The full pool table** is
behind a toggle and lists every market with price, cleared volume, basket
weight, change and contribution, sortable by any column. Nothing in a pool is
unreachable, which is the actual fix — the shortlists are a summary, and a
summary is what hid Omen of Chance.

### Tower rules, and what is deliberately not quantified

The exposure model rests on game rules rather than on measurements: a tower node
takes three tablets and four on a city biome; mechanic tablets compete, so
filling every slot with one mechanic makes it the only major mechanic that
spawns; and more copies of a tablet means more encounters of it.

These support *relative* exposure between mechanics and nothing more. Four
things are left unquantified on purpose, and are stated on the page rather than
modelled away: absolute encounters or loot per slot; the affix uplift on any
tablet, since every non-unique tablet rolls two prefixes and two suffixes and no
source prices a rolled one; the Overseer/Irradiated loot uplift and atlas-tree
influence; and Vaal realizing late as temple room rather than as drops in the
map that ran it. This is why the return figure is an index and never an EV per
map.

One known imprecision is named rather than papered over: GGG groups every Omen
under the Ritual exchange family, including Abyss-themed Omens that also drop
from Abyss, and no source splits that supply.

`scripts/tests/poe2/test-farms.mjs` covers all of the above against fixtures.

## History

PoE 2 history is accumulated by `scripts/poe2/history.mjs`. A fresh run merges
the checked-in file with the deployed `price-history.json`, lets the deployed
copy win an overlapping timestamp, and appends the new snapshot. The most recent
7 days remain at hourly resolution; older data keeps the latest snapshot per
UTC day and expires after 430 days. There is no history-reset switch: the
accumulated points are the only copy of what the market did, and no upstream
feed can rebuild them. Code-only deployments reuse
all four current/history files, so a push does not erase accumulated data; a
reuse run that would publish fewer points than it read throws instead of
promoting. `src/games/poe2/shared/MarketBrowser.jsx` projects the
current catalogue into the collapsible parent/subcategory browser with adjacent
search results used by both Price Tracker and Exchange. Unique gear uses
slot-level children derived from normalized metadata rather than a curated name
list. Both tabs keep the browser in a bounded, sticky left sidebar on desktop;
the category and item panes scroll independently, and long labels truncate
without compressing their rows. The sidebar stacks only on narrow screens.
Collapsing a parent also clears its subcategory, preventing a hidden child
filter from surviving after the children close. An external selection, such as
clicking the Exchange market catalogue, reveals the matching category and
subcategory instead of being replaced by the browser's previous filter. The
tracker reads the price history directly. Divine display uses the stored
Divine/Exalted rate, while Chaos display uses the Chaos Orb's aligned Exalted
series at each timestamp.
The Divine-adjusted option leaves the displayed price line in the selected
currency, adds Exalted-per-Divine on a second axis, and calculates the reported
move as `(priceNow / rateNow) / (priceThen / rateThen) - 1`. It is unavailable
until the selected window has at least two item points with matching rates.

`scripts/poe2/exchange-history.mjs` applies the same seven-day hourly and
430-day daily retention to completed pair data. The Exchange route finder starts
with every completed pair containing the selected item. A candidate quote
currency is usable when it is Exalted or has its own direct completed Exalted
pair in the same official hour. The normalized mean is
`quote per item * Exalted per quote`; its low/high band multiplies the respective
completed bounds of both legs. Route liquidity is the lower Exalted-equivalent
turnover of the item/quote and quote/Exalted legs.

Buy mode sorts normalized means ascending and sell mode descending; sell is the
default. The selected route floor applies to both legs. The editable floor defaults to 1,000
Exalted/hour and the editable participation assumption defaults to 90% of
completed hourly flow; both expose presets but accept custom values. Planned
quantity starts at one item and applies to both recommendation cards and the
route table.
The route table initially renders 10 rows and
expands in 10-row batches. The first batch always includes completed Exalted,
Chaos, and Divine comparisons when available, even when one is below the route
floor. Pinned routes are injected into the batch and then placed by their actual
Exalted-equivalent value rather than grouped at the top; only qualifying routes
can become the recommendation. Changing the item,
direction, or route floor resets the table to the first batch. Quantity
estimates take the slower of the
selected share of completed item units on the first leg and the same share of
limiting normalized route turnover. They do not model a live order book,
and combined bounds do not assert that both extremes were simultaneously
executable. Selecting a route row keeps the recommendation in place and adds a
second card comparing that route's cost or return, clear time, and observed
range against the recommendation. Direct Exalted, Chaos, and Divine pairs
remain the stable chart and display-rate basis.
History is decoded once into indexed pair maps; the resulting movement map is
reused by the market catalogue. The bottom market catalogue defaults to a 1,000
Exalted turnover filter and renders 20 rows at a time; search, sort, and filter
changes reset it to the first batch. Its turnover floor filters both the item's
overall turnover and every route's limiting turnover, then recalculates best
buy, best sell, eligible route count, and route difference before sorting.
Each displayed buy/sell route includes its limiting turnover for verification.
The Exchange picker uses the same metadata-driven category and subcategory rules
as Price Tracker rather than maintaining an exchange-only taxonomy. Specific
GGG tags such as catalysts take precedence over broad structural classes, and
league mechanics have separate subcategories rather than combined buckets.

PoE 1 uses its own family-oriented history contract because it also stitches
source backfills onto a league-day axis. Every PoE 1 family — scarabs and each
entry in `src/games/poe1/catalogue/categories.js` — is stored the same way, four
files per league folder, and built by the same code path (`buildFamilyHistory`):

```text
<key>.json              current prices
<key>-selfhistory.json  raw accumulated snapshots, one point per run
<key>-backfill.json     poe.ninja's league-long curve, fetched once per league
<key>-history.json      the two stitched onto one day axis — what the app plots
```

`<key>-history.json` is derived, so it can be rebuilt; the other three cannot.
The live deployment is the normal state store and each run recreates
`public/data/poe1` from scratch. Checked-in history files are also accepted as
recovery seeds: raw points merge by absolute timestamp with the deployed point
winning an overlap, while a derived curve keeps whichever complete axis has
more points until the next fetch rebuilds it. Three consequences drive the
design:

- **A run that writes nothing for a family deletes it.** The next run then
  starts that curve again from a single point. Runs therefore call
  `carryForward()` when a feed prices nothing or the family throws, and for a
  league that has rolled over to "previous" — which keeps the curve it
  accumulated while it was current. One bad hour costs an hour, not the league.
- **The backfill is fetched once.** poe.ninja's legacy `itemhistory` is ~90
  requests per league and only scarabs have it; hourly runs would make that
  2,160 requests a day for a curve that does not change. It is stored with
  absolute timestamps rather than the endpoint's `daysAgo`, which is only true
  at the moment of the request and would otherwise slide a day off the axis
  every day it was reused.
- **Points thin rather than disappear.** Full resolution for 72 hours because
  the 1h-48h change windows are read straight off these points, one point per
  UTC day before that, nothing past ~14 months. That retains two complete
  3–5 month leagues while keeping each item series to roughly 500 points;
  `SELF_HISTORY_CAP` remains headroom rather than the thing doing the shaping.

All previous-deployment reads prefer `/data/poe1/<league>/`. The former
`/data/<league>/` location remains a migration fallback only. The browser also
accepts the old scarab `history.json` filename when `scarabs-history.json` is
not present, so checked-in or deployed pre-split datasets remain readable.
External JSON requests have a 30-second timeout (`FETCH_TIMEOUT_MS`) so one
stalled fallback cannot block the hourly job indefinitely.

`historyOrigin()` picks one day 0 per league — league start whenever it is
known and plausible, otherwise the earliest point we hold — and the price
curves, the gem curve and the `rateHistory` line all hang off it. That is what
lets Strat Watcher add a scarab series to an Astrolabe series; before it, each
family anchored day 0 at its own first snapshot, so "day 3" meant a different
moment on each tab. `stitchHistory()` merges backfill and accumulation into
10-minute buckets and lets our own snapshots win the overlap, the same way
`buildRateHistory()` already did for the divine rate.

Short change windows remain absent until a snapshot of roughly the right age
exists; they are never estimated from the daily poe.ninja sparkline, and a
window will not resolve against a point much older than itself — after a missed
run the badge goes blank instead of quoting a four-hour-old move as a 1h one.

`scripts/tests/poe1/test-history.mjs` runs the whole layer against a stubbed deployment:
backfill reuse, recovery merging, stitching, the shared axis, carry-forward and
thinning.

## Coverage boundary

The GGG feed prices only items with completed trades on the in-game Currency
Exchange. The normal basis is the selected hour; the bounded boss-gap lookup can
use a recent earlier completed hour for a currently recognized thin item.
Uniques, maps, gems, unidentified forms and roll variants generally require
poe.ninja or poe.watch. Boss drop rates and Delve biome rules remain curated
project data and are not supplied by any price API. Delve biome weights and
encounter tier/weight/minimum-depth fields are transcribed from current PoEDB
data-mined tables; creator observations are labelled separately.

poe.watch publishes an **active price** on its own item pages — what is
clearing, rather than the cheapest ask. It is not in the documented API and not
in the published `ItemData` schema; it comes from
`https://poe.watch/detailed/<id>/beta?league=…&merchant=all&corrupted=any&scale=linear`,
which is why the price map now carries each poe.watch item id as `wid`. The
difference is large: The Untouched Soul lists a 20c floor against a 50c mean
while its active price is 9c.

Because it is one request per item, `applyBetaPrices` fetches it only for the
names the boss and Delve tables actually price, only for the primary current
league, and never for a name the GGG digest already settled. `WATCH_BETA_LIMIT`
caps the count (default 300; set 0 to disable). The entry keeps `listedC` — what
the listings said — plus `beta: { confidence, samples, asOf, calculator }`. Any
failure leaves the listing figure in place: the floor is a perfectly good
answer, and this is an improvement on it rather than a dependency.

Since poe.ninja took primacy this reaches only poe.watch's own names. The
lookup key is `wid`, which is written by the poe.watch branch of the price map,
so a name poe.ninja priced has none and is skipped. poe.watch is the fallback
now: it sharpens the prices it supplies rather than second-guessing the ones it
did not. In practice that is the unidentified markets, which is where the
active price mattered most anyway.

So the full order for a boss line is: GGG completed trades, then poe.ninja's
listing floor, then poe.watch's active price, then poe.watch's listing floor.

One consequence worth stating plainly: poe.watch's own exchange rows
(`exchange: true`, backed by 24h volume) are completed trades too, and they now
lose to a poe.ninja listing on any name both feeds carry. GGG covers most of
that ground first, so the exposure is names GGG's digest does not reach, but it
is a real trade-off taken deliberately in favour of one predictable order.

Boss drops are quoted as the item a boss actually hands over, which is not the
same item the market usually prices. `resolve(..., { asDrop: true })` therefore:

1. tries the unidentified market first for every drop — declared aliases, then
   `Unidentified <name>` — and flags the line `unidQuote` so the UI can label it
   `Unid` rather than swapping the basis silently;
2. failing that, quotes the listing floor (`lo`) instead of the typical figure.
   From poe.ninja that floor is the cheapest listed variant of the item; from
   poe.watch it is the row's `min`. A drop lands unopened, and a mean prices well-rolled copies nobody
   is handing you, so the floor is simply the right figure — the result carries
   `floorQuote` for tests and callers, but the UI shows no badge. Labelling it
   would read as a warning about the price when the mean is what would have
   overstated how profitable a boss is;
3. leaves GGG figures alone — those are completed trades — and leaves synthetic
   aggregates alone, since a `@synthetic` is already the average of a random
   outcome and its `lo` is its cheapest member, not a floor for the item you get.

Entry costs run through the same floor rule with `{ asEntry: true }`, minus the
unidentified lookup — they are currency, and there is no unidentified market for
a fragment. Because GGG has absolute priority, a completed-trade price is what
they use whenever the digest carries the name; only where it does not does a
listing feed answer, and there the floor is what you can actually buy at rather
than the mean of every ask — again unlabelled.

For unidentified boss uniques, the poe.watch adapter uses the current listing
floor and preserves separate item-level markets. poe.watch publishes those as
their own rows — `Unidentified Watcher's Eye 86+`, `Unidentified Thread of Hope`
— so the resolver targets them by name before it will fall back to the
identified item, and badges the line `identified floor` when it has to.

Volume only ever disqualifies a row for being *expensive*. poe.watch keeps dead
asks alongside real ones — an Unidentified Glorious Vanity row has sat at 61.5
million chaos on `daily: 0` while a traded row for the same name quotes 2.2k —
and `lowConfidence` alone did not stop that pricing a drop. But requiring volume
outright is the wrong cure: it throws away cheap thin rows too, and every one of
those it drops pushes the quote up. So `traded()` keeps an untraded row when it
undercuts everything that moved and drops it when it sits above. A silent cheap
listing is still a listing you could have bought; a silent dear one is an ask
nobody took. When nothing for a name traded in 24 hours the rows are all there
is, which keeps prices alive in a quiet league, and genuinely dear traded markets
are untouched (Unidentified Forbidden Flame trades at both 5.2k and 28.7k, and
both rows are real).

Corrupted rows are never treated as the drop: `isWatchBaseVariant` rejects
`gemIsCorrupted`, because a corrupted copy cannot be modified further and its
price reflects that rather than what a boss hands over. The reach of this is
limited — `gemIsCorrupted` is the only corruption field in the `ItemData` schema
and the docs scope it to gems, so a corrupted *unique* is not distinguishable at
row level, and the beta endpoint's `corrupted` parameter is inert (`any`,
`false`, `no`, `true` and `0` all return byte-identical payloads, so the active
price cannot exclude corrupted listings either). What actually keeps corrupted
copies out of a boss quote is the unidentified-first rule above: an unidentified
market is priced before any identified row, corrupt or not.

Boss data names the exact
market for Watcher's Eye, Thread of Hope, Forbidden Flame and Forbidden Flesh;
the resolver prefers that alias, then a generic unidentified listing, and only
then the identified item. Aul's Uprising is the current exception: no automated
source exposes its unidentified market, while poe.watch exposes 17 identified
aura outcomes. Delve therefore uses a strict arithmetic mean of all 17 and does
not price the line if any outcome is missing. Current aggregate feeds also do not split Kurgal's one- and
two-Abyssal-socket uniques; those lines keep the live name-wide quote and are
badged `shared quote` rather than implying variant-level precision.

## Gem levelling boundary

One `stash/current/item/overview?type=SkillGem` request returns every gem at
every level/quality/corruption state poe.ninja carries, and `gems.json` keeps
them per variant with their listing counts rather than collapsing to a name.
That is the whole dataset the tab needs; nothing about gems is curated project
data.

`prices.json` still collapses gems to one price per name, and deliberately: its
consumers price a gem a boss *drops*, which is the level 1, 0% quality,
uncorrupted copy (`isBaseVariant`). The two files answer different questions
about the same rows.

Alternate quality (Anomalous, Divergent, Phantasmal) is parsed by
`parseVariant` and then dropped. You cannot Gemcutter a Superior gem into one,
so it is a different trade with a different input, and mixing the two markets
would misprice both. Vaal gems are excluded as rows for the same kind of
reason — they are inherently corrupted, so they can never be the gem you buy
and level — but they stay priceable, because a quarter of every corruption
lands on one.

Level and quality caps are read off the uncorrupted variants poe.ninja lists,
not from a table of gem names: 20/20 for a normal gem, 5/0 for an Awakened one,
3/20 for the exceptional gems. A gem listed only at level 1 has no target
market and is not a row.

Corruption follows the published Vaal Orb weights (1/4 each; level and quality
split 50/50 within their quarter; quality magnitude 1–10 uniform, capped at
23%). Two readings of the same rule exist for a gem with no Vaal version and
`vaalSlot` chooses between them: the default lets that quarter do nothing,
which keeps +1 level at the documented 1/8, while `redistribute` gives each of
the three possible effects a third and puts it at 1/6. The wiki states both the
four-way split and the 1/8 figure and does not reconcile them, so the setting
is visible in the UI rather than resolved silently.

Outcomes are quoted variant by variant. poe.ninja lists the variants people
trade, not every (level, quality) pair, so `quoteVariant` walks down to the
nearest cheaper listed variant at the same level, then up to the nearest listed
one, then to the other corruption state. Zeroing an unlisted outcome would
understate every EV on the page by an eighth; reaching up overstates instead,
which is why the substitution is badged. Rolls that share no market — the
10–19% quality band — are shown as one banded row with a weighted price and
cannot be overridden, since there is no single market to correct.

A row's headline listing count is the thinnest market carrying at least a tenth
of the expected value, plus the input. Ranking by the worst market anywhere on
the route would always be led by the level 19 nobody wants, which is not the
market the profit depends on.

`gems-selfhistory.json` stores one number per gem per run — the profit the
model saw under the default assumptions — rather than the variant prices behind
it. ~800 gems against 120 scarabs means the unthinned per-variant alternative
is a multi-megabyte hourly download, so the browser recomputes today's figures
from `gems.json` and reads the curve as a record. Overrides and the `vaalSlot`
setting therefore move the rows and not the history, and the panel says so.
The Gem Levelling change column compares that profit history over the selected
window. It requires a sample close to the requested age; when Divine-adjusted
is enabled it also uses the shared league `rateHistory` at both endpoints. The
same rate values are attached to the expanded chart so its dashed Divine-rate
line and selected-range adjustment use the identical calculation.
Points stay hourly for 48 hours and collapse to the last point of each UTC day
beyond that (the shared `thinPoints`, with a shorter window than the price
families use), capped at 400 rather than 1,200 — there are ~800 gems against
120 scarabs, so the same point count is an order of magnitude more bytes.

### Code deploys and the reuse list

A push to `main` deploys code only: the workflow sets `DATA_MODE=reuse` and
`mirrorExisting()` copies the live deployment's data forward instead of taking
a new snapshot. It **overlays** the deployment onto the checked-in tree and
removes nothing: after a repository move the checked-in files are the only copy
of the timeline, because the previous Pages site is gone. A league the
deployment no longer serves keeps whatever is checked in and is marked `stale`
rather than dropped, and the checked-in history seeds are merged point-by-point
before the derived curves are rebuilt from them.

It copies **file by file from `LEAGUE_FILES`**, so a file a run writes but that
list omits is not carried forward — the tab that reads it goes empty, and if the
missing file was a self-history, the following scheduled run starts accumulating
from zero.

The per-family names are therefore derived from
`src/games/poe1/catalogue/categories.js` via
`FAMILY_FILES()` rather than retyped. `gems.json` and its two history files are
named explicitly since gems are not an exchange category, and
`scripts/tests/poe1/test-fetch-shapes.mjs` asserts that every file a full run writes for a
league appears in `LEAGUE_FILES`.

`history.json` and `selfhistory.json` are also listed. Scarabs wrote those two
before every family shared one naming rule; they stay in the mirror list so a
code push during the changeover cannot delete the accumulated curve out from
under the run that migrates it into `scarabs-selfhistory.json`. Once a fetch run
has done that they stop existing and the entries become no-ops — safe to drop
from the list after a deploy or two.

## Where a price came from

Precedence decides the quote: the GGG digest is completed trades, so it has
absolute priority wherever it quotes a name, and poe.ninja outranks poe.watch
below it. The first two cover almost every name, so the case worth saying out
loud on a line is the third — poe.ninja does not list this item at all and the
number came from the fallback.

`getPriceMap` writes `source: "poe.watch"` on those entries and nothing on the
others, so the field marks the exception rather than adding twenty bytes to
every name in a file the browser downloads hourly. GGG deletes it when it
supersedes a name. `sourceNote` turns it into a plain `poe.watch` badge on boss
and Delve drop lines — not a warning: poe.watch is a real feed and its
unidentified markets are the only ones there are. The badge says this price is
sourced differently from everything around it, which is what you want to know
when a drop looks out of line with its neighbours.

There used to be a `contested` badge here instead. It compared the two feeds
and flagged names more than 1.5x apart, and `contestedFallback` swapped a
contested poe.watch quote for poe.ninja's. Both are gone: preferring poe.ninja
one item at a time stopped meaning anything once poe.ninja won outright, and
the badge then warned about prices that were fine.

The comparison itself survives as a **log line only**. `describeSpreads` takes
`[{ name, watch, ninja }]` — each figure the feed's own floor, the statistic a
boss line actually quotes — and prints the widest gaps in the hourly run.
poe.ninja is used either way, so there is no decision for a reader to make, but
a feed that starts pricing a different item state (the identified/unidentified
case runs orders apart) is otherwise invisible for weeks. Nothing from it
reaches `prices.json`.

## Shared UI pieces

`src/games/poe1/features/pricing/PriceChart.jsx` is the PoE 1 price graph: six callers, one
`rows = [{ day, value, chaos, rate, overlay? }]` contract. It also exports
`Sparkline`, the list-sized version — plain SVG, because instantiating Recharts
once per table row is not affordable, and it renders a dash rather than a flat
line when there are fewer than two points.
`src/games/poe1/features/pricing/PriceCell.jsx`
is the editable price cell, shared by the Boss and Delve drop tables — click
the figure to override it, `↺` to put the market price back, and the tooltip
carries the listing evidence (traded volume, listing count, listed range, thin
and stale flags). Both tables read the same resolver and write the same
`priceOverrides` map keyed by item name, so a price corrected in one is
corrected in the other. It keeps its `bp-` class names in Delve on purpose: the
two tables are meant to look identical, so the Delve boss table also takes the
Boss tab's green EV column (`.dl-table td.ev`).

## Catalogue maintenance

Every PoE 1 market family is defined once in
`src/games/poe1/catalogue/categories.js`: key, display label,
poe.ninja type, name regex, the poe.watch categories that regex may match
inside, and whether it gets its own tab. `scripts/poe1/fetch-data.mjs` and
`src/games/poe1/Poe1App.jsx` both read it, so adding a family is one entry plus a nav item
rather than the same list maintained in two places.

No list of individual item names exists anywhere in the fetch path. Families
are fetched by type and matched by name pattern, so an item GGG adds to an
existing family is priced, charted and counted in movement on the next hourly
run with no code change. Scarabs additionally group themselves: `groupForName`
in `src/games/poe1/catalogue/scarabs.js` falls back to the first word of the name, so a new scarab
joins its existing mechanic and a brand-new family creates its own group — the
Trarthan scarabs charted correctly before anything knew they existed.
`GROUP_TONES` in `src/games/poe1/Poe1App.jsx` is cosmetic; an unknown group renders in the
default colour.

`src/games/poe1/catalogue/scarabs.js` holds the full catalogue anyway, checked against poedb's
Scarab item class — poedb is generated from the game files, and the wiki runs a
league behind on scarab reworks. Three things read it: demo mode builds its
snapshot from it, it pins the mechanic for names the regex would guess wrong,
and `isCurrentScarab()` decides what the browse views show.

That last one exists because **the feeds price every scarab that still trades,
including the retired sets**. poe.ninja quotes Breach Scarab, of Splintering,
of Lordship and of Snares next to the five that replaced them — nine rows under
one mechanic, four of which nobody can farm, and a set total inflated by a
third. Mechanics, movers and Popular farms therefore read the current catalogue
only. `items` stays whole underneath, because saved strategies and price
lookups have to keep working for whatever someone owns.

Deliberately a rule and not a list of retired names: a list only covers the
retirements someone remembered to write down, and every league adds more. It
cuts the other way too — a scarab GGG adds mid-league stays out of the tab
until this catalogue is updated, which is the trade accepted for a browse view
that matches the game. The catalogue-drift report names anything new on the run
it appears, so the signal to update is already there.
`scripts/tests/poe1/test-catalogue.mjs` asserts the count (118), that no scarab sits in
two mechanics, that every name maps back to its own group, and that the retired
Breach set groups as Breach while reading as not current.

What is not automatic is a **rename**. Curated data references items by display
name — the `bosses/bossData.js` drop tables and `delve/delveData.js` biome
pools under `src/games/poe1/features/` — and
self-history is keyed by name too, so a renamed item silently unprices those
lines and restarts its own history.

`src/games/poe1/catalogue/catalogue.js` compares each family against the previously deployed
snapshot, once per run for the primary current league, and writes
`catalogue.json` beside the other files for that league:

* `renamed` — the same stable id under a different name. poe.watch assigns real
  numeric item ids; the poe.ninja exchange derives its id from the name itself,
  so only a numeric id counts as continuity. These are acted on: `applyRenames`
  rewrites the accumulated self-history keys so the item's change windows
  survive instead of restarting blank.
* `suspected` — a vanished name paired with a new one by token similarity.
  Reported, never applied. "Ritual Scarab of Wisps" and "Ritual Scarab of
  Abundance" share three of four tokens, so acting on similarity alone would
  graft a sibling's price curve onto the wrong item — worse than a day of empty
  percentages.
* `added` / `removed` — the plain remainder.
* `breaking` — the subset of the above that curated data prices by name. This
  is the only part that needs a person; it prints as `CURATED NAMES AFFECTED`
  in the Actions log.

The Overview's data-quality strip shows the same summary, so a catalogue change
is visible on the site and not only in CI output. With no previous deployment
to compare against, a family reports `first` rather than claiming its entire
contents are new.

### After a league launch

1. Read the `catalogue:` lines in the Actions log, or the Catalogue cell on the
   Overview.
2. Fix anything reported as `CURATED NAMES AFFECTED` in the relevant dataset
   under `src/games/poe1/features/`. `reportUnpricedBossItems` prints the closest priced names
   as suggestions, which separates a drifted spelling from an item no source
   lists.
3. New Delve fossils are priced and charted immediately but need a biome pool
   entry in `src/games/poe1/features/delve/delveData.js` before they enter Depth EV.

## UI composition

`src/shared/ui/AppShell.jsx` supplies the header, navigation and market-source
strip used by both games. Their visual contract lives in
`src/shared/ui/app-shell.css`: page gutters, header height, title/subtitle,
labels, controls, tabs and source text all use shared `--ui-*` tokens. New
game sections should compose these components instead of copying shell CSS.
Game-specific header artwork and feature layouts remain in the game workspace,
so PoE 2 can keep its dense boss ranking/detail layout without diverging from
PoE 1's outer scale.

`src/games/poe1/Poe1App.jsx` owns the PoE 1 market state, scarab views and tab
mounts. Its feature styles still live in the `css` string at the bottom of that
file — `bp-`, `dl-`, `ov-`, `gm-` and feature-specific `st-` rules are kept
together there. A tab whose CSS is missing renders as unstyled markup rather
than failing, so the mount and the styles have to be added together.
`src/games/poe1/features/overview/Overview.jsx` is the PoE 1 default view and
reads the same generated snapshots as
the detailed tools. It calls the pure boss and Delve calculation modules instead
of maintaining separate estimates. It stacks two briefing panels with the same
layout — feature card on the left, signal selectors on the right — one reading
upward and one downward, separated by accent colour rather than by shape so the
same position means the same thing in both. Both panels draw the same six desks —
Popular farms, Strat Watcher, Boss profit, Delve, Gem levelling and category
movers (Astrolabes and Catalysts, each labelled by its own family) — and each
desk contributes a signal only while it has an entry for that direction. The
gem desk runs the same `computeGems` the tab does on the same saved settings,
and drops thin markets whatever the tab's filter is set to: a headline is the
wrong place to lead with a profit resting on three listings. Three
decision desks and a data-quality strip follow. These are alternate
presentations of existing results, not new calculations.

`src/games/poe1/features/overview/overviewTrends.js` owns the ranking and the
shared five-second rotation.
Every desk keeps a three-deep shortlist per direction. `rotateDesks` moves the
highlighted feature card one desk per tick and only advances the entries once
the tick has been all the way round, so the page walks across the desks showing
each one's strongest entry before any shows its second — changing desk and
entry on the same tick would skip most of what the shortlists hold. Clicking a
signal pins the highlight to it; clicking the pinned one hands it back to the
rotation. Movements — scarab mechanics, saved
strategies, category prices — are sign-filtered, so a rising list holds real
gains rather than the least-bad losses. Levels rather than movements — boss net,
Delve opportunity — take a plain best/worst slice instead, since an all-negative
boss list still has a best three. Non-finite values never rank: a window without
a comparison snapshot is not a trend.
Popular farms remains a dedicated scarab-only market view. Strat Watcher owns
the searchable five-scarab-plus-Astrolabe editor and caps its collection at ten.
`src/games/poe1/features/strategies/farmStrategy.js` migrates the old
`vaal-street.farmingStrategy.v1` record
into `vaal-street.farmingStrategies.v2`, sanitises unique strategy ids and
calculates weighted nominal and divine-adjusted movement from the same live
scarab and Astrolabe rows.

Opening a saved strategy draws the shared `PriceChart` from the sum of its
items' histories. `src/games/poe1/features/strategies/stratHistory.js` does the
combining and holds the two
rules that keep the sum honest: an item with no history is dropped and named
rather than back-filled with its current price, and the plotted window is the
overlap of the items that do have history — from the latest first day to the
earliest last day — because a total that silently loses a scarab halfway back
reads as a price crash. Inside that window an item with no sample on the exact
day contributes its nearest one, since sources are sampled hourly at slightly
different minutes. Duplicate scarabs are summed once per slot, matching how
`computeFarmStrategy` prices them.

Scarab histories are fetched lazily for whatever is on screen — the open
mechanic panel or the open strategy — through one effect, so a strategy reusing
an already-charted scarab costs no extra request. The Astrolabe only joins the
line when its snapshot's `historyAxis` matches the scarab snapshot's: the two
files are day-aligned independently, so day 3 in one is not necessarily day 3 in
the other. When they disagree, the graph is scarabs-only and says so. TTK profiles stay inside Boss profit and Delve sample
profiles stay inside the Delve Assumptions panel. Boss summaries and price gaps
carry a boss id through `src/games/poe1/Poe1App.jsx`, so
their links open the relevant boss instead of the first boss in the list.

The Delve toolbar also owns a collapsible money guide. Its route priorities,
sulphite loop and historical sample are static, timestamped observations from
Duddybrainzz's 3.28 deep-Delve video. They are presentation-only: the guide does
not alter price resolution, depth curves, samples or EV. Historical profit is
explicitly labelled and remains separate from current generated snapshots. The
guide control sits beside Assumptions so both explanatory panels share one place.

## Delve estimation boundary

The six biome-exclusive fossil encounters share PoEDB tier 4 and encounter
weight 100. `src/games/poe1/features/delve/delve.js` calculates Depth EV for
one fossil node outside Smuggler's Stashes:
the community special-node chance times the live target-node value, plus the
remaining generic-node share. Opportunity is biome share times median Depth EV,
normalised to 0–100. City boss EV is calculated separately and never enters the
fossil ranking. Biome targets default to Depth EV. The Bosses view promotes
`boss chance × current drop-table EV` as the boss-loot value of an eligible city
node; it does not include normal city rewards or imply a guaranteed payout.

The assumptions panel labels the working community curves. Special-node
replacement rises linearly from each encounter's minimum depth to 90% at depth
1500. Boss-within-city chance rises linearly from each boss's minimum depth to
15% at depth 600. City biome shares still use the exact current PoEDB
effect-depth ramps (63/135/200). The constants live together in
`COMMUNITY_DEPTH_GUIDE` so official or stronger sampled curves can replace them
without changing the pricing model. Unpublished Delve boss item drop rates use
an unrelated editable, visibly marked 3% default.

Delve boss distributions use one guaranteed roll from each boss's measured
unique pool. Cards and fragments remain independent rolls. The older 3.25
sample supplies the published shares; current drops without a published sample,
such as Zorath's Eye, remain visibly preliminary and editable. Kurgal drops
Zorath's Eye of the Inevitable at the requested 50% preliminary rate — the other
three Eye variants come from unrelated content and are not in this table, so the
line prices that one item rather than an average. Exchange-backed boss drops use the
same GGG-first resolver as the main Boss profit tab.

A named node drops its own fossil and nothing else, so a biome panel lists that
one fossil rather than the biome's wider pool — that pool feeds the stash and
wall cards now, not the biome. `computeBiome` still returns it, because it is
still what the biome drops and the `openWalls` filter applies to it, but no
displayed value reads it: `depthAdjustedFound` keys off the target and the stash.

A fossil node is either the biome's special node or a Smuggler's Stash. There is
no third "generic fossil node": loose fossils drop as ordinary loot from any
node, which is not something you can steer towards. Depth EV is therefore
`specialChance × target + (1 − specialChance) × stash`, and the stash's share of
fossil nodes is the complement of the special-node curve — about 84% at depth
300, falling to 10% at the 1500 cap. `computeBiomes` exposes it as
`stash.share`, weighted by biome share because each biome's curve keys off its
own unlock depth.

Two cluster nodes sit outside the biome model and share one shape in
`src/games/poe1/features/delve/delve.js`: both draw on a mine-wide pool and hand over a cluster rather
than a single fossil. Low is the smallest cluster at the cheapest priced
outcome, high the largest at the dearest, median the mean cluster at the median
outcome — no distribution between the fossils is claimed, because none is
published. `clusterValueSeries` gives either one a price history from the pool
median, so both open the same panel a biome does, chart included.

`computeWalls` covers fractured walls. Its pool is exactly the fossils flagged
`wall` — the five a wall can hand over — which makes it the complement of the
stash pool: walls (5), stash (14) and the six biome targets partition all 25
fossils with no overlap, and a test asserts that. A wall is not a fossil node; it turns up in
the darkness on the way to one, so its 15% share
(`COMMUNITY_DEPTH_GUIDE.fracturedWall`) is per node travelled to and sits
outside the special/stash split rather than competing with it. That is a third
denominator in the Opportunity score, which is why that score stays relative.
The 4–6 drop count is a preliminary working figure.

`computeStash` models the stash itself, separately from any biome. Its pool is
every fossil that is neither one of the six biome-exclusive targets nor
reachable only behind a fractured wall — 15 fossils. The wiki says a stash chest
drops any fossil "regardless of biome", which lifts the biome restriction but
not the node restriction the same table states per fossil, and neither the
special nodes nor the walls are things a stash chest bypasses. Both exclusions
are unconditional, so unlike the biome pools this one does not move with
`openWalls`. Values come from low/median/high priced-pool outcomes rather than
assuming equal fossil probabilities.

Fractured walls are a property of the biome, not the fossil. The wiki marks
Fundamental as wall-locked in Magma Fissure and "Anywhere" in Sulphur Vents, so
each biome carries its own `walls` list and `wallIn` records where a fossil is
locked away — that is what the `openWalls` toggle filters, per biome. The
derived `wall` flag answers the coarser question the pools ask, "can a wall hand
you this at all", so it is true for any fossil with a wall entry anywhere.
Fundamental therefore belongs to the Fractured Walls pool even though Sulphur
Vents also drops it loose. It also carries a count range — 4 to 10 fossils by default — since a stash
drops a cluster: low is the smallest cluster at the cheapest pool outcome, high
the largest at the dearest, median the mean cluster at the median outcome. It
It renders as a card inside the Biome targets grid, sorted with the biomes
rather than pinned to the end, and follows the same view switcher: target value
and Depth EV both show the median stash, because depth changes which biome you
are in rather than what a stash holds, and My pace multiplies by the profile's
observed stashes per hour. Opportunity scores it as `stash share × median
stash`, normalised against the same leader as the biomes, so it can top the
grid at shallow depth and still hold a score at the 1500 cap where one fossil
node in ten is a stash. The two shares have different denominators — a biome's
is share of the mine, a stash's is share of fossil nodes — which is why
Opportunity stays a relative routing score rather than currency. The card opens
the same way a biome card does, into a panel listing the 15 pool fossils with
live prices and the cheapest/median/dearest cluster scenarios. A sample profile
with logged stashes replaces both ends of the range with its own measured
average, because a measurement is a point estimate rather than a spread.

The active Delve sample profile supplies per-encounter quantities. Its stored
observation keys remain `cacheNodes` and `cacheFossils`: they are persisted in
`sl.delve.sampleProfiles.v1`, so renaming them would discard logged samples.
Only the labels say Stash. A custom profile gets a
personal hourly projection when it contains elapsed minutes; a timed route with
zero recorded encounters remains valid zero-rate evidence. Profiles and active selection use the versioned
`sl.delve.sampleProfiles.v1` and `sl.delve.activeSampleProfile.v1` localStorage
keys; global Delve settings keep depth, wall preference and price/boss overrides.
