/**
 * The offline Districts-page publish tool, shaped exactly like
 * `scripts/publishAlgorithmsManifest.ts`: `parseArgs` from `node:util`,
 * deep relative imports with explicit `.js` extensions, a `main()` guarded
 * on being the process entry point, non-zero exit on failure. District
 * artifacts are refreshed only by an offline `pnpm ingest:districts` +
 * `pnpm publish:districts`; the live Worker cron does not touch them.
 *
 * ONE VERDICT PASS, TWO CALLERS. This file no longer computes a lock verdict
 * itself: it composes every team's rows and hands them to
 * `packages/harness/districtRankingsMerge.ts`'s `recomputeDistrictVerdicts`,
 * the same pass 10-05's live Worker calls through `applyDistrictRankings`. The
 * two-pass `maxRemainingChamp` rule whose pass two reads pass one's
 * `districtLock.status` is precisely the part that must not exist twice. The
 * two facts only a corpus-holding caller has — whether the district's DCMP is
 * still ahead (from the event list's start dates) and each event's tier (from
 * `events.event_type`) — are seeded into that pass rather than recomputed
 * beside it.
 *
 * AWARD-BASED QUALIFICATION still rests on the corpus's `event_awards` table:
 * until the orchestrator's real `pnpm ingest:districts -- --awards-only` (or
 * `pnpm ingest:awards`) run, that table is empty for every event, so every
 * team's `qualifyingAwards` is `[]` and every award-qualified set is empty;
 * this is a genuinely valid, degenerate input (an ordinary points-only run),
 * not an error state — the curated `prequalified.ts` lists are unaffected
 * either way, since they are pure declared data with no ingest dependency.
 *
 * THE BAKE (10-06): an event NOBODY HAS PLAYED at the run's own instant is
 * priced offline from walk-forward SPR state and published as a
 * `v1/district-presim/{districtKey}/{eventKey}.json` sidecar, so the browser
 * paints it with zero simulation compute. `--as-of` is the one instant that
 * decides which events are still ahead AND which matches enter the replay, so
 * an event can never be priced from a state that saw its own results. With
 * `--as-of` absent the instant is the run's own clock and the truncation is
 * provably an identity, so the verification path and the production path are
 * one code path. `--no-bake` skips the replay entirely and says so.
 *
 * Never reads, prints or interpolates `.env` or any value from it —
 * `putObject` (`packages/harness/r2Client.js`) reads its own credentials
 * from `process.env`, exactly as every other publish tool in this repo does;
 * this file never touches `process.env` directly. `--dry-run` composes,
 * validates (through `DistrictsIndexArtifactSchema`/`DistrictArtifactSchema`)
 * and prints per-object byte sizes without ever calling `putObject`.
 *
 * Write ordering: every `v1/district/{key}.json` is written before
 * `v1/districts/{year}.json` is overwritten, so the index never points at
 * a detail object that is not there yet.
 *
 * ROOKIE BONUS, A DOCUMENTED GAP: this corpus carries no `rookie_year` per
 * team (nothing in `packages/corpus/schema.sql`'s `teams` table, and no
 * ingest module fetches TBA's `/team/{key}` rookie-year field). A team's
 * `district_rankings.rookie_bonus` is TBA's own ALREADY-APPLIED bonus, folded
 * into `point_total` from that team's very first ranked event (FIRST applies
 * it there, not incrementally) -- so a team appearing in `district_rankings`
 * at all has, in practice, already received any rookie bonus it will ever
 * get. `maxRemainingDistrict`/`maxRemainingChamp` below therefore do NOT add
 * a speculative future rookie bonus: doing so with no reliable rookie
 * signal would inflate ~every non-rookie team's ceiling (the vast majority),
 * making the tool less useful without making it more correct.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  openCorpusReadOnly,
  selectDistrictsForYear,
  selectDistrictRankings,
  selectEventAwardsForEvents,
  selectEventTeamsForEvents,
  type Corpus,
  type CorpusDistrict,
  type CorpusDistrictRanking,
  type CorpusEventAward,
} from "../packages/corpus/db.js";
import { maxEventPoints, type DistrictTier } from "../packages/core/districts/pointModel.js";
import {
  awardDisplayName,
  isAwardOnly,
  isQualificationRelevantAward,
  type AwardTier,
} from "../packages/core/districts/qualification.js";
import { bakeDistrictEvent, DISTRICT_BAKE_DRAWS_PER_SCHEDULE, DISTRICT_BAKE_SCHEDULE_COUNT } from "../packages/harness/districtBake.js";
import {
  applyDistrictEventState,
  // Aliased on import so this file carries exactly ONE line naming the promoted
  // schema. The module-local `EventPointsEntrySchema`/`EventPointsArraySchema`
  // pair this file used to define is DELETED; the promoted one is the survivor.
  DistrictRankingsEventPointsEntrySchema as PromotedEventPointsEntry,
  recomputeDistrictVerdicts,
} from "../packages/harness/districtRankingsMerge.js";
import { defaultMatchesPerTeam, matchesPerTeamFor, MAX_SCHEDULE_TEAMS, MIN_SCHEDULE_TEAMS } from "../packages/harness/generatedSchedules.js";
import {
  districtDetailKey,
  districtPreSimKey,
  districtsIndexKey,
  DistrictArtifactSchema,
  DistrictPreSimArtifactSchema,
  DistrictsIndexArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  type DistrictArtifact,
  type DistrictEventState,
  type DistrictPreSimArtifact,
  type DistrictsIndexArtifact,
} from "../packages/harness/pageArtifacts.js";
import {
  assertWithinDistrictBudget,
  DISTRICT_DETAIL_MAX_BYTES,
  DISTRICT_DETAIL_MAX_BYTES_PER_TEAM,
  DISTRICT_PRESIM_MAX_BYTES,
} from "../packages/harness/publishBudget.js";
import { putObject } from "../packages/harness/r2Client.js";
import { parseSeasonSpec } from "../packages/harness/seasonSpec.js";
import { buildDistrictPricingState, resolveDistrictPricingAlgorithm, startedEventKeysAsOf } from "./districtPricingState.js";
import { decorationBucket, rookieStateFor } from "../packages/core/districts/awardBaseRates.js";
import type { DistrictAwardProfile } from "../packages/core/districts/ledgerSimulation.js";
import { loadAwardInstances, loadRookieYears, priorJudgedAwardCount, type AwardInstance } from "./measureDistrictAwardBaseRates.js";
import { selectCorpusSeasons } from "../packages/corpus/db.js";

const DEFAULT_BUCKET = "sigmascout-artifacts";
const CORPUS_PATH = "data/corpus.sqlite";

/**
 * The first season the production `publish:districts` entry replays from when a
 * bake needs walk-forward state — `package.json`'s own `--years
 * 2016-2020,2022-2026`, read as its first term. Overridable with
 * `--warmup-from` so a verification run can replay a shorter warmup.
 */
const DEFAULT_WARMUP_FROM_SEASON = 2016;

/**
 * The per-object byte ceilings the publish gate enforces. Injectable so a test
 * can fire the gate at a lowered ceiling WITHOUT editing a committed constant —
 * `docs/publish-budget.md`'s own rule is never to widen a ceiling to make a run
 * pass, and a test that edited one would be doing exactly that.
 */
export interface DistrictBudgetCeilings {
  readonly detailPerTeam: number;
  readonly detailAbsolute: number;
  readonly presim: number;
}

export const COMMITTED_DISTRICT_CEILINGS: DistrictBudgetCeilings = {
  detailPerTeam: DISTRICT_DETAIL_MAX_BYTES_PER_TEAM,
  detailAbsolute: DISTRICT_DETAIL_MAX_BYTES,
  presim: DISTRICT_PRESIM_MAX_BYTES,
};

// ---------------------------------------------------------------------------
// TBA event_points shape — the module-local copy this file used to carry was
// PROMOTED to `packages/harness/districtRankingsMerge.ts` when a second
// producer (10-05's Worker) began parsing the same array. One schema, two
// callers, and the tier of an entry still comes from its own `district_cmp`
// boolean rather than from a join to `events.event_type` (`pointModel.ts`'s
// documented measurement trap).
// ---------------------------------------------------------------------------

/** TBA `event_type` -> this model's two-tier vocabulary. `2`=District Championship, `5`=District Championship Division map to `"dcmp"` (mirrors `packages/core/rankingPoints/constants.ts`'s `EVENT_TYPE_TIERS`); every other value observed in a district's own event list is `"district"`. */
function districtTierForEventType(eventType: number): DistrictTier {
  return eventType === 2 || eventType === 5 ? "dcmp" : "district";
}

/**
 * TBA `event_type` -> the tier an event's AWARDS qualify a team at, or `null`
 * for events whose awards are never qualification-relevant. This is
 * deliberately NOT `districtTierForEventType`: a District Championship
 * DIVISION (`event_type` 5) is `"dcmp"` for POINT purposes, but its "Winner"
 * award crowns a division champion, not the DCMP winning alliance — only the
 * parent DCMP event (`event_type` 2) presents the Winner/Impact/EI/RAS awards
 * that advance a team to the FIRST Championship (TBA's own
 * `district_advancement_helper` reads DCMP qualifiers from the parent event).
 * Counting division Winners was a live bug: 2026fim division winners
 * (e.g. frc5460 at 2026micmp4) rendered champ-`lockedAward` without having
 * won the DCMP.
 */
function awardTierForEventType(eventType: number): AwardTier | null {
  if (eventType === 1) return "district";
  if (eventType === 2) return "dcmp";
  return null;
}

// ---------------------------------------------------------------------------
// Corpus reads — module-local helpers, mirroring `packages/harness/publish.ts`'s
// `selectEventMeta` local-helper style (raw SQL against the Corpus instance,
// no new `packages/corpus/db.ts` accessor needed for a publish-only query).
// ---------------------------------------------------------------------------

export interface DistrictEventMeta {
  readonly eventKey: string;
  readonly name: string;
  readonly week: number | null;
  readonly eventType: number;
  /** TBA start date (YYYY-MM-DD) or null when unknown. Used to keep already-finished events out of `remainingEvents` — a registered no-show must not inflate a ceiling forever. */
  readonly startDate?: string | null;
}

/**
 * True when `event` could still yield points as of `computedAt`: its start
 * date is unknown (honest default: assume ahead), or within/after
 * `computedAt` minus a 7-day buffer (FRC events run at most a few days;
 * the generous buffer absorbs timezones and multi-day DCMPs). Without this
 * gate, a team registered for an event it never attended keeps that event in
 * `remainingEvents` forever, inflating its ceiling — conservative
 * mid-season, but nonsense once the event is over (e.g. finished-season FiM
 * showed "332 / 166 remaining" from no-show registrations).
 */
function eventStillAhead(event: DistrictEventMeta, computedAt: string): boolean {
  if (event.startDate == null) return true;
  const start = Date.parse(event.startDate);
  if (Number.isNaN(start)) return true;
  return start >= Date.parse(computedAt) - 7 * 24 * 60 * 60 * 1000;
}

interface EventRow {
  event_key: string;
  name: string | null;
  week: number | null;
  event_type: number;
  start_date: string | null;
}

/** Every event belonging to district `abbreviation` (the bare, non-year-prefixed key `events.district_key` stores) for `year` — the authoritative "this district's full event list" this task needs, since no separate district-events table exists. */
function selectDistrictEvents(db: Corpus, abbreviation: string, year: number): DistrictEventMeta[] {
  const rows = db
    .prepare(`SELECT event_key, name, week, event_type, start_date FROM events WHERE district_key = ? AND year = ? ORDER BY event_key ASC`)
    .all(abbreviation, year) as EventRow[];
  return rows.map((row) => ({ eventKey: row.event_key, name: row.name ?? row.event_key, week: row.week, eventType: row.event_type, startDate: row.start_date }));
}

interface TeamMetaRow {
  team_key: string;
  team_number: number;
  nickname: string | null;
}

/** `teamKey -> {teamNumber, nickname}` for a set of team keys — `nickname` may be `null` (a real, honest "TBA sent none" state, matching `teams.nickname`'s own nullability). */
function selectTeamMeta(db: Corpus, teamKeys: readonly string[]): Map<string, { teamNumber: number; nickname: string | null }> {
  const result = new Map<string, { teamNumber: number; nickname: string | null }>();
  if (teamKeys.length === 0) return result;
  const placeholders = teamKeys.map(() => "?").join(", ");
  const rows = db.prepare(`SELECT team_key, team_number, nickname FROM teams WHERE team_key IN (${placeholders})`).all(...teamKeys) as TeamMetaRow[];
  for (const row of rows) result.set(row.team_key, { teamNumber: row.team_number, nickname: row.nickname });
  return result;
}

// ---------------------------------------------------------------------------
// Pure composition — no I/O, fully unit-testable (scripts/publishDistricts.test.ts)
// ---------------------------------------------------------------------------

/**
 * The verdict a row carries between composition and the shared verdict pass.
 * NEVER PUBLISHED: `buildDistrictArtifact`'s only return path runs
 * `recomputeDistrictVerdicts`, which replaces both verdicts on every team.
 * Mirrors `districtRankingsMerge.ts`'s own module-private placeholder of the
 * same name and for the same reason — a schema-satisfying stand-in, not a
 * second verdict implementation.
 */
const PLACEHOLDER_VERDICT: DistrictArtifact["teams"][number]["districtLock"] = {
  status: "unknown",
  pointsToLock: null,
  threatCount: 0,
  cutLinePoints: null,
  allocationNote: null,
};

export interface ComposeDistrictArtifactOptions {
  readonly season: number;
  readonly generation: string;
  readonly computedAt: string;
  readonly district: CorpusDistrict;
  /** Ascending by `rank` — `selectDistrictRankings`'s own order. */
  readonly rankings: readonly CorpusDistrictRanking[];
  readonly events: readonly DistrictEventMeta[];
  /** `eventKey -> registered team keys`, scoped to `events` above (`selectEventTeamsForEvents`'s own shape). */
  readonly registrations: ReadonlyMap<string, readonly string[]>;
  /** `eventKey -> award recipients at that event`, scoped to `events` above (`selectEventAwardsForEvents`'s own shape). An event with no upserted awards (including every event, before the orchestrator's real awards ingest runs) is simply absent from this map — `buildDistrictArtifact` treats that identically to an empty array. */
  readonly awards: ReadonlyMap<string, readonly CorpusEventAward[]>;
  readonly teamMeta: ReadonlyMap<string, { teamNumber: number; nickname: string | null }>;
}

/**
 * Composes one district's full detail artifact: the Breakdown table's
 * per-event component readout, both remaining-events lists, both
 * `maxRemaining*` ceilings, every team's qualifying-awards list (revision
 * R2a), and both lock verdicts (`computeLocksWithQualifiers` run twice —
 * once against `dcmpSlots`, once against `cmpSlots`). Pure: takes
 * already-queried corpus rows, returns a `DistrictArtifactSchema`-validated
 * object, throws on any Zod violation rather than publishing a malformed
 * artifact.
 */
export function buildDistrictArtifact(options: ComposeDistrictArtifactOptions): DistrictArtifact {
  const { season, generation, computedAt, district, rankings, events, registrations, teamMeta } = options;

  const eventsByKey = new Map(events.map((e) => [e.eventKey, e]));

  const districtBase = maxEventPoints(season, "district");
  const dcmpBase = maxEventPoints(season, "dcmp");
  const districtEventMaxTotal = districtBase.qual + districtBase.alliance + districtBase.elim + districtBase.award;
  const dcmpEventMaxTotal = dcmpBase.qual + dcmpBase.alliance + dcmpBase.elim + dcmpBase.award;

  // teamKey -> the set of this district's own event keys that team is registered for.
  const registeredByTeam = new Map<string, Set<string>>();
  for (const [eventKey, teamKeys] of registrations) {
    if (!eventsByKey.has(eventKey)) continue; // scope strictly to this district's own events
    for (const teamKey of teamKeys) {
      if (!registeredByTeam.has(teamKey)) registeredByTeam.set(teamKey, new Set());
      registeredByTeam.get(teamKey)!.add(eventKey);
    }
  }

  // Award-based qualification. Walk every district event's award recipients
  // ONCE, building each team's display-ready `qualifyingAwards` list. The two
  // award-qualified team-key sets the lock math needs are NO LONGER derived
  // here: the shared verdict pass derives them from these very lists
  // (`awardQualifiedSets`), so there is one derivation with two callers rather
  // than two copies that can drift. An event whose `event_type` has no award
  // tier at all (a DCMP DIVISION, type 5) contributes nothing to the list, so
  // the shared pass never sees a division Winner in the first place.
  const teamQualifyingAwards = new Map<string, DistrictArtifact["teams"][number]["qualifyingAwards"]>();
  for (const event of events) {
    const tier = awardTierForEventType(event.eventType);
    if (tier === null) continue; // division/other events' awards never qualify anyone
    const eventAwards = options.awards.get(event.eventKey) ?? [];
    for (const awardRow of eventAwards) {
      if (!isQualificationRelevantAward(awardRow.awardType, tier)) continue;
      if (!teamQualifyingAwards.has(awardRow.teamKey)) teamQualifyingAwards.set(awardRow.teamKey, []);
      teamQualifyingAwards.get(awardRow.teamKey)!.push({
        eventKey: event.eventKey,
        awardType: awardRow.awardType,
        label: awardDisplayName(awardRow.awardType, season),
        awardOnly: isAwardOnly(awardRow.awardType, tier),
      });
    }
  }

  interface PerTeamComputed {
    ranking: CorpusDistrictRanking;
    eventPoints: DistrictArtifact["teams"][number]["eventPoints"];
    remainingEvents: DistrictArtifact["teams"][number]["remainingEvents"];
    maxRemainingDistrict: number;
    hasPlayedDcmp: boolean;
  }

  const perTeam: PerTeamComputed[] = rankings.map((ranking) => {
    const rawEventPoints = PromotedEventPointsEntry.array().parse(JSON.parse(ranking.eventPointsRaw));
    const eventPoints = rawEventPoints.map((ep) => {
      const meta = eventsByKey.get(ep.event_key);
      return {
        eventKey: ep.event_key,
        eventName: meta?.name ?? ep.event_key,
        week: meta?.week ?? null,
        tier: (ep.district_cmp ? "dcmp" : "district") as DistrictTier,
        qual: ep.qual_points,
        alliance: ep.alliance_points,
        elim: ep.elim_points,
        award: ep.award_points,
        total: ep.total,
      };
    });
    const playedEventKeys = new Set(eventPoints.map((ep) => ep.eventKey));
    const registeredEventKeys = registeredByTeam.get(ranking.teamKey) ?? new Set<string>();
    const remainingEvents = [...registeredEventKeys]
      .filter((eventKey) => !playedEventKeys.has(eventKey) && eventStillAhead(eventsByKey.get(eventKey)!, computedAt))
      .map((eventKey) => {
        const meta = eventsByKey.get(eventKey)!;
        const tier = districtTierForEventType(meta.eventType);
        return {
          eventKey,
          eventName: meta.name,
          week: meta.week,
          tier,
          maxPoints: tier === "dcmp" ? dcmpEventMaxTotal : districtEventMaxTotal,
        };
      });

    const maxRemainingDistrict = remainingEvents.filter((e) => e.tier === "district").reduce((sum, e) => sum + e.maxPoints, 0);
    const hasPlayedDcmp = eventPoints.some((ep) => ep.tier === "dcmp");

    return { ranking, eventPoints, remainingEvents, maxRemainingDistrict, hasPlayedDcmp };
  });

  // THE CALENDAR HALF of the hypothetical-DCMP ceiling, and the ONLY half this
  // file still owns. Once every dcmp-tier event has started, no one can earn
  // DCMP points anymore, no-show registrations included — and no dcmp event
  // listed at all (an early-season calendar gap) must read as "still ahead",
  // because denying the hypothetical ceiling would UNDERSTATE rivals' ceilings,
  // the one direction the lock math must never err in.
  //
  // The shared verdict pass has neither a corpus nor a calendar, so it reads
  // this answer back off the artifact's own rows (`dcmpStillAhead`). Seeding
  // every team's `maxRemainingChamp` with the calendar's answer here is what
  // hands it that fact; the pass then applies the has-played-a-DCMP gate and
  // the pass-1-eliminated gate itself, exactly as this function used to.
  const dcmpEvents = events.filter((e) => districtTierForEventType(e.eventType) === "dcmp");
  const dcmpStillAhead = dcmpEvents.length === 0 || dcmpEvents.some((e) => eventStillAhead(e, computedAt));

  const teams = perTeam.map((t) => {
    const info = teamMeta.get(t.ranking.teamKey);
    return {
      teamKey: t.ranking.teamKey,
      teamNumber: info?.teamNumber,
      nickname: info?.nickname ?? undefined,
      rank: t.ranking.rank,
      pointTotal: t.ranking.pointTotal,
      rookieBonus: t.ranking.rookieBonus,
      adjustments: t.ranking.adjustments,
      eventPoints: t.eventPoints,
      remainingEvents: t.remainingEvents,
      maxRemainingDistrict: t.maxRemainingDistrict,
      // The calendar's answer, seeded. Replaced by the shared pass below.
      maxRemainingChamp: t.maxRemainingDistrict + (dcmpStillAhead ? dcmpEventMaxTotal : 0),
      qualifyingAwards: teamQualifyingAwards.get(t.ranking.teamKey) ?? [],
      districtLock: PLACEHOLDER_VERDICT,
      champLock: PLACEHOLDER_VERDICT,
    };
  });

  const seeded = DistrictArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation,
    computedAt,
    districtKey: district.districtKey,
    year: district.year,
    abbreviation: district.abbreviation,
    displayName: district.displayName,
    dcmpSlots: district.dcmpSlots,
    cmpSlots: district.cmpSlots,
    teams,
    insights: {
      teamCount: rankings.length,
      // `eventCount` is the ONE insights field the shared pass carries forward
      // untouched — a district's event count has no corpus-free source, so this
      // file is its only producer.
      eventCount: events.length,
      dcmpCutLinePoints: null,
      cmpCutLinePoints: null,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
  });

  // ONE verdict pass, two callers: 10-05's Worker is the other. Both lock
  // verdicts, both cut lines, `maxRemainingChamp`, the `2025fsc` override and
  // all four insight counts come from `districtRankingsMerge.ts`'s
  // `recomputeDistrictVerdicts`. The two-pass `maxRemainingChamp` rule whose
  // pass two reads pass one's `districtLock.status` is precisely the part that
  // must not exist twice.
  // The tier fact only this file has: TBA's own `events.event_type` for every
  // one of this district's events, including one no team carries a row for.
  const tierByEvent = new Map<string, DistrictTier>(events.map((e) => [e.eventKey, districtTierForEventType(e.eventType)]));
  return recomputeDistrictVerdicts(seeded, { tierByEvent });
}

export interface DistrictsIndexInputRow {
  readonly district: CorpusDistrict;
  readonly teamCount: number;
  readonly eventCount: number;
}

/** Composes the `v1/districts/{year}.json` index from the already-built per-district summaries. */
export function buildDistrictsIndexArtifact(
  season: number,
  generation: string,
  computedAt: string,
  rows: readonly DistrictsIndexInputRow[]
): DistrictsIndexArtifact {
  return DistrictsIndexArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation,
    computedAt,
    year: season,
    districts: rows.map((row) => ({
      districtKey: row.district.districtKey,
      abbreviation: row.district.abbreviation,
      displayName: row.district.displayName,
      dcmpSlots: row.district.dcmpSlots,
      cmpSlots: row.district.cmpSlots,
      teamCount: row.teamCount,
      eventCount: row.eventCount,
    })),
  });
}

// ---------------------------------------------------------------------------
// I/O — corpus read, R2 write
// ---------------------------------------------------------------------------

/** One district's composed artifact together with the corpus rows the bake still needs. */
export interface ComposedDistrict {
  readonly key: string;
  readonly district: CorpusDistrict;
  readonly events: readonly DistrictEventMeta[];
  readonly registrations: ReadonlyMap<string, readonly string[]>;
  artifact: DistrictArtifact;
}

interface PublishedYear {
  readonly indexArtifact: DistrictsIndexArtifact;
  readonly indexKey: string;
  readonly detailArtifacts: ReadonlyArray<ComposedDistrict>;
}

/** Builds both artifact kinds for one season, reading everything from the corpus. Pure with respect to R2 — no `putObject` call happens here. */
export function composeYear(db: Corpus, season: number, generation: string, computedAt: string): PublishedYear {
  const districts = selectDistrictsForYear(db, season);
  const detailArtifacts: ComposedDistrict[] = [];
  const indexRows: DistrictsIndexInputRow[] = [];

  for (const district of districts) {
    const rankings = selectDistrictRankings(db, district.districtKey);
    const events = selectDistrictEvents(db, district.abbreviation, district.year);
    const registrations = selectEventTeamsForEvents(
      db,
      events.map((e) => e.eventKey)
    );
    // Award recipients for this district's own events (regular
    // and DCMP alike — selectEventAwardsForEvents is not tier-scoped, the
    // same shape selectEventTeamsForEvents already reads). Empty for every
    // event until the orchestrator's real awards ingest runs — a valid,
    // degenerate input, not an error (see this file's header note).
    const awards = selectEventAwardsForEvents(
      db,
      events.map((e) => e.eventKey)
    );
    const teamKeys = rankings.map((r) => r.teamKey);
    const teamMeta = selectTeamMeta(db, teamKeys);

    const composed = buildDistrictArtifact({ season, generation, computedAt, district, rankings, events, registrations, awards, teamMeta });

    // THE FOUR STATE FACTS, written through the SHARED writer rather than by a
    // second row walk inside `buildDistrictArtifact`. `applyDistrictEventState`
    // refuses an event key no team carries a row for, so the map is narrowed to
    // the keys this artifact actually holds — an event nobody in this district
    // registered for has no cell to grey out.
    const carriedEventKeys = new Set<string>();
    for (const team of composed.teams) {
      for (const row of team.eventPoints) carriedEventKeys.add(row.eventKey);
      for (const row of team.remainingEvents) carriedEventKeys.add(row.eventKey);
    }
    const eventState = new Map<string, DistrictEventState>();
    for (const [eventKey, observed] of deriveDistrictEventState(db, events, computedAt)) {
      if (carriedEventKeys.has(eventKey)) eventState.set(eventKey, observed);
    }
    const artifact =
      eventState.size === 0 ? composed : applyDistrictEventState({ artifact: composed, eventState, generation, computedAt });

    detailArtifacts.push({ key: districtDetailKey(district.districtKey), district, events, registrations, artifact });
    indexRows.push({ district, teamCount: rankings.length, eventCount: events.length });
  }

  const indexArtifact = buildDistrictsIndexArtifact(season, generation, computedAt, indexRows);
  return { indexArtifact, indexKey: districtsIndexKey(season), detailArtifacts };
}

// ---------------------------------------------------------------------------
// The bake: unstarted district events priced from walk-forward SPR state
// ---------------------------------------------------------------------------

export interface QualMatchCounts {
  /** Qualification matches with a decided winner. */
  readonly played: number;
  /** Qualification rows of any kind — played and merely scheduled together. */
  readonly total: number;
}

/**
 * Per-event qualification-match counts, DISTINCT on match key. Module-local raw
 * SQL against the `Corpus` instance, following `selectTeamMeta`'s own
 * local-helper style: a publish-only query earns no new
 * `packages/corpus/db.ts` accessor.
 */
function selectQualMatchCounts(db: Corpus, eventKeys: readonly string[]): Map<string, QualMatchCounts> {
  const counts = new Map<string, QualMatchCounts>();
  if (eventKeys.length === 0) return counts;
  const placeholders = eventKeys.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT event_key,
              COUNT(DISTINCT match_key) AS total,
              COUNT(DISTINCT CASE WHEN winner IS NOT NULL THEN match_key END) AS played
       FROM matches WHERE comp_level = 'qm' AND event_key IN (${placeholders})
       GROUP BY event_key`
    )
    .all(...eventKeys) as { event_key: string; total: number; played: number }[];
  for (const row of rows) counts.set(row.event_key, { played: row.played, total: row.total });
  return counts;
}

// ---------------------------------------------------------------------------
// The four state facts, derived from the corpus at the run's own instant —
// the OFFLINE half of the field `apps/worker/src/districtRefresh.ts` writes
// live. A grey cell on the ledger is a published fact, never an inference the
// browser made from an absence.
// ---------------------------------------------------------------------------

interface EventMatchFactsRow {
  event_key: string;
  qual_total: number;
  qual_played: number;
  finals_decided: number;
  open_elim: number;
}

/**
 * The four state facts per event, keyed the way `applyDistrictEventState`'s
 * `eventState` map is keyed — ONE block per EVENT, applied to every team's
 * matching row, so the Worker's live write and this offline write describe one
 * fact one way rather than two.
 *
 * Every count is DISTINCT on `match_key`. The counts sit in the same grouped
 * query as nothing else, but a count over join rows is exactly the shape that
 * silently doubles, and the alliance and award checks below are existence
 * queries against tables whose keys are positional — so distinct-keying is
 * stated once here and meant everywhere.
 *
 * `asOf` is a HORIZON, not decoration: an event whose start date is at or after
 * the instant had not begun, so it reports played zero, a null total and three
 * false booleans. With the instant at the run's own clock no district event in
 * the corpus is future-dated, so this branch never fires in production and the
 * facts are the corpus's own — which is what keeps the verification path and
 * the production path one code path.
 */
export function deriveDistrictEventState(
  db: Corpus,
  events: readonly DistrictEventMeta[],
  asOf: string
): ReadonlyMap<string, DistrictEventState> {
  const state = new Map<string, DistrictEventState>();
  if (events.length === 0) return state;
  const eventKeys = events.map((e) => e.eventKey);
  const placeholders = eventKeys.map(() => "?").join(", ");

  const matchRows = db
    .prepare(
      `SELECT event_key,
              COUNT(DISTINCT CASE WHEN comp_level = 'qm' THEN match_key END) AS qual_total,
              COUNT(DISTINCT CASE WHEN comp_level = 'qm' AND winner IS NOT NULL THEN match_key END) AS qual_played,
              COUNT(DISTINCT CASE WHEN comp_level = 'f' AND winner IS NOT NULL THEN match_key END) AS finals_decided,
              COUNT(DISTINCT CASE WHEN comp_level <> 'qm' AND winner IS NULL THEN match_key END) AS open_elim
       FROM matches WHERE event_key IN (${placeholders}) GROUP BY event_key`
    )
    .all(...eventKeys) as EventMatchFactsRow[];
  const matchFacts = new Map(matchRows.map((row) => [row.event_key, row] as const));

  const withAlliances = new Set(
    (db.prepare(`SELECT DISTINCT event_key FROM event_alliances WHERE event_key IN (${placeholders})`).all(...eventKeys) as { event_key: string }[]).map(
      (row) => row.event_key
    )
  );
  const withAwardsAll = new Set(
    (db.prepare(`SELECT DISTINCT event_key FROM event_awards_all WHERE event_key IN (${placeholders})`).all(...eventKeys) as { event_key: string }[]).map(
      (row) => row.event_key
    )
  );
  const withAwards = new Set(
    (db.prepare(`SELECT DISTINCT event_key FROM event_awards WHERE event_key IN (${placeholders})`).all(...eventKeys) as { event_key: string }[]).map(
      (row) => row.event_key
    )
  );
  // The POSITIVE-ONLY third clause. CONTEXT's correction forbids INFERRING
  // posted-ness from `award_points`, because a team at zero award points is
  // indistinguishable from awards not yet posted. This clause can therefore
  // only ever turn false into TRUE — it rescues an event whose award rows are
  // absent from a gitignored table, and it can never manufacture a premature
  // grey cell. `> 0`, never `IS NOT NULL`.
  const withNonZeroAwardPoints = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT json_extract(entry.value, '$.event_key') AS event_key
           FROM district_rankings dr, json_each(dr.event_points_raw) entry
           WHERE json_extract(entry.value, '$.award_points') > 0
             AND json_extract(entry.value, '$.event_key') IN (${placeholders})`
        )
        .all(...eventKeys) as { event_key: string }[]
    ).map((row) => row.event_key)
  );

  const instant = Date.parse(asOf);
  for (const event of events) {
    // A null start date reads as STARTED, matching `startedEventKeysAsOf`'s own
    // default and for the same reason: its rows are real observations.
    const start = event.startDate == null ? Number.NEGATIVE_INFINITY : Date.parse(event.startDate);
    const startedByNow = Number.isNaN(start) || Number.isNaN(instant) || start < instant;
    if (!startedByNow) {
      state.set(event.eventKey, { qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
      continue;
    }
    const facts = matchFacts.get(event.eventKey);
    const qualTotal = facts?.qual_total ?? 0;
    state.set(event.eventKey, {
      qualMatchesPlayed: facts?.qual_played ?? 0,
      // ZERO QUALIFICATION ROWS MEANS TBA HAS PUBLISHED NO SCHEDULE, and the
      // honest answer to "how long is it" is NULL. A zero there would claim a
      // zero-match event — measured 2026-09-25, six of the 150 2026 district
      // events carry zero `qm` rows (four divisioned DCMP parents, which are
      // playoff-only, plus `2026isde3` and `2026isde4`, registered and never
      // played), and every one of those is a real published state.
      qualMatchesTotal: qualTotal === 0 ? null : qualTotal,
      alliancesPicked: withAlliances.has(event.eventKey),
      // BOTH HALVES, because either alone is wrong: an open elimination row
      // beside a decided final is a playoff still running, and a decided final
      // is what tells a finished bracket from an event whose elimination rows
      // were never created at all.
      playoffsDone: (facts?.finals_decided ?? 0) > 0 && (facts?.open_elim ?? 0) === 0,
      awardsPosted: withAwardsAll.has(event.eventKey) || withAwards.has(event.eventKey) || withNonZeroAwardPoints.has(event.eventKey),
    });
  }
  return state;
}

// ---------------------------------------------------------------------------
// The per-team award profile — ONE derivation, shared by the bake (here) and by
// the published `awardProfile` field. Two derivations of one fact is how the
// published award cell and the published award pmf come to disagree.
// ---------------------------------------------------------------------------

export interface SeasonAwardProfiles {
  /** Team key -> the two keys `awardBaseRate` looks a rate up by. A team whose rookie year is unknown is ABSENT. */
  readonly profiles: ReadonlyMap<string, DistrictAwardProfile>;
  /** Teams left out because TBA reports no `rookie_year` for them — counted, never folded into `veteran`. */
  readonly unknownRookieYear: readonly string[];
  /** How many prior-season award instances the buckets were derived from. Zero means the award corpus is not ingested. */
  readonly priorInstanceCount: number;
}

/**
 * Every team's decoration bucket and rookie state for `season`, derived
 * WALK-FORWARD: only judged awards from seasons strictly before `season` count.
 *
 * The prior-count rule itself is 10-02's `priorJudgedAwardCount`, imported
 * rather than restated — it is DISTINCT on `(year, eventKey, awardType)`
 * because `event_awards_all`'s primary key is positional and a naive row count
 * triples a shared award. Instances are grouped by team first purely for speed;
 * that function filters by team key anyway, so the answer is identical.
 *
 * A team whose `rookie_year` is null gets NO PROFILE rather than being folded
 * into `veteran`. Folding an absence into a value is a guess, and 10-02's
 * `RookieState` carries `"unknown"` as its own state for exactly that reason.
 * Measured 2026-09-25: 2 of 6,433 `teams` rows carry a null `rookie_year` and
 * ZERO of the 16,337 `district_rankings` rows that join to a `teams` row do — so
 * this path exists for honesty and is not expected to fire, which is precisely
 * why it needs a test rather than an argument.
 */
export function buildSeasonAwardProfiles(db: Corpus, season: number, teamKeys: readonly string[]): SeasonAwardProfiles {
  const priorSeasons = selectCorpusSeasons(db).filter((s) => s < season);
  const instancesByTeam = new Map<string, AwardInstance[]>();
  let priorInstanceCount = 0;
  for (const priorSeason of priorSeasons) {
    for (const instance of loadAwardInstances(db, priorSeason)) {
      priorInstanceCount++;
      if (instance.teamKey === null) continue;
      const list = instancesByTeam.get(instance.teamKey);
      if (list === undefined) instancesByTeam.set(instance.teamKey, [instance]);
      else list.push(instance);
    }
  }

  const rookieYears = loadRookieYears(db);
  const profiles = new Map<string, DistrictAwardProfile>();
  const unknownRookieYear: string[] = [];
  for (const teamKey of new Set(teamKeys)) {
    const rookieState = rookieStateFor(rookieYears.get(teamKey), season);
    if (rookieState === "unknown") {
      unknownRookieYear.push(teamKey);
      continue;
    }
    const bucket = decorationBucket(priorJudgedAwardCount(instancesByTeam.get(teamKey) ?? [], teamKey, season));
    profiles.set(teamKey, { bucket, rookieState });
  }
  return { profiles, unknownRookieYear: unknownRookieYear.sort(), priorInstanceCount };
}

/** Why one district event was refused a bake, in the vocabulary the per-season census counts. */
export type BakeIneligibilityReason =
  | "not-a-remaining-event"
  | "divisioned-dcmp-parent"
  | "already-in-progress"
  | "roster-out-of-generator-range"
  | "empty-roster";

export interface BakeCandidate {
  readonly districtKey: string;
  readonly eventKey: string;
  readonly eventType: number;
  readonly week: number | null;
  readonly tier: DistrictTier;
  readonly roster: readonly string[];
  readonly matchesPerTeam: number;
}

/**
 * ELIGIBILITY, as one named predicate with one reason string per rejection.
 *
 * An event is baked when, AT THE RUN'S OWN INSTANT: at least one team still
 * carries it in `remainingEvents`; its TBA `event_type` is not 2; it has no
 * played qualification match; and its registered roster is inside the schedule
 * generator's size range.
 *
 * `event_type` 2 — the divisioned DCMP parent — is excluded because it has no
 * qualification schedule to generate at all (measured: 6 of 150 2026 district
 * events carry zero `qm` rows and four of them are exactly these parents) and
 * because its alliance count is not knowable before its divisions run
 * (measured: every 2026 district event with an alliance count other than eight
 * is one of them).
 *
 * "No played qualification match" is evaluated IN THE AS-OF VIEW: an event that
 * had not started at `startedEventKeys`' instant contributes no played row,
 * because at that instant it had played nothing. That is what makes the
 * verification path and the production path one code path — with the instant at
 * the run's own clock the as-of view is the corpus itself.
 */
export function classifyBakeCandidate(args: {
  readonly event: DistrictEventMeta;
  readonly remainingEventKeys: ReadonlySet<string>;
  readonly roster: readonly string[];
  readonly quals: QualMatchCounts | undefined;
  readonly startedEventKeys: ReadonlySet<string>;
}): BakeIneligibilityReason | null {
  if (!args.remainingEventKeys.has(args.event.eventKey)) return "not-a-remaining-event";
  if (args.event.eventType === 2) return "divisioned-dcmp-parent";
  const playedAsOf = args.startedEventKeys.has(args.event.eventKey) ? (args.quals?.played ?? 0) : 0;
  if (playedAsOf > 0) return "already-in-progress";
  if (args.roster.length === 0) return "empty-roster";
  if (args.roster.length < MIN_SCHEDULE_TEAMS || args.roster.length > MAX_SCHEDULE_TEAMS) return "roster-out-of-generator-range";
  return null;
}

/** One season's bake census — the denominators a publisher must be able to show. */
export interface BakeCensus {
  considered: number;
  baked: number;
  readonly ineligible: Map<BakeIneligibilityReason, number>;
  readonly skipped: Map<string, number>;
}

function emptyCensus(): BakeCensus {
  return { considered: 0, baked: 0, ineligible: new Map(), skipped: new Map() };
}

function bump<K>(counter: Map<K, number>, key: K): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

interface BakeSeasonResult {
  readonly sidecars: ReadonlyArray<{ key: string; artifact: DistrictPreSimArtifact }>;
  readonly bakedEventsByDistrict: ReadonlyMap<string, string[]>;
  readonly census: BakeCensus;
  readonly replayMs: number;
  readonly bakeMs: number;
  readonly matchesReplayed: number;
}

/**
 * Bakes every eligible event of one season, building the walk-forward pricing
 * state ONCE and LAZILY — only when the season actually has an eligible event.
 * A season with nothing to bake does no replay at all, which (measured
 * 2026-09-25, and true of every season in the corpus) is the production cost
 * today.
 *
 * `bakeLimit` caps how many events are baked; the tracer slice passes 1.
 */
function bakeSeason(
  db: Corpus,
  season: number,
  year: PublishedYear,
  computedAt: string,
  generation: string,
  options: CliOptions,
  bakeLimit: number
): BakeSeasonResult {
  const census = emptyCensus();
  const sidecars: Array<{ key: string; artifact: DistrictPreSimArtifact }> = [];
  const bakedEventsByDistrict = new Map<string, string[]>();

  const startedEventKeys = startedEventKeysAsOfSeason(db, season, computedAt);

  // Collect candidates across EVERY district first, so the decision to replay is
  // made once for the season rather than once per district.
  const candidates: BakeCandidate[] = [];
  for (const composed of year.detailArtifacts) {
    const eventKeys = composed.events.map((e) => e.eventKey);
    const quals = selectQualMatchCounts(db, eventKeys);
    const remainingEventKeys = new Set<string>();
    for (const team of composed.artifact.teams) for (const row of team.remainingEvents) remainingEventKeys.add(row.eventKey);

    for (const event of composed.events) {
      census.considered++;
      const roster = composed.registrations.get(event.eventKey) ?? [];
      const reason = classifyBakeCandidate({ event, remainingEventKeys, roster, quals: quals.get(event.eventKey), startedEventKeys });
      if (reason !== null) {
        bump(census.ineligible, reason);
        continue;
      }
      const eventQuals = quals.get(event.eventKey);
      candidates.push({
        districtKey: composed.district.districtKey,
        eventKey: event.eventKey,
        eventType: event.eventType,
        week: event.week,
        tier: districtTierForEventType(event.eventType),
        roster,
        // The real schedule's matches-per-team when TBA has published qualification
        // rows for this event, else Statbotics' 12 (10 for Championship Divisions) —
        // mirroring `buildPreScheduleSidecarForEvent`'s own branch.
        matchesPerTeam:
          eventQuals !== undefined && eventQuals.total > 0
            ? matchesPerTeamFor(roster.length, eventQuals.total)
            : defaultMatchesPerTeam(event.eventType),
      });
    }
  }

  if (candidates.length === 0) {
    console.log(`publishDistricts: season ${season} — 0 bake-eligible event(s), so NO walk-forward replay was run`);
    return { sidecars, bakedEventsByDistrict, census, replayMs: 0, bakeMs: 0, matchesReplayed: 0 };
  }

  const algorithm = resolveDistrictPricingAlgorithm();
  if (algorithm === null) {
    console.log(`publishDistricts: season ${season} — no Sigma-Score algorithm resolved, so no event can be priced; skipping the bake`);
    return { sidecars, bakedEventsByDistrict, census, replayMs: 0, bakeMs: 0, matchesReplayed: 0 };
  }

  // The award profiles, derived ONCE for every team on any candidate roster and
  // handed to the bake. `event_awards_all` is gitignored and a fresh checkout
  // has none, in which case every team's prior judged-award count is zero and
  // every team lands in the `none` bucket — a plausible-looking WRONG answer.
  // Refuse rather than publish it.
  const rosterTeamKeys = [...new Set(candidates.flatMap((candidate) => [...candidate.roster]))];
  const awardProfiles = options.awardProfilesFor?.(season, rosterTeamKeys) ?? buildSeasonAwardProfiles(db, season, rosterTeamKeys);
  if (awardProfiles.priorInstanceCount === 0) {
    console.log(
      `publishDistricts: season ${season} — the prior-season award corpus is EMPTY (event_awards_all holds no row before ${season}), so every team would land in the "none" bucket. Refusing to bake; run \`pnpm ingest:awards-all\` first (RESEARCH Assumption A5).`
    );
    bump(census.skipped, "empty-award-corpus");
    return { sidecars, bakedEventsByDistrict, census, replayMs: 0, bakeMs: 0, matchesReplayed: 0 };
  }
  const profilesByTeam = awardProfiles.profiles;
  if (awardProfiles.unknownRookieYear.length > 0) {
    console.log(
      `publishDistricts: season ${season} — ${awardProfiles.unknownRookieYear.length} roster team(s) carry no TBA rookie_year and therefore no award profile: ${awardProfiles.unknownRookieYear.join(", ")}`
    );
  }

  const warmupFrom = options.warmupFrom ?? DEFAULT_WARMUP_FROM_SEASON;
  const warmupSeasons: number[] = [];
  for (let s = warmupFrom; s < season; s++) warmupSeasons.push(s);

  const replayStart = performance.now();
  const pricing = buildDistrictPricingState(db, { season, warmupSeasons, asOf: computedAt, algorithm });
  const replayMs = performance.now() - replayStart;
  if (pricing === null) {
    console.log(`publishDistricts: season ${season} — the walk-forward replay produced no state, so no event can be priced; skipping the bake`);
    return { sidecars, bakedEventsByDistrict, census, replayMs, bakeMs: 0, matchesReplayed: 0 };
  }
  console.log(
    `publishDistricts: season ${season} — replayed ${pricing.matchesReplayed} match(es) across ${pricing.replayedSeasons.join("+")} (truncated ${pricing.matchesTruncated} at as-of ${computedAt}) in ${replayMs.toFixed(0)} ms`
  );

  // An event shared by two districts is baked ONCE and attached to both. Baking
  // it twice would publish two different pmfs for one event and no reader could
  // tell which was right.
  const bakedByEvent = new Map<string, DistrictPreSimArtifact>();
  const bakeStart = performance.now();
  for (const candidate of candidates) {
    if (census.baked >= bakeLimit) break;
    const already = bakedByEvent.get(candidate.eventKey);
    if (already !== undefined) {
      pushBakedEvent(bakedEventsByDistrict, candidate.districtKey, candidate.eventKey);
      sidecars.push({ key: districtPreSimKey({ districtKey: candidate.districtKey, eventKey: candidate.eventKey }), artifact: { ...already, districtKey: candidate.districtKey } });
      continue;
    }

    const label = `publishDistricts: bake skip ${candidate.eventKey} [${pricing.algorithmId}]`;
    const predict = pricing.predictFor(candidate.roster);
    if (predict === undefined) {
      console.log(`${label}: the all-or-nothing ranking-point filler rejected this roster`);
      bump(census.skipped, "no-ranking-point-filler");
      continue;
    }

    const outcome = bakeDistrictEvent({
      districtKey: candidate.districtKey,
      eventKey: candidate.eventKey,
      season,
      tier: candidate.tier,
      eventType: candidate.eventType,
      week: candidate.week,
      roster: candidate.roster,
      // Eight, with Fact 2 as the reason: every 2026 district event with an
      // alliance count other than eight is a divisioned DCMP parent, and those
      // are excluded by `classifyBakeCandidate` — the other half of the same
      // finding.
      allianceCount: 8,
      // The REGISTERED roster size. A started event's field size is
      // `event_rankings.total_teams`; those are two different facts (a team that
      // registered and never played appears in one and not the other), and
      // `DistrictLedgerEventInput.fieldSize`'s own doc comment names resolving
      // the discrepancy as the caller's decision. An unstarted event has no
      // rankings row at all, so the registered roster is the only honest answer.
      fieldSize: candidate.roster.length,
      ratings: pricing.ratingsFor(candidate.roster),
      awardProfiles: profilesByTeam,
      algorithmId: pricing.algorithmId,
      algorithmVersion: pricing.algorithmVersion,
      matchesPerTeam: candidate.matchesPerTeam,
      predict,
    });

    if (outcome.status === "skipped") {
      console.log(`${label}: ${outcome.detail}`);
      bump(census.skipped, outcome.reason);
      continue;
    }

    const artifact = DistrictPreSimArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation,
      computedAt,
      districtKey: candidate.districtKey,
      eventKey: candidate.eventKey,
      year: season,
      roster: outcome.roster,
      rows: outcome.rows.map((row) => ({ t: row.t, qual: row.qual, alliance: row.alliance, elim: row.elim, award: row.award, total: row.total })),
      algorithmId: pricing.algorithmId,
      algorithmVersion: pricing.algorithmVersion,
      pricedFrom: pricing.pricedFrom,
      draws: outcome.draws,
    });
    bakedByEvent.set(candidate.eventKey, artifact);
    sidecars.push({ key: districtPreSimKey({ districtKey: candidate.districtKey, eventKey: candidate.eventKey }), artifact });
    pushBakedEvent(bakedEventsByDistrict, candidate.districtKey, candidate.eventKey);
    census.baked++;
  }
  const bakeMs = performance.now() - bakeStart;

  return { sidecars, bakedEventsByDistrict, census, replayMs, bakeMs, matchesReplayed: pricing.matchesReplayed };
}

function pushBakedEvent(into: Map<string, string[]>, districtKey: string, eventKey: string): void {
  const list = into.get(districtKey);
  if (list === undefined) into.set(districtKey, [eventKey]);
  else if (!list.includes(eventKey)) list.push(eventKey);
}

/** `startedEventKeysAsOf` re-exported through one call site, so the publisher and the pricing state share one predicate. */
function startedEventKeysAsOfSeason(db: Corpus, season: number, asOf: string): ReadonlySet<string> {
  return startedEventKeysAsOf(db, season, asOf);
}

function reportCensus(season: number, census: BakeCensus): void {
  const ineligible = [...census.ineligible.entries()].map(([reason, n]) => `${reason}=${n}`).join(", ") || "none";
  const skipped = [...census.skipped.entries()].map(([reason, n]) => `${reason}=${n}`).join(", ") || "none";
  console.log(`publishDistricts: season ${season} bake census — considered ${census.considered}, baked ${census.baked}; ineligible: ${ineligible}; skipped: ${skipped}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliOptions {
  readonly years: number[];
  readonly bucket: string;
  readonly dryRun: boolean;
  /** The instant this run is computed at. Becomes `computedAt`, drives `eventStillAhead`, and truncates the walk-forward replay. */
  readonly asOf: string;
  /** When set, every composed object is written here as a file named from its R2 key with the separators flattened. */
  readonly localOut?: string;
  /** `false` under `--no-bake`. */
  readonly bake: boolean;
  /** First season replayed before the target season. Defaults to the production `--years` list's first term. */
  readonly warmupFrom?: number;
  /** Overrides the corpus-derived award profiles. A TEST SEAM only — production always derives them from the corpus through `buildSeasonAwardProfiles`. */
  readonly awardProfilesFor?: (season: number, roster: readonly string[]) => SeasonAwardProfiles;
  /** Caps how many events one season's bake will produce. Defaults to unbounded; the tracer slice passes 1. */
  readonly bakeLimit?: number;
  /** The byte ceilings the publish gate enforces. Defaults to the committed constants. */
  readonly ceilings?: DistrictBudgetCeilings;
}

export function parseOptions(argv: readonly string[]): CliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      years: { type: "string" },
      bucket: { type: "string" },
      "dry-run": { type: "boolean" },
      "as-of": { type: "string" },
      "local-out": { type: "string" },
      "no-bake": { type: "boolean" },
      "warmup-from": { type: "string" },
    },
  });

  const yearsSpec = values.years;
  if (yearsSpec === undefined) {
    throw new Error('publishDistricts: --years is required, e.g. --years "2019,2020,2022-2026"');
  }

  const now = Date.now();
  let asOf = new Date(now).toISOString();
  if (values["as-of"] !== undefined) {
    const parsed = Date.parse(values["as-of"]);
    if (Number.isNaN(parsed)) {
      throw new Error(`publishDistricts: --as-of "${values["as-of"]}" is not a parseable ISO date or date-time`);
    }
    if (parsed > now) {
      // An as-of instant AHEAD of the run's own clock would ask the replay for
      // matches that do not exist and then bake from a state that is simply
      // current, while stamping a provenance that is a lie.
      throw new Error(
        `publishDistricts: --as-of "${values["as-of"]}" is later than the run's own clock (${new Date(now).toISOString()}) — refusing to stamp a future instant on a state that is merely current`
      );
    }
    asOf = new Date(parsed).toISOString();
  }

  let warmupFrom: number | undefined;
  if (values["warmup-from"] !== undefined) {
    warmupFrom = Number(values["warmup-from"]);
    if (!Number.isInteger(warmupFrom)) throw new Error(`publishDistricts: --warmup-from "${values["warmup-from"]}" is not an integer season`);
  }

  return {
    years: parseYearsSpec(yearsSpec),
    bucket: values.bucket ?? DEFAULT_BUCKET,
    dryRun: values["dry-run"] === true,
    asOf,
    ...(values["local-out"] !== undefined ? { localOut: values["local-out"] } : {}),
    bake: values["no-bake"] !== true,
    ...(warmupFrom !== undefined ? { warmupFrom } : {}),
  };
}

/** `--years` accepts a single year, a range (`"2022-2026"`), or a comma-separated list of these — `packages/harness/seasonSpec.ts`'s shared grammar, the same one `publish.ts`'s `--seasons` uses. */
export function parseYearsSpec(spec: string): number[] {
  return parseSeasonSpec(spec, "--years");
}

/** An R2 key as a flat filename: `v1/district/2026fnc.json` becomes `v1__district__2026fnc.json`. */
export function localOutFileName(key: string): string {
  return key.replace(/\//g, "__");
}

/**
 * Measures, GATES and only then records one composed object.
 *
 * The gate runs BEFORE the object is written locally or uploaded, in
 * `--dry-run` and real runs alike — `assertWithinPageBudget`'s own stated
 * placement. A gate that fires after the file is written is a log line, not a
 * gate.
 *
 * Bytes are `Buffer.byteLength`, never `String.length`. Measured 2026-09-25: 30
 * of the 3,155 teams that appear in `district_rankings` carry a non-ASCII
 * nickname (`frc88`'s is 3 UTF-16 code units and 4 UTF-8 bytes), so a code-unit
 * count understates every district object — and a gate that understates is not
 * a gate.
 */
function gateAndRecord(args: {
  readonly key: string;
  readonly body: string;
  readonly ceiling: number;
  readonly perTeamCeiling?: number;
  readonly teamCount?: number;
  readonly localOut?: string;
}): number {
  const bytes = Buffer.byteLength(args.body);
  assertWithinDistrictBudget(args.key, bytes, args.ceiling);
  if (args.perTeamCeiling !== undefined && args.teamCount !== undefined && args.teamCount > 0) {
    assertWithinDistrictBudget(`${args.key} (per team, ${args.teamCount} teams)`, Math.ceil(bytes / args.teamCount), args.perTeamCeiling);
  }
  if (args.localOut !== undefined) {
    mkdirSync(args.localOut, { recursive: true });
    writeFileSync(join(args.localOut, localOutFileName(args.key)), args.body, "utf8");
  }
  return bytes;
}

export async function run(options: CliOptions): Promise<void> {
  const db = openCorpusReadOnly(CORPUS_PATH);
  const generation = new Date().toISOString();
  // `--as-of` IS `computedAt`. One instant decides which events are still ahead
  // (`eventStillAhead`), which matches enter the walk-forward replay
  // (`startedEventKeysAsOf`) and which events are bake-eligible — so a past
  // event provably cannot be priced from a state that saw its own results.
  const computedAt = options.asOf;
  const ceilings = options.ceilings ?? COMMITTED_DISTRICT_CEILINGS;

  try {
    if (!options.bake) {
      console.log(
        "publishDistricts: --no-bake — NO walk-forward replay and NO baked pmfs. Every artifact this run composes will carry no baked-event list, so the ledger paints an unstarted event as unavailable until the next full publish."
      );
    }
    for (const season of options.years) {
      const year = composeYear(db, season, generation, computedAt);

      const bakeResult = options.bake
        ? bakeSeason(db, season, year, computedAt, generation, options, options.bakeLimit ?? Number.POSITIVE_INFINITY)
        : undefined;
      if (bakeResult !== undefined) reportCensus(season, bakeResult.census);

      let totalBytes = 0;
      for (const composed of year.detailArtifacts) {
        const bakedEvents = bakeResult?.bakedEventsByDistrict.get(composed.district.districtKey);
        const artifact =
          bakedEvents === undefined || bakedEvents.length === 0
            ? composed.artifact
            : DistrictArtifactSchema.parse({ ...composed.artifact, bakedEvents: [...bakedEvents].sort() });
        const body = JSON.stringify(artifact);
        const bytes = gateAndRecord({
          key: composed.key,
          body,
          ceiling: ceilings.detailAbsolute,
          perTeamCeiling: ceilings.detailPerTeam,
          teamCount: artifact.teams.length,
          ...(options.localOut !== undefined ? { localOut: options.localOut } : {}),
        });
        totalBytes += bytes;
        const perTeam = artifact.teams.length > 0 ? Math.ceil(bytes / artifact.teams.length) : 0;
        console.log(`publishDistricts: composed "${composed.key}" (${bytes} bytes, ${perTeam} per team across ${artifact.teams.length} teams)`);
        if (!options.dryRun) {
          await putObject(options.bucket, composed.key, body, { contentType: "application/json", cacheControl: "public, max-age=60" });
          console.log(`publishDistricts: published "${composed.key}" to bucket "${options.bucket}"`);
        }
      }

      // Sidecars before the index, for the same artifacts-before-index reason:
      // `bakedEvents` must never name a sidecar that is not there yet.
      let largestSidecar = { key: "", bytes: 0 };
      for (const sidecar of bakeResult?.sidecars ?? []) {
        const body = JSON.stringify(sidecar.artifact);
        const bytes = gateAndRecord({
          key: sidecar.key,
          body,
          ceiling: ceilings.presim,
          ...(options.localOut !== undefined ? { localOut: options.localOut } : {}),
        });
        totalBytes += bytes;
        if (bytes > largestSidecar.bytes) largestSidecar = { key: sidecar.key, bytes };
        console.log(`publishDistricts: composed "${sidecar.key}" (${bytes} bytes)`);
        if (!options.dryRun) {
          await putObject(options.bucket, sidecar.key, body, { contentType: "application/json", cacheControl: "public, max-age=60" });
          console.log(`publishDistricts: published "${sidecar.key}" to bucket "${options.bucket}"`);
        }
      }

      // Artifacts-before-index: every v1/district/{key}.json above is
      // written (or, in --dry-run, composed) before the index below is
      // overwritten, so the index never points at a detail object that is
      // not there yet.
      const indexBody = JSON.stringify(year.indexArtifact);
      const indexBytes = Buffer.byteLength(indexBody);
      totalBytes += indexBytes;
      if (options.localOut !== undefined) {
        mkdirSync(options.localOut, { recursive: true });
        writeFileSync(join(options.localOut, localOutFileName(year.indexKey)), indexBody, "utf8");
      }
      console.log(`publishDistricts: composed "${year.indexKey}" (${indexBytes} bytes)`);
      if (!options.dryRun) {
        await putObject(options.bucket, year.indexKey, indexBody, { contentType: "application/json", cacheControl: "public, max-age=60" });
        console.log(`publishDistricts: published "${year.indexKey}" to bucket "${options.bucket}"`);
      }

      const sidecarCount = bakeResult?.sidecars.length ?? 0;
      console.log(
        `publishDistricts: season ${season} — ${year.detailArtifacts.length} district(s), ${sidecarCount} sidecar(s)` +
          (sidecarCount > 0 ? ` (largest ${largestSidecar.key} at ${largestSidecar.bytes} bytes)` : "") +
          `, ${totalBytes} total bytes` +
          (bakeResult !== undefined
            ? `, replay ${bakeResult.replayMs.toFixed(0)} ms, bake ${bakeResult.bakeMs.toFixed(0)} ms`
            : "")
      );
    }

    if (options.dryRun) {
      console.log("publishDistricts: --dry-run — nothing published.");
    }
    if (options.localOut !== undefined) {
      console.log(`publishDistricts: --local-out — every composed object written to "${options.localOut}".`);
    }
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  await run(options);
}

// Guard: only auto-run `main()` when this file is the process entry point.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("publishDistricts failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
