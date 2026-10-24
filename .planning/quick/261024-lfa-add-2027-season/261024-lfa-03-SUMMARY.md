---
phase: quick-261024-lfa
plan: 03
subsystem: release command, web (Teams and Locks), docs
tags: [2027, roster-only-season, publish, read-back, teams-page, locks-page, docs]
status: complete
requires:
  - "261024-lfa-01: publish.ts --roster-seasons-only, rosterOnlySeason.ts, publish:seasons with 2027"
  - "261024-lfa-02: seasonGame.ts copy, GameNotOutState, DEFAULT_SEASON, the seasons mock in seasonReveal.test.ts"
provides:
  - "scripts/verifyRosterSeason.ts: verifyRosterSeasons(options, deps), compareRosterSeason(expected, observed), expectedRosterSeason, credential-free CLI --seasons <spec>"
  - "package.json publish:roster-seasons (ingest 2027, publish --roster-seasons-only, read back), pinned in publish.rosterOnly.test.ts"
  - "Teams and Locks pages: plain game not out state for a roster-only season, queries off"
  - "docs/worker-operations.md section 'A season before its game: 2027'"
  - ".planning/todos/pending/2027-season-before-the-game.md"
affects: [Jacob's release run, the reveal, January 2027 rules work]
tech-stack:
  added: []
  patterns: ["read-back by content: live manifest versions vs tree versions first, then per-key content checks against the corpus"]
key-files:
  created:
    - scripts/verifyRosterSeason.ts
    - scripts/verifyRosterSeason.test.ts
    - apps/web/src/routes/rosterOnlyPages.test.tsx
    - .planning/todos/pending/2027-season-before-the-game.md
  modified:
    - package.json
    - packages/harness/publish.rosterOnly.test.ts
    - apps/web/src/routes/teams.tsx
    - apps/web/src/routes/districts.tsx
    - .planning/PROJECT.md
    - docs/worker-operations.md
    - docs/models/epa-vs-statbotics.md
    - docs/models/epa-statbotics-gap.md
decisions:
  - "The release is a 2027-only write, not a rebaseline: keys carry no generation and the live algorithms manifest is never rewritten, so the read-back checks the live manifest versions against this checkout before any page"
  - "The verifier builds its expected event list from its own corpus query plus isCancelledEvent, never by importing publish.ts (whose import graph reaches r2Client)"
  - "Teams and Locks branch on isRosterOnlySeason before any data-reading markup, because keepPreviousData can hold the previous year's artifact while the query is off"
metrics:
  duration: "about 13 minutes"
  completed: 2026-10-24
actuals:
  tokens: 21000
  tasks: 3
  commits: 5
---

Run from the repo root: pnpm publish:roster-seasons
It takes a few minutes. It ingests 2027, writes only 2027 objects (about 650: an events list, an empty teams list and one page per event, for each of opr, epa and spr), never touches the live-windows manifest, D1 or any 2026 object, and does not pause live folding. No Worker deploy is needed (no Worker code changed). It ends by reading the objects back from data.sigmascout.org and prints VERIFIED, or lists what is wrong and exits 1.
After VERIFIED, the reveal is one line: in apps/web/src/lib/seasons.ts change CURRENT_SEASON = 2026 to 2027. Then run npx vitest run apps/web from the repo root, commit, push, check gh run list --limit 3, and open https://sigmascout.org/events?year=2027 in a real browser. 2026 stays the default.

# Phase quick-261024-lfa Plan 03: one-command 2027 release with a content read-back, honest Teams and Locks pages, docs Summary

`pnpm publish:roster-seasons` ingests 2027, publishes only 2027 and then reads it back from the live origin by content. The read-back checks the live manifest versions against this checkout first. The Teams and Locks pages show a plain "The 2027 game is not out yet" state for a roster-only season and request nothing for it. The docs and a January todo describe 2027 as a roster-only season and name the reveal.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (RED) | 26bbfd2c | test(quick-261024-lfa): add failing tests for the roster-season read-back and its command pin |
| 1 (GREEN) | c9a864b6 | feat(quick-261024-lfa): pnpm publish:roster-seasons ingests, publishes and reads back 2027 |
| 2 (RED) | a9e816f1 | test(quick-261024-lfa): add failing tests for the roster-only Teams and Locks pages |
| 2 (GREEN) | 6cf12db2 | feat(quick-261024-lfa): Teams and Locks pages show a plain game not out state for a roster-only season |
| 3 | 63f2d6bc | docs(quick-261024-lfa): 2027 as a roster-only season, the reveal, and the January checklist |

## What was built

- **`scripts/verifyRosterSeason.ts`** (credential-free). It reads no environment variable, does not import `r2Client` and does not import `publish.ts`. A source-level test pins all three. For each roster-only season in `--seasons` it:
  1. Fetches the live algorithms manifest (`AlgorithmsManifestSchema`) and compares each entry with `PUBLISHED_ALGORITHM_MODULES[id].version`. A mismatch, an unknown id or a missing id is a problem, and that algorithm's pages are skipped.
  2. Builds the expected 2027 list from the corpus: its own events and played-count query, filtered through `isCancelledEvent`, with rosters from `selectEventTeamsForEvents` minus `isDemoTeamKey`.
  3. Per algorithm, checks:
     - the events list: 200, `EventsArtifactSchema`, the season, exactly the expected keys, `teamCount` per roster, zero matches, and names;
     - the teams list: 200 and zero teams;
     - the event page of the largest roster (ties go to the smallest key): 200, `EventArtifactSchema`, exactly that roster, no matches or upcoming, and the corpus name.
  4. Prints `VERIFIED: ...` plus the `Reveal: ...` line and exits 0. Otherwise it prints every problem and `NOT VERIFIED` and exits 1. A spec with no roster-only season is refused before any fetch.
- **`package.json` `publish:roster-seasons`** is the plan's exact string. The pin test in `publish.rosterOnly.test.ts` ties it to the rest of the repo:
  - both `--seasons` values equal the `publish:seasons` spec;
  - the ingest years (`--year`, `--years`) equal `selectRosterOnlySeasons` of that spec, and that set is not empty. The failure message says to delete or retarget the script once no roster-only season is left;
  - it has `--roster-seasons-only` and `--include-offseason`, and no `--write-budget`;
  - the verify step runs after the publish step;
  - the ingest and publish steps use `--env-file=.env`, and the verify step does not.
- **`teams.tsx`**: `rosterOnly = isRosterOnlySeason(year)`, and the query's `enabled` includes `!rosterOnly`. The "Teams {year}" heading stays. The toggles are hidden. `GameNotOutState` with `gameNotOutTeamsBody(year)` takes the place of the filters, tier key, chart and table, and it branches before any markup that reads data. All hooks stay where they were.
- **`districts.tsx`**: the index query gets `enabled: !rosterOnly`, and the district query's `enabled` includes `!rosterOnly`. After the "Locks" h1 the page renders `GameNotOutState` with `GAME_NOT_OUT_LOCKS_BODY`. Every index, select, tab and empty-state branch is gated on `!rosterOnly`.
- **Events page**: no code change. The new test shows that it lists roster-only rows with their team counts and no error state.
- **Docs**:
  - `PROJECT.md`: the season timing line and the season coverage decision row.
  - `worker-operations.md`: the rebaseline bullet now says every published season. A new section covers the roster-only season, what the publisher writes, the seed and the window filter, the command, the read-back, the reveal, `publish:districts`, and the January trap with the 2027-02-20 date.
  - Both EPA docs: the parenthetical.
- **Todo** `2027-season-before-the-game.md`: items (a) to (f) as the plan listed them, with the fact corrections applied.

## Test results

Task 1 (`npx vitest run` from the repo root):
- scripts/verifyRosterSeason.test.ts: 8/8. RED first: the file failed at import.
- packages/harness/publish.rosterOnly.test.ts: 8/8 (7 existing and 1 new pin). RED first: the pin failed on the missing script.
- packages/harness/publish.test.ts: 244/244
- CLI refusal: `npx tsx scripts/verifyRosterSeason.ts --seasons 2016-2020,2022-2026` exits 1 with the refusal message and makes no fetch.
- Root `npx tsc --noEmit`: clean.

Task 2:
- apps/web/src/routes/rosterOnlyPages.test.tsx: 5/5. RED first: the Teams and Locks tests failed, and the non-vacuity and Events tests passed.
- teams.test.tsx and districts.test.tsx, together with the new file: 32/32.
- Whole web suite (`npx vitest run apps/web`), committed state: 155 files, 3417/3417.
- Web and e2e typechecks: clean.

Task 3:
- `grep -c publish:roster-seasons`: 1 in worker-operations.md and 3 in the todo. `grep -c roster-only .planning/PROJECT.md` prints 2.
- packages/harness/payloadBudget.test.ts: 13/13.
- `git diff --quiet -- docs/publish-budget.md`: exit 0, so the file is untouched.

Final verification: publish.rosterOnly, publish, verifyRosterSeason, publishLiveWindows and secrets-boundary all pass (279/279). Root typecheck is clean. `grep -c "export const CURRENT_SEASON = 2026;"` printed 1 before every commit. Nothing changed under `packages/core`. No algorithm version changed.

## Reveal rehearsal findings

`CURRENT_SEASON` was set to 2027 on the working copy with `sed`. Then the whole web suite, the web typecheck and the e2e typecheck ran, and 2026 was restored. The suite was then run again on the restored file. The edit was never staged.

- With 2027: 155 files, 3417/3417, and both typechecks clean. **Nothing was caught.** The new Teams and Locks branches added no test that depends on the season.
- After restoring 2026: 155 files, 3417/3417. `git status` showed `seasons.ts` clean.

## Live read-back dry check (read-only, before any publish)

Network was reachable from Bash, so the verifier ran once against `data.sigmascout.org` (public GETs only, no write):

- The live manifest matches this checkout: opr@6.0.0+baseline, epa@15.0.0+baseline, spr@11.0.0+baseline. So no manifest problem was reported.
- The corpus side reports 216 events, 190 with a roster. The page it checks is 2027tuis2, with 51 teams.
- It found 9 problems, all 404s on the 2027 keys. That is expected, since nothing is published yet. It ended with NOT VERIFIED and exit 1.

So Jacob's real run will check the keys the site actually reads.

## Deviations from Plan

1. **Tracer gate.** Auto mode is off, which would normally mean a human check after the tracer task. The orchestrator asked for all three tasks in one run. The gate was met by re-running the tracer's automated verify (260/260, CLI exit 1, clean typecheck) and by the live read-only check above.
2. **[Rule 2] More checks than the plan listed.** The verifier also checks:
   - an algorithm missing from the live manifest, and a manifest id this checkout does not publish;
   - event names, on both the list and the page;
   - an empty corpus season, which is reported as "run the ingest before verifying".

   Added tests: a `compareRosterSeason` unit test (404s name every key) and a source-level credential-free pin.
3. **[Rule 1] Locks roster test timing.** The first Locks test waited for the algorithms manifest, but the Locks page reads no algorithm version, so the manifest is never requested. That test now waits on a short timer. The fix went into the GREEN commit (6cf12db2). The Teams non-vacuity test also waits for the teams URL and the filter row, not just the table container, because the container also shows while the page is loading.
4. **Fact corrections applied as instructed:**
   - 216 events (TBA's count already includes the offseason and preseason events);
   - the first 2027 event is 2027-02-20, so its probe window would open 2027-02-19;
   - about 650 objects.
5. **Stale line reference.** `score.ts:279-286` is the `aggregateScores` undeclared-season throw. The Week 0 risk comes from the 261024-lfa research inventory. The todo states it as flagged by that inventory, with "check it before February". It does not claim it as verified.
6. **Skill path.** The skill path in the prompt (`~/.claude/skills/sketch-findings-sigmascout/SKILL.md`) does not exist, so the project skill was loaded through the Skill tool instead. The UI change reuses `GameNotOutState`, with no new colour or styling.
7. **STATE.md and ROADMAP.md were not touched**, as the orchestrator instructed.

## Known Stubs

None. The empty 2027 teams list and the roster rows with `metrics: {}` are the designed roster-only shape from plan 01.

## Self-Check: PASSED

- FOUND: scripts/verifyRosterSeason.ts, scripts/verifyRosterSeason.test.ts, apps/web/src/routes/rosterOnlyPages.test.tsx, .planning/todos/pending/2027-season-before-the-game.md
- FOUND in git log: 26bbfd2c, c9a864b6, a9e816f1, 6cf12db2, 63f2d6bc
- `grep -c "export const CURRENT_SEASON = 2026;" apps/web/src/lib/seasons.ts` prints 1. The working tree is clean apart from the untracked planning directory.
- No publish, Worker deploy or push was made. The only network use was the read-only verifier GETs.
