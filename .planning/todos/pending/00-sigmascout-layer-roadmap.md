---
id: 00-sigmascout-layer-roadmap
created: 2026-09-09
source: consolidated from the 2026-09-08/09 session — Swing Factor, the match band, VPR's retirement, and the ranking-point extraction
resolves_phase:
priority: high
---

# Roadmap: the SigmaScout layer, and what VPR's retirement left open

The organising idea, in the developer's words: there are **two levels**. Level 1 is the ALGORITHM
(OPR, EPA, BPR) — it predicts scores. Level 2 is SIGMASCOUT'S OWN FEATURES, built on top and
computed identically for every algorithm. Swing Score, the match band, ranking points and the rank
simulation are all level 2. No algorithm should have to know about them.

Three vocabulary rules, now enforced in code:

| term | what it is | who sees it |
|---|---|---|
| **Swing Score** | per team, per metric — how much a robot's contribution varies match to match | users |
| **Match Band** | per alliance, per match — `√(Σ the three robots' Swing Scores²)` | users |
| **spread** | the ALGORITHM's own confidence in a number | **nobody — never rendered** |

---

## DONE this session

- Swing Factor computed at publish time for every algorithm; band attached to the one shared
  record both artifact builders read, so a match reads identically on a team page and an event
  page (`203a2bea`, `53b4bf87`). Verified live: 0 mismatches across all four algorithms.
- The estimator centres, so a model that is consistently wrong about a robot no longer reads as a
  robot that is inconsistent (`6e22b672`).
- Live ticks stopped deleting offline-published fields — they were silently dropping `ranks`,
  `robotImageUrl`, `activeYears` and would have eaten `swingFactor` (`94b4ccd3`).
- No silent Sigma1 fallthrough in the live tier, and BPR got the shape guard it alone lacked
  (`e50bacd5`).
- VPR removed from the site; BPR is the premier algorithm (`eae2defb`).
- **spread no longer reaches the screen** — eleven leak paths closed at their single root cause
  (`ac4e79e6`).
- Ranking points lifted out of `sigma1/` into `packages/core/rankingPoints/` before it could be
  deleted with the retired algorithm (`708ab089`).

---

## 1. Finish the deploy — BPR does not fold live yet

D1 still holds VPR's state. BPR's rows do not exist until `seed-bpr.sql` is applied, so the live
tier is configured for BPR but cannot fold. **Seed first, deploy second.**

This is the shortest item on the list and the only one blocking live behaviour.

## 2. Per-component Swing Score — the visible gap

Swing Score is computed from TOTAL-score residuals only, so the Auto/Teleop/Endgame tiles, the
event metric cells and the Teams table's component columns render **bare values**. That is honest
(there is no per-component number to show) but it is a real loss versus what VPR displayed.

Needs per-component residuals: actual minus predicted per phase, which needs per-phase
PREDICTIONS. BPR already keeps display-only phase filters (`phaseTeams`), so the work is to emit
per-match phase predictions from that isolated track and fold them the same way the total is
folded. Publish-layer work plus a republish.

Two things unblock automatically when it lands:
- the **Alliances tab's combined ±**, removed with the spread leak — its replacement is the same
  `√(Σ Swing Score²)` the match band already uses (`AlliancesTab.tsx` names this in place)
- the **metric-history chart band**, whose code is intact and dormant behind a single flag in
  `MetricHistoryChart.tsx` and needs per-MATCH Swing Scores

## 3. Ranking points for BPR — everything downstream is already built

`packages/core/rankingPoints/` is universal and tested without any algorithm attached: ten season
rule modules, the registry, the constants, and the Monte Carlo. The only missing piece is an
adapter producing `AllianceRpMoments` for BPR — per-team beliefs over the season's threshold
variables, plus score mean/variance/cross-covariance.

For 2026 that is **two variables**, and neither is a phase total:

| bonus | gated on |
|---|---|
| Energized, Supercharged | `hubTotalCount` — a raw fuel COUNT, never points |
| Traversal | `totalTowerPoints` = `autoTowerPoints + endGameTowerPoints` |

**So modelling auto/teleop/endgame points does not unlock RP.** Do not conflate item 2 with this
one — they want different quantities, and building eleven point components would still leave two
of three bonuses unpredictable.

Read `rankingPoints/moments.ts` before implementing: it names the assumptions an adapter must
consciously satisfy rather than inherit (a diagonal covariance block asserts `hubTotalCount` and
`totalTowerPoints` are uncorrelated, which is probably false).

Restores with this: the **Simulation tab** (dark for every algorithm since VPR left — BPR's presim
sidecar 404s where VPR's returned 200) and the **per-bonus RP dots** in match tables.
`preSchedule.ts` is already generic and needs no changes.

## 4. Live match updates carry no band — and the shape bump they need

`buildEventMatchRow` emits no band, so every match the Worker folds during a live event loses its
band until the next full publish. Detail and the full design in
`live-match-updates-swing-and-lossy-merge.md` (defect 2 — defects 1 and 3 are done).

The estimator does NOT need a deviation history: four running numbers per team under West's
weighted incremental variance, O(1) per match, numerically stable. The catch is that the offline
side uses an exact two-pass form, so **both should move onto the same accumulator** or live and
offline will agree algebraically but not bit-for-bit — against a contract built on bit-equality.
`scheduled.replay.test.ts`'s digest covers only three prediction fields today and would not catch
the divergence; extend it.

Costs a `STATE_SNAPSHOT_SHAPE_VERSION` bump 9 → 10, which invalidates every live row with no
migration path by design. **Ride the same re-seed as item 1** rather than making it a second
outage.

## 5. All algorithms folding live — blocked by arithmetic, with a way through

`cost(n, teams) = 2 + 2n + 2n(1+teams)` against 41 usable subrequests. At 6 touched teams: one
algorithm costs 18, **two cost 34**, three cost 50, four cost 66. R2 has no batch API, so the
per-team artifact term cannot be collapsed the way D1 access already is.

The way through is rotating **two algorithms per tick**, giving every algorithm a fold every two
minutes against a 1–3 minute freshness target. The Worker already rotates events with a
no-starvation guarantee. CPU is the tighter constraint (idle ticks run 5–9 ms of a 10 ms budget) —
measure a real fold before trusting it. Detail in `vpr-retirement-make-features-algorithm-agnostic.md`.

## 6. Calibration and honesty items

- **The band is conservative, not broken.** Over 36,805 alliance observations, RMS z = 0.920 and
  **75.2% land inside a band drawn as ±1σ** where 68.3% is nominal. Not sketch 003's failure, but
  "±1σ" implies 68% and delivers 75%.
- **A systematic under-prediction.** Mean z = +0.1197 at ~25σ — alliances outscore their
  prediction by roughly **11 points**. Likely a filter lagging teams that improve across a season;
  untested. Belongs in the model, not the band.
- **Asymmetry is real but modest and POPULATION-level.** Upper semi-deviation 73.27 vs 64.91
  below, ratio 1.129. It balances the miss rates (14.3/11.8 → 13.2/13.0) without covering more.
  Must use the global ratio — a team's ~9 effective observations cannot support a per-team skew.
- **The docs are still false.** `pageArtifacts.ts`'s header and `uncertainty-display.md` both state
  the sum-of-squares identity for the PUBLISHED `redScoreVarianceOwn` as an enforced rule. Nothing
  reads that field on the event page any more, but the prose still asserts it.

All measured and detailed in `match-band-calibration-and-the-broken-additivity-identity.md`.

## 7. BPR itself

- **It has never been tuned and there is no path to tune it.** 14 hardcoded constants,
  `paramSetName: "baseline"`, and **no `bpr` entry in the tuning search space at all**. Deliberate
  and honest — frozen on 2016-2022, evaluated once on a sealed 2023-2026 holdout — but the numbers
  are a single frozen guess and the headroom is unmeasured. VPR's whole tuning apparatus now
  serves nothing.
- **Do components improve prediction?** Testable on **2016-2022** — the window BPR's parameters
  were frozen on — **without spending the holdout**. Worth settling empirically before anyone
  argues for feeding components into `predict`. Note BPR's own type warns why not: component
  splits read per-season breakdown fields, and for 2023-2026 those were holdout schema.

## 8. Cleanup left by the retirement

- `sigma1/` model code is still present; `remove-swing-from-sigma1-core.md` covers the swing half.
  `sigma1/rp/state.ts` is now the only RP piece left there and dies with VPR.
- The promoted-version machinery (`applyPromotedOverrides`, `PROMOTED_VPR_VERSION_PATH`) still
  exists in `cli.ts` for tuning runs; `buildAlgorithmsManifest` no longer uses it.
- Published `vpr@` objects remain in R2, unreferenced. Deliberate — the retirement removed the id
  from the site, not data already written.

## 9. Test-suite hygiene

Two suites fail only in FULL runs and pass in isolation, which makes every full run ambiguous:
`seasonParamSets` D-4 Leg B and `algorithmIdentity`. Both documented in
`flaky-seasonparamsets-equivalence-gate.md`. Until fixed, **re-run in isolation before treating a
full-run failure as a defect**.

---

## Suggested order

1. **Seed and deploy** (item 1) — nothing live works without it.
2. **Item 4's shape bump rides that same re-seed**, so do the Worker accumulator with it.
3. **Ranking points for BPR** (item 3) — biggest user-visible win, and everything downstream is
   already written and tested.
4. **Per-component Swing Score** (item 2) — unblocks two dormant displays at once.
5. **Algorithm rotation** (item 5), measured on a real fold.
6. Calibration, docs and BPR tuning questions (items 6–7) as separate, evidence-first pieces.
