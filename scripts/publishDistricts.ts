/**
 * The offline Districts-page publish tool (quick task 260905-lic Task 2),
 * shaped exactly like `scripts/publishAlgorithmsManifest.ts`: `parseArgs`
 * from `node:util`, deep relative imports with explicit `.js` extensions, a
 * `main()` guarded on being the process entry point, non-zero exit on
 * failure. Per the plan's own context: "District artifacts are refreshed
 * only by an offline `pnpm ingest:districts` + `pnpm publish:districts`. The
 * live Worker cron does not touch them."
 *
 * Never reads, prints or interpolates `.env` or any value from it —
 * `putObject` (`packages/harness/r2Client.js`) reads its own credentials
 * from `process.env`, exactly as every other publish tool in this repo does;
 * this file never touches `process.env` directly. `--dry-run` composes,
 * validates (through `DistrictsIndexArtifactSchema`/`DistrictArtifactSchema`)
 * and prints per-object byte sizes without ever calling `putObject`.
 *
 * Write ordering (artifacts-before-index, the same load-bearing rule the
 * retune/republish skill establishes): every `v1/district/{key}.json` is
 * written before `v1/districts/{year}.json` is overwritten, so the index
 * never points at a detail object that is not there yet.
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
 * making the tool less useful without making it more correct. Flagged here,
 * not silently dropped -- see the SUMMARY for the same note.
 */
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  openCorpusReadOnly,
  selectDistrictsForYear,
  selectDistrictRankings,
  selectEventTeamsForEvents,
  type Corpus,
  type CorpusDistrict,
  type CorpusDistrictRanking,
} from "../packages/corpus/db.js";
import { computeLocks, type LockResult, type LockTeamInput } from "../packages/core/districts/locks.js";
import { maxEventPoints, type DistrictTier } from "../packages/core/districts/pointModel.js";
import {
  districtDetailKey,
  districtsIndexKey,
  DistrictArtifactSchema,
  DistrictsIndexArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  type DistrictArtifact,
  type DistrictsIndexArtifact,
} from "../packages/harness/pageArtifacts.js";
import { putObject } from "../packages/harness/r2Client.js";

const DEFAULT_BUCKET = "sigmascout-artifacts";
const CORPUS_PATH = "data/corpus.sqlite";

// ---------------------------------------------------------------------------
// TBA event_points shape — parsed here, not modelled column-by-column in the
// corpus schema (schema.sql's own stated reason). Live shape probed against
// 2026fnc and cross-checked against every ingested season by this task's own
// reconciliation.test.ts; no season-specific variant has been observed.
// ---------------------------------------------------------------------------

const EventPointsEntrySchema = z.object({
  event_key: z.string().min(1),
  district_cmp: z.boolean(),
  qual_points: z.number(),
  alliance_points: z.number(),
  elim_points: z.number(),
  award_points: z.number(),
  total: z.number(),
});

const EventPointsArraySchema = z.array(EventPointsEntrySchema);

/** TBA `event_type` -> this model's two-tier vocabulary. `2`=District Championship, `5`=District Championship Division map to `"dcmp"` (mirrors `packages/core/algorithms/sigma1/rp/constants.ts`'s `EVENT_TYPE_TIERS`); every other value observed in a district's own event list is `"district"`. */
function districtTierForEventType(eventType: number): DistrictTier {
  return eventType === 2 || eventType === 5 ? "dcmp" : "district";
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
}

interface EventRow {
  event_key: string;
  name: string | null;
  week: number | null;
  event_type: number;
}

/** Every event belonging to district `abbreviation` (the bare, non-year-prefixed key `events.district_key` stores) for `year` — the authoritative "this district's full event list" this task needs, since Task 1 stores no separate district-events table. */
function selectDistrictEvents(db: Corpus, abbreviation: string, year: number): DistrictEventMeta[] {
  const rows = db
    .prepare(`SELECT event_key, name, week, event_type FROM events WHERE district_key = ? AND year = ? ORDER BY event_key ASC`)
    .all(abbreviation, year) as EventRow[];
  return rows.map((row) => ({ eventKey: row.event_key, name: row.name ?? row.event_key, week: row.week, eventType: row.event_type }));
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

/** The point total sitting at the `slots`-th rank (1-based), or `null` when `slots` is `null` (capacity not published) or there are no ranked teams at all. `rankingsAscByRank` must already be sorted ascending by `rank` (`selectDistrictRankings`'s own `ORDER BY rank ASC`). */
export function cutLinePointsFor(rankingsAscByRank: readonly CorpusDistrictRanking[], slots: number | null): number | null {
  if (slots === null) return null;
  const idx = Math.min(slots, rankingsAscByRank.length) - 1;
  if (idx < 0) return null;
  return rankingsAscByRank[idx]!.pointTotal;
}

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
  readonly teamMeta: ReadonlyMap<string, { teamNumber: number; nickname: string | null }>;
}

/**
 * Composes one district's full detail artifact: the Breakdown table's
 * per-event component readout, both remaining-events lists, both
 * `maxRemaining*` ceilings, and both lock verdicts (`computeLocks` run
 * twice — once against `dcmpSlots`, once against `cmpSlots`). Pure: takes
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

  interface PerTeamComputed {
    ranking: CorpusDistrictRanking;
    eventPoints: DistrictArtifact["teams"][number]["eventPoints"];
    remainingEvents: DistrictArtifact["teams"][number]["remainingEvents"];
    maxRemainingDistrict: number;
    hasPlayedDcmp: boolean;
  }

  const perTeam: PerTeamComputed[] = rankings.map((ranking) => {
    const rawEventPoints = EventPointsArraySchema.parse(JSON.parse(ranking.eventPointsRaw));
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
      .filter((eventKey) => !playedEventKeys.has(eventKey))
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

  // Pass 1: districtLock, using maxRemainingDistrict (regular-tier events only).
  const districtLockInputs: LockTeamInput[] = perTeam.map((t) => ({
    teamKey: t.ranking.teamKey,
    pointTotal: t.ranking.pointTotal,
    maxRemaining: t.maxRemainingDistrict,
  }));
  const districtLocks = computeLocks(districtLockInputs, district.dcmpSlots);
  const districtLockByTeam = new Map(districtLocks.map((r) => [r.teamKey, r] as const));

  // Pass 2: maxRemainingChamp = maxRemainingDistrict + (one hypothetical dcmp-tier
  // event's max, only for a team that has not already attended DCMP AND is not
  // already eliminated from DCMP qualification per pass 1's districtLock).
  const maxRemainingChampByTeam = new Map<string, number>();
  for (const t of perTeam) {
    const districtLock = districtLockByTeam.get(t.ranking.teamKey)!;
    const stillMightAttendDcmp = !t.hasPlayedDcmp && districtLock.status !== "eliminated";
    maxRemainingChampByTeam.set(t.ranking.teamKey, t.maxRemainingDistrict + (stillMightAttendDcmp ? dcmpEventMaxTotal : 0));
  }
  const champLockInputs: LockTeamInput[] = perTeam.map((t) => ({
    teamKey: t.ranking.teamKey,
    pointTotal: t.ranking.pointTotal,
    maxRemaining: maxRemainingChampByTeam.get(t.ranking.teamKey)!,
  }));
  const champLocks = computeLocks(champLockInputs, district.cmpSlots);
  const champLockByTeam = new Map(champLocks.map((r) => [r.teamKey, r] as const));

  const dcmpCutLine = cutLinePointsFor(rankings, district.dcmpSlots);
  const cmpCutLine = cutLinePointsFor(rankings, district.cmpSlots);

  const lockVerdict = (result: LockResult, cutLinePoints: number | null) => ({
    status: result.status,
    pointsToLock: result.pointsToLock,
    threatCount: result.threatCount,
    cutLinePoints,
  });

  const teams = perTeam.map((t) => {
    const info = teamMeta.get(t.ranking.teamKey);
    const districtLock = districtLockByTeam.get(t.ranking.teamKey)!;
    const champLock = champLockByTeam.get(t.ranking.teamKey)!;
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
      maxRemainingChamp: maxRemainingChampByTeam.get(t.ranking.teamKey)!,
      districtLock: lockVerdict(districtLock, dcmpCutLine),
      champLock: lockVerdict(champLock, cmpCutLine),
    };
  });

  return DistrictArtifactSchema.parse({
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
      eventCount: events.length,
      dcmpCutLinePoints: dcmpCutLine,
      cmpCutLinePoints: cmpCutLine,
      districtLockedCount: districtLocks.filter((r) => r.status === "locked").length,
      districtEliminatedCount: districtLocks.filter((r) => r.status === "eliminated").length,
      champLockedCount: champLocks.filter((r) => r.status === "locked").length,
      champEliminatedCount: champLocks.filter((r) => r.status === "eliminated").length,
    },
  });
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

interface PublishedYear {
  readonly indexArtifact: DistrictsIndexArtifact;
  readonly indexKey: string;
  readonly detailArtifacts: ReadonlyArray<{ key: string; artifact: DistrictArtifact }>;
}

/** Builds both artifact kinds for one season, reading everything from the corpus. Pure with respect to R2 — no `putObject` call happens here. */
export function composeYear(db: Corpus, season: number, generation: string, computedAt: string): PublishedYear {
  const districts = selectDistrictsForYear(db, season);
  const detailArtifacts: Array<{ key: string; artifact: DistrictArtifact }> = [];
  const indexRows: DistrictsIndexInputRow[] = [];

  for (const district of districts) {
    const rankings = selectDistrictRankings(db, district.districtKey);
    const events = selectDistrictEvents(db, district.abbreviation, district.year);
    const registrations = selectEventTeamsForEvents(
      db,
      events.map((e) => e.eventKey)
    );
    const teamKeys = rankings.map((r) => r.teamKey);
    const teamMeta = selectTeamMeta(db, teamKeys);

    const artifact = buildDistrictArtifact({ season, generation, computedAt, district, rankings, events, registrations, teamMeta });
    detailArtifacts.push({ key: districtDetailKey(district.districtKey), artifact });
    indexRows.push({ district, teamCount: rankings.length, eventCount: events.length });
  }

  const indexArtifact = buildDistrictsIndexArtifact(season, generation, computedAt, indexRows);
  return { indexArtifact, indexKey: districtsIndexKey(season), detailArtifacts };
}

interface CliOptions {
  readonly years: number[];
  readonly bucket: string;
  readonly dryRun: boolean;
}

function parseOptions(argv: readonly string[]): CliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      years: { type: "string" },
      bucket: { type: "string" },
      "dry-run": { type: "boolean" },
    },
  });

  const yearsSpec = values.years;
  if (yearsSpec === undefined) {
    throw new Error('publishDistricts: --years is required, e.g. --years "2019,2020,2022-2026"');
  }

  return { years: parseYearsSpec(yearsSpec), bucket: values.bucket ?? DEFAULT_BUCKET, dryRun: values["dry-run"] === true };
}

/** `--years` accepts a single year, a range (`"2022-2026"`), or a comma-separated list of these — the same term grammar `packages/harness/publish.ts`'s own `parseSeasonsRange` accepts, reimplemented locally (small enough not to warrant a cross-file dependency into that much larger module) so this file stays standalone, matching `scripts/publishAlgorithmsManifest.ts`'s own shape. */
export function parseYearsSpec(spec: string): number[] {
  const terms = spec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (terms.length === 0) throw new Error(`--years must not be empty, got "${spec}"`);

  const years = new Set<number>();
  for (const term of terms) {
    const singleMatch = /^(\d{4})$/.exec(term);
    if (singleMatch) {
      years.add(Number.parseInt(singleMatch[1]!, 10));
      continue;
    }
    const rangeMatch = /^(\d{4})-(\d{4})$/.exec(term);
    if (!rangeMatch) {
      throw new Error(`--years terms must each be a single year like "2026" or a range like "2022-2026", got invalid term "${term}" in "${spec}"`);
    }
    const start = Number.parseInt(rangeMatch[1]!, 10);
    const end = Number.parseInt(rangeMatch[2]!, 10);
    if (end < start) throw new Error(`--years range end (${end}) must be >= start (${start}), in term "${term}" of "${spec}"`);
    for (let year = start; year <= end; year++) years.add(year);
  }
  return Array.from(years).sort((a, b) => a - b);
}

export async function run(options: CliOptions): Promise<void> {
  const db = openCorpusReadOnly(CORPUS_PATH);
  const generation = new Date().toISOString();
  const computedAt = generation;

  try {
    for (const season of options.years) {
      const year = composeYear(db, season, generation, computedAt);

      let totalBytes = 0;
      for (const { key, artifact } of year.detailArtifacts) {
        const body = JSON.stringify(artifact);
        totalBytes += body.length;
        console.log(`publishDistricts: composed "${key}" (${body.length} bytes)`);
        if (!options.dryRun) {
          await putObject(options.bucket, key, body, { contentType: "application/json", cacheControl: "public, max-age=60" });
          console.log(`publishDistricts: published "${key}" to bucket "${options.bucket}"`);
        }
      }

      // Artifacts-before-index: every v1/district/{key}.json above is
      // written (or, in --dry-run, composed) before the index below is
      // overwritten, so the index never points at a detail object that is
      // not there yet.
      const indexBody = JSON.stringify(year.indexArtifact);
      totalBytes += indexBody.length;
      console.log(`publishDistricts: composed "${year.indexKey}" (${indexBody.length} bytes)`);
      if (!options.dryRun) {
        await putObject(options.bucket, year.indexKey, indexBody, { contentType: "application/json", cacheControl: "public, max-age=60" });
        console.log(`publishDistricts: published "${year.indexKey}" to bucket "${options.bucket}"`);
      }

      console.log(`publishDistricts: season ${season} — ${year.detailArtifacts.length} district(s), ${totalBytes} total bytes`);
    }

    if (options.dryRun) {
      console.log("publishDistricts: --dry-run — nothing published.");
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
