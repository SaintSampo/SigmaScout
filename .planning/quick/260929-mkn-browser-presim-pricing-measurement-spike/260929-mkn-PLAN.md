---
quick_id: 260929-mkn
date: 2026-09-29
description: >-
  Measurement-only spike: what would it cost to price the pre-schedule ("Before schedule
  release") rank simulation in the browser instead of reading the baked sidecar? Measures
  per-call pricing cost with and without a per-alliance cache (Node and a real Chromium page
  at 1x/4x/6x CPU throttle), the per-event payload and lazy-bundle bytes the browser would
  need, and the wall time to reach 150/300/1000/2000/4000 schedules, mapped against the
  rung-2 binding resampling floor. Ships nothing.
status: planned
phase: quick-260929-mkn
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [quick-260929-mkn]
files_modified:
  - scripts/browserPresimPricing.ts
  - scripts/browserPresimPricing.test.ts
  - scripts/measureBrowserPresimPricing.ts
  - .planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-results.json
  - .planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-FINDINGS.md

estimate:
  tokens: 100000
  raw_tokens: 200000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "A browser-safe pricing module, bundled by esbuild for platform=browser and run in a real headless Chromium page with every network request aborted, reproduces the Node bake's baked rank histograms at n=1000 schedules x 50 draws for three finished 2026 events (about 18, 40 and 75 teams), or the exact mismatch (matches with differing rounded pmfs, histogram cells that differ) is measured and reported"
    - "The pricing state is the spr pre-event walk-forward state with the Sigma carry and the RP cold-team prior on, reconstructed by `buildDistrictPricingState` cut at each event's first played match over the publish season list (2016-2020, 2022-2026), never the season-final state"
    - "Per-call pricing cost is reported in microseconds for the uncached and alliance-cached arms, in Node and in Chromium at CPU throttle 1x, 4x and 6x, and the cache effect is reported as the within-run ratio of the two arms from interleaved repetitions in the same process or page"
    - "The code-level factoring answer is stated: which pieces of SPR predict plus the RP fill are alliance-level (cacheable) and which are match-level, with measured per-call cost for SPR predict, the alliance-level RP pieces and the match-level combine"
    - "Per-event payload bytes (raw, gzip, brotli) for the minimal browser pricing inputs sit beside the same event's rebuilt sidecar body bytes and the 2026-09-29 publish run's sidecar median 7,145 B / p95 15,983 B / max 23,806 B (raw), plus the pricing bundle's minified, gzip and brotli bytes"
    - "Wall time to reach 150/300/1000/2000/4000 schedules (cached arm, generate/price/draw split) at 1x/4x/6x is tabulated per event and mapped against the rung-2 binding floor (n=150 50.0%, 300 62.7%, 1000 81.1% with worst team 1.17 ranks, 2000 91.8%, 4000 98.4%)"
    - "260929-mkn-FINDINGS.md states go / no-go / go-with-conditions under the frame pre-registered in this plan, with a schedule count and a progressive-render plan, every extrapolation labelled"
  artifacts:
    - path: scripts/browserPresimPricing.ts
      provides: "Browser-safe presim pricer: payload type, uncached and alliance-cached match pricing, chunked run with checkpoints, component micro-loops"
      contains: "export function runPresim"
    - path: scripts/browserPresimPricing.test.ts
      provides: "Pins the match-level combine against analyticRpPmf and the alliance cache key"
    - path: scripts/measureBrowserPresimPricing.ts
      provides: "Driver: extract, tracer, node, browser and summarize phases"
      contains: "buildDistrictPricingState"
    - path: .planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-results.json
      provides: "Compact measured numbers (no payload bodies), top-level keys events, parity, q1, components, q2, q3, host"
    - path: .planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-FINDINGS.md
      provides: "Findings and recommendation"
  key_links:
    - from: scripts/browserPresimPricing.ts
      to: packages/core/rankingPoints/analyticPmf.ts
      via: "allianceBonusRpPmf (alliance-level, cached) + matchOutcomeDistribution + convolvePmf (match-level)"
      pattern: "allianceBonusRpPmf"
    - from: scripts/measureBrowserPresimPricing.ts
      to: scripts/districtPricingState.ts
      via: "buildDistrictPricingState(db, { season: 2026, warmupSeasons, asOf: first played match, sigmaCarry: true, rpColdPrior: true }).predictFor(roster)"
      pattern: "predictFor"
    - from: scripts/measureBrowserPresimPricing.ts
      to: packages/harness/preSchedule.ts
      via: "buildPreScheduleArtifact reference bake (1000 x 50) that the browser histograms must equal"
      pattern: "buildPreScheduleArtifact"
    - from: scripts/measureBrowserPresimPricing.ts
      to: apps/web/node_modules/@playwright/test
      via: "createRequire anchored at apps/web/package.json; chromium.launch, newCDPSession, Emulation.setCPUThrottlingRate"
      pattern: "setCPUThrottlingRate"
---

# Quick task 260929-mkn: browser presim pricing, measured

<objective>
Jacob reopened browser-side pricing of the pre-schedule simulation on 2026-09-29 (closed
2026-09-19 in `.planning/todos/completed/price-the-preschedule-simulation-in-the-browser.md` and
2026-09-23 in `docs/simulation-architecture.md` section 5). Section 5's Option B cost estimate is
stale: it assumed a Cholesky and 4,000 joint draws per match, but the SPR RP path is analytic
lattice pmfs with no Cholesky. This spike replaces the estimate with measurements.

Three questions:
1. Pricing cost as browser JS: microseconds per synthetic-match pricing call and per-event
   total at 1000 schedules, with and without a per-alliance cache.
2. Payload: bytes of the minimal per-event inputs the browser needs, beside today's sidecar,
   plus the lazy-loaded pricing bundle.
3. Time to a stable table: wall time to 150/300/1000/2000/4000 schedules at 1x/4x/6x throttle,
   against the rung-2 binding resampling floor.

Output: two scripts, one small test, a compact results JSON and a findings doc with a
recommendation. Measurement only.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@docs/simulation-architecture.md
@packages/harness/preSchedule.ts
@scripts/districtPricingState.ts

Read only the named ranges of these, do not read them whole:
- `packages/harness/publish.ts` 160-176 (PRESIM constants), 471-508 (`makeRankingPointFiller`, the RP fill this spike must reproduce), 1369-1445 (`buildPreScheduleSidecarForEvent`: the `predict` closure is algorithm.predict then the filler), 2477-2493 (the published roster: unique team keys over every played and scheduled match of the event, all comp levels).
- `packages/core/rankingPoints/analyticPmf.ts` 485-500 and 566-739 (`allianceBonusRpPmf`, `matchOutcomeDistribution`, private `allianceOutcomePmf`, `analyticRpPmf`).
- `packages/core/algorithms/spr.ts` 556-580 and 637-672 (`viewOfMap`, `predict`).
- `scripts/measureFieldAveragedRanks.ts` 720-790 only if the reference-bake call shape needs checking.
- `docs/models/rung2-generated-schedules.md` lines 37-67 (the binding floor tables).

## Established facts (do not re-derive)

- Offline bake cost: `reports/publish/republish-260919.out.log` line 213, `2026/spr sidecars 841.1s` for about 214 sidecars, about 3.9 s per event in Node. Pricing dominates, not drawing.
- The 2026-09-29 publish run (docs/publish-budget.md line 549): 211 presim sidecars, median 7145 B, p95 15983 B, max 23806 B. These are RAW UTF-8 bytes (`Buffer.byteLength`, publish.ts:1297), not compressed.
- Only 2026 events have published sidecars (`--presim-from-season 2026`), so every measured event is a finished 2026 event.
- The embedded per-event SPR state block was deleted 2026-09-23; the browser has no SPR state today.
- Distinct alliances C(N,3): 18 teams 816, 40 teams 9,880, 75 teams 67,525, 76 teams 70,300. Alliance slots priced per bake = scheduleCount x quals x 2.
- Chromium for Playwright is installed at planning time (`%LOCALAPPDATA%/ms-playwright/chromium_headless_shell-1234`). `@playwright/test` 1.62.1 lives ONLY in `apps/web/node_modules`; the repo root cannot import it by name. esbuild is not a root dependency; it resolves from tsx's own install.
- Root `tsconfig.json` has `lib: ["ES2023"]` (no DOM), `noUncheckedIndexedAccess`, `verbatimModuleSyntax`; it includes `scripts/**/*.ts`. Root vitest includes `scripts/**/*.test.ts`, so the test runs in Linux CI: it must not touch the corpus, esbuild, Playwright or the filesystem.

## The factoring, read from the code at planning time (Task 1 confirms it by parity)

Per synthetic match, the published pipeline runs `spr.predict(state, match)` and then the filler.
- SPR `predict`: `viewOfMap(state.teams, allianceKeys)` gives each alliance's `{mu, pv}` from its own three teams only (ALLIANCE-LEVEL); `redScore = red.mu * state.scale / 3` (ALLIANCE-LEVEL); `pRedWin = normCdf((red.mu - blue.mu) / (tau * sqrt(red.pv + blue.pv + 2 obsSd^2)))` (MATCH-LEVEL, a few flops). `viewOfMap` is NOT exported, so this spike cannot cache it without editing `packages/`; SPR predict stays per match in both arms and its own per-call cost is measured separately, which bounds what caching it could save.
- Filler, per alliance: `allianceSigmaBandVariance(teams, sigmaByTeam)`, `accumulator.momentsFor(teams, allianceScore, bandVariance)`, `meanShift.apply(moments, rosterIsFullyWarm(accumulator, teams))`, `allianceBonusRpPmf(shiftedMoments, ruleModule, eventType)`. All ALLIANCE-LEVEL and all exported. `allianceBonusRpPmf` is the marginal-fit and lattice work, expected to be the bulk of the cost.
- Filler, per match: `matchOutcomeDistribution({red/blue scoreMean, scoreVariance, winRp, tieRp, pRedWin})`, the per-alliance outcome pmf (private `allianceOutcomePmf` in analyticPmf.ts, five lines: length winRp+1, win prob at winRp, tie prob added at tieRp, lose prob added at 0), `convolvePmf(outcomePmf, bonusPmf)`, the normalization and `maxRp + 1` length checks, then `roundPmf`. MATCH-LEVEL and cheap.
- Float order caveat: `viewOfMap`, `allianceSigmaBandVariance` and `momentsFor` sum over the alliance in key order. A cache keyed by the SORTED triple can hand a permutation pieces computed in another order, which can differ in the last bit. Whether that survives `roundPmf` is measured, not assumed.
- Presim predictions carry no RP decomposition (`matchOutcomePmf` and friends are absent from both `spr.predict` and the filler), so `SimMatchInput.outcome` is absent. Parity confirms it.

## Pre-registration (fixed before any number is seen)

- P1, cache effect (question 1): for each (event, engine, throttle) cell, K=200 schedules, run uncached and cached interleaved U,C,U,C,U,C in the same process or page. Report per-call microseconds per arm and the per-repetition ratio cached/uncached; the reported effect is the median of the three within-run ratios, with the range. Absolute milliseconds are reported but are one machine's numbers, not a bar.
- P2, parity gate: at n=1000 x 50 draws, the uncached arm in Node, the cached arm in Node and the cached arm in Chromium 1x must each produce baked histograms identical to `buildPreScheduleArtifact`'s for the same state and seeds. The uncached arm in Chromium 1x is checked too. Parity failing in any arm rules out a plain "go": the best available verdict is go-with-conditions naming the output change and the version bump it would force (a changed published number ships under a new spr version).
- P3, reading frame for the recommendation: the deciding number is the ~75-team event's wall time to n=1000 (cached arm, generation included) at 4x and at 6x. Under 3 s reads as comparable to a fetch; 3 to 15 s needs progressive rendering and a lower first count; over 15 s at 4x is phone-hostile. These are seconds-scale bands, three orders above the millisecond run-to-run spread, so the spread cannot flip a band. Payload is read as the per-event gzip bytes against the same event's rebuilt sidecar gzip bytes, plus the bundle's gzip bytes paid once per session.
- Throttle meaning: CDP `Emulation.setCPUThrottlingRate` on a desktop host. 4x is Lighthouse's mobile preset (the project's first-paint precedent, docs/first-paint-measurement.md line 224); 6x is read as a low-end phone. Both are approximations of a phone, and the findings say so.
</context>

<interfaces>
Signatures the executor uses directly (all verified at planning time):
- `buildDistrictPricingState(db: Corpus, { season, warmupSeasons, asOf, algorithm, sigmaCarry?, rpColdPrior? }): DistrictPricingState | null` in scripts/districtPricingState.ts. Result fields: `endState` (SprState after the last replayed match), `layer` (SigmaScoutLayer), `predictFor(roster)` (bound predict or undefined when the roster is refused), `ratingsFor(roster)` (Map teamKey to `{teamKey, total, sigma}` under the rookie rule), `teamsWithoutSigmaFor(roster)`. `asOf` is any `Date.parse`-able string; played matches with `sort_time >= asOf` (epoch ms) are cut from every replayed season. `openDistrictPricingCorpus()` opens `data/corpus.sqlite` read-only; the caller closes it.
- `BASE_PUBLISH_ALGORITHMS.spr` (packages/harness/publish.ts) is the published SPR module; `spr` is also exported from packages/core/algorithms/spr.ts. `spr.version` feeds every seed string.
- `buildPreScheduleArtifact(params)` and `PublishedPreScheduleArtifactSchema` (packages/harness/preSchedule.ts, packages/harness/pageArtifacts.ts). Reference call shape: scripts/measureFieldAveragedRanks.ts 761-777.
- Seeds, copied not imported (preSchedule.ts pulls zod into a bundle): `fnv1a32` (FNV-1a 32-bit, preSchedule.ts 121-128); structure k = `generateSchedule(numTeams, matchesPerTeam, mulberry32(fnv1a32("generate|" + numTeams + "|" + matchesPerTeam + "|" + k)), DEFAULT_RESTARTS)`; shuffle k = seeded Fisher-Yates over roster indices with `mulberry32(fnv1a32(eventKey + "|" + algorithmVersion + "|shuffle|" + k))` (preSchedule.ts 250-260, 366-392); draws k = `simulateRanks(simInputs, zeroBaselines, 50, mulberry32(fnv1a32(eventKey + "|" + algorithmVersion + "|baked|" + k)))` (preSchedule.ts 441-452); synthetic `UpcomingMatch` fields and surrogate filtering exactly as preSchedule.ts 267-320 (compLevel "qm", matchKey `${eventKey}_presim${k}_qm${n}`, surrogates excluded from the simulateRanks team lists only).
- `RpMomentsAccumulator.fromBeliefs(ruleModule, beliefsMap, { population })`, `accumulator.beliefsByTeam()`, `accumulator.populationState()` (empiricalMoments.ts 278, 310, 336). `RpMeanShiftAccumulator.fromState(ruleModule, state)`, `.apply(moments, fullyWarm)`, `rosterIsFullyWarm(accumulator, teams)` (meanShift.ts 60, 127, 157). `layer.rpMeanShiftState()`, `layer.rpAccumulator`.
- `allianceSigmaBandVariance(teams, sigmaByTeam)` (packages/harness/sigmaScore.ts 81), `isRpEligibleEventType` (packages/core/rankingPoints/constants.ts), `RP_RULE_MODULES` (packages/core/rankingPoints/rules.ts), `roundPmf` (packages/harness/rounding.ts 140), `mulberry32`/`simulateRanks` (packages/core/algorithms/simulation/rankSimulation.ts 52, 228), `generateSchedule`/`DEFAULT_RESTARTS`/`matchesPerTeamFor` (packages/harness/generatedSchedules.ts).
- SprState: `spr.initState([])` gives a valid state; predict reads only `teams` (Map of `{muL, pL, muS, pS}`), `logTau` and `scale`. A team absent from `teams` is priced as `freshTeam`, the same as a fresh entry.
</interfaces>

<tasks>

<task type="tracer">
  <name>Task 1: Tracer, one event end to end: replayed pre-event state, browser-safe pricer, esbuild bundle, Chromium page, parity with the Node bake</name>
  <files>scripts/browserPresimPricing.ts, scripts/browserPresimPricing.test.ts, scripts/measureBrowserPresimPricing.ts</files>
  <precondition>`data/corpus.sqlite` exists and `ls "$LOCALAPPDATA/ms-playwright"` lists a `chromium_headless_shell-*` directory; the sandbox cannot download a browser.</precondition>
  <read_first>packages/harness/preSchedule.ts (already in context), packages/harness/publish.ts 471-508, packages/core/rankingPoints/analyticPmf.ts 566-739, packages/core/algorithms/spr.ts 637-672, scripts/districtPricingState.ts 330-484</read_first>
  <behavior>
    - combineMatch over allianceBonusRpPmf pieces for two hand-built alliances returns redPmf/bluePmf exactly equal (toEqual, no tolerance) to analyticRpPmf on the same moments, pRedWin and 2026 rule module
    - allianceKey gives the same key for all six permutations of one triple, and different keys for different triples
  </behavior>
  <action>
Create `scripts/browserPresimPricing.ts`, a browser-safe module: it imports only from `packages/core/**`, `packages/harness/generatedSchedules.ts`, `packages/harness/sigmaScore.ts` and `packages/harness/rounding.ts`, and never a Node built-in, preSchedule.ts, publish.ts or pageArtifacts.ts (esbuild with platform=browser is the gate). Header comment: measurement only, not wired into the app or the pipeline, seeds copied from preSchedule.ts with line references, parity checked by scripts/measureBrowserPresimPricing.ts. Contents:
- `PresimPricingPayload`, JSON-serializable: eventKey, season, eventType, week, algorithmVersion, matchesPerTeam, roster (sorted string array), spr `{ logTau, scale, teams: record teamKey to [muL, pL, muS, pS] }` for roster teams present in the state, sigma record teamKey to number (the rookie-rule Sigma), rp `{ beliefs: record teamKey to RpTeamBeliefs, population }` for roster teams, meanShift (RpMeanShiftState or null).
- `buildPresimPricer(payload)`: rebuilds an SprState from `spr.initState([])` with the payload's teams Map, logTau and scale; the accumulator via `RpMomentsAccumulator.fromBeliefs(rule, beliefs, { population })` (the RP cold prior is on in production, so always pass the third argument); the mean shift via `RpMeanShiftAccumulator.fromState`; sigma as a Map. Exposes `priceUncached(upcoming)` that reproduces publish.ts's predict-then-`makeRankingPointFiller` composition by calling `analyticRpPmf` on the per-alliance moments (so the uncached arm uses the production entry point), and `priceCached(upcoming)` that calls `spr.predict` per match, then looks up or computes per-alliance pieces keyed by `allianceKey(teams)` (sorted triple joined by a separator) holding `{ scoreMean, scoreVariance, bonusPmf, bonusProbabilities }` from the band variance, `momentsFor`, `meanShift.apply` and `allianceBonusRpPmf`, then runs the match-level `combineMatch`. Both return rounded `{ rp, bp }` through `roundPmf`. Counters: pricing calls, alliance slots, cache misses, unique alliances.
- `combineMatch(red, blue, pRedWin, ruleModule)` (exported for the test): `matchOutcomeDistribution`, the five-line outcome pmf copied from analyticPmf.ts's private `allianceOutcomePmf`, `convolvePmf`, and the same normalization and `maxRp + 1` length checks `analyticRpPmf` makes.
- `runPresim(payload, { scheduleCount, drawsPerSchedule, cache, chunkSize, checkpoints, maxWallMs })`: processes schedules in chunks of `chunkSize` (default 50): generate the chunk's structures and shuffles and synthetic matches, then price the chunk, then draw the chunk into roster-by-roster rank totals, timing each phase per chunk with `performance.now()` (Chromium coarsens that timer to about 100 microseconds outside cross-origin isolation, so never time single calls). Records `{ count, elapsedMs, generateMs, priceMs, drawMs }` whenever the cumulative count reaches a checkpoint, and stops early once elapsed passes `maxWallMs`, recording `stoppedEarly` and the last count reached. Returns the final totals histograms (number[][], roster order), checkpoints, counters and phase totals.
- `measureComponents(payload, { scheduleCount })`: pre-generates K schedules' synthetic matches, then times three whole loops: SPR predict alone over every match, the alliance-level pieces once per unique alliance, and `combineMatch` over every match given cached pieces. Reports microseconds per call for each.

Create `scripts/browserPresimPricing.test.ts` pinning the two behaviors above. Build the alliance moments from `RpMomentsAccumulator.fromBeliefs` with a small hand-written beliefs map (copy the belief field shape from an existing empiricalMoments test) and the 2026 rule module, so the test needs no corpus.

Create `scripts/measureBrowserPresimPricing.ts`, the Node driver (reads the corpus read-only; no network, no `.env`, no R2 or D1), with `--phase` and `--events`, writing working files under `reports/presim-spike/` (gitignored). This task implements two phases:
- `extract`: event selection is 2026txmca (18 teams) and 2026joh (75 teams) plus the finished RP-eligible 2026 event whose roster is closest to 40 teams (ties to the lowest event key; every qualification match played; roster not refused by `predictFor`, else take the next candidate and log why). The roster follows publish.ts 2477-2493: unique team keys over every played and scheduled match of the event, all comp levels. `matchesPerTeam = matchesPerTeamFor(roster.length, qualMatchCount)`. For each event call `buildDistrictPricingState(db, { season: 2026, warmupSeasons: [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025], asOf: ISO string of the event's earliest played match `sort_time`, algorithm: BASE_PUBLISH_ALGORITHMS.spr, sigmaCarry: true, rpColdPrior: true })`. The warmup list is publish:seasons' own season list (2021 excluded on purpose). Build the payload from `endState`, `ratingsFor(roster)` sigma, `layer.rpAccumulator.beliefsByTeam()` filtered to the roster plus `populationState()`, and `layer.rpMeanShiftState()`. Build the reference with `buildPreScheduleArtifact` (1000 schedules x 50 draws, `pricedFrom: "pre-event-walk-forward"`, generation "measure", computedAt 1970-01-01T00:00:00.000Z, predict from `predictFor(roster)`) and keep its `baked.histograms`, plus the `PublishedPreScheduleArtifactSchema.parse` body's raw, gzip and brotli bytes (node:zlib, default levels). Write `reports/presim-spike/{eventKey}.json` with payload, reference histograms, sidecar bytes, roster size, qual count, matchesPerTeam, asOf and `spr.version`. Log the replay wall time per event.
- `tracer`: for 2026txmca, Node `runPresim` at 1000 x 50 uncached and cached, compare each arm's histograms with the reference; bundle `scripts/browserPresimPricing.ts` with esbuild's JS API (resolve it with createRequire from tsx's own package.json path, never by bare name from the repo root and never via a shell shim) using bundle, minify, format iife, globalName `__presimSpike`, platform browser, target es2022, metafile on; write the bundle to `reports/presim-spike/`. Load Playwright's `chromium` with createRequire anchored at `apps/web/package.json`, typed through a small local interface so root tsc stays clean. Launch headless, new context, `context.route` every URL to abort and count attempts, open `about:blank`, inject the bundle with `addScriptTag({ content })`, set the CDP throttle rate to 1 through `newCDPSession(page)`, run `__presimSpike.runPresim` via `page.evaluate` with the payload, and compare histograms. Print exactly one line `PARITY <eventKey> node-uncached=<identical|DIFF n> node-cached=<...> chromium-1x-cached=<...> network-attempts=<n>` plus the three wall times.

If `chromium.launch` fails with a sandbox or permission error, do not work around it: finish the Node side, and hand back the exact command for the orchestrator to run from the main context. Run every command from the repo root, foreground, with a Bash timeout of 600000 ms, output teed to a log under `reports/presim-spike/`, and judge success by the log's content, never by exit code.

Before anything else, run `mkdir -p reports/presim-spike` and save `git rev-parse HEAD` to `reports/presim-spike/start-sha.txt`; the scope gates below read it. Other sessions share this checkout, so stage by explicit path only (never `git add -A` or `git add .`) and put `260929-mkn` in every commit message. Commit the two scripts and the test at the end of this task.
  </action>
  <verify>
    <automated>npx vitest run scripts/browserPresimPricing.test.ts</automated>
    <automated>mkdir -p reports/presim-spike; npx tsx scripts/measureBrowserPresimPricing.ts --phase extract --events 2026txmca 2>&1 | tee reports/presim-spike/extract-tracer.log; npx tsx scripts/measureBrowserPresimPricing.ts --phase tracer 2>&1 | tee reports/presim-spike/tracer.log; grep -E "^PARITY 2026txmca node-uncached=identical node-cached=identical chromium-1x-cached=identical network-attempts=0" reports/presim-spike/tracer.log</automated>
    <automated>git log --format= --name-only "$(cat reports/presim-spike/start-sha.txt)"..HEAD --grep=260929-mkn | sort -u | grep -v -E "^(scripts/browserPresimPricing(\.test)?\.ts|scripts/measureBrowserPresimPricing\.ts|\.planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/.*)?$" | grep -c .  # must print 0</automated>
  </verify>
  <done>The vitest file passes. The tracer log carries a PARITY line for 2026txmca with all three arms identical to the Node bake and zero network attempts, or the executor has stopped and reported the exact DIFF counts (a DIFF in the cached arm is a finding for Task 3, not a reason to change the key). This task's commit touches only the two scripts and the test.</done>
</task>

<task type="auto">
  <name>Task 2: Expand to three events: the Q1 cost matrix, Q2 bytes, Q3 progressive time to stable table, all in Node and in Chromium at 1x/4x/6x</name>
  <files>scripts/measureBrowserPresimPricing.ts, scripts/browserPresimPricing.ts, .planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-results.json</files>
  <read_first>docs/models/rung2-generated-schedules.md lines 37-67</read_first>
  <action>
Add three phases to the driver, then run everything.

`node` phase, per event: parity at 1000 x 50 for both arms against the extract reference (reuse Task 1's comparison, now reporting matches whose rounded pmfs differ between arms and histogram cells that differ); P1 at K=200 with U,C,U,C,U,C interleaving (per-call microseconds per arm and per-rep ratio); both arms once each at K=1000 for the direct per-event pricing total; `measureComponents` at K=200; and a progressive cached run to 4000 with checkpoints 150, 300, 1000, 2000, 4000 and `maxWallMs` 240000.

`browser` phase with `--throttle 1|4|6` and `--events`: one browser per invocation, the same abort-all route and network-attempt counter as the tracer, the bundle built once and reused. At every rate: P1 at K=200 interleaved as in Node, and the progressive cached run to 4000 with the same checkpoints and a 240000 ms cap. At rate 1 only: parity at 1000 for both arms, both arms once at K=1000, and `measureComponents`. The throttle rate is set before any timing and read back into the result. Run on the page main thread, where CDP throttling applies; the findings note that production would run in a Web Worker and that this spike did not measure worker throttling. Record the Chromium version (`browser.version()`), Node version and `os.cpus()[0].model` into the result.

Also in `browser` (rate 1): bundle bytes (minified raw, gzip, brotli) and the metafile's five largest inputs by bytes. In `node`: the payload's raw, gzip and brotli bytes per event, beside the extract phase's sidecar body bytes, and the bytes of 1000 encoded pairing structures for that event's shape (six bytes per match, raw and gzip), which is the payload cost of shipping structures instead of generating them.

`summarize` phase: merge every working file into `.planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-results.json` with top-level keys `host`, `events` (one object per event with fields `eventKey`, `rosterSize`, `quals`, `matchesPerTeam`, `asOf`, `sprVersion`, `replaySeconds`), `parity`, `q1`, `components`, `q2`, `q3`. Numbers only: no payload bodies, no histograms, no team keys beyond the event list. For uncached per-event totals at 4x and 6x, which are not run at K=1000, write the K=200 figure times five and mark the field `extrapolated: true`; the cached arm's per-event total at every rate is the progressive run's 1000 checkpoint, measured.

Run order, each a separate foreground command from the repo root with a 600000 ms Bash timeout and output teed to `reports/presim-spike/`: `--phase extract` for the remaining two events, `--phase node`, then `--phase browser --throttle 1`, `--throttle 4`, `--throttle 6`, splitting by `--events` whenever one command could run past nine minutes (the 75-team event at 6x on its own). Rerun the 75-team event's 1x progressive browser run a second time and keep both, so one Q3 cell shows its own run-to-run spread. If a run hits the 240 s cap, keep the last reached count; do not raise the cap to force 4000. Finish with `--phase summarize`. Commit the updated scripts and the results JSON by explicit path, with `260929-mkn` in the message; never `git add -A`.
  </action>
  <verify>
    <automated>node -e "const r=JSON.parse(require('fs').readFileSync('.planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-results.json','utf8'));const miss=['host','events','parity','q1','components','q2','q3'].filter(k=>!(k in r));if(miss.length||r.events.length!==3){console.log('FAIL',miss,r.events&&r.events.length);process.exit(1)}console.log('OK events',r.events.map(e=>e.eventKey+':'+e.rosterSize).join(' '))"</automated>
    <automated>npx vitest run scripts/browserPresimPricing.test.ts</automated>
    <automated>npx tsc --noEmit 2>&1 | grep -E "scripts/(browserPresimPricing|measureBrowserPresimPricing)" | wc -l  # must print 0</automated>
  </verify>
  <done>The results JSON holds three events (about 18, 40 and 75 teams) with parity per arm and engine, P1 per-call microseconds and within-run ratios for every event x engine x throttle cell, component micro-loop costs, payload, sidecar, structure and bundle bytes, and Q3 checkpoint times with the generate/price/draw split at 1x, 4x and 6x, every extrapolated field flagged. Every browser run reported zero network attempts. No new root tsc errors in the two scripts. The scripts, test and results JSON are committed.</done>
</task>

<task type="auto">
  <name>Task 3: Write the findings and the recommendation under the pre-registered frame</name>
  <files>.planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-FINDINGS.md</files>
  <read_first>.planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-results.json</read_first>
  <action>
Write `260929-mkn-FINDINGS.md` from the results JSON alone, in a plain, flat tone. State what each number is and at what schedule count, and label every extrapolation and every single-run cell as such. Sections, in order:
1. Answer: go, no-go or go-with-conditions, in two or three sentences, with the schedule count and progressive-render plan.
2. What was measured on: the three events (roster, quals, matches per team), the state (spr version, pre-event walk-forward reconstructed by `buildDistrictPricingState` cut at the event's first played match over 2016-2020 and 2022-2025 with the Sigma carry and the RP cold prior on; equivalent to the publisher's pre-event snapshot up to matches sharing that exact timestamp; not read from R2), the host CPU, the Node and Chromium versions, and the throttle meaning from the pre-registration.
3. Factoring: which pieces are alliance-level and which match-level, from the code and confirmed by parity, with the component costs; say plainly that SPR predict was not cached because `viewOfMap` is not exported, and bound its possible saving by its own measured per-call cost (labelled as a bound).
4. Q1 tables: per-call microseconds per arm and the P1 median ratio with range, Node and Chromium 1x/4x/6x; per-event totals at 1000, measured or flagged extrapolated; cache hit rate and unique alliances against C(N,3).
5. Q2 table: payload raw, gzip and brotli per event beside the same event's rebuilt sidecar and the 2026-09-29 run's median 7,145 B / p95 15,983 B / max 23,806 B (raw); the bundle's minified, gzip and brotli bytes and its largest inputs; the shipped-structures bytes.
6. Q3 table: time to 150, 300, 1000, 2000 and 4000 schedules per event and throttle with the generate/price/draw split, beside the rung-2 binding floor per count (clause 1 pooled: 150 50.0%, 300 62.7%, 1000 81.1% with worst team 1.17 ranks, 2000 91.8%, 4000 98.4%; n=20's 27.0% and worst team 10.61 as the old shipped reference). If generation is a large share, give the derived price-plus-draw time as what shipping structures would leave (derived from the split, labelled).
7. Parity: per arm and engine, identical or the exact DIFF counts, and what a DIFF would mean (an output change that ships under a new spr version).
8. Recommendation: apply P2 then P3 exactly as pre-registered, naming the band each throttle landed in, then the concrete plan: first rendered count, refinement checkpoints, stopping count, and whether today's baked sidecar should stay as zero-compute first paint.
9. Not measured: worker-thread throttling, real phone hardware, events above 76 teams, cold JIT on first load beyond what the first chunk shows, and anything the cap cut short.

Do not edit `docs/simulation-architecture.md`, the closed todo, STATE.md or ROADMAP.md. Write the file with the Write tool. If Write is blocked for this path, do not fall back to a heredoc: return the full findings text in the handback for the orchestrator to write. Return the SUMMARY text in the handback as well; the orchestrator writes SUMMARY.md. Commit FINDINGS.md by explicit path if it was written.
  </action>
  <verify>
    <automated>f=.planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-FINDINGS.md; test -f "$f" && grep -cE "^## " "$f" && grep -ciE "go-with-conditions|no-go|\bgo\b" "$f" && grep -ci "extrapolat" "$f"</automated>
    <automated>git log --format= --name-only "$(cat reports/presim-spike/start-sha.txt)"..HEAD --grep=260929-mkn | sort -u | grep -v -E "^(scripts/browserPresimPricing(\.test)?\.ts|scripts/measureBrowserPresimPricing\.ts|\.planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/.*)?$" | grep -c .  # must print 0</automated>
  </verify>
  <done>FINDINGS.md exists with the nine sections, a verdict under the pre-registered P2 and P3 frame, a concrete schedule count and progressive plan, every extrapolation labelled, and no edits to docs/, the closed todo, STATE.md or ROADMAP.md. Or, if Write was blocked, the full text is in the handback.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| local corpus to driver | `data/corpus.sqlite` opened read-only; nothing is written back |
| driver to Chromium page | A locally built bundle injected into `about:blank`; the page must never reach the network |
| repo to transcript | `.env` holds live credentials and is never needed by this task |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-mkn-01 | Information disclosure | `.env` | high | mitigate | No step reads, sources or prints `.env`; the driver uses no environment variable and no credential (CLAUDE.md secrets rules) |
| T-mkn-02 | Tampering | production artifacts (R2, D1, deploy) | high | mitigate | No publish, deploy, R2 or D1 call exists in either script; the only writes are `reports/presim-spike/` (gitignored) and the two files in the quick dir |
| T-mkn-03 | Information disclosure | Chromium page network | medium | mitigate | `context.route` aborts every request and counts attempts; the tracer and every browser run must report `network-attempts=0`; the page only ever opens `about:blank` |
| T-mkn-04 | Tampering | pipeline and app code | medium | mitigate | Nothing under `packages/`, `apps/`, `docs/` or `.planning/todos/` is edited; commits stage by explicit path, and the Task 1 and Task 3 gates list every file the `260929-mkn` commits touched since `start-sha.txt` and require it to be one of the five planned files |
| T-mkn-SC | Tampering | package installs | low | accept | No package is installed; esbuild and Playwright resolve from existing installs through createRequire |
</threat_model>

<verification>
- `npx vitest run scripts/browserPresimPricing.test.ts` passes.
- The tracer log's PARITY line for 2026txmca, and the results JSON's `parity` block for all three events.
- Every browser run records zero network attempts.
- The `260929-mkn` commits since `reports/presim-spike/start-sha.txt` touch only the five files in `files_modified` (other sessions' commits in the same checkout are not counted).
</verification>

<success_criteria>
- The three questions each have measured numbers in the results JSON and a table in FINDINGS.md.
- The factoring question is answered from the code and confirmed by parity.
- The recommendation follows P2 and P3 as pre-registered, with a schedule count and a progressive-render plan.
- Nothing was published, deployed or uploaded, and no network was used.
</success_criteria>

<output>
Return the SUMMARY text in the handback; the orchestrator writes
`.planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-SUMMARY.md`.
</output>
