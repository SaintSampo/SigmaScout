---
quick_id: 260920-qgg
subsystem: prediction-algorithms
tags: [zod, spr, epa, tba-schema, breakdown-parsing, versioning]
key-files:
  created: []
  modified:
    - packages/core/algorithms/breakdown/constants.ts
    - packages/core/algorithms/breakdown/2016.ts through 2026.ts (all ten season modules)
    - packages/core/algorithms/breakdown/breakdown.test.ts
    - packages/core/algorithms/breakdown/reconciliation.test.ts
    - packages/core/algorithms/spr.ts
    - packages/core/algorithms/spr.test.ts
    - packages/core/algorithms/epa.ts
    - packages/core/algorithms/epa.test.ts
    - packages/spr/softCredit.test.ts
    - data/baselines/level1-digest-2026-09.json
completed: 2026-09-20
status: complete
---

# 260920-qgg: SPR phases freeze at offseason events because TBA omits adjustPoints

**Code complete and tested. Ships as spr 7.0.0 and epa 12.0.0. Nothing is live yet: the republish,
the seed, the Worker deploy and the R2 cleanup are owed.**

## Root cause

TBA's offseason score breakdowns omit `adjustPoints` on both alliances: 6,105 matches at 95
offseason events, 2016 to 2026, zero official matches. Every season schema required the key, so
the whole breakdown parsed as malformed. SPR's `foldPhases` skips a malformed match while `update`
keeps folding Total through a lenient read, so Auto, Teleop and Endgame froze at their pre-event
values while Total moved. At `2026cc`, frc4414 showed Total 316.31 over phases summing to 141.4.
EPA sent the same matches through its proportional fallback instead of real components.

## What changed

- One shared `ADJUST_POINTS_SCHEMA` (`z.number().finite().default(0)`) in `breakdown/constants.ts`,
  used by all ten season modules. Zod defaults on `undefined` only, so a present-but-invalid value
  still fails. The corpus holds no such value: 345,464 sides carry a number, 12,210 omit the key,
  none carry null, a string or a non-finite number.
- 5,066 offseason matches now parse. 1,164 stay malformed on purpose because they also lack real
  scoring fields (all 1,039 in 2023 lack the charge station and park fields; 76 in 2022, 49 in
  2024). Defaulting a scoring field would publish an unmeasured value as measured.
- No fallback was added to `foldPhases` for that remainder, for the same reason. Recorded as a doc
  comment.
- Guards: exact per-season still-malformed offseason counts are pinned, and a comment-stripped
  source gate fails any season module that spells its own default. Two stale pins that asserted the
  old malformed behaviour (`breakdown.test.ts`, `epa.test.ts`) were inverted.

## What moves, measured

- **No win prediction changes, for any algorithm, any official match, any season.** Two-arm 2026
  replay: 0 of 18,372 official predictions moved for SPR and for EPA.
- **Published accuracy and Brier are identical.** `captureCompareSlices` before and after: 0.00000
  delta on every season and pooled, for opr, epa and spr, scored counts unchanged (pooled 125,422;
  spr 0.75631 / 0.16144, epa 0.75168 / 0.16977, opr 0.63701 / 0.20984).
- SPR phase values move at offseason rows, plus 208 official 2026 rows: `2026wima` precedes the
  Israel district events and `phaseScale` is league scoped. Phase values only.
- EPA component values move at offseason rows.
- OPR reads no breakdown and is untouched. Ranking point odds are untouched.
- `STATE_SNAPSHOT_SHAPE_VERSION` stays 16.

## Versions

- spr `6.0.0+baseline` to `7.0.0+baseline`, epa `11.0.0+baseline` to `12.0.0+baseline`, opr
  unchanged at `5.0.0+baseline`.
- `data/baselines/level1-digest-2026-09.json`: exactly two `algorithmVersion` strings moved. All
  three `predictionStreamSha256` values and the `FROZEN_AT_09_01_STREAM_SHA256` pin are unchanged.
  Owner approved the guarded-file edit 2026-09-20.

## Commits

1. `22e204c5` test: pin 2026 adjustPoints-absence parsing and SPR phase presence
2. `cd6de80f` feat: one shared adjust schema symbol, wired through 2026
3. `b3770775` test: invert the 2024 adjust-absence pin, add per-season and source-scan gates
4. `cf3f34a2` feat: roll the shared adjust schema through the other nine seasons
5. `8a7c5e85` feat: bump SPR to 7.0.0 and EPA to 12.0.0 for the adjustPoints fix

## Verification

- Executor: root `npx vitest run`, 258 files, 5795 passed, 1 skipped. Root and worker
  `tsc --noEmit` clean. One `MetricHistoryTab.test.tsx` timeout on a single loaded run, green in
  isolation and on two further full runs; unrelated.
- Orchestrator rerun: `level1Digest.test.ts` and `breakdown/`, 4 files, 115 pass. The digest file's
  diff is the two version lines and nothing else.

## Owed

> **ALL DONE 2026-09-21.** Checked against production, not against these notes: generation
> `8caca9d2` is live (opr 5.0.0, epa 12.0.0, spr 7.0.0), D1 holds all three algorithms at that
> generation, Worker `6631ba04` was deployed with the publish, a whole-bucket census shows 0 orphan
> generations (3.93 GB), `main` is pushed with the Test and deploy workflows green, `pnpm
> verify:subset` is 0 failing on one generation and the live Playwright suite is 170/170. The list
> below is kept as the record of what was owed.

1. `pnpm publish:seasons`, then commit the rewritten budget doc
2. The four-file seed (see 260920-q75), `seed-cursors.sql` last
3. `npx wrangler deploy` from a clean tree
4. `pnpm cleanup:r2-generations` for the superseded generation and the `spr@6.0.0` / `epa@11.0.0`
   objects
5. `gh run list` after the push
