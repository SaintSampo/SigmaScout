/**
 * WHO CAN WIN A DISTRICT CHAMPIONSHIP'S IMPACT, ENGINEERING INSPIRATION OR
 * ROOKIE ALL STAR AWARD, at one position in a season (quick task 261014-i8i;
 * its weights come from the one award model since quick task 261014-qje).
 *
 * THE RULE LIVES HERE AND NOWHERE ELSE. The champ cutoff draws
 * (`buildChampAwardDraws` on the web), the per event DCMP award slate
 * (`dcmpAwardSlate.ts`) and the district event eligibility
 * (`districtAwardEligibility` in `awardSlate.ts`) all read this module, so the
 * Champ Locks chance, the DCMP row's Awards cell and a district event's Awards
 * cell cannot disagree about who is eligible.
 *
 * THE RULE. A DCMP winner of one of these three awards had won the same award
 * at a district event that season in 148 of 149 (Impact), 110 of 111
 * (Engineering Inspiration) and 84 of 85 (Rookie All Star) cases. So, per award
 * type, at one position:
 *
 *  - a team HOLDING the award at a district tier event whose awards are final
 *    at the position is eligible: chance 1;
 *  - a team ENTERED at a district tier event whose awards are still open
 *    carries the chance it becomes that event's entrant. Over its open events
 *    E that is `1 - prod_E (1 - w_E / W_E)`, where `w_E` is its weight at E
 *    and `W_E` the sum over E's entrants. This is exactly the chance the champ
 *    draws make the team E's entrant in one run, so the two cannot disagree.
 *    An open event whose weights sum to 0 contributes 0;
 *  - every other team carries 0.
 *
 * A DCMP tier award never makes a team eligible: the set of events is the
 * union of the teams' DISTRICT tier events only.
 *
 * THE WEIGHTS ARE THE ONE AWARD MODEL'S (quick task 261014-qje, Q-11). There
 * is no separate champ weighting:
 *
 *  - a held candidate (who wins at the DCMP) weighs its DCMP tier class lift,
 *    `slateEntrantWeight(season, "dcmp", ...)`;
 *  - an entrant at an open district event (who wins there) weighs its district
 *    tier class lift, `slateEntrantWeight(season, "district", ...)`;
 *  - a season with no slate tables at that tier weighs the audience: 1 inside
 *    the award's audience, 0 outside it (Rookie All Star rookies only,
 *    Engineering Inspiration veterans only, Impact anyone);
 *  - an entrant already HOLDING that same award at a final district event
 *    weighs 0 at the open event (Q-05: no team wins Impact, Engineering
 *    Inspiration or Rookie All Star at two district events in one season).
 *
 * PURE AND BROWSER SAFE. It never imports `locks.ts`: no award prediction may
 * reach a Locked verdict, and a source test pins that. Its output is plain
 * arrays and objects, because the per event slate built from it crosses a
 * `postMessage` boundary.
 */
import { hasAwardSlateTables, inSlotAudience, slateEntrantWeight, TYPE_SLOT, type AwardSlateTier } from "./awardSlate.js";
import { DCMP_DRAWN_AWARD_TYPES, type DcmpDrawnAwardType } from "./hypotheticalDcmp.js";
import type { DistrictAwardProfile } from "./ledgerSimulation.js";

/** One team as the eligibility rule reads it. */
export interface DcmpEligibilityTeam {
  readonly teamKey: string;
  readonly rookie: boolean;
  /** Every award the team holds this season, at any event; only district tier events in the set count. */
  readonly heldAwards: readonly { readonly eventKey: string; readonly awardType: number }[];
  /** The team's district tier events this season, played or still to come. */
  readonly districtEventKeys: readonly string[];
}

/** One weighted team. A weight of zero never becomes an event's entrant. */
export interface DcmpEligibilityWeightedTeam {
  readonly teamKey: string;
  readonly weight: number;
}

/** One district tier event whose awards are still open at the position, with every team entered there. */
export interface DcmpEligibilityPendingEvent {
  readonly eventKey: string;
  readonly entrants: readonly DcmpEligibilityWeightedTeam[];
}

/** One award type's eligibility at the position. */
export interface DcmpAwardTypeEligibility {
  readonly awardType: DcmpDrawnAwardType;
  /** Teams holding the award at a district tier event whose awards are final, in team order. */
  readonly candidates: readonly DcmpEligibilityWeightedTeam[];
  /** The open district tier events, sorted by key. */
  readonly pendingEvents: readonly DcmpEligibilityPendingEvent[];
}

/** Every award type's eligibility, in `DCMP_DRAWN_AWARD_TYPES` order (Impact, Engineering Inspiration, Rookie All Star). */
export type DcmpAwardEligibility = readonly DcmpAwardTypeEligibility[];

export interface DcmpAwardEligibilityInput {
  /** The season priced: the slate tables the weights read are this season's. */
  readonly season: number;
  readonly teams: readonly DcmpEligibilityTeam[];
  /** Whether an event's awards are final at the position. */
  readonly awardFinal: (eventKey: string) => boolean;
  /** One team's award profile; the zero profile for a team with none, in every shipped caller. */
  readonly profileOf: (teamKey: string) => DistrictAwardProfile;
}

/**
 * One team's weight for one of the three awards at one tier (Q-11): the class
 * lift of the award's slot (`slateEntrantWeight`) when the season has slate
 * tables at that tier, else the audience weight (1 inside the award's
 * audience, 0 outside it). Checked with `hasAwardSlateTables`, never by
 * catching a refusal.
 */
export function eligibilityWeight(season: number, tier: AwardSlateTier, awardType: DcmpDrawnAwardType, profile: DistrictAwardProfile): number {
  if (hasAwardSlateTables(season, tier)) return slateEntrantWeight(season, tier, awardType, profile);
  return inSlotAudience(TYPE_SLOT.get(awardType)!, profile.rookieState) ? 1 : 0;
}

/** Every award type's held candidates and pending entrant events at one position. See the module header for the rule. */
export function dcmpAwardEligibility(input: DcmpAwardEligibilityInput): DcmpAwardEligibility {
  const { season, teams, awardFinal, profileOf } = input;
  const districtEventKeys = new Set<string>();
  const entrantsByEvent = new Map<string, DcmpEligibilityTeam[]>();
  for (const team of teams) {
    for (const eventKey of new Set(team.districtEventKeys)) {
      districtEventKeys.add(eventKey);
      const list = entrantsByEvent.get(eventKey) ?? [];
      list.push(team);
      entrantsByEvent.set(eventKey, list);
    }
  }
  const pendingKeys = [...districtEventKeys].filter((eventKey) => !awardFinal(eventKey)).sort();

  return DCMP_DRAWN_AWARD_TYPES.map((awardType) => {
    const holders = new Set<string>();
    for (const team of teams) {
      const held = team.heldAwards.some(
        (award) => award.awardType === awardType && districtEventKeys.has(award.eventKey) && awardFinal(award.eventKey)
      );
      if (held) holders.add(team.teamKey);
    }
    const candidates: DcmpEligibilityWeightedTeam[] = teams
      .filter((team) => holders.has(team.teamKey))
      .map((team) => ({ teamKey: team.teamKey, weight: eligibilityWeight(season, "dcmp", awardType, profileOf(team.teamKey)) }));
    const pendingEvents = pendingKeys.map((eventKey) => ({
      eventKey,
      entrants: (entrantsByEvent.get(eventKey) ?? []).map((team) => ({
        teamKey: team.teamKey,
        // Q-05: a team already holding this award at a final district event
        // cannot win it again at a district event that season.
        weight: holders.has(team.teamKey) ? 0 : eligibilityWeight(season, "district", awardType, profileOf(team.teamKey)),
      })),
    }));
    return { awardType, candidates, pendingEvents };
  });
}

/**
 * One team's chance of being eligible for one award type: 1 when it holds the
 * award, `1 - prod (1 - w / W)` over the open events it is entered at, 0
 * otherwise. An open event whose entrant weights sum to 0 contributes 0.
 */
export function dcmpEligibilityChance(eligibility: DcmpAwardEligibility, teamKey: string, awardType: DcmpDrawnAwardType): number {
  const entry = eligibility.find((candidate) => candidate.awardType === awardType);
  if (entry === undefined) return 0;
  if (entry.candidates.some((candidate) => candidate.teamKey === teamKey)) return 1;
  let missEverywhere = 1;
  for (const event of entry.pendingEvents) {
    let total = 0;
    let mine = 0;
    for (const entrant of event.entrants) {
      total += entrant.weight;
      if (entrant.teamKey === teamKey) mine += entrant.weight;
    }
    if (total <= 0 || mine <= 0) continue;
    missEverywhere *= 1 - mine / total;
  }
  return 1 - missEverywhere;
}
