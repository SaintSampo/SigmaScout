/**
 * Measures Jacob's two District Locks tenets over every published
 * district season, at every stage position the tab's rewind rail can land on.
 *
 * ---------------------------------------------------------------------------
 * THE TWO TENETS, IN JACOB'S OWN WORDS (2026-09-25)
 * ---------------------------------------------------------------------------
 *
 *   "No team that ever is displayed as 'locked' should ever fail to qualify on
 *   points; no team that is ever displayed as 'locked out' should ever end up
 *   qualifying on points."
 *
 * A status word on that tab is a PROMISE. `Locked` says the slot is already
 * guaranteed; `Locked out` says it is already gone. Both are made from a floor
 * and a ceiling recomputed at the rewound position, against a `dcmpSlots`
 * capacity and an award-consumed slot count that are themselves rewound — and
 * that last part is what makes the tenets non-trivial rather than a
 * monotonicity argument on paper. Rewinding LOWERS every floor and RAISES every
 * ceiling, which on its own can only make locking harder; but rewinding also
 * un-awards Impact, and each un-awarded Impact hands a slot back to the points
 * pool, which makes locking easier. The two effects point in opposite
 * directions, so only a measurement settles it.
 *
 * THE FIRST RUN OF THIS SWEEP (2026-09-25) FOUND THIRTEEN TENET-A VIOLATIONS,
 * every one of them an un-awarded Impact handing its slot back. Quick task
 * 260925-ms7 closed that by HOLDING BACK one points slot for every
 * district-tier event whose Impact award is still to come
 * (`packages/core/districts/reservedSlots.ts`), and this sweep is what proves
 * it: tenet A now measures ZERO. The size of the reservation is reported in
 * the census below, so a future reader can watch it fire rather than infer it
 * from an absence of failures.
 *
 * THIS SWEEP IS ALSO WHAT LICENSED THE POOLED REMAINING-POINTS LOCK (quick
 * task 260925-pl6). That argument locks a team when no achievable distribution
 * of the district's remaining points could lift enough rivals past it, which
 * makes MORE teams read `Locked` and therefore makes MORE promises. Measured
 * here: 213 more team-positions read `Locked` across 110 of the 4,022 swept
 * positions, and both tenets stayed at zero. The census carries those two
 * counts and the size of the pool beside them, for the same reason the
 * reservation's own numbers are there — so a reader can watch the argument
 * fire rather than take an unchanged zero on trust. (213 and 110 were measured
 * under the floor shipped then; the next paragraph has today's counts.)
 *
 * THE FLOOR AND THE YARDSTICK BOTH CARRIED CHAMPIONSHIP POINTS UNTIL QUICK TASK
 * 261005-04t (2026-10-05). `pointTotal` is TBA's ALL TIER total, so once a
 * District Championship had been played every team's championship points sat
 * in the District tab's lock floor at every position, AND in the publisher's
 * `districtLock.status` this sweep scored against. Both sides knew who played
 * the championship, so they agreed with each other and the sweep read zero
 * while a rewound week one view was calling teams `Locked` on points earned two
 * months later. The displays now come from a district tier floor
 * (`districtLockBounds`) and the yardstick is the district tier final standing
 * (`districtTierFinalVerdicts`), which carries no championship points either.
 *
 * Measured over the same 109 seasons, 4,022 positions and 921,658 team
 * positions, before and after:
 *
 *   `Locked` on points shown   130,718 -> 77,115  (kept 75,950, award 1,165)
 *   `Locked out` shown         190,854 -> 167,333 (kept 167,288, award 45)
 *   `Locked · award` chip       24,192 -> 24,192
 *   pooled only locks              213 -> 6,552, at 110 -> 1,074 positions
 *   slots held back             26,604 -> 26,604, at 3,804 positions
 *   tenet A, tenet B, unresolved ties: 0, 0, 0
 *
 * Fewer promises, and every one of them kept. The pooled argument now carries
 * far more of the `Locked` displays, because without championship points the
 * gaps between teams are small beside what one event can still hand out, which
 * is exactly the case the ceiling test cannot reach.
 *
 * AGAINST THE PUBLISHER'S VERDICT (`publishedFinalVerdicts`, passed as the
 * second argument) the same sweep reports 571 tenet A and 477 tenet B rows.
 * None of them is a broken promise on this tab. They are two yardsticks
 * disagreeing: over places a team earned and gave up, over teams that played
 * the championship from below the line, and over ties the all tier total
 * happens to break. Bringing the publisher onto the district tier floor is
 * todo `publisher-district-lock-all-tier-total`.
 *
 * THIS SWEEP READS THE RAW VERDICT MODEL ONLY. It calls
 * `computeDistrictLedgerStatuses` and does not import `districtFieldOverlay`:
 * the tenets are about the guarantee, and the Live overlay shows the field.
 *
 * ---------------------------------------------------------------------------
 * "QUALIFIED ON POINTS" IS THE DISTRICT TIER FINAL STANDING
 * ---------------------------------------------------------------------------
 *
 * The final outcome is `districtTierFinalVerdicts(artifact)`: the tab's own
 * verdict for every team with every district tier category final, on district
 * tier points alone. It is the site's own answer to "who earned a place at the
 * District Championship", recomputed through the same modules the displays
 * came from, so a violation is a promise the tab broke to itself. It is NOT
 * `team.districtLock.status`, which ranks the all tier total (see above), and
 * it is NOT the verdict at the `now` position, which leaves an event open
 * wherever its recorded state does not read finished (see
 * `districtTierFinalVerdicts`). The outcome names below still say "at now" for
 * the history's sake; read them as "in the final standing". Its four reachable
 * values are NOT two buckets:
 *
 *   - `locked`       -> qualified ON POINTS.
 *   - `lockedAward`  -> qualified, by an AWARD rather than by points. Whether
 *                       points alone would ALSO have sufficed is UNKNOWABLE
 *                       from the artifact, because `computeLocksWithQualifiers`
 *                       short-circuits every award qualifier before the points
 *                       math runs and its own doc comment says so: "a team that
 *                       is both award-qualified and points-safe still reports
 *                       lockedAward — the award is what guarantees it". So this
 *                       is an INDETERMINATE outcome, counted under its own name
 *                       and never scored as a broken promise. A `Locked` chip
 *                       shown to a team that went to the district championship
 *                       on an Impact award did not mislead anybody.
 *   - `eliminated`   -> not qualified.
 *   - `contending`   -> a tie AT the cut line that `locks.ts` deliberately
 *                       refuses to break. `threatCount(T)` counts every other
 *                       team `R` with `ceiling(R) >= floor(T)` — `>=`, not `>`,
 *                       "since a tie is settled by a tiebreaker this model does
 *                       not carry and must count as a possible loss" — and
 *                       `locked` needs `threatCount < slots`. Two teams tied
 *                       for the last slot are therefore both `contending` at
 *                       the finish and NEITHER is reported as having qualified.
 *                       Fifty of these 109 seasons end that way on district
 *                       tier points (fifteen on the publisher's all tier
 *                       total, which championship points happen to untie).
 *   - `unknown`      -> capacity not published. Cannot arise: every artifact
 *                       with a null `dcmpSlots` is skipped and counted by name.
 *
 * SO EACH DISPLAY IS SCORED INTO ONE OF FOUR OUTCOMES rather than pass/fail:
 *
 *   `Locked` (on points) shown, final verdict ...
 *     locked          -> KEPT
 *     lockedAward     -> AWARD-QUALIFIED AT NOW (indeterminate, see above)
 *     eliminated      -> VIOLATION of tenet A
 *     contending      -> VIOLATION of tenet A (never guaranteed the slot)
 *
 *   `Locked out` shown, final verdict ...
 *     eliminated      -> KEPT
 *     locked          -> VIOLATION of tenet B
 *     lockedAward     -> AWARD-QUALIFIED AT NOW (it qualified, but by an award,
 *                        which says nothing about the points claim that was
 *                        made — counted, not scored)
 *     contending      -> UNRESOLVED TIE AT NOW (told the slot was already gone,
 *                        finished alive but unresolved — a weaker broken
 *                        promise than tenet B names, counted under its own name
 *                        rather than folded into either bucket)
 *
 * The `Locked · award` chip variant is NOT tenet A's subject and is counted
 * separately: that chip's promise is "an award guarantees this", which the
 * points math never made.
 *
 * ---------------------------------------------------------------------------
 * THE BROWSER'S OWN STATUS CODE, CALLED THROUGH THE COMPONENT'S OWN WIRING
 * ---------------------------------------------------------------------------
 *
 * This script defines NO status rule. It calls the same modules
 * `apps/web/src/components/districts/DistrictLedger.tsx` calls, in the same
 * order, with the same arguments:
 *
 *   1. `districtTierEvents` over `artifact.teams` for the district's event
 *      list, and `deriveStageFromState(entry.state).final` for the `now` stage
 *      per event (first team seen wins, exactly as the component's memo does).
 *   2. `buildDistrictTimeline({ events, eventArtifacts: new Map() })`.
 *   3. `districtStageAtPosition(timeline, i, nowStageByEvent)`.
 *   4. `buildDistrictLedgerRows({ artifact, distributions, stageByEvent: atNow
 *      ? undefined : stageByEvent })` — the `atNow ? undefined` fallback is the
 *      component's own: at `now` every stage comes from the artifact's own
 *      `state` blocks and nothing is overridden.
 *   5. `computeDistrictLedgerStatuses({ artifact, teams: rows.teams })`, the
 *      RAW model. The component then lays the Live field overlay over it for
 *      display; this sweep stops here on purpose.
 *
 * All three district modules are React free: `districtLedgerStatus.ts` imports
 * only `packages/core/districts/*`, and `districtLedgerRows.ts` /
 * `districtTimeline.ts` reach `apps/web/src/lib/{liveEvent,simulationInputs,
 * teamKey}.ts`, none of which imports React or a `.tsx`.
 *
 * WHY AN EMPTY EVENT-ARTIFACT MAP IS THE RIGHT SWEEP SET, not a shortcut. With
 * no event artifacts the timeline carries no MATCH steps, so its positions are
 * exactly: season start, then each event's `qualsDone` / `alliance` /
 * `playoffs` / `awards`, then now. A within-quals position only LOOSENS both
 * ends relative to the `qualsDone` step that follows it — its floor is no
 * higher and its ceiling no lower, because the qualification category is still
 * open there and becomes final only at `qualsDone`, and the award set is
 * identical at both. A looser floor/ceiling pair at the same pool and slot
 * count can only produce FEWER `Locked` and FEWER `Locked out` displays, so no
 * promise is made inside quals that is not also made at the `qualsDone` step
 * this sweep does visit.
 *
 * WHAT THE EMPTY DISTRIBUTION MAP COSTS, stated rather than absorbed: with no
 * simulated or baked distribution for an open cell, every open cell renders
 * `unavailable`, the grand total renders `unavailable`, and a team's
 * `projection` falls back to its earned district-tier total. That changes
 * `In range` / `Out of range`, which are decided by a projection cut line — so
 * those two counts are reported for completeness and are NOT the subject of
 * either tenet. It does not touch `Locked` or `Locked out` at all: those come
 * from the floor, the ceiling, the slot count and the award set, none of which
 * reads a distribution.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIAL-FREE AND OFFLINE
 * ---------------------------------------------------------------------------
 *
 * Read-only local artifacts, no network request, no environment variable, no
 * credential. Its `package.json` entry (`measure:ledger-tenets`) deliberately
 * omits the `--env-file=.env` flag that `ingest:*` and `publish:*` carry.
 *
 * Usage:
 *   npx tsx scripts/measureLedgerTenets.ts [--dir <path>] [--json]
 *   pnpm measure:ledger-tenets
 *
 * Exits 1 when any VIOLATION exists. The indeterminate buckets never affect the
 * exit code — a tool that failed on 7,081 teams that went to the district
 * championship on an Impact award would be reporting the wrong thing loudly.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DistrictArtifactSchema, type DistrictArtifact, type EventArtifact } from "../packages/harness/pageArtifacts.js";
import type { LockStatus } from "../packages/core/districts/locks.js";
import { maxEventPoints } from "../packages/core/districts/pointModel.js";
import {
  buildDistrictLedgerRows,
  deriveStageFromState,
  districtTierEvents,
  type DistrictEventDistributions,
  type DistrictLedgerTeam,
  type DistrictStageFinality,
} from "../apps/web/src/components/districts/districtLedgerRows.js";
import { buildDistrictTimeline, districtStageAtPosition } from "../apps/web/src/components/districts/districtTimeline.js";
import {
  computeDistrictLedgerStatuses,
  districtLockBounds,
  type DistrictCategoryCeilings,
} from "../apps/web/src/components/districts/districtLedgerStatus.js";

/** 10-06's dry run wrote every published district season here. Read-only. */
export const LOCAL_DISTRICT_DIR = "data/local-publish/districts";

/**
 * The district DETAIL files alone. The two underscores after `district` are
 * load-bearing: `v1__districts__2026.json` is the per-year INDEX artifact,
 * which carries no `teams` array at all and must not be parsed as a detail.
 */
const DISTRICT_DETAIL_FILE = /^v1__district__(.+)\.json$/;

/** Nothing is fetched, so every event artifact is absent and every open cell renders unavailable — see the header. */
const NO_EVENT_ARTIFACTS: ReadonlyMap<string, EventArtifact> = new Map<string, EventArtifact>();
const NO_DISTRIBUTIONS: ReadonlyMap<string, DistrictEventDistributions> = new Map<string, DistrictEventDistributions>();

export interface LoadedDistricts {
  readonly artifacts: readonly DistrictArtifact[];
  /** District keys skipped because `dcmpSlots` is null — TBA published no capacity, so `locks.ts` reports `unknown` for every team and no promise is ever displayed. Counted out by name, never silently dropped. */
  readonly skippedNoCapacity: readonly string[];
  /** Index files (`v1__districts__{year}.json`) seen and correctly not parsed as districts. */
  readonly indexFilesSeen: number;
}

/** Reads and SCHEMA-VALIDATES every district detail artifact in `dir`. A file that fails `DistrictArtifactSchema` throws rather than being skipped. */
export function loadDistrictArtifacts(dir: string): LoadedDistricts {
  const artifacts: DistrictArtifact[] = [];
  const skippedNoCapacity: string[] = [];
  let indexFilesSeen = 0;

  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    if (!DISTRICT_DETAIL_FILE.test(file)) {
      if (file.startsWith("v1__districts__")) indexFilesSeen += 1;
      continue;
    }
    const parsed = DistrictArtifactSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
    if (parsed.dcmpSlots === null) {
      skippedNoCapacity.push(parsed.districtKey);
      continue;
    }
    artifacts.push(parsed);
  }

  return { artifacts, skippedNoCapacity, indexFilesSeen };
}

/** The two promises under test. `lockedAward` displays are neither, and are counted on their own. */
export type LedgerTenet = "A-locked-must-qualify-on-points" | "B-locked-out-must-not-qualify-on-points";

/** How one `Locked` or `Locked out` display turned out. Only `violation` fails a tenet; see the header for why the other two are not failures. */
export type LedgerTenetOutcome = "kept" | "violation" | "award-qualified-at-now" | "unresolved-tie-at-now";

export interface LedgerTenetViolation {
  readonly tenet: LedgerTenet;
  readonly districtKey: string;
  readonly year: number;
  readonly positionId: string;
  readonly positionLabel: string;
  /** The step kind the position sits on — `qualsDone` / `alliance` / `playoffs` / `awards`, or the two reserved ids. */
  readonly positionKind: string;
  readonly teamKey: string;
  /**
   * The floor and ceiling at the offending position, recomputed HERE for the
   * report line alone. They decide nothing: the status under test came entirely
   * from `computeDistrictLedgerStatuses`, and these two numbers exist so a
   * reader can see WHICH pair produced it.
   */
  readonly floor: number;
  readonly ceiling: number;
  /**
   * The team's final DISTRICT TIER total: `districtLockBounds` with no rows,
   * which is `pointTotal` minus every point earned at the District
   * Championship. The all tier `pointTotal` is not printed, because it is not
   * what either the display or the yardstick ranks.
   */
  readonly finalTotal: number;
  /** The team's final verdict in the yardstick the sweep was scored against: `districtTierFinalVerdicts` unless the caller passed another map. */
  readonly finalStatus: LockStatus;
}

export interface DistrictTenetSweep {
  readonly districtKey: string;
  readonly year: number;
  readonly teamCount: number;
  readonly eventCount: number;
  /** Stage positions swept, inclusive of season start and now. */
  readonly positions: number;
  readonly teamPositions: number;
  /** `Locked` shown WITHOUT the award note — the display tenet A governs. */
  readonly lockedPointsShown: number;
  readonly lockedKept: number;
  readonly lockedAwardQualifiedAtNow: number;
  readonly lockedViolations: number;
  /** `Locked · award` shown — the same chip word, a different promise, and not tenet A's subject. */
  readonly lockedAwardShown: number;
  readonly lockedOutShown: number;
  readonly lockedOutKept: number;
  readonly lockedOutAwardQualifiedAtNow: number;
  readonly lockedOutUnresolvedTieAtNow: number;
  readonly lockedOutViolations: number;
  readonly inRangeShown: number;
  readonly outOfRangeShown: number;
  readonly prequalifiedShown: number;
  readonly capacityUnknownShown: number;
  /** The YARDSTICK's final verdict census: `districtTierFinalVerdicts` unless the caller passed another map. */
  readonly finalLocked: number;
  readonly finalLockedAward: number;
  readonly finalEliminated: number;
  readonly finalContending: number;
  /** False when at least one district-tier event is not finished at `now` (a cancelled or still-running season). Reported, never a filter. */
  readonly everyEventFinishedAtNow: boolean;
  /** Slots HELD BACK for Impact awards still to come, summed over every position — the size of the 260925-ms7 reservation across this season's sweep. */
  readonly reservedSlotsTotal: number;
  /** Positions at which at least one slot was held back. Zero would mean the reservation never fired and every "0 violations" below was free. */
  readonly positionsWithReservedSlots: number;
  /** `Locked` displays the POOLED remaining-points argument produced where the ceiling test did not (quick task 260925-pl6) — the gain, counted at the team-position. */
  readonly lockedByPooledOnly: number;
  /** Positions at which at least one team locked on the pooled argument alone. */
  readonly positionsWithPooledOnlyLock: number;
  /** The district's remaining points, summed over every position — the size of the pool the argument was asked against. Zero would mean it never fired. */
  readonly pooledRemainingPointsTotal: number;
  readonly violations: readonly LedgerTenetViolation[];
}

/**
 * The floor/ceiling pair at one position, for a VIOLATION REPORT LINE ONLY.
 *
 * READ FROM THE TAB'S OWN `districtLockBounds`, the one place the District
 * Locks floor and open ceiling are derived, so this file restates no rule.
 * Nothing in this file branches on the result.
 */
function floorAndCeilingForReport(
  source: DistrictArtifact["teams"][number],
  team: DistrictLedgerTeam,
  categoryCeiling: DistrictCategoryCeilings
): { readonly floor: number; readonly ceiling: number } {
  const { floor, openCeiling } = districtLockBounds(source, team.rows, categoryCeiling);
  return { floor, ceiling: floor + openCeiling };
}

/** Every category of an event decided: the stage a finished district tier event reads at. */
const ALL_CATEGORIES_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };

/**
 * THE PUBLISHER'S OWN FINAL VERDICTS: each team's `districtLock.status`, read
 * straight off the artifact.
 *
 * NOT THE DEFAULT YARDSTICK since quick task 261005-04t. The publisher ranks
 * the ALL TIER `pointTotal`, so once a championship has been played these
 * verdicts know who played it. Exported so a caller can still score against
 * them on purpose, which is how the corrupted fixture test proves the checker
 * can fail and how the 571 and 477 in this file's header were measured.
 */
export function publishedFinalVerdicts(artifact: DistrictArtifact): ReadonlyMap<string, LockStatus> {
  return new Map(artifact.teams.map((team) => [team.teamKey, team.districtLock.status] as const));
}

/**
 * THE YARDSTICK: the standing with every district tier category final, on
 * district tier points alone.
 *
 * Built through the tab's own modules: a stage map marking all four categories
 * final for every district tier event key in the artifact, the real row
 * builder with that map and no distributions, and
 * `computeDistrictLedgerStatuses`. A team with no result reads `unknown`.
 *
 * DELIBERATELY NOT THE VERDICT AT `now`. 19 of the 109 local seasons carry an
 * event whose own state blocks do not read finished, and against `now` 186
 * `Locked` and 307 `Locked out` displays end `contending`, all of them inside
 * those 19 seasons (55 and 127 under the floor shipped before 261005-04t).
 * That is a quirk of the recorded state, not a broken promise: the points
 * those events handed out are in the artifact.
 */
export function districtTierFinalVerdicts(artifact: DistrictArtifact): ReadonlyMap<string, LockStatus> {
  const stageByEvent = new Map<string, DistrictStageFinality>();
  for (const team of artifact.teams) {
    for (const entry of districtTierEvents(team)) stageByEvent.set(entry.eventKey, ALL_CATEGORIES_FINAL);
  }
  const rows = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS, stageByEvent });
  const statuses = computeDistrictLedgerStatuses({ artifact, teams: rows.teams });
  return new Map(artifact.teams.map((team) => [team.teamKey, statuses.byTeam.get(team.teamKey)?.verdict ?? "unknown"] as const));
}

/** Scores one `Locked` (on points) display against the yardstick's final verdict. */
export function outcomeForLockedShown(finalStatus: LockStatus): LedgerTenetOutcome {
  if (finalStatus === "locked") return "kept";
  if (finalStatus === "lockedAward") return "award-qualified-at-now";
  return "violation";
}

/** Scores one `Locked out` display against the yardstick's final verdict. */
export function outcomeForLockedOutShown(finalStatus: LockStatus): LedgerTenetOutcome {
  if (finalStatus === "eliminated") return "kept";
  if (finalStatus === "locked") return "violation";
  if (finalStatus === "lockedAward") return "award-qualified-at-now";
  return "unresolved-tie-at-now";
}

/**
 * Sweeps one district season across every stage position, through the
 * component's own wiring.
 *
 * `finalVerdicts` IS THE YARDSTICK every `Locked` and `Locked out` display is
 * scored against. It defaults to `districtTierFinalVerdicts(artifact)`; every
 * read of a final status and the four final census counts come from this map
 * and from nowhere else.
 */
export function sweepDistrict(
  artifact: DistrictArtifact,
  finalVerdicts: ReadonlyMap<string, LockStatus> = districtTierFinalVerdicts(artifact)
): DistrictTenetSweep {
  const sourceByTeam = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  let finalLocked = 0;
  let finalLockedAward = 0;
  let finalEliminated = 0;
  let finalContending = 0;
  for (const team of artifact.teams) {
    const finalStatus = finalVerdicts.get(team.teamKey) ?? "unknown";
    if (finalStatus === "locked") finalLocked += 1;
    else if (finalStatus === "lockedAward") finalLockedAward += 1;
    else if (finalStatus === "eliminated") finalEliminated += 1;
    else if (finalStatus === "contending") finalContending += 1;
  }

  // The component's own two memos: the district's district-tier event list, and
  // the `now` stage per event from the `state` blocks alone.
  const eventsByKey = new Map<string, { eventKey: string; eventName: string; week: number | null }>();
  const nowStageByEvent = new Map<string, DistrictStageFinality>();
  let everyEventFinishedAtNow = true;
  for (const team of artifact.teams) {
    for (const entry of districtTierEvents(team)) {
      if (!eventsByKey.has(entry.eventKey)) {
        eventsByKey.set(entry.eventKey, { eventKey: entry.eventKey, eventName: entry.eventName, week: entry.week });
      }
      if (nowStageByEvent.has(entry.eventKey)) continue;
      const stage = deriveStageFromState(entry.state);
      nowStageByEvent.set(entry.eventKey, stage.final);
      if (!stage.finished) everyEventFinishedAtNow = false;
    }
  }

  const timeline = buildDistrictTimeline({ events: [...eventsByKey.values()], eventArtifacts: NO_EVENT_ARTIFACTS });
  const ceilings = maxEventPoints(artifact.year, "district");
  const categoryCeiling: DistrictCategoryCeilings = {
    qual: ceilings.qual,
    alliance: ceilings.alliance,
    elim: ceilings.elim,
    award: ceilings.award,
  };

  const violations: LedgerTenetViolation[] = [];
  let teamPositions = 0;
  let lockedPointsShown = 0;
  let lockedKept = 0;
  let lockedAwardQualifiedAtNow = 0;
  let lockedViolations = 0;
  let lockedAwardShown = 0;
  let lockedOutShown = 0;
  let lockedOutKept = 0;
  let lockedOutAwardQualifiedAtNow = 0;
  let lockedOutUnresolvedTieAtNow = 0;
  let lockedOutViolations = 0;
  let inRangeShown = 0;
  let outOfRangeShown = 0;
  let prequalifiedShown = 0;
  let capacityUnknownShown = 0;
  let reservedSlotsTotal = 0;
  let positionsWithReservedSlots = 0;
  let lockedByPooledOnly = 0;
  let positionsWithPooledOnlyLock = 0;
  let pooledRemainingPointsTotal = 0;

  for (let index = 0; index < timeline.positions.length; index++) {
    const position = timeline.positions[index]!;
    const atNow = index >= timeline.nowIndex;
    const stageByEvent = districtStageAtPosition(timeline, index, nowStageByEvent);
    const rows = buildDistrictLedgerRows({
      artifact,
      distributions: NO_DISTRIBUTIONS,
      stageByEvent: atNow ? undefined : stageByEvent,
    });
    const statuses = computeDistrictLedgerStatuses({ artifact, teams: rows.teams });
    reservedSlotsTotal += statuses.reservedSlots;
    if (statuses.reservedSlots > 0) positionsWithReservedSlots += 1;
    pooledRemainingPointsTotal += statuses.pooledRemainingPoints;
    let pooledOnlyHere = 0;

    for (const team of rows.teams) {
      const status = statuses.byTeam.get(team.teamKey);
      if (status === undefined) continue;
      teamPositions += 1;

      const finalStatus = finalVerdicts.get(team.teamKey) ?? "unknown";
      let tenet: LedgerTenet;
      let outcome: LedgerTenetOutcome;

      if (status.status === "prequalified") {
        prequalifiedShown += 1;
        continue;
      } else if (status.status === "inRange") {
        inRangeShown += 1;
        continue;
      } else if (status.status === "outOfRange") {
        outOfRangeShown += 1;
        continue;
      } else if (status.status === "capacityUnknown") {
        capacityUnknownShown += 1;
        continue;
      } else if (status.status === "locked" && status.byAward) {
        lockedAwardShown += 1;
        continue;
      } else if (status.status === "locked") {
        lockedPointsShown += 1;
        // `"pooled"` and not `"both"`: the ceiling test did NOT reach this
        // display, so it exists only because points are conserved.
        if (status.lockedBy === "pooled") {
          lockedByPooledOnly += 1;
          pooledOnlyHere += 1;
        }
        tenet = "A-locked-must-qualify-on-points";
        outcome = outcomeForLockedShown(finalStatus);
        if (outcome === "kept") lockedKept += 1;
        else if (outcome === "award-qualified-at-now") lockedAwardQualifiedAtNow += 1;
        else lockedViolations += 1;
      } else {
        lockedOutShown += 1;
        tenet = "B-locked-out-must-not-qualify-on-points";
        outcome = outcomeForLockedOutShown(finalStatus);
        if (outcome === "kept") lockedOutKept += 1;
        else if (outcome === "award-qualified-at-now") lockedOutAwardQualifiedAtNow += 1;
        else if (outcome === "unresolved-tie-at-now") lockedOutUnresolvedTieAtNow += 1;
        else lockedOutViolations += 1;
      }

      if (outcome !== "violation") continue;

      const source = sourceByTeam.get(team.teamKey);
      if (source === undefined) continue;
      const { floor, ceiling } = floorAndCeilingForReport(source, team, categoryCeiling);
      violations.push({
        tenet,
        districtKey: artifact.districtKey,
        year: artifact.year,
        positionId: position.id,
        positionLabel: position.label,
        positionKind: position.step?.kind ?? position.id,
        teamKey: team.teamKey,
        floor,
        ceiling,
        finalTotal: districtLockBounds(source, [], categoryCeiling).floor,
        finalStatus,
      });
    }

    if (pooledOnlyHere > 0) positionsWithPooledOnlyLock += 1;
  }

  return {
    districtKey: artifact.districtKey,
    year: artifact.year,
    teamCount: artifact.teams.length,
    eventCount: eventsByKey.size,
    positions: timeline.positions.length,
    teamPositions,
    lockedPointsShown,
    lockedKept,
    lockedAwardQualifiedAtNow,
    lockedViolations,
    lockedAwardShown,
    lockedOutShown,
    lockedOutKept,
    lockedOutAwardQualifiedAtNow,
    lockedOutUnresolvedTieAtNow,
    lockedOutViolations,
    inRangeShown,
    outOfRangeShown,
    prequalifiedShown,
    capacityUnknownShown,
    finalLocked,
    finalLockedAward,
    finalEliminated,
    finalContending,
    everyEventFinishedAtNow,
    reservedSlotsTotal,
    positionsWithReservedSlots,
    lockedByPooledOnly,
    positionsWithPooledOnlyLock,
    pooledRemainingPointsTotal,
    violations,
  };
}

export interface LedgerTenetCensus {
  readonly seasons: number;
  readonly positions: number;
  readonly teamPositions: number;
  readonly lockedPointsShown: number;
  readonly lockedKept: number;
  readonly lockedAwardQualifiedAtNow: number;
  readonly lockedViolations: number;
  readonly lockedAwardShown: number;
  readonly lockedOutShown: number;
  readonly lockedOutKept: number;
  readonly lockedOutAwardQualifiedAtNow: number;
  readonly lockedOutUnresolvedTieAtNow: number;
  readonly lockedOutViolations: number;
  readonly inRangeShown: number;
  readonly outOfRangeShown: number;
  readonly prequalifiedShown: number;
  readonly capacityUnknownShown: number;
  /** Slots held back for Impact awards still to come, summed over every position of every season. */
  readonly reservedSlotsTotal: number;
  /** Positions at which at least one slot was held back. */
  readonly positionsWithReservedSlots: number;
  /** `Locked` displays the pooled remaining-points argument produced where the ceiling test did not — the gain quick task 260925-pl6 was measured by. */
  readonly lockedByPooledOnly: number;
  /** Positions at which at least one team locked on the pooled argument alone. */
  readonly positionsWithPooledOnlyLock: number;
  /** The district's remaining points, summed over every position of every season. */
  readonly pooledRemainingPointsTotal: number;
  readonly seasonsNotFinishedAtNow: readonly string[];
  readonly seasonsWithTieAtTheLine: readonly string[];
  /** Every distinct step kind a violation landed on. A single value here is itself the finding. */
  readonly violationPositionKinds: readonly string[];
}

export function censusOf(sweeps: readonly DistrictTenetSweep[]): LedgerTenetCensus {
  const add = (pick: (s: DistrictTenetSweep) => number): number => sweeps.reduce((sum, s) => sum + pick(s), 0);
  const violations = sweeps.flatMap((s) => s.violations);
  return {
    seasons: sweeps.length,
    positions: add((s) => s.positions),
    teamPositions: add((s) => s.teamPositions),
    lockedPointsShown: add((s) => s.lockedPointsShown),
    lockedKept: add((s) => s.lockedKept),
    lockedAwardQualifiedAtNow: add((s) => s.lockedAwardQualifiedAtNow),
    lockedViolations: add((s) => s.lockedViolations),
    lockedAwardShown: add((s) => s.lockedAwardShown),
    lockedOutShown: add((s) => s.lockedOutShown),
    lockedOutKept: add((s) => s.lockedOutKept),
    lockedOutAwardQualifiedAtNow: add((s) => s.lockedOutAwardQualifiedAtNow),
    lockedOutUnresolvedTieAtNow: add((s) => s.lockedOutUnresolvedTieAtNow),
    lockedOutViolations: add((s) => s.lockedOutViolations),
    inRangeShown: add((s) => s.inRangeShown),
    outOfRangeShown: add((s) => s.outOfRangeShown),
    prequalifiedShown: add((s) => s.prequalifiedShown),
    capacityUnknownShown: add((s) => s.capacityUnknownShown),
    reservedSlotsTotal: add((s) => s.reservedSlotsTotal),
    positionsWithReservedSlots: add((s) => s.positionsWithReservedSlots),
    lockedByPooledOnly: add((s) => s.lockedByPooledOnly),
    positionsWithPooledOnlyLock: add((s) => s.positionsWithPooledOnlyLock),
    pooledRemainingPointsTotal: add((s) => s.pooledRemainingPointsTotal),
    seasonsNotFinishedAtNow: sweeps.filter((s) => !s.everyEventFinishedAtNow).map((s) => s.districtKey),
    seasonsWithTieAtTheLine: sweeps.filter((s) => s.finalContending > 0).map((s) => s.districtKey),
    violationPositionKinds: [...new Set(violations.map((v) => v.positionKind))].sort(),
  };
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function reportSeasonTable(sweeps: readonly DistrictTenetSweep[]): void {
  console.log(`PER SEASON`);
  console.log(`  district  teams  events   pos   team-positions    Locked  Lk-award  Locked out   in range  out of range   tenet A  tenet B`);
  for (const s of sweeps) {
    console.log(
      `  ${s.districtKey.padEnd(8)}${pad(s.teamCount, 7)}${pad(s.eventCount, 8)}${pad(s.positions, 6)}${pad(s.teamPositions, 17)}` +
        `${pad(s.lockedPointsShown, 10)}${pad(s.lockedAwardShown, 10)}${pad(s.lockedOutShown, 12)}${pad(s.inRangeShown, 11)}${pad(s.outOfRangeShown, 14)}` +
        `${pad(s.lockedViolations, 10)}${pad(s.lockedOutViolations, 9)}${s.violations.length === 0 ? "" : "   <-- VIOLATION"}`
    );
  }
  console.log(``);
}

function reportViolations(sweeps: readonly DistrictTenetSweep[]): void {
  const violations = sweeps.flatMap((s) => s.violations);
  console.log(`VIOLATIONS`);
  if (violations.length === 0) {
    console.log(`  tenet A (Locked shown, then NOT qualified on points): 0`);
    console.log(`  tenet B (Locked out shown, then qualified on points): 0`);
    console.log(`  Both tenets hold at every swept position of every swept season.`);
    console.log(``);
    return;
  }
  for (const v of violations) {
    console.log(
      `  [${v.tenet}] ${v.districtKey} (${String(v.year)})  position ${v.positionId} [${v.positionKind}] (${v.positionLabel})  team ${v.teamKey}` +
        `  floor ${String(v.floor)}  ceiling ${String(v.ceiling)}  final total ${String(v.finalTotal)}  final status ${v.finalStatus}`
    );
  }
  console.log(``);
}

function reportTotals(census: LedgerTenetCensus, loaded: LoadedDistricts): void {
  console.log(`TOTALS`);
  console.log(`  seasons swept                       ${String(census.seasons)}`);
  console.log(
    `  seasons skipped (dcmpSlots null)    ${String(loaded.skippedNoCapacity.length)}${loaded.skippedNoCapacity.length === 0 ? "" : ` — ${loaded.skippedNoCapacity.join(", ")}`}`
  );
  console.log(`  index files not parsed as districts  ${String(loaded.indexFilesSeen)}`);
  console.log(`  stage positions swept               ${String(census.positions)}`);
  console.log(`  team-positions evaluated            ${String(census.teamPositions)}`);
  console.log(``);
  console.log(`  TENET A — "Locked" shown on points  ${String(census.lockedPointsShown)}`);
  console.log(`    kept (locked at the finish)       ${String(census.lockedKept)}`);
  console.log(`    award-qualified at the finish     ${String(census.lockedAwardQualifiedAtNow)}  (qualified, by award — indeterminate on points, not a failure)`);
  console.log(`    VIOLATIONS                        ${String(census.lockedViolations)}`);
  console.log(``);
  console.log(`  TENET B — "Locked out" shown        ${String(census.lockedOutShown)}`);
  console.log(`    kept (eliminated at the finish)   ${String(census.lockedOutKept)}`);
  console.log(`    award-qualified at the finish     ${String(census.lockedOutAwardQualifiedAtNow)}  (qualified by award — says nothing about the points claim)`);
  console.log(`    unresolved tie at the finish      ${String(census.lockedOutUnresolvedTieAtNow)}  (contending — alive but never guaranteed)`);
  console.log(`    VIOLATIONS                        ${String(census.lockedOutViolations)}`);
  console.log(``);
  console.log(`  "Locked · award" chip shown         ${String(census.lockedAwardShown)}  (a different promise; not tenet A's subject)`);
  console.log(`  In range shown                      ${String(census.inRangeShown)}  (projection-based; see header — not a tenet)`);
  console.log(`  Out of range shown                  ${String(census.outOfRangeShown)}  (projection-based; see header — not a tenet)`);
  console.log(`  Prequalified shown                  ${String(census.prequalifiedShown)}  (no prequalification exists at this tier)`);
  console.log(`  Capacity-unknown shown              ${String(census.capacityUnknownShown)}`);
  console.log(``);
  console.log(`  slots held back for awards to come   ${String(census.reservedSlotsTotal)}  (summed over every position; 260925-ms7's reservation)`);
  console.log(`  positions holding back at least one  ${String(census.positionsWithReservedSlots)} of ${String(census.positions)}`);
  console.log(``);
  console.log(`  Locked on the POOLED argument alone  ${String(census.lockedByPooledOnly)}  (260925-pl6's gain: the ceiling test did not reach these)`);
  console.log(`  positions where it fired alone       ${String(census.positionsWithPooledOnlyLock)} of ${String(census.positions)}`);
  console.log(`  district points still to hand out    ${String(census.pooledRemainingPointsTotal)}  (summed over every position; the pool the argument was asked against)`);
  console.log(``);
  console.log(
    `  violations landed on step kinds:    ${census.violationPositionKinds.length === 0 ? "(none)" : census.violationPositionKinds.join(", ")}`
  );
  console.log(
    `  seasons with a tie at the final line (contending at the finish): ${String(census.seasonsWithTieAtTheLine.length)}` +
      `${census.seasonsWithTieAtTheLine.length === 0 ? "" : ` — ${census.seasonsWithTieAtTheLine.join(", ")}`}`
  );
  console.log(
    `  seasons with an unfinished district-tier event at now:    ${String(census.seasonsNotFinishedAtNow.length)}` +
      `${census.seasonsNotFinishedAtNow.length === 0 ? "" : ` — ${census.seasonsNotFinishedAtNow.join(", ")}`}`
  );
  console.log(``);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const asJson = argv.includes("--json");
  const dirFlag = argv.indexOf("--dir");
  const dir = dirFlag === -1 ? LOCAL_DISTRICT_DIR : (argv[dirFlag + 1] ?? LOCAL_DISTRICT_DIR);

  const loaded = loadDistrictArtifacts(dir);
  // One argument on purpose: `Array.map` would hand `sweepDistrict` the index
  // as its yardstick.
  const sweeps = loaded.artifacts.map((artifact) => sweepDistrict(artifact));
  const census = censusOf(sweeps);
  const violations = sweeps.flatMap((s) => s.violations);

  if (asJson) {
    console.log(JSON.stringify({ dir, census, skippedNoCapacity: loaded.skippedNoCapacity, sweeps, violations }, null, 2));
  } else {
    console.log(``);
    console.log(`LEDGER TENETS — the District Locks tab's own status code, at every stage position.`);
    console.log(`  tenet A:    a team shown "Locked" on points is inside the final points-qualified set`);
    console.log(`  tenet B:    a team shown "Locked out" is outside it`);
    console.log(`  outcome:    the tab's own verdict with every district tier category final, on district tier points`);
    console.log(`              only (no District Championship points on either side). "locked" is qualified on points;`);
    console.log(`              "lockedAward" is qualified by an award and INDETERMINATE on points, because`);
    console.log(`              computeLocksWithQualifiers short-circuits award qualifiers before the points math;`);
    console.log(`              "contending" is an unbroken tie at the line, which never counts as qualified.`);
    console.log(`  source:     ${dir} (read-only, no network, no credential)`);
    console.log(``);
    reportSeasonTable(sweeps);
    reportTotals(census, loaded);
    reportViolations(sweeps);
  }

  if (violations.length > 0) process.exitCode = 1;
}

// Guard: only auto-run `main()` when this file is the process entry point, so
// the pure helpers above can be imported by the test file without sweeping.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error("measure:ledger-tenets failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
