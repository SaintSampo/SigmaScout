# Quick Task 261009-ul3: The district publisher refuses to overwrite live facts with older ones - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning

<domain>
## Task Boundary

Jacob, 2026-10-09: "fix the gaps. do not leave anything undone." Leftover (f) of quick task 261009-r9x: an offline district publish built from a corpus OLDER than what the live Worker has already written replaces the live artifact and loses facts the Worker recorded (an event's playoffs done, awards posted, who won a qualifying award). The Worker cannot notice: its rankings request then answers 304 and nothing re merges. The published flag falls back to false, which holds reservations (safe), but a regressed `playoffsDone` is never asked about again (quick task 261009-tx6 CONTEXT D7).

The fix is at the source: `scripts/publishDistricts.ts` checks the currently published district artifact before each upload and refuses a regression. In normal use (`pnpm rebaseline` ingests first) the check never fires.

Scope: `scripts/publishDistricts.ts`, a small pure comparison module beside it (or in `packages/harness`), tests. `packages/harness/r2Client.ts` already has `getObject`. No artifact shape change, no Worker change, no browser change.

</domain>

<decisions>
## Implementation Decisions

### D1. What counts as a regression
For one district artifact, comparing the PUBLISHED artifact (old) with the one about to be uploaded (new), per event key present in both:
- `state.alliancesPicked`, `state.playoffsDone` or `state.awardsPosted` true in old and false in new;
- `state.qualMatchesPlayed` lower in new than in old;
- a `qualifyingAwards` entry (team, event key, award type) present in old and absent in new;
- an `eventPoints` row (team, event key) present in old and absent in new.
A district with no published artifact, or an old artifact that fails to parse, is not a regression (first publish, or a shape change). An event present only in old or only in new is not compared.

### D2. What the publisher does
- On a real upload (not `--dry-run`, not `--local-out` alone), before each district detail `putObject`: `getObject` the same key, compare, and if any regression is found REFUSE the whole run before the first upload: print one line per regressed fact (district, event, team where it applies, old value, new value), then a plain instruction ("the corpus is older than what is live; run the ingest first"), and exit non zero. The check runs for every district of the run BEFORE any upload starts, so a refusal leaves R2 untouched.
- A missing object (404) is "no published artifact". Any other read failure refuses the run (fail closed) with the error, because publishing blind is what this guard exists to stop.
- `--allow-regress` skips the refusal, still prints the list, and says it was overridden.
- `--dry-run` runs the same comparison only when `--check-live` is also given (dry runs must stay offline by default); it prints the list and never fails.
- The reader is injectable so the tests need no network.

### D3. Tests
- The pure comparison: each regression kind detected; an identical artifact, a newer artifact (more matches, flag false to true, an added award) and a first publish are clean.
- The publisher wiring with a fake reader and a fake writer: a regression refuses before any write; `--allow-regress` writes; a 404 writes; a read error refuses; a dry run reads nothing.
- The existing publisher tests pass unchanged.

### D4. Docs, todo
- `docs/worker-operations.md` (the district publish section): one paragraph on the guard and the override.
- The todo's leftover (f) is closed by this task.

### Claude's Discretion
- Module name and placement; the exact wording of the printed lines (plain, one fact per line).
- If a step is ambiguous, refuse rather than publish, and record the reading.

</decisions>

<specifics>
## Specific Ideas

- Upload sites: `scripts/publishDistricts.ts` ~1816 (the district detail), ~1836 (sidecars), ~1861 (the index). Only the district DETAIL artifacts are compared.
- `getObject(bucket, key)` in `packages/harness/r2Client.ts` ~309 returns the body text and has the retry policy of the client.
- Tests: `npx vitest run <paths>` from the repo root (never `timeout <n> pnpm`); three typechecks chained with `&&` and a sentinel echo; final full `npx vitest run`. The executor has no network and must not run a real publish. Never Read, cat or echo `.env`.

</specifics>

<canonical_refs>
## Canonical References

- `scripts/publishDistricts.ts`, `scripts/publishDistricts.test.ts`, `packages/harness/r2Client.ts`, `packages/harness/pageArtifacts.ts` (`DistrictArtifactSchema`)
- `.planning/quick/261009-r9x-awards-posted-flag-waits-for-a-judged-aw/261009-r9x-SUMMARY.md` (leftover f), `.planning/quick/261009-tx6-worker-awards-watch-settle-time-day-long/261009-tx6-CONTEXT.md` (D7)
</canonical_refs>
