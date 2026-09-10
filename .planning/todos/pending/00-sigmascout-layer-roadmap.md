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
- BPR seeded into D1 and folding live; worker deployed (2026-09-09).
- Swing Score given its own column and tile (`1e89f6dd`).
- **Ranking points and the rank simulation are LIVE for every algorithm** — generation `511137fd`,
  108,805 objects. `054c8da1` turned the tab back on.

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

## 3. ~~Ranking points and simulation~~ — DONE 2026-09-09

Live at generation `511137fd`. Verified per algorithm on `2026casnv`, identically for opr, epa and
bpr: **74 of 89** played matches carry `redRpPmf`, **59** carry `redBonusRp`, and the pre-schedule
sidecar is **HTTP 200** where it was 404 for everything but VPR (`presim: count=641`). The tab
renders real rank distributions under BPR and OPR — medians, 10th–90th bands, the match slider,
over 20 synthetic schedules and 1000 draws.

**OPR now has a rank simulation.** It models no ranking points and never will; it gets them from
the SigmaScout layer. That was the point of moving RP out of the algorithm.

Two things carried forward rather than closed:

- **~~The known bias~~ — MEASURED 2026-09-09 (`4bdb7717`), and far worse than "a known bias".**
  Over 488,026 (alliance, bonus) observations across all ten seasons: mean predicted **0.1131**
  against an observed **0.3109**. Every bonus in every season under-predicts; 2016 `breach` is
  predicted at 0.0044 and happens 73.37% of the time. THREE causes, separated by measurement:
  independent draws across conjunctions (the diagonal block — 2025 `coralBonus` needs four reef
  levels at once and is 62x under), an apparently-unintended even-split variance shrinkage by
  exactly `rosterSize`, and two bonuses hardcoded `false` (2025 `autoBonus` happens 65.94% of the
  time and is predicted 0.0000). Full write-up and a suggested fix order in
  `rp-bonus-probabilities-are-severely-under-predicted.md`; re-measure with
  `scripts/measureRpCalibration.ts`.
- **Presim storage roughly tripled** — median 184 KB per sidecar, now for three algorithms instead
  of VPR's one. Comfortable against R2's free tier today; check it at the next budget review.

## 4. ~~Live match updates carry no band~~ — CODE DONE 2026-09-09 (`63596da3`), NOT YET DEPLOYED

The Worker now emits the Match Band on every match it folds and the per-team Swing Factor on
every team it touches. Each team row carries `sigmascoutSwing` — four running numbers — as a
PASSENGER injected by `withSwingBeliefs`/`readSwingBeliefs`, so no algorithm's serializer knows
it exists. `STATE_SNAPSHOT_SHAPE_VERSION` is **10**.

Offline moved onto the same incremental estimator first (`7c685676`), so there is one arithmetic
path rather than two that agree to twelve digits. Publish-neutral, measured: over 37,281 real band
comparisons, max raw difference 2.9e-11 and **zero** rows differ after rounding.

`scheduled.replay.test.ts` gained a SECOND digest covering the band. The existing one is pinned
byte-for-byte to `promote.ts` and covers only three prediction fields, so it could not have seen a
divergence in the field this bump was made for. Confirmed to fail with the emission reverted, and
it carries an explicit non-vacuity check.

**A real bug fell out of it.** The demo-team test caught that the swing fold ignored the
fully-demo-alliance rule every algorithm's `update` applies — a real alliance "beating" three
placeholders is not evidence of anything and must not move a band either. Offline had this wrong
too, since the band landed. The rule now lives in `SwingFactorAccumulator.foldMatch` so the two
callers cannot diverge. Over 2024–2026, 300 fully-demo matches were polluting the accumulator and
**8,017 of 122,310 published bands change** as a result.

**STILL TO DO — the production step, deliberately not taken unattended:**

1. `pnpm publish:seasons` — corrects those 8,017 bands AND emits shape-10 seeds.
2. `npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-bpr.sql`
3. Deploy the Worker.

**Seed first, deploy second.** A deploy carrying shape 10 against un-re-seeded rows throws
`LeagueRowShapeVersionError` and takes live folding down until the seed runs. September has no
live windows, so this is the cheapest possible moment to do it.

## 5. All algorithms folding live — blocked by arithmetic, with a way through

`cost(n, teams) = 2 + 2n + 2n(1+teams)` against 41 usable subrequests. At 6 touched teams: one
algorithm costs 18, **two cost 34**, three cost 50, four cost 66. R2 has no batch API, so the
per-team artifact term cannot be collapsed the way D1 access already is.

The way through is rotating **two algorithms per tick**, giving every algorithm a fold every two
minutes against a 1–3 minute freshness target. The Worker already rotates events with a
no-starvation guarantee. CPU is the tighter constraint (idle ticks run 5–9 ms of a 10 ms budget) —
measure a real fold before trusting it. Detail in `vpr-retirement-make-features-algorithm-agnostic.md`.

## 5b. ~~`publish.ts --event` strips the SigmaScout layer~~ — DONE 2026-09-09 (`41dbbe2d`)

The per-match math moved into `sigmaScoutLayer.ts` and **both** orchestrations now drive it, so a
level-2 field can no longer reach one write path and not the other. Verified on the real corpus:
`--event 2026casnv` emits band on 75 of 89 played rows, `rpPmf` on 74, `bonusRp` on 59, and a
197 KB presim sidecar — matching the published artifact's own coverage, for bpr and opr alike.

The planned fix was the wrong one. The todo doc proposed carrying published values forward,
because it assumed `--event` replays only its own event. That premise was stale — plan 07-09
already made this mode replay the whole season for the percentile pool — so the correct fix
(recompute properly) turned out to be free.

Four parity tests now pin the two paths together, and each was **confirmed to fail against the old
behavior before being kept**. Worth noting what did not catch this: 1083 passing unit tests, and a
`--dry-run` byte count, which cannot see a missing field.

## 5c. `--event` writes different NUMBERS than the full publish — measured, and worse than 5b was

Fixing the strip made this measurable. `--event` replays its season **cold**, while
`pnpm publish:seasons` threads carry state from 2016. Against the live `2026casnv` artifact:
**`pRedWin` differs on 86 of 89 rows**, and on `qm1` `--event` says `0.5` — the cold-start coin
flip — where the live publish says `0.055`.

This is upstream of the SigmaScout layer entirely; band and RP are computed identically by both
paths now and differ only because the predictions beneath them do. The strip at least showed as
absence — this replaces good numbers with worse ones and leaves an artifact that looks normal.

`runEventMode`'s header has disclosed this since plan 07-09 as "close to but not identical".
`0.5` vs `0.055` is not close. **The "do not run `--event` on an event you care about" warning
stands, for this reason now.** Three options, including a genuinely interesting one (persist each
season's end state during `publish:seasons` and have `--event` load it), in
`event-mode-replays-cold-and-writes-different-numbers.md`.

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

## 9. ~~Test-suite hygiene~~ — DONE 2026-09-09 (`1a7bd4c1`)

**The full suite is green: 225 files, 4127 passed, 0 failed.** It had not been, and that mattered —
a red suite is how the last 8-day red hid, and these parity tests would have meant nothing arriving
into an already-red run.

Three unrelated failures, all pre-existing:

- `replayRig.test.ts` still pinned `PUBLISHED_ALGORITHM_IDS` to the four-member list including
  `vpr`. VPR left that list on 2026-09-09 (`eae2defb`) and the pin was not updated with it. The
  equality pin is the right shape — it failed loudly on a membership change, exactly as designed.
- `seasonParamSets` D-4 Leg B (replays two full seasons twice over) and `algorithmIdentity` (reads
  every source file in the repo) run 6–7 s against vitest's 5 s default. Given explicit 30 s
  timeouts. They were never flaky in the "sometimes wrong" sense — just slow, and only under
  full-suite parallel load.

The "re-run in isolation before treating a full-run failure as a defect" workaround is retired.
Treat a full-run failure as a defect.

---

## Suggested order

1. **Ship item 4's production step** — publish, seed, deploy, in that order. The code is committed
   and the suite is green; what is left is the part that touches production, and September's empty
   calendar is the cheapest window for a shape bump.
2. **Fix the RP under-prediction** (item 3's measured bias), cheapest cause first: the `rosterSize`
   variance shrinkage, then 2025's hardcoded `autoBonus`, then the diagonal block itself — for
   which a single GLOBAL per-season correlation is worth trying before a per-team cross-term that
   the sample size cannot support.
3. **Decide what `--event` is for** (item 5c) — fix its cold replay, or delete the path. It cannot
   stay as a republish command that degrades what it republishes.
4. **Algorithm rotation** (item 5), measured on a real fold.
5. **Calibration and docs** (item 6), and re-decide the two dormant displays from item 2.

Watch the first live event of the season: it is the first real exercise of BPR's fold path AND of
the live RP path.
