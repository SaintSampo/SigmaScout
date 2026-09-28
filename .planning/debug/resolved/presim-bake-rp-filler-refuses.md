---
status: resolved
trigger: "District presim bake refuses nearly every event with no-ranking-point-filler"
created: 2026-09-28
updated: 2026-09-28
---

# Debug: the district presim bake refuses nearly every event with no-ranking-point-filler

## Symptoms

<!-- DATA_START -->
- **Expected:** An unstarted district event with a registered roster and rated teams bakes a presim sidecar (`v1/district-presim/{district}/{event}.json`). At the "now" position, an unstarted event's Locks tab prediction cells come ONLY from that sidecar. `useDistrictLedgerData.ts` fetches no event artifact and runs no Worker for it.
- **Actual:** `npx tsx scripts/publishDistricts.ts --years 2026-2026 --as-of 2026-03-01 --dry-run --local-out <scratch>` reports:
  - census: `season 2026 bake census — considered 150, baked 0; ineligible: not-a-remaining-event=119, divisioned-dcmp-parent=8; skipped: no-ranking-point-filler=23`
  - every skip logs as `publishDistricts: bake skip <event> [spr]: the all-or-nothing ranking-point filler rejected this roster`
  - the 23 skipped events: 2026caasv, mibat, miken, mimus, mitr2, inlaf, inwas, txama, txcl2, txhou, txman, njski, paphi, sccha, isde3, isde4, ctwat, mabos, mawor, vtbur, onwel, orore, waahs
- **At `--as-of 2026-04-04`:** 2 baked (including 2026onwel and 2026miken), 1 skipped with no-ranking-point-filler (2026njski).
- **Error messages:** none thrown. The skips are typed, with reason `no-ranking-point-filler`.
- **Timeline:** found 2026-09-27 during quick task 260927-syh. Unknown whether it ever worked for early season instants.
- **Reproduction:** the command above. Each run takes about 3.5 minutes, most of it the replay. Baseline logs:
  - C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/3c57a05a-d20e-47df-8edd-35005826589b/scratchpad/bake-0301-before.log (as of 2026-03-01)
  - C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/3c57a05a-d20e-47df-8edd-35005826589b/scratchpad/bake-before.log (as of 2026-04-04)
<!-- DATA_END -->

## Constraints

- Walk-forward: nothing after the as-of instant may leak into a bake.
- No publish, push or deploy without asking Jacob. Local dry runs with `--dry-run --local-out` are fine.
- Never Read or print .env. The dry run needs no credentials.
- Run vitest from the repo root and verify by the output.
- Stage by explicit path. Other sessions share this checkout.

## Current Focus

- bug_class: Bohrbug (deterministic, same census every run)
- status: ROOT CAUSE CONFIRMED. Decision 2 (the two as-of leaks) FIXED in 47eceffa. Decision 1 PART 1 DONE (2026-09-28): the acceptance bar is pre-registered (section below, sha256 9b83748be0f9c1c59edff6109df74f2c965887e6fefb8d76ab169c6e794ab8f4), and the Sigma-carry candidate is built INERT at its default and committed (14088080 candidate, f3e5fa10 Part 2 instruments). Decision 1 PART 2 DONE (2026-09-28): NO-GO. G4b fails on its bonus-Brier leg, and every other gate passes (see "## Decision 1 Verdict"). The production default stays off, so the early-season refusals the trigger reports persist in production (03-01 still bakes 0). Removing them needs Jacob's decision on a revised candidate or on the bar.
- confirmed hypothesis H1: `makeRankingPointFiller` (packages/harness/publish.ts:462) returns undefined when any roster team is missing from `layer.sigmaScoreByTeam()`. `buildDistrictPricingState` (scripts/districtPricingState.ts:230) builds the target season's SigmaScoutLayer fresh, with no carry from the warmup seasons, and `SigmaScoreAccumulator.scoreByTeam()` lists only teams it has folded or observed. So a team with no folding match this season before the as-of instant has no Sigma Score, and the whole roster is refused.
- masked second gate: once Sigma is solved, `bakeDistrictEvent`'s unrated check needs an SPR `total` for every roster team, and SPR `teamMetrics` omits never-seen teams (rookies) by design. 121 of 135 unstarted events at 2026-03-01 carry at least one rookie.
- reasoning_checkpoint (drafted for the fix step; fix_rationale waits on the option chosen):
  hypothesis: "Every early-season roster is refused because the filler demands an in-season Sigma Score for every roster team, and in-season Sigma exists only after a team's first folded match of the season."
  confirming_evidence:
    - "as-of 2026-03-01: sigma map size 0, Sigma population count 0, zero folding 2026 matches replayed; filler refused 135 of 135 unstarted rosters"
    - "as-of 2026-04-04: 6 refusals, every missing team is plays-2026-only-after-asof (47 team-event pairs); rosters whose teams have all played bake"
  falsification_test: "An event whose every roster team has a folded 2026 match before as-of being refused by the filler. None observed (13 of 13 such events at 04-04 pass)."
  fix_rationale: "(decided: Decision 1 = option B, see the Decision 1 checkpoint below)"
  blind_spots: "Calibration of the Sigma prior for a never-seen team as an UPCOMING pricing input has never been measured. The RP accumulator's cold-team moments were not inspected in depth."
  candidate_causes:
    - "code: filler all-or-nothing Sigma membership rule plus a per-season cold-restarted Sigma layer"
    - "data: registered no-shows who never play 2026 (17 team-event pairs at 03-01)"
    - "code (verification path): as-of candidate selection reads season-final district rankings"
  and_gate: "yes. Refusal needs BOTH the filler's in-season Sigma requirement AND a roster team with no folded in-season match. Rookies add an independent third condition (no SPR total) that will surface as unrated-teams once the first two are addressed."
- decision (Jacob, 2026-09-28, via AskUserQuestion): Decision 1 = carry Sigma across seasons plus a rookie rating from SPR's rookie prior (option B, gated model change, SEPARATE later cycle). Decision 2 = fix both as-of leaks (candidate selection from as-of data; cut the replay at match time).
- cycle history: cycle 2 did Decision 2 only. Cycle 3 (Decision 1 Part 1): pre-registered the bar, then built the candidate inert at default with tests. It ran no backtest and no knob-on dry run.
- reasoning_checkpoint (Decision 2, the verification path):
  hypothesis: "The as-of dry run reads post-as-of data in two places: bake candidacy uses season-final district_rankings event_points (and season-final played-qual counts gated by start date), and the replay admits every match of an event whose start date precedes as-of, including matches played after as-of."
  confirming_evidence:
    - "03-01: 119 of 150 events not-a-remaining-event although 135 non-parent events had not started; the 23 candidates are exactly the no-show events"
    - "diag-asof2: start-date truncation admits 491 post-as-of matches at 03-05 and 850 at 04-04"
  falsification_test: "After the fix, an as-of run whose replayed count exceeds the count of played matches with sort_time < as-of, or a no-as-of run whose output differs by any byte from the pre-fix run at the same pinned clock."
  fix_rationale: "Candidacy counts a team's district-points event as played only when that event was underway at as-of (a played match with sort_time < as-of; start date when the corpus holds no played match for it). The in-progress gate counts qual matches with sort_time < as-of. The replay drops every played match with sort_time >= as-of, in every replayed season. Each rule reduces to the old one when nothing in the corpus is at or after the instant, which is the production condition (measured: 0 such matches)."
  blind_spots: "Rosters (event_teams) and schedule length (qm row count, which sets matchesPerTeam) are still season-final in an as-of run; the corpus carries no timestamp for either, and filtering them would change production. The composed district artifact itself (eventPoints, pointTotal, rankings) stays season-final in an as-of run; only candidacy is in scope."
  candidate_causes:
    - "code: candidacy reads season-final event_points_raw through the composed artifact's remainingEvents"
    - "code: replay truncation keyed on events.start_date rather than matches.sort_time"
    - "data: sort_time fallback (synthetic composite time) would make a match-time cut approximate; measured 0 synthetic 2026 played matches"
  and_gate: "no. Each leak stands alone: candidacy and the replay read different tables through different predicates."
- decision_2_result: fixed in 47eceffa. Guardrail accepted (see Resolution.verification). Post-fix dry-run baselines for Decision 1 to compare against: scratchpad/bake-0301-after, bake-0305-after, bake-0404-after (+ .log).
- open findings for Jacob (not fixed, out of this cycle's scope):
  - F1 roster leak in the as-of path: rosters (event_teams) are season-final. At as-of 04-04, 10 of the 14 baked events are DCMP divisions (micmp1-4, txcmp1-2, necmp1-2, oncmp1) whose rosters depend on district results after 04-04. Production is unaffected, because TBA publishes a DCMP roster only after qualification. For verification fidelity, a candidate rule is to make a DCMP-tier event ineligible in an as-of run until the district's last regular event has finished.
  - F2 the `divisioned-dcmp-parent` reason covers every event_type 2 event, including single-venue DCMPs that have a qualification schedule (nccmp, sccmp, incmp, wicmp, mrcmp, pncmp, cancmp; 62 to 132 played quals each). So the bake never prices an undivided DCMP. This is pre-existing and was masked before, because the season-final candidacy marked 7 of these 15 events not-a-remaining-event.
  - F3 (found in cycle 3) the published EVENT presim sidecar for a played event prices SPR from the pre-event state, but builds its RP filler from the season-final Sigma map, RP accumulator and mean shift. Those include the event's own matches, so this is a walk-forward leak in those pmfs (Evidence, "new finding F3").
  - Shipping consistency (not a finding, a to-do if Part 2 says GO): in this candidate only the district bake applies the rookie rule. With the knob on in publishSeasons, the event presim and upcoming rows price carried rosters but still refuse rosters that include a rookie, and the Worker would price carried teams only through a republished seed. Shipping needs a decision on whether the event page adopts the same rookie rule.
- reasoning_checkpoint (Decision 1, the candidate):
  hypothesis: "Early-season rosters are refused because the target season's Sigma layer starts empty and SPR rates no never-seen team. Starting the layer from the previous season's carried accumulator and rating never-seen teams with SPR's own unseen-team prior satisfies both the filler's all-or-nothing Sigma membership and the bake's unrated-teams check, without relaxing either rule."
  confirming_evidence:
    - "real corpus, as-of 2026-03-01, warmup [2025]: knob off gives Sigma map size 0 and predictFor(2026mibig) undefined; knob on gives predictFor defined and all 41 roster teams a finite total and Sigma > 0, rookies at SPR's unseen total (districtPricingState.test.ts)"
    - "knob off is byte-identical on every instrument (Evidence, section D inertness)"
  falsification_test: "Part 2: a knob-on as-of dry run that bakes no more than the knob-off one at 2026-03-01 (G5), or a knob-on Compare page that differs by any byte from knob-off (G1)."
  fix_rationale: "It removes the cause (a per-season cold restart of the Sigma accumulator, and no rookie rating) instead of weakening the all-or-nothing rule. That rule exists because a band summed from only the known roster members reads as confident and is wrong."
  blind_spots: "(a) The RP moments accumulator still restarts every season: a team with no in-season RP history contributes zero threshold means, so pre-event bonus odds for cold rosters are biased low. The carry cannot fix that, and G4b tests whether such pmfs still beat climatology. (b) Carried volatility evidence is in the previous season's points; scoring levels move between games, and the carried evidence decays with the team's own matches. (c) rookieMean is in-sample for 2016-2022. (d) Only the bake applies the rookie rule (the shipping consistency item above)."
  candidate_causes:
    - "code: the target-season Sigma layer is built cold (districtPricingState, publishSeasons)"
    - "code: SPR teamMetrics omits never-seen teams, so the bake has no total for rookies"
    - "data: registered no-shows (17 team-event pairs at 03-01), covered by the carry when they are returning teams"
  and_gate: "yes. A roster bakes only when EVERY team has both a Sigma and a total, so the carry and the rookie rating are both needed."
- part_2_progress (cycle 4, 2026-09-28): DONE, 06:01:59Z to 06:20:01Z. The bar digest was verified before any run and again at the end (9b83748b..., 11918 bytes, unchanged). State was the same before and after: HEAD f3e5fa10, `git status --short -- packages scripts apps` clean, data/corpus.sqlite 592121856 bytes with mtime 2026-09-25 11:43:55.655 -0400 (WAL 0 bytes). Runs were detached via scratchpad/start-detached.ps1, with outputs and logs under scratchpad/d1/. No instrument fix was needed.
- decision_1_part_2_result: NO-GO. G4b FAILS on its bonus-Brier leg: candidate 0.173994 against climatology 0.140040 on 385096 observations. Its RPS leg passes (0.160718 against 0.179949). G1 EQUAL, G2, G3, G4-cover, G4a and G5 pass (G5: 03-01 bakes 135 with the knob on against 0 off). Part 2 ran before Jacob signed off on the Rule A reading, which makes the verdict conditional, but it is NO-GO under either answer. See "## Decision 1 Verdict". The production default stays off, and nothing was bumped, republished, reseeded, deployed or pushed.
- next_action: "Awaiting Jacob: Rule A reading sign-off, then on GO the SPR version bump and rollout decision (republish, D1 seed, event presim adoption of the rookie rule); findings F1, F2, F3 open"

## Pre-registered Acceptance Bar (Decision 1)

Registered: 2026-09-28T05:25:00Z, before any backtest, coverage dry run or candidate output existed. Written by the Decision 1 Part 1 cycle at HEAD 47eceffa. Part 2 runs exactly what is below, reads the verdicts mechanically, and may not add, drop, reweight or reinterpret a gate after seeing a number. Everything a command prints beyond the gate lines is descriptive only.

### What the candidate is (one configuration, no search)

The knob is `sigmaCarry`, a boolean. Off (the default, and the only production value) is the incumbent. On is the single candidate configuration, with no numeric parameter:

1. Carry. Season S's SPR SigmaScoreAccumulator starts from season S-1's accumulator as it stood right after S-1's LAST OFFICIAL match (`isOfficialEventType`; the same instant SPR's own `carryFrom: "last-official-match"` carries from; if S-1 folded no official match, its end state). Per team: the volatility evidence (`varWeight`, `sumSquares`) and the last observed `talent` carry unchanged, with no boundary decay, because the accumulator already ages evidence by the team's own matches (varHalfLife 6) and not by the calendar. The bias term (`mean`, `meanWeight`) resets to zero, as SPR resets its fast component at a boundary. The talent prior's population statistics start from S-1's OWN population (what S-1 folded, excluding what S-1 itself carried in), so no season's residuals reach further than the next season. A season that folded nothing (the empty 2021) passes its carried-in population through unchanged. The first replayed season (2016) starts cold, exactly as today.
2. Rookie rating (bake and measurement only). A roster team SPR has never seen gets the SPR total that SPR's own `predict` already assigns an unseen team: `rookieMean x unit` at the pricing instant (`rookieMean` 0.55, frozen 2026-09-08 on 2016-2022 only; `unit` = the walk-forward `scale / 3`). A roster team with no Sigma belief gets the accumulator's own prior-only Sigma at that team's total (`priorSigmaAtTalent(total)`, which is exactly what `sigmaFor` reads for a team whose only information is its talent). Nothing else changes: SPR `predict`, `update`, `teamMetrics` and the published rows are untouched.

### Why Rule A reads as an exact-equality check here (fixed now, before any result)

From the code (Evidence, Decision 1 cycle, section A): SPR's `pRedWin` is computed inside `spr.ts` `predict` from SPR state alone (`muL`, `muS`, `pL`, `pS`, `logTau`, `obsSd`). The published winner accuracy and Brier (`aggregateScores` in `packages/harness/score.ts`, scorer `packages/core/scoring/brier.ts`) are computed in `publishSeasons` from `records` (the raw walk-forward output) before any `SigmaScoutLayer` runs, and read `pRedWin` and the actual winner only. Sigma never enters SPR. So the carry and the rookie rating CANNOT move winner accuracy or winner Brier, and Rule A's "both improve" cannot be met by this change by construction.

The pre-registered reading: for this level-2-only change, Rule A is satisfied if and only if gate G1 below shows EXACT equality of every published winner accuracy and Brier figure between the arms. EQUAL is not an improvement and is not reported as one. NOT EQUAL means a level-2 to level-1 leak and is an automatic NO-GO. Acceptance of the change itself then rests on G2 to G5. This reading is fixed here; the orchestrator puts it to Jacob before Part 2 runs, and if Jacob rejects it the candidate is NO-GO under Rule A with nothing run.

### Scorers (identical for both arms)

- G1: the published scorer, through the real publisher: `scripts/captureCompareSlices.ts` runs `publishSeasons` in dry run and keeps the Compare page bodies. Ties are scored in Brier at 0.5 and excluded from accuracy; a 0.5 no-call counts as a miss.
- G2 to G4: one script, `scripts/measureSigmaCarry.ts`, folds BOTH arms from ONE replay per season (arms multiply layers, never replays) and scores both with the same functions: `insideBands` from `scripts/measureMatchBandCoverage.ts` (the published band harness), and `buildRpCalibrationRecord` / `buildTotalRpSummary` / `rankedProbabilityScore` from `scripts/measureRpCalibration.ts` (the scorer that produces the published `rpCalibration` block). The replay is the publisher's: SPR only, offseason included, `seasonBoundaryFor` + `carrySeason` over the published gapped season list 2016-2020, 2022-2026, the corpus cold-start index, talent captured after each match as `publishSeasons` captures it.
- Every paired comparison asserts identical observation counts in both arms; a mismatch voids the comparison and is a NO-GO (instrument defect), never a silent skip.

### Season sets and match sets

- G1: all ten published seasons 2016-2020, 2022-2026, every algorithm, every comp-level view, every slice field.
- G2 to G4: counted seasons 2017-2020, 2022-2026 (nine). 2016 is replayed and not counted: it is the cold-start season, with no prior season to carry from, so the carry is identical to the incumbent there by construction and the rookie rule would price from a scale-0 state.
- Official play only (`isOfficialEventType`) in every G2 to G4 population.

### Gates

- G1 (Rule A, exact equality). Pass iff `compare-off.json` and `compare-on.json` are byte-identical (`cmp` exit 0). Both captures stamp the same fixed generation and computedAt, so any byte difference is a real difference.
- G2 (band calibration, played rows). Rows: every alliance side of every official played match in the counted seasons, all comp levels, gated exactly as `measureMatchBandCoverage.ts` gates (fully demo match, empty roster, fully DQ'd zero-score side, non-finite actual or predicted score all skipped), and present with a band in both arms. Metric: the pooled share of rows with `|actual - predicted score| <= sqrt(published matchBand variance)`; calibration error = `|share - 0.683|`. Pass iff error(candidate) <= error(incumbent). Descriptive only: the 2-band share, per season, per coldest-robot bucket.
- G3 (RP on played rows, the matched set). Observations: official played qualification matches (`isBonusRpCompLevel`) in the counted seasons where both arms produced `redRpPmf`/`blueRpPmf` (every SPR played row does). Bonus observations: each side's predicted bonus probabilities against `actualBonusFlagsForSeason` flags (null flags and length mismatches skipped, as `measureRpCalibration.ts` skips them). Metrics: pooled bonus Brier (mean of `(p - actual)^2` over every (side, bonus) observation, i.e. the count-weighted mean of `buildRpCalibrationRecord`'s per-bonus Brier) and pooled total-RP ranked probability score (`buildTotalRpSummary`, count-weighted across seasons). Pass iff bonusBrier(candidate) <= bonusBrier(incumbent) AND RPS(candidate) <= RPS(incumbent). Descriptive only: 3-outcome Brier, per season.
- G4 (pre-event pricing, the upcoming path the bake and presim use). Unit: every official event in the counted seasons with at least one played RP-eligible qualification match and a pre-event SPR state. Instant: immediately before the event's first played match in the season's chronological stream (both layers have folded every earlier record; the SPR state is the state after the preceding record). Roster: the distinct teams of the event's played qualification matches. Each played qualification match is priced as an upcoming match: `spr.predict(preEventState, toLeakProofUpcoming(match))`, then `makeRankingPointFiller`. Incumbent: the incumbent layer's accumulator, mean shift and `sigmaScoreByTeam()` (all-or-nothing per roster, exactly as the bake and presim refuse today). Candidate: the candidate layer's accumulator and mean shift, with the candidate Sigma map (carried `sigmaScoreByTeam()` plus the rookie rule for any roster team missing from it). I = matches the incumbent prices, C = matches the candidate prices. Scored exactly as G3.
  - G4-cover: |I minus C| must be 0 (the candidate may never drop a match the incumbent prices).
  - G4a (matched set I and C): pass iff bonusBrier(candidate) <= bonusBrier(incumbent) AND RPS(candidate) <= RPS(incumbent), on identical observations.
  - G4b (newly covered set C minus I): pass iff bonusBrier(candidate) < bonusBrier(reference) AND RPS(candidate) < RPS(reference), on identical observations, where the reference is walk-forward season-to-date climatology at the same instant: bonus i probability `(k_i + 0.5) / (n + 1)` over the n official qualification alliance sides of the same season folded strictly before the instant with derivable flags (k_i earned bonus i); total-RP pmf over `0..maxRp` of `(c_k + 1/(maxRp + 1)) / (n' + 1)` over the n' such sides with an integer in-support RP (c_k with RP = k). Descriptive only: the candidate's own played-row pmfs on C minus I (a ceiling, since they price with in-event information), counts per season, the 2017-2020/2022 (rookieMean in-sample) against 2023-2026 split.
  - Coverage is never an accuracy claim: |I|, |C|, |C minus I| are reported as counts beside, never inside, G4a and G4b.
- G5 (the payoff: district bake coverage, 2026). Census `baked` count from `publishDistricts` as-of dry runs at 2026-03-01, 03-05, 03-14, 03-21 and 04-04, knob off and knob on. Knob-off baselines: 03-01 = 0, 03-05 = 0, 04-04 = 14 (scratchpad `bake-0301-after.log`, `bake-0305-after.log`, `bake-0404-after.log`, run at 47eceffa, which the Part 1 inertness proof shows the knob-off path reproduces), 03-14 and 03-21 made by Part 2 with the knob off. Pass iff baked(on) >= baked(off) at every one of the five instants AND baked(on, 03-01) > baked(off, 03-01). Every knob-on run must complete with every sidecar schema-parsed (the script parses before writing; a throw is a NO-GO).

### GO / NO-GO (mechanical)

GO iff G1 EQUAL, G2 pass, G3 pass, G4-cover pass, G4a pass, G4b pass and G5 pass. Anything else is NO-GO, and Part 2 names every failing gate with its two numbers. A crash or a voided comparison is NO-GO (inconclusive). Part 2 may fix an instrument crash and rerun only if the fix changes no scored quantity and no candidate code, and must say so. No gate is rerun with a different configuration, knob value, season set, match set or scorer.

GO means the candidate has earned promotion to Jacob's decision, with the Rule A reading above. It does not ship anything: shipping needs Jacob's approval, an SPR version bump (published Sigma values, bands, RP pmfs and presim coverage all move), a republish, a D1 reseed (the seed carries the Sigma beliefs and population) and a Worker deploy decision.

### Exact Part 2 commands (repo root; `S` = C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/3c57a05a-d20e-47df-8edd-35005826589b/scratchpad; each run detached with stdout and stderr to a log, completion judged by the log content)

Before and after the runs, record HEAD, `git status --short -- packages scripts apps` (must be clean) and `data/corpus.sqlite`'s size and mtime (no ingest may run between the arms).

1. G1: `npx tsx scripts/captureCompareSlices.ts --out $S/d1/compare-off.json`, then `npx tsx scripts/captureCompareSlices.ts --sigma-carry --out $S/d1/compare-on.json`, then `cmp $S/d1/compare-off.json $S/d1/compare-on.json`. Record `npx tsx scripts/captureCompareSlices.ts --diff $S/d1/compare-off.json $S/d1/compare-on.json` for the file.
2. G2 to G4: `npx tsx scripts/measureSigmaCarry.ts --out $S/d1/sigma-carry.json`. Its printed `GATE` lines and the JSON's `verdicts` block are the G2, G3, G4-cover, G4a and G4b results.
3. G5 baselines: `npx tsx scripts/publishDistricts.ts --years 2026-2026 --as-of 2026-03-14 --dry-run --local-out $S/d1/bake-0314-off` and the same with `2026-03-21` and `bake-0321-off`.
4. G5 candidate: for D in 2026-03-01, 2026-03-05, 2026-03-14, 2026-03-21, 2026-04-04: `npx tsx scripts/publishDistricts.ts --years 2026-2026 --as-of D --dry-run --sigma-carry --local-out $S/d1/bake-MMDD-on`.

## Decision 1 Verdict

Part 2 ran 2026-09-28 from 06:01:59Z to 06:20:01Z at HEAD f3e5fa10. The tree was clean for packages, scripts and apps, and the corpus was unchanged before and after. Every gate was read mechanically from the bar above. No gate was rerun, and no instrument was fixed. The full figures are in Evidence, "Decision 1 Part 2".

| Gate | Result | Incumbent (G4b: reference) | Candidate | Counts |
|---|---|---|---|---|
| G1 Rule A, exact equality | PASS (EQUAL) | compare-off.json sha256 2db73669...62ed2 | compare-on.json sha256 2db73669...62ed2 | cmp exit 0; 35475 bytes each; 90 slices (3 algorithms x 10 seasons x 3 views) |
| G2 band calibration | PASS | error 0.057326 (inside-1 share 0.740326) | error 0.048896 (share 0.731896) | n = 278045 rows in both arms |
| G3 played-row RP | PASS | bonus Brier 0.136178065, RPS 0.136805220 | bonus Brier 0.136178065 (equal), RPS 0.136792736 | bonus n = 513310, total-RP n = 230480, both arms |
| G4-cover | PASS | I = 28350 | C = 115240 | C minus I = 86890; I minus C = 0 |
| G4a matched set | PASS | bonus Brier 0.188424713, RPS 0.159673343 | bonus Brier 0.188424713 (equal), RPS 0.159669208 | bonus n = 128214, total-RP n = 56700, both arms |
| G4b newly covered vs climatology | FAIL | bonus Brier 0.140039626, RPS 0.179948613 | bonus Brier 0.173994199 (worse), RPS 0.160718300 (better) | bonus n = 385096, total-RP n = 173780, both |
| G5 district bake coverage | PASS | baked 0 / 0 / 1 / 1 / 14 | baked 135 / 135 / 108 / 82 / 20 | at 03-01 / 03-05 / 03-14 / 03-21 / 04-04; every knob-on run completed and every sidecar schema-parsed |

**Decision 1: NO-GO.** The failing gate is G4b. It requires a strictly lower candidate bonus Brier, and the candidate's is 0.173994 against the reference's 0.140040, higher by 0.033955. Its RPS leg passed (0.160718 against 0.179949). Every other gate passed.

Rule A reading: Jacob has not signed off on it. The verdict is NO-GO under either answer. If he rejects the reading, the bar's own mapping makes it NO-GO. If he accepts it, G4b still makes it NO-GO.

## Evidence

- timestamp: 2026-09-28
  checked: scripts/publishDistricts.ts:1294-1298 and scripts/districtPricingState.ts:271-281
  found: the `no-ranking-point-filler` skip fires only when `pricing.predictFor(roster)` returns undefined, which happens only when `makeRankingPointFiller` returns undefined.
  implication: the skip is decided in the filler, before `bakeDistrictEvent` runs.

- timestamp: 2026-09-28
  checked: packages/harness/publish.ts:462-475 (`makeRankingPointFiller`)
  found: three refusal conditions. Accumulator undefined, rule module undefined, or `roster.some((t) => !sigmaByTeam.has(t))`. For 2026 SPR the first two are defined (04-04 bakes), so the roster Sigma check is the only varying one.
  implication: the refusal means at least one roster team has no Sigma Score in the map.

- timestamp: 2026-09-28
  checked: scripts/districtPricingState.ts:192-241, packages/harness/sigmaScoutLayer.ts:84-114, packages/harness/sigmaScore.ts (`scoreByTeam`, `sigmaFor`, `priorSigmaFor`)
  found: the SigmaScoutLayer is constructed only for the target season (`if (s === season)`), never carried from warmup seasons. `scoreByTeam()` iterates stored beliefs only. `sigmaFor(unseen)` is always defined, but with population count 0 it falls back to INITIAL_PRIOR_K = 0.5 points, and with no observed talent it uses TALENT_FLOOR, which clamps to the minimum 0.25x population sigma.
  implication: a team gets a Sigma Score only after its first folded match of the season. The accumulator's own prior is unusable before the season has any evidence.

- timestamp: 2026-09-28
  checked: scratchpad/diag-sigma.ts (real corpus, `buildDistrictPricingState` with warmup 2016-2025), logs diag-0301.log and diag-0404.log
  found: |
    as-of 2026-03-01: sigma map size 0; Sigma population count 0; 9 started 2026 events, all Week 0 (type 100, never folds); 0 teams with a folding 2026 match.
      135 unstarted non-parent district events with a roster: filler ok 0, refused 135.
      missing-Sigma team-event pairs: plays-2026-only-after-asof 4571, only-nonfolding-before-asof (Week 0 teams) 91, never-plays-2026 (no-shows) 17.
      121 of 135 events have at least one team with no SPR total; those teams match the rookie count (no pre-2026 match).
    as-of 2026-04-04: sigma map size 3446; population 77889.
      19 unstarted non-parent events with a roster: filler ok 13, refused 6 (miesc, onwin, njski, oncmp2, isde1, isde2).
      every missing-Sigma pair is plays-2026-only-after-asof (47). 3 events have a team missing an SPR total.
  implication: H1 confirmed as the dominant mechanism. H2 (no-shows) is real but minor. A second, masked gate (rookies have no SPR total, so `unrated-teams`) will block about 90% of early-season events once Sigma is addressed.

- timestamp: 2026-09-28
  checked: .planning/phases/10-*/10-06-SUMMARY.md, Deviation 1
  found: the 10-06 executor measured the same thing at as-of 2026-03-07 (zero of 116 events fully rated, best 20/27) and recorded coverage by instant (03-14: 1 event, 03-21: 7, 03-28: 17, 04-04: 13). It was logged as a verification-procedure deviation, not a defect.
  implication: the behavior is a documented consequence of the all-or-nothing design, not a regression. Whether it is acceptable is a product decision.

- timestamp: 2026-09-28
  checked: publish.ts:2311 (event presim sidecar), apps/worker/src/scheduled.ts:551-567 (`upcomingModelOf`), sigmaScoutLayer.matchBand.test.ts:219
  found: the event page's presim sidecar uses the same filler with the same season-only Sigma map. The Worker deliberately gives a never-seen team no Sigma Score on upcoming rows ("a number the next republish silently changes"), and a test pins "a never-seen roster still gets no upcoming band".
  implication: the event page has the same early-season gap. A bake-only prior would create a second pricing rule that differs from the event page's.

- timestamp: 2026-09-28
  checked: 2026 corpus event start dates (scratchpad/diag-dates.cjs)
  found: Week 0 (type 100) events 02-21 to 03-01. The first folding matches are regionals from 03-03/03-04 (79 + 458 matches). District events start 03-05. Sigma's MIN_POPULATION_FOR_TALENT_PRIOR (200 robot observations, about 34 matches) is crossed on 03-03/03-04.
  implication: a prior that waits for in-season population evidence would price every district event from about 03-04 onward. Only the preseason window before the first regional stays unpriced.

- timestamp: 2026-09-28
  checked: scripts/publishDistricts.ts:394-395 and packages/corpus/db.ts:1399 (`selectDistrictRankings`)
  found: `remainingEvents` excludes any event in the team's `event_points_raw` from the SEASON-FINAL district rankings. There is no as-of filter. At as-of 03-01 this marks 119 of 150 events as `not-a-remaining-event`, although 135 non-parent events had not started. The 23 events the 03-01 run exercises are exactly those with a registered team that never earned points there (no-shows).
  implication: VERIFICATION FIDELITY. The as-of dry run's candidate set reads post-as-of data. It is not representative of an early-season production run. Production at "now" is unaffected.

- timestamp: 2026-09-28
  checked: `startedEventKeysAsOf` truncation vs match sort_time (scratchpad/diag-leak.cjs)
  found: truncation is by event start date, so every match of an event that started before as-of enters the replay. At as-of 04-04 that admits 850 played matches from 20 in-progress events with sort_time at or after the as-of instant. At 03-01 it admits 0.
  implication: WALK-FORWARD LEAK in the as-of verification path (pre-existing). The 04-04 baseline's pricing state includes post-as-of matches. Production at "now" is unaffected because the corpus holds no future results. The `districtPricingState.ts` header claim that "a leak is not expressible" does not hold for a mid-event as-of instant.

- timestamp: 2026-09-28 (Decision 2 cycle)
  checked: pre-fix baselines captured before any source edit (HEAD bfcb32c8, scripts/packages/apps clean). scratchpad/pin-clock.mjs pins Date.now() and argument-less new Date() to PIN_NOW so a no-as-of run stamps a fixed generation/computedAt and two runs can be diffed byte-for-byte.
  found: |
    no-as-of (PIN_NOW=2026-09-28T00:00:00.000Z), scratchpad/nowA + now-A.log: census "considered 150, baked 0; ineligible: not-a-remaining-event=150; skipped: none"; "0 bake-eligible event(s), so NO walk-forward replay was run"; 15 files, 2663724 total bytes.
    as-of 2026-03-05, scratchpad/bake-0305-before + bake-0305-before.log: replayed 165473 (truncated 20339); census "considered 150, baked 0; ineligible: not-a-remaining-event=119, divisioned-dcmp-parent=8; skipped: no-ranking-point-filler=23" (the same 23 no-show events as 03-01).
  implication: at "now" the bake does no replay, so byte identity at now exercises composition and candidacy only. The replay cut's identity at now rests on the measured premise below.

- timestamp: 2026-09-28 (Decision 2 cycle)
  checked: scratchpad/diag-asof.cjs and diag-asof2.cjs (real corpus, read-only)
  found: |
    played matches with sort_time >= now (pinned 2026-09-28T00:00Z or the real clock): 0. Max played sort_time 2026-09-20T23:54:51Z.
    148 2026 events carry district points; every one has played matches in the corpus; none has a first played match before its start date. 2026 played matches with a synthetic (fallback) sort_time: 0.
    2026 played matches 20907. Start-date truncation vs match-time cut: 03-01 admits 31 vs 31 (leak 0); 03-05 admits 568 vs 77 (leak 491 across 6 events); 04-04 admits 13037 vs 12187 (leak 850 across 20 events). No match is admitted by match time that start date refused.
  implication: the 03-05 baseline also carries leaked matches (491), not only 04-04. A sort_time < as-of cut is an identity at the run's own clock, so production is unaffected.

- timestamp: 2026-09-28 (Decision 2 cycle)
  checked: fix applied to scripts/districtPricingState.ts and scripts/publishDistricts.ts (see Resolution.fix), then the post-fix no-as-of dry run at the same pinned clock into scratchpad/nowB (log now-B.log)
  found: |
    diff -r nowA nowB: exit 0, no output. 15 files each; the sha256 manifests (nowA.sha, nowB.sha) are identical.
    Logs differ on exactly one line, the --local-out path. Census line identical: "considered 150, baked 0; ineligible: not-a-remaining-event=150; skipped: none".
  implication: production at "now" is byte-identical. Caveat: at now no district event is still ahead, so candidacy is empty on both sides and no replay runs. The rule-equivalence for a non-empty in-season candidate set is pinned separately by the corpus-guarded test (as-of set equals the published remainingEvents union once every points event is underway).

- timestamp: 2026-09-28 (Decision 2 cycle)
  checked: post-fix as-of dry runs (scratchpad/bake-{0301,0305,0404}-after + .log) against the pre-fix baselines, plus scratchpad/diag-census.ts, which reclassifies every event under the old and new candidacy rules without a replay. Its old-rule reconstruction reproduces both pre-fix censuses exactly. Logs: diag-census-2026-03-01.log, diag-census-2026-03-05.log, diag-census-0404.log.
  found: |
    Census before -> after (considered 150 on every run):
    | as-of | replayed (truncated) | baked | not-a-remaining | parent (type 2) | in-progress | filler skip |
    | 03-01 before | 164936 (20876) | 0 | 119 | 8 | 0 | 23 |
    | 03-01 after  | 164936 (20876) | 0 |   0 | 15 | 0 | 135 |
    | 03-05 before | 165473 (20339) | 0 | 119 | 8 | 0 | 23 |
    | 03-05 after  | 164982 (20830) | 0 |   0 | 15 | 0 | 135 |
    | 04-04 before | 177942 (7870)  | 2 | 131 | 8 | 8 | 1 |
    | 04-04 after  | 177092 (8720)  | 14 | 108 | 15 | 7 | 6 |
    03-01 transitions: 112 not-a-remaining -> candidate, then all 112 refused by the filler (23 -> 135). 7 not-a-remaining -> parent (cancmp, incmp, mrcmp, nccmp, sccmp, pncmp, wicmp; 8 -> 15). 23 candidate -> candidate (the no-show events, still refused). 8 parent -> parent. Every one of the 119 moved events had started=false, underway=false and 0 as-of qual plays; their start dates run from 03-05 to 06-30. The old rule dropped them only because every registered ranked team later earned points there. The replay is unchanged, because the start-date rule admitted 0 post-as-of matches at 03-01.
    03-05: the census transitions are identical to 03-01 (district events start 03-05, and a start of 03-05T00:00Z is not before the instant). The replay shrinks by 491 matches (165473 -> 164982), exactly the measured leak: matches from 6 events that started 03-03/03-04 and were played on or after 03-05T00:00Z. The post-fix 03-05 run refuses the same 135 events as 03-01.
    04-04 transitions: 16 not-a-remaining -> candidate (mibig, micmp1-4, miesc, mifen, txcmp1-2, isde1, isde2, necmp1-2, oncmp1-2, onwin; all unstarted, first plays 04-10 to 06-30). 7 not-a-remaining -> parent (the same 7 DCMPs as at 03-01). 1 already-in-progress -> candidate: 2026mawor, start 2026-04-03 so started by date, but its first played match is 2026-04-04T14:46Z. The old gate read its 78 season-final quals, and its as-of count is 0. 3 candidate -> candidate (miken, njski, onwel). 7 in-progress, 8 parents and 108 not-a-remaining are unchanged.
    04-04 bake outcomes: 14 baked (mibig, micmp1-4, mifen, miken, txcmp1-2, mawor, necmp1-2, oncmp1, onwel). 6 filler refusals (miesc, njski, isde1, isde2, oncmp2, onwin), the same six the leaky-state diag named. Cutting the 850 post-as-of matches changed none of those verdicts, only the pmfs.
    Artifacts: at 03-01 and 03-05, all 15 composed district and index objects are identical to their baselines apart from `generation`. At 04-04 the only non-generation differences are the bakedEvents lists (fim +6, fit +2, ne +3, ont +1) and the sidecars. miken and onwel keep identical rosters. Their expected event totals shift by up to 6.55 and 0.80 points, because the pricing state no longer holds the 850 post-as-of matches.
  implication: both leaks are closed and every census difference is accounted for. 03-01 still bakes 0, because every roster fails the Sigma gate, which is Decision 1. The new candidate set exposes two pre-existing verification-fidelity findings (Current Focus F1 roster leak, F2 undivided DCMPs excluded as type 2).

- timestamp: 2026-09-28 (Decision 2 cycle)
  checked: verification
  found: |
    scoped: scripts/districtPricingState.test.ts + scripts/publishDistricts.test.ts 80 passed.
    full suite from the repo root (npx vitest run): 298 files passed; 6994 tests passed, 1 skipped (a pre-existing conditional it.skip guard); 0 failures.
    typechecks: root tsc -p tsconfig.json exit 0 (re-run on the final tree); apps/worker exit 0; apps/web exit 0 with 0 errors (routeTree.gen.ts already present); apps/web tsconfig.e2e.json exit 0.
    manual mutation check (scratchpad/mutants.cjs; Stryker is not configured): 5 of 5 mutants killed. M1 no replay cut: 2 tests fail, including the pre-existing matchesTruncated > 0. M2 cut boundary > instead of >=: 1 fails. M3 underway by start date only: 1 fails. M4 candidacy reads season-final points: 2 fail. M5 season-final played-qual count: 1 fails. Both files were restored byte-for-byte (sha256 checked).
    final-tree no-as-of pinned run (nowC) vs pre-fix nowA: diff -r identical, 15 files.
  implication: the fix is accepted under the guardrail. Revert-and-reconfirm is covered by the pre-fix baselines at HEAD bfcb32c8 (the leaks present) against the post-fix runs (the leaks gone), and by mutants M1, M4 and M5, each a targeted revert of one fix site.

- timestamp: 2026-09-28 (Decision 1 Part 1, section A: what the carry can move)
  checked: every consumer of the SPR Sigma Score. packages/core/algorithms/spr.ts `predict`; packages/harness/publish.ts `publishSeasonsWith` (`harnessPredictions` built from `records`, the raw WalkForwardSimulator output, before any `foldPlayed`), packages/harness/score.ts `aggregateScores` and packages/core/scoring/brier.ts; packages/harness/sigmaScoutLayer.ts (`foldPlayed` -> `#bandVarianceFor` -> `#rpFieldsFor` and `#matchBandFields`; `enrichUpcoming`); packages/core/rankingPoints/analyticPmf.ts `matchOutcome`; `makeRankingPointFiller`; the event presim (`buildPreScheduleSidecarForEvent`); scripts/districtPricingState.ts; apps/worker/src/scheduled.ts `upcomingModelOf`; packages/harness/level1Digest.test.ts.
  found: |
    Winner odds: SPR's `pRedWin` and `winner` are computed in `predict` from SPR state alone (muL, muS, pL, pS, logTau, obsSd). No Sigma input exists. The published winner accuracy and Brier read `r.prediction.pRedWin` and the actual winner from `records`, before the layer runs, and level1Digest.test.ts pins that `foldPlayed` never mutates pRedWin/redScore/blueScore.
    Where Sigma enters: (1) played rows, through `bandVarianceFor` (every roster team priced, from the prior if unseen): the RP pmf's score variance (total-RP pmf, bonus pmfs, and the tie share of `matchOutcomePmf`, whose red-win entry is pRedWin x (1 - pTie)), and the display `matchBand` = rosterSize x that variance; (2) upcoming rows, the event presim, the district bake and the Worker's upcoming rows, all-or-nothing on `sigmaScoreByTeam()` membership plus the same variance; (3) the published Sigma metric and tier, and the D1 seed's Sigma beliefs and population. The memory note "win odds keep the old variance" is accurate only in the Sigma code's own vocabulary: its "win-odds variance" is the RP pmf's score variance; the published win probability never reads Sigma at all.
    Worker: `upcomingModelOf` reads `sigma.scoreByTeam()` of the accumulator resumed from the D1 seed. The carry would reach it only through a republished seed; the Worker code needs no change and is not touched. The test "a never-seen roster still gets no upcoming band" stays true: the layer still gates on stored beliefs; the rookie rule lives only in the bake and the measurement.
  implication: the carry CANNOT move winner accuracy or winner Brier. It CAN move band calibration (played and upcoming), RP Brier / RPS and the 3-outcome Brier on played rows, the published Sigma values and tiers, and which upcoming rosters price. Rule A is therefore pre-registered as an exact-equality check (bar, G1).

- timestamp: 2026-09-28 (Decision 1 Part 1, section A: the rookie prior)
  checked: spr.ts `viewOfMap` / `freshTeam` / `teamMetrics` / `SPR_PARAMS`, and every `teamMetrics` caller in publish.ts and districtPricingState.ts
  found: |
    What SPR's predictions already use for a never-seen team: `viewOfMap` reads an absent team as `freshTeam(SPR_PARAMS)` = { muL: rookieMean 0.55, pL: priorVar 0.1, muS: 0, pS: fastPriorVar 0.25 }. As a published total that is 0.55 x unit with spread sqrt(0.35) x unit, unit = state.scale / 3.
    Exposing it as a `total` in `teamMetrics` would change NO prediction (`predict` never reads `teamMetrics`; the Sigma talent capture reads only teams already in state after `update`) but WOULD add published rows: `teamMetrics(state, teamsThisSeason)` includes scheduled-only rookies (Teams rows), registered-roster event standings, and the `allianceTeams` survivor filter. So the candidate leaves `teamMetrics` untouched and adds `AlgorithmModule.unseenTeamMetrics` (SPR only, publishes nothing), read only by the knob-on bake and the measurement.
    Provenance: rookieMean, priorVar and fastPriorVar are the frozen 2026-09-08 parameters, chosen on 2016-2022 only; `unit` is the online scale, which has seen only folded matches. For the 2026 bake: no 2026 data enters, no leak. For backtest seasons 2016-2022 the constants are in-sample hyperparameters, exactly as they already are for every SPR prediction of a rookie in both arms; declared in the bar as a descriptive split, not fixed.
  implication: the rookie rating is walk-forward for the target season and adds no new in-sample exposure beyond what SPR's predictions already carry.

- timestamp: 2026-09-28 (Decision 1 Part 1, new finding F3, not fixed, out of scope)
  checked: publish.ts `buildPreScheduleSidecarForEvent` and its `fillRankingPoints` argument
  found: for an event whose schedule has landed and that has been played, the event presim sidecar prices SPR from the walk-forward PRE-EVENT state, but its ranking-point filler is built from `layerForAlgo` after the whole season's fold: season-final Sigma map, season-final RP accumulator and season-final mean shift, which include the event's own matches. The membership gate also reads season-final Sigma, which is why played events' sidecars always exist.
  implication: a walk-forward leak in the published event presim's RP pmfs for played events (pre-existing). It also means the published presim's coverage for played events says nothing about pre-event coverage. The measurement's G4 prices every event at its true pre-event instant in both arms instead. For Jacob.

- timestamp: 2026-09-28 (Decision 1 Part 1, section C: the candidate as built)
  checked: the implementation, before any backtest
  found: |
    packages/harness/sigmaCarry.ts (new): the candidate's single home and definition. `SigmaSeasonCarry`, `acrossSigmaBoundary` (bias reset, evidence and talent kept), `seasonOwnPopulation` (the season's own population; an empty season passes its carried-in population through), `candidateRosterRatings` / `candidateSigmaMap` (the rookie rule).
    packages/harness/sigmaScoutLayer.ts: optional third constructor argument `{ sigmaCarry: { from } }`. With it, the accumulator starts via `SigmaScoreAccumulator.fromBeliefs` (the Worker's own resume path), the layer snapshots its state just before the first non-official fold after an official match, and `sigmaCarryOut()` returns the carry as of the last official match (end of stream when there was none). `sigmaPriorAtTalent`. Without it, construction and folding are the incumbent's.
    packages/harness/sigmaScore.ts: `priorSigmaAtTalent(talent)`, `priorSigmaFor` now delegates to it (identical arithmetic).
    packages/core/algorithms/types.ts + spr.ts: optional `unseenTeamMetrics`; SPR's total formula extracted into `totalMetricOf`, shared by `teamMetrics` and `unseenTeamMetrics`.
    packages/harness/publish.ts: `PublishSeasonsOptions.sigmaCarry` (no CLI flag); layers chained across seasons when true.
    scripts/districtPricingState.ts: `sigmaCarry` option: warmup seasons fold a Sigma-only layer to chain the carry; `ratingsFor`/`predictFor` use the rookie rule; `DistrictPricingState.sigmaCarry` reports it.
    scripts/publishDistricts.ts: `--sigma-carry`, refused without `--dry-run`. scripts/captureCompareSlices.ts: `--sigma-carry`.
    scripts/measureSigmaCarry.ts (new, with test): the G2 to G4 instrument, one replay and two layer arms per season, scored by the published band and RP scorers, mechanical verdicts in code (`judgeSigmaCarryBar`).
    No numeric parameter was added. No SPR version bump, no republish, no reseed, no deploy, no push.
  implication: the knob reaches every path Part 2 needs (captureCompareSlices, measureSigmaCarry, publishDistricts) with no source edit.

- timestamp: 2026-09-28 (Decision 1 Part 1, the bar's digest)
  checked: the section `## Pre-registered Acceptance Bar (Decision 1)` of this file, written before any candidate code, backtest or dry run, and not edited since
  found: |
    sha256 9b83748be0f9c1c59edff6109df74f2c965887e6fefb8d76ab169c6e794ab8f4 (11918 bytes, 56 lines).
    Extraction rule: UTF-8 text with CRLF normalized to LF, from the start of the line `## Pre-registered Acceptance Bar (Decision 1)` up to and including the newline before the next line that starts with `## ` (that is `## Evidence`). Recompute from the repo root:
    node -e "const t=require('fs').readFileSync('.planning/debug/presim-bake-rp-filler-refuses.md','utf8').replace(/\r\n/g,'\n');const s=t.indexOf('## Pre-registered Acceptance Bar (Decision 1)\n');const e=t.indexOf('\n## ',s+5)+1;console.log(require('crypto').createHash('sha256').update(t.slice(s,e)).digest('hex'))"
  implication: Part 2 recomputes this digest before running anything; a mismatch means the bar moved and Part 2 stops.

- timestamp: 2026-09-28 (Decision 1 Part 1, section D: inertness, knob off)
  checked: |
    (1) publishDistricts pinned-clock no-as-of dry run (PIN_NOW 2026-09-28T00:00:00.000Z, scratchpad/pin-clock.mjs) into scratchpad/nowD, against the pre-change reference nowA.
    (2) publishDistricts as-of 2026-04-04 knob-off dry run into scratchpad/bake-0404-knoboff (log bake-0404-knoboff.out.log), against bake-0404-after (47eceffa), with scratchpad/strict-cmp.cjs: every file must exist in both and match byte for byte after blanking ONLY the top-level `generation`.
    (3) The real `publishSeasons`, dry run, seasons 2025-2026, all three algorithms, offseason included, presim sidecars on (2026), fixed generation/computedAt and a pinned clock (scratchpad/capture-season-digests.ts): the sha256 of every page body (artifactSink) and of every string the uploader measures (which includes each presim sidecar body), in order. BEFORE captured at 47eceffa with a clean tree before any source edit (season-digests-before.json, 1130 s); AFTER on the final tree (season-digests-after.json).
    (4) The harness's own fixture-level instruments, run in the full suite: `PINNED_RP_DIGESTS` (sigmaScoutLayer.matchBand.test.ts, the nine RP fields over the 2022 digest slice) and level1Digest.test.ts.
  found: |
    (1) `diff -r nowA nowD`: identical, 15 of 15 files. Logs identical apart from stderr routing.
    (2) census identical ("considered 150, baked 14; ineligible: already-in-progress=7, not-a-remaining-event=108, divisioned-dcmp-parent=15; skipped: no-ranking-point-filler=6"; replayed 177092, truncated 8720). strict-cmp: files=29 (15 composed + 14 sidecars), other-diffs=0, generation-only=29. `generation` is the one field known to differ run to run: an unpinned run stamps its own clock there, while `computedAt` is the as-of instant.
    (3) 24386 page bodies (teams 6, events 6, event 1935, team 22437, compare 2) and 24600 measured strings (the 214 presim sidecars included): 0 differences in order and content; running digest 00e8cc55cdf0e6d1... on both; sidecar size stats identical.
    (4) both pass unchanged (full suite below).
  implication: with the knob off, every shipped SPR output the checks can reach is byte-identical: the season artifacts with the event presim, the district composition and bake, and the Compare page. The Worker is untouched, and its bundle gains only the unused `unseenTeamMetrics` function.

- timestamp: 2026-09-28 (Decision 1 Part 1, section D: tests and typechecks)
  checked: new tests, full suite from the repo root, four typechecks, manual mutants
  found: |
    New tests: packages/harness/sigmaCarry.test.ts (15: inert at default, inert bookkeeping on with nothing carried, offseason checkpoint included; carry out resets bias and holds the season's own population; season S seeded from S-1's carry and nothing else; last-official-match instant; Week 0 folds nothing; no-official-match fallback; carry independent of the rule module; priorSigmaAtTalent equals sigmaFor of a talent-only team; the rookie rule's cases). packages/harness/sigmaCarry.publish.test.ts (2: absent equals false byte for byte; ON leaves both Compare pages byte-identical and moves 2026 team pages). packages/core/algorithms/spr.test.ts (+4: unseenTeamMetrics equals teamMetrics for a fresh team, equals predict's all-rookie alliance score / 3, publishes nothing, zero at scale 0). scripts/districtPricingState.test.ts (+5, real corpus, as-of 2026-03-01, warmup [2025]: the knob changes no replay; OFF refuses 2026mibig with no Sigma at all; ON rates all 41 of its roster teams, rookies at SPR's unseen total and the prior at it; 2026 is exactly the carry an independent 2025 replay hands on; in-season at 03-07 the carried layer folds exactly the pre-instant matches). scripts/publishDistricts.test.ts (+1: --sigma-carry refused without --dry-run, absent by default). scripts/measureSigmaCarry.test.ts (11: the pre-registered season lists, the climatology reference, the figures, every gate's PASS/FAIL/VOID, and the loop on the digest slice: identical arms with nothing to carry, the same observation sets with a carry, nothing dropped).
    Full suite (`npx vitest run` from the repo root, scratchpad/vitest-full-d1.out.log): Test Files 301 passed (301); Tests 7032 passed, 1 skipped (7033), the same pre-existing conditional skip; 0 failed. Before this cycle: 298 files, 6994 passed.
    Typechecks: root tsconfig.json exit 0; apps/worker exit 0; apps/web exit 0 (0 errors); apps/web tsconfig.e2e.json exit 0.
    Manual mutants (scratchpad/mutants-d1.cjs, log mutants-d1.log; Stryker is not configured): 11 of 11 killed, each file restored byte for byte (sha256). M1 carry ignores the last-official checkpoint; M2 bias not reset; M3 cumulative population; M4 layer ignores its carry; M5 no offseason snapshot; M6 rookie rule ignores the unseen total; M7 knob-off district pricing uses the candidate map; M8 warmup seasons do not chain; M9 publishSeasons never hands the carry on; M10 priorSigmaAtTalent ignores talent; M11 unseenTeamMetrics reads rookieMean as 0.
  implication: the candidate's defining properties are each pinned by at least one test that fails when that property breaks. The walk-forward requirements hold with the knob on: S is seeded from S-1 only, and inside S only pre-instant matches fold.

- timestamp: 2026-09-28 (Decision 1 Part 1, section E: the Part 2 instruments and their runtimes)
  checked: the current walk-forward evaluation paths (the tune/promote/Rule-A CLI and `pnpm harness` are deleted and were not recreated), and measured timings from this cycle's runs
  found: |
    G1: scripts/captureCompareSlices.ts, the real publisher in dry run keeping the Compare pages (the published scorer, ties at 0.5 in Brier). Estimated 10 to 15 minutes per arm: this cycle's 2025-2026 publisher run measured 42 to 59 s of replay plus about 15 s of building per season for the three algorithms (the sidecars it adds, 989 s, are off in the capture), so 10 seasons is about 11 minutes.
    G2 to G4: scripts/measureSigmaCarry.ts (committed with a test; not throwaway, because it is the instrument any future Sigma change must pass too). Estimated 5 to 10 minutes. Its SPR-only 10-season replay is comparable to publishDistricts' 11-season SPR replay, measured 216 to 247 s. The two layer folds are cheap: the publisher's per-season fold for all three algorithms measured 1.3 to 2.6 s. The pre-event pricing adds a few seconds per season.
    G5: scripts/publishDistricts.ts --as-of ... --dry-run [--sigma-carry]. About 4 to 5 minutes per run: replay 216 to 247 s measured, plus the bake at about 0.37 s per event, measured 5.3 s for 14 events. A knob-on 03-01 run could bake up to 135 events, about 50 s more. There are 7 runs, so about 35 minutes run sequentially. The machine has 12 cores and 64 GB, so 3 or 4 can run in parallel.
    Nothing in this list was run against the corpus in this cycle, apart from the knob-off inertness runs above.
  implication: Part 2 needs about 1 hour sequential, and less with parallel runs.

- timestamp: 2026-09-28 (Decision 1 Part 2, integrity and run state)
  checked: the bar digest, HEAD, `git status --short -- packages scripts apps`, and data/corpus.sqlite, before the first run (05:59Z) and after the last (06:20:06Z). Also each script's write paths, before running any of them in parallel.
  found: |
    Digest before any run: 9b83748be0f9c1c59edff6109df74f2c965887e6fefb8d76ab169c6e794ab8f4 over 11918 bytes, equal to the registered value. It was re-checked after each edit to this file, with the same result every time.
    Before: HEAD f3e5fa105b17fefa03b2b176fe382de8072ecfe0; tree clean (no output); corpus 592121856 bytes, mtime 2026-09-25 11:43:55.655098200 -0400; -wal 0 bytes.
    After: HEAD f3e5fa10 (unchanged); tree clean; corpus 592121856 bytes, same mtime; -wal 0 bytes, mtime 2026-09-25 11:46:52. No ingest ran and HEAD did not move, so no comparison is void.
    Write paths: all three scripts open the corpus through `openCorpusReadOnly` (better-sqlite3 `readonly: true`, so no lock file). captureCompareSlices writes only `--out`; its publishSeasons call is `dryRun: true`, `skipState: true` (no seed SQL), with no write-budget (so no budget doc). measureSigmaCarry writes only `--out`. publishDistricts writes only under `--local-out`, and in `--dry-run` it makes no `putObject` call. No run shared an output path with another.
    Execution: each run was detached via scratchpad/start-detached.ps1 (Start-Process, stdout and stderr to scratchpad/d1/<name>.out.log and .err.log), with at most 4 at a time. Completion was judged by log content. Every .err.log is 0 bytes.
    Runtimes: compare-off 852.1 s, compare-on 851.8 s, measureSigmaCarry 234 s (06:02:01.7Z to 06:05:55.6Z), publishDistricts replays 175 to 205 s each, bake 0.3 to 40 s.
  implication: every comparison ran on one code state and one corpus state. No instrument crashed, so no fix and no rerun happened.

- timestamp: 2026-09-28 (Decision 1 Part 2, Rule A reading: disclosure)
  checked: the bar's "Why Rule A reads as an exact-equality check" section, which says the orchestrator puts that reading to Jacob before Part 2 runs
  found: that step did not happen. The session manager has no user channel, and the main session asked for GO/NO-GO in this pass. So Part 2 ran BEFORE Jacob signed off on the exact-equality reading of Rule A.
  implication: the verdict is conditional on that sign-off. By the bar's own mapping, if Jacob rejects the reading, the result is NO-GO whatever the numbers say. This run is NO-GO on the numbers anyway (G4b), so the missing sign-off does not change the outcome.

- timestamp: 2026-09-28 (Decision 1 Part 2, G1)
  checked: `npx tsx scripts/captureCompareSlices.ts --out $S/d1/compare-off.json`, the same with `--sigma-carry` into compare-on.json, `cmp`, and `--diff` (log $S/d1/compare-diff.log)
  found: |
    Both runs printed "captured 90 slices": algorithms epa, opr and spr x seasons 2016-2020 and 2022-2026 x views qualification, elimination and combined.
    cmp exit 0. Both files are 35475 bytes, sha256 2db73669246c0e0e6de3b7f2c6c4e49313bc04676c206c519c5131787e562ed2.
    --diff (qualification view): every row shows +0.00000 on accuracy and Brier and equal scored counts. Pooled spr 125422 scored, accuracy 0.75631, Brier 0.16144, in both arms.
  implication: G1 PASS (EQUAL). The carry does not reach the published winner accuracy or Brier, as section A predicted. EQUAL is not an improvement.

- timestamp: 2026-09-28 (Decision 1 Part 2, G2 to G4)
  checked: `npx tsx scripts/measureSigmaCarry.ts --out $S/d1/sigma-carry.json` (log $S/d1/sigma-carry.out.log; spr@7.0.0+baseline; replayed 2016-2020 and 2022-2026; counted 2017-2020 and 2022-2026). The JSON (sha256 00cef356723cadaf23367bf93677e932546c15afc5dcc236299bdfa11c5a0610) holds `verdicts`, `pooled`, `descriptive` and per-season `seasons`.
  found: |
    GATE G2 PASS: inside 1 band incumbent 0.740326 (error 0.057326), candidate 0.731896 (error 0.048896), n=278045. Raw counts: incumbent inside1 205844, inside2 265341; candidate inside1 203500, inside2 264510. No row lacked a band in either arm (noBandRows 0).
    GATE G3 PASS: bonus Brier incumbent 0.13617806451166192, candidate 0.13617806451166192 (identical); total-RP RPS incumbent 0.13680522018191874, candidate 0.13679273635056188. bonus n=513310/513310, total-RP n=230480/230480.
    GATE G4-cover PASS: incumbent priced 28350, candidate 115240, newly covered 86890, dropped 0.
    GATE G4a PASS: bonus Brier incumbent 0.18842471300830907, candidate 0.18842471300830907 (identical); RPS incumbent 0.1596733427559758, candidate 0.15966920841290955. bonus n=128214/128214, total-RP n=56700/56700.
    GATE G4b FAIL: bonus Brier candidate 0.17399419864316057, reference 0.14003962636274161 (the candidate is higher, so the strict-less leg fails); RPS candidate 0.1607182998010564, reference 0.17994861263913306 (this leg passes). bonus n=385096/385096, total-RP n=173780/173780.
    GATES G2-G4 OVERALL: FAIL.
    Per-season pre-event coverage (events priced / I / C / C minus I): 2017 160/3518/12683/9165; 2018 174/3735/14143/10408; 2019 189/3845/14916/11071; 2020 52/0/3806/3806; 2022 179/2770/12048/9278; 2023 179/3476/13538/10062; 2024 185/3599/14125/10526; 2025 198/3770/14805/11035; 2026 208/3637/15176/11539. Dropped 0 in every season.
  implication: G2, G3, G4-cover and G4a pass; G4b fails on its bonus-Brier leg. G3 and G4a pass on bonus-Brier EQUALITY (the `<=` leg) plus an RPS improvement of about 1e-5 and 4e-6.

- timestamp: 2026-09-28 (Decision 1 Part 2, G5)
  checked: |
    Knob-off baselines. 03-01, 03-05 and 04-04 are the bar's named 47eceffa logs (scratchpad/bake-0301-after.log, bake-0305-after.log, bake-0404-after.log). 03-14 and 03-21 were made now ($S/d1/bake-0314-off, bake-0321-off plus .out.log).
    Knob-on runs at 03-01, 03-05, 03-14, 03-21 and 04-04 ($S/d1/bake-MMDD-on plus .out.log).
    Every knob-on and new knob-off directory was re-parsed against DistrictPreSimArtifactSchema, DistrictArtifactSchema and DistrictsIndexArtifactSchema with scratchpad/d1-validate.ts (log $S/d1/validate-on.log). Moved events were computed from the sidecar files plus the "bake skip" log lines ($S/d1/g5-moved.txt).
  found: |
    Census lines, "season 2026 bake census — ...":
      03-01 off: considered 150, baked 0; ineligible: divisioned-dcmp-parent=15; skipped: no-ranking-point-filler=135
      03-01 on:  considered 150, baked 135; ineligible: divisioned-dcmp-parent=15; skipped: none
      03-05 off: considered 150, baked 0; ineligible: divisioned-dcmp-parent=15; skipped: no-ranking-point-filler=135
      03-05 on:  considered 150, baked 135; ineligible: divisioned-dcmp-parent=15; skipped: none
      03-14 off: considered 150, baked 1; ineligible: not-a-remaining-event=27, divisioned-dcmp-parent=15; skipped: no-ranking-point-filler=107
      03-14 on:  considered 150, baked 108; ineligible: not-a-remaining-event=27, divisioned-dcmp-parent=15; skipped: none
      03-21 off: considered 150, baked 1; ineligible: not-a-remaining-event=51, divisioned-dcmp-parent=15, already-in-progress=2; skipped: no-ranking-point-filler=81
      03-21 on:  considered 150, baked 82; ineligible: not-a-remaining-event=51, divisioned-dcmp-parent=15, already-in-progress=2; skipped: none
      04-04 off: considered 150, baked 14; ineligible: already-in-progress=7, not-a-remaining-event=108, divisioned-dcmp-parent=15; skipped: no-ranking-point-filler=6
      04-04 on:  considered 150, baked 20; ineligible: already-in-progress=7, not-a-remaining-event=108, divisioned-dcmp-parent=15; skipped: none
    Replay counts are identical off and on at every instant (the knob changes no replay): 164936 (truncated 20876), 164982 (20830), 167943 (17869), 170922 (14890), 177092 (8720).
    Moved from skipped to baked: 135 at 03-01, 135 at 03-05, 107 at 03-14, 81 at 03-21, 6 at 04-04 (2026isde1, isde2, miesc, njski, oncmp2, onwin). At every instant, every moved event was a no-ranking-point-filler skip in the knob-off run, and no knob-off baked event was lost (off baked set is a subset of on). The full lists are in g5-moved.txt. The knob-off 03-14 and 03-21 runs bake only 2026schar.
    Still refused with the knob on: none at any instant ("skipped: none"). No unrated-teams and no filler refusal remain. The events not baked are all ineligible, not refused: divisioned-dcmp-parent 15 (finding F2), not-a-remaining-event and already-in-progress.
    Completion: every knob-on log ends with "--local-out — every composed object written"; every .err.log is 0 bytes. Sidecar file counts equal baked counts (135, 135, 108, 82, 20). The re-parse covered 150, 150, 123, 97 and 35 files (sidecars, 14 district details and 1 index each) with 0 failures.
  implication: G5 PASS. baked(on) >= baked(off) at all five instants, and at 03-01 it is 135 > 0. Every knob-on run completed with every sidecar schema-parsed.

- timestamp: 2026-09-28 (Decision 1 Part 2, DESCRIPTIVE ONLY, cannot change the verdict)
  checked: sigma-carry.json `seasons` and `descriptive`, and the G5 outputs
  found: |
    2-band share (G2 rows): incumbent 0.954310, candidate 0.951321.
    Per-season band calibration error |inside-1 share - 0.683|, incumbent / candidate: 2017 0.0333/0.0230; 2018 0.0182/0.0388; 2019 0.2000/0.2725; 2020 0.0213/0.0297; 2022 0.0595/0.1455; 2023 0.0375/0.0327; 2024 0.0390/0.0490; 2025 0.0328/0.0025; 2026 0.0395/0.0269. The candidate is closer in 4 of 9 seasons and further in 5. The pooled G2 pass partly comes from over-coverage (2019 0.9555, 2022 0.8285) offsetting under-coverage (2017, 2018, 2020, 2026 at about 0.64 to 0.66).
    Per coldest-robot bucket (inside-1 / inside-2), incumbent then candidate: under 3 (n 38925) 0.6226/0.8501, then 0.6509/0.8869; 3 to 11 (n 108041) 0.7828/0.9775, then 0.7573/0.9621; 12 plus (n 131079) 0.7403/0.9661, then 0.7350/0.9616.
    3-outcome Brier, played rows (n 115240): incumbent 0.335098610, candidate 0.335093832.
    G4b per season, candidate beats reference (bonus, RPS): 2017 (yes, yes); 2018, 2019, 2020, 2022, 2023, 2024, 2025 and 2026 (no, yes). The bonus leg fails in 8 of 9 seasons, and the RPS leg passes in all 9.
    rookieMean in-sample split, G4b candidate/reference: 2017-2020 and 2022 bonus Brier 0.145784/0.125974, RPS 0.154630/0.174768 (bonus n 167300, RP n 87456). 2023-2026 bonus 0.195664/0.150844, RPS 0.166887/0.185197 (bonus n 217796, RP n 86324). The bonus leg fails in both halves.
    C-minus-I ceiling (the candidate's own played-row pmfs on the newly covered matches, priced with in-event information): bonus Brier 0.124660 (n 385096), RPS 0.132590 (n 173780). Even with in-event information, the bonus Brier beats the season-to-date climatology (0.140040) by only 0.0154.
    Observation, inference from the equalities above: the played-row bonus Brier is identical to 17 significant digits in both arms over 513310 observations, and so is the matched-set bonus Brier over 128214. So the bonus probabilities do not read Sigma. The G4b bonus shortfall is therefore a property of the RP bonus model at pre-event instants (the per-season RP accumulator restart, blind spot (a)). The carry does not cause it; it only exposes those matches to scoring. Not tested directly.
    G5: of the 135 events baked at 03-01, 10 are DCMP divisions (micmp1-4, necmp1-2, oncmp1-2, txcmp1-2), whose as-of rosters are season-final (finding F1).
  implication: none for the verdict. For any revised candidate: G4b's bonus leg would need a change to the pre-event bonus model itself, not to Sigma. The pooled G2 figure hides a per-season split.

- timestamp: 2026-09-28 (Decision 1 Part 2, raw output paths)
  checked: every file Part 2 wrote. S = C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/3c57a05a-d20e-47df-8edd-35005826589b/scratchpad
  found: |
    G1: $S/d1/compare-off.json, compare-on.json, compare-diff.log; logs compare-off.out.log / .err.log and compare-on.out.log / .err.log.
    G2 to G4: $S/d1/sigma-carry.json; logs sigma-carry.out.log / .err.log.
    G5 knob off (new): $S/d1/bake-0314-off/, bake-0321-off/ plus .out.log / .err.log. G5 knob off (bar baselines): $S/bake-0301-after/, bake-0305-after/, bake-0404-after/ plus .log.
    G5 knob on: $S/d1/bake-0301-on/, bake-0305-on/, bake-0314-on/, bake-0321-on/, bake-0404-on/ plus .out.log / .err.log.
    Checks: $S/d1/validate-on.log (schema re-parse), $S/d1/g5-moved.txt (moved events per instant), $S/d1-validate.ts (the read-only re-parse script). Launcher: $S/start-detached.ps1.
  implication: every figure in the verdict can be re-read from these files without a rerun.

## Eliminated

- hypothesis: accumulator or rule module absent for 2026 (filler conditions 1 and 2)
  evidence: 04-04 bakes miken and onwel through the same filler; both are season-level constants.
  timestamp: 2026-09-28
- hypothesis: H2, registered no-shows are the main cause
  evidence: only 17 of 4679 missing-Sigma pairs at 03-01 are never-plays-2026. At 04-04 there are none. No-shows are a minor contributor, not the mechanism.
  timestamp: 2026-09-28

## Resolution

root_cause: "The district bake demands an in-season Sigma Score for every roster team (makeRankingPointFiller's all-or-nothing rule), and the Sigma layer restarts empty each season, so a team has no Sigma Score until its first folded match of the season. At 2026-03-01 no team had one, so every roster was refused. Behind it sits a second gate: rookies have no SPR total (teamMetrics omits never-seen teams), which blocks 121 of 135 early-season events under the unrated-teams check; plus (verification path, Decision 2) two as-of leaks: bake candidacy read season-final district points and season-final played-qual counts, and the replay admitted every match of an event that started before the instant, including matches played after it."
fix: |
  Decision 2 (47eceffa): scripts/districtPricingState.ts gains playedMatchKeysAtOrAfter (the replay drops every played match with sort_time >= as-of, in every replayed season) and underwayEventKeysAsOf (an event is underway once it has a played match before as-of; with no played match in the corpus it falls back to its start date). The DistrictPricingState.startedEventKeys field was removed, since nothing reads it now, and matchesTruncated now sums over every season. The header's "a leak is not expressible" claim is corrected.
  scripts/publishDistricts.ts: candidacy uses remainingEventKeysAsOf, which is buildDistrictArtifact's own remaining-events rule factored into remainingRegisteredEventKeys and registeredEventKeysByTeam, with points rows counted as played only for underway events. selectQualMatchCounts (now exported) counts played quals with sort_time < as-of. classifyBakeCandidate drops its startedEventKeys input. The header names what an as-of run still reads season-final (roster, schedule length, the composed artifact).
  Decision 1 (Sigma carry-over plus rookie rating), PART 1 ONLY: the candidate is built INERT at its default and is NOT promoted (14088080 candidate, f3e5fa10 Part 2 instruments). Its switch is `sigmaCarry`. The switch is off in every production path, and PublishSeasonsOptions has no CLI flag for it. It is on only through captureCompareSlices --sigma-carry, measureSigmaCarry's candidate arm, and publishDistricts --sigma-carry (which refuses to run without --dry-run). Definition: packages/harness/sigmaCarry.ts. Acceptance bar: the pre-registered section above. Part 2 decides GO or NO-GO.
verification:
  target_test: { result: pass, tests: "playedMatchKeysAtOrAfter x3, underwayEventKeysAsOf x2, real-corpus in-progress cut at 2026-03-07, remainingEventKeysAsOf x3, selectQualMatchCounts, real-corpus candidacy at 2026-03-01, classifyBakeCandidate as-of case" }
  mutation_check: { result: pass, method: "manual (Stryker not configured), scratchpad/mutants.cjs", mutant_killed: "5 of 5" }
  no_op_deletion: { result: pass, deletion_justified_by_rca: true, note: "removals (startedEventKeys gate/field, startedEventKeysAsOfSeason) are replaced by the as-of match-clock inputs" }
  adjacent_tests: { result: pass, suites_run: ["full repo-root vitest: 298 files, 6994 passed, 1 skipped, 0 failed"] }
  revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true, method: "pre-fix HEAD bfcb32c8 dry runs show the leaks (850/491 post-as-of matches, 119 events wrongly not-remaining) and the post-fix runs do not; mutants M1/M4/M5 revert single fix sites and are killed" }
  byte_identity_at_now: { result: pass, detail: "pinned-clock no-as-of dry run, pre vs post (nowA vs nowB and nowC): diff -r identical, 15 of 15 files, census line identical" }
  typechecks: { root: 0, apps_worker: 0, apps_web: "0 (0 errors)", apps_web_e2e: 0 }
  guardrail_verdict: accepted
  decision_1_part_1_inertness:
    byte_identity_now: { result: pass, detail: "pinned-clock no-as-of district dry run nowD vs pre-change nowA: diff -r identical, 15 of 15 files" }
    byte_identity_asof_0404: { result: pass, detail: "knob-off as-of 2026-04-04 vs bake-0404-after: 29 of 29 files identical after blanking only generation; census identical" }
    season_artifacts: { result: pass, detail: "publishSeasons dry run 2025-2026, 3 algorithms, sidecars on: 24386 page bodies + 214 presim sidecars, 0 sha256 differences, running digest 00e8cc55cdf0e6d1 both sides" }
    fixture_digests: { result: pass, detail: "PINNED_RP_DIGESTS and level1Digest unchanged in the full suite" }
    tests: { result: pass, detail: "full repo-root vitest 301 files, 7032 passed, 1 skipped, 0 failed (+3 files, +38 tests)" }
    mutation_check: { result: pass, method: "manual, scratchpad/mutants-d1.cjs", mutant_killed: "11 of 11" }
    typechecks: { root: 0, apps_worker: 0, apps_web: "0 (0 errors)", apps_web_e2e: 0 }
    acceptance: "NO-GO (Decision 1 Part 2, 2026-09-28): G4b FAIL on its bonus-Brier leg (candidate 0.173994 against climatology 0.140040); every other gate PASS. Conditional on Jacob's Rule A sign-off, which is still outstanding, but NO-GO under either answer. See '## Decision 1 Verdict'."
files_changed: [scripts/districtPricingState.ts, scripts/districtPricingState.test.ts, scripts/publishDistricts.ts, scripts/publishDistricts.test.ts, packages/harness/sigmaCarry.ts, packages/harness/sigmaCarry.test.ts, packages/harness/sigmaCarry.publish.test.ts, packages/harness/sigmaScoutLayer.ts, packages/harness/sigmaScore.ts, packages/harness/publish.ts, packages/core/algorithms/types.ts, packages/core/algorithms/spr.ts, packages/core/algorithms/spr.test.ts, scripts/captureCompareSlices.ts, scripts/measureSigmaCarry.ts, scripts/measureSigmaCarry.test.ts]


jacob_ruling (2026-09-28):
  decision_1: "Keep the Sigma carry candidate in the code, switched OFF (sigmaCarry defaults off, no production path turns it on). Next, fix the pre-event ranking point bonus model's cold start. G4b's bonus Brier is identical in both arms, so the failure sits in the bonus model, not the carry. Then retry the carry against the SAME registered bar (sha256 9b83748b...). Tracked in .planning/todos/pending/early-season-rp-bonus-cold-start.md."
  decision_2: "Fixed (47eceffa)."
  push: "HOLD. All three commits stay local until Jacob says otherwise."
  follow_up: "F3 (a played event's published presim sidecar fills its RP pmfs from season-final state) goes to its own /gsd-debug session, with F1 (as-of runs read season-final rosters and schedule lengths) and F2 (7 undivided DCMPs excluded as type 2) as notes."
  outcome: "Closed as partially fixed. The verification leaks are fixed. The early-season coverage gap stays open, deliberately, behind the bonus model work."
