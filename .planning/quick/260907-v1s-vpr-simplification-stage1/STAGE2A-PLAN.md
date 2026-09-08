---
task: Stage 2A — delete the confirmed-dead VPR parameters
date: 2026-09-07
status: planned, not started
depends_on: Stage 1b/1c results in RESULTS.md
---

# Stage 2A: cut 19 searchable parameters to 10

## What gets removed

**Deleted outright (7 fields + a module + a state field).** Confirmed free on
every origin in Stage 1b:

| field | why |
|---|---|
| `adaptationEnabled` | subsystem free on 2022/2025/2026, the three origins shipping it on |
| `adaptationEwmaAlpha` | ≤1.5σ everywhere reachable |
| `adaptationExponent` | ≤2.1σ, best point negative |
| `adaptationMinFactor` | ≤1.5σ |
| `adaptationMaxFactor` | ≤2.0σ |
| `adaptationMinObservations` | ≤0.9σ |
| `maxTeamKalmanGain` | never binds on ANY origin — 0.54→1.0 bitwise identical on 2024/2025/2026 |

Also removed: `packages/core/algorithms/sigma1/adaptation.ts`, its test, the
`InnovationStats` state field, and the `foldInnovation` call site in `index.ts`.

**Moved out of the search, NOT deleted (2 fields).** `linkC` and `covEwmaAlpha`
are provably incapable of changing winner accuracy (proof in RESULTS.md,
confirmed +0.00000 with a paired SE of exactly 0 on all five origins) but they
DO set the published probability's calibration, which the site renders. They
move from `SIGMA1_SEARCH_SPACE` into `SEARCH_EXCLUSIONS` with the invariance
proof as their recorded reason, and get fit in a separate 1-D pass against
Brier after the accuracy search.

**Deliberately NOT removed.** `minConsistencyVarianceRel` (retracted — live at
3.58σ on 2024) and the three carry-damping fields `carryVarianceFactor` /
`carryEvidenceRate` / `carryMeanReversion` (conditional — free on four origins,
−1.7σ on 2022). See RESULTS.md's B-RETRACTED and B-CONDITIONAL sections.

## Census after

| | before | after |
|---|---|---|
| `SIGMA1_PARAM_KEYS` | 33 | **26** |
| `SEARCHABLE_PARAM_KEYS` | 19 | **10** |
| `SEARCH_EXCLUSIONS` | 14 | **16** |

10 + 16 = 26. `searchSpace.test.ts` asserts this partition and will name any
field left in neither.

## THE COST, stated up front

`Sigma1ParamsSchema` is `z.strictObject`. Deleting fields makes every committed
`vpr@10.0.0+*.json` **unparseable** — trigger (a) in `params.ts`'s own
version-bump rules — so this forces `SIGMA1_CODE_VERSION` → **11.0.0**.

Because D-13 artifact identity is `{codeVersion}+{paramSetName}`, an 11.0.0 bump
changes **every R2 key**: a full republish of ~75,796 objects / ~2.94 GB, which
took hours on 2026-09-06.

**For a change that is bitwise-zero accuracy by construction.**

### Recommended sequencing: hold the republish

Do NOT republish at the end of 2A. Land the deletion, keep the site serving
`vpr@10.0.0+rolling-2026-09d`, and batch the single republish with Stage 2B's
re-tune. Paying a 3 GB republish twice — once for a zero-accuracy simplification
and again a few days later for the actual model improvement — is pure waste.

This means 2A ends with the repo ahead of the live site, which is a state this
project has held deliberately before (260905-tll shipped code whose artifacts
404'd until the next republish, with the client degrading correctly). The same
discipline applies: **verify the live site still serves 10.0.0 correctly after
2A lands**, since nothing about the deployed artifacts changes.

## Work items

1. **`params.ts`** — delete the 7 fields from the interface, `DEFAULT_SIGMA1_PARAMS`,
   and `Sigma1ParamsSchema`; bump `SIGMA1_CODE_VERSION` to 11.0.0 with a history
   block recording that trigger (a) fired and (b) did not.
2. **`index.ts`** — remove the `adaptationFactor` call in `applyTeamProcessNoise`
   (leaving `q` unscaled), the `foldInnovation` call, and the `innovationStats`
   state field. Remove `maxTeamKalmanGain` from both gain sites.
3. **`kalman.ts`** — drop the `maxTeamKalmanGain` parameter and its clamp.
   `attributionShrinkage` stays.
4. **Delete** `adaptation.ts` and `adaptation.test.ts`.
5. **`packages/harness/stateSnapshot.ts`** — `STATE_SNAPSHOT_SHAPE_VERSION`
   MUST go 8 → 9. Verified: the snapshot serializes `innovationStats` at
   lines 277 and 342, so removing the field is a real `Sigma1State` shape
   change and stale live D1 rows would deserialize wrong. This is the one
   live-Worker hazard in 2A and it is NOT optional — a re-seed is owed.
   (Note the file lives under `packages/harness/`, not alongside the sigma1
   module, which is easy to miss when grepping.)
6. **`searchSpace.ts`** — remove 7 bounds, move `linkC`/`covEwmaAlpha` into
   `SEARCH_EXCLUSIONS` with the invariance proof as their reason, drop the
   `maxTeamKalmanGain` guard from `isValidParamSet`.
7. **`promote.ts`** — add a `10.` branch to `migrateSourceParams` that STRIPS the
   deleted keys, mirroring the existing `9.`/`8.`/`7.` shape-map branch.
8. **`legacyParams.ts`** — a new entry for the 10.x shape.
9. **Re-promote all 7 committed version files** to 11.0.0, and re-pin
   `promotedVersionPath.ts` (it derives from `SIGMA1_CODE_VERSION`, so it
   re-points automatically — verify rather than assume).
10. **Census/fixture updates**: `searchSpace.test.ts` (19→10, 33→26, 14→16),
    `baselineFingerprint.test.ts`, `selectionProvenance.test.ts`,
    `digest.test.ts`'s committed-version digests, `fixtures/digest-slice.json`.

## The verification that matters

An inertness proof, not a test-suite pass: replay a season under 11.0.0 and
confirm the prediction stream is **byte-identical** to 10.0.0's, because every
deleted field sat at its identity value. This is the same instrument every prior
bump used. If the streams differ, a deletion was not inert and the claim in
RESULTS.md is wrong.

Run the full suite from the **repo root** (`npx vitest run`), not from
`apps/web` — repo root is 204 files, apps/web is 89, and an 8-day red CI hid in
that gap once.

## Out of scope

No re-tune, no acceptance run, no promotion of new parameter VALUES. 2A changes
the parameter SET only; every surviving parameter keeps its shipped value.
