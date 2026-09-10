# 260910-kco — pre-registered rule: BPR seeds next season from official play only

Committed BEFORE any contrast number exists (pre-registration proven by git
ordering, the 260909-3oe discipline).

## The change under test

Add `carryFrom: "last-official-match"` to the shipped `bpr` module
(`packages/core/algorithms/bpr.ts`) — the exact mechanism EPA adopted in quick
task 260908-615 (its 5.0.0 → 6.0.0 bump). Season boundaries then carry the
state as it stood after the season's last OFFICIAL match, so offseason and
preseason exhibition play cannot seed the next season's prior. Within-season
offseason folding is NOT touched by this change.

## Why the decision is already principled, not number-seeking

- Jacob asked for it directly (2026-09-10): "make BPR only seed from official
  play like EPA."
- The research model that produced the sealed 78.05% holdout number
  (`packages/bpr/`) loads matches with `where e.is_offseason = 0`
  (`packages/bpr/data.ts`) — it has NEVER seen an offseason match, at any
  point, in any season. Production BPR folding offseason play into its
  carryover state is an unvalidated deviation FROM the sealed configuration;
  this change narrows that deviation. It does not re-describe the sealed
  number — the seal's world has no offseason matches for `carryFrom` to
  distinguish.
- Parity: EPA already carries from last-official; BPR's difference is an
  accident of porting order, not a modeled decision.

## The measurement (due diligence, not a gate for improvement)

One shared-stream design-era replay (seasons 2016-2020, 2022 — the holdout
2023+ is structurally never loaded), production configuration
(`includeOffseason: true`), two arms in the same `runSeasons` call:

- incumbent: shipped `bpr` (season-final carry)
- candidate: `{ ...bpr, id: "bpr-oc", carryFrom: "last-official-match" }`

Scored on the standard official population (aggregateScores' D-06/D-07/D-Q3
exclusions), plus paired per-match deltas with the event-blocked bootstrap
(`eventBlockedBootstrap`, 2000 resamples, seed 42) — the 260909-03b paired
two-sigma bar for the full design era is 0.169pp.

## Decision rule (fixed now)

1. SHIP the change unless the paired accuracy delta (candidate − incumbent)
   is WORSE than −0.169pp (a real, resolvable regression beyond the paired
   bar) — in which case STOP, do not ship, and surface the number to Jacob.
2. Any outcome better than that threshold ships, including a flat 0.000pp —
   the change is principled (see above), and 2016 (cold start) contributes
   no boundary so a small measured effect is expected.
3. Brier is recorded and reported but is NOT a gate here (the change cannot
   alter the link calibration mechanism, only boundary priors).
4. Ship = `carryFrom` line + `BPR_VERSION` 1.0.0 → 2.0.0 (+ the mechanical
   version-string updates in tests/fixtures) + a dated note in bpr.ts's
   header. The next full republish is what makes it live; the orphaned
   `bpr@1.0.0+baseline` generation then gets its own recorded delete pass.
