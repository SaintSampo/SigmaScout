---
id: sigma1-cold-start-zero-plus-minus
created: 2026-09-01
source: quick task 260901-is2 CONTEXT.md "out of scope" — filed by Task 6
resolves_phase:
priority: medium
---

# A never-seen team publishes `0 ± 0`

> **CLOSED 2026-09-04 (quick task 260904-n9n) — the defect does not exist; the missing
> test now does.** This file's own first instruction ("do not assume it, locate it") was
> followed and the answer is that no defaulting site exists: all three algorithms OMIT a
> never-seen team from `teamMetrics` (sigma1 `index.ts:1553`, `epa.ts:797`,
> `opr.ts:467-469`), publish and the Worker default the missing entry to `metrics: {}`
> (never zeros), the client renders a blank cell for a missing metric while a real zero
> renders `0.00` (`MetricValue.tsx` + its test), missing totals rank last with a
> deterministic tie-break, and a zero-match win rate is `null`, "never a coerced zero"
> (`rowModel.ts`). The percentile pools likewise exclude valueless teams (260904-586,
> "never counted as a zero").
>
> **The representation decision this file asked for is option (b), already in force** —
> decided piecewise by the 2026-09-01 blank-cell user request, 260904-586's pool
> exclusion, and rowModel's missing-sorts-last contract. Recorded here per item 3 so it
> is not re-litigated.
>
> **What was actually missing** was a pin on the omission contract itself: nothing
> asserted `teamMetrics` returns an ABSENT entry (rather than zeros) for an unknown team,
> so a refactor of `continue` into a zero-fill would have shipped `0 ± 0` with a green
> suite. 260904-n9n added that test to all three algorithm suites (items 4 and 5).
> Item 6 (sort order) was already pinned by `rowModel.test.ts`.
>
> Related but separately decided, not this file's case: a team IN state via carry with no
> folded matches publishes a bare value with NO spread — the D-Y1 contract, pinned with
> rationale in `sigma1.test.ts`.

## What changed

Nothing — and that is the point. Quick task 260901-is2 fixed the ± for teams that **have**
played (D-Q2: R is now estimated from innovations and recovers a known σ instead of running
~5× small), but the never-seen team's `0 ± 0` is a **separate defect on a different code
path** and was explicitly listed as out of scope in that task's CONTEXT.md. It survives the
D-Q2 fix untouched.

Filing it now so the fix that made the ± honest for 99% of teams is not mistaken for having
made it honest for all of them.

## The defect

A team with no match history publishes a value of `0` and a spread of `0` — a point estimate
of "this team scores exactly zero points, and I am certain of it". That is the most confident
claim the system can make, attached to the case it knows least about. It is exactly backwards,
and it is the one display that most directly contradicts the project's central promise of
honest uncertainty: `X ± Y` at 1 SD is supposed to widen when the model knows less.

**Mechanism (verified 2026-09-01).** `teamMetrics` in
`packages/core/algorithms/sigma1/index.ts:1205` opens with:

```ts
const teamState = state.teams.get(team);
if (!teamState) continue;
```

A team enters `state.teams` only when it is folded by an actual match update, so a team on an
event roster that has not yet played is **absent from the returned `TeamMetrics` map entirely**
— not present-with-zeros. The `0 ± 0` is therefore produced downstream, where a consumer
defaults a missing entry rather than distinguishing "no data" from "measured zero". The publish
path reads `metricsByTeam` at `packages/harness/publish.ts:1727` and again at :2165; the exact
defaulting site (publish, artifact schema, or client render) needs to be pinned as the first
step of the fix — **do not assume it, locate it**, because which layer defaults determines
whether the fix is a schema change or a render change.

Note the contrast with the *cold-start parameters*, which are real and non-zero:
`SIGMA1_COLD_START_TEAM_TOTAL` and `SIGMA1_COLD_START_CONSISTENCY_VARIANCE` (= 25, an SD of 5)
exist precisely to answer "what should we assume about a team we have never seen play"
(`packages/harness/searchSpace.ts:103`). The model has a considered answer for this case; the
published artifact does not carry it.

## What "done" looks like

1. The defaulting site is located and named — one of publish, the artifact schema, or the
   client. A test pins which layer owns the decision.
2. A never-seen team either (a) is published with the cold-start prior and its honest spread
   (a wide ±, not `± 0`), or (b) is published with an explicit "no data" marker that the UI
   renders as such — **never** as a numeric `0 ± 0`. Option (b) is likely the better answer
   for a team on a roster who has not played: the model's prior is a league-average guess, not
   a measurement, and presenting a guess in the same visual form as a measurement is the same
   category error in a different direction.
3. Whichever is chosen, the choice is written down with its reasoning, because both options are
   defensible and the next reader will otherwise re-litigate it.
4. A test constructs a Sigma1 state containing at least one played team and one roster-only
   team, calls the publish assembly, and asserts the roster-only team's published shape — so a
   future refactor cannot silently reintroduce `0 ± 0`.
5. The same check is applied to `epa` and `opr`, which have their own cold-start paths and are
   likely to share the defect. If they do not, say why in the test.
6. UI: confirm how the chosen representation renders on the team page and in the teams table
   sort order — a "no data" team must not sort as if it scored 0.

## Related

- `.planning/quick/260901-is2-model-correctness-fixes-from-adversarial/CONTEXT.md` — "Out of
  scope (surface as follow-ups): ... the cold-start `0 ± 0` issue for never-seen teams"
- `packages/core/algorithms/sigma1/index.ts:1205` — `teamMetrics`, the `!teamState` skip
- `packages/core/algorithms/sigma1/params.ts` — the cold-start constants that already encode
  the model's real answer for this case
- `Skill("sketch-findings-sigmascout")` — the decided uncertainty/interval display rules; the
  "no data" representation should come from there rather than being invented
