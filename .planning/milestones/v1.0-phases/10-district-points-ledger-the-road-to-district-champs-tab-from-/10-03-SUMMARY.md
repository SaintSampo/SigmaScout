---
phase: 10-district-points-ledger
plan: 03
subsystem: api
tags: [district-points, frc, zod, schemas, cloudflare-workers, r2, manifest, byte-budget, typescript, vitest]

requires:
  - phase: 09
    provides: "packages/core/districts/locks.ts's computeLocksWithQualifiers/cutLinePointsWithQualifiers, pointModel.ts's maxEventPoints season registry, qualification.ts's specialAllocationNote, prequalified.ts's prequalifiedTeams, and scripts/publishDistricts.ts's buildDistrictArtifact verdict pipeline"
  - phase: 08
    provides: "packages/harness/browserSafeSchemas.test.ts's static import-graph scan and its entry-point registration convention"
  - phase: 07
    provides: "packages/harness/publishBudget.ts's PAGE_BUDGET_MAX_BYTES/assertWithinPageBudget shape and docs/publish-budget.md's ceiling-change discipline"
provides:
  - "packages/harness/districtRankingsMerge.ts — applyDistrictRankings, applyDistrictEventState and recomputeDistrictVerdicts, the ONE producer of the merged district shape, pure and Worker-bundleable"
  - "DistrictEventStateSchema on both district row schemas — the four state facts a grey-versus-blue cell needs"
  - "DistrictPointPmfSchema, DISTRICT_AWARD_BUCKETS, awardBaseRates with an executable walk-forward leak boundary, and per-team awardProfile"
  - "districtPreSimKey + DistrictPreSimArtifactSchema + DistrictArtifactSchema.bakedEvents — the SIDECAR placement the byte measurement selected"
  - "DISTRICT_DETAIL_MAX_BYTES_PER_TEAM, DISTRICT_DETAIL_MAX_BYTES, DISTRICT_PRESIM_MAX_BYTES, DistrictBudgetExceededError, assertWithinDistrictBudget"
  - "LiveWindowEntrySchema.districtKey, populated by buildLiveWindowsManifest via a districts join, at an unchanged MANIFEST_SCHEMA_VERSION"
  - "scripts/publishLiveWindows.ts and pnpm publish:live-windows — the one-object path that gets districtKey to production"
affects: [10-05, 10-06, 10-07, 10-09]

actuals:
  tokens: 32917
  tasks: 4
  commits: 4

tech-stack:
  added: []
  patterns:
    - "One shared pure producer with two callers, never two implementations of one published shape: the Worker and the offline publisher both call applyDistrictRankings and recomputeDistrictVerdicts"
    - "A placement decision stated as a rule BEFORE the measurement, then recorded as the measurement's consequence — the rule and the numbers both live in docs/publish-budget.md and the synthesizer that produced them is committed"
    - "A dry run's zero-write behaviour pinned by an injected upload function's call count, never argued from reading the code"
    - "Refuse-before-merging: an empty or duplicated payload throws before a single row is touched, so no half-merged artifact can exist"
    - "Derive a corpus-only fact from the artifact the corpus-having producer already wrote, erring in the direction that delays a guarantee rather than publishing a false one (dcmpStillAhead)"

key-files:
  created:
    - packages/harness/districtRankingsMerge.ts
    - packages/harness/districtRankingsMerge.test.ts
    - packages/harness/districtBudget.test.ts
    - scripts/publishLiveWindows.ts
    - scripts/publishLiveWindows.test.ts
  modified:
    - packages/harness/pageArtifacts.ts
    - packages/harness/pageArtifacts.test.ts
    - packages/harness/publishBudget.ts
    - packages/harness/manifestSchemas.ts
    - packages/harness/manifests.ts
    - packages/harness/manifests.test.ts
    - packages/harness/browserSafeSchemas.test.ts
    - docs/publish-budget.md
    - package.json

key-decisions:
  - "SIDECAR, not inline, for the baked pmfs. Measured 2026pnw: state-only 151,351 bytes, inline 717,001 bytes, ratio 4.737x. The stated rule (inline only if at most 150,000 bytes AND at most 1.35x) fails both halves by 4.8x and 3.5x, so the inline branch was never written to any source file."
  - "Neither PAGE_ARTIFACT_SCHEMA_VERSION nor MANIFEST_SCHEMA_VERSION moved, and the manifest half deliberately OVERRIDES 10-RESEARCH Open Question 2's recommendation to bump: 10-09 deploys the Worker before the republish, so a bumped literal would make the newly deployed Worker reject the manifest sitting in R2 for the whole window between deploy and republish, killing live folding for every event rather than just districts."
  - "dcmpStillAhead is derived from the published artifact's own numbers (a dcmp-tier remaining row, or a champ ceiling at least one whole dcmp event above the district ceiling) because the Worker has no calendar. The `>=` comparison rather than `===` is what survives a merge that shrinks maxRemainingDistrict, and the whole derivation errs toward 'still ahead' — overstating a rival ceiling delays a locked verdict, understating one would publish a guarantee that is not true."
  - "recomputeDistrictVerdicts takes a whole artifact and owns the two-pass maxRemainingChamp rule itself, so it is idempotent and 10-06 can call the same function the merge calls instead of keeping a second verdict pass."
  - "An award whose event key appears on no eventPoints or remainingEvents row is left out of BOTH award-qualified sets rather than given a guessed tier — the team then reports contending instead of lockedAward, which understates a qualification but never publishes a false guarantee."
  - "DISTRICT_AWARD_BUCKETS is the wire vocabulary (none / oneOrTwo / threeOrMore) and deliberately differs from 10-02's module keys (none / one-or-two / three-or-more). 10-06 maps at the publish boundary; renaming a measured, pinned table to match a wire field would have been the more expensive change."
  - "COUNT(DISTINCT m.match_key) landed in the same edit as the districts join. match_count is what decides probe-versus-measured, and a count over join rows is exactly the shape that flips a zero-match probe event into a fake measured window."

patterns-established:
  - "Nested-and-optional over five flat optional fields: all five state facts come from one observation, so 'three present, two absent' is not a state any producer can be in, and the parent object's absence is the honest 'not observed' answer"
  - "A doc-versus-constant drift test that asserts the doc contains each ceiling rendered with comma grouping, proved to go red by temporarily moving a constant"
  - "A measurement instrument committed inside the test file that consumed it, so the number in the doc is re-derivable rather than transcribed"

requirements-completed: [SC-1, SC-5]

coverage:
  - id: D1
    description: "applyDistrictRankings merges a TBA-shaped rankings payload into a published district artifact and returns a schema-valid artifact with every verdict recomputed"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "packages/harness/districtRankingsMerge.test.ts#merges a real payload into a real artifact and returns a schema-valid artifact with recomputed verdicts"
        status: pass
      - kind: unit
        ref: "npx vitest run packages/harness/districtRankingsMerge.test.ts (29 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "An empty or duplicated rankings payload throws DistrictMergeError rather than blanking or half-merging a published district"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "packages/harness/districtRankingsMerge.test.ts#throws DistrictMergeError for an empty rankings payload rather than blanking a published district"
        status: pass
    human_judgment: false
  - id: D3
    description: "districtRankingsMerge.ts is Worker-bundleable — no Node built-in and nothing under packages/core/algorithms/ in its reachable import graph"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "packages/harness/browserSafeSchemas.test.ts#never reaches a file under packages/core/algorithms/"
        status: pass
      - kind: unit
        ref: "packages/harness/browserSafeSchemas.test.ts#visits at least the expected leaf modules (sanity check the scan itself is not vacuous)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every field this plan adds is optional, and a pre-republish district artifact and a pre-phase-10 live-windows manifest both still parse"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts#a district artifact carrying NONE of phase 10's fields still parses — the pre-republish shape the newly deployed Worker reads back at least once"
        status: pass
      - kind: unit
        ref: "packages/harness/manifests.test.ts#LiveWindowEntrySchema accepts an absent districtKey (a manifest published before this phase), a null, and a non-empty string — and rejects an empty string"
        status: pass
    human_judgment: false
  - id: D5
    description: "The baked-pmf placement is decided by measured 2026pnw bytes against a stated rule, and the ceilings the measurement produced cannot drift from the doc"
    requirement: "SC-5"
    verification:
      - kind: unit
        ref: "packages/harness/districtBudget.test.ts#the stated decision rule still selects SIDECAR on the measured numbers"
        status: pass
      - kind: unit
        ref: "packages/harness/districtBudget.test.ts#docs/publish-budget.md states each ceiling with comma grouping"
        status: pass
      - kind: unit
        ref: "packages/harness/districtBudget.test.ts#passes exactly at the ceiling and throws one byte above it"
        status: pass
    human_judgment: false
  - id: D6
    description: "An award base-rate block whose measuredThroughSeason is at or past its season is rejected by the schema — the walk-forward leak boundary is executable"
    requirement: "SC-5"
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts#REJECTS a table whose measuredThroughSeason equals its season — the walk-forward boundary is executable, not a comment"
        status: pass
    human_judgment: false
  - id: D7
    description: "buildLiveWindowsManifest emits the year-prefixed districtKey for a district event and an explicit null otherwise, joined and never concatenated, moving no pre-existing window"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "packages/harness/manifests.test.ts#emits the YEAR-PREFIXED district key for a district event whose events.district_key is the bare abbreviation"
        status: pass
      - kind: unit
        ref: "packages/harness/manifests.test.ts#REGRESSION: the districts join moves no pre-existing window — startMs, endMs, inferred and the entry count are unchanged"
        status: pass
    human_judgment: false
  - id: D8
    description: "pnpm publish:live-windows writes exactly one object reusing the live generation, with three refusals before any upload and a --dry-run that provably writes nothing"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "scripts/publishLiveWindows.test.ts#writes NOTHING: the injected upload function's call count is exactly 0"
        status: pass
      - kind: unit
        ref: "scripts/publishLiveWindows.test.ts (13 tests, all passing)"
        status: pass
    human_judgment: true
    rationale: "The tests prove the script's behaviour against an injected upload function and an injected live-manifest reader. They cannot prove the REAL run against R2 does what the injected one did — that is 10-09 Task 5's dry run, real write, and GET-with-Origin verification, which no plan in waves 1 to 4 can perform because executor subagents have no network."

duration: 26 min
completed: 2026-09-25
status: complete
---

# Phase 10 Plan 03: The district data contract Summary

**The district artifact gains per-event state, a measured-and-decided baked-pmf placement, and a shared pure merge; the live-windows manifest gains `districtKey` plus a one-write path to production that replaces a ~109,000-write decision with a command.**

## Performance

- **Duration:** 26 min
- **Tasks:** 4 of 4
- **Files:** 5 created, 9 modified
- **Commits:** 4

## Accomplishments

1. **One shared pure producer of the merged district shape.** `packages/harness/districtRankingsMerge.ts` exports `applyDistrictRankings`, `applyDistrictEventState`, `recomputeDistrictVerdicts`, `DistrictMergeError` and the three payload schemas (`DistrictRankingsEventPointsEntrySchema` promoted verbatim out of `scripts/publishDistricts.ts`'s module-local copy). The Worker (10-05) and the publisher (10-06) are callers; neither reimplements the merge. It is proved Worker-bundleable by `browserSafeSchemas.test.ts`'s STRICT entry-point list, which now also asserts the scan actually walks into `locks.ts` and `pointModel.ts` so the check cannot go vacuous.
2. **The four state facts, on both row schemas.** `DistrictEventStateSchema` is nested and optional, with `qualMatchesTotal` nullable for an event whose schedule TBA has not published, and exactly one cross-field refinement (`qualMatchesPlayed` at most a non-null `qualMatchesTotal`). No implication refinement between the three booleans — a real event can carry elimination matches with no published alliances, and a schema that rejects a real state blocks a live write.
3. **The baked-pmf placement decided by measured bytes.** See the section below. SIDECAR, by a wide margin, with `districtPreSimKey`, `DistrictPreSimArtifactSchema` and `DistrictArtifactSchema.bakedEvents` committed and the inline branch never written.
4. **The district byte budget.** `DISTRICT_DETAIL_MAX_BYTES_PER_TEAM`, `DISTRICT_DETAIL_MAX_BYTES`, `DISTRICT_PRESIM_MAX_BYTES`, `DistrictBudgetExceededError` and `assertWithinDistrictBudget` in `publishBudget.ts`, with a test that goes red when a constant and `docs/publish-budget.md` disagree (verified by temporarily moving `DISTRICT_DETAIL_MAX_BYTES_PER_TEAM` to 1,800 and watching it fail by name, then restoring).
5. **District liveness discovery.** `LiveWindowEntrySchema.districtKey` (nullish, non-empty) populated by a `districts` join on `(abbreviation, year)`, never a string concatenation, so a manifest cannot name a district with no row and therefore no published artifact.
6. **The one-object path to production.** `scripts/publishLiveWindows.ts` / `pnpm publish:live-windows`.

## The measured 2026pnw bytes and the placement decision

Measured against the local gitignored fixture `data/fixtures/phase10/district-2026pnw.json` (the live artifact, generation of 2026-09-14): 126 teams, 303 team-event pairs, 9 district events, 0 remaining events. Because the fixture is a **finished** season, the inline variant SYNTHESIZES the worst case by moving every played (team, event) pair back into `remainingEvents`; measuring the artifact as-is would have measured nothing. Every synthesized pmf runs over its real support from `pointModel.ts` (qual 0-22, alliance 0-16, elim 0-30, award 0-15, event total 0-83 at district tier, each times 3 at dcmp) as a discretized bell passed through `roundPmf`, so nearly every entry is a full-width five-decimal number.

| Variant | Total bytes | Bytes per team |
|---|---:|---:|
| baseline, as published today | 106,920 | 849 |
| (a) state-only | **151,351** | **1,201** |
| (b) inline baked pmfs | **717,001** | 5,690 |
| (c) sidecar (a) + 9 sidecars | **733,050** total (581,699 across the sidecars) | — |

- **Inline-to-state ratio: 4.737.**
- **Largest single sidecar: 209,043 bytes.**

**The rule** (stated in the plan before the measurement): choose INLINE if and only if `B_inline` is at most 150,000 bytes AND `B_inline / B_state` is at most 1.35; otherwise SIDECAR.

**Outcome: SIDECAR.** 717,001 is 4.8x over the byte bar and 4.737 is 3.5x over the ratio bar. Both halves fail, and not narrowly. Inlining would have put roughly 566,000 bytes of never-changing distributions on an object every viewer re-fetches on a 60 second floor while any member event is live.

### The ceilings, and the arithmetic behind each

| Constant | Value | Derivation |
|---|---:|---|
| `DISTRICT_DETAIL_MAX_BYTES_PER_TEAM` | 1,700 | variant (a)'s 1,201 bytes per team x 1.4, rounded up to the next 100 (1,681.7 -> 1,700) |
| `DISTRICT_DETAIL_MAX_BYTES` | 1,300,000 | 1,700 x 750 = 1,275,000, rounded up to the next 100,000. 750 is a STATED design margin, not a measurement: FiM is the largest district and carries roughly four times PNW's 126 teams |
| `DISTRICT_PRESIM_MAX_BYTES` | 1,300,000 | 209,043 x 4.4 x 1.4 = 1,287,705, rounded up to the next 100,000 |

The measured state-only artifact sits at 8.8% of the absolute ceiling and 70.6% of the per-team one. All three numbers are restated in `docs/publish-budget.md`, and `districtBudget.test.ts` fails when the doc and a constant disagree. District rows were deliberately NOT added to the machine-readable `json budget` block: that block is rewritten by `pnpm publish:seasons --write-budget`, which does not publish districts, so a hand-added row there would be erased by the next run.

## Publishing the live-windows manifest

**This section is 10-09's. It should not need to re-read the script.**

**The command**, exactly as `node -e "console.log(require('./package.json').scripts['publish:live-windows'])"` printed it:

```
tsx --env-file=.env scripts/publishLiveWindows.ts
```

So: `pnpm publish:live-windows --dry-run` first, then `pnpm publish:live-windows`. Flags are `--dry-run`, `--seasons <spec>` (parsed by `parseSeasonSpec`, defaulting to `DEFAULT_LIVE_WINDOWS_SEASONS` = the same `2016-2020,2022-2026` list `publish:seasons` hardcodes) and `--allow-empty`.

**What it writes:** exactly one object, `v1/manifest/live-windows.json`, with `contentType: application/json` and `cacheControl: public, max-age=60` — byte-for-byte the header pair `packages/harness/publish.ts` uses. No generation bump, no D1 seed, no KV write, no prune owed, no other key touched.

**The three refusals, each before any upload, each asserted with an injected-upload call count of 0:**

1. **Non-200 live manifest.** The run reads `https://data.sigmascout.org/v1/manifest/live-windows.json` with a browser-shaped `Origin` header and throws naming the key and the status. Tested at 404 and at 503. It never mints a generation: the one on the live manifest is the one it reuses.
2. **Schema-version disagreement.** If the live manifest's `schemaVersion` differs from the working tree's `MANIFEST_SCHEMA_VERSION`, it throws naming BOTH values (a plain field read, not a second manifest schema, because the envelope's own `z.literal` would reject without naming both). That disagreement means the deployed Worker and the working tree do not agree on the shape, and overwriting is how live folding goes down.
3. **Zero-window rebuild.** It throws naming the rebuilt count and the live manifest's own count, unless `--allow-empty` is passed, in which case it writes and says so.

**The census line, in both modes.** One line naming the mode, the key, the reused generation and the fresh `computedAt`; a second naming the rebuilt window count beside the live manifest's own count, how many windows carry a `districtKey`, how many carry an explicit null, and how many are probe windows. Observed forms:

```
DRY RUN, would write v1/manifest/live-windows.json reusing generation sentinel-gen-0001, computedAt 2026-09-25T10:53:18.905Z
  2 rebuilt window(s) against the live manifest's 5; 1 carry a districtKey, 1 carry an explicit null, 0 are probe windows
```

```
wrote v1/manifest/live-windows.json reusing generation sentinel-gen-0001, computedAt 2026-09-25T10:53:18.917Z
  3 rebuilt window(s) against the live manifest's 9; 1 carry a districtKey, 2 carry an explicit null, 0 are probe windows
```

**A rebuilt count LOWER than the live count is normal, not a symptom.** `buildLiveWindowsManifest` deliberately drops a window already closed at build time. A test pins that the run proceeds in exactly that case.

**The dry run's observed injected-upload call count is 0**, asserted as `expect(calls).toHaveLength(0)` in `scripts/publishLiveWindows.test.ts`'s first test. That is the load-bearing pin in the file: a dry run that writes is worse than no dry run, because an operator trusts it.

**The script was NOT run against R2 in this plan.** No network request was made, no secret was read, printed, copied, hashed or interpolated, and `.env` was never opened — `putObject` reads its own credentials inside `packages/harness/r2Client.ts`, and every test here injects its upload function and builds its own temp corpus instead. **10-09 Task 5 is its only caller**, and it should run the dry run, then the real write, then verify by GET with an `Origin` header that the live manifest carries `districtKey` on district-event windows.

## Handoff contracts

### 10-05 (the Worker's district pass)

- Call `applyDistrictRankings({ artifact, rankings, generation, computedAt, eventState? })` after a changed `/district/{key}/rankings` poll, and `applyDistrictEventState({ artifact, eventState, generation, computedAt })` when a category finished but no team's points moved (alliances selected, nothing earned by an unpicked team). Both return a `DistrictArtifactSchema`-parsed artifact. Never call `buildDistrictArtifact` — it needs four corpus tables the Worker does not have.
- Both refuse rather than half-apply: an empty rankings payload, a duplicated `team_key`, and an event-state key the district carries no row for all throw `DistrictMergeError`.
- Derive district liveness from `LiveWindowEntrySchema.districtKey` on the manifest the tick already reads. An ABSENT key means a pre-phase-10 manifest and must be read exactly as `null`.
- **T-10-03-03 is transferred to you.** This plan writes nothing to R2; your district writer must mirror `artifactWriter.ts`'s body INCLUDING its `ArtifactSecretLeakError` check.
- `applyDistrictRankings` drops an event key from `bakedEvents` as soon as any team reports points for it, so you do not need to manage that list yourself.

### 10-06 (`scripts/publishDistricts.ts`)

- Replace the module-local `EventPointsEntrySchema` with the promoted `DistrictRankingsEventPointsEntrySchema` from `districtRankingsMerge.ts`.
- Call `recomputeDistrictVerdicts` instead of keeping a second verdict pass. It is idempotent and owns the two-pass `maxRemainingChamp` rule, both cut lines and the `2025fsc` override.
- Emit `state` on every `eventPoints`/`remainingEvents` row, `awardProfile` per team, `awardBaseRates` once at the top level, and the baked pmfs into `districtPreSimKey({ districtKey, eventKey })` sidecars with the published keys listed in `bakedEvents`.
- **Map 10-02's `DECORATION_BUCKETS` (`none` / `one-or-two` / `three-or-more`) onto `DISTRICT_AWARD_BUCKETS` (`none` / `oneOrTwo` / `threeOrMore`) at that boundary.** The two vocabularies differ on purpose.
- `awardBaseRates` will be REJECTED unless `measuredThroughSeason < season`, rows are unique by `(bucket, rookie)`, every row's `points.o` is 0, and every `n` is positive.
- Wire `assertWithinDistrictBudget(key, bytes, ceiling)` before `putObject`, against `DISTRICT_DETAIL_MAX_BYTES` (and `DISTRICT_DETAIL_MAX_BYTES_PER_TEAM` times the team count) for the district object and `DISTRICT_PRESIM_MAX_BYTES` for each sidecar.

### 10-07 (the web tab)

- Read `state` on each row for grey versus blue. Its ABSENCE means "this producer did not observe this event", not "nothing has happened" — a pre-republish artifact carries none at all.
- **The placement is SIDECAR.** Fetch `v1/district-presim/{districtKey}/{eventKey}.json` only for an event key listed in the district artifact's `bakedEvents`; never use a 404 as control flow. Rows are roster-indexed (`t`), so build the roster map once.
- `awardBaseRates` plus a team's `awardProfile` select the row for an award cell of an event in progress. The chance of any award points is `1 - points.p[0]`; there is deliberately no stored field for it.
- Every pmf is offset-encoded: `p[i]` is the probability of exactly `o + i` points.

### 10-09 (operator gates)

See **Publishing the live-windows manifest** above. Nothing else in this plan owes an operator step.

## Deviations from Plan

### Auto-fixed and judgment calls

**1. [Rule 3 - Blocking] `districtRankingsMerge.ts` and its test were touched by Task 2 although they are not in Task 2's `<files>` list**
- **Found during:** Task 2
- **Issue:** Task 2's `<action>` explicitly requires `applyDistrictRankings` to drop an event key from `bakedEvents` on the sidecar branch, but the task's `files` field lists only the five schema/budget/doc files.
- **Fix:** made the edit where the action said to, and added the two matching tests.
- **Files modified:** `packages/harness/districtRankingsMerge.ts`, `packages/harness/districtRankingsMerge.test.ts`
- **Commit:** 4788b753

**2. [Rule 3 - Blocking] `awardProfile` carry-forward is asserted in Task 2, not Task 1**
- **Found during:** Task 1
- **Issue:** Task 1's `<behavior>` lists `awardProfile` among the fields carried forward byte-identically, but `awardProfile` does not exist on the schema until Task 2.
- **Fix:** the carry-forward is implemented generically in Task 1 (the merge spreads the existing team row first, so any field a later plan adds rides forward by default), and its assertion landed with the field itself in Task 2.
- **Files modified:** `packages/harness/districtRankingsMerge.test.ts`
- **Commit:** 4788b753

**3. [Judgment call] `dcmpStillAhead` is derived from the artifact, and the plan did not say how**
- **Found during:** Task 1
- **Issue:** `buildDistrictArtifact`'s two-pass rule needs "has this district's DCMP already happened", which it answers from event start dates. The merge has no calendar and no corpus, and the plan said only "the same two-pass rule ... including the already-attended-DCMP and already-eliminated gates".
- **Fix:** derived it from the published artifact's own numbers — a dcmp-tier remaining row, or any team whose `maxRemainingChamp` exceeds its `maxRemainingDistrict` by at least one whole dcmp event. Documented at length in the function, including why the comparison is `>=` (a merge that trims district-tier remaining events pushes the gap ABOVE one dcmp event) and why the derivation deliberately errs toward "still ahead".
- **Files modified:** `packages/harness/districtRankingsMerge.ts`
- **Commit:** 31a4c733

**4. [Judgment call] `insights.eventCount` rides forward rather than being recomputed**
- **Found during:** Task 1
- **Issue:** the plan says to rebuild `insights`' four verdict counts; it does not say what to do with `teamCount` and `eventCount`.
- **Fix:** `teamCount` is recomputed from the merged team list; `eventCount` rides forward untouched, because a district's event count has no corpus-free source and deriving one from the rows present would shrink every time a registration list did. Pinned by a test.
- **Commit:** 31a4c733

**5. [Judgment call] the `package.json` diff is two changed lines, not one**
- **Found during:** Task 4
- **Issue:** the plan's acceptance criterion asks for exactly one added line changing no existing line. Appending an entry to the end of a JSON object requires adding a trailing comma to the previous line.
- **Fix:** none needed — the previous entry's KEY and VALUE are unchanged; only its line terminator moved. `git diff --numstat` reads `2 1 package.json`. `dependencies`, `devDependencies` and `pnpm-lock.yaml` are untouched.
- **Commit:** 6e61d77c

**Total deviations:** 2 auto-fixed (both Rule 3, scope), 3 judgment calls documented. **Impact:** none on the plan's contracts. Every `must_haves` truth holds and every acceptance criterion passed.

## Authentication Gates

None. Nothing in this plan needed a credential; `.env` was never opened, read, printed, copied or interpolated.

## Verification

Plan-level, all from the repo root, never wrapped in `timeout <n> pnpm`:

| Check | Result |
|---|---|
| `npx vitest run packages/harness` | 45 files, **1,142 tests passed** |
| `npx vitest run scripts/publishLiveWindows.test.ts` | **13 tests passed**, collected and RUN (no `existsSync` guard, no skip) |
| `npx vitest run` (whole repo, root) | 262 files, **5,871 passed, 1 skipped** |
| `npx tsc --noEmit` | exit 0 |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | exit 0 |
| `npx tsc --noEmit -p apps/worker/tsconfig.json` | exit 0 |
| `grep -c "^export const MANIFEST_SCHEMA_VERSION = 1;" packages/harness/manifestSchemas.ts` | 1 |
| `grep -c "^export const PAGE_ARTIFACT_SCHEMA_VERSION = 1;" packages/harness/pageArtifacts.ts` | 1 |
| `npx vitest run packages/harness/payloadBudget.test.ts` | 12 passed, file untouched by this plan |
| `grep -c '"v1/manifest/live-windows.json"' scripts/publishLiveWindows.ts` | 1 |
| `node -e "...scripts['publish:live-windows']"` | `tsx --env-file=.env scripts/publishLiveWindows.ts` |
| doc-versus-constant drift test proved non-vacuous | moved `DISTRICT_DETAIL_MAX_BYTES_PER_TEAM` to 1,800, saw `AssertionError: DISTRICT_DETAIL_MAX_BYTES_PER_TEAM (1,800) is not stated in docs\publish-budget.md`, restored |

The known `MetricHistoryTab.test.tsx` flake did not appear; the full-repo run was green on the first attempt.

## Known Stubs

None. No placeholder values, no TODO/FIXME, and no unwired data path was left behind. The one deliberately unexercised path is `scripts/publishLiveWindows.ts`'s REAL upload, which cannot be run here (no network in an executor) and belongs to 10-09 Task 5 — it is exercised in tests through an injected upload function.

## Issues Encountered

None.

## Next Phase Readiness

Ready for 10-04. 10-05, 10-06 and 10-07 are unblocked: the contract each of them was waiting on is committed, and the handoff sections above state exactly what each must call and emit. 10-09's manifest step is now a command with a verification rather than a decision with a price tag.

## Self-Check: PASSED

- `packages/harness/districtRankingsMerge.ts` FOUND
- `packages/harness/districtRankingsMerge.test.ts` FOUND
- `packages/harness/districtBudget.test.ts` FOUND
- `scripts/publishLiveWindows.ts` FOUND
- `scripts/publishLiveWindows.test.ts` FOUND
- Commits 31a4c733, 4788b753, e038be34, 6e61d77c all present in `git log`
- Every task's `<acceptance_criteria>` re-run and passing; every plan-level `<verification>` item run and recorded in the table above
