---
phase: quick-260906-7eu
plan: 01
subsystem: ingest-pipeline, corpus, page-artifacts, web-ui
tags: [tba-videos, youtube-embed, match-table, corpus-migration]
dependency-graph:
  requires: []
  provides:
    - CorpusMatch.videoKey
    - EventMatchSchema.video / TeamSeasonMatchSchema.video
    - apps/web/src/lib/matchVideo.ts (parseMatchVideoKey, youTubeEmbedUrl)
    - apps/web/src/components/MatchVideoCell.tsx
  affects:
    - packages/ingest/schemas.ts
    - packages/ingest/normalize.ts
    - packages/corpus/schema.sql
    - packages/corpus/db.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/publish.ts
    - apps/web/src/components/event/EventMatchTable.tsx
    - apps/web/src/components/team/MatchTable.tsx
tech-stack:
  added: []
  patterns:
    - "Additive ALTER TABLE ADD COLUMN migration (EVENT_LOCATION_COLUMNS precedent) for matches.video_key"
    - "Conditional-spread optional artifact field (never assigned undefined directly)"
    - "Radix Dialog structural mount-on-open for zero-cost-until-activated embeds"
key-files:
  created:
    - apps/web/src/lib/matchVideo.ts
    - apps/web/src/lib/matchVideo.test.ts
    - apps/web/src/components/MatchVideoCell.tsx
    - apps/web/src/components/MatchVideoCell.test.tsx
  modified:
    - packages/ingest/schemas.ts
    - packages/ingest/normalize.ts
    - packages/ingest/normalize.test.ts
    - packages/corpus/schema.sql
    - packages/corpus/db.ts
    - packages/corpus/db.test.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/publish.ts
    - packages/harness/publish.test.ts
    - apps/web/src/components/event/eventMatchAxis.ts
    - apps/web/src/components/event/EventMatchTable.tsx
    - apps/web/src/components/event/EventMatchTable.test.tsx
    - apps/web/src/components/team/MatchTable.tsx
    - apps/web/src/components/team/MatchTable.test.tsx
    - apps/web/src/styles/theme.css
    - packages/corpus/integrity.test.ts
    - scripts/deleteRetiredAlgorithmObjects.test.ts
    - packages/harness/cli.season-carry.test.ts
    - packages/harness/stateSnapshot.test.ts
    - packages/harness/manifests.test.ts
    - packages/harness/replay.season.test.ts
    - packages/harness/selectionProvenance.test.ts
decisions:
  - "CorpusMatch.videoKey is required (string | null), not optional - every existing Partial<CorpusMatch> test-fixture helper updated with videoKey: null rather than loosening the type, so a caller can never silently omit it"
  - "matches.video_key takes the additive ALTER TABLE ADD COLUMN treatment (EVENT_LOCATION_COLUMNS pattern), not a rebuild guard - it is a new source fact, so an existing row NULL is already correct"
  - "video is conditionally spread onto EventMatchSchema played matches[] rows and TeamSeasonMatchSchema rows, never onto EventUpcomingMatchSchema - an unplayed match has no video"
  - "videoByMatchKey wired into both the seasons publish loop AND the single-event (--event <key>) publish path, extending beyond the plan literal seasons-loop-only instruction for parity between the two publish modes"
  - "parseMatchVideoKey returning undefined is both the correctness AND security boundary (T-7eu-01) - an unparseable or attack-payload string never reaches the iframe src"
metrics:
  duration: ~55min
  completed: 2026-09-06
status: complete
actuals:
  tokens: 68000
  tasks: 3
  commits: 4
---

# Phase quick-260906-7eu Plan 01: Add TBA match video links (ingest to published artifact to in-site player) Summary

Ingests TBA per-match `videos[]` end to end (Zod boundary, normalize, corpus
column, publish artifacts) and surfaces it as a Video column with an embedded,
lazily-mounted in-site YouTube player in both the event page and team page
match tables.

## What shipped

**Task 1 - data path (TBA JSON to published artifact).**
- `packages/ingest/schemas.ts`: `tbaMatchSchema.videos` - `.nullish()` array of `{ type, key }`, never required.
- `packages/ingest/normalize.ts`: `CorpusMatch.videoKey`, populated by `extractVideoKey` - the first `type: "youtube"` entry key, verbatim (including any timestamp suffix), `null` otherwise.
- `packages/corpus/schema.sql` / `db.ts`: `matches.video_key TEXT`, added via an additive `ALTER TABLE ADD COLUMN` migration (`MATCH_VIDEO_COLUMNS` / `hasMatchVideoColumn`, mirroring the `EVENT_LOCATION_COLUMNS` pattern exactly) - a corpus predating this column gains it in place on the next `openCorpus`, with every existing row other columns and row count unchanged. `upsertMatch` writes and updates the column.
- `packages/harness/pageArtifacts.ts`: `video: z.string().min(1).optional()` added to `EventMatchSchema` and `TeamSeasonMatchSchema`, deliberately NOT to `EventUpcomingMatchSchema`.
- `packages/harness/publish.ts`: new `selectMatchVideoKeys(db, season, options)` (mirrors `selectScheduledMatchTimes` shape and scoping exactly); a `videoByMatchKey` map is read once per season and passed into both `buildEventArtifact` (played `matches` row builder only, conditional spread) and `buildTeamSeasonArtifact` (row builder, conditional spread). Also wired into the single-event `--event <key>` publish path for parity.

**Task 2 - parser and shared player (TDD).**
- `apps/web/src/lib/matchVideo.ts`: `parseMatchVideoKey` (bare 11-char id, `?t=`/`&t=` seconds or `NhNmNs` timestamp suffix, full watch / `youtu.be` / embed URL forms, undefined for anything unparseable including an oversized attack-payload string) and `youTubeEmbedUrl` (privacy-mode `youtube-nocookie.com` origin, autoplay on, `start` param only when a start time was parsed).
- `apps/web/src/components/MatchVideoCell.tsx`: renders nothing when the key is absent or unparseable; otherwise a single button (Dialog trigger) with an inline play-triangle SVG, opening a `DialogContent` player. `DialogContent` mounts only while open - Radix structural laziness, not a `loading` attribute - which is what keeps a many-row table at zero iframes until activation.
- `apps/web/src/styles/theme.css`: `.match-video-trigger` / `.match-video-dialog` / `.match-video-frame` - muted ink at rest, accent on hover and focus-visible, focus ring from the existing `--color-ring` token, 16:9 aspect-ratio frame. No colour literal.
- TDD gate sequence: RED commit (`a8e15d7e`, both test files fail to resolve their not-yet-written implementation modules) then GREEN commit (`07827515`, both implementations land, 23/23 tests pass).

**Task 3 - wire the Video column into both match tables.**
- `apps/web/src/components/event/eventMatchAxis.ts`: `EventMatchRow.video`, copied only inside the `toRow` `played` branch (the upcoming schema publishes no such field).
- `apps/web/src/components/event/EventMatchTable.tsx`: `EVENT_MATCH_TABLE_COLUMN_COUNT` raised 6 to 7, `"Video"` header appended, `MatchVideoCell` rendered last (after Call).
- `apps/web/src/components/team/MatchTable.tsx`: same `"Video"` header and `MatchVideoCell` cell appended after Call - `TeamSeasonMatch` already carries `video` via the schema widening, no local type change needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking type error] `CorpusMatch.videoKey` widening broke 9 existing test-fixture files**
- **Found during:** Task 1, after adding the required `videoKey: string | null` field to `CorpusMatch`.
- **Issue:** Nine files build `CorpusMatch` literals through the established `Partial<CorpusMatch>` override helper pattern; none of their base objects supplied `videoKey`, so `npx tsc --noEmit` failed with a missing-property error on each.
- **Fix:** Added `videoKey: null` to each helper base object (never widened the field to optional, which would have let a caller forget it silently).
- **Files modified:** `packages/corpus/integrity.test.ts`, `scripts/deleteRetiredAlgorithmObjects.test.ts`, `packages/harness/cli.season-carry.test.ts`, `packages/harness/stateSnapshot.test.ts`, `packages/harness/manifests.test.ts`, `packages/harness/replay.season.test.ts`, `packages/harness/selectionProvenance.test.ts`, `packages/harness/publish.test.ts` (two helpers).
- **Commit:** `e5aa9c8e`

**2. [Rule 1 - bug, RED-commit test defect] `toHaveAccessibleName` is not available in this workspace**
- **Found during:** Task 2 GREEN run.
- **Issue:** `MatchVideoCell.test.tsx` RED commit used the jest-dom matcher `toHaveAccessibleName`, but this workspace deliberately carries no jest-dom dependency (per the note in `StateViews.test.tsx`).
- **Fix:** Replaced with `screen.getByRole(role, { name: /.../ })` queries, which assert the identical accessible-name contract via Testing Library own accessible-name computation, with no new dependency.
- **Files modified:** `apps/web/src/components/MatchVideoCell.test.tsx`
- **Commit:** `07827515`

### Extension beyond the plan literal text

`videoByMatchKey` was also wired into the `publish.ts` single-event (`--event <key>`) publish path, not only the seasons loop the plan action text named - the same map, read the same way, at negligible extra cost, so a subset publish of one event also gets videos rather than silently omitting them until a full-season republish.

## Known Stubs

None. Every field added is either populated from real corpus data or conditionally absent by design (no unplayed-match videos, no hardcoded empty defaults).

## Threat Flags

None beyond the plan own threat model, which this implementation follows exactly: `parseMatchVideoKey` allowlists the YouTube id charset and a length bound before any value reaches an iframe `src` (T-7eu-01); the embed carries an explicit `allow` list and `strict-origin-when-cross-origin` referrer policy (T-7eu-02); `youtube-nocookie.com` plus mount-on-open only (T-7eu-03); the zero-iframe-before-interaction property is asserted by an 80-row test in both table test files, not merely assumed (T-7eu-04); the corpus migration is additive-only, no table drop, no row delete (T-7eu-05).

## Orchestrator verification (independent of the executor own claims)

Re-run from the repo root after the executor returned, on the shared checkout:

- `npx vitest run` (full suite, repo root) - **203 files, 3713 passed, 4 skipped**. One earlier run of the same suite showed a single failure in `packages/harness/replay.season.test.ts` that did not reproduce on two subsequent runs; a concurrent session was committing to `packages/core/algorithms/sigma1/` during that window, which is the likely cause. Not attributable to this task, and green on re-run.
- `npx vitest run` over the 7 directly-touched test files - 328 passed.
- `npx tsc --noEmit` (root) - clean.
- `npx tsc --noEmit -p apps/web/tsconfig.json` - clean.
- All 4 commit hashes confirmed in `git log`; working tree clean apart from untracked planning artifacts.

## Deferred - network required, NOT yet done

The executor sandbox denies all network Bash, so these remain open. **Until steps 2 and 3 run, the Video column ships but is empty on every row** - no published artifact carries a `video` field yet.

1. **Confirm the live TBA shape** - probe a recent event `/event/{key}/matches` and confirm `videos` really is `{ type, key }[]`, and whether a real `youtube` key carries a timestamp suffix.
2. **Backfill the corpus** - the migration leaves existing rows `video_key` NULL until a refetch runs. Open question: the ingest path uses TBA ETags, so an unchanged event may return 304 and skip - a forced refetch may be required to populate videos for already-ingested seasons.
3. **Republish** - `pnpm publish:seasons`, then hand-transcribe its printed size summary into `docs/publish-budget.md` (the script does not write that file itself).
4. **`pnpm verify:subset`** after the republish, to confirm published artifacts parse against the widened schemas.
