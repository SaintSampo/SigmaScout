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
| **Swing Score** | ONE number per team — its total consistency estimate for its NEXT match | users |
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

## 1. ~~Seed and deploy~~ — DONE 2026-09-09

BPR now folds live. Seed generation `a4a700dc` matched the live manifest exactly and its league row
declared `snapshotShapeVersion: 9`, matching the code, before anything was applied. **6,549 BPR rows
seeded** (1 league + 6,548 team); opr/epa/vpr row counts unchanged. Worker deployed with
`LIVE_ALGORITHM_IDS = "bpr"`, startup 72 ms, version `67590821`.

Verified by watching two consecutive cron ticks, both `ok:true` (1835 ms cold start then 341 ms,
1 subrequest each, zero errors).

**Not yet exercised, and honestly so: the BPR FOLD path.** There are zero live windows in September,
so every tick is idle (`eventsConsidered: 0`). The deploy is healthy and the state is loadable, but
no match has actually been folded through BPR in production. First live event is the real test —
watch a tick then, and check `event_cursor` advances.

## 2. Swing Score gets its OWN COLUMN

Developer decision, 2026-09-09: **per-component Swing Scores are not being built.** Swing Score is
one number per team — its total consistency estimate for its next match — and it gets its own
column rather than riding along as a `±` suffix on another metric.

What changes:

- **Teams table** — a dedicated Swing column. Total goes back to a bare value.
- **Team page** — Swing Score as its own tile, not a suffix on the Total tile.
- **Phase tiles / event metric cells** — bare values, permanently. This is now the intended design
  rather than a gap waiting on per-component work.
- **Ribbon `±` toggle** — should hide the Swing column/tile, since that is now the thing it names.
- **Match Band is unchanged.** It stays `√(Σ the three robots' Swing Scores²)` — an alliance
  quantity built from the per-team one.

Consequently the two displays previously listed as "waiting on per-component Swing Scores" need
re-deciding rather than un-blocking:

- the **Alliances tab's combined ±** — the honest replacement is the Match Band formula over the
  three picks, which needs no per-component anything and could be done now
- the **metric-history chart band** — it plotted a per-match spread. There is no per-match Swing
  Score, so either publish one or leave the band off for good. Its code is dormant behind a single
  flag in `MetricHistoryChart.tsx`.

## 3. Ranking points — ADAPTER BUILT 2026-09-09, awaiting a republish

`RpMomentsAccumulator` (`packages/core/rankingPoints/empiricalMoments.ts`) learns each team's
threshold-variable beliefs from observed results alone and produces `AllianceRpMoments` for ANY
algorithm — the score variance it needs is the swing band, which is why RP is reachable now and was
not before. Wired into `publishSeasons`' walk-forward loop beside the band, predict-before-update.
An algorithm that models its own RP keeps it.

Measured over the same 216 events of 2026 for `bpr`: median event artifact **57,555 → 68,112 bytes**
(+18%), payload-budget gate still green. 149 tests in the package, including the end-to-end path
for all ten seasons with no algorithm involved.

**Still to do, in order:**

1. **Republish** — nothing is live until then. `pnpm publish:seasons`.
2. **Flip `SIMULATION_AVAILABLE`** in `SimulationTab.tsx` once artifacts carry `redRpPmf`. It is a
   single constant, and the tab lights up for every algorithm at once.
3. **Verify the presim sidecar builds for BPR** — it 404s today. `preSchedule.ts` is already
   generic and should just work once RP exists, but confirm rather than assume.
4. **Check the bonus-RP dots** return in the match tables (`redBonusRp` is emitted now).

**Known bias, stated rather than discovered later:** the covariance block is diagonal and the score
cross-covariance is zero, so the joint draw understates how often an alliance clears both 2026
thresholds together. Narrower and less correlated than reality, pushing bonus probabilities toward
the extremes. Documented in `empiricalMoments.ts`'s header with the reasoning.

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

## 5b. `publish.ts --event` strips the SigmaScout layer (my regression)

The single-event republish path mirrors `publishSeasons` locally and never got the swing band or
RP, so running it on an event silently deletes that event's bands. Same defect shape as the
Worker's lossy merge. **Do not run `--event` on an event you care about** until fixed;
`pnpm publish:seasons` is unaffected. Two honest fix options in
`single-event-publish-path-drops-the-sigmascout-layer.md`.

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

## 7. BPR — the one open question

**Do components improve prediction?** Testable on **2016-2022**, the window BPR's parameters were
frozen on, **without spending the sealed 2023-2026 holdout**. Worth settling empirically before
anyone argues for feeding components into `predict`. BPR's own type warns why not: component splits
read per-season breakdown fields, and for 2023-2026 those were holdout schema.

BPR's constants are settled and are not to be revisited.

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

1. **Republish**, then flip `SIMULATION_AVAILABLE` and verify the presim sidecar and bonus dots
   (item 3's remaining four steps). This is the payoff for everything above it.
2. **Fix `--event`** (item 5b) before anyone uses it — it is a live footgun today.
3. **The Worker's swing accumulator** (item 4) — needs a shape bump, so batch it with the next
   re-seed.
4. **Swing Score's own column** (item 2) — and re-decide the two dormant displays.
5. **Algorithm rotation** (item 5), measured on a real fold.
6. Calibration and docs (item 6).

Watch the first live event of the season: it is the first real exercise of BPR's fold path.
