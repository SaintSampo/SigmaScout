# Phase 6: Team Pages - Context

**Gathered:** 2026-08-25
**Status:** Ready for planning

<domain>
## Phase Boundary

The team detail page — the destination Phase 5's Teams table and search box were
built to point at but could not, because it did not exist. Two tabs: a season
overview (identity, robot image, TBA link, record, win rate, metrics, then one
section per event listing that team's matches with predictions beside actuals)
and a metric-history plot across the season.

**Requirements:** TEAM-02 … TEAM-06

**In scope:** the `/team/{number}` route and its two tabs; the season header; per-event
match sections with the predicted-vs-actual band display; the metric-history chart;
the five pipeline/schema additions those views require plus the republish that
carries them; wiring the search box and Teams table to the new route; the two
folded todos (static-shell first paint, UI polish pass).

**Out of scope:** event detail pages and their tabs (Phase 7), the rank simulation
and the Compare accuracy table (Phase 8). Phase 6 touches Phase 4's publisher only
to add the fields enumerated in D-01…D-05 — it does not redesign the artifact layout.

**Starting state.** `apps/web` exists with the full Phase 5 shell. There is no team
route. `TeamSeasonArtifactSchema` is already published for every team-year-algorithm
(51,693 objects) and already carries `seasonStats`, per-event `matches[]`, and
`metricHistory[]`. Recharts is not installed.
</domain>

<decisions>
## Implementation Decisions

### Published-data additions (all ride one republish)

Five fields are added to the published team artifact. Each is a Phase 4 publisher
change; together they are paid for by a single full republish, measured at **~25 min
wall clock, 54,673 PUTs, 5.47% of one month's free-tier Class-A allowance**
(`docs/publish-budget.md`). Doing them as one batch rather than five runs is the
point of grouping them here.

- **D-01: Each alliance's OWN predicted-score variance is published separately.** Today only the red+blue **sum** is saved (`Prediction.variance`), because that sum
  is the win-probability denominator. The user's stated requirement drove this: a
  match display must show *"not just the total probability of a match win, but
  separately, the predicted scores for each alliance ± 1 SD — an alliance of three
  unpredictable robots will have a higher SD than 3 consistent robots."*

  **Verified satisfiable, not assumed.** Sigma1 tracks a **per-team** C×C covariance
  matrix built from that team's own residual history
  (`packages/core/algorithms/sigma1/covariance.ts` file header — explicitly per-team,
  never league-wide), and `sigma1/index.ts:684` already computes
  `redScoreVarianceOwn` / `blueScoreVarianceOwn` as `posteriorSum + covarianceTotal`
  to build the RP pmf, then discards them. Estimate uncertainty *and* performance
  spread are both in that number, so three streaky robots genuinely widen the band.
  This is publishing two numbers that already exist — not new modelling.

  Resolves the folded todo `publish-match-predictive-variance.md`. Its acceptance
  criteria (assert the published value against what `linkFunctions.ts` consumed;
  spot-check ±1σ coverage across a season; re-measure `docs/publish-budget.md`)
  carry into this phase unchanged.
  — **Reversibility:** costly — a published-schema field; removing it means another
  full republish and breaks any client already reading it.

- **D-02: Actual RP is carried through to the published match row.** TEAM-05 asks for
  it; today only the *prediction* is published, so every predicted RP sits beside a
  blank and is unfalsifiable on a site whose pitch is measurable accuracy. TBA's score
  breakdowns are already in the corpus — this is a carry-through, not new collection.
  — **Reversibility:** costly — published-schema field.

- **D-03: The robot image URL is resolved by the pipeline and published on the team artifact.** Ingest calls TBA's `/team/{key}/media/{year}`, picks the `preferred`
  entry where flagged and otherwise the first photo, and publishes the URL.

  **Measured before deciding** (20 sampled real 2024 teams): 15/20 have a robot photo,
  14/20 have a `preferred` flag, 16/20 have an avatar. Robot photos live at opaque
  Imgur/Instagram keys (`i.imgur.com/1kDEW6V.jpeg`) learnable only from the
  authenticated media API — they are **not** derivable from team+year.

  Browser-direct was **verified working** and then rejected: TBA's API does send
  `access-control-allow-origin` for our origin and explicitly allows the
  `x-tba-auth-key` request header (preflight tested 2026-08-25), so it would work —
  but it puts the API key in the shipped bundle and adds a round trip to an already
  breached load budget. A predictable unauthenticated avatar URL
  (`thebluealliance.com/avatar/{year}/{team}.png`, 200 for teams that have one, 403
  otherwise) also exists but serves a 40×40 logo, not a robot.

  The planner must handle the ~25% of teams with no photo with a fallback tile.
  Staleness is accepted: a photo uploaded mid-season appears at the next publish.
  — **Reversibility:** costly — published-schema field plus an ingest-side TBA call.

- **D-04: Per-metric percentiles are published.** Needed by the sketch-decided rarity
  tier system (Common 0–50 unboxed / Rare 50–75 / Epic 75–95 / Legendary 95–100).
  Client-side derivation was rejected on two grounds: NAV-06 forbids recomputing
  season statistics in the browser, and it would force a team page to download the
  1.4–2.7 MB teams artifact to tier a single row.
  — **Reversibility:** costly — published-schema field.

- **D-05: `activeYears` is published on the team artifact.** A short integer array of
  the seasons that team competed, feeding D-14's constrained year dropdown. Chosen
  over probing each season's URL (five extra round trips per page load, on a breached
  budget, to learn something the pipeline knows for free) and over a new per-team
  index artifact (~3,750 more objects and a second request to carry ~5 integers).

  **Bootstrap wrinkle the planner must handle:** the list is learned only by
  successfully fetching *some* year, so a link to a year the team did not play still
  404s before the dropdown can be constrained. This is precisely why D-15's empty
  state remains required — the two decisions are complementary, not overlapping.
  — **Reversibility:** costly — published-schema field.

### Match display

The event-page match display decided in sketch 003 (variant C) carries to the team
page: per alliance, a soft band for the predicted score ±1 SD, a solid tick at the
prediction, a ringed donut dot at the actual, all on **one shared horizontal axis
drawn once in a table header**. The overlap between the two bands *is* the win
probability, drawn rather than asserted. `references/uncertainty-display.md` in the
sketch-findings skill is binding here, including its "grey the loser's number, never
its mark" rule.

- **D-06: The shared axis domain is per team-season — this team's own range.**
  Chosen over a fixed field-wide season domain. Accepted tradeoff, stated explicitly:
  the scale means something different on every team page, so comparing bar *position*
  across two teams' pages is not valid.

  **Implementation note carried forward:** compute the domain across the **whole**
  team-season *including scheduled matches*, so the axis is stable once the schedule
  is known rather than creeping as results land. This is the mitigation for the sketch
  findings' open question *"Where does the shared domain come from?"* — do not
  implement it as min/max of played matches.

- **D-07: Red is always on top — the FRC/TBA/Statbotics convention.** The team is on
  red in some matches and blue in others; rather than reorienting rows, the team's own
  alliance is marked in place (highlighted row, or its three team numbers bolded), so
  positions never move. Rejected: putting this team's alliance on top, which reads
  "us vs them" instantly but swaps colour positions between rows.

- **D-08: A scheduled match uses the same row — both bands and the tick drawn, no actual dot.** The Actual column shows the scheduled time instead. The prediction is
  the interesting part before a match, so it is drawn at full weight; dimming was
  rejected because it de-emphasises the row a user at a competition most wants, and
  the sketch findings already warn against greying marks that carry alliance identity.
  Answers the sketch findings' second open question.

- **D-09: A single match list per event, with actual scores made optional.**
  `TeamSeasonMatchSchema` currently *requires* `actualWinner`/`actualRedScore`/
  `actualBlueScore`, so an unplayed match cannot exist in the team artifact at all —
  TEAM-04's "attended **or upcoming** event" is unbuildable as shipped. Chosen over
  mirroring the event artifact's separate `upcoming[]` array.

  **The tradeoff was raised and accepted:** relaxing the fields removes the type-level
  guarantee that a played match has a result. **The planner must replace that guarantee
  with a validation rule** (e.g. a played match — one with a result timestamp or in the
  played set — must carry scores), so the protection moves from the type system to a
  test rather than disappearing.
  — **Reversibility:** costly — loosening a published schema is easy; re-tightening it
  later requires every already-published artifact to satisfy the stricter shape.

- **D-10: Mobile uses horizontal scroll, matching the Teams table's D-04.** The plot needs ~470px against a ~390px phone. **This inherits Phase 5 D-04's declared risk
  verbatim:** a horizontal scroll region nested inside a vertical list makes the two
  touch gestures compete — and here it repeats once per event section rather than once
  per page. Phase 5 called this "a known implementation risk for research to solve, not
  discover." That instruction carries forward and is the single highest-risk item in
  this phase.

### Metric-history chart (TEAM-06)

- **D-11: Total only.** Sigma1 and EPA both expose 9 components plus Total for 2026
  (`apps/web/src/lib/metricKeys.ts`); ten lines is spaghetti. Per-component
  trajectories are deferred, not rejected — see Deferred Ideas.

- **D-12: X-axis is the team's own match sequence (1…n, evenly spaced), with event boundaries marked** by a labelled divider or tinted band. Note for the planner:
  `metricHistory[].matchIndex` is the team's position in the **season-wide**
  chronological stream, not a per-team counter — plotting against it directly leaves
  large gaps and is not what this decision means.

- **D-13: On algorithms with no spread, draw a plain line with no explanation.**
  `MetricValueSchema.spread` is present only for algorithms that model uncertainty, so
  OPR (Total only) and EPA (components, no spread) have no band to draw. The band
  simply does not appear. Rejected: an explanatory note, and hiding the tab entirely.

- **D-14 (charting): Recharts, dynamically imported so it loads only when the chart tab opens.** Keeps the stack's chosen library out of the overview tab's first paint.

  **This is not a repeat of D-19's failed route split.** That split deferred only ~11 KB
  on Teams because the weight sat in the shared vendor chunk, and it cost a serialized
  round trip — measured slower on every network profile and reverted (`29364417`).
  Recharts is used by exactly one tab and nothing else, so the deferral is real. The
  planner must still verify this with a measurement rather than assuming it.

### Page structure and URL

- **D-15 (route): `/team/1114` — plain team number.** What TBA and Statbotics both use,
  so it is typeable and guessable. Year and algorithm ride as search params like every
  other page. Rejected: `/team/frc1114` (internal key leaking into shared URLs) and
  `/team/1114/2026` (splits year handling across path and params, so the global year
  dropdown would behave differently on this one page).
  — **Reversibility:** costly — shared links outlive the code that made them (same
  envelope as Phase 5 D-14).

- **D-16 (tabs): the tab is a search param, `?tab=…`.** Per D-14's rule that anything
  shareable lives in the URL, typed via TanStack Router. The chart tab is linkable and
  back/forward move between tabs.

- **D-17 (header): Total plus every component, tier-boxed.** The same numbers the Teams table showed, so nothing changes meaning on click-through. **The tier tint earns its
  place specifically here:** the sketch findings concluded tiers are redundant on a
  sorted column (adjacent rows share a tier by construction) but valuable on component
  columns — and a single team's components genuinely span tiers. Their own worked
  example is team 3313, *Rare overall but Epic in Hub Auto*. A one-team view is where
  that signal is visible and a sorted table is where it is not.

- **D-18 (constrained year dropdown — user-originated): on a team page, the global year dropdown lists only the years that team actually competed.** Raised by the user while
  reviewing the empty-state question. This removes the *common* route to a
  wrong-year team page entirely; what remains is a shared/bookmarked link or a
  hand-edited URL. Depends on D-05's `activeYears`.

  Note the interaction with Phase 5's global-control decisions: D-11/D-12 treat the year
  dropdown as a global control whose options do not change per page. This is a
  deliberate, scoped exception for the team page, where the option set is genuinely
  team-dependent.

- **D-19 (empty state): keep the page, explain, offer the team's active years.** For a
  year the team did not compete, the header still shows the team's identity and the body
  says so, with the competing years as one-click links. Mirrors Phase 5 D-11's rule that
  a year change explains an empty result rather than discarding intent. Rejected:
  silently redirecting to the most recent active year (overrides the user's choice and
  desynchronises the dropdown from the URL — the exact bug D-14's typed params prevent).
  Still required despite D-18, per D-05's bootstrap note.

### Claude's Discretion

- The fallback treatment for the ~25% of teams with no robot photo (D-03).
- How the team's own alliance is marked within a red-on-top row (D-07) — highlighted
  row vs bolded team numbers.
- The exact form of the event-boundary marker on the chart (D-12).
- Whether the season header's component grid is a stat row, a compact table, or chips.

### Folded Todos

All three matched todos were folded into scope.

- **`publish-match-predictive-variance.md`** (tagged `resolves_phase: 6`, priority high)
  — the harness computes D-10's full predictive variance and never publishes it, so any
  match interval display is wrong. Directly implemented by **D-01**; its acceptance
  criteria carry over. This todo explicitly names itself as blocking TEAM-05.

- **`static-shell-first-paint.md`** — `apps/web` is a pure client-rendered SPA, so
  nothing paints until ~600 KB of JS executes. NAV-06's 2.5 s threshold is currently
  missed at **~4.06 s** on the congested-venue profile, which is the representative case
  for a competition weekend. Folded here because Phase 6 adds a chart library on top;
  fixing the budget belongs in the phase that would otherwise worsen it. Its acceptance
  criterion is binding: **re-measure with `docs/first-paint-measurement.md`'s fourth
  entry's method** (both builds, real CDP throttling, 4x CPU, median of three) and record
  before/after. It also states a hard constraint — **do not re-attempt route-level code
  splitting as the fix**; it was tried, measured slower on every profile, and reverted.

- **`ui-polish-pass.md`** — the user's Phase 5 sign-off note that the UI is *"too minimal
  and rough around the edges. There should be a little bit of color."* Folded so Phase 6's
  components are built on the final palette rather than resworn later. **Partly answered
  already:** the sketch sessions decided the rarity-tier palette and the "serious tool,
  more alive" direction, which supersedes sketch 001's visual direction. What remains
  open is the todo's question 1 — depth within the current system (alternating row tints,
  elevation, spacing rhythm, rank treatment, chips), all permitted today and unexplored.
  D-06's token discipline held through Phase 5, so this stays a token/CSS change rather
  than a component sweep.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design contracts (binding)

- `.claude/skills/sketch-findings-sigmascout/SKILL.md` — index; load before any UI work
- `.claude/skills/sketch-findings-sigmascout/references/uncertainty-display.md` — **the
  most important file for this phase.** The two ± are different quantities (D-09
  consistency vs D-10 predictive variance) and conflating them produced bands wrong by
  7–10σ in a real sketch. Also holds the selected match-table anatomy, the CSS/geometry
  patterns, and the alliance colour tokens.
- `.claude/skills/sketch-findings-sigmascout/references/chart-craft.md` — derive coupled
  geometry, grouping is proximity (needed ~4× separation before pairing read correctly),
  render-and-look, grey the number not the mark
- `.claude/skills/sketch-findings-sigmascout/references/colour-and-tiers.md` — the tier
  cuts and hex values for D-17; **the tier blue must stay sky `#0EA5E9`**, never true
  blue (ΔE 1.3 deutan against rarity purple)
- `.claude/skills/sketch-findings-sigmascout/sources/003-alliance-axes/` — the winning
  variant running against real data
- `.planning/phases/05-site-shell-navigation-browsing/05-UI-SPEC.md` — the Phase 5 design
  contract this phase inherits and, per the folded UI-polish todo, may deepen

### Prior-phase decisions this phase is bound by

- `.planning/phases/05-site-shell-navigation-browsing/05-CONTEXT.md` — D-04 (mobile
  horizontal-scroll gesture risk, inherited by D-10), D-05/D-06 (visual direction, token
  discipline), D-07 (uncertainty always visible at secondary weight), D-11/D-12/D-13
  (year and algorithm switching), D-14 (URL carries shareable state), D-17a (hostname
  split), D-18 (R2 CORS), D-19 + its NOT-ACHIEVED outcome (why route splitting is
  forbidden as a first-paint fix)
- `.planning/phases/04-publish-live-update-pipeline/04-CONTEXT.md` — D-01 (one file per
  page), D-02 (algorithm version in the path), D-05 (payload budget), D-07 (team artifact
  holds everything the page renders — do not split it), D-25 (browser reads artifacts
  from the R2 domain, no compute in the path), D-26 (cache headers)
- `.planning/phases/02-prediction-models-epa-sigma1/02-CONTEXT.md` — **D-09 and D-10 are
  the two ± definitions** underpinning D-01 here; D-12 (link function modes), D-21 (raw
  numbers only), D-24 (component predictions), D-27/D-28 (metric and history shapes)

### Folded todos (acceptance criteria are binding)

- `.planning/todos/pending/publish-match-predictive-variance.md`
- `.planning/todos/pending/static-shell-first-paint.md`
- `.planning/todos/pending/ui-polish-pass.md`

### Measurement baselines

- `docs/publish-budget.md` — the republish cost model and the machine-readable budget
  block read by `packages/harness/payloadBudget.test.ts`. **Every schema addition in
  D-01…D-05 must re-measure this**; the team artifact is already the second at-risk
  page kind (max 287,264 B for `frc118/2024`).
- `docs/first-paint-measurement.md` — four dated entries and the full methodology the
  static-shell todo requires reusing

### Code contracts

- `packages/harness/pageArtifacts.ts` — `TeamSeasonArtifactSchema`,
  `TeamSeasonMatchSchema`, `artifactKey`; the file header states the two rules every
  schema obeys (raw numbers only; the two ± never merged)
- `packages/harness/metricHistorySchema.ts` — `MetricHistoryRowSchema`, and its header's
  warning about Node built-ins on the browser import graph
- `packages/harness/publish.ts` — `buildTeamSeasonArtifact` and the rounding boundary
- `packages/core/algorithms/sigma1/index.ts` — `predict()`; **line 684 is where D-01's
  two values already exist**
- `packages/core/algorithms/sigma1/covariance.ts` — the per-team covariance model that
  makes D-01's user requirement satisfiable

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `apps/web/src/lib/api/teams.ts` / `events.ts` — the established fetch + Zod-validate +
  TanStack Query pattern; the team-artifact fetcher should mirror it exactly
- `apps/web/src/lib/metricKeys.ts` — `metricKeysFor(algorithmId, season)` already returns
  the correct column set per algorithm-season; the season header (D-17) and the chart
  (D-11) both key off it rather than inspecting a fetched row
- `apps/web/src/components/MetricValue.tsx` — the `X ± Y` renderer with the band at
  secondary weight (Phase 5 D-07). The season header should reuse it, extended for D-17's
  tier box.
- `apps/web/src/components/Skeletons.tsx`, `StateViews.tsx` — first-load skeleton (D-16)
  and error/empty states; D-19's empty state is a new member of this family
- `apps/web/src/components/ui/*` — table, badge, button, separator, sheet primitives
- `apps/web/src/lib/artifactOrigin.ts` — the `data.sigmascout.org` origin resolver
- `apps/web/src/lib/searchParams.ts` + `resolveSortKey.ts` — typed search-param handling
  and the algorithm-switch fallback pattern D-16 extends with a `tab` param

### Established Patterns

- **Deep relative imports with explicit `.js`** into `packages/core/...` — there is no
  `@sigmascout/*` workspace alias anywhere (`05-PATTERNS.md`)
- **Browser-safe schema leaves.** `metricHistorySchema.ts` exists specifically because
  importing from a module with top-level `node:fs` drags Node built-ins into the browser
  bundle. Any new shared schema must respect this; `browserSafeSchemas.test.ts` enforces it.
- **Assembly functions parse through their Zod schema before returning**
  (`publish.ts` header, T-04-22), so an invalid artifact can never be uploaded
- **Rounding happens only at the publish boundary** (`rounding.ts`) — D-01/D-02's new
  fields need `ROUNDING_RULE` entries

### Integration Points

- `apps/web/src/components/search/SearchBox.tsx:221` — a team hit currently navigates to
  `/teams`; this phase points it at `/team/{number}`. Its `SearchNavigate` type at line 52
  is a narrow union of `"/teams" | "/events"` and must widen.
- `apps/web/src/components/teams-table/columns.tsx` — team number / nickname cells become
  links to the new route
- `apps/web/src/components/ribbon/YearSelect.tsx` — D-18 makes its option set
  page-dependent for the first time
- `apps/web/src/routes/` — a new route module joins `teams`, `events`, `compare`
- `packages/harness/publish.ts` `buildTeamSeasonArtifact` — the single funnel for
  D-01…D-05
- `packages/ingest/` — D-03's new TBA media call

</code_context>

<specifics>
## Specific Ideas

- **The user's framing of the app's central tension, which drove D-01 verbatim:** *"There
  are a few things a match prediction should show. Not just the total probability of a
  match win, but separately, the predicted scores for each alliance +/- 1 SD. An alliance
  of three unpredictable robots will have a higher SD than 3 consistent robots."* The two
  jobs named — compute the best prediction, and display it so anyone can understand it —
  are the standard this phase's match display is measured against.

- **The user's design addition (D-18):** on a team page the year dropdown should list only
  the years that team played. Raised unprompted while reviewing the empty-state question.

- **Statbotics and TBA remain the yardstick** for conventions: the `/team/1114` URL shape
  (D-15) and red-on-top alliance ordering (D-07) were both chosen because those two sites
  already do it.

</specifics>

<deferred>
## Deferred Ideas

- **Per-component metric trajectories on the chart** — deferred by D-11, which ships Total
  only. The data is already published in `metricHistory[]`, so this is additive whenever
  it is wanted: a legend/chip row toggling components onto the same axes, or small
  multiples. Nothing in this phase's decisions blocks it.

- **Explaining the missing variance band** on OPR/EPA — deferred by D-13. If users read
  the vanishing band as a bug rather than a property of the algorithm, a one-line note is
  the cheap fix.

- **Revisiting the palette itself** (`ui-polish-pass.md`'s question 2 — whether 60/30/10
  near-monochrome suits this audience at all) — the folded todo's question 1 (depth within
  the current system) is in scope for this phase; the base-palette question is not. It
  touches every component in Phases 5–8 and wants designing rather than improvising.

- **Cross-team comparison of match-plot bar positions** — foreclosed by D-06's per-team
  domain, and noted here so a later reader does not assume it works. A fixed field-wide
  season scale would enable it, at the cost of compressing a mid-tier team's matches.

- **Surfacing per-algorithm freshness** — carried forward from Phase 5's deferred list,
  still not part of this phase.

</deferred>

---

*Phase: 6-team-pages*
*Context gathered: 2026-08-25*
