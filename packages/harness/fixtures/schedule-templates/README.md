# Committed schedule-template stand-ins

Three qualification-schedule templates in the same twelve-column layout
`packages/harness/scheduleTemplates.ts` parses:
`red1,red1Surrogate,red2,red2Surrogate,red3,red3Surrogate,blue1,...`, with
team values **one-based** and surrogate flags `1`/`0`.

## Why these exist

The production template cache, `data/schedule-templates/`, is gitignored and
never committed: those files are Team 254's cheesy-arena templates under
Team 254's own custom licence, which grants redistribution only for
contributing back upstream, and this repository is public. See
`scripts/fetchScheduleTemplates.ts` for the full statement.

That is correct, but it made CI red. `publishSeasons` builds a pre-schedule
sidecar per event, which loads a template, so 16 tests in
`packages/harness/publish.test.ts` reached the loader transitively and threw
`ScheduleTemplateMissingError` on a runner that has no cache — while passing
locally, off untracked local state. CI was red on that alone for 22
consecutive runs (2026-09-06 through 2026-09-09).

Skipping those 16 would have retired two gates worth keeping: the presim
sidecar tests, and the `publishSeasons`-vs-`--event` parity tests that guard
the cold-publish defect fixed in `41dbbe2d`.

## Provenance

**These are not Team 254's files and contain none of their content.** They
are schedules generated for this repository, checked to be byte-distinct
from the corresponding upstream cache entries, and cover only the three grid
cells the synthetic test fixtures actually request:

| File | Teams | Matches/team | Rows |
|------|-------|--------------|------|
| `6_1.csv` | 6 | 1 | 1 |
| `6_2.csv` | 6 | 2 | 2 |
| `8_2.csv` | 8 | 2 | 3 |

Row count is `ceil(numTeams * matchesPerTeam / 6)`. Each team plays exactly
`matchesPerTeam` non-surrogate matches; `8_2.csv`'s three rows hold 18 slots
against 16 non-surrogate appearances, so its last row carries the two
surrogate (`1`) appearances that make up the difference. No team appears
twice within a single match.

## When they are used

Only when `data/schedule-templates/` does **not exist at all** — a machine
that has never run `pnpm fetch:schedule-templates`. On a machine that has
the cache, a missing individual cell still throws
`ScheduleTemplateMissingError` exactly as before, so a half-fetched cache
cannot be masked by this fallback. Real FRC events are far larger than 6 or
8 teams, so a real publish cannot quietly land here.
