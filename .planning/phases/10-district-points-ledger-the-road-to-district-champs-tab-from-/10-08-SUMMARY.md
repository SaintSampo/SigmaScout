---
phase: 10-district-points-ledger-the-road-to-district-champs-tab-from-
plan: 08
subsystem: docs
tags: [methodology, content-as-data, voice-gate, playwright, runbooks, districts]

requires:
  - phase: 10-01
    provides: "the qualification, alliance selection and playoff reconciliation counts asserted in pointFormulas.reconciliation.test.ts"
  - phase: 10-02
    provides: "the recorded constants beside measureAllianceWinProbability.ts, measureSelectionAgreement.ts and awardBaseRates.ts"
  - phase: 10-04
    provides: "the progressive captain rule's slot counts, the serpentine order and three recorded limitations"
  - phase: 10-05
    provides: "the four TickResult district fields, the two reserved cursor key shapes and the recorded freshness limit"
  - phase: 10-06
    provides: "the bake's three limitations and the awardsPosted residual gap"
  - phase: 10-07
    provides: "the shipped tab id, its panel test id and every test id DistrictLedger.tsx renders"
provides:
  - "/methodology/district-points — six sections stating how every district point category is predicted, the measured selection agreement, the measured bracket pricer gap and the seven recorded limits"
  - "The district award base-rate table on /methodology/awards, with its registered season set, its per-cell sample sizes and all five cells that cannot be scored"
  - "districtLedgerContent.ts + its runtime voice gate and figure pins; the sixth methodology hub card"
  - "docs/worker-operations.md's district refresh section, its four tick counters, one symptom row and the recorded freshness limit"
  - "docs/simulation-architecture.md corrected to three engines, with the district engine and the new browser side alliance pricer described"
  - "docs/publish-budget.md's fourth live writer row"
  - "apps/web/e2e/districts-ledger.spec.ts, registered on desktop and phone-390, written and collected but NOT run"
affects: [10-09]

actuals:
  tokens: 22544
  tasks: 4
  commits: 4

tech-stack:
  added: []
  patterns:
    - "A figure that appears in none of the plan's five named committed sources is not written: the numbers are FILLED from constants, never authored"
    - "A runtime voice gate over exported string VALUES, plus a second independent gate over the rendered DOM, so a string moved into JSX cannot escape it"
    - "A retired claim's pin is REPLACED rather than deleted, and the retired wording is referred to rather than re-quoted, so the note cannot re-introduce what it retires"
    - "An e2e spec whose only gate is collection: registered on the deployed projects, proven absent from every local one, and handed to the operator plan to run"

key-files:
  created:
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/methodology/districtLedgerContent.test.ts
    - apps/web/src/components/methodology/DistrictPointsPage.tsx
    - apps/web/src/routes/methodology.district-points.tsx
    - apps/web/src/routes/methodology.district-points.test.tsx
    - apps/web/e2e/districts-ledger.spec.ts
  modified:
    - apps/web/src/components/methodology/methodologyCardData.ts
    - apps/web/src/components/methodology/methodologyCardData.test.ts
    - apps/web/src/components/methodology/MethodologyCards.tsx
    - apps/web/src/components/methodology/awardsContent.ts
    - apps/web/src/components/methodology/awardsContent.test.ts
    - apps/web/playwright.config.ts
    - docs/worker-operations.md
    - docs/simulation-architecture.md
    - docs/publish-budget.md

key-decisions:
  - "Task 1's structure equality assertion was committed RED, exactly as the plan mandates: all six section ids are declared in Task 1 so the remaining five cannot be quietly dropped, and a placeholder paragraph to hide it is forbidden. Task 2 bodied them in the next commit and it went green."
  - "The award row in section 1's table carries no numeral. Task 1's acceptance criteria require every figure in that table to trace to 10-01, and the award point support traces to 10-02 instead, so the row states the source in words and Task 2's award-base-rates section carries the numbers."
  - "The awards page's nine base-rate cells are one table with a merged distribution column rather than nine numeric columns, because AwardsPage.tsx keys each TableRow on row[0] and three rows would otherwise share the key 'None'. The merge also keeps each unscorable cell to two words instead of six."
  - "The retired AWARDS_LEAD sentence is described, never quoted, in both the content header and the test comment, and the negative guard matches its tail (/anywhere yet/). Task 2's acceptance criterion forbids the literal substring anywhere under apps/web/src, and the plan's own Task 3 rule (refer by number, never re-quote) is the pattern applied."
  - "The 390px e2e test sets its own viewport explicitly. Both deployed projects collect the whole file, so a test relying on the project's viewport would run at 1440x900 under `desktop` and its overflow premise could be false there."
  - "No colour was added anywhere, so the dataviz palette validator was deliberately not run against an unchanged palette."

patterns-established:
  - "Figure pins carry a comment naming the generating command, grouped by source, so a rerun measurement that moves a number turns a named pin red rather than leaving a stale true-looking sentence"
  - "Seven recorded limitations pinned by an equality assertion on their row labels, so an edit cannot drop one"
  - "Pre-task doc grep counts recorded beside post-task counts, so a positive presence gate is a measurement rather than decoration"

requirements-completed: [SC-6, SC-7]

coverage:
  - id: D1
    description: "/methodology/district-points exists, is reachable from a sixth hub card, and carries six sections covering how each category is scored, how the open ones are predicted, the selection model, where the award base rates live, the bracket pricer's measured gap, and what the model does not cover"
    requirement: "SC-6"
    verification:
      - kind: unit
        ref: "apps/web/src/components/methodology/districtLedgerContent.test.ts#renders the sections in exactly the declared id order, by equality"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/methodology.district-points.test.tsx (6 tests: h1, lead, every section heading and paragraph, every anchor id, every table cell, the rendered DOM gate)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/methodology/methodologyCardData.test.ts#lists the six hub cards in their exact display order, by equality"
        status: pass
    human_judgment: false
  - id: D2
    description: "The district award base-rate table is on /methodology/awards with its registered season set, its per-cell sample sizes and all five cells that cannot be scored stated rather than omitted"
    requirement: "SC-6"
    verification:
      - kind: unit
        ref: "apps/web/src/components/methodology/awardsContent.test.ts#exports the four section ids in order, by equality; and #states every measured figure the scripts produced"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/methodology.awards.test.tsx#renders every table: its caption, its column headers and every cell (passed with NO hand edit)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every figure on both pages traces to one of five named committed sources and is pinned as a substring by a test carrying its generating command in a comment"
    requirement: "SC-6"
    verification:
      - kind: unit
        ref: "apps/web/src/components/methodology/districtLedgerContent.test.ts#states every measured figure its committed sources produced (36 pins)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/methodology/awardsContent.test.ts#states every measured figure the scripts produced (33 pins)"
        status: pass
      - kind: other
        ref: "this SUMMARY's `## Figure to source` table, one row per figure"
        status: pass
    human_judgment: false
  - id: D4
    description: "The voice gate runs at runtime over exported string values and finds zero dash characters of any kind, zero plus minus, no retired vocabulary, no singular first person and no paragraph over three sentences; the route test finds the same over the rendered DOM"
    requirement: "SC-6"
    verification:
      - kind: unit
        ref: "apps/web/src/components/methodology/districtLedgerContent.test.ts — the districtLedgerContent voice describe, 7 tests"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/methodology.district-points.test.tsx#renders no hyphen minus, en dash, em dash or plus minus anywhere in the page text"
        status: pass
    human_judgment: false
  - id: D5
    description: "Seven recorded limitations are stated on the page, one row each, pinned by an equality assertion on their labels"
    requirement: "SC-6"
    verification:
      - kind: unit
        ref: "apps/web/src/components/methodology/districtLedgerContent.test.ts#states exactly the seven recorded limitations, by equality against a hand typed literal"
        status: pass
    human_judgment: false
  - id: D6
    description: "AWARDS_LEAD no longer claims the site shows no award predictions, and the assertion that pinned that claim was replaced rather than deleted"
    requirement: "SC-6"
    verification:
      - kind: unit
        ref: "apps/web/src/components/methodology/awardsContent.test.ts#names where award predictions appear, and says the rest of the site shows none"
        status: pass
      - kind: other
        ref: "grep -rn 'does not show award predictions' apps/web/src -> no match"
        status: pass
    human_judgment: false
  - id: D7
    description: "All three runbooks describe the system phase 10 shipped: the district refresh pass with its four tick counters, its symptom row and the recorded freshness limit; three engines rather than two; the fourth live writer"
    requirement: "SC-7"
    verification:
      - kind: other
        ref: "grep -ci district on each of the three docs, recorded against the pre-task counts in this SUMMARY"
        status: pass
      - kind: other
        ref: "grep -q 'two engines' docs/simulation-architecture.md -> no match; the fenced json budget block byte identical to HEAD at 1,487 bytes"
        status: pass
    human_judgment: false
  - id: D8
    description: "A deployed-origin e2e spec covering the Road to District Champs tab at 1440x900 and 390px exists, is matched by both deployed projects and by no local one, and carries five titled tests"
    requirement: "SC-7"
    verification:
      - kind: other
        ref: "npx playwright test --list e2e/districts-ledger.spec.ts --project=desktop --project=phone-390 -> 10 tests in 1 file, 5 titles per project (full output in this SUMMARY)"
        status: pass
      - kind: other
        ref: "the same --list under local-desktop and local-phone-390 -> 0 tests in 0 files"
        status: pass
    human_judgment: false
  - id: D9
    description: "The spec actually passes against the deployed site with the republished district artifact"
    verification: []
    human_judgment: true
    rationale: "NOT PROVEN HERE. An executor subagent has no network, so this spec has never been executed. Its first real run is 10-09's, after the deploy and the republish."
  - id: D10
    description: "The published copy reads the way Jacob wants it to read"
    verification: []
    human_judgment: true
    rationale: "A voice gate is mechanical: it proves no dash character, no plus minus, no retired vocabulary, no first person and no paragraph over three sentences. It cannot prove the prose is the prose he wants. `feedback_methodology_copy_voice` records that he prefers to edit methodology copy himself; the two content file paths are named in this SUMMARY for exactly that."

duration: 33 min
completed: 2026-09-25
status: complete
---

# Phase 10 Plan 08: The words and the proof Summary

**Phase 10's four measurements became published prose on two methodology pages, every figure filled from a committed constant and pinned as a substring by a test that names its generating command; the three runbooks stopped describing a system with two engines, one live writer set and no district pass; and the Road to District Champs tab got a deployed origin e2e spec that this plan deliberately did not run.**

## Performance

- **Duration:** 33 min
- **Tasks:** 4 of 4 (1 tracer, 3 auto)
- **Files:** 15 (6 created, 9 modified), 1,336 insertions, 21 deletions
- **Full suite:** 280 files, 6,263 passed, 1 skipped, 0 failed. No re-run needed; the known `MetricHistoryTab.test.tsx` flake did not appear.

## Task Commits

| # | Task | Commit | Type |
|---|---|---|---|
| 1 | The district points methodology page, its first section and the sixth hub card | `e82e646c` | feat |
| 2 | The five remaining sections, the award base rate table, and the retired awards lead | `ff59a786` | feat |
| 3 | The three runbooks stop describing the system phase 10 replaced | `ec26bf3a` | docs |
| 4 | The deployed origin e2e spec, written and registered, not run | `13a7ccfe` | test |

**The tracer feedback gate was run.** After committing Task 1 its `<verify>` was re-executed end to end: the scoped vitest run reported 92 of 93 passing with exactly one failure, the declared-red structure equality assertion (see Deviations), and `npm --prefix apps/web run build` plus `npx tsc --noEmit -p apps/web/tsconfig.json` were both clean. No expansion work began before that gate cleared.

## Figure to source

**10-09 and any future editor read this section.** One row per figure appearing on either methodology page. A figure with no row is a defect.

### `/methodology/district-points`, section `how-district-points-work`

| Figure, as it reads on the page | Committed source | Command or test that produced it |
|---|---|---|
| `29,796 rows, 0 mismatches` | 10-01's qualification block | `npx vitest run packages/core/districts/pointFormulas.reconciliation.test.ts` |
| `20,209 rows, 0 mismatches` | 10-01's alliance selection block | the same test |
| `478 brackets and 10,278 rows, 0 mismatches` | 10-01's playoff block | the same test |
| `17 minus the alliance number` | `packages/core/districts/selectionPoints.ts` | `selectionPoints.test.ts`, exhaustive over all 32 slot by alliance combinations, and the 20,209 row reconciliation above |
| `30 for first, 20 for second, 13 for third, 7 for fourth` | `PLAYOFF_PLACEMENT_POINTS` in `packages/core/districts/bracket.ts` (`[30, 20, 13, 7, 0, 0, 0, 0]`) | the same reconciliation test's playoff block |
| `three times` (the district championship weight) | `districtTierWeight` in `qualPoints.ts`; `DCMP_WEIGHT` is 3 in every registered season of `pointModel.ts` | 10-01-SUMMARY's divisioned block records its observations as base values "divided by the 3x DCMP weight" |

### `/methodology/district-points`, section `the-alliance-selection-model`

Every figure below is an exported `MEASURED_*` constant in `scripts/measureSelectionAgreement.ts`, generated by `pnpm measure:selection-agreement` (`npx tsx scripts/measureSelectionAgreement.ts --captain-seasons 2023-2026 --seasons 2026 --warmup-from 2026`, run 2026-09-25), and cross checked against 10-02-SUMMARY's `## Selection agreement`.

| Figure | Constant |
|---|---|
| `485 events` | `MEASURED_USABLE_EVENTS = 485` |
| `99.97%, or 3,879 of 3,880` | `MEASURED_PROGRESSIVE_CORRECT_SLOTS = 3879` of `MEASURED_CAPTAIN_SLOTS = 3880` |
| `25.15%, or 976 of 3,880` | `MEASURED_NAIVE_CORRECT_SLOTS = 976` |
| `3.75%` | `MEASURED_CAPTAIN_COIN_FLOOR = 0.03751894072315206` |
| `2,256 turns` | `MEASURED_PICK_TURNS = 2256` |
| `32.62%` | `MEASURED_EXACT_AGREEMENT = 0.3262411347517731` |
| `5.90%` | `MEASURED_POOLED_COIN_FLOOR = 0.05901808119368394` |
| `1,128 turns` | `MEASURED_FIRST_PICK_TURNS` and `MEASURED_SECOND_PICK_TURNS`, both 1128 |
| `42.91%` | `MEASURED_FIRST_PICK_EXACT_AGREEMENT = 0.42907801418439717` |
| `3.95%` | `MEASURED_FIRST_PICK_COIN_FLOOR = 0.03949582708257352` |
| `22.34%` | `MEASURED_SECOND_PICK_EXACT_AGREEMENT = 0.22340425531914893` |
| `7.85%` | `MEASURED_SECOND_PICK_COIN_FLOOR = 0.07854033530479476` |
| `60.51%` | `MEASURED_TOP3_AGREEMENT = 0.6050531914893617` |
| `2026milac` | `MEASURED_PROGRESSIVE_MISSES = ["2026milac alliance 8"]`, also pinned by `selectionModel.reconciliation.test.ts#the single permitted miss is 2026milac alliance 8` |
| `position 4` / `position 2` | 10-02-SUMMARY's PICK-ORDER block: median model rank 4.0 on second picks, 2.0 on first picks (`MEASURED_MEDIAN_MODEL_RANK = 3` is the POOLED value and is deliberately not stated on the page) |

**The sentence 10-02 forbids softening is on the page unsoftened:** "The second pick is the weaker half. Its exact agreement is 22.34% against a floor of 7.85%, about 2.8 times the floor, where first picks run about 11 times their own floor."

### `/methodology/district-points`, section `how-well-the-bracket-pricer-works`

Every figure is an exported `MEASURED_*` constant in `scripts/measureAllianceWinProbability.ts`, generated by `pnpm measure:alliance-win-probability` (`npx tsx scripts/measureAllianceWinProbability.ts --seasons 2026 --warmup-from 2026`, run 2026-09-25), cross checked against 10-02-SUMMARY's `## The win-probability gap`.

| Figure | Constant |
|---|---|
| `19,792` | `MEASURED_SCORED_ROWS = 19792` |
| `0.0552` | `MEASURED_MEAN_ABSOLUTE_GAP = 0.05521610065219025` |
| `0.0417` | `MEASURED_MEDIAN_ABSOLUTE_GAP = 0.04173061762050173` |
| `0.1224` | `MEASURED_P90_ABSOLUTE_GAP = 0.12238168934831306` |
| `4.44%` | `MEASURED_WINNER_DISAGREEMENT_RATE = 0.04441188358932902` |
| `0.1462` | `MEASURED_BROWSER_FORMULA_BRIER = 0.14622846507962675` |
| `0.1443` | `MEASURED_PUBLISHED_BRIER = 0.1442591501111827` |
| `0.2494` | `MEASURED_COIN_BRIER = 0.24941895715440582` |
| `0.2112` | `MEASURED_SIGN_ONLY_BRIER = 0.2111960201100925` |

### `/methodology/district-points`, section `what-this-does-not-model`

| Figure | Committed source |
|---|---|
| `One captain slot in 3,880 ... at 2026milac` | `MEASURED_CAPTAIN_SLOTS` / `MEASURED_PROGRESSIVE_MISSES`; `selectionModel.reconciliation.test.ts` |
| `4,000 draws` | `DISTRICT_BAKE_SCHEDULE_COUNT` (40) x `DISTRICT_BAKE_DRAWS_PER_SCHEDULE` (100) in `packages/harness/districtBake.ts` |
| `0.03525` | `packages/harness/districtBake.test.ts`'s printed seed to seed spread at the production draw budget, recorded in 10-06-SUMMARY |

### `/methodology/awards`, section `district-award-base-rates`

Every figure is generated by `pnpm measure:district-award-base-rates` (`npx tsx scripts/measureDistrictAwardBaseRates.ts`, run 2026-09-25) and cross checked against the committed 2026 table literals in `packages/core/districts/awardBaseRates.ts` and 10-02-SUMMARY's `## Award base-rate tables`.

| Figure | Committed literal |
|---|---|
| `2019, 2020, 2022, 2023, 2024, 2025 and 2026` | `DISTRICT_AWARD_BASE_RATE_SEASONS` |
| `2,042` and `52.4%` | `2026.cells["none\|rookie"]`: `n: 2042`, `1 - pmf[0] = 0.5235064` |
| `7,335` and `19.9%` | `2026.cells["none\|veteran"]`: `n: 7335`, `1 - pmf[0] = 0.1990457` |
| `6,349` and `26.1%` | `2026.cells["one-or-two\|veteran"]`: `n: 6349`, `1 - pmf[0] = 0.2606710` |
| `10,060` and `61.6%` | `2026.cells["three-or-more\|veteran"]`: `n: 10060`, `1 - pmf[0] = 0.6155070` |
| `27.1%, 25.0%, 0.1%, 0.1%, 0.0%` | `2026.cells["none\|rookie"].pmf[1..5]` |
| `17.2%, 1.1%, 1.4%, 0.1%, 0.1%` | `2026.cells["none\|veteran"].pmf[1..5]` |
| `23.4%, 1.3%, 1.2%, 0.1%, 0.0%` | `2026.cells["one-or-two\|veteran"].pmf[1..5]` |
| `48.4%, 5.3%, 7.4%, 0.2%, 0.2%` | `2026.cells["three-or-more\|veteran"].pmf[1..5]` |
| the five `not scored` rows | the five cells 10-02 reports CANNOT BE SCORED in every registered season, all at `n = 0`, and absent from the module: all three `unknown` rookie rows plus `one-or-two\|rookie` and `three-or-more\|rookie` |

**The thin-crossing finding is on the page, not lowered into silence:** "Rookie status splits the table only where a team has never won a judged award." 10-02 named that a finding for this plan.

**Nothing on either page comes from outside the five named sources.** The existing awards page figures (41,869, the top pick percentages, 19 of the 24, the ranked list) are untouched and keep their original `pnpm measure:award-predictability` provenance.

## The retired sentences

### `AWARDS_LEAD`

| | Text |
|---|---|
| **Before** | "SigmaScout tested whether FRC awards can be predicted. The site does not show award predictions anywhere yet." |
| **After** | "SigmaScout tested whether FRC awards can be predicted. The Road to District Champs ledger prices a team's award points at a district event from the base rates at the foot of this page, and no other page on the site shows an award prediction." |

The pinning assertion was **replaced, not deleted**:

| | Assertion |
|---|---|
| **Before** | `expect(AWARDS_LEAD).toContain("does not show award predictions")` |
| **After** | `expect(AWARDS_LEAD).toContain("The Road to District Champs ledger prices a team's award points")`, `expect(AWARDS_LEAD).toContain("no other page on the site shows an award prediction")`, and `expect(AWARDS_LEAD).not.toMatch(/anywhere yet/)` |

Negative grep proving it is gone:

```
$ grep -rn "does not show award predictions" apps/web/src
(no output)
```

The retired wording is **described rather than quoted** in `awardsContent.ts`'s header and in the test's own comment, and the negative guard matches the retired sentence's tail (`/anywhere yet/`) instead of the banned phrase, so neither note can re-introduce what it retires. That is the plan's own Task 3 rule (refer by number, never re-quote) applied to a sentence instead of a heading.

### `docs/simulation-architecture.md`, section 1's heading and opening

| | Text |
|---|---|
| **Before** | `## 1. There is one tab and two engines` / "The Simulation tab ... is a single panel whose content is decided by one piece of state" |
| **After** | `## 1. Two tabs simulate, and there are three engines` / "Two tabs in this app run a simulation: the event page's Simulation tab, and the district page's Road to District Champs tab. Between them they use three engines." |

One further occurrence of the banned phrase was found in the section's body prose ("The first two engines call the same function") and rewritten to "The Baked engine and the Live engine both call the same function", which says the same thing more precisely now that a third engine exists (deviation 4). Negative greps:

```
$ grep -n "two engines" docs/simulation-architecture.md
(no output)
$ grep -n "one tab and two engines" docs/simulation-architecture.md
(no output)
```

The dated historical note added to the header stack refers to the corrected section **by its number** ("section 1's own count of tabs and engines was wrong and is corrected below") and never re-quotes the retired heading, which is why both greps stay empty.

## Doc mention counts, before and after

```
$ for f in docs/worker-operations.md docs/simulation-architecture.md docs/publish-budget.md; do echo -n "$f: "; grep -ci district "$f"; done
```

| Doc | Before this plan | After |
|---|---:|---:|
| `docs/worker-operations.md` | **0** | **30** |
| `docs/simulation-architecture.md` | **0** | **23** |
| `docs/publish-budget.md` | **36** | **45** |

**A correction to the plan's own premise.** The plan states "Before this plan, the three docs contain the word district zero times between them." That was true when the plan was written and is no longer true: 10-06 wrote the measured district payload section into `docs/publish-budget.md`, so its pre-task count is **36, not 0**. The other two were genuinely zero. The positive presence gate still holds on all three, and 10-06's section is untouched by this plan.

The four tick fields, each appearing in the sample JSON line, in the explanatory table, and in the symptom row:

```
$ for k in districtsConsidered districtsRefreshed districtsUnchanged districtsFailed; do echo -n "$k: "; grep -c "$k" docs/worker-operations.md; done
districtsConsidered: 3
districtsRefreshed: 3
districtsUnchanged: 3
districtsFailed: 3
```

The "When something is wrong" table gained **exactly one row** (11 lines before, 12 after, counted over the section), and that row's first thing to check names all four counts in order.

### The fenced machine-readable `json budget` block

Extracted from `git show HEAD:docs/publish-budget.md` and from the working tree and compared:

```
found in HEAD: True   found in working tree: True
identical: True       bytes: 1487 1487
```

**Byte identical.** The scoped diff of that block is empty.

### The freshness limit, in both places, for comparison

| Where | Wording |
|---|---|
| `docs/worker-operations.md` | "Awards that post after every member event's live window has closed do not appear until the next offline republish. An event's live window is padded one hour past the last match observed there (`LIVE_WINDOW_PAD_MS` in `packages/harness/manifestSchemas.ts`), so an award ceremony later that night falls outside it and the tick never asks." |
| `districtLedgerContent.ts` (limit 7) | "Awards posted after every event in the district has finished wait for the next offline republish" / "An event's live window closes one hour after the last match observed there." |

Compatible: the same fact, the same cause, the runbook naming the constant and the public page not.

## The e2e spec, as collected

**The gate here is COLLECTION, not execution.** `--list` ran successfully in this environment; the spec is **registered and collected but has never been run**.

```
$ cd apps/web && npx playwright test --list e2e/districts-ledger.spec.ts --project=desktop --project=phone-390
Listing tests:
  [desktop] › districts-ledger.spec.ts:134:3 › Road to District Champs, 1440x900 › the default panel renders the ledger, and the five status chips account for the whole roster
  [desktop] › districts-ledger.spec.ts:193:3 › Road to District Champs, 1440x900 › the Rewind slider spans the district's timeline and its position is shareable
  [desktop] › districts-ledger.spec.ts:229:3 › Road to District Champs, 1440x900 › a pre rename tab id still lands on the Road to District Champs panel
  [desktop] › districts-ledger.spec.ts:240:3 › Road to District Champs, 1440x900 › the Champ Locks panel still renders the shipped champ table, so this phase's removal is provably scoped
  [desktop] › districts-ledger.spec.ts:254:3 › Road to District Champs, 390px › the table's own region is the only horizontal scroller and the sticky Team column holds
  [phone-390] › districts-ledger.spec.ts:134:3 › Road to District Champs, 1440x900 › the default panel renders the ledger, and the five status chips account for the whole roster
  [phone-390] › districts-ledger.spec.ts:193:3 › Road to District Champs, 1440x900 › the Rewind slider spans the district's timeline and its position is shareable
  [phone-390] › districts-ledger.spec.ts:229:3 › Road to District Champs, 1440x900 › a pre rename tab id still lands on the Road to District Champs panel
  [phone-390] › districts-ledger.spec.ts:240:3 › Road to District Champs, 1440x900 › the Champ Locks panel still renders the shipped champ table, so this phase's removal is provably scoped
  [phone-390] › districts-ledger.spec.ts:254:3 › Road to District Champs, 390px › the table's own region is the only horizontal scroller and the sticky Team column holds
Total: 10 tests in 1 file
```

**No local project collects it**, which is the point: the spec must read the republished artifact from the real deployed origin.

```
$ npx playwright test --list e2e/districts-ledger.spec.ts --project=local-desktop
Error: No tests found.
Total: 0 tests in 0 files
$ npx playwright test --list e2e/districts-ledger.spec.ts --project=local-phone-390
Error: No tests found.
Total: 0 tests in 0 files
```

### Every selector literal, paired with its grep

```
$ grep -n "\"road-to-district-champs-panel\"\|\"champ-locks-panel\"" apps/web/src/routes/districts.tsx
228:  <TabsContent value="road-to-district-champs" data-testid="road-to-district-champs-panel" ...>
231:  <TabsContent value="champ-locks" data-testid="champ-locks-panel" ...>

$ grep -n 'data-testid="district-ledger-..."' apps/web/src/components/districts/DistrictLedger.tsx
686:  <div className="flex flex-col gap-[var(--spacing-md)]" data-testid="district-ledger-tab">
477:  <div className="data-card ..." data-testid="district-ledger-controls">
426:  <div className="flex flex-col gap-[var(--spacing-sm)]" data-testid="district-ledger-rewind">
439:  <span data-testid="district-ledger-rewind-readout">{position.label}</span>
182:  <div className="flex flex-col gap-[var(--spacing-sm)]" data-testid="district-ledger-status-chips">
188:  data-testid="district-ledger-status-chip"
715:  <TableRow key={team.teamKey} data-testid="district-ledger-row" data-team={team.teamKey}>
725:  <TableRow key={`${team.teamKey}-${row.eventKey}`} data-testid="district-ledger-row" data-team={team.teamKey}>
302:  <TableCell rowSpan={...} data-testid="district-ledger-team-cell" className={TEAM_CELL_CLASS}>
151:  <TableCell rowSpan={rowSpan} data-testid="district-ledger-status-cell" ...>
157:  <TableCell rowSpan={rowSpan} data-testid="district-ledger-status-cell" data-status={status.status} ...>
734:  <TableCell rowSpan={...} data-testid="district-ledger-grand-total" className="numeric-cell align-top">

$ grep -n 'data-testid={`${which}-locks-header-stat-row`}|data-testid={`district-${which}-locks-column-toggle`}|data-testid={`district-${which}-locks-tab`}' apps/web/src/components/districts/DistrictLocksTab.tsx
176:  <div className="flex flex-wrap items-center gap-[var(--spacing-lg)]" data-testid={`${which}-locks-header-stat-row`}>
302:  <div className="flex flex-col gap-[var(--spacing-md)]" data-testid={`district-${which}-locks-tab`}>
308:  data-testid={`district-${which}-locks-column-toggle`}

$ grep -n 'overflow-x-auto overscroll-x-contain' apps/web/src/components/districts/DistrictLedger.tsx
697:  <div className="data-card w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">

$ grep -n "DISTRICT_LEDGER_STATUS_KEYS = " apps/web/src/components/districts/districtLedgerStatus.ts
47:export const DISTRICT_LEDGER_STATUS_KEYS = ["prequalified", "locked", "inRange", "outOfRange", "lockedOut"] as const;

$ grep -n "RENAMED FROM \`district-locks\`" apps/web/src/lib/searchParams.ts
315: * THE FIRST TAB'S ID WAS RENAMED FROM `district-locks` IN PHASE 10, AND THE

$ grep -n "^  at: z.string" apps/web/src/lib/searchParams.ts
358:  at: z.string().optional().catch(undefined),
```

The champ tier's three test ids are template literals with `which="champ"`, so the rendered strings are `champ-locks-header-stat-row`, `district-champ-locks-tab` and `district-champ-locks-column-toggle`. The ledger's scroll region carries no test id of its own, so the spec addresses it structurally as `[data-testid="district-ledger-tab"] > div.overflow-x-auto`; both halves of that selector are grepped above.

### Every pinned count, derived from the published fixtures

```
$ node -e "const a=require('./data/fixtures/phase10/district-2026pnw.json');
           const c={}; for(const x of a.teams){const s=x.districtLock.status; c[s]=(c[s]||0)+1;}
           console.log('districtLock.status counts:', JSON.stringify(c));
           console.log('roster:', a.teams.length, 'dcmpSlots:', a.dcmpSlots);
           console.log('districtLockedCount:', a.insights.districtLockedCount,
                       'districtEliminatedCount:', a.insights.districtEliminatedCount);"
districtLock.status counts: {"locked":42,"lockedAward":8,"eliminated":76}
roster (teams): 126 dcmpSlots: 50
districtLockedCount: 42 districtEliminatedCount: 76

$ node -e "const i=require('./data/fixtures/phase10/districts-index-2026.json');
           console.log(JSON.stringify(i.districts.find(d=>d.districtKey==='2026pnw')));"
{"districtKey":"2026pnw","abbreviation":"pnw","displayName":"Pacific Northwest",
 "dcmpSlots":50,"cmpSlots":21,"teamCount":126,"eventCount":9}
```

| Constant in the spec | Value | Derived from |
|---|---:|---|
| `ROSTER_SIZE` | 126 | the index row's `teamCount`, the artifact's `teams.length` and its `insights.teamCount`, all three agreeing |
| `DCMP_SLOTS` | 50 | the index row's `dcmpSlots` and the artifact's own `dcmpSlots` |
| `LOCKED_COUNT` | 50 | 42 `locked` plus 8 `lockedAward`; the Locked chip counts both, because `lockedAward` is a note on one status rather than a second status |
| `PREQUALIFIED_COUNT` | 0 | no team in the artifact carries a `prequalified` verdict |
| `LOCKED_OUT_COUNT` | 76 | `insights.districtEliminatedCount`, equal to the `eliminated` census |

**The two pins check each other:** `PREQUALIFIED_COUNT + LOCKED_COUNT` is 50, which must equal `DCMP_SLOTS` on a finished district, and the spec asserts that equality separately from the two counts themselves. `126 = 50 + 76` closes the roster with In range and Out of range at zero, which is what a district with no open category must report.

## Content files for Jacob

`feedback_methodology_copy_voice` records that Jacob prefers to edit methodology copy himself. Both files are content-as-data: every string the page renders lives in one of them, and nothing is written in JSX.

- **`apps/web/src/components/methodology/districtLedgerContent.ts`** — the whole of `/methodology/district-points`: the title, the lead, six section headings, their paragraphs and every table cell.
- **`apps/web/src/components/methodology/awardsContent.ts`** — `/methodology/awards`, including the rewritten `AWARDS_LEAD` and the new `district-award-base-rates` section.

Editing either will turn a test red if a figure is dropped, a dash character is typed, a paragraph runs past three sentences, or a section id changes. That is the gate working; the message names the exact string.

## Baseline vs post-plan failing test sets

| | Baseline (10-07 close out) | Post-plan |
|---|---|---|
| `npx vitest run` from the REPO ROOT | 278 files, 6,241 passed, 1 skipped, **failing set: {} (empty)** | **280 files, 6,263 passed, 1 skipped, failing set: {} (empty)** |
| `npx tsc --noEmit` (root) | clean | clean |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | clean | clean |

**Collected file count of the root-run full suite: 280.** That is the repo-root number, not the count `apps/web` would report (memory `project_test_scope_trap`). This plan added two test files (`districtLedgerContent.test.ts` and `methodology.district-points.test.tsx`) and 22 tests.

**Both failing sets are empty.** The known `MetricHistoryTab.test.tsx` load flake did not appear in this run, so no re-run was needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Task 1's acceptance criteria 1 and 4 are jointly unsatisfiable, and criterion 4 governs**

- **Found during:** Task 1
- **Issue:** Criterion 1 requires the scoped vitest run to pass. Criterion 4 requires all six section ids to be declared with only one bodied, states that the structure equality assertion "is therefore RED until Task 2 lands", and forbids working around it with a placeholder paragraph. Both cannot hold at the same commit.
- **Fix:** Followed criterion 4, which is the more specific instruction and carries the planner's stated reason (the pressure that stops the remaining five sections being quietly dropped). Task 1's commit message records the red assertion by name, says why it is red, and says which commit clears it. The scoped run at Task 1 was 92 of 93 passing with exactly that one failure and nothing else; after Task 2 it is 93 of 93. The red lasted one commit and never reached a push.
- **Files modified:** none beyond the plan's list
- **Verification:** the Task 1 scoped run's output, the Task 2 scoped run's output, and the full suite at close out
- **Committed in:** `e82e646c` (red, recorded) and `ff59a786` (green)

**2. [Rule 2 - Missing critical] The awards base-rate table would have produced duplicate React keys**

- **Found during:** Task 2
- **Issue:** `AwardsPage.tsx` renders `<TableRow key={row[0]}>`. The plan's shape for the new table is "the decoration buckets crossed with rookie status", which gives three rows whose first cell reads "None", three reading "One or two" and three reading "Three or more" — nine rows sharing three keys. React would have warned and reconciled the rows against each other.
- **Fix:** Merged bucket and rookie status into a single first column ("None, rookie", "None, rookie year unknown", and so on), which makes every `row[0]` unique. The same edit merged the six point-value columns into one distribution column, which keeps each unscorable cell to two words instead of six repeats of "not scored" and keeps the table small, as the voice rules ask. `AwardsPage.tsx` itself is unchanged.
- **Files modified:** `apps/web/src/components/methodology/awardsContent.ts`
- **Verification:** `methodology.awards.test.tsx#renders every table` passes with no React key warning in the run output
- **Committed in:** `ff59a786`

**3. [Rule 3 - Blocker] Task 2's no-substring criterion conflicts with its own instruction to note the retired sentence**

- **Found during:** Task 2
- **Issue:** Action step 7 says to note in the content module's header that the sentence was retired "so a reader of the diff does not restore it", which invites quoting it. Acceptance criterion 8 says no file under `apps/web/src/` may carry the substring `does not show award predictions`. A verbatim quote in the header, plus the natural `not.toContain` guard in the test, put three copies of the banned substring under `apps/web/src`.
- **Fix:** Applied the plan's own Task 3 pattern (refer, never re-quote). The header and the test comment describe the retired claim; the negative guard matches its tail with `/anywhere yet/`. The grep now returns nothing and the retirement is still documented and still guarded in both directions.
- **Files modified:** `apps/web/src/components/methodology/awardsContent.ts`, `apps/web/src/components/methodology/awardsContent.test.ts`
- **Verification:** `grep -rn "does not show award predictions" apps/web/src` returns no output; the replacement assertion passes
- **Committed in:** `ff59a786`

**4. [Rule 1 - Bug] The `two engines` negative grep failed on a sentence the plan did not name**

- **Found during:** Task 3
- **Issue:** After rewriting section 1's heading and opening, `grep -q "two engines" docs/simulation-architecture.md` still matched: the section's body carried "The first two engines call the **same** function".
- **Fix:** Rewritten to "The Baked engine and the Live engine both call the **same** function", which says the same thing more precisely now that a third engine exists. Both negative greps are empty.
- **Files modified:** `docs/simulation-architecture.md`
- **Verification:** `grep -n "two engines" docs/simulation-architecture.md` returns no output
- **Committed in:** `ec26bf3a`

**5. [Rule 1 - Bug] The 390px e2e test would have run at 1440x900 under the `desktop` project**

- **Found during:** Task 4, at the collection gate
- **Issue:** Both deployed projects collect the whole spec file, so the 390px test as first written (inheriting the project's viewport) would run at 1440x900 under `desktop`. Its `assertOverflows` premise could be false at that width, which would have turned a premise guard into a spurious failure, or worse, made the arbitration assertion vacuous had the guard been relaxed. This is the same shape as `no-page-pan.spec.ts`'s recorded `grepInvert` case.
- **Fix:** The 390px test sets its own viewport explicitly, with a comment saying why. It now runs at 390 on both projects; `phone-390` still adds the real device descriptor (touch, mobile user agent, device pixel ratio) on top. The desktop tests already set their own viewport, so the file is width correct under either project.
- **Files modified:** `apps/web/e2e/districts-ledger.spec.ts`
- **Verification:** the `--list` output above, re-run after the change
- **Committed in:** `13a7ccfe`

### Documented, not fixed

**The plan's pre-task premise for `docs/publish-budget.md` was stale.** It states all three docs contain the word district zero times; 10-06 had already written 36 mentions into that file. Recorded above with the real counts rather than repeated as written.

**`apps/web/src/routes/methodology.awards.test.tsx` is in the plan's `files_modified` and was NOT touched.** Every assertion there iterates `AWARDS_SECTIONS` and passed unmodified with the new section present, including the rendered table count. The plan's criterion ("the awards route test passes with no hand edit, or the SUMMARY names every hand edit and its reason") is met by the first branch: there are no hand edits to name.

---

**Total deviations:** 5 auto-fixed (2 x Rule 3, 2 x Rule 1, 1 x Rule 2) plus 2 documented notes.
**Impact on plan:** no scope creep and no dropped requirement. Deviations 2, 4 and 5 are defects the plan's own gates surfaced; 1 and 3 are conflicts inside the plan's own acceptance criteria, each resolved toward the more specific instruction and recorded here.

## What is NOT proven here

Named as unproven rather than claimed:

- **The e2e spec has never been executed.** `--list` collects it under both deployed projects; that proves the file compiles, that both `testMatch` regexes match it, and that the five titles are what 10-09 will see. It proves nothing about whether any assertion passes. **10-09's run is the first.**
- **The pinned counts are derived from the COMMITTED FIXTURES, not from the deployed artifact.** `data/fixtures/phase10/district-2026pnw.json` is a snapshot of the 2026-09-14 generation. 10-09's republish writes a new generation; the underlying season is finished so the verdicts should be identical, but that identity is an expectation this plan did not test.
- **The 390px and reduced-motion backstops remain open.** 10-07 named both as backstops it could only measure locally. The 390px one is this spec's job and is still 10-09's to run; the reduced-motion one is the UAT's manual OS-setting check and is not covered by anything here.
- **`apps/web/e2e/**` is typechecked by neither tsconfig.** Neither the root nor the web tsconfig `include`s the e2e directory, so no e2e spec in this repo is typechecked by anything except Playwright's own transpile at run time. This plan does not close that gap (adding the directory would surface unknown errors across twenty existing specs), and records it as a real gap rather than leaving it to be rediscovered.
- **The copy has not been read by Jacob.** The voice gate is mechanical. It cannot prove the prose is the prose he wants; the two content file paths are named above for exactly that reason.
- **No `measure:*` script was rerun.** Every figure was copied from a committed constant or a committed reconciliation test, per the plan's explicit prohibition, so nothing here re-derives a number a sibling already committed.

## Security and secrets

**No secret was read, printed, copied, hashed or interpolated at any point in this plan.** `.env` was never passed to the `Read` tool, never `cat`/`head`/`tail`/`echo`'d, and never interpolated into a shell command, a log line, a test name or a commit message. No command run by this plan carried an environment-file flag. Task 3 edits an operations runbook, which is where a credential is most tempting to paste; every added sentence names a procedure, a key SHAPE or a constant's name, and no value.

**No network request was made.** No `measure:*` script was run, nothing was published, deployed, pushed or fetched, and the e2e spec was written and collected but never executed. `--list` does not drive a browser and makes no request.

**No package was installed.** `package.json` and `pnpm-lock.yaml` are untouched.

**Threat register dispositions discharged:** T-10-08-01 (every figure filled from one of five named sources, cross checked against the exported constant, pinned as a substring with its generating command in a comment, and traced row by row in `## Figure to source`), T-10-08-02 (the voice gate at runtime over exported VALUES, structure by equality against a hand typed literal, and a second independent gate over the rendered DOM), T-10-08-03 (both named phrases gone including from the dated note, the awards claim guarded by a replaced assertion, and positive presence greps recorded against real pre-task counts), T-10-08-04 (no `.env` read, no credentialed command, no value in any added sentence), T-10-08-05 (registered on the two deployed projects only, proven absent from both local ones, not run, and Playwright is not in this repo's CI), T-10-08-06 (every selector grepped out of shipped source with the output above, and the scoped-removal control asserted POSITIVELY by the champ tier's own test ids). T-10-08-SC is `accept`: this plan installs nothing.

## Known Stubs

None. No cell, string or section on either page renders a placeholder, and no test was skipped.

## Issues Encountered

- **`git add` warns `LF will be replaced by CRLF` on every new file.** Expected on this machine; no test in this plan regexes for a line ending.
- **Two acceptance criteria inside the plan conflicted with two others** (deviations 1 and 3). Both are recorded above with the resolution and its reasoning rather than being silently resolved.

## User Setup Required

None. Nothing in this plan fetches, publishes, deploys or installs.

## Next Phase Readiness

**Ready for 10-09.** What it needs from here:

1. **The e2e command**, run from `apps/web` AFTER the deploy and AFTER the republish, from the MAIN context (an executor has no network):

   ```
   cd apps/web && npx playwright test e2e/districts-ledger.spec.ts --project=desktop --project=phone-390
   ```

   Five test titles per project, listed verbatim in `## The e2e spec, as collected`. **This is the spec's first execution.** A failure is as likely to be spec drift as a site defect, and both must be triaged rather than one assumed. The pinned counts (126 roster, 50 championship slots, 50 Locked, 76 Locked out, 0 In range, 0 Out of range) come from the committed 2026-09-14 fixture; if the republished generation disagrees, read the new artifact's own `districtLock.status` census before changing a number in the spec.

2. **The spec will fail against a PRE-REPUBLISH site.** 10-07 records that the tab degrades honestly against an artifact with no `state` blocks: every category renders open and unavailable. The chip counts this spec pins assume the republished artifact. Deploy the Worker first, republish second, then run the spec.

3. **Nothing else is owed by this plan.** No deploy, no publish, no push, no `gh run list`, no D1 seed.

**For Jacob:** the two content files are named in `## Content files for Jacob`.

## Self-Check: PASSED

- All 6 files in `key-files.created` exist on disk, and all 9 in `key-files.modified` are present in this plan's diff.
- All four task commits resolve in `git log`: `e82e646c`, `ff59a786`, `ec26bf3a`, `13a7ccfe`.
- `git show --name-only` per commit lists only files from the plan's `files_modified`, with no commit crossing a task boundary. Task 3's commit lists exactly the three paths under `docs/`; Task 4's lists exactly the two under `apps/web/`.
- `packages/core/districts/locks.ts`, every file under `apps/web/src/components/districts/`, `apps/web/src/styles/theme.css`, every published schema, `package.json` and `pnpm-lock.yaml` are all unchanged (`git status --short` over each returns nothing).
- Plan `<verification>` re-run at close out:
  1. `npx vitest run apps/web/src/components/methodology apps/web/src/routes/methodology.district-points.test.tsx apps/web/src/routes/methodology.awards.test.tsx apps/web/src/routes/methodology.index.test.tsx` — 8 files, 101 tests, all passing.
  2. `npm --prefix apps/web run build` succeeded (the route tree regenerated with the new route) and `npx tsc --noEmit -p apps/web/tsconfig.json` is clean after it.
  3. `npx tsc --noEmit` at the repo root — clean.
  4. `npx vitest run` from the repo root — **280 files, 6,263 passed, 1 skipped, 0 failed.**
  5. Task 3's doc greps, all recorded above beside their pre-task counts.
  6. `npx playwright test --list e2e/districts-ledger.spec.ts --project=desktop --project=phone-390` — 10 tests in 1 file, full output above.
- No secret read or printed; no network request made; no `measure:*` script run.

---
*Phase: 10-district-points-ledger*
*Completed: 2026-09-25*
