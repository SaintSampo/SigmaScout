---
phase: quick-261010-jyn
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/districtLiveGuard.ts
  - scripts/districtLiveGuard.test.ts
  - scripts/publishDistricts.ts
  - scripts/publishDistricts.test.ts
  - docs/worker-operations.md
autonomous: true
requirements: [261010-jyn]

estimate:
  tokens: 85000
  raw_tokens: 170000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "D1: a district of the run is live at the clock when the live windows builder, asked at that clock on the same corpus, still gives one of its events a window and that window has opened. That is the event's own window plus the 24 hours after it (`DISTRICT_AWARDS_WATCH_MS`), for district events, District Championships and their divisions alike. The new code holds no date rule of its own."
    - "D1: the clock is `Date.now()`, read once per pass through the `now` seam on `CliOptions`. The publish's `asOf` instant never decides it and no command line flag sets it."
    - "D1: an event the builder can give no window at all (no match and no usable start date) makes its district live only when its season is the UTC year of the clock."
    - "D2 as revised: on a run that uploads, a live district is skipped. Its detail artifact and its sidecars are not uploaded, no local file is written for them, and the 261009-ul3 guard neither reads nor compares it. Every other district publishes as today and `run` resolves, so `main` exits 0."
    - "D2 as revised: the clock check runs twice on a run that uploads, after the artifacts are composed and before the first R2 read, and again after the bake. A district found live at the second pass is skipped before any of its uploads, and a district skipped at any point stays skipped for the run."
    - "D2 as revised: the run prints one line per live event (district, event, window, watched until), one line per skipped district, and a closing line with the two counts and the instruction to run again or pass `--allow-live`."
    - "D2 as revised, the index: a skipped district's row in `v1/districts/{year}.json` is carried from the published index, read once through the reader seam for a season that has both a skipped and a published district. A published index that is missing, unreadable or not a districts index refuses the run before any upload. A season whose districts are all skipped uploads nothing, the index included."
    - "D2 as revised: `--allow-live` publishes the live districts too, with the same lines and one override line, and the 261009-ul3 guard still reads and compares them."
    - "D2 as revised: a `--dry-run` prints the same event lines and one notice line, skips nothing, reads nothing from R2 for this check and never fails. A run with no live district prints no new line."
    - "D2 as revised: a clock check that cannot run refuses a run that uploads, with or without `--allow-live`, and is one printed line in a dry run."
    - "The evidence skip (orchestrator addition): at the 261009-ul3 second read, with the published artifact already in hand and nothing new read, a district is also skipped when, for an event whose calendar window plus 24 hours is still open at the clock, this run would write `awardsPosted` true where the published file does not hold it true, or a lower value than the published one in `qual`, `alliance`, `elim`, `award` or `total` of an `eventPoints` row both files hold."
    - "The evidence skip: outside that window nothing changes. An older event's flag is still raised at the hindsight vantage, a lower point value there is still not a regression, and what the 261009-ul3 guard refuses is the same as before."
    - "The evidence skip prints its own lines with a distinct reason, counts in the closing line, is overridden by `--allow-live`, prints as a notice under `--dry-run --check-live`, and does not run in a plain dry run, which reads nothing."
    - "Order on a run that uploads: the 261009-ul3 second read, then the evidence check on the bodies that read returned, then the index carry for every skipped district, then the upload loop. A district skipped by evidence has uploaded nothing and its index row is carried like any other skipped district's."
    - "D2: only `pnpm publish:districts` and `pnpm verify:district-bake` reach the district publish, so `scripts/rebaseline.ts` and `packages/harness/publish.ts` are not edited."
    - "D3: the live rule is tested through the real builder on a temp corpus with an injected clock, the index carry and the evidence comparison are tested with hand built artifacts, and the wiring is tested on the real `run` with a fake reader, a fake writer and an injected clock. The tests that existed before this task pass with no edit to their bodies."
    - "D3: for a run with no live district and no evidence the composed artifacts are unchanged: before and after local dumps are identical once `generation` and `computedAt` are dropped, for the 119 file no bake dump of every published season and for the 42 file two season dump with the bake on."
    - "D4: `docs/worker-operations.md` has one subsection after the 261009-ul3 one that says who owns the file while an event is live, what the clock rule covers, what the evidence rule covers, how the index row is kept, what `--allow-live` does and why it is dangerous, and what is still not covered."
    - "Scope fence: `packages/harness/manifests.ts`, `packages/harness/manifestSchemas.ts`, `packages/harness/pageArtifacts.ts`, `scripts/districtPublishGuard.ts`, `scripts/rebaseline.ts`, `apps/worker`, `apps/web`, `packages/core`, `scripts/champ*.test.ts` and `scripts/measureChampJointLocks*` are untouched, and no todo file is touched."
    - "Gates: the targeted vitest files, the four typechecks with their sentinel, both dump comparisons and the full root `npx vitest run` are green, each read from its printed output."
  artifacts:
    - path: "scripts/districtLiveGuard.ts"
      provides: "which district events of a run are live at a clock, read off the live windows builder; the clock check; what a season uploads once the skipped districts are known; the index that keeps a skipped district's published row; the calendar watch window; and the evidence comparison and its check"
      contains: "buildLiveWindowsManifest"
    - path: "scripts/districtLiveGuard.test.ts"
      provides: "the live rule on a temp corpus with an injected clock, the two checks' mode tables, the season upload plan, the index carry and the evidence comparison, with no network and no real corpus"
      contains: "compareForLiveEvidence"
    - path: "scripts/publishDistricts.ts"
      provides: "the two clock passes, the evidence check after the 261009-ul3 second read, the skip of a skipped district's uploads, the carried index, `--allow-live`, and the `now` seam"
      contains: "allow-live"
    - path: "scripts/publishDistricts.test.ts"
      provides: "the wiring on the real `run`: one live district skipped and the rest published, the carried index row, a district that turns live between the passes, every district live, the two evidence skips and their window edge, the override, the two notices, the silent run"
      contains: "261010-jyn"
    - path: "docs/worker-operations.md"
      provides: "the operator subsection on the live district skip, the two rules, the kept index row, the override and its danger"
      contains: "--allow-live"
  key_links:
    - from: "scripts/districtLiveGuard.ts liveDistrictEventsAt"
      to: "packages/harness/manifests.ts buildLiveWindowsManifest"
      via: "one call at the clock for the verdict, one call with retention off to tell a pruned window from an event with no window"
      pattern: "buildLiveWindowsManifest\\("
    - from: "scripts/districtLiveGuard.ts calendarWatchEventsAt"
      to: "packages/harness/manifests.ts probeWindowFor"
      via: "the builder's own calendar window function, asked with the builder's own moved clock"
      pattern: "probeWindowFor\\("
    - from: "scripts/publishDistricts.ts run"
      to: "scripts/districtLiveGuard.ts checkLiveDistricts"
      via: "one call after compose on every run, one more after the bake on a run that uploads; the district keys it returns are skipped"
      pattern: "checkLiveDistricts\\("
    - from: "scripts/publishDistricts.ts run"
      to: "scripts/districtLiveGuard.ts checkLiveEvidence"
      via: "one call right after the 261009-ul3 second read on a run that uploads, on the bodies that read returned; one call after the report read in a dry run with --check-live"
      pattern: "checkLiveEvidence\\("
    - from: "scripts/publishDistricts.ts run"
      to: "scripts/districtLiveGuard.ts carryPublishedIndex"
      via: "one call per season that has both a skipped and a published district, after the evidence check and before the first upload"
      pattern: "carryPublishedIndex\\("
    - from: "scripts/districtLiveGuard.ts"
      to: "scripts/districtPublishGuard.ts DistrictPublishRefusedError"
      via: "the one refusal type of the publisher, thrown for a clock check that could not run and for a published index that cannot be carried"
      pattern: "DistrictPublishRefusedError"
---

<objective>
Close the last stated limit of quick tasks 261009-vp9, 261010-66y and 261010-d7r, per CONTEXT D1, D3 and D4, D2 as the orchestrator revised it, and the evidence skip the orchestrator added: the offline district publisher does not overwrite a district's file while the Worker owns it. It skips that district and publishes the others.

Two rules decide it. The clock rule skips a district while one of its events is in its window or in the 24 hours after it. The evidence rule covers the rest of the Worker's watch: when an event is still inside its calendar window plus 24 hours and this run would raise its awards flag over the published file or write a lower point value than the published file holds, the district is skipped too.

Purpose: Jacob's rule is that no team is told it is locked at any stop and later told it is not. A publish during the Worker's watch raises the awards flag at the hindsight vantage and writes an older points snapshot, and either can withdraw a lock the page already showed. Refusing the whole run would be overridden as a matter of routine in season, so the guard leaves that district alone and lets the rest through.

Output: the small module `scripts/districtLiveGuard.ts`, the skips wired into `scripts/publishDistricts.ts` with `--allow-live` and a `now` test seam, their tests, one doc subsection, and the SUMMARY with the comparison lines and the control script output. No artifact shape change, no Worker change, no browser change.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/261010-jyn-the-district-publisher-refuses-to-publis/261010-jyn-CONTEXT.md
@.planning/quick/261009-ul3-district-publisher-refuses-to-overwrite-/261009-ul3-SUMMARY.md
@.claude/CLAUDE.md

Scratchpad (session shared, never committed), called SCRATCH below:
`C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad`

## D2 as revised by the orchestrator (2026-10-10)

The orchestrator is writing this into the CONTEXT file. If the CONTEXT still says anywhere that the run is refused for a live district, this block is right.

- On a run that uploads, a district that is live is SKIPPED. Nothing of it is uploaded (its detail artifact, its sidecars), no local file is written for it, and the 261009-ul3 guard neither reads nor compares it. Every other district of the run publishes as today. The run prints one line per live event, one line per skipped district, and a closing line with the count and the instruction (run again later, or pass `--allow-live`). Exit code 0.
- Both passes stay: before the bake, and again before the first upload, because a window can open during the bake. A district found live at the second pass is skipped then, before any of its uploads.
- The index. A skipped district's row in `v1/districts/{year}.json` is carried from the currently published index, read through the existing reader seam, one more read per season that has a skipped district. A missing or unreadable published index refuses the run (fail closed). Premise P8 says why the composed row cannot be published instead.
- `--allow-live` publishes the live districts too: the same lines plus one line saying it was overridden. The 261009-ul3 guard still runs on them.
- `--dry-run` prints the same lines as a notice and never fails.
- A check that cannot run refuses a run that uploads, also with `--allow-live`.
- When every district of the run is live, nothing is uploaded.

## The evidence skip, as added by the orchestrator (2026-10-10)

At the 261009-ul3 second read, where the published artifact is already in hand, a district is ALSO skipped (same lines, same closing count, same `--allow-live` override, a distinct reason in its line) when, for an event whose calendar window plus 24 hours is still open at the real clock:

- (i) this run would write `awardsPosted` true where the published state holds it false (the Worker's live rule has not confirmed it yet), or
- (ii) this run would write a LOWER value than the published one in any points category of a surviving `eventPoints` row of that event (a snapshot older than what the Worker has merged).

Outside that window nothing changes: an older event's flag is still raised at the hindsight vantage and a lower point value is still not a regression (261009-ul3 D1 stands there). It must read nothing new, and it must not change what the 261009-ul3 guard refuses. A district skipped by evidence has uploaded nothing, and its index row is carried like any skipped district's. Under `--dry-run --check-live` it prints as a notice. Under a plain dry run it cannot run (no read) and prints nothing.

## How this task is run

- Worktrees are OFF. The executor edits the main checkout on `main`. Other sessions share this checkout.
- Stage by explicit path, one file at a time. Never `git add -A`, never `git add .`. Run `git status --short` before each commit and after it.
- Never commit anything under `.planning/`. Never push. No network. Never a publish without `--dry-run`. Never `--check-live` from the command line (it reads R2). The tests reach that mode through `run` with a fake reader.
- Never Read, cat, head, tail or echo `.env`. Nothing in this plan needs it: every command below runs with no `.env`.
- Tests run as `npx vitest run <paths>` from the repo root, and the result is read from the printed totals, never from the exit code. Never `timeout <n> pnpm`.
- Long file content is written with the Write and Edit tools. Git Bash heredocs fail on this machine for long content.
- Quick task 261010-d7r is complete. Its files are `packages/core/districts/champJointLock.ts`, `apps/web/src/components/districts/*`, `packages/core/districts/finalsBracket.ts`, `scripts/champ*.test.ts` and `scripts/measureChampJointLocks.test.ts`. This plan must not touch them.
- A further quick task (261010-l0s) was opened while this plan was being revised. Its CONTEXT scopes it to `packages/core/districts/champJointLock.ts`, its tests, and the monotone and walk tests under `scripts/`. None of those is one of this plan's five files, and this plan must not touch them either. STOP rule 3 is the guard if that changes.
- No todo file is touched and no todo item is added.

## Planner measurements, all at commit `72cc0830`, 2026-10-10, offline

- HEAD moved to `e868a1a2` while this plan was being revised. That commit touches only `.planning/`: no file under `scripts`, `packages`, `apps` or `docs` differs between the two, so every line number and every planner dump below still holds.

- `npx tsx scripts/publishDistricts.ts --years "2016-2020,2022-2026" --dry-run --no-bake --local-out DIR` runs with no `.env` in 6 seconds and writes 119 files (109 district details, 10 indexes). Planner dump: `SCRATCH/jyn-planner-before`. It is identical to `SCRATCH/ul3-after2` (differing 0), so the no bake composition has not moved since 261009-ul3.
- `npx tsx scripts/publishDistricts.ts --years 2025-2026 --as-of 2026-04-04 --dry-run --local-out DIR` runs with no `.env` in 167 seconds (the replay is 162 seconds) and writes 42 files (26 details, 14 sidecars, 2 indexes). Planner dump: `SCRATCH/jyn-planner-bake-before`. It differs from `SCRATCH/ul3-bake-after` in 4 district details of 2026 (fim, fit, ne, ont), which later tasks changed, so the old 261009-ul3 bake dump is NOT a baseline for this task.
- `SCRATCH/ul3-compare-all.mjs BEFORE_DIR AFTER_DIR` reads every `.json` file of both directories, drops the top level `generation` and `computedAt`, prints one counts line, then `UL3 COMPARE CLEAN` or `UL3 COMPARE FAILED`. Exit 0 only when clean.
- `SCRATCH/r9x-compare.mjs BEFORE_DIR AFTER_DIR` does the same for district details only and also counts `awardsPosted` flips. It prints `R9X COMPARE CLEAN` or `R9X COMPARE FAILED`.
- `npx vitest run scripts/publishDistricts.test.ts scripts/districtPublishGuard.test.ts` passes 130 tests in 2 files, none skipped. `packages/harness/manifests.test.ts` passes 51.
- `buildLiveWindowsManifest` over the ten published seasons on the real corpus takes 0.45 seconds per call, and 43 ms for one season. It accepts a read only corpus handle.
- At the real clock (2026-10-10T19:04Z) the builder gives no window that carries a `districtKey`, and no district event is inside its calendar window plus 24 hours. Both rules are silent today.
- At `2026-03-21T18:00:00.000Z` the clock rule reads 28 district events live in 13 districts. At `2026-07-08T12:07:31.000Z` (the last match of `2026iscmp`, the last district event of 2026) it reads one: `2026isr`, `2026iscmp`, and the other 13 districts of 2026 are quiet. One hour plus 24 hours later, at `2026-07-09T13:07:31.000Z`, it reads none, and one millisecond before that it still reads that one.
- The evidence window of `2026iscmp` (start date 2026-07-06): its calendar window is 2026-07-05T12:00Z to 2026-07-10T00:00Z, so the window plus 24 hours ends at `2026-07-11T00:00:00.000Z`. From `2026-07-09T13:07:31.000Z` to one millisecond before that end, `2026iscmp` is the only district event in an evidence window, and no district is live by the clock. At the end instant there is none.
- At `2026-03-24T12:00:00.000Z` (a Tuesday in season) the clock rule lists no district and 18 events of 10 districts are inside an evidence window.
- In this run's 2026 artifact of `2026isr`, 38 teams hold an `eventPoints` row at `2026iscmp`, every one with a state whose `awardsPosted` is true.
- At `2016-03-19T14:06:34.000Z` every one of the 8 districts of 2016 is live by the clock. It is the only published season with such an instant (2026 peaks at 13 of 14, 2025 at 11 of 12).
- The corpus holds 1,127 district events (event types 1, 2 and 5 only). None has an empty start date, the builder gives every one a window, and two of them (`2026isde3`, `2026isde4`) have no match.
- Under the clock rule every district keeps a free gap between events every week of 2025 and 2026: 44 to 88 percent of its season is free, the shortest gap is 63 hours or more (one 16 hour gap, `2025ont`), and the longest skipped stretch is 2.3 to 4.4 days (7.5 for `2026isr`, from the two unplayed events of premise P4). `SCRATCH/jyn-gaps-per-district.mts`. The evidence rule skips nothing in those gaps unless this run and the published file disagree in one of its two ways.
- `SCRATCH/jyn-live-at.mts` (planner written, runs only after Task 1 lands): `npx tsx SCRATCH/jyn-live-at.mts <ISO clock | now> [--notice] [--enforce] [--enforce-allow-live] [--calendar]`. Offline and read only. It prints the count line and one line per live event, with a mode flag what the clock check prints and returns in that mode, and with `--calendar` (after Task 3) the events inside an evidence window. It calls only the check functions: nothing is composed, nothing is read from R2 and nothing is uploaded.

## What the code looks like today (line numbers at the base commit)

- `packages/harness/manifests.ts` `buildLiveWindowsManifest` (192): one grouped query over the events of the given seasons, joined to their matches and to the `districts` row of their year. An event with a match gets `[first match time minus padMs, last match time plus padMs)`, `inferred: false`. An event with no match gets `probeWindowFor(start_date, retentionNowMs)`, which is `[start date 00:00 UTC minus 12 hours, plus 4 days)`, `inferred: true`, or no entry when the start date does not parse. A window is dropped when `endMs <= nowMs`, and for an event with a joined `districtKey` when `endMs + DISTRICT_AWARDS_WATCH_MS <= nowMs` (the builder asks with `retentionNowMs = nowMs - DISTRICT_AWARDS_WATCH_MS`, lines 238 and 251). A window that has not opened yet is kept. It needs `generation` (any non empty string), `computedAt` and, optionally, an explicit `nowMs`. All three only stamp or prune the returned object. `probeWindowFor` (90) is exported.
- `apps/worker/src/districtRefresh.ts` (521) watches a district member while `window.startMs <= nowMs && nowMs < window.endMs + DISTRICT_AWARDS_WATCH_MS`. Read only: the Worker is not edited.
- `scripts/publishDistricts.ts` `run` (1812 to 1968): compose every season (1836), the 261009-ul3 first pass (1862, reads R2), the bake loop (1864 to 1871), the 261009-ul3 second pass (1877, reads R2), then the upload loop (1879), which per season uploads every detail, then every sidecar, then the index. `gateAndRecord` (1792) writes the local file and `writeObject` uploads. `ComposedDistrict` (610) holds `district` (with `districtKey` and `year`) and `events` (every event of the district, any event type, each with its `startDate`). A sidecar entry is `{ key, artifact }` and `artifact.districtKey` names its district.
- `scripts/districtPublishGuard.ts` `guardLivePublish` (270) reads each district's published body through the reader it is handed, compares, prints, and returns counts and regressions. It does not hand the bodies back, and its event fold is not exported. This plan does not edit that file.
- The index row (`DistrictsIndexRowSchema`, `packages/harness/pageArtifacts.ts` near 1966) holds `districtKey`, `abbreviation`, `displayName`, `dcmpSlots`, `cmpSlots`, `teamCount` and `eventCount`. `composeYear` fills it from the corpus (line 702).
- An `eventPoints` row (`packages/harness/pageArtifacts.ts` near 2040) holds `eventKey`, `tier`, the five numbers `qual`, `alliance`, `elim`, `award` and `total`, and an optional `state` with `awardsPosted`. A `remainingEvents` row holds an optional `state` too.
- `main` (1971) catches a rejection from `run`, prints `publishDistricts failed:` with the message and exits 1.

## The contracts this plan creates

```ts
// scripts/districtLiveGuard.ts (new). It imports the Corpus type, buildLiveWindowsManifest, probeWindowFor
// and DISTRICT_AWARDS_WATCH_MS from ../packages/harness/manifests.js, DistrictArtifactSchema,
// DistrictsIndexArtifactSchema and their types from ../packages/harness/pageArtifacts.js, and
// DistrictPublishRefusedError and the PublishedReader type from ./districtPublishGuard.js. Nothing else.
// It never reads the wall clock or the environment.

/** Every line this module logs, and every message it throws, contains this text. */
export const LIVE_DISTRICT_MARKER = "live district";

export interface RunDistrictEvent {
  readonly eventKey: string;
  readonly startDate: string | null;        // TBA's YYYY-MM-DD, as the corpus holds it
}

/** One district of the run, with every event the publisher lists for it. */
export interface RunDistrict {
  readonly districtKey: string;             // TBA's year prefixed key, "2026pnw"
  readonly season: number;
  readonly events: readonly RunDistrictEvent[];
}

// ---- the clock rule (Tasks 1 and 2) ----

export interface LiveDistrictEvent {
  readonly districtKey: string;
  readonly eventKey: string;
  readonly basis: "matches" | "calendar" | "no-window";   // "no-window" arrives in Task 2
  readonly startMs: number | null;          // the builder's own bounds, null for "no-window"
  readonly endMs: number | null;
  readonly watchedUntilMs: number | null;   // endMs + DISTRICT_AWARDS_WATCH_MS, for printing
}

/** Sorted by district key, then event key. Reads the corpus and writes nothing. */
export function liveDistrictEventsAt(
  db: Corpus,
  args: { readonly districts: readonly RunDistrict[]; readonly nowMs: number }
): LiveDistrictEvent[];

export interface LiveDistrictsCheck {
  readonly live: readonly LiveDistrictEvent[];        // live events of districts not in alreadyListed
  readonly liveDistrictKeys: readonly string[];       // their distinct district keys, sorted
  readonly overridden: boolean;                       // true only in enforce mode with allowLive and something live (Task 2)
  readonly unchecked: boolean;                        // true only in notice mode when the check could not run (Task 2)
}

/** Prints what it finds and returns it. It throws only when the check cannot run on a run that uploads. */
export function checkLiveDistricts(args: {
  readonly stage: string;                  // printed: "before the bake" or "before the first upload"
  readonly db: Corpus;
  readonly districts: readonly RunDistrict[];
  readonly nowMs: number;
  readonly log: (line: string) => void;
  readonly alreadyListed?: ReadonlySet<string>;   // district keys an earlier pass printed: neither printed nor returned again
  readonly mode: "enforce" | "notice";     // Task 1 builds enforce, Task 2 adds notice
  readonly allowLive: boolean;             // Task 1 reads it as false, Task 2 builds the override
}): LiveDistrictsCheck;

/** What one season uploads once the skipped districts are known. */
export function seasonUploadPlan(args: {
  readonly districtKeys: readonly string[];        // the season's districts, in composed order
  readonly skipped: ReadonlySet<string>;
}): {
  readonly publish: readonly string[];
  readonly skip: readonly string[];
  readonly index: "composed" | "carried" | "none";   // nothing skipped | some skipped, some not | every district skipped
};

/** The index a season with skipped districts uploads: this run's rows, each skipped district's row taken from the published index. */
export async function carryPublishedIndex(args: {
  readonly bucket: string;
  readonly indexKey: string;                       // "v1/districts/2026.json"
  readonly season: number;
  readonly composed: DistrictsIndexArtifact;       // this run's index
  readonly skipped: ReadonlySet<string>;
  readonly read: PublishedReader;
  readonly log: (line: string) => void;
}): Promise<DistrictsIndexArtifact>;                 // throws DistrictPublishRefusedError when the published index cannot be carried

// ---- the evidence rule (Task 3) ----

export interface CalendarWatchEvent {
  readonly eventKey: string;
  readonly startMs: number;                 // probeWindowFor's own bounds
  readonly endMs: number;
  readonly watchedUntilMs: number;          // endMs + DISTRICT_AWARDS_WATCH_MS
}

/** Per district, the events whose calendar window plus 24 hours is open at the clock. No corpus read: start dates only. */
export function calendarWatchEventsAt(args: {
  readonly districts: readonly RunDistrict[];
  readonly nowMs: number;
  readonly exclude?: ReadonlySet<string>;   // district keys the clock rule already listed
}): Map<string, CalendarWatchEvent[]>;      // only districts with at least one such event; events sorted by key

export const EVIDENCE_POINT_CATEGORIES = ["qual", "alliance", "elim", "award", "total"] as const;

export interface LiveEvidence {
  readonly districtKey: string;
  readonly eventKey: string;
  readonly kind: "awardsPostedRaised" | "pointsLowered";
  readonly teamKey?: string;                // pointsLowered only
  readonly category?: (typeof EVIDENCE_POINT_CATEGORIES)[number];   // pointsLowered only
  readonly published: string;               // the published value, rendered
  readonly next: string;                    // this run's value, rendered
}

/** What this run would write over the published artifact, for the given events only. Pure. */
export function compareForLiveEvidence(
  published: DistrictArtifact,
  next: DistrictArtifact,
  eventKeys: ReadonlySet<string>
): LiveEvidence[];

export interface LiveEvidenceCheck {
  readonly evidence: readonly LiveEvidence[];
  readonly evidenceDistrictKeys: readonly string[];   // distinct, sorted
  readonly overridden: boolean;
}

/** Prints what it finds and returns it. It reads nothing and never throws. */
export function checkLiveEvidence(args: {
  readonly stage: string;
  readonly districts: readonly RunDistrict[];
  readonly nowMs: number;                           // the clock reading of the pass it follows
  readonly alreadyListed: ReadonlySet<string>;      // districts the clock rule listed: not looked at
  readonly details: ReadonlyArray<{ readonly key: string; readonly districtKey: string; readonly artifact: DistrictArtifact }>;   // this run's, as handed to the 261009-ul3 pass
  readonly publishedBodies: ReadonlyMap<string, string | null>;   // what that pass read, by key
  readonly mode: "enforce" | "notice";
  readonly allowLive: boolean;
  readonly log: (line: string) => void;
}): LiveEvidenceCheck;

// scripts/publishDistricts.ts, CliOptions gains two optional fields:
readonly now?: () => number;    // TEST SEAM, Task 1. Production reads Date.now().
readonly allowLive?: boolean;   // true only under --allow-live, Task 2
```

What `checkLiveDistricts` does (Task 1 builds the first row and the last column, Task 2 the rest):

| mode | allowLive | the windows cannot be built (a throw) | live events found | none found |
|---|---|---|---|---|
| enforce | false | throws `DistrictPublishRefusedError` naming the error | prints one line per event and one skip line per district, returns their keys | prints nothing, returns empty lists |
| enforce | true | the same throw | prints one line per event and one override line, returns their keys with `overridden: true` | prints nothing |
| notice | ignored | prints one line naming the error, returns `unchecked: true` | prints one line per event and one notice line, returns their keys | prints nothing |

What `carryPublishedIndex` does with what the reader answers for the index key:

| the reader | result |
|---|---|
| throws | throws `DistrictPublishRefusedError` naming the key and the error message |
| answers null (no object) | throws `DistrictPublishRefusedError` naming the key |
| answers a body that is not JSON, or fails `DistrictsIndexArtifactSchema` | throws `DistrictPublishRefusedError` naming the key |
| answers a districts index | this run's index, in this run's row order, with each skipped district's row replaced by the published row of the same key. A skipped district with no published row is left out, with one line. Rows of districts that are not skipped are this run's, even where the published row differs. The stamps and the year are this run's. The result goes through `DistrictsIndexArtifactSchema.parse`. |

What `compareForLiveEvidence` reports, for each event key it is given, events in ascending key order (Task 3):

| kind | reported when | not reported when |
|---|---|---|
| `awardsPostedRaised`, once per event, first | this run's fold of `awardsPosted` for the event is true and the published fold is not true: false, no state on any row, or no row for the event at all | the published fold is true; this run's fold is false or absent |
| `pointsLowered`, once per team and category, in this run's team order and the order of `EVIDENCE_POINT_CATEGORIES` | both artifacts hold an `eventPoints` row for that team at the event and this run's number is lower than the published one | the numbers are equal or this run's is higher; only one side holds the row |

The fold is the one the 261009-ul3 module uses: a flag is true for an event when any `eventPoints` or `remainingEvents` row of the event carries a state with it true, and the first `eventPoints` row a team holds at the event is its row.

What `checkLiveEvidence` does (Task 3). A district is looked at when it is not in `alreadyListed`, `calendarWatchEventsAt` gives it at least one event, and `publishedBodies` holds a body for its key that parses as a district artifact. A body that is null, missing from the map, not JSON or not a district artifact is not compared and nothing is printed for it.

| mode | allowLive | evidence found | none found |
|---|---|---|---|
| enforce | false | prints one line per event and kind and one skip line per district, returns their keys | prints nothing, returns empty lists |
| enforce | true | prints one line per event and kind and one override line, returns their keys with `overridden: true` | prints nothing |
| notice | ignored | prints one line per event and kind and one notice line, returns their keys | prints nothing |

Default wording. The executor may reword a line, but every line keeps the `publishDistricts:` prefix and the marker, and keeps every token a test below names (district key, event key, team key, category name, the instants as `toISOString()` text, the stage, the index key, `awards posted`, `on evidence`, `skipped`, `Nothing was uploaded`, `--allow-live`, `--dry-run`, the two counts, the doc heading):

- A live event with a window: `publishDistricts: live district {districtKey}: event {eventKey} is inside its window or within 24 hours after it. Window {start} to {end}, {from its match times | from its start date, the corpus holds no match for it}. The Worker watches it until {watchedUntil}.`
- A live event with no window: `publishDistricts: live district {districtKey}: event {eventKey} has no match and no usable start date in the corpus, so no window can be built for it. Its season is the current year, so it is read as live.`
- A district skipped by the clock: `publishDistricts: live district {districtKey} is skipped {stage}: this run uploads nothing of it, and its published file stays as the Worker has it.`
- Evidence, the flag: `publishDistricts: live district {districtKey}: event {eventKey} is past its match window and inside its calendar window plus 24 hours, until {watchedUntil}, so the Worker may still be watching it. This run would write awards posted true, and the published file does not hold it true.`
- Evidence, the points, one line per event: `publishDistricts: live district {districtKey}: event {eventKey} is past its match window and inside its calendar window plus 24 hours, until {watchedUntil}, so the Worker may still be watching it. This run would write {n} point value(s) lower than the published file holds. The first: team {teamKey}, {category}, published {a}, this run {b}.`
- A district skipped on evidence: `publishDistricts: live district {districtKey} is skipped {stage} on evidence: this run uploads nothing of it, and its published file stays as the Worker has it.`
- The override, for either rule: `publishDistricts: --allow-live was given, so this run publishes the {n} live district(s) listed above too.`
- The notice of the clock rule: `publishDistricts: --dry-run uploads nothing, so this is a notice. A run that uploads would skip the {n} live district(s) listed above, unless --allow-live is given.`
- The notice of the evidence rule: `publishDistricts: --dry-run uploads nothing, so this is a notice. A run that uploads would skip the {n} live district(s) listed above on evidence, unless --allow-live is given.`
- The kept rows of one season: `publishDistricts: "{indexKey}" keeps the published row of {k} live district(s) this run skips: {keys}.`
- A skipped district with no published row: `publishDistricts: live district {districtKey} has no row in the published "{indexKey}", so the index this run uploads leaves it out.`
- A season with every district skipped: `publishDistricts: every district of season {season} is a live district this run skips, so nothing of that season is uploaded, "{indexKey}" included.`
- The closing line, printed last by `run` when at least one district was skipped by either rule: `publishDistricts: {n} live district(s) skipped, {m} district(s) published. Run this again later, or pass --allow-live to publish them now. See "The offline district publish skips a district while one of its events is live" in docs/worker-operations.md.`
- A clock check that could not run, dry run: `publishDistricts: the live district check could not run {stage}: {message}. A dry run goes on.`
- A clock check that could not run, a run that uploads (thrown): `publishDistricts: refused {stage}. Nothing was uploaded. The live district check could not run: {message}. A run that cannot tell whether a district is live does not publish, and --allow-live does not change that.`
- An index that cannot be carried (thrown): `publishDistricts: refused before the first upload. Nothing was uploaded. This run skips {k} live district(s) of season {season} and has to keep their rows from the published "{indexKey}", and {that object does not exist | it could not be read: {message} | it is not a districts index}. Run this again once no district of that season is skipped, or pass --allow-live, which publishes them too.`

The order inside `run` once all three tasks have landed. The lines marked NEW are added, the two 261009-ul3 passes are handed fewer districts and a reader that also records what it returns, and nothing else moves:

1. Open the corpus, the stamps, the ceilings, the writer binding.
2. The `--no-bake` line.
3. Compose every season.
4. NEW (Task 1). The clock pass, stage `before the bake`. Every run. `enforce` on a run that uploads, `notice` on a dry run. On a run that uploads without the override, the districts it returns join the skip set.
5. The 261009-ul3 first pass (reads R2), over the districts that are not skipped.
6. NEW (Task 3). In a dry run with `--check-live` only: the evidence check as a notice, on the bodies step 5 read, at the clock reading of step 4.
7. The bake, unchanged, over every district.
8. NEW (Task 1). The clock pass, stage `before the first upload`. A run that uploads only. It is handed the districts the first pass listed, so it prints and returns only newly live ones. Without the override they join the skip set.
9. The 261009-ul3 second pass (reads R2), over the districts that are not skipped. It stays the last read of a district detail before the upload loop.
10. NEW (Task 3). On a run that uploads: the evidence check, on the bodies step 9 read, at the clock reading of step 8. Without the override the districts it returns join the skip set.
11. NEW (Task 1). For each season with both a skipped and a published district, `carryPublishedIndex`. A refusal here comes before any upload.
12. The upload loop. A skipped district's detail and sidecars are passed over: no byte gate, no local file, no upload. The index is this run's, the carried one, or none, as `seasonUploadPlan` says.
13. NEW (Task 1). The closing line, when at least one district was skipped.
</context>

<planner_readings>
## Premises the code contradicts

- **P1. The sentence 261010-d7r left about this limit is not in `docs/worker-operations.md`.** D4 says to correct it there. 261010-d7r never edited that doc (its last change is 261010-66y, `9d531d6b`). The sentence ("That publisher is run after events are over") is in `packages/core/districts/champJointLock.ts` at lines 356 to 358 and in the header of `scripts/champJointMonotone.test.ts` at lines 1217 to 1222. Both files are fenced off from this plan. An older header says the same thing as an assumption: `packages/core/districts/eventAwards.ts` lines 44 to 46 ("The corpus is ingested once an event is over"). So this plan adds the subsection and corrects no existing sentence. The orchestrator corrects the three headers after this task lands.
- **P2. "The publisher and the Worker cannot disagree about when an event is live" does not hold for the clock rule alone, which is why the evidence rule exists.** The Worker reads the manifest object published earlier, built from the corpus as it was then. The clock rule rebuilds the windows from the corpus as it is now. The builder gives an event one of two windows: from its match times when the corpus holds a match, from its start date when it holds none. Measured on the 148 district events of 2026 that have matches: the calendar window opens a median 50.4 hours before the match window (least 21.0) and stays open a median 25.1 hours after it closes (most 74.2). So when the manifest in R2 was built before an event's schedule existed and the corpus now holds its matches, the Worker goes on watching that district for about a day after the clock rule stops skipping it. By then the live rule has normally turned the flag true and the points are normally final, but that is TBA's timing and not something the code guarantees. The evidence rule covers that day for the two differences that can take a lock back. Reading R28 lists what is still not covered.
- **P3. No code filters on tier, so "district tier or dcmp tier events" is a fact about the data and not a rule.** Neither the builder nor the publisher's `selectDistrictEvents` reads `event_type`. An event belongs to a district exactly when `events.district_key` joins a `districts` row of its year. In the corpus that set is event types 1 (953), 2 (110) and 5 (64) and nothing else: no offseason or preseason event carries a district key, and no abbreviation lacks its row. The clock rule therefore keys on the manifest's `districtKey` and adds no event type test, because a second membership rule could disagree with the Worker. D3's "an offseason event is never a district event" is tested as what the data is: an offseason event has a null district key, has an open window, and makes no district live.
- **P4. "One whose event starts tomorrow is not live" is false for an event with no match in the corpus.** Its window is the calendar one, which opens 12 hours before its start date at 00:00 UTC and is watched for 5 days after that. Two such events are in the corpus (`2026isde3`, `2026isde4`, both unplayed): in March 2026 they alone would have made `2026isr` read live from 03-14T12:00Z to 03-22T00:00Z. The tests pin "starts tomorrow" on a window from match times (not live until one hour before the first match) and pin the calendar case separately. An event that was cancelled or never played is one of the right uses of `--allow-live`, and the doc says so.
- **P5. The "no start date" case of D1 does not exist in the corpus.** None of the 1,127 district events has an empty start date, and the builder gives every one of them a window. The in doubt rule is built and tested on a temp corpus. It is unreachable today.
- **P6. The builder, asked at a clock, answers only half of "live", and it prunes without saying why.** It keeps a district window while `now < endMs + 24 hours`, and it also keeps every window that has not opened yet. So the clock rule adds "has opened". And an event missing from its output is either past the watch or one it can give no window, which is why R4 asks it a second time with retention off.
- **P7. The live awards rule does not need every expected award.** CONTEXT lists "every expected consuming award" as a condition of the Worker's rule. `awardsPostedRule` (`packages/core/districts/eventAwards.ts` line 286) needs a judged award, award points, playoff points and a settled list: settled for 60 minutes when every expected award is listed, and for 12 hours when one is not. The doc subsection states it that way.
- **P8. The index row of a skipped district cannot be published as composed.** The Worker never writes the index: it has two R2 writers, `writeArtifactObject` for the five page kinds (teams, team, events, event, compare) and `writeDistrictArtifactObject` for `v1/district/{key}.json`, and the index key appears in `apps/worker/src` only in a comment. But a composed row can disagree with the file the Worker owns. The Worker's merge sets the detail's `insights.teamCount` to its own team list length, which grows when a newcomer joins (`packages/harness/districtRankingsMerge.ts` line 1129), and it carries the detail's `dcmpSlots`, `cmpSlots` and `insights.eventCount` as last published, while a composed index row takes `teamCount`, `eventCount` and both slot counts from today's corpus (`scripts/publishDistricts.ts` line 702). The page reads only `districtKey` and `abbreviation` off the index today (`apps/web/src/components/districts/DistrictSelect.tsx`), so nothing would show it, but the published data would be inconsistent. Reading R13 therefore carries the published row.
- **P9. The 261009-ul3 guard does not hand back what it read.** The evidence rule must read nothing new and that module is not edited, so `run` wraps the reader it hands to that guard: the wrapper calls the same reader with the same arguments, returns what it returned, and keeps each returned body by key (reading R23).

## Readings this plan fixes (each binding)

The clock rule and the skip:

- **R1. The clock.** `run` reads `(options.now ?? Date.now)()` exactly once per clock pass and nowhere else. `options.asOf` is never the clock. `parseOptions` never sets `now`. The evidence check uses the reading of the clock pass it follows.
- **R2. Membership.** A window belongs to a district of the run when its `districtKey` is a string that names one of the run's districts. No event type test (P3).
- **R3. Live at the clock.** The builder is asked at the clock, so its own retention decides "past the watch". The check adds one comparison, `window.startMs <= nowMs`. Together they equal the Worker's own comparison at `apps/worker/src/districtRefresh.ts` line 521, and a test pins that equality at the six edge instants. `watchedUntilMs` is `endMs + DISTRICT_AWARDS_WATCH_MS` and is used for printing only.
- **R4. No window at all.** The builder is asked a second time with a retention clock of 0, the idiom its own doc names, so that nothing is pruned. An event of a run district that is absent from that list is one the builder can give no window. It makes its district live only when the district's season equals the UTC year of the clock (D1). An event that is absent at the clock but present with retention off is past its watch, and is not live.
- **R5. Two clock passes on a run that uploads, one on a dry run.** The first comes after compose because the run's districts and their events are known there, and before the first R2 read. The second comes after the bake, because an event's window can open during it.
- **R6. Once skipped, skipped for the run.** The skip set is every district either rule returned at any step. A district whose watch ends during the bake stays skipped: the operator runs again.
- **R7. What `--allow-live` covers.** Both rules: nothing is skipped and the index is this run's. A clock check that could not run refuses a run that uploads with or without it. `--allow-live` on a dry run is accepted and does nothing.
- **R8. A dry run skips nothing.** It composes and writes every district as today, so the dumps and the as of analysis are unchanged, and it prints the notice. It reads nothing from R2 for the clock rule.
- **R9. Silence.** When neither rule finds anything, nothing new is logged in any mode and `run` prints no closing line.
- **R10. One line per live event and one per skipped district.** A district with two live events prints two event lines and one skip line.
- **R11. The stamps handed to the builder.** `generation` is a fixed label of the module, `computedAt` is the clock as ISO text. The returned manifest object is read for its `windows` and thrown away. It is never published.
- **R12. The 261009-ul3 passes.** They are called as today, handed only the districts that are not skipped at that moment. When districts were skipped and none is left, they are not called.
- **R13. The index (P8).** A season with nothing skipped uploads this run's index, as today. A season with both skipped and published districts uploads this run's index with each skipped district's row replaced by the published one. The published index is read once for that season, after the evidence check and before the first upload. No object, a read failure, or a body that is not a districts index refuses the whole run (fail closed), and `--allow-live` is the way through, since it skips nothing. A skipped district with no row in the published index is left out of the uploaded index, with one line: the index goes on saying what is published. A season whose districts are all skipped uploads nothing, the index included, and its published index is not read.
- **R14. The carried index carries this run's stamps.** `generation` and `computedAt` are this run's, though a carried row is older. The rows hold no stamp of their own, and the picker reads only the key and the abbreviation.
- **R15. The bake is not narrowed.** It still runs over every district, skipped or not, so no baked artifact of a published district can change. A skipped district's sidecars are baked and then not uploaded.
- **R16. Every district of the run live.** Nothing is uploaded and nothing is read from R2. The run prints the event lines, one skip line per district, one line per season saying nothing of it is uploaded, and the closing line with a published count of 0. `run` resolves.
- **R17. Where the tests live.** The live rule, the two checks' tables, the season plan, the index carry and the evidence comparison are tested with no real corpus, so they run in CI. The wiring is tested on the real `run`, which opens the real corpus, in the corpus guarded style of the 261009-ul3 describe.

The evidence rule:

- **R18. Which window, and why.** The orchestrator asked which is used. Both: the two rules together cover the union of the builder's two windows plus 24 hours. The clock rule is the match window half (and the calendar window of an event with no match). The evidence rule is the calendar half for an event that has matches. At one clock reading a district the clock rule did not list has no event in a match window, so the evidence rule computes only the calendar window. The union is the safe side because the Worker's manifest can hold either window, depending on whether the corpus held the event's matches when that manifest was built.
- **R19. The calendar window is the builder's.** `calendarWatchEventsAt` calls the exported `probeWindowFor` with the event's start date and the clock moved back by `DISTRICT_AWARDS_WATCH_MS`, which is how the builder itself asks for a district event (`packages/harness/manifests.ts` lines 238 and 251), and then keeps the event when `startMs <= nowMs`. It writes no window bound of its own. A test pins it against the builder at the six edge instants for an event with no match. An event whose start date is null or does not parse has no calendar window and is never looked at.
- **R20. Rule (i), the flag.** Reported when this run's fold of `awardsPosted` for the event is true and the published fold is not true. Not true covers three cases: false, no state on any row of the event, and no row for the event at all. Each means the Worker has not confirmed it, so each is the skip side.
- **R21. Rule (ii), the points.** The five numbers of an `eventPoints` row: `qual`, `alliance`, `elim`, `award`, `total`. A row is surviving when both artifacts hold one for that team at that event, and a team's first row at the event is its row, as in the 261009-ul3 module. A higher number, a row only this run holds and a row only the published file holds are not evidence: the last is the 261009-ul3 guard's refusal already.
- **R22. One fold, stated twice.** The event fold of the 261009-ul3 module is not exported and that file is not edited, so the new module carries the same rule in its own small walk: a flag is true when any row has it true. A test pins the two against each other on one pair of artifacts.
- **R23. Nothing new is read (P9).** `run` hands the 261009-ul3 guard a reader that records each body it returns, by key, in a map made fresh for that pass. A throw passes through unrecorded. The evidence check reads only that map.
- **R24. Order.** The 261009-ul3 second read, then the evidence check, then the index carry, then the upload loop. The carry has to come after the evidence check so that a district skipped on evidence keeps its published row. The cost is one index read per season with a skipped district between the second read of the details and the first upload. A carry refusal still comes before any upload.
- **R25. When it runs.** On a run that uploads: once, after the 261009-ul3 second pass, not after the first. In a dry run with `--check-live`: once, after that run's only 261009-ul3 pass, as a notice. In a plain dry run: never, because nothing was read. When every district was skipped by the clock: never, because that pass did not run.
- **R26. What is not compared.** A district the clock rule listed. A district with no event in a calendar window plus 24 hours. A published body that is null (a first publish), missing from the map (it could not be read in report mode), not JSON, or not a district artifact (a shape change). None of these prints anything from this check.
- **R27. It never refuses and never changes a refusal.** `checkLiveEvidence` does not throw. The 261009-ul3 guard runs first, on the same districts, exactly as before, so a lost fact still refuses the whole run before the evidence check is reached.
- **R28. What is still not covered, stated in the doc.** (a) Past an event's calendar window plus 24 hours nobody watches it, and a publish raises its flag at the hindsight vantage as before, so awards or points that land later than that can still take a lock back: the limit the doc already states. (b) A snapshot older than the Worker's in which a value is HIGHER, because TBA lowered it in between, cannot be told from a newer one and is published. (c) A manifest in R2 built from an older corpus can hold a window that neither of today's two windows contains, for an event whose date or schedule moved. (d) The evidence rule compares only a published file that parses, so a first publish and a shape change are not compared. (e) The Worker can write, and an event's window can open, in the time between the second read and a district's own upload, which now includes the index read. (f) A plain dry run shows the clock rule only.

## STOP rules

1. A comparison prints `FAILED`. First run `git log --oneline BASE..HEAD -- scripts packages` and `git status --short`. If another session moved the composing code, STOP and report. If not, this task changed an artifact: fix the code. Never edit a comparer to pass.
2. Anything that needs the network, `.env`, a publish without `--dry-run`, or `--check-live` from the command line: STOP. Those are the orchestrator's.
3. Step 0, or any later `git status --short`, shows one of this plan's five repo files modified or committed by another session: STOP and report.
4. A test that existed before this task needs an edit to its body to pass: STOP (D3). Additions and import lines are the only edits to `scripts/publishDistricts.test.ts`.
5. A change seems needed to `packages/harness/manifests.ts`, `packages/harness/manifestSchemas.ts`, `packages/harness/pageArtifacts.ts`, `scripts/districtPublishGuard.ts`, `scripts/rebaseline.ts`, `apps/worker`, `apps/web`, `packages/core`, `scripts/champ*.test.ts` or `scripts/measureChampJointLocks*`: STOP.
6. The full root `npx vitest run` shows a failure in a file this task did not touch: run that file alone once, run `git status --short` and `git log --oneline -5`, then report it. Do not fix another session's file.
</planner_readings>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: End to end, one path only. A run that uploads skips a district with a live event, publishes the others and keeps the skipped district's published index row (D1, D2 as revised, D3)</name>
  <files>scripts/districtLiveGuard.ts, scripts/districtLiveGuard.test.ts, scripts/publishDistricts.ts, scripts/publishDistricts.test.ts</files>
  <read_first>
    - `.planning/quick/261010-jyn-the-district-publisher-refuses-to-publis/261010-jyn-CONTEXT.md`, then the two orchestrator blocks in this plan's context
    - `packages/harness/manifests.ts` lines 60 to 292 (`probeWindowFor`, the options, the two rules in the header, the builder)
    - `packages/harness/manifestSchemas.ts` lines 34 to 56 and 158 to 165 (the pad, the watch constant and its contract, `isLiveAt`)
    - `apps/worker/src/districtRefresh.ts` lines 505 to 525 (read only: the watch comparison R3 names)
    - `packages/harness/manifests.test.ts` lines 36 to 92 and 400 to 492 (the temp corpus, the `event` and `match` helpers, the retention cases to mirror)
    - `packages/harness/pageArtifacts.ts` lines 1925 to 1985 (the two district keys, the index row and index schemas)
    - `scripts/districtPublishGuard.ts` lines 1 to 90 (the header's voice, `PublishedReader`, `DistrictPublishRefusedError`)
    - `scripts/publishDistricts.ts` lines 76 to 91 (the 261009-ul3 header paragraph), 263 to 270 (`DistrictEventMeta`), 575 to 625 (the index builder, `ComposedDistrict`, `PublishedYear`), 1363 to 1370 (`BakeSeasonResult`), 1633 to 1767 (`CliOptions`, `parseOptions`), 1792 to 1983 (`gateAndRecord`, `run`, `main`)
    - `scripts/publishDistricts.test.ts` lines 1 to 64 (imports and constants) and 1965 to 2110 (the 261009-ul3 describe: the corpus guard, `seams`, `runCaptured`, the `fetch` spy)
  </read_first>
  <behavior>
    `scripts/districtLiveGuard.test.ts` (new, no real corpus, no network). The live rule tests build a temp corpus the way `packages/harness/manifests.test.ts` does. One district row `2026pnw` (abbreviation `pnw`, year 2026). T1 and T2 are two match times in March 2026, T1 before T2. PAD is `LIVE_WINDOW_PAD_MS` and WATCH is `DISTRICT_AWARDS_WATCH_MS`, both imported from `../packages/harness/manifests.js`. `liveDistrictEventsAt` is called with the run districts spelled out (each event with its key and start date) and an injected `nowMs`.
    - In its window: a district event with matches at T1 and T2. At `nowMs` T1 the result is exactly one entry: district `2026pnw`, that event, basis `matches`, `startMs` T1 minus PAD, `endMs` T2 plus PAD, `watchedUntilMs` T2 plus PAD plus WATCH.
    - The edges of the same event: not live at `startMs` minus 1, live at `startMs`, live at `endMs`, live at `watchedUntilMs` minus 1, not live at `watchedUntilMs`, not live a day after that. Not live 24 hours before `startMs` (the event that starts tomorrow, on a window from match times).
    - A calendar window: a district event with no match and start date `2026-03-05`. Its bounds are the ones `probeWindowFor` gives. Not live at `startMs` minus 1, live at `startMs` with basis `calendar`, live at `endMs` plus WATCH minus 1, not live at `endMs` plus WATCH. The test name says that an event whose start date is tomorrow reads live from 12:00 UTC today.
    - A District Championship (event type 2) and a District Championship division (event type 5), each carrying the abbreviation, each make `2026pnw` live inside their window.
    - Not district events: an offseason event (event type 99, `isOffseason` true, district key null) inside its window gives an empty result. So does a regional (district key null). So does an event whose abbreviation has no `districts` row for its year, even when the run districts name `2026pnw`.
    - Scope: with a second district `2026fim` in the corpus and a live event in each, a call that lists only `2026pnw` reports only the `2026pnw` event. A call with an empty district list reports nothing.
    - Order: two live events in `2026pnw` and one in `2026fim` come back sorted by district key, then by event key.
    - Parity with the Worker (R3): for one event with matches and one calendar event, at each of `startMs` minus 1, `startMs`, `endMs` minus 1, `endMs`, `endMs` plus WATCH minus 1 and `endMs` plus WATCH, the event is reported exactly when `startMs <= nowMs && nowMs < endMs + WATCH`. The test spells that comparison out and its comment cites `apps/worker/src/districtRefresh.ts`.
    - A clock that is not finite throws an `Error` that says so.
    - `checkLiveDistricts`, `enforce`, one live event: `log` receives exactly two lines. The first contains `LIVE_DISTRICT_MARKER`, `2026pnw`, the event key and the three instants as `toISOString()` text. The second contains the marker, `2026pnw`, the stage and the word `skipped`. Both start with `publishDistricts:`. It does not throw. It returns that event in `live`, `["2026pnw"]` in `liveDistrictKeys`, and `overridden` and `unchecked` both false.
    - `checkLiveDistricts`, two live events in `2026pnw` and one in `2026fim`: three event lines and two skip lines, and `liveDistrictKeys` is `["2026fim", "2026pnw"]`.
    - `checkLiveDistricts` with `alreadyListed` holding `2026pnw`: only the `2026fim` event and district are printed and returned. With both keys in `alreadyListed`, nothing is printed and the lists are empty.
    - `checkLiveDistricts`, nothing live: `log` is never called and the lists are empty.
    - `seasonUploadPlan`: nothing skipped gives every key to publish and index `composed`, and so does a season with no district. One of three skipped gives the other two to publish, in the given order, the one to skip, and index `carried`. A skipped key that is not one of the season's districts changes nothing. Every district skipped gives nothing to publish and index `none`.
    - `carryPublishedIndex`, with hand built index artifacts passed through `DistrictsIndexArtifactSchema.parse` and a fake reader. This run's index has rows A, B and C, and the published one has the same keys with a different `teamCount` on every row and a different `cmpSlots` on B. With B skipped, the result keeps this run's A and C, takes the published B whole, keeps this run's row order, stamps and year, and one logged line contains the marker, the index key and B's key. The reader was called exactly once, with the bucket and the index key.
    - `carryPublishedIndex`, a skipped district with no published row: the result has no row for it, and one logged line contains the marker, its key and the index key.
    - `carryPublishedIndex` fails closed: the reader answers null; the reader throws an `Error` with a recognisable message; the reader answers `not json`; the reader answers `{}`. Each rejects with `DistrictPublishRefusedError`, and each message contains `Nothing was uploaded`, the index key, the marker and `--allow-live`. The message of the read failure also contains the recognisable message.

    `scripts/publishDistricts.test.ts`, a new corpus guarded describe named with 261010-jyn, appended after the last existing describe. It has its own helpers, copied in shape from the 261009-ul3 describe and not shared with it: a `seams` pair that pushes `read KEY` and `write KEY` to one list and keeps every written body by key, a `runCaptured` that captures `console.log` and the thrown error, and the `fetch` spy that throws and is asserted never called. Fixture, computed once from the real corpus: the 2026 district event with the latest match time and its year prefixed district key through the `districts` join (the planner measured `2026iscmp` and `2026isr`), and that time, called LAST. LIVE is LAST. ENDS is LAST plus PAD plus WATCH. N is the number of `districts` rows of 2026. LIVEKEY is `v1/district/` plus the fixture's district key plus `.json`, and INDEXKEY is `v1/districts/2026.json`. The published index fixture is the index `composeYear` gives for 2026 with the fixture district's `teamCount` raised by 7, passed through `DistrictsIndexArtifactSchema.parse`. Unless a test says otherwise it calls `run` with `years: [2026]`, `asOf: COMPUTED_AT`, `bake: false`, a bucket name that is not the real one, both seams, and a reader that answers the published index fixture for INDEXKEY and null for every other key.
    - One live district is skipped and the others publish: `now` answers LIVE. `run` resolves with no error. The writer got exactly N keys: N minus 1 details and INDEXKEY, and never LIVEKEY. The reader was called 2N minus 1 times (N minus 1 details in each 261009-ul3 pass, then INDEXKEY last), and never for LIVEKEY. Every read comes before the first write. In the uploaded index the fixture district's row equals the published row (the raised `teamCount`) and every other row equals this run's. With `localOut` set to a fresh temp directory it holds N files and none is the fixture district's detail. The printed lines hold one with the marker, the district key and the event key, one with the marker, the district key and `skipped`, and a last marker line with `--allow-live`, the count 1 and the count N minus 1.
    - One millisecond before the watch ends: `now` answers ENDS minus 1. The writer never got LIVEKEY and got N keys.
    - At the instant the watch ends: `now` answers ENDS. `run` resolves, the writer got N plus 1 keys, LIVEKEY among them, the reader was called 2N times and never for INDEXKEY, the uploaded index equals this run's, and no printed line contains the marker.
    - A district that turns live between the passes: `now` answers ENDS on its first call and LIVE afterwards. `run` resolves. The writer got N keys and never LIVEKEY. The reader was called 2N times: N details in the first 261009-ul3 pass, LIVEKEY among them, then N minus 1 details, then INDEXKEY last. A printed line contains the marker, the district key and `before the first upload`.
    - The published index is missing: `now` answers LIVE and the reader answers null for every key. `run` rejects with `DistrictPublishRefusedError`. The message contains INDEXKEY and `--allow-live`. The writer was never called and the `localOut` directory is empty.
    - Every district of a season live: `years: [2016]` and `now` answers `2016-03-19T14:06:34.000Z`. `run` resolves. The writer and the reader were never called and the `localOut` directory is empty. The skip lines name every district key of 2016 (read from the corpus in the test, so a corpus in which one of them is no longer live at that instant fails here by name). A printed line contains the marker and `v1/districts/2016.json`. The last marker line holds the count 8 and a published count of 0.
    - One season wholly skipped beside one published in full: `years: [2016, 2026]` and `now` answers `2016-03-19T14:06:34.000Z`. The writer got exactly the N plus 1 keys of 2026 and no key of 2016, and the reader was never called for `v1/districts/2016.json`.
    - The clock is read once per pass: on a run that resolves, the `now` seam was called exactly 2 times.
    - The as of instant is not the clock: `asOf` is LIVE as ISO text and `now` answers ENDS. `run` resolves with N plus 1 writes and no line containing the marker.
    - A dry run is not affected: `dryRun: true` and `now` answers LIVE. `run` resolves, the reader and the writer were never called, and the `localOut` directory holds N plus 1 files, the fixture district's detail among them.
  </behavior>
  <action>
    Step 0, before any edit. Record the base commit with `git rev-parse --short HEAD` (BASE). Run `git status --short` and apply STOP rule 3. Take the two BEFORE dumps with the commands in the verify block, with `jyn-before` and `jyn-bake-before` as the directory names (the bake one takes about three minutes). Compare each with the planner's dump of the same name prefixed `jyn-planner-` using `SCRATCH/ul3-compare-all.mjs`, and keep the two printed lines for the SUMMARY. If either prints `FAILED`, apply STOP rule 1 before going on.

    Write the failing tests of the behavior block first and see them fail.

    Create `scripts/districtLiveGuard.ts` (D1, D2 as revised, readings R2, R3, R10, R11, R13, R14). Give it a header in the voice of `scripts/districtPublishGuard.ts`: what it protects (the Worker owns a district's file while one of its events is live and for 24 hours after it), that a live district is skipped and never a reason to refuse the run, where the window comes from (the live windows builder, the same function the manifest is built with, asked on the same corpus), the one comparison it adds and why (the builder keeps windows that have not opened), that membership is the manifest's `districtKey` and no event type is tested (premise P3), why a skipped district's index row is the published one (premise P8), and that it never reads the wall clock or the environment.

    `liveDistrictEventsAt` returns an empty list for an empty district list, throws a plain `Error` naming the clock when `nowMs` is not finite, derives the seasons from the districts handed in, calls `buildLiveWindowsManifest` once with those seasons, the module's fixed label as `generation`, the clock as ISO text as `computedAt` and the clock as `nowMs`, keeps every window whose `districtKey` is a string naming one of the districts handed in and whose `startMs` is at or before the clock, maps `inferred` to the basis (`calendar` when true, `matches` when false), sets `watchedUntilMs` to `endMs` plus `DISTRICT_AWARDS_WATCH_MS`, and sorts by district key then event key by plain string comparison. It does not write the window bounds, the pad, the calendar span or the retention bound itself: every one of them is the builder's. `RunDistrict` carries each event with its start date from this task on, though only Task 3 reads the start date.

    `checkLiveDistricts` in this task builds the `enforce` row without the override: it calls `liveDistrictEventsAt`, drops the events of any district in `alreadyListed`, logs nothing when none is left, and otherwise logs one event line per event and then one skip line per district, in sorted order. It returns the final outcome shape of the context block, with `overridden` and `unchecked` false. It accepts `mode` and `allowLive` in its arguments and, in this task, is only ever called with `enforce` and false. It does not throw for a live district.

    `seasonUploadPlan` is pure and does what the context block says. `carryPublishedIndex` does what its table says: one read of the index key, each failure a `DistrictPublishRefusedError` with the wording of the context block (the message of a read failure only, never the error object or a stack), one line naming the kept rows, one line per skipped district that has no published row, and the result through `DistrictsIndexArtifactSchema.parse`. Export `LIVE_DISTRICT_MARKER` and use it in every line and message.

    Wire it into `scripts/publishDistricts.ts` (D2 as revised, readings R1, R5, R6, R12, R15, R16), following the order of the context block without its two Task 3 steps. Add the optional `now` field to `CliOptions` with a doc comment that calls it a test seam and says production reads the wall clock and that it is never the `asOf` instant. Do not touch `parseOptions` in this task. In `run`, right after the seasons are composed, build the run's district list from the composed seasons (each district's year prefixed key, its season, and every event the publisher lists for it with its key and its start date, null where the corpus holds none) and start an empty skip set. Add the two clock passes, each reading the clock once through the seam, each adding the district keys it returns to the skip set, the second handed the keys the first returned. In this task both passes run only on a run that uploads, so a dry run makes no call and skips nothing. Hand each 261009-ul3 pass only the districts that are not in the skip set at that moment, in their existing order, and do not call it when districts were skipped and none is left. After the 261009-ul3 second pass and before the upload loop, ask `seasonUploadPlan` for each season, and for a season whose index is `carried` await `carryPublishedIndex` with the reader the 261009-ul3 guard uses, keeping the result for the upload loop. Every season's carry finishes before the first upload. In the upload loop, pass over a skipped district's detail and every sidecar whose artifact names a skipped district: no byte gate, no local file, no upload and no composed line. Upload the index the plan says: this run's as today, the carried one through the same byte gate, local write and upload as today's index, or none with the one line for a season whose districts are all skipped. Where the season summary line is printed and districts of that season were skipped, it says how many were published and how many skipped; with nothing skipped that line is exactly today's. After the loop print the closing line when the skip set is not empty. The bake loop is not edited. With an empty skip set every statement that existed before behaves exactly as before. Add a comment at each new step that says what it is and why it sits there.

    Never Read, cat or echo `.env`. Nothing here needs the network. Stage the four files by explicit path and commit them as one commit whose subject names 261010-jyn and says in a plain sentence that the publisher skips a district with a live event and publishes the others. Run `git status --short` after the commit.
  </action>
  <verify>
    <automated>npx vitest run scripts/districtLiveGuard.test.ts scripts/publishDistricts.test.ts scripts/districtPublishGuard.test.ts packages/harness/manifests.test.ts</automated>
    <automated>SCR="C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad" && rm -rf "$SCR/jyn-after" && npx tsx scripts/publishDistricts.ts --years "2016-2020,2022-2026" --dry-run --no-bake --local-out "$SCR/jyn-after" > "$SCR/jyn-after.log" 2>&1 && node "$SCR/ul3-compare-all.mjs" "$SCR/jyn-before" "$SCR/jyn-after" && node "$SCR/r9x-compare.mjs" "$SCR/jyn-before" "$SCR/jyn-after"</automated>
    <automated>npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && npx tsc --noEmit -p apps/worker/tsconfig.json && echo "TYPECHECKS CLEAN (root, web, e2e, worker)"</automated>
    <automated>SCR="C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad" && npx tsx "$SCR/jyn-live-at.mts" now --enforce && npx tsx "$SCR/jyn-live-at.mts" 2026-03-21T18:00:00.000Z --enforce</automated>
    Step 0 commands, run once before the first edit (the same two dump commands with the BEFORE names): `npx tsx scripts/publishDistricts.ts --years "2016-2020,2022-2026" --dry-run --no-bake --local-out "$SCR/jyn-before"` and `npx tsx scripts/publishDistricts.ts --years 2025-2026 --as-of 2026-04-04 --dry-run --local-out "$SCR/jyn-bake-before"`, each followed by `node "$SCR/ul3-compare-all.mjs" "$SCR/jyn-planner-before" "$SCR/jyn-before"` and its bake twin.
    Read from the printed output: the vitest totals show the two publisher files above their 130 and `packages/harness/manifests.test.ts` at 51, with nothing failed and nothing skipped. Both comparers print `CLEAN`. The control script prints `0 live district event(s)` and `returned: 0 live district(s)` for `now`. For the March clock it prints `109 district(s) of the run, 28 live district event(s) in 13 district(s)`, its own 28 lines, then the check's 28 event lines and 13 skip lines, and `returned: 13 live district(s)`.
  </verify>
  <done>
    A run that uploads skips a district with an event in its window or in the 24 hours after it, at either pass: none of its objects is gated, written locally, uploaded, read or compared, every other district publishes, the index keeps the skipped district's published row, and `run` resolves. A season whose districts are all live uploads nothing. A published index that cannot be carried refuses the run before any upload. A run with no live district prints no new line and uploads exactly as before, and the no bake dump of every published season is identical before and after. The four typechecks print their sentinel. One commit, four files.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: The override, the dry run notice, the event with no window and the clock check that cannot run (D1, D2 as revised, D3)</name>
  <files>scripts/districtLiveGuard.ts, scripts/districtLiveGuard.test.ts, scripts/publishDistricts.ts, scripts/publishDistricts.test.ts</files>
  <read_first>
    - `scripts/districtLiveGuard.ts` and `scripts/districtLiveGuard.test.ts` as Task 1 left them
    - `scripts/publishDistricts.ts`: `parseOptions`, and `run` as Task 1 left it
    - `scripts/publishDistricts.test.ts` lines 2276 to 2295 (the 261009-ul3 flag tests to mirror) and the 261010-jyn describe of Task 1
  </read_first>
  <behavior>
    `scripts/districtLiveGuard.test.ts`, added cases, same temp corpus style:
    - No window, current year (R4): a `2026pnw` event with no match and start date `not-a-date`. At a clock inside 2026 it is reported with basis `no-window` and three null instants. At `2026-12-31T23:59:59.999Z` it is reported. At `2027-01-01T00:00:00.000Z` it is not.
    - Pruned is not the same as no window: a `2026pnw` event with start date `not-a-date` and one match in March 2026 is not reported at a clock in October 2026.
    - A district handed in with a season other than the clock's UTC year never yields a `no-window` entry.
    - `checkLiveDistricts` prints the `no-window` event line for such an event, with the marker, the district key and the event key, and skips its district like any other.
    - The mode table, with one live event: `enforce` with `allowLive` true logs the event line and one override line containing `--allow-live`, logs no skip line, does not throw, and returns the district key with `overridden: true`. `notice` logs the event line and one notice line containing `--dry-run`, logs no skip line, does not throw whatever `allowLive` is, and returns the district key with `overridden: false`.
    - A check that cannot run: `db` is a stub whose `prepare` throws an `Error` with a recognisable message. `notice` logs exactly one line naming that message and returns `unchecked: true` with empty lists. `enforce` throws `DistrictPublishRefusedError` whose message contains that message, the stage and `Nothing was uploaded`, with `allowLive` false and with it true.
    - In every mode, every logged line starts with `publishDistricts:` and contains `LIVE_DISTRICT_MARKER`, and nothing is logged when nothing is live.

    `scripts/publishDistricts.test.ts`, added to the 261010-jyn describe of Task 1 (same fixture, same helpers):
    - `--allow-live` publishes the live district too and the 261009-ul3 guard still runs on it: `allowLive: true`, `now` answers LIVE. `run` resolves. The writer got N plus 1 keys, LIVEKEY among them. The reader was called 2N times, twice for LIVEKEY and never for INDEXKEY. The uploaded index equals this run's, not the published fixture. A printed line contains the marker and `--allow-live`, a printed line contains the marker with the district key and the event key, and no line contains `skipped`.
    - `--allow-live` does not switch the 261009-ul3 guard off: `allowLive: true`, `now` answers LIVE, and the reader answers, for LIVEKEY, a copy of this run's own artifact with one extra `qualifyingAwards` entry (award type 9999, built through `composeYear` and `DistrictArtifactSchema.parse` as the 261009-ul3 fixture does) and null for every other key. `run` rejects with `DistrictPublishRefusedError`, the message contains `older than what is live`, and the writer was never called.
    - The same stale artifact without the override is left alone: the same reader, `allowLive` absent, `now` answers LIVE, and INDEXKEY answers the published index fixture. `run` resolves, because the skipped district is neither read nor compared.
    - The dry run notice: `dryRun: true`, `now` answers LIVE. `run` resolves, a printed line contains the marker with the district key and the event key, a printed line contains the marker and `--dry-run`, no line contains `skipped`, and the reader and the writer were never called. The `now` seam was called exactly once. The `localOut` directory holds N plus 1 files, the fixture district's detail among them.
    - The notice changes no composed byte: two dry runs with `localOut`, one with `now` answering LIVE and one answering ENDS. Both directories hold the same file names, and every file is equal once the top level `generation` is dropped.
    - The real clock is silent for a finished season: a dry run with no `now` seam prints no line containing the marker.

    `scripts/publishDistricts.test.ts`, a new describe for `parseOptions` named with 261010-jyn, no corpus:
    - `--allow-live` sets `allowLive` to true. Without it the key is absent. It is accepted with `--dry-run`. `parseOptions` never sets `now`.
  </behavior>
  <action>
    Write the failing tests of the behavior block first and see them fail.

    `scripts/districtLiveGuard.ts` (D1 last sentence, D2 as revised, readings R4, R7, R8, R9). Add the event with no window to `liveDistrictEventsAt`: a second call to `buildLiveWindowsManifest` over the same seasons with a retention clock of 0, held in a named constant whose comment says it switches retention off and cites the builder's own doc of `nowMs`. For every district handed in whose season equals the UTC year of the clock, every event key of that district that is absent from that second list becomes an entry with basis `no-window` and three null instants. An event absent at the clock but present in the second list is past its watch and adds nothing. Extend the header with this rule, premise P5 (no such event is in the corpus today) and the reason for the second call (premise P6). Build the remaining cells of the `checkLiveDistricts` table in the context block, with the wording given there: the `no-window` event line, the override row (event lines and one override line, no skip line, `overridden` true), the `notice` row (event lines and one notice line, no skip line), and the check that could not run, caught around the call to `liveDistrictEventsAt`, the message only, never the error object or a stack. In `enforce` it throws with or without `allowLive`. In `notice` it logs one line and returns `unchecked` true.

    `scripts/publishDistricts.ts` (D2 as revised). Add `--allow-live` to `parseOptions` as a boolean option, spread into the result only when given, in the style of `--allow-regress`, with no refusal for a dry run. Add the `allowLive` field to `CliOptions` with a doc comment that says it publishes the live districts too, that the 261009-ul3 guard still runs on them, and that it never covers a check that could not run. In `run`, pass `mode` and `allowLive` at both call sites, make the first clock pass run on every run (`enforce` on a run that uploads, `notice` on a dry run), and add a pass's district keys to the skip set only when the pass was not overridden and the run uploads. The second pass stays a run that uploads only, and it is still handed the keys the first pass returned, overridden or not, so nothing is printed twice. The publisher's header and the doc are Task 3's.

    Never Read, cat or echo `.env`. Stage the four files by explicit path and commit them as one commit whose subject names 261010-jyn and says in a plain sentence that `--allow-live` publishes the live districts too and a dry run prints a notice. Run `git status --short` after the commit.
  </action>
  <verify>
    <automated>npx vitest run scripts/districtLiveGuard.test.ts scripts/publishDistricts.test.ts scripts/districtPublishGuard.test.ts packages/harness/manifests.test.ts</automated>
    <automated>SCR="C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad" && rm -rf "$SCR/jyn-after2" && npx tsx scripts/publishDistricts.ts --years "2016-2020,2022-2026" --dry-run --no-bake --local-out "$SCR/jyn-after2" > "$SCR/jyn-after2.log" 2>&1 && node "$SCR/ul3-compare-all.mjs" "$SCR/jyn-before" "$SCR/jyn-after2" && node "$SCR/r9x-compare.mjs" "$SCR/jyn-before" "$SCR/jyn-after2"</automated>
    <automated>npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && npx tsc --noEmit -p apps/worker/tsconfig.json && echo "TYPECHECKS CLEAN (root, web, e2e, worker)"</automated>
    <automated>SCR="C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad" && npx tsx "$SCR/jyn-live-at.mts" now --notice --enforce && npx tsx "$SCR/jyn-live-at.mts" 2026-07-08T12:07:31.000Z --notice --enforce --enforce-allow-live</automated>
    Read from the printed output: the targeted run shows nothing failed and nothing skipped. Both comparers print `CLEAN`. The typecheck sentinel is printed. The control script prints `0 live district event(s)` and two `returned: 0 live district(s)` lines for `now`. For the July clock it prints one live event (`2026isr`, `2026iscmp`); under the dry run heading the event line and the notice line; under the run that uploads the event line and the skip line and `returned: 1 live district(s) [2026isr], overridden false`; under the override the event line and the override line and `overridden true`. Nothing throws.
  </verify>
  <done>
    `--allow-live` publishes a live district with the 261009-ul3 guard still in force on it. A dry run prints the live districts as a notice, skips nothing, never fails and composes the same bytes. An event with no window makes its district live only in the clock's UTC year. A clock check that could not run refuses a run that uploads and is a printed line in a dry run. The no bake dump is identical before and after. Two commits so far, four files.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: The evidence skip after the 261009-ul3 second read, the publisher header and the operations doc (the orchestrator's addition, D3, D4)</name>
  <files>scripts/districtLiveGuard.ts, scripts/districtLiveGuard.test.ts, scripts/publishDistricts.ts, scripts/publishDistricts.test.ts, docs/worker-operations.md</files>
  <read_first>
    - The evidence block and readings R18 to R28 of this plan
    - `scripts/districtLiveGuard.ts` and `scripts/districtLiveGuard.test.ts` as Task 2 left them
    - `scripts/districtPublishGuard.ts` lines 115 to 250 (read only: the event fold and the comparison this rule sits beside) and `scripts/districtPublishGuard.test.ts` lines 1 to 110 (how a schema valid district artifact fixture is built)
    - `packages/harness/manifests.ts` lines 73 to 98 and 232 to 262 (`probeWindowFor`, and how the builder asks it for a district event)
    - `packages/harness/pageArtifacts.ts` lines 2021 to 2065 (the event state, the `eventPoints` row and the `remainingEvents` row)
    - `scripts/publishDistricts.ts` lines 76 to 91 (the header paragraph to add beside) and `run` as Task 2 left it
    - `scripts/publishDistricts.test.ts`: the 261010-jyn describe as Task 2 left it
    - `docs/worker-operations.md` lines 1281 to 1346 ("The limits that remain", the 261009-ul3 subsection, the heading that follows it)
    - `packages/core/districts/eventAwards.ts` lines 16 to 47 and 269 to 290 (read only: the facts and the two vantages of the awards flag, for the doc's wording)
  </read_first>
  <behavior>
    `scripts/districtLiveGuard.test.ts`, added cases.

    `calendarWatchEventsAt`, with no corpus (run districts spelled out with start dates):
    - An event with start date `2026-03-05`: its bounds are the ones `probeWindowFor` gives and `watchedUntilMs` is `endMs` plus WATCH. It is returned from `startMs` to `watchedUntilMs` minus 1, and not at `startMs` minus 1 or at `watchedUntilMs`.
    - An event whose start date is null, and one whose start date is `not-a-date`, are never returned.
    - A district in `exclude` is not in the map. A district with no event in a window is not in the map. Two events of one district come back sorted by key.
    - Parity with the builder (R19): on a temp corpus, for a district event with no match, at each of the six edge instants the event is in `calendarWatchEventsAt` exactly when `liveDistrictEventsAt` reports it.

    `compareForLiveEvidence`, with hand built artifacts passed through `DistrictArtifactSchema.parse`, in the style of `scripts/districtPublishGuard.test.ts`. EVENT is the one event key handed in unless a case says otherwise:
    - Rule (i): published false on every row of EVENT and this run true gives exactly one `awardsPostedRaised`. So does a published artifact with no state on any row of EVENT, and one with no row for EVENT at all. Published true gives none. This run false, and this run with no state, give none. One published row true among several false gives none.
    - Rule (ii): each of `qual`, `alliance`, `elim`, `award` and `total` lower by itself in this run gives exactly one `pointsLowered` naming the team, that category and both values. Two categories lower on one row give two, in the order of `EVIDENCE_POINT_CATEGORIES`. Equal numbers and higher numbers give none. A row only this run holds, and a row only the published artifact holds, give none.
    - Both differences on an event that is not in the set handed in give nothing.
    - Order: events in ascending key order, the flag before the points, the points in this run's team order.
    - One fold (R22): for a pair of artifacts in which one row of several carries the flag true, `compareDistrictArtifacts(A, B)` of the 261009-ul3 module reports the `awardsPosted` loss and `compareForLiveEvidence(B, A, ...)` reports the raise.

    `checkLiveEvidence`, with the same hand built artifacts, a district whose one event has a start date that puts the clock inside its calendar window plus 24 hours, and a `publishedBodies` map:
    - `enforce`, the flag difference: one evidence line with the marker, the district key, the event key, `awards posted` and the window's end as ISO text, then one skip line with the marker, the district key, `skipped` and `on evidence`. It returns the evidence, the district key, and `overridden` false.
    - `enforce`, three lowered values at one event: one evidence line that holds the count 3 and names the first team, its category and both values, and one skip line.
    - `enforce` with `allowLive` true: the evidence lines and one override line containing `--allow-live`, no skip line, `overridden` true.
    - `notice`: the evidence lines and one notice line containing `--dry-run` and `on evidence`, no skip line.
    - Both differences at a clock equal to the event's `watchedUntilMs`: nothing is printed and the lists are empty. One millisecond earlier they are reported.
    - Not compared (R26): the district is in `alreadyListed`; its body is null; its key is missing from the map; its body is `not json`; its body is `{}`. Each prints nothing and returns empty lists.
    - It never throws, and every logged line starts with `publishDistricts:` and contains the marker.

    `scripts/publishDistricts.test.ts`, added to the 261010-jyn describe (same fixture, same helpers). GAP is ENDS, the first instant at which the clock rule no longer lists the fixture district. PAST is the end of the fixture event's calendar window plus WATCH, computed in the test from the event's `start_date` in the corpus through `probeWindowFor` (the planner measured `2026-07-11T00:00:00.000Z`). Two published variants of the fixture district's own artifact, both built through `composeYear` and `DistrictArtifactSchema.parse`: FLAGFALSE sets `awardsPosted` false in the state of every row of the fixture event, and the fixture asserts that this run's artifact holds it true there. HIGHERPOINTS raises `qual` and `total` by 3 on the first team's `eventPoints` row at the fixture event. In these tests the reader answers the variant for LIVEKEY, the published index fixture for INDEXKEY, and null for every other key, unless a test says otherwise.
    - Rule (i) skips: `now` answers GAP and LIVEKEY answers FLAGFALSE. `run` resolves. The writer got N keys and never LIVEKEY. The reader was called 2N plus 1 times: N details in each 261009-ul3 pass, LIVEKEY in both, then INDEXKEY last, and every read comes before the first write. The uploaded index holds the published row for the fixture district. The printed lines hold one with the marker, the district key, the event key and `awards posted`, one with the marker, the district key, `skipped` and `on evidence`, and a last marker line with the counts 1 and N minus 1. The `localOut` directory holds N files and none is the fixture district's detail.
    - Rule (ii) skips: the same with HIGHERPOINTS. A printed line names the first team's key and `qual`.
    - One millisecond before the window ends: `now` answers PAST minus 1 with FLAGFALSE. The writer never got LIVEKEY.
    - Past the window nothing changes, for each variant: `now` answers PAST. `run` resolves, the writer got N plus 1 keys, LIVEKEY among them, the reader was never called for INDEXKEY, and no printed line contains the marker. With FLAGFALSE the uploaded LIVEKEY body holds `awardsPosted` true for the fixture event.
    - `--allow-live` publishes: `allowLive: true`, `now` answers GAP, FLAGFALSE. The writer got N plus 1 keys, LIVEKEY among them. A printed line contains the marker and `awards posted`, one contains the marker and `--allow-live`, and none contains `skipped`.
    - No difference, nothing changes: `now` answers GAP and the reader answers, for every detail key, this run's own artifact for that key. `run` resolves with N plus 1 writes, the reader was never called for INDEXKEY, no printed line contains the marker, and every uploaded detail body equals this run's composed artifact once the top level `generation` is dropped.
    - The 261009-ul3 guard is not changed by it: `now` answers GAP and LIVEKEY answers this run's artifact with one extra `qualifyingAwards` entry (award type 9999). `run` rejects with `DistrictPublishRefusedError`, the message contains `older than what is live`, and the writer was never called.
    - The notice under `--dry-run --check-live`: `dryRun: true`, `checkLive: true`, `now` answers GAP, FLAGFALSE. `run` resolves, a printed line contains the marker and `awards posted`, one contains the marker, `--dry-run` and `on evidence`, the writer was never called, the reader was called N times and never for INDEXKEY, and the `localOut` directory holds N plus 1 files.
    - A plain dry run cannot run it: `dryRun: true`, `now` answers GAP, FLAGFALSE. The reader was never called and no printed line contains the marker.
    - The clock is still read once per clock pass: on the run of rule (i), the `now` seam was called exactly 2 times.
  </behavior>
  <action>
    Write the failing tests of the behavior block first and see them fail.

    `scripts/districtLiveGuard.ts` (the orchestrator's addition, readings R18 to R27). Add `calendarWatchEventsAt`: for each district not in `exclude` and each of its events, ask the imported `probeWindowFor` with the event's start date and the clock moved back by `DISTRICT_AWARDS_WATCH_MS`, exactly as the builder asks for a district event, keep the event when a window comes back and its `startMs` is at or before the clock, and set `watchedUntilMs` to `endMs` plus the same constant. A null start date has no window. It writes no window bound of its own and reads no corpus. Add `EVIDENCE_POINT_CATEGORIES` and `compareForLiveEvidence` as their table in the context block says: one small walk over each artifact that gathers, for the events handed in only, the fold of `awardsPosted` over every `eventPoints` and `remainingEvents` row and each team's first `eventPoints` row. Add `checkLiveEvidence` as its table says: the districts to look at come from `calendarWatchEventsAt` with `alreadyListed` as the exclusion; a body is parsed with `JSON.parse` and `DistrictArtifactSchema.safeParse`, and anything that is not a parsed district artifact is passed over without a line; the evidence of a district is printed as one line for the flag per event and one line for the lowered values per event, holding their count and the first of them; then the skip line with its `on evidence` reason, the override line or the notice line, by mode. It never throws. Extend the header: the evidence rule, why it exists (premise P2), which window it uses and why the two rules together are the union (readings R18, R19), what counts as not confirmed (R20), the five numbers (R21), that the fold is the 261009-ul3 module's own rule stated again because that module is not edited (R22), and what is not compared (R26).

    `scripts/publishDistricts.ts` (readings R23, R24, R25). In `run`, give the reader handed to the 261009-ul3 guard a recording wrapper: it calls the reader the run already uses with the same arguments, returns exactly what that returned, and keeps each returned body by key in a map made fresh for each pass. A throw passes through and records nothing. Do not edit `scripts/districtPublishGuard.ts`. Keep each clock pass's clock reading. On a run that uploads, right after the 261009-ul3 second pass and before the index carry, call `checkLiveEvidence` with stage `before the first upload`, the run's districts, the second clock pass's reading, every district key either clock pass returned as `alreadyListed`, the details that pass was handed, the map it recorded, `enforce` and `allowLive`; add the district keys it returns to the skip set unless it was overridden. Do not call it when the 261009-ul3 second pass was not called. In a dry run with `--check-live`, right after that run's 261009-ul3 pass, call it with stage `before the bake`, the first clock pass's reading and `notice`. In a plain dry run make no call. The index carry, the upload loop and the closing line already read the skip set, so a district skipped on evidence is passed over and its index row carried with no further change. With no evidence every statement behaves exactly as Task 2 left it.

    Add a header paragraph to `scripts/publishDistricts.ts` after the 261009-ul3 one, titled for the live districts guard and quick task 261010-jyn: what it skips, the clock rule and where its window comes from, the two clock passes and where they sit, the evidence rule and the read it rides on, how the index row of a skipped district is kept, `--allow-live`, the two notices, the two refusals that remain (a clock check that cannot run, a published index that cannot be carried), and that the clock is the wall clock and never `--as-of`.

    `docs/worker-operations.md` (D4, premises P1, P2, P4, P7, P8, readings R13, R18, R28). Add one subsection headed `### The offline district publish skips a district while one of its events is live (quick task 261010-jyn)`. It goes after the last paragraph of the 261009-ul3 subsection (the one that starts "What remains: the Worker can still write between the second read") and before the heading "A championship whose rows arrive one event at a time". Plain sentences, in this order.
    First, the rule: the Worker owns a district's file while it is watching one of that district's events, so `pnpm publish:districts` skips that district: it uploads neither its detail file nor its sidecars and publishes every other district of the run. The run ends with exit 0.
    Second, the clock rule: it covers an event and the day after its last match. The same builder that builds the live windows manifest is asked on the corpus at the wall clock (never `--as-of`); the window comes from the event's match times with an hour either side, or, when the corpus holds no match for the event, from 12 hours before its start date to 4 days after it; plus 24 hours; district events, District Championships and their divisions alike. It is checked twice, before anything is read and again just before the first upload, and a district it lists is neither read nor compared.
    Third, the evidence rule: it covers the rest of the Worker's watch. The Worker can be reading an older manifest that holds an event's calendar window, which stays open about a day longer than the window from its matches. For an event still inside its calendar window plus 24 hours, the publisher compares what it is about to upload with the published file it has just read, and skips the district when it would write awards posted true where the published file does not hold it true, or a lower value than the published one in the qualification, alliance, playoff, award or total points of a row both files hold. It reads nothing extra. Past that window nothing changes: the flag is raised at the hindsight vantage and a lower value is not a regression, as before.
    Fourth, what is printed: one line per live event (district, event, window, watched until), one line per piece of evidence, one line per skipped district with its reason, and a last line with how many districts were skipped and published and what to do: run the publish again later, or pass `--allow-live`.
    Fifth, the index: the row of a skipped district in `v1/districts/{year}.json` is taken from the index that is published now, because the Worker changes the detail file's team count and keeps its slot counts as last published, and a row composed from the corpus could disagree with the file the Worker owns. The Worker never writes the index. When the published index is missing or cannot be read the run is refused before any upload. When every district of a season is skipped nothing of that season is uploaded.
    Sixth, `--allow-live`: it prints the same lines and one more saying it was overridden, and publishes the listed districts too; the 261009-ul3 check still runs on them.
    Seventh, why it is dangerous, as two facts: the publisher sets the awards flag at its hindsight vantage (a judged award listed or award points, either one), while the Worker's live rule needs a judged award and award points and playoff points and a settled list (60 minutes when every expected award is listed, 12 hours when one is not), so a publish during the Worker's watch can raise a flag the Worker would still hold false and a lock the page showed can be withdrawn; and the corpus's points can be older than what the Worker has merged, so a floor can drop or a finished category can read open again until the Worker's next forced look, up to 15 minutes.
    Eighth, when it is right: a listed event was cancelled or never played (an event with no match in the corpus reads live from 12 hours before its start date for its whole calendar window), the season has never been published, or the Worker did not follow the event and the corpus is known to be the newer side.
    Ninth: a `--dry-run` prints the clock rule's lines as a notice, skips nothing and never fails. It shows the evidence rule's lines only with `--check-live`, because a plain dry run reads nothing from R2. A run with nothing to skip prints nothing new. A clock check that cannot run refuses a run that uploads, also with `--allow-live`.
    Tenth, what is still not covered, each as one sentence, from reading R28: (a) the flag raised at the hindsight vantage once nobody is watching, the limit already stated above; (b) an older snapshot in which a value is higher than the Worker's; (c) a manifest in R2 holding a window that neither of today's two windows contains; (d) a first publish and a shape change are not compared; (e) the time between the second read and a district's own upload; (f) a plain dry run shows the clock rule only.
    Change no other part of the doc. Premise P1: there is no 261010-d7r sentence in this doc to correct, so correct none.

    Final gates, each read from its printed output: the targeted vitest files; the no bake dump into a freshly removed `SCRATCH/jyn-after3` compared by both comparers against `SCRATCH/jyn-before`; the bake dump into a freshly removed `SCRATCH/jyn-bake-after` compared against `SCRATCH/jyn-bake-before`; the four typechecks; the control script with `--calendar`; the scope line; then the full root `npx vitest run`, read from its printed totals. STOP rule 1 applies to a failed comparison and STOP rule 6 to a failure in a file this task did not touch.

    Never Read, cat or echo `.env`. Stage the five files by explicit path and commit them as one commit whose subject names 261010-jyn and says in a plain sentence that a district is also skipped on evidence while an event's calendar window is open, and that the operations doc states both rules. Run `git status --short` after the commit. Do not push.
  </action>
  <verify>
    <automated>npx vitest run scripts/districtLiveGuard.test.ts scripts/publishDistricts.test.ts scripts/districtPublishGuard.test.ts packages/harness/manifests.test.ts</automated>
    <automated>SCR="C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad" && rm -rf "$SCR/jyn-after3" && npx tsx scripts/publishDistricts.ts --years "2016-2020,2022-2026" --dry-run --no-bake --local-out "$SCR/jyn-after3" > "$SCR/jyn-after3.log" 2>&1 && node "$SCR/ul3-compare-all.mjs" "$SCR/jyn-before" "$SCR/jyn-after3" && node "$SCR/r9x-compare.mjs" "$SCR/jyn-before" "$SCR/jyn-after3"</automated>
    <automated>SCR="C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad" && rm -rf "$SCR/jyn-bake-after" && npx tsx scripts/publishDistricts.ts --years 2025-2026 --as-of 2026-04-04 --dry-run --local-out "$SCR/jyn-bake-after" > "$SCR/jyn-bake-after.log" 2>&1 && node "$SCR/ul3-compare-all.mjs" "$SCR/jyn-bake-before" "$SCR/jyn-bake-after"</automated>
    <automated>npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && npx tsc --noEmit -p apps/worker/tsconfig.json && echo "TYPECHECKS CLEAN (root, web, e2e, worker)"</automated>
    <automated>SCR="C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad" && npx tsx "$SCR/jyn-live-at.mts" now --calendar && npx tsx "$SCR/jyn-live-at.mts" 2026-07-09T13:07:31.000Z --calendar && npx tsx "$SCR/jyn-live-at.mts" 2026-07-11T00:00:00.000Z --calendar && npx tsx "$SCR/jyn-live-at.mts" 2026-03-24T12:00:00.000Z --calendar</automated>
    <automated>git show --name-only --format= $(git log --format=%H --grep="261010-jyn") | sort -u</automated>
    <automated>npx vitest run</automated>
    Read from the printed output: the targeted run shows nothing failed and nothing skipped. All three comparisons print `CLEAN` (119 files and 42 files). The typecheck sentinel is printed. The control script prints `0 live district event(s)` and `calendar watch: 0 event(s)` for `now`; `0 live district event(s)` and `calendar watch: 1 event(s) in 1 district(s) the clock rule does not list: 2026isr(2026iscmp)` for `2026-07-09T13:07:31.000Z`; `calendar watch: 0 event(s)` for `2026-07-11T00:00:00.000Z`; and `calendar watch: 18 event(s) in 10 district(s)` for `2026-03-24T12:00:00.000Z`. The scope line lists exactly `docs/worker-operations.md`, `scripts/districtLiveGuard.test.ts`, `scripts/districtLiveGuard.ts`, `scripts/publishDistricts.test.ts` and `scripts/publishDistricts.ts`. The full run's totals show no failure.
  </verify>
  <done>
    On a run that uploads, a district with an event inside its calendar window plus 24 hours is skipped when this run would raise that event's awards flag over the published file or write a lower point value than the published file holds, on the bodies the 261009-ul3 second pass already read, and its index row is carried. Past that window, and with no such difference, the run uploads exactly as before. `--allow-live` publishes, `--dry-run --check-live` prints a notice, a plain dry run prints nothing from this rule, and the 261009-ul3 guard refuses what it refused before. The header and the doc subsection state both rules and what is not covered. Both dumps are identical before and after. Three commits in all, five files, none of them under `.planning/`, nothing pushed.
  </done>
</task>

</tasks>

<verification>
- The targeted vitest files pass with nothing skipped: the corpus is present in the main checkout, so every corpus guarded test runs.
- `UL3 COMPARE CLEAN` and `R9X COMPARE CLEAN` for the 119 file no bake dump after each task, and `UL3 COMPARE CLEAN` for the 42 file bake dump after Task 3, each against a baseline the executor took at BASE before its first edit. These are runs with nothing to skip, which is the case the comparison is for.
- The four typechecks print `TYPECHECKS CLEAN (root, web, e2e, worker)`.
- The control script reads no district live at the real clock, 28 events in 13 districts at `2026-03-21T18:00:00.000Z`, one at `2026-07-08T12:07:31.000Z`, and one event in an evidence window at `2026-07-09T13:07:31.000Z`.
- This task's commits name exactly the five files of `files_modified`.
- The full root `npx vitest run` is green, read from its printed totals. Never `timeout <n> pnpm`.
</verification>

<success_criteria>
- D1: live is read off the live windows builder on the same corpus at the wall clock, with the 24 hour watch, and the new code holds no date rule of its own. An event with no window is live only in the clock's UTC year.
- D2 as revised: a run that uploads skips a live district at either pass, uploads nothing of it, writes no local file for it and does not read or compare it, publishes the others, keeps the skipped district's published index row, and exits 0. `--allow-live` publishes the live districts too with the 261009-ul3 guard still on them. A dry run prints a notice and never fails. A run with nothing to skip prints nothing new. The only refusals this guard adds are a clock check that cannot run and a published index that cannot be carried.
- The evidence skip: inside an event's calendar window plus 24 hours, a raised awards flag or a lowered point value against the published file skips the district, with nothing new read and the 261009-ul3 guard's refusals unchanged. Past that window nothing changes.
- D3: both rules, the season plan, the index carry and the wiring are tested with an injected clock and no network, and no existing test body was edited. For a run with nothing to skip the composed artifacts are byte identical before and after.
- D4: the doc subsection says who owns the file, what each rule covers, what is printed, how the index row is kept, the override and its danger, and what is still not covered.
- The fenced files are untouched, no todo is touched, nothing under `.planning/` is committed and nothing is pushed.
</success_criteria>

<output>
Create `.planning/quick/261010-jyn-the-district-publisher-refuses-to-publis/261010-jyn-SUMMARY.md` with the Write tool and do NOT commit it. If the Write tool refuses that file, return the full SUMMARY text in the final message instead and never write it through Bash.

The SUMMARY carries: BASE and the three commit hashes; every comparison line as printed (the two step 0 lines against the planner dumps, the pair of each task, the bake line); the vitest totals of each run; the full output of the control script at the real clock, at `2026-03-21T18:00:00.000Z` with `--enforce`, at `2026-07-08T12:07:31.000Z` in its three modes, and at the four `--calendar` clocks; the real wording of a clock skip, an evidence skip of each kind, an override, the two notices, the closing line and the two refusals, copied from a test run; each premise P1 to P9 and each reading R1 to R28 as executed; any deviation; and what the orchestrator still owes (the planning commit, the three headers of premise P1, and the dry runs from the main context, one of them with `--check-live`).
</output>
