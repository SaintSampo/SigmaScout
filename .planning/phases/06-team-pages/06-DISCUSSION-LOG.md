# Phase 6: Team Pages - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-25
**Phase:** 6-team-pages
**Areas discussed:** Folded todos, The missing data & republish, How matches are displayed, The metric-history chart (TEAM-06), Page structure/URL/season header

---

## Folded Todos

| Option | Description | Selected |
|--------|-------------|----------|
| Publish match variance | `publish-match-predictive-variance.md`, tagged `resolves_phase: 6`. Without it TEAM-05 has no honest ± and sketch 003's band display is unbuildable. | ✓ |
| Static shell first paint | Put real markup in `index.html` so first paint does not wait on ~600 KB of JS. NAV-06 already breached at ~4.06 s; Phase 6 adds Recharts on top. | ✓ |
| UI polish pass | "Too minimal, needs a little colour." Folding it means Phase 6 components are built on the final palette. | ✓ |
| None — keep Phase 6 pure UI | Ship against exactly what the artifact carries today; leave TEAM-02/04/05 partly unmet. | |

**User's choice:** All three folded.

---

## The Missing Data & Republish

### Match ± — how sure we were, and what teams actually earned

| Option | Description | Selected |
|--------|-------------|----------|
| Both — split the uncertainty, add actual RP | Save red's and blue's uncertainty separately and carry actual RP through. | ✓ (via free text, then confirmed) |
| Split the uncertainty only | Bands, but predicted RP stays unfalsifiable. | |
| Actual RP only | Honest RP comparison, no score bands. | |
| Neither — ship what exists | No pipeline work; sketch-decided display unbuildable. | |

**User's choice:** First answered in free text rather than picking an option, articulating the requirement directly: *"I think the root of this question comes from a fundamental friction in this app. It does two things. 1) calculate predictions as best as possible. 2) display data in a way that is easy for anyone to understand. There are a few things a match prediction should show. Not just the total probability of a match win, but separately, the predicted scores for each alliance +/- 1 SD. An alliance of three unpredictable robots will have a higher SD than 3 consistent robots."* This was read as selecting the per-alliance split. Actual RP was then asked separately and answered "Yes — carry actual RP through."

**Notes:** The user asked for plain-language context before answering; the first pass of this question was rejected as too technical. Before recording the decision, the claim was verified in code rather than assumed: `sigma1/covariance.ts` tracks a **per-team** covariance matrix, and `sigma1/index.ts:684` already computes `redScoreVarianceOwn`/`blueScoreVarianceOwn` and discards them — so the user's "three unpredictable robots" requirement is satisfiable by publishing numbers that already exist.

### Upcoming matches and events

| Option | Description | Selected |
|--------|-------------|----------|
| Two lists, copying the event page | Mirror `EventArtifactSchema`'s separate `upcoming[]`. Keeps the type guarantee that a played match has a score. | |
| One list, make the scores optional | Simpler. Loses the type-level guarantee. | ✓ |
| Finished events only, defer upcoming | TEAM-04's "or upcoming" left unmet. | |

**Notes:** The tradeoff was raised before the choice and the choice was made anyway. CONTEXT.md D-09 therefore requires the planner to replace the lost type guarantee with a validation rule rather than letting it disappear.

### Robot image

| Option | Description | Selected |
|--------|-------------|----------|
| Pipeline publishes the URL | Ingest resolves it once per team-year. Zero extra browser requests, key stays server-side. | ✓ |
| Browser calls TBA media API at page load | Verified working (CORS confirmed). Exposes the API key in the bundle. | |
| Browser via Worker proxy | Key secret, but a round trip and Worker in the page path. | |
| Avatar hotlink | Free and predictable, but a 40×40 logo not a robot. | |

**Notes:** The user initially chose "client hotlinks a predictable CDN path". That answer was tested rather than accepted: `thebluealliance.com/avatar/{year}/{team}.png` does work unauthenticated, but serves the avatar, not a robot photo; real photos sit at opaque Imgur/Instagram keys. Coverage was measured across 20 real 2024 teams (15/20 photo, 14/20 preferred, 16/20 avatar) and the options re-presented. The user then asked *"can a user's browser pull a team's robot image from TBA at page load?"* — tested and confirmed yes (TBA sends `access-control-allow-origin` for our origin and allows `x-tba-auth-key`) — and, given the key-exposure tradeoff, chose the pipeline route.

### Per-metric percentiles

| Option | Description | Selected |
|--------|-------------|----------|
| Publish percentiles with the rest | One republish carries every schema change at once. | ✓ |
| Derive client-side from `teams/{year}` | Violates NAV-06 and needs a 1.4–2.7 MB download to tier one row. | |
| Skip tiers on the team page | Defer to Phase 7. | |

---

## How Matches Are Displayed

### The shared axis domain

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed per season, field-wide distribution | Every row comparable everywhere; axis never moves. | |
| Per team-season — this team's own range | Tighter and more readable per page; scale differs between team pages. | ✓ |
| Per event section | Tightest; loses cross-event comparison. | |

**Notes:** Chosen against the recommendation. The stability concern was not re-litigated but converted into an implementation note in D-06: compute the domain across the whole team-season *including scheduled matches* so the axis does not creep as results land.

### Row orientation

| Option | Description | Selected |
|--------|-------------|----------|
| Red always on top, FRC convention | Matches TBA/Statbotics; team's own alliance marked in place. | ✓ |
| This team's alliance always on top | Reads "us vs them"; breaks the red-top convention. | |
| Red on top, no highlight | Cleanest; reader hunts for the team number every row. | |

### Scheduled (unplayed) match rows

| Option | Description | Selected |
|--------|-------------|----------|
| Same row, bands and tick, no actual dot | Prediction drawn at full weight; Actual column shows the scheduled time. | ✓ |
| Same row, visually dimmed | De-emphasises the row users most want at a competition. | |
| Separate upcoming block | Pinned at top; costs the continuous timeline and repeats the axis. | |

### Mobile form

| Option | Description | Selected |
|--------|-------------|----------|
| Stack into two rows | Full-width plot, no gesture conflict, taller. | |
| Horizontal scroll, matching the Teams table | Consistent with Phase 5 D-04; inherits its gesture-conflict risk, repeated per event section. | ✓ |
| Numbers only on mobile | Drops the differentiator on the venue device. | |

**Notes:** Chosen against the recommendation. D-10 records that this inherits Phase 5 D-04's explicit instruction that the gesture conflict is "for research to solve, not discover", and flags it as the phase's highest-risk item.

---

## The Metric-History Chart (TEAM-06)

### Which metrics

| Option | Description | Selected |
|--------|-------------|----------|
| Total by default, components toggleable | Readable default, component detail one tap away. | |
| Total only | Simplest; leaves published per-component history unused. | ✓ |
| Small multiples grid | Nothing hidden; ~10 renders and a lot of vertical space. | |

**Notes:** Component trajectories recorded as a deferred idea, not a rejection — the data is already published, so it is additive later.

### X-axis

| Option | Description | Selected |
|--------|-------------|----------|
| Team's own match sequence, events marked | "They jumped at their second event" reads straight off the chart. | ✓ |
| Team's match sequence, no event markers | Cleaner; loses the event-by-event story. | |
| Calendar date | Honest about gaps; gaps eat the width. | |

### Algorithms with no spread

| Option | Description | Selected |
|--------|-------------|----------|
| Plain line, with a note | Explains the absence; demonstrates the Sigma1 differentiator. | |
| Plain line, no explanation | Less chrome; a vanishing band may read as a bug. | ✓ |
| Hide the chart tab entirely | A tab that appears and disappears is worse. | |

### Charting library

| Option | Description | Selected |
|--------|-------------|----------|
| Recharts, loaded only when the chart tab opens | Real deferral — used by one tab only, unlike D-19's vendor-chunk case. | ✓ |
| Recharts in the main bundle | Adds the full library to every page load on a breached budget. | |
| Hand-rolled SVG | Near-zero bundle cost; materially more work. | |

---

## Page Structure, URL & Season Header

### Route

| Option | Description | Selected |
|--------|-------------|----------|
| `/team/1114` — plain team number | What TBA and Statbotics use; typeable and guessable. | ✓ |
| `/team/frc1114` — TBA team key | Internal identifier in a shared URL. | |
| `/team/1114/2026` — year in path | Splits year handling across path and params. | |

### Tabs

| Option | Description | Selected |
|--------|-------------|----------|
| Search param, `?tab=metrics` | Consistent with D-14; linkable and back/forward friendly. | ✓ |
| Path segment | Makes the tab a route rather than view state. | |
| Component state only | Chart tab not linkable — the failure D-14 exists to prevent. | |

### Season header

| Option | Description | Selected |
|--------|-------------|----------|
| Total plus every component, tier-boxed | Same numbers as the Teams table; tiers do real work on a one-team view. | ✓ |
| Total plus components, no tiers | Gives up the tier system's clearest argument. | |
| Total only, prominent | Loses the component detail the scout just clicked away from. | |

### Empty state for a year the team did not compete

| Option | Description | Selected |
|--------|-------------|----------|
| Keep the page, explain, offer active years | Mirrors Phase 5 D-11's "explain, don't discard". | ✓ |
| Redirect to most recent active year | Silently overrides the user's choice. | |
| Bounce to the Teams list | Conflates a missing event with a sat-out season. | |

**Notes:** The user accepted the recommendation and added a design decision of their own: *"how would a user even get to such a page? When we are on a team page, lets have the year drop down ONLY display years that teams has played."* Recorded as D-18. This surfaced a fifth unpublished field (`activeYears`), asked separately and answered "an `activeYears` array on the team artifact". Because the list can only be learned by fetching a year that exists, the empty state remains necessary as a backstop for shared links — the two decisions are complementary.

---

## Claude's Discretion

- Fallback treatment for the ~25% of teams with no robot photo (D-03)
- How the team's own alliance is marked within a red-on-top row (D-07)
- The exact form of the event-boundary marker on the chart (D-12)
- Whether the season header's component grid is a stat row, compact table, or chips

## Deferred Ideas

- Per-component metric trajectories on the chart (data already published; additive)
- Explaining the missing variance band on OPR/EPA
- Revisiting the base palette itself (`ui-polish-pass.md` question 2) — question 1 is in scope, question 2 is not
- Cross-team comparison of match-plot bar positions — foreclosed by D-06's per-team domain
- Surfacing per-algorithm freshness — carried forward from Phase 5
