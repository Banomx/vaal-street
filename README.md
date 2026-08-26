# Vaal Street

Path of Exile 1 farming profitability and market price tools, plus an isolated
Path of Exile 2 boss-profit workspace.

The site opens on a compact **Overview** briefing. It reuses the existing scarab
movement, boss EV, Delve biome and category-price calculations in a selectable
headline, three decision desks and a small data-quality strip. Every result links
to the full tool. **Popular farms** keeps the existing mechanic movement layout.
The separate **Strat Watcher** stores up to ten custom setups, each with five
scarabs plus one Astrolabe. Saved icons expose their full item names immediately
on hover or keyboard focus; duplicate scarabs count as separate map-device
slots. Clicking a saved setup opens the same league graph the other tabs use,
plotting what the whole setup cost over time; clicking one of its icons overlays
that single item on it. The line covers the days every saved item has history
for — an item with no history at all is named under the graph instead of being
filled in with today's price. Overview rotates through the three strongest saved
setups every five seconds and lists up to three falling setups underneath.
Boss price-coverage warnings still open the boss that contains the first gap.

Exchange-traded prices come from **GGG's public Currency Exchange API** first.
The scheduled snapshot reads the latest completed hourly digest and calculates
the volume-weighted chaos price from the quantities that actually traded. GGG
identifies items by internal Metadata paths, so RePoE supplies the display-name
mapping; it does not supply prices.

For a configured boss drop that GGG recognizes but that did not trade in the
latest hour, the snapshot keeps a recent official price from the preceding
deployment or searches up to 24 earlier completed hours. The entry records its
actual `marketHour`, and the boss-price tooltip shows its age. Unsupported names
do not trigger this lookback.

**poe.ninja** is next, then **poe.watch**. They fill exchange items with no
usable trade in the completed GGG hour and price everything the Currency
Exchange does not cover: uniques, maps, gems, unidentified forms and roll
variants. poe.ninja's exchange overview handles the fungible half and its stash
item overview the rest — that endpoint prices essentially every other item in
the game, which is why it sits directly under GGG. poe.watch answers for what
poe.ninja does not list, and the unidentified markets (`Unidentified Watcher's
Eye 86+` and friends) are the important case: they exist on poe.watch alone and
the boss tab prices drops off them.

The order is one rule, applied everywhere — the broad price map, the category
tabs, and poe.watch's own active-price pass, which now only touches names
poe.watch supplied. One consequence is deliberate: poe.watch's exchange rows are
completed trades, and on a name poe.ninja also carries they lose to a poe.ninja
listing. GGG covers most of that ground first.

One note for anyone reading the fallback in
`scripts/poe1/sources/poewatch.mjs`: poe.watch's
`mean`/`min`/`max` are chaos, but you have to infer that — there is no Chaos Orb
row, and Exalted Orb reads 1. Identified items keep the existing mean-based
fallback; unidentified boss uniques use the current listing floor and retain
separate item-level markets where poe.watch provides them. The per-row `divine`
and `exalted` fields are inconsistent with `mean` and with each other. The divine
rate is the currency-exchange one, recovered as `mean / divine` from every row —
that ratio is the same constant across unrelated items, whereas Divine Orb's own
item listing can be thin. These figures are only used when the GGG hourly digest
is unavailable or has no usable pair.

## Run locally

Requires Node.js 18+ (you have a matching setup if `node --version` prints v18 or higher).

```bash
cd vaal-street
npm install
npm run dev
```

Open http://localhost:5173 — done.

The app reads the generated snapshots under `public/data/<game>/` first, and a
production build reads **only** those. In development it falls back to the live
poe.ninja API and then to a sample dataset if the snapshots are absent. The dev
server proxies `/ninja/*` to `https://poe.ninja/*`, so that fallback never makes
a cross-origin request.

`?data=` picks a source explicitly, in any build:

| value | source |
|---|---|
| `?data=static` | generated snapshots only (production default) |
| `?data=live` | the poe.ninja API (needs the `/ninja` proxy) |
| `?data=demo` | the deterministic sample dataset, banner-labelled |

Other useful commands:

```bash
npm test        # unit tests; data-generation tests run against fixtures
npm run build   # static output in dist/
npm run validate # publication gates against the checked-in public/data
```

## VS Code

Open the folder (`File > Open Folder...` or `code vaal-street`), then run
`npm run dev` in the integrated terminal (Ctrl+`). Vite hot-reloads on every
save under `src/`.

## Font

The UI uses **Kei Font (けいふぉんと)** — free for commercial use, Apache License
2.0. The font file isn't bundled; add it once:

1. Download: http://font.sumomo.ne.jp/fontdata-c2157415/k-font.zip
2. Extract and copy the `.ttf` to `public/fonts/keifont.ttf` (rename it to
   exactly that — the original filename contains Japanese characters).
3. Commit and push. Until the file exists, the site falls back to the previous
   serif stack automatically.

Note: the TTF is several MB because it includes thousands of kanji. If load
time ever bothers you, ask me to subset it to Latin glyphs (~50 KB).

## Host on GitHub Pages

GitHub Pages is static-only, so the repo includes a workflow
(`.github/workflows/deploy.yml`) that fetches the data **server-side** every
hour, bakes it into the site as JSON under `data/`, and redeploys. The app loads
those files first, so no browser-side proxy or API credential is needed.

One-time setup:

```bash
cd vaal-street
git init -b main
git add -A
git commit -m "Vaal Street"
git remote add origin git@github.com:Banomx/vaal-street.git
git push -u origin main
```

Then on github.com: repo **Settings > Pages > Build and deployment > Source >
GitHub Actions**. The first workflow run starts on push (or trigger it under
**Actions > Build & deploy to GitHub Pages > Run workflow**). After ~3-4
minutes the site is live at `https://banomx.github.io/vaal-street/`.

Notes:
- Prices refresh hourly, at 10 minutes past. GGG publishes one digest per
  completed hour and the run asks for the last completed one, so every skipped
  hour is a price nobody can fetch later. A thin configured boss item may use
  its most recent official trade hour from the prior 24 hours. The banner shows
  when the deployed snapshot was generated.
- Every family — scarabs, astrolabes, catalysts, fossils, resonators — is
  stored the same way, one folder per league:

  ```
  public/data/poe1/<league>/<key>.json              current prices
  public/data/poe1/<league>/<key>-selfhistory.json  raw accumulated snapshots, one point per run
  public/data/poe1/<league>/<key>-backfill.json     poe.ninja's league-long curve, fetched once
  public/data/poe1/<league>/<key>-history.json      the two stitched onto one day axis — what the site plots
  ```

- poe.ninja restructured their API in 2026 and no longer documents a public
  price-history endpoint. Where the legacy route still answers it is fetched
  **once per league** and reused from then on; everything after that comes from
  the site **accumulating its own history**: every scheduled run reads the
  previous deployment's `<key>-selfhistory.json` and appends the current
  prices. For a family with no backfill (astrolabes, catalysts) the graph
  starts at the second run and grows from there, so the earlier in the league
  you deploy the better. The 1h and 2h change buttons read those hourly points
  directly and stay unavailable until a matching earlier one exists.
- **The accumulated history lives only in the last deployment**, so a run that
  writes nothing for a family would delete it and restart the curve. Runs
  therefore carry the deployed files forward when a feed comes back empty; the
  same applies to a league that has rolled over to "previous", which keeps the
  curve it accumulated while it was current. Points stay at full resolution for
  72 hours, then collapse to one per day, and are dropped after ~14 months —
  enough room for two full 3–5 month league timelines with extra rollover room.
- You can run `npm run data` locally for both games, or `npm run data:poe1` and
  `npm run data:poe2` separately. The dev server will serve snapshots from
  `public/data/<game>/`. In development, deleting the relevant folder (or
  loading `?data=live`) goes back to the live `/ninja` proxy. Self-history needs
  the deployed site URL, so locally set
  `PAGES_BASE_URL=https://banomx.github.io/vaal-street` if you want it — same if
  you later use a custom domain. There is intentionally no history-reset input;
  accumulated timelines can only be repaired through the reviewed merge tool.

## Production build (for later, e.g. serving from your own box)

```bash
npm run build        # outputs static files to dist/
npm run preview      # serves dist/ on :5173 with the same /ninja proxy
```

A production build reads the generated snapshots only, so serving `dist/` needs
no proxy and no API credentials — any static host will do. The `/ninja` proxy
below is only needed if you want `?data=live` to work on that host:

```nginx
location /ninja/ {
    proxy_pass https://poe.ninja/;
    proxy_set_header Host poe.ninja;
    proxy_ssl_server_name on;
}
```

## Boss profit tab

Expected value per kill from each boss's drop groups, minus what it costs to
open the fight, over how long a run takes — i.e. profit per hour.

PoE 2 has its own Boss profit tab and calculation layer under
`src/games/poe2/features/bosses/`. It reports gross and net EV per kill with no
built-in timing assumptions. Users can create named TTK profiles, enter seconds
or `m:ss` per encounter, and get profit/hour only where their selected profile
has a time. Supplied wiki percentages are fixed. Rates inferred from
rarity wording, `?`, bounds, or unsampled Anomaly pools are orange, labelled
**needs review**, editable in the table, and stored only as small game-scoped
browser settings. Current prices for the active challenge league and Standard
come from `public/data/poe2/<league>/prices.json`. The normalized file retains
each quote's source, market family, GGG item class, tags, Metadata path, and
available listing or trade-volume metadata. Unique-item classes come from the
feed's GGG category and are supplemented from RePoE by Metadata id or base type.
Independent boss drops are divided into item-family tables such as Lineage
Supports, runes, reliquary keys, and Vaal currencies; guaranteed pools keep
their encounter-specific rules. The PoE 2 **Popular farms** tab groups tablets
under their league mechanic and uses each Normal precursor tablet as the price
and history baseline. Unique tablets are shown as context and never replace the
default baseline.
Cards rank by Normal-tablet value by default, expose optional movement/name
sorting, flag thin listing pools, and compare unique-tablet prices against the
baseline. Unique tablets use detailed market tiles with price,
liquidity, source, baseline difference, and a relative-value bar. A one-time history marker prevents older cheapest-rarity tablet
quotes from appearing as Normal-tablet market movement.
The client also suppresses that legacy series immediately, before the next
scheduled snapshot persists the migration marker.
`price-history.json` stores aligned hourly Exalted price series and the matching
Divine rate. The Price tracker derives groups from the stable metadata, so newly
introduced items do not need display-name rules. Unique gear is split by its
actual slot and item class in a searchable, collapsible two-level browser with
the matching item list beside it, and plots the selected item
in Exalted, Chaos, or Divine. Its Divine-adjusted option compares
`Exalted price / Exalted per Divine` at both ends of the selected window and
adds the Divine rate as a dashed second-axis line. The latest 7 days stay
hourly, then history is reduced to one point per UTC day and retained for 430 days.
Completed Currency Exchange trades come from GGG's hourly PoE 2 feed first;
poe.ninja's documented PoE 2 exchange and stash endpoints fill current exchange gaps and non-exchange items.
[PoE2Scout](https://api.poe2scout.com/swagger/index.html) is the final gap-fill
for names neither source prices; it never overwrites GGG or poe.ninja data.

The PoE 2 **Currency Exchange** tab uses GGG's completed hourly pair graph rather
than listing data. Its route finder compares every direct item/quote pair whose
quote currency also has a completed Exalted pair. Exalted, Divine, Chaos, and
less common quote currencies are therefore normalized to one Exalted-equivalent
basis. Buy mode recommends the lowest completed mean; sell mode opens by default
and recommends the highest. The selected turnover floor must be met by both the item/quote leg and
the quote/Exalted leg.

Enter a quantity to see the actual quote-currency amount, Exalted equivalent,
estimated clear time at a configurable share of observed hourly unit flow,
combined completed low/high range, and limiting route turnover. The route floor
and flow share accept custom numeric values, defaulting to 1,000 Exalted/hour
and 90% respectively; suggested liquid-market presets are available from each
field. Quantity starts at one item and can be changed for bulk checks. The
comparison is a
historical signal rather than a live fill or arbitrage promise because the two
legs may not have cleared simultaneously. The market table shows the cheapest
buy and best sell currency for every item. It defaults to a 1,000 Exalted
turnover floor, renders 20 markets initially, and expands in 20-market batches.
That floor applies both to overall item turnover and to each candidate route's
limiting leg; cheapest buy, best sell, route count, and route difference are
recalculated from the routes that pass it. The buy and sell cells display their
own limiting route turnover so unchanged qualifying routes are explicit.
The detailed chart retains
completed low/mean/high history and Divine-adjusted movement. Item selection
uses the same searchable category/subcategory browser as Price Tracker instead
of one flat dropdown. The underlying
full pair graph is stored in `exchange-markets.json` and its compact timeline in
`exchange-history.json`.

Drops don't all roll the same way, so each boss splits them into groups:

| kind | meaning | maths |
|---|---|---|
| `pool` | `rolls` drops picked from the group (the unique pool, the guaranteed fragment / astrolabe tables, and T17 fragment stacks, which use rolls > 1) | `share x rolls` |
| `weighted` | the group as a whole has a `base` chance; if it hits, one line is picked by `weight` (Uber Maven's awakened gems: 2% base, three gems at equal weight) | `base x weight / totalWeight` |
| `independent` | each line rolls on its own | `chance`, x `(1 + quantity/100)` when the group is `quantityScaled` |

The five **Tier 17 maps** are in here too, since they're the only source of uber
fragments and so belong next to the bosses those fragments open. Their fragments
drop as a *stack* sized by area item quantity, not as independent per-item rolls,
so they're modelled as a pool with multiple rolls:

| Area IIQ | fragments | roll count |
|---|---|---|
| below 235% | 1-3 | 2 |
| 235-250% | 2-3 | 2.5 |
| 250%+ | 2-4 | 3 |

Defaults sit at the low-IIQ midpoint; the roll count is editable in the group
header. Which fragment type you get is assumed uniform across the map's types.
The unique drops on those maps are a flat 5% — a community figure, not measured
data — so T17 is the one part of the dataset that's guesswork rather than source.

Area item quantity matters on the Eldritch fights — regular Exarch and Eater
default to 70%, Black Star and Infinite Hunger to 50%, which is what the
reference tool assumes. It's an editable field on those bosses.

Alongside EV there's **profit in N runs**: a seeded Monte Carlo reporting how
often N consecutive runs finish in the black. EV alone hides variance — a boss
can be solidly +EV on the back of a 1% drop and still lose you money most
sessions. The run count is configurable (default 10), and **Sort by → Safest**
ranks every boss by that probability rather than by expected value, breaking
ties on profit/hour. Each row carries its own `N% safe` badge, so the trade-off
between a big average and a reliable one is visible without switching sort.

- **`src/games/poe1/features/bosses/bossData.js`** is the dataset: one block per boss. Add a boss by copying
  a block; no other file changes. Lines carry an optional `label` (when the
  display name differs from the name used for pricing, e.g. unidentified or
  variant items) and an optional `key` (needed only when a boss lists the same
  item twice — Catarina's three Cinderswallow Urn variants).
- The boss list is exactly the set that exists in the current PoE 1 build.
  Content that has been removed from the game (the Breachlord fights, the Atziri
  apex, Aul, the Trialmaster, Lycia, Olroth) is deliberately absent.
- Exceptional support gems are drop-restricted to named bosses, and
  `test-boss.mjs` holds that mapping from poewiki and checks it **both ways** —
  every gem must appear on each boss that drops it, and no boss may claim one it
  shouldn't. Gems restricted to content this tool doesn't list (Legion generals,
  the Zealot's and Arkhon's Vaults, Vruun, Ghorr, K'tash, Beidat, Zorath, Velka,
  Kosis) are deliberately absent.
- `rates` records provenance: `ledger` for the supplied drop tables, `estimate`
  where the drops are documented but no rate is published anywhere (badged `est`
  in the UI). A `wiki` value is also supported for adding a boss from poewiki.
- Everything is editable — times, rates, weights, quantity, entry counts and
  prices. Edits live in **TTK profiles** saved to `localStorage`.
- The **TTK profiles** view manages those profiles: create, duplicate, rename,
  export/import as JSON, switch which one is in use, and edit every boss's kill
  time in one grid laid out by content type. Times are `m:ss` (a plain number is
  read as seconds); fields that differ from the default are highlighted, and
  clearing a profile's overrides puts every boss back to the built-in time.
- Default kill times match the reference tool's own TTK profile, so the kills-per-hour
  figures line up out of the box.
- **Blaster** is a shipped preset, badged `preset` beside your own profiles:
  half the default kill time. Every profile carries a speed tag — `2x` for that
  one, `1x` for an unedited profile — in both the picker and the card, so which
  is quicker needs no digging. It is the median of each boss's default time over
  the profile's, so a floored or rounded boss cannot drag it. A few fights are
  set by their mechanics rather than your damage and carry their own figure:
  both Shapers at 3:00, slower than halving would give, because phases and
  dialogue do not care about damage; and King in the Mists at a flat 0:30, which
  is a floor on any preset since that run is mostly arena.
  Setup/travel is left alone — a faster build does not walk to the map device any
  quicker — so the tier 17 maps keep their full minute. Presets are derived from
  the defaults in `bossData.js` rather than a copied table, so changing a default
  kill time updates them too. They are never written to `localStorage` and cannot
  be deleted or renamed; **Duplicate** gives you an editable copy, and editing one
  directly makes that copy for you.
- Prices come from `public/data/poe1/<league>/prices.json`, written by the same
  workflow that snapshots scarabs — GGG first, then poe.ninja, then poe.watch.
  Items missing from all three are flagged `no price` rather than silently
  counted as zero.
- Unidentified drops are priced from the unidentified market when available.
  Exact item-level aliases distinguish Watcher's Eye, Thread of Hope, Forbidden
  Flame and Forbidden Flesh drops; the identified item is only a final fallback.

Two test scripts and a probe:

```bash
npm run test:poe1                                      # all PoE 1 checks
node scripts/tests/poe1/test-fetch-shapes.mjs          # snapshot vs. endpoint shapes
node scripts/poe1/tools/probe-price.mjs "Orb of Dominance" # locate an item
```

`probe-price.mjs` exists because the snapshot has to decide up front which
endpoint serves what, and the docs have been wrong about that more than once. It
throws every type at every endpoint family and reports where a name really
lives, plus how many rows each combination returned — so "this item has no
price" becomes a fact instead of a guess. It writes nothing. `--counts` skips
the search and just prints the per-endpoint totals, which is how you spot a
category returning suspiciously few rows.

Its most useful finding so far: **poe.ninja renders a page for every known item,
but the overview endpoints only return items with confirmed price data.** A URL
like `/poe1/economy/allflame/currency/orb-of-dominance` existing does not mean
the API will price it.

For the handful of drops in that state, a line can declare its own price:

```js
{ item: "Orb of Dominance", chance: 0.03, fallback: { divine: 3.7 } }
```

It is used *only* when poe.ninja returns nothing for that name — a real listing
always wins — and `divine` is the better unit, since it tracks the divine rate
instead of going stale the moment chaos moves. `asOf` records when the figure was
last checked: the UI badges these `set`, and `set 45d` once a month has passed,
so an old hand-typed number announces itself rather than passing as current. The
snapshot lists them with their age, separately from genuine misses.

### GGG Currency Exchange coverage

[GGG's Currency Exchange endpoint](https://www.pathofexile.com/developer/docs/reference#currencyexchange)
is public and needs no OAuth client.
`scripts/poe1/sources/ggg-exchange.mjs` reads the latest
completed hourly digest, filters it by league and calculates an item's chaos
price as `chaos volume / item volume`. An item with no direct Chaos pair can use
its direct Divine pair and that hour's GGG Divine-to-Chaos rate. If a configured
boss item has a current market row but no completed trade, a bounded lookup can
recover its most recent official price from the preceding 24 hours. The normal
hourly workflow retains that result while it remains within the same age limit,
so it does not repeatedly download the history.

The feed contains internal Metadata paths rather than display names. The
snapshot resolves them through RePoE's `base_items.min.json`; RePoE is metadata
only and never contributes a price. The hourly feed does not cover the current
hour or non-exchange items, so poe.ninja and poe.watch remain necessary for
uniques, maps, gems, roll variants and thin or missing markets.

`test-boss.mjs` checks every pool's shares sum to ~1, that drop keys are unique
per boss, and that EV reproduces the reference tool's numbers for the same rates
and prices (including quantity scaling and the weighted gem group).

`test-fetch-shapes.mjs` guards the three things that have actually broken here:

1. **Which endpoint serves what.** Per [poe.ninja's docs](https://poe.ninja/docs/api),
   bulk goods — currency, *fragments*, scarabs, astrolabes, omens, embers — come
   from `exchange/current/overview`, while uniques, gems, div cards and maps come
   from `stash/current/item/overview`. Reading fragments from the currency
   endpoint gives numbers that look plausible and are wrong.
2. **The chaos conversion.** Exchange lines quote `primaryValue` in a *primary
   reference currency* that isn't always chaos, and the docs don't define the
   sign of `core.rates`. So the script calibrates on Chaos Orb itself —
   `chaos = primaryValue / primaryValue(Chaos Orb)` — which is exact whatever the
   primary is, and logs Chaos Orb's computed price as a self-check (it must be 1).
3. **Coverage.** The docs enumerate exactly which `type` values each family
   accepts, and it's worth following them literally — `DivinationCard` is a valid
   *exchange* type, and leaving it out of that list is what made cards read as
   unpriced. Sources are ranked, and a name found by an earlier one is never
   re-priced by a later one:

   | rank | endpoint | covers | units |
   |---|---|---|---|
   | 1 | `exchange/current/overview` | everything fungible: currency, fragments, scarabs, astrolabes, omens, essences, oils, divination cards | needs calibration |
   | 1 | `stash/current/item/overview` | non-fungible, priced per listing: uniques, gems, maps, **invitations**, incubators, vials, memories, beasts | chaos |
   | 2 | `stash/current/currency/overview` | PoE 1 only, same goods as the exchange priced the older way — gap-fill only | chaos |

   The published type lists have disagreed with reality more than once, so any
   type that comes back empty from its documented family is retried against the
   other one before being written off. Every run prints which sources answered,
   how many names the gap-fill added, and the boss items that ended up with no
   price at all — so a gap shows up in the workflow log instead of on the site.

The test stubs `fetch` with a deliberately **non-chaos primary**, makes every
legacy `/api/data/*` path 404, and runs the real script end to end. `DATA_OUT`
redirects the PoE 1 output directory so it never touches `public/data/poe1/`.

Two naming wrinkles it also pins:

- poe.ninja's line ids are slugs, and slugs lose apostrophes — `awakeners-orb`
  can't be turned back into `Awakener's Orb` by guessing. The script borrows real
  names from the stash currency overview as a dictionary (names only; its prices
  are not what we quote against) and matches them on letters and digits alone.
- Maps are labelled inconsistently: the tier 17s are grouped under "Nightmare
  Map" and the base type isn't always the display name. The snapshot indexes map
  lines under both `name` and `baseType`, and prints the tier 17 listings it
  found so their entry costs can be named from fact rather than guesswork. On the
  app side, a price lookup falls back to aliases and then to a
  punctuation-insensitive match, trying the name with and without a trailing
  "Map" — so a near-miss doesn't silently read as `no price`.

## Delve tab

The Delve tool has three views:

- **Fossils & resonators** shows live prices, history, pool value ranges and
  current fractured-wall targets.
- **Biome targets** opens on Depth EV, the practical estimate for one fossil
  node outside Smuggler's Caches at the
  selected depth. It blends the live special-target value with the generic
  fossil-node range using the labelled community special-node curve. Target value
  isolates the special encounter; Opportunity is a relative 0–100 routing score
  from biome share and Depth EV.
- **Bosses** keeps Ahuatotli, Kurgal and Aul separate from fossil routing. Each
  boss has a guaranteed unique pool plus separate card/fragment rolls, with
  preliminary or unpublished rates visibly flagged for the player to edit.
  Unpublished rates start at a marked 3% default. The view shows value and
  distribution per kill plus city-biome share. Each boss card keeps the current
  median beside exact expected value and revalidates the hourly market snapshot.
  A labelled community curve also
  leads with the estimated boss-loot value of an eligible city node, then shows
  value and distribution per kill. Boss cards/fragments use GGG pricing first; unique
  markets fall back to poe.ninja, then poe.watch. Kurgal's preliminary Eye line
  uses the live arithmetic mean of all four variants and expands to show each
  underlying price. Aul's Uprising similarly shows the strict mean and complete
  breakdown of all 17 identified aura outcomes because no automated source
  exposes the unidentified market.

**My samples** is inside Assumptions beside the active guide values. It stores a
built-in Guide baseline and custom observation profiles. Encounter counts,
fossil totals and minutes can replace guide quantities and unlock a personal
priced-pool hourly range; a timed route with no encounters remains a valid dry
sample.

**How to make money**, beside the Assumptions control, opens a compact pathing
guide sourced from Duddybrainzz's
3.28 depth-5000 test. It separates route priorities and sulphite setup from the
historical six-hour result, links each point to its video timestamp and never
feeds the old league prices or reported hourly rate into the live calculator.

PoEDB supplies biome weights plus exclusive encounter tier, weight and minimum
depth. All six exclusive encounters are tier 4 with weight 100, which supports
a relative comparison. Because the server curve is not public, the working
community model rises linearly from each special node's unlock depth to a 90%
replacement chance at depth 1500. Generic nodes and Smuggler's caches still use
low/median/high pool scenarios rather than an equal-weight fossil average.
The current city-biome ramps are exact: Vaal Outpost reaches full weight at
depth 63, Abyssal City at 135 and Primeval Ruins at 200. Boss selection inside
those cities uses the same explicit working approach: linear from each boss's
minimum depth to a 15% chance per eligible city node at depth 600. The estimates
are marked experimental and can be replaced if a better source appears.

The Guide baseline uses three exclusive fossils per target, two fossils per
generic node and five per cache. Each value is labelled as guide evidence or a
conservative fallback. Custom profile observations replace each category
independently; zero observations never create a fake hourly number.

`scripts/poe1/fetch-data.mjs` writes the fossil/resonator price and history snapshots.
`node scripts/tests/poe1/test-delve.mjs` covers dataset integrity, value ranges,
opportunity normalisation, sample-profile calculations and boss EV.

## Divine-adjusted prices ("did it go up, or did chaos deflate?")

Chaos drifts against divine all league, so a scarab that reads +20% in chaos can
be *down* in real terms. The **Divine-adjusted** checkbox in the toolbar (Scarabs,
Popular farms, Astrolabes, Catalysts — the boss tab doesn't need it) answers that:

- the price chart gains a dashed **chaos-per-divine** line on its own right-hand
  axis, so a rising price sitting under a faster-rising rate is obvious at a glance;
- dragging a range on the chart shows both the nominal move and the **real** one,
  e.g. `▲ 12.1% · real ▼ 24.8%`;
- every ▲/▼ badge switches to the divine-denominated change, marked with a small
  `div`. Popular farms re-ranks off those numbers, so a mechanic only counts as
  heating up if it outran the divine;
- the status line reports what the divine itself did over the selected window.

Real change is `(price_now / rate_now) / (price_then / rate_then) - 1` — the move
priced in divine, using the rate **as it was on each end of the window**, not
today's. Divine isn't a perfectly stable unit either, but it's the one the
player base actually anchors to.

Where the data comes from: every snapshot stores the divine rate alongside the
prices in `<key>-selfhistory.json`, and the script emits one `rateHistory`
series per league, on the same day axis as the price history and repeated into
every family's file. On top of that it makes one attempt per league
at poe.ninja's legacy `currencyhistory` endpoint to backfill the league so far —
that endpoint has a habit of dying and of quoting the ratio upside down, so the
result is sanity-checked and silently dropped when it looks wrong. With no
backfill the curve simply grows from our own hourly snapshots.

Consequences worth knowing:

- the checkbox is **disabled** until there are two rate points — on a fresh
  league without backfill that normally takes one to two hourly runs;
- snapshots taken before this feature existed have no rate, so their change
  windows can't be converted; those badges stay in chaos until the windows roll
  past the old points. The status line says so when that's the case;
- the live-API fallback (no static snapshots) has no rate curve at all, so the
  toggle stays off there.

The selectable windows are 1h, 2h, 4h, 8h, 12h, 24h and 48h. Short windows
come from the site's hourly self-history. poe.ninja's daily sparkline can only
fill 24h/48h when self-history is not ready. A window resolves only against a
point of roughly the right age — after a missed run the affected badges go
blank rather than quoting a four-hour-old move as a 1h one.

`node scripts/tests/poe1/test-rate.mjs` covers the whole data path: rate storage, the
nominal-vs-real split, the upside-down backfill, and the day-axis alignment.
`node scripts/tests/poe1/test-history.mjs` covers the layer under it: backfill reuse,
stitching, the shared axis, carry-forward and thinning.

## Where things live

- `src/app/` — application boot and the PoE 1 / PoE 2 selection only.
- `src/shared/` — game-neutral UI, data paths, scoped storage, and the snapshot
  contract (`shared/data/snapshot.js`, `shared/data/dataMode.js`).
- `src/games/poe1/Poe1App.jsx` — PoE 1 shell, navigation, data loading, styles.
- `src/games/poe1/catalogue/` — PoE 1 market families and scarab catalogue.
- `src/games/poe1/features/` — feature-owned UI, calculations and datasets:
  `bosses`, `delve`, `gems`, `overview`, `pricing` and `strategies`.
- `src/games/poe2/` — PoE 2 shell and isolated PoE 2-only features.
- `scripts/shared/` — staging, publication gates, source provenance, RePoE.
- `scripts/poe1/`, `scripts/poe2/` — each game's snapshot pipeline, endpoint
  registry (`endpoints.mjs`) and publication gates (`validate.mjs`).
- `scripts/tools/merge-pages-artifact.mjs` — merge a downloaded Pages artifact
  back into `public/data` after a deployment loss.
- `scripts/tests/{shared,poe1,poe2}/` — tests, separated from operational scripts.
- `public/data/<game>/<league>/` — generated snapshots split by game and league.
- `public/data/<game>/quality.json` — the last run's publication-gate report.
- `vite.config.js` — the `/ninja` proxy for dev and preview.

See `AGENTS.md` for the short maintenance map and `docs/architecture.md` for
the ownership and data-retention rules.

- Scarab grouping is derived from names automatically; new scarabs poe.ninja
  adds get sorted into the right mechanic without code changes. They join the
  Scarabs tab once they are in `src/games/poe1/catalogue/scarabs.js`, which is
  also what keeps the
  retired sets — still traded in the permanent leagues — out of it.

## Notes

- If a published snapshot cannot be read — missing, unparseable, or written by a
  newer schema than the build — the page says so and shows nothing rather than
  substituting sample data. `quality.json` warnings and a stale timestamp are
  surfaced the same way. Sample data only ever appears under `?data=demo`.
- Price history loads lazily per mechanic (one request per scarab in the
  group, cached), so opening a group the first time takes a moment.
- 1h–12h change comes from accumulated hourly snapshots. 24h/48h can also fall
  back to poe.ninja's daily sparkline, i.e. "since yesterday's / the day
  before's data point".
- Every % in the app is a chaos figure unless the Divine-adjusted box is
  ticked; see the section above for what changes when it is.
