---
todo: exclude-offseason-demo-teams
resolves: .planning/todos/pending/exclude-offseason-demo-teams.md
phase: 07 (event-pages), landed between plan 07-19 and plan 07-20 per the todo's own sequencing
completed: 2026-08-29
status: complete
commits:
  - bd3d58c0 (feat: model exclusion, all three algorithms)
  - ca6804b2 (feat: published-surface exclusion, publish.ts)
  - c69b10a4 (docs: trivial comment-merge follow-up)
  - a7210237 (docs: docs/publish-budget.md + WINDOWS.md #11/#15 re-measurement)
---

# Exclude Off-Season Demo Team keys (frc9970-frc9999) — Summary

**Excluded all 30 TBA "Off-Season Demo Team" keys from OPR/EPA/VPR ratings via a shared,
never-published pseudo-entity (not column deletion), and from every published team surface;
full republish confirms 414 fewer team-season objects and moved real teams' ratings.**

## Treatment chosen, and why

The todo's own central design constraint asked for a case-1/case-2 split, evaluated against a
concrete measurement rather than assumed. That evaluation happened, and the recommended default
was adopted as-is:

- **Case 1 — fully-demo alliances (428 measured, all but 36 at offseason events).** The whole
  match is now a no-op for `update()` in all three algorithms — added to `opr.ts`, `epa.ts`, and
  `sigma1/index.ts`'s `update()` functions as an early-return guard
  (`isFullyDemoAlliance(result.redTeams) || isFullyDemoAlliance(result.blueTeams)`), checked
  against the raw, pre-remap roster. For OPR this guard is a defensive no-op today (OPR already
  ignores every non-`qm` comp level, and every real-event fully-demo alliance in this corpus is at
  `qf`/`sf`) — but it is load-bearing for EPA and VPR, which fold every comp level and would
  otherwise also learn from the 195 fully-demo `qm` rows this corpus carries at offseason events.
- **Case 2 — mixed alliances (7,684 measured: one demo robot beside two real teammates, or two
  demo robots beside one).** Every demo key is remapped to a single shared, never-published
  `DEMO_PSEUDO_TEAM_KEY` (`packages/core/algorithms/demoTeams.ts`) **before** it reaches any
  algorithm's design matrix or per-team state — the column is KEPT, under a shared identity, never
  deleted. This is the opposite of how OPR already treats surrogates (which delete the column and
  subtract an offset) precisely because that pattern would have reproduced the exact inflation bug
  the todo warns against: EPA and Sigma1 divide an alliance's observed score evenly across
  whichever teammates remain in `teams.length` — subtract a column without subtracting a
  proportional share of the target and the two real teammates silently absorb the third slot.
  Keeping (not deleting) the demo slot means `teams.length` stays 3, and the real teammates'
  arithmetic is untouched.

`ratingEligibleTeams` (`opr.ts`) is the ONE choke point all three algorithms already routed team
identity through for surrogate handling (per pre-existing project convention) — the remap was
added there once, so `predict()`/`update()` in EPA and Sigma1 needed no separate call site.

### A bug this design surfaced and fixed

Building the case-2 tests exposed that a real alliance can carry **two** demo robots beside one
real teammate — measured directly against the corpus: 715 red + 725 blue alliance-rows, not a rare
edge case. After remapping, both occurrences collapse to the same pseudo key, so
`solveEventOpr`'s design-matrix row lists that key twice. The pre-existing matrix-building code
(`M.set(row, idx, 1)`) OVERWROTE the column value instead of accumulating it, which would have
silently modeled a 2-demo-robot alliance as if only one demo slot existed — a genuine bias against
every equation a real team shares a season with. Fixed to `M.set(row, idx, M.get(row, idx) + 1)`,
with a dedicated regression test (`opr.test.ts`, "two demo teammates on one real alliance").

## Quantified: chosen treatment vs. naive column deletion

Measured directly in committed tests (`opr.test.ts`), not asserted:

| Scenario | Naive deletion (column dropped, alliance score kept full) | Chosen treatment (pseudo column kept) | Inflation naive deletion would have caused |
|---|---:|---:|---:|
| 1 demo + 2 real teammates, alliance score 90 | 45 per real teammate | 30 per real teammate | **1.5x** |
| 2 demo + 1 real teammate, alliance score 90 | 90 (all credited to the one real teammate) | 18 | **5x** |

For EPA and Sigma1, correctness is proven structurally rather than by a single hand-computed
number: an equivalence test in each of `epa.test.ts`/`sigma1.test.ts` shows a real teammate's own
learned state (component means, match count, Kalman beliefs) is **byte-identical** whether its
alliance-mate is a demo team or an ordinary third real team, given the same alliance score. That
equivalence is only possible because the demo slot is treated as a real slot under a shared
identity — the required "real teammate is NOT inflated" test.

Case 1 is pinned the same way: replaying a fully-demo forfeit match first, versus never replaying
it at all, produces byte-identical resulting state in all three algorithms (`opr.test.ts`,
`epa.test.ts`, `sigma1.test.ts`, "case 1: a fully-demo alliance never updates ANY rating").

## Published-surface exclusion

`packages/harness/publish.ts`'s `teamsThisSeason` — the single list that drives `teams/{year}`
rows, `team/{teamKey}/{year}` pages, and (via the client's shared `teams/{year}` fetch,
`apps/web/src/lib/search-index.ts`) both search and the Teams-page ranking — now filters out all
30 `frc9970`-`frc9999` keys at its one construction site. Event pages (`event/{eventKey}`) are
deliberately untouched: a demo robot's real historical presence in an event's own match/alliance
record is not in this todo's scope and stays visible, matching the developer-directed decision
that this is a team-page/list/search/ranking exclusion, not an event-history rewrite.

Tests: `publish.test.ts` seeds a corpus with a mixed-alliance match and a fully-demo playoff match,
runs `publishSeasons` for real, and asserts against the actual `putObject` calls — no
`team/{teamKey}` page for any demo key, no row for any demo key in the `teams/{year}` artifact,
while the real teammates' own pages and rows ARE present.

## Republish, verify, re-measure

Full republish: `pnpm publish:seasons` (`--seasons 2022-2026 --include-offseason`), 23m38s wall
clock (`23:28:41Z`-`23:52:19Z`), generation `961340e8-9e45-4d91-8e85-f72982ac3d87`. Checked for
stray processes before AND after (`tasklist`, clean 12-process baseline both times — no repeat of
07-17's zombie-process incident); confirmed complete via the log's own final summary line, not
exit code alone.

**Object counts, confirmed against real published bytes (not projected):**

| Page kind | Before (47d020a4-...) | After (961340e8-...) | Delta |
|---|---:|---:|---:|
| `team/{teamKey}/{year}` | 53,010 | 52,596 | **-414** (exactly 138 team-seasons x 3 algorithms) |
| `teams/{year}` | 15 | 15 | 0 (same count, contents changed) |
| Total objects (page + manifest) | 57,190 | 56,776 | -414 |
| Total bytes | 3,358,758,125 | 3,309,108,967 | -49,649,158 (-1.48%) |

**`team/{teamKey}/{year}` new maximum, CONFIRMED not assumed:** `v1/team/frc3538/2024/vpr@2.0.0+tuned-2026-08.json`,
**675,943 bytes** — exactly the team-season the todo predicted (`~682,000 bytes estimated`), a
17.76% drop from the prior maximum (821,938 bytes at `frc9999/2024`, a demo key that no longer
publishes at all). `docs/publish-budget.md`'s machine-readable block and prose were both
re-measured against this real run.

**A representative real team's rating moved, fetched live before and after this run:**
`frc4613` (2026) shared an alliance with demo team `frc9992` at `2026audd`'s playoff finals.

| Algorithm | Before | After |
|---|---|---|
| `vpr` | 205.93 ± 8.47 (percentile 98.0) | 201.86 ± 7.90 (percentile 97.9) |
| `opr` | 262.0 (percentile 99.1) | 274.09 (percentile 99.2) |

**Post-run health check:** `pnpm verify:subset` — 35 entries checked, 0 failing, generation
uniformity 1 distinct value across every non-retired-prefix entry.

## Explicit non-goal — confirmed, not fixed

Both previously-crossed payload ceilings stay crossed, and neither `budgetMaxBytes` nor the
absolute structural ceiling was raised:

- `teams/{year}`: 3,732,955 -> **3,705,194 bytes** (-0.74%), still over `budgetMaxBytes` 3,500,000.
- `team/{teamKey}/{year}`: 821,938 -> **675,943 bytes** (-17.76%), still over BOTH `budgetMaxBytes`
  375,000 (80.3% over) and the 600,000-byte absolute structural ceiling `payloadBudget.test.ts`
  enforces (12.7% over).

`.planning/WINDOWS.md` ledger #11 and #15 both had their measured FIGURES updated to these new
numbers and remain `status: open` — neither was closed, per the todo's explicit instruction.

## A known residual, honestly disclosed (not in the todo's literal acceptance criteria)

Because R2 has no cascading delete and `publishSeasons` only ever `PUT`s keys it is asked to
build, the ~414 `team/{teamKey}/{year}` objects the PRIOR generation wrote for demo keys still
physically exist in the bucket. Confirmed directly: `v1/team/frc9992/2026/vpr@...` still returns
`200` after this run, but carries the STALE `47d020a4-...` generation stamp — an orphan, reachable
only by guessing its exact old URL, and confirmed ABSENT from `teams/2026`'s listing (0 of 3,718
rows match a demo key) and therefore from search and ranking too. A future cleanup pass could
delete these, generalizing `scripts/deleteRetiredAlgorithmObjects.ts`'s
enumerate-then-delete-then-census pattern from "retired algorithm id" to "excluded team key" — not
built here, since the todo's acceptance criteria describe the publish-time exclusion, verified
above, not a bucket-cleanliness guarantee.

## Also discovered, deliberately left out of scope

The live incremental Worker (`apps/worker/src/scheduled.ts`, `processEvent`'s `touchedTeams`) does
NOT apply this same demo-team exclusion — if a live event ever featured a genuine demo-team match,
Phase B would still write a `team/{teamKey}` R2 artifact and a D1 team-scope row under the raw
demo key. This is genuinely out of this todo's scope: its measured blast radius and acceptance
criteria are entirely about the offline `data/corpus.sqlite` / `publish.ts` pipeline, and this
session has no live Worker deployment to re-measure a Worker-side change against (this todo's own
instruction: re-measure anything you change). Attempting to append this finding to
`.planning/WINDOWS.md` via `gsd-tools windows append` failed with a pre-existing CRLF
frontmatter-parsing bug in that tool, unrelated to this todo; per the tool's documented
best-effort contract, recording it here in this SUMMARY instead is the fallback. Routed forward
for a future plan with live Worker access.

## Test baseline

Before: 1970 passed / 2 failed (accepted, ledgered) / 1 skipped.
After: 1995 passed / 2 failed (same two, same reason, updated figures) / 1 skipped — +25 new
tests (`demoTeams.test.ts` x12, plus new cases in `opr.test.ts`/`epa.test.ts`/`sigma1.test.ts`/
`publish.test.ts`), zero regressions. `pnpm typecheck` clean.

## Secrets boundary

No `.env` value was ever rendered to any output stream, log, command, or file in this session —
`pnpm publish:seasons` (`tsx --env-file=.env ...`) read it itself, per the established pattern.

## Files touched

- `packages/core/algorithms/demoTeams.ts` (new) / `demoTeams.test.ts` (new)
- `packages/core/algorithms/opr.ts`, `opr.test.ts`
- `packages/core/algorithms/epa.ts`, `epa.test.ts`
- `packages/core/algorithms/sigma1/index.ts`, `sigma1/sigma1.test.ts`
- `packages/harness/publish.ts`, `publish.test.ts`
- `docs/publish-budget.md`
- `.planning/WINDOWS.md` (ledger #11, #15 figures updated, both left open)

## Follow-on

- `.planning/todos/pending/remeasure-accuracy-record-offseason-inclusion.md` may now run — this
  exclusion landed first, per its own sequencing requirement.
- Phase 07 plan 07-20 (backstop e2e evidence) can now run against genuinely final pages.

## Scope clarification — developer decision, 2026-08-30

This todo's own wording said the demo keys must be excluded from "every published surface." That
phrasing is **wider than what shipped, and wider than what the developer subsequently decided
should ship.** Recorded here so the record matches reality rather than the original aspiration.

**What IS excluded** (`frc9970`–`frc9999`, all 30 keys):

- Every algorithm's ratings — no rating is learned for a demo key, and the 428 fully-demo
  alliances (forfeit/no-show playoffs at real regionals and districts) are dropped as non-contests.
- `team/{teamKey}/{year}` pages — 138 team-seasons × 3 algorithms stopped publishing, and the 414
  pre-exclusion orphans were deleted from R2 and read-back confirmed 404.
- `teams/{year}` lists, search, and team rankings.
- The Worker's incremental fold path, so a live offseason event cannot re-create any of the above.

**What is NOT excluded, deliberately:** an event artifact's own `teams[]` roster. Demo keys still
appear as rows on the event page's Insights and Breakdown tabs, carrying the `rank` and `record`
TBA itself publishes for them, with an EMPTY `metrics` object — no rating, so they cannot distort
any prediction.

Surfaced by code review as finding WR-02 (`07-REVIEW.md`) and verified live: `2025auwarp` returns
30 event teams of which 20 are demo keys, each with `metrics: {}` and a real TBA rank.

**Why it was left that way.** An event's team list is a record of who was physically on the field,
and TBA's own rankings for that event include these entries at exactly these ranks. Removing them
would put this site's event rank column in disagreement with TBA's published rankings and leave
gaps in the rank sequence — against this project's standing preference to match the convention the
FRC community already reads. They carry no rating, so the contamination this todo existed to fix
does not reach them.

The accurate scope statement is therefore: **excluded from the model and from every TEAM-scoped
published surface; retained as unrated roster rows in event-scoped artifacts.**
