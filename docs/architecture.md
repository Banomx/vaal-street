# Architecture

## Market snapshot pipeline

The React app is static and reads generated JSON from `public/data/`. GitHub
Actions runs `scripts/fetch-data.mjs` at 17 minutes past every hour, builds the
site and deploys it to GitHub Pages.

Price precedence is:

1. GGG's public Currency Exchange hourly digest for completed exchange trades.
2. poe.watch for missing exchange markets and non-exchange listings.
3. poe.ninja for remaining gaps and roll-variant detail.
4. For configured boss items still unpriced by those sources, the most recent
   completed GGG trade hour within the preceding 24 hours, but only when the
   current GGG market data recognizes the item.
5. Explicit, dated fallback values in the boss/Delve datasets when all market
   sources lack the item.

`scripts/ggg-exchange.mjs` requests the previous completed UTC hour from
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
unavailable, the snapshot completes with poe.watch and poe.ninja instead.

Each deployed JSON file records `generatedAt`; files using GGG also record
`gggHour`, the newest completed market hour used by the snapshot. Individual
GGG entries record `marketHour`, which differs when a thin boss item came from a
recent earlier hour. The existing `selfhistory.json` files accumulate hourly
snapshots for charts and the 1h/2h/4h/8h/12h/24h/48h change fields. Short
windows remain absent until a sufficiently old snapshot exists; they are never
estimated from the daily poe.ninja sparkline.

## Coverage boundary

The GGG feed prices only items with completed trades on the in-game Currency
Exchange. The normal basis is the selected hour; the bounded boss-gap lookup can
use a recent earlier completed hour for a currently recognized thin item.
Uniques, maps, gems, unidentified forms and roll variants generally require
poe.watch or poe.ninja. Boss drop rates and Delve biome rules remain curated
project data and are not supplied by any price API. Delve biome weights and
encounter tier/weight/minimum-depth fields are transcribed from current PoEDB
data-mined tables; creator observations are labelled separately.

For unidentified boss uniques, the poe.watch adapter uses the current listing
floor and preserves separate item-level markets. Boss data names the exact
market for Watcher's Eye, Thread of Hope, Forbidden Flame and Forbidden Flesh;
the resolver prefers that alias, then a generic unidentified listing, and only
then the identified item. Aul's Uprising is the current exception: no automated
source exposes its unidentified market, while poe.watch exposes 17 identified
aura outcomes. Delve therefore uses a strict arithmetic mean of all 17 and does
not price the line if any outcome is missing. Current aggregate feeds also do not split Kurgal's one- and
two-Abyssal-socket uniques; those lines keep the live name-wide quote and are
badged `shared quote` rather than implying variant-level precision.

## Catalogue maintenance

Every market family is defined once in `src/categories.js`: key, display label,
poe.ninja type, name regex, the poe.watch categories that regex may match
inside, and whether it gets its own tab. `scripts/fetch-data.mjs` and
`src/App.jsx` both read it, so adding a family is one entry plus a nav item
rather than the same list maintained in two places.

No list of individual item names exists anywhere in the fetch path. Families
are fetched by type and matched by name pattern, so an item GGG adds to an
existing family is priced, charted and counted in movement on the next hourly
run with no code change. Scarabs additionally group themselves: `groupForName`
in `src/App.jsx` falls back to the first word of the name, so a new scarab
joins its existing mechanic and a brand-new family creates its own group.
`GROUPS` there lists only the irregular names — Horned, Universal, Influencing
— and seeds the demo snapshot. `GROUP_TONES` is cosmetic; an unknown group
renders in the default colour.

What is not automatic is a **rename**. Curated data references items by display
name — `src/bossData.js` drop tables, `src/delveData.js` biome pools — and
self-history is keyed by name too, so a renamed item silently unprices those
lines and restarts its own history.

`src/catalogue.js` compares each family against the previously deployed
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
2. Fix anything reported as `CURATED NAMES AFFECTED` in `src/bossData.js` or
   `src/delveData.js`. `reportUnpricedBossItems` prints the closest priced names
   as suggestions, which separates a drifted spelling from an item no source
   lists.
3. New Delve fossils are priced and charted immediately but need a biome pool
   entry in `src/delveData.js` before they enter Depth EV.

## UI composition

`src/App.jsx` owns the shared shell, global market controls and scarab views.
`src/Overview.jsx` is the default view and reads the same generated snapshots as
the detailed tools. It calls the pure boss and Delve calculation modules instead
of maintaining separate estimates. It stacks two briefing panels with the same
layout — feature card on the left, signal selectors on the right — one reading
upward and one downward, separated by accent colour rather than by shape so the
same position means the same thing in both. Both panels draw the same five desks —
Popular farms, Strat Watcher, Boss profit, Delve and category movers — and each
desk contributes a signal only while it has an entry for that direction. Three
decision desks and a data-quality strip follow. These are alternate
presentations of existing results, not new calculations.

`src/overviewTrends.js` owns the ranking and the shared five-second rotation.
Every desk keeps a three-deep shortlist per direction and both panels advance
through their shortlists on the same tick. Movements — scarab mechanics, saved
strategies, category prices — are sign-filtered, so a rising list holds real
gains rather than the least-bad losses. Levels rather than movements — boss net,
Delve opportunity — take a plain best/worst slice instead, since an all-negative
boss list still has a best three. Non-finite values never rank: a window without
a comparison snapshot is not a trend.
Popular farms remains a dedicated scarab-only market view. Strat Watcher owns
the searchable five-scarab-plus-Astrolabe editor and caps its collection at ten.
`src/farmStrategy.js` migrates the old `vaal-street.farmingStrategy.v1` record
into `vaal-street.farmingStrategies.v2`, sanitises unique strategy ids and
calculates weighted nominal and divine-adjusted movement from the same live
scarab and Astrolabe rows. TTK profiles stay inside Boss profit and Delve sample
profiles stay inside the Delve Assumptions panel. Boss summaries and price gaps carry a boss id through `src/App.jsx`, so
their links open the relevant boss instead of the first boss in the list.

The Delve toolbar also owns a collapsible money guide. Its route priorities,
sulphite loop and historical sample are static, timestamped observations from
Duddybrainzz's 3.28 deep-Delve video. They are presentation-only: the guide does
not alter price resolution, depth curves, samples or EV. Historical profit is
explicitly labelled and remains separate from current generated snapshots. The
guide control sits beside Assumptions so both explanatory panels share one place.

## Delve estimation boundary

The six biome-exclusive fossil encounters share PoEDB tier 4 and encounter
weight 100. `src/delve.js` calculates Depth EV for one fossil node outside Smuggler's Stashes:
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
such as Zorath's Eye, remain visibly preliminary and editable. Kurgal currently
uses the requested 50% preliminary rate. Its conditional value is the arithmetic
mean of Malevolence, Authority, the Inevitable and the Endless; the row expands
to expose the four live inputs, and the one-kill simulation rolls an actual
variant rather than a fixed average item. Exchange-backed boss drops use the
same GGG-first resolver as the main Boss profit tab.

Generic fossil nodes use low/median/high outcomes from the priced biome pool
instead of assuming equal fossil probabilities.

A Smuggler's Stash is modelled separately by `computeStash`, because it is not a
biome encounter. Its pool is every fossil that is not one of the six
biome-exclusive targets, taken across the whole mine rather than the biome you
are standing in, and it follows the same `openWalls` setting the biome pools
use. It also carries a count range — 4 to 10 fossils by default — since a stash
drops a cluster: low is the smallest cluster at the cheapest pool outcome, high
the largest at the dearest, median the mean cluster at the median outcome. It
appears as its own card at the end of the Biome targets grid, outside the biome
ranking, since it has no share of the mine and no depth ramp. A sample profile
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
