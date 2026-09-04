# Deferred items — quick task 260904-4b3

Out-of-scope discoveries and deliberately-deferred fixes found during execution.
Logged, not fixed here (scope boundary: only issues directly caused by this task's own
changes are auto-fixed; pre-existing failures in unrelated files are out of scope).

## 1. WR-06's durable fix — publish TBA's event `timezone` and format match times in it

`260902-post-phase08-ungoverned-ui/REVIEW.md`'s WR-06 flagged that `MatchTable.tsx`'s
`formatScheduledTime` renders a scheduled match time in the VIEWER's own browser
timezone with no label, so a scout reading a schedule from another timezone reads the
time as the venue's local time when it is actually theirs. This task ships the honest
interim fix: `formatScheduledTime` now appends a zone label (`timeZoneName: "short"`) to
the rendered string on both the team page's match table and `StartMatchPicker.tsx`'s
summary row (both consume the same exported formatter), so the reader can at least see
which zone the printed time is in.

**That is not the durable fix.** The durable fix is to show the time in the EVENT's own
venue timezone, which requires the artifact to actually carry one. Today it does not:

- **What TBA exposes.** TBA's `/event/{key}` endpoint publishes a `timezone` field (an
  IANA zone name, e.g. `"America/Los_Angeles"`) on every event. This is a live,
  documented field on TBA's own API — not something that needs to be derived or
  guessed.
- **Why this task cannot ship it.** Publishing that field through to the site's
  precomputed artifacts requires: (1) the ingest pipeline to read and store the field
  from TBA's event response, (2) `EventArtifactSchema`/`EventMatchSchema` (or wherever
  the field is threaded) in `packages/harness/pageArtifacts.ts` to carry it, and (3) a
  republish of the affected event/team artifacts so the field is actually present on
  live data. All three are pipeline/schema/publish changes, explicitly out of scope for
  this quick task's stated boundary ("nothing under `packages/core`, `packages/harness`,
  `packages/corpus`, `pipeline/`, `scripts/`, `apps/worker/` ... is modified. No artifact
  is republished").
- **What changes once it lands.** `formatScheduledTime` (or a sibling formatter) would
  format the epoch instant using the published venue `timezone` via
  `Intl.DateTimeFormat(..., { timeZone: event.timezone, timeZoneName: "short" })`,
  replacing the interim "viewer's own zone, labelled" behaviour this task ships with the
  correct "venue's own zone, labelled" behaviour WR-06 actually asked for.
- **Until it lands.** The site shows the reader's own timezone, honestly labelled as
  such — never the venue's, and never unlabelled.

## 2. `packages/harness/baselineFingerprint.test.ts` — 2 pre-existing failures (NOT caused by this task)

Discovered running this task's own required root-level `npx vitest run` gate.

```
packages/harness/baselineFingerprint.test.ts
  > committed baseline fingerprints > both retired-implementation fingerprints record
    OPR's own pre-rewrite id/version, not anything later
      expected '4.0.0+baseline' to be '2.0.0+baseline'
  > committed baseline fingerprints > data/baselines/ contains exactly 4 committed
    fingerprints: two retired-implementation runs, the event-scoped re-run, and the
    offseason-inclusive SC-3 re-measurement
      expected [ …(5) ] to have a length of 4 but got 5
```

**Why it is definitely pre-existing, not collateral.** This quick task (260904-4b3) never
touches `packages/harness/`, `data/baselines/`, or any OPR versioning — its own
`files_modified` list and out-of-scope declaration are explicit about this (`apps/web/`
and this task's own planning directory only). `git status --short
packages/harness/baselineFingerprint.test.ts` shows zero working-tree diff: the test file
itself is byte-identical to what other, concurrent work already committed to `main`
before this task started (`git log` traces it to task `260904-100`'s
`vpr@7.0.0+rolling-2026-09` promotion). The fifth, unexpected file in `data/baselines/`
(`sc3-rolling-origin-2026-09.json`) and the OPR version bump to `4.0.0+baseline` both
originate from a separate concurrently-running quick task
(`260904-4aa-verify-epa-matches-statbotics`), visible as untracked/modified files in
`git status` throughout this task's execution and never staged or committed by this task.

**Impact on this task's plan.** The plan's own verification section requires "`npx vitest
run` from the REPO ROOT — full suite green" as the final gate before commit. That is not
achievable without either the concurrent task finishing its own commit (updating the
fingerprint fixtures to match), or `baselineFingerprint.test.ts` being deliberately
re-measured — neither is this UI-only task's work to do.

**What "done" looks like:** the concurrent task (`260904-4aa` or its successor) either
lands a matching fingerprint-fixture update, or `baselineFingerprint.test.ts`'s own
committed expectations are deliberately re-measured against the new OPR baseline.
