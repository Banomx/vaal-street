## General

Work pragmatically and prefer simple, maintainable solutions.
Follow the existing structure, conventions, and style of a project before introducing new ones.
Do not create unnecessary files, abstractions, summaries, or additional complexity.

## Documentation

Treat documentation as part of the implementation.

When a change affects existing documentation:

* update the relevant documentation
* replace outdated information
* remove information that is no longer correct
* merge duplicate information where appropriate

Do not simply append new sections after every change.
Before creating a new documentation file, check whether the information belongs in an existing one.
Documentation should primarily describe the **current state** of the system or project, not the history of individual changes.
Do not automatically create files such as `SUMMARY.md`, `CHANGES.md`, `IMPLEMENTATION.md`, or similar unless they are actually needed.

## Documentation Style

Write documentation for another technical person who needs to understand, operate, troubleshoot, or reproduce the setup.

Keep it:

* practical
* concise
* technically precise
* easy to follow
* human-written in tone

Prefer concrete commands, paths, configuration examples, and short explanations over lengthy prose.
Avoid overly polished corporate or AI-style language, unnecessary introductions, conclusions, filler, and exaggerated wording.
Explain non-obvious decisions when they would help someone understand why something was implemented a certain way.
For troubleshooting information, document the useful result rather than a chronological diary of everything attempted.

## Accuracy

Do not document assumptions as facts.
Make sure documented commands, paths, configuration, and behavior match the actual implementation.
If something was not verified, make that clear.

## Documentation

Main documentation is in `docs/`.
Keep `README.md` limited to setup and basic usage.
Archtiecture decision belong in `docs/architecture.md`.
If documentation exposes infrastructure or sensitive information, prefix it and add it to .gitignore.
Keep documentation relevant and updated, not only append to it.

## Daily Notes

Write Daily (timestamped) notes in markdown under docs/daily-recap
Be concise and not overly formal.
Only put the important info in a daily.
If you iterate over something, remove stale info from todays daily.
Keep dailys relevant and updatet, not only appended to.




# Project navigation

Use this map before changing code. Keep game-specific rules inside that game's
directory; share only infrastructure that is genuinely game-neutral.

## Application

- `src/app/` — bootstrapping and game selection only.
- `src/shared/` — game-neutral UI, data-path, and storage infrastructure.
- `src/games/poe1/Poe1App.jsx` — PoE 1 shell, navigation, fetching, and styles.
- `src/games/poe1/catalogue/` — PoE 1 market-family and scarab catalogues.
- `src/games/poe1/features/<feature>/` — a feature's UI, calculations, and
  curated data together. Cross-feature helpers currently live in `pricing/`.
- `src/games/poe2/Poe2App.jsx` — PoE 2 shell, navigation, and price loading. Add PoE 2 features under
  `src/games/poe2/features/<feature>/`; do not import PoE 1 feature code.

If both games need the same behavior, extract the smallest game-neutral part to
`src/shared/`. Do not move PoE-specific names, leagues, endpoints, or formulas
into shared code merely because they look similar today.

## Data and scripts

- `public/data/<game>/index.json` — leagues available for that game.
- `public/data/<game>/<league>/` — generated, feature-split JSON snapshots.
- `scripts/poe1/fetch-data.mjs` — PoE 1 snapshot orchestrator.
- `scripts/poe1/sources/` — external PoE 1 feed adapters.
- `scripts/poe1/tools/` — manual PoE 1 diagnostics.
- `scripts/tests/poe1/` — PoE 1 tests mirroring source ownership.
- `scripts/poe2/fetch-data.mjs` — PoE 2 league and current-price snapshot.
- `scripts/tests/poe2/` — PoE 2 tests mirroring source ownership.

Use `src/shared/storage/jsonStore.js` only for small settings and saved inputs.
Bulk timelines belong in generated JSON; large mutable client-only data belongs
in IndexedDB, and shared/queryable data belongs behind an API/database.

## Change rules

- General website shell or game selector: change `src/app/` or `src/shared/`.
- PoE 1 feature: stay inside its `src/games/poe1/features/<feature>/` folder,
  then update `Poe1App.jsx` only when navigation or shared orchestration changes.
- PoE 2 feature: create the matching `src/games/poe2/features/<feature>/`
  folder and its own data pipeline/tests; keep its persisted keys game-scoped.
- Adding a market family: update `src/games/poe1/catalogue/categories.js` and
  the PoE 1 navigation. Do not duplicate the family list in the fetcher.
- Update `docs/architecture.md`, current README commands/paths, and today's
  `docs/daily-recap/` entry when structure or behavior changes.

Run `npm test` and `npm run build` after structural or cross-feature changes.
