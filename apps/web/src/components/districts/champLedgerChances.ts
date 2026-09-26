/**
 * The Champ Locks tab's two PURE chance halves: the "to be there" chance that
 * weights the DCMP row, and the SECOND advancement run over the champ grand
 * totals.
 *
 * No React, no `Worker`, and no estimator of its own. Both runs go through the
 * shipped `useDistrictAdvancementChance` hook and the shipped
 * `advancementChances` draws; this module owns only the widening, the
 * composition and the narrowing.
 *
 * WHY THERE IS NO PER-RUN FIELD MEMBERSHIP HERE. Requirement 2's "to be there"
 * chance is the per-team MARGINAL, which `advancementChances` already returns
 * as `chanceByTeam` — that map is literally the share of runs in which a team
 * sits inside the district's points slots, which IS the chance of being in the
 * DCMP field. Conditioning the DCMP's own predictions on a per-run field would
 * be a different and larger piece of work (an optional `membershipByRun` inside
 * `packages/core/districts/advancementChance.ts`'s existing per-run loop), and
 * it is deliberately not built: the DCMP's predictions come from the shipped
 * per-event machinery on the DCMP event artifact's REAL roster, so no run needs
 * a field of its own.
 *
 * THE CHIP STILL WINS. `reconcileChampAdvancementChances` is the shipped
 * narrowing at the champ tier: a chance prints under In range and Out of range
 * alone, and a disagreement with a guarantee is counted and never printed.
 */
import type { AdvancementChanceInputs } from "../../../../../packages/core/districts/advancementChance.js";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import {
  prepareChanceRanking,
  reconcileAdvancementChances,
  type DistrictAdvancementChanceRun,
  type DistrictLedgerChanceModel,
} from "./districtLedgerChances.js";
import type { DistrictLedgerStatusModel } from "./districtLedgerStatus.js";
import type { ChampLedgerTeam } from "./champLedgerRows.js";
import type { ChampLedgerStatusModel } from "./champLedgerStatus.js";

/**
 * THE CHANCE OF BEING IN THE DISTRICT CHAMPIONSHIP FIELD, per team.
 *
 * The district-tier run's raw marginal, WIDENED BY THE DISTRICT-TIER VERDICTS
 * so a guarantee is never printed as a probability:
 *
 * - `locked` and `prequalified` read exactly 1. They are in the field.
 * - `lockedOut` reads exactly 0. They are not.
 * - `inRange` and `outOfRange` read the marginal, which is the whole question.
 * - Every other team — an unpublished capacity, or a team the run could not
 *   rank — is ABSENT from the returned map, which reads as `undefined` at the
 *   call site and is DISCLOSED there as `gaps.teamsWithoutFieldChance`.
 *
 * A SILENT ZERO WOULD BE THE WORST ANSWER AVAILABLE. It erases every DCMP point
 * from a bubble team's grand total and sorts it down the table, which is a far
 * larger lie than an absence the tab names.
 *
 * This is the one and only new consumer of the shipped district run: no second
 * estimator, and no change to `packages/core`.
 */
export function districtFieldMembershipChances(
  rawChanceByTeam: ReadonlyMap<string, number>,
  districtStatuses: DistrictLedgerStatusModel
): ReadonlyMap<string, number> {
  const byTeam = new Map<string, number>();
  for (const [teamKey, result] of districtStatuses.byTeam) {
    if (result.status === "locked" || result.status === "prequalified") {
      byTeam.set(teamKey, 1);
      continue;
    }
    if (result.status === "lockedOut") {
      byTeam.set(teamKey, 0);
      continue;
    }
    if (result.status !== "inRange" && result.status !== "outOfRange") continue;
    const raw = rawChanceByTeam.get(teamKey);
    if (raw === undefined) continue;
    byTeam.set(teamKey, raw);
  }
  return byTeam;
}

export interface BuildChampAdvancementChanceRunOptions {
  readonly artifact: DistrictArtifact;
  /** The champ rows built AT THIS POSITION, in `champLedgerRows.ts`'s own sorted order. */
  readonly teams: readonly ChampLedgerTeam[];
  /** The champ verdicts at the SAME position — the source of the qualifier sets. */
  readonly statuses: ChampLedgerStatusModel;
  /** The per-event run's own signature when its result is in hand, or `null` while a run is in flight. `null` suppresses the request entirely. */
  readonly runSignature: string | null;
  /** The rewind position id, so moving the slider always re-runs. */
  readonly positionId: string;
  /** The dcmp event key this fold read — a district whose championship key changes is a different race. */
  readonly dcmpEventKey: string | undefined;
  /** The per-team field chance the grand totals were mixed at. A moving field chance moves every grand total, so it moves the signature. */
  readonly fieldChanceByTeam: ReadonlyMap<string, number>;
}

/**
 * The champ chance signature.
 *
 * MIRRORS `chanceSignature`'s composition — the artifact's identity and publish
 * timestamp, the capacity, the position, the per-event run's signature, the
 * qualifier sets, the reservation and each team's own grand-total shape — and
 * adds the two things only this tier has: the dcmp event key, and the per-team
 * FIELD CHANCE. The field chance is in it because it is an input the grand
 * totals are a function of and nothing else in the list moves with it: a
 * district run that shifts one bubble team from 40% to 60% leaves the artifact,
 * the position, the per-event signature and every grand-total LENGTH untouched,
 * so a signature blind to it would leave the champ chances quietly stale in the
 * minutes they matter.
 */
function champChanceSignature(
  options: BuildChampAdvancementChanceRunOptions,
  chanceTeams: AdvancementChanceInputs["teams"],
  excludedTeams: readonly string[]
): string {
  const { artifact, statuses, runSignature, positionId, dcmpEventKey, fieldChanceByTeam } = options;
  return [
    excludedTeams.join("+"),
    artifact.districtKey,
    artifact.generation,
    artifact.computedAt,
    String(artifact.cmpSlots),
    dcmpEventKey ?? "-",
    positionId,
    runSignature ?? "",
    String(statuses.reservedSlots),
    statuses.awardQualified.join("+"),
    statuses.prequalified.join("+"),
    [...fieldChanceByTeam]
      .map(([teamKey, chance]) => `${teamKey}=${chance.toFixed(6)}`)
      .sort()
      .join(","),
    chanceTeams.map((team) => `${team.teamKey}=${String(team.counts.length)}/${String(team.denominator)}`).join(","),
  ].join("|");
}

/**
 * The SECOND advancement run: each team's CHAMP grand total (the variant-A
 * mixture, chance of being in the field already folded in) ranked against
 * `artifact.cmpSlots`.
 *
 * Every refusal is `prepareChanceRanking`'s — the shipped four, plus the two
 * exclusion bounds — reading `cmpSlots` in place of `dcmpSlots`. Nothing is
 * restated here but the capacity.
 */
export function buildChampAdvancementChanceRun(
  options: BuildChampAdvancementChanceRunOptions
): DistrictAdvancementChanceRun | undefined {
  const { artifact, teams, statuses, runSignature } = options;
  const prepared = prepareChanceRanking(teams, artifact.cmpSlots, runSignature);
  if (prepared === undefined) return undefined;

  const inputs: AdvancementChanceInputs = {
    teams: prepared.chanceTeams,
    slots: artifact.cmpSlots!,
    awardQualified: statuses.awardQualified,
    prequalified: statuses.prequalified,
    // ALWAYS ZERO at this tier — `champLedgerStatus.ts`'s decision 2. The run
    // must count the slots exactly as the verdicts beside it did.
    reservedSlots: statuses.reservedSlots,
  };
  return {
    inputs,
    signature: champChanceSignature(options, prepared.chanceTeams, prepared.excludedTeams),
    excludedTeams: prepared.excludedTeams,
  };
}

/**
 * The shipped narrowing at the champ tier: a chance prints under In range and
 * Out of range alone, and a disagreement with a guarantee is counted in `gaps`
 * and never printed.
 *
 * Delegates to `reconcileAdvancementChances` rather than restating it, so the
 * two tabs cannot come to disagree about which chips may carry a number.
 */
export function reconcileChampAdvancementChances(
  chanceByTeam: ReadonlyMap<string, number>,
  champStatuses: ChampLedgerStatusModel
): DistrictLedgerChanceModel {
  return reconcileAdvancementChances(chanceByTeam, champStatuses);
}
