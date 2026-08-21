# Phase 4: Publish & Live Update Pipeline - Context

**Gathered:** 2026-08-21
**Status:** Ready for planning — **blocked on Phase 3.2 (see D-09)**

<domain>
## Phase Boundary

Everything Phases 1–3 compute currently lives on one machine, in gitignored `data/` and `reports/`. This phase turns that compute into *published data*: compact, versioned JSON artifacts in Cloudflare R2 covering every page the site will render, plus a Cron Trigger Worker that keeps them fresh within ~1–3 minutes during live events, all inside free-tier limits.

**In scope:**
- Offline full-season precompute publishing page-shaped artifacts for 2022–2026 (DATA-03)
- The incremental Cloudflare Worker update path: TBA polling, per-team state advance, artifact writes (DATA-04)
- Live state storage and the offline→online state handoff
- The read/serving path artifacts are fetched through
- Measured budgets: payload size, Worker CPU, R2/KV write volume, TBA request counts (DATA-05)
- The replay rig that proves both freshness and offline/online equivalence

**Explicitly OUT of scope** (named so the planner does not drift):
- Any React/UI work — Phases 5–8 own every page. This phase publishes the data those pages read, and nothing that renders it.
- The 1000-run rank simulation itself — Phase 8. This phase publishes only the *parameters* it consumes (see D-08).
- Changing Sigma1 or EPA in any way. 03-CONTEXT D-04 freezes EPA; Sigma1 ships as the promoted `sigma1@2.0.0+tuned-2026-08`.
- The OPR baseline swap itself — that is Phase 3.2's job (D-09). Phase 4 *consumes* its output.

</domain>

<decisions>
## Implementation Decisions

### Measurements taken during discussion (bind the planner — do not re-derive)

Measured against the live 104,925-match corpus at HEAD on 2026-08-21:

| Fact | Value |
|---|---|
| Teams competing per season | 3,150 (2022) → 3,787 (2025) → 3,748 (2026) |
| Events per season | 288–350 |
| Matches per season | 18,215 (2022) – 23,884 (2025) |
| Matches per team per season | avg 32.5–37.8, **max 292** |
| **Peak concurrent events** | **38** (Sat 2026-03-21) |
| **Peak global match throughput** | **~3.5 matches/min** (207 in the busiest hour) |
| Busiest single day | 1,562 matches across 35 concurrent events |
| Sigma1 components per season | 6 (2022), 9 (2023), 13 (2024), 7 (2025), 11 (2026) |
| Sigma1 per-team state | ~2 KB JSON → **~7.5 MB per season** across 3,750 teams |
| OPR `IncrementalInverse` at 3,750 teams | capacity 4096 → **4096² × 8 B = 134 MB**; rank-1 update O(N²) ≈ 16.8M ops/match |
| Corpus on disk | 336 MB (`data/corpus.sqlite`, gitignored) |
| `reports/` on disk | 3.5 GB (gitignored) |
| Algorithms in `ALGORITHMS` registry today | 7 |
| Next live offseason events | `2026azscor` (2026-08-28), `2026scsc` (2026-08-29); 99 more historically in September |

Consequences the planner must honor:
- **OPR's season-pooled state exceeds a Cloudflare Worker's 128 MB isolate limit outright.** This is a shape problem, not a tuning problem — it is what forced D-09.
- **Sigma1's full-season state cannot be loaded per tick** (a 7.5 MB `JSON.parse` is tens of ms against a 10 ms CPU budget), but the ~21 team states a typical tick touches (~42 KB) can. Per-team granular reads are therefore a hard requirement, not a preference (D-13).
- **Per-tick compute is trivial**; at ~3.5 matches/min a 1-minute tick folds ~3–4 results. The pressure is artifact serialization and subrequest count, not model math.

### Artifact shape & publishing layout

- **D-01:** The unit of a published artifact is **one file per page the site renders** — `teams/{year}`, `team/{teamKey}/{year}`, `events/{year}`, `event/{eventKey}`, `compare/{year}`. One page render = one fetch. Chosen directly against the project's stated top UX priority (page load speed). Rejected: an event-centric layout where team pages stitch 2–6 event files (fewer objects, but multiplies fetches on the page users visit most); rejected: splitting lists into a slim search index (revisit in Phase 5 if the search box proves slow on the full table). — **Reversibility:** costly — Phases 5–8 fetch these paths, and changing the layout after publication means republishing every artifact and rewriting every client fetch.
- **D-02:** **Algorithm version rides in the path**, one file per `(page, year, algorithm@version)`. First paint downloads only the selected algorithm; switching the dropdown is a second, CDN-cached fetch. Rejected: one file carrying all algorithms inline — with a 7-entry registry that is a multiplied payload tax on first paint to display one algorithm. This is 03-CONTEXT D-13's version identity cashing out as a storage property, exactly as D-13 anticipated. — **Reversibility:** one-way — 03 D-13 already rated version identity one-way for this reason; the Phase 5 dropdown and Phase 8 Compare page both key on these paths.
- **D-03:** The **published set is the shipped set only**: event-scoped OPR (per D-09), EPA, and the promoted Sigma1 version. The three Phase 2 link-mode variants (`sigma1-seasonsd`, `sigma1-normalcdf`, `sigma1-defaults`) and `sigma1-adapt` stay harness-only. Rejected: publishing all 7 registry entries — it multiplies write volume and puts Phase 2 experiments in a user-facing dropdown they were never meant to reach.
- **D-04:** Artifacts live at **stable paths, overwritten in place, each carrying a `generation` / `computedAt` stamp inside**. A reader may see a fresh event file beside a slightly older teams table; that skew is *accepted and visible* rather than hidden, because each artifact is independently self-consistent. Rejected: immutable content-versioned paths plus a pointer — the pointer must be rewritten every publish, and at 1-minute cadence that is 1,440 writes/day against KV's 1,000/day free cap, so the pointer could not live in KV without widening the cron interval. Rejected: no stamp at all — a wrong number on screen with no way to explain itself is the failure shape this project's log already records.
- **D-05:** SC-1's payload budget is a **committed budget file plus a failing test** that measures real published artifacts. Follows the project's established make-a-misreading-fail-a-test discipline (03 D-12, 03.1 D-16) — a payload regression surfaces on the commit that causes it. The two artifacts most at risk are the year-wide teams table and the 292-match team page; the budget must name them explicitly.
- **D-06:** Published artifacts are **rounded at publish to display-relevant precision**, and the rounding rule is written down. Unrounded values remain in the harness artifacts, which is where reproducibility lives — so 03 D-16's bitwise digests are untouched by this. Roughly a 3× payload saving on metric-heavy files for digits no page displays. The planner picks the per-field precision; probabilities and RP distributions warrant more digits than display metrics because Phase 8 draws from them.
- **D-07:** A **team-season file carries everything the team page renders**: season stats, per-event sections, every match's prediction (winner, confidence, scores, RP ± variance) versus actual, and the metric-history series. The 292-match outlier is the D-05 budget test's problem to police, not a reason to split 3,750 files into two shapes.
- **D-08:** **Phase 4 publishes scheduled-match simulation parameters** — per-match win probability *and* the full RP pmf for not-yet-played matches — not Phase 8. SC-1 requires artifacts covering every page the site will render, and the predict-before-update path already produces these every tick. **Direct consequence the planner must confront:** 03-CONTEXT D-11 flagged the RP joint model's Monte Carlo as needing a check against the 10 ms Worker budget, and this decision puts it squarely on the cron path. That measurement happens in this phase. D-11's own note that deterministic numerical integration would satisfy 03 D-16 trivially *and* remove the Monte Carlo cost remains open to the planner.

### Baselines — OPR becomes event-scoped (requires Phase 3.2)

- **D-09:** **Season-pooled ridge OPR is retired as the project's baseline. OPR means event-scoped OPR everywhere** — harness, artifacts, and site alike — matching what TBA and Statbotics publish and what the FRC community understands by the term. This is a user decision made with the tradeoff stated explicitly (see D-11). It also dissolves this phase's hardest constraint: N drops from 3,750 to ~60, state from 134 MB to ~32 KB, the update from 16.8M ops to ~4,000. — **Reversibility:** one-way — it invalidates every published OPR figure and the SC-3 comparison built on them (03 D-04 rated this `costly` in the other direction); reverting means a second full 2022–2026 re-run and a second re-issue of every affected document.
- **D-10:** The swap is sequenced as an **inserted Phase 3.2, executed before Phase 4 plans**. Phase 3.2 changes OPR to event-scoped, re-runs the full 2022–2026 harness, and re-issues every affected figure in `docs/models/`, the Phase 1–3 SUMMARYs, and `PROJECT.md`. Phase 4 then publishes numbers that are already correct. Rejected: doing it as Phase 4's first plan — Phase 4's success criteria say nothing about baselines, so a change to the project's headline comparison would land with no criterion verifying it. Rejected: publishing event-OPR now and re-running later — that puts season-pooled accuracy figures on the Compare page for an OPR the rest of the site no longer computes, which is the two-things-under-one-name drift 03 D-04 exists to prevent.
- **D-11:** The **season-pooled results are kept as recorded history, not deleted**. `docs/models/` records them as "the baseline this project used through Phase 3, and what Sigma1 measured against then," with the switch and its rationale alongside. **This is not optional bookkeeping.** Season-pooled OPR sees every match a team played all season; event OPR sees only that event's handful — so event OPR is a *weaker* baseline, and Sigma1 currently **loses** holdout winner accuracy to season-pooled OPR on both holdout seasons (2025: 0.7539 vs 0.7618; 2026: 0.7819 vs 0.7825). A Sigma1 win against the new baseline must not be mistakable for the goalpost move 03-CONTEXT D-02 explicitly forbade. The record showing both numbers and the reason is what keeps that claim honest. Expect event OPR to be noisy early in an event, where 40 teams and few matches leave the design matrix badly rank-deficient; the existing ridge term is what keeps it finite.

  > **Dated errata (2026-08-21, Phase 3.2 plan 06, per 03.2-CONTEXT D-17).** D-11's cited figures
  > above are misattributed and its closing sentence about the ridge term is now stale. Both are
  > corrected here, in place, rather than silently edited — D-11's original text is left unchanged
  > above.
  >
  > **1. The misattribution.** The cited 2025: `0.7539` and 2026: `0.7819` are the **untuned**
  > Sigma1 rows (`sigma1-defaults`) from `docs/models/sigma1-tuning-results.md`'s Phase-2
  > starting-position table (lines 129-141), not the promoted, tuned Sigma1 this project ships. The
  > **promoted** Sigma1 (`sigma1@2.0.0+tuned-2026-08`) scored **0.7657** (2025) and **0.7873**
  > (2026) against season-pooled OPR's **0.7618** and **0.7825** — and **won both** holdout winner-
  > accuracy comparisons. `sigma1-tuning-results.md`'s `## SC-3 Verdict` (lines 151-160) records
  > this as **8/8 PASS**, not a loss.
  >
  > **2. Why the correction strengthens D-11's argument rather than weakening it.** D-11's point is
  > that a Sigma1 win against a weaker new baseline (event-scoped OPR) must not be mistakable for
  > the goalpost move 03-CONTEXT D-02 forbids. That risk is *higher*, not lower, when Sigma1 was
  > already winning against the harder baseline (season-pooled OPR) before the swap — a reader has
  > more reason to suspect a widened margin is attributable to the opponent weakening, precisely
  > because Sigma1 did not need a weaker opponent to win in the first place. The corrected premise
  > makes the honesty requirement more load-bearing, not less.
  >
  > **3. The ridge claim.** D-11 closes by saying "the existing ridge term is what keeps it
  > finite." After 03.2-CONTEXT D-06 there is **no ridge term** — it was dropped entirely, and
  > finiteness now comes from a minimum-norm pseudo-inverse solve via SVD (matching TBA's own
  > `np.linalg.pinv`). Rank deficiency in an early event is a well-defined minimum-norm answer, not
  > a divergence risk needing regularization to contain. See `docs/models/opr-baseline-change.md`
  > § "Early-event behavior (SC-5)" for the measured early-event accuracy/rank curve this produces.

### Live state & correctness

- **D-12:** Live state is bootstrapped by an **offline-published state snapshot, with a scheduled re-baseline**. The offline pipeline replays history, publishes both artifacts and a state snapshot, and re-runs on a schedule to overwrite live state. The Worker only loads and advances. Fully automatic at run time; what distinguishes this from the alternatives is that the offline run is the *authority*, so incremental drift gets corrected rather than compounding across a season. Rejected: Worker self-bootstrap — mid-season teams would start from a cold prior instead of their real accumulated rating, and the Worker would own logic the harness never exercises (ARCHITECTURE.md Anti-Pattern 2).
- **D-13:** The state store choice is **deferred to research**, but one requirement is **locked**: the store must support **per-team granular reads**; loading whole-league state per tick is structurally forbidden by the 10 ms budget (see Measurements). Research must resolve, against verified current limits: D1 vs R2-per-object vs a split (bulk in R2, bookkeeping in D1), and the current Durable Objects free-tier story. **Note the standing conflict:** `.claude/CLAUDE.md` states "D1 — deliberately not used in v1", but its stated reason is that nothing needs ad-hoc SQL *from the client* — which is about the read/serving path, not Worker state. If research chooses D1, `CLAUDE.md` must be updated to say so rather than left contradicting the code.
- **D-14:** A **replay equivalence test** proves the live incremental path produces the same numbers the offline harness does: the same historical event is driven through both, and the resulting artifacts are asserted to match. Turns the shared-`packages/core` claim from an architectural assertion into a measured fact — the same shape as 03 D-15's committed-digest CI gate, applied to the publish path. This rig is dual-purpose; D-20 reuses it.
- **D-15:** Whatever polling structure research selects (D-18), **no live event may be systematically starved** — degradation under load must be a bounded delay, never permanent omission. Recorded as a requirement because the naive design fails this silently: Cloudflare's subrequest cap is a hard throw, not a throttle, so a Worker iterating live events in stable order always serves the same front-of-list events and never reaches the tail.

### Refresh scope & cron design

- **D-16:** A tick rewrites **the changed event's file and its ~6 affected team files only**. The year-wide Teams table and Events list rebuild on a slower cadence (minutes, or at event boundaries). Rationale: serializing ~3,750 rows × 3 algorithms is on the order of the entire 10 ms budget before any other work — "rewrite everything every tick" likely cannot fit at all, and finding that out means failing during a live event. The pages a visitor watches during a match are fresh within 1–3 minutes; the season-wide ranking lags by minutes, which is imperceptible.
- **D-17:** The cron fires **every minute year-round and early-exits when nothing is live**. ~1,440 near-zero invocations/day against a 100k/day free request budget is negligible. Rejected: season-scoped cron expressions — offseason events run in the fall and championship dates shift, so a hardcoded calendar is one more thing that silently goes stale.
- **D-18:** **Liveness comes from an offline-published live-windows manifest.** The offline pipeline already holds the full event calendar; it publishes a small manifest of event keys and active windows, and the Worker reads one tiny object per tick. Spends zero TBA subrequests on discovery, and keeps calendar logic where there is CPU to spare.
- **D-19:** The **polling structure is deferred to research**, gated on one question research must answer first: **do R2/D1 binding calls count toward the free plan's 50-subrequest-per-invocation cap?** If they do, a peak tick is ~38 TBA polls + ~21 state reads + ~21 state writes ≈ 80 and blows the cap outright; if they do not, 38 fits with 12 to spare. The candidate mechanisms are a rotating start offset with a per-tick cap, sharding across staggered cron triggers (5 available), or both. Two facts constrain the answer: a 304 costs the same subrequest as a 200, so ETags save bandwidth but not budget; and the 10 ms limit is CPU time, not wall-clock, so waiting on fetches is free.

### Measurement & proof

- **D-20:** SC-2's freshness is proven by the **replay rig driving the deployed Worker** — recorded historical event data pushed through the real Worker path, measuring end-to-end latency from result-available to artifact-updated. Repeatable and CI-gateable. **Accepted gap, recorded deliberately:** because the rig replaces TBA, it does not exercise real TBA latency or real Cloudflare cron jitter. A live offseason event (`2026azscor` 2026-08-28, `2026scsc` 2026-08-29, or any of ~99 September events) remains available as an optional later confirmation and is *not* required to close SC-2.
- **D-21:** CPU is measured on a **deployed Worker under replayed load, read from Cloudflare's own reporting** — the number the platform actually enforces. Local `wrangler dev` timing is not evidence. The recorded figure must call out the **worst-case tick** (peak concurrency, an elimination-bracket flurry resolving at once), not just the average.
- **D-22:** The Worker **reuses the existing TBA throttle and counter**: `THROTTLE_INTERVAL_MS = 100` spacing and `TbaRequestCounter` from `packages/ingest/tbaClient.ts`. 38 events × 100 ms ≈ 3.8 s wall clock costs nothing against a CPU-time budget. One politeness policy across ingest and cron, one counter shape, one documented figure for SC-4. Rejected: a 38-request parallel burst every minute against a volunteer-run free service that explicitly asks for considerate querying.
- **D-23:** All measured numbers land in **one committed budget doc** — CPU per tick, R2/KV write volume per event-day, TBA request counts, and per-artifact payload sizes, each with the run that produced it. Sits alongside `docs/models/`, where this project already keeps its measured claims. Phase verification checks against it, and D-05's budget test reads from it.

### Publish & serving

- **D-24:** Artifacts are published by a **local CLI command** (`pnpm publish:artifacts`-shaped) running the precompute against the local corpus and uploading to R2. The Cloudflare token lives in the same untracked `.env` that already holds `TBA_API_KEY`, covered by the existing `scripts/secrets-boundary.test.ts`. Rationale: the 336 MB corpus cannot be cheaply rebuilt in CI (ingest is hours plus TBA load), so publishing runs where the corpus already is.
- **D-25:** The browser reads artifacts from an **R2 custom domain with no compute in the path**. Zero Worker requests per read, so the 100k/day free request cap never applies to page traffic, and R2's zero egress means a live-event traffic spike costs nothing. `Cache-Control` is set as object metadata at write time. A thin read Worker or Pages Function is *not* ruled out forever — it is deferred until a concrete need appears (see Deferred Ideas).
- **D-26:** Caching is **short `max-age` (~60 s) plus ETag revalidation**. TanStack Query's `refetchInterval` polls during live events and mostly receives cheap 304s. Pairs directly with D-04's stable-paths-plus-generation-stamp — there is no pointer to invalidate and no purge call on the cron path. Mirrors the conditional-request discipline `tbaClient.ts` already uses against TBA.
- **D-27:** The Worker is **deployed manually via `wrangler deploy`**, with the TBA key set once through `wrangler secret put`, and the procedure documented. No Cloudflare deploy token in GitHub, and the cron Worker is deployed deliberately rather than on every push — notably, an accidental merge during a live event cannot redeploy the thing currently keeping the site fresh.

### Tension the planner must resolve

**D-12 schedules a re-baseline; D-24 makes publishing a local CLI command.** A scheduled re-baseline that only runs when a laptop is on is not really scheduled. The planner must either (a) define the re-baseline cadence as an explicitly manual pre/post-event-weekend operation and say so plainly in the budget doc, or (b) surface CI-based publishing (corpus snapshot in R2, GitHub Actions pulls it) as a follow-on. Do not silently assume automation that D-24 does not provide.

### Claude's Discretion

- Per-field numeric precision under D-06, and whether probabilities/RP distributions keep more digits than display metrics.
- Whether D-08's RP distribution for scheduled matches is produced by Monte Carlo or by deterministic numerical integration — 03 D-11 and D-16 leave this open, and the 10 ms budget may decide it.
- The exact slower cadence for D-16's global-table rebuild (fixed interval, event-boundary triggered, or both).
- The state snapshot's serialization format and how it is keyed by algorithm version.
- Wave/plan decomposition across precompute, Worker, storage, serving, and the replay rig.
- Where the D-23 budget doc lives under `docs/` and its exact shape.
- Whether the D-05 budget test and the D-23 budget doc share a machine-readable source or stay separate.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope source (authoritative for what is in this phase)
- `.planning/ROADMAP.md` § Phase 4 — the goal and the four success criteria this phase is verified against
- `.planning/REQUIREMENTS.md` — DATA-03 (offline precompute, no recomputation per request), DATA-04 (~1–3 min freshness), DATA-05 (Cloudflare free tiers + TBA rate limits)

### Blocking dependency
- `.planning/ROADMAP.md` § Phase 3.2 — **does not exist yet.** Must be inserted via `/gsd-phase` and executed before Phase 4 is planned. See D-09/D-10/D-11 for its full scope.

### Product spec & mandate
- `REBUILD_SPEC.md` — product spec, clean-slate mandate, and the failure log. Three entries bear directly on this phase: **"never recompute per request"** (D-01, D-16 are the response), **"documentation drift and zero tests"** (D-05, D-14, D-23), and **"keep generated artifacts out of git"** (constrains D-24 — the corpus and `reports/` stay gitignored).
- `.claude/CLAUDE.md` § Technology Stack — the Cloudflare topology guidance (R2 primary, KV thin pointers, no D1 in v1). **Read D-13: this file currently contradicts `.planning/research/ARCHITECTURE.md` on D1 and must be reconciled, not silently overridden.**

### Prior phase context — locked decisions that still bind
- `.planning/phases/03-tuning-ranking-points-versioning/03-CONTEXT.md` — **D-13/D-14** (version identity and the promotion model; D-02 here is their storage consequence), **D-04** (EPA frozen; and the OPR half of it is what D-09 here deliberately overturns — read both), **D-11** (the RP joint model's Monte Carlo, explicitly "flagged for Phase 4"), **D-15/D-16** (bitwise reproducibility and the committed-digest CI gate; D-06 here must not disturb them), **D-02** (SC-3 keeps its literal reading, never redefined to fit a result — the direct constraint on D-11 here).
- `.planning/phases/02-prediction-models-epa-sigma1/02-CONTEXT.md` — **D-20/D-21** (artifact schema v2, raw numbers only — no precomputed deltas or "X beats Y" fields in any published artifact), **D-23/D-24/D-25** (prediction sidecars), **D-27/D-28** (`teamMetrics` contract and per-team metric history — the source for D-07's history series), **D-09/D-10** (what `±` means; the two distinct meanings must survive into published artifacts).
- `.planning/phases/01-data-foundation-evaluation-harness/01-CONTEXT.md` — **D-09** (tune/holdout split), **D-02** (JSON artifact canonical, renderers read from it).
- `.planning/phases/03.1-address-phase-1-3-review-warnings-and-doc-drift/03.1-CONTEXT.md` — **D-13** (standing rule: a committed digest is never hand-edited; if a change alters a prediction stream the result is a new promoted version).

### Research
- `.planning/research/ARCHITECTURE.md` — the whole document is this phase's blueprint. Specifically: the offline/online compute split, **Pattern 2** (compute/serve split with versioned artifacts), **Pattern 3** (client-side simulation over server-precomputed probabilities — the basis for D-08), **Pattern 4** (heavy compute in CI/local, light compute in the Worker — never the reverse), **Anti-Pattern 1** (recompute-per-request), **Anti-Pattern 2** (two implementations drifting — what D-14 measures), and **Anti-Pattern 3** (treating the 10 ms ceiling as "probably fine").
- `.planning/research/STACK.md` and `.claude/CLAUDE.md` — free-tier limits: 10 ms CPU/invocation, 5 cron triggers/account, 50 subrequests/invocation, KV 1,000 writes/day, R2 10 GB + 1M Class-A + 10M Class-B ops/month, D1 5M reads + 100k writes/day.
- `.planning/research/PITFALLS.md` — cold-start and season-carryover behavior, relevant to D-12's snapshot handoff.

### Existing implementation — read before changing
- `packages/ingest/tbaClient.ts` — `THROTTLE_INTERVAL_MS` (100), `TbaRequestCounter`, and the ETag-conditional `tbaFetch`. D-22 reuses all three in the Worker. Note the file header's "never logs the key, never embeds it in a returned value" constraint.
- `packages/core/algorithms/types.ts` — `AlgorithmModule<S>` and the file header's **"must stay Worker-importable, no Node-only APIs"** constraint. This is the boundary that makes D-14's equivalence claim possible.
- `packages/core/algorithms/opr.ts` — `IncrementalInverse`, `applyObservation`, `solveRidgeOpr`. The 134 MB measurement above came from `IncrementalInverse`'s capacity arithmetic; Phase 3.2 rewrites this surface.
- `packages/core/algorithms/sigma1/index.ts` — `Sigma1State`, `Sigma1TeamState` (beliefs, covariance, consistency, innovationStats), `Sigma1League`. This is what D-12's snapshot serializes and D-13's store must read per-team.
- `packages/core/algorithms/sigma1/rp/distribution.ts` — the RP pmf D-08 publishes and 03 D-11's Monte Carlo concern attaches to.
- `packages/harness/artifact.ts` — `ARTIFACT_SCHEMA_VERSION` (currently 3), `HarnessArtifactSchema`. The Compare page's source; D-03's published set must stay consistent with `algorithms[]`.
- `packages/harness/predictions.ts` / `packages/harness/metricHistory.ts` — the JSONL sidecars that feed D-07's per-match rows and metric-history series.
- `packages/harness/replay.ts` — `toLeakProofUpcoming`, `buildSeasonStream`, `WalkForwardSimulator.run`, `onMatchComplete`. D-14's replay rig and D-08's scheduled-match predictions must both run through this leak-proof path.
- `packages/harness/cli.ts` — the `ALGORITHMS` registry (7 entries), `PROMOTED_SIGMA1_VERSION_PATH`, `applyPromotedOverrides`, `warnIfNewerPromotedSigma1`. D-03 selects from here; the deployed Worker must resolve the promoted version the same way.
- `packages/corpus/schema.sql` and `packages/corpus/db.ts` — the corpus D-24 publishes from.
- `scripts/secrets-boundary.test.ts` — the existing secrets discipline D-24's Cloudflare token must extend to.
- `pnpm-workspace.yaml` — globs are live and already anticipate `apps/*`; its header comment names Phase 4's `apps/worker` explicitly as the reason they were uncommented on 2026-08-20.

### Open-item ledgers
- `.planning/WINDOWS.md` — entries #1 and #2 (dead Statbotics validation channel) remain open and are OUT of scope here.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/ingest/tbaClient.ts` — ETag-conditional fetch, throttle, and request counter. D-22 reuses it wholesale in the Worker rather than writing a second TBA client, which would be ARCHITECTURE.md Anti-Pattern 2 applied to ingestion.
- `packages/core/*` — already constrained to be Worker-importable with no Node-only APIs (`types.ts` header, `isomorphic.test.ts`). The Worker imports `predict`/`update` unchanged; this is what makes D-14's equivalence assertion meaningful rather than aspirational.
- `packages/harness/replay.ts` — `WalkForwardSimulator` and its `onMatchComplete` hook are the natural driver for D-20's replay rig; the leak-proof `toLeakProofUpcoming` path must be preserved for D-08's scheduled-match predictions.
- `packages/harness/artifact.ts` — `HarnessArtifactSchema` is the established pattern for "the Zod schema *is* the executable spec, validated on write." D-05's budget file and the published artifact schemas should follow it.
- `scripts/secrets-boundary.test.ts` — the pattern for making a secrets-handling regression fail a test; extends to D-24's Cloudflare token.
- `scripts/reviewFrontmatterLint.ts` — precedent (03.1 D-16) for a narrow, mechanical invariant enforced as a lint rather than trusting prose.

### Established Patterns
- **Explicit-flag discipline (DATA-02):** quirks are stored, not inferred at read time. D-04's generation stamp follows it — skew is recorded on the artifact, not left for a reader to notice.
- **Structural enforcement over convention:** `toLeakProofUpcoming`'s Proxy, and 03.1 D-11's unconstructible-invalid-params rule. D-13/D-15 are stated as locked *requirements* for research precisely so the constraint survives whatever mechanism is chosen.
- **Make a misreading fail a test:** `reconciliation.test.ts`, `digest.test.ts`, the review-frontmatter lint. D-05 and D-14 are this pattern applied to payloads and to the offline/online boundary.
- **Raw numbers only in artifacts (02 D-21):** no precomputed deltas, no comparison fields. Applies unchanged to every artifact this phase publishes.
- **Generated artifacts stay out of git:** `data/*` (except `algorithm-versions/`) and `reports/` are gitignored. Published artifacts go to R2, never into the repo.

### Integration Points
- `apps/worker/` — new workspace package; `pnpm-workspace.yaml`'s `apps/*` glob is already live and was uncommented specifically for it (2026-08-20, commit `76f57561`).
- `packages/harness/cli.ts` `ALGORITHMS` + `applyPromotedOverrides` — the deployed Worker must resolve the same promoted version by the same rule; 03.1 D-12 keeps the promoted path explicitly pinned with a loud warning on a newer file, and that behavior must carry into the Worker.
- `packages/core/algorithms/opr.ts` — Phase 3.2 rewrites this to event scope before Phase 4 consumes it.
- `packages/harness/artifact.ts` `ARTIFACT_SCHEMA_VERSION` — currently 3; publishing page-shaped artifacts alongside it may or may not require a bump. 03 D-16's note applies: breaking schema is nearly free now and expensive after Phase 4 publishes.
- `data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json` — the committed promoted version whose identity D-02 puts into every artifact path.

</code_context>

<specifics>
## Specific Ideas

- The user's framing on OPR: *"I don't want season-pooled OPR ever. All OPR should be event scoped like statbotics and TBA."* The intent is that SigmaScout's baselines should be quantities the FRC community actually recognizes and can check, not internal constructs.
- The user pushed back on the subrequest-cap options with *"if we hit the limit, what is the risk? Won't the requests just catch up when they can?"* — the expectation is that overload degrades into delay. D-15 encodes that expectation as a requirement, because it is not the default behavior and has to be built.
- On state bootstrap the user said *"I feel like this should be automatic."* D-12 satisfies that literally — nothing in the running system is manual — but the planner should keep that bar in mind: anything requiring routine hand-operation is against the grain of what was asked. This is also why the D-24/D-12 tension is called out explicitly rather than left implicit.
- Continuing 03.1's note: the user prefers plain-language framing over review jargon. SUMMARY and VERIFICATION write-ups for this phase should follow suit.

</specifics>

<deferred>
## Deferred Ideas

- **A thin read Worker or Pages Function in front of R2** — D-25 serves directly from an R2 custom domain to keep reads off the 100k/day Worker request cap. Add a read layer only against a measured need (per-route cache tuning, redirects, a fallback shape), not preemptively.
- **CI-based publishing** (corpus snapshot in R2, GitHub Actions pulls and publishes) — deferred by D-24 because the 336 MB corpus lives locally, but it is the natural resolution of the D-12/D-24 tension if manual re-baselining proves impractical.
- **Auto-deploy of the Worker on push to main** — deferred by D-27 until the pipeline's shape has settled and the replay rig can gate it.
- **A slim search index split out of the year-wide Teams table** — considered under D-01 and rejected for now; revisit in Phase 5 if search on the full table proves slow.
- **Cache policy split by liveness** (long immutable cache for finished seasons, short for live events) — considered under D-26; a real optimization, but it makes cache policy depend on the live-windows manifest, so it is deferred until D-26's simpler policy is measured.
- **Publishing all archived promoted versions indefinitely** — considered under D-03. PROJECT.md's "past Sigma versions remain viewable and comparable" requirement will need this eventually; D-02's version-in-path layout makes it a pure additive change when that phase arrives.
- **Statbotics external-validation channel** (`WINDOWS.md` #1/#2) — still open, still out of scope, still landing in Phase 8.

</deferred>

---

*Phase: 04-publish-live-update-pipeline*
*Context gathered: 2026-08-21*
