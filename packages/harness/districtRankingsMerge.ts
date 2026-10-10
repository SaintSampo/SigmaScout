/**
 * THE ONE PRODUCER of the merged district shape.
 *
 * Before phase 10 `v1/district/{districtKey}.json` had exactly one producer,
 * `scripts/publishDistricts.ts`'s `buildDistrictArtifact`. It now has two: the
 * offline publisher and the live Worker's district pass. Rather than let two
 * implementations of the same shape drift, both call the functions below —
 * `scripts/publishDistricts.ts` (10-06) and `apps/worker` (10-05) are CALLERS,
 * and neither reimplements the merge or the verdict pass.
 *
 * PURITY CONTRACT, stated the way `./manifestSchemas.ts` states its own,
 * because the Worker bundles this file: zero I/O, zero Node built-ins, no
 * corpus import, no `better-sqlite3`, nothing under
 * `packages/core/algorithms/`, and no clock — every timestamp and generation
 * string arrives as an argument. It may import only `zod`,
 * `./pageArtifacts.js` and modules under `packages/core/districts/`.
 * `packages/harness/browserSafeSchemas.test.ts` holds this file to its STRICT
 * assertion (no Node built-in AND nothing under `packages/core/algorithms/`),
 * so a future import that breaks the Worker bundle fails there by name.
 *
 * WHY THE MERGE IS A FUNCTION AND NOT INLINE WORKER CODE: the Worker has no
 * corpus (`10-RESEARCH.md` Pitfall 3). It can only read back what was
 * published, merge in what `/district/{key}/rankings` supplies, and recompute
 * the verdicts. Everything else — `eventName`, `week`, `remainingEvents`,
 * `teamNumber`, `nickname`, `qualifyingAwards` — must be CARRIED FORWARD from
 * the artifact rather than rebuilt, and an empty or duplicated rankings
 * response must refuse rather than blank a published district. Those are the
 * rules that are easy to get subtly wrong twice.
 *
 * ONE FIELD IS CARRIED FORWARD AND EXTENDED (quick task 261009-r9x).
 * `qualifyingAwards` is never rebuilt and never shortened, but when the caller
 * supplies this tick's awards lists (`eventAwards`), `applyDistrictEventAwards`
 * appends the record of every qualifying award a district team won. The same
 * step raises `state.awardsPosted` through the one shared rule
 * (`packages/core/districts/eventAwards.ts`), and it runs before the verdict
 * pass, so the flag, the winner records and both lock verdicts come out of one
 * build.
 *
 * THE CALLER SAYS WHICH LISTS HAVE SETTLED (quick task 261009-tx6). The live
 * rule needs to know that a list has stood unchanged for an hour. This
 * module has no clock and gains none: the caller passes the event keys whose
 * list is settled (`settledAwardEvents`), and an absent set settles nothing.
 *
 * THE CALLER MEASURES, THIS MODULE DECIDES (quick task 261009-vp9). The flag
 * also waits for every consuming award an event gives, and for 12 unchanged
 * hours where one is not listed. The caller hands a second set, the events
 * whose list has stood for 12 hours (`longSettledAwardEvents`). This module
 * knows the event's tier, whether it is a division and which award types the
 * list holds, and asks the one rule.
 *
 * A CHAMPIONSHIP WHOSE ROWS ARRIVE ONE EVENT AT A TIME (quick task
 * 261010-66y). The rows learn a District Championship key only when TBA posts
 * it, so for some ticks the artifact can hold one division, or one of two
 * championships, and nothing of the others. Three readings of the verdict
 * pass follow from that, each documented where it lives:
 *
 *   - a championship's FIRST rows land with no state block, and on the two
 *     live entry points such a row reads wholly open while the championship
 *     is still ahead (`openAtPlayedRows`, the option
 *     `statelessChampionshipRowsOpen`);
 *   - every team with a live division row carries the finals Playoffs maximum
 *     until the finals' Playoffs are final, and the finals' Awards add no
 *     ceiling for anyone (`openAtPlayedRows`, THE FINALS);
 *   - while the field is not proven after a start
 *     (`packages/core/districts/dcmpFieldProof.ts`, the one rule both Locks
 *     tabs read too) the champ reservation holds the championships that may
 *     be unseen (`reservedChampSlotsAtNow`), and a team with no championship
 *     row carries a finals on its hypothetical championship (pass 2).
 *
 * THE LIMITS, stated: the Worker still writes those first rows with no state
 * block; a team the district tier reads eliminated carries no hypothetical
 * championship even where it attends (1 to 9 teams per 2026 district), so
 * its ceiling appears when its row lands; and the field proof's own limits
 * are in its header. `scripts/champFieldStagedWalk.test.ts` walks all of it
 * through both entry points.
 */
import { z } from "zod";
import { computeLocksWithQualifiers, cutLinePointsWithQualifiers, type LockResult, type LockTeamInput, type QualifierSets } from "../core/districts/locks.js";
import { maxEventPoints, type DistrictTier } from "../core/districts/pointModel.js";
import { prequalifiedTeams } from "../core/districts/prequalified.js";
import { ALL_CATEGORIES_OPEN, reservedImpactSlots, type DistrictCategoryFinality, type ReservedSlotEvent } from "../core/districts/reservedSlots.js";
import {
  NO_POINTS_PRESENT,
  categoryPointsPresenceByEvent,
  corroboratedCategoryFinality,
  divisionCountOf,
  finalsChampionMaximum,
  type CategoryPointsPresence,
} from "../core/districts/categoryCorroboration.js";
import { dcmpFieldProof, hypotheticalFinalsCeiling, statelessChampionshipRowReadsOpen, unseenChampionshipsHeld, type DcmpFieldProof } from "../core/districts/dcmpFieldProof.js";
import { districtEventStateStarted } from "../core/districts/reservedSlots.js";
import { championshipStemOf, dcmpNeverHappening, perChampionship, reservedChampSlots } from "../core/districts/champReservedSlots.js";
import {
  awardPointsPresentAt,
  awardsPostedRule,
  expectedAwardsListed,
  judgedAwardListed,
  playoffPointsPresentAt,
  qualifyingAwardRecord,
  type AwardsEventKind,
} from "../core/districts/eventAwards.js";
import { dcmpAwardCountCeilings } from "../core/districts/hypotheticalDcmp.js";
import { pooledLockInputs, type PooledTeamEntry } from "../core/districts/pooledLockInputs.js";
import { AWARD_TYPE_WINNER, consumingAwardTypesForTier, eventTierByKey, specialAllocationNote, type AwardTier } from "../core/districts/qualification.js";
import { DistrictArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type DistrictArtifact, type DistrictEventState } from "./pageArtifacts.js";

type DistrictTeam = DistrictArtifact["teams"][number];
type DistrictEventPointsRow = DistrictTeam["eventPoints"][number];
type DistrictRemainingEventRow = DistrictTeam["remainingEvents"][number];

/**
 * Thrown for every input this merge refuses rather than half-applies: an
 * empty rankings payload (which would blank a published district), a
 * duplicated `team_key`, or an event-state observation for an event no team
 * in the artifact carries. Named so a caller can distinguish "TBA sent
 * something I will not act on" from a Zod parse failure.
 */
export class DistrictMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DistrictMergeError";
  }
}

// ---------------------------------------------------------------------------
// The TBA `/district/{key}/rankings` payload, parsed at this module's own
// boundary
// ---------------------------------------------------------------------------

/**
 * One entry of a ranking row's `event_points` array, PROMOTED VERBATIM from
 * `scripts/publishDistricts.ts`'s module-local `EventPointsEntrySchema` —
 * same seven fields, same reasoning, one home now that two producers parse
 * it. `packages/corpus/schema.sql` stores this array verbatim as JSON on
 * purpose (`district_rankings.event_points_raw`) and its doc comment says
 * the season-aware parse belongs to the publish layer; this schema is that
 * parse.
 *
 * `district_cmp` is the ONLY source of an entry's tier. Joining to an
 * event's `event_type` instead is `pointModel.ts`'s documented measurement
 * trap and yields a bogus district-tier maximum of 66.
 */
export const DistrictRankingsEventPointsEntrySchema = z.object({
  event_key: z.string().min(1),
  district_cmp: z.boolean(),
  qual_points: z.number(),
  alliance_points: z.number(),
  elim_points: z.number(),
  award_points: z.number(),
  total: z.number(),
});

/**
 * One `/district/{key}/rankings` element, restricted to what the merge
 * consumes. TBA sends more fields; this schema is non-strict, so they are
 * dropped on parse rather than rejected.
 */
export const DistrictRankingsRowSchema = z.object({
  team_key: z.string().min(1),
  rank: z.number().int().positive(),
  point_total: z.number(),
  rookie_bonus: z.number(),
  adjustments: z.number(),
  event_points: z.array(DistrictRankingsEventPointsEntrySchema),
});

export type DistrictRankingsRow = z.infer<typeof DistrictRankingsRowSchema>;

/**
 * The whole rankings response as an array of rows.
 *
 * TBA's own response is NULLABLE — `/district/{key}/rankings` answers `null`
 * for a district-year it has no rankings for. Deciding that a null or empty
 * body means "nothing to merge, leave the published artifact alone" is the
 * CALLER's job: this schema rejects a null, and `applyDistrictRankings`
 * throws on an empty array, precisely so a caller cannot fall into treating
 * "TBA answered nothing" as "every team has zero points".
 */
export const DistrictRankingsPayloadSchema = z.array(DistrictRankingsRowSchema);

export type DistrictRankingsPayload = z.infer<typeof DistrictRankingsPayloadSchema>;

// ---------------------------------------------------------------------------
// The shared verdict pass
// ---------------------------------------------------------------------------

/**
 * The state block for each event key, read across EVERY `eventPoints` and
 * `remainingEvents` row of every team, any tier, District Championship
 * divisions included (quick task 261009-tx6). A row that CARRIES a state
 * block wins over a row that carries none, the same rule
 * `reservedDistrictSlots` applies, because the artifact's own rows can
 * disagree about whether a block is present and "no state" is the weaker
 * observation of the two. An event whose rows all carry none maps to
 * `undefined`. An event on no row is absent from the map.
 *
 * ONE MAP, TWO READERS: the award gate in `awardQualifiedSets` and the open
 * category walk the ceilings and floors are built from. Both ask "what does
 * this event's own state say", so they read it in one place.
 */
function eventStateByKey(teams: readonly DistrictTeam[]): Map<string, DistrictEventState | undefined> {
  const stateByEvent = new Map<string, DistrictEventState | undefined>();
  for (const team of teams) {
    for (const row of [...team.eventPoints, ...team.remainingEvents]) {
      if (!stateByEvent.has(row.eventKey)) stateByEvent.set(row.eventKey, row.state);
      else if (stateByEvent.get(row.eventKey) === undefined && row.state !== undefined) stateByEvent.set(row.eventKey, row.state);
    }
  }
  return stateByEvent;
}

/**
 * The presence facts of one `teams` array, built once and kept for as long as
 * the array lives. THE TEAM ARRAYS ARE TREATED AS IMMUTABLE: the verdict pass
 * hands the same array to every call and never mutates one, and both merge
 * entry points build a NEW array for every artifact they return. A caller
 * that changed a row in place would read stale facts here, so no caller may.
 */
const presenceByTeams = new WeakMap<readonly DistrictTeam[], Map<string, CategoryPointsPresence>>();

/**
 * THE ONE PLACE THE PUBLISHED VERDICTS READ WHICH CATEGORIES OF AN EVENT ARE
 * FINAL (quick task 261009-tx6). The ceilings, the floors, the pooled pool,
 * the Winner gate of `awardQualifiedSets` and both reservations all ask this
 * function, so none of them can disagree about what is open at an event.
 *
 * IT READS THE ROWS (quick task 261009-vp9, "a category counts as finished
 * only when its points are in"). The event's state comes from the match feed
 * and moves within a minute. The points come from the district rankings, a
 * different feed that can lag. Read from the state alone, a category closed
 * before its points were in, a rival lost a ceiling it could still fill, and
 * the published verdict took a Locked back when the points landed. So the
 * answer is `corroboratedCategoryFinality`
 * (`packages/core/districts/categoryCorroboration.ts`): the state says the
 * stage is over AND the artifact's own rows at the event carry the points
 * that prove it. Playoffs need a row at the winner's value, Alliance
 * selection a row with alliance points above 0, Qualification follows
 * Alliance selection, and Awards are the flag. Only the flag closes the
 * categories below it: Playoffs final does not close Alliance selection. An absent state reports every
 * category open. An event on no row has nothing proven.
 *
 * The rule only ever OPENS a category the state alone would close. On every
 * finished event its answer is the state's own, so no published artifact
 * moves: the publisher comparison over the 109 local district seasons is
 * clean.
 *
 * The presence facts are built once per `teams` array (see
 * `presenceByTeams`).
 *
 * Exported for the test that holds the rule to one place.
 */
export function publishedCategoryFinality(teams: readonly DistrictTeam[], eventKey: string, state: DistrictEventState | undefined, season: number): DistrictCategoryFinality {
  let presence = presenceByTeams.get(teams);
  if (presence === undefined) {
    presence = categoryPointsPresenceByEvent(teams, season);
    presenceByTeams.set(teams, presence);
  }
  return corroboratedCategoryFinality(state, presence.get(eventKey) ?? NO_POINTS_PRESENT);
}

/** The four point categories of an event row, in the order a row carries them. */
const POINT_CATEGORIES = ["qual", "alliance", "elim", "award"] as const;

/** One tier's two sums for one team: what its open categories could still pay, and what they have paid so far. */
interface OpenCategorySums {
  /** The sum of the category ceilings still open at the team's played rows of this tier. */
  ceiling: number;
  /** The points the team's rows already carry in those open categories. */
  earned: number;
}

/**
 * What is still open at the events a team ALREADY HAS A POINTS ROW FOR, per
 * tier (quick task 261009-tx6). For every `eventPoints` row whose event
 * carries a state block, each category `publishedCategoryFinality` reports as
 * not final contributes that category's ceiling at the row's tier
 * (`maxEventPoints`) to `ceiling` and the row's own points in it to `earned`.
 *
 * A ROW WHOSE EVENT CARRIES NO STATE BLOCK CONTRIBUTES TO NEITHER. That is a
 * hindsight row (the offline publisher's first pass, an artifact from before
 * the state blocks existed), and it reads as it always has: its points are
 * in the floor and nothing more is expected of it. EXCEPT, on the two live
 * paths only (`live.statelessChampionshipRowsOpen`, quick task 261010-66y), a
 * dcmp tier row while the championship is still ahead
 * (`statelessChampionshipRowReadsOpen`). That is not hindsight: it is a row
 * the Worker wrote before it had anywhere to put the state, on the tick a
 * championship's first rows arrive. It is walked with every category open:
 * the tier's four ceilings join the ceiling and the row's four values leave
 * the floor, which is exactly what the team carried a tick earlier as its
 * hypothetical championship.
 *
 * A ceiling is counted once per event, however many rows a team carries for
 * it. TBA sends one row per event, so a second row is a malformed input, and
 * one event can pay each category once.
 *
 * THE FINALS OF A CHAMPIONSHIP PLAYED IN DIVISIONS (quick task 261010-66y).
 * TBA writes a finals row only for a team it pays there, so before the finals
 * are played no row names them, and this pass used to give no team a finals
 * ceiling. When the finals rows posted, the finals teams' ceilings rose.
 * Walked with every attending team registered first: 2 published locks taken
 * back at 2026 TX when the finals' state was written, and 7 to 15 teams per
 * district whose `maxRemainingChamp` rose from 45 to 90 there. So:
 *
 *   - A LIVE DIVISION ROW is a dcmp tier row whose key is not its own
 *     championship stem and whose event carries a state block, or carries
 *     none while the exception above applies.
 *   - EVERY TEAM WITH A LIVE DIVISION ROW CARRIES THE FINALS PLAYOFFS MAXIMUM,
 *     finals row or no finals row, while the finals' Playoffs are not final
 *     (an absent finals state reads every category open). The maximum is
 *     `finalsChampionMaximum` for the number of division keys the rows hold
 *     once the field is proven, and the whole dcmp Playoffs ceiling while it
 *     is not, since the number of divisions is then not known. The Playoffs
 *     points of the team's own finals row, if it has one, leave the floor.
 *   - THE FINALS' AWARDS ADD NO CEILING FOR ANYONE. A points paying award at a
 *     finals event is a consuming award (Impact, Engineering Inspiration,
 *     Rookie All Star), which takes a Championship slot whatever its
 *     winner's points, and the champ reservation already holds a place for
 *     each. The joint worst case proof on the Champ Locks tab rests on the
 *     same fact, and `scripts/champFieldStagedWalk.test.ts` holds it over
 *     every local season. The award points of a finals row leave the floor
 *     while the finals' Awards are not final.
 *   - A ROW AT A FINALS KEY OF A TEAM WITH NO LIVE DIVISION ROW THERE adds no
 *     ceiling at all: such a team played in no division and cannot be on a
 *     division winning alliance. Its points in the categories not final
 *     leave the floor.
 *   - The team's finals row is read once, by the rule above, and not walked
 *     a second time as an ordinary row.
 *
 * A finals key is a dcmp key equal to its stem with at least one division
 * key beside it. In the offline publisher's first pass no row carries a
 * state and the exception does not apply, so no division row is live and
 * nothing moves there. The Champ Locks tab reads the finals' Awards this way
 * from the same quick task's last step on.
 */
function openAtPlayedRows(
  team: DistrictTeam,
  teams: readonly DistrictTeam[],
  season: number,
  stateByEvent: ReadonlyMap<string, DistrictEventState | undefined>,
  live: LiveChampionshipReading = NOT_LIVE
): Record<DistrictTier, OpenCategorySums> {
  const sums: Record<DistrictTier, OpenCategorySums> = { district: { ceiling: 0, earned: 0 }, dcmp: { ceiling: 0, earned: 0 } };
  const statelessOpen = (tier: DistrictTier): boolean => live.statelessChampionshipRowsOpen && statelessChampionshipRowReadsOpen(tier, live.championshipStillAhead);

  // THE FINALS, read once per championship stem of this team's live division rows.
  const dcmpKeys = dcmpKeysOf(teams);
  const dcmpMaxima = maxEventPoints(season, "dcmp");
  const liveDivisionStems = new Set<string>();
  for (const row of team.eventPoints) {
    if (row.tier !== "dcmp") continue;
    const stem = championshipStemOf(row.eventKey);
    if (stem === row.eventKey) continue;
    if (stateByEvent.get(row.eventKey) !== undefined || statelessOpen(row.tier)) liveDivisionStems.add(stem);
  }
  for (const stem of liveDivisionStems) {
    const finalsState = stateByEvent.get(stem);
    const finalsFinal = finalsState === undefined ? ALL_CATEGORIES_OPEN : publishedCategoryFinality(teams, stem, finalsState, season);
    const finalsRow = team.eventPoints.find((row) => row.eventKey === stem);
    if (!finalsFinal.elim) sums.dcmp.ceiling += live.fieldProven ? finalsChampionMaximum(season, divisionCountOf(stem, dcmpKeys)) : dcmpMaxima.elim;
    if (finalsRow !== undefined) {
      for (const category of POINT_CATEGORIES) if (!finalsFinal[category]) sums.dcmp.earned += finalsRow[category];
    }
  }

  const counted = new Set<string>();
  for (const row of team.eventPoints) {
    // The finals row of a team with a live division row at that stem was read above.
    if (row.tier === "dcmp" && liveDivisionStems.has(row.eventKey)) continue;
    const state = stateByEvent.get(row.eventKey);
    if (state === undefined && !statelessOpen(row.tier)) continue;
    const final = state === undefined ? ALL_CATEGORIES_OPEN : publishedCategoryFinality(teams, row.eventKey, state, season);
    const maxima = maxEventPoints(season, row.tier);
    const firstRow = !counted.has(row.eventKey);
    counted.add(row.eventKey);
    // A row at a finals key of a team with no live division row there: no ceiling at all.
    const finalsOnlyRow = row.tier === "dcmp" && championshipStemOf(row.eventKey) === row.eventKey && divisionCountOf(row.eventKey, dcmpKeys) >= 1;
    for (const category of POINT_CATEGORIES) {
      if (final[category]) continue;
      if (firstRow && !finalsOnlyRow) sums[row.tier].ceiling += maxima[category];
      sums[row.tier].earned += row[category];
    }
  }
  return sums;
}

/**
 * How the open category walk reads a championship on the live paths (quick
 * task 261010-66y). `NOT_LIVE` is every reading before that task, and what
 * `dcmpStillAhead` and `unexplainedDistrictCeilings` hand in.
 */
interface LiveChampionshipReading {
  /** The option only the two merge entry points pass: a stateless dcmp tier row may read open. */
  readonly statelessChampionshipRowsOpen: boolean;
  /** The pass's own still ahead answer, computed before the walk. */
  readonly championshipStillAhead: boolean;
  /** The field proof's `proven`: picks the finals Playoffs maximum a division team carries. */
  readonly fieldProven: boolean;
}

const NOT_LIVE: LiveChampionshipReading = { statelessChampionshipRowsOpen: false, championshipStillAhead: false, fieldProven: true };

/** Every dcmp tier event key on any row of a `teams` array, built once per array like `presenceByTeams`. */
const dcmpKeysByTeams = new WeakMap<readonly DistrictTeam[], string[]>();

function dcmpKeysOf(teams: readonly DistrictTeam[]): string[] {
  let keys = dcmpKeysByTeams.get(teams);
  if (keys === undefined) {
    const found = new Set<string>();
    for (const team of teams) for (const row of [...team.eventPoints, ...team.remainingEvents]) if (row.tier === "dcmp") found.add(row.eventKey);
    keys = [...found].sort();
    dcmpKeysByTeams.set(teams, keys);
  }
  return keys;
}

/**
 * THE FIELD PROOF AS THE PUBLISHED PASS READS IT (quick task 261010-66y): the
 * one core rule (`dcmpFieldProof`), with the started keys from the event
 * level state map (`districtEventStateStarted`, the same reading the tabs
 * take) and the awards final keys from `publishedCategoryFinality`. A key
 * whose rows carry no state has not started and reads no award final.
 */
function publishedFieldProof(
  teams: readonly DistrictTeam[],
  season: number,
  nowYear: number,
  dcmpSlots: number | null,
  stateByEvent: ReadonlyMap<string, DistrictEventState | undefined>
): DcmpFieldProof {
  const startedKeys = new Set<string>();
  const awardsFinalKeys = new Set<string>();
  for (const [eventKey, state] of stateByEvent) {
    if (state === undefined) continue;
    if (districtEventStateStarted(state)) startedKeys.add(eventKey);
    if (publishedCategoryFinality(teams, eventKey, state, season).award) awardsFinalKeys.add(eventKey);
  }
  return dcmpFieldProof({ teams, dcmpSlots, season, nowYear, startedKeys, awardsFinalKeys });
}

/** The sum of a team's district tier `remainingEvents` ceilings: the part of `maxRemainingDistrict` its calendar explains. */
function districtRemainingEventsSum(team: DistrictTeam): number {
  let sum = 0;
  for (const event of team.remainingEvents) if (event.tier === "district") sum += event.maxPoints;
  return sum;
}

/**
 * Whether the district's DCMP could still yield points to anyone, derived
 * WITHOUT a corpus or a calendar, as a function of ONE self consistent
 * artifact.
 *
 * `buildDistrictArtifact` answers this from the event list's own start dates.
 * The Worker has neither, so the answer is read back off the artifact the
 * publisher (which did have the calendar) produced: a team still carrying a
 * dcmp-tier remaining event, or any team whose published champ ceiling
 * exceeds its district ceiling, less what is open at its own championship
 * row, by at least one whole dcmp event, means the hypothetical DCMP was
 * still ahead when that artifact was written.
 *
 * WHY THE OPEN CHAMPIONSHIP CEILING IS SUBTRACTED (quick task 261009-tx6).
 * The verdict pass now puts the open categories of a team's own championship
 * row on its champ ceiling. A row that is wholly open is worth one whole dcmp
 * event, the same size as the hypothetical one, so without the subtraction a
 * team PLAYING its championship would read as a team GRANTED a hypothetical
 * one, and the next call would hand a hypothetical championship to every
 * other team. A team holds a hypothetical championship or a championship
 * row, never both (`hasPlayedDcmp` in pass 2), so the subtraction can never
 * hide a granted one.
 *
 * WHY IT IS READ OFF THE INCOMING ARTIFACT. The stored ceilings, the rows and
 * the states of one artifact were written together by one verdict pass, so
 * the difference means what it meant when it was written. Both merge entry
 * points therefore evaluate this BEFORE they merge a row or a state and hand
 * the answer to the pass, which gives the same answer on a rankings 200 tick
 * and a 304 tick. Mixing stored ceilings with freshly merged rows is how the
 * two paths could disagree.
 *
 * WHY NOT FROM THE ROWS ALONE. A district that lists no dcmp event on any row
 * says nothing about its championship in its rows. The offline publisher's
 * calendar answer reaches the Worker ONLY as that stored difference
 * (`scripts/publishDistricts.ts` seeds `maxRemainingChamp` with one
 * championship when its calendar says one is still ahead).
 *
 * The `>=` comparison rather than `===` is deliberate: a carried-forward
 * champ ceiling can sit MORE than one dcmp event above a district ceiling
 * that has since shrunk, and an equality test would read that as "no DCMP
 * granted".
 *
 * This errs toward "still ahead", which OVERSTATES ceilings. That is the only
 * safe direction: an overstated rival ceiling delays a `"locked"` verdict,
 * while an understated one would publish a guarantee that is not true.
 *
 * IT CALLS THE OPEN CATEGORY WALK WITHOUT THE LIVE READING, ON PURPOSE (quick
 * task 261010-66y). The verdict pass may have read a stateless championship
 * row open, and a division team's finals at the whole Playoffs ceiling; this
 * subtracts the smaller plain reading, so what is left of the stored ceiling
 * is larger and the answer errs toward "still ahead".
 */
function dcmpStillAhead(artifact: DistrictArtifact): boolean {
  const dcmpBase = maxEventPoints(artifact.year, "dcmp");
  const dcmpEventMaxTotal = dcmpBase.qual + dcmpBase.alliance + dcmpBase.elim + dcmpBase.award;
  const stateByEvent = eventStateByKey(artifact.teams);
  return artifact.teams.some(
    (team) =>
      team.remainingEvents.some((event) => event.tier === "dcmp") ||
      team.maxRemainingChamp - team.maxRemainingDistrict - openAtPlayedRows(team, artifact.teams, artifact.year, stateByEvent).dcmp.ceiling >= dcmpEventMaxTotal
  );
}

/**
 * The part of each team's STORED `maxRemainingDistrict` that its own rows do
 * not explain (quick task 261009-tx6): the larger of zero and the stored
 * value minus its district tier remaining events minus what is open at its
 * district tier played rows, all three read off the ONE artifact handed in.
 *
 * The one thing it carries today is A NEWCOMER'S SEED: a team that arrived in
 * a rankings payload with no calendar was given one district event's maximum
 * (`applyDistrictRankings`), and no row of the artifact says so. The verdict
 * pass rebuilds `maxRemainingDistrict` from the rows on every call, so
 * without this map the seed would vanish on the very next tick.
 *
 * FLOORED AT ZERO, so a value stored before the pass counted open categories
 * (smaller than its rows now explain) carries nothing and can never LOWER a
 * ceiling.
 */
function unexplainedDistrictCeilings(artifact: DistrictArtifact): Map<string, number> {
  const stateByEvent = eventStateByKey(artifact.teams);
  const unexplained = new Map<string, number>();
  for (const team of artifact.teams) {
    const explained = districtRemainingEventsSum(team) + openAtPlayedRows(team, artifact.teams, artifact.year, stateByEvent).district.ceiling;
    unexplained.set(team.teamKey, Math.max(0, team.maxRemainingDistrict - explained));
  }
  return unexplained;
}

/**
 * The two award-qualified (CONSUMING) team-key sets `computeLocksWithQualifiers`
 * needs, derived from the artifact's own `qualifyingAwards` lists.
 *
 * An award's tier is resolved from the `eventPoints`/`remainingEvents` row
 * carrying that event key, and `consumingAwardTypesForTier` decides whether
 * it consumes a slot. An award whose event key appears on NO row is left out
 * of both sets rather than assigned a guessed tier: the effect is that the
 * team reports `"contending"` instead of `"lockedAward"`, which understates
 * a qualification but never publishes a guarantee that is not true.
 *
 * AN AWARD COUNTS ONLY ONCE ITS OWN EVENT SAYS IT IS GIVEN (quick task
 * 261009-tx6). The live Worker records a winner the moment TBA lists it,
 * which can be many ticks before the event's flag turns true. Each
 * reservation (`reservedDistrictSlots`, `reservedChampSlotsAtNow`) holds a
 * slot back for an event until that event's state says the award is given,
 * so a record counted earlier held the slot twice, and the published verdict
 * took back a Locked it had given on points one tick before. So the record is
 * read off the state block of its own event (`eventStateByKey`, any tier, a
 * District Championship award at the finals key):
 *
 *   - a Winner (type 1) counts once the event's PLAYOFFS ARE FINAL as
 *     `publishedCategoryFinality` reads them (quick task 261009-vp9): the
 *     state says the playoffs are done AND a row at the event carries the
 *     winner's playoff value, or the awards are posted, the later fact that
 *     closes them. A Winner listed while the playoff points are still to
 *     land is recorded and not yet counted, exactly as the reservation still
 *     holds the winning alliance's places;
 *   - every other consuming award counts once the event's Awards are final,
 *     which is `awardsPosted`.
 *
 * Those are the two readings the reservations take, through the same
 * function, so an award is either reserved for or counted and never both. It
 * is also the rule the Locks tabs apply (`districtLedgerStatus.ts`,
 * `champLedgerStatus.ts`), which gate each award on its own event's stage.
 * The Winner's second clause matters for one shape only: awards posted with
 * the playoffs flag never turned true (a curtailed bracket).
 * `reservedChampSlots` releases the winning alliance's slots there, so a
 * winner left uncounted would be neither reserved for nor counted, which is
 * the one side that can publish a Locked that is not true.
 *
 * AN EVENT WHOSE ROWS CARRY NO STATE BLOCK COUNTS ITS AWARDS AS BEFORE. The
 * offline publisher runs this pass on state free rows first, and a tier
 * supplied from the corpus can name an event no row carries. Both are
 * hindsight: the award was read from a finished event.
 */
function awardQualifiedSets(
  teams: readonly DistrictTeam[],
  suppliedTiers: ReadonlyMap<string, DistrictTier> | undefined,
  stateByEvent: ReadonlyMap<string, DistrictEventState | undefined>,
  season: number
): { district: Set<string>; dcmp: Set<string> } {
  // The artifact derived map is shared with the District Locks tab
  // (`eventTierByKey`, quick task 261007-jvz), so the two resolve an award's
  // tier the same way wherever no corpus tier is supplied.
  const tiers = eventTierByKey(teams);
  const district = new Set<string>();
  const dcmp = new Set<string>();
  for (const team of teams) {
    for (const award of team.qualifyingAwards) {
      // A CALLER-SUPPLIED tier wins. `scripts/publishDistricts.ts` holds the
      // corpus's own `events.event_type` and can therefore resolve the tier of
      // an award at an event NO team carries a row for — an Impact award at an
      // event every team either skipped or has not played yet. The
      // artifact-derived map below is the only source a corpus-free caller
      // (the Worker) has, and it stays the fallback.
      const tier = suppliedTiers?.get(award.eventKey) ?? tiers.get(award.eventKey);
      if (tier === undefined) continue;
      const awardTier: AwardTier = tier === "dcmp" ? "dcmp" : "district";
      if (!consumingAwardTypesForTier(awardTier).has(award.awardType)) continue;
      // The gate: read off the award's OWN event. No state block on any row
      // for it means a hindsight row, which counts as it always has.
      const state = stateByEvent.get(award.eventKey);
      if (state !== undefined) {
        const final = publishedCategoryFinality(teams, award.eventKey, state, season);
        const given = award.awardType === AWARD_TYPE_WINNER ? final.elim : final.award;
        if (!given) continue;
      }
      (awardTier === "dcmp" ? dcmp : district).add(team.teamKey);
    }
  }
  return { district, dcmp };
}

/**
 * How many DCMP points slots are held back for Impact awards still to come —
 * one per district-tier event whose `state.awardsPosted` is not `true`, minus
 * the events the cancelled carve out excludes.
 * `packages/core/districts/reservedSlots.ts` owns the rule; this function owns
 * only the walk over the artifact's own rows.
 *
 * DISTRICT-TIER ROWS ONLY. The DCMP's own consuming awards belong to the champ
 * pass, against a different slot pool, and are deliberately not reserved for
 * here.
 *
 * There is no rewind offline, so an event's award is final at the position
 * exactly when its published state says the awards are posted. FIRST STATE
 * SEEN WINS per event, matching every other per-event derivation in this file.
 *
 * The Awards finality is read through `publishedCategoryFinality` (quick task
 * 261009-vp9), the one reader. For Awards that is the flag itself, so the
 * count is what it was.
 */
function reservedDistrictSlots(teams: readonly DistrictTeam[], season: number): number {
  const events: ReservedSlotEvent[] = [];
  const seen = new Set<string>();
  for (const team of teams) {
    for (const row of [...team.eventPoints, ...team.remainingEvents]) {
      if (row.tier !== "district") continue;
      const existing = seen.has(row.eventKey);
      if (existing) {
        // A row carrying state wins over an earlier row that carried none:
        // the artifact's own rows can disagree about whether a state block is
        // present, and "no state" is the weaker observation of the two.
        const known = events.find((event) => event.eventKey === row.eventKey);
        if (known === undefined || known.stateAtNow !== undefined || row.state === undefined) continue;
        events[events.indexOf(known)] = { eventKey: row.eventKey, stateAtNow: row.state, awardFinalAtPosition: publishedCategoryFinality(teams, row.eventKey, row.state, season).award };
        continue;
      }
      seen.add(row.eventKey);
      events.push({ eventKey: row.eventKey, stateAtNow: row.state, awardFinalAtPosition: publishedCategoryFinality(teams, row.eventKey, row.state, season).award });
    }
  }
  return reservedImpactSlots(events);
}

/**
 * The pooled remaining-points facts at "now": how many district points the
 * district still has to hand out, and which teams can still collect any of them
 * (quick task 260925-pl6). `packages/core/districts/pooledLockInputs.ts` owns
 * the rule; this function owns only the walk over the artifact's own rows.
 *
 * DISTRICT-TIER ROWS ONLY, matching the `maxRemainingDistrict` the ceiling test
 * is asked against. There is no rewind offline, so an event's categories are
 * final exactly when its published state says so, and an event with no state
 * block at all reports every category OPEN — the honest unknown, and the side
 * that makes the pool bigger and the pooled lock fire less.
 *
 * A TEAM WITH NO `awardProfile` IS PASSED AS A ROOKIE. A rookie widens the
 * award pool, so the unknown answer sits on the conservative side of a
 * guarantee.
 *
 * FOR A FINISHED SEASON THIS RETURNS ZERO AND AN EMPTY SET, and the pooled test
 * then locks exactly the teams the ceiling test already locked — which is why
 * adding it moved no published number for any of the 109 published artifacts.
 *
 * FINALITY COMES FROM `publishedCategoryFinality` (quick task 261009-tx6),
 * the same function and the same event level state map the ceilings and the
 * floors read, so the pool and the floors describe one position. For a
 * district tier event the map holds exactly the block the district tier only
 * walk used to find, so no pool moved.
 */
function pooledDistrictPoints(teams: readonly DistrictTeam[], stateByEvent: ReadonlyMap<string, DistrictEventState | undefined>, season: number): ReturnType<typeof pooledLockInputs> {
  const entries: PooledTeamEntry[] = teams.map((team) => {
    const eventKeys = new Set<string>();
    for (const row of [...team.eventPoints, ...team.remainingEvents]) {
      if (row.tier === "district") eventKeys.add(row.eventKey);
    }
    return {
      teamKey: team.teamKey,
      rookie: team.awardProfile?.rookie ?? true,
      events: [...eventKeys].map((eventKey) => ({ eventKey, final: publishedCategoryFinality(teams, eventKey, stateByEvent.get(eventKey), season) })),
    };
  });
  return pooledLockInputs(entries);
}

function lockVerdict(result: LockResult, cutLinePoints: number | null, allocationNote: string | null): DistrictTeam["districtLock"] {
  return {
    status: result.status,
    pointsToLock: result.pointsToLock,
    threatCount: result.threatCount,
    cutLinePoints,
    allocationNote,
  };
}

/**
 * How many FIRST Championship slots are held back at "now" for the District
 * Championship's own consuming qualifications still to come (quick task
 * 261006-3gg): the winning alliance while a DCMP's playoffs are open, and
 * every judged consuming award at its historical ceiling while its awards are
 * open. `packages/core/districts/champReservedSlots.ts` owns the rule; this
 * function owns only the walk over the artifact's dcmp-tier rows.
 *
 * ONE RESERVATION PER CHAMPIONSHIP, summed: a district with two championships
 * (2026ca) holds slots back for each one still open, and a district whose
 * championship is published as divisions plus a finals event (FIM, TX, NE,
 * ONT) holds back ONE, at the finals event's state (`perChampionship`). A
 * district with no dcmp row at all holds back one whole open championship,
 * unless the rule's past-season clause says it is never happening. A row
 * carrying state wins over one that carries none, matching
 * `reservedDistrictSlots` above.
 *
 * EACH CHAMPIONSHIP'S PLAYOFFS AND AWARDS ARE READ THROUGH
 * `publishedCategoryFinality` (quick task 261009-vp9), one finality per dcmp
 * key, folded per championship with every category open as the fallback. So
 * the winning alliance's four places stay held until the playoff points are
 * in the rows, not merely until the match feed says the final was played.
 *
 * THE WINNER HOLD (quick task 261009-vp9). The four places are released only
 * once the championship's Playoffs are final AND a Winner is recorded there:
 * some team's `qualifyingAwards` holds a Winner whose event key has the
 * championship's stem. Playoffs final alone is not enough. TBA can post the
 * playoff points before it lists the Winner, and for those ticks the four
 * places would be neither reserved for (the playoffs read final) nor counted
 * (no winner is recorded), so the points race would be handed four slots the
 * winners then take. On a synthetic championship whose winners sit far down
 * the standings that order lost 13 held places in the published verdict.
 * With the hold a winner's place is reserved for or counted, never both and
 * never neither. A Winner recorded at ANOTHER championship of the same
 * district releases nothing here. Once the awards are posted
 * `reservedChampSlots` reserves nothing whatever this says.
 *
 * WHILE THE FIELD IS NOT PROVEN AFTER A START (quick task 261010-66y) the
 * championships the rows may not have shown yet are held back whole, beside
 * the known ones, exactly as the Champ Locks tab holds them
 * (`unseenChampionshipsHeld` in `packages/core/districts/dcmpFieldProof.ts`,
 * the one rule both read). The rows learn a championship key only when TBA
 * posts it, so a second championship, or the divisions of one, can be
 * invisible while the first has started, and each still hands out its own
 * winning alliance and judged awards. The proof is built from the same dcmp
 * state map this function already reads. It bit nowhere in the measured
 * walks, and it is here so the published reservation and the tab's cannot
 * disagree.
 *
 * Exported for the test that pins the count.
 */
export function reservedChampSlotsAtNow(teams: readonly DistrictTeam[], season: number, districtKey: string, cmpSlots: number, nowYear: number, dcmpSlots: number | null): number {
  type RowState = DistrictTeam["eventPoints"][number]["state"];
  const stateByEvent = new Map<string, RowState>();
  const dcmpStates: RowState[] = [];
  for (const team of teams) {
    for (const row of [...team.eventPoints, ...team.remainingEvents]) {
      if (row.tier !== "dcmp") continue;
      dcmpStates.push(row.state);
      if (!stateByEvent.has(row.eventKey) || (stateByEvent.get(row.eventKey) === undefined && row.state !== undefined)) stateByEvent.set(row.eventKey, row.state);
    }
  }
  const neverHappening = dcmpNeverHappening({ dcmpStates, artifactYear: season, nowYear });
  const awardCeilings = dcmpAwardCountCeilings(season, districtKey, cmpSlots).counts;
  // The championships a Winner is recorded at, by stem: the winner hold.
  const winnerRecordedAt = new Set<string>();
  for (const team of teams) {
    for (const award of team.qualifyingAwards) if (award.awardType === AWARD_TYPE_WINNER) winnerRecordedAt.add(championshipStemOf(award.eventKey));
  }
  const finalByEvent = new Map<string, DistrictCategoryFinality>();
  for (const [eventKey, state] of stateByEvent) {
    const final = publishedCategoryFinality(teams, eventKey, state, season);
    // What is handed on as "Playoffs final" for the RESERVATION: the
    // Playoffs are final AND a Winner is recorded at this championship.
    finalByEvent.set(eventKey, { ...final, elim: final.elim && winnerRecordedAt.has(championshipStemOf(eventKey)) });
  }
  const finalByChampionship = perChampionship<DistrictCategoryFinality>(finalByEvent, ALL_CATEGORIES_OPEN);
  const stages: DistrictCategoryFinality[] = finalByChampionship.size === 0 ? [ALL_CATEGORIES_OPEN] : [...finalByChampionship.values()];
  let reserved = 0;
  for (const final of stages) {
    reserved += reservedChampSlots({ elimFinal: final.elim, awardFinal: final.award, awardCeilings, neverHappening });
  }
  // The championships that may be unseen, while the field is not proven after a start.
  if (publishedFieldProof(teams, season, nowYear, dcmpSlots, stateByEvent).unprovenAfterStart) {
    reserved += unseenChampionshipsHeld(teams, dcmpSlots) * reservedChampSlots({ elimFinal: false, awardFinal: false, awardCeilings, neverHappening });
  }
  return reserved;
}

/**
 * A team's season total counting district tier events only: `pointTotal`
 * minus the `total` of every `eventPoints` entry whose tier is not
 * `"district"`. The publisher twin of the first loop of `districtLockBounds`
 * (apps/web/src/components/districts/districtLedgerStatus.ts), derived by
 * subtraction and never by re-summing, because `pointTotal` carries the rookie
 * bonus, the adjustments and TBA's own arithmetic (quick task 261007-il9).
 */
function districtTierPointTotal(team: DistrictTeam): number {
  let total = team.pointTotal;
  for (const row of team.eventPoints) if (row.tier !== "district") total -= row.total;
  return total;
}

/**
 * The shared verdict pass: both lock verdicts, both cut lines,
 * `maxRemainingChamp`, the `2025fsc` champ override and `insights`' four
 * counts, all recomputed from the artifact's own merged totals.
 *
 * Exported so `scripts/publishDistricts.ts` (10-06) calls the SAME function
 * `applyDistrictRankings` calls rather than keeping a second verdict pass
 * that can drift from it. It reproduces `buildDistrictArtifact`'s pipeline
 * exactly: derive both award-qualified sets, take `prequalifiedTeams(season)`
 * for the champ tier only, run `computeLocksWithQualifiers` against
 * `dcmpSlots` and then `cmpSlots`, compute both cut lines through
 * `cutLinePointsWithQualifiers` against the SAME hoisted inputs objects so the
 * verdicts and the published cut line can never disagree, and apply
 * `specialAllocationNote` over every `champLock`.
 *
 * A SECOND ADDITION, quick task 260925-pl6: the district pass also hands
 * `computeLocksWithQualifiers` the POOLED remaining-points facts
 * (`pooledDistrictPoints` above), so a team locks when EITHER no single rival
 * can reach it or no achievable distribution of the district's remaining points
 * can lift enough rivals past it. The champ pass passes none, because a DCMP's
 * own pool is a different tier against a different slot pool. For a finished
 * season the pool is zero and the pooled test locks exactly the teams the
 * ceiling test already locked, so no published number moves there either —
 * measured across all 109 published artifacts, zero verdicts and zero cut lines
 * differ.
 *
 * ONE ADDITION TO THAT PIPELINE, quick task 260925-ms7: the district pass
 * holds back one points slot for every district-tier event whose Impact award
 * is still to come (`reservedDistrictSlots` above), which tightens the
 * `"locked"` test alone — `locks.ts` leaves `"eliminated"` and the published
 * `dcmpCutLinePoints` on the unreserved count, so neither moves. The champ
 * pass holds back its own slots the same way (quick task 261006-3gg,
 * `reservedChampSlotsAtNow` above): the DCMP's winning alliance and judged
 * consuming awards take Championship slots whatever the winners' points, so
 * until they are posted the champ `"locked"` test runs against a pool with
 * those slots removed. For a finished season every DCMP has posted its awards
 * and both reservations are zero, so no published number moves there either.
 *
 * THE WINNING ALLIANCE'S PLACES ARE RESERVED FOR OR COUNTED, NEVER BOTH AND
 * NEVER NEITHER (quick task 261009-vp9). A recorded Winner is counted once
 * its championship's Playoffs are final (`awardQualifiedSets`), and the four
 * places held for the winning alliance are released only once the Playoffs
 * are final AND a Winner is recorded there (`reservedChampSlotsAtNow`). So
 * playoff points that land before the Winner is listed release nothing: on a
 * synthetic championship whose winners sit far down the standings, that
 * order used to lose 13 held places in the published verdict.
 *
 * THE DISTRICT PASS RANKS THE DISTRICT TIER TOTAL (quick task 261007-il9).
 * Before this, the pass answered "who earned a place at the District
 * Championship" with points earned at it: `districtLock`,
 * `dcmpCutLinePoints`, `districtLockedCount` and `districtEliminatedCount`
 * ranked the all tier `pointTotal`. They now rank `districtTierPointTotal`,
 * the total the District Locks tab's own floor counts. The champ pass keeps
 * the all tier total, the race the Championship slots are decided on. The
 * pass 2 gate still reads pass one's status, but no team can have a DCMP row
 * while a DCMP is still ahead, except in a multi championship district.
 * `pointTotal` is unchanged on the wire. Measured 2026-10-07 by rebuilding
 * the 109 local district seasons offline (`publishDistricts.ts --dry-run
 * --no-bake --local-out`): the tenet sweep against the publisher's verdicts
 * fell from 562 tenet A and 454 tenet B rows to 4 and 0, with zero champ side
 * and zero `pointTotal` movement. The four residual rows were 2019fma's award
 * at an uncounted event; quick task 261007-jvz moved the tab onto this pass's
 * district wide award rule (`eventTierByKey`), and the sweep reads 0 and 0.
 *
 * THE CEILINGS COUNT WHAT IS STILL OPEN AT A PLAYED EVENT (quick task
 * 261009-tx6). Before this, `maxRemainingDistrict` was the sum of a team's
 * `remainingEvents` and nothing else, so the moment a team had a points row
 * at an event that event was worth nothing more to it, while its award
 * points, and during the event its playoff and selection points, were still
 * to come. A rival's award points then landed on a ceiling that said they
 * could not, and the published verdict took a Locked back: replayed over the
 * eight 2026 PNW district events, six times (`frc9430`, `frc5920`).
 *
 * The rule is the District Locks tab's own (`districtLockBounds` in
 * apps/web/src/components/districts/districtLedgerStatus.ts), applied to
 * every `eventPoints` row whose event carries a state block. For each
 * category `publishedCategoryFinality` reports as not final:
 *
 *   - the category's ceiling at the row's tier joins the team's ceiling
 *     (district tier rows into `maxRemainingDistrict`, and both tiers into
 *     `maxRemainingChamp`), and
 *   - the points the row already carries in that category LEAVE the floor
 *     the lock test and the cut line read.
 *
 * Both halves are needed. Adding the ceiling alone is worse than adding
 * nothing: the points that land while the category still reads open would
 * then sit in the floor and in the ceiling at once, and the same replay
 * shows eight take backs. With both halves a point landing in an open
 * category moves no input at all, and the replay shows none.
 *
 * A ROW WHOSE EVENT CARRIES NO STATE BLOCK ADDS NOTHING AND REMOVES NOTHING,
 * so a hindsight artifact (every category of every row final, or no state
 * at all) recomputes to exactly what it did. Measured over the 109 local
 * district seasons: zero artifacts differ.
 *
 * BOTH CEILINGS ARE BUILT FROM THE ROWS on every call, never added to a
 * stored value, so the pass applied to its own output changes nothing.
 * `maxRemainingDistrict` is rewritten on the returned teams as
 * `maxRemainingChamp` always was. `pointTotal`, `rank` and every row are
 * untouched on the wire.
 *
 * TWO LIMITS, STATED PLAINLY.
 *   1. This is the tab's rule WITHOUT its settled playoffs refinement. The
 *      pass has no bracket facts, so an alliance already knocked out keeps
 *      the whole playoff ceiling until the category is final. A published
 *      status in the middle of the playoffs can therefore be WEAKER than the
 *      tab's (a Locked shown later), never stronger.
 *   2. CLOSED by quick task 261009-vp9. The rule is only as good as the
 *      finality it is handed, and finality used to be read from the event's
 *      state alone, so for the time between a category finishing on the
 *      field and its points reaching the district rankings a ceiling could
 *      close before the points were in. `publishedCategoryFinality` now
 *      reads the rows as well: a category is final only once the points that
 *      prove it are in. What that leaves: an event whose winning alliance
 *      carries no row at the winner's value (a team's third district event
 *      earns no row; three of 418 district events since 2023) keeps its
 *      Playoffs open from the playoff points landing until its awards flag
 *      turns true. That is the open side: a Locked shown later, never one
 *      taken back.
 *
 * The season is the artifact's own `year` — `maxEventPoints` throws
 * `UnknownDistrictSeasonError` for a season with no declared ceiling rather
 * than guessing one.
 *
 * `insights.eventCount` rides forward untouched: a district's event count has
 * no corpus-free source, and inventing one from the rows present would shrink
 * every time a team's registration list did.
 */
export interface RecomputeDistrictVerdictsOptions {
  /**
   * `eventKey -> tier` from a source the ARTIFACT does not carry. Optional, and
   * absent for every corpus-free caller: `applyDistrictRankings` passes none,
   * so the Worker's behaviour is bit-for-bit what it was.
   *
   * `scripts/publishDistricts.ts` passes one, because it reads
   * `events.event_type` from the corpus and can therefore resolve an award's
   * tier at an event no team in the artifact carries a row for. Without it that
   * award is left out of both qualified sets, which understates a
   * qualification — safe, but wrong where the fact is actually available.
   */
  readonly tierByEvent?: ReadonlyMap<string, DistrictTier>;
  /** The calendar year at the time of the call, for the champ reservation's past-season clause. Defaults to the clock; tests pass it. */
  readonly nowYear?: number;
  /**
   * Whether the district's championship is still ahead, when the caller has
   * already read it (quick task 261009-tx6). The two merge entry points read
   * it off the artifact they were handed, BEFORE merging a row or a state,
   * and pass it here. Absent, the pass reads it off its own input through the
   * same function, which is what a direct caller (the offline publisher,
   * whose input is one self consistent artifact) wants.
   */
  readonly dcmpStillAhead?: boolean;
  /**
   * `teamKey -> the part of a stored `maxRemainingDistrict` no row explains`
   * (quick task 261009-tx6), added to the ceiling the pass rebuilds from the
   * rows. Only the two merge entry points pass one: they compute it for every
   * team of the artifact they were handed, and seed a team new in a rankings
   * payload with one district event's maximum. Absent, nothing is added.
   */
  readonly unexplainedDistrictCeiling?: ReadonlyMap<string, number>;
  /**
   * Whether a dcmp tier row whose event carries no state block may read
   * wholly open while the championship is still ahead (quick task
   * 261010-66y). ONLY THE TWO MERGE ENTRY POINTS PASS IT, as true, on the
   * `unexplainedDistrictCeiling` precedent: there a stateless championship
   * row is the row the live Worker wrote on the tick a championship's first
   * rows arrived, before it had a state to write. Absent reads false, so a
   * direct caller (the offline publisher's first pass over state free rows)
   * reads a stateless row as it always has: a hindsight row.
   */
  readonly statelessChampionshipRowsOpen?: boolean;
}

export function recomputeDistrictVerdicts(artifact: DistrictArtifact, options: RecomputeDistrictVerdictsOptions = {}): DistrictArtifact {
  const season = artifact.year;
  const dcmpBase = maxEventPoints(season, "dcmp");
  const dcmpEventMaxTotal = dcmpBase.qual + dcmpBase.alliance + dcmpBase.elim + dcmpBase.award;

  const teams = artifact.teams;
  const stateByEvent = eventStateByKey(teams);
  const awardQualified = awardQualifiedSets(teams, options.tierByEvent, stateByEvent, season);

  // WHETHER THE CHAMPIONSHIP IS STILL AHEAD, computed BEFORE the open
  // category walk (quick task 261010-66y): the walk reads a stateless
  // championship row open only while it is. It is the caller's answer when
  // it has one. The two merge entry points read it off the artifact they
  // were handed, before they merged anything into it (see `dcmpStillAhead`).
  // A direct caller passes none and the pass reads it off its own input.
  // Pass 2 below reuses this one value.
  const stillAhead = options.dcmpStillAhead ?? dcmpStillAhead(artifact);
  // The field proof, built once: it picks the finals Playoffs maximum a
  // division team carries, and gives a team with no championship row its
  // finals on top of the hypothetical championship while the field is not
  // proven after a start.
  const nowYear = options.nowYear ?? new Date().getUTCFullYear();
  const fieldProof = publishedFieldProof(teams, season, nowYear, artifact.dcmpSlots, stateByEvent);
  const live: LiveChampionshipReading = {
    statelessChampionshipRowsOpen: options.statelessChampionshipRowsOpen === true,
    championshipStillAhead: stillAhead,
    fieldProven: fieldProof.proven,
  };

  // What is still open at the events each team already has a row for, per
  // tier (quick task 261009-tx6). Built once, and read by both ceilings and
  // both floors below.
  const openByTeam = new Map(teams.map((team) => [team.teamKey, openAtPlayedRows(team, teams, season, stateByEvent, live)] as const));

  // `maxRemainingDistrict` is BUILT from the rows on every call and never
  // added to a stored value, so the pass is idempotent: the remaining district
  // tier events, plus what is open at the played ones, plus the part of a
  // stored ceiling the rows cannot express (a newcomer's seed), which only the
  // two merge entry points know.
  const maxRemainingDistrictByTeam = new Map<string, number>();
  for (const team of teams) {
    maxRemainingDistrictByTeam.set(
      team.teamKey,
      districtRemainingEventsSum(team) + openByTeam.get(team.teamKey)!.district.ceiling + (options.unexplainedDistrictCeiling?.get(team.teamKey) ?? 0)
    );
  }

  // Pass 1: districtLock, against maxRemainingDistrict (regular-tier events
  // only). No prequalification concept exists at the district/DCMP tier.
  // Ranked on the district tier total (quick task 261007-il9): a DCMP's
  // points never earn a place at that DCMP. The points a team's rows carry in
  // a category that is still open are NOT in the floor: the category's whole
  // ceiling is in `maxRemaining` instead, so counting them here too would
  // count them twice. `dcmpCutLine` below reads these same inputs, so it
  // follows.
  const districtLockInputs: LockTeamInput[] = teams.map((team) => ({
    teamKey: team.teamKey,
    pointTotal: districtTierPointTotal(team) - openByTeam.get(team.teamKey)!.district.earned,
    maxRemaining: maxRemainingDistrictByTeam.get(team.teamKey)!,
  }));
  const districtQualifiers: QualifierSets = { awardQualified: awardQualified.district, prequalified: new Set() };
  // One slot held back per district-tier Impact award still to come, so a
  // published `"locked"` is never revoked by an award posted the next day
  // (quick task 260925-ms7). Zero for a district whose events have all posted
  // their awards, which is every finished season in the corpus.
  const reservedSlots = reservedDistrictSlots(teams, season);
  // The second, ADDITIVE proof of `"locked"` (quick task 260925-pl6): points
  // are conserved inside an event, so the district's total remaining points are
  // far smaller than the sum of every rival's ceiling, and a team also locks
  // when no achievable distribution of what is left can lift enough rivals past
  // it. Zero for a finished season, where it locks exactly whom the ceiling test
  // already did.
  const pooled = pooledDistrictPoints(teams, stateByEvent, season);
  const districtLocks = computeLocksWithQualifiers(districtLockInputs, artifact.dcmpSlots, districtQualifiers, reservedSlots, pooled);
  const districtLockByTeam = new Map(districtLocks.map((result) => [result.teamKey, result] as const));

  // Pass 2: maxRemainingChamp = maxRemainingDistrict + what is open at the
  // team's own championship rows + one hypothetical dcmp-tier event's maximum,
  // the last only for a team that has not already attended a DCMP, is not
  // already eliminated per pass 1, and whose district's DCMP has not already
  // happened. Same three gates as `buildDistrictArtifact`. A team has a
  // championship row or a hypothetical championship, never both.
  //
  // "Not already happened" is `stillAhead`, computed above, before the open
  // category walk.
  //
  // WHILE THE FIELD IS NOT PROVEN AFTER A START the hypothetical championship
  // carries a finals as well (`hypotheticalFinalsCeiling`, quick task
  // 261010-66y): the whole dcmp Playoffs ceiling, which is what the team will
  // carry the moment its division's rows land (the finals rule of
  // `openAtPlayedRows`). Without it a team's ceiling rose when its rows
  // landed. The Champ Locks tab grants the same.
  const hypotheticalChampionship = dcmpEventMaxTotal + hypotheticalFinalsCeiling(!fieldProof.unprovenAfterStart, dcmpBase.elim);
  const maxRemainingChampByTeam = new Map<string, number>();
  for (const team of teams) {
    const districtLock = districtLockByTeam.get(team.teamKey)!;
    const hasPlayedDcmp = team.eventPoints.some((row) => row.tier === "dcmp");
    const mightAttendDcmp = stillAhead && !hasPlayedDcmp && districtLock.status !== "eliminated";
    maxRemainingChampByTeam.set(
      team.teamKey,
      maxRemainingDistrictByTeam.get(team.teamKey)! + openByTeam.get(team.teamKey)!.dcmp.ceiling + (mightAttendDcmp ? hypotheticalChampionship : 0)
    );
  }

  // The champ floor is the all tier total, less the points the team's rows
  // carry in a category still open at EITHER tier: both tiers' open ceilings
  // are inside `maxRemainingChamp`.
  const champLockInputs: LockTeamInput[] = teams.map((team) => {
    const open = openByTeam.get(team.teamKey)!;
    return { teamKey: team.teamKey, pointTotal: team.pointTotal - open.district.earned - open.dcmp.earned, maxRemaining: maxRemainingChampByTeam.get(team.teamKey)! };
  });
  const champQualifiers: QualifierSets = { awardQualified: awardQualified.dcmp, prequalified: prequalifiedTeams(season) };
  const champReservedSlots = artifact.cmpSlots === null ? 0 : reservedChampSlotsAtNow(teams, season, artifact.districtKey, artifact.cmpSlots, nowYear, artifact.dcmpSlots);
  let champLocks = computeLocksWithQualifiers(champLockInputs, artifact.cmpSlots, champQualifiers, champReservedSlots);

  // `2025fsc` issued five explicit named invitations instead of a slot-count
  // cutline, so the ordinary math is WRONG for that one district-year. Publish
  // an honest "not modeled" rather than a plausible-looking wrong verdict.
  const champAllocationNote = specialAllocationNote(artifact.districtKey);
  if (champAllocationNote !== null) {
    champLocks = champLocks.map((result) => ({ ...result, status: "unknown" as const, pointsToLock: null, threatCount: 0 }));
  }
  const champLockByTeam = new Map(champLocks.map((result) => [result.teamKey, result] as const));

  const dcmpCutLine = cutLinePointsWithQualifiers(districtLockInputs, artifact.dcmpSlots, districtQualifiers);
  const cmpCutLine = champAllocationNote !== null ? null : cutLinePointsWithQualifiers(champLockInputs, artifact.cmpSlots, champQualifiers);

  const recomputedTeams = teams.map((team) => ({
    ...team,
    maxRemainingDistrict: maxRemainingDistrictByTeam.get(team.teamKey)!,
    maxRemainingChamp: maxRemainingChampByTeam.get(team.teamKey)!,
    districtLock: lockVerdict(districtLockByTeam.get(team.teamKey)!, dcmpCutLine, null),
    champLock: lockVerdict(champLockByTeam.get(team.teamKey)!, cmpCutLine, champAllocationNote),
  }));

  return DistrictArtifactSchema.parse({
    ...artifact,
    teams: recomputedTeams,
    insights: {
      ...artifact.insights,
      teamCount: recomputedTeams.length,
      dcmpCutLinePoints: dcmpCutLine,
      cmpCutLinePoints: cmpCutLine,
      districtLockedCount: recomputedTeams.filter((team) => team.districtLock.status === "locked").length,
      districtEliminatedCount: recomputedTeams.filter((team) => team.districtLock.status === "eliminated").length,
      champLockedCount: recomputedTeams.filter((team) => team.champLock.status === "locked").length,
      champEliminatedCount: recomputedTeams.filter((team) => team.champLock.status === "eliminated").length,
    },
  });
}

// ---------------------------------------------------------------------------
// The merge core
// ---------------------------------------------------------------------------

/** `eventKey -> { eventName, week }`, from every row the artifact already carries. The artifact is the ONLY event-metadata source a corpus-free caller has. */
function eventMetaByKey(teams: readonly DistrictTeam[]): Map<string, { eventName: string; week: number | null }> {
  const meta = new Map<string, { eventName: string; week: number | null }>();
  for (const team of teams) {
    for (const row of team.eventPoints) if (!meta.has(row.eventKey)) meta.set(row.eventKey, { eventName: row.eventName, week: row.week });
    for (const row of team.remainingEvents) if (!meta.has(row.eventKey)) meta.set(row.eventKey, { eventName: row.eventName, week: row.week });
  }
  return meta;
}

/** Applies `eventState` to one row when the caller supplied an observation for its event, otherwise leaves the row's existing `state` alone. */
function withState<T extends { eventKey: string; state?: DistrictEventState }>(row: T, eventState: ReadonlyMap<string, DistrictEventState> | undefined): T {
  const observed = eventState?.get(row.eventKey);
  return observed === undefined ? row : { ...row, state: observed };
}

/** The verdict a brand-new team's row carries before `recomputeDistrictVerdicts` replaces it. Never published: every return path runs the verdict pass. */
const PLACEHOLDER_VERDICT: DistrictTeam["districtLock"] = { status: "unknown", pointsToLock: null, threatCount: 0, cutLinePoints: null, allocationNote: null };

// ---------------------------------------------------------------------------
// The awards step (quick task 261009-r9x)
// ---------------------------------------------------------------------------

/**
 * One award of a TBA `/event/{key}/awards` response, narrowed to the two
 * fields the merge reads. The caller parses the response at its own boundary
 * (the Worker through `tbaEventAwardsResponseSchema`); this module carries no
 * second schema for it.
 */
export interface DistrictEventAwardInput {
  readonly award_type: number;
  readonly recipient_list: readonly { readonly team_key: string | null }[];
}

/** This tick's awards lists, keyed by event key. An event with no entry has no awards news. */
export type DistrictEventAwardsByEvent = ReadonlyMap<string, readonly DistrictEventAwardInput[]>;

/**
 * Applies this tick's awards lists to an artifact's rows: raises
 * `state.awardsPosted` where the live rule now holds, and records who won
 * each qualifying award.
 *
 * ROWS ONLY. No verdict pass, no generation and no timestamp: both entry
 * points below run this on their merged rows immediately before
 * `recomputeDistrictVerdicts`, so the verdict pass reads the new flag and the
 * new records in the same build.
 *
 * THE FLAG, for each event in the map that some row carries.
 * `awardsPostedRule` at the live vantage is asked with six facts:
 *   - whether the list holds a judged award (anything other than Winner and
 *     Finalist);
 *   - whether some team's row at the event carries award points above zero ON
 *     THE ARTIFACT HANDED IN, which is the artifact after this tick's
 *     rankings were merged;
 *   - whether some team's row at the event carries PLAYOFF points above zero
 *     on that same artifact (quick task 261009-vp9). A true flag closes every
 *     category of the event, so it must not rise while the playoff points
 *     are still to land;
 *   - whether the list holds EVERY consuming award an event of its kind gives
 *     (quick task 261009-vp9). The kind is read off the artifact's own rows:
 *     a district tier event (Impact), a dcmp tier key equal to its
 *     championship stem (a championship: Impact, Winner, Engineering
 *     Inspiration and Rookie All Star), or a dcmp tier key whose stem differs
 *     from the key (a division: none);
 *   - whether the caller names the event in `settledAwardEvents` (quick task
 *     261009-tx6: its list has stood unchanged for an hour);
 *   - whether the caller names it in `longSettledAwardEvents` (quick task
 *     261009-vp9: unchanged for 12 hours).
 * The rule turns the flag true on a judged award with its points, playoff
 * points at the event and, where every expected award is listed, the hour;
 * where one is not listed, the 12 hours. An event a set does not name, and every event when a set is not
 * passed, reads as not settled at that length. When the rule holds, every
 * `eventPoints` and `remainingEvents` row for that event that already
 * carries a state block gets `awardsPosted: true`. The step only ever RAISES
 * the flag: a flag already true stays true whatever the list holds, because
 * awards do not un post. A row with no state block is left without one. The
 * schema needs all five state facts, and no state reads as pending, which is
 * the side that keeps reservations held. An event on no row has no flag to
 * raise and is not asked.
 *
 * THE RECORDS, for each event in the map. The event's tier comes from the
 * artifact's own rows (`eventTierByKey`). An event on no row records nothing.
 * A DCMP DIVISION records nothing either: on a dcmp tier row a key whose
 * championship stem differs from the key is a division (`2026micmp1`), and a
 * division Winner must never reach the list, exactly as in the publisher,
 * which skips divisions by event type. The division's FLAG still follows the
 * rule like any event's. Otherwise each recipient that is a team of this
 * artifact gets the record `qualifyingAwardRecord` returns, the same builder
 * `scripts/publishDistricts.ts` calls, appended after the team's existing
 * entries. A recipient outside the district and a recipient with no team key
 * are ignored.
 *
 * IDEMPOTENT, AND NOTHING IS EVER REMOVED. An entry with the same event key
 * and award type already on the team is not added twice, and an entry the
 * list no longer holds stays. A second identical call returns an equal
 * artifact.
 *
 * RECORDED EVERY TIME, WHATEVER THE FLAG SAYS. A DCMP Winner listed before
 * the judged awards is recorded at once, and an Impact winner is recorded
 * while the flag still waits. The record is WRITTEN at once and READ later:
 * the verdict pass counts it only once its own event's state says the award
 * is given (`awardQualifiedSets`, quick task 261009-tx6). Until then the
 * event still reserves its slot and the recorded winner consumes none, so
 * the published verdict no longer holds a slot twice, and a team it locked
 * on points is not read contending for the ticks between the record and the
 * flag (the three state walk in `districtRankingsMerge.test.ts`). The Locks
 * tabs have always read it this way: they gate each award on its own
 * event's stage.
 */
export function applyDistrictEventAwards(
  artifact: DistrictArtifact,
  eventAwards: DistrictEventAwardsByEvent,
  settledAwardEvents?: ReadonlySet<string>,
  longSettledAwardEvents?: ReadonlySet<string>
): DistrictArtifact {
  if (eventAwards.size === 0) return artifact;

  const tiers = eventTierByKey(artifact.teams);
  const teamByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  const eventsToRaise = new Set<string>();
  const appendedByTeam = new Map<string, DistrictTeam["qualifyingAwards"]>();

  for (const [eventKey, awards] of eventAwards) {
    // An event no row carries has no flag to raise and nothing to record.
    const tier = tiers.get(eventKey);
    if (tier === undefined) continue;
    const division = tier === "dcmp" && championshipStemOf(eventKey) !== eventKey;
    const kind: AwardsEventKind = tier === "district" ? "district" : division ? "division" : "championship";
    const awardTypes = awards.map((award) => award.award_type);

    const posted = awardsPostedRule(
      {
        judgedAwardListed: judgedAwardListed(awardTypes),
        awardPointsPresent: awardPointsPresentAt(artifact.teams, eventKey),
        playoffPointsPresent: playoffPointsPresentAt(artifact.teams, eventKey),
        expectedAwardsListed: expectedAwardsListed(kind, awardTypes),
        listSettled: settledAwardEvents?.has(eventKey) === true,
        listSettledLong: longSettledAwardEvents?.has(eventKey) === true,
      },
      "live"
    );
    if (posted) eventsToRaise.add(eventKey);

    // A division records nothing. Its flag still follows the rule above.
    if (division) continue;

    for (const award of awards) {
      for (const recipient of award.recipient_list) {
        if (recipient.team_key === null) continue;
        const team = teamByKey.get(recipient.team_key);
        if (team === undefined) continue;
        const record = qualifyingAwardRecord({ eventKey, awardType: award.award_type, tier, season: artifact.year });
        if (record === null) continue;
        const appended = appendedByTeam.get(team.teamKey) ?? [];
        const sameAward = (entry: { eventKey: string; awardType: number }) => entry.eventKey === record.eventKey && entry.awardType === record.awardType;
        if (team.qualifyingAwards.some(sameAward) || appended.some(sameAward)) continue;
        appended.push(record);
        appendedByTeam.set(team.teamKey, appended);
      }
    }
  }

  if (eventsToRaise.size === 0 && appendedByTeam.size === 0) return artifact;

  const raise = <T extends { eventKey: string; state?: DistrictEventState }>(row: T): T =>
    row.state === undefined || row.state.awardsPosted || !eventsToRaise.has(row.eventKey) ? row : { ...row, state: { ...row.state, awardsPosted: true } };

  return {
    ...artifact,
    teams: artifact.teams.map((team) => {
      const appended = appendedByTeam.get(team.teamKey);
      return {
        ...team,
        eventPoints: team.eventPoints.map(raise),
        remainingEvents: team.remainingEvents.map(raise),
        qualifyingAwards: appended === undefined ? team.qualifyingAwards : [...team.qualifyingAwards, ...appended],
      };
    }),
  };
}

export interface ApplyDistrictRankingsOptions {
  /** The district artifact as read back from R2 — already `DistrictArtifactSchema`-parsed. */
  readonly artifact: DistrictArtifact;
  /** The raw `/district/{key}/rankings` body. Parsed through `DistrictRankingsPayloadSchema` at this boundary. */
  readonly rankings: unknown;
  /** Stamped onto the result verbatim. Never minted inside this module. */
  readonly generation: string;
  /** Stamped onto the result verbatim. There is no clock in this module. */
  readonly computedAt: string;
  /** Optional per-event state observations, keyed by event key — written onto every matching row across every team. */
  readonly eventState?: ReadonlyMap<string, DistrictEventState>;
  /**
   * Optional awards lists fetched this tick, keyed by event key (quick task
   * 261009-r9x). When supplied, `applyDistrictEventAwards` runs on the merged
   * rows immediately before the verdict pass. Absent, the merge behaves
   * exactly as it did before that task.
   */
  readonly eventAwards?: DistrictEventAwardsByEvent;
  /**
   * The event keys of `eventAwards` whose list has stood unchanged for an
   * hour, as the caller measured it (quick task 261009-tx6). The flag of an
   * event whose list holds every consuming award it gives can rise only
   * here. Absent, no list is settled.
   */
  readonly settledAwardEvents?: ReadonlySet<string>;
  /**
   * The event keys of `eventAwards` whose list has stood unchanged for 12
   * hours, as the caller measured it (quick task 261009-vp9). The flag of an
   * event whose list LACKS a consuming award it gives can rise only here.
   * Absent, nothing rises for such an event.
   */
  readonly longSettledAwardEvents?: ReadonlySet<string>;
}

/**
 * Merges a TBA rankings payload into an already-published district artifact
 * and returns a `DistrictArtifactSchema`-parsed result with every verdict
 * recomputed.
 *
 * REFUSE BEFORE MERGING, NEVER HALF-MERGE. An empty `rankings` array throws
 * (an empty rankings response must never blank a published district — this
 * guard is the whole reason the merge is a function and not inline Worker
 * code) and a duplicated `team_key` throws, both before any row is touched.
 *
 * Merged per team from the payload: `rank`, `pointTotal`, `rookieBonus`,
 * `adjustments`, and `eventPoints` rebuilt from `event_points` with
 * `eventName`/`week` looked up from the artifact's own rows (falling back to
 * the event key and `null`, exactly as `buildDistrictArtifact` does) and
 * `tier` read from each entry's OWN `district_cmp` boolean.
 * `remainingEvents` is trimmed of every event that now has an `eventPoints`
 * entry (`10-RESEARCH.md` Pitfall 3).
 *
 * Carried forward untouched: `teamNumber`, `nickname`, every other key the
 * artifact's team row carries, and every district-level field.
 * `qualifyingAwards` is carried forward too, and EXTENDED by the awards step
 * when the caller supplies `eventAwards` (quick task 261009-r9x): entries are
 * appended, never rebuilt and never shortened. A team present in the artifact
 * but absent from the payload keeps its whole row and still competes in the
 * lock math — dropping it would silently remove a threat and manufacture a
 * `"locked"` verdict.
 *
 * THE AWARDS STEP RUNS AFTER THE ROWS ARE MERGED AND BEFORE THE VERDICT PASS.
 * Its flag rule reads award points off the merged rows, so points that arrive
 * in this same payload count on this same call.
 *
 * TEAM ORDER: payload order first (TBA sends rankings ascending by rank),
 * then any artifact-only team in the artifact's own order. Deterministic, so
 * two runs over the same inputs serialize byte-identically.
 */
export function applyDistrictRankings(options: ApplyDistrictRankingsOptions): DistrictArtifact {
  const { artifact, generation, computedAt, eventState, eventAwards, settledAwardEvents, longSettledAwardEvents } = options;
  const rankings = DistrictRankingsPayloadSchema.parse(options.rankings);

  if (rankings.length === 0) {
    throw new DistrictMergeError(
      `applyDistrictRankings: refusing to merge an EMPTY rankings payload into published district ${artifact.districtKey} — ` +
        `a null or empty TBA response means "nothing to merge", which is the caller's decision to make, never a district with zero teams`
    );
  }
  const seen = new Set<string>();
  for (const row of rankings) {
    if (seen.has(row.team_key)) {
      throw new DistrictMergeError(`applyDistrictRankings: rankings payload for district ${artifact.districtKey} carries team_key ${row.team_key} more than once — refusing to merge an ambiguous payload`);
    }
    seen.add(row.team_key);
  }

  const season = artifact.year;
  const districtBase = maxEventPoints(season, "district");
  const dcmpBase = maxEventPoints(season, "dcmp");
  const districtEventMaxTotal = districtBase.qual + districtBase.alliance + districtBase.elim + districtBase.award;
  const dcmpEventMaxTotal = dcmpBase.qual + dcmpBase.alliance + dcmpBase.elim + dcmpBase.award;

  const meta = eventMetaByKey(artifact.teams);
  const existingByTeam = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));

  // Read off the INCOMING artifact, before a row or a state is merged into
  // it (quick task 261009-tx6): whether a championship is still ahead, and
  // the part of every team's stored district ceiling its rows do not explain.
  // `applyDistrictEventState` reads the same two facts the same way, so a
  // rankings 200 tick and a 304 tick hand the verdict pass the same answers.
  const stillAhead = dcmpStillAhead(artifact);
  const unexplainedDistrictCeiling = unexplainedDistrictCeilings(artifact);

  const mergedFromPayload: DistrictTeam[] = rankings.map((row) => {
    const existing = existingByTeam.get(row.team_key);
    const existingStateByEvent = new Map<string, DistrictEventState>();
    for (const existingRow of existing?.eventPoints ?? []) if (existingRow.state !== undefined) existingStateByEvent.set(existingRow.eventKey, existingRow.state);
    for (const existingRow of existing?.remainingEvents ?? []) if (existingRow.state !== undefined) existingStateByEvent.set(existingRow.eventKey, existingRow.state);

    const eventPoints: DistrictEventPointsRow[] = row.event_points.map((entry) => {
      const known = meta.get(entry.event_key);
      const carried = existingStateByEvent.get(entry.event_key);
      const built: DistrictEventPointsRow = {
        eventKey: entry.event_key,
        eventName: known?.eventName ?? entry.event_key,
        week: known?.week ?? null,
        tier: entry.district_cmp ? "dcmp" : "district",
        qual: entry.qual_points,
        alliance: entry.alliance_points,
        elim: entry.elim_points,
        award: entry.award_points,
        total: entry.total,
        ...(carried === undefined ? {} : { state: carried }),
      };
      return withState(built, eventState);
    });

    const playedEventKeys = new Set(eventPoints.map((entry) => entry.eventKey));
    const remainingEvents: DistrictRemainingEventRow[] = (existing?.remainingEvents ?? [])
      .filter((remaining) => !playedEventKeys.has(remaining.eventKey))
      .map((remaining) => withState({ ...remaining, maxPoints: remaining.tier === "dcmp" ? dcmpEventMaxTotal : districtEventMaxTotal }, eventState));

    // A PAYLOAD-ONLY TEAM HAS NO CALENDAR HERE, AND ZERO IS THE ONE ANSWER
    // THAT CANNOT BE USED. A team present in TBA's rankings payload but absent
    // from the published artifact has no `remainingEvents` to sum, so its
    // ceiling would be 0 — a ceiling equal to that team's current point
    // total. That removes it as a threat to everyone above it and can mark the
    // team itself `eliminated`, which is exactly the outcome this function's
    // own header says dropping a team would produce: "silently remove a threat
    // and manufacture a `locked` verdict". Arriving at it by a different route
    // does not make it a different bug.
    //
    // `dcmpStillAhead` states the rule this follows: err toward "still
    // ahead", because an OVERSTATED rival ceiling only delays a `"locked"`
    // verdict while an understated one publishes a guarantee that is not true.
    // So an unknown team is seeded with one district event's own maximum
    // total.
    //
    // THE BOUND IS HONEST ABOUT WHAT IT IS. A team plays 0 to 4 district
    // events, and this substitution assumes exactly one is still ahead. It is
    // not a measurement and it is not tight — it is the smallest value that
    // errs in the safe direction, chosen over a larger guess because the
    // publisher's own calendar, not this function, is where the real answer
    // lives.
    //
    // THE SEED LASTS UNTIL AN OFFLINE REPUBLISH GIVES THE TEAM REAL ROWS, ON
    // BOTH PATHS (quick task 261009-tx6). The verdict pass rebuilds
    // `maxRemainingDistrict` from the rows, and no row says "seeded", so the
    // seed is handed to the pass as this team's unexplained ceiling. On every
    // later tick the team is in the artifact, its stored ceiling still holds
    // the seed, and `unexplainedDistrictCeilings` finds it again as the part
    // of that stored value no row explains, on a rankings 200 and on a 304
    // alike. Before that task the seed was written into the field once and
    // lost on the very next rankings 200, when the carried sum of a team with
    // no remaining events read zero.
    if (existing === undefined) unexplainedDistrictCeiling.set(row.team_key, districtEventMaxTotal);

    return {
      // Spread first so every field the artifact's team row carries — today's
      // and any field a later plan adds — rides forward by default; the
      // payload-derived fields below are the deliberate exceptions.
      ...(existing ?? { teamKey: row.team_key, qualifyingAwards: [] as DistrictTeam["qualifyingAwards"], districtLock: PLACEHOLDER_VERDICT, champLock: PLACEHOLDER_VERDICT }),
      teamKey: row.team_key,
      rank: row.rank,
      pointTotal: row.point_total,
      rookieBonus: row.rookie_bonus,
      adjustments: row.adjustments,
      eventPoints,
      remainingEvents,
      // Both provisional: `recomputeDistrictVerdicts` builds the two ceilings
      // from the rows and overwrites them below. The publisher's calendar
      // answer was already read off the incoming artifact (`stillAhead`
      // above), so nothing downstream reads these two values.
      maxRemainingDistrict: existing?.maxRemainingDistrict ?? districtEventMaxTotal,
      maxRemainingChamp: existing?.maxRemainingChamp ?? districtEventMaxTotal,
    } satisfies DistrictTeam;
  });

  const carriedOnly = artifact.teams.filter((team) => !seen.has(team.teamKey)).map((team) => ({ ...team, eventPoints: team.eventPoints.map((row) => withState(row, eventState)), remainingEvents: team.remainingEvents.map((row) => withState(row, eventState)) }));

  const teams = [...mergedFromPayload, ...carriedOnly];

  // A baked pmf describes an event that has NOT started. The moment any team
  // reports points for it, the sidecar is stale by definition, so its key
  // leaves `bakedEvents` and the reader stops fetching it. Same trim the
  // `remainingEvents` filter above performs, one level up.
  const playedAnywhere = new Set<string>();
  for (const team of teams) for (const row of team.eventPoints) playedAnywhere.add(row.eventKey);
  const bakedEvents = artifact.bakedEvents?.filter((eventKey) => !playedAnywhere.has(eventKey));

  const merged: DistrictArtifact = {
    ...artifact,
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation,
    computedAt,
    teams,
    ...(bakedEvents === undefined ? {} : { bakedEvents }),
  };

  return recomputeDistrictVerdicts(eventAwards === undefined ? merged : applyDistrictEventAwards(merged, eventAwards, settledAwardEvents, longSettledAwardEvents), {
    dcmpStillAhead: stillAhead,
    unexplainedDistrictCeiling,
    // A live path: a championship's first rows arrive with no state block.
    statelessChampionshipRowsOpen: true,
  });
}

export interface ApplyDistrictEventStateOptions {
  /** The district artifact as read back from R2 — already `DistrictArtifactSchema`-parsed. */
  readonly artifact: DistrictArtifact;
  /** Per-event state observations, keyed by event key. Every key must match at least one row somewhere in the artifact. */
  readonly eventState: ReadonlyMap<string, DistrictEventState>;
  readonly generation: string;
  readonly computedAt: string;
  /**
   * Forwarded to `recomputeDistrictVerdicts`. The publisher passes its corpus
   * tier map; the Worker passes none, exactly as it does through
   * `applyDistrictRankings`.
   */
  readonly tierByEvent?: ReadonlyMap<string, DistrictTier>;
  /**
   * Optional awards lists fetched this tick, keyed by event key (quick task
   * 261009-r9x). Applied after the state is written and before the verdict
   * pass. Unlike `eventState`, a key no row carries is NOT refused here: it
   * contributes nothing.
   */
  readonly eventAwards?: DistrictEventAwardsByEvent;
  /** The event keys of `eventAwards` whose list has stood unchanged for an hour (quick task 261009-tx6). Absent, no list is settled. */
  readonly settledAwardEvents?: ReadonlySet<string>;
  /** The event keys of `eventAwards` whose list has stood unchanged for 12 hours (quick task 261009-vp9): the wait for a list that lacks a consuming award its event gives. Absent, nothing rises for such an event. */
  readonly longSettledAwardEvents?: ReadonlySet<string>;
}

/**
 * Writes observed per-event state onto every matching `eventPoints` and
 * `remainingEvents` row, then recomputes the verdicts.
 *
 * WHY THIS IS A SECOND ENTRY POINT rather than an argument to the first: a
 * category can finish without moving a single team's point total. Alliances
 * are selected, and a team that was not picked earns nothing while its row's
 * `alliancesPicked` is now true. So the Worker needs a write path that
 * records what it observed when the rankings poll came back unchanged.
 *
 * WHY THE VERDICT PASS RUNS HERE TOO (2026-09-26): a state observation CAN
 * move a verdict without moving a point. The Locked test holds back one
 * qualifier slot for every event whose Impact award is still pending, and
 * `reservedImpactSlots` reads that from `state.awardsPosted`, with a missing
 * state block counting as pending. Before this the publisher computed its
 * verdicts on state-free rows and attached the state afterwards through this
 * function, so every finished season shipped with all of its events read as
 * pending: eight held-back slots, and eight Locked PNW teams demoted to
 * contending in generation 2026-09-26T03:18:01Z. The recompute is the same
 * pass `applyDistrictRankings` ends with; this path merely stopped skipping it.
 *
 * Both functions share the one merge core (`withState` walks the rows for
 * each); neither duplicates the other's row walk.
 *
 * REFUSES an event key no team in the artifact carries. A state observation
 * for an event outside this district is a caller bug — silently dropping it
 * would leave the Worker believing it had written a fact it had not.
 */
export function applyDistrictEventState(options: ApplyDistrictEventStateOptions): DistrictArtifact {
  const { artifact, eventState, generation, computedAt, tierByEvent, eventAwards, settledAwardEvents, longSettledAwardEvents } = options;

  const known = new Set<string>();
  for (const team of artifact.teams) {
    for (const row of team.eventPoints) known.add(row.eventKey);
    for (const row of team.remainingEvents) known.add(row.eventKey);
  }
  for (const eventKey of eventState.keys()) {
    if (!known.has(eventKey)) {
      throw new DistrictMergeError(`applyDistrictEventState: district ${artifact.districtKey} carries no row for event ${eventKey} — refusing to drop a state observation for an event outside this district`);
    }
  }

  // Read off the INCOMING artifact, before the state is written (quick task
  // 261009-tx6), exactly as `applyDistrictRankings` reads them: whether a
  // championship is still ahead, and the part of every team's stored district
  // ceiling its rows do not explain.
  const stillAhead = dcmpStillAhead(artifact);
  const unexplainedDistrictCeiling = unexplainedDistrictCeilings(artifact);

  const withEventState = DistrictArtifactSchema.parse({
    ...artifact,
    // STAMPED HERE TOO, exactly as `applyDistrictRankings` stamps it.
    // `districtRefresh.ts` chooses between the two entry points on whether TBA
    // answered 200 or 304, so a version stamped by one and merely carried by
    // the other would make the PUBLISHED schema version of a live district
    // depend on a TBA cache hit — two ticks over the same district writing two
    // different values. The producer owns this field in both paths, and it is
    // never read off the artifact it was handed.
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation,
    computedAt,
    teams: artifact.teams.map((team) => ({
      ...team,
      eventPoints: team.eventPoints.map((row) => withState(row, eventState)),
      remainingEvents: team.remainingEvents.map((row) => withState(row, eventState)),
    })),
  });
  return recomputeDistrictVerdicts(eventAwards === undefined ? withEventState : applyDistrictEventAwards(withEventState, eventAwards, settledAwardEvents, longSettledAwardEvents), {
    ...(tierByEvent === undefined ? {} : { tierByEvent }),
    dcmpStillAhead: stillAhead,
    unexplainedDistrictCeiling,
    // A live path: a championship's first rows arrive with no state block.
    statelessChampionshipRowsOpen: true,
  });
}
