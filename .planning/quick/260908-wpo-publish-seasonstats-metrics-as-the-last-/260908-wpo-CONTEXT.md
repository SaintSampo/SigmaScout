# Quick Task 260908-wpo: publish seasonStats.metrics as the last-official-match snapshot - Context

**Gathered:** 2026-09-08
**Status:** Ready for planning

<domain>
## Task Boundary

`seasonStats` in the published team artifact mixes two bases. Make it internally
consistent, and name the basis on the object so it cannot drift silently again.

Follows the pending todo
`.planning/todos/pending/season-final-metric-is-not-what-any-page-shows.md`
(Option 1 of the three it lists), opened by quick task 260908-n5o.

Out of scope: any change to EPA, VPR, BPR or OPR rating maths. This changes which
already-computed number is written into one artifact field. No model moves.

</domain>

<decisions>
## The defect, measured

`packages/harness/publish.ts` already scopes the record to official play
(`teamStatsOfficial`, quick task 260908-615) but writes SEASON-FINAL metrics into the
same object:

| `seasonStats` field | Basis today |
|---|---|
| `record`, `matchCount`, `eventCount` | official play only |
| `metrics` | season-final, offseason and preseason included |

Live, `epa@6.0.0+baseline`, 2026:

| Team | Teams list total | `seasonStats.metrics.total` | last-official row |
|---|---:|---:|---:|
| frc7769 | 313.95 | 251.37 (pct 99.3) | 313.95 (pct 99.9) |
| frc88 | 155.96 | 182.75 (pct 96.4) | 155.96 (pct 94.4) |
| frc2056 | 302.03 | 277.79 (pct 99.7) | 302.03 (pct 99.9) |
| frc254 | 328.39 | 328.39 (pct 99.9) | 328.39 (pct 99.9) |

Teams with no offseason play agree exactly. Every team with offseason play splits, on
value AND percentile. `lastOfficialRow.metrics.total` equals the Teams-list total
exactly, so the correct values already exist in the publisher.

## The fix is a reuse, not a new computation - LOCKED

`publish.ts` already builds `officialMetricsByTeamWithPercentiles` (line ~2402) for the
Teams list, from `lastOfficialMetricsByTeam` + `withPercentiles`. The team artifact's
call site (line ~2730) passes `metricsByTeamWithPercentiles[teamKey] ?? {}` instead.

Change that call site to prefer the official record. Do NOT introduce a second
derivation of officialness; the `officialEventKeys` set already exists and the codebase
has already paid for a duplicate derivation once.

## Offseason-only teams keep their numbers - LOCKED, this is the trap

An offseason-only team is deliberately ABSENT from `officialMetricsByTeam` (that
function's own doc comment says so). A naive `officialMetricsByTeamWithPercentiles[teamKey] ?? {}`
would publish EMPTY metrics for them, and their team page would go blank.

Measured population: 39 such teams in 2026, 97 in 2025, 97 in 2024. Not negligible.

Today those teams DO show numbers: `SeasonHeader.tsx` resolves
`metricsOverride ?? artifact.seasonStats.metrics`, and `officialSnapshotRow` returns
undefined for them, so the season-final values render. Blanking them would be a
regression introduced by a bug fix, which is worse than the bug.

**Required behaviour:** official snapshot when the team has any official play,
season-final fallback when it does not. Never an empty metrics object where values
exist today.

## Name the basis - LOCKED

Add `seasonStats.metricsBasis` with exactly two values, `"last-official-match"` and
`"season-final"`, set per team to whichever branch produced the values.

This is the same lesson quick task 260908-n5o applied to the EPA comparison artifact's
`basis: "last-official-match"` field. A silent fallback is how this defect survived:
`seasonStats.metrics` never said which quantity it carried, so nothing could catch it
changing meaning per team. A consumer must be able to tell from the object alone.

## The stale comment is part of the fix

`publish.ts` around line 2390-2400 currently ends with: "the per-team artifact's
`seasonStats`/`metricHistory` sections stay season-final, exactly as before." That
sentence documents precisely the behaviour being changed, and this project's failure log
names a document asserting something untrue about the system as its defining past
failure. Correct it in the same commit, and say what changed and why rather than
deleting it.

`metricHistory` genuinely DOES stay season-final and must not be touched. It is the
metric-history chart's source and it carries the offseason rows that make an offseason
event section render its own end-of-event state. Only `seasonStats.metrics` moves.

## Client

`SeasonHeader.tsx`'s `metricsOverride ?? artifact.seasonStats.metrics` can stay as is.
Once the published fallback is correct the override resolves to the same values, so it
becomes redundant rather than wrong. Leaving it is the low-risk choice and it keeps
working against artifacts published before this change. Do not delete it in this task.

The fix does remove a real user-visible glitch: today, for a team with offseason play,
the header renders the season-final number until the events artifact loads and the
override kicks in, so the number visibly changes after load.

## Claude's Discretion

- Exact field placement and naming style for `metricsBasis` inside the schema.
- Whether the publisher computes the per-team branch inline at the call site or via a
  small named helper. A named, exported helper is easier to unit test and matches how
  `lastOfficialMetricsByTeam` itself is exported for that reason.
- Test shape, provided an offseason-only team is covered explicitly.

</decisions>

<specifics>
## Specific Ideas

Key locations, verified 2026-09-08:

- `packages/harness/publish.ts:2401-2402` — `officialMetricsByTeam` /
  `officialMetricsByTeamWithPercentiles`, already built
- `packages/harness/publish.ts:~2730` — the team artifact call site to change
- `packages/harness/publish.ts:228-265` — `lastOfficialMetricsByTeam` and its
  offseason-only omission contract
- `packages/harness/publish.ts:2305` — `teamStatsOfficial`, the precedent for
  official-scoping in this same object
- `packages/harness/publish.ts:1044` and `1234` — `buildTeamSeasonArtifact`'s
  `seasonStats` type and construction
- `packages/harness/pageArtifacts.ts` — `TeamSeasonArtifact` schema
- `apps/web/src/components/team/SeasonHeader.tsx:138` — the client fallback

**Operational constraints that have bitten this project before:**

- An executor subagent's sandbox denies ALL network Bash. It cannot run the republish.
  That step is ORCHESTRATOR-RUN from the main context.
- This change requires a FULL republish (`pnpm publish:seasons`) before any live
  verification means anything. Roughly 75,000 objects, and it takes a long time.
- `publish:seasons` prints a budget summary but does NOT write
  `docs/publish-budget.md`. Transcribe it manually or the budget tests stay red.
- Publish ordering is load-bearing: artifacts before manifest.
- Never `Read`, `cat` or echo `.env`.
- Run vitest from the REPO ROOT, not `apps/web`. Never wrap it in `timeout ... pnpm`.
- Root `tsc --noEmit` does not cover `apps/web`; typecheck both.
- TWO root typecheck errors are PRE-EXISTING and belong to another session:
  `packages/harness/tune.test.ts(1069)` and `packages/harness/stateSnapshot.test.ts(1008,1027)`.
  Do not fix them, do not count them as this task's.
- **Another session is editing this checkout concurrently, including `publish.ts`.**
  Stage every commit by explicit path. Never `git add -A`.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/todos/pending/season-final-metric-is-not-what-any-page-shows.md` — the
  todo this closes, including its verification recipe
- `docs/models/epa-vs-statbotics.md` — the published-quantity section, same lesson
- `.claude/CLAUDE.md` — secrets handling, methodology and provenance constraints

</canonical_refs>
