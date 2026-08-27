# Phase 7: Event Pages - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-27
**Phase:** 07-event-pages
**Areas discussed:** Alliances tab, the site-wide ± rule, Insights tab, algorithm renaming, Quals/Elims scale and unplayed rows, Breakdown tab

---

## Gate: upstream artifacts and folded todos

| Option | Description | Selected |
|--------|-------------|----------|
| Discuss + UI spec first | Run discuss-phase and ui-phase before planning, as Phases 5 and 6 did | ✓ |
| UI spec only | Skip discuss-phase | |
| Skip both | Plan from roadmap and research only | |

| Option | Description | Selected |
|--------|-------------|----------|
| Fold match predictive variance into Phase 7 | The Quals/Elims ± needs it; harness computes it but never publishes | ✓ |
| Leave as standalone todo | Phase 7 stays purely front-end | |

| Option | Description | Selected |
|--------|-------------|----------|
| Include the playoff-bonus republish in Phase 7 | Combine with the variance change so R2 is rewritten once | ✓ |
| Defer again | Low priority, stale keys are ignored by readers | |

**Notes:** Both todos were repointed and committed (`ebe90c51`) before the discussion began, so the decision could not be lost between commands.

---

## Gray area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Alliances tab — what "combined metrics" means | No data source exists; combination math undecided | ✓ |
| Insights tab — what "rank" means | Official TBA rank vs metric-sort position | ✓ |
| Quals/Elims — shared scale and unplayed rows | Sketch 003's open question about live-event axis creep | ✓ |
| Breakdown tab — component display | EVNT-03 is one word of spec | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Apply ui-polish question 1 to new surfaces | Row tints, elevation, chips; palette untouched | ✓ |
| Settle the base palette this phase | Sketch round before six phases inherit it | |
| Leave both deferred | Build on Phase 5/6 treatment as-is | |

---

## Alliances tab

| Option | Description | Selected |
|--------|-------------|----------|
| Sum members, sum variances, show √ | Mirrors `sigma1/index.ts:688` exactly | ✓ |
| Sum, plus per-component rows | Overlaps the Breakdown tab's job | |
| No combined number — list members | Doesn't answer "which alliance is strongest" | |

**User's choice:** Sum variances, show √.
**Notes:** The user challenged the first framing directly — *"you can't just add SDs for multiple robots right?"* — which was correct and led to the arithmetic being restated explicitly as `σ = √(σ₁² + σ₂² + σ₃²)`, three robots at ±10 giving ±17.3 rather than ±30. The independence assumption underneath was then surfaced and recorded as a stated floor rather than left implicit.

| Option | Description | Selected |
|--------|-------------|----------|
| First three picks only | Statbotics' convention; keeps the column comparable | ✓ |
| Every team TBA lists | A 4-team alliance's total stops being comparable | |
| Three picks, backup swappable | Most informative; new interaction to design | |

| Option | Description | Selected |
|--------|-------------|----------|
| Disabled, with reason on hover | Recovers what greying drops | |
| Plain disabled | Greyed, unclickable, no explanation | ✓ |
| Disabled pre-selection, explained if absent | Two behaviours, each case right | |

**Notes:** Chosen twice — once before and once after being told the treatment cannot distinguish "selection hasn't happened" from "no recorded alliances."

---

## The site-wide ± rule

This area was not on the original list. It opened when the user was shown that the same alliance would carry a narrower ± on Alliances than on Elims.

| Option | Description | Selected |
|--------|-------------|----------|
| Predictive variance (D-10) everywhere on alliance rows | Same quantity as match rows | |
| Consistency spread (D-09) | The team-page quantity | (initially) |
| Both, labelled separately | Two columns, explicitly named | |

**User's first response:** *"This is a problem that keeps coming up. And I feel like I am just learning that a previous choice might be wrong. The entire point of rendering a +/- value is that it lets humans compare which robots are more consistent. So sounds like go with D-09, and explore if this needs to be changed elsewhere?"*

**Audit performed in response:** nothing shipped was wrong — `MetricValue.tsx` renders D-09 and `MatchTable.tsx` renders D-10, each correct for its job. But both use the identical `±` glyph, the identical CSS class, and the identical secondary weight, on the same page.

| Option | Description | Selected |
|--------|-------------|----------|
| ± means consistency; predictions drawn only | Delete the printed ± at MatchTable.tsx:205 | |
| Nested band — draw the decomposition | Inner = swing, outer = + estimate uncertainty | |
| Different notation per quantity | `88.2 ± 3.1` vs `86 (74–98)` | |
| Label the quantity inline | "±3.1 consistency" / "±12 predicted" | |

**User's choice:** none of them — *"I think this is terrible. I really want to explore this question."* Then, after exploration: *"I've decided I don't want the user to EVER see a D-09 consistency value. ± should always represent 1 SD. Every plot should use this value too, never D-09."*

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — ± is always √(P+R) | Uncertainty, not streakiness, is the accepted reading | ✓ |
| Yes, but show match count nearby | Makes a wide band legible as "few matches" | |
| Hold on — let's reconsider | Look at rookie vs veteran numbers first | |

| Option | Description | Selected |
|--------|-------------|----------|
| Redefine `spread` in place | Cheapest; bounded cache risk | ✓ |
| New field, retire `spread` | No cached artifact can be misread | |
| Bump the artifact schema version | Most traceable | |

| Option | Description | Selected |
|--------|-------------|----------|
| Keep computing, never display | R stays in the model; three docs rewritten | ✓ |
| Keep it, keep it published | Reintroducible without a republish | |
| Strip from published artifacts | Smallest payload | |

| Option | Description | Selected |
|--------|-------------|----------|
| Fix it in Phase 7, record as cross-cutting | Site never internally inconsistent | ✓ |
| Phase 7 tabs only | Keeps the fence clean | |
| Sketch it first | Costs a round before planning | |

**Notes:** The consequence that ± widens for teams with few matches — uncertainty rather than streakiness — was stated before the confirmation, and confirmed knowingly.

---

## Insights tab

| Option | Description | Selected |
|--------|-------------|----------|
| Both official rank and metric position | The gap between them is the story | |
| Metric position only | Literal reading of SC-1 | |
| Official TBA rank only | What an FRC person means by "rank" | ✓ |

**User's choice:** Official rank only, plus a request: rename the Teams page Rank column per-algorithm, and give Sigma1 a three-letter acronym.
**Notes:** Verified before recording — `rowModel.ts:98-110` always ranks by the selected algorithm's Total regardless of active sort, so the rename describes what the column already does.

| Option | Description | Selected |
|--------|-------------|----------|
| At this event | Countable from `matches[]` already in the artifact | ✓ (then superseded) |
| Season-wide | Matches SC-1 most strictly | |
| Both, event first | Two more columns | |

**Notes:** The user first asked *"what is EventTeamSchema? I am but a simple human"* — the jargon was dropped and the question re-asked in plain terms. The event-record answer was later superseded when TBA's authoritative `record` turned out to be available from the same endpoint as RPs.

| Option | Description | Selected |
|--------|-------------|----------|
| Season-final (current behaviour) | Cheapest; matches 06.1's percentile logic | |
| As-of-event | What the model knew when it predicted | ✓ |
| Season-final now, as-of later | Ship, then revisit | |

| Option | Description | Selected |
|--------|-------------|----------|
| Components yes, sorted column no | Phase 6 D-17's conclusion | |
| Everywhere | One simple rule, more colour | ✓ |
| Not on this tab | Keeps the roster dense | |

**Notes:** The user asked *"what is a tier"* — explained in plain terms (percentile-named coloured boxes, Statbotics' shaded metric cells as ancestor) before the question was re-asked.

| Option | Description | Selected |
|--------|-------------|----------|
| Value as-of-event, percentile vs season-final | The split 06.1 already locked | ✓ |
| Both as-of-event | Reopens 06.1's decision | |

---

## Algorithm renaming

| Option | Description | Selected |
|--------|-------------|----------|
| SPR — Sigma Power Rating | OPR/DPR family | |
| SPA — Sigma Points Added | Parallel to EPA | |
| SIG — Sigma | Ties to the brand | |

**User's choice:** none — *"let's not put sigma in the name. In three sentences describe to me the core of how sigma1 works."*

| Option | Description | Selected |
|--------|-------------|----------|
| KPA — Kalman Points Added | Names the mechanism | |
| VPA — Variance-aware Points Added | Names the differentiator | |
| CPA — Component Points Added | Names the per-component model | |

**User's choice:** **VPR — Variance Power Rating**, their own coinage combining VPA's subject with OPR's family name.

| Option | Description | Selected |
|--------|-------------|----------|
| Display label only | No republish, no link breakage | |
| Display label plus docs | One vocabulary per audience | |
| Rename everywhere including the ID | Cleanest; against a one-way Phase 4 decision | ✓ |

**Notes:** Chosen under a warning that it "breaks every shared link." That warning was then **corrected**: the digest excludes `algorithmId` so Phase 3's CI gate is unaffected, and `searchParams.ts:49`'s `.catch(DEFAULT_ALGORITHM)` means old `?algorithm=sigma1` links resolve to the new default rather than failing. The decision stands on better information than it was made with.

---

## Quals and Elims

| Option | Description | Selected |
|--------|-------------|----------|
| Delete orphans in the same pass | Write-verify-then-delete ordering | ✓ |
| Leave them, delete later | Rollback path; dead storage | |
| Leave them permanently | Zero risk, permanent cost | |

| Option | Description | Selected |
|--------|-------------|----------|
| Per tab — separate domains | Follows the per-view rule literally | ✓ |
| One scale across the whole event | Compresses the quals tab | |
| Per tab, over played plus scheduled | Phase 6 D-06's creep mitigation | |

**Notes:** The played-and-scheduled computation from the third option was carried forward anyway rather than re-asked — it is the same problem Phase 6 D-06 already decided, and the two options differed only in how the domain is computed, not in the per-tab split. Recorded openly rather than applied silently.

| Option | Description | Selected |
|--------|-------------|----------|
| Merge client-side into one list | Phase 8's simulation input untouched | ✓ |
| Two sections on the tab | Simplest; scanning is harder | |
| Merge in the schema too | Reworks Phase 8's input before Phase 8 | |

| Option | Description | Selected |
|--------|-------------|----------|
| Flat chronological list | Works across all five seasons | |
| Group by round, per season | Season-specific display logic | |
| Flat now, bracket later | Ships without a season-shaped rabbit hole | ✓ |

**Notes:** Corpus query before asking established the fork: 2022 has a real `ef`/`qf`/`sf`/`f` bracket; 2024 and 2026 put nearly every playoff match at `sf` with set numbers to 17 and 21.

---

## Breakdown tab

| Option | Description | Selected |
|--------|-------------|----------|
| Per-team model estimates | The only per-team view that can exist | ✓ |
| Estimates plus event actuals | Two units of analysis on one tab | |
| Event-wide composition | Drifts from EVNT-03's wording | |

| Option | Description | Selected |
|--------|-------------|----------|
| Phase groups, expandable to components | Readable by default, detail on demand | |
| Phase groups only | Three columns, same every season | |
| Every raw component | Maximum detail; wide, season-varying table | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Table of values with tier boxes | Consistent with Insights and the team page | ✓ |
| Stacked composition bar per team | Proportion well, magnitude poorly | |
| Table plus a composition bar column | Both readings; more mobile pressure | |

**User's choice on the Insights/Breakdown division, verbatim:** *"Insights is the summary. It has teams in their actual rank order and shows a limited amount of statistics, auto, teleop, endgame, record, rank, RPs, that kind of stuff. Breakdown has nothing about real event rank, it is sorted based on VPR rank and has the breakdown of every metric."*

---

## Closing decisions

| Option | Description | Selected |
|--------|-------------|----------|
| Amend SC-1 to match the design | The criterion predates the design | ✓ |
| Keep SC-1, change the design | Insights becomes a Teams-page clone | |
| Amend and split the difference | Note that Breakdown carries the full column set | |

| Option | Description | Selected |
|--------|-------------|----------|
| Extend the table, take RPs and record | One ingest change captures both | ✓ (on second pass) |
| Take record only, skip RPs | No dependency on `sort_orders` | |
| Neither — count record in the browser | Cheapest; subtly wrong for DQs | (initially) |

**Notes:** The user first chose "neither", then reversed after being shown that the choice silently dropped RPs — a column their own description of the tab had named.

| Option | Description | Selected |
|--------|-------------|----------|
| Fall back to VPR order, say so | Works on all 1,581 events | ✓ |
| Fall back and name the reason | Needs event type consulted | |
| Fall back silently | Reader can't tell which ordering | |

**Notes:** Preceded by the user asking *"tell me more about these 50 events, what are some of them"* — answered with a real corpus query rather than a description: 259 events have no ranking rows, overwhelmingly offseason and preseason, including 68- and 62-match events, plus one Championship Finals per year where a qualification ranking cannot exist at all.

| Option | Description | Selected |
|--------|-------------|----------|
| Split: 7a pipeline, 7b tabs | Clean seam at the republish | |
| Plan it whole | 12–15 plans in several waves | ✓ |
| Split differently — defer the hard parts | Four tabs sooner | |

**Notes:** Chosen after being shown that nine pipeline items are now in scope and that Phase 6 was 9 plans and 06.1 was 8.

---

## Claude's Discretion

- Where the event page header sources event identity from
- Predicted-winner and confidence rendering (the `.alliance-chip` pattern carries forward)
- Default tab, and the tab strip on a phone with five tabs
- Visual treatment of the disabled Alliances tab
- Missing-data fallbacks on every tab
- Placement and wording of D-08's "official rankings unavailable" notice
- Depth-within-the-current-system polish on new surfaces; base palette untouched

## Deferred Ideas

- A true double-elimination bracket view for the Elims tab
- Distinguishing "no quals exist" from "no ranking published" in the fallback notice
- The base-palette question (`ui-polish-pass.md` question 2)
- Bringing back a labelled consistency column
- Cross-tab comparison of match-plot bar positions (foreclosed by per-tab domains)
- Per-component metric trajectories on the team page chart
- Surfacing per-algorithm freshness
- Moving `static-shell-first-paint.md` out of `pending/` — it is already resolved
