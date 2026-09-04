# Quick Task 260903-n2o: provenance-aware headline eligibility - Context

**Gathered:** 2026-09-03
**Status:** Ready for planning

<domain>
## Task Boundary

Quick task `260903-krp` replaced the fixed tune/holdout split with
`isHeadlineEligible(season, corpusSeasons)` — "eligible if at least two distinct prior seasons
exist". **That rule encodes a PREMISE it never checks.** The premise is "this season's
hyperparameters were selected using only seasons before it", which becomes true only once the
rolling-origin re-tune promotes origin-selected parameters. **It has not.**

Verified 2026-09-03: the shipped `data/algorithm-versions/vpr@7.0.0+tuned-2026-08.json` carries
`provenance.tuneSeasons: [2022, 2023, 2024]` and objective "mean tune-season brierScore". The
rolling-origin runs that exist (`reports/tune-joint-*-origin*.json`) all returned
`keep-incumbent`, so no origin-selected parameter set was ever promoted.

The retired `TUNE_SEASONS = [2022,2023,2024]` made a tune season headline-ineligible
**structurally**. `260903-krp` removed that guarantee and replaced it with an assumption. Nothing
in the repo reads `provenance.tuneSeasons` — `promote.ts` writes it at :474/:582 and no consumer
exists.

An adversarial review raised 23 findings; 16 were refuted and **7 survived**. This task fixes the
survivors.

</domain>

<decisions>
## Implementation Decisions — LOCKED

### D-1 — Eligibility requires BOTH ordering AND provenance

    headlineEligible =
        (>= 2 distinct prior seasons in the corpus)      // the existing rule, keep it
      AND (this season is NOT in the scoring algorithm's selected-on set)

The second clause restores the structural guarantee `260903-krp` deleted. Without it the rule
asserts a property of the OPTIMIZER while reading only a list of years.

### D-2 — The selected-on set is per-ALGORITHM and must be passed explicitly

`aggregateScores` scores several algorithms in one call (`epa`, `opr`, `vpr`), each with its own
provenance. The set therefore keys by `algorithmId`.

**It must be a required input with no silent default**, for exactly the reason `corpusSeasons` is:
a default of "empty" means "nothing was tuned on anything", which is the most permissive possible
claim and would silently restore today's bug. An algorithm genuinely never tuned (a baseline)
must say so explicitly.

Source of truth is `provenance.tuneSeasons` in the promoted version file
(`ProvenanceSchema`, `promote.ts:142`). Do not invent a second record of the same fact.

### D-3 — The honest eligible set TODAY is {2025, 2026}

With the shipped `tuneSeasons: [2022,2023,2024]`:

| season | >=2 priors? | selected on? | eligible |
|---|---|---|---|
| 2022 | (see D-4) | YES | **no** |
| 2023 | yes | YES | **no** |
| 2024 | yes | YES | **no** |
| 2025 | yes | no | **yes** |
| 2026 | yes | no | **yes** |

**That is exactly what ships today**, which is the point: this task restores correctness, it does
not change what users see. The 2 -> 5 expansion is real but arrives WITH the re-tune, not before
it. `score.ts`'s current doc comment claiming "five headline-eligible seasons" is WRONG today and
must be corrected to say so conditionally.

### D-4 — `corpusSeasons` must be the CORPUS, not the publish range

`publish.ts:1981` passes `seasonsSorted`, which is the `--seasons` CLI range, and
`package.json`'s `publish:seasons` passes `--seasons 2022-2026`. So the "corpus" the rule sees is
five seasons, not the seven actually ingested — making 2022 (0 priors) and 2023 (1 prior)
ineligible for the WRONG reason, and making `headlineEligible` a property of the CLI invocation
rather than of the season. A single-season republish would flip it on a live key.

Eligibility is a property of the data available, not of what a given run chose to publish. Fix
this. Prefer sourcing the season set from the corpus itself over widening the `--seasons` flag,
but the planner may choose the mechanism.

### D-5 — The user-facing claim must be conditional, never unguarded

`apps/web/src/components/compare/MethodologyNote.tsx:165` currently renders, unconditionally:

> "VPR's hyperparameters for each of 2022–2026 were selected using only seasons before it — no
> displayed season was scored using hyperparameters chosen by looking at it."

**This is false for 2022, 2023 and 2024, and it reaches production WITHOUT a republish**, because
`buildMethodologyFigures` reads only fields already present in the live 5.0.0 artifacts. The next
push of `main` deploys it. This is the single most urgent item in this task.

The replacement must state only what the data supports. It may not assert leak-free selection for
a season the shipped provenance contradicts. If the artifact does not carry enough information to
make the claim honestly, say less — an omitted sentence is fine; a false one is not.

### D-6 — Fix the report caption that now contradicts its own badges

`packages/harness/report.ts:97` still reads "Holdout rows (2025–2026) are the only
headline-eligible figures per D-09; tune rows (2022–2024) ... must never be presented as a
headline claim" — retired vocabulary, and post-republish it would sit directly under a green
"Headline-eligible" badge on a row it forbids.

### Claude's Discretion

- The shape of the selected-on input (map vs per-algorithm field) and how it reaches the call
  sites.
- How `corpusSeasons` is sourced under D-4.
- MethodologyNote's replacement wording, subject to D-5.

</decisions>

<specifics>
## Specific Ideas

**The other surviving findings, all in scope:**

- **`publish.ts:1981` has ZERO test coverage** — the one production call site that decides
  published `headlineEligible`. Its own in-code comment admits the false-green risk and no test
  closes it. Reverting the argument to `[season]` would keep the suite green. Add a test that
  actually exercises `publishSeasons`' compare artifact and would fail on that revert.
- **`isHeadlineEligible` returns `true` for a season absent from `corpusSeasons`** (minor). A
  typo'd year silently reads as eligible. Decide: throw, or document. Prefer throwing — it matches
  the "unregistered season has no defensible answer" discipline `componentMapForSeason` and
  `rpRuleModuleForSeason` already use.
- **`eventScopeDiagnostic.ts:218-219` self-derives `corpusSeasons` from predictions** — the exact
  pattern the options contract forbids. It genuinely discards the flag, so it is not a live bug,
  but it is the anti-pattern sitting in the codebase as an example. Make it explicit.

**Do NOT** run a tuning search, promote, publish, or full harness replay.

**Do NOT change what users currently see.** Per D-3 the honest eligible set today is {2025, 2026},
which is what live artifacts already contain. If this task changes a published number, something
is wrong.

**Known traps** (project memory): never `timeout <n> pnpm <cmd>` — it swallows output and exits 0.
Run `npx vitest run` from the REPO ROOT. Also run `npx tsc --noEmit` in `apps/web` separately —
the root tsconfig only includes `packages/**`/`scripts/**` and does not reach it.

**Fixtures:** `apps/web/src/routes/__fixtures__/compare-*.json` are byte-pinned to the 5.0.0
shape and must NOT change.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/quick/260903-krp-.../260903-krp-SUMMARY.md` — the task this corrects
- `packages/harness/promote.ts:142` — `ProvenanceSchema.tuneSeasons`, written at :474 and :582
- `data/algorithm-versions/vpr@7.0.0+tuned-2026-08.json` — the shipped provenance
- `.planning/todos/pending/retune-sigma1-rolling-origin.md` — the job that makes the premise true
- `.planning/todos/pending/rolling-origin-hyperparameter-tuning.md` — D-2 through D-5

</canonical_refs>
