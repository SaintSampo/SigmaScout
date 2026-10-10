/**
 * WHETHER A CATEGORY'S NUMBER IS FINAL at the live position: the event's state
 * says the stage is over AND the points that prove it are in the district
 * artifact's own rows (quick task 261009-vp9). Pure, no I/O, no zod, no React.
 * The published verdict pass (`packages/harness/districtRankingsMerge.ts`) and
 * both Locks tabs (`apps/web/src/components/districts/districtLedgerRows.ts`)
 * call the SAME rule, so the published verdicts and the tabs cannot drift.
 *
 * ---------------------------------------------------------------------------
 * JACOB'S RULE
 * ---------------------------------------------------------------------------
 *
 * "It is mission critical that no team is told they are locked at any stop,
 * and then later they are not locked."
 *
 * ---------------------------------------------------------------------------
 * THE GAP THIS CLOSES
 * ---------------------------------------------------------------------------
 *
 * An event's state block (qualification matches played, alliances picked,
 * playoffs done) is derived from MATCH results and moves within a minute.
 * Each team's points per category come from TBA's district rankings, a
 * different feed. `districtEventCategoryFinality` reads the state alone. So
 * between a stage ending on the field and its points reaching the rankings a
 * category read final while its rows still held the old numbers: a rival lost
 * its playoff ceiling before its playoff points landed, a team read Locked,
 * and the points arriving took the Locked back. Replayed over the eight 2026
 * PNW district events through the shared merge and the District Locks status
 * code: 32 published `districtLock` take backs, 9 published `champLock`, 32
 * on the tab. With this rule: none.
 *
 * History is not affected. At a rewound stop the points are the season's
 * final ones. This is a gap at the LIVE position only.
 *
 * ---------------------------------------------------------------------------
 * THE TWO READINGS, NEVER MIXED
 * ---------------------------------------------------------------------------
 *
 *   1. WHAT HAS HAPPENED ON THE FIELD is the state alone,
 *      `districtEventCategoryFinality`. It drives the simulation run, the
 *      published alliances and the played bracket the run conditions on, the
 *      bracket facts, the timeline and the milestone rail.
 *   2. WHETHER A CATEGORY'S NUMBER IS FINAL is this module. It drives which
 *      cells are grey and everything the lock math reads: the floors, the
 *      ceilings, the pooled pool, both reservations and the winner gate.
 *
 * Nothing live goes dark while points lag. Only finality waits.
 *
 * ---------------------------------------------------------------------------
 * THE RULE, LINE BY LINE
 * ---------------------------------------------------------------------------
 *
 *   award    = awardsPosted
 *   elim     = award OR (playoffsDone AND some row at the event carries the
 *              WINNER's playoff value)
 *   alliance = award OR (alliancesPicked AND some row at the event carries
 *              alliance selection points above 0)
 *   qual     = alliance
 *
 * ONLY THE AWARDS FLAG CASCADES DOWN. Alliance selection and Playoffs each
 * need their OWN points. Playoffs final does NOT close Alliance selection:
 * the district rankings are one feed with four layers, and nothing proves the
 * layers always land in the order the event is played. When the playoff
 * points landed before the alliance points, the first version of this rule
 * read Alliance selection and Qualification final without a single alliance
 * point in the rows, and the alliance points arriving took a lock back
 * (walked on `2026orore`: 4 published district, 2 published champ, 4 on the
 * District Locks tab, 2 on the Champ Locks tab). The awards flag may cascade
 * because the live flag itself waits for award points AND playoff points at
 * the event and for a settled list (`eventAwards.ts`).
 *
 * AWARDS are the strong flag of quick tasks 261009-r9x and 261009-tx6 (a
 * judged award listed, award points present, playoff points present, the
 * list settled) and need no second proof here.
 *
 * PLAYOFFS. A team shows the winner's value only after TBA has scored the
 * deciding match, so a row at that value proves the playoff points are in.
 * The value is `maxEventPoints(season, tier).elim` (30 at a district event,
 * 90 at a championship or a division, in 2026). The test is "at or above":
 * over the 109 local district artifacts no row is ever above it.
 *
 * ALLIANCE SELECTION. Every picked team earns alliance points above 0, so one
 * such row proves the selection has been scored. Over those artifacts every
 * one of 1019 events with picked alliances has such a row.
 *
 * QUALIFICATION HAS NO PROOF OF ITS OWN. TBA shows provisional qualification
 * points while an event is being played, so their presence proves nothing.
 * The alliance points landing is the proof that qualification is over and
 * scored. Until then Qualification reads open at the live position even after
 * the last qualification match.
 *
 * AN ABSENT STATE reads every category open, as it always has.
 *
 * ---------------------------------------------------------------------------
 * THE ASSUMPTION THAT REMAINS, STATED PLAINLY
 * ---------------------------------------------------------------------------
 *
 * TBA computes an event's point categories together. Two things follow from
 * it, and NEITHER IS VERIFIED against a live event:
 *
 *   1. The qualification points are final once alliance points appear.
 *      Qualification has no proof of its own, so alliance points close it. If
 *      alliance points ever landed BEFORE the corrected qualification points,
 *      the corrected points arriving afterwards could take a lock back
 *      (walked on `2026orore`: 2 published district and 2 on the District
 *      Locks tab).
 *   2. Playoff points carried by a payload that also carries award points
 *      include the deciding match. The awards flag asks only that SOME row
 *      at the event carries playoff points above 0, not the winner's value,
 *      because an event whose winners carry no row never shows that value
 *      (see below).
 *
 * ---------------------------------------------------------------------------
 * A DIVISIONED CHAMPIONSHIP'S FINALS EVENT
 * ---------------------------------------------------------------------------
 *
 * A finals event (a dcmp tier key equal to its championship stem, with two or
 * more division keys beside it) has no qualification schedule and no alliance
 * selection of its own, so those two categories keep the state's own reading
 * there. Its Playoffs follow the rule with the finals champion maximum: 60 at
 * four divisions and 30 at two in a season the bracket module carries, and
 * the whole dcmp Playoffs ceiling otherwise. That last value is never paid at
 * a finals event, so in such a season its Playoffs read open until the awards
 * flag closes them, which is the open side.
 *
 * ---------------------------------------------------------------------------
 * AN EVENT WHOSE WINNERS CARRY NO ROW
 * ---------------------------------------------------------------------------
 *
 * Of 1042 local events whose playoffs are done, 36 have no row at the
 * winner's value: 8 finals events before 2023, 25 district events before
 * 2023, and 3 of 418 district events since 2023 (`2026njtab`, `2026mawor`,
 * `2026waahs`), where the winning alliance's full value sits on no row
 * because a team's third district event earns no row. At such an event the
 * Playoffs read open at the live position from the playoff points landing
 * until the awards flag turns true. That is the open side, and the flag then
 * closes every category at once.
 *
 * ---------------------------------------------------------------------------
 * THE GUARANTEE: THE RULE ONLY EVER OPENS
 * ---------------------------------------------------------------------------
 *
 * For every state and every presence, a category this rule reads final is
 * read final by `districtEventCategoryFinality` too. It never closes one
 * early. A rankings row alone closes nothing: the state has to say the stage
 * is over as well. `categoryCorroboration.test.ts` holds this over every
 * combination.
 *
 * On every finished event of the 109 local artifacts the awards flag is true,
 * so the cascade closes all four categories and this rule equals the state's
 * reading: 0 of 1124 events differ.
 *
 * ---------------------------------------------------------------------------
 * WHEN TBA POSTS POINTS DURING AN EVENT IS NOT VERIFIED
 * ---------------------------------------------------------------------------
 *
 * No live district weekend has been observed under this rule. Both cases are
 * covered, and neither is asserted:
 *
 *   - If the points lag by minutes, finality waits minutes.
 *   - If they arrive only when an event ends, the tab shows predictions
 *     conditioned on the field all event and no category reads final until
 *     then.
 */
import { BRACKET_REGISTERED_SEASONS, maxFinalsPointsByPlacement } from "./bracket.js";
import { championshipStemOf } from "./champReservedSlots.js";
import { maxEventPoints, type DistrictTier } from "./pointModel.js";
import { ALL_CATEGORIES_OPEN, districtEventCategoryFinality, type DistrictCategoryFinality, type DistrictEventStateFacts } from "./reservedSlots.js";

/** What the district artifact's own rows prove about one event, read across every team. */
export interface CategoryPointsPresence {
  /** Some `eventPoints` row at the event carries alliance selection points above 0. */
  readonly alliancePoints: boolean;
  /** Some `eventPoints` row at the event carries playoff points at or above the winner's value for that event. */
  readonly winnerPlayoffPoints: boolean;
  /** The event is a divisioned championship's finals event: no qualification and no alliance selection of its own. */
  readonly finalsEvent: boolean;
}

/** Nothing proven: what an event on no row reports. Every category the state alone would close reads open, Awards apart. */
export const NO_POINTS_PRESENT: CategoryPointsPresence = { alliancePoints: false, winnerPlayoffPoints: false, finalsEvent: false };

/**
 * The four category finalities at the LIVE position: the state's own reading,
 * narrowed to the categories whose points are in. See the header for each
 * line. An absent state reads every category open.
 */
export function corroboratedCategoryFinality(state: DistrictEventStateFacts | undefined, presence: CategoryPointsPresence): DistrictCategoryFinality {
  if (state === undefined) return ALL_CATEGORIES_OPEN;
  const award = state.awardsPosted;
  const elim = award || (state.playoffsDone && presence.winnerPlayoffPoints);
  if (presence.finalsEvent) {
    // No qualification and no selection of its own: the state's own reading.
    const field = districtEventCategoryFinality(state);
    return { qual: field.qual, alliance: field.alliance, elim, award };
  }
  // Only the awards flag cascades down: Playoffs final does not close
  // Alliance selection, which needs its own points.
  const alliance = award || (state.alliancesPicked && presence.alliancePoints);
  return { qual: alliance, alliance, elim, award };
}

/** How many DIVISION keys (a trailing digit, the same stem, not the stem itself) a championship stem holds among the dcmp tier keys. */
export function divisionCountOf(stem: string, dcmpEventKeys: readonly string[]): number {
  return dcmpEventKeys.filter((key) => key !== stem && championshipStemOf(key) === stem).length;
}

/**
 * The finals champion maximum of a championship with `divisions` divisions:
 * `maxFinalsPointsByPlacement` for a registered bracket season at 2 or 4
 * divisions, otherwise the whole 3x DCMP Playoffs ceiling (the conservative
 * side, for an earlier season or another division count).
 */
export function finalsChampionMaximum(season: number, divisions: number): number {
  if (BRACKET_REGISTERED_SEASONS.includes(season) && (divisions === 2 || divisions === 4)) return maxFinalsPointsByPlacement(season, divisions, 1);
  return maxEventPoints(season, "dcmp").elim;
}

/**
 * One team of a district artifact, narrowed to what the presence facts read.
 * Typed structurally so this module needs no artifact type and stays free of
 * zod.
 */
export interface CategoryPresenceTeam {
  readonly eventPoints: readonly { readonly eventKey: string; readonly tier: DistrictTier; readonly alliance: number; readonly elim: number }[];
  readonly remainingEvents: readonly { readonly eventKey: string; readonly tier: DistrictTier }[];
}

/**
 * The presence facts of every event any row names, read off the artifact's
 * own rows ONCE.
 *
 * An event's tier is taken from the first row that names it, across both row
 * lists. The two facts are set from `eventPoints` rows only: a
 * `remainingEvents` row carries no points. Every key on any row is in the
 * map, so an event only `remainingEvents` rows name reports nothing proven.
 *
 * THE TEAMS ARE TREATED AS IMMUTABLE. A caller may keep the returned map for
 * as long as it keeps the array it was built from, and must build a new one
 * for a new array.
 */
export function categoryPointsPresenceByEvent(teams: readonly CategoryPresenceTeam[], season: number): Map<string, CategoryPointsPresence> {
  const tierByEvent = new Map<string, DistrictTier>();
  for (const team of teams) {
    for (const row of team.eventPoints) if (!tierByEvent.has(row.eventKey)) tierByEvent.set(row.eventKey, row.tier);
    for (const row of team.remainingEvents) if (!tierByEvent.has(row.eventKey)) tierByEvent.set(row.eventKey, row.tier);
  }
  const dcmpKeys: string[] = [];
  for (const [eventKey, tier] of tierByEvent) if (tier === "dcmp") dcmpKeys.push(eventKey);

  const winnerValue = new Map<string, number>();
  const finals = new Set<string>();
  for (const [eventKey, tier] of tierByEvent) {
    if (tier === "district") {
      winnerValue.set(eventKey, maxEventPoints(season, "district").elim);
      continue;
    }
    // A key equal to its stem with two or more division keys beside it is a
    // finals event. A division and a single championship pay the dcmp value.
    const divisions = championshipStemOf(eventKey) === eventKey ? divisionCountOf(eventKey, dcmpKeys) : 0;
    if (divisions >= 2) {
      finals.add(eventKey);
      winnerValue.set(eventKey, finalsChampionMaximum(season, divisions));
    } else {
      winnerValue.set(eventKey, maxEventPoints(season, "dcmp").elim);
    }
  }

  const alliance = new Set<string>();
  const winner = new Set<string>();
  for (const team of teams) {
    for (const row of team.eventPoints) {
      if (row.alliance > 0) alliance.add(row.eventKey);
      if (row.elim >= (winnerValue.get(row.eventKey) ?? Number.POSITIVE_INFINITY)) winner.add(row.eventKey);
    }
  }

  const presence = new Map<string, CategoryPointsPresence>();
  for (const eventKey of tierByEvent.keys()) {
    presence.set(eventKey, { alliancePoints: alliance.has(eventKey), winnerPlayoffPoints: winner.has(eventKey), finalsEvent: finals.has(eventKey) });
  }
  return presence;
}
