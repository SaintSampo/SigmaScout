/**
 * THE WEB'S DCMP AWARD INPUTS at one position (quick task 261014-i8i).
 *
 * A module of its own so neither `champLedgerChances.ts` nor
 * `districtRunAssembly.ts` imports the other: both read the same awards final
 * closure and the same eligibility from here, and the rule itself lives in
 * `packages/core/districts/dcmpAwardEligibility.ts`.
 */
import {
  dcmpAwardEligibility,
  dcmpEntrantWeight,
  type DcmpAwardEligibility,
} from "../../../../../packages/core/districts/dcmpAwardEligibility.js";
import type { ChampCutoffSetting } from "../../../../../packages/core/districts/hypotheticalDcmp.js";
import { dcmpEligibilityTeamsFromArtifact } from "../../../../../packages/harness/districtDcmpAwardInputs.js";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { awardProfileOrZero, deriveStageFromState, tierEvents, type DistrictStageFinality } from "./districtLedgerRows.js";

/**
 * Whether an event's awards are final at the position: the position's own
 * stage where `stageByEvent` supplies one, else the event entry's own `state`
 * (the first entry met, district tier then DCMP tier, in team order), else
 * false. Covers both tiers' entries.
 */
export function dcmpAwardFinalAt(
  artifact: DistrictArtifact,
  stageByEvent?: ReadonlyMap<string, DistrictStageFinality>
): (eventKey: string) => boolean {
  const nowAwardFinal = new Map<string, boolean>();
  for (const team of artifact.teams) {
    for (const tier of ["district", "dcmp"] as const) {
      for (const entry of tierEvents(team, tier)) {
        if (!nowAwardFinal.has(entry.eventKey)) nowAwardFinal.set(entry.eventKey, deriveStageFromState(entry.state).final.award);
      }
    }
  }
  return (eventKey: string): boolean => stageByEvent?.get(eventKey)?.award ?? nowAwardFinal.get(eventKey) ?? false;
}

/**
 * The DCMP Impact, Engineering Inspiration and Rookie All Star eligibility at
 * one position, weighted by `dcmpEntrantWeight` under `setting.weighting`. A
 * team with no award profile reads the zero profile.
 */
export function dcmpEligibilityAt(
  artifact: DistrictArtifact,
  stageByEvent: ReadonlyMap<string, DistrictStageFinality> | undefined,
  setting: ChampCutoffSetting
): DcmpAwardEligibility {
  const byKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  return dcmpAwardEligibility({
    teams: dcmpEligibilityTeamsFromArtifact(artifact, awardProfileOrZero),
    awardFinal: dcmpAwardFinalAt(artifact, stageByEvent),
    weight: (team, awardType) => dcmpEntrantWeight(awardProfileOrZero(byKey.get(team.teamKey)), awardType, artifact.year, setting.weighting),
  });
}
