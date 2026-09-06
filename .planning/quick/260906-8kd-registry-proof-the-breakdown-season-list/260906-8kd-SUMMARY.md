---
phase: quick-260906-8kd
plan: "01"
subsystem: breakdown-test-infra
tags: [testing, registry-pattern, breakdown, tech-debt]
status: complete
dependency-graph:
  requires: []
  provides:
    - BREAKDOWN_REGISTERED_SEASONS (packages/core/algorithms/breakdown/index.ts)
  affects:
    - packages/core/algorithms/breakdown/groups.test.ts
    - packages/core/algorithms/breakdown/reconciliation.test.ts
tech-stack:
  added: []
  patterns:
    - "Registry-derived test iteration (mirrors sigma1/rp/rules.ts + rules.test.ts, and districts/pointModel.ts + pointModel.test.ts)"
key-files:
  created: []
  modified:
    - packages/core/algorithms/breakdown/index.ts
    - packages/core/algorithms/breakdown/groups.test.ts
    - packages/core/algorithms/breakdown/reconciliation.test.ts
    - .planning/todos/pending/extend-corpus-2018-2017-2016.md
decisions:
  - "Exactly ONE pinned equality assertion, in groups.test.ts (pure unit test, no corpus) — mirrors the RP precedent, where RP_REGISTERED_SEASONS has four consumers and a single pin in rules.test.ts, deliberately not in the corpus-gated reconciliation.test.ts"
  - "No emptiness/non-vacuity guard added — reconciliation.test.ts's existing expect(rows.length).toBeGreaterThanOrEqual(SAMPLE_SIZE) already turns a registered-but-not-ingested season into a loud failure"
  - "pointModel.test.ts left untouched: it was never a defect, and the todo's claim that it was has been corrected"
metrics:
  duration: "~15min"
  completed: 2026-09-06
actuals:
  tokens: 9500
  tasks: 3
  commits: 3
---

# Quick Task 260906-8kd: Registry-proof the breakdown season list — Summary

Closed the silent hardcoded-season-list trap in the breakdown test suite, so that extending the
corpus to 2018 (then 2017, 2016) cannot ship an unproven component map with a green suite.
Prerequisite work for `.planning/todos/pending/extend-corpus-2018-2017-2016.md`; no season was
registered by this task.

## What changed

**Task 1 — the export and the first consumer** (`02ff057a`). Added
`BREAKDOWN_REGISTERED_SEASONS` to `breakdown/index.ts`, derived from the module-private
`SEASON_COMPONENT_MAPS` by the identical expression `rules.ts` uses for `RP_REGISTERED_SEASONS`.
`groups.test.ts`'s module-level `const SEASONS = [...]` deleted; its three `for...of` sites now
read the tuple. Added the one loud pin.

**Task 2 — the second consumer** (`3df826e6`). `reconciliation.test.ts`'s module-level
`REGISTERED_SEASONS` deleted; both `describe.each` (season reconciliation) and `it.each`
(prototype-poisoning regression) now read the same tuple. Provenance doc comment preserved and
re-anchored at the import; its "all seven seasons" phrasing dropped, since that count goes stale
the moment 2018 lands.

**Task 3 — a factual correction to the todo** (`dccdf1f4`). See below.

## The todo was wrong, and this task is what disproved it

`extend-corpus-2018-2017-2016.md` (committed hours earlier, same day) named **three** files under
"THE TRAP", including `packages/core/districts/pointModel.test.ts`. That was wrong, and the error
originated with the ORCHESTRATOR's own brief to the planner — not with either subagent.

Checking how each list is actually *consumed* is what settled it, and the distinction is the
useful part:

| consumption | failure mode |
|---|---|
| iteration list (`for...of`, `describe.each`) over a hardcoded literal | **silent** — a new season is simply never tested |
| equality assertion (`toEqual([...])`) against a registry | **loud** — fails the instant a season is registered |

`pointModel.test.ts` was already in the second category *and* already iterated
`DISTRICT_REGISTERED_SEASONS` at line 21. It was never a defect — it is the exemplar the two
breakdown files have now been brought up to. The todo's section is corrected as a dated
2026-09-06 correction rather than a silent rewrite, following the predecessor file's own habit
("CORRECTED 2026-09-03 — the flags DO get recomputed; the earlier instruction here was wrong").
Investment #1 in "Then 2017, then 2016" is marked DONE, with the count corrected from three
files to two.

## Verification

**Behaviour preservation, by machine diff.** vitest `--reporter=json` `fullName` lists captured
before any edit and after all edits, run from the repo root:

```
2a3
> BREAKDOWN_REGISTERED_SEASONS is the sorted tuple 2019, 2020, 2022-2026 (2021 absent — no standard FRC season was played)
```

Exactly one added line — the new pin's own name — and zero removed. Every season-labelled test
name is byte-identical. The season set exercised is unchanged: 2019, 2020, 2022–2026.
`tsc --noEmit` error set unchanged (compared as a set against the known-red baseline, never
against zero).

**Independently re-verified by the ORCHESTRATOR**, not taken on the executor's report — this
task existed because a claim about these very files turned out to be false:

- `npx vitest run packages/core/algorithms/breakdown` from the repo root: **3 files, 74 tests,
  all passing.**
- Per-commit `git show --name-only`: each of the three commits touches exactly its intended
  file(s) and nothing else.
- `git diff --quiet 02ff057a~1 dccdf1f4 -- packages/core/districts/pointModel.test.ts` → clean.
  The out-of-scope file was genuinely not touched.
- Only one season literal survives in either test file: the intentional pin at
  `groups.test.ts:13`.

**Proof the trap is actually closed**, read off the post-change source rather than assumed.
Registering 2018 in `SEASON_COMPONENT_MAPS` without any other edit now fails three distinct ways:

1. `groups.test.ts:13` — the pin's `toEqual` no longer matches (the conscious-edit tripwire).
2. `groups.test.ts:38-42` — `expect(componentGroupsForSeason(season)).toBeDefined()` fails, because
   `GROUPS_BY_SEASON` has no 2018 entry.
3. `groups.test.ts:20-35` — every declared component must be grouped or explicitly ungrouped, so
   the grouping must be *decided*, not merely present.

And once 2018 IS grouped but not yet ingested, `reconciliation.test.ts:89`'s existing
`SAMPLE_SIZE` floor fails rather than passing vacuously. No new guard was needed for that; it is
recorded here so a later reader does not add a redundant one.

## Exactly one pin, and why

`groups.test.ts` carries the single pin; `reconciliation.test.ts` carries none. The planner
verified the precedent rather than assuming it: `RP_REGISTERED_SEASONS` has **four** consumers
and exactly **one** pin, in `rules.test.ts` — the pure unit-test file whose header says "no
corpus access" — deliberately not in the corpus-gated `reconciliation.test.ts`, which skips
wholesale without `data/corpus.sqlite`. Two pins would mean two edits per future season
registration, which is the duplication the RP precedent already declined.

## Concurrency

Another session landed two unrelated commits (`9340100c`, `4b4d2f5e`) between this plan's Task 1
and Task 2. Scope verification was therefore done against the three specific commit hashes rather
than a `HEAD~3..HEAD` range, which would have been misaligned. Every commit staged by explicit
path with a `git diff --cached --name-only` equality assertion before committing — the mitigation
added after quick task 260906-813, where that assertion was printed but not read, and 206 lines
of another session's work were absorbed. No mismatch occurred this time.

## Deviations from Plan

None. All gates passed on the first attempt with no auto-fixes.

## Commits

- `02ff057a` — refactor(quick-260906-8kd): derive the breakdown season list from the registry
- `3df826e6` — refactor(quick-260906-8kd): drive reconciliation.test.ts from the breakdown registry
- `dccdf1f4` — docs(quick-260906-8kd): correct THE TRAP — two files, both now registry-driven
