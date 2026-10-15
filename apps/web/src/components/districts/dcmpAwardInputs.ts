/**
 * THE WEB'S AWARD SLATE INPUTS at one position (quick task 261014-i8i for the
 * DCMP tier; quick task 261014-qje added the district tier, Q-01).
 *
 * A module of its own so neither `champLedgerChances.ts` nor
 * `districtRunAssembly.ts` imports the other: both read the same awards final
 * closure and the same eligibility from here, and the rule itself lives in
 * `packages/core/districts/dcmpAwardEligibility.ts`, its weights in the one
 * award model (`packages/core/districts/awardSlate.ts`).
 */
import { dcmpAwardEligibility, type DcmpAwardEligibility } from "../../../../../packages/core/districts/dcmpAwardEligibility.js";
import { buildDcmpAwardSlate, type DcmpAwardSlateInput } from "../../../../../packages/core/districts/dcmpAwardSlate.js";
import { buildDistrictAwardSlate, districtAwardEligibility, type AwardSlateInput } from "../../../../../packages/core/districts/awardSlate.js";
import { champCutoffTuning } from "../../../../../packages/core/districts/hypotheticalDcmp.js";
import { dcmpEligibilityTeamsFromArtifact, districtEventWeeksFromArtifact } from "../../../../../packages/harness/districtDcmpAwardInputs.js";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { dcmpEventKeysFor } from "./champLedgerRows.js";
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

/** Each artifact team's award profile, the zero profile for a team with none. */
function profileOfArtifact(artifact: DistrictArtifact): (teamKey: string) => ReturnType<typeof awardProfileOrZero> {
  const byKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  return (teamKey) => awardProfileOrZero(byKey.get(teamKey));
}

/**
 * The DCMP Impact, Engineering Inspiration and Rookie All Star eligibility at
 * one position, weighted by the one award model's class weights (quick task
 * 261014-qje, Q-11; no separate champ weighting remains). A team with no
 * award profile reads the zero profile.
 */
export function dcmpEligibilityAt(
  artifact: DistrictArtifact,
  stageByEvent: ReadonlyMap<string, DistrictStageFinality> | undefined
): DcmpAwardEligibility {
  return dcmpAwardEligibility({
    season: artifact.year,
    teams: dcmpEligibilityTeamsFromArtifact(artifact, awardProfileOrZero),
    awardFinal: dcmpAwardFinalAt(artifact, stageByEvent),
    profileOf: profileOfArtifact(artifact),
  });
}

/**
 * THE DCMP AWARD SLATE one DCMP tier request carries at one position (quick
 * task 261014-i8i). Built by `buildDcmpAwardSlate` from the SAME eligibility
 * the champ draws read (`dcmpEligibilityAt`) and the season's own
 * `champCutoffTuning` count mode, so the per event run and the champ draws read
 * one eligibility and one count model at one position. `cmpSlots` absent reads
 * 0, the champ draws' own fallback. `target` is a real DCMP tier key, or
 * `"wholeChampionship"` for the simulated DCMP bake that stands for a whole
 * championship.
 */
export function dcmpAwardSlateAt(
  artifact: DistrictArtifact,
  stageByEvent: ReadonlyMap<string, DistrictStageFinality> | undefined,
  target: { readonly eventKey: string } | "wholeChampionship"
): DcmpAwardSlateInput {
  const setting = champCutoffTuning(artifact.year).setting;
  return buildDcmpAwardSlate({
    season: artifact.year,
    districtKey: artifact.districtKey,
    cmpSlots: artifact.cmpSlots ?? 0,
    dcmpEventKeys: dcmpEventKeysFor(artifact),
    target,
    eligibility: dcmpEligibilityAt(artifact, stageByEvent),
    setting,
  });
}

/**
 * THE DISTRICT AWARD SLATE one district tier request carries at one position
 * (quick task 261014-qje, Q-01 and Q-05). Eligibility through the one rule
 * (`districtAwardEligibility`) over the artifact's district teams, the event
 * weeks the artifact carries and the awards final closure at the position;
 * weights from the one award model, a team with no profile reading the zero
 * profile. The slate lists every artifact team entered at the event at the
 * district tier; the input builder fits it to the event's actual award field
 * (`districtEligibilityForField`), so a guest from outside the district reads
 * chance 1. Throws `UnknownAwardSlateSeasonError` for a season with no district
 * tier table and `UnknownSeasonAwardListError` for an undeclared season list.
 */
export function districtAwardSlateAt(
  artifact: DistrictArtifact,
  stageByEvent: ReadonlyMap<string, DistrictStageFinality> | undefined,
  eventKey: string
): AwardSlateInput {
  const teams = dcmpEligibilityTeamsFromArtifact(artifact, awardProfileOrZero);
  const weeks = districtEventWeeksFromArtifact(artifact);
  const eligibility = districtAwardEligibility({
    season: artifact.year,
    eventKey,
    teams,
    weekOf: (key) => weeks.get(key) ?? null,
    awardFinal: dcmpAwardFinalAt(artifact, stageByEvent),
    profileOf: profileOfArtifact(artifact),
  });
  const entered = new Set(teams.filter((team) => team.districtEventKeys.includes(eventKey)).map((team) => team.teamKey));
  return buildDistrictAwardSlate({
    season: artifact.year,
    awardField: [...entered].map((teamKey) => ({ teamKey })),
    eligibility: eligibility.filter((entry) => entered.has(entry.teamKey)),
  });
}
