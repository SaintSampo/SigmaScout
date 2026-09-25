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
 */
import { z } from "zod";
import { computeLocksWithQualifiers, cutLinePointsWithQualifiers, type LockResult, type LockTeamInput, type QualifierSets } from "../core/districts/locks.js";
import { maxEventPoints, type DistrictTier } from "../core/districts/pointModel.js";
import { prequalifiedTeams } from "../core/districts/prequalified.js";
import { consumingAwardTypesForTier, specialAllocationNote, type AwardTier } from "../core/districts/qualification.js";
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
 * Whether the district's DCMP could still yield points to anyone, derived
 * WITHOUT a corpus or a calendar.
 *
 * `buildDistrictArtifact` answers this from the event list's own start dates.
 * The Worker has neither, so the answer is read back off the artifact the
 * publisher (which did have the calendar) produced: a team still carrying a
 * dcmp-tier remaining event, or any team whose published champ ceiling
 * exceeds its district ceiling by at least one whole dcmp event, means the
 * hypothetical DCMP was still ahead when that artifact was written.
 *
 * The `>=` comparison rather than `===` is deliberate: after a merge trims a
 * team's district-tier remaining events, that team's carried-forward champ
 * ceiling sits MORE than one dcmp event above its freshly shrunk district
 * ceiling, and an equality test would read that as "no DCMP granted".
 *
 * This errs toward "still ahead", which OVERSTATES ceilings. That is the only
 * safe direction: an overstated rival ceiling delays a `"locked"` verdict,
 * while an understated one would publish a guarantee that is not true.
 */
function dcmpStillAhead(teams: readonly DistrictTeam[], dcmpEventMaxTotal: number): boolean {
  return teams.some((team) => team.remainingEvents.some((event) => event.tier === "dcmp") || team.maxRemainingChamp - team.maxRemainingDistrict >= dcmpEventMaxTotal);
}

/**
 * `eventKey -> tier`, built from every team's own `eventPoints` and
 * `remainingEvents` rows. The artifact is the only tier source available to
 * a corpus-free caller, and it is authoritative: each `eventPoints` row's
 * tier came from that entry's own `district_cmp` boolean.
 */
function tierByEventKey(teams: readonly DistrictTeam[]): Map<string, DistrictTier> {
  const tiers = new Map<string, DistrictTier>();
  for (const team of teams) {
    for (const row of team.eventPoints) tiers.set(row.eventKey, row.tier);
    for (const row of team.remainingEvents) if (!tiers.has(row.eventKey)) tiers.set(row.eventKey, row.tier);
  }
  return tiers;
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
 */
function awardQualifiedSets(
  teams: readonly DistrictTeam[],
  suppliedTiers: ReadonlyMap<string, DistrictTier> | undefined
): { district: Set<string>; dcmp: Set<string> } {
  const tiers = tierByEventKey(teams);
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
      (awardTier === "dcmp" ? dcmp : district).add(team.teamKey);
    }
  }
  return { district, dcmp };
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
}

export function recomputeDistrictVerdicts(artifact: DistrictArtifact, options: RecomputeDistrictVerdictsOptions = {}): DistrictArtifact {
  const season = artifact.year;
  const dcmpBase = maxEventPoints(season, "dcmp");
  const dcmpEventMaxTotal = dcmpBase.qual + dcmpBase.alliance + dcmpBase.elim + dcmpBase.award;

  const teams = artifact.teams;
  const awardQualified = awardQualifiedSets(teams, options.tierByEvent);

  // Pass 1: districtLock, against maxRemainingDistrict (regular-tier events
  // only). No prequalification concept exists at the district/DCMP tier.
  const districtLockInputs: LockTeamInput[] = teams.map((team) => ({ teamKey: team.teamKey, pointTotal: team.pointTotal, maxRemaining: team.maxRemainingDistrict }));
  const districtQualifiers: QualifierSets = { awardQualified: awardQualified.district, prequalified: new Set() };
  const districtLocks = computeLocksWithQualifiers(districtLockInputs, artifact.dcmpSlots, districtQualifiers);
  const districtLockByTeam = new Map(districtLocks.map((result) => [result.teamKey, result] as const));

  // Pass 2: maxRemainingChamp = maxRemainingDistrict + one hypothetical
  // dcmp-tier event's maximum, only for a team that has not already attended
  // a DCMP, is not already eliminated per pass 1, and whose district's DCMP
  // has not already happened. Same three gates as `buildDistrictArtifact`.
  const stillAhead = dcmpStillAhead(teams, dcmpEventMaxTotal);
  const maxRemainingChampByTeam = new Map<string, number>();
  for (const team of teams) {
    const districtLock = districtLockByTeam.get(team.teamKey)!;
    const hasPlayedDcmp = team.eventPoints.some((row) => row.tier === "dcmp");
    const mightAttendDcmp = stillAhead && !hasPlayedDcmp && districtLock.status !== "eliminated";
    maxRemainingChampByTeam.set(team.teamKey, team.maxRemainingDistrict + (mightAttendDcmp ? dcmpEventMaxTotal : 0));
  }

  const champLockInputs: LockTeamInput[] = teams.map((team) => ({ teamKey: team.teamKey, pointTotal: team.pointTotal, maxRemaining: maxRemainingChampByTeam.get(team.teamKey)! }));
  const champQualifiers: QualifierSets = { awardQualified: awardQualified.dcmp, prequalified: prequalifiedTeams(season) };
  let champLocks = computeLocksWithQualifiers(champLockInputs, artifact.cmpSlots, champQualifiers);

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
 * Carried forward untouched: `teamNumber`, `nickname`, `qualifyingAwards`,
 * every other key the artifact's team row carries, and every district-level
 * field. A team present in the artifact but absent from the payload keeps its
 * whole row and still competes in the lock math — dropping it would silently
 * remove a threat and manufacture a `"locked"` verdict.
 *
 * TEAM ORDER: payload order first (TBA sends rankings ascending by rank),
 * then any artifact-only team in the artifact's own order. Deterministic, so
 * two runs over the same inputs serialize byte-identically.
 */
export function applyDistrictRankings(options: ApplyDistrictRankingsOptions): DistrictArtifact {
  const { artifact, generation, computedAt, eventState } = options;
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

    const carriedMaxRemainingDistrict = remainingEvents
      .filter((remaining) => remaining.tier === "district")
      .reduce((sum, remaining) => sum + remaining.maxPoints, 0);

    // A PAYLOAD-ONLY TEAM HAS NO CALENDAR HERE, AND ZERO IS THE ONE ANSWER
    // THAT CANNOT BE USED. A team present in TBA's rankings payload but absent
    // from the published artifact has no `remainingEvents` to sum, so the
    // reduce above returns 0 — a ceiling equal to that team's current point
    // total. That removes it as a threat to everyone above it and can mark the
    // team itself `eliminated`, which is exactly the outcome this function's
    // own header says dropping a team would produce: "silently remove a threat
    // and manufacture a `locked` verdict". Arriving at it by a different route
    // does not make it a different bug.
    //
    // `dcmpStillAhead` just above states the rule this follows: err toward
    // "still ahead", because an OVERSTATED rival ceiling only delays a
    // `"locked"` verdict while an understated one publishes a guarantee that is
    // not true. So an unknown team is seeded with one district event's own
    // maximum total.
    //
    // THE BOUND IS HONEST ABOUT WHAT IT IS. A team plays 0 to 4 district
    // events, and this substitution assumes exactly one is still ahead. It is
    // not a measurement and it is not tight — it is the smallest value that
    // errs in the safe direction, chosen over a larger guess because the
    // publisher's own calendar, not this function, is where the real answer
    // lives. The next offline republish gives the team a real row and this path
    // stops applying to it.
    const maxRemainingDistrict = existing === undefined ? districtEventMaxTotal : carriedMaxRemainingDistrict;

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
      maxRemainingDistrict,
      // Provisional: `recomputeDistrictVerdicts` owns the two-pass rule and
      // overwrites this below. Seeded from the artifact's own published value
      // so `dcmpStillAhead` can still read the publisher's calendar answer.
      maxRemainingChamp: existing?.maxRemainingChamp ?? maxRemainingDistrict,
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

  return recomputeDistrictVerdicts(merged);
}

export interface ApplyDistrictEventStateOptions {
  /** The district artifact as read back from R2 — already `DistrictArtifactSchema`-parsed. */
  readonly artifact: DistrictArtifact;
  /** Per-event state observations, keyed by event key. Every key must match at least one row somewhere in the artifact. */
  readonly eventState: ReadonlyMap<string, DistrictEventState>;
  readonly generation: string;
  readonly computedAt: string;
}

/**
 * Writes observed per-event state onto every matching `eventPoints` and
 * `remainingEvents` row and changes nothing else.
 *
 * WHY THIS IS A SECOND ENTRY POINT rather than an argument to the first: a
 * category can finish without moving a single team's point total. Alliances
 * are selected, and a team that was not picked earns nothing while its row's
 * `alliancesPicked` is now true. So the Worker needs a write path that
 * records what it observed when the rankings poll came back unchanged — and
 * running the verdict pass there would be work that provably cannot alter an
 * outcome, since no floor and no ceiling moved.
 *
 * Both functions share the one merge core (`withState` walks the rows for
 * each); neither duplicates the other's row walk.
 *
 * REFUSES an event key no team in the artifact carries. A state observation
 * for an event outside this district is a caller bug — silently dropping it
 * would leave the Worker believing it had written a fact it had not.
 */
export function applyDistrictEventState(options: ApplyDistrictEventStateOptions): DistrictArtifact {
  const { artifact, eventState, generation, computedAt } = options;

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

  return DistrictArtifactSchema.parse({
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
}
