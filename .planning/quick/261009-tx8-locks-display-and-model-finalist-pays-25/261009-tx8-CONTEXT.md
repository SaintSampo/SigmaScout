# Quick Task 261009-tx8: Locks display and model corrections - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning

<domain>
## Task Boundary

Jacob, 2026-10-09: "fix the gaps. do not leave anything undone." Four items left by quick tasks 261008-26o, 261009-2tr and 261009-kt3 where the page shows or predicts a number that is not right. Browser and core only. No Worker change, no artifact shape change, no algorithm version change, no republish (the district publisher bakes nothing until 2027: every event is in the past).

LOCK MATH MUST NOT MOVE except where B4 says so: `settledElimBounds`, the ceilings, the joint proof and the reservations read the same values as before.

</domain>

<decisions>
## Implementation Decisions

### B1. WITHDRAWN (orchestrator, 2026-10-09): TBA pays a losing finalist the base value
- B1 proposed paying a losing finalist 5 more per Finals match it won. The planner measured the corpus (every eight alliance district and DCMP tier event of 2023 to 2026): 261 district tier and 68 DCMP tier losing finalist rows with one Finals win all sit at exactly the base value (20, or 60 at a DCMP); none sits above it. The 13 rows at 25 that quick task 261009-2tr read as losing finalists are members of the WINNING alliance who played in only one of its two Finals wins. `PLAYOFF_POOL` (213, measured maximum 212) agrees.
- So the simulation, the settled cell, the Finalist outcome and the pays line already state what TBA publishes, and nothing user facing changes. The comments that state the false premise are corrected, and the measurement becomes a corpus gated test.
- The 25 / 75 placement maximum that 261009-2tr put in the lock math (`maxPlayoffPointsByPlacement`, `SettledPlayoffs.ceiling`) is KEPT: the manual's wording would allow it, and a larger ceiling is the safe side.
- The DCMP row's small stage line (the planner's reading R10) reads the team's dcmp sources in the order division then finals and prints the stage word of the first that still has an open category, or "final".

### B2. A divisioned championship's DCMP row shows the division, plus the finals once earned
- Today a team with a division row and a finals row (FIM, NE, ON, TX finalists and finals award winners) shows only its FIRST dcmp row in the Champ Locks DCMP cells, and `tierEvents` sorts the finals row first, so frc27 at 2026 FIM prints the finals row's 0, 0, 60, 30 and hides its division's 66, 48, 90, 0.
- New rule in `buildDcmpRow` (`apps/web/src/components/districts/champLedgerRows.ts`): the PRIMARY row is the team's division row (the dcmp key that is not a divisioned championship's parent, `fieldFixingDcmpKeys`); a team whose only dcmp row is the finals keeps today's behaviour. For each category, where the finals row's category is FINAL at the position its earned value is ADDED to the primary cell (a final primary cell becomes the sum; an open primary cell is shifted by it), and the subtotal and grand total follow. Where the finals category is not final at the position, the cell shows the division alone: the finals are not priced, and nothing is fabricated.
- At Now for frc27 2026: Qualification 66, Alliance selection 48, Playoffs 150, Awards 30, subtotal 294.
- `sources` keeps every dcmp row (261009-kt3 D3) and the status math is untouched.
- Methodology: one flat sentence that a championship played in divisions adds the finals points to the District Championship row once they are earned.

### B3. Retire the unreachable `placed` milestone arm
- `DistrictPlayoffMilestone`'s `{ kind: "placed" }` arm has been unreachable since 261008-26o. Remove it across `districtLedgerRows.ts`, `ledgerVerdict.ts`, `districtLedgerOutcomes.ts`, `LedgerParts.tsx`, `districtLedgerCopy.ts` and their tests. No rendered output changes.

### B4. A tied playoff match no longer stalls the bracket routing
- A tie in a playoff set is replayed under the next match number (corpus 2023 to 2026, district points events: 13 finals with a tie, one semifinal `2023ncash` sf12 `1:tie 2:red`, finals of up to four matches). `playedBracketMatchesFor` drops a row with no winner, so the decision map has a gap at the tied match number and `routePlayedBracket` stops at the gap: the set is never decided.
- Fix in `bracketDecisionsFromPlayedMatches` (`packages/core/districts/bracket.ts`): within each set, the decided rows are renumbered 1..n in match number order (a later row for the same original key still wins first). Sound: a row is a real result, and in a best of three a side with two real wins has won the set whatever was tied in between.
- This is the ONE place lock results may move: the single event sweep may GAIN locks or change `joint` reasons at the tied finals (for example `2024necmp` is divisioned; `2023mabri`, `2023marea`, `2024njall` are district events and not in the champ sweep). Gate: zero violations; report every changed sweep line; no lock may be LOST.
- Tests: the `2023ncash` semifinal and a four match final route to the real winner; a set with one decided row and a later undecided one stays open.

### Claude's Discretion
- Function names and file placement.
- Test fixture shape.

</decisions>

<specifics>
## Specific Ideas

- Values 2026: district 30 / 20 or 25 / 13 / 7; dcmp 90 / 60 or 75 / 39 / 21.
- The 261008-3il cell grammar is locked: bold "chance then outcome", small "pays <values>" from the outcome rows; no tilde on percentages; no percentage prints 100; ranges use "to".
- Tests pin the old words in `LedgerParts.test.tsx`, `districtLedgerCopy.test.ts`, `districtLedgerOutcomes.test.ts`, `DistrictLedger.test.tsx`, `ChampLocksLedger.test.tsx`, `LedgerVerdictDrawer.test.tsx`, `ledgerSimulation.test.ts`: update the pins that B1 moves and add pins for the new values.
- UI rules: `.claude/skills/sketch-findings-sigmascout/SKILL.md` (colours as tokens, class lists with text role classes as plain strings, methodology voice).
- Tests: `npx vitest run <paths>` from the repo root (never `timeout <n> pnpm`); typechecks root, web, e2e chained with `&&` and a sentinel echo; final full `npx vitest run`. Never Read, cat or echo `.env`.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/todos/pending/locks-settled-playoffs-follow-ups.md` (items 1 and 5), `.planning/todos/pending/champ-joint-lock-follow-ups.md` (items 4, 5, 7, 12)
- `packages/core/districts/bracket.ts`, `ledgerSimulation.ts`; `apps/web/src/components/districts/districtLedgerRows.ts`, `districtLedgerOutcomes.ts`, `districtLedgerCopy.ts`, `LedgerParts.tsx`, `champLedgerRows.ts`
- Quick task 261008-3il (the cell grammar), 261009-2tr CONTEXT D7 (the settled ceiling)
</canonical_refs>
