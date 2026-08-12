# Pitfalls Research

**Domain:** FRC (FIRST Robotics Competition) match-prediction website — rating/prediction models, TBA data pipeline, Cloudflare-hosted static-precompute architecture
**Researched:** 2026-08-12
**Confidence:** MEDIUM (web-search-derived, cross-checked across multiple independent sources per topic; no official Anthropic/vendor docs MCP available this run — see Sources)

This file expands on SigmaScout's own failure log (REBUILD_SPEC.md), which is treated as confirmed/critical and re-stated here in the project's terms, plus domain research on sports-prediction methodology, rating-model math, TBA API quirks, and Cloudflare free-tier operation.

## Critical Pitfalls

### Pitfall 1: No evaluation harness before model work begins (confirmed prior failure)

**What goes wrong:**
Algorithm changes get judged by vibes ("this looks more accurate") instead of a scored, reproducible backtest. Nobody can say whether Sigma1 actually beats OPR/EPA/Statbotics, and hyperparameter changes ship without evidence they helped.

**Why it happens:**
Building the harness feels like overhead compared to building the "real" feature (the model). It's tempting to write the model first and "add tests later."

**How to avoid:**
Build the walk-forward backtest harness (Brier score + winner accuracy, per-algorithm, per-year) as the first working artifact, before Sigma1 exists in any tunable form. OPR is trivial to compute and gives the harness something to score on day one. Every subsequent model change is a PR-sized diff scored against the same harness output.

**Warning signs:**
Model code changes without a corresponding backtest run in the commit/PR; hyperparameters adjusted "by feel"; no dashboard or table showing Brier score trend across versions.

**Phase to address:**
Phase 0/1 — evaluation harness must exist and run against a trivial baseline (OPR) before Sigma1 development starts.

---

### Pitfall 2: Unidentifiable latent model structure (confirmed prior failure — the 4D collapse)

**What goes wrong:**
A model is given more free parameters per team than the data can pin down (e.g., separate offense/defense/time-allocation dimensions when the only observable per match is a single alliance score). The optimizer finds infinitely many parameter combinations that fit training data equally well; parameters drift, don't converge, or trade off against each other arbitrarily between runs. This is mathematically the same failure mode as Bradley-Terry-style models being identifiable only up to a global additive/multiplicative constant — except here it's worse because there isn't even a single scalar per team, there are several, and the alliance-sum observation can't separate them.

**Why it happens:**
It's intuitive to want a "rich" model (defense matters! time allocation matters!) but FRC's core observable is: alliance-level score components, win/loss, and RP — all aggregated at the *alliance*, not the *individual robot*. Any per-robot decomposition beyond what's linearly separable from alliance-level scoring data is underdetermined without extra structure (e.g., per-robot game-piece counts if TBA's score breakdown provides them) or strong priors/regularization.

**How to avoid:**
Before adding any new latent dimension to a metric, ask: "Given only the observables TBA actually publishes (alliance score, score breakdown line items if present, win/loss, RP), can this parameter's value change *only if that entity's own outcome changes*, holding everything else fixed?" If two parameter settings produce identical predictions for every observed match, the model is unidentifiable — fix it with a hard constraint (e.g., anchor/reference constraint, sum-to-zero constraint) or drop the dimension. Prefer models with one scalar (+ variance) per team per metric unless a specific, TBA-observable, per-robot signal justifies more dimensions (e.g., 2024+ score breakdowns sometimes report per-robot game piece counts — verify per season before relying on this).
Use the score-breakdown-level data (not just alliance totals) wherever TBA provides it, since that increases the observable dimensionality and can make a richer model actually identifiable — but verify this precisely, per season, before adding structure that depends on it.

**Warning signs:**
Parameter estimates that don't converge or change wildly between refits on near-identical data; two different parameter vectors giving statistically indistinguishable backtest scores; a component of the model (e.g., "defense rating") that never gets validated against any independent signal.

**Phase to address:**
Phase where Sigma1's state vector is designed — do an explicit identifiability check (on paper or by simulation) before implementation. Revisit any time a new latent dimension is proposed for Sigma2+.

---

### Pitfall 3: Outcome leakage / non-walk-forward evaluation (confirmed prior failure)

**What goes wrong:**
A prediction for match N is scored as "accurate" but was actually computed using data from match N or later (e.g., ratings refit on the whole season, then "predictions" extracted after the fact; or an event's final rankings used as a feature). Backtest numbers look great; live predictions during an actual event are much worse, because the harness was silently cheating.

**Why it happens:**
It's easy to accidentally leak future data: computing a season-end rating and asking "what would this rating have predicted for match 3" is *not* the same as "what did the model predict, using only data through match 2, for match 3." Vectorized/batch computation of ratings across a whole season is the most common way this creeps in, because it's much faster to implement than a strict sequential replay.

**How to avoid:**
Structurally enforce predict-before-update: the harness replays matches in true chronological order (including qual + playoff interleaving where relevant, and matches across concurrent events in a week), calls `predict(match)` before calling `update(match, result)`, and the model object is never allowed to see match N+1..end when predicting match N. Write this as an actual code-level invariant (e.g., a `WalkForwardSimulator` that owns the only reference to future matches and only reveals them one at a time) rather than a discipline the algorithm author has to remember. Add a regression test that deliberately tries to leak (e.g., asserts that shuffling future-match order doesn't change past predictions).

**Warning signs:**
Backtest accuracy that's suspiciously high compared to published Statbotics numbers; predictions that get *worse* when re-run event-by-event instead of season-batch; any code path where a rating is computed once "for the whole season" and then match predictions are derived from it after the fact.

**Phase to address:**
Same phase as the evaluation harness (Phase 0/1) — this is the harness's core job, not a later add-on. Also re-verify at each new algorithm phase (Sigma1, EPA reimplementation) since it's easy to reintroduce leakage in a new code path.

---

### Pitfall 4: Recompute-per-request architecture (confirmed prior failure)

**What goes wrong:**
Team/event pages recompute ratings or season aggregates on every page load or API request (Statbotics' known anti-pattern, explicitly called out in REBUILD_SPEC.md as "do not do that"). This is slow, and on Cloudflare's free tier it's not just slow — a free-plan Worker gets only 10ms of CPU time per invocation (see Pitfall 8), which makes any non-trivial recomputation-per-request effectively impossible without hitting CPU limits or timeouts.

**Why it happens:**
Recompute-on-read is the simplest thing to build first ("just call the model function in the API handler") and works fine in local dev with a small dataset; it silently becomes the architecture because nobody explicitly designed the precompute/serve split.

**How to avoid:**
Design the precompute/serve boundary explicitly, before any UI work: a scheduled job (see Pitfall 9 for where that job should run) computes everything — ratings, predictions, backtests, simulation inputs — and writes compact, page-ready JSON/data artifacts to storage (KV/R2/static build output). The site's read path only ever fetches precomputed data; it never re-derives it. Treat "can this page be served from a static JSON blob with zero computation?" as a hard requirement for every page.

**Warning signs:**
Any API/Worker handler that loops over match history or calls the rating model directly inside a request handler; page load times that scale with season match count; TTFB that grows as the season progresses.

**Phase to address:**
Architecture/data-pipeline phase, before any page is built. Verify per-page during each frontend phase ("what precomputed artifact does this page read, and does it read *only* that?").

---

### Pitfall 5: TBA data quirks silently corrupt aggregates (surrogates, offseason gaps, per-season schema drift)

**What goes wrong:**
Several TBA data realities are easy to miss and will quietly bias ratings/records if unhandled:
- **Surrogate matches** (a team fills in for another and the result doesn't count toward that team's ranking) are not always explicitly flagged in every API view — historically this required inferring surrogate status indirectly (e.g., from qual-match-count patterns) rather than reading a clean boolean. If unhandled, surrogate results get folded into a team's rating/record as if they counted normally.
- **Offseason events** run through manual FMS report imports (rather than the real-time Trusted API) frequently lack rich score breakdowns — so a per-season model that depends on score-breakdown fields will silently get nulls/missing data for some offseason events and must degrade gracefully (or exclude those events) rather than crash or silently treat missing as zero.
- **Score breakdown schema changes every season** (each game has different scoring elements), so any code that reads `score_breakdown` fields must be written per-season, not generically, and must be revisited for each new season (2022, 2023, 2024, 2025, 2026 all have different breakdown shapes).
- **Replays / re-run matches**: a match can be replayed (rare but real — e.g., after a field fault); the API may expose the same match key with corrected data. A model that ingests match results incrementally must handle the "same match key, data superseded" case rather than assuming a match key appears exactly once.

**Why it happens:**
The TBA API is the ground-truth source but is oriented around what FRC's own event-management system produces, not around what's convenient for a clean statistics pipeline. It's easy to write the "happy path" ingestion against a couple of test events and not encounter surrogates, offseason gaps, or replays until much later, at which point ratings have already been silently contaminated across a large date range.

**How to avoid:**
Write an explicit TBA ingestion normalization layer, with tests, that: (a) filters or flags surrogate matches per the `match.score_breakdown` / team-list semantics TBA actually documents for the target seasons — verify current behavior against TBA's API docs rather than assuming, since this has been an open API-design question; (b) treats missing score-breakdown fields as "unknown," never as zero, and has an explicit fallback path (e.g., degrade to alliance-total-only prediction) for events/matches missing breakdown data; (c) keys ingestion by match key + a data-version/last-modified marker so replayed/corrected matches overwrite rather than duplicate; (d) hard-codes a per-season score-breakdown schema (don't try to build one generic parser for all years).

**Warning signs:**
A team's win rate or rating changes unexpectedly after a re-fetch of "old," supposedly-finalized data; ratings computed for offseason events look wildly different from same-team in-season ratings; a season's ingestion code silently throws or nulls-out on an event and nobody notices because the site just shows stale/missing data for that event.

**Phase to address:**
Data pipeline / TBA ingestion phase — build the normalization layer and its tests before any model consumes TBA data directly. Re-verify per season when 2027 ingestion is added.

---

### Pitfall 6: Score-breakdown-derived predictions silently break every new game year

**What goes wrong:**
FRC changes its scoring rules, RP (Rank Point) criteria, and playoff format almost every season (e.g., the switch to double-elimination playoffs starting 2023, RP criteria that differ per game). A model or RP-prediction feature hardcoded for one season's rules will produce confidently wrong predictions for a different season without erroring — because the shapes of the data are similar enough that nothing crashes, but the RP semantics are completely different.

**Why it happens:**
It's tempting to build RP prediction once, generically, using whatever pattern worked for the season you tested against, and assume it generalizes. FRC's per-season game manual changes are exactly the kind of "business logic drift" that doesn't show up as a data-shape error.

**How to avoid:**
Treat "RP rules" and "playoff format" as explicit, versioned, per-season configuration (not inferred from data), reviewed against that season's official game manual before the season's data is ingested. The project's own requirement ("Rank-point prediction with per-season RP rules for all covered seasons") already acknowledges this — the pitfall is under-scoping the verification step (i.e., not actually reading each season's manual/RP rubric explicitly, and instead assuming e.g. 2023's rule generalizes to 2024).

**Warning signs:**
RP prediction accuracy that's much worse for some seasons than others in the backtest, with no code error — a strong sign the RP model has last season's rules baked in.

**Phase to address:**
Whichever phase implements RP prediction/simulation — plan explicit per-season rule tables as a deliverable, not an implementation detail.

---

### Pitfall 7: Overfitting hyperparameters to the backtest itself (data snooping)

**What goes wrong:**
The auto-tuning harness (an explicit project requirement — "hyperparameters tuned automatically... offline optimizer against backtest score") repeatedly evaluates many hyperparameter settings against the same backtest data until one looks best. The reported backtest score for the winning hyperparameters is then optimistic — the harness has effectively "seen" the test data many times, even though any single walk-forward run itself doesn't leak future data into a given prediction.

**Why it happens:**
Walk-forward correctness (Pitfall 3) prevents leakage *within* a single evaluation run, but it does not prevent leakage *across* many evaluation runs used to pick hyperparameters — that's a different, second-order form of overfitting, and it's easy to believe "we're walk-forward, so we're safe" and miss it.

**How to avoid:**
Split seasons into a tuning set and a held-out validation set (e.g., tune hyperparameters using 2022–2024 backtests, report final headline "beats Statbotics" numbers on 2025–2026 as a held-out check that was *not* used during tuning). Re-run the held-out check only occasionally, not every tuning iteration. Document the split explicitly in the harness output so the Compare page's numbers are honest about which years were in-sample for tuning vs. out-of-sample.

**Warning signs:**
Sigma1's backtest score keeps improving every time hyperparameters are retuned, but real-world (live 2027 event) performance doesn't match; the "beats Statbotics" claim is based on the same years used to pick the hyperparameters.

**Phase to address:**
The auto-tuning/optimizer phase for Sigma1 — define the tune/holdout season split as part of the harness design, not after the fact.

---

### Pitfall 8: Cloudflare free-tier Worker CPU time makes "compute in a Worker" infeasible for anything but serving

**What goes wrong:**
Cloudflare Workers on the free plan are capped at **10ms of CPU time per invocation** (hard limit, not configurable — the 5-minute/30-second extended CPU limits are paid-plan-only opt-ins). A Kalman-filter update pass over a season's worth of teams/matches, or a 1000-run Monte Carlo event simulation, will not fit in 10ms. If the scheduled data-refresh job is implemented as a Cloudflare Worker Cron Trigger, it will hit this ceiling and fail/timeout silently (no auto-retry, no failure alert on the free plan) well before it finishes computing.

**Why it happens:**
"Cloudflare Workers cron" sounds like the obvious place to put "the job that recomputes stuff periodically," since the project is already Cloudflare Pages-hosted — but Workers are designed for fast request/response, not batch compute, and the free-tier CPU cap reflects that.

**How to avoid:**
Do not run the heavy compute (rating updates, backtests, simulations) inside a Cloudflare Worker on the free plan. Options that fit "free tier only": (a) run the compute step in GitHub Actions (free minutes for public/hobby repos) on a schedule, writing results to KV/R2 or committing precomputed JSON to the Pages build output; (b) keep a Worker Cron Trigger only for lightweight orchestration (e.g., "check if TBA has new data, if so trigger a GitHub Actions workflow via API"), not the computation itself. Validate the actual CPU-time need against the 10ms cap before committing to any Worker-based compute path — this should be tested with a realistic data volume early, not assumed.

**Warning signs:**
Worker cron job errors with CPU-limit-exceeded (or silently stops updating data with no error visible, since free-tier failures aren't alerted); "freshness" target (1–3 min) silently degrades because the job never completes.

**Phase to address:**
Architecture/data-pipeline phase — pick the compute execution environment (GitHub Actions vs. Worker vs. other) explicitly, informed by this constraint, before building the scheduled pipeline.

---

### Pitfall 9: KV eventual consistency breaks "freshness within 1–3 minutes" assumptions

**What goes wrong:**
Cloudflare KV writes propagate globally in up to ~60 seconds and KV is not read-after-write consistent across edge locations — a user near a different edge node than the one that just wrote fresh data can see stale data (or a null) for up to a minute after an update. Additionally, KV enforces hard daily caps on the free tier (100k reads/day, 1,000 writes/day, 1,000 deletes/day, 1,000 list ops/day) with no throttling/queuing — operations simply fail once exceeded. A live event with many teams updating within a compressed multi-hour window can plausibly approach the 1,000 writes/day cap if each match/event update is written as a separate KV write.

**Why it happens:**
KV is easy to reach for as "the free key-value store," but it's designed for infrequently-changing, globally-cached data (like config), not for a "few writes per minute during a live event, read by everyone immediately" workload — that's closer to what Cloudflare recommends Durable Objects for.

**How to avoid:**
Batch writes: compute an entire refreshed dataset per pipeline run and write it as a small number of KV keys (e.g., one blob per event, or one per "latest snapshot"), not one write per match/team/metric. Budget the write cap explicitly against the 1–3 minute freshness target and expected event-day match cadence (worst case: a large event running matches every ~5 minutes for 8+ hours could need on the order of 100+ update cycles/day across multiple concurrent events — verify this arithmetic against actual event schedules before finalizing the polling interval). Treat the "up to 60s propagation" as part of the freshness budget (i.e., target ~1–3 min end-to-end already implicitly includes this), and don't assume a write is visible everywhere the instant it succeeds.

**Warning signs:**
Different users (or the same user across page reloads) seeing different "latest" data for the same event during a live event; KV write-quota-exceeded errors appearing only on high-match-volume event days; freshness noticeably worse during a large multi-field event week than in isolated testing.

**Phase to address:**
Data pipeline / storage design phase — decide the write batching strategy and KV key structure before wiring up the live-event refresh loop; load-test the write-cap arithmetic against a real high-volume event's actual match schedule (pull historical match timestamps from TBA for a big event to validate assumptions).

---

### Pitfall 10: Treating uncalibrated confidence as validated confidence

**What goes wrong:**
The Sigma-family "X ± Y" variance display and per-match "prediction confidence" are only meaningful if the underlying probabilities are calibrated (i.e., among matches predicted at 70% confidence, the favored alliance actually wins about 70% of the time) — not just if the Brier score is low. A model can have a good (low) Brier score while still being systematically overconfident or underconfident in specific regimes (e.g., early season with few matches per team, or in blowout vs. close-match predictions), and Brier score alone won't surface that.

**Why it happens:**
Brier score is the natural single-number metric to optimize and report, and it's a proper scoring rule, so it's easy to treat "low Brier" as "well-calibrated" — but Brier score conflates calibration (reliability) with resolution/sharpness, and a model can trade one for the other while keeping Brier roughly constant.

**How to avoid:**
In the evaluation harness, compute and publish a calibration curve (binned predicted-probability vs. observed-frequency) alongside Brier score, not just the scalar. Do this per algorithm and ideally per confidence bucket, and surface it on the Compare page (or at least in harness output) so "beats Statbotics on Brier" claims can be checked against "and is actually calibrated," which is a stronger and more useful claim for a site whose entire value prop is "honest uncertainty."

**Warning signs:**
Matches predicted at very high confidence (e.g., 90%+) losing noticeably more than 10% of the time in the backtest, or the reverse (predicted-50% matches skewing heavily to one side); variance (Y in "X ± Y") that doesn't shrink as more matches accumulate within a season for a given team.

**Phase to address:**
Evaluation harness phase — calibration reporting should ship alongside Brier score/winner accuracy from the start, not be added later as an afterthought.

---

### Pitfall 11: Early-season / cold-start overconfidence for rookie and returning teams

**What goes wrong:**
A Kalman-filter-style model with a fixed prior (e.g., start every team at a league-average rating with some fixed initial variance) will be systematically overconfident about brand-new rookie teams if the initial variance is too small, and will converge too slowly (staying overconfident-in-the-wrong-direction) for returning teams whose offseason changes (new drivetrain, new drivers, redesigned robot) mean this season's true skill differs substantially from last season's carried-over rating.

**Why it happens:**
It's simplest to initialize every team the same way; distinguishing "this is a genuine rookie with zero history" from "this is a veteran team with 5 years of history" requires deliberate design (e.g., wider initial variance for rookies, some season-over-season decay/regression-to-mean for returning teams' carried-forward rating) that's easy to skip in a first implementation.

**How to avoid:**
Explicitly design (and backtest) the initialization policy as three distinct cases: brand-new rookie team (wide prior, e.g., league-average mean, high variance), returning team at season start (carry forward some fraction of last season's rating with inflated variance to represent robot-changed uncertainty — an explicit season-carryover decay parameter, itself tunable by the auto-tuning harness), and mid-season team with accumulating match history (variance shrinks with more matches, per the Kalman-filter math). Validate all three regimes separately in the backtest (e.g., report Brier score sliced by "team's first 3 matches of season" vs. "team's matches 10+").

**Warning signs:**
Backtest accuracy notably worse in early-season matches (weeks 1–2) than late-season; rookie teams' predicted win probabilities clustering suspiciously close to 50% (or the opposite — clustering at extremes) regardless of actual performance in their first few matches.

**Phase to address:**
Sigma1 design phase — cold-start and season-carryover policy should be an explicit, named part of the model spec and a specific backtest slice, not implicit behavior of whatever the Kalman filter defaults to.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Generic score-breakdown parser shared across seasons | Less code to write once | Silently wrong or crashing when a new season's schema differs (Pitfall 6) | Never for scoring-relevant fields; acceptable only for season-agnostic fields (match key, alliance teams, win/loss) |
| Skipping the tune/holdout season split "for now" | Faster path to a first Sigma1 backtest number | Headline "beats Statbotics" claim is not honest (Pitfall 7) | Only during early internal iteration, never for a published Compare-page number |
| Writing one KV key per match update during live events | Simple to implement (write-as-you-go) | Burns the 1,000 writes/day free cap fast on high-match-volume event days (Pitfall 9) | Never during real events; fine during local/dev testing with small volumes |
| Computing predictions inside the Worker request handler "just to get the page working" | Fast to prototype a page | Re-creates the recompute-per-request failure and can't survive the 10ms CPU cap anyway (Pitfalls 4, 8) | Only as a disposable local prototype, deleted before the precompute pipeline exists |
| Skipping calibration-curve reporting, shipping Brier score only | Simpler harness output | Ships an unfalsifiable "confidence" number that the product's whole pitch depends on (Pitfall 10) | Never — this is core to the "honest uncertainty" value prop |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| The Blue Alliance API v3 | Treating every match as final/complete/uniquely-keyed and ignoring surrogates, replays, and offseason score-breakdown gaps | Build an explicit normalization/ingestion layer (Pitfall 5) with tests against real historical event data that includes at least one offseason event and one known-surrogate match |
| The Blue Alliance API v3 | Polling on a fixed interval without ETag/conditional requests, burning rate limit and TBA server load | Store and send `If-None-Match` with cached ETags; treat 304 responses as free, and back off polling frequency outside active event windows |
| Cloudflare Workers KV | Using KV as a live, high-frequency, read-after-write store (e.g., "write score the instant a match finalizes, expect it visible everywhere instantly") | Batch writes per pipeline run; treat KV as an eventually-consistent snapshot store, not a live database; use Durable Objects only if genuine read-after-write consistency is needed somewhere |
| Cloudflare Workers Cron Triggers | Assuming a cron-triggered Worker can run the actual model computation | Free-plan Workers cap CPU at 10ms/invocation (Pitfall 8); move real compute to GitHub Actions or similar, use the Worker only for lightweight triggering/serving |
| Cloudflare Pages | Assuming unlimited/instant redeploys during active-event freshness testing | Free plan: 500 builds/month, 20-minute build timeout, one concurrent build — plan around this if using a Pages rebuild as part of the freshness pipeline rather than a KV-only data update |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Recompute-per-request (Pitfall 4) | Page load time scales with season match count; TTFB grows as season progresses | Precompute/serve split enforced architecturally | Breaks immediately at any real data volume, and hard-fails against the 10ms free Worker CPU cap |
| Whole-season batch rating recompute instead of incremental update | Data pipeline run time grows superlinearly as seasons accumulate (2022–2026 and growing) | Incremental, per-match state update (Kalman filter is naturally incremental — use that) rather than season-wide refit on every pipeline run | Becomes noticeable once a full historical backtest (2022–2026, all events) is re-run on every deploy instead of only when algorithm code changes |
| One KV write per match/team during live events | Approaches or exceeds the 1,000 writes/day free cap on high-volume event days | Batch writes into per-event or per-snapshot blobs | Breaks on a large multi-day event with frequent match cadence, or several concurrent events in the same week |
| 1000-run Monte Carlo event simulation computed inside a request/Worker | Simulation tab is slow or times out against CPU caps | Precompute simulation results for likely "start match" choices during the scheduled pipeline run, or run simulation compute in the same off-Worker environment as rating updates | Breaks as soon as it's tested against the free-tier CPU cap, not just at scale |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Committing the TBA API key | Key leaked in git history, potential quota abuse by others under the project's key | Keep the key in untracked `.env` (already noted as the current setup) and in Cloudflare's secret/environment binding for the deployed pipeline; verify `.gitignore` covers it before first commit of pipeline code |
| Exposing the TBA API key to the browser | Client-side code could leak the key, letting others use the project's TBA quota | All TBA calls happen server-side/in the scheduled pipeline only; the browser only ever fetches SigmaScout's own precomputed data, never calls TBA directly |
| No validation on data written to KV/R2 by the scheduled pipeline | A malformed pipeline run (e.g., partial TBA outage) writes broken/partial data that the site then serves as if valid | Validate computed artifacts (schema + sanity checks, e.g., "no negative predicted score," "probabilities sum to ~1") before publishing; keep the previous good snapshot as a fallback if validation fails |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Displaying `X ± Y` variance without explaining what Y means | Casual users (students, parents) don't understand what "±4.2" conveys, undermining the "honest uncertainty" differentiator | Brief inline explanation/tooltip on first encounter with a variance value; keep OPR/EPA (no variance) visually distinct from Sigma-family metrics so the ± isn't assumed to apply everywhere |
| Showing stale predictions during a live event without indicating staleness | Users trust a prediction that's actually several minutes old during a fast-moving event | Surface a "last updated" timestamp tied to the actual pipeline run time, not just page load time, especially on event pages during active events |
| Simulation tab defaulting to a confusing or arbitrary "start match" | Users get a rank distribution that doesn't match their mental model of "what happens from here" | Default the start-match selector to the next unplayed match, clearly labeled, with an obvious way to rewind to an earlier match |

## "Looks Done But Isn't" Checklist

- [ ] **Evaluation harness:** Often "done" once it runs on one algorithm — verify it runs all algorithms (OPR, EPA, Sigma1) walk-forward, over all seasons 2022–2026, and reports both Brier score and calibration, not just win-accuracy
- [ ] **TBA ingestion:** Often "done" once a couple of live-season events parse correctly — verify against an offseason event, a known-surrogate match, and at least one event whose score_breakdown differs from the "typical" shape for its season
- [ ] **RP prediction:** Often "done" once one season's RP logic works — verify per-season RP rule tables exist and are individually checked against that season's official game manual, for every covered season (2022–2026)
- [ ] **Live freshness (1–3 min target):** Often "verified" only in low-traffic local testing — verify against realistic write volume/cadence for a large, real historical event's actual match schedule, and against the KV free-tier daily write cap
- [ ] **Algorithm versioning:** Often "done" as a UI dropdown only — verify that a past Sigma version's stored predictions are truly frozen/reproducible (not silently recomputed with current code) when viewed later
- [ ] **"Beats Statbotics" claim:** Often "done" once Sigma1's in-sample backtest number looks good — verify the number reported publicly (Compare page) is from a held-out season range never used during hyperparameter tuning

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|-----------------|
| Outcome leakage discovered after Sigma1 is "done" | HIGH | Rebuild the walk-forward simulator as the single source of truth for match ordering/visibility, re-run all backtests, retune hyperparameters on the corrected harness, retract any previously-published "beats Statbotics" numbers until reverified |
| Unidentifiable model discovered mid-development | MEDIUM–HIGH | Do the identifiability check retroactively (does any pair of parameter settings produce identical predictions on the historical data?); either add a constraint/anchor or collapse the extra dimension; re-tune and re-backtest |
| KV write-cap exceeded during a live event | MEDIUM | Switch to batched per-event writes immediately; if mid-event, fall back to a longer polling interval to stay under cap until batching ships |
| Season-specific RP/scoring bug found after a season's data is already ingested | LOW–MEDIUM | Because compute is precomputed and versioned (not live-mutating), re-run the pipeline for the affected season only, republish that season's artifacts; no user-facing data loss if raw TBA data was cached/retained |
| Calibration found to be poor for a shipped algorithm version | LOW | Because algorithm versions are first-class and viewable historically, ship a corrected version alongside (not replacing) the flawed one, and let the Compare page show both — consistent with the versioning requirement already in scope |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| No evaluation harness | Phase 0/1 (evaluation harness) | Harness runs OPR walk-forward over ≥1 full season before Sigma1 exists |
| Unidentifiable latent model | Sigma1 design phase | Written identifiability check/argument reviewed before implementation starts |
| Outcome leakage | Phase 0/1 (evaluation harness) | Regression test asserting future-match order doesn't affect past predictions |
| Recompute-per-request architecture | Architecture/data-pipeline phase | Every page's data-fetch path traced to a precomputed artifact, zero model calls in request handlers |
| TBA data quirks (surrogates, offseason gaps, replays) | Data pipeline / TBA ingestion phase | Ingestion tests include an offseason event, a surrogate-match event, and a replayed match |
| Per-season RP/scoring rule drift | RP prediction phase | Per-season rule table reviewed against each season's official game manual |
| Hyperparameter overfitting to backtest (data snooping) | Auto-tuning/optimizer phase | Tune/holdout season split documented; headline Compare numbers come from held-out seasons |
| Cloudflare free-tier Worker CPU cap | Architecture/data-pipeline phase | Compute execution environment chosen and load-tested against 10ms cap before pipeline build-out |
| KV eventual consistency / write caps | Data pipeline / storage design phase | Write-batching strategy validated against a real large event's match cadence |
| Uncalibrated confidence reported as validated | Evaluation harness phase | Calibration curve shipped alongside Brier score from harness v1 |
| Cold-start / rookie / season-carryover handling | Sigma1 design phase | Backtest sliced by "early season" vs. "mid/late season" and by rookie vs. returning team |

## Sources

- [Tech Talk: How The Blue Alliance Gets Data](https://blog.thebluealliance.com/2017/06/13/tech-talk-how-the-blue-alliance-gets-data/) — MEDIUM
- [TBA GitHub Issue #1500: indicate surrogate matches on each match list](https://github.com/the-blue-alliance/the-blue-alliance/issues/1500) — MEDIUM (primary/official issue tracker)
- [TBA GitHub Issue #5736: Support 2024 Score Breakdowns](https://github.com/the-blue-alliance/the-blue-alliance/issues/5736) — MEDIUM
- [TBA APIv3 docs](https://www.thebluealliance.com/apidocs/v3) — MEDIUM
- [Evaluating FRC Rating Models — Statbotics blog](https://www.statbotics.io/blog/models) — MEDIUM
- [The EPA Model: A Gentle Introduction — Statbotics blog](https://www.statbotics.io/blog/intro) — MEDIUM
- [The Math Behind OPR — TBA blog](https://blog.thebluealliance.com/2017/10/05/the-math-behind-opr-an-introduction/) — MEDIUM
- [Glicko rating system — Wikipedia](https://en.wikipedia.org/wiki/Glicko_rating_system) — MEDIUM
- [The Glicko Rating System: When Confidence Matters](https://mcginniscommawill.com/posts/2025-04-29-glicko1-rating-system/) — MEDIUM
- [Asymptotic comparison of identifying constraints for Bradley-Terry models (arXiv)](https://arxiv.org/pdf/2205.04341) — MEDIUM
- [On the identifiability of mixtures of ranking models (arXiv)](https://arxiv.org/pdf/2201.13132) — MEDIUM
- [On misconceptions about the Brier score in binary prediction models (PMC/arXiv)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12818272/) — MEDIUM
- [Overfitting In Sports Analytics — Meegle](https://www.meegle.com/en_us/topics/overfitting/overfitting-in-sports-analytics) — LOW–MEDIUM
- [Logical Leakage in Backtesting](https://www.emergentmind.com/topics/logical-leakage-in-backtesting) — LOW–MEDIUM
- [Cloudflare Workers docs — Limits](https://developers.cloudflare.com/workers/platform/limits/) — MEDIUM (official docs, corroborated across multiple secondary sources)
- [Cloudflare Workers docs — Pricing](https://developers.cloudflare.com/workers/platform/pricing/) — MEDIUM
- [Cloudflare changelog — Higher CPU limits (2025-03-25)](https://developers.cloudflare.com/changelog/2025-03-25-higher-cpu-limits/) — MEDIUM
- [How KV works — Cloudflare KV docs](https://developers.cloudflare.com/kv/concepts/how-kv-works/) — MEDIUM
- [Cloudflare Workers KV: Consistency, CRUD, Caching, and Limits](https://eastondev.com/blog/en/posts/dev/20260422-cloudflare-workers-kv-guide/) — LOW–MEDIUM
- [Cloudflare Pages docs — Limits](https://developers.cloudflare.com/pages/platform/limits/index.md) — MEDIUM
- [Cloudflare Workers Cron Triggers: limits, minimum interval](https://crontap.com/blog/cloudflare-workers-cron-minute-limit) — LOW–MEDIUM
- [FIRST — Double Elimination Playoffs Update](https://www.firstinspires.org/robotics/frc/blog/2022-double-elimination-playoffs-update) — MEDIUM (official FIRST source)
- [Chief Delphi — 2023 Double Elimination Playoffs discussion](https://www.chiefdelphi.com/t/2023-double-elimination-playoffs/425155) — LOW–MEDIUM (community, generally reliable for FRC specifics)
- [FRC Games History PDF (alliance sizes 1999–2004 vs. 2005+)](https://www.chiefdelphi.com/uploads/short-url/gmZiqWIUGW5qU2FCA2N1eYvBXqM.pdf) — LOW–MEDIUM

Note: web search results could not be cross-verified against an official documentation MCP provider (context7/ref/jina) or a premium search provider (exa/tavily/brave/firecrawl) in this run — none were configured/available (`.planning/config.json` has all provider flags `false`). Findings above were corroborated across 2+ independent web sources where possible and are tagged MEDIUM per the project's confidence classifier; treat Cloudflare-specific numeric limits (10ms CPU, KV daily caps, cron trigger counts) as needing a final spot-check against `developers.cloudflare.com` at implementation time, since free-tier limits do change.

---
*Pitfalls research for: FRC match-prediction website (SigmaScout v3)*
*Researched: 2026-08-12*
