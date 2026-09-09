---
id: live-match-updates-swing-and-lossy-merge
created: 2026-09-08
source: quick task 260908-5wd — plan for making live-updated matches carry the SigmaScout layer, written while a retune/republish runs in another session
resolves_phase:
priority: high
---

# Plan: make live match updates carry the SigmaScout layer

> **STATUS 2026-09-09 — defects 1 and 3 are FIXED; defect 2 remains.**
> Defect 1 (live ticks deleting offline-published fields) shipped in `94b4ccd3`, with three tests
> confirmed to fail with the fix reverted. Defect 3 (the silent Sigma1 fallthrough that would have
> folded live events with the wrong model under BPR's id, plus BPR's missing shape guard) shipped
> in `e50bacd5`. **Defect 2 — the Worker's swing accumulator and the shape bump 9 → 10 — is the
> only part left, and it should ride the BPR re-seed.** See `00-sigmascout-layer-roadmap.md`.

Investigated 2026-09-08 against the live Worker. **Three separate defects**, only one of which is
the feature request. They are ordered below by urgency, not by size, because the first one starts
destroying published data the moment the in-flight republish lands.

---

## Defect 1 — the live merge SILENTLY STRIPS optional published fields (urgent, small)

`mergeTeamSeasonArtifact` (`apps/worker/src/scheduled.ts:652-666`) returns a freshly constructed
object. It names twelve fields and spreads nothing. Every OTHER field the offline publisher wrote
is dropped the first time a live tick touches that team.

Currently dropped from a touched team's artifact:

| field | published by | consequence of a live tick |
|---|---|---|
| `swingFactor` | 260908-5wd (about to land) | the team tile loses its ± |
| `ranks` | 260905-ttv | the World/Country/District/State rank cards vanish |
| `robotImageUrl` | D-03 | the robot photo reverts to the no-photo tile |
| `activeYears` | D-05 | the year dropdown narrows |

The same shape exists in `runGlobalRebuild`'s teams rows (`scheduled.ts:1088-1099`), which drops
`country`, `stateProv`, `districtKey` and will drop `swingFactor`.

**This is pre-existing** — `ranks` and `robotImageUrl` are being stripped during live events
today — and `swingFactor` merely joins the queue. It is listed first because it is a data-loss
bug with a one-line-shaped fix and because the republish is about to make it visible.

**Fix:** spread `existing` first, then override the fields the tick genuinely recomputes.

```ts
return {
  ...existing,                       // preserve every offline-published field
  schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
  // …the twelve fields this tick actually recomputes, unchanged…
};
```

**Do not** let this become "spread and hope": the fields the tick recomputes must still be listed
explicitly AFTER the spread, so a reader can see exactly what a tick owns. Add a test that a
touched team's artifact retains an `existing.ranks`/`robotImageUrl`/`swingFactor` through a fold —
`scheduled.test.ts` already has the touched-team round-trip harness at line 403.

Ship this **independently of everything below**, ideally before the republish finishes.

---

## Defect 2 — live-updated matches carry no band (the actual feature request)

`buildEventMatchRow` (`scheduled.ts:463`) emits no `redScoreVarianceOwn` and no swing band, so
every match the Worker folds during a live event renders with no band until the next full publish.

### The design question this turns on

A Swing Factor needs a team's deviation HISTORY, and the Worker holds only algorithm state. But
the estimator does **not** need the list — it is exactly computable from four running numbers per
team, updated in O(1) per match, using West's weighted incremental variance:

```
decay all priors:   W  ← w·W          M2 ← w·M2          W2 ← w²·W2
add observation x:  W  ← W + 1
                    delta ← x − mean
                    mean ← mean + delta / W
                    M2   ← M2 + delta · (x − mean)      // note: post-update mean
                    W2   ← W2 + 1
read:               variance = M2 / (W − W2/W)
                    swingFactor = 1.92 · √variance
```

`W2` is carried solely for the effective-sample denominator that makes a one-observation team
return nothing. This form is numerically stable — it never subtracts two large nearly-equal
numbers, which is the failure the offline two-pass form was written to avoid (measured: the naive
`E[x²] − E[x]²` returned 9.05e-8 instead of 0 for five identical deviations of 3).

**Storage: four floats per team.** Trivially inside the existing team row, well under
`SeedRowTooLargeError`'s budget, and it does not touch the league row (whose 16 KB cap
`MAX_LEAGUE_ROW_BYTES` forbids anything that scales with team count).

**CPU: negligible** — four multiply-adds per team per match, on a path already measured at 17–38 ms.

### The live-vs-offline equality problem, and the decision it forces

The offline pipeline currently uses an exact TWO-PASS computation over the full deviation list.
The Worker would use the incremental form. Those are algebraically equal but not bit-equal, and
this project's whole live/offline contract (`scheduled.replay.test.ts`) is built on bit-equality.

**Recommendation: move the offline pipeline onto the SAME incremental accumulator.** One
arithmetic path, bit-identical by construction, and the stability argument for two-pass is fully
answered by West's form. `packages/harness/swingFactor.ts`'s `SwingFactorAccumulator` already has
the right shape — replace its internal deviation array with the four running numbers and every
caller keeps working.

Then **extend `scheduled.replay.test.ts`'s digest** to include the swing band. Today it digests
only `pRedWin`/`predictedRedScore`/`predictedBlueScore`, so it would not catch a live/offline
divergence in this field at all — that extension is what makes the equality claim real rather
than asserted.

### Where it belongs, which is a real decision

D1 rows are *algorithm state*; Swing Factor is deliberately *not* an algorithm concept
(`swingFactor.ts`'s header is explicit). Putting the accumulator inside `state_json` puts a level-2
heuristic inside a level-1 blob.

**Recommended anyway**, with the reason recorded: `state_json` is the only per-team row the Worker
reads and writes, and it does so in ONE subrequest each way regardless of payload. A separate
table would double the subrequest cost of every tick against a 41-usable budget where three
algorithms already overflow. Nest it under an explicitly-named key — `sigmascoutSwing`, not
`swing` — so it reads as a passenger rather than as part of the model. (VPR's Sigma1 state already
has an unrelated `swing` key; do not collide with it.)

### The shape-version consequence, and how to make it free

Adding the accumulator bumps `STATE_SNAPSHOT_SHAPE_VERSION` 9 → 10, and a bump **invalidates every
live row** — `deserializeState` throws `LeagueRowShapeVersionError` and the only remedy is a full
re-seed from a fresh publish. There is no migration path by design.

**So do not ship this as its own disruption.** It should ride the re-seed that the VPR→BPR live-tier
switch will already require. Sequencing is in the last section.

Also update `stateSnapshot.test.ts:489`, which hard-codes "version is 9, and 3–8 all throw".

---

## Defect 3 — the live tier cannot become BPR without a code fix (blocks the migration)

`buildAlgorithmModules` (`scheduled.ts:279-291`) branches on `"opr"` and `"epa"` and **falls
through to `makeSigma1(...)` for everything else**. There is no `bpr` branch.

So setting `LIVE_ALGORITHM_IDS = "bpr"` today would construct a **Sigma1 module wearing the id
`bpr`**, silently folding live events with the wrong model and writing them to BPR's artifacts.
`serializeState` has a real `bpr` branch, so the state would round-trip and nothing would throw.

Note also that `deserializeBprState` (`stateSnapshot.ts:689`) does **not** perform the shape-version
check every other algorithm does — BPR alone is unguarded, so a stale BPR row would be read rather
than rejected.

Both must be fixed before BPR goes live. Neither is related to Swing Factor; they surfaced while
mapping this and would otherwise be found the hard way.

---

## Sequencing

The shape bump is the expensive step, so everything that needs a re-seed should share one.

1. **Now, independently: Defect 1.** Spread `existing` in both merges, with a preservation test.
   No shape bump, no re-seed, ships against the current deploy, and stops the data loss the
   in-flight republish is about to make visible.
2. **Then: Defect 3.** Add the `bpr` branch to `buildAlgorithmModules` and the shape guard to
   `deserializeBprState`, with a test that a `bpr` live tier constructs a BPR module. Still no
   re-seed.
3. **Then: Defect 2, in one shape bump.**
   a. Convert `SwingFactorAccumulator` to the incremental form; assert offline output is unchanged
      within rounding on a fixture.
   b. Add `sigmascoutSwing` to the serialized team state for every algorithm; bump to 10; update
      `stateSnapshot.test.ts:489`.
   c. Fold the accumulator in the Phase A loop at `scheduled.ts:891-895` — read the band BEFORE
      `algorithm.update`, exactly where `predict` already happens, then fold.
   d. Emit the band in `buildEventMatchRow`/`buildEventUpcomingRow`/`buildTeamSeasonMatchRow`, and
      the per-team `swingFactor` in both merges.
   e. Extend `scheduled.replay.test.ts`'s digest to cover the band.
4. **Re-seed and deploy together**, ideally the same re-seed that switches the live tier to BPR.
   `npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-<id>.sql`.

## Risks to watch

- **CPU headroom is genuinely thin.** Idle ticks run 5–9 ms against a 10 ms budget, and
  `worker-operations.md:429` already calls that "a defect with no headroom". The added arithmetic
  is four multiply-adds per team per match and should be invisible, but measure a real fold tick
  after deploying rather than assuming.
- **The bump is irreversible in place.** A deploy carrying shape 10 against un-re-seeded D1 rows
  takes live folding down until the seed runs. Seed first, deploy second.
- **Do not put the accumulator in the league row.** It scales with team count and would breach
  `MAX_LEAGUE_ROW_BYTES`.
