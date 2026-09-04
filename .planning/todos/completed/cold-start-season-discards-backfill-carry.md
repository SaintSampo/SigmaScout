---
id: cold-start-season-discards-backfill-carry
created: 2026-09-04
source: found by the orchestrator while preparing the rolling-origin republish (quick task 260904-2i9)
resolves_phase:
priority: high
---

# `COLD_START_SEASON = 2022` throws away the 2019/2020 backfill's carry

> **RESOLVED, PARTIALLY — 2026-09-04 (quick task 260904-cs1).** Of this file's own three-step "why
> fixing it is not a one-line change" list below, **step 1 is done; steps 2 and 3 remain
> outstanding.**
>
> - **Step 1 (done):** the fix landed as **positional-by-construction**, not as a corrected
>   literal, per this file's own "prefer making it positional" recommendation.
>   `seasonBoundaryFor`'s cold start is now `index === 0` of the replay range; `COLD_START_SEASON`
>   and `isColdStartSeason` are deleted from the repo entirely (verified: `grep -rn
>   'COLD_START_SEASON|isColdStartSeason' packages/ apps/ scripts/ --include='*.ts'
>   --include='*.tsx'` returns nothing). `--cold-start-season` / `PublishSeasonsOptions.coldStartSeason`
>   survive as a narrowed, diagnostic-only override (D-4) for forcing a non-index-0 season cold.
> - **Steps 2-3 (outstanding):** re-run the screen and all ten joint searches under the now-warmer
>   origin-2022 trajectory; re-promote, re-publish, re-measure. This work lives in
>   `.planning/todos/pending/retune-sigma1-rolling-origin.md`, which now carries the corresponding
>   non-comparability note for the ten already-recorded verdicts.
>
> **No re-measurement was performed by this task.** D-2's safety argument — that the in-flight
> `publish --seasons 2022-2026` / `harness --seasons 2022-2026` replay is byte-identical under the
> positional default because 2022 is index 0 either way — is pinned by a non-vacuous equivalence
> test in `packages/harness/seasonBoundary.test.ts`, not merely asserted. Only future TUNING
> replays that do not start at 2022 (e.g. `[2019, 2020, 2022]`) actually change behavior.

## The defect

`packages/core/algorithms/breakdown/constants.ts:72` still reads:

```ts
export const COLD_START_SEASON = 2022;
```

It was correct when the corpus began at 2022. `extend-corpus-2019-2020` moved the corpus start to
**2019** and this constant was never updated.

`seasonBoundaryFor` decides cold start by **matching the constant**, not by position:

```ts
isColdStart: season === coldStartSeason
```

So on the rolling-origin tuning replay for origin 2022 — verified by direct evaluation, 2026-09-04:

```
[2019, 2020, 2022]
  2019 -> {fromSeason: 2018, isColdStart: false}   (index 0; nothing to carry anyway)
  2020 -> {fromSeason: 2019, isColdStart: false}
  2022 -> {fromSeason: 2020, isColdStart: TRUE}    <-- state from 2019+2020 DISCARDED
```

**Every team enters 2022 from the rookie baseline, despite two prior seasons sitting in the
corpus.** The backfill feeds the search OBJECTIVE (2019/2020 predictions are scored during
selection) but contributes nothing to the STATE the origin season is predicted from.

## Why this did not block the republish

It is **consistent** between tuning and publishing. `publish --seasons 2022-2026` also marks 2022
cold-start, so the published 2022 figures match the figures that cleared the D-T7 acceptance bar
exactly. Nothing dishonest shipped — the numbers correspond to their own validation.

The user was shown this and chose to publish and file it (2026-09-04), rather than re-run the
whole re-tune before shipping.

## Why fixing it is not a one-line change

Changing the constant to 2019 changes **every replay** — the selection objective, the origin
evaluations, and the published figures. That invalidates all ten verdicts recorded in
`retune-sigma1-rolling-origin`, because "the incumbent" and every candidate would be measured
against a different state trajectory. Fixing it properly means:

1. Correct the constant (and decide whether cold start should be positional — `index === 0` — rather
   than a matched literal, which is what made this silent).
2. Re-run the screen and all ten joint searches.
3. Re-promote, re-publish, re-measure.

That is a deliberate multi-hour decision, not a bolt-on.

## What to fix, beyond the number

**The mechanism is the real bug.** `isColdStart: season === coldStartSeason` means the cold-start
season is a *value that must be remembered*, and it went stale silently the moment the corpus grew.
The comment in `seasonBoundary.ts` even asserts the now-false invariant:

> "Index 0 has no predecessor to read: `season - 1` is kept there as a nominal label, which is safe
> precisely because `isColdStart` will be `true` for that season"

That is no longer true — on a 2019-start corpus, index 0 (2019) gets `isColdStart: false` and a
nominal `fromSeason: 2018`. It happens to be harmless today only because there is no prior state to
carry at index 0, so `carrySeason` is skipped for a different reason than the comment claims.

**Prefer making it positional** (`index === 0` is the cold start, by construction) over updating a
literal. That makes the wrong state unrepresentable rather than something to remember — the same
correction pattern quick tasks `260903-n2o`/`260903-tk6`/`260904-2i9` all applied to duplicated
facts. If a caller genuinely needs to override, it should pass one explicitly rather than rely on a
module constant matching by coincidence.

## Expected gain

2022 and 2023 currently predict with no or little carried history. Giving 2022 a real two-season
prior should improve its predictions materially — 2022's accepted delta was only +0.00125 Brier,
and its incumbent Brier (0.1566) is already the best of any origin, so a genuine warm start is a
plausible source of a larger, more convincing win than the one that just cleared.

## Related

- `.planning/todos/pending/retune-sigma1-rolling-origin.md` — the ten verdicts this would invalidate
- `.planning/todos/pending/extend-corpus-2019-2020.md` — the backfill whose value this suppresses
- `packages/harness/seasonBoundary.ts` — `seasonBoundaryFor`, and the comment that is now false
- `packages/core/algorithms/breakdown/constants.ts:72` — the constant
