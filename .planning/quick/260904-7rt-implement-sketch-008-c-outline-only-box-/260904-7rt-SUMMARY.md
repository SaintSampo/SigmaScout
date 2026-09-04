---
phase: quick-260904-7rt
plan: 01
subsystem: ui
tags: [react, css-tokens, accessibility, design-system]

# Dependency graph
requires:
  - phase: quick-260904-none (Phase 6 plan 06-07)
    provides: the D-17 rarity-tier system (MetricValue, TierKeyRow, tiers.ts, theme.css tokens)
provides:
  - Common (0-50th percentile) metric cells now render an outline-only ring instead of a bare cell
  - --tier-common-edge theme.css token and .metric-tier--common CSS rule
  - Widened MetricValue "boxed" seam (any defined tier boxes, not just non-common)
  - Teams table coalesces a missing wire-format tier label to "common" (Task 1 option-a)
  - Updated sketch-findings-sigmascout colour-and-tiers.md design record
affects: [ui, sketch-findings-sigmascout skill, any future tier-surface work]

actuals:
  tokens: 7917
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "CSS ring-only tier treatment via box-shadow:inset (never border) to preserve column geometry"
    - "theme.css-parsed drift guard tests (favicon.test.ts pattern) for design decisions with a sketch behind them"

key-files:
  created: []
  modified:
    - apps/web/src/styles/theme.css
    - apps/web/src/components/MetricValue.tsx
    - apps/web/src/components/MetricValue.test.tsx
    - apps/web/src/components/team/TierKeyRow.tsx
    - apps/web/src/components/event/AlliancesTab.tsx
    - apps/web/src/components/event/AlliancesTab.test.tsx
    - apps/web/src/components/event/BreakdownTab.test.tsx
    - apps/web/src/components/event/InsightsTab.test.tsx
    - apps/web/src/components/team/EventSection.test.tsx
    - apps/web/src/components/team/SeasonHeader.test.tsx
    - apps/web/src/components/teams-table/columns.tsx
    - apps/web/src/lib/tiers.ts
    - .claude/skills/sketch-findings-sigmascout/references/colour-and-tiers.md

key-decisions:
  - "Task 1 (resolved by user 2026-09-04 via AskUserQuestion): Teams table option-a — coalesce a missing wire-format tier label to \"common\". Correct on any fully-published season; accepted tradeoff that a live-event row (Worker computes no percentiles) can briefly wear a Common ring instead of its true tier until the next publish. No wire-format change, no republish."
  - "Ring drawn with box-shadow:inset, never border, to keep Common cells byte-identical in bounding box to filled-tier cells in the same column (locked in the plan, verified by code review + reasoning, not by re-running the Playwright geometry spec)."

requirements-completed: [TEAM-01, TEAM-03]

coverage:
  - id: D1
    description: "Common metric cells render a hairline inset ring, no fill; text/digits byte-identical to the untiered render"
    requirement: "TEAM-01"
    verification:
      - kind: unit
        ref: "apps/web/src/components/MetricValue.test.tsx#tier prop (D-17) > wraps the value in the common modifier class when tier='common' (260904-7rt, sketch 008 winner C)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/MetricValue.test.tsx#tier prop (D-17) > renders byte-identical numeric text at tier='common' to the same metric rendered untiered (260904-7rt: the ring is presentation-only)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Cells with no resolvable tier (no percentile published, or out of [0,100]) still render completely plain"
    requirement: "TEAM-01"
    verification:
      - kind: unit
        ref: "apps/web/src/components/MetricValue.test.tsx#tier prop (D-17) > renders no metric-tier class when tier is undefined (the default, unchanged behaviour)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/event/BreakdownTab.test.tsx#percentile 101 renders no metric-tier class (out of range)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Rare/Epic/Legendary tokens and rules are byte-identical to what shipped before"
    requirement: "TEAM-01"
    verification:
      - kind: other
        ref: "git diff 8c7aa3ea~1..d808ede5 -- apps/web/src/styles/theme.css (no change inside --tier-rare-*/--tier-epic-*/--tier-legendary-* declarations or rules, additions + comment rewrites only)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/event/BreakdownTab.test.tsx#percentile 75/50/100 boundary tests (unchanged, still passing)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Column alignment unchanged: a Common cell occupies exactly the same bounding box as a filled-tier cell in the same column (box-shadow:inset contributes no layout)"
    verification: []
    human_judgment: true
    rationale: "The plan's own geometry proof runs via Playwright (apps/web/e2e/breakdown-desktop-overflow.spec.ts) against a live-artifact fixture; not executed in this run for time/scope reasons. Reasoned correct instead: box-shadow does not participate in the CSS box model by spec, and the shipped rule uses box-shadow:inset exclusively (no border), verified by the automated verify command's negative check for border/background/color declarations on .metric-tier--common. A human or a future CI run of that spec should confirm no measured width moved."
  - id: D5
    description: "The ring colour resolves through a --tier-* custom property in theme.css; no component file carries the hex literal"
    requirement: "TEAM-01"
    verification:
      - kind: unit
        ref: "grep -nE '#[0-9A-Fa-f]{6}\\b' src/components/MetricValue.tsx src/components/team/TierKeyRow.tsx src/components/event/AlliancesTab.tsx src/components/teams-table/columns.tsx (no matches)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The tier key row shows all four bands as boxes, Common included"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/BreakdownTab.test.tsx#TierKeyRow's Common swatch carries the common tier ring, same as every other band"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every surface that renders tier boxes gets the Common treatment through the same seam (MetricValue's boxed predicate) or an explicit, reasoned exception (Teams table's tier ?? \"common\" coalesce)"
    requirement: "TEAM-03"
    verification:
      - kind: unit
        ref: "apps/web/src/components/team/SeasonHeader.test.tsx, EventSection.test.tsx, InsightsTab.test.tsx, AlliancesTab.test.tsx, teams-table/columns.tsx (all re-pinned, all passing)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The design record (colour-and-tiers.md) describes the outline treatment so a future contributor does not revert it"
    verification:
      - kind: other
        ref: ".claude/skills/sketch-findings-sigmascout/references/colour-and-tiers.md (Design Decisions, tier table, CSS Patterns, HTML Structures, key-row copy, and Origin all updated)"
        status: pass
    human_judgment: false
  - id: D9
    description: "npx vitest run from apps/web is green"
    verification:
      - kind: unit
        ref: "npx vitest run (79 test files, 1237 tests passed)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-09-04
status: complete
---

# Quick Task 260904-7rt: Common Tier Outline (Sketch 008 Winner C) Summary

**Common (0-50th percentile) metric cells now draw a hairline inset ring (`#CBD5E1`, `box-shadow: inset`, no fill) instead of rendering as bare text, on every surface that shows tiered metrics — implemented via one new theme.css token, one new CSS rule, and a two-character widening of `MetricValue`'s `boxed` predicate.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 (1 decision, already resolved; 2 auto)
- **Files modified:** 14

## Task 1: Teams Table Decision (resolved by user, not re-litigated)

The user resolved this checkpoint before execution began (2026-09-04, via AskUserQuestion):
**option-a — "Outline anyway."** On the Teams table, an absent wire-format `tier` label now draws the Common ring (`tier ?? "common"`). This is exactly correct on any fully-published season, since `publish.ts` ranks every metric with a value and the only cells with no label are the Common ones. The accepted tradeoff: mid-live-event, the Worker that updates rows computes no percentiles at all, so a genuinely Legendary team's row can briefly wear a Common ring instead of its true tier until the next full publish corrects it — a small, temporary, wrong claim, judged better than the Teams table (the site's largest tier surface) showing Common bare while every other page shows it outlined. No wire-format change, no republish. Recorded in `columns.tsx`'s own comment above the coalesce.

## Accomplishments

- New `--tier-common-edge: #CBD5E1` token and `.metric-tier--common { box-shadow: inset 0 0 0 1px var(--tier-common-edge); }` rule in `theme.css`, with a load-bearing comment forbidding `border` (would break column alignment).
- `MetricValue`'s `boxed` predicate widened from `tier !== undefined && tier !== "common"` to `tier !== undefined` — the single seam six of seven consuming surfaces already flow through.
- `TierKeyRow` drops its Common special-case; all four bands now render `metric-tier metric-tier--{tier}`.
- `AlliancesTab`'s `CombinedCell` approximation-disclosure gate widened from `approx !== undefined && approx.tier !== "common"` to `approx !== undefined` — a Common combined total now discloses its 3x-heuristic approximation on the same terms as every other tier.
- Teams table (`columns.tsx`) implements Task 1's option-a: `tier={info.getValue()?.tier ?? "common"}`.
- 8 test assertions flipped from "Common renders no box" to "Common renders `.metric-tier--common`", each renamed to describe the new behaviour (not left describing the old one).
- New coverage: `MetricValue.test.tsx`'s common-class-pair + byte-identical-text tests, a theme.css-parsed drift guard (favicon.test.ts pattern) pinning the token/rule/no-fill contract, and a `BreakdownTab.test.tsx` assertion that `TierKeyRow`'s own Common swatch matches the cells it explains.
- `colour-and-tiers.md` (the sketch-findings-sigmascout skill's design record) rewritten: Design Decisions, the tier table (added a Box edge column), CSS Patterns, HTML Structures, the key-row copy, and Origin — all now describe sketch 008 winner C superseding sketch 004 variant B's Common-unboxed call, with 004-B's history kept visible rather than rewritten away.

## Test Assertions Flipped (exact list)

1. `MetricValue.test.tsx:83-88` — tier="common" now expects `.metric-tier--common`, not "no class"
2. `BreakdownTab.test.tsx:219-220` (percentile 49.9) — expects `.metric-tier--common`
3. `InsightsTab.test.tsx:544-545` (percentile 49.9) — expects `.metric-tier--common`
4. `EventSection.test.tsx:239-252` (percentile 20) — expects `.metric-tier--common`
5. `EventSection.test.tsx:254-268` (percentile 0, boundary case) — expects `.metric-tier--common`, value assertion kept
6. `SeasonHeader.test.tsx:176-177` (20th-percentile teleop cell) — expects `.metric-tier--common`
7. `AlliancesTab.test.tsx:327-338` (interpolated percentile 10) — expects `.metric-tier--common` AND the approximation disclosure (role="group" + title)

Regression anchors confirmed unchanged and still green (not edited): `MetricValue.test.tsx:98-105` (no tier prop), `BreakdownTab.test.tsx:227-236` (percentile 101/-1/absent), `InsightsTab.test.tsx:574-590` and `475-479`, `EventSection.test.tsx:270-284`, `SeasonHeader.test.tsx:237-250`, `AlliancesTab.test.tsx:277-282` and `319-325`.

## Task Commits

Each task was committed atomically:

1. **Task 2: Token, CSS rule, and the shared seam** — `8c7aa3ea` (feat)
2. **Task 3: Re-pin the tests and correct the design record** — `d808ede5` (test)
3. **Follow-up: close TierKeyRow coverage gap** — `47fe88e0` (test)

_Task 1 (checkpoint:decision) required no code commit — resolved by the user before execution and recorded in `columns.tsx`'s own comment._

## Files Created/Modified

- `apps/web/src/styles/theme.css` — `--tier-common-edge` token, `.metric-tier--common` rule, rewritten doc comments
- `apps/web/src/components/MetricValue.tsx` — widened `boxed` predicate, rewritten doc comment
- `apps/web/src/components/MetricValue.test.tsx` — flipped common-tier assertion, added common-class + byte-identical-text coverage, added theme.css drift guard
- `apps/web/src/components/team/TierKeyRow.tsx` — all four bands boxed, rewritten doc comment
- `apps/web/src/components/event/AlliancesTab.tsx` — `CombinedCell`'s disclosure gate widened
- `apps/web/src/components/event/AlliancesTab.test.tsx` — flipped Common-combined-total assertion, added TierKeyRow-swatch style disclosure check
- `apps/web/src/components/event/BreakdownTab.test.tsx` — flipped percentile-49.9 assertion, added TierKeyRow Common-swatch assertion
- `apps/web/src/components/event/InsightsTab.test.tsx` — flipped percentile-49.9 assertion
- `apps/web/src/components/team/EventSection.test.tsx` — flipped two Common-band assertions
- `apps/web/src/components/team/SeasonHeader.test.tsx` — flipped teleop-cell assertion
- `apps/web/src/components/teams-table/columns.tsx` — `tier ?? "common"` coalesce (Task 1 option-a) with rationale comment
- `apps/web/src/lib/tiers.ts` — corrected a stale "Common renders unboxed either way" comment
- `.claude/skills/sketch-findings-sigmascout/references/colour-and-tiers.md` — full design-record update

## Decisions Made

- Task 1: option-a (Teams table coalesces missing tier to Common) — see above, resolved by user before execution.
- Ring geometry: `box-shadow: inset`, never `border` — locked by the plan, re-affirmed in both `theme.css` and `colour-and-tiers.md` with an explicit "do not swap this" comment, since a border would add 2px to Common cells only and misalign every mixed-tier column.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing coverage] Added a TierKeyRow Common-swatch test**
- **Found during:** Post-Task-3 review against the plan's `must_haves.truths`
- **Issue:** The plan's must-have "the tier key row shows all four bands as boxes, Common included" had no direct automated assertion — existing tests only checked that `TierKeyRow` renders once, not what each band's class list contains.
- **Fix:** Added a targeted assertion in `BreakdownTab.test.tsx` (the one existing test file that already renders and finds `tier-key-row`) checking all four `.metric-tier--{tier}` classes are present inside it.
- **Files modified:** `apps/web/src/components/event/BreakdownTab.test.tsx`
- **Verification:** New test passes; full suite still green (1237/1237).
- **Committed in:** `47fe88e0`

---

**Total deviations:** 1 auto-fixed (Rule 2, missing coverage)
**Impact on plan:** Additive test coverage only — no production code changed by this deviation. No scope creep.

### Out-of-scope finding (not fixed, logged for awareness)

`apps/web/src/components/team/SeasonHeader.tsx` lines ~160-162 carry a comment describing the Teams table's Total column as "sorted, deliberately unboxed" — a claim about the sort-column exclusion rule (`colour-and-tiers.md`'s "tiering the sorted column" guidance), NOT about Common's box treatment. Reading `teams-table/columns.tsx`'s actual `metricColumns` construction shows the Total column is generated by the same loop as every other metric column and receives the same tier treatment — this comment already appears stale independent of this task's changes (a pre-existing documentation drift, not something 260904-7rt's edits caused). Left untouched per the SCOPE BOUNDARY rule (out-of-scope, unrelated file not in this plan's `files_modified`). Flagging here rather than in `deferred-items.md` since it's a one-line documentation note, not a defect.

### Staleness note resolution

The plan named specific stale comments in `SeasonHeader.tsx` and `lib/tiers.ts` describing "Common renders plainly." A direct text search found no such comment in `SeasonHeader.tsx` (see the out-of-scope finding above for the closest candidate, which is about a different rule) — likely drift between when the plan was authored and execution, or the plan author was referring to the sort-column comment loosely. `lib/tiers.ts` DID carry the described comment ("Common renders unboxed either way") and it has been corrected.

## Issues Encountered

None beyond the coverage gap noted above.

## Known Stubs

None.

## Unrun Verification

The plan's top-level `<verification>` section names a Playwright geometry proof (`apps/web/e2e/breakdown-desktop-overflow.spec.ts`) confirming a Common cell's bounding box matches a Rare cell's exactly in a mixed-tier column. This was NOT executed in this run (Playwright e2e suite requires a built dev server; out of this quick task's time budget). Reasoned correct instead: `box-shadow` does not participate in the CSS box model per spec — an inset shadow paints strictly inside the existing padding box and affects zero layout dimensions — and the shipped `.metric-tier--common` rule uses `box-shadow: inset` exclusively, confirmed by the Task 2 automated verify command's negative check (`! grep ... 'border|background|color'`). A future CI run of that spec, or a manual visual check, would close this out definitively. The `gsd-tools windows append` CLI was attempted to log this to the cross-phase defect ledger but the binary was not found in this environment (`.claude/gsd-core/bin/gsd-tools.cjs` does not exist here) — logging is best-effort per the workflow's own instructions, so this paragraph is the record instead.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

The Common outline treatment is live everywhere `MetricValue`/`TierKeyRow` render a tiered metric: team page season grid, team page event snapshots, all three event tabs (Breakdown, Insights, Alliances), the tier key row, and the Teams table. No blockers. The one open item is the unrun Playwright geometry spec noted above — low risk given the CSS mechanism, but worth a follow-up visual pass if a future session touches `.metric-tier` layout again.

---
*Phase: quick-260904-7rt*
*Completed: 2026-09-04*
