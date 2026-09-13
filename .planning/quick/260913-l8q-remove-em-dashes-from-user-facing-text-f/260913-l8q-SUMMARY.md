---
quick_id: 260913-l8q
status: complete
date: 2026-09-13
commits:
  - 6bc36f66
  - b186f81b
  - df7bfbcd
shipped: false
---

# Quick Task 260913-l8q: em dashes out of sentences, Locks cut line, Beta tag

Committed locally only. Jacob chose "Commit only": no R2 district republish and no push. Until
`pnpm publish:districts` runs, the live Locks tab still shows the old cut lines, and until a push,
the sentence fixes and Beta tag are not deployed.

## Task 1: em dashes out of user-facing sentences (6bc36f66)

Scope (Jacob's decision): sentences only. The lone "—" placeholders that mean "nothing here" stay
(Locks tab unknown verdict, empty awards and event-points cells, null cut line, and both match
tables' Call-column glyph). Code comments and test names are not user-facing.

Found by a TypeScript-AST scan of every string literal, template literal and JSX text node, so
comments were excluded by construction. Changed:

- `RpCalibrationSection.tsx`: "in the corpus, including offseason events"
- `DistrictLocksTab.tsx`: lock explanation ("has not been eliminated: declines, ..."), and the
  schedule chip is now "Name: Played" (parentheses would stack with the chip's own "(N max)")
- `EventMatchTable.tsx`, `MatchTable.tsx`: aria-label "Not scored (no prior data)"
- `StartMatchPicker.tsx`: "Before the schedule is released: how the field ..."
- `acknowledgmentsContent.ts`: three prose strings (and the doc comment quoting one of them)
- `methodologyCardData.ts`: "built on: The Blue Alliance, Statbotics, and more."
- `event.$eventKey.tsx`: unreachable Simulation-tab title also named the retired VPR, now
  "Simulation is only available on SPR. Switch the algorithm selector to SPR."
- `packages/core/districts/qualification.ts`: "special allocation, not modeled" (2025fsc
  champ verdict cell), plus the four tests and one doc comment that quote it

A re-scan of HEAD after the concurrent 260913-jkp commits landed found only the kept placeholders.

## Task 2: Locks cut line matches the lock verdicts (b186f81b)

Root cause: `cutLinePointsFor` in `scripts/publishDistricts.ts` read the point total at raw
rank `slots` in the full district ranking. The verdicts (`computeLocksWithQualifiers`) remove
award-qualified and prequalified teams from the pool and subtract ranked award qualifiers from
the slot count. Live 2026fnc proof: 15 champ slots, 8 award qualifiers, so 7 points slots. The
7th pool team is 8429 at 231 and GearCats (6500) is next at 216, marked eliminated, while the
published cut line was rank 15's 172.

Fix: a private `qualifierPool` helper in `packages/core/districts/locks.ts` now feeds both
`computeLocksWithQualifiers` and a new exported `cutLinePointsWithQualifiers`, so the two cannot
drift. Both tiers in `buildDistrictArtifact` pass the same hoisted qualifier sets to the verdict
call and the cut-line call. `cutLinePointsFor` is deleted. Written test-first, including an
NC-2026-shaped regression and a 200-trial seeded property test: no team above the line is
eliminated, and no team below it is locked.

- Local corpus, all 109 district-years (2016-2020, 2022-2026): zero property violations;
  2026fnc composes to champ 231 and DCMP 76 (was 172 and 75).
- `publishDistricts.ts --dry-run` over every season ran clean with no network.
- Census against the live artifacts' own verdicts: 101 of 109 district-years get a corrected cut
  line. Most move up. Two move down slightly (2023fim champ 151 to 150, 2023fit 178 to 176)
  because prequalified teams leave the pool without consuming a slot. The largest jumps are
  2022fin champ 216 to 311 and 2026fsc champ 199 to 285, where award qualifiers consume many of
  few slots.

## Task 3: grey Beta tag after the wordmark (df7bfbcd)

The tag is a sibling `span` outside the home `Link` (`text-role-label`, `--ribbon-ink-muted`,
baseline-aligned), so the link's accessible text stays "ΣigmaScout". Written test-first with 2 new
Ribbon tests.

Visual check (Playwright on a local dev server): desktop at 1280px renders the tag grey at 12px
next to the 28px wordmark, with no horizontal overflow. On phones the tag costs about 34px on the
first ribbon row, which squeezes the algorithm dropdown: at 360/375/390/393px it shrinks to
27/42/57/60px and the "SPR" label disappears. At 430px it is 97px and the label shows. Jacob chose
to keep it as is.

## Verification

- Both typechecks clean (root and `apps/web/tsconfig.json`).
- Executor's plan-level run: 78 files, 1617 passed, 1 failed. Orchestrator re-run of
  `event.$eventKey.test.tsx`, ribbon, `packages/core/districts` and `publishDistricts.test.ts`:
  181 passed, 1 failed.
- The one failure is foreign: `event.$eventKey.test.tsx`'s Insights skeleton header expectation,
  broken by concurrent quick task 260913-jkp's "Total ± Sigma" split-pill commits (e3110e9d
  and its neighbours). No file this task touched is involved.

## Owed

- `pnpm publish:districts` (network, main context) before the live Locks tab shows the corrected
  cut lines. Then verify https://data.sigmascout.org/v1/district/2026fnc.json reads
  `cmpCutLinePoints` 231 and `dcmpCutLinePoints` 76.
- A push to deploy the web changes. Check `origin/main..main` first, because other sessions'
  commits ride along.
