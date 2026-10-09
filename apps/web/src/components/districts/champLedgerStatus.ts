/**
 * The five statuses at the FIRST Championship tier, at one position.
 *
 * ONE PURE MODULE, no React, mirroring `districtLedgerStatus.ts`'s shape and
 * defining NO lock rule of its own: every verdict comes from
 * `packages/core/districts/locks.ts`, the award vocabulary from
 * `qualification.ts` and the ceilings from `pointModel.ts`.
 *
 * THE DECISIONS THIS MODULE TAKES, all stated here because a reader will
 * otherwise wonder why it differs from the district tier's module:
 *
 * 1. IN RANGE / OUT OF RANGE IS DECIDED BY RANK, not by `>=` a cut line. The
 *    district tab reports the friendlier side for a team exactly at the line,
 *    on `locks.ts`'s tie philosophy. At the champ tier that would put BOTH
 *    teams tied at the 2026 PNW cut line In range and 22 teams into 21 slots.
 *    So a pool team is In range when its 1-based position in the champ
 *    ledger's own sorted order, restricted to the pool, is at most
 *    `pointsSlots`. The district tab's rule is untouched, and `floorCutLine`
 *    keeps `cutLinePointsWithQualifiers`' own semantics. Neither rule decides
 *    the PREDICTED CUTOFF the tab prints: that is derived from this ordering
 *    by `predictedCutoff.ts` and moves no chip.
 *
 * 2. THE CHAMP TIER RESERVES ITS OWN SLOTS AND PASSES NO POOLED ARGUMENT.
 *    Until quick task 261006-3gg this tier reserved nothing, on the reading
 *    that the DCMP's consuming qualifications were "a different tier with a
 *    different slot pool". They are — and that pool is exactly the one this
 *    module's `"locked"` test is about. A DCMP winning alliance member or a
 *    judged consuming award winner takes a Championship slot whatever its
 *    points, so a rival whose ceiling sits below a team's floor, never a
 *    threat to the ceiling test, can still take a slot out from under it.
 *    FNC 2026 at the "playoffs done, awards open" stop showed frc7890 Locked
 *    with 10 threats against 11 slots; four of the five judged consuming
 *    awards then went to teams below 7890's floor. The sweep in
 *    `scripts/measureChampTenets.ts` found nine such displays across the
 *    published seasons. `packages/core/districts/champReservedSlots.ts` owns
 *    the rule (the winning alliance while the playoffs are open, every judged
 *    consuming award at its historical ceiling while the awards are open,
 *    nothing once the awards are final); this module owns only the DCMP's
 *    stage at the position, read off the rows, and the subtraction. The
 *    reservation feeds `lockSlots` alone, exactly as the district tier's does:
 *    `"eliminated"`, `floorCutLine` and the In range rank rule stay on the
 *    unreserved count. `pooledLockInputs` still models district event point
 *    pools only, so no pooled argument is passed. At an all-final position the
 *    reservation is zero and `data/fixtures/phase10/district-2026pnw.json`
 *    reproduces exactly as before — `{locked: 12, lockedAward: 8, contending:
 *    2, eliminated: 104}`, cut line 182.
 *
 * 3. IN RANGE / OUT OF RANGE, AS SHOWN, CUT AT THE SIMULATED LINE (quick task
 *    260927-6bf, decision L2). Decision 1's rank rule above is the VERDICT the
 *    rest of the tab and the champ run read. What the chips SHOW comes from
 *    `applyChampRangeState`, below, over the one `champRangeState` the cutoff
 *    view also reads: until the DCMP awards post, a contending team is In
 *    range iff its median is at or above the simulated line, and while that
 *    line is still being computed (Jacob's 2026-09-27 chip timing decision) or
 *    cannot be drawn at all, the two chips read a neutral placeholder or No
 *    call, never the rank rule. Once the awards post, nothing is drawn any
 *    more and the rank rule stands.
 *
 * 4. A TEAM KNOCKED OUT OF THE PLAYOFFS HAS ITS PLAYOFF POINTS SETTLED AT ONCE
 *    (quick task 261008-26o). FNC 2026 at the DCMP Round 5 stop had six teams
 *    at 99% and none Locked, because every team, an alliance already out
 *    included, kept the whole 3x Playoffs ceiling (90 in 2026) until the
 *    Finals posted. A source whose alliance's bracket placement is decided
 *    now carries `settledElim` from the row builder's one derivation
 *    (`settledPlayoffPoints`), and it replaces the whole Playoffs ceiling:
 *    TBA's exact number joins the floor, a placement table value joins only
 *    the ceiling, because TBA prorates a team that sat out part of the
 *    playoffs (frc3663 at 2026pncmp, fourth place alliance worth 21, was paid
 *    12). A team left off every alliance is not settled: a backup robot is
 *    called from that pool and paid for its share. The award ceiling and
 *    decision 2's reservation are unchanged. A placement table value enters
 *    the ceiling at the placement's MAXIMUM, `SettledPlayoffs.ceiling` (quick
 *    task 261009-2tr, CONTEXT D7): a losing finalist that won one Finals match
 *    is paid 75 at a 2026 DCMP while its cell prints 60.
 *
 *    EVERY DCMP SOURCE IS FOLDED (quick task 261009-kt3, CONTEXT D3). A team
 *    at a divisioned championship carries its division row and, once TBA pays
 *    it there, a finals row (2026 frc27: micmp1 66, 48, 90, 0 and micmp 0, 0,
 *    60, 30). Each source's open categories leave the floor at its own stage.
 *    A finals source's Qualification and Alliance selection ceilings are 0, its
 *    Playoffs ceiling is the finals champion maximum (60 at four divisions, 30
 *    at two) and is never settled from a bracket, and its Awards ceiling is the
 *    3x DCMP one. A division team with no finals row carries the finals
 *    champion maximum while the finals' Playoffs are open
 *    (`champFinalsCeilingWithoutRow`), since TBA writes a finals row only once
 *    it pays one. Each DCMP award is gated on its OWN event's stage: the winner
 *    and consuming awards of a divisioned championship are given at its finals.
 *
 * 5. THE JOINT WORST CASE PROOF (quick task 261009-2tr). A second proof of
 *    `"locked"`, OR-ed with the ceiling test and superseding nothing, exactly
 *    as `locks.ts` ORs its pooled test. Decision 2's reservation and the
 *    ceiling test give every rival the whole award ceiling independently and
 *    hold back a flat number of slots; the joint proof instead counts, for each
 *    team, the most rivals that can take a slot from it in any way the bracket,
 *    the backup robots and the award budget can still fall, counting each
 *    rival once, and locks the team when that count is below the points slots.
 *    It runs only at a SINGLE championship (exactly one dcmp tier key, so the
 *    divisioned FIM, NE, ON and TX and 2026 California's two championships keep
 *    the shipped path), once the DCMP's Qualification and Alliance selection
 *    are final and while its Awards are open, with the complete eight alliance
 *    list and every played playoff row resolved (`DcmpBracketFacts`, carried on
 *    `distributions`). With the Playoffs final it runs only once the winner
 *    award is posted, or the routed final names the winner. Anywhere else
 *    `jointProof` names why it did not run and the statuses are exactly the
 *    shipped ones. In the proof a placement pays its MAXIMUM
 *    (`maxPlayoffPointsByPlacement`, 75, 39 and 21 at 2026), never
 *    `playoffPoints`, and a decided placement that is not exact already sits in
 *    the ceiling at its maximum through decision 4. `champJointLock.ts` owns the
 *    argument, the one point paying award per rival cap included; this module
 *    owns only reading the facts off the rows.
 *
 * AWARD-QUALIFIED AT THIS TIER means the DCMP winning alliance once the
 * playoffs are done, and Impact, Engineering Inspiration or Rookie All Star at
 * the DCMP once awards are posted — at any of the district's championships
 * (two for 2026 California, quick task 261006-lwo). A district-event Impact
 * win qualifies a team for the DCMP, not the Championship, so it locks nobody
 * here — which is exactly what restricting the scan to dcmp-tier keys enforces.
 */
import {
  computeLocksWithQualifiers,
  cutLinePointsWithQualifiers,
  pointsRaceSlots,
  type LockResult,
  type LockStatus,
  type LockTeamInput,
  type QualifierSets,
} from "../../../../../packages/core/districts/locks.js";
import { AWARD_TYPE_WINNER, consumingAwardTypesForTier } from "../../../../../packages/core/districts/qualification.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import { dcmpAwardCountCeilings, dcmpJudgedAwardCeiling, dcmpJudgedAwardPoints } from "../../../../../packages/core/districts/hypotheticalDcmp.js";
import {
  championshipStemOf,
  dcmpNeverHappening,
  MAX_WINNING_ALLIANCE_SIZE,
  pendingAwardSlots,
  perChampionship,
  reservedChampSlots,
} from "../../../../../packages/core/districts/champReservedSlots.js";
import { BRACKET_REGISTERED_SEASONS, maxFinalsPointsByPlacement, maxPlayoffPointsByPlacement } from "../../../../../packages/core/districts/bracket.js";
import { dcmpBracketState, jointLockedTeams, type JointLockAlliance, type JointLockInput } from "../../../../../packages/core/districts/champJointLock.js";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import {
  DISTRICT_CATEGORIES,
  settledElimBounds,
  tierEvents,
  type DistrictCategory,
  type DistrictEventDistributions,
  type DistrictStageFinality,
  type SettledPlayoffs,
} from "./districtLedgerRows.js";
import { DISTRICT_LEDGER_STATUS_KEYS, type DistrictLedgerStatusKey, type DistrictLedgerStatusState } from "./districtLedgerStatus.js";
import { dcmpEventKeysFor, type ChampLedgerTeam } from "./champLedgerRows.js";
import type { ChampNoCallReason, ChampRangeState } from "./champLedgerChances.js";
import { applyLedgerRangeState, type LedgerRangeCall } from "./ledgerRangeState.js";

/** Which kind of award locked a team — the chip reads `Locked · winner` or `Locked · award`. */
export type ChampAwardKind = "winner" | "award";

export interface ChampLedgerStatusResult {
  readonly teamKey: string;
  readonly status: DistrictLedgerStatusState;
  /** True when an AWARD is the reason a team is Locked — a note on one status rather than a second status. */
  readonly byAward: boolean;
  /** `"winner"` for the DCMP winning alliance, `"award"` for a judged award, `null` for every team the points math decided. */
  readonly awardKind: ChampAwardKind | null;
  readonly verdict: LockStatus;
  readonly lockedBy: LockResult["lockedBy"];
  /** 1-based rank inside the POINTS POOL in the champ ledger's own sorted order, or `null` for a team outside the pool. */
  readonly poolRank: number | null;
}

export interface ChampLedgerStatusModel {
  readonly byTeam: ReadonlyMap<string, ChampLedgerStatusResult>;
  /**
   * The CHIP counts, over the WHOLE district and never over the filtered view.
   * `locked` is `locked` PLUS `lockedAward`, because the chip says "Locked" for
   * both — a test comparing this against `insights.champLockedCount` is testing
   * the wrong number, since that field counts the `locked` verdict alone.
   */
  readonly counts: Readonly<Record<DistrictLedgerStatusKey, number>>;
  /** The raw six-status `locks.ts` census, which IS what `insights.champLockedCount`/`champEliminatedCount` count. */
  readonly verdictCensus: Readonly<Record<LockStatus, number>>;
  /**
   * `cutLinePointsWithQualifiers` ON THE FLOORS: the artifact's own
   * `insights.cmpCutLinePoints` at an all final position, `null` for an
   * unpublished capacity.
   *
   * NOT RENDERED ANYWHERE. The tab prints the PREDICTED CUTOFF instead (quick
   * task 260926-37q), which is the midpoint of the boundary pair over the
   * MEDIAN PROJECTIONS the table is sorted by. This field is kept for exactly
   * one reason: it is the only thing in the repo proving this module's
   * recompute reproduces `insights.cmpCutLinePoints`, which
   * `champLedgerStatus.test.ts` pins.
   */
  readonly floorCutLine: number | null;
  readonly awardQualified: readonly string[];
  readonly prequalified: readonly string[];
  /**
   * How many Championship slots were HELD BACK at this position for the DCMP's
   * own consuming qualifications still to come — decision 2 in this module's
   * header, `champReservedSlots.ts` for the rule. Zero once the DCMP's awards
   * are final, which is every finished season.
   */
  readonly reservedSlots: number;
  /** `locks.ts`'s own narrowing: `cmpSlots` minus the ranked award qualifiers. The In range rank boundary. */
  readonly pointsSlots: number;
  /**
   * Whether the joint worst case proof ran at this position (decision 5), with
   * its input and the teams it locked, or why it did not. Always set by
   * `computeChampLedgerStatuses`; optional only so a hand built model needs no
   * edit.
   */
  readonly jointProof?: ChampJointProof;
  /**
   * Every team's FLOOR at the position (the lock input's `pointTotal`): the
   * corpus sweep's D3 assertion reads it (quick task 261009-kt3). Always set by
   * `computeChampLedgerStatuses`; optional only so a hand built model needs no
   * edit.
   */
  readonly floorByTeam?: ReadonlyMap<string, number>;
  /** Every team's CEILING at the position (floor plus the open ceiling). Set alongside `floorByTeam`. */
  readonly ceilingByTeam?: ReadonlyMap<string, number>;
}

/** Why the joint proof did not run at a position, in the order the preconditions are checked. */
export type JointProofSkipReason =
  | "noDistributions"
  | "notSingleChampionship"
  | "noBracketFacts"
  | "stageNotEligible"
  | "noCapacity"
  | "neverHappening"
  | "winnerNotPosted"
  | "bracketUnroutable"
  | "noCandidateWinner";

/** The joint proof at one position: its input and the teams it locked, or the first precondition it failed. */
export type ChampJointProof =
  | { readonly applied: true; readonly input: JointLockInput; readonly locked: ReadonlySet<string> }
  | { readonly applied: false; readonly reason: JointProofSkipReason };

/**
 * What a decided placement that is NOT exact adds to a team's `extra` in the
 * joint proof, beyond the `settled.ceiling` `settledElimBounds` already put
 * there (261009-2tr planner reading 12, reduced by CONTEXT D7). Zero for no
 * settled value, an exact one, or a team the proof's own routing places (the
 * placement's maximum already sits in the ceiling). A team with a settled value
 * that is not exact and NO routed placement gets the rest of the whole DCMP
 * Playoffs ceiling, so its total is that ceiling.
 */
export function jointDecidedPlacementTopUp(settled: SettledPlayoffs | undefined, placement: number | undefined, season: number): number {
  if (settled === undefined || settled.exact) return 0;
  if (placement !== undefined) return 0;
  return Math.max(0, maxEventPoints(season, "dcmp").elim - settled.ceiling);
}

export interface ComputeChampLedgerStatusesOptions {
  readonly artifact: DistrictArtifact;
  /** The rows `champLedgerRows.ts` produced AT THIS POSITION, in its own sorted order — this module computes no second ordering. */
  readonly teams: readonly ChampLedgerTeam[];
  /**
   * The teams the DISTRICT-tier verdict has eliminated at this position.
   *
   * Read for exactly one thing: the hypothetical DCMP ceiling a team gets
   * while the championship is not on the artifact yet. A team the district
   * tier has locked OUT cannot reach the field, so it gets none — which is
   * `districtRankingsMerge.ts`'s own `maxRemainingChamp` gate
   * (`stillAhead && !hasPlayedDcmp && districtLock.status !== "eliminated"`),
   * read off the verdicts the tab already computed rather than recomputed
   * here.
   *
   * ABSENT MEANS "no team is ruled out", which grants every team the ceiling.
   * That OVERSTATES rivals' ceilings, which is the only safe direction: an
   * overstated rival delays a `"locked"` verdict, an understated one would
   * publish a guarantee that is not true.
   */
  readonly districtLockedOut?: ReadonlySet<string>;
  /**
   * The calendar year at the time of the call, for `dcmpNeverHappening`'s
   * past-season clause. Defaults to the clock; a test passes it so a fixture
   * without `state` blocks reads the same in every year.
   */
  readonly nowYear?: number;
  /**
   * The tab's distributions, read for exactly one thing: the District
   * Championship's `dcmpBracket` facts, which the joint proof (decision 5)
   * needs. Absent means the proof never runs, which is the shipped behaviour
   * byte for byte.
   */
  readonly distributions?: ReadonlyMap<string, DistrictEventDistributions>;
}

const EMPTY_CENSUS: Record<LockStatus, number> = {
  locked: 0,
  lockedAward: 0,
  prequalified: 0,
  eliminated: 0,
  contending: 0,
  unknown: 0,
};

const ALL_OPEN_STAGE: DistrictStageFinality = { qual: false, alliance: false, elim: false, award: false };

/** How many DIVISION keys (a trailing digit, the same stem, not the stem itself) a championship stem holds among the dcmp tier keys. */
function divisionCountOf(stem: string, dcmpEventKeys: readonly string[]): number {
  return dcmpEventKeys.filter((key) => key !== stem && championshipStemOf(key) === stem).length;
}

/**
 * The finals champion maximum of a championship with `divisions` divisions:
 * `maxFinalsPointsByPlacement` for a registered bracket season at 2 or 4
 * divisions, otherwise the whole 3x DCMP Playoffs ceiling (the conservative
 * side, for an earlier season or another division count).
 */
function finalsChampionMaximum(season: number, divisions: number): number {
  if (BRACKET_REGISTERED_SEASONS.includes(season) && (divisions === 2 || divisions === 4)) return maxFinalsPointsByPlacement(season, divisions, 1);
  return maxEventPoints(season, "dcmp").elim;
}

/**
 * The open category ceilings of a FINALS source of a divisioned championship
 * (quick task 261009-kt3, planner reading R1), or `undefined` for any other
 * dcmp key. A finals row carries no Qualification or Alliance selection points;
 * its Playoffs pay at most the finals champion maximum
 * (`maxFinalsPointsByPlacement`, 60 at four divisions, 30 at two) and its
 * Awards at most the 3x DCMP Awards ceiling. A division count other than 2 or 4
 * keeps the whole 3x Playoffs ceiling.
 */
function finalsSourceCeiling(
  eventKey: string,
  dcmpEventKeys: readonly string[],
  season: number,
  dcmpCeiling: Readonly<Record<DistrictCategory, number>>
): Readonly<Record<DistrictCategory, number>> | undefined {
  if (championshipStemOf(eventKey) !== eventKey) return undefined;
  const divisions = divisionCountOf(eventKey, dcmpEventKeys);
  if (divisions < 2) return undefined;
  return { qual: 0, alliance: 0, elim: finalsChampionMaximum(season, divisions), award: dcmpCeiling.award };
}

/**
 * THE FINALS PLAYOFFS CEILING OF A DIVISION TEAM WITH NO FINALS ROW (quick task
 * 261009-kt3, planner reading R2). A finals row exists only for a team TBA paid
 * there, so a live artifact may carry none before the finals pay, while a four
 * division finalist is paid 30. A team with a source at a division of a stem
 * that holds 2 or more division keys, and no source at that stem's parent,
 * therefore carries the finals champion maximum (90 when the division count is
 * not 2 or 4) while the parent's Playoffs are not final (all open where no row
 * carries the parent). Zero in every other case, so it can never fire on a
 * single championship (one key) or on two championships (each one key).
 */
export function champFinalsCeilingWithoutRow(
  sourceKeys: readonly string[],
  dcmpEventKeys: readonly string[],
  season: number,
  stageByEvent: ReadonlyMap<string, DistrictStageFinality>
): number {
  let total = 0;
  const seen = new Set<string>();
  for (const key of sourceKeys) {
    const stem = championshipStemOf(key);
    if (stem === key || seen.has(stem)) continue;
    seen.add(stem);
    const divisions = divisionCountOf(stem, dcmpEventKeys);
    if (divisions < 2) continue;
    if (sourceKeys.includes(stem)) continue;
    if ((stageByEvent.get(stem) ?? ALL_OPEN_STAGE).elim) continue;
    total += finalsChampionMaximum(season, divisions);
  }
  return total;
}

/**
 * Computes every team's champ-tier status at the position the rows were built
 * at.
 *
 * THE FLOOR IS DERIVED BY SUBTRACTION from `source.pointTotal`, across BOTH
 * tiers, never by a re-sum — `districtLedgerStatus.ts`'s own reason applies
 * unchanged: `pointTotal` carries the rookie bonus, the adjustments and TBA's
 * own arithmetic, and a re-sum would silently drop all three. At a position
 * where nothing is reopened the floor is EXACTLY `pointTotal`, which is what
 * reproduces the artifact.
 *
 * THE CEILING is the floor plus each open category's own TIER ceiling:
 * `maxEventPoints(year, "district")` per open district-tier category counted
 * once per district-tier event, and `maxEventPoints(year, "dcmp")` for the DCMP
 * row's. A team whose membership is `"out"` contributes NO dcmp ceiling — it is
 * not in the field and cannot earn there.
 *
 * A TEAM THE ARTIFACT LISTS NO DCMP ROW FOR gets ONE WHOLE HYPOTHETICAL DCMP
 * added to its ceiling, on the artifact's own `maxRemainingChamp` gates: not
 * already played a championship, and not eliminated by the district-tier
 * verdict. This is the pre-registration window — `remainingEvents` comes from
 * TBA registrations and a team registers only after it qualifies, so for most
 * of the district season NO team has a dcmp row. Reading that as "no ceiling"
 * would Lock out most of a district in week one, which is the one direction the
 * lock math must never err in.
 *
 * A SETTLED PLAYOFFS CATEGORY (quick task 261008-26o, decision 4) is the one
 * exception to "open means earned out, ceiling in", on the District points
 * row and the DCMP row alike: a source carrying `settledElim` has its earned
 * `elim` (0 where TBA has no row) leave the floor, and `settledElimBounds`
 * replaces the whole Playoffs ceiling. Rewound over a finished event the
 * settled value IS TBA's `elim`, so it rejoins the floor and the two cancel.
 * Live mid playoffs it is the placement table's value, an upper bound TBA can
 * prorate down, so it joins the ceiling only.
 */
export function computeChampLedgerStatuses(options: ComputeChampLedgerStatusesOptions): ChampLedgerStatusModel {
  const { artifact, teams, districtLockedOut } = options;
  const districtCeilings = maxEventPoints(artifact.year, "district");
  const dcmpCeilings = maxEventPoints(artifact.year, "dcmp");
  const ceilingFor = (tier: "district" | "dcmp"): Readonly<Record<DistrictCategory, number>> => {
    const source = tier === "district" ? districtCeilings : dcmpCeilings;
    return { qual: source.qual, alliance: source.alliance, elim: source.elim, award: source.award };
  };
  const districtCeiling = ceilingFor("district");
  const dcmpCeiling = ceilingFor("dcmp");
  /** One whole District Championship's maximum — the hypothetical ceiling for a team the artifact does not name a championship for yet. */
  const dcmpMaxTotal = dcmpCeiling.qual + dcmpCeiling.alliance + dcmpCeiling.elim + dcmpCeiling.award;

  const sourceByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  const dcmpEventKeyList = dcmpEventKeysFor(artifact);
  const dcmpEventKeys = new Set(dcmpEventKeyList);
  const consuming = consumingAwardTypesForTier("dcmp");

  // EVERY dcmp tier event's stage at this position, read off the rows (the one
  // place the rewind rail writes it), over EVERY source of every team, first
  // seen per key (quick task 261009-kt3, reading R3). A key no row carries
  // reads all open. The reservation, the award gate and the joint proof read it.
  const dcmpStageByEvent = new Map<string, DistrictStageFinality>();
  for (const team of teams) {
    for (const source of team.dcmpRow.sources) {
      if (!dcmpStageByEvent.has(source.eventKey)) dcmpStageByEvent.set(source.eventKey, source.stage.final);
    }
  }

  const lockInputs: LockTeamInput[] = [];
  const orderedKeys: string[] = [];
  const awardQualified = new Set<string>();
  const prequalified = new Set<string>();
  const awardKindByTeam = new Map<string, ChampAwardKind>();
  // THE JOINT PROOF'S READINGS (decision 5): per team, the open ceiling minus
  // the two DCMP pieces the proof models itself, and the DCMP source's settled
  // Playoffs value for a team in the field.
  const jointExtraByTeam = new Map<string, number>();
  const dcmpSettledByEvent = new Map<string, Map<string, SettledPlayoffs | undefined>>();
  const winnerPostedAt = new Set<string>();

  for (const team of teams) {
    const source = sourceByKey.get(team.teamKey);
    if (source === undefined) continue;
    orderedKeys.push(team.teamKey);

    let floor = source.pointTotal;
    let openCeiling = 0;

    // The District points row: one event's worth of ceiling per open category
    // per district-tier event, and that event's earned points out of the floor.
    const earnedByEvent = new Map(source.eventPoints.map((row) => [row.eventKey, row] as const));
    for (const entry of team.districtRow.sources) {
      const earned = earnedByEvent.get(entry.eventKey);
      for (const category of DISTRICT_CATEGORIES) {
        if (entry.stage.final[category]) continue;
        if (earned !== undefined) floor -= earned[category];
        if (category === "elim" && entry.settledElim !== undefined) {
          // Knocked out of this event's playoffs: settled, by the one rule.
          const settled = settledElimBounds(entry.settledElim);
          floor += settled.floor;
          openCeiling += settled.ceiling;
          continue;
        }
        openCeiling += districtCeiling[category];
      }
    }

    // The DCMP row, at the 3x ceilings, and only for a team that is in the
    // field or may still be. EVERY source is folded (quick task 261009-kt3,
    // CONTEXT D3): a team at a divisioned championship carries its division
    // row and, once paid there, its finals row, and the finals' open points
    // must leave the floor at a rewound stop exactly as the division's do.
    const dcmpSources = team.dcmpRow.sources;
    let jointModeled = 0;
    if (team.membership !== "out" && dcmpSources.length > 0) {
      for (const dcmpEntry of dcmpSources) {
        const dcmpStage = dcmpEntry.stage.final;
        const finalsCeiling = finalsSourceCeiling(dcmpEntry.eventKey, dcmpEventKeyList, artifact.year, dcmpCeiling);
        // The finals Playoffs are never settled from a bracket (reading R1):
        // open until the finals' Playoffs stage is final.
        const settledElim = finalsCeiling === undefined ? dcmpEntry.settledElim : undefined;
        let settledAtKey = dcmpSettledByEvent.get(dcmpEntry.eventKey);
        if (settledAtKey === undefined) {
          settledAtKey = new Map();
          dcmpSettledByEvent.set(dcmpEntry.eventKey, settledAtKey);
        }
        settledAtKey.set(team.teamKey, settledElim);
        const ceiling = finalsCeiling ?? dcmpCeiling;
        const earned = earnedByEvent.get(dcmpEntry.eventKey);
        for (const category of DISTRICT_CATEGORIES) {
          if (dcmpStage[category]) continue;
          if (earned !== undefined) floor -= earned[category];
          if (category === "elim" && settledElim !== undefined) {
            // Knocked out of the DCMP playoffs: settled in place of the whole 3x
            // ceiling (decision 4 in this module's header).
            const settled = settledElimBounds(settledElim);
            floor += settled.floor;
            openCeiling += settled.ceiling;
            continue;
          }
          openCeiling += ceiling[category];
          // The joint proof models the open DCMP Awards and an unsettled open
          // DCMP Playoffs category itself (261009-2tr planner reading 5), the
          // finals' two included (261009-kt3 reading R1).
          if (category === "award" || category === "elim") jointModeled += ceiling[category];
        }
      }
      // A division team with no finals row may still be paid in the finals
      // (reading R2); zero at a single championship and at two championships.
      const finalsWithoutRow = champFinalsCeilingWithoutRow(
        dcmpSources.map((entry) => entry.eventKey),
        dcmpEventKeyList,
        artifact.year,
        dcmpStageByEvent
      );
      openCeiling += finalsWithoutRow;
      jointModeled += finalsWithoutRow;
    } else if (team.membership !== "out" && dcmpSources.length === 0) {
      // THE PRE-REGISTRATION WINDOW. The artifact names no championship for
      // this team, so there is no row to read a stage off — but the season
      // plainly still allows one, and a status that pretended otherwise would
      // Lock out a team that can still play three more days of competition.
      //
      // The ceiling is one whole hypothetical DCMP, granted on the artifact's
      // own two gates: the team has not already played one, and the district
      // tier has not eliminated it. This is `maxRemainingChamp`'s rule, and it
      // is what keeps the verdicts computable all season rather than only
      // after registrations open.
      const hasPlayedDcmp = source.eventPoints.some((row) => row.tier === "dcmp");
      if (!hasPlayedDcmp && districtLockedOut?.has(team.teamKey) !== true) openCeiling += dcmpMaxTotal;
    }

    lockInputs.push({ teamKey: team.teamKey, pointTotal: floor, maxRemaining: openCeiling });
    jointExtraByTeam.set(team.teamKey, openCeiling - jointModeled);

    // PREQUALIFIED is the artifact's own curated Championship pre-qualification
    // (Hall of Fame, prior-year Championship results) — a fact about the team
    // that no position can reopen.
    if (source.champLock.status === "prequalified") prequalified.add(team.teamKey);

    for (const award of source.qualifyingAwards) {
      // A DISTRICT-event Impact win qualifies a team for the DCMP, not the
      // Championship, so only awards at a DCMP are read here — at ANY of the
      // district's championships (quick task 261006-lwo; 2026 California ran
      // two). The stage gate below is the award's OWN event's (quick task
      // 261009-kt3, reading R3): a divisioned championship's winner and
      // consuming awards are given at its finals event, whose stage is not the
      // team's division's.
      if (!dcmpEventKeys.has(award.eventKey)) continue;
      if (!consuming.has(award.awardType)) continue;
      // AN AWARD THE SLIDER HAS REOPENED HAS NOT BEEN GIVEN OUT at this
      // position. The winning alliance is decided by the PLAYOFFS and the
      // judged awards by the AWARDS stage, so each is gated on its own
      // category.
      const awardStage = dcmpStageByEvent.get(award.eventKey) ?? ALL_OPEN_STAGE;
      const gate = award.awardType === AWARD_TYPE_WINNER ? awardStage.elim : awardStage.award;
      if (!gate) continue;
      if (award.awardType === AWARD_TYPE_WINNER) winnerPostedAt.add(award.eventKey);
      awardQualified.add(team.teamKey);
      // `winner` wins the label where a team holds both: it is the rarer and
      // more specific claim, and it is the one the DCMP tier adds over the
      // district's vocabulary.
      if (award.awardType === AWARD_TYPE_WINNER) awardKindByTeam.set(team.teamKey, "winner");
      else if (!awardKindByTeam.has(team.teamKey)) awardKindByTeam.set(team.teamKey, "award");
    }
  }

  const qualifiers: QualifierSets = { awardQualified, prequalified };

  // THE CHAMP-TIER RESERVATION — decision 2 in this module's header. Each
  // dcmp-tier event's stage at this position (`dcmpStageByEvent`, over every
  // source) is folded to one stage per CHAMPIONSHIP: FIM's four divisions and
  // their finals are one championship at the finals' stage, California's two
  // keys are two (`perChampionship`). One reservation per championship,
  // summed. With no dcmp row anywhere one whole championship is open, which is
  // the conservative answer. No pooled argument is passed.
  const awardCeilings = dcmpAwardCountCeilings(artifact.year, artifact.districtKey, artifact.cmpSlots ?? 0).counts;
  const neverHappening = dcmpNeverHappening({
    dcmpStates: artifact.teams.flatMap((team) => tierEvents(team, "dcmp").map((entry) => entry.state)),
    artifactYear: artifact.year,
    nowYear: options.nowYear ?? new Date().getUTCFullYear(),
  });
  let reservedSlots = 0;
  const stageByChampionship = perChampionship(dcmpStageByEvent, ALL_OPEN_STAGE);
  for (const stage of stageByChampionship.size === 0 ? [ALL_OPEN_STAGE] : stageByChampionship.values()) {
    reservedSlots += reservedChampSlots({ elimFinal: stage.elim, awardFinal: stage.award, awardCeilings, neverHappening });
  }
  // THE POOL ORDER IS THE CHAMP LEDGER'S OWN SORTED ORDER, filtered to the
  // pool by `locks.ts`'s own exported narrowing — never a hand-rolled
  // subtraction, which is the class of bug `qualifierPool`'s doc comment
  // already names. It reads nothing from the verdicts, so the joint proof can
  // read it before they are computed.
  const narrowing = pointsRaceSlots(orderedKeys, artifact.cmpSlots ?? 0, qualifiers, reservedSlots);
  const pointsSlots = artifact.cmpSlots === null ? 0 : narrowing.pointsSlots;

  // THE JOINT WORST CASE PROOF — decision 5 in this module's header.
  const floorByTeam = new Map(lockInputs.map((input) => [input.teamKey, input.pointTotal] as const));
  const jointProof = jointProofAt({
    artifact,
    distributions: options.distributions,
    dcmpStageByEvent,
    neverHappening,
    winnerPostedAt,
    narrowing,
    floorByTeam,
    jointExtraByTeam,
    dcmpSettledByEvent,
    qualifiers,
    awardCeilings,
  });
  const jointLocked = jointProof.applied ? jointProof.locked : undefined;

  const verdicts = computeLocksWithQualifiers(lockInputs, artifact.cmpSlots, qualifiers, reservedSlots, undefined, jointLocked);
  const floorCutLine = cutLinePointsWithQualifiers(lockInputs, artifact.cmpSlots, qualifiers);
  const poolRankByTeam = new Map(narrowing.poolKeys.map((teamKey, index) => [teamKey, index + 1] as const));

  const byTeam = new Map<string, ChampLedgerStatusResult>();
  const counts: Record<DistrictLedgerStatusKey, number> = { prequalified: 0, locked: 0, inRange: 0, outOfRange: 0, lockedOut: 0 };
  const verdictCensus: Record<LockStatus, number> = { ...EMPTY_CENSUS };

  for (const verdict of verdicts) {
    verdictCensus[verdict.status] += 1;
    const poolRank = poolRankByTeam.get(verdict.teamKey) ?? null;
    let status: DistrictLedgerStatusState;
    let byAward = false;
    if (verdict.status === "prequalified") {
      status = "prequalified";
    } else if (verdict.status === "locked") {
      status = "locked";
    } else if (verdict.status === "lockedAward") {
      status = "locked";
      byAward = true;
    } else if (verdict.status === "eliminated") {
      status = "lockedOut";
    } else if (verdict.status === "unknown" || poolRank === null) {
      status = "capacityUnknown";
    } else {
      status = poolRank <= pointsSlots ? "inRange" : "outOfRange";
    }
    if (status !== "capacityUnknown") counts[status] += 1;
    byTeam.set(verdict.teamKey, {
      teamKey: verdict.teamKey,
      status,
      byAward,
      awardKind: byAward ? (awardKindByTeam.get(verdict.teamKey) ?? "award") : null,
      verdict: verdict.status,
      lockedBy: verdict.lockedBy,
      poolRank,
    });
  }

  return {
    byTeam,
    counts,
    verdictCensus,
    floorCutLine,
    awardQualified: [...awardQualified].sort(),
    prequalified: [...prequalified].sort(),
    reservedSlots,
    pointsSlots,
    jointProof,
    floorByTeam,
    ceilingByTeam: new Map(lockInputs.map((input) => [input.teamKey, input.pointTotal + input.maxRemaining] as const)),
  };
}

interface JointProofAtInput {
  readonly artifact: DistrictArtifact;
  readonly distributions: ReadonlyMap<string, DistrictEventDistributions> | undefined;
  readonly dcmpStageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  readonly neverHappening: boolean;
  /** The dcmp tier keys whose winner award is posted at the position. */
  readonly winnerPostedAt: ReadonlySet<string>;
  readonly narrowing: ReturnType<typeof pointsRaceSlots>;
  readonly floorByTeam: ReadonlyMap<string, number>;
  readonly jointExtraByTeam: ReadonlyMap<string, number>;
  /** Per dcmp tier key, each team with a source there and its settled Playoffs value (undefined when unsettled). */
  readonly dcmpSettledByEvent: ReadonlyMap<string, ReadonlyMap<string, SettledPlayoffs | undefined>>;
  readonly qualifiers: QualifierSets;
  readonly awardCeilings: Parameters<typeof pendingAwardSlots>[0];
}

/** The eight alliance numbers of the DCMP bracket. */
const DCMP_ALLIANCE_NUMBERS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Decision 5's preconditions, in order, and the proof's input read off the
 * rows. The first failed precondition is the reason; otherwise the proof runs.
 */
function jointProofAt(input: JointProofAtInput): ChampJointProof {
  const { artifact, distributions, narrowing } = input;
  if (distributions === undefined) return { applied: false, reason: "noDistributions" };
  const dcmpKeys = dcmpEventKeysFor(artifact);
  if (dcmpKeys.length !== 1) return { applied: false, reason: "notSingleChampionship" };
  const dcmpKey = dcmpKeys[0]!;
  const facts = distributions.get(dcmpKey)?.dcmpBracket;
  if (facts === undefined) return { applied: false, reason: "noBracketFacts" };
  const stage = input.dcmpStageByEvent.get(dcmpKey);
  if (stage === undefined || !stage.qual || !stage.alliance || stage.award) return { applied: false, reason: "stageNotEligible" };
  if (artifact.cmpSlots === null) return { applied: false, reason: "noCapacity" };
  if (input.neverHappening) return { applied: false, reason: "neverHappening" };

  const dcmpSettledByTeam = input.dcmpSettledByEvent.get(dcmpKey) ?? new Map<string, SettledPlayoffs | undefined>();
  const routing = dcmpBracketState(facts.playedMatches, DCMP_ALLIANCE_NUMBERS);
  let candidateWinners: (number | null)[];
  let aliveAlliances: number[];
  if (stage.elim) {
    // Playoffs final (planner reading 8): the posted winner has left the pool,
    // or the routed final names the winner; otherwise nothing is known.
    aliveAlliances = [];
    if (input.winnerPostedAt.has(dcmpKey)) candidateWinners = [null];
    else if (routing?.decidedWinner !== undefined) candidateWinners = [routing.decidedWinner];
    else return { applied: false, reason: "winnerNotPosted" };
  } else {
    if (routing === undefined) return { applied: false, reason: "bracketUnroutable" };
    // Alive for the proof (planner reading 6): unplaced by the routing, or any
    // listed pick in the field without a settled Playoffs value, whose
    // playoff points could otherwise fall between its floor and the proof.
    const alive = new Set(routing.alive);
    for (const alliance of facts.alliances) {
      const unsettled = alliance.picks.some((pick) => dcmpSettledByTeam.has(pick) && dcmpSettledByTeam.get(pick) === undefined);
      if (unsettled) alive.add(alliance.allianceNumber);
    }
    aliveAlliances = [...alive].sort((a, b) => a - b);
    candidateWinners = routing.decidedWinner !== undefined ? [routing.decidedWinner] : aliveAlliances;
  }
  if (candidateWinners.length === 0) return { applied: false, reason: "noCandidateWinner" };

  // Members (CONTEXT D2): the picks whose DCMP alliance selection points are
  // above 0. A listed pick at 0 is a backup robot that joined in the playoffs.
  const allianceSelectionPoints = new Map<string, number>();
  for (const team of artifact.teams) {
    const row = team.eventPoints.find((entry) => entry.eventKey === dcmpKey);
    if (row !== undefined) allianceSelectionPoints.set(team.teamKey, row.alliance);
  }
  const alliances: JointLockAlliance[] = facts.alliances.map((alliance) => ({
    allianceNumber: alliance.allianceNumber,
    members: alliance.picks.filter((pick) => (allianceSelectionPoints.get(pick) ?? 0) > 0),
  }));
  const placementOfTeam = new Map<string, number>();
  for (const alliance of facts.alliances) {
    const placement = routing?.placementByAlliance.get(alliance.allianceNumber);
    if (placement === undefined) continue;
    for (const pick of alliance.picks) if (!placementOfTeam.has(pick)) placementOfTeam.set(pick, placement);
  }

  const proofInput: JointLockInput = {
    pool: narrowing.poolKeys.map((teamKey) => ({
      teamKey,
      floor: input.floorByTeam.get(teamKey)!,
      extra:
        (input.jointExtraByTeam.get(teamKey) ?? 0) +
        jointDecidedPlacementTopUp(dcmpSettledByTeam.get(teamKey), placementOfTeam.get(teamKey), artifact.year),
    })),
    slotOnlyRivals: [...input.qualifiers.prequalified].filter((teamKey) => !input.qualifiers.awardQualified.has(teamKey)).sort(),
    pointsSlots: narrowing.pointsSlots,
    alliances,
    aliveAlliances,
    candidateWinners,
    placementPoints: [2, 3, 4].map((placement) => maxPlayoffPointsByPlacement(artifact.year, "dcmp", placement)),
    consumingAwards: pendingAwardSlots(input.awardCeilings),
    judgedAwards: dcmpJudgedAwardCeiling(),
    judgedAwardPoints: dcmpJudgedAwardPoints(artifact.year),
    maxAllianceSize: MAX_WINNING_ALLIANCE_SIZE,
  };
  return { applied: true, input: proofInput, locked: jointLockedTeams(proofInput) };
}

/** What a contending team's chip SHOWS while the simulated line is not in hand: a neutral placeholder, never the rank rule. An alias of the shared type. */
export type ChampRangeCall = LedgerRangeCall;

/** One team's DISPLAYED status. `rangeCall` is set only for a contending team whose In range or Out of range call is withheld. */
export interface ChampDisplayStatusResult extends ChampLedgerStatusResult {
  readonly rangeCall?: ChampRangeCall;
}

/** The statuses the chips render: the verdict model, with the contending teams' calls taken from the range state. */
export interface ChampDisplayStatusModel extends ChampLedgerStatusModel {
  readonly byTeam: ReadonlyMap<string, ChampDisplayStatusResult>;
  /** Set while the In range and Out of range calls are withheld: their filter chips print an em dash, never a count. */
  readonly withheld: ChampRangeCall | undefined;
  /** The named terminal reason, for the `noCall` arm alone. */
  readonly noCallReason: ChampNoCallReason | undefined;
}

/**
 * THE CHIPS, from the ONE range state the cutoff view also reads (decision L2
 * and Jacob's 2026-09-27 chip timing decision).
 *
 * Touches ONLY contending teams, the ones decision 1 called In range or Out of
 * range. Locked, Locked · award, Locked · winner, Locked out, prequalified and
 * the capacity refusal come straight from the verdicts in every arm, so they
 * render immediately. Verdicts, `verdictCensus`, `floorCutLine`,
 * `awardQualified`, `prequalified`, `reservedSlots` and `pointsSlots` pass
 * through untouched.
 *
 * - `settled`: the shipped rank rule, unchanged.
 * - `simulated`: In range iff the median projection is at or above the line.
 * - `pending` and `noCall`: the call is WITHHELD. The team is carried as
 *   `capacityUnknown`, the one state that already means no chip call, no
 *   chance line and visible under every filter, with `rangeCall` naming why,
 *   and the two counts read as withheld. The rank rule ordering never leaves
 *   this function in these two arms.
 *
 * A delegation to the shared `applyLedgerRangeState` since quick task
 * 261004-uw4, where the District Locks tab's chips read the same function.
 */
export function applyChampRangeState(
  statuses: ChampLedgerStatusModel,
  teams: readonly ChampLedgerTeam[],
  state: ChampRangeState
): ChampDisplayStatusModel {
  return applyLedgerRangeState(statuses, teams, state);
}

/** Re-exported so the champ tab reads ONE list of chip keys rather than declaring a second. */
export { DISTRICT_LEDGER_STATUS_KEYS };
