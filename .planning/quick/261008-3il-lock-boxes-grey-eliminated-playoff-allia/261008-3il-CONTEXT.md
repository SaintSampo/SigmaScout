# Quick Task 261008-3il: Lock boxes, the unpicked Playoffs box and one grammar for every open cell - Context

**Gathered:** 2026-10-08
**Status:** Ready for planning

<domain>
## Task Boundary

Jacob, 2026-10-08: "I want to improve the lock blue boxes. 1) for playoffs, as teams are eliminated in the playoff rounds, their boxes should turn grey. 2) the text in the playoffs and awards boxes are super unclear. I want a holistic review of the text in those boxes. propose a better system."

**Item 1 is already live and verified, nothing to build for decided alliances.** Quick task 261008-26o (commits 6610fffa to 84b664ef, deployed before 02:35 on 2026-10-08) greys a team's Playoffs cell as soon as its alliance's bracket placement is decided. Verified on sigmascout.org at FNC 2026 Wake County #1 (`2026ncwak`) with a Playwright probe counting `[data-cell-id="2026ncwak:elim"]` by `data-cell`: Round 2 6 grey of 29, Round 3 12, Round 5 18, Finals 29. The Champ tab DCMP row (`2026nccmp`): Round 3 15 grey of 52, Round 5 21.

**What stays blue through the whole playoffs is the teams no alliance picked.** They read `top 4 ~0%` with no second line (5 of 29 at `2026ncwak`, 23 of 52 at the DCMP). They are correctly NOT grey: a backup robot is called from that pool. Measured over `data/local-publish/districts` (2016 to 2026, rows whose event playoffs are done): 2 to 5 percent of unpicked teams were paid playoff points (2026: 42 of 1,202 district rows, 3.5 percent; 24 of 522 DCMP rows, 4.6 percent). So the fix for item 1 is wording, not greying.

Item 2 is a rewrite of what every OPEN (blue) cell prints, on both Locks tabs (shared renderer `openCellLines` in `apps/web/src/components/districts/LedgerParts.tsx`), plus the legend explainer, the methodology paragraphs that describe the cells, and the tests that pin the words.

</domain>

<decisions>
## Implementation Decisions

### The unpicked team's Playoffs cell (Jacob chose: blue, "not picked")
- Stays an OPEN (blue) cell, lock math untouched (the whole Playoffs ceiling stays on it; the dropped unpicked rule from 261008-26o stays dropped).
- Bold line `not picked`, small line `backup call only`.
- Condition: the event's alliance selection is settled at the position AND the team is on no alliance. The row builder already holds the selection route view for the alliance cell in the same loop (`selectionRoutesByTeam` + `rankingFixed`, `districtLedgerRows.ts` ~1352-1370); a team whose `routes.notSelectedDraws === denominator` with `rankingFixed` true is not picked. Where the run reports no routes (a baked event), fall through to the shipped chance form. Do not read the artifact's `eventPoints.alliance === 0` at Now, it is not posted mid event.
- Applies to the district tier rows and the Champ tab's DCMP row alike (same renderer; the DCMP row's cells come through `champLedgerRows.ts`, check that the route view or an equivalent flag reaches it, otherwise carry a boolean on the open cell).

### One grammar for every open cell (Jacob chose: chance, then what it pays)
Bold line: the chance first, then the outcome in one or two words. Small line: the points that outcome PAYS, read from the pay tables (exact, no tilde), never a conditional median. The agreed sample set, 2026 district tier values:

| Cell state | Bold | Small |
|---|---|---|
| Playoffs, bracket not started (alliance alive) | `66% top 4` | `pays 7 to 30` |
| Playoffs, top 4 secured (`topFour`) | `85% final` | `pays 20 or 30` |
| Playoffs, in the final (`finals`) | `59% win` | `pays 30` |
| Playoffs, not picked | `not picked` | `backup call only` |
| Awards | `56% award` | `pays 5 or 10` |
| Alliance selection, likelier route | `60% captain` / `60% picked` | `pays 9 to 16` (captain or first pick), `pays 1 to 8` (second pick) |
| Alliance selection, ranking settled | `12` | `first pick, alliance 3` (unchanged) |
| Qualification, event total, grand total (median form) | `~22` | `likely 15 to 22` (unchanged apart from "to", see below) |

- Pay values come from the existing point sources, never literals: `playoffPoints(season, tier, placement)` (2026 district 30/20/13/7, dcmp 90/60/39/21); award points from the award support (judged 5, Impact 10 at district tier, times the dcmp weight); selection ranges from the route observations the outcome builders already carry (`DistrictSelectionOutcomeRow.minPoints/maxPoints`, `districtLedgerOutcomes.ts`). Prefer deriving the small line from the same outcome rows the drawer lists, so cell and drawer cannot disagree.
- Range words: `pays 7 to 30` with "to" (the drawer's own "9 to 16" rule, never a dash); two discrete values read `pays 20 or 30`; one value `pays 30`.
- Milestone words: `top 4`, `final`, `win`. The route words `captain` and `picked` stay. `award` stays.
- The `playoffMilestone.kind === "placed"` arm is unreachable since 261008-26o; retire it if touching it is cheap (todo item 1 of `.planning/todos/pending/locks-settled-playoffs-follow-ups.md`), otherwise leave it.
- Median form cells: unchanged except that the likely range reads `likely 15 to 22` in place of the en dash, for one range grammar across the tab. If that ripples into too many pins (the cutoff stat line uses the same helper), leave the en dash and say so in the SUMMARY.

### The tilde and the 99 percent cap (Jacob chose: drop the tilde on percentages)
- No tilde on any percentage anywhere on the two Locks tabs: cells, the drawer's outcome rows (`districtLedgerOutcomeChance`), the DCMP row's field chance line (`champLedgerFieldChanceLine`). The tilde stays on simulated POINT figures (`~22`, the medians).
- **A team is never given a 100 percent verdict.** Any chance rendered with a percent sign clamps its rounded value to 99 (`DISTRICT_LEDGER_CHANCE_CEILING_PERCENT` already exists and `districtLedgerChanceLine` already applies it; apply the same clamp to the cell percentages and the drawer percentages). Jacob: "displaying 100 out of 100 runs or 0 out of 100 runs is fine though", so the drawer's run-count headline sentences stay as counts. A chance that rounds to 0 percent is unchanged.
- Legend explainer: replace the tilde clause so it reads that `~` marks this site's predicted points and that a percentage is the share of 1,000 runs. Keep it one line, flat voice.

### Methodology
- `apps/web/src/components/methodology/districtLedgerContent.ts`: rewrite the sentence "An open cell shows either a median with a likely range, or a chance with the typical amount when it happens." and the Playoffs cell paragraph to describe the new grammar (chance then outcome, the points that outcome pays, the not picked case, no percentage prints 100). Voice: flat third person, no dash characters, no how or why sentences (memory `feedback_methodology_copy_voice`).

### Claude's Discretion
- Whether the small "pays" line is built by a new helper in `districtLedgerCopy.ts` fed with the outcome rows, or by extending `openCellLines`. One tested place.
- How the unpicked flag reaches the DCMP row.
- Test updates: `districtLedgerCopy.test.ts`, `LedgerParts.test.tsx`, `DistrictLedger.test.tsx`, `ChampLocksLedger.test.tsx`, `LedgerVerdictDrawer.test.tsx`, `districtLedgerContent.test.ts` pin today's words (21 matches of the old phrases across the district tests). Update the pins to the new grammar and add one pin for the 99 cap and one for the not picked cell. The e2e specs do not pin the cell words.

</decisions>

<specifics>
## Specific Ideas

- Today's forms, for reference: median `~22` / `likely 15–22`; chance `~56% award` / `~5 if won`; playoffs `top 4 ~66%` / `~13 if top 4`, `finalist ~85%` / `~30 if finalist`, `winner ~59%` / `~30 if winner`; routes `captain ~60%` / `~12 if in`; settled `~12` / `first pick, alliance 3`; degenerate `top 4 ~0%` (no small line) for unpicked teams.
- `openCellLines` is the only renderer of these lines, used by `LedgerCell` and `GrandTotalContent`, shared by both tabs.
- Live probe script, reusable after deploy: `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad/probe-locks.mjs` (run from `apps/web`, args like `@2026ncwak:round:3` and `champ-locks@2026nccmp:round:5`).
- Browser only: no artifact shape, algorithm version or Worker change.

</specifics>

<canonical_refs>
## Canonical References

- Quick task 261008-26o (settled Playoffs cells) and its todo `.planning/todos/pending/locks-settled-playoffs-follow-ups.md`
- Sketch 021 README "What a blue cell prints (round four)" (the grammar this task replaces) and sketch 025 (the drawer the cell opens)
- `packages/core/districts/bracket.ts` (`playoffPoints`, `allianceBracketMilestones`), `apps/web/src/components/districts/districtLedgerOutcomes.ts` (outcome rows with point ranges)
</canonical_refs>
