# Quick Task 260903-3bv: Gap-aware season-boundary carry (Sigma1) - Context

**Gathered:** 2026-09-03
**Status:** Ready for planning

<domain>
## Task Boundary

`SeasonBoundary` (`packages/core/algorithms/types.ts:203-207`) carries `fromSeason` and
`toSeason`, but **the elapsed gap is never computed anywhere** — verified 2026-09-03: those
two fields are read only to look up component maps and to label state. Every season boundary
is therefore treated as one year.

That is correct today because the corpus (2022–2026) is contiguous. It stops being correct
the moment `extend-corpus-2019-2020` lands: 2021 is permanently excluded (the at-home/remote
season, no conventional 3v3 alliance matches), so the corpus becomes 2019, 2020, 2022…2026
and the **2020 → 2022 boundary spans two years**. Left as-is, a full student-cohort turnover
would be treated as a single off-season.

Make Sigma1's season-boundary carry gap-aware. **Sigma1 only** — see the EPA decision below.

</domain>

<decisions>
## Implementation Decisions — LOCKED

### D-1 — Scope: Sigma1 only. EPA is NOT touched.

**User decision, 2026-09-03.** EPA keeps literal Statbotics-parity behaviour, gap included.
`packages/core/algorithms/epa.ts`'s own `carrySeason` (:649) and the shared `epaCarryover`
(`packages/core/algorithms/carryover.ts:~230`) **must not change**, and `carryover.test.ts`'s
existing assertion that a default-params Sigma1 call and an `epaCarryover` call produce the
identical blend must be handled deliberately rather than broken silently — see the risk note
in <specifics>.

The consequence was raised before the decision and accepted: across the 2020 → 2022 boundary
VPR will handle the gap and EPA will not, so VPR gains some advantage on 2022 and 2023 that
comes from the baseline being handicapped rather than from VPR being better. It is recorded,
not re-litigated.

### D-2 — Mechanism: apply the existing per-boundary steps once per YEAR ELAPSED

    gap = boundary.toSeason - boundary.fromSeason      // >= 1, integer

1. **`carryMeanReversion`** — applied `gap` times, i.e. revert by `1 - (1 - λ)^gap` toward
   `EPA_ROOKIE_BASELINE` instead of by `λ`. In `sigma1CarryNormalizedRating`
   (`packages/core/algorithms/sigma1/carryover.ts:77-91`). **This is the substantive change.**
2. **`consistencyCarryDecay`** — applied `gap` times, i.e. `decay^gap`, at the
   `consistency[name] = carriedObserved * resolved.consistencyCarryDecay` line in
   `carrySeason` (`packages/core/algorithms/sigma1/index.ts:~1585`).
3. **Belief variance — NO CHANGE.** An earlier framing of this task said to "add
   `processNoiseEventBoundary` `gap` times". **That was wrong and must not be implemented.**
   `carrySeason` does not ADD process noise at a season boundary; it RESETS belief variance to
   a cold-start value via `seedConsistencyFor`. Nothing is more uncertain than cold start, so
   a longer gap cannot and should not inflate it further.

**No new parameter, and no new searchable hyperparameter.** This reuses two params that
already exist and are already tuned. Do NOT add anything to `searchSpace.ts`.

### D-3 — The bar: bitwise identical when `gap === 1`

Every boundary in the current corpus is one year, so this change must be a **provable no-op on
today's corpus**. `1 - (1 - λ)^1 === λ` and `decay^1 === decay` hold exactly in IEEE-754 only
if the implementation does not restructure the arithmetic — prefer an explicit `gap === 1`
fast path returning the existing expression unchanged over relying on `Math.pow` round-tripping.

This is the same equivalence bar D-T1's reparameterization had to clear. A zero-diff proof on
the existing span is required, not optional.

### Claude's Discretion

- Exact threading of `gap` from `carrySeason` into `sigma1Carryover` /
  `sigma1CarryNormalizedRating` (neither currently receives the boundary).
- Whether `gap` is passed as a number or the whole `SeasonBoundary`.
- Test file placement and naming.

</decisions>

<specifics>
## Specific Ideas

**The threading problem.** `carrySeason(state, boundary, params)` has the boundary.
`sigma1Carryover(input, params)` does not, and it is what calls
`sigma1CarryNormalizedRating(lastYear, yearBefore, params)`. The gap has to reach the innermost
function; pick the smallest change that does it without widening the public surface more than
necessary.

**RISK — the EPA/Sigma1 blend-equality test.** `carryover.test.ts` asserts that a
default-params Sigma1 call and an `epaCarryover` call produce the identical blend. With D-1
freezing EPA and D-2 changing Sigma1, that equality now holds **only when `gap === 1`**. Do not
delete the test to make it pass — narrow it to `gap === 1` and add a sibling asserting the two
DIVERGE at `gap === 2`, so the intentional divergence is pinned rather than lost.

**Tests to add (at minimum):**
- `gap === 1` reproduces the pre-change value exactly, for both the mean reversion and the
  consistency decay. Bitwise, not `toBeCloseTo`.
- `gap === 2` reverts strictly further toward `EPA_ROOKIE_BASELINE` than `gap === 1`, and
  decays consistency strictly further.
- Applying `gap === 2` once equals applying `gap === 1` twice (the composition property that
  makes "per year elapsed" the right generalization rather than an arbitrary curve).
- A `gap` of 0 or negative is impossible by construction; assert or document which.

**Do NOT run** the harness, a tuning search, a publish, or a promote. This task changes code and
proves equivalence. Nothing downstream re-runs here.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/todos/pending/extend-corpus-2019-2020.md` — why this is needed; the "How 2020 is
  accounted for" section states the same mechanism (its bullet 3 wording predates the
  correction in D-2 item 3 above; **D-2 wins**).
- `packages/core/algorithms/types.ts:203-207` — `SeasonBoundary`
- `packages/core/algorithms/sigma1/carryover.ts:77-91,110-134` — the mean blend and reversion
- `packages/core/algorithms/sigma1/index.ts:1546-1600` — `carrySeason`
- `packages/core/algorithms/epa.ts:649` — EPA's carry, frozen by D-1

</canonical_refs>
