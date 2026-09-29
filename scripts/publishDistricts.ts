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
 * decides which events are still ahead, which events are bake candidates, and
 * which matches enter the replay, so an event can never be priced from a state
 * that saw its own results. Both as-of cuts are keyed on each match's own
 * timestamp: the replay keeps only played matches stamped before the instant,
 * and candidacy counts a team's district points at an event as already earned
 * only if that event was underway by then. With `--as-of` absent the instant is
 * the run's own clock, nothing in the corpus is stamped after it, and both cuts
 * are identities, so the verification path and the production path are one
 * code path. `--no-bake` skips the replay entirely and says so. The bake
 * prices with the production SPR 9.0.0 model, the Sigma carry
 * (`packages/harness/sigmaCarry.ts`) and the RP cold-team prior
 * (`.planning/quick/260928-n6i-fix-the-early-season-rp-bonus-cold-start/260928-n6i-PREREG.md`)
 * both on. `--no-sigma-carry` and `--no-rp-cold-prior` (each refused without
 * `--dry-run`, combinable) rebuild the pre-9.0.0 model for verification only,
 * so a bake priced that way can never reach R2.
 *
 * WHAT AN AS-OF RUN STILL READS SEASON-FINAL, named rather than hidden: each
 * candidate's registered roster (`event_teams`), its qualification-schedule
 * length (the `qm` row count that sets matches per team), and the composed
 * district artifact itself (points, ranks, remaining events). The corpus holds
 * no timestamp for a registration or a schedule row, so neither can be cut
 * without changing what a production run publishes. The artifact is the
 * published surface and keeps its season-final rows; only the bake's
 * candidacy reads the as-of view.
 *
 * The roster leak is bounded, not closed. For a DCMP it would be the worst
 * case, because a DCMP roster is DECIDED by the district's results: so an
 * as-of run refuses every DCMP-tier event (`event_type` 2 or 5) as
 * `dcmp-field-not-final-as-of` until every regular event of its district has
 * finished before the instant, after which the roster is information the
 * instant already had. A REGULAR event's roster and schedule length stay
 * season-final: a team that registered or dropped after the instant, and a
 * schedule published after it, still reach an as-of bake. Closing that needs a
 * roster and schedule history the corpus does not keep. Production is not
 * affected: at the run's own clock the season-final roster IS the current one.
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
import { DISTRICT_REGISTERED_SEASONS, maxEventPoints, type DistrictTier } from "../packages/core/districts/pointModel.js";
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
  type DistrictAwardBucket,
  type DistrictEventState,
  type DistrictPreSimArtifact,
  type DistrictsIndexArtifact,
} from "../packages/harness/pageArtifacts.js";
import {
  assertWithinDistrictBudget,
  DISTRICT_DETAIL_MAX_BYTES,
  DISTRICT_DETAIL_MAX_BYTES_PER_TEAM,
  DISTRICT_PRESIM_MAX_BYTES,
  DISTRICTS_INDEX_MAX_BYTES,
} from "../packages/harness/publishBudget.js";
import { putObject } from "../packages/harness/r2Client.js";
import { roundPmf } from "../packages/harness/rounding.js";
import { parseSeasonSpec } from "../packages/harness/seasonSpec.js";
import {
  buildDistrictPricingState,
  finishedEventKeysAsOf,
  resolveDistrictPricingAlgorithm,
  underwayEventKeysAsOf,
} from "./districtPricingState.js";
import {
  awardBaseRate,
  AWARD_POINT_SUPPORT,
  DECORATION_BUCKETS,
  decorationBucket,
  DISTRICT_AWARD_BASE_RATE_SEASONS,
  rookieStateFor,
  type AwardBaseRateSource,
  type DecorationBucket,
} from "../packages/core/districts/awardBaseRates.js";
import {
  awardOrderingTables,
  awardResidualRate,
  AWARD_ORDERING_SEASONS,
  hasAwardOrderingTables,
  MAX_IMPACT_POSITION,
  MAX_ROOKIE_ALL_STAR_POSITION,
  impactOrderingProbability,
  rookieAllStarOrderingProbability,
} from "../packages/core/districts/awardOrderingTables.js";
import type { DistrictAwardProfile } from "../packages/core/districts/ledgerSimulation.js";
import { MEASURED_COMMAND as ORDERING_MEASURED_COMMAND, priorImpactWinCount } from "./measureAwardOrderingTables.js";
import { loadAwardInstances, loadRookieYears, MEASURED_COMMAND, priorJudgedAwardCount, type AwardInstance } from "./measureDistrictAwardBaseRates.js";
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
  /** `v1/districts/{year}.json`. Every composed object kind has a ceiling; a gate covering two of three is a gate with a hole in it. */
  readonly indexAbsolute: number;
}

export const COMMITTED_DISTRICT_CEILINGS: DistrictBudgetCeilings = {
  detailPerTeam: DISTRICT_DETAIL_MAX_BYTES_PER_TEAM,
  detailAbsolute: DISTRICT_DETAIL_MAX_BYTES,
  presim: DISTRICT_PRESIM_MAX_BYTES,
  indexAbsolute: DISTRICTS_INDEX_MAX_BYTES,
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

/**
 * `teamKey -> the set of the district's own event keys that team registered
 * for`. Registrations for an event outside `eventsByKey` are dropped, so a
 * team's list is scoped strictly to this district's events.
 */
function registeredEventKeysByTeam(
  registrations: ReadonlyMap<string, readonly string[]>,
  eventsByKey: ReadonlyMap<string, DistrictEventMeta>
): Map<string, Set<string>> {
  const registeredByTeam = new Map<string, Set<string>>();
  for (const [eventKey, teamKeys] of registrations) {
    if (!eventsByKey.has(eventKey)) continue; // scope strictly to this district's own events
    for (const teamKey of teamKeys) {
      if (!registeredByTeam.has(teamKey)) registeredByTeam.set(teamKey, new Set());
      registeredByTeam.get(teamKey)!.add(eventKey);
    }
  }
  return registeredByTeam;
}

/**
 * THE ONE REMAINING-EVENTS RULE: a registered event the team has not played
 * that is still ahead at `computedAt`. Two callers hand it two views of
 * "played": the published artifact passes the season-final event points, and
 * the bake's candidacy (`remainingEventKeysAsOf`) passes those same points cut
 * to the events underway at its instant. One rule, so the two cannot drift.
 */
function remainingRegisteredEventKeys(
  registered: ReadonlySet<string>,
  played: ReadonlySet<string>,
  eventsByKey: ReadonlyMap<string, DistrictEventMeta>,
  computedAt: string
): string[] {
  return [...registered].filter((eventKey) => !played.has(eventKey) && eventStillAhead(eventsByKey.get(eventKey)!, computedAt));
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
  /** The season's six-cell award base-rate table, once per artifact. Absent for an unregistered season or an empty prior award corpus. */
  readonly awardBaseRates?: DistrictArtifact["awardBaseRates"];
  /** The season's ordering tables and the residual they are layered on, once per artifact. Absent for a season with no measured table. */
  readonly awardOrderingTables?: DistrictArtifact["awardOrderingTables"];
  /** Team key -> the SAME profile object the bake was handed, mapped to the wire vocabulary at emission. A team absent here publishes no `awardProfile`. */
  readonly awardProfiles?: ReadonlyMap<string, DistrictAwardProfile>;
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
  const registeredByTeam = registeredEventKeysByTeam(registrations, eventsByKey);

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
    const remainingEvents = remainingRegisteredEventKeys(registeredEventKeys, playedEventKeys, eventsByKey, computedAt)
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
    const awardProfile = options.awardProfiles?.get(t.ranking.teamKey);
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
      // The SAME object the bake's award-profile map carried for this team,
      // mapped to the wire vocabulary at this one boundary. Two derivations of
      // one fact is how a published award cell and a published award pmf come
      // to disagree.
      ...(awardProfile === undefined ? {} : { awardProfile: toWireAwardProfile(awardProfile) }),
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
    ...(options.awardBaseRates === undefined ? {} : { awardBaseRates: options.awardBaseRates }),
    ...(options.awardOrderingTables === undefined ? {} : { awardOrderingTables: options.awardOrderingTables }),
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
  /** The season's award context, built ONCE here and handed to the bake, so the published profile and the baked pmf rest on one derivation. */
  readonly awardContext: SeasonAwardContext;
}

/** Builds both artifact kinds for one season, reading everything from the corpus. Pure with respect to R2 — no `putObject` call happens here. */
export function composeYear(db: Corpus, season: number, generation: string, computedAt: string): PublishedYear {
  const districts = selectDistrictsForYear(db, season);
  const detailArtifacts: ComposedDistrict[] = [];
  const indexRows: DistrictsIndexInputRow[] = [];
  // ONE award context per season: one prior-instance index, one table, one
  // per-team derivation, shared by every district AND by the bake.
  const awardContext = buildSeasonAwardContext(db, season);
  let profiled = 0;
  let unprofiled = 0;

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

    const awardProfiles = awardContext.profilesFor(teamKeys);
    profiled += awardProfiles.profiles.size;
    unprofiled += awardProfiles.unknownRookieYear.length;
    const composed = buildDistrictArtifact({
      season,
      generation,
      computedAt,
      district,
      rankings,
      events,
      registrations,
      awards,
      teamMeta,
      ...(awardContext.baseRates === undefined ? {} : { awardBaseRates: awardContext.baseRates }),
      ...(awardContext.orderingTables === undefined ? {} : { awardOrderingTables: awardContext.orderingTables }),
      awardProfiles: awardProfiles.profiles,
    });

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
      eventState.size === 0
        ? composed
        : applyDistrictEventState({
            artifact: composed,
            eventState,
            generation,
            computedAt,
            // The verdicts are recomputed inside with the state attached, so a
            // finished event never reads as a pending Impact award (2026-09-26).
            tierByEvent: new Map<string, DistrictTier>(events.map((e) => [e.eventKey, districtTierForEventType(e.eventType)])),
          });

    detailArtifacts.push({ key: districtDetailKey(district.districtKey), district, events, registrations, artifact });
    indexRows.push({ district, teamCount: rankings.length, eventCount: events.length });
  }

  if (awardContext.baseRates !== undefined) {
    // 10-08 quotes these numbers on the methodology page, and a number living
    // only in a transcript traces to nothing.
    console.log(
      `publishDistricts: season ${season} award profiles — ${profiled} team(s) profiled, ${unprofiled} without one (no TBA rookie_year); source rungs: ${[...awardContext.sources.entries()].map(([cell, rung]) => `${cell}=${rung}`).join(", ")}`
    );
  }

  const indexArtifact = buildDistrictsIndexArtifact(season, generation, computedAt, indexRows);
  return { indexArtifact, indexKey: districtsIndexKey(season), detailArtifacts, awardContext };
}

// ---------------------------------------------------------------------------
// The bake: unstarted district events priced from walk-forward SPR state
// ---------------------------------------------------------------------------

export interface QualMatchCounts {
  /** Qualification matches with a decided winner, stamped strictly before the as-of instant — the AS-OF played count. */
  readonly played: number;
  /** Qualification rows of any kind — played and merely scheduled together. Season-final: the corpus holds no timestamp for when a schedule was published. */
  readonly total: number;
}

/**
 * Per-event qualification-match counts, DISTINCT on match key. Module-local raw
 * SQL against the `Corpus` instance, following `selectTeamMeta`'s own
 * local-helper style: a publish-only query earns no new
 * `packages/corpus/db.ts` accessor.
 *
 * `played` is cut at `asOf` by each match's own `sort_time`, the same clock the
 * replay's cut reads (`playedMatchKeysAtOrAfter`), so "had this event played a
 * qualification match at the instant" and "which matches the pricing state
 * saw" are one fact. It used to be the season-final count, gated only by the
 * event's start date, so an event that had started but not yet played at the
 * instant read as already in progress on the strength of matches played later.
 * At the run's own clock the two counts agree, because no played match is
 * stamped after it.
 */
export function selectQualMatchCounts(db: Corpus, eventKeys: readonly string[], asOf: string): Map<string, QualMatchCounts> {
  const counts = new Map<string, QualMatchCounts>();
  if (eventKeys.length === 0) return counts;
  const instant = Date.parse(asOf);
  if (Number.isNaN(instant)) throw new Error(`publishDistricts: as-of instant "${asOf}" is not a parseable date`);
  const placeholders = eventKeys.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT event_key,
              COUNT(DISTINCT match_key) AS total,
              COUNT(DISTINCT CASE WHEN winner IS NOT NULL AND sort_time < ? THEN match_key END) AS played
       FROM matches WHERE comp_level = 'qm' AND event_key IN (${placeholders})
       GROUP BY event_key`
    )
    .all(instant, ...eventKeys) as { event_key: string; total: number; played: number }[];
  for (const row of rows) counts.set(row.event_key, { played: row.played, total: row.total });
  return counts;
}

/**
 * THE AS-OF REMAINING SET the bake chooses its candidates from: every event at
 * least one ranked team still had ahead of it AT `computedAt`.
 *
 * It is `buildDistrictArtifact`'s own remaining-events rule
 * (`remainingRegisteredEventKeys`) with one input changed. A team's district
 * points are season-final, so a points row at an event says the team played
 * there at SOME point in the season, not that it had by the instant. Only the
 * rows whose event was underway at the instant (`underwayEventKeys`, from
 * `underwayEventKeysAsOf`) count as played here.
 *
 * Measured 2026-09-28, the season-final version this replaced marked 119 of 150
 * 2026 events "not a remaining event" at an as-of of 2026-03-01, although 135
 * non-parent events had not started. The only candidates it left were events
 * where some registered team never earned points (a no-show), so an early
 * as-of dry run exercised the bake on 23 unrepresentative events.
 *
 * At the run's own clock every event carrying points is underway, so this set
 * equals the union of the published artifact's `remainingEvents` lists — the
 * production answer is unchanged.
 */
export function remainingEventKeysAsOf(args: {
  readonly events: readonly DistrictEventMeta[];
  readonly registrations: ReadonlyMap<string, readonly string[]>;
  /** The district's ranked teams, each with its season-final district-points rows. */
  readonly teams: ReadonlyArray<{ readonly teamKey: string; readonly eventPoints: ReadonlyArray<{ readonly eventKey: string }> }>;
  readonly underwayEventKeys: ReadonlySet<string>;
  readonly computedAt: string;
}): ReadonlySet<string> {
  const eventsByKey = new Map(args.events.map((e) => [e.eventKey, e] as const));
  const registeredByTeam = registeredEventKeysByTeam(args.registrations, eventsByKey);
  const remaining = new Set<string>();
  for (const team of args.teams) {
    const registered = registeredByTeam.get(team.teamKey);
    if (registered === undefined) continue;
    const playedAsOf = new Set(team.eventPoints.map((row) => row.eventKey).filter((eventKey) => args.underwayEventKeys.has(eventKey)));
    for (const eventKey of remainingRegisteredEventKeys(registered, playedAsOf, eventsByKey, args.computedAt)) remaining.add(eventKey);
  }
  return remaining;
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
  return buildSeasonAwardContext(db, season).profilesFor(teamKeys);
}

/**
 * THE ONE PLACE 10-02's MODULE VOCABULARY MEETS 10-03's WIRE VOCABULARY.
 *
 * The two spellings genuinely differ and that is deliberate: the module's is a
 * measurement-side identifier on a pinned, measured table, and the wire's is a
 * published field a browser reads. Mapping once here is cheaper than a rename
 * that touches the measured table. A `Record` keyed by 10-02's OWN exported
 * literals rather than a `switch` or a string transform, so adding a bucket on
 * either side is a TYPE ERROR here rather than a silent miss anywhere.
 */
const WIRE_BUCKET: Readonly<Record<DecorationBucket, DistrictAwardBucket>> = {
  none: "none",
  "one-or-two": "oneOrTwo",
  "three-or-more": "threeOrMore",
};

/** The dense point axis `DistrictPointPmfSchema` speaks, spanning 10-02's six-bin award support. */
const AWARD_POINT_AXIS_LENGTH = AWARD_POINT_SUPPORT[AWARD_POINT_SUPPORT.length - 1]! + 1;

/**
 * 10-02's six-BIN award pmf onto 10-03's dense POINT axis.
 *
 * The two are not the same shape and must not be confused: the module's array
 * is indexed by a position in `AWARD_POINT_SUPPORT` (`[0, 5, 8, 10, 13, 15]`),
 * while the wire's `p[i]` is the probability of exactly `o + i` POINTS. `o`
 * stays 0 — the schema refines on it, so the chance of NO award points is
 * addressable at index 0 — and trailing exact zeros are trimmed, which the
 * offset refinement permits and which costs a reader nothing.
 */
function awardPmfOnPointAxis(binned: readonly number[]): { o: number; p: number[] } {
  const dense = new Array<number>(AWARD_POINT_AXIS_LENGTH).fill(0);
  for (let bin = 0; bin < AWARD_POINT_SUPPORT.length; bin++) {
    dense[AWARD_POINT_SUPPORT[bin]!] = (dense[AWARD_POINT_SUPPORT[bin]!] ?? 0) + (binned[bin] ?? 0);
  }
  const rounded = roundPmf(dense);
  let last = rounded.length - 1;
  while (last > 0 && rounded[last] === 0) last--;
  return { o: 0, p: rounded.slice(0, last + 1) };
}

/**
 * The last season whose observations could have fed `season`'s table.
 *
 * NOT `season - 1`. 2021 has no district season at all — the corpus carries
 * 2016-2020 and 2022-2026 — so a naive minus-one would publish a
 * `measuredThroughSeason` naming a season that contributed nothing. The answer
 * is the greatest REGISTERED district season strictly below the published one.
 */
export function measuredThroughSeasonFor(season: number): number | undefined {
  const prior = DISTRICT_REGISTERED_SEASONS.filter((s) => s < season);
  return prior.length === 0 ? undefined : prior[prior.length - 1];
}

/** Everything one season's award publication needs, derived ONCE and shared by the wire and the bake. */
export interface SeasonAwardContext {
  readonly season: number;
  /** How many prior-season award instances the buckets rest on. Zero means `event_awards_all` is not ingested for any prior season. */
  readonly priorInstanceCount: number;
  /** The six-cell published table, or `undefined` for an unregistered season or an empty prior corpus. */
  readonly baseRates: DistrictArtifact["awardBaseRates"];
  /** The published ordering tables, or `undefined` whenever `baseRates` is — the two travel together or not at all. */
  readonly orderingTables: DistrictArtifact["awardOrderingTables"];
  /** Which fallback rung each published cell landed on, keyed `${wireBucket}|${rookie}`. */
  readonly sources: ReadonlyMap<string, AwardBaseRateSource>;
  /** Derives (and memoizes) the profiles for a set of team keys. */
  profilesFor(teamKeys: readonly string[]): SeasonAwardProfiles;
}

/**
 * Builds one season's award context: the six-cell table and the per-team
 * profile derivation, from ONE prior-instance index.
 *
 * THE UNREGISTERED SEASON IS PRE-CHECKED, NEVER CAUGHT. `awardBaseRate` throws
 * `UnknownAwardBaseRateSeasonError` for a season with no table; control flow
 * through a typed error is not control flow, so the season is tested against
 * `DISTRICT_AWARD_BASE_RATE_SEASONS` first and the lookup is simply not called.
 *
 * THE EMPTY-PRIOR GUARD. `event_awards_all` is gitignored and a fresh checkout
 * has none (RESEARCH Assumption A5). With no prior award rows every team's
 * prior judged-award count is zero and every team lands in the `none` bucket —
 * a plausible-looking WRONG answer. The context then publishes NO table and NO
 * profile, and the bake skips the season for the same reason.
 */
export function buildSeasonAwardContext(db: Corpus, season: number): SeasonAwardContext {
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
  const memo = new Map<string, DistrictAwardProfile>();

  const registered = DISTRICT_AWARD_BASE_RATE_SEASONS.includes(season);
  const measuredThroughSeason = measuredThroughSeasonFor(season);
  const sources = new Map<string, AwardBaseRateSource>();
  let baseRates: DistrictArtifact["awardBaseRates"];
  if (!registered) {
    console.log(
      `publishDistricts: season ${season} has no registered district award base-rate table (registered: ${DISTRICT_AWARD_BASE_RATE_SEASONS.join(", ")}) — publishing no award block and no team award profile`
    );
  } else if (priorInstanceCount === 0) {
    console.log(
      `publishDistricts: season ${season} — the prior-season award corpus is EMPTY, so every team would land in the "none" bucket. Publishing no award block and no team award profile; run \`pnpm ingest:awards-all\` first (RESEARCH Assumption A5).`
    );
  } else if (measuredThroughSeason === undefined) {
    console.log(`publishDistricts: season ${season} has no registered district season before it — publishing no award block`);
  } else {
    const rows: NonNullable<DistrictArtifact["awardBaseRates"]>["rows"] = [];
    const cells: string[] = [];
    for (const bucket of DECORATION_BUCKETS) {
      for (const rookieState of ["rookie", "veteran"] as const) {
        const rate = awardBaseRate(season, bucket, rookieState);
        const wireBucket = WIRE_BUCKET[bucket];
        sources.set(`${wireBucket}|${String(rookieState === "rookie")}`, rate.source);
        rows.push({ bucket: wireBucket, rookie: rookieState === "rookie", n: rate.n, points: awardPmfOnPointAxis(rate.pmf) });
        cells.push(`${wireBucket}/${rookieState}: n=${rate.n} source=${rate.source}`);
      }
    }
    // An `unknown` cell the module registered is logged as MEASURED AND NOT
    // PUBLISHED rather than dropped invisibly: 10-03's wire field is a boolean
    // and Fact 4 measured that state as empty in the district population.
    for (const bucket of DECORATION_BUCKETS) {
      const unknownCell = awardBaseRate(season, bucket, "unknown");
      if (unknownCell.source === "cell") {
        console.log(
          `publishDistricts: season ${season} — the module registers an "unknown" rookie-state cell for bucket "${bucket}" (n=${unknownCell.n}); it is measured and NOT published, because the wire field is a boolean`
        );
      }
    }
    baseRates = { season, measuredThroughSeason, script: MEASURED_COMMAND, rows };
    console.log(
      `publishDistricts: season ${season} award census — measured through ${measuredThroughSeason}, script "${MEASURED_COMMAND}"; cells: ${cells.join("; ")}`
    );
  }

  // THE ORDERING TABLES TRAVEL WITH THE BASE RATES OR NOT AT ALL. Publishing
  // one without the other would leave a reader holding a residual it cannot
  // fall back from, or an ordering it cannot subtract. The module registers
  // exactly the same season set (`awardOrderingTables.test.ts` asserts that by
  // equality), so this guard fires only if that ever stops being true.
  let orderingTables: DistrictArtifact["awardOrderingTables"];
  if (baseRates !== undefined && measuredThroughSeason !== undefined) {
    if (!hasAwardOrderingTables(season)) {
      console.log(
        `publishDistricts: season ${season} has a base-rate table but NO ordering table (ordering seasons: ${AWARD_ORDERING_SEASONS.join(", ")}) — publishing the base rates alone, so the ledger keeps the base-rate path`
      );
    } else {
      const tables = awardOrderingTables(season);
      const impact: NonNullable<DistrictArtifact["awardOrderingTables"]>["impact"] = [];
      for (let position = 1; position <= MAX_IMPACT_POSITION; position++) {
        // A position the measurement could not score is ABSENT from the wire,
        // exactly as it is `null` in the module. The reader's own fallback
        // takes it to the tail, and shipping a zero would be a fabricated
        // probability wearing a position's name.
        if (tables.impact[position - 1] === null) continue;
        const rate = impactOrderingProbability(season, position);
        impact.push({ position, n: rate.n, p: rate.p });
      }
      const rookieAllStar: NonNullable<DistrictArtifact["awardOrderingTables"]>["rookieAllStar"] = [];
      for (let position = 1; position <= MAX_ROOKIE_ALL_STAR_POSITION; position++) {
        if (tables.rookieAllStar[position - 1] === null) continue;
        const rate = rookieAllStarOrderingProbability(season, position);
        rookieAllStar.push({ position, n: rate.n, p: rate.p });
      }
      const residual: NonNullable<DistrictArtifact["awardOrderingTables"]>["residual"] = [];
      for (const bucket of DECORATION_BUCKETS) {
        for (const rookieState of ["rookie", "veteran"] as const) {
          const rate = awardResidualRate(season, bucket, rookieState);
          residual.push({
            bucket: WIRE_BUCKET[bucket],
            rookie: rookieState === "rookie",
            n: rate.n,
            points: awardPmfOnPointAxis(rate.pmf),
          });
        }
      }
      orderingTables = {
        season,
        measuredThroughSeason,
        script: ORDERING_MEASURED_COMMAND,
        impact,
        impactTail: tables.impactTail,
        rookieAllStar,
        rookieAllStarTail: tables.rookieAllStarTail,
        residual,
      };
      console.log(
        `publishDistricts: season ${season} award ordering — Impact position 1 ${(impact[0]?.p ?? 0).toFixed(4)} on n=${impact[0]?.n ?? 0}, tail ${tables.impactTail.p.toFixed(4)} on n=${tables.impactTail.n}; ` +
          `Rookie All Star position 1 ${(rookieAllStar[0]?.p ?? 0).toFixed(4)} on n=${rookieAllStar[0]?.n ?? 0}; script "${ORDERING_MEASURED_COMMAND}"`
      );
    }
  }

  const publishAwards = baseRates !== undefined;

  return {
    season,
    priorInstanceCount,
    baseRates,
    orderingTables,
    sources,
    profilesFor(teamKeys) {
      const profiles = new Map<string, DistrictAwardProfile>();
      const unknownRookieYear: string[] = [];
      if (!publishAwards) return { profiles, unknownRookieYear: [], priorInstanceCount };
      for (const teamKey of new Set(teamKeys)) {
        const memoized = memo.get(teamKey);
        if (memoized !== undefined) {
          profiles.set(teamKey, memoized);
          continue;
        }
        const rookieState = rookieStateFor(rookieYears.get(teamKey), season);
        if (rookieState === "unknown") {
          unknownRookieYear.push(teamKey);
          continue;
        }
        // ONE derivation of the count, shared by the bucket and by the
        // ordering key. Deriving them separately is how a published bucket and
        // a published ordering position come to describe different teams.
        const priorJudgedAwards = priorJudgedAwardCount(instancesByTeam.get(teamKey) ?? [], teamKey, season);
        // The Impact ordering's first key (260929-imp), counted by the SAME
        // helper the measurement script built the Impact tables with: distinct
        // (year, event) Impact wins, seasons strictly before this one.
        const priorImpactWins = priorImpactWinCount(instancesByTeam.get(teamKey) ?? [], teamKey, season);
        const bucket = decorationBucket(priorJudgedAwards);
        const profile: DistrictAwardProfile = { bucket, rookieState, priorJudgedAwards, priorImpactWins };
        memo.set(teamKey, profile);
        profiles.set(teamKey, profile);
      }
      return { profiles, unknownRookieYear: unknownRookieYear.sort(), priorInstanceCount };
    },
  };
}

/** One team's published row selector, mapped from the SAME profile object the bake was handed. */
export function toWireAwardProfile(profile: DistrictAwardProfile): {
  bucket: DistrictAwardBucket;
  rookie: boolean;
  priorJudgedAwards?: number;
  priorImpactWins?: number;
} {
  return {
    bucket: WIRE_BUCKET[profile.bucket],
    rookie: profile.rookieState === "rookie",
    // Absent stays absent rather than becoming 0: a zero would say "this team
    // has never won a judged award", which is a different claim from "this
    // producer did not derive a count". The same holds for the Impact count.
    ...(profile.priorJudgedAwards === undefined ? {} : { priorJudgedAwards: profile.priorJudgedAwards }),
    ...(profile.priorImpactWins === undefined ? {} : { priorImpactWins: profile.priorImpactWins }),
  };
}

/** Why one district event was refused a bake, in the vocabulary the per-season census counts. */
export type BakeIneligibilityReason =
  | "not-a-remaining-event"
  | "divisioned-dcmp-parent"
  | "dcmp-field-not-final-as-of"
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
 * Every DCMP (TBA `event_type` 2) that has at least one DIVISION: an
 * `event_type` 5 event whose key starts with the parent's key and is longer
 * than it (`2026micmp` -> `2026micmp1`..`2026micmp4`). Pure over the event
 * list it is handed, so the bake's classifier reads it as data.
 *
 * Measured 2026 (corpus of 2026-09-28): 4 divided parents (micmp with 4
 * divisions; necmp, oncmp and txcmp with 2 each) and 11 undivided DCMPs
 * (cancmp, cascmp, chcmp, gacmp, incmp, iscmp, mrcmp, nccmp, pncmp, sccmp,
 * wicmp), every one of which ran its own 8-alliance qualification tournament.
 */
export function dividedDcmpParentKeys(events: ReadonlyArray<{ readonly eventKey: string; readonly eventType: number }>): Set<string> {
  const divisions = events.filter((e) => e.eventType === 5).map((e) => e.eventKey);
  const divided = new Set<string>();
  for (const parent of events) {
    if (parent.eventType !== 2) continue;
    if (divisions.some((key) => key.length > parent.eventKey.length && key.startsWith(parent.eventKey))) divided.add(parent.eventKey);
  }
  return divided;
}

/**
 * Whether a district's DCMP field was still UNKNOWABLE at an as-of instant:
 * true while any of the district's regular events (TBA `event_type` 1) is
 * missing from `finishedEventKeys` (`finishedEventKeysAsOf`). Pure; the caller
 * decides that the question is asked only in an `--as-of` run.
 */
export function dcmpFieldPendingAsOf(
  events: ReadonlyArray<{ readonly eventKey: string; readonly eventType: number }>,
  finishedEventKeys: ReadonlySet<string>
): boolean {
  return events.some((e) => e.eventType === 1 && !finishedEventKeys.has(e.eventKey));
}

/** Every DCMP-tier event of `season` (TBA `event_type` 2 and 5), across every district: `dividedDcmpParentKeys`'s input. */
function selectDcmpTierEvents(db: Corpus, season: number): Array<{ eventKey: string; eventType: number }> {
  const rows = db
    .prepare(`SELECT event_key, event_type FROM events WHERE year = ? AND event_type IN (2, 5) ORDER BY event_key ASC`)
    .all(season) as { event_key: string; event_type: number }[];
  return rows.map((row) => ({ eventKey: row.event_key, eventType: row.event_type }));
}

/**
 * ELIGIBILITY, as one named predicate with one reason string per rejection.
 *
 * An event is baked when, AT THE RUN'S OWN INSTANT: at least one team still
 * had it ahead (`remainingEventKeysAsOf`); it is not a divided DCMP parent; it
 * had played no qualification match; and its registered roster is inside the
 * schedule generator's size range.
 *
 * A DIVIDED DCMP parent (`event_type` 2 with at least one `event_type` 5
 * division, `dividedDcmpParentKeys`) is excluded because it has no
 * qualification schedule to generate at all (its divisions carry the
 * qualification matches and the parent plays finals only) and because its
 * alliance count is not knowable before its divisions run (measured: every
 * 2026 district event with an alliance count other than eight is one of the
 * four divided parents). An UNDIVIDED DCMP is an ordinary qualification
 * tournament with eight alliances and is a candidate like any district event.
 *
 * IN AN `--as-of` RUN ONLY, a DCMP-tier event (`event_type` 2 or a type 5
 * division) is refused as `dcmp-field-not-final-as-of` while any regular
 * district event of its district is unfinished at the instant
 * (`dcmpFieldPendingAsOf`). Its roster is read season-final, and a DCMP roster
 * is the product of that district's results, so before they are all in, that
 * roster is information from after the instant. At the run's own clock the
 * rule is off: TBA lists a DCMP roster only once the district has qualified
 * its field, so the roster a production run reads is already knowable.
 *
 * BOTH AS-OF INPUTS ARRIVE ALREADY CUT, so this predicate holds no clock of its
 * own. `remainingEventKeys` is `remainingEventKeysAsOf`'s answer and
 * `quals.played` is `selectQualMatchCounts`'s as-of count: qualification matches
 * played strictly before the instant, by each match's own timestamp. An event
 * that had not played a qualification match at the instant reads zero here,
 * even if it played sixty afterwards. That is what makes the verification path
 * and the production path one code path — with the instant at the run's own
 * clock both inputs are the corpus itself.
 */
export function classifyBakeCandidate(args: {
  readonly event: DistrictEventMeta;
  readonly remainingEventKeys: ReadonlySet<string>;
  readonly roster: readonly string[];
  /** AS-OF counts from `selectQualMatchCounts`; `undefined` when the event has no qualification rows at all. */
  readonly quals: QualMatchCounts | undefined;
  /** `dividedDcmpParentKeys` over the season's DCMP-tier events. */
  readonly dividedDcmpParentKeys: ReadonlySet<string>;
  /**
   * `dcmpFieldPendingAsOf` for this event's district in an `--as-of` run: a regular district
   * event of the district had not finished at the instant. Always `false` without `--as-of`.
   */
  readonly dcmpFieldPendingAsOf: boolean;
}): BakeIneligibilityReason | null {
  if (!args.remainingEventKeys.has(args.event.eventKey)) return "not-a-remaining-event";
  if (args.event.eventType === 2 && args.dividedDcmpParentKeys.has(args.event.eventKey)) return "divisioned-dcmp-parent";
  if (districtTierForEventType(args.event.eventType) === "dcmp" && args.dcmpFieldPendingAsOf) return "dcmp-field-not-final-as-of";
  if ((args.quals?.played ?? 0) > 0) return "already-in-progress";
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

  // The events underway at the instant, once per season: the as-of cut every
  // district's candidacy below reads, on the replay's own match clock.
  const underwayEventKeys = underwayEventKeysAsOf(db, season, computedAt);
  // Which DCMPs have divisions, once per season, handed to the classifier as data.
  const dividedParents = dividedDcmpParentKeys(selectDcmpTierEvents(db, season));
  // The events finished at the instant, read ONLY in an `--as-of` run: the DCMP
  // field rule does not exist at the run's own clock (see `classifyBakeCandidate`).
  const finishedEventKeys = options.asOfRun === true ? finishedEventKeysAsOf(db, season, computedAt) : undefined;

  // Collect candidates across EVERY district first, so the decision to replay is
  // made once for the season rather than once per district.
  const candidates: BakeCandidate[] = [];
  for (const composed of year.detailArtifacts) {
    const eventKeys = composed.events.map((e) => e.eventKey);
    const quals = selectQualMatchCounts(db, eventKeys, computedAt);
    // NOT the composed artifact's `remainingEvents`: those are built from
    // season-final district points, which in an as-of run include points earned
    // after the instant. At the run's own clock the two sets are equal.
    const remainingEventKeys = remainingEventKeysAsOf({
      events: composed.events,
      registrations: composed.registrations,
      teams: composed.artifact.teams,
      underwayEventKeys,
      computedAt,
    });
    const fieldPending = finishedEventKeys !== undefined && dcmpFieldPendingAsOf(composed.events, finishedEventKeys);

    for (const event of composed.events) {
      census.considered++;
      const roster = composed.registrations.get(event.eventKey) ?? [];
      const reason = classifyBakeCandidate({
        event,
        remainingEventKeys,
        roster,
        quals: quals.get(event.eventKey),
        dividedDcmpParentKeys: dividedParents,
        dcmpFieldPendingAsOf: fieldPending,
      });
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
  const awardProfiles = options.awardProfilesFor?.(season, rosterTeamKeys) ?? year.awardContext.profilesFor(rosterTeamKeys);
  if (year.awardContext.baseRates === undefined) {
    // NO PROFILES MEANS NO BAKE, and the reason has to be stated rather than
    // worked around: an event total is the SUM of four categories, so omitting
    // the award draw would publish a total that is wrong in a direction nobody
    // could see. The season's own omission was already logged by
    // `buildSeasonAwardContext` with its cause — an unregistered season, or an
    // empty prior award corpus (`pnpm ingest:awards-all`, RESEARCH A5).
    console.log(
      `publishDistricts: season ${season} — no published award base-rate table, so no event can be priced; refusing to bake rather than publish an event total missing its award draw`
    );
    bump(census.skipped, "no-award-base-rates");
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
  if (options.sigmaCarry === false) {
    console.log(
      `publishDistricts: season ${season} — Sigma carry OFF (--no-sigma-carry, verification only): the pre-9.0.0 model, every season's Sigma starts empty and a team with no Sigma refuses its roster`
    );
  }
  if (options.rpColdPrior === false) {
    console.log(
      `publishDistricts: season ${season} — RP cold-team prior OFF (--no-rp-cold-prior, verification only): the pre-9.0.0 model, a team with no RP history this season is priced from a zero belief`
    );
  }
  const pricing = buildDistrictPricingState(db, {
    season,
    warmupSeasons,
    asOf: computedAt,
    algorithm,
    // Explicit either way: production is both on, and only a dry-run opt-out turns one off.
    sigmaCarry: options.sigmaCarry !== false,
    rpColdPrior: options.rpColdPrior !== false,
  });
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
      const missing = pricing.teamsWithoutSigmaFor(candidate.roster);
      console.log(
        `${label}: the all-or-nothing ranking-point filler rejected this roster; ${missing.length} of ${candidate.roster.length} team(s) have no pre-event Sigma Score: ${missing.join(", ") || "(none; no ranking-point model for this season)"}`
      );
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
      // alliance count other than eight is a DIVIDED DCMP parent, and those are
      // excluded by `classifyBakeCandidate` — the other half of the same
      // finding. An undivided DCMP is no exception: all 11 of 2026's drafted
      // eight alliances (measured 2026-09-28 from `event_alliances`).
      allianceCount: 8,
      // The REGISTERED roster size. A started event's field size is
      // `event_rankings.total_teams`; those are two different facts (a team that
      // registered and never played appears in one and not the other), and
      // `DistrictLedgerEventInput.fieldSize`'s own doc comment names resolving
      // the discrepancy as the caller's decision. An unstarted event has no
      // rankings row at all, so the registered roster is the only honest answer.
      // An undivided DCMP takes the same rule: its registered roster (31 to 66
      // teams in 2026) is its field.
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
    if (outcome.zeroProfileTeams.length > 0) {
      console.log(
        `publishDistricts: bake ${candidate.eventKey} [${pricing.algorithmId}]: ${outcome.zeroProfileTeams.length} roster team(s) carry no award profile and are priced with no decorations: ${outcome.zeroProfileTeams.join(", ")}`
      );
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
  /** The instant this run is computed at. Becomes `computedAt`, drives `eventStillAhead`, cuts bake candidacy to what had happened by then, and cuts the walk-forward replay at each match's own timestamp. */
  readonly asOf: string;
  /**
   * `true` only when `--as-of` was given: the instant is in the past, so the rules that exist
   * only for verification fidelity apply (the DCMP field rule in `classifyBakeCandidate`).
   * Absent at the run's own clock, which is every production run.
   */
  readonly asOfRun?: boolean;
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
  /**
   * `false` under `--no-sigma-carry`: price the bake WITHOUT the Sigma carry
   * (`packages/harness/sigmaCarry.ts`), the pre-9.0.0 model. A verification opt-out, refused without
   * `--dry-run` so a bake priced that way can never reach R2. Absent: the production path, carry on.
   */
  readonly sigmaCarry?: boolean;
  /**
   * `false` under `--no-rp-cold-prior`: price the bake WITHOUT the RP cold-team prior (`rpColdPrior`,
   * `.planning/quick/260928-n6i-fix-the-early-season-rp-bonus-cold-start/260928-n6i-PREREG.md`), the
   * pre-9.0.0 model. A verification opt-out, refused without `--dry-run` so a bake priced that way can
   * never reach R2. Absent: the production path, prior on.
   */
  readonly rpColdPrior?: boolean;
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
      "no-sigma-carry": { type: "boolean" },
      "no-rp-cold-prior": { type: "boolean" },
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

  const noSigmaCarry = values["no-sigma-carry"] === true;
  if (noSigmaCarry && values["dry-run"] !== true) {
    throw new Error(
      "publishDistricts: --no-sigma-carry prices the bake with the pre-9.0.0 model and is a verification opt-out only — it must never reach R2, so it refuses to run without --dry-run"
    );
  }
  const noRpColdPrior = values["no-rp-cold-prior"] === true;
  if (noRpColdPrior && values["dry-run"] !== true) {
    throw new Error(
      "publishDistricts: --no-rp-cold-prior prices the bake with the pre-9.0.0 model and is a verification opt-out only — it must never reach R2, so it refuses to run without --dry-run"
    );
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
    ...(values["as-of"] !== undefined ? { asOfRun: true } : {}),
    ...(values["local-out"] !== undefined ? { localOut: values["local-out"] } : {}),
    bake: values["no-bake"] !== true,
    ...(warmupFrom !== undefined ? { warmupFrom } : {}),
    ...(noSigmaCarry ? { sigmaCarry: false as const } : {}),
    ...(noRpColdPrior ? { rpColdPrior: false as const } : {}),
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
  // (`playedMatchKeysAtOrAfter`, by each match's own timestamp) and which events
  // are bake-eligible (`remainingEventKeysAsOf` and the as-of qualification
  // count) — so a past event cannot be priced from a state that saw its own
  // results.
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
      // THROUGH THE SAME GATE AS THE OTHER TWO KINDS. This object used to be
      // measured by a hand-rolled `Buffer.byteLength` and a hand-rolled
      // `--local-out` write, with no `assertWithinDistrictBudget` in front of
      // either — the one composed object that could be written and uploaded
      // unmeasured. It grows with the district count per season and it is on
      // the picker's page-load path.
      const indexBytes = gateAndRecord({
        key: year.indexKey,
        body: indexBody,
        ceiling: ceilings.indexAbsolute,
        ...(options.localOut !== undefined ? { localOut: options.localOut } : {}),
      });
      totalBytes += indexBytes;
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
