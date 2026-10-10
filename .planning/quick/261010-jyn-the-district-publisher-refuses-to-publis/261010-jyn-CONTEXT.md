# Quick Task 261010-jyn: The district publisher refuses to publish a district while one of its events is live - Context

**Gathered:** 2026-10-10
**Status:** Ready for planning (plan against HEAD 72cc0830; the files this task touches are not touched by quick task 261010-d7r)

<domain>
## Task Boundary

Jacob's rule: "it is mission critical that no team is told they are locked at any stop, and then later they are not locked." Jacob, 2026-10-09: "fix the gaps. do not leave anything undone."

Quick tasks 261009-vp9, 261010-66y and 261010-d7r made the live Locks views sound against everything the WORKER writes. Their last stated limit is an OPERATOR action: an offline district publish run while a district or championship event of that district is live (or within the day after it ends).

What such a publish does today (`scripts/publishDistricts.ts`):
- It sets each event's `awardsPosted` by the awards rule at its HINDSIGHT vantage (`awardsPostedRule(..., "hindsight")`, line ~925: a judged award listed OR award points present). The live rule the Worker uses needs a judged award listed AND award points AND playoff points AND every expected consuming award AND a settled list. So a corpus ingested during an event can raise a flag the live rule would still hold false. 261010-d7r measured that forced edge (a division's flag true before its playoff points): 56 Locked teams lost over the 2026 two division championships when the points then land.
- It writes each team's `eventPoints` from the corpus's rankings snapshot, which is minutes or hours older than what the Worker has merged. Quick task 261009-ul3's guard refuses a lost row, a lost flag, a lower played count and a lost award record, but by its decision D1 it does not look at a point value going down or a category's points disappearing. A stale snapshot can therefore lower a floor, or turn a category that read final back to open, until the Worker's next forced look (up to 15 minutes): a lock shown can be withdrawn and shown again.

The Worker owns a district's artifact while one of its events is live. The fix is at the source: the publisher refuses to overwrite it then.

Scope: `scripts/publishDistricts.ts`, the guard module beside it (`scripts/districtPublishGuard.ts`) or a small new one, tests, `docs/worker-operations.md`. No artifact shape change, no Worker change, no browser change. The composed artifacts must be byte identical before and after (the guard only reads and refuses).

</domain>

<decisions>
## Implementation Decisions

### D1. What "live" means for this guard
- A district is LIVE at the real clock when one of its district tier or dcmp tier events is inside its live window or inside the day after it: the same window the live windows manifest gives the Worker, including the 24 hour retention of a closed district window (`DISTRICT_AWARDS_WATCH_MS`, quick task 261009-tx6). Use the manifest builder's own window rule (`packages/harness/manifests.ts`) on the same corpus, so the publisher and the Worker cannot disagree about when an event is live. Do not invent a second date rule. If the builder cannot give a window for an event (no start date), read that event as live when in doubt only if its season is the current year; say what you chose.
- The clock is the REAL clock (injectable for tests), never the publish's `asOf` instant: an as of dump of a past date is an analysis tool and must compose exactly as today.

### D2. What the publisher does
- On a run that uploads: before the first upload, for every district of the run, if the district is live, REFUSE the whole run. Print one line per live district naming the event and its window, then one plain instruction (wait until the day after the event ends, or pass the override), and exit non zero. Nothing is uploaded and no local file is written. It runs beside the 261009-ul3 guard, before any upload.
- `--allow-live` overrides: it prints the same lines plus one line saying it was overridden, and publishes. The 261009-ul3 guard still runs.
- `--dry-run` prints the live districts as a notice and never fails. A run for seasons with no live district prints nothing new.
- Check whether `pnpm rebaseline` or `publish:seasons` reaches the district publish. If one does, say in the plan what a refusal does to that run and make it fail early and clearly (before the long publish starts), not midway.

### D3. Tests
- The live test: a district with an event in its window is live; one whose last event ended more than a day ago is not; one whose event starts tomorrow is not; a dcmp tier division is covered; an offseason event is never a district event.
- The publisher wiring with fake reader and writer and an injected clock: a live district refuses before any write and writes no local file; `--allow-live` writes; a dry run prints and writes nothing; a run with no live district is unchanged.
- The existing publisher and guard tests pass unchanged. The composed artifacts are byte identical before and after (the dump comparison of 261009-ul3).

### D4. Docs
- `docs/worker-operations.md`: one short subsection after the 261009-ul3 one: the Worker owns a district's file while one of its events is live; what the publisher prints; the override and why it is dangerous (a flag raised at the hindsight vantage, stale points). Correct the sentence 261010-d7r left about this limit so it says the publisher now refuses.
- Leave `packages/core` and `apps/web` headers alone (a parallel task owns them): the orchestrator fixes their wording afterwards.

### D5. Decisions after the planner's measurements (orchestrator, 2026-10-10; binding, they REPLACE D2 above and override D1 and D3 where they differ)
- **D2 is replaced: a live district is SKIPPED, the run is not refused.** A whole run refusal would be overridden routinely in season (no free hour for 7 to 12 days at a stretch, because one live district blocks every district of a season). On a run that uploads, nothing of a live district is uploaded (detail, sidecars), no local file is written for it, and the 261009-ul3 guard does not read it. Every other district publishes as today. One line per live event, one per skipped district, a closing line with the count and the instruction. Exit code 0. Both passes (before the bake, before the first upload) feed one skip set.
- **The index.** The Worker never writes the per season districts index, and a composed row can contradict the detail file the Worker owns (team count, slots, event count). So a skipped district's index row is CARRIED from the published index (one read per season that has a skipped district, through the existing reader seam); a missing or unreadable published index refuses the run before any upload (fail closed, `--allow-live` is the way through). A season whose every district is skipped uploads nothing, the index included.
- **`--allow-live`** publishes the live districts too, prints that it was overridden, and the 261009-ul3 guard still runs on them. **`--dry-run`** prints the lines as a notice. **A check that cannot run** refuses a run that uploads, also with `--allow-live`.
- **The evidence skip (the planner's smallest fix, both comparisons).** The clock rule stops skipping about a day before the Worker stops watching (the builder's match window against the calendar window an older manifest gave the Worker). In that day a publish could still raise a flag the live rule holds false, or write an older points snapshot. So at the 261009-ul3 second read, with the published artifact in hand, a district is also skipped when, for an event whose calendar window plus 24 hours is still open at the real clock, this run would write `awardsPosted` true where the published state holds it false, or a lower value than the published one in any points category of a surviving row of that event. Outside that window nothing changes (261009-ul3 D1 stands there).
- **The planner's premises stand:** the guard keys on `districtKey` (no tier test); an event with no match in the corpus is live from 12 hours before its start date (a cancelled event is a right use of `--allow-live`); the live awards rule is worded as the code has it (60 minutes when every expected award is listed, 12 hours when one is not); the three fenced headers that say "that publisher is run after events are over" (`champJointLock.ts`, `champJointMonotone.test.ts`, `eventAwards.ts`) are corrected by the orchestrator after this task.
- `pnpm rebaseline` and `publish:seasons` never reach the district publish; only `pnpm publish:districts` and `pnpm verify:district-bake` do.

### Claude's Discretion
- Names and placement; the exact wording of the printed lines (plain, one fact per line).
- If a step is ambiguous, refuse rather than publish, and record the reading.

</decisions>

<specifics>
## Specific Ideas

- The 261009-ul3 guard: `scripts/districtPublishGuard.ts`, `guardLivePublish`, the `readPublished` and `writeObject` seams and the option parsing in `scripts/publishDistricts.ts`.
- The window builder: `buildLiveWindowsManifest` in `packages/harness/manifests.ts`; `scripts/publishLiveWindows.ts` shows how it is called.
- Tests: `npx vitest run <paths>` from the repo root (never `timeout <n> pnpm`); typechecks root, web, e2e, worker chained with `&&` and a sentinel echo; final full `npx vitest run`. The executor has no network and must not run a real publish. Never Read, cat or echo `.env`.

</specifics>

<canonical_refs>
## Canonical References

- `scripts/publishDistricts.ts`, `scripts/publishDistricts.test.ts`, `scripts/districtPublishGuard.ts`, `scripts/districtPublishGuard.test.ts`, `packages/harness/manifests.ts`, `packages/harness/manifestSchemas.ts`, `scripts/rebaseline.ts`, `docs/worker-operations.md`
- `.planning/quick/261009-ul3-district-publisher-refuses-to-overwrite-/261009-ul3-SUMMARY.md`
- `.planning/quick/261010-d7r-the-joint-lock-proof-never-raises-a-boun/261010-d7r-SUMMARY.md` (the forced flag edge and the stated limit)
</canonical_refs>
