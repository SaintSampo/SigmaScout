---
quick_id: 260902-i8i
slug: fix-cr-01-cr-02-wr-01-from-the-post-phas
date: 2026-09-02
status: complete
tasks_completed: 3
source: .planning/reviews/260902-post-phase08-ungoverned-ui/REVIEW.md
---

# Summary — the three user-facing defects from the post-Phase-08 review

Fixes for CR-01, CR-02 and WR-01, the findings from the review of work that shipped
outside any GSD phase after Phase 08 closed its UAT on 2026-08-31. That code had no
review gate at all: UI reviews 05/06/08 were waived by user decision in `09a81d1f`.

**No PLAN.md was written for this task, deliberately.** `REVIEW.md` already carried
file:line and a recommended fix for each finding; restating it is the documentation
bloat the 2026-08-31 retrospective measured (48.7% of commits were docs, planning
corpus outgrew the codebase). The review document is the specification.

## Commits

| Finding | SHA | What a user would have seen |
|---|---|---|
| CR-01 | `c1262c6e` | Front door replaced by a router error surface — hero, search, all three CTAs gone — because a decorative proof block could not be computed. Now the podium is simply absent and the page renders. |
| CR-02 | `59624852` | A Rare/Epic/Legendary box over a knowingly-approximate value, with no disclosure at all for screen-reader or touch users. Now the boxed cell is an accessible group whose name is the disclosure. |
| WR-01 | `38bb434d` | `2026isde1/isde2/iscmp` shown as "Week 17/18/19", three nonsense options at the end of the Week filter, and 208 played official matches unreachable under any real week. Now they collapse into one "Other" bucket and are filterable. |

## CR-01 — where the failure is handled, and why there

`pooledAccuracyPodium` throws by design on a missing combined slice; `index.tsx` called
it behind a guard covering only query failure, with no error boundary above it. A
schema-valid HTTP 200 missing one algorithm's slice therefore took down the home page.

The fix guards **the call site**, not the helper and not a new error boundary:

- Pushing it into `homePodium.ts` would make the helper silently wrong for its other
  consumer — the Compare page wants the loud failure, and `homePodium.test.ts` asserts it.
- An error boundary errs the other way: it would swallow every render bug in its subtree
  under the same "no podium" outcome, converting real breakage into invisible absence.

A `try` around the one call that can throw catches exactly the condition the helper's
own header names. Also added a `podium.length >= 3` check before the medal layout
indexes places 0–2 off an array sized by `PUBLISHED_ALGORITHM_IDS.length`.

## CR-02 — the attribute that was missing

`aria-label` is prohibited on a bare `<span>`'s implicit `role="generic"`, so browsers
drop it from the accessibility tree; `title` is hover-only. The disclosure reached
nobody on touch and nobody using assistive tech. The code comment claimed to mirror
`BonusRpDots.tsx` — that file supplies `role="group"`, which this one omitted. It now
genuinely mirrors it. **The visible `≈` glyph stays removed** per the user's 2026-09-01
request; only the exposure changed.

## WR-01 — out-of-band weeks leave the numeric scale

TBA publishes Israeli district events with week values above the season scale
(`2026isde1` = 16, `isde2` = 17, `iscmp` = 18). The blind `+1` turned those into
"Week 17/18/19". `MAX_SEASON_WEEK` and `hasOutOfBandWeek` in `filterModel.ts` are now
the single home for the rule, shared by `filterOptions`, `weekMatches` and `TypeChip`;
`"other"` joins `WEEK_SPECIAL_VALUES` and `EventsSearchSchema`'s enum arm so the filter
round-trips through the URL.

Found by a test rather than by the review: `weekFilterLabel` now guards the bound
itself rather than trusting callers, because `EventsSearchSchema.week` accepts any
integer by design — a hand-edited `?week=16` would still have produced a "Week 17"
chip with only the `filterOptions` fix.

## Verification

Every new test was confirmed **failing against the unfixed code** before the fix landed
— including `Unable to find an accessible element with the role "group"` with the DOM
dump reading "There are no accessible roles", and
`expected [ 2, 3, 'offseason', 16, 17, 18 ] to include 'other'`.

The WR-01 fixture pins the three real event keys with their raw published week values,
so putting an out-of-band week back on the season scale requires deleting an assertion
rather than silently re-shipping "Week 17".

```
apps/web suite   → 75 files, 1169 tests, all passing
targeted re-run  → 5 files, 97 tests, all passing (independent check)
tsc --noEmit     → clean after each commit
```

The two known `payloadBudget.test.ts` failures are in `packages/harness`, outside both
this scope and the `apps/web` project — untouched.

## Still open from the same review

WR-02 through WR-08 and IN-01 through IN-05. Notable among them: a Result chip that
renders "Loss" for a team on neither alliance; two Events columns that sort by a
different quantity than they display; match times rendered in the viewer's timezone
with no label while event dates were deliberately pinned to UTC; and
`calibrationSeries.ts` left mostly dead by the deletion of `CalibrationChart.tsx`.
