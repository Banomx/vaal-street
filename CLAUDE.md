# Claude Code instructions

Read `AGENTS.md` completely before working in this repository. It is the
authoritative project guide for architecture, data preservation, documentation,
Git behaviour and verification. This file adds Claude-specific working habits;
it does not replace or duplicate `AGENTS.md`.

If this file and `AGENTS.md` ever disagree, stop and point out the conflict
instead of choosing silently. Keep durable repository rules in `AGENTS.md` and
keep changing API details in `docs/architecture.md`, the relevant
`endpoints.mjs` file, source-adapter comments and regression tests.

## General

Work pragmatically and prefer simple, maintainable solutions.
Follow the existing structure, conventions, and style of a project before introducing new ones.
Do not create unnecessary files, abstractions, summaries, or additional complexity.
Improve the modules that exist rather than rewriting them wholesale.

## Start every task safely

Before editing:

1. Run `git status --short`, `git branch --show-current` and `git remote -v`.
2. Read the relevant implementation, its tests, `docs/architecture.md`, and
   today's existing note under `docs/daily-recap/`.
3. Preserve unrelated and uncommitted user work. Never reset or rewrite it.
4. Prefer improving the existing module over creating a parallel framework.
5. State any assumption that could materially change the result.

Do not commit or push unless the user explicitly asks. Never add
`Co-authored-by`, Claude/AI attribution, or generated-by text.

## Protect market history

Treat `public/data/` as valuable state, not disposable build output. Upstream
services cannot recreate the accumulated timelines.

- Do not run a live fetch, reuse deployment, cleanup, history reset or other
  command that can rewrite `public/data/` until the preservation procedure in
  `AGENTS.md` has been followed.
- Do not add a history-reset switch. Deliberate recovery uses the reviewed merge
  tool, never a fetcher flag.
- Never let a shorter deployed history replace a richer local or downloaded
  Pages history.
- Use `scripts/tools/merge-pages-artifact.mjs` for a downloaded Pages artifact
  and review its reported merge before accepting the result.
- Generate into staging, validate the complete candidate, and promote only a
  successful dataset. A failed fetch must leave the last known good dataset
  intact and return a failing status.
- Missing data is unknown, never zero. Do not fabricate flat or one-point
  history to make a chart appear complete.

Tell the user before performing a live fetch or touching recovered history.
Fixture-backed tests and read-only audits do not need additional confirmation.

## Implementation boundaries

- Keep PoE 1 rules under `src/games/poe1/` and `scripts/poe1/`.
- Keep PoE 2 rules under `src/games/poe2/` and `scripts/poe2/`.
- Put only genuinely game-neutral contracts, publication logic and UI
  infrastructure in `src/shared/` or `scripts/shared/`.
- Normalize and validate external responses at their source adapter. Preserve
  provenance, observation time, stable identity and useful liquidity evidence.
- Prefer Metadata paths for identity. Source-scoped IDs and name fallbacks must
  retain their scope/confidence and must not silently prove a rename.
- Select prices through the documented resolver; do not overwrite source
  observations before their freshness, liquidity and item-state compatibility
  have been evaluated.
- A published shape change requires the schema-version and reader-compatibility
  updates described in `AGENTS.md`.
- Production UI must render only validated snapshots and must distinguish
  ready, degraded, stale, missing, corrupt and incompatible states.

When an upstream shape appears to have changed, verify it against current
primary documentation and a captured response fixture. Do not add speculative
endpoint types or encode a transient response shape without a regression test.

## Verification

Use the narrowest relevant tests while iterating. Before handing off a
structural, cross-feature or data-contract change, run:

```text
npm test
npm run build
npm run validate
```

Data-generation tests must use fixtures, not live APIs. If a live data run is
later authorized, compare league counts, selected-price counts, metadata
coverage, rejected rows, history lengths, source contribution and quality
status against the previous valid dataset before accepting it.

Do not weaken validation merely to make an existing malformed snapshot pass.
Repair or explicitly migrate the data, preserving recoverable history.

## Documentation and handoff

Update existing documentation as part of the implementation, following
`AGENTS.md`. Do not create progress-report or summary files.

At handoff, report concisely:

- the user-visible outcome;
- important implementation or data-contract decisions;
- files or areas changed;
- tests and validation actually run;
- anything not verified, especially live-source behaviour;
- whether generated data or recovered history changed;
- the final `git status --short` state.

Do not claim a task is complete while required checks are failing or while a
known data-preservation issue remains unresolved.
