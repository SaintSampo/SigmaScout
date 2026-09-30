---
phase: quick-260929-ttp
plan: 01
subsystem: web/districts
tags: [locks, rewind, milestone-picker, sketch-024]
status: complete
requires: [sketch 024 variant Q, districtTimeline, district artifact state blocks]
provides: [LocksMilestonePicker, districtMilestones model, <eventKey>:schedule alias]
affects: [District Locks tab, Champ Locks tab, districts-ledger e2e spec]
tech-stack:
  added: []
  patterns: [URL is the only selection; pure milestone model; sketch CSS ported literally under token-only colours]
key-files:
  created:
    - apps/web/src/components/districts/districtMilestones.ts
    - apps/web/src/components/districts/districtMilestones.test.ts
    - apps/web/src/components/districts/LocksMilestonePicker.tsx
    - apps/web/src/components/districts/LocksMilestonePicker.test.tsx
    - .planning/todos/pending/locks-picker-playoffs-half-stop.md
    - .planning/todos/pending/locks-cutoff-strip-chart.md
  modified:
    - apps/web/src/components/districts/districtTimeline.ts
    - apps/web/src/components/districts/districtTimeline.test.ts
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/districts/districtLedgerCopy.test.ts
    - apps/web/src/components/districts/DistrictLedger.tsx
    - apps/web/src/components/districts/DistrictLedger.test.tsx
    - apps/web/src/components/districts/ChampLocksLedger.tsx
    - apps/web/src/components/districts/ChampLocksLedger.test.tsx
    - apps/web/src/components/districts/LedgerParts.tsx
    - apps/web/src/styles/theme.css
    - apps/web/e2e/districts-ledger.spec.ts
decisions:
  - "Locks rewind is sketch 024 Q's event then milestone picker on both tabs, with eight stops (no Playoffs half stop) and no cutoff strip; both logged as todos (Jacob, 2026-09-29)"
  - "Schedule is stored as <eventKey>:schedule and resolves to the position just before the event's first match step; exact ids win first"
  - "Milestone happened reads the state blocks, not the timeline; quartile ids are qualification match numbers so they build with no artifact loaded"
  - "The picker is capped at 814px, sketch Q's content width"
  - "The picker prints the ledger's short event name"
metrics:
  completed: 2026-09-29
  tasks: 3
  commits: 3
---

# Quick 260929-ttp: Locks rewind becomes sketch 024 Q's event then milestone picker

The District Locks and Champ Locks tabs lose the match level Rewind slider. In its place is sketch 024
variant Q's picker: a week grouped native event menu, Season start and Live pills, an eight stop
milestone stepper, and previous and next arrows that walk every happened milestone in timeline order,
naming the next one. Every choice writes `?at=` with replace history and no scroll reset.

## What changed

- **Pure model (`districtMilestones.ts`).** Eight milestones per event; "happened" from each event's
  own state block; quartile stops are qualification match number `max(1, round(total x f))`.
  Selection, done, fill, the walk, focus target and default focus live here, unit tested.
- **Timeline.** `resolveDistrictTimelinePosition` resolves the `<eventKey>:schedule` alias after an
  exact id match. Old shared `at` links still resolve.
- **`LocksMilestonePicker.tsx`**, one component for both tabs. The URL is the only selection; the
  only local state is which event the menu shows.
- **CSS.** Sketch Q's CSS ported rule by rule into `theme.css`, each rule citing the sketch selector,
  colours through tokens only. Geometry changes only for eight columns and the 814px cap.
- **Removed.** The slider, tick rail, rail helpers, jump chips (`DistrictTimeline.chips`), their copy,
  CSS and tests, and the 160ms drag debounce (every control is now a discrete click).
- **e2e spec** updated (live only, run after deploy).

## Commits

- 915c9b41 feat(260929-ttp): sketch 024 Q milestone picker on the DCMP Locks tab
- 53e97103 refactor(260929-ttp): Champ Locks on the milestone picker; remove the rewind slider
- 26d1514e test(260929-ttp): picker e2e, todos, fidelity audit

## Verification

- `npx vitest run apps/web` from the repo root: 131 files, 2484 tests passed, 0 failed (executor).
- `npx tsc --noEmit -p apps/web` and `-p apps/web/tsconfig.e2e.json`: clean (executor).
- **Orchestrator live check** (vite dev server, live data from data.sigmascout.org, Playwright,
  `apps/web/reports/ttp-compare.mjs`): sketch Q and the real `/districts?year=2026&district=2026pnw`
  picker screenshotted at 1440 and 390, and computed styles diffed on 21 element pairs. Remaining diffs
  are only content driven widths, the page shell's 24px vs 16px gutter, the `--district-ledger-faint`
  token, zero width border-style from preflight, and the live dot's pulse phase. Champ Locks renders the
  same component; the previous arrow walks milestone by milestone, `at` and the pressed stop follow,
  "This is live" shows at the end, no console errors on either tab.

## Differences from sketch Q

- Sanctioned: eight stops (no Playoffs half), no cutoff strip chart.
- Sketch bug not copied: the sketch's `.stp-now { display: flex }` overrode `hidden` and drew a stray
  "now" marker on finished events.
- Column pitch at 1440 is 101.75px (8 columns in the same 814px) against the sketch's 90.44px.
- At 390 both pills wrap onto row two together (the route's gutter is 24px, the sketch's 16px).
- Long non template names (the DCMP) print in full and widen the native select, capped at 100%.

## Deferred Items

- Comments still saying "slider" or "rail" in champLedgerChances.ts, districtLedgerChances.ts,
  champLedgerRows.ts, districtLedgerRows.ts, districtLedgerStatus.ts, useDistrictLedgerData.ts,
  useDistrictSimulationRun.ts, ChampLocksLedger.tsx (wording only).
- Run the live e2e spec after deploy.

## Known Stubs

None.
