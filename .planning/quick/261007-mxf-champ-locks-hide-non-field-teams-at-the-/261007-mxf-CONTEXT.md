# Quick Task 261007-mxf: Champ Locks hide rule and Locked + In range DCMP bake - Context

**Gathered:** 2026-10-07
**Status:** Ready for planning

<domain>
## Task Boundary

Two changes to the Champ Locks tab (`apps/web/src/components/districts/ChampLocksLedger.tsx` and its pure modules), Jacob 2026-10-07:

1. When the DCMP is the selected event, do not display a team that is not at the DCMP and not eligible for an award.
2. At any district event position (before the DCMP starts), simulate the DCMP as if the field is made up of the Locked and In range teams. Teams outside that field read "out of range" where the DCMP row used to read "not yet priced".

</domain>

<decisions>
## Implementation Decisions

### Hide rule (change 1)
- A team registered at the DCMP for judging only already has a dcmp-tier row on the artifact (`tierEvents(team, "dcmp")` is non-empty), so `champFieldMembership` reads it as `"in"`. The hide rule therefore drops exactly the teams whose membership is `"out"`: not registered at the DCMP at all.
- Positions that count as "the DCMP is the selected event": every DCMP milestone on the rail (`<dcmpKey>:schedule` through its Awards stop, see `districtMilestones.ts`), AND the Now position once the DCMP has started (`startedDcmpEventKeys` non-empty at now).
- Hidden teams are removed from `visibleTeams`, never from `rows.teams`: the champ run, the predicted cutoff, the disclosed gaps and the status counts still see them. Only the table omits them.
- The status filter chips and the team-number search compose with the hide rule as they do today.

### The simulated field (change 2)
- Where the DCMP has NOT started at the position, the DCMP is baked in the Web Worker over generated schedules, the same `generated` mode `asOfRewind.ts` `planAsOfEvent` already uses for an unstarted district event at a rewound stop, with the as-of pricer at the stop.
- The roster is the district tier's verdict at that position: `prequalified`, `locked` and `inRange` teams from `computeDistrictLedgerStatuses` (the `districtStatuses` memo in the tab), applied after the range state settles so In range is the shown chip, not a provisional one. The field size is that roster's length, even where it exceeds the district's real capacity. No cap.
- The bake replaces the walk-forward field-rank estimate (`hypotheticalDcmpEstimates`) as the DCMP price before the field is a fact, at rewound stops. In-field teams get four real category cells and a real Subtotal from the bake, exactly the `fieldIsFact && row !== undefined` arm of `buildDcmpRow`, so the DCMP win chance comes from the baked Playoffs cell as it does once the real field is a fact.
- The "to be there" chance still weights the grand total exactly once (sketch 022 variant A): 1 for Locked and Prequalified, the district run's marginal for In range. Unchanged.
- `skipEventKeys` currently leaves the unstarted DCMP out of the rewound run; that exclusion is what this change replaces with a planned generated DCMP event whose roster is the verdict set rather than `districtRegistrations`.

### Scope of the bake: rewound stops only (this task)
- The Now position keeps today's behaviour: the field-rank estimate until the DCMP field is a fact. Routing Now through the as-of path would change how live district events are priced, which stays untouched. A DCMP-only as-of run at Now is a separate follow-up; record it as a todo, do not build it here.

### What teams outside the simulated field read
- `lockedOut` teams: the existing em dash kind (`notInField`, "not in the field" copy). They are definitively out.
- `outOfRange` teams: a NEW cell kind whose copy is "out of range", in all four DCMP category cells and the DCMP Subtotal. Add the constant beside `CHAMP_LEDGER_NOT_YET_PRICED_CELL` in `districtLedgerCopy.ts`, with the same three-way distinction documented there (em dash = not in the field, "not available" = attempted and refused, "out of range" = outside the simulated field).
- Both groups' grand totals are district only, labelled with the existing `CHAMP_LEDGER_DISTRICT_ONLY_LINE`, and their DCMP Source line should say why in one short phrase (follow the existing `CHAMP_LEDGER_NOT_IN_FIELD_LINE` pattern).
- `capacityUnknown` teams, and in-field teams whose bake is unavailable at the stop: the shipped `unavailable` ("not available") reading, never a silent zero and never "out of range".
- "not yet priced" survives only where the estimate still applies: the Now position before the field is a fact, and a stop whose as-of state has not loaded yet (pending).

### Claude's Discretion
- Where the verdict-set roster is assembled (tab memo vs a pure helper in `champLedgerChances.ts` or `champLedgerRows.ts`) and how it is threaded into `useAsOfRewind`'s candidates / `planAsOfEvent` so the DCMP plan reads the verdict roster instead of registrations.
- Sequencing: the district run must settle (verdicts known) before the DCMP bake is requested, and the champ run after the bake. Keep the existing pending arms honest: cells read pending, not zero, while any upstream run is in flight.
- Test placement: pure-module tests beside `champLedgerRows.test.ts` / `districtLedgerCopy.test.ts` / `asOfRewind` tests; one component test in `ChampLocksLedger.test.tsx` for the hide rule and for the "out of range" cells.
- Methodology copy in `districtLedgerContent.ts` (line ~163 names "not yet priced" and the field-rank estimate) must be updated to describe the rewound Locked + In range bake; flat third person, no dashes (feedback_methodology_copy_voice).

</decisions>

<specifics>
## Specific Ideas

- Run bounds: `MAX_DISTRICT_SIMULATION_EVENTS` is 64; a DCMP roster of 60 to 90 teams must stay under the Worker's per-event baseline cap (`MAX_DISTRICT_SIMULATION_BASELINES`, check it) and `MAX_SIMULATION_MATCHES`. The 261005-5g0 summary measured early rewound stops at 3.7 to 8.0 s to a settled Champ table while baking most of 27 district events; one more generated event of DCMP size is acceptable, a second full rerun of every event is not.
- The bake's `eventType` for a dcmp-tier generated event comes from `fallbackEventType("dcmp")` when no event artifact exists at the stop; `asOfDefaultMatchesPerTeam(eventType)` sets matches per team.
- Do not touch `hypotheticalDcmp.ts`, its generated tables, or `scripts/measureChampCutoff.ts`: the estimate stays for the Now position and the champ cutoff tuning still reads it.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/quick/261005-5g0-*/261005-5g0-SUMMARY.md` (as-of rewind, generated mode, measured stop costs)
- `.planning/quick/260927-6bf-*/` (the field-rank estimate this bake supersedes at rewound stops)
- `.planning/quick/260925-xab-*/` (sketch 022 ledger, the three empty-cell readings)
- Project memory: never use field-averaged presim as the method; browser bake parity with the Node bake is exact (260929-mkn)

</canonical_refs>
