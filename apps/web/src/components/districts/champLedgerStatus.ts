/**
 * The five statuses at the FIRST Championship tier, at one position.
 *
 * ONE PURE MODULE, no React, mirroring `districtLedgerStatus.ts`'s shape and
 * defining NO lock rule of its own: every verdict comes from
 * `packages/core/districts/locks.ts`, the award vocabulary from
 * `qualification.ts` and the ceilings from `pointModel.ts`.
 *
 * TWO DECISIONS THIS MODULE TAKES, both stated here because a reader will
 * otherwise wonder why it differs from the district tier's module:
 *
 * 1. IN RANGE / OUT OF RANGE IS DECIDED BY RANK, not by `>=` a cut line. The
 *    district tab reports the friendlier side for a team exactly at the line,
 *    on `locks.ts`'s tie philosophy. At the champ tier that would put BOTH
 *    teams tied at the 2026 PNW cut line In range and 22 teams into 21 slots.
 *    So a pool team is In range when its 1-based position in the champ
 *    ledger's own sorted order, restricted to the pool, is at most
 *    `pointsSlots`. The district tab's rule is untouched, and Today's line
 *    keeps `cutLinePointsWithQualifiers`' own semantics.
 *
 * 2. THE CHAMP TIER RESERVES NOTHING AND PASSES NO POOLED ARGUMENT.
 *    `reservedSlots.ts`'s own doc comment scopes the reservation to
 *    district-tier events ("Pass ONLY district-tier events: the DCMP's own
 *    consuming awards are a different tier with a different slot pool"), and
 *    `pooledLockInputs` models district event point pools. Inventing a
 *    champ-tier reservation would be a new guarantee rule sketch 022 does not
 *    ask for and `measureLedgerTenets.ts` does not measure. Both omissions are
 *    what reproduce `data/fixtures/phase10/district-2026pnw.json` exactly —
 *    `{locked: 12, lockedAward: 8, contending: 2, eliminated: 104}` with zero
 *    per-team disagreements and a cut line of 182, the artifact's own
 *    `insights.cmpCutLinePoints`. If a champ-tier reservation is ever wanted it
 *    is a separate MEASURED task, not a guess here.
 *
 * AWARD-QUALIFIED AT THIS TIER means the DCMP winning alliance once the
 * playoffs are done, and Impact, Engineering Inspiration or Rookie All Star at
 * the DCMP once awards are posted. A district-event Impact win qualifies a team
 * for the DCMP, not the Championship, so it locks nobody here — which is
 * exactly what restricting the scan to the dcmp event key enforces.
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
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { DISTRICT_CATEGORIES, type DistrictCategory, type DistrictStageFinality } from "./districtLedgerRows.js";
import { DISTRICT_LEDGER_STATUS_KEYS, type DistrictLedgerStatusKey, type DistrictLedgerStatusState } from "./districtLedgerStatus.js";
import { dcmpEventKeyFor, type ChampLedgerRow, type ChampLedgerTeam } from "./champLedgerRows.js";

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
  /** `cutLinePointsWithQualifiers` on the floors — the artifact's own `insights.cmpCutLinePoints` at an all-final position. `null` for an unpublished capacity. */
  readonly todaysLine: number | null;
  readonly awardQualified: readonly string[];
  readonly prequalified: readonly string[];
  /** ALWAYS ZERO at this tier — see decision 2 in this module's header. Exposed so a consumer never has to assume the rule holds. */
  readonly reservedSlots: number;
  /** `locks.ts`'s own narrowing: `cmpSlots` minus the ranked award qualifiers. The In range rank boundary. */
  readonly pointsSlots: number;
}

export interface ComputeChampLedgerStatusesOptions {
  readonly artifact: DistrictArtifact;
  /** The rows `champLedgerRows.ts` produced AT THIS POSITION, in its own sorted order — this module computes no second ordering. */
  readonly teams: readonly ChampLedgerTeam[];
}

const EMPTY_CENSUS: Record<LockStatus, number> = {
  locked: 0,
  lockedAward: 0,
  prequalified: 0,
  eliminated: 0,
  contending: 0,
  unknown: 0,
};

/** The stage of a row's single source event at this position, or every category OPEN where the row has no source. */
function rowStage(row: ChampLedgerRow): DistrictStageFinality {
  return row.sources[0]?.stage.final ?? { qual: false, alliance: false, elim: false, award: false };
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
 * A TEAM WHOSE MEMBERSHIP IS STILL `"open"` AND WHICH THE ARTIFACT LISTS NO
 * DCMP ROW FOR contributes no dcmp ceiling either, because the tab holds no
 * DCMP row to read a stage off. That is a narrower ceiling than the season
 * strictly allows and therefore the conservative side of `Locked out`; it is
 * stated rather than hidden because a future artifact that lists the DCMP field
 * as `remainingEvents` before the event starts would close it by itself.
 */
export function computeChampLedgerStatuses(options: ComputeChampLedgerStatusesOptions): ChampLedgerStatusModel {
  const { artifact, teams } = options;
  const districtCeilings = maxEventPoints(artifact.year, "district");
  const dcmpCeilings = maxEventPoints(artifact.year, "dcmp");
  const ceilingFor = (tier: "district" | "dcmp"): Readonly<Record<DistrictCategory, number>> => {
    const source = tier === "district" ? districtCeilings : dcmpCeilings;
    return { qual: source.qual, alliance: source.alliance, elim: source.elim, award: source.award };
  };
  const districtCeiling = ceilingFor("district");
  const dcmpCeiling = ceilingFor("dcmp");

  const sourceByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  const dcmpEventKey = dcmpEventKeyFor(artifact);
  const consuming = consumingAwardTypesForTier("dcmp");

  const lockInputs: LockTeamInput[] = [];
  const orderedKeys: string[] = [];
  const awardQualified = new Set<string>();
  const prequalified = new Set<string>();
  const awardKindByTeam = new Map<string, ChampAwardKind>();

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
        openCeiling += districtCeiling[category];
      }
    }

    // The DCMP row, at the 3x ceilings, and only for a team that is in the
    // field or may still be.
    const dcmpStage = rowStage(team.dcmpRow);
    const dcmpEntry = team.dcmpRow.sources[0];
    if (team.membership !== "out" && dcmpEntry !== undefined) {
      const earned = earnedByEvent.get(dcmpEntry.eventKey);
      for (const category of DISTRICT_CATEGORIES) {
        if (dcmpStage[category]) continue;
        if (earned !== undefined) floor -= earned[category];
        openCeiling += dcmpCeiling[category];
      }
    }

    lockInputs.push({ teamKey: team.teamKey, pointTotal: floor, maxRemaining: openCeiling });

    // PREQUALIFIED is the artifact's own curated Championship pre-qualification
    // (Hall of Fame, prior-year Championship results) — a fact about the team
    // that no position can reopen.
    if (source.champLock.status === "prequalified") prequalified.add(team.teamKey);

    for (const award of source.qualifyingAwards) {
      // A DISTRICT-event Impact win qualifies a team for the DCMP, not the
      // Championship, so only awards at the DCMP itself are read here.
      if (dcmpEventKey === undefined || award.eventKey !== dcmpEventKey) continue;
      if (!consuming.has(award.awardType)) continue;
      // AN AWARD THE SLIDER HAS REOPENED HAS NOT BEEN GIVEN OUT at this
      // position. The winning alliance is decided by the PLAYOFFS and the
      // judged awards by the AWARDS stage, so each is gated on its own
      // category.
      const gate = award.awardType === AWARD_TYPE_WINNER ? dcmpStage.elim : dcmpStage.award;
      if (!gate) continue;
      awardQualified.add(team.teamKey);
      // `winner` wins the label where a team holds both: it is the rarer and
      // more specific claim, and it is the one the DCMP tier adds over the
      // district's vocabulary.
      if (award.awardType === AWARD_TYPE_WINNER) awardKindByTeam.set(team.teamKey, "winner");
      else if (!awardKindByTeam.has(team.teamKey)) awardKindByTeam.set(team.teamKey, "award");
    }
  }

  const qualifiers: QualifierSets = { awardQualified, prequalified };

  // THREE ARGUMENTS. No reservation and no pooled argument — see decision 2 in
  // this module's header. Passing either would be a champ-tier guarantee rule
  // nothing has measured.
  const reservedSlots = 0;
  const verdicts = computeLocksWithQualifiers(lockInputs, artifact.cmpSlots, qualifiers, reservedSlots);
  const todaysLine = cutLinePointsWithQualifiers(lockInputs, artifact.cmpSlots, qualifiers);

  // THE POOL ORDER IS THE CHAMP LEDGER'S OWN SORTED ORDER, filtered to the
  // pool by `locks.ts`'s own exported narrowing — never a hand-rolled
  // subtraction, which is the class of bug `qualifierPool`'s doc comment
  // already names.
  const narrowing = pointsRaceSlots(orderedKeys, artifact.cmpSlots ?? 0, qualifiers, reservedSlots);
  const pointsSlots = artifact.cmpSlots === null ? 0 : narrowing.pointsSlots;
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
    todaysLine,
    awardQualified: [...awardQualified].sort(),
    prequalified: [...prequalified].sort(),
    reservedSlots,
    pointsSlots,
  };
}

/** Re-exported so the champ tab reads ONE list of chip keys rather than declaring a second. */
export { DISTRICT_LEDGER_STATUS_KEYS };
