/**
 * The Road to District Champs tab's PURE assembly layer: the district-tier row
 * model, the per-event stage derivation, the in-progress event-key derivation,
 * the baked-pmf decode, the one distribution representation every consumer
 * sees, the per-event `simulateDistrictEvent` input assembly, the cell
 * descriptors, the event and grand totals and the median projection.
 *
 * Follows `apps/web/src/lib/simulationInputs.ts`'s discipline exactly, and for
 * the same reason: gather inputs, disclose every gap, call no simulator. No
 * React import anywhere in this file, and no call to `simulateDistrictEvent` —
 * that runs in the Worker, from the inputs this module assembles.
 *
 * THE ONE DISTRIBUTION REPRESENTATION, declared once here and nowhere else: a
 * dense readonly array whose INDEX IS THE POINT VALUE, plus an explicit
 * denominator (the draw count for a simulated `Int32Array`, `1` for a decoded
 * baked probability array). It is structurally the same shape 10-04's
 * `DistrictEventTotalInput` consumes, so a row's event total feeds the grand
 * total convolution with no adapter at all.
 *
 * 10-03's offset encoding (`DistrictPointPmfSchema`'s `{o, p}`) is decoded to
 * that representation EXACTLY ONCE, at the artifact boundary in
 * `decodeDistrictPointPmf` below. An offset carried through to the cell rules
 * and again to the histogram geometry would be three places to get the same
 * `+ o` wrong, and the leading zeros cost nothing in memory at these array
 * lengths (a dcmp-tier event total spans 0 to 249).
 *
 * BAKED-PMF BRANCH: 10-03 shipped the SIDECAR branch
 * (`packages/harness/pageArtifacts.ts` exports `districtPreSimKey` and
 * `DistrictArtifactSchema.bakedEvents`), so a baked pmf arrives as a
 * `DistrictPreSimArtifact` fetched through `apps/web/src/lib/api/districtLedger.ts`.
 * This module is the only place that knows which branch shipped; had the
 * inline branch shipped, `bakedDistributionsFor` below would read the block off
 * the district artifact's own remaining-event row instead and nothing else in
 * the tab would change.
 */
import {
  convolveDistrictGrandTotal,
  type DistrictAwardProfile,
  type DistrictLedgerEventInput,
  type DistrictLedgerResult,
  type SuppliedAlliance,
} from "../../../../../packages/core/districts/ledgerSimulation.js";
import {
  pointCellSummary,
  pointPercentiles,
  pointQuantile,
  pointThresholdSummary,
  type PointCellSummary,
} from "../../../../../packages/core/districts/pointSummary.js";
import { playoffPoints, type AllianceBracketMilestone, type PlayedBracketMatch } from "../../../../../packages/core/districts/bracket.js";
import { maxEventPoints, type DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import { allianceRatingsFromMetrics, type AllianceMemberRating } from "../../../../../packages/core/algorithms/simulation/allianceWinProbability.js";
import type { SimTeamBaseline } from "../../../../../packages/core/algorithms/simulation/rankSimulation.js";
import type {
  DistrictArtifact,
  DistrictEventState,
  DistrictPointPmf,
  DistrictPreSimArtifact,
  EventArtifact,
} from "../../../../../packages/harness/pageArtifacts.js";
import { districtEventStateFinished, districtEventStateStarted } from "../../lib/liveEvent.js";
import { ALL_CATEGORIES_OPEN, districtEventCategoryFinality } from "../../../../../packages/core/districts/reservedSlots.js";
import { buildQualRows, buildSimulationInputs } from "../../lib/simulationInputs.js";
import { teamNumberFromKey } from "../../lib/teamKey.js";

type DistrictTeam = DistrictArtifact["teams"][number];
type DistrictEventPoints = DistrictTeam["eventPoints"][number];

/** The four point categories, in the fixed column order the tab renders. */
export const DISTRICT_CATEGORIES = ["qual", "alliance", "elim", "award"] as const;

export type DistrictCategory = (typeof DISTRICT_CATEGORIES)[number];

/** Every addressable cell on a row, including the two totals. The value doubles as the drawer's URL cell id suffix. */
export type DistrictCellKind = DistrictCategory | "eventTotal" | "grandTotal";

/**
 * CONTEXT's round-four form assignment, by CATEGORY rather than by cell:
 * qualification, the event total and the grand total always take the median
 * form; the three lumpy categories take the chance form, with 10-04's own
 * 99.5% fallback to the median form applied inside `pointCellSummary`.
 */
const MEDIAN_FORM_CELLS: ReadonlySet<DistrictCellKind> = new Set<DistrictCellKind>(["qual", "eventTotal", "grandTotal"]);

/** THE one distribution representation — see this module's header. Index is the point value; `denominator` is what the array sums to. */
export interface DistrictPointDistribution {
  readonly counts: ArrayLike<number>;
  readonly denominator: number;
}

/** Which of a row's four categories are already decided at a position. `true` means FINAL (grey); `false` means still open (blue). */
export type DistrictStageFinality = Readonly<Record<DistrictCategory, boolean>>;

/** One (team, event) cell's stage at a position, plus the two derived facts the fetch and simulation gates read. */
export interface DistrictEventStage {
  readonly final: DistrictStageFinality;
  /**
   * False when the artifact carries no `state` block for this row at all — a
   * pre-republish artifact. Every category is then reported OPEN rather than
   * guessed finished, because 10-03 made every added field optional precisely
   * so such an artifact still parses.
   */
  readonly stateKnown: boolean;
  readonly started: boolean;
  readonly finished: boolean;
}

const ALL_OPEN: DistrictStageFinality = ALL_CATEGORIES_OPEN;

/**
 * The stage at the "now" position, read from 10-03's `state` block and nothing
 * else.
 *
 * A NULL `qualMatchesTotal` LEAVES QUALIFICATION OPEN rather than guessing it
 * finished: null is the honest answer for an event whose schedule TBA has not
 * published yet, and reading it as "finished" would print a grey number the
 * event has not earned.
 */
export function deriveStageFromState(state: DistrictEventState | undefined): DistrictEventStage {
  if (state === undefined) {
    return { final: ALL_OPEN, stateKnown: false, started: false, finished: false };
  }
  // The four-booleans rule lives in `packages/core/districts/reservedSlots.ts`,
  // beside the two state predicates below and the remaining-points pool that
  // reads the same finalities — one rule, three consumers.
  const final: DistrictStageFinality = districtEventCategoryFinality(state);
  // The two primitives live in `liveEvent.ts`, beside the poll gate that is
  // their only other consumer, so this derivation and that gate cannot drift.
  return { final, stateKnown: true, started: districtEventStateStarted(state), finished: districtEventStateFinished(state) };
}

/**
 * Decodes 10-03's offset encoding into the ONE representation. The decoded
 * array's length is exactly `o + p.length` and its first `o` entries are zero,
 * which is the whole of what the offset ever meant.
 */
export function decodeDistrictPointPmf(pmf: DistrictPointPmf): DistrictPointDistribution {
  const counts = new Float64Array(pmf.o + pmf.p.length);
  for (let i = 0; i < pmf.p.length; i++) counts[pmf.o + i] = pmf.p[i]!;
  return { counts, denominator: 1 };
}

/** A point mass at one integer point value — what a FINAL category contributes to a total. */
export function pointMassDistribution(points: number): DistrictPointDistribution {
  const value = Math.max(0, Math.round(points));
  const counts = new Float64Array(value + 1);
  counts[value] = 1;
  return { counts, denominator: 1 };
}

// ---------------------------------------------------------------------------
// The row model
// ---------------------------------------------------------------------------

/**
 * THE MILESTONE A PLAYOFFS CELL IS ACTUALLY CHASING, when the bracket has
 * already moved past the top four.
 *
 * Jacob, 2026-09-25: "Can we have it update as playoffs go on? top four >
 * finalist > winner." Before the bracket starts, and while an alliance is still
 * short of a top-four finish, the cell's chance IS the chance of reaching the
 * top four — placements five through eight pay nothing, so "any points at all"
 * and "top four" are the same event and the cell needs no extra field. This type
 * covers the three positions past that, where the shipped chance would be a
 * settled question printed as a prediction.
 *
 * `chance` and `conditionalMedian` are `pointThresholdSummary`'s own two numbers,
 * taken on the SAME distribution the cell's histogram is drawn from, so the
 * headline and the outcome list can never disagree.
 */
export type DistrictPlayoffMilestone =
  | { readonly kind: "finalist"; readonly chance: number; readonly conditionalMedian: number | undefined }
  | { readonly kind: "winner"; readonly chance: number; readonly conditionalMedian: number | undefined }
  | { readonly kind: "placed"; readonly placement: number; readonly points: number };

/** One rendered cell: a grey final integer, a blue open distribution, or an honest unavailable. */
export type DistrictLedgerCell =
  | { readonly id: string; readonly cell: DistrictCellKind; readonly kind: "final"; readonly earned: number }
  | {
      readonly id: string;
      readonly cell: DistrictCellKind;
      readonly kind: "open";
      readonly summary: PointCellSummary;
      readonly distribution: DistrictPointDistribution;
      /** The axis ceiling this cell's histogram is drawn on — always `maxEventPoints`-derived, never a literal. */
      readonly ceiling: number;
      /** Present only on a Playoffs cell whose bracket has already moved past the top four — see `DistrictPlayoffMilestone`. */
      readonly playoffMilestone?: DistrictPlayoffMilestone;
    }
  | { readonly id: string; readonly cell: DistrictCellKind; readonly kind: "unavailable" };

/** One district-tier event row for one team. */
export interface DistrictLedgerEventRow {
  readonly eventKey: string;
  readonly eventName: string;
  readonly week: number | null;
  readonly stage: DistrictEventStage;
  readonly cells: readonly DistrictLedgerCell[];
  readonly eventTotal: DistrictLedgerCell;
  /**
   * The artifact's own per-component row for this (team, event), when TBA has
   * published one. Carried on the row because the STATUS module needs it: a
   * rewound position derives its floor by SUBTRACTING these earned values from
   * `team.pointTotal`, never by re-summing categories from scratch.
   */
  readonly earned: DistrictEventPoints | undefined;
  /** This event's per-tier ceiling for a wholly unstarted row, as `remainingEvents.maxPoints` published it. `undefined` for an event the team has already played. */
  readonly remainingMaxPoints: number | undefined;
}

/** One team's whole ledger entry: its district-tier rows, its grand total, and the projection the sort and the status both read. */
export interface DistrictLedgerTeam {
  readonly teamKey: string;
  readonly teamNumber: number;
  readonly nickname: string;
  readonly rows: readonly DistrictLedgerEventRow[];
  /** This team's DISTRICT-tier event count — never a hardcoded two (the real `2026pnw` artifact carries 0 to 4). */
  readonly rowCount: number;
  /** The artifact's own `pointTotal` minus every dcmp-tier event total: the district-tier earned number this tab reports. */
  readonly earnedDistrictTotal: number;
  readonly grandTotal: DistrictLedgerCell;
  /** The continuous median of the predicted grand total, or the earned district-tier total for a team with no open category. */
  readonly projection: number;
  readonly hasOpenCategory: boolean;
  /** 1-based index in the sorted order — the position number the Team cell prints and the status projection consumes. */
  readonly position: number;
  /** TBA's own rookie bonus (10 in a first season, 5 in a second, else 0), already inside `pointTotal` and the grand total; carried so the Team cell and the drawer can print it. */
  readonly rookieBonus: number;
}

/** Every gap this assembly could not close, disclosed as named arrays rather than absorbed. A silently absorbed gap becomes a plausible, complete, WRONG distribution downstream. */
export interface DistrictLedgerGaps {
  /** Events in progress (or reopened) whose event artifact could not be fetched. */
  readonly missingEventArtifacts: readonly string[];
  /** Events whose qualification rows carried no usable pmf pair, so those matches are excluded from the run. */
  readonly eventsWithExcludedMatches: readonly string[];
  /** Teams with no published `awardProfile` — 10-04 raises `MissingAwardProfileError` for the whole event when awards are still open. */
  readonly teamsWithoutAwardProfile: readonly string[];
  /** Events whose `fieldSize` fell back to the roster length because the event artifact publishes none. */
  readonly eventsWithFallbackFieldSize: readonly string[];
  /** Events whose published alliance list was not yet final, so it was dropped and the draft simulated rather than priced from a partial bracket — see `alliancesAreFinal`. */
  readonly eventsWithPartialAllianceList: readonly string[];
  /** Events carrying a played elimination row whose two sides could not both be resolved to one alliance, so that match was left out of the bracket conditioning — see `playedBracketMatchesFor`. */
  readonly eventsWithUnresolvedElimMatches: readonly string[];
  /** Events the Worker could not price at all, with the error class that refused. */
  readonly unavailableEvents: readonly { readonly eventKey: string; readonly name: string }[];
  /**
   * Teams whose row build refused — a negative combined shift
   * (`NegativeDistrictShiftError`) or a distribution carrying no mass at all
   * (`EmptyDistributionError`). Their rows render every predicted number as
   * unavailable, including the grand total; their earned points are unchanged.
   * See `buildTeam`'s own doc comment in this module for why this is per team
   * rather than per table.
   */
  readonly teamsWithUnavailableGrandTotal: readonly string[];
}

// ---------------------------------------------------------------------------
// District-tier event collection
// ---------------------------------------------------------------------------

/** One district-tier event a team is entered in, from `eventPoints` and `remainingEvents` unioned by event key. */
interface DistrictTierEventEntry {
  readonly eventKey: string;
  readonly eventName: string;
  readonly week: number | null;
  readonly state: DistrictEventState | undefined;
  readonly earned: DistrictEventPoints | undefined;
  readonly remainingMaxPoints: number | undefined;
}

/**
 * A team's district-tier events in week order, a null week last with the event
 * name as the tie-break — `collectAllEvents`' own ordering rule in the shipped
 * champ tab, restated here because this one is per team rather than per
 * district.
 *
 * DCMP-TIER ROWS ARE DROPPED. This tab is the road to the district
 * championship; the `2026pnw` artifact's top team carries a `2026pncmp`
 * dcmp-tier `eventPoints` entry alongside two district-tier ones, and that row
 * belongs to Champ Locks.
 */
export function districtTierEvents(team: DistrictTeam): DistrictTierEventEntry[] {
  const byKey = new Map<string, DistrictTierEventEntry>();
  for (const row of team.eventPoints) {
    if (row.tier !== "district") continue;
    byKey.set(row.eventKey, { eventKey: row.eventKey, eventName: row.eventName, week: row.week, state: row.state, earned: row, remainingMaxPoints: undefined });
  }
  for (const row of team.remainingEvents) {
    if (row.tier !== "district") continue;
    const existing = byKey.get(row.eventKey);
    if (existing === undefined) {
      byKey.set(row.eventKey, {
        eventKey: row.eventKey,
        eventName: row.eventName,
        week: row.week,
        state: row.state,
        earned: undefined,
        remainingMaxPoints: row.maxPoints,
      });
    } else {
      byKey.set(row.eventKey, {
        ...existing,
        state: existing.state ?? row.state,
        remainingMaxPoints: existing.remainingMaxPoints ?? row.maxPoints,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.week !== b.week) {
      if (a.week === null) return 1;
      if (b.week === null) return -1;
      return a.week - b.week;
    }
    return a.eventName.localeCompare(b.eventName);
  });
}

/**
 * The district-tier event keys whose state is STARTED and NOT FINISHED at the
 * "now" position — exactly the events the tab fetches an artifact for and
 * simulates. An unstarted event (baked) and a finished event (grey) are both
 * absent, which is SC-5's whole mechanism.
 */
export function inProgressDistrictEventKeys(artifact: DistrictArtifact): string[] {
  const keys = new Set<string>();
  for (const team of artifact.teams) {
    for (const entry of districtTierEvents(team)) {
      const stage = deriveStageFromState(entry.state);
      if (stage.started && !stage.finished) keys.add(entry.eventKey);
    }
  }
  return [...keys].sort();
}

/** Every district-tier event key in the artifact, in a stable order — the superset the timeline and the baked fetch both narrow from. */
export function allDistrictTierEventKeys(artifact: DistrictArtifact): string[] {
  const keys = new Set<string>();
  for (const team of artifact.teams) for (const entry of districtTierEvents(team)) keys.add(entry.eventKey);
  return [...keys].sort();
}

// ---------------------------------------------------------------------------
// The per-event simulation input
// ---------------------------------------------------------------------------

/** What `buildDistrictEventSimulationInput` returns: the input itself, or the reason it could not be built. */
export type DistrictEventInputResult =
  | {
      readonly ok: true;
      readonly input: DistrictLedgerEventInput;
      readonly fieldSizeFellBack: boolean;
      readonly excludedMatchCount: number;
      /** The event artifact published an alliance list that is not yet final, so it was dropped and the draft is simulated — see `alliancesAreFinal`. */
      readonly allianceListIsPartial: boolean;
      /** Played elimination rows whose two sides could not both be resolved to one alliance, so the whole match was left out of the conditioning. */
      readonly unresolvedElimMatchKeys: readonly string[];
    }
  | { readonly ok: false; readonly reason: "no-qual-rows" };

/**
 * 10-03's wire bucket vocabulary mapped onto 10-02's measured module keys — one
 * mapping, at this boundary, exactly as `DISTRICT_AWARD_BUCKETS`' doc comment
 * requires.
 *
 * `priorJudgedAwards` is forwarded UNCHANGED and stays absent when the artifact
 * carries none. Defaulting it to 0 here would sort that team to the bottom of
 * its field and price it at the ordering's tail; `awardOrderingAssignments`
 * instead takes the whole event back to the base rate, which is the price the
 * artifact was published at before the ordering existed.
 */
function awardProfileFor(team: DistrictTeam): DistrictAwardProfile | undefined {
  const profile = team.awardProfile;
  if (profile === undefined) return undefined;
  const bucket = profile.bucket === "none" ? "none" : profile.bucket === "oneOrTwo" ? "one-or-two" : "three-or-more";
  return {
    bucket,
    rookieState: profile.rookie ? "rookie" : "veteran",
    ...(profile.priorJudgedAwards === undefined ? {} : { priorJudgedAwards: profile.priorJudgedAwards }),
  };
}

/**
 * The end-of-qualification baseline, for the ONE case
 * `buildSimulationInputs` structurally cannot express: a position at which
 * every qualification row is already played, so the remaining set is EMPTY.
 * That function is addressed by a start MATCH KEY, and "one past the last row"
 * has no key.
 *
 * The arithmetic is deliberately identical to that function's own non-rewind
 * Ranking Score path — `Math.round(rp * denominator)` against TBA's own played
 * -match denominator — and is a recovery rather than a tolerance, for the
 * reason stated there: `rp` is rounded once at publish to 2 decimals, so the
 * product recovers the integer total exactly for any real qualification
 * schedule. A team with no published Ranking Score gets a zero baseline, which
 * with zero remaining matches simply places it last; that is honest rather than
 * invented, and it is why a finished qualification stage is expressed as ZERO
 * REMAINING MATCHES and never as a fifth flag (10-04 rejects a flag outright).
 */
function finishedQualBaselines(artifact: EventArtifact): SimTeamBaseline[] {
  return artifact.teams.map((team) => {
    if (team.rp === undefined) return { teamKey: team.teamKey, earnedRpSum: 0, matchesPlayed: 0 };
    const denominator = team.record === undefined ? 0 : team.record.wins + team.record.losses + team.record.ties;
    if (denominator <= 0) return { teamKey: team.teamKey, earnedRpSum: 0, matchesPlayed: 0 };
    return { teamKey: team.teamKey, earnedRpSum: Math.round(team.rp * denominator), matchesPlayed: denominator };
  });
}

/** TBA's `event_alliances.picks` as 10-04's supplied-alliance shape — validated by that module, never trusted here. */
function suppliedAlliances(artifact: EventArtifact): readonly SuppliedAlliance[] | undefined {
  const alliances = artifact.alliances;
  if (alliances === undefined || alliances.length === 0) return undefined;
  return alliances.map((alliance) => ({ allianceNumber: alliance.allianceNumber, picks: [...alliance.picks] }));
}

/** What `playedBracketMatchesFor` resolved, and what it could not — a disclosed gap rather than a silent drop. */
export interface PlayedBracketMatchesResult {
  readonly matches: readonly PlayedBracketMatch[];
  /** The match keys whose two sides could not both be resolved to exactly one alliance. */
  readonly unresolvedMatchKeys: readonly string[];
}

/**
 * The event artifact's PLAYED elimination rows as alliance-numbered decisions.
 *
 * THE ONE PLACE COLOUR BECOMES AN ALLIANCE NUMBER. `bracket.ts` deliberately
 * refuses to know about red and blue — resolving a colour needs the event's own
 * pick lists, which are this module's data — so the mapping lives here and
 * nowhere else.
 *
 * A side resolves to an alliance only when every one of its teams that appears
 * in ANY pick list appears in the SAME one. That tolerance is deliberate and it
 * is what a backup robot needs: TBA's `picks` array carries a fourth entry for
 * one, the field shows three robots, and which three changes between matches.
 * A side whose teams span two alliances, or none, is a row this tab cannot map,
 * and the whole match is DISCLOSED rather than guessed at — a mis-mapped match
 * silently rewrites the placement of every set below it, which is why
 * `routePlayedBracket` refuses one outright.
 *
 * A row with no `actualWinner` is not played and is skipped without comment; a
 * tie has no winner in an elimination bracket and TBA publishes none.
 */
export function playedBracketMatchesFor(artifact: EventArtifact): PlayedBracketMatchesResult {
  const alliances = artifact.alliances;
  if (alliances === undefined || alliances.length === 0) return { matches: [], unresolvedMatchKeys: [] };

  const allianceByTeam = new Map<string, number>();
  for (const alliance of alliances) {
    for (const pick of alliance.picks) allianceByTeam.set(pick, alliance.allianceNumber);
  }
  const allianceOfSide = (teamKeys: readonly string[]): number | undefined => {
    const numbers = new Set<number>();
    for (const teamKey of teamKeys) {
      const allianceNumber = allianceByTeam.get(teamKey);
      if (allianceNumber !== undefined) numbers.add(allianceNumber);
    }
    return numbers.size === 1 ? [...numbers][0] : undefined;
  };

  const matches: PlayedBracketMatch[] = [];
  const unresolvedMatchKeys: string[] = [];
  for (const match of artifact.matches) {
    if (match.compLevel === "qm") continue;
    const red = allianceOfSide(match.redTeams);
    const blue = allianceOfSide(match.blueTeams);
    if (red === undefined || blue === undefined || red === blue) {
      unresolvedMatchKeys.push(match.matchKey);
      continue;
    }
    const winningAllianceNumber = match.actualWinner === "red" ? red : match.actualWinner === "blue" ? blue : undefined;
    if (winningAllianceNumber === undefined) continue;
    matches.push({
      compLevel: match.compLevel,
      setNumber: match.setNumber,
      matchNumber: match.matchNumber,
      winningAllianceNumber,
    });
  }
  return { matches, unresolvedMatchKeys };
}

/**
 * The bracket size a district event's playoffs are simulated at before its own
 * alliances are announced. NOT a point ceiling — every point ceiling on this
 * tab traces to `maxEventPoints(season, tier)`. CONTEXT's corpus-verified
 * correction states that every regular district event since 2023 uses the
 * eight-alliance bracket WITHOUT EXCEPTION; the only non-eight "district" rows
 * are divisioned district championship parents, which this tab never renders.
 * Once alliances ARE announced the published count is used instead.
 */
const DEFAULT_DISTRICT_ALLIANCE_COUNT = 8;

/**
 * The smallest number of picks a FINISHED district alliance carries: a
 * captain, a first pick and a second pick. TBA's `picks` array may carry a
 * fourth entry (a backup robot) and never more.
 *
 * Mirrors `ledgerSimulation.ts`'s own `DRAFTED_ALLIANCE_SIZE`, which is
 * module-private there. Restated rather than exported because the two mean
 * different things: that one is how many robots a SIMULATED draft takes, this
 * one is how many a PUBLISHED alliance must already have before its list can
 * be called final.
 */
const DISTRICT_FINAL_ALLIANCE_PICKS = 3;

/**
 * Whether a published alliance list describes a FINISHED selection, or one
 * still in progress.
 *
 * WHY THIS GATE EXISTS. `event_alliances` appears on the event artifact while
 * selection is still running, and it grows: a list of four alliances, or of
 * eight alliances each holding only its captain, is what "selection is
 * underway" looks like on the wire. Handed to `simulateDistrictEvent` as
 * `allianceCount`, a truncated list takes the `!usesEightAllianceBracket`
 * branch and prices elimination points from `divisionedDcmpPlayoffPmf`, whose
 * own doc comment scopes it to the sixteen DIVISIONED district championship
 * parent events and to nothing else — its two- and four-alliance populations
 * are `micmp`/`necmp`/`oncmp`/`txcmp` only. A regular district event would be
 * priced from base values its own bracket cannot produce.
 *
 * `validateSuppliedAlliances` does not catch it: it requires only that
 * alliance numbers 1 through `allianceCount` are all present, which a
 * truncated list satisfies, and it rejects a pick list only at 0 and above 4.
 *
 * NOT-YET-FINAL IS THE HONEST ANSWER. The list is dropped, the count stays at
 * the eight-alliance bracket every regular district event since 2023 runs, and
 * the draft is simulated as it is before any alliance is announced. The event
 * is named in the disclosed-gap list rather than absorbed.
 */
function alliancesAreFinal(alliances: readonly SuppliedAlliance[]): boolean {
  if (alliances.length !== DEFAULT_DISTRICT_ALLIANCE_COUNT) return false;
  return alliances.every((alliance) => alliance.picks.length >= DISTRICT_FINAL_ALLIANCE_PICKS);
}

export interface BuildDistrictEventInputOptions {
  readonly eventKey: string;
  readonly season: number;
  readonly eventArtifact: EventArtifact;
  readonly districtArtifact: DistrictArtifact;
  readonly stage: DistrictStageFinality;
  /**
   * The first qualification row still to be played at this position, or `null`
   * when qualification is finished at this position. Task 4's slider supplies
   * a rewound key; the "now" position supplies the first unplayed row's key.
   */
  readonly startMatchKey: string | null;
  /**
   * Whether this position may condition the bracket on the elimination matches
   * ALREADY PLAYED. True only at the LIVE position.
   *
   * WHY IT IS THE CALLER'S CALL AND NOT A DERIVATION. The rewind rail's playoff
   * step is all-or-nothing by construction: a position at an event's `alliance`
   * step is before its bracket started, and a position at its `playoffs` step is
   * after the bracket finished, so a rewound position never sits part-way
   * through one. Only "now" does, and only the caller knows whether it is at
   * "now" — `stage` alone cannot say, because the stage at an `alliance` step and
   * the stage of a live event mid-bracket are the same four booleans.
   *
   * Absent reads as false: a caller that has not thought about it gets the
   * shipped behaviour rather than a bracket conditioned on a position that
   * cannot honestly carry one.
   */
  readonly conditionOnPlayedElims?: boolean;
}

/**
 * Assembles ONE event's `simulateDistrictEvent` input by mirroring
 * `buildSimulationInputs` per event and adding the four members that function
 * does not produce: the ratings map (through 10-02's metrics helper, so the
 * `total`/`sigma` key indexing exists in exactly one place), the award-profile
 * map, the alliance count, and `fieldSize`.
 *
 * The known-stage members are supplied only for stages already CLOSED at this
 * position, which is what makes rewinding reopen them by construction rather
 * than by a special case.
 */
export function buildDistrictEventSimulationInput(options: BuildDistrictEventInputOptions): DistrictEventInputResult {
  const { eventKey, season, eventArtifact, districtArtifact, stage, startMatchKey } = options;
  const qualRows = buildQualRows(eventArtifact);

  let baselines: readonly SimTeamBaseline[];
  let remainingMatches: DistrictLedgerEventInput["remainingMatches"];
  let excludedMatchCount = 0;

  if (startMatchKey === null) {
    if (qualRows.length === 0 && eventArtifact.teams.length === 0) return { ok: false, reason: "no-qual-rows" };
    baselines = finishedQualBaselines(eventArtifact);
    remainingMatches = [];
  } else {
    const assembled = buildSimulationInputs(eventArtifact, startMatchKey);
    if (assembled === null) return { ok: false, reason: "no-qual-rows" };
    baselines = assembled.baselines;
    remainingMatches = assembled.remainingMatches;
    excludedMatchCount = assembled.excludedMatchKeys.length;
  }

  const rosterKeys = baselines.map((baseline) => baseline.teamKey);
  const metricsByTeam: Record<string, EventArtifact["teams"][number]["metrics"] | undefined> = {};
  for (const team of eventArtifact.teams) metricsByTeam[team.teamKey] = team.metrics;
  const ratings = new Map<string, AllianceMemberRating>(
    allianceRatingsFromMetrics(rosterKeys, metricsByTeam).map((rating) => [rating.teamKey, rating] as const)
  );

  const awardProfiles = new Map<string, DistrictAwardProfile>();
  const districtTeamByKey = new Map(districtArtifact.teams.map((team) => [team.teamKey, team] as const));
  for (const teamKey of rosterKeys) {
    const districtTeam = districtTeamByKey.get(teamKey);
    const profile = districtTeam === undefined ? undefined : awardProfileFor(districtTeam);
    if (profile !== undefined) awardProfiles.set(teamKey, profile);
  }

  // The event artifact publishes no official field size of its own (that field
  // lives on the TEAM artifact's per-event row), so the roster length is the
  // fallback every time — recorded per event in the disclosed-gap list rather
  // than absorbed, because 10-04 rejects a rank above its field size and a
  // silently clamped rank would print a wrong point value.
  const fieldSize = rosterKeys.length;

  const published = suppliedAlliances(eventArtifact);
  // A published list that is not yet FINAL is dropped rather than handed on as
  // a two- or four-alliance bracket — see `alliancesAreFinal`.
  const allianceListIsPartial = stage.alliance && published !== undefined && !alliancesAreFinal(published);
  const alliances = allianceListIsPartial ? undefined : published;
  const allianceCount = stage.alliance && alliances !== undefined ? alliances.length : DEFAULT_DISTRICT_ALLIANCE_COUNT;

  const knownElimPoints = stage.elim ? earnedPointsMap(districtArtifact, eventKey, "elim") : undefined;
  const knownAwardPoints = stage.award ? earnedPointsMap(districtArtifact, eventKey, "award") : undefined;

  // THE PARTIALLY-PLAYED BRACKET. Only where the playoffs are genuinely under
  // way: the position must be the live one, the alliances must be final (a
  // partial list was already dropped above, and a bracket cannot be read against
  // rosters that are still being picked) and the playoff stage must still be
  // open. Anything else passes no played rows at all, which is exactly the
  // shipped behaviour.
  const playedElims =
    options.conditionOnPlayedElims === true && stage.alliance && !stage.elim && alliances !== undefined
      ? playedBracketMatchesFor(eventArtifact)
      : { matches: [], unresolvedMatchKeys: [] };

  const input: DistrictLedgerEventInput = {
    eventKey,
    season,
    tier: "district",
    fieldSize,
    allianceCount,
    remainingMatches,
    baselines,
    ratings,
    awardProfiles,
    ...(stage.alliance && alliances !== undefined ? { knownAlliances: alliances } : {}),
    ...(knownElimPoints !== undefined ? { knownElimPoints } : {}),
    ...(knownAwardPoints !== undefined ? { knownAwardPoints } : {}),
    ...(playedElims.matches.length > 0 ? { playedElimMatches: playedElims.matches } : {}),
  };

  return {
    ok: true,
    input,
    fieldSizeFellBack: true,
    excludedMatchCount,
    allianceListIsPartial,
    unresolvedElimMatchKeys: playedElims.unresolvedMatchKeys,
  };
}

/** `teamKey -> the artifact's own earned points` for one event and one category — the known-stage maps 10-04 consumes. */
function earnedPointsMap(artifact: DistrictArtifact, eventKey: string, category: DistrictCategory): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const team of artifact.teams) {
    const row = team.eventPoints.find((entry) => entry.eventKey === eventKey);
    if (row !== undefined) out.set(team.teamKey, row[category]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Distribution sources
// ---------------------------------------------------------------------------

/** Every distribution the tab has for one event, whether simulated or baked, keyed by team then category. */
export interface DistrictEventDistributions {
  readonly eventKey: string;
  readonly byTeam: ReadonlyMap<string, Readonly<Record<DistrictCellKind, DistrictPointDistribution | undefined>>>;
  /**
   * How far each team's alliance has already got in this event's bracket, as
   * 10-04's run reported it. Absent for a BAKED event, which has not started, so
   * there is no bracket to have got anywhere in.
   */
  readonly playoffMilestoneByTeam?: ReadonlyMap<string, AllianceBracketMilestone>;
}

function emptyCellRecord(): Record<DistrictCellKind, DistrictPointDistribution | undefined> {
  return { qual: undefined, alliance: undefined, elim: undefined, award: undefined, eventTotal: undefined, grandTotal: undefined };
}

/** One simulated event's result, reshaped into the per-team cell record the row builder reads. Reshaping happens here and not at the Worker boundary. */
export function distributionsFromResult(result: DistrictLedgerResult): DistrictEventDistributions {
  const byTeam = new Map<string, Record<DistrictCellKind, DistrictPointDistribution | undefined>>();
  const put = (teamKey: string, cell: DistrictCellKind, counts: ArrayLike<number>): void => {
    let record = byTeam.get(teamKey);
    if (record === undefined) {
      record = emptyCellRecord();
      byTeam.set(teamKey, record);
    }
    record[cell] = { counts, denominator: result.draws };
  };
  for (const [teamKey, counts] of result.qualPoints) put(teamKey, "qual", counts);
  for (const [teamKey, counts] of result.selectionPoints) put(teamKey, "alliance", counts);
  for (const [teamKey, counts] of result.elimPoints) put(teamKey, "elim", counts);
  for (const [teamKey, counts] of result.awardPoints) put(teamKey, "award", counts);
  for (const [teamKey, counts] of result.eventTotal) put(teamKey, "eventTotal", counts);
  return { eventKey: result.eventKey, byTeam, playoffMilestoneByTeam: result.playoffMilestones };
}

/** One baked sidecar's roster-indexed rows, decoded into the same per-team cell record. */
export function distributionsFromPreSim(artifact: DistrictPreSimArtifact): DistrictEventDistributions {
  const byTeam = new Map<string, Record<DistrictCellKind, DistrictPointDistribution | undefined>>();
  for (const row of artifact.rows) {
    const teamKey = artifact.roster[row.t];
    if (teamKey === undefined) continue;
    const record = emptyCellRecord();
    record.qual = decodeDistrictPointPmf(row.qual);
    record.alliance = decodeDistrictPointPmf(row.alliance);
    record.elim = decodeDistrictPointPmf(row.elim);
    record.award = decodeDistrictPointPmf(row.award);
    record.eventTotal = decodeDistrictPointPmf(row.total);
    byTeam.set(teamKey, record);
  }
  return { eventKey: artifact.eventKey, byTeam };
}

// ---------------------------------------------------------------------------
// Cell construction
// ---------------------------------------------------------------------------

export function districtCellId(eventKey: string, cell: DistrictCellKind): string {
  return `${eventKey}:${cell}`;
}

/** The grand-total drawer's cell id — one per team, with no event key of its own. */
export const GRAND_TOTAL_CELL_ID = "grand";

function summaryFor(cell: DistrictCellKind, distribution: DistrictPointDistribution): PointCellSummary {
  if (MEDIAN_FORM_CELLS.has(cell)) {
    return { form: "median", percentiles: pointPercentiles(distribution.counts, distribution.denominator) };
  }
  return pointCellSummary(distribution.counts, distribution.denominator);
}

function openCell(id: string, cell: DistrictCellKind, distribution: DistrictPointDistribution, ceiling: number): DistrictLedgerCell {
  return { id, cell, kind: "open", summary: summaryFor(cell, distribution), distribution, ceiling };
}

/**
 * The Playoffs cell's milestone, from the bracket's own progress and this event's
 * OWN placement point values.
 *
 * `undefined` for an alliance that is still alive short of a top-four finish, and
 * for an event with no bracket progress at all. Both print the shipped chance,
 * which for a playoff bracket IS the chance of reaching the top four: placements
 * five through eight pay nothing, so "any points" and "top four" are one event.
 *
 * Every threshold comes from `playoffPoints`, so the dcmp weight is applied by
 * the phase's single weight source and no point value is a literal here.
 */
function playoffMilestoneFor(
  season: number,
  tier: DistrictTier,
  milestone: AllianceBracketMilestone | undefined,
  distribution: DistrictPointDistribution
): DistrictPlayoffMilestone | undefined {
  if (milestone === undefined || milestone.kind === "alive") return undefined;
  if (milestone.kind === "decided") {
    return { kind: "placed", placement: milestone.placement, points: playoffPoints(season, tier, milestone.placement) };
  }
  // A top-four finish is secured, so the next thing worth asking is whether the
  // alliance reaches the FINAL — second place or better.
  const placement = milestone.kind === "finals" ? 1 : 2;
  const threshold = playoffPoints(season, tier, placement);
  const summary = pointThresholdSummary(distribution.counts, distribution.denominator, threshold);
  return milestone.kind === "finals"
    ? { kind: "winner", chance: summary.chance, conditionalMedian: summary.conditionalMedian }
    : { kind: "finalist", chance: summary.chance, conditionalMedian: summary.conditionalMedian };
}

// ---------------------------------------------------------------------------
// The row builder
// ---------------------------------------------------------------------------

export interface BuildDistrictLedgerRowsOptions {
  readonly artifact: DistrictArtifact;
  /** `eventKey -> the distributions the tab holds for it`, simulated or baked. Absent means the tab has none, so that event's open cells render unavailable. */
  readonly distributions: ReadonlyMap<string, DistrictEventDistributions>;
  /** `eventKey -> the stage at the current position`. Absent falls back to the row's own `state` block, which is the "now" answer. */
  readonly stageByEvent?: ReadonlyMap<string, DistrictStageFinality>;
  /** Events the Worker refused to price, with the error class that refused — their open cells render unavailable rather than blank. */
  readonly unavailableEvents?: readonly { readonly eventKey: string; readonly name: string }[];
  readonly gaps?: Partial<DistrictLedgerGaps>;
}

export interface DistrictLedgerRowsResult {
  readonly teams: readonly DistrictLedgerTeam[];
  readonly gaps: DistrictLedgerGaps;
}

/**
 * Builds every team's rows, cells, totals and projection at one position, then
 * sorts.
 *
 * THE SORT: descending by the median of the predicted grand total, with a
 * finished team ordered by its actual district-tier total, breaking ties by the
 * earned total and then by team number. The tie-break asserts NOTHING about
 * which of two equal-projection teams is better, because the published data
 * cannot establish that — `rankRows.ts`'s own framing — and no secondary
 * ordering by interval width or by any other statistic is ever introduced.
 */
export function buildDistrictLedgerRows(options: BuildDistrictLedgerRowsOptions): DistrictLedgerRowsResult {
  const { artifact, distributions, stageByEvent, unavailableEvents = [] } = options;
  const season = artifact.year;
  const ceilings = maxEventPoints(season, "district");
  const categoryCeiling: Readonly<Record<DistrictCategory, number>> = {
    qual: ceilings.qual,
    alliance: ceilings.alliance,
    elim: ceilings.elim,
    award: ceilings.award,
  };
  const eventTotalCeiling = ceilings.qual + ceilings.alliance + ceilings.elim + ceilings.award;
  const unavailableByKey = new Map(unavailableEvents.map((entry) => [entry.eventKey, entry.name] as const));

  const teamsWithoutAwardProfile = new Set(options.gaps?.teamsWithoutAwardProfile ?? []);
  const teamsWithUnavailableGrandTotal = new Set(options.gaps?.teamsWithUnavailableGrandTotal ?? []);

  const built: DistrictLedgerTeam[] = [];

  /**
   * ONE team's whole entry. Extracted from the loop below so a refusal
   * attributable to ONE TEAM costs that team its grand total and nothing more
   * (phase 10 review, WR-09).
   *
   * Three of the functions reached from here document themselves as throwing
   * rather than fabricating — `convolveDistrictGrandTotal`
   * (`NegativeDistrictShiftError` for a negative rookie-bonus-plus-adjustments
   * shift or a non-positive denominator) and `pointCellSummary`/`pointQuantile`
   * (`EmptyDistributionError` for a histogram carrying no mass at all). Each of
   * those inputs arrives PER TEAM, so each is attributable per team.
   *
   * `maxEventPoints` is deliberately NOT in here: it is keyed on the season and
   * the tier only, so an unregistered season is a refusal about the WHOLE table
   * and is left to propagate to the tab's error boundary (`ErrorBoundary`,
   * wrapped around `DistrictLedgerContent`). Degrading every team one at a time
   * for a fact that is the same for all of them would print a whole table of
   * "not available" where one honest message belongs.
   */
  const buildTeam = (team: DistrictTeam): DistrictLedgerTeam => {
    const entries = districtTierEvents(team);
    const rows: DistrictLedgerEventRow[] = [];
    const eventTotalDistributions: DistrictPointDistribution[] = [];
    let everyEventTotalKnown = true;
    let hasOpenCategory = false;
    let earnedDistrictTotal = 0;

    for (const entry of entries) {
      const derived = deriveStageFromState(entry.state);
      const overridden = stageByEvent?.get(entry.eventKey);
      const final: DistrictStageFinality = overridden ?? derived.final;
      const stage: DistrictEventStage = {
        final,
        stateKnown: derived.stateKnown,
        started: derived.started,
        finished: final.qual && final.alliance && final.elim && final.award,
      };
      const record = distributions.get(entry.eventKey)?.byTeam.get(team.teamKey);
      if (entry.earned !== undefined) earnedDistrictTotal += entry.earned.total;

      const cells: DistrictLedgerCell[] = DISTRICT_CATEGORIES.map((category) => {
        const id = districtCellId(entry.eventKey, category);
        if (final[category]) {
          // THE GREY NUMBER IS ALWAYS THE ARTIFACT'S OWN `eventPoints[category]`,
          // never a value derived from the simulation: 10-04's ranking
          // comparator's team-key tiebreak is not TBA's official tiebreak, so a
          // derived qualification-points value can honestly disagree with the
          // earned one for tied teams.
          if (entry.earned === undefined) return { id, cell: category, kind: "unavailable" };
          return { id, cell: category, kind: "final", earned: entry.earned[category] };
        }
        hasOpenCategory = true;
        const distribution = record?.[category];
        if (distribution === undefined) return { id, cell: category, kind: "unavailable" };
        const cell = openCell(id, category, distribution, categoryCeiling[category]);
        if (category !== "elim" || cell.kind !== "open") return cell;
        const milestone = playoffMilestoneFor(
          season,
          "district",
          distributions.get(entry.eventKey)?.playoffMilestoneByTeam?.get(team.teamKey),
          distribution
        );
        return milestone === undefined ? cell : { ...cell, playoffMilestone: milestone };
      });

      const totalId = districtCellId(entry.eventKey, "eventTotal");
      let eventTotal: DistrictLedgerCell;
      if (stage.finished) {
        // The artifact's own `total` is TBA's arithmetic over TBA's own
        // components, so where the two ever disagree the published total is the
        // quantity this tab prints.
        eventTotal =
          entry.earned === undefined
            ? { id: totalId, cell: "eventTotal", kind: "unavailable" }
            : { id: totalId, cell: "eventTotal", kind: "final", earned: entry.earned.total };
      } else {
        const distribution = record?.eventTotal;
        eventTotal =
          distribution === undefined
            ? { id: totalId, cell: "eventTotal", kind: "unavailable" }
            : openCell(totalId, "eventTotal", distribution, eventTotalCeiling);
      }

      if (eventTotal.kind === "final") eventTotalDistributions.push(pointMassDistribution(eventTotal.earned));
      else if (eventTotal.kind === "open") eventTotalDistributions.push(eventTotal.distribution);
      else everyEventTotalKnown = false;

      rows.push({
        eventKey: entry.eventKey,
        eventName: entry.eventName,
        week: entry.week,
        stage,
        cells,
        eventTotal,
        earned: entry.earned,
        remainingMaxPoints: entry.remainingMaxPoints,
      });
    }

    const grandCeiling = eventTotalCeiling * Math.max(entries.length, 1) + Math.max(0, Math.round(team.rookieBonus + team.adjustments));
    let grandTotal: DistrictLedgerCell;
    let projection: number;
    if (!everyEventTotalKnown) {
      grandTotal = { id: GRAND_TOTAL_CELL_ID, cell: "grandTotal", kind: "unavailable" };
      projection = earnedDistrictTotal + team.rookieBonus + team.adjustments;
    } else {
      // `NegativeDistrictShiftError` is allowed to propagate rather than
      // clamped: 10-04's corpus pass measured `adjustments` as 0 in all 16,345
      // rows, so a negative shift has never been observed and clamping one to
      // zero would fabricate a value rather than fall back.
      const counts = convolveDistrictGrandTotal(
        eventTotalDistributions,
        Math.round(team.rookieBonus),
        Math.round(team.adjustments)
      );
      const distribution: DistrictPointDistribution = { counts, denominator: 1 };
      if (hasOpenCategory) {
        grandTotal = openCell(GRAND_TOTAL_CELL_ID, "grandTotal", distribution, grandCeiling);
        // The continuous 50th percentile, for a team that still has something
        // to earn.
        projection = pointQuantile(counts, 0.5, 1);
      } else {
        // A fully finished team has NO predicted distribution at all: the
        // convolution is a point mass, and taking its quantile would reproduce
        // the same number by a longer route while inviting a reader to think a
        // prediction was involved.
        const earned = earnedDistrictTotal + team.rookieBonus + team.adjustments;
        grandTotal = { id: GRAND_TOTAL_CELL_ID, cell: "grandTotal", kind: "final", earned: earned };
        projection = earned;
      }
    }

    return {
      teamKey: team.teamKey,
      teamNumber: team.teamNumber ?? safeTeamNumber(team.teamKey),
      nickname: team.nickname ?? `Team ${String(team.teamNumber ?? safeTeamNumber(team.teamKey))}`,
      rows,
      rowCount: rows.length,
      earnedDistrictTotal,
      grandTotal,
      projection,
      hasOpenCategory,
      position: 0,
      rookieBonus: Math.max(0, Math.round(team.rookieBonus)),
    };
  };

  for (const team of artifact.teams) {
    if (team.awardProfile === undefined) teamsWithoutAwardProfile.add(team.teamKey);
    try {
      built.push(buildTeam(team));
    } catch {
      // DEGRADE PER TEAM, never per table. The team keeps its identity, its
      // rows and its earned points, and loses exactly the thing that could not
      // be built: every predicted number, including the grand total. It is
      // NAMED in `gaps.teamsWithUnavailableGrandTotal` rather than absorbed —
      // an absorbed refusal becomes a plausible, complete, wrong row, which is
      // the whole reason these functions throw in the first place.
      teamsWithUnavailableGrandTotal.add(team.teamKey);
      built.push(degradedLedgerTeam(team));
    }
  }

  built.sort((a, b) => {
    if (a.projection !== b.projection) return b.projection - a.projection;
    if (a.earnedDistrictTotal !== b.earnedDistrictTotal) return b.earnedDistrictTotal - a.earnedDistrictTotal;
    return a.teamNumber - b.teamNumber;
  });

  const teams = built.map((team, index) => ({ ...team, position: index + 1 }));

  return {
    teams,
    gaps: {
      missingEventArtifacts: [...(options.gaps?.missingEventArtifacts ?? [])].sort(),
      eventsWithExcludedMatches: [...(options.gaps?.eventsWithExcludedMatches ?? [])].sort(),
      teamsWithoutAwardProfile: [...teamsWithoutAwardProfile].sort(),
      eventsWithFallbackFieldSize: [...(options.gaps?.eventsWithFallbackFieldSize ?? [])].sort(),
      eventsWithPartialAllianceList: [...(options.gaps?.eventsWithPartialAllianceList ?? [])].sort(),
      eventsWithUnresolvedElimMatches: [...(options.gaps?.eventsWithUnresolvedElimMatches ?? [])].sort(),
      teamsWithUnavailableGrandTotal: [...teamsWithUnavailableGrandTotal].sort(),
      unavailableEvents: [...unavailableByKey.entries()].map(([eventKey, name]) => ({ eventKey, name })).sort((a, b) => a.eventKey.localeCompare(b.eventKey)),
    },
  };
}

/**
 * The row model for a team whose ordinary build REFUSED — the fallback
 * `buildDistrictLedgerRows`' per-team catch pushes.
 *
 * ARITHMETIC ONLY, no simulation and no summary: every cell is `unavailable`,
 * the earned totals are summed straight off the artifact's own published
 * `eventPoints[].total`, and the projection is that sum plus the published
 * rookie bonus and adjustments — the same expression the `!everyEventTotalKnown`
 * branch above already uses for a team the tab holds no distribution for. So
 * this function has nothing left in it that can throw, which is what makes the
 * catch that calls it a genuine floor rather than a second place to fail.
 *
 * The team KEEPS its rows: dropping them would change the table's shape for
 * one team and make a row count disagree with an event list. It loses only the
 * numbers that could not be built.
 */
function degradedLedgerTeam(team: DistrictTeam): DistrictLedgerTeam {
  const entries = districtTierEvents(team);
  let earnedDistrictTotal = 0;
  const rows: DistrictLedgerEventRow[] = entries.map((entry) => {
    if (entry.earned !== undefined) earnedDistrictTotal += entry.earned.total;
    const derived = deriveStageFromState(entry.state);
    return {
      eventKey: entry.eventKey,
      eventName: entry.eventName,
      week: entry.week,
      stage: { ...derived, finished: derived.finished },
      cells: DISTRICT_CATEGORIES.map((category) => ({ id: districtCellId(entry.eventKey, category), cell: category, kind: "unavailable" as const })),
      eventTotal: { id: districtCellId(entry.eventKey, "eventTotal"), cell: "eventTotal" as const, kind: "unavailable" as const },
      earned: entry.earned,
      remainingMaxPoints: entry.remainingMaxPoints,
    };
  });
  const teamNumber = team.teamNumber ?? safeTeamNumber(team.teamKey);
  return {
    teamKey: team.teamKey,
    teamNumber,
    nickname: team.nickname ?? `Team ${String(teamNumber)}`,
    rows,
    rowCount: rows.length,
    earnedDistrictTotal,
    grandTotal: { id: GRAND_TOTAL_CELL_ID, cell: "grandTotal", kind: "unavailable" },
    projection: earnedDistrictTotal + team.rookieBonus + team.adjustments,
    hasOpenCategory: false,
    position: 0,
    rookieBonus: Math.max(0, Math.round(team.rookieBonus)),
  };
}

function safeTeamNumber(teamKey: string): number {
  try {
    return teamNumberFromKey(teamKey);
  } catch {
    return 0;
  }
}

/**
 * The team-number search filter: a prefix match on the team NUMBER, keeping
 * every one of that team's rows or none of them. An empty query keeps every
 * team; a query matching nothing yields an empty list, which the table renders
 * as its own filtered-to-zero empty state rather than as an error.
 */
export function filterDistrictLedgerTeams(teams: readonly DistrictLedgerTeam[], query: string): DistrictLedgerTeam[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [...teams];
  return teams.filter((team) => String(team.teamNumber).startsWith(trimmed));
}

/** The stat line's three numbers at the current position. */
export interface DistrictLedgerStatLine {
  /** The slot-th highest earned district-tier total — a FLOOR on where the real line ends up, since open categories can only add points. `null` when capacity is not published. */
  readonly todaysLineFloor: number | null;
  readonly openCells: number;
  readonly totalCells: number;
}

export function districtLedgerStatLine(teams: readonly DistrictLedgerTeam[], dcmpSlots: number | null): DistrictLedgerStatLine {
  let openCells = 0;
  let totalCells = 0;
  for (const team of teams) {
    for (const row of team.rows) {
      for (const cell of row.cells) {
        totalCells += 1;
        if (cell.kind === "open") openCells += 1;
      }
    }
  }
  // `locks.ts`'s own honest-null contract for an unpublished capacity: never a
  // guessed zero.
  if (dcmpSlots === null || dcmpSlots === 0 || teams.length === 0) {
    return { todaysLineFloor: null, openCells, totalCells };
  }
  const sortedDesc = teams.map((team) => team.earnedDistrictTotal).sort((a, b) => b - a);
  const index = Math.min(dcmpSlots, sortedDesc.length) - 1;
  return { todaysLineFloor: sortedDesc[index]!, openCells, totalCells };
}
