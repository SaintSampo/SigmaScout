---
status: partial
phase: 06-team-pages
source: [06-VERIFICATION.md]
started: 2026-08-25T20:20:00Z
updated: 2026-08-26T01:45:00Z
---

## Current Test

[testing complete — 2 issues, 1 blocked]

## Tests

### 1. Push and deploy, then re-run the four deployed-origin e2e specs
expected: After pushing local `main` to `origin/main` and letting Cloudflare Pages redeploy, re-run `pnpm --filter web test:e2e -- team-page`, `-- no-page-pan`, `-- touch-scroll`, and `-- static-shell`. All four pass against the real deployed build.
result: pass
resolved_at: 2026-08-26
resolution: |
  PASSES now — full suite 40/40 against the deployed origin. Getting there took two real fixes,
  both recorded below; the original run was 36/40.
    - App: three compounding layout defects (dead data-orientation variants in tabs.tsx, missing
      min-w-0 on the overview panel, no page max-width). See G-06-1.
    - Spec: touch-scroll.spec.ts:197 dragged at y=2039 on a 681px viewport — its own coordinate
      bug, invisible for as long as the deploy was stale.
first_run: "36 passed / 4 failed — no-page-pan:84 and touch-scroll:197 on both iphone-17 and pixel-10"

deploy_correction: |
  The premise of this test was wrong. There is NO git-integrated deploy for sigmascout.org:
  pushing to origin/main does not redeploy it. `.github/workflows/deploy.yml` is a leftover v2
  workflow targeting GitHub Pages that dies in 13s at setup-node ("Dependencies lock file is not
  found ... package-lock.json") and has never reached its build step. The only deploy path is the
  manual `pnpm --filter web run deploy` (`wrangler pages deploy dist --project-name
  sigmascout-web`), which was run here to unblock the test.

harness_note: |
  `pnpm --filter web test:e2e -- <spec>` does NOT filter — pnpm forwards `--` as a literal
  argv entry (`playwright test "--" "team-page"`) and Playwright then runs the whole suite. All
  four commands in this test's text are therefore the same command. Use
  `pnpm --filter web exec playwright test <spec>` to filter. Full-suite result: 36 passed, 4 failed.

note: |
  Blocking cause, confirmed independently during verification: local `main` (`5c8af78c`) is 125
  commits ahead of `origin/main` (still `79ca50be`, the Phase 5 HEAD), and a live fetch of
  https://sigmascout.org/ returns the OLD empty-`#root` index.html with no static-shell markup.
  `apps/web/playwright.config.ts` has no local `webServer` and targets the deployed origin
  exclusively, because R2 CORS does not allow-list localhost. These specs structurally cannot pass
  until this code ships. This is a deploy gap, not a code defect.

  Do this test FIRST — tests 2 and 3 are easier once the code is live.

### 2. Real-device iOS Safari touch-gesture check
expected: On a real iPhone in Safari, open a team page with >=2 event sections (e.g. frc118/2024). Dragging horizontally inside the first event's match table scrolls only that table — the page must not pan sideways. Repeat in the second section: same result, and the first section must not move. Dragging vertically over a match table scrolls the page normally. Dragging diagonally must not stick to the wrong axis.
result: blocked
blocked_by: physical-device
reason: "I dont even have an iphone"
resolution: accepted-risk
resolved_at: 2026-08-26
resolution_note: |
  Closed as an ACCEPTED RISK by explicit decision, not as a pass and not as a deferral. The full
  reasoning — what is verified, what a Chromium/CDP pass is and is not evidence of, the specific
  exposure, and the routes that would close it later — is recorded under "## Accepted Gaps" in
  06-VERIFICATION.md. Phase 6 closes with this gap visible in the record.

blocked_detail: |
  Not a scheduling problem — the hardware is not available to this project at all, so this check
  cannot be discharged by re-running it later. D-10's real-device question therefore stays OPEN
  for Phase 6 and must be carried forward rather than silently closed.

  Two consequences worth stating plainly:
  1. The Chromium/CDP specs (touch-scroll.spec.ts) drive Playwright's touch dispatcher, NOT WebKit
     gesture arbitration. 06-RESEARCH.md Pitfall 6 documents historical iOS Safari gaps for a
     directional `touch-action` inside a different-axis outer scroller. A green suite is not
     evidence about iOS, and no amount of re-running it becomes evidence.
  2. Any future iOS regression here will land unobserved. If real-device coverage matters for
     D-10, it needs a route that does not depend on owning the hardware — a borrowed device, a
     hosted real-device lab, or an explicit accepted-risk decision recorded in the roadmap.

  Options if this needs closing later: BrowserStack/Sauce Labs real-device session, an iPad or
  borrowed iPhone (same WebKit gesture engine), or recording it as accepted risk.

note: |
  This is the phase's own named highest-risk item (D-10). The defect it guards against already
  shipped once and was caught at real-device sign-off — not by any spec. 06-RESEARCH.md Pitfall 6
  documents historical iOS Safari gaps for directional `touch-action` inside a different-axis outer
  scroller. A passing Chromium/CDP test is NOT evidence of real-device behavior. No iOS device was
  available during execution.

### 3. UI polish visual sign-off
expected: Viewing the before/after screenshots in `.planning/phases/06-team-pages/screenshots/` (or the live polished page) at desktop and phone widths, the team page reads as a serious data tool that is more alive than Phase 5's — event sections as distinct objects, match rows grouping correctly via the zebra tint — without the colour going decorative.
result: issue
reported: "the actual page contect is decent. But the spacing is terrible. things are uncentered, overflowing, bad spacing, the worse. on mobile half the page is not accessible."
severity: major

verdict_split: |
  The colour/depth half of this plan's must-have PASSES on the user's own read ("the actual page
  content is decent") — event cards, zebra tint and alliance chips all land, and the colour did
  not go decorative. The LAYOUT half fails: spacing, centring and overflow were never part of what
  06-09 measured, and no mechanical gate in this phase looks at them.

note: |
  06-09-PLAN.md's own must-have states this is judged by looking, not by a token diff. The
  mechanical gates all pass (additive-only theme.css diff, zero hex literals in components,
  elevation/tint component tests), but the qualitative call is deferred to you by the plan's text.
  This is also where your Phase 5 sign-off note ("too minimal, needs a little colour") gets its
  answer — the plan scoped in only the depth that stays inside the existing palette.

## Summary

total: 3
passed: 0
issues: 2
pending: 0
skipped: 0
blocked: 1

## Gaps

- gap_id: G-06-1
  truth: "All four deployed-origin e2e specs pass against the real deployed build"
  status: resolved
  resolved_at: 2026-08-26
  resolved_by: "direct fix (no gap-closure plan) — commits 'fix(06): repair team page layout' and 'test(06): drag through the scroller's visible band'"
  verified_by: "full e2e suite 40/40 against https://sigmascout.org after redeploy"
  reason: "User reported: no-page-pan:84 and touch-scroll:197 fail on both iphone-17 and pixel-10 — per-event-section match tables cannot scroll horizontally on a phone"
  severity: major
  test: 1
  root_cause: "apps/web/src/routes/team.$teamNumber.tsx:151 — the overview TabsContent is a flex item of the Tabs root (`flex gap-2`) but omits `min-w-0`, so its computed min-width stays `auto`. It therefore refuses to shrink below its content's intrinsic width and lays out at 955px inside a 354px flex line. Every descendant in the chain (event-card section, both flex-col wrappers, the match-table-scroll div) correctly carries `min-w-0`; this one link does not, so the whole subtree sizes to content. The scroller ends up 905px wide with a 905px table, making scrollWidth === clientWidth — no overflow, therefore nothing to scroll, therefore scrollLeft stays 0 under a drag."
  measured: "iPhone 17 viewport 402px. All 8 match-table-scroll-* elements: scrollWidth 905 === clientWidth 905, overflow-x auto, touch-action pan-x. Ancestor Tabs root: clientWidth 354, scrollWidth 1162."
  user_impact: "On a phone the match tables render ~905px wide inside a 354px column and cannot be panned (the document itself correctly does not overflow), so roughly 60% of every match table's columns are permanently unreachable."
  artifacts:
    - path: "apps/web/src/routes/team.$teamNumber.tsx"
      issue: "TabsContent (line 151, and the sibling history panel at line 153) missing `min-w-0`"
  missing:
    - "Add `min-w-0` to the overview TabsContent className, and to the history TabsContent for the same reason"
  debug_session: ""

- gap_id: G-06-2
  truth: "The team page's layout reads as considered at desktop and phone widths"
  status: failed
  reason: "User reported: spacing is terrible, things are uncentered, overflowing, bad spacing; on mobile half the page is not accessible"
  severity: major
  test: 3
  root_cause: "Not yet diagnosed as a single cause — this is a layout-quality gap, not one defect. The mobile inaccessibility is G-06-1 (min-w-0). The desktop spacing/centring/overflow complaints are separate and were never measured by any gate in this phase: 06-09's must-have was scoped to colour and depth (elevation/tint component tests, additive-only theme.css diff, zero hex literals), so spacing and alignment had no acceptance criterion at all."
  artifacts:
    - path: "apps/web/src/routes/team.$teamNumber.tsx"
      issue: "overall page layout — gutters, max-width, centring"
    - path: "apps/web/src/components"
      issue: "match table column layout: axis tick labels (-14/46/107/167) render inside the header row and read as column headings"
  missing:
    - "A layout pass judged by looking at the rendered page, not by a token diff"
  process_note: |
    Worth recording plainly: the loop that catches bad UI is rendering it and looking. In this
    phase that loop was structurally broken, which is why 9 plans and 7 planning documents did not
    catch a layout defect visible in one glance:
      - apps/web/e2e has no local webServer and asserts only against the deployed origin, and
        deploy.yml had been dead since the pnpm rebuild — so no-page-pan:84, a spec that ALREADY
        encodes this exact bug, had never actually run.
      - The before/after screenshots 06-09 produced for sign-off contain the broken mobile layout,
        but the plan's mechanical gates all looked at tokens rather than at the images.
      - Meanwhile the api-coverage verify:pre gate blocked UAT entirely over three cells exceeding
        a character count.
    The ceremony was pointed at the wrong risk. See the conversation following this UAT for the
    scope-split decision (keep the harness rigor for algorithm/pipeline work; drop to a tight
    render-and-look loop for UI).

## Deferred Follow-Ups

Both are PIPELINE gaps, not UI gaps: the UI for each is built and shipped, and each renders a
deliberately honest "no data" state until the pipeline publishes what it needs. Neither is a
blocking gap for Phase 6 (#1921 — recorded here so they do not spawn gap-closure plans).

- id: F-06-1
  title: "Publish per-bonus RP so the match-table dots can be real"
  deferred_at: 2026-08-26
  requested: "do the dots in the UI but they will just all be empty. note to fix the data later"
  why: |
    The artifact publishes only AGGREGATE ranking points — `redRpPmf`/`blueRpPmf` over the RP
    TOTAL, and `actualRedRp`/`actualBlueRp` as a single integer. Neither can say WHICH bonus was
    earned or predicted: a 2026 total of 1 does not distinguish Energized from Supercharged from
    Traversal. Every dot therefore renders in the `unknown` state (dashed, muted) rather than
    hollow, because a hollow dot asserts "will not earn this bonus" — a claim the data cannot
    support.
  the_data_exists_upstream: |
    Each season's rule module already declares `bonusNames` and computes per-bonus `bonusFlags`
    during `parse()`, and `distribution.ts`'s Monte Carlo already evaluates every bonus per
    draw. `RpPmfResult` just discards the per-bonus detail, returning `redPmf`/`bluePmf` only.
  work_required:
    - "packages/core/algorithms/sigma1/rp/distribution.ts — accumulate and return per-bonus probabilities alongside the pmf"
    - "packages/harness/pageArtifacts.ts — publish per-bonus predicted probability and per-bonus actual flags on TeamSeasonMatch"
    - "republish artifacts across 2022-2026 (corpus is present locally, 339MB)"
    - "apps/web/src/components/team/BonusRpDots.tsx — pass real states; no structural change, it already takes a states[] prop"
  note: "Crosses the digest-reproducibility gate — this is algorithm output, so it wants the harness rigor, not a quick patch."

- id: F-06-2
  status: RESOLVED 2026-08-26
  resolved_by: |
    Sigma1 now publishes phaseAuto/phaseTeleop/phaseEndgame as first-class metrics with real
    spread and percentile. The spread is `covariance.ts`'s new `subsetVariance` — the same
    quadratic form `teamTotalVariance` already used for total, restricted to the group's own
    component indices, so the off-diagonal covariances are included rather than assumed away.
    Percentiles came free: `withPercentiles` discovers metric names from the record itself.
    The client-side grouping was deleted; `lib/metricGroups.ts` computes nothing now.
  title: "Publish group-level variance and percentile for the Auto/Teleop/Endgame tiles"
  deferred_at: 2026-08-26
  why: |
    The headline grid now shows four tiles (Auto, Teleop, Endgame, Total) instead of one per raw
    component. Group VALUES are exact — expectation is linear, so a sum of means is the mean of
    the sum however the components covary. Group ± and group percentile are NOT derivable
    client-side:
      - spread would need the covariance between components, which is not published. Components
        within a match are plainly correlated (a strong auto and a strong teleop share the same
        robot), so a quadrature sum would misstate the interval. A wrong `X ± Y` is worse for
        this project than no Y.
      - percentile is a rank against the season pool for one specific metric; the percentile of a
        sum is not any function of its parts' percentiles.
    Consequence today: the three phase tiles show a bare value with no ± and no rarity-tier box.
    Only Total, which the algorithm publishes directly, carries both.
  work_required:
    - "publish per-group variance (and percentile) from the pipeline's existing percentile pass"
    - "apps/web/src/lib/metricGroups.ts — GroupedMetric.spread/percentile are typed `undefined` today; widen once published"

- id: F-06-3
  title: "Rarity tiers on the per-event metric line"
  deferred_at: 2026-08-26
  requested: "use rarity marking for those 4 metrics [in each event section]"
  why_not_done: |
    `MetricHistoryRowSchema.metrics` publishes only { value, spread } — a history row carries no
    percentile. The percentile pass ranks SEASON-FINAL values, so applying a season-final
    percentile to an as-of-this-event value would colour a number by a rank it does not have,
    which is the same class of quiet inaccuracy F-06-2 was fixed to avoid. The season header's
    four tiles and the Teams table DO now carry tiers, because those are season-final values
    ranked against a season-final pool.
  two_honest_options:
    - "Rank each history value against the SEASON-FINAL distribution for that metric — well-defined and cheap (the sorted arrays already exist in the percentile pass), and reads as 'where this team stood at that point, against the final field'."
    - "Rank each history value against the pool AT THAT MATCH INDEX — more truly 'as of then', but needs every team's state at every index, which is a much larger pass."
  work_required:
    - "packages/harness/metricHistorySchema.ts — add optional percentile to MetricValueSchema"
    - "packages/harness/publish.ts — populate it in the chosen ranking scheme"
    - "apps/web/src/components/team/EventSection.tsx — pass tierForPercentile(tile.metric.percentile); the call site is already commented with this reference"

- id: F-06-4
  title: "The consistency-variance floor is scale-blind and has become a constant for low-variance metrics"
  deferred_at: 2026-08-26
  found_by: "user noticed adjust shows the identical ±1.00 for every team on the Teams page"
  mechanism: |
    `SIGMA1_MIN_CONSISTENCY_VARIANCE = 1` (consistency.ts) floors every shrunk consistency
    VARIANCE, and display spread is sqrt(variance) — so the smallest ± any metric can ever show is
    exactly ±1.00. `adjust` is TBA's `adjustPoints`, ~0 in nearly every match, so its observed
    residual variance falls under the floor and is clamped.
  measured: |
    Share of the 3,479 teams in the live 2024 sigma1 artifact whose spread is pinned at exactly
    1.00, with the metric's largest absolute value anywhere in the league for scale:
      endGamePark            99%   (max |value| 1.86)
      phaseEndgame           98%   (max |value| 8.99)
      adjust                 97%   (max |value| 19.85)
      phaseAuto              70%   (max |value| 21.42)
      foulsCommitted         27%   (max |value| 14.97)
      endGameSpotLightBonus  20%   (max |value| 0.81)
      total                   1%   (max |value| 63.07)
  why_it_matters: |
    A floor of 1 point^2 is an ABSOLUTE constant applied across metrics on wildly different scales.
    For `total` (range ~63) it is negligible. For `endGameSpotLightBonus`, whose largest value in
    the entire league is 0.81, the floor emits a ± larger than the metric's whole range.

    The constant's own doc comment argues a documented FLOOR is permitted by PROJECT.md's
    honest-uncertainty rule where a substituted constant VALUE would not be. That distinction holds
    at 5% pinned. At 97-99% the floor IS the value for those metrics, which is the thing the rule
    forbids.

    It also lands on Phase 6's own output: phaseEndgame is 98% pinned, so the Endgame tile's ± is
    near-meaningless for almost every team.
  root_cause_note: |
    The floor was designed to stop a thin-HISTORY team reporting an implausibly tiny spread
    (consistency.ts's own header). It is instead binding on low-VARIANCE components for teams with
    full histories — a different failure mode than it was built for.
  suggested_direction: "Make the floor scale-relative (a fraction of that metric's league-wide spread) rather than an absolute 1 point^2, so it still protects thin histories without swamping small-range metrics."
  caution: "Phase 3 hyperparameter feeding published algorithm output and the D-15 digest gate — this is tuning work with a re-baseline, not an edit."

- id: F-06-5
  title: "Sigma1's per-team consistency SD barely discriminates between teams"
  deferred_at: 2026-08-26
  severity: "goes to the product's core value — an interval that cannot separate a metronomic team from an erratic one is not decision-useful"
  found_by: "user: 2026 end-of-season total SD sits between ±5 and ±10 for most teams; expected some teams near-identical every match and others much streakier"
  confirmed: |
    Live 2026 sigma1 artifact, 3,709 teams. Published total:
      VALUE   p10 12.4   median 39.2   p90 130.2   -> p90/p10 = 10.5x
      SPREAD  p10 3.63   median 5.57   p90 8.44    -> p90/p10 =  2.3x
    Teams differ ~10x in how much they score and only ~2.3x in how consistent they are modelled to
    be. The user's read is correct, not a perception artifact.
  ruled_out_shrinkage: |
    The obvious suspect was empirical-Bayes shrinkage toward the league mean
    (SIGMA1_SHRINKAGE_PRIOR_MATCHES = 8, so own-data weight = mc/(mc+8)). If that were the cause,
    teams with more matches would spread OUT. Measured by matchCount bucket:
      1-10     n=264   own-weight 41%   p90/p10 2.18x
      10-20    n=705   own-weight 65%   p90/p10 2.09x
      20-40    n=1674  own-weight 79%   p90/p10 2.06x
      40-70    n=1021  own-weight 87%   p90/p10 1.95x
      70-200   n=45    own-weight 94%   p90/p10 1.43x
    The ratio falls monotonically as own-data weight rises. Shrinkage is NOT the cause; the
    distribution gets MORE compressed the more a team's own history dominates.
  leading_hypothesis: |
    Residual attribution. covariance.ts's own header records it as a stated modeling choice: a
    per-team residual is never observed, because a Kalman update sees an alliance SUM. Team j's
    residual is attributed as `K_j * innovation` — a gain-weighted share of the SAME innovation
    all three partners receive. If partners' gains are similar, all three book near-identical
    residuals for that match, so a team's "consistency" largely measures ALLIANCE-level score
    noise (common to everyone) rather than its own variability. That predicts both the compression
    and its worsening with more matches, since more matches average further toward the shared
    noise level.
  status: HYPOTHESIS — compression is confirmed and shrinkage is excluded; the attribution mechanism is not yet demonstrated to be the cause.
  how_to_test: |
    - Simulate: inject two synthetic teams with deliberately different true per-match variance
      (e.g. sd 2 vs sd 20) into an otherwise real season and check whether the published SDs
      separate. If they do not, attribution is confirmed as the compressor.
    - Compare published SD against a partner-controlled empirical estimate of each team's own
      variability, rather than raw alliance-score SD (which partners dominate).
    - Check whether K_j actually differs across partners in practice, or is near-uniform.
  do_not: "Do not 'fix' this by widening the displayed interval. The interval is not too narrow in absolute terms; it fails to VARY between teams. Rescaling would preserve the defect and hide it."
  related: "[[F-06-4]] — the ±1.00 variance floor is a separate defect in the same estimator, and floors 98% of phaseEndgame."
