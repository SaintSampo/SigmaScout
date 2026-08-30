# Phase 8: Simulation & Compare - Context

**Gathered:** 2026-08-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 8 ships the two headline differentiators: the event page's **Simulation tab**
(EVNT-07) and the public **Compare accuracy table** (COMP-01, EVAL-05).

**In scope:**
- A sixth event-page tab, `simulation`, where the user picks a start match and the
  remaining **qualification** matches are simulated 1000× in the browser, producing a
  predicted rank distribution per team.
- One publisher change plus a full republish: `redRpPmf`/`blueRpPmf` on **played**
  event matches (see D-01).
- The Compare page at `apps/web/src/routes/compare.tsx`, replacing the 21-line Phase 5
  placeholder, reading the already-published `v1/compare/{year}.json`.
- An automated check that the Compare page's rendered numbers equal the harness's
  versioned artifact (EVAL-05, ROADMAP SC-4).
- A measured comparison quantifying the rewind-overconfidence gap (D-01's control run).

**Out of scope:**
- Any change to the tune/holdout split itself, to the hyperparameter search, or to
  algorithm versioning. Rolling-origin tuning is deferred to its own post-v1.0 phase
  (see `<deferred>`).
- Elimination-match or alliance-selection simulation. SC-1 scopes this to remaining
  **qualification** matches.
- Base-palette changes. `ui-polish-pass.md` question 2 stays deferred, exactly as
  Phase 7 D-21 left it.

</domain>

<decisions>
## Implementation Decisions

### Simulation inputs and the rewind-honesty question

- **D-01: The simulation uses each match's own stored, as-of-that-match prediction, and
  the phase measures how wrong that is rather than hand-waving it.**

  **The mechanism, so downstream agents do not re-derive it.** The harness walks an event
  match by match: predict from everything seen so far, then fold in that match's result.
  The stored prediction for qual 50 is therefore what the model believed *right before
  qual 50 was played* — after digesting matches 1–49.

  **The live case is exact and needs nothing.** `publish.ts:1733` calls
  `algorithm.predict(state, match)` with a **single shared `state`** for every scheduled
  match, so all unplayed matches already carry predictions from one common model state
  (the state after the last match actually played). A simulation started at any unplayed
  match is leak-free by construction. This is the 2027 live-event case the feature exists
  for.

  **The rewind case is approximate and must say so.** Starting at an already-played match
  means later matches' stored predictions already absorbed results the simulation is
  pretending have not happened. The error is *not* a wrong winner — it is
  **overconfidence**: the rank distribution comes out narrower than an honest from-here
  forecast.

  **Why this option and not a frozen-state one — measured, not assumed:**

  | Option | Added bytes | Worst-case event artifact | Verdict |
  |---|---|---|---|
  | Stored predictions + pmfs on played matches | +84 B/match | 327,261 → ~340,000 (budget 350,000) | **chosen** |
  | + pre-event frozen set, inline | +174 B/match | ~354,261 — **over budget** | rejected |
  | Sidecar checkpoint artifact (~10 checkpoints) | ~38 KB/event, separate object | untouched | runner-up |
  | Freeze at every possible start point | ~950 KB/event | dead | rejected |
  | Publish per-match team state | n/a | does not even work — see below | rejected |

  Per-match team state does **not** solve this: the browser still cannot rebuild an RP
  distribution from it, because Phase 7 D-11 locks that combined figures are computed
  where the covariance lives, never client-side.

  **Rationale on record:** the user's stated constraint was "saving extra data vs
  simulation accuracy … find the best middleground". This option is the cheapest that
  works, is exact for the case that actually matters, and buys the evidence needed to
  decide whether the sidecar is ever worth building.
  — **Reversibility:** costly — adding `redRpPmf`/`blueRpPmf` to `EventMatchSchema` is a
  published-contract change carried by a full republish (`docs/publish-budget.md` measures
  one at ~23–25 minutes and 54,671 PUTs, ~5.5% of a month's free-tier Class-A ops).
  Removing them later means another republish.

- **D-02: The phase measures the rewind-overconfidence gap and publishes the number.**
  Build a small frozen-prediction control on roughly 5 events, run the simulation both
  ways, and compare rank-distribution widths. The on-page caption must state the measured
  figure ("rank spread is ~X% narrower than a true from-here forecast"), not a vague
  hedge. If the gap turns out large, that is the evidence for a later sidecar-checkpoint
  phase; if small, the question closes.

  **Planner note:** this is a real task with real output, not a footnote. It is the only
  thing standing between D-01 and an unquantified honesty claim on a site whose entire
  premise is honest uncertainty.

- **D-03: `redRpPmf`/`blueRpPmf` are added to `EventMatchSchema` (played matches) and
  populated in the same republish.** Measured shape: always length 7, mean 2.31 non-zero
  entries, ~84 bytes per match for both alliances including key names. A sparse
  index/value encoding was tested and **rejected** — it saved 6 bytes out of 1,017 (index
  overhead cancels the zeros), so dense stays.

  These values already exist in the harness: `TeamSeasonMatchSchema` publishes them on
  played matches today (verified live on `frc254/2025`). This is a publisher plumbing
  change, not new computation.
  — **Reversibility:** costly — see D-01.

- **D-04: The Simulation tab is VPR-only, and is plain-disabled on OPR and EPA.**
  Verified live: the OPR event artifact carries no `redRpPmf` and no
  `redScoreVarianceOwn` at all — OPR and EPA model neither RP nor variance, so the
  simulation genuinely cannot run on them. Treatment follows **Phase 7 D-17** exactly:
  visible, greyed, unclickable, **no explanation**. Chosen over an explained disabled
  state so the event page keeps one consistent rule for "tab you cannot use."
  **Known cost, chosen anyway:** a user on OPR sees a dead tab with no hint that switching
  to VPR in the global dropdown would enable it.

### Simulation display

- **D-05: Each team's row shows median rank, a drawn 10th–90th percentile band on a
  shared rank axis, and a per-row histogram of the full rank distribution.**

  Percentile bands rather than mean ± SD, for two reasons that are not stylistic:
  1. Rank is bounded (1..N), integer, and skewed. A team at mean rank 3.0 with SD 4.0
     yields a ±1 SD band of **−1.0 to 7.0**, and rank −1 does not exist. Percentiles read
     straight off the 1000 draws are always in range and assume no distribution.
  2. Phase 7 **D-01** locks that every `±` on this site means exactly 1 SD of full
     predictive variance. A rank spread is not that quantity, so labelling it `±` would
     break a rule the site already enforces everywhere else. The band must therefore be
     labelled as a 10th–90th percentile range, never with a `±` glyph.

  The band is **drawn**, not just printed — `sketch-findings-sigmascout`'s "the ± gets
  drawn, not just printed" applies. The per-row histogram exists because a median and a
  band both hide bimodality: a team that either captains or misses entirely looks
  identical to a steady mid-pack team under summary statistics alone.

  **Planner note:** `chart-craft.md` requires mocking a chart against the real
  distribution before committing to it. Do that for the histogram before building it.

- **D-06: No "probability of finishing top 8" / alliance-captain column.** Explicitly
  dropped by the user: *"I dont actually care about how close teams are to ranking top 8,
  dont include that feature."* This also removes a complication that would otherwise have
  needed handling — the captain cutoff is **not** universally 8: measured across the
  corpus, 1,193 of 1,355 events run 8 alliances, but 104 run 4 and 22 run 6, so any
  cutoff column would have had to derive its threshold per event. Not needed now.

- **D-07: The 1000 draws run in a browser Web Worker, with live progress shown during the
  run and total elapsed time shown on completion.** `apps/web` has no Web Worker today —
  this is the first, so the planner should expect Vite worker-bundling setup as real work
  rather than an import. The user's framing: *"I love the timer idea. lets have some kind
  of way to indicate live progress too, and then they see the total time running the sim
  took."*

  **Accepted consequence:** no committed benchmark file, so runtime is not
  regression-testable and varies by visitor hardware. **Planner note:** ROADMAP SC-2 says
  runtime must be "measured and recorded". To give "recorded" a durable home without
  building a benchmark harness, capture one representative measured runtime into the phase
  SUMMARY at execution time. Otherwise `/gsd-verify-phase` may reasonably read SC-2 as
  unmet.

### Compare page

- **D-08: One uniform table across all five seasons — no tune/holdout tiering, grouping,
  or differential emphasis — plus a single methodology note.** The note states which
  seasons the hyperparameter search saw, and shows the evidence that it did not flatter
  VPR: tune-season Brier 0.1592 / 0.1687 / 0.1761 versus holdout 0.1617 / 0.1501 — holdout
  sits *inside* the tune range and the single best season (2026, 0.1501) is a holdout one.
  If the fixed split were flattering VPR, holdout would be visibly worse; it is not.

  This is a **presentation** decision only. It does not amend EVAL-04, which remains in
  force as a methodology rule — the split still exists in the artifact (`seasonLabel`,
  `headlineEligible`) and is disclosed in the note; it simply is not the table's organising
  principle.

- **D-09: The page surfaces everything the artifact carries** — winner accuracy and Brier
  per algorithm per year, the qualification / elimination / combined split, the 10-bin
  calibration curves, and the exclusion counts.

  The compLevel split earns its place: in 2025, **OPR beats EPA on elimination matches**
  (Brier 0.1767 vs 0.1897) while losing badly on quals (0.2192 vs 0.1950) — a real finding
  about event-scoped OPR that a combined-only table erases.

  The exclusion counts need careful wording. Offseason matches **feed the model but are
  excluded from scoring** — that distinction is why `exclusionCounts.offseason` is 5,915
  for 2025 while the Brier figures already reflect the offseason-inclusive stream
  (re-measured 2026-08-30, `docs/models/offseason-inclusion-remeasurement.md`). Do not
  word this as "offseason events are ignored"; they are not.

- **D-11: Differences too small to call render as a visual TIE, not as a defeat.** Added
  2026-08-30 after sketch 007 measured something neither this phase nor SC-3 had exposed:
  VPR wins Brier in all 15 season × view slices, but loses **winner accuracy** to OPR on
  elimination matches in 2022, 2024 and 2025.

  | Season | VPR | OPR | Gap | In matches | Naive 1 SE |
  |---|---|---|---|---|---|
  | 2022 | .7824 | .7930 | 1.06pp | ~28 of 2,613 | 1.14pp |
  | 2024 | .7092 | .7094 | **0.02pp** | **0.6 of 2,867** | 1.20pp |
  | 2025 | .7552 | .7578 | 0.25pp | ~8 of 3,056 | 1.10pp |

  Every gap is inside one standard error; 2024's is smaller than a single match. **Caveat
  stated so nobody over-reads it:** that SE treats the algorithms as independent when they
  are scored on the same matches. A paired (McNemar) test would use a smaller error and
  might find 2022's gap real — but it needs the count of matches where the two disagreed,
  which the artifact does not publish. The defensible claim is therefore narrow: *the
  published data cannot tell a reader whether these gaps are real.*

  So: below a chosen threshold, both values render in full ink, neither greyed. The page
  must state that the threshold is a judgement call, not a computed significance level.
  Rejected: publishing bootstrap intervals or paired-disagreement counts (real harness +
  publisher work plus a republish on an already-sizeable phase), and declaring winners
  regardless of margin.

  This **qualifies** `chart-craft.md`'s "grey the loser's number, never its mark" — that
  rule assumes a loser exists. Where the data cannot establish one, neither value is greyed.

  **This does NOT touch SC-3**, which is measured on the combined view, where VPR wins both
  metrics in both holdout seasons. This is a sub-slice the Compare page exposes for the
  first time.

- **D-10: Parity check (SC-4) is a Vitest component test rendering the Compare page
  against a committed copy of a real published `v1/compare/{year}.json`.** Chosen on the
  user's instruction to take the least time. Hermetic, no network, fast.

  **Stated limitation, recorded so nobody mistakes its reach:** this proves the *page* is
  faithful to the *artifact*. It cannot catch the published artifact drifting away from
  what the harness actually produced. If that coverage is wanted later, the existing
  pattern to copy is `apps/web/e2e/event-live-artifact.spec.ts`, which fetches artifacts
  from the real R2 origin inside Playwright.

### Claude's Discretion

- Where `simulation` sits in the tab strip (expected: sixth, after Elims) and how the
  six-tab strip behaves on a phone. Phase 7 left this open explicitly: *"the tab strip's
  behaviour on a phone with five tabs (six once Phase 8 adds Simulation)."*
- The start-match picker's form — dropdown, slider, or click-a-row-in-a-list.
- Whether the simulation auto-runs on tab open or waits for an explicit button.
- The rank axis's domain and how the shared scale is computed.
- The Compare page's layout, and how the three compLevel views are switched between.
- How the calibration curve is drawn, and the plain-language explainer that accompanies
  it, since calibration is unfamiliar to most of this audience.
- Depth-within-the-current-system polish on both new surfaces per `ui-polish-pass.md`
  question 1 — row tints, elevation, spacing rhythm, chips. **The base-palette question
  (that todo's question 2) stays deferred**; no `--color-*`, `--accent`, `--alliance-*` or
  `--tier-*` value changes in this phase.

### Folded Todos

- **`ui-polish-pass.md`** (priority high) — folded at question-1 depth only, exactly as
  Phase 7 folded it. See Claude's Discretion above.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Prior-phase decisions this phase is bound by
- `.planning/phases/07-event-pages/07-CONTEXT.md` — D-01 (every `±` is 1 SD of full
  predictive variance; constrains D-05 here), D-11 (combined figures computed where the
  covariance lives, never in the browser; rules out client-side RP reconstruction), D-13
  (`matches[]` and `upcoming[]` stay separate specifically so this phase's simulation input
  is untouched), D-17 (plain-disabled tab treatment, inherited by D-04 here), D-21
  (cross-cutting-change precedent).
- `.planning/phases/06-team-pages/06-CONTEXT.md` — D-06 (played-and-scheduled axis
  computation), D-08 (unplayed-row treatment).

### Design contract
- `.claude/skills/sketch-findings-sigmascout/SKILL.md` — the index; load before any UI work.
- `.claude/skills/sketch-findings-sigmascout/references/uncertainty-display.md` — **read
  before building the rank band.** One ± quantity everywhere; drawing a band from partial
  variance produces bands wrong by 7–10σ.
- `.claude/skills/sketch-findings-sigmascout/references/chart-craft.md` — **read before
  building the histogram.** Derive coupled geometry; mock against the real distribution.
- `.claude/skills/sketch-findings-sigmascout/references/colour-and-tiers.md` — tier palette
  and the CVD constraint (tier blue must stay sky `#0EA5E9`).

### Model and methodology
- `docs/models/offseason-inclusion-remeasurement.md` — why offseason matches feed the model
  but are excluded from scoring; the 2026-08-30 re-measurement behind D-09's wording.
- `docs/models/sigma1-tuning-results.md` — the tune/holdout split's origin and the SC-3
  verdict tables behind D-08's no-overfitting evidence.
- `docs/models/opr-baseline-change.md` — why OPR is event-scoped, which is why it carries
  no cross-event state and no variance (D-04).
- `docs/publish-budget.md` — the 350,000-byte `event/{eventKey}` ceiling, the current
  327,261-byte max, and the ~23–25 min / 54,671 PUT cost of a full republish.

### Schemas and code contracts
- `packages/harness/pageArtifacts.ts` — `EventMatchSchema` (line ~290, gains D-03's
  fields), `EventUpcomingMatchSchema` (~351, the shape to mirror), `CompareArtifactSchema`
  (~930) and `CompareSliceSchema` (~906).
- `packages/harness/publish.ts` — `buildCompareArtifact` (~1039), `buildEventArtifact`
  (~281), and the shared-state prediction call at line 1733 that D-01 rests on.
- `packages/harness/score.ts` — `TUNE_SEASONS` / `HOLDOUT_SEASONS` and `seasonSplit`.
- `packages/harness/rounding.ts` — every new numeric field needs a `ROUNDING_RULE` entry;
  rounding happens only at the publish boundary.
- `.claude/CLAUDE.md` — secrets discipline; the TBA key is reached via
  `tsx --env-file=.env`, never read or echoed.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`v1/compare/{year}.json` is already published and live** — five files, ~14 KB each,
  nine slices per year (3 algorithms × 3 compLevel views). Carries `brierScore`,
  `winnerAccuracy`, `scoredCount`, `tieCount`, `noCallCount`, `exclusionCounts`,
  `candidateCount`, 10 `calibrationBins`, `seasonLabel`, `headlineEligible`. The Compare
  page is a UI-and-proof job, **not** a pipeline job.
- `apps/web/src/lib/artifactOrigin.ts` — `artifactUrl()` is the only place an artifact host
  string may appear; every fetcher builds through it.
- `apps/web/src/components/MetricValue.tsx`, the `.alliance-chip` pattern from
  `06-09-PLAN.md`, and the event page's existing tab machinery.
- `apps/web/e2e/event-live-artifact.spec.ts` — the established pattern for asserting
  against real published bytes, if the parity check is ever widened past D-10.

### Established Patterns
- **Deep relative imports with explicit `.js`** into `packages/core/...`; there is no
  `@sigmascout/*` workspace alias.
- **Browser-safe schema leaves** — importing from a module with top-level `node:fs` drags
  Node built-ins into the browser bundle; `browserSafeSchemas.test.ts` enforces the split.
  The simulation's Web Worker must respect this.
- **Assembly functions parse through their Zod schema before returning**, so an invalid
  artifact can never be uploaded.
- **Rounding only at the publish boundary** (`rounding.ts`) — D-03's new fields need a
  `ROUNDING_RULE` entry. Note the existing precedent that Brier/accuracy/calibration
  figures are deliberately **unrounded**.
- URL-shareable state lives in typed router search params, never in a store.

### Integration Points
- `apps/web/src/lib/searchParams.ts:229` — `EVENT_TABS` is a fixed five-id tuple; this
  phase adds `"simulation"` as the sixth. `DEFAULT_EVENT_TAB` stays `insights`.
- `apps/web/src/routes/event.$eventKey.tsx` — `REGISTERED_EVENT_TABS` grows by one.
- `apps/web/src/routes/compare.tsx` — the 21-line Phase 5 placeholder is replaced wholesale.
- `packages/harness/pageArtifacts.ts` `EventMatchSchema` + `packages/harness/publish.ts`
  `buildEventArtifact` — the single funnel for D-03.
- A new Web Worker module under `apps/web/src`, plus whatever Vite worker config it needs.

### Measured facts the planner should not re-derive
- **Only 41 of 1,353 corpus events have any unplayed qualification match** (2022: 11,
  2023: 5, 2024: 12, 2025: 12, 2026: 1), and most are abandoned offseason events. A
  simulation restricted to genuinely-unplayed matches would be empty on 97% of browsable
  events. This is why D-01 allows rewind at all.
- Event sizes: 1,353 events with quals, **average 63 quals, maximum 135** (`2024wvrox`).
  Largest team count 78.
- RP pmfs are **VPR-only**; OPR and EPA carry neither pmfs nor variances.
- Event artifact budget: `budgetMaxBytes` 350,000; current max 327,261 → **22,739 bytes of
  headroom**. D-03 consumes roughly 13,000 of it at the largest event.

</code_context>

<specifics>
## Specific Ideas

- **The user's framing that produced D-01, verbatim:** *"I want your honest opinion on this
  one. Im including this feature because statbotics does. the constrais are saving extra
  data vs simulation accuracy. rank 3 solutions on thise constraints. I want to find the
  best middleground."* The decision was made against a ranked cost table, not a preference.

- **An unverified claim that informed the recommendation, flagged as such:** my
  understanding is that Statbotics' own simulation uses present-day ratings for every
  simulated match, which for a finished event means end-of-event ratings throughout —
  *more* hindsight than D-01, not less. This was presented to the user as understanding
  rather than verified fact and should not be repeated as established without checking.

- **The user's push on tune/holdout, verbatim:** *"I want to revisit the nessecity of tune
  vs holdout seasons. I really feel like there should be no difference. I get that it is a
  check on overfitting, but I really want a more clever solution."* This produced D-08's
  uniform presentation for Phase 8 and the deferred rolling-origin phase below. The
  ceiling was stated at decision time and accepted: **no temporally honest scheme can make
  all five seasons headline-eligible** — 2022 has nothing before it — so the realistic
  ceiling is 3–4 headline seasons, not 5.

- **On the top-8 column, verbatim:** *"I dont actually care about how close teams are to
  ranking top 8, dont include that feature."*

</specifics>

<deferred>
## Deferred Ideas

- **Rolling-origin hyperparameter tuning — its own phase, after v1.0.** Replace the fixed
  tune/holdout split by tuning only on seasons strictly before the season being scored
  (score 2023 tuned on 2022; score 2024 tuned on 2022–23; score 2025 on 2022–24; score 2026
  on 2022–25). Every scored season becomes genuinely out-of-sample, taking headline seasons
  from 2 to 3–4 and removing the split at its source rather than in the presentation. It
  lifts the project's existing match-level "predict strictly before you update" discipline
  up to the hyperparameter level, closing the one place that rule currently does not reach.

  **Known costs, established during this discussion:** four hyperparameter searches instead
  of one (Phase 3's two-stage screen over the 9 surviving params, run four times — offline
  Node, wall-clock not money); **four parameter sets**, which collides with Phase 3's
  versioning contract, since `data/algorithm-versions/vpr@2.1.0+tuned-2026-08.json` is a
  single promoted set whose prediction-stream digest is enforced as a CI gate — the promote
  path and digest gate both need rework; re-measurement of SC-3's 8/8 verdict, every
  published artifact, and `docs/models/sigma1-tuning-results.md`; and a new decision about
  which param set the live 2027 site uses (presumably the 2026-evaluation set).

- **Sidecar checkpoint simulation artifact.** The runner-up to D-01: a separate
  `v1/sim/{eventKey}/...` object holding frozen prediction sets at ~10 checkpoints per
  event (~38 KB/event, VPR-only, ~35 MB total), with the start-match picker snapping to the
  checkpoint at-or-before the chosen match so the model is *less* informed than truth and
  the rank distribution errs **wide rather than narrow**. Not built now because D-02's
  measurement has not yet shown the gap is large enough to warrant it. **D-02's output is
  the trigger for revisiting this.**

- **Elimination-bracket simulation and alliance-selection prediction.** Out of SC-1's
  qualification-only fence; would be its own phase.

### Reviewed Todos (not folded)

- **`publish-as-of-match-team-metrics.md`** (priority medium) — reviewed and **not folded**.
  It was examined closely as the enabler for a freeze-at-start-match simulation and
  rejected for that purpose on a substantive ground: per-match team state alone does not
  let the browser rebuild an RP distribution, because Phase 7 D-11 requires combined
  figures to be computed where the covariance lives. Its original purpose — testing the
  alliance-uncertainty identity — is untouched by this phase and remains open.

</deferred>

---

*Phase: 08-simulation-compare*
*Context gathered: 2026-08-30*
