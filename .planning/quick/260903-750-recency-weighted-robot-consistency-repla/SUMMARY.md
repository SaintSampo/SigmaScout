# Summary — Y becomes recency-weighted robot consistency

`SIGMA1_CODE_VERSION` 6.0.0 -> 7.0.0. The published `±` is each team's own
recency-weighted swing; the per-event variance decomposition is deleted. The
blank rate went **40.2% -> 0%** and `predict()` is bitwise unchanged.

The estimator and its wiring landed in `dd131b74`/`bb4baada`. This is the second
half: `00c3907e`, `996dd24a`, `001bb986`, `e3ac7d8b`, `e8544a82`.

## The gate — PASS

Both re-promoted files' `predictionStreamSha256` are character-identical to
their 6.0.0 values, and both headline Brier/accuracy pairs match to the last
digit.

| file | 6.0.0 -> 7.0.0 | |
|---|---|---|
| `tuned-2026-08` | `380c5980…83e7783fb` -> same | PASS |
| `tracer-check` | `38d091e0…99029a1c` -> same | PASS |

Neither was hand-edited. `computePredictionStreamDigest` hashes exactly
`[matchKey, pRedWin, redScore, blueScore]`, so reproducing it *is* the proof.

**`update()` is verified by a stronger instrument than the digest.**
`displayOnly.test.ts` hashes post-fold and post-carrySeason filter state against
a fixture generated **once, before 260902-varopr**. It was **not regenerated**.
With `swing` added to its exclusion list — for the reason `perEventVariance` was
added at 5.0.0 — both hashes still reproduce character for character. Two
successive display-estimator swaps judged against one unregenerated baseline.

## Blank rate: 0%

Measured as the other two were — one 2022-2026 replay with season carry,
promoted `tuned-2026-08` params, every cell for every 2026 team.

| estimator | no `±` | teams missing >=1 |
|---|---|---|
| clamp (5.0.0) | 34.9% (19,436 / 55,770) | 97.7% |
| NNLS (6.0.0) | 40.2% (22,412 / 55,770) | 98.8% |
| swing (7.0.0) | **0.0%** (0 / 55,785) | **0.0%** (0 / 3,719) |

**The denominator moved by one team** (3,718 -> 3,719). The cause is the corpus,
not the code — 2026 is live and the earlier rows used an ingest one team
smaller. Recorded rather than rounded away; zero is zero against either.

Structural, not tuned: no floor, no minimum-match rule, no fallback exists in
`swing.ts`. Deviations are centred residuals, so one observation is already a
valid estimate. The one `undefined` case is a never-folded key — a team that has
not played — which no denominator here contains.

The measuring script was scratch and is deleted; it never reached a commit.

## `varianceOpr.ts`: DELETED

1. Nothing in production imports it — all three import sites were its own tests.
2. The source half already assumed it: `LEGACY_6_VARIANCE_OPR_RIDGE` is
   documented as existing "because the constant it came from is deleted with
   `varianceOpr.ts`". Keeping it would have made a committed comment false.
3. An 865-line NNLS solver nothing calls is a trap for the next reader.

The counter-argument (a large diff atop a large one) is why it is isolated in
`001bb986`: 1,817 deleted lines, zero behaviour. Recovery is
`git show 001bb986^ -- <path>`.

## Tests

**Ported** (property holds, source moved): `P IS GONE FROM THE DISPLAY`; the
phase-group lookup, now against `swingSpread` at every aggregation level; the
retired-additivity note; `carrySeason` drops swing (the map went, the decision
survived verbatim); the square-of-the-sum rule, re-expressed on the published
spread as a ratio of `C` against `sqrt(C)`.

**Rewritten** (rule changed, coverage kept): the `lastEventKey === null` case —
now two teams with *identical* `lastEventKey: null` and state, differing only in
the accumulator; `selectionsFor("vpr")` returns no event selection; shape
version 6 -> 7; zero event rows; searchSpace counts 25->26 fields, 10->11
exclusions, searchable unchanged at 15; the 3.x migration tag's third hop.

**Deleted** (internals of a retired estimator, no analogue contrived): the
`solveEventVariance` lookup identity; per-event partitioning (swing is
deliberately *not* partitioned — consistency does not restart when a robot
travels); the two `rowCount` no-fold tests, whose subject keeps stronger
coverage in the all-surrogate and whole-alliance-DQ blocks ("no team state
touched" subsumes "no fold"); the event-row D1 seed-budget block; and
`varianceOpr`'s two test files.

## Deviations

1. **Latent runtime bug in the committed source half** (`00c3907e`).
   `Legacy6Sigma1ParamsSchema` used `Sigma1ParamsSchema.omit(…)`; zod 4 rejects
   `.omit()` on a schema with `.check(…)` refinements, throwing at
   module-evaluation time — so importing `promote.ts` at all died before running
   a line. `tsc` was clean throughout. Rewritten longhand as `z.strictObject`,
   which is also the convention the 3.x/4.x frozen schemas document and this one
   had broken.
2. **Extended the 4.x/3.x migration tags** — `migrate4to5` composes through
   `migrate6to7`, so those files really do traverse two and three maps.
3. **Doc comments describing the retired decomposition as the source of the
   `±`** — in scope, but larger than expected. Worst was `teamMetrics`'s own
   header, above a function reading `swingSpread`. Also an *orphaned*
   `varianceOprRidge` field doc in `params.ts`, and `stateSnapshot.ts`'s missing
   6 -> 7 paragraph.
4. **One test cut back.** An attempt to pin the `/ n` share by comparing a
   3-robot alliance to a 1-robot one failed (ratio 4.12, not 3) — the observed
   own-component vector is not independent of alliance size. Dropped rather than
   reverse-engineered; the omission is stated in the test.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` from the **repo root** (167 files): **2938 passed, 1 skipped,
  0 failed.**
- `git worktree list` — main tree only. No scratch committed.

## Follow-ups

- **Republish.** Live artifacts still carry the 5.0.0 numbers, as after 6.0.0.
- **Re-measure both constants** after the rolling-origin re-tune. They were fit
  against `reports/is2-full` predictions from an earlier model version. The
  half-life sits on a plateau (flat 4-12) and is unlikely to move; the scale may.
