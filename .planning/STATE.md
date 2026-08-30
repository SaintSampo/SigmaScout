---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 07
current_phase_name: event-pages
status: executing
stopped_at: Completed 07-20-PLAN.md -- Phase 07 (event-pages) fully complete, 20/20 plans
last_updated: "2026-08-30T01:35:33.861Z"
last_activity: 2026-08-28
last_activity_desc: Phase 07 execution started
progress:
  total_phases: 10
  completed_phases: 10
  total_plans: 84
  completed_plans: 84
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-12)

**Core value:** Predictions that are *measurably* better than Statbotics — proven by walk-forward, Brier-scored backtests — delivered on pages that load fast.
**Current focus:** Phase 07 — event-pages

## Current Position

Phase: 07 (event-pages) — COMPLETE
Plan: 20 of 20
Status: All plans executed. 07-UAT.md carries 2 pending hardware-dependent items (real-device touch sign-off, plot-density judgement) for /gsd-verify-work 7.
Last activity: 2026-08-29 — Phase 07 execution completed (plan 07-20)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 64
- Average duration: —
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 6 | - | - |
| 02 | 6 | - | - |
| 03 | 8 | - | - |
| 03.1 | 5 | - | - |
| 03.2 | 6 | - | - |
| 04 | 8 | - | - |
| 05 | 8 | - | - |
| 06 | 9 | - | - |
| 06.1 | 8 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 22min | 3 tasks | 9 files |
| Phase 01 P02 | 15min | 2 tasks | 14 files |
| Phase 01 P03 | 23min | 3 tasks | 11 files |
| Phase 01 P04 | 12min | 2 tasks | 4 files |
| Phase 01 P05 | 40min | 3 tasks | 12 files |
| Phase 01 P06 | 3h04m | 2 tasks | 7 files |
| Phase 02 P02 | 25min | 3 tasks | 9 files |
| Phase 02 P03 | 80min | 3 tasks | 17 files |
| Phase 02 P04 | 40min | 3 tasks | 10 files |
| Phase 02 P05 | 95min | 3 tasks | 6 files |
| Phase 02 P06 | 3h10m (+ gap closure) | 3 tasks | 6 files |
| Phase 03 P01 | 70min | 3 tasks | 14 files |
| Phase 03 P02 | 100min | 3 tasks | 9 files |
| Phase 03 P03 | 115min | 3 tasks | 32 files |
| Phase 03 P04 | 55min | 2 tasks | 8 files |
| Phase 03 P05 | 150min | 3 tasks | 9 files |
| Phase 03 P06 | 6h03m | 2 tasks | 10 files |
| Phase 03 P07 | 55min | 2 tasks | 5 files |
| Phase 03 P08 | 55min | 3 tasks | 8 files |
| Phase 03.1 P01 | 55min | 3 tasks | 9 files |
| Phase 03.1 P02 | 11min | 2 tasks | 12 files |
| Phase 03.1 P04 | 55min | 3 tasks | 9 files |
| Phase 03.1 P03 | 7min | 2 tasks | 2 files |
| Phase 03.1 P05 | 35min | 2 tasks | 7 files |
| Phase 06.1 P01 | 35min | 3 tasks | 15 files |
| Phase 06.1 P02 | 25min | 3 tasks | 4 files |
| Phase 06.1 P03 | 25min | 2 tasks | 4 files |
| Phase 06.1 P04 | 20min | 2 tasks | 1 files |
| Phase 06.1 P05 | ~35min | 3 tasks | 4 files |
| Phase 06.1 P06 | ~40min | 3 tasks | 7 files |
| Phase 06.1 P07 | ~50min | 3 tasks | 1 files |
| Phase 06.1 P08 | 55min | 3 tasks | 12 files |
| Phase 07 P01 | 22min | 3 tasks | 13 files |
| Phase 07 P02 | 32min | 3 tasks | 4 files |
| Phase 07 P06 | 45min | 3 tasks | 9 files |
| Phase 07 P03 | ~20min | 3 tasks | 8 files |
| Phase 07 P07 | 22min | 3 tasks | 4 files |
| Phase 07 P04 | 20min | 3 tasks | 5 files |
| Phase 07 P08 | 40min | 3 tasks | 2 files |
| Phase 07 P05 | 25min | 3 tasks | 3 files |
| Phase 07 P09 | 18min | 3 tasks | 2 files |
| Phase 07 P10 | 35min | 3 tasks | 2 files |
| Phase 07 P11 | 17min | 3 tasks | 4 files |
| Phase 07 P12 | ~55min | 3 tasks | 10 files |
| Phase 07 P13 | ~35min | 2 tasks | 4 files |
| Phase 07 P14 | 25min | 3 tasks | 4 files |
| Phase 07 P15 | 45min | 3 tasks | 15 files |
| Phase 07 P16 | ~70min | 3 tasks | 43 files |
| Phase 07 P17 | 1h27m | 2 tasks | 2 files |
| Phase 07 P18 | ~1h20m | 3 tasks | 57 files |
| Phase 07 P19 | ~50min (continuation) + predecessor sessions | 4 tasks | 12 files |
| Phase 07 P20 | ~4h | 3 tasks | 9 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Measurement before models — ingestion + walk-forward harness + OPR baseline all land in Phase 1, before any Sigma1 work (failure log: no harness existed).
- [Roadmap]: Predict-before-update is enforced structurally (shared pure-function core), verified by a test that outcome leakage fails rather than returns data.
- [Roadmap]: No standalone polish phase — mobile, deep links, and load performance are success criteria inside the page-building phases.
- [Roadmap]: EVAL-05 lands in Phase 8 with the Compare page, so "site numbers equal harness numbers" is verifiable end-to-end rather than on paper.
- [Phase ?]: Renamed pre-existing .env key TBA_AUTH_KEY -> TBA_API_KEY to match every downstream Phase 1 plan's env var contract
- [Phase ?]: TBA's computed per-match RP field is named 'rp' (not the 2016/2017-era 'tba_rpEarned') in all sampled 2022-2026 seasons -- Plan 03 can normalize RP as a direct field read
- [Phase ?]: Statbotics /v3/year/{year} endpoint consistently 500s -- D-04's reference row will use a dated manual constant instead of a live fetch
- [Phase ?]: Diff-on-upsert replay detection lives in packages/corpus/db.ts (not normalize.ts) since only the corpus layer sees a match's previously-stored score-bearing fields — TBA exposes no replay flag (RESEARCH.md Pitfall 1); the detector must compare against prior corpus state, which normalize.ts cannot see
- [Phase ?]: packages/corpus/schema.sql scoped to events/matches/http_cache only (no teams table) for this tracer, matching the plan's explicit must_haves.artifacts list — RESEARCH.md's broader sketch included a teams table, but the plan's narrower explicit list is authoritative; can be added later without migration pain
- [Phase ?]: detectReplay lives in normalize.ts as a pure sticky diff over score-bearing fields; db.ts's upsertMatch is the sole caller (reads the prior row via selectExistingMatch first) so no caller can bypass the check
- [Phase ?]: teams-list pagination (fetchAllTeams) is deliberately un-conditional — a 304's bodyless response can't signal the terminal empty page, and teams-list is cheap relative to the match-payload volume ETag caching is meant to bound
- [Phase ?]: Local dev corpus (data/corpus.sqlite, gitignored) predated this plan's new tables/columns and was deleted and rebuilt rather than migrated -- disposable by design, no ALTER-based migration path exists yet
- [Phase ?]: D-07's surrogate-slot question resolved: a surrogate's column is excluded from OPR's design matrix, its current rating (or league-mean per-team share if ) is subtracted from its alliance's target score, and non-surrogate teammates keep a correctly-scaled observation
- [Phase ?]: Disqualification policy (Open Question 3, no locked decision): opposite of surrogates -- a dq'd team's column and rating update are kept, since MatchResult carries no dq field and OPR models physical score contribution, not ranking rulings
- [Phase ?]: cli.ts rewired to score.ts/artifact.ts/statbotics.ts/report.ts's new module boundaries (blocking fix, single-event scope preserved for Plan 06 to widen) — Task 1/3's required export changes broke cli.ts's typecheck; fixing it matches exactly what Plan 06's read_first already expects to find
- [Phase ?]: Statbotics fallback per-season accuracy constants are unverified best-available estimates, logged as an open stub in WINDOWS.md — Statbotics /v3/year/{year} reproducibly 500s (reconfirmed live 2026-08-13) and their blog renders numbers client-side from the same broken API — no way to source verified values from this offline pipeline
- [Phase ?]: Fixed O(n^3)-per-match OPR solve (Plan 04) to O(n^2) incremental Sherman-Morrison/RLS after benchmarking real corpus scale (~3,700 teams/season) showed the original approach would need ~16 CPU-days/season — Task 2's own acceptance criteria required the real pnpm harness --seasons 2022-2026 command to complete; the fix is mathematically exact, proven by a new equivalence test against the untouched solveRidgeOpr
- [Phase ?]: reports/ (harness default --out) added to .gitignore — Generated artifact was untracked-but-not-ignored, against the failure log's keep-generated-artifacts-out-of-git rule
- [Phase ?]: Offseason events excluded from breakdown-map reconciliation samples — self-reported score_breakdown for offseason events is not guaranteed to match the official schema (found live: missing adjustPoints entirely); matches selectMatchesChronological's existing excludeOffseason discipline
- [Phase ?]: ALGO-03 (Sigma1) deliberately NOT marked complete in REQUIREMENTS.md despite appearing in plan 02-02's frontmatter requirements list — no Sigma1 code exists yet; only ALGO-02 reflects what plan 02-02 actually shipped
- [Phase ?]: carryover.ts owns EPA_NORM_MEAN/EPA_NORM_SD/EPA_INIT_PENALTY/EPA_MEAN_REVERSION (moved from epa.ts) -- the only acyclic import direction since epa.carrySeason needs carryover.ts's epaCarryover
- [Phase ?]: epaCarryover sources the normalized<->points conversion scale from the outgoing season's own per-team point-total mean/sd, since the incoming season has no observations yet at a boundary -- documented approximation
- [Phase ?]: The head-to-head table replaces (not duplicates) the per-algorithm score table -- one home per Brier/accuracy figure, never two groupings that could drift
- [Phase ?]: SC-2 (Statbotics per-team numeric tolerance) recorded blocked-on-external-dependency per D-14 -- api.statbotics.io reproducibly 500s, re-confirmed live 2026-08-14; EPA correctness rests on synthetic-fixture tests and walk-forward structural proofs instead
- [Phase ?]: Fixed a pre-existing (02-02) circular import between breakdown/index.ts and every season file, discovered running the real pnpm harness command Task 2 required -- extracted shared constants into new breakdown/constants.ts leaf module
- [Phase ?]: D-04's opposing-alliance foulsCommitted attribution implemented explicitly in Sigma1's predict() -- each side's own foulsCommitted entry represents points ITS fouls cost the OPPONENT
- [Phase ?]: Sigma1 cold-start mean/consistency seed from a live league-wide running ExpandingStats per component rather than a fixed placeholder constant alone
- [Phase ?]: Sigma1's carrySeason reuses carryover.ts's epaCarryover unchanged -- posterior variance re-inflates to the cold-start prior at a season boundary, consistency carries forward decayed by SIGMA1_CONSISTENCY_CARRY_DECAY (D-17)
- [Phase ?]: T-02-01's second finite-value gate added in sigma1/index.ts update() -- a value surviving the per-season Zod parse boundary can still be produced non-finite by distributeResidual's degenerate branch
- [Phase ?]: Prediction/metric-history sidecars open with fs 'w' (truncate) not 'a' (append) -- a fresh replay produces a fresh sidecar per season, never a mix of two runs' lines
- [Phase ?]: redComponents/blueComponents required on PersistedPredictionRecord but validly {} for OPR (no components in its Prediction type) -- D-24's full-vector shape is a schema capability, not a per-algorithm mandate
- [Phase ?]: replay.ts needed zero code changes for D-28 -- 02-01's onMatchComplete hook already fired after update() with post-update state; only test coverage was missing
- [Phase ?]: cli.ts ALGORITHMS registry now carries 5 entries (opr, epa, sigma1, sigma1-seasonsd, sigma1-normalcdf) -- D-12's three link modes scored side by side in one real 2024 run, verified: identical predicted scores, distinct win probabilities
- [Phase ?]: Gap 1 (02-06 checkpoint): identifiability.ts now ships a committed, deterministic connected-components pass; re-running it corrected the write-up's island count (2022: 7 not 4; 2024: 3 not 2) rather than the script being tuned to match the prior prose
- [Phase ?]: Gap 2 (02-06 checkpoint): EPA's event-boundary invariance is now a verified test (epa.test.ts), closing the one named ALGO-02 coverage gap the checkpoint identified
- [Phase ?]: Circular-import fix (Rule 3): moved four Sigma1 params.ts-sourced constants (SIGMA1_COLD_START_TEAM_TOTAL/CONSISTENCY_VARIANCE, SIGMA1_FALLBACK_SCORE_SD, SIGMA1_CONSISTENCY_CARRY_DECAY) into params.ts itself rather than sigma1/index.ts as drafted -- the literal plan instruction created a genuine ESM load-time TDZ crash (index.ts and params.ts would each dereference the other's binding at module-top-level-eval time)
- [Phase ?]: tune.ts does not import cli.ts's runSeasons (the plan's stated key_link) -- that function has no event-bounding parameter, and the plan's own --events flag requires one; tune.ts mirrors runSeasons's orchestration locally while reusing the actual leak-proof buildSeasonStream/WalkForwardSimulator primitives unchanged
- [Phase ?]: ALGO-04/ALGO-06 intentionally NOT marked complete in REQUIREMENTS.md by plan 03-01 -- both IDs also appear in 03-05's and 03-06's requirements lists; this plan ships tuning/versioning infrastructure (one knob searched, one test version promoted), not the full sensitivity screen/joint search or final integration those requirements describe. Matches the ALGO-03 precedent from plan 02-02
- [Phase ?]: RpParsedResult.totalRp is bonus-only RP; win/tie/loss RP is a caller decision, since parse() has no outcome input and must not derive one from a score
- [Phase ?]: 2025 Coral Bonus championship-tier threshold corpus-converged to 7 and 2026 Energized/Supercharged District-Championship/Championship thresholds corpus-converged to exact clean boundaries -- both flagged for the plan's required human-check against the official manuals
- [Phase ?]: Reconciliation found 3 additional named tolerances beyond 2022's Cargo Bonus (2024 Ensemble ~7%, 2025 Auto/Coral/Barge Bonus 2-5%) -- documented and flagged per D-12's honesty precedent rather than chased or hidden
- [Phase ?]: ALGO-08 intentionally NOT marked complete in REQUIREMENTS.md by plan 03-02 -- it also appears in 03-03's and 03-06's requirements lists; this plan ships RP rule modules + reconciliation proof, not the predict()-wiring 03-03 delivers
- [Phase ?]: eventType widened onto UpcomingMatch (required, not optional) and deliberately NOT added to replay.ts's OUTCOME_KEYS -- it is knowable before a match is played
- [Phase ?]: RpRuleModule extended with predictThresholds (rp/constants.ts + all 5 season modules) -- parse() requires a full raw score_breakdown and cannot evaluate bonuses from Monte-Carlo-drawn threshold-variable values alone
- [Phase ?]: 2023 sustainabilityBonus/2024 melodyBonus/2025 coralBonus+autoBonus predicted at their conservative (less-likely-to-achieve) branch -- their real condition gates on alliance-level signals (coopertition flags, per-robot leave state) D-09's tracked RpThresholdVariable lists never captured; understates, never overstates, flagged for human review
- [Phase ?]: opr.ts/epa.ts version strings changed to 2.0.0+baseline/1.0.0+baseline (Rule 1 fix) -- buildArtifact's new strict D-13 shape check would otherwise throw on every real non-Sigma1 harness run
- [Phase ?]: ALGO-08 marked complete by plan 03-03 (not deferred to 03-06, whose actual scope is CI reproducibility/holdout head-to-head/SC-3, unrelated to RP) -- this is the literal predict()-wiring plan 03-01/03-02 named as 03-03's job
- [Phase ?]: adaptation.ts (D-05/D-07): innovation-driven per-team process-noise scaling, one bounded scalar factor per team, cold-starts at exactly 1.0 (assume correctly specified), returns exactly 1 when disabled or below adaptationMinObservations -- provably inert-when-off (byte-identical prediction streams, digest.test.ts reproduces the committed version bitwise unchanged)
- [Phase ?]: sigma1-adapt registered in cli.ts's ALGORITHMS (6 entries total, not the 7 plan 03-04's acceptance criteria literally stated -- the plan's action text only asked for one new entry; corrected the write-up rather than force-adding an unrequested sigma1Defaults registration)
- [Phase ?]: ALGO-05 intentionally NOT marked complete by plan 03-04 -- it also appears in 03-05's and 03-06's requirements lists; this plan ships the adaptation mechanism and the on/off registry pair only, not the best-vs-best comparison or verdict ALGO-05 describes (matches ALGO-04/ALGO-06/ALGO-08 precedent)
- [Phase ?]: [Phase 3]: Sensitivity screen (2022,2023, 5 values) found 9/20 Sigma1 hyperparameters survive brierRange>1e-4 -- three are structurally invisible to the objective (minConsistencyVariance/shrinkagePriorMatches only affect teamMetrics(), fallbackScoreSd unreachable via a normal replay), carryLastYearWeight/carryPriorYearWeight are inert in a 2-season screen window (the weighted blend only activates at a team's THIRD season), and all 5 adaptation-only params are inert because the screen ran at adaptationEnabled=false
- [Phase ?]: [Phase 3]: Two equal-budget joint searches (evals=60, seed=42, seasons 2022-2024, identical 9-parameter survivor set) ran adaptation-off and adaptation-on; adaptation-off promoted as sigma1@2.0.0+tuned-2026-08 (D-08's default) with rpMonteCarloDraws restored to 2000; adaptation-on winner NOT promoted, held for plan 03-06's holdout best-vs-best comparison
- [Phase ?]: [Phase 3]: Fixed Rule 1 blocking bugs discovered running this plan's real corpus commands -- runBoundedSeasons' predictions.push(...predictions) blew V8's call-stack argument limit at full-season batched-multi-candidate scale (117k+ elements), replaced with a plain loop; rp/distribution.ts's Cholesky ridge escalates through [1e-6,1e-4,1e-2,1,10,100] instead of a single fixed 1e-6 retry, since promote.ts's bounded-slice replay always starts every team's RP state cold and a sparse early cross-covariance estimate can exceed what one fixed ridge restores to positive-definite
- [Phase ?]: [Phase 3]: SC-3 evaluated at its literal 8-comparison reading and PASSES 8/8 -- tuned Sigma1 (sigma1@2.0.0+tuned-2026-08) beats both OPR and EPA on holdout Brier AND winner accuracy on both 2025 and 2026, closing the accuracy gap the Phase-2 starting position flagged as unlikely under D-01's Brier-only search objective
- [Phase ?]: [Phase 3]: ALGO-05's best-vs-best holdout comparison shows adaptation-on beating adaptation-off on Brier on both holdout seasons (modest, consistent, ~0.8-2.4% relative; accuracy mixed/noise-scale) -- D-08's shipped-disabled default is flagged as a named decision to revisit, not silently flipped; adaptation-on remains unpromoted
- [Phase ?]: [Phase 3]: Fixed a Rule 1 blocking bug found running the real pnpm harness --seasons 2022-2026 command -- Sigma1's RP joint covariance could be mathematically indefinite (a genuine Cauchy-Schwarz violation between the residual-based cross-covariance and the Kalman-posterior diagonal variances), not merely ill-conditioned; clamped the cross term to its own Cauchy-Schwarz bound before the existing ridge escalation, verified not to move any committed digest
- [Phase ?]: [Phase 3] CR-01 fixed: isRpEligibleEventType() guards Sigma1's update()/predict() RP path against unmapped event_type, proven a bitwise no-op on both committed digest slices; a NEW, separate, out-of-scope score-breakdown-schema crash on self-reported offseason data was discovered (previously masked by CR-01) and logged to WINDOWS.md rather than fixed
- [Phase ?]: [Phase 3] ALGO-08 intentionally NOT marked complete by plan 03-07 -- 03-08 also carries requirements:[ALGO-08] and closes the remaining gap (manual game-manual threshold confirmation, conservative-branch understatement quantification); this plan closes only the CR-01 crash ground
- [Phase ?]: Decision A = A1-confirmed: human read 2025 FRC Game Manual Sec 6.5.4 Table 6-2 and 2026 FRC Game Manual Sec 6.5.3 Tables 6-4/6-5, both corpus-converged threshold sets confirmed correct as shipped, no constant changed
- [Phase ?]: Decision B = B2-plan-fix: conservative-branch understatement measured (never overstates, tested and held) but NOT accepted as a shipped limitation -- escalated to a future-phase redesign predicting undecidable RPs from teams' own historical achievement rates rather than a new latent Kalman gating dimension
- [Phase ?]: Authorized deviation: fixed 2025 Coral Bonus coopertition gate to require BOTH alliances' coopertitionCriteriaMet (was: observing alliance's flag alone) -- matches 2023.ts's established pattern, cut the championship-tier reconciliation residual from 72/2004 to 5/2004
- [Phase ?]: [Quick 260819-2x6] Closed EVAL-01/SC-4: toLeakProofUpcoming's Proxy now traps getOwnPropertyDescriptor and ownKeys (in addition to the pre-existing get trap), closing the descriptor-value and key-enumeration leakage bypasses the v1.0 mid-milestone audit flagged as the sole blocker; audit's 'object spread copies every outcome field silently' claim corrected as non-reproducible (spread already hit the get trap)
- [Phase ?]: [Phase 03.1 P01]: winner_imputed is a plain non-sticky boolean column (unlike replayed) -- written straight from the incoming CorpusMatch on every upsert since it describes the row as currently normalized
- [Phase ?]: [Phase 03.1 P01]: openCorpus gained a schema-version guard (hasWinnerImputedColumn) per planner discretion -- a pre-winner_imputed corpus fails at open with a named actionable error instead of a cryptic mid-ingest SQLite error
- [Phase ?]: [Phase 03.1 P01]: WR-04 and WR-03 regression proofs required stronger methodology than a literal line-revert -- better-sqlite3 defaults foreign_keys ON already in this environment, and single-threaded JS has no real TOCTOU window without vi.mock('node:fs', ...) to simulate the race
- [Phase ?]: [Phase 03.1 P02]: assertValidPRedWin's opr.predict regression test lives in the new predictionValidity.test.ts, not opr.test.ts, to avoid a file conflict with plan 03.1-03 (which owns opr.test.ts exclusively in the next wave)
- [Phase ?]: [Phase 03.1 P02]: Rule 1 fix -- assertValidPRedWin surfaced a real latent 0/0 NaN in sigma1's season-sd link mode (the one of D-12's three modes missing the degenerate-branch guard modes 2/3 already had); fixed in linkFunctions.ts, proven not to move either committed digest (both are id="sigma1", predictive-variance mode, never season-sd)
- [Phase ?]: [Phase 03.1 P02]: Rule 3 fix -- ExclusionCounts.quarantined becoming a required field broke artifact.ts's ExclusionCountsSchema plus inline ScoreSlice fixtures in report.test.ts/tune.test.ts (files outside this plan's declared files_modified); propagated quarantined: 0 / a matching Zod field through all three
- [Phase ?]: [Phase 03.1 P04]: D-11 (WR-01) implemented via Zod 4's object-level .check() chained onto Sigma1ParamsSchema's existing z.strictObject(...), confirmed by direct execution to still satisfy z.ZodType<Sigma1Params> and nest unchanged inside PromotedVersionSchema -- every pre-existing .parse() call site now enforces the five cross-parameter invariants with zero new call sites
- [Phase ?]: [Phase 03.1 P04]: One as Sigma1Params cast deliberately left in tune.ts's coordinate-descent refinement loop (not one of the two sites the plan named) -- filtered by isValidParamSet immediately before use, proven equivalent to Sigma1ParamsSchema by a dedicated agreement test, so it is not a bypass
- [Phase ?]: [Phase 03.1 P04]: warnIfNewerPromotedSigma1 (D-12, WR-03) wired only into applyPromotedOverrides' sigma1 branch, never sigma1-adapt -- that branch reads a gitignored search artifact, not a committed version pin, so WR-03's staleness concern does not apply there
- [Phase ?]: [Phase 03.1 P03]: applyObservation's D-08 guard drives its regression test through opr.update (the shipped public surface), not IncrementalInverse/applyObservation directly -- both stay module-private per the plan's recorded open-design-question resolution
- [Phase ?]: [Phase 03.1 P03]: OPR season-scale drift property test holds team pool at 400 (not the review's 1,500-3,700) since the batch comparison runs solveRidgeOpr three times; match count held at the review's own low end (5,000) since match count is the drift-accumulation axis that matters -- measured max deviation 4.27e-12, six orders of magnitude inside the 1e-6 documented tolerance
- [Phase ?]: [Phase 03.1 P03]: denom <= 0 branch in the OPR guard is documented as defense in depth, not directly regression-tested -- denom is provably > 1 on well-formed input while the inverse stays positive-definite, so no reachable path through the public surface forces it non-positive; manufacturing a fake reachability path was explicitly rejected
- [Phase ?]: [Phase 03.1 P05]: reviewFrontmatterLint.ts hand-rolls frontmatter parsing (no YAML dependency) and checks one narrow invariant (D-16): resolution counts vs body resolution subsections, findings.total, and status -- deliberately not a full cross-artifact consistency checker
- [Phase ?]: [Phase 03.1 P05]: 01-REVIEW.md/03-REVIEW.md's findings: counts and status: issues_found left unchanged per 02-REVIEW.md's precedent -- a resolution: block records the accurate resolved/open split instead, since info findings remain genuinely open and flipping status would trade one false claim for another
- [Phase ?]: [Phase 03.1 P05]: 01-VERIFICATION.md's status/verdict corrected to passed, reading the decision tree's 'empty human-verification section' rule as 'no outstanding items' (matching sibling phases' semantics) since the human_verification entry itself must be preserved for provenance, never deleted
- [Phase ?]: [Phase 06.1 P01]: PD-01/PD-02/PD-03 applied as written — offseason events in event_rankings ingest scope, null-body vs empty-rankings distinguished only in ingest-run counters, standing line is plain text not a Badge
- [Phase ?]: [Phase 06.1 P01]: Rule 1 fix — event_rankings ingest skips (and counts separately) a ranking row for a team key with no corpus teams row, rather than fail the whole event's upsert or fabricate a teams row; discovered live against 2024's remote-league events (2024azrl1..5), which report standings for synthetic second-robot team keys TBA's own /team/{key} 404s on
- [Phase ?]: [Phase 06.1 P01]: publish.ts's event assembly conditionally spreads rank/totalTeams rather than assigning them directly, so an omitted field is genuinely absent from the parsed artifact (asserted via not.toHaveProperty) — Zod's object parse otherwise keeps a key present-with-undefined-value
- [Phase ?]: [Phase 06.1 P02]: PD-04/PD-05 applied as written -- per-bonus RP data travels as a positional array indexed to bonusNames (not a Record), never passed through roundPmf; both saved for plan 06.1-05's publish boundary
- [Phase ?]: [Phase 06.1 P03]: percentileAgainstSortedPool implements the verbatim RESEARCH.md/PATTERNS.md formula (below-all-pool query yields 0, non-negative, well-defined) rather than the plan's imprecise >0 prose claim -- the acceptance_criteria's actual grading gate does not test that specific claim
- [Phase ?]: [Phase 06.1 P04]: Offseason events in event_rankings ingest scope (PD-01) recorded as COVERAGE.md's own explicit reasoned row, settling RESEARCH.md Open Question 1; four sibling TBA event-scoped endpoints (oprs, district_points, alliances, insights) all OPT-OUT, each with a distinct reason
- [Phase ?]: [Phase 06.1 P04]: Live full 2022-2026 rankings ingest (1,582 requests, 253.8s) verified by fresh read-only corpus query -- 47,695 event_rankings rows, 1,322 populated events, 368 offseason events, 0 invariant violations; three seasons undershoot the plan's own 250-event acceptance estimate, traced to genuine TBA empty/null responses (not a defect) and documented in COVERAGE.md/SUMMARY.md rather than fixed
- [Phase ?]: [Phase 06.1 P05]: actualBonusFlagsForSeason reuses sigma1/index.ts's own RP-fold skip predicates (isRpEligibleEventType + breakdown-parse-failure) rather than a second, independently-drifting eligibility rule
- [Phase ?]: [Phase 06.1 P05]: withHistoryPercentiles/actualBonusFlagsForSeason exported (matching publish.ts's own computeSizeStats/OUTCOME_KEYS precedent) so their precise multi-branch behavior contracts get direct unit tests
- [Phase ?]: [Phase 06.1 P05]: corpus-backed percentile invariant replays real 2022 season with epa (per-team-independent state) rather than opr/sigma1 -- measured all 3,062 teams satisfy the value-equality precondition, 0 mismatches, floor of 50 required
- [Phase ?]: [Phase 06.1 P06]: PD-11/PD-12/PD-13/PD-14 and D-06.1-A applied exactly as written -- bonusDotLabel is the single source of a dot's title and aria-label; the per-event metric line's tier comes from the history row's own published percentile (EventSection.tsx never receives season-final data at all, so it structurally cannot substitute it)
- [Phase ?]: [Phase 06.1 P07]: The republish's payload-budget delta has five real contributing causes, not three -- two pre-06.1 Phase-6 commits (06f468ad phase-group metrics, bf1e3228 teams-artifact tier field) landed after the prior recorded run and were never republished until this run, swept in alongside this phase's own three items
- [Phase ?]: [Phase 06.1 P07]: teams/{year}'s measured maximum (3,577,069 bytes) now exceeds its committed budgetMaxBytes ceiling (3,500,000), caused entirely by pre-06.1 Phase-6 work; ceiling deliberately NOT raised (this plan's own prohibition); payloadBudget.test.ts left genuinely red for this one page kind, logged to WINDOWS.md ledger #11 for a future developer decision
- [Phase ?]: [Phase 06.1 P08]: T-06.1-24 re-dispositioned to accept (Task 1 option-a) -- per-event tier-basis caption removed with no replacement explanation anywhere; buildTeamSeasonArtifact's predicted+actual per-bonus fields switched to conditional spread and gated on isBonusRpCompLevel(match.compLevel) as defence-in-depth beyond the plan's literal per-task file list (Rule 2)
- [Phase ?]: [Phase 07 P01]: Event page season sourced from the event key + artifact.season, never ?year= — /event/{eventKey}?year=2026 still renders the real season's columns
- [Phase ?]: [Phase 07 P01]: EventSearchSchema's tab enum stays over all five EVENT_TABS ids for URL-contract stability; route-local REGISTERED_EVENT_TABS narrows to the ids actually wired each wave, since z.enum's .catch() can't help when every id is a valid enum member
- [Phase ?]: [Phase 07 P01]: Breakdown tab's columnPinningFeature/columnSizingFeature registered locally in BreakdownTab.tsx (not imported from teams-table/columns.tsx) since the column helper must be typed against BreakdownRow
- [Phase ?]: [Phase 07 P01]: The tab strip and each tab's own table are three independent DOM-sibling overflow-x-auto scroll regions, never ancestor/descendant of one another
- [Phase ?]: [Phase 07 P02]: RED commits for both TDD tasks contain only db.test.ts (implementation temporarily git-stashed to confirm real failure), GREEN commits add schema.sql/db.ts -- necessary since both tasks' tests and implementation land in the same pre-existing files
- [Phase ?]: [Phase 07 P02]: event_rankings' four new D-18.6 columns (recordWins/recordLosses/recordTies/rankingScore) are optional on CorpusEventRanking, not required -- verified live that packages/ingest/cli.ts and packages/harness/publish.ts both compile unchanged (git diff --stat empty), so 07-03/07-04 start from a green tree
- [Phase ?]: [Phase 07 P02]: The real data/corpus.sqlite was migrated in place for the first time via openCorpus's new additive ALTER TABLE step -- event_rankings row count proven unchanged (47,695 before and after), event_alliances now exists (0 rows, expected until 07-05 populates it)
- [Phase ?]: [Phase 07 P02]: EVNT-02/EVNT-05 intentionally NOT marked complete in REQUIREMENTS.md despite appearing in plan 07-02's frontmatter requirements list -- this plan ships only the storage-level half (corpus tables/columns/accessors); the tab-rendering surfaces that fulfill the requirement text (Insights tab ranking, Alliances tab combined metrics) are owned by 07-11 and 07-14, matching the ALGO-03/ALGO-04/06/08 precedent
- [Phase ?]: [Phase 07 P06]: TeamMetric.spread redefined site-wide from sqrt(R) to sqrt(P+R) (D-01/D-02/D-03), proven by the alliance-additivity identity against predict()'s own redScoreVarianceOwn/blueScoreVarianceOwn; teamOwnComponentVarianceSum threads a seed accumulator through allianceComponentVarianceSum so predict()'s floating-point path stays bit-identical (digest.test.ts) despite the naive delegation shape flipping both committed digests
- [Phase ?]: [Phase 07 P06]: Two extra stale two-quantity-model doc sites (adaptation.ts x2, rp/state.ts x1) found live by this plan's own sweep-gate grep, outside PD-02's enumerated 12 sites and outside files_modified -- corrected under Rule 2 since the plan's own acceptance criterion required a zero-match grep over the whole sigma1/ directory
- [Phase ?]: [Phase 07 P06]: EVNT-02/EVNT-05 left Pending in REQUIREMENTS.md -- this plan changes the quantity those tabs display but does not own the tabs (07-11/07-14 do), matching the 07-02 precedent
- [Phase ?]: [Phase 07 P03]: status: z.unknown() widened to z.unknown().optional() (Rule 1 fix, live-discovered) -- real 2022 alliance objects can carry no status key at all, a shape RESEARCH.md's 40-event sample never observed; Zod v4's z.unknown() alone requires the key present
- [Phase ?]: [Phase 07 P03]: tbaClient.test.ts's capability-surface case widened beyond the plan's literal instruction to also exercise fetchTeamMedia/fetchEventRankings, so a test titled 'eleven capabilities' actually calls all eleven rather than nine plus two separately-tested siblings
- [Phase ?]: [Phase 07 P03]: COVERAGE.md's status row/note [6] updated with a new 'status ABSENT entirely' row rather than silently edited into agreement -- the plan-time matrix didn't anticipate this shape; live 2022 ingest (244/25/19) and 2024 ingest (285/27/12) are the measured-cost section's authoritative figures for 07-05's later full pass
- [Phase ?]: [Phase 07 P03]: EVNT-05 intentionally left Pending in REQUIREMENTS.md despite appearing in plan 07-03's frontmatter requirements list -- this plan ships only the ingest half (schema/normalize/CLI mode/live two-season proof); the requirement text describes the rendered Alliances tab, which is 07-14's job, matching the EVNT-02/EVNT-05 precedent 07-02 already established
- [Phase ?]: [Phase 07 P07]: eventFixtureWith test helper moved to module scope beside validEventFixture (per the plan's own instruction) after an initial draft nested it inside Task 1's describe block -- folded into Task 2's commit, the first task that actually needed to reuse it
- [Phase ?]: [Phase 07 P07]: Reworded one new doc-comment phrase ('the two arrays stay separate on the wire' -> 'remain two distinct arrays on the wire') to avoid a literal substring collision with 07-06's PD-09 sweep gate grep -- same meaning, gate stays green
- [Phase ?]: [Phase 07 P07]: EVNT-02/EVNT-04/EVNT-05/EVNT-06 left Pending in REQUIREMENTS.md despite appearing in plan 07-07's frontmatter requirements list -- this plan ships only the schema-level half; the rendered tab is owned by 07-11/07-12/07-14/07-13 respectively, matching the established 07-02/07-03/07-06 precedent
- [Phase ?]: [Phase 07 P04]: normalizeEventRankings's sort-order guard (RankingScoreSortOrderError) and the read it protects live in one function, asserting sort_order_info[0].name === RANKING_SCORE_SORT_ORDER_NAME before storing a ranking-score value — RESEARCH.md Question 1's finding (stable across 40 live events, 5 seasons, 8 event types) licenses reading position 0, not reading it silently
- [Phase ?]: [Phase 07 P04]: rankingsLive.test.ts's live-TBA cases assert sort_order_info[0].name against a string literal, never the exported constant, so a future rename of the constant cannot make the live drift check pass vacuously; bounded to 7 requests total (T-07-04-04)
- [Phase ?]: [Phase 07 P04]: Observed (not assumed) that a bare pnpm test in a fresh shell with no exported TBA_API_KEY reports the live-TBA block as a named skip, not a run — this repo's node Vitest project does not auto-load .env into process.env
- [Phase ?]: [Phase 07 P04]: EVNT-02 left Pending in REQUIREMENTS.md despite appearing in plan 07-04's frontmatter requirements list -- this plan ships only the ingest-level guard/record/ranking-score half; the rendered Insights tab is 07-11's, matching the 07-02/07-03/07-06/07-07 precedent
- [Phase ?]: [Phase 07 P08]: eventTeamRankingFields extracted as a module-level helper (not inlined in a block-bodied .map() callback) specifically to keep buildEventArtifact's own function range at exactly one return statement (T-07-08-02, high severity) -- traded off against the plan's literal ROUNDING_RULE.rankingPoints in-function grep location, which now reads 0 instead of 1
- [Phase ?]: [Phase 07 P08]: Task 1's pmf-refines-still-fire test uses an empty redRpPmf, not the plan's literal [0.2, 0.2] -- buildEventArtifact's existing roundPmf call unconditionally renormalizes any non-empty pmf to sum to 1, so [0.2, 0.2] parses successfully through this path; pageArtifacts.test.ts's own schema-level Test 3b (07-07) is what actually covers the raw-value refine failure
- [Phase ?]: [Phase 07 P08]: EVNT-02/EVNT-04/EVNT-05/EVNT-06 left Pending in REQUIREMENTS.md despite appearing in plan 07-08's frontmatter requirements list -- this plan ships only the assembly/publish-boundary half; the rendered tabs (Insights/Quals/Elims/Alliances) are owned by 07-11 through 07-14, matching the established 07-02/07-03/07-06/07-07 precedent
- [Phase ?]: [Phase 07 P05]: Both corpusCensus.test.ts describe blocks (event_rankings, event_alliances) authored together in Task 1's single commit rather than split per task -- Task 2's commit is --allow-empty, the honest reflection of a deliverable (live-ingested corpus) that is entirely gitignored external state
- [Phase ?]: [Phase 07 P05]: Live full 2022-2026 rankings force-refresh (1,586 requests, 232.2s) and alliances ingest (1,586 requests, 223.1s) verified by fresh read-only corpus census -- event_rankings zero NULL record columns corpus-wide (47,695 rows, 1,322 populated events matching 06.1-04's baseline exactly), event_alliances first-ever corpus-wide measurement (10,290 rows, 1,355 distinct events); 2024's rankings null-body/empty-rankings split (0/44) measured for the first time, closing 06.1-04 COVERAGE.md note [3]
- [Phase ?]: [Phase 07 P05]: A pre-existing 07-02 test (packages/corpus/integrity.test.ts:314) asserting an event_rankings row can still be found with all four D-18.6 columns NULL is now permanently falsified by this plan's mandated zero-NULL backfill -- left unfixed (every task's verification requires packages/corpus/ diff stay empty) and logged to WINDOWS.md ledger #12 for a future plan to update
- [Phase ?]: [Phase 07 P09]: withEventPercentiles applies NO metric-name allowlist (PD-03, deliberate divergence from withHistoryPercentiles) -- buildEventTeamsStanding's required 4th sortedPools param threads the season-final pool into both call sites; runEventMode restructured onto a season-scoped replay (PD-05) so 07-10's subset publish carries honest percentiles
- [Phase ?]: [Phase 07 P09]: --include-offseason threaded through main()/runSeasonsCliMode/publishSeasons -- unlocks 253 real event artifacts (verified live, --seasons 2026 dry-run) a standard --seasons republish could not reach before; package.json's publish:seasons script left unedited (PD-08), routed to 07-17/07-19
- [Phase ?]: PD-04 confirmed live: 07-10 adds 7 offseason keys (all 404 pre-plan) and overwrites 8 -- not zero-added as the outline originally said
- [Phase ?]: 07-10 found 2025isios publishes alliances:[] despite the plan's own table declaring populated -- confirmed against live TBA as real state (not an ingest bug), a third D-17 empty-alliances event; expectation left unedited per the plan's own first prohibition, routed to 07-14
- [Phase ?]: EVNT-02 through EVNT-06 left Pending after 07-10 (matches 07-02 through 07-09 precedent) -- this plan proves the publish-run level only; 07-11 through 07-15 own the rendered tab surfaces that satisfy each requirement
- [Phase ?]: [Phase 07 P11]: RP renders as a plain numeric-cell span (never MetricValue) and the fallback-mode Rank header names the selected algorithm — Insights tab EVNT-02/D-07..D-10 shipped, verified live against 2025cmptx (0/26 ranked, real no-ranking Championship Finals) and 2024new (75/75 ranked control)
- [Phase ?]: [Phase 07 P12]: eventMatchAxis.ts's comparator branches on sortTime PRESENCE before VALUE (never values-only) because a values-only comparison is non-transitive across a mixed timed/untimed set; the bracket chain is retained beneath it because 114 corpus groups share an identical sort_time -- closes 07-13's routed series-major finding (2022nhgrs: 8/14 rows moved)
- [Phase ?]: [Phase 07 P12]: PLOT_W promoted to matchAxis.ts export and padAxisDomain extracted as a shared helper, both proven behaviour-preserving (matchAxis.test.ts/MatchTable.test.tsx stayed byte-identical and green) -- one geometry set and one padding policy for both the team and event match tables
- [Phase ?]: [Phase 07 P12]: EventMatchTable carries no team-key prop at all, enforced by a compile-time Exclude<keyof Props,...> === never assertion proven to bite -- the this-team bold-highlight rule is dropped by being structurally unrepresentable rather than merely unapplied
- [Phase ?]: [Phase 07 P12]: EVNT-04 marked complete in REQUIREMENTS.md -- this plan renders the Quals tab (matches the EVNT-02/07-11 precedent of marking complete at the rendering plan, not the earlier schema/publish plans)
- [Phase ?]: [Phase 07 P13]: ElimsTab.tsx ships as QualsTab's sibling with isElimCompLevel swapped in for isQualCompLevel -- no new comparator, filter, geometry constant or bonus-state derivation declared, enforced by seven negative grep gates; every elimination-row bonus-RP dot renders unknown with the not-awarded-outside-qualification-matches label (playoffs award no bonus RP)
- [Phase ?]: [Phase 07 P13]: EVNT-06 marked complete -- D-14's flat elimination list (no bracket) ships with the measured reason (from 2023 on, compLevel is sf for nearly every playoff match) recorded on the tab, and the ordering deviation (compareEventMatchRows is series-major for a 2022-style bracket, not literally chronological) surfaced as a flagged planner assumption routed to a named owner rather than fixed locally
- [Phase ?]: [Phase 07 P14]: Alliances tab EVNT-05/D-15/D-16/D-17 shipped -- combineAlliancePicks all-or-nothing sum-of-variances arithmetic proven against both measured absence causes (sub-three-pick alliance, missing-metrics-row pick); D-17 disabled trigger computed only from a genuinely resolved artifact for the current event key, proven via a real router.navigate exercising keepPreviousData
- [Phase ?]: [Phase 07 P14]: WINDOWS.md ledger #13 (2025isios's stale expectAlliances:populated seed in scripts/verifySubsetPublish.ts) left open -- outside this plan's declared file scope (AlliancesTab.tsx/test.tsx, event.$eventKey.tsx/test.tsx); the empty-alliances state itself is correctly handled by this plan's D-17 logic
- [Phase ?]: [Phase 07 P15]: Event identity header (EventHeader.tsx) ships as a DOM sibling above the tab strip, rendering only on populated/pending (PD-05); EventsList and SearchBox now navigate to /event/{eventKey}, retiring Phase 5's interim Events-list landing
- [Phase ?]: [Phase 07 P15]: D-20's per-algorithm rank header derives from algorithmDisplayLabel(algorithm) rather than a literal; Phase 5 D-12's year-change extension point discharged via an allow-list membership fetch at click time (resolveYearChangeTarget), falling back to the target season's Events list on any miss/unresolved version/fetch failure
- [Phase ?]: [Phase 07 P15]: SearchBox.test.tsx's pre-existing case count was 10, not the plan's stated 13; EventsList.test.tsx's pre-existing count (9) matched exactly — both files' pre-existing cases pass unweakened
- [Phase ?]: [Phase 07 P16]: Sigma1 -> VPR rename (pipeline half): registry/version-files/harness chain renamed to vpr, PIPELINE_ALGORITHM_IDS added beside unchanged PUBLISHED_ALGORITHM_IDS (PD-01) so the browser tier stays on sigma1@ until 07-18; digest.test.ts stayed bit-identical unedited
- [Phase ?]: [Phase 07 P16]: algorithmIdentity.test.ts's STRUCTURAL_EXEMPTIONS (6 entries) added alongside the plan's own 8-entry IDENTITY_SWEEP_EXCLUSIONS to cover cases the tier-P/C/F list doesn't reach (the sweep's own file, a path-segment false positive, PD-01's dual-tier constant, a frozen-fixture assertion, a live-reality verification script, and a negative rejection-proof test); marker cap raised 12->13 against the real re-grep count
- [Phase ?]: [Phase 07 P17]: Discovered and recovered from a genuine concurrent-writer incident -- four zombie publish.ts processes from earlier executor-timeout-killed attempts stayed alive on Windows/Git-Bash (the timeout kills only the outer wrapper, not the deep tsx child) and raced a tracked run against the live R2 bucket for its full ~24-minute duration. Killed via PowerShell Stop-Process, confirmed absent, superseded by one clean solitary re-run (generation 47d020a4-1a16-4331-bd70-ce2f468bf2d1) -- safe per PD-05 since every key is deterministic and idempotent. Post-recovery verify:subset confirms one distinct generation across every sampled key
- [Phase ?]: [Phase 07 P17]: team/{teamKey}/{year} crosses BOTH its 375,000-byte committed budget and payloadBudget.test.ts's separate 600,000-byte absolute structural ceiling for the first time (821,938 bytes, frc9999/2024 -- confirmed a real synthetic/heavily-reused team key with 27 events/289 matches under --include-offseason, not a data-integrity artifact); neither ceiling raised, new WINDOWS.md ledger #15 routed to 07-19
- [Phase ?]: [Phase 07 P18]: PUBLISHED_ALGORITHM_IDS collapsed to [opr, epa, vpr] once precondition confirmed the manifest/artifact live; DEFAULT_ALGORITHM=vpr, DEFAULT_EVENT_TAB=insights, ribbon relabeled OPR/EPA/VPR; every sigma1@/D1 row survives untouched (07-19's job)
- [Phase ?]: [Phase 07 P18]: algorithmIdentity.test.ts's apps/web/ exclusion deleted (client third of D-05 landed); STRUCTURAL_EXEMPTIONS extended for two permanent negative-rejection tests (Worker tier, D-05 adjacency proof) that must cite the retired id; MARKER_CAP raised 13->19
- [Phase ?]: [Phase 07 P18]: event-page.spec.ts's tracer was genuinely broken since 07-15 (asserted testids that never shipped) -- first surfaced by this plan's own mandated e2e run, since 07-01 through 07-17 had never been pushed to trigger the deploy workflow; fixed and reverified against the live deployed origin (two pushes, two successful deploys, 42/42 e2e pass)
- [Phase ?]: [Phase 07 P19]: The R2/D1 cleanup pass completed -- 19,261 sigma1@ R2 keys deleted, 4,599 D1 rows deleted, Worker redeployed onto the vpr live-fold tier -- proven by before/after census (48/60 present -> 0/60), never by exit code; corrected 07-17's DeleteObject billing-class attribution (it is a Free operation, not Class A, per Cloudflare's own pricing page)
- [Phase ?]: [Phase 07 P19]: Discovered (not fixed -- apps/worker out of scope) a new production finding: the redeployed Worker fails 100% of ticks captured hours later with outcome:exceededCpu and empty logs, contradicting the healthy ticks recorded immediately post-deploy; ledgered WINDOWS.md #16 and routed to a new todo
- [Phase ?]: [Phase 07 P19]: Developer-directed exclusion of 30 fake 'Off-Season Demo Team' keys (frc9970-frc9999) from the model and every published surface, sequenced to land AFTER this plan and BEFORE 07-20; routed as .planning/todos/pending/exclude-offseason-demo-teams.md with full measured blast radius (6,285 contaminated matches, 428 fully-demo alliances). **RESOLVED 2026-08-29**: fully-demo alliances (case 1) now a no-op update() in all three algorithms; mixed alliances (case 2) remap every demo key to one shared, never-published pseudo entity rather than deleting the column (deletion would have inflated real teammates -- quantified in opr.test.ts: naive deletion would have been 1.5x-5x the chosen treatment's value for a representative match). Full republish (generation 961340e8-9e45-4d91-8e85-f72982ac3d87) confirms 414 fewer team-season objects (53,010 -> 52,596) and a real team's rating moving on both algorithms. WINDOWS.md ledger #11/#15 figures updated (teams max 3,732,955->3,705,194; team max 821,938->675,943 at frc3538/2024, confirmed) and left open per the todo's explicit non-goal. See .planning/todos/completed/exclude-offseason-demo-teams-SUMMARY.md for the full accounting.
- [Phase ?]: [Phase 07 P20]: assertNoIntermediateScroller requires an actual overflow on the flagged axis, not merely a permissive computed overflow style -- a naive version false-positived on __root.tsx's own overflow-x-hidden div due to the CSS coupled-axis overflow-x/overflow-y resolution rule, proven both ways via a live bite-check
- [Phase ?]: [Phase 07 P20]: 2022ilpe/2022nhgrs elimination order corrected to WALL-CLOCK (not the series-major sequence 07-13 originally measured) -- eventMatchAxis.ts's compareEventMatchRows has prioritized sortTime presence since its one commit (07-12's tracer); both fixtures now render wall-clock live, closing the bracket-order product decision this plan's own checkpoint originally framed
- [Phase ?]: [Phase 07 P20]: the alliance-uncertainty identity (ledger row 9) was rewritten from a near-equality assertion to a monotone-narrowing assertion after developer-confirmed evidence (280 alliance-pairs, 2024new: mean gap 1.130 first half vs 0.373 second half) showed the original design compared an as-of-event quantity against an as-of-that-match one, which can never hold as an identity regardless of tolerance; the TRUE identity is routed to .planning/todos/pending/publish-as-of-match-team-metrics.md
- [Phase ?]: [Phase 07 P20]: Phase 07 (event-pages) is now fully complete -- 20/20 plans, all seven UI-SPEC backstop rows and five non-UI-SPEC backstop markers have evidence (10 automated, 2 carried to 07-UAT.md for /gsd-verify-work 7 pending physical hardware)

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- Clean-slate mandate: no pre-v3 code, models, or tuned values may be consulted or ported (REBUILD_SPEC.md). Only the failure log carries over.
- Cloudflare free-tier 10 ms Worker CPU is the load-bearing constraint; Sigma1's per-match update cost must be measured early (Phase 2) so Phase 4's incremental path is feasible.
- Per-season RP rules for 2022–2026 must be verified against official game manuals in Phase 3 — generic parsing will not work.
- REQUIREMENTS.md originally stated 34 v1 requirements; the actual count is 38. Corrected in the traceability section.
- ~~epa.ts's predict() may attribute foulsCommitted to the wrong side's score (sums a team's own learned foulsCommitted into its own score rather than the opponent's) -- unverified impact, logged to WINDOWS.md entry 3, not fixed by plan 02-04~~ **RESOLVED** (corrected 2026-08-20, phase 03.1 verification): this line was stale and contradicted its own cited source. `WINDOWS.md` ledger entry 3 has read `status: fixed` since 2026-08-14T06:40:51Z, and `packages/core/algorithms/epa.ts` implements the correct D-04 cross-alliance attribution at HEAD — an alliance's own `FOULS_COMMITTED_COMPONENT` is excluded from its offensive total and the OPPOSING alliance's is added instead (`redScore = redOffensiveTotal + blueComponents[FOULS_COMMITTED_COMPONENT]`), mirroring sigma1's handling. Fixed in `a0ec5d54` (`fix(02): EPA predict attributes foulsCommitted to the opposing alliance (D-04)`) with a regression test in `epa.test.ts`. STATE.md was simply never updated to match.
- ~~packages/core/algorithms/breakdown/2024.ts's parseBreakdown() is called unconditionally at the top of sigma1's update() with no eventType/compLevel guard and no try/catch -- self-reported offseason score_breakdown JSON missing required fields (confirmed: 2024cafb_qm1, 2024wvrox_sf1m1) throws uncaught; logged WINDOWS.md #4/#5, not fixed (out of scope for 03-07)~~ **RESOLVED** by quick task 260818-inm: `tryParseBreakdownPair` narrows the failure to ZodError/SyntaxError only and degrades to the D-05 fallback with a counted `breakdownParseFailureCount`; both commands now exit 0 (1004 and 19 failures counted, never dropped). WINDOWS.md #4/#5 closed. ~~Security threat T-03-18b remains formally `open` in 03-SECURITY.md until `/gsd-secure-phase 3` is re-run.~~ **RESOLVED** (corrected 2026-08-20, phase 03.1 follow-up, per the 2026-08-19 milestone audit): `/gsd-secure-phase 3` was in fact re-run — `03-SECURITY.md` reads `status: verified`, `threats_open: 0`, `updated: 2026-08-19`. This line was stale, carried over unfixed from the prior audit; T-03-18b is closed.
- Phase 03.1 (address-phase-1-3-review-warnings-and-doc-drift) closed all nine review warnings carried forward from Phases 1 and 3 (six in `01-REVIEW.md`, three in `03-REVIEW.md`), each with a verifiable commit SHA recorded in the review file's own resolution subsection; corrected `01-VERIFICATION.md`'s stale human-verification item (closed by `01-UAT.md`, not still outstanding); and corrected this file's stale T-03-18b claim above. See `.planning/phases/03.1-address-phase-1-3-review-warnings-and-doc-drift/03.1-05-SUMMARY.md` for the full accounting.
- teams/{year} artifact's measured maximum (3,577,069 bytes) exceeds its committed budgetMaxBytes ceiling (3,500,000 bytes) -- caused by pre-06.1 Phase-6 work (06f468ad/bf1e3228), not phase 06.1's own scope; payloadBudget.test.ts left red pending a developer decision (raise ceiling deliberately, or shrink the teams/{year} artifact). See WINDOWS.md ledger #11 and 06.1-07-SUMMARY.md.
- Executor-tool Bash timeout does not terminate background process trees on Windows/Git-Bash (only the outer wrapper dies, not deep tsx/node children) -- caused a real concurrent-writer incident during 07-17's publish run, recovered but costly. Future long-running publish invocations on this machine MUST use run_in_background=true from the FIRST attempt, never rely on the tool's default timeout to kill a heavy child process

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260818-inm | Guard parseBreakdown against self-reported offseason score_breakdown JSON so a Zod failure degrades to a counted skip instead of aborting the harness run (security threat T-03-18b) | 2026-08-18 | dd39ba28 | [260818-inm-guard-parsebreakdown-against-self-report](./quick/260818-inm-guard-parsebreakdown-against-self-report/) |
| 260819-2x6 | Close EVAL-01/SC-4 outcome-leakage descriptor and enumeration bypasses: add getOwnPropertyDescriptor and ownKeys traps to toLeakProofUpcoming's Proxy handler | 2026-08-19 | e70b31df | [260819-2x6-add-getownpropertydescriptor-and-ownkeys](./quick/260819-2x6-add-getownpropertydescriptor-and-ownkeys/) |
| 260821-ncc | Assert sigma1-adapt reads 2.0.0+tune-joint-on-winner in the committed event-scoped fingerprint, so a missing gitignored reports/tune-joint-on.json cannot silently substitute the 2.0.0+defaults-adapt fallback undetected (SECURITY A-01, threat T-03.2-13) | 2026-08-21 | a912c22b | [260821-ncc-assert-sigma1-adapt-version-in-the-commi](./quick/260821-ncc-assert-sigma1-adapt-version-in-the-commi/) |
| 260822-wqt | Restrict the Worker's live folding tier to sigma1 via a tracked LIVE_ALGORITHM_IDS var, fixing the measured defect where three live algorithms cost 50 subrequests against ~41 usable and deferred every ordinary match forever; all three algorithms remain published. Also fixed an AND/OR precedence bug in readScopedState that leaked one algorithm's league row into another's read | 2026-08-23 | a37f40e7 | [260822-wqt-restrict-live-folding-to-sigma1](./quick/260822-wqt-restrict-live-folding-to-sigma1/) |

### Roadmap Evolution

- Phase 03.1 inserted after Phase 3: Address Phase 1-3 review warnings and doc drift (URGENT)
- Phase 3.2 inserted after Phase 3.1: Swap OPR to event-scoped and re-issue affected figures (URGENT)
- Phase 3.2 edited: SC-2 reworded: docs/models and PROJECT.md re-issued outright; Phase 1-3 SUMMARYs annotated with dated superseded-by notes, original numbers intact (03.2-CONTEXT D-16). Reworded before any new figures were measured.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-08-30T01:35:33.835Z
Stopped at: Completed 07-20-PLAN.md -- Phase 07 (event-pages) fully complete, 20/20 plans
Resume file: None
