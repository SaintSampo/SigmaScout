# 260928-n6i pre-registration: the RP cold-team prior, then the Sigma-carry retry

Registered 2026-09-28T20:55Z at HEAD eb90c0d7, on branch `quick/260928-n6i`, before any candidate code, dry run or result exists. The runs below execute exactly what is written here. Verdicts are read mechanically. No gate is added, dropped, reweighted or reinterpreted after a number is seen. Everything a command prints beyond its gate lines is descriptive only.

## Why (the diagnosis this candidate rests on)

The Sigma-carry candidate failed gate G4b of the bar registered in `.planning/debug/resolved/presim-bake-rp-filler-refuses.md` (sha256 9b83748be0f9c1c59edff6109df74f2c965887e6fefb8d76ab169c6e794ab8f4). On the matches it newly prices, the bonus Brier was 0.173994, against 0.140040 for season-to-date climatology. The bonus probabilities are identical in both of that bar's arms, so the failure sits in the RP bonus model, not in Sigma.

From the code, with no new measurement:

- `analyticRpPmf` reads the bonus probabilities from the threshold-variable moments only (`meanVector`, `varianceBlock`). No score and no Sigma enters them.
- `RpMomentsAccumulator.momentsFor` skips a team with no belief for a variable. So a roster team with no folded match this season adds a zero mean, and no variance.
- A fully cold alliance therefore gets mean 0 and variance 0, a degenerate belief that prices nearly every bonus near 0. A partly cold alliance's mean is short by the cold teams' share.
- The mean shift never corrects this, because it books and shifts fully warm rosters only.
- A team with one observation has an undefined variance, and it still counts toward the variance average with 0, which narrows the belief further.
- Every match in G4b's newly covered set comes from a roster with a team the incumbent refused for lacking a Sigma Score this season. That team has no folded match this season, so it is also RP-cold.

## Candidate R: `rpColdPrior` (one configuration, no numeric parameter, no search)

A boolean. Off (the default, and the only production value) is the incumbent and must be byte-identical to today. On:

1. **Population summary.** Per season and per threshold variable, the `RpMomentsAccumulator` keeps an unweighted, undecayed running summary of every finite alliance value that `fold` folds. That is exactly the population the team beliefs fold, at RP-eligible event types, over every comp level, with offseason events included as the layer folds them today. The summary holds the count `n`, the mean `m` and the unbiased variance `v` (denominator `n - 1`; undefined below `n = 2`). It is read before a match folds, the accumulator's existing predict-before-update order, so it is walk-forward. It never carries across seasons, because the threshold variables change with the game.
2. **Cold team.** In `momentsFor` with roster size `r`, a team with no belief for a variable contributes mean `m / r` when `n >= 1`. When `n >= 2` it also counts toward the variance average with the per-team term `v / r^2`, which the existing `r^2 / contributing` scaling turns into the alliance variance `v`. With `n = 0` it is skipped exactly as today.
3. **Thin team.** A team whose belief has an undefined variance (an effective sample below one) gets the variance term `v / r^2` when `n >= 2`, instead of today's 0.
4. **Everything else is unchanged**: warm teams' means and variances, `hasHistory`, `rosterIsFullyWarm`, the mean shift's booking and application (so a prior-filled team is never shifted), the win odds, the score moments, Sigma, and the match band.

A fully cold alliance is thereby priced from the league's season-to-date distribution of that variable, not from zero. This is not a blend: no second model's output is mixed in, and a team with its own history is untouched. It is the RP analogue of SPR's own treatment of an unseen team.

`snapshotFor` copies the population summary along with the roster's beliefs, so a frozen pre-event snapshot prices exactly as the live accumulator does. The Worker's resume path (`beliefsByTeam` and `fromBeliefs`) does not carry the summary. So the knob is offline-only until a rollout adds it to the D1 seed, and no production entry point turns it on.

## Inertness (before any gate runs)

- The full vitest suite, run from the REPO ROOT, is green, with new unit tests for items 1 to 4 and for knob-off identity.
- A knob-off `publishSeasons` dry run for 2025-2026 at the change's HEAD gives sha256 identical page bodies and presim sidecars to the same dry run at eb90c0d7. If this fails, the change is NO-GO (a knob-off leak), and nothing below runs.

## Bar R (the cold-team prior earns promotion on its own)

Population and scorers are those of the registered bar's G3 and G4, through `scripts/measureSigmaCarry.ts`: SPR only, one replay per season, both arms folded from the same records, and nine counted seasons (2017-2020, 2022-2026; 2016 is replayed, not counted). **In bar R mode the Sigma carry is OFF in both arms.** The incumbent is today's layer. The candidate is the same layer with `rpColdPrior` on. At G4's pre-event instant, both arms price with the same all-or-nothing Sigma refusal (each arm's own `sigmaScoreByTeam()`, no rookie rule). Their Sigma is identical, so both price the same match set.

- **R0 (Rule A, winner figures).** `captureCompareSlices` default against `captureCompareSlices --rp-cold-prior` must be byte-identical (`cmp` exit 0). The capture keeps winner accuracy, Brier and counts only, so NOT EQUAL means an RP-to-winner leak and is an automatic NO-GO.
- **R1 (played rows, the published RP scorer).** The G3 population. Pass iff bonusBrier(on) < bonusBrier(off) AND RPS(on) < RPS(off), both STRICT, because this change moves published RP pmfs and must improve both.
- **R2 (pre-event, the matched set).** The G4 set both arms price. Pass iff bonusBrier(on) <= bonusBrier(off) AND RPS(on) <= RPS(off).
- Every paired comparison asserts identical observation counts. A mismatch voids it, and a void is NO-GO.
- Descriptive only: per season, and the pre-event bonus Brier split by the number of RP-cold teams on the side (0, 1, 2, 3).

**GO(R) iff R0 EQUAL, R1 pass and R2 pass.** Anything else is NO-GO, reported with each failing gate's two numbers. If R is NO-GO, the carry retry below does not run.

## The Sigma-carry retry (only if R is GO)

The SAME registered bar (sha256 9b83748b...): gates G1, G2, G3, G4-cover, G4a, G4b and G5, the same scorers, season sets, match sets, G4b climatology reference and GO mapping. One declared change of baseline: **both arms carry `rpColdPrior` on.** The incumbent is SPR plus the cold-team prior. The candidate is SPR plus the cold-team prior plus the Sigma carry, the same carry configuration as before, unchanged. The G5 knob-off baselines are rerun with `rpColdPrior` on at all five instants, because the earlier ones were made without it.

The registered bar's Rule A reading (G1 exact equality) still awaits Jacob's sign-off. It goes to him before the retry runs.

## Exact commands (worktree root; `S` = C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/cbee6492-81d3-46ec-843d-d0c94858caa3/scratchpad/n6i; each detached with output to a log; completion judged by the log content)

Before and after every run, record HEAD, `git status --short -- packages scripts apps` (must be clean) and `data/corpus.sqlite`'s sha256, which must equal 36ab99dd26a74c9c... (the worktree's own copy, taken 2026-09-28 from the main checkout at mtime 15:20:56).

Bar R:
1. R0: `npx tsx scripts/captureCompareSlices.ts --out $S/r/compare-off.json`; `npx tsx scripts/captureCompareSlices.ts --rp-cold-prior --out $S/r/compare-on.json`; `cmp` the two.
2. R1, R2: `npx tsx scripts/measureSigmaCarry.ts --rp-prior-arms --out $S/r/rp-prior.json`. Its printed `GATE R1` and `GATE R2` lines and the JSON's `verdicts` block are the results.

Retry (only if GO(R)):
3. G1: `npx tsx scripts/captureCompareSlices.ts --rp-cold-prior --out $S/d1/compare-off.json`; `npx tsx scripts/captureCompareSlices.ts --rp-cold-prior --sigma-carry --out $S/d1/compare-on.json`; `cmp`.
4. G2 to G4: `npx tsx scripts/measureSigmaCarry.ts --rp-cold-prior --out $S/d1/sigma-carry.json`.
5. G5 baselines: for D in 2026-03-01, 03-05, 03-14, 03-21, 04-04: `npx tsx scripts/publishDistricts.ts --years 2026-2026 --as-of D --dry-run --rp-cold-prior --local-out $S/d1/bake-MMDD-off`.
6. G5 candidate: the same five with `--rp-cold-prior --sigma-carry` and `--local-out $S/d1/bake-MMDD-on`.

`--rp-cold-prior` on `publishDistricts` refuses to run without `--dry-run`, as `--sigma-carry` does.

## What a GO does and does not do

Nothing ships from this task. GO(R) and a retry GO each mean "earned promotion to Jacob's decision". Shipping either needs his approval, plus an SPR version bump (published RP pmfs, presim sidecars and, for the carry, Sigma and bands all move), the population summary added to the D1 seed and the Worker's resume path, a republish, a reseed and a Worker deploy decision.
