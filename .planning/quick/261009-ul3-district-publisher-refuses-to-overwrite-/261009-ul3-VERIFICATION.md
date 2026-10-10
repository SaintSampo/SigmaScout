---
task: 261009-ul3
verified: 2026-10-10
status: passed
score: 5/5 checks verified
gaps: []
---

# Quick task 261009-ul3 verification

Goal: the offline district publisher refuses to overwrite live facts with older ones, never uploads on a refusal, and does not change what it composes. Commits `3f0421af`, `14bb1b07` over base `0aafac90`.

## Test run (from the repo root)

`npx vitest run scripts/districtPublishGuard.test.ts scripts/publishDistricts.test.ts packages/harness/r2ClientRetry.test.ts`

Printed: `Test Files 3 passed (3)`, `Tests 146 passed (146)`, duration 11.39 s. The corpus-backed `run()` tests were not skipped (the file count and test count show no skips).

## 1. Regression detection (scripts/districtPublishGuard.ts)

| D1 fact | Code | Status |
| --- | --- | --- |
| alliancesPicked / playoffsDone / awardsPosted true live, not true now | lines 203-207, loop over STATE_FLAGS | VERIFIED |
| qualMatchesPlayed lower | lines 209-217 | VERIFIED |
| qualifyingAward (team, event, awardType) gone | lines 229-239, keyed by team + award type | VERIFIED |
| eventPoints row (team, event) gone | lines 222-225 | VERIFIED |

Clean cases, read in code and pinned by tests: flag false to true (never compared in that direction), a team that gains a row (only live's rows are walked), an award added, an event on one side only (the `shared` filter at line 193), a district with no published object (null, counted `notPublished`), an unparseable or wrong-shape body (counted `unparsed`, logged, skipped). An identical artifact compares clean because the same fold runs on both sides.

Hunt for misses and false alarms:
- State is per row and optional, so the module folds it per event (any true, max played). A flag on only some rows cannot cause a false alarm. Live state with no state on this run's side is flagged, and an all-false, zero-played live state against no state is not.
- A same award type held by a different team is correctly a lost fact for the first team.
- Not compared, by design and stated in D1: an event named by only one side, a lower point value on a surviving row, `qualMatchesTotal`. Observation, not a gap: a whole event disappearing from this run's artifact is not flagged, which D1 sets out explicitly ("an event present only in old ... is not compared").
- A team that moves out of the district would raise a points-row regression and need `--allow-regress`. That is a legitimate refusal under D1, not a false alarm on a newer artifact.

## 2. A refusal writes nothing (scripts/publishDistricts.ts `run`)

- Every upload goes through the single `writeObject` binding (lines 1825, 1900, 1920, 1945). The grep for `putObject` finds only the import, the default for that binding, and comments. District details, sidecars and the index are all covered.
- Order in `run`: compose every season (`composedSeasons`), guard pass one over every district of every season, bake all seasons into `prepared`, guard pass two, then the upload loop. A throw from either pass leaves the upload loop unreached, so a later season is never checked after an earlier one uploaded.
- The only local file writer, `mkdirSync`/`writeFileSync` in the byte-gate helper (line 1806), is called only inside the post-guard loop. The test "refuses before any write" asserts the `--local-out` directory is empty and zero writes.
- `main` catches and calls `process.exit(1)` (line 1981).
- Pre-existing and unchanged: a byte-budget throw for a later season can still happen after an earlier season uploaded. That is not a guard concern and the guard is already past by then.

## 3. Read failures and dry runs

- `guardLivePublish`, enforce mode (lines 306-311): any read failure throws `DistrictPublishRefusedError`, before the `allowRegress` branch (line 349), so `--allow-regress` cannot cover it. Pinned by "a read failure rejects ... with or without --allow-regress".
- `guardMode` (publishDistricts.ts, the `guardMode` assignment in `run`): `undefined` for a plain `--dry-run`, so zero reads (test "a dry run reads nothing" uses a reader that errors and asserts `calls` is empty). `--dry-run --check-live` is `report`, which logs a read failure and continues and returns without throwing (lines 312-314, 346). It makes pass one only.
- Production reader is `options.readPublished ?? getObjectIfExists`, resolved on the reading path only.

## 4. r2Client

`getObject` is untouched (the diff only adds `getObjectIfExists` and edits one comment). `getObjectIfExists` calls `sendWithRetry`, the same loop `putObject` and listing use, with a predicate accepting 2xx and 404. A 404 returns `null` after cancelling the body. The five `getObjectIfExists` tests in `r2ClientRetry.test.ts` pass: 200, 404 after exactly one request, retry of 500 twice, permanent 403 that names the key and not the account, and give up on a persistent 503 after 5 attempts.

## 5. Nothing composed changes

The guard module does no I/O, reads the composed artifact (before the baked-event list is attached) and mutates nothing. In `run` the composed and baked inputs are unchanged. The only restructuring is that seasons are all composed, then all baked, then all uploaded, instead of one season at a time. Seasons share no state. I did not re-run a dump comparison (it needs the corpus and a long compose). The SUMMARY reports the no-bake dump identical (119 files, 0 differing) and its own before and after bake dumps identical over 42 files, and the code reading supports that.

## Cited as given (orchestrator, production read)

`--dry-run --no-bake --check-live`: `109 district(s) compared, 0 not published yet, 0 not parseable, 0 unreadable, 0 live fact(s) this run would lose`.

## Docs

`docs/worker-operations.md` has the new subsection with the six facts, both passes, the 404 and parse rules, the override and the non-overridable read failure, the `--check-live` command, and the remaining seconds-wide window. It matches the code. The claim that `pnpm rebaseline` runs neither `publish:districts` nor the districts ingest pass is consistent with `package.json`, which holds no rebaseline reference to either.

## Gaps

None.

## Residual risks (warnings, not gaps)

- The Worker can write between the second read and a district's own upload, a window of seconds. The docs name it and say a conditional put would close it.
- Whole-event disappearance and lower point values are deliberately not detected, per D1.
