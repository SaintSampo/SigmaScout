---
phase: quick-261009-txb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/measureLedgerSettledTenets.ts
  - scripts/measureLedgerSettledTenets.test.ts
  - package.json
  - .planning/todos/pending/locks-settled-playoffs-follow-ups.md
autonomous: true
requirements: [261009-txb]

estimate:
  tokens: 32000
  raw_tokens: 64000
  tasks: 2
  confidence: high

must_haves:
  truths:
    - "D1: `scripts/measureLedgerSettledTenets.ts` runs the District Locks tab's own `buildDistrictLedgerRows` and `computeDistrictLedgerStatuses` twice at every stop (Alliances final, Round 1 to Round 5, Playoffs final with awards open) of every district tier event of every 2023 to 2026 district season with a published dcmpSlots: once with no distributions (blunt) and once with distributions carrying only that event's `playoffMilestoneByTeam`, built from the corpus alliances and the played rows up to that round by `playedBracketMatchesFor` and `dcmpBracketMilestonesByTeam` (settled). No Monte Carlo, no network, no credential; it prints a skipped line and exits 0 when `data/corpus.sqlite` is absent."
    - "D1 and tenet D: tenets A and B are scored in both runs with `outcomeForLockedShown` and `outcomeForLockedOutShown` from `scripts/measureLedgerTenets.ts` against the tab's district tier final standing (`districtTierFinalVerdicts`); tenet C flags every team Locked under the blunt rule that is not Locked under the settled rule at the same stop; tenet D (no take back, Jacob's rule in its literal form) flags, under the settled rule, every later stop of an event at which a team shown Locked (on points or by award) at an earlier stop of that event is not shown Locked. Any tenet A, B, C or D violation sets exit code 1; the blunt rule's take back count is a reference column and never moves it."
    - "The yardstick is confirmed (orchestrator, 2026-10-09): the district tier final standing scores the tenets, and the artifact's published `districtLock.status` is printed as a census that never moves the exit code, because the local artifacts were written 2026-09-25, before quick task 261007-il9, and on them that field ranks the all tier total (254 teams differ over the 48 swept seasons). The script header says so."
    - "D1: the report carries, per season, events swept, stops, Locked on points under the blunt rule and under the settled rule, gained and lost, Locked out under each, the blunt rule's take back count, and violations per tenet A, B, C and D; then the skipped events with their reason (no alliances in the corpus, not an eight alliance bracket, no played playoff rows in the corpus, bracket does not route)."
    - "On 2026pnw alone the sweep reads 8 events, 56 stops, Locked on points 351 blunt and 360 settled, Locked out 665 and 697, no take back under either rule, VIOLATIONS: none, exit 0."
    - "D2: the test file runs a synthetic stop builder test, a skip reason test and a no take back helper test with no local data, and (gated on the local 2026pnw artifact and the corpus) pins 2026waahs Round 3 at 29 blunt and 31 settled Locked on points with exactly frc1983 and frc2926 gained and nobody lost, and proves the checker can fail on a corrupted yardstick. The real data `main` exit code test is NOT in the file until Task 2."
    - "D3 and the sequencing decision: Task 1 lands the sweep while it reports a KNOWN, PRINTED, EXPECTED failure at HEAD 9e979118: tenet A 0, tenet B 0, tenet C 41, tenet D 41 under the settled rule (the same 41 team stops) and 0 under the blunt rule, exit 1. Task 2, the acceptance (zero A, B, C and D violations, the `main` exits 0 test, todo item 2 struck), is executed only after quick task 261009-uhb (the pooled pool nets out settled playoff points) lands."
    - "No lock math changes in this task: its commits touch only `scripts/measureLedgerSettledTenets.ts`, its test and one `package.json` line; `scripts/measureChampJointLocks.ts` is imported and not edited."
  artifacts:
    - path: "scripts/measureLedgerSettledTenets.ts"
      provides: "settledStops, bracketSkipReason, takeBackRows, settledDistrictContext, statusesAtSettledStop, sweepSettledEvent, sweepSettledDistrict, main; the corpus gated District Locks settled playoffs sweep with tenets A to D"
      contains: "sweepSettledDistrict"
    - path: "scripts/measureLedgerSettledTenets.test.ts"
      provides: "the synthetic stop builder, skip reason and no take back tests, the 2026waahs Round 3 pin, the corrupted yardstick test; after Task 2 the main exits 0 test"
      contains: "2026waahs"
    - path: "package.json"
      provides: "the measure:ledger-settled-tenets script entry, with no env file flag"
      contains: "measure:ledger-settled-tenets"
  key_links:
    - from: "scripts/measureLedgerSettledTenets.ts"
      to: "apps/web/src/components/districts/districtLedgerRows.ts"
      via: "buildDistrictLedgerRows with a one event distributions map carrying playoffMilestoneByTeam"
      pattern: "playoffMilestoneByTeam"
    - from: "scripts/measureLedgerSettledTenets.ts"
      to: "scripts/measureLedgerTenets.ts"
      via: "the outcome rules and the district tier final standing, imported and never restated"
      pattern: "outcomeForLockedShown"
    - from: "scripts/measureLedgerSettledTenets.ts"
      to: "scripts/measureChampJointLocks.ts"
      via: "bracketFromCorpus and CORPUS_PATH, both already exported"
      pattern: "bracketFromCorpus"
---

<objective>
Give the District Locks tab's settled playoffs rule (quick task 261008-26o) the corpus sweep the Championship tier got in 261009-2tr: at every playoff round stop of every 2023 to 2026 district event, run the tab's own status code with and without the real bracket facts and check that nobody shown Locked failed to qualify (A), nobody shown Locked out qualified (B), nobody loses a lock to the settled rule at a stop (C), and nobody shown Locked at a stop is not Locked at a later stop of the same event (D, no take back) (CONTEXT D1 to D3, plus the orchestrator's tenet D of 2026-10-09).

Purpose: item 2 of `.planning/todos/pending/locks-settled-playoffs-follow-ups.md`. The two shipped sweeps pass no bracket facts, so the settled rule has never been measured against history at the district tier. The sweep is also the gate quick task 261009-uhb proves its lock math fix against.

Output: `scripts/measureLedgerSettledTenets.ts`, its test, one `package.json` line, and the measured totals for the SUMMARY. Measurement only. NO lock math changes in this task, whatever the sweep finds.

Sequencing (orchestrator, 2026-10-09). Task 1 runs NOW and lands the sweep with its known failure printed (41 tenet C rows, 41 tenet D rows, exit 1). Quick task 261009-uhb then fixes the lock math. Task 2 runs only AFTER that fix has landed and is written to be executed on its own.
</objective>

<planner_findings>
The planner prototyped the whole sweep with scratch scripts (the same functions, the same stops) at HEAD 9e979118 on `data/local-publish/districts` and `data/corpus.sqlite`. It runs. All four seasons take about 6 seconds after startup (2026fim, the largest season, 0.9 s). These numbers are PRE-REGISTERED: the executor's own run is compared against them and is never fitted to them.

**1. Totals, scored against the district tier final standing.**

| season | districts | events | stops | Locked blunt | Locked settled | gained | lost | Locked out blunt | Locked out settled | settled rows |
|---|---|---|---|---|---|---|---|---|---|---|
| 2023 | 11 | 94 | 658 | 8,120 | 8,214 | 100 | 6 | 16,727 | 16,972 | 4,775 |
| 2024 | 11 | 98 | 686 | 8,724 | 8,786 | 71 | 9 | 19,105 | 19,352 | 5,088 |
| 2025 | 12 | 103 | 721 | 8,981 | 9,126 | 149 | 4 | 20,747 | 21,086 | 5,261 |
| 2026 | 14 | 123 | 861 | 11,157 | 11,282 | 147 | 22 | 25,513 | 25,825 | 6,304 |
| all | 48 | 418 | 2,926 | 36,982 | 37,408 | 467 | 41 | 82,092 | 83,235 | 21,428 |

Zero events skipped: every district tier event of the 48 seasons has eight alliances and played playoff rows in the corpus, none fails to route, none has an unresolved row, and every event has all five rounds (2,926 is 418 times 7). Tenet A: 0 violations in both runs (blunt 36,284 kept and 698 award qualified; settled 36,696 kept and 712 award qualified). Tenet B: 0 in both runs (award qualified 6 blunt, 13 settled; unresolved ties 0). No team loses Locked out to the settled rule.

COVERAGE LIMIT, to keep in the header and the SUMMARY: all 21,428 settled rows are the `exact` kind (every swept event is finished, so the value is TBA's own `elim`). The not exact branch of `settledPlayoffPoints` (live, mid playoffs, where the placement maximum joins only the ceiling) is not reachable from finished seasons and is NOT covered by this sweep.

**2. Tenets C and D FAIL at HEAD, on the same 41 team stops.**

| season | tenet C | tenet D, settled rule | take back, blunt rule (reference) |
|---|---|---|---|
| 2023 | 6 | 6 | 0 |
| 2024 | 9 | 9 | 0 |
| 2025 | 4 | 4 | 0 |
| 2026 | 22 | 22 | 0 |
| all | 41 | 41 | 0 |

The 41 tenet D rows are exactly the 41 tenet C rows (same district, event, stop and team), so the full run prints 82 violation rows. They cover 32 team events at 21 events, 9 rows at Round 4 and 32 at Round 5. Every one is a team first Locked by the POOLED argument alone (`lockedBy` `pooled`) that reads In range (`contending`) at the row and Locked again at Playoffs final, and every one qualified (final standing: 40 `locked`, 1 `lockedAward`). So no promise was false, but the tab shows the team Locked and takes it back. Traced at 2026cthar: frc2067 is Locked (pooled) from Alliances final through Round 3, In range at Round 4 and Round 5, Locked again at Playoffs final. The blunt rule takes nothing back: 0 rows.

Cause, as measured: `pooledRemainingPoints` is the same in both runs (4,323 at every 2026cthar round stop) because `eventRemainingPool` (`packages/core/districts/pointPool.ts`) still adds the whole `PLAYOFF_POOL` while the event's Playoffs stage is open, while the settled rule has already moved the decided alliances' exact playoff points (21 at Round 4, 60 at Round 5) into their own floors. Those points are counted on both sides of the pooled test. Rounds 2 and 3 never lose a lock because the placements decided there pay 0. The Champ Locks tab passes no pooled argument, so this is the District tab only. Quick task 261009-uhb is the fix; it is NOT made here.

The 41 rows (R5 alone unless marked):
2023fit 2023txama frc5427 frc5431; 2023txcle frc7506; 2023txsan frc9128. 2023ont 2023ontor frc1241 (R4 and R5). 2024fim 2024midet frc815 frc4779; 2024mimtp frc2337 frc8424. 2024fit 2024txama frc9121 frc9136 frc9140. 2024fma 2024njwas frc9094. 2024ne 2024rikin frc8085. 2025chs 2025vaale frc2534. 2025fit 2025txsan frc3310. 2025fma 2025paben frc222. 2025pch 2025gagwi frc1833. 2026fim 2026mibig frc3767 frc6753 frc7160; 2026mifen frc503 frc6637 frc11386 (R4 and R5); 2026miwmi frc3175 frc9210 (R4 and R5). 2026ne 2026cthar frc2067 (R4 and R5); 2026mawor frc228 frc7153 (R4 and R5); 2026nhdur frc1119. 2026win 2026wiapp frc1306; 2026wimuk frc3197.

**3. The yardstick, CONFIRMED by the orchestrator 2026-10-09.** D1 names the artifact's `districtLock.status` and also "the outcome rules `measureLedgerTenets.ts` already uses". On this machine the two disagree: every file in `data/local-publish/districts` was written 2026-09-25, before quick task 261007-il9, so its `districtLock.status` still ranks the all tier total (2026fnc frc10107: 63 district tier points, published `eliminated` against a 76 point all tier line, `locked` in the district tier final standing). Scored against that field the sweep reads 226 tenet A and 263 tenet B rows in the BLUNT run and 241 and 269 in the settled run, over 254 differing teams in 39 of the 48 seasons, which is the same two yardstick disagreement `measureLedgerTenets.ts` documents in its header. The decision: score against `districtTierFinalVerdicts(artifact)`, the shipped district sweep's own default, and print the published field's counts as a census that never moves the exit code. The script header states this.

**4. The D2 pin reads the LOCAL 2026pnw artifact, gated, not the committed fixture (kept by the orchestrator).** `data/fixtures/phase10/district-2026pnw.json` carries no state blocks, so every category reads open at Now and `districtStageAtPosition` keeps every rewound stop open: no Locked display exists to pin. The pin is 2026waahs at Round 3: no tied row, and the 12 settled rows there pay 0, so it does not move when quick task 261009-tx8 changes tie routing or when 261009-uhb corrects the pooled pool.

**5. Sibling tasks in this checkout.** 261009-uhb is the lock math fix this sweep gates; it must not be started inside this task. 261009-tx9 is planned against `scripts/measureChampJointLocks.ts`; this plan only imports its existing exports. 261009-tx8 (B4) will make tied playoff sets route: 13 swept events carry a tied row, 12 of them in the Finals (which no round stop reads) and one in a semifinal (`2023ncash` sf12, tie then red), so after tx8 lands only 2023fnc's 2023ncash Round 4 and Round 5 numbers can move.
</planner_findings>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/261009-txb-district-locks-settled-playoffs-sweep-wi/261009-txb-CONTEXT.md
@.claude/CLAUDE.md

<interfaces>
Existing contracts (read these signatures, do not re-explore the files):

```ts
// scripts/measureLedgerTenets.ts (all exported: import, never copy)
export const LOCAL_DISTRICT_DIR = "data/local-publish/districts";
export function loadDistrictArtifacts(dir: string): { artifacts: readonly DistrictArtifact[]; skippedNoCapacity: readonly string[]; indexFilesSeen: number }; // all 109 seasons, schema validated, 0.2 s; filter on artifact.year
export function districtTierFinalVerdicts(artifact: DistrictArtifact): ReadonlyMap<string, LockStatus>; // THE YARDSTICK
export function publishedFinalVerdicts(artifact: DistrictArtifact): ReadonlyMap<string, LockStatus>;    // districtLock.status: census only
export function outcomeForLockedShown(finalStatus: LockStatus): LedgerTenetOutcome;    // locked kept, lockedAward award-qualified-at-now, anything else violation
export function outcomeForLockedOutShown(finalStatus: LockStatus): LedgerTenetOutcome; // eliminated kept, locked violation, lockedAward award-qualified-at-now, else unresolved-tie-at-now
// sweepDistrict, about lines 480 to 500: the eventsByKey and nowStageByEvent memos (first team seen wins) and the timeline call to reproduce

// scripts/measureChampJointLocks.ts (already exported; DO NOT EDIT THIS FILE)
export const CORPUS_PATH = "data/corpus.sqlite";
export function bracketFromCorpus(db: Corpus, alliancesBySeason: Map<number, ReturnType<typeof selectEventAlliancesForSeason>>, season: number, eventKey: string): BracketSourceEvent | undefined;
// undefined means no alliances in the corpus; matches are the sf and f rows; actualWinner is "red" | "blue" | "tie"
// dcmpStops (about lines 117 to 162) and statusesAtStop (170 to 212) are the two shapes this script mirrors at the district tier

// packages/corpus/db.ts
export function openCorpusReadOnly(path: string): Corpus;
export function selectEventAlliancesForSeason(db: Corpus, season: number): Map<string, EventAllianceSelection[]>;

// packages/core/districts/bracket.ts
export function bracketSetIdFor(compLevel: string, setNumber: number): string | undefined; // "sf1" to "sf13", "f"
export function bracketRoundOfSet(setId: string): number | undefined;                       // 1 to 5; undefined for "f"
export function bracketDecisionsFromPlayedMatches(matches: readonly PlayedBracketMatch[]): ReadonlyMap<string, number>;
export function routePlayedBracket(decisions: ReadonlyMap<string, number>): PartialBracketRouting; // throws InvalidBracketDecisionError on a mis mapped row
export class InvalidBracketDecisionError extends Error {}
// Round 1 pairings by alliance number: sf1 1 v 8, sf2 4 v 5, sf3 2 v 7, sf4 3 v 6

// apps/web/src/components/districts/districtLedgerRows.ts
export interface BracketSourceEvent { alliances?: readonly { allianceNumber: number; picks: readonly string[] }[]; matches: readonly { matchKey: string; compLevel: string; setNumber: number; matchNumber: number; redTeams: readonly string[]; blueTeams: readonly string[]; actualWinner?: "red" | "blue" | "tie" }[] }
export function playedBracketMatchesFor(artifact: BracketSourceEvent, onlyMatchKeys?: ReadonlySet<string>): { matches: readonly PlayedBracketMatch[]; unresolvedMatchKeys: readonly string[] };
export function dcmpBracketMilestonesByTeam(alliances: readonly SuppliedAlliance[], playedMatches: readonly PlayedBracketMatch[]): ReadonlyMap<string, AllianceBracketMilestone>; // tier free despite its name
export interface DistrictEventDistributions { eventKey: string; byTeam: ReadonlyMap<string, ...>; playoffMilestoneByTeam?: ReadonlyMap<string, AllianceBracketMilestone>; /* the rest optional */ }
export function buildDistrictLedgerRows(options: { artifact: DistrictArtifact; distributions: ReadonlyMap<string, DistrictEventDistributions>; stageByEvent?: ReadonlyMap<string, DistrictStageFinality> }): { teams: readonly DistrictLedgerTeam[]; gaps: DistrictLedgerGaps };
// DistrictLedgerTeam.rows[n].settledElim?: { points: number; exact: boolean; ceiling: number }
export function districtTierEvents(team): DistrictTierEventEntry[]; // eventKey, eventName, week, state
export function deriveStageFromState(state): { final: DistrictStageFinality; started: boolean; finished: boolean; stateKnown: boolean };

// apps/web/src/components/districts/districtTimeline.ts
export function buildDistrictTimeline(options: { events: readonly { eventKey: string; eventName: string; week: number | null }[]; eventArtifacts: ReadonlyMap<string, EventArtifact> }): DistrictTimeline;
// timeline.positions[i].step?: { kind: "qualsDone" | "alliance" | "playoffs" | "awards" | "match" | "round"; eventKey: string }; timeline.nowIndex
export function districtStageAtPosition(timeline: DistrictTimeline, positionIndex: number, nowStageByEvent: ReadonlyMap<string, DistrictStageFinality>): Map<string, DistrictStageFinality>;

// apps/web/src/components/districts/districtLedgerStatus.ts
export function computeDistrictLedgerStatuses(options: { artifact: DistrictArtifact; teams: readonly DistrictLedgerTeam[] }): DistrictLedgerStatusModel;
// model.byTeam: Map<teamKey, { teamKey; status: "locked" | "lockedOut" | "inRange" | "outOfRange" | "prequalified" | "capacityUnknown"; byAward: boolean; verdict: LockStatus; lockedBy: LockedBy | null }>; model.pooledRemainingPoints; model.reservedSlots
```

The new script's exported contract (the tests are written against these names):

```ts
export const SWEPT_SEASONS: readonly number[]; // 2023, 2024, 2025, 2026
export interface SettledStop { readonly label: string; readonly index: number; readonly playedKeys: ReadonlySet<string> }
export function settledStops(timeline: DistrictTimeline, eventKey: string, bracket: BracketSourceEvent): SettledStop[];
export function bracketSkipReason(bracket: BracketSourceEvent | undefined): string | undefined; // undefined means sweepable
// TENET D, pure: the stops in order, each with the teams shown Locked there (on points or by award).
// One row per (team, later stop) at which a team Locked at an earlier stop is not Locked; a team taken back at two stops gives two rows.
export function takeBackRows(stops: readonly { readonly label: string; readonly locked: ReadonlySet<string> }[]): { readonly teamKey: string; readonly stop: string; readonly firstLockedStop: string }[];
export interface SettledDistrictContext { readonly timeline: DistrictTimeline; readonly nowStageByEvent: ReadonlyMap<string, DistrictStageFinality>; readonly eventKeys: readonly string[] }
export function settledDistrictContext(artifact: DistrictArtifact): SettledDistrictContext;
export function statusesAtSettledStop(artifact: DistrictArtifact, context: SettledDistrictContext, eventKey: string, stop: SettledStop, bracket: BracketSourceEvent, withSettled: boolean): { readonly statuses: DistrictLedgerStatusModel; readonly teams: readonly DistrictLedgerTeam[] };
export interface SettledViolation { readonly tenet: "A" | "B" | "C" | "D"; readonly run: "blunt" | "settled"; readonly districtKey: string; readonly eventKey: string; readonly stop: string; readonly teamKey: string; readonly finalStatus: LockStatus; readonly publishedStatus: LockStatus; readonly lockedBy: string | null; readonly firstLockedStop?: string /* tenet D only */ }
export function sweepSettledEvent(artifact: DistrictArtifact, context: SettledDistrictContext, eventKey: string, bracket: BracketSourceEvent, finalVerdicts: ReadonlyMap<string, LockStatus>): SettledEventSweep; // { eventKey, stops: SettledStopRecord[], takeBackBlunt: number, violations: SettledViolation[] }
export function sweepSettledDistrict(artifact: DistrictArtifact, bracketFor: (eventKey: string) => BracketSourceEvent | undefined, finalVerdicts?: ReadonlyMap<string, LockStatus>): SettledDistrictSweep; // default districtTierFinalVerdicts(artifact)
export async function main(argv?: readonly string[]): Promise<void>;
```
</interfaces>
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: The settled playoffs sweep end to end with tenets A to D, its unit tests and the 2026waahs pin, landed with its known failure printed (D1, D2)</name>
  <files>scripts/measureLedgerSettledTenets.ts, scripts/measureLedgerSettledTenets.test.ts, package.json</files>
  <precondition>`data/corpus.sqlite` and `data/local-publish/districts/v1__district__2026pnw.json` exist in the main checkout (gitignored local data; worktrees are off).</precondition>
  <read_first>
    - .planning/quick/261009-txb-district-locks-settled-playoffs-sweep-wi/261009-txb-CONTEXT.md (D1 to D3)
    - This plan's planner_findings 1 and 2 (the pre-registered table and the 41 rows the full run must reproduce)
    - scripts/measureChampJointLocks.ts lines 1 to 215 (header shape, `dcmpStops`, `statusesAtStop`) and 628 to 775 (`bracketFromCorpus`, the report helpers, `main`, the entry guard). Read only: do not edit this file.
    - scripts/measureLedgerTenets.ts lines 226 to 300 and 386 to 540 (loader, the two yardsticks, the outcome rules, the `sweepDistrict` memos and its per team status branch). Skip the 225 line header.
    - scripts/measureChampJointLocks.test.ts lines 1 to 30 and 78 to 105 (the gating idiom with an explicit `it.skip` message)
  </read_first>
  <behavior>
    - Stop builder, synthetic, no local data: a timeline from `buildDistrictTimeline` over two invented events with an empty artifact map, and an invented eight alliance bracket for the second event with played rows for sf1 to sf10 only plus one `f` row. `settledStops` returns the labels Alliances final, Round 1, Round 2, Round 3, Playoffs final, awards open, in that order. The first four share the index of the position whose step kind is `alliance` for that event and the last sits at its `playoffs` step. The played key counts are 0, 4, 8, 10 and 11: a round with no played row has no stop, and the `f` row joins only the last stop.
    - Skip reasons, synthetic: `bracketSkipReason(undefined)` is `no alliances in the corpus`; seven alliances gives a reason starting `not an eight alliance bracket`; eight alliances with no played sf or f row gives `no played playoff rows in the corpus`; an sf1 row won by alliance 3 (sf1 is 1 against 8) gives a reason starting `bracket does not route`; a well formed Round 1 gives undefined.
    - No take back (tenet D), synthetic: `takeBackRows` over five ordered stops whose Locked sets are {a}, {a, b}, {b}, {a, b} and the empty set returns exactly three rows: a at the third stop with first Locked stop the first, a at the fifth with the first, and b at the fifth with first Locked stop the second. A team Locked at every stop and a team Locked at none give no row.
    - 2026waahs pin, gated on the local 2026pnw artifact AND the corpus with an explicit `it.skip` message when either is absent: the seven stop labels of D1; at Round 3 Locked on points is 29 blunt and 31 settled, the gained set is exactly frc1983 and frc2926, nobody is lost; Locked out is 51 blunt and 56 settled with exactly frc2906, frc2929, frc4173, frc4682 and frc949 gained; the settled run carries 12 settled rows, all `exact`, summing 0 points; at Alliances final (29 and 51) and at Playoffs final, awards open (37 and 71) the two runs are identical; `sweepSettledEvent` against `districtTierFinalVerdicts` returns no violation of any tenet for the event and `takeBackBlunt` 0.
    - The checker can fail, same gate: with a copy of the yardstick in which frc1983 reads `eliminated`, `sweepSettledEvent` for 2026waahs returns at least one violation, every one of them tenet A naming frc1983, one of them at Round 3 in the settled run and none at Round 3 in the blunt run.
    - NOT in this task: any test that calls `main` on the real data. It is added by Task 2, after quick task 261009-uhb.
  </behavior>
  <action>
Write the test file first and watch it fail on the missing module, then write the script. The pinned values are the planner's prototype of the tab's own functions at HEAD 9e979118; if the implementation differs, check the inputs first (same position index for every round stop, played keys by round, the one event distributions map) and never change a rule to meet a pin.

Create `scripts/measureLedgerSettledTenets.ts` with the exports listed in the interfaces block, the header doc and entry guard in the shape of `measureChampJointLocks.ts`. The header states: what is measured and why (the shipped sweeps pass no bracket facts); the four tenets (A, B and C of D1, and D, no take back, with Jacob's sentence "no team is told they are locked at any stop, and then later they are not locked"); the two runs; the stops; THE YARDSTICK DECISION (confirmed 2026-10-09): the district tier final standing scores the tenets, the shipped district sweep's own default, and the published `districtLock.status` is a census that never moves the exit code, because the local artifacts predate quick task 261007-il9 and that field ranks the all tier total on them; THE COVERAGE LIMIT: every settled row a finished season can produce is the exact kind, so the live mid playoffs branch of `settledPlayoffPoints` is not covered; the sources (read only, no network, no credential); usage; exit code 1 on any tenet A, B, C or D violation. Add one dated sentence for the first run (2026-10-09: tenets A and B zero, tenets C and D 41 rows each on the same team stops, the pooled pool counting settled playoff points twice, fixed by quick task 261009-uhb) and leave every other total to the SUMMARY (D3).

`settledDistrictContext(artifact)`: the two memos exactly as `sweepDistrict` builds them (per `districtTierEvents` entry, first team seen wins: the event's key, name and week, and `deriveStageFromState(entry.state).final` as its Now stage), then `buildDistrictTimeline` over those events with an EMPTY event artifact map, as both shipped sweeps do. `eventKeys` is the event keys sorted.

`settledStops(timeline, eventKey, bracket)`: `dcmpStops`' rule at the district tier, per D1. Find the position whose step kind is `alliance` for the event; there, one stop labelled `Alliances final` with no played keys, then for each round 1 to 5 that has at least one row with a defined `actualWinner`, a stop labelled `Round n` at the SAME index whose played keys are the rows with a defined `actualWinner` in rounds 1 to n (`bracketSetIdFor` then `bracketRoundOfSet`; a row with no round, the final included, never joins a round stop). Then, at the position whose step kind is `playoffs` for the event, a stop labelled `Playoffs final, awards open` with every played sf and f row. No Now stop (D1 lists none).

`bracketSkipReason(bracket)`: the four reasons of the behavior block, in that order of testing. Does not route means `routePlayedBracket(bracketDecisionsFromPlayedMatches(playedBracketMatchesFor(bracket).matches))` throws `InvalidBracketDecisionError` (rethrow anything else). A bracket that routes without deciding every placement (a tied row at HEAD) is swept, not skipped, and counted in the census.

`takeBackRows(stops)`: pure, as the interfaces block states. Walk the stops in order keeping, per team, the label of the first stop at which it was Locked; at each stop every team that has such a label and is not in the stop's Locked set gives one row.

`statusesAtSettledStop(...)`: `districtStageAtPosition(timeline, stop.index, nowStageByEvent)`, then `buildDistrictLedgerRows` with that stage map (keep the shipped sweeps' `atNow ? undefined : stageByEvent` expression) and then `computeDistrictLedgerStatuses`. With `withSettled` false the distributions map is empty (the blunt rule, as today's sweep). With it true the map holds ONE entry, for this event only: `eventKey`, an empty `byTeam`, and `playoffMilestoneByTeam` from `dcmpBracketMilestonesByTeam(alliances, playedBracketMatchesFor(bracket, stop.playedKeys).matches)`. Every other event sits where the timeline puts it, with no bracket facts. Return the status model and the built teams.

`sweepSettledEvent(...)`: per stop, in the order `settledStops` returns them, both runs. Count Locked on points (status `locked`, `byAward` false) and Locked out (status `lockedOut`) in each run; gained and lost are the set differences of the two Locked on points sets; count the settled run's rows carrying `settledElim`, how many are `exact`, and their points sum; keep each run's `pooledRemainingPoints`.
- Tenet A: each Locked on points display in EITHER run whose `outcomeForLockedShown(finalVerdicts.get(teamKey) ?? "unknown")` is `violation`.
- Tenet B: each Locked out display in either run whose `outcomeForLockedOutShown` is `violation`. The other two outcomes are counted under their own names and never scored, exactly as `measureLedgerTenets.ts` does.
- Tenet C: each team whose blunt status is `locked` (either chip) and whose settled status is not, recorded with run `settled` and the BLUNT run's `lockedBy`.
- Tenet D: `takeBackRows` over the SETTLED run's per stop Locked sets (status `locked`, on points or by award). Each row is a violation with run `settled`, the later stop as its stop, `firstLockedStop`, and as `lockedBy` how the team was Locked at that first stop (`award` for the award chip, else the result's `lockedBy`). The same helper over the BLUNT run's sets gives `takeBackBlunt`, a reference count that is reported, never recorded as a violation and never moves the exit code.
- Also count, without scoring, teams Locked out under blunt and not under settled, and the displays the published field would score as a violation per tenet and run.
Every violation carries district, event, stop label, team, the yardstick's verdict, the published `districtLock.status` and `lockedBy`.

`sweepSettledDistrict(artifact, bracketFor, finalVerdicts = districtTierFinalVerdicts(artifact))`: for each event key of the context, `bracketSkipReason(bracketFor(eventKey))` either records a skipped event with its reason or sweeps it. It also counts the teams on which `publishedFinalVerdicts` and the yardstick differ.

`main(argv)`: when `CORPUS_PATH` is absent print `skipped: data/corpus.sqlite is absent` and return (exit 0). Otherwise open it with `openCorpusReadOnly` and close it in a `finally`; `loadDistrictArtifacts(LOCAL_DISTRICT_DIR)`, keep `SWEPT_SEASONS` (a null dcmpSlots season of those years is listed by name as skipped, no capacity); `--district <districtKey>` keeps one district; `--json` prints the sweeps, the skipped list, the violations and the seconds as JSON. The text report prints a title block naming the four tenets, the yardstick and the sources; a PER SEASON table (districts, events swept, stops, Locked on points blunt, settled, gained, lost, Locked out blunt, settled, take back under the blunt rule, violations A, B, C, D) with an all seasons row; a CENSUS block (award qualified and unresolved tie outcomes per run, settled rows with the exact and not exact split, events with an unresolved playoff row, events whose bracket does not decide all eight placements, Locked out lost, teams on which the published field differs and the rows it would score per tenet and run, seconds); `SKIPPED (n)` with one line per event and its reason; then exactly `VIOLATIONS: none`, or `VIOLATIONS (n)` with one line per violation (tenet, run, district, event, stop, team, verdict in the final standing, published status, `lockedBy`, and for tenet D the first Locked stop). Set `process.exitCode = 1` when any tenet A, B, C or D violation exists.

`package.json`: add one line, `"measure:ledger-settled-tenets": "tsx scripts/measureLedgerSettledTenets.ts"`, directly after the `measure:ledger-tenets` line. No env file flag: the script reads no credential.

Run the verify command BEFORE committing, and keep the full run's whole report for the SUMMARY (D3). Three things must hold.
1. The 2026pnw run prints 8 events swept, 56 stops, Locked on points 351 and 360, Locked out 665 and 697, 412 settled rows all exact, take back 0 and `VIOLATIONS: none`.
2. The full run reproduces planner finding 1's PER SEASON table and finding 2's table, prints `VIOLATIONS (82)` (41 tenet C rows and 41 tenet D rows, on the 41 team stops finding 2 lists, every one `lockedBy` `pooled`), zero tenet A and tenet B rows, take back 0 under the blunt rule, and `FULL_SWEEP_EXIT=1`. That exit code is the KNOWN, PRINTED, EXPECTED failure this task lands with (sequencing decision): do not treat it as a failed task, do not move tenet C or D out of the exit code, and do not edit any lock math or any file under `apps/` or `packages/`.
3. Record `git rev-parse --short HEAD` and whether a 261009-tx8 or 261009-uhb commit is in `git log --oneline -30`. With tx8 landed only the 2023 row may differ, through 2023ncash Round 4 and Round 5. With uhb landed the tenet C and D rows may be gone. ANY other difference from the pre-registered numbers, and any tenet A or tenet B row, means the script differs from the prototype or a new defect exists: do not commit, report the differing numbers and rows, and never adjust the script to match.

Then stage by explicit path (`git add scripts/measureLedgerSettledTenets.ts scripts/measureLedgerSettledTenets.test.ts package.json`), confirm `git diff --cached --stat` lists exactly those three files and that the staged `package.json` diff is the one added line (other sessions share this checkout; if `package.json` carries someone else's edit, stop and report instead of committing it), commit `feat(261009-txb): a corpus gated sweep runs the District Locks status code at every playoff round stop, blunt and settled, with a no take back tenet`, and run `git status --short` after. A full suite failure in a file this task did not touch, while `git status --short` shows another session's paths, is reported, not fixed. Do not push. Do not commit anything under `.planning/`. Do not start Task 2.
  </action>
  <verify>
    <automated>npx vitest run scripts/measureLedgerSettledTenets.test.ts && npx tsx scripts/measureLedgerSettledTenets.ts --district 2026pnw && npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && npx vitest run && echo TXB_TASK1_OK; npx tsx scripts/measureLedgerSettledTenets.ts; echo "FULL_SWEEP_EXIT=$?"</automated>
  </verify>
  <done>The test file's five groups pass and the two gated ones RAN on this machine (read the vitest counts, not the exit code; never `timeout <n> pnpm`); the 2026pnw run prints 8 events, 56 stops, 351 and 360, 665 and 697, `VIOLATIONS: none`; the three typechecks are clean and the full root `npx vitest run` passes, so `TXB_TASK1_OK` is printed; the full run reproduces planner finding 1's table, prints the 41 tenet C and 41 tenet D rows of finding 2 with zero tenet A and B rows and take back 0 under the blunt rule, and `FULL_SWEEP_EXIT=1` is printed because of them; the test file holds no test that calls `main` on the real data; one commit holds exactly the three files; `git diff --name-only HEAD~1 HEAD` names no file under `apps/` or `packages/` and not `scripts/measureChampJointLocks.ts`; the report to the orchestrator carries the full run's tables and violation rows.</done>
</task>

<task type="auto">
  <name>Task 2 (deferred: run only after quick task 261009-uhb has landed): the four season acceptance at zero tenet A, B, C and D violations (D2, D3)</name>
  <files>scripts/measureLedgerSettledTenets.test.ts, scripts/measureLedgerSettledTenets.ts, .planning/todos/pending/locks-settled-playoffs-follow-ups.md</files>
  <precondition>`git log --oneline --grep 261009-uhb` shows the pooled pool fix on this branch AND `git log --oneline --grep 261009-txb` shows Task 1's commit AND `scripts/measureLedgerSettledTenets.ts` exists AND `data/corpus.sqlite` and `data/local-publish/districts` exist in the main checkout. If the fix has not landed, do not run this task: report that and stop.</precondition>
  <read_first>
    - This plan's objective and planner_findings 1, 2 and 5: the baseline Task 1 landed with (36,982 Locked on points blunt, 37,408 settled, 467 gained, 41 lost; 41 tenet C and 41 tenet D rows; take back 0 under the blunt rule)
    - .planning/quick/261009-txb-district-locks-settled-playoffs-sweep-wi/261009-txb-SUMMARY.md if it exists (Task 1's tables as executed, which outrank the planner's where they differ)
    - scripts/measureLedgerSettledTenets.test.ts (whole: the gating idiom with an explicit `it.skip` message that the new test mirrors)
    - scripts/pruneCancelledEvents.test.ts lines 82 to 124 (saving, clearing and restoring `process.exitCode` around `main`, and the console spy)
    - .planning/todos/pending/locks-settled-playoffs-follow-ups.md (item 2)
  </read_first>
  <action>
This task is self contained: it needs nothing from the session that ran Task 1. It makes no change to lock math and none to the checks.

Run `npx tsx scripts/measureLedgerSettledTenets.ts` once, keep the whole report for the SUMMARY (D3), and record `git rev-parse --short HEAD` and whether a 261009-tx8 commit is in `git log --oneline -40`.

ACCEPTANCE is the report's last block reading `VIOLATIONS: none` with exit 0: zero tenet A, B, C and D rows. Beside it, compare with the baseline and report every number that differs, never fitting anything: events 418 and stops 2,926 are unchanged; the blunt columns (Locked on points 36,982, Locked out 82,092, take back 0) are unchanged, because the fix reads settled facts only; lost is 0; Locked on points under the settled rule is at or above 37,449 (the baseline's 37,408 plus the 41 restored). With 261009-tx8 landed the 2023 row may also differ through 2023ncash. A blunt column that moved for any other reason is reported as a finding and is not a reason to edit anything here.

If ANY violation remains (exit 1): STOP. The fix is incomplete or a new defect exists. Do not add the `main` test, do not strike the todo, do not edit lock math, any file under `apps/` or `packages/`, or the checks. Report every violation row (tenet, run, district, event, stop, team, verdict in the final standing, published `districtLock.status`, `lockedBy`, and for tenet D the first Locked stop), the PER SEASON table and the CENSUS block. A tenet A or tenet B row is reported first.

On acceptance:
1. Add the last D2 test to `scripts/measureLedgerSettledTenets.test.ts`, gated on the corpus and the local district directory with an explicit `it.skip` message: `main([])` with the console spied leaves `process.exitCode` unset, using the save, clear and restore pattern of `scripts/pruneCancelledEvents.test.ts`, with a 60 second timeout.
2. In the header of `scripts/measureLedgerSettledTenets.ts`, after the dated first run sentence, add one dated sentence with the acceptance run's totals (events, stops, Locked on points blunt and settled, zero violations of all four tenets after quick task 261009-uhb). Header comment only: no code change.
3. Edit item 2 of `.planning/todos/pending/locks-settled-playoffs-follow-ups.md` to read CLOSED by quick task 261009-txb, with the all seasons totals line and the note that the sweep found the pooled pool take back that quick task 261009-uhb fixed. Do not commit it: the orchestrator commits `.planning/`.
4. Run the verify command. Stage `scripts/measureLedgerSettledTenets.test.ts` and `scripts/measureLedgerSettledTenets.ts` by explicit path, confirm `git diff --cached --stat` lists exactly those two files, commit `feat(261009-txb): the settled playoffs sweep is pinned at zero violations on the real data`, run `git status --short`. Do not push.
  </action>
  <verify>
    <automated>npx tsx scripts/measureLedgerSettledTenets.ts && npx vitest run scripts/measureLedgerSettledTenets.test.ts && npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && npx vitest run && echo TXB_ACCEPTED</automated>
  </verify>
  <done>The sweep prints `VIOLATIONS: none` over 2023 to 2026 with zero tenet A, B, C and D rows and take back 0 under the blunt rule, and exits 0; the gated `main` test is in the test file and RAN (read the vitest counts); the three typechecks are clean; the full root `npx vitest run` passes (read the totals, never `timeout <n> pnpm`); `TXB_ACCEPTED` is printed; item 2 of the todo reads CLOSED; one commit holds exactly the test file and the script, and the script's diff is comment lines only. If a violation remained, the task is NOT done: nothing was committed, the todo is untouched, and the violation report was delivered.</done>
</task>

</tasks>

<verification>
After Task 1 (now):
- `git diff --name-only <pre task HEAD>..HEAD` lists only `scripts/measureLedgerSettledTenets.ts`, `scripts/measureLedgerSettledTenets.test.ts` and `package.json`. Nothing under `apps/`, `packages/` or `.planning/`, and not `scripts/measureChampJointLocks.ts` or `scripts/measureLedgerTenets.ts`.
- `npx vitest run scripts/measureLedgerSettledTenets.test.ts`: the three synthetic groups pass anywhere; the two gated groups ran here; no test calls `main` on the real data.
- `npx tsx scripts/measureLedgerSettledTenets.ts --district 2026pnw` prints `VIOLATIONS: none` and exits 0.
- `npx tsx scripts/measureLedgerSettledTenets.ts` over all four seasons reproduces planner findings 1 and 2 and exits 1 on the 41 tenet C and 41 tenet D rows: the known, printed, expected failure.
- The three typechecks are clean and the full root `npx vitest run` passes. Verify by the printed counts, never by an exit code alone and never through `timeout <n> pnpm ...`.

After Task 2 (only once quick task 261009-uhb has landed):
- The same full run prints `VIOLATIONS: none` and exits 0; the `main` exits 0 test is committed and ran; todo item 2 reads CLOSED.

Always:
- `.env` is never read, printed or passed to a command: the script needs no credential.
- Nothing is pushed, and no lock math is edited by this task.
</verification>

<success_criteria>
- The sweep of D1 exists with tenets A to D, runs the tab's own functions with real bracket facts, and is the gate quick task 261009-uhb proves itself against.
- Task 1 ends with the sweep committed, its unit tests green, and its four season result printed and reported as the pre-registered failure: zero A and B, 41 C, 41 D under the settled rule, 0 take backs under the blunt rule.
- Task 2 ends, after the fix, with zero violations of all four tenets, the `main` exits 0 test committed, and todo item 2 closed. D3's acceptance bar is met only then.
- The SUMMARY states the coverage limit: every settled row is the exact kind, and the live mid playoffs branch is not reachable from finished seasons.
</success_criteria>

<output>
After Task 1 produce `.planning/quick/261009-txb-district-locks-settled-playoffs-sweep-wi/261009-txb-SUMMARY.md` with status "Task 1 complete, Task 2 pending on quick task 261009-uhb" and no `requirements_completed` yet. It carries the full PER SEASON table, the CENSUS block, the 82 violation rows, the HEAD the run was made at, the differences from the pre-registered numbers, and the coverage limit. After Task 2 the same file gains the acceptance run's tables and `requirements_completed: [261009-txb]`. If the harness blocks writing a SUMMARY.md from a subagent, return the full SUMMARY text to the orchestrator instead; do not route around the block through Bash. Never commit `.planning/` files; worktrees are off; stage by explicit path; check `git status` after each commit; do not push.
</output>
