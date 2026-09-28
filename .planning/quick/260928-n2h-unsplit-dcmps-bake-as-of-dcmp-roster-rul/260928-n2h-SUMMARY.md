---
quick_id: 260928-n2h
status: complete
date: 2026-09-28
---

# Quick Task 260928-n2h: undivided DCMPs bake, the as-of DCMP field rule, a pre-event F3c, the seed cwd and refusal logs

**What changed:** the district bake now prices undivided DCMPs. An as-of run no longer prices a DCMP from a roster that did not exist yet. The field-averaged measurement reads pre-event inputs. The seed step of `pnpm rebaseline` runs wrangler from apps/worker. Every silent presim or bake refusal now logs the teams that caused it. No published number changes, so there is no version bump and no republish.

## Commits

- **1fff4919, F2:** `dividedDcmpParentKeys` is passed to `classifyBakeCandidate` as data. A divided DCMP is a type 5 key that extends its parent's key. In 2026, micmp, necmp, oncmp and txcmp are still refused. The 11 undivided DCMPs become candidates. They bake with 8 alliances and a field size equal to the registered roster.
- **e015e48d, F1 (the DCMP part):** a new reason, `dcmp-field-not-final-as-of`, applies only when `--as-of` is given. It refuses a DCMP tier event until every type 1 event of its district has finished, judged by match time, before the instant. The header now says a regular event's roster and schedule length are still season-final in an as-of run.
- **bdb8faa2, Task 3:**
  - F3c: the pre-event snapshot, plus the pre-event mean shift on both arms.
  - `seedCommand`: cwd apps/worker, absolute paths, and an entry-point guard. The new test is scripts/rebaseline.test.ts.
  - Refusal lines naming the teams with no pre-event Sigma Score.

## Census, as-of dry runs

| As of | Before | After |
|---|---|---|
| 2026-03-05 | baked 0 (parent 15, filler 135) | baked 0 (dcmp field 21, parent 4, filler 125) |
| 2026-04-04 | baked 14 (in progress 7, not remaining 108, parent 15, filler 6) | baked 9 (in progress 7, not remaining 108, dcmp field 17, parent 4, filler 5) |

At 2026-04-04:
- chcmp, nccmp, pncmp and sccmp now bake.
- The 9 DCMP division bakes are refused, because their districts still had regular events to play at the instant.

## Verification

- **Pinned-clock byte identity:**
  - publishDistricts with no as-of: 15 of 15 files are identical.
  - publishSeasons for 2025 and 2026: 24,389 bodies and 41 sidecars are identical, and the running digest is 8929a75c6001706f on both sides.
- **Full vitest from the repo root:** 299 of 302 files passed.
  - rpSeed and sigmaSeed fail only because the working copy is CRLF. They pass on LF.
  - measureAllianceWinProbability: the 2026 mean is 0.055538 against the recorded 0.055216. This looks like drift from today's 2026 corpus re-ingest (21,093 truncated matches, against 20,830 earlier). It is not caused by this task, but that was not confirmed at the pre-task commit.
- **Typechecks:** all four are clean.

## Open

- **The field-averaged measurement cannot give a pre-event verdict with its fixed targets.** 5 of its 6 events are refused pre-event, because some teams had no Sigma Score yet: 2022on034, 2023gaalb, 2024caav, 2026joh and 2026txmca. Only 2025cur prices, and the criterion needs 6 events. The doc keeps its season-final figures, marked as such. A new target sample, fixed before the run, is needed: events whose every team had played earlier that season.
- **The measureAllianceWinProbability record may need re-measuring against the re-ingested corpus.**
