---
phase: 10
slug: district-points-ledger
mode: chunked-outline
granularity: coarse
tracer_mode: true
created: 2026-09-25
plan_count: 9
requirements: [SC-1, SC-2, SC-3, SC-4, SC-5, SC-6, SC-7]
---

# Phase 10 — Plan Outline

Nine plans in five waves. Every plan LEADS with one production-quality end-to-end tracer slice
that is verified before any expansion task (`TRACER_MODE: true`). The last plan is the only
`autonomous: false` one: executor subagents have no network, so deploy, republish, push, CI watch
and the live e2e run are orchestrator-run checkpoint tasks at the end of the phase.

| Plan ID | Objective | Wave | Depends On | Requirements |
|---|---|---|---|---|
| 10-01 | Core district point formulas in `packages/core/districts`: the corpus reconciliation test FIRST (Wave 0), then `qualPoints.ts` (erfinv, Winitzki), `selectionPoints.ts` (captain and first pick `17 - allianceNumber`, second pick `allianceNumber`, fourth robot 0), `bracket.ts` (the verified 13-match 8-alliance double elimination routing and its 0/0/7/13/20/30 exit points) and the non-eight-alliance empirical fallback playoff table; plus the additive per-draw `onDraw` hook on `simulateRanks` that leaves its two existing callers and their regression oracle untouched | 1 | — | SC-2, SC-6 |
| 10-02 | Measured before it ships: the walk-forward award base-rate tables by decoration bucket crossed with rookie status (script, leak test, season-registered table module), the selection model's pick-order agreement measured against `event_alliances`, and the NEW browser alliance win-probability function measured against the harness's own `pRedWin` with the honest gap recorded. Owns every new root `package.json` script entry for this phase | 1 | — | SC-2, SC-6 |
| 10-03 | The district artifact and manifest contract: four per-team-per-event state booleans on `DistrictTeamEventPointsSchema`, the baked-pmf shape with inline-vs-sidecar decided by MEASURED bytes for `2026pnw`, the award-table placement, `districtKey` on `LiveWindowEntrySchema` populated by the offline manifest writer, a district payload-budget line, and the single shared pure `applyDistrictRankings` producer both writers will call | 1 | — | SC-1, SC-5 |
| 10-04 | The joint district ledger simulation in `packages/core/districts`: one run yields correlated (qual, selection, playoff) per team via the `onDraw` hook, captains are the top eight, picks are greedy by SPR, the bracket is priced by the new win-probability function, the event total is the per-run sum, the grand total is the exact convolution of two event totals plus rookie bonus and adjustments, and every histogram is a marginal of the same runs | 2 | 10-01, 10-02 | SC-2 |
| 10-05 | The Worker district refresh pass: derive district liveness from member-event live windows, one ETag conditional `/district/{key}/rankings` request per live district per tick, one `/event/{key}/awards` request per live event once playoffs are done, merge into the artifact read back from R2 through the shared producer, recompute `locks.ts` verdicts, write with the secret-leak check and per-district try/catch isolation, never simulate | 2 | 10-03 | SC-1 |
| 10-06 | The offline publisher: `scripts/publishDistricts.ts` emits the four state booleans, the baked per-team-per-event category and event-total pmfs for unstarted events, and the season award base-rate tables, all through the same shared producer; measured serialized bytes recorded against the new budget line | 3 | 10-02, 10-03, 10-04 | SC-5, SC-6 |
| 10-07 | The web tab: the district simulation Web Worker triad (entry, protocol, factory) following the shipped lifecycle, and the Road to District Champs ledger replacing `DistrictLocksTab` — two rows per team, grey final cells and blue open cells, the five status chips as filters with counts, the drawer histograms on sketch 005 continuous edges, the Rewind to slider stepping by match across the interleaved timeline, median-grand-total sorting, team search, stat line, the 60 s live poll and lazy per-event artifact loading, search params, component tests | 3 | 10-03, 10-04 | SC-2, SC-3, SC-4, SC-5 |
| 10-08 | The words and the proof: methodology copy for the award base rates, the selection agreement and the win-probability gap in the content-as-data voice with its runtime voice test, docs updates (`docs/worker-operations.md`, the simulation architecture doc, `docs/publish-budget.md`), and the live e2e spec covering the new tab at desktop and 390px | 4 | 10-02, 10-05, 10-06, 10-07 | SC-6, SC-7 |
| 10-09 | Operator gates (`autonomous: false`, every task a checkpoint): repo-root `npx vitest run` green and both tsconfigs clean, then `npx wrangler deploy` of the Worker from a clean tree, THEN the district republish, then the push, then `gh run list`, then the live e2e spec against the deployed site | 5 | 10-08 | SC-7 |

## Notes for per-plan planners

### Binding, every plan

- **Read first, always:** `10-CONTEXT.md` (all of it; the "Corrections from research" block is
  binding and overrides the sketch README), `.claude/CLAUDE.md`, and
  `Skill("sketch-findings-sigmascout")` for any plan that renders pixels.
- **Never `Read` or `cat` `.env`.** Scripts that need a key use `tsx --env-file=.env`; the
  measurement scripts in 10-02 read `data/corpus.sqlite` read-only and need no key at all.
- **Tests run from the repo root** with `npx vitest run <path>`; never `timeout <n> pnpm ...`
  (it swallows output and exits 0), never from `apps/web` alone (77 files there, 167 at root).
- **Corpus-backed tests use the `existsSync` guard** and an explicit `it.skip` message, exactly as
  `packages/core/districts/reconciliation.test.ts:15-21,50` does — `data/corpus.sqlite` is
  gitignored and CI will not have it (RESEARCH Assumption A5).
- **Additive artifact fields do not bump `PAGE_ARTIFACT_SCHEMA_VERSION`**; changed published
  numbers ship under a new algorithm version. Zod schemas are the executable spec of every field.
- **Every colour is a token**; no literal hex in component code. The red Locked out chip is a
  status colour, not a series — run the dataviz palette validator before adding a palette entry.
- **Never print `±`** anywhere on this tab, and never render a partial variance.
- Executor subagents have NO network: no publish, no TBA fetch, no `wrangler deploy`, no
  `git push`. Anything networked belongs in 10-09.
- A `|` in a STATE.md quick-task description breaks the append helper; keep pipes out.

### Which research sections each plan must read

| Plan | RESEARCH.md sections | PATTERNS.md sections | Other |
|---|---|---|---|
| 10-01 | Summary; Pitfall 2 and Pitfall 5; Code Examples 1 to 5; Open Question 1; Sources "Verified via direct corpus query" | `ledgerSimulation.ts` (PRNG reuse, validation-before-loop), `pointModel.ts`/`locks.ts` reference-only row, Shared Pattern "Honest null / never-guess" | VALIDATION.md Wave 0 row for `pointFormulas.reconciliation.test.ts`; CONTEXT "Alliance selection and captains" |
| 10-02 | Section on the browser win-probability gap (the "Corrections from research" item), Pitfall 1, Anti-Pattern "Rebuilding an alliance win-probability band", Assumption A4, Package Legitimacy Audit (reuse `spr.ts`'s `erf`/`normCdf`, add no dependency) | `scripts/measureAwardBaseRates.ts` row (walk-forward leak boundary, credential-free discipline, bucket definition, output-table discipline), Shared Pattern "Walk-forward / no-lookahead" | CONTEXT "Awards (Jacob): base rates by decoration bucket"; `scripts/measureAwardPredictability.ts` and its test as the exact analog |
| 10-03 | Architectural Responsibility Map; Pattern 2 (`districtDetailKey` bypasses `PageKind` — do NOT widen it); Pitfall 3 and Pitfall 6; Open Questions 2 and 3; Security Domain (the `ArtifactSecretLeakError` row) | `pageArtifacts.ts` schema-additions row (additive-no-bump discipline, booleans-not-derived-client-side, sidecar-vs-inline by measured bytes), Shared Pattern "Schema-version discipline" | CONTEXT "The four state facts, sourced"; `docs/publish-budget.md` |
| 10-04 | Summary; Pitfall 2; Code Examples 1 and 5; the "Why one joint draw" reasoning in the sketch README; Assumption A2 | `ledgerSimulation.ts` row in full (module header discipline, PRNG reuse, validation-before-loop, structured-clone result shape, accumulator-outside-loop) | CONTEXT "What the page computes where"; `rankSimulation.ts` read in full before writing |
| 10-05 | Section 2 / the Worker gap (PageKind exclusion, no corpus access); Pitfalls 3 and 4; Open Questions 2 and 3; Pattern 2; Security Domain (all three rows) | `apps/worker/src/scheduled.ts` row (ETag conditional pattern, `liveWindows.ts` gating, `artifactWriter.ts` incremental write) | CONTEXT "Freshness" and "District liveness for the Worker"; `docs/worker-operations.md` |
| 10-06 | Architectural Responsibility Map (baked pmfs row); Pitfall 6; Assumption A5 | `packages/harness/publish.ts` district-builder row; Shared Pattern "Walk-forward / no-lookahead" | CONTEXT "Pipeline (publish time)"; `packages/harness/preSchedule.ts` as the offline-bake precedent |
| 10-07 | Pattern 3 (`simulationInputs.ts` pure-assembly with disclosed gaps); Pattern 4 (Web Worker lifecycle, the `"WebWorker"` lib conflict, the load-bearing inline `new URL(...)`); Don't Hand-Roll table in full | `DistrictLedger.tsx` row, the three worker-file rows, `districtLedger.ts` API row, Shared Patterns "Zero-conversion structured-clone" and "Token-only colour" | 10-UI-SPEC.md in full — lift its `## UI Considerations` table verbatim into `must_haves.truths`; sketch 021 README; `RankDistributionTable.tsx` and `rankRows.ts` (`continuousQuantile`) |
| 10-08 | Sources and the confidence breakdown (every stated number must trace to a committed script) | `districtLedgerContent.ts` row (content-as-data, runtime voice gate over exported string VALUES) | `feedback_methodology_copy_voice` (flat third person, zero dash characters); `awardsContent.ts` + `awardsContent.test.ts` as the exact analog; memory `project_e2e_live_only_drift` |
| 10-09 | Section 10 / SC-7 row | — | CONTEXT "Process rules that apply"; memory `project_worker_deploy_and_tail`, `project_subagent_network_block`, `project_ci_red_after_local_green`, `project_rebaseline_one_command` |

### The shared pure producer for the district artifact (decided)

The district artifact currently has one producer (`scripts/publishDistricts.ts`). This phase adds
a second (the Worker's rankings merge). **Decision: one shared pure function, not two writers.**

- 10-03 creates `packages/harness/districtRankingsMerge.ts` exporting a pure
  `applyDistrictRankings(artifact, rankings)` (zero I/O, no `better-sqlite3`, no corpus import, so
  the Worker can bundle it) that takes a parsed `DistrictArtifact` plus TBA-shaped rankings and
  returns the updated artifact with the four state booleans, per-event `eventPoints`, totals,
  rookie bonus and adjustments applied, and the `locks.ts` verdicts recomputed.
- 10-05 (Worker) and 10-06 (publisher) both call it. Neither reimplements the merge.
- The Worker NEVER calls `buildDistrictArtifact` — it has no corpus. It reads the published
  artifact from R2, applies the merge, carries `remainingEvents`, `teamMeta` and `qualifyingAwards`
  forward, and trims `remainingEvents` of any event that now has an `eventPoints` entry
  (RESEARCH Pitfall 3).

### Assumption-delta decision

<assumption_delta_decision>
**Noun:** the district artifact producer (`v1/district/{key}.json`).
**Decision:** promote.
**Rationale:** the artifact goes from one producer (the offline publisher) to two (publisher plus
the Worker's rankings merge). Adding the Worker alongside the existing publisher would leave two
independent implementations of the same shape, which is exactly the drift the schema-as-spec rule
exists to prevent. Promoting means one shared pure `applyDistrictRankings` in `packages/harness`
becomes THE producer of the merged shape; the publisher and the Worker are both callers. One
schema, one merge, one `locks.ts` recompute, testable without R2 or a corpus.
</assumption_delta_decision>

### Decisions already settled — do not reopen

- **Second-pick points are `allianceNumber` itself, never `9 - allianceNumber`.** The latter
  scored 0 of 969 corpus rows. CONTEXT's "Corrections from research" block supersedes its own
  earlier prose (RESEARCH Pitfall 5).
- **The browser prices nothing today.** The embedded state block was deleted 2026-09-23. The
  alliance win-probability function is net-new, built from the event artifact's published per-team
  SPR total mean and Sigma Score with the rank simulation's own uncorrected `Σ Sigma²` spread
  form — never the display band. Its gap against the real `pRedWin` is measured in 10-02 and
  stated on the methodology page in 10-08. Any task phrased "call the existing alliance pricer"
  is wrong (RESEARCH Pitfall 1).
- **`simulateRanks` is extended, never forked.** Its two existing callers and their measured
  rewind-overconfidence oracle must stay byte-identical; the hook is an optional parameter called
  at the existing per-draw `order` site (RESEARCH Code Example 1, Anti-Patterns).
- **`PageKind` stays closed.** District keys already bypass it by design; the Worker gets its own
  district writer mirroring `writeArtifactObject`'s body including the secret-leak check
  (RESEARCH Pattern 2, Security Domain).
- **Non-eight-alliance events get the published empirical fallback pmf**, never a fabricated
  bracket (CONTEXT; RESEARCH Open Question 1 and Assumption A2). 10-01 builds that table from the
  corpus with its own pinned test.
- **District liveness = any member event has a live window** (CONTEXT correction; RESEARCH Open
  Question 3).
- **Awards posted is sourced from a Worker `/event/{key}/awards` fetch once playoffs are done**,
  not inferred from `award_points` appearing (CONTEXT correction, which resolves RESEARCH
  Assumption A3 in favour of fetching).
- **No award prediction ever feeds `locks.ts`.** A Locked verdict stays a guarantee.

### Sequencing hazards for 10-09

Order is load-bearing and must appear as separate checkpoint tasks in this order: full suite and
both tsconfigs green → `npx wrangler deploy` (clean tree; Jacob grants the deploy in-message; a
dirty tree means deploying from a clean detached worktree at the verified SHA) → district
republish → `git push` (check `origin/main..main` first, another session's commits may be
sitting there) → `gh run list` → the live e2e spec. Deploying after the republish would serve a
schema the Worker cannot merge.

## OUTLINE COMPLETE
