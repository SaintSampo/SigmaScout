/**
 * Measures the DISTRICT AWARD BASE RATES that
 * `packages/core/districts/awardBaseRates.ts` ships.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE TABLE IS FOR
 * ---------------------------------------------------------------------------
 *
 * 10-CONTEXT.md, "Awards (Jacob): base rates by decoration bucket" — per
 * season, for buckets of prior judged awards crossed with rookie status, the
 * chance a team earns ANY award points at a regular district event and the
 * distribution over 0 / 5 / 8 / 10 / 13 / 15-or-more. 10-04 draws the award
 * category from it, 10-06 bakes it, 10-08 quotes it.
 *
 * ---------------------------------------------------------------------------
 * THE BOUNDARY IS WALK-FORWARD IN BOTH HALVES
 * ---------------------------------------------------------------------------
 *
 *   HALF ONE, THE FEATURE. A team's decoration bucket at a season-Y event
 *   counts only judged awards from seasons strictly before Y.
 *
 *   HALF TWO, THE RATES. The table registered for season Y is fit only on
 *   team-events from seasons strictly before Y.
 *
 * Both halves carry their own leak test, on fixtures chosen so a leak CHANGES
 * the answer — a fixture where it does not proves nothing. Half two is the
 * LARGER surface here, because the table is the thing that ships, and the
 * obvious single leak test only covers half one. This project's failure log is
 * a log of measurements that looked like answers.
 *
 * The per-season loop rebuilds each season's prior set from scratch rather than
 * accumulating forward, so there is no running state a reordering could leak
 * through.
 *
 * ---------------------------------------------------------------------------
 * SCOPE: THE DISTRICT TIER ONLY, SELECTED BY THE ENTRY'S OWN BOOLEAN
 * ---------------------------------------------------------------------------
 *
 * The measured outcome is the `award_points` component of a
 * `district_rankings.event_points_raw` entry, parsed with the same field set
 * `scripts/publishDistricts.ts`'s `EventPointsEntrySchema` declares, and
 * tier-selected by each entry's OWN `district_cmp` boolean.
 *
 * `pointModel.ts`'s header names the trap directly: inferring the tier by
 * joining to `events` and testing `event_type == 2` yields the dcmp figure
 * wearing the district tier's name. A test asserts the exclusion rather than a
 * comment claiming it.
 *
 * NOT IN SCOPE: Impact and Rookie All Star ORDERING tables (10-CONTEXT.md
 * scopes both out of this phase), and any path from an award prediction into
 * `locks.ts` — a Locked verdict stays a guarantee.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIAL-FREE AND OFFLINE
 * ---------------------------------------------------------------------------
 *
 * Read-only corpus, no network request, no environment variable, no credential.
 * Its `package.json` entry (`measure:district-award-base-rates`) deliberately
 * omits the `--env-file=.env` flag that `ingest:*` and `publish:*` carry.
 *
 * `event_awards_all` is GITIGNORED and does not travel via git (10-RESEARCH.md
 * assumption A5), so another checkout runs `pnpm ingest:awards-all` first. The
 * corpus-guarded tests skip cleanly where it is absent, which is CI.
 *
 * Usage:
 *   npx tsx scripts/measureDistrictAwardBaseRates.ts [--seasons 2016-2020,2022-2026] [--json]
 *   pnpm measure:district-award-base-rates
 */

import { pathToFileURL } from "node:url";
import {
  openCorpusReadOnly,
  selectDistrictRankings,
  selectDistrictsForYear,
  selectEventAwardsAllForYear,
  type Corpus,
} from "../packages/corpus/db.js";
import {
  AWARD_POINT_SUPPORT,
  awardPointsBucketIndex,
  cellKey,
  DECORATION_BUCKETS,
  decorationBucket,
  MIN_CELL_OBSERVATIONS,
  NON_JUDGED_AWARD_TYPES,
  ROOKIE_STATES,
  rookieStateFor,
  type AwardPointDistribution,
  type DecorationBucket,
  type RookieState,
  type SeasonAwardBaseRates,
} from "../packages/core/districts/awardBaseRates.js";
import { DISTRICT_REGISTERED_SEASONS } from "../packages/core/districts/pointModel.js";
import { parseSeasons } from "./scriptHelpers.js";

const CORPUS_PATH = "data/corpus.sqlite";

/** The default window: every season `pointModel.ts` carries a district point ceiling for. */
export const DEFAULT_SEASON_SPEC = DISTRICT_REGISTERED_SEASONS.join(",");

/**
 * A season needs at least this many PRIOR district seasons of data before a
 * table is registered for it. Three rather than one: a single prior season's
 * award mix is one year's judging panel, and the three-or-more decoration
 * bucket barely exists after one season of history.
 */
export const MIN_PRIOR_DISTRICT_SEASONS = 3;

/** The exact command that produced the tables committed in `awardBaseRates.ts`. */
export const MEASURED_COMMAND = "npx tsx scripts/measureDistrictAwardBaseRates.ts";
/** The date that command was run. */
export const MEASURED_DATE = "2026-09-25";

// ───────────────────────────── pure helpers ─────────────────────────────
// Everything in this section is pure and unit-tested in
// measureDistrictAwardBaseRates.test.ts.

/** One award instance as this script reads it. `teamKey` is null for a person-only award. */
export interface AwardInstance {
  readonly year: number;
  readonly eventKey: string;
  readonly awardType: number;
  readonly teamKey: string | null;
}

/**
 * How many DISTINCT judged awards a team had won before `beforeYear`.
 *
 * DISTINCT on `(year, eventKey, awardType)` because `event_awards_all`'s
 * primary key is POSITIONAL: a multi-recipient award is several rows at one
 * event, and a naive row count triples a shared award.
 *
 * `beforeYear` is strict — this is leak half one, and the test pins it on a
 * fixture where the leaked boundary lands the team in a different bucket.
 */
export function priorJudgedAwardCount(
  instances: readonly AwardInstance[],
  teamKey: string,
  beforeYear: number
): number {
  const seen = new Set<string>();
  for (const instance of instances) {
    if (instance.teamKey !== teamKey) continue;
    if (instance.year >= beforeYear) continue;
    if (NON_JUDGED_AWARD_TYPES.has(instance.awardType)) continue;
    seen.add(`${instance.year}|${instance.eventKey}|${instance.awardType}`);
  }
  return seen.size;
}

/** One district-tier team-event outcome: what a team scored in award points at one regular district event. */
export interface TeamEventOutcome {
  readonly season: number;
  readonly teamKey: string;
  readonly eventKey: string;
  readonly awardPoints: number;
}

/** A running cell: the team-event count, the histogram over the support, and every unmodelled value seen. */
export interface CellAccumulator {
  n: number;
  readonly counts: number[];
  readonly unmodelled: Map<number, number>;
}

export function emptyCell(): CellAccumulator {
  return { n: 0, counts: AWARD_POINT_SUPPORT.map(() => 0), unmodelled: new Map() };
}

/** Folds one outcome into a cell. An unmodelled value is censused and NOT counted into `n`'s histogram. */
export function foldOutcome(cell: CellAccumulator, awardPoints: number): void {
  const index = awardPointsBucketIndex(awardPoints);
  if (index === undefined) {
    cell.unmodelled.set(awardPoints, (cell.unmodelled.get(awardPoints) ?? 0) + 1);
    return;
  }
  cell.n++;
  cell.counts[index]!++;
}

/** Normalizes a cell into a pmf. `undefined` for an empty cell — never a uniform guess. */
export function toDistribution(cell: CellAccumulator): AwardPointDistribution | undefined {
  if (cell.n === 0) return undefined;
  return { n: cell.n, pmf: cell.counts.map((c) => c / cell.n) };
}

/** Sums several cells into one, for the pooled rungs. */
export function poolCells(cells: readonly CellAccumulator[]): CellAccumulator {
  const pooled = emptyCell();
  for (const cell of cells) {
    pooled.n += cell.n;
    for (let i = 0; i < pooled.counts.length; i++) pooled.counts[i]! += cell.counts[i]!;
    for (const [value, count] of cell.unmodelled) pooled.unmodelled.set(value, (pooled.unmodelled.get(value) ?? 0) + count);
  }
  return pooled;
}

/** Whether a cell clears the stated minimum. A cell AT the minimum is present; below it prints CANNOT BE SCORED. */
export function clearsCellBar(cell: CellAccumulator): boolean {
  return cell.n >= MIN_CELL_OBSERVATIONS;
}

/** One season's measured result, before it becomes a committed literal. */
export interface SeasonMeasurement {
  readonly season: number;
  readonly priorSeasons: number[];
  readonly cells: Map<string, CellAccumulator>;
  readonly bucketPooled: Map<DecorationBucket, CellAccumulator>;
  readonly seasonPooled: CellAccumulator;
  /** Cells below `MIN_CELL_OBSERVATIONS` — reported CANNOT BE SCORED, absent from the emitted table. */
  readonly thinCells: string[];
  readonly registered: boolean;
  readonly registrationReason: string;
}

/**
 * Builds one season's cells from a PRIOR outcome set and a PRIOR award-instance
 * set. Both are supplied by the caller and both must already be restricted to
 * seasons strictly before `season` — which is exactly what leak half two's test
 * drives directly.
 *
 * A prior outcome's bucket is built as of THAT outcome's own season, so a 2019
 * row's bucket counts pre-2019 awards rather than pre-Y awards.
 */
export function buildSeasonCells(
  season: number,
  priorOutcomes: readonly TeamEventOutcome[],
  priorInstances: readonly AwardInstance[],
  rookieYears: ReadonlyMap<string, number>
): SeasonMeasurement {
  const cells = new Map<string, CellAccumulator>();
  for (const bucket of DECORATION_BUCKETS) {
    for (const state of ROOKIE_STATES) cells.set(cellKey(bucket, state), emptyCell());
  }

  // Memoized per (team, outcome season): the bucket feature is the expensive
  // part and it depends only on those two.
  const bucketCache = new Map<string, DecorationBucket>();
  for (const outcome of priorOutcomes) {
    const cacheKey = `${outcome.teamKey}|${outcome.season}`;
    let bucket = bucketCache.get(cacheKey);
    if (bucket === undefined) {
      bucket = decorationBucket(priorJudgedAwardCount(priorInstances, outcome.teamKey, outcome.season));
      bucketCache.set(cacheKey, bucket);
    }
    const state = rookieStateFor(rookieYears.get(outcome.teamKey) ?? null, outcome.season);
    foldOutcome(cells.get(cellKey(bucket, state))!, outcome.awardPoints);
  }

  const bucketPooled = new Map<DecorationBucket, CellAccumulator>();
  for (const bucket of DECORATION_BUCKETS) {
    bucketPooled.set(
      bucket,
      poolCells(ROOKIE_STATES.map((state) => cells.get(cellKey(bucket, state))!))
    );
  }
  const seasonPooled = poolCells([...cells.values()]);

  const thinCells: string[] = [];
  for (const [key, cell] of cells) {
    if (!clearsCellBar(cell)) thinCells.push(key);
  }

  const priorSeasons = [...new Set(priorOutcomes.map((o) => o.season))].sort((a, b) => a - b);
  let registered = true;
  let registrationReason = "registered";
  if (priorSeasons.length < MIN_PRIOR_DISTRICT_SEASONS) {
    registered = false;
    registrationReason = `only ${priorSeasons.length} prior district season(s) of data, below the ${MIN_PRIOR_DISTRICT_SEASONS} required`;
  } else if (seasonPooled.n < MIN_CELL_OBSERVATIONS) {
    registered = false;
    registrationReason = `season-pooled n=${seasonPooled.n} is below the ${MIN_CELL_OBSERVATIONS} minimum`;
  } else if (thinCells.length === cells.size) {
    registered = false;
    registrationReason = `every cell is below the ${MIN_CELL_OBSERVATIONS} minimum`;
  }

  return { season, priorSeasons, cells, bucketPooled, seasonPooled, thinCells, registered, registrationReason };
}

/** The committed-literal shape for one registered season. Thin cells are ABSENT, never zeroed. */
export function toSeasonTable(measurement: SeasonMeasurement): SeasonAwardBaseRates {
  const cells: Record<string, AwardPointDistribution> = {};
  for (const [key, cell] of measurement.cells) {
    if (!clearsCellBar(cell)) continue;
    const distribution = toDistribution(cell);
    if (distribution !== undefined) cells[key] = distribution;
  }
  const bucketPooled: Record<string, AwardPointDistribution> = {};
  for (const [bucket, cell] of measurement.bucketPooled) {
    const distribution = toDistribution(cell);
    if (distribution !== undefined) bucketPooled[bucket] = distribution;
  }
  return { cells, bucketPooled, seasonPooled: toDistribution(measurement.seasonPooled)! };
}

// ───────────────────────────── corpus reads ─────────────────────────────

/**
 * Every district-tier team-event outcome for one season: an
 * `event_points_raw` entry whose OWN `district_cmp` is false. Never joined to
 * `events` — see this file's header for the measurement trap that avoids.
 */
export function loadDistrictTierOutcomes(db: Corpus, season: number): TeamEventOutcome[] {
  const out: TeamEventOutcome[] = [];
  for (const district of selectDistrictsForYear(db, season)) {
    for (const ranking of selectDistrictRankings(db, district.districtKey)) {
      let entries: unknown;
      try {
        entries = JSON.parse(ranking.eventPointsRaw);
      } catch {
        continue;
      }
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (typeof entry !== "object" || entry === null) continue;
        const record = entry as Record<string, unknown>;
        // The same field set publishDistricts.ts's EventPointsEntrySchema declares.
        if (typeof record["event_key"] !== "string") continue;
        if (typeof record["district_cmp"] !== "boolean") continue;
        if (typeof record["award_points"] !== "number") continue;
        if (record["district_cmp"] === true) continue;
        out.push({
          season,
          teamKey: ranking.teamKey,
          eventKey: record["event_key"],
          awardPoints: record["award_points"],
        });
      }
    }
  }
  return out;
}

/** Every award instance for one season, as this script's `AwardInstance` shape. */
export function loadAwardInstances(db: Corpus, season: number): AwardInstance[] {
  return selectEventAwardsAllForYear(db, season).map((row) => ({
    year: row.year,
    eventKey: row.eventKey,
    awardType: row.awardType,
    teamKey: row.teamKey,
  }));
}

interface TeamRookieYearRow {
  team_key: string;
  rookie_year: number | null;
}

/** teamKey to `rookie_year`, NON-NULL ROWS ONLY. An absent key is the `"unknown"` rookie state. */
export function loadRookieYears(db: Corpus): Map<string, number> {
  const rows = db.prepare(`SELECT team_key, rookie_year FROM teams`).all() as TeamRookieYearRow[];
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.rookie_year === null || !Number.isFinite(row.rookie_year)) continue;
    out.set(row.team_key, row.rookie_year);
  }
  return out;
}

// ───────────────────────────── the measurement ─────────────────────────────

export interface MeasurementResult {
  readonly bySeason: Map<number, SeasonMeasurement>;
  readonly registeredSeasons: number[];
}

/**
 * Measures every season in `seasons`, in ascending order. For each, the prior
 * award-instance set and the prior team-event outcome set are built from
 * seasons STRICTLY BEFORE it — reversing that is the leak.
 */
export function measureDistrictAwardBaseRates(db: Corpus, seasons: readonly number[]): MeasurementResult {
  const ordered = [...seasons].sort((a, b) => a - b);
  const rookieYears = loadRookieYears(db);

  const outcomeCache = new Map<number, TeamEventOutcome[]>();
  const instanceCache = new Map<number, AwardInstance[]>();
  const loadOutcomes = (season: number): TeamEventOutcome[] => {
    let cached = outcomeCache.get(season);
    if (cached === undefined) {
      cached = loadDistrictTierOutcomes(db, season);
      outcomeCache.set(season, cached);
    }
    return cached;
  };
  const loadInstances = (season: number): AwardInstance[] => {
    let cached = instanceCache.get(season);
    if (cached === undefined) {
      cached = loadAwardInstances(db, season);
      instanceCache.set(season, cached);
    }
    return cached;
  };

  const bySeason = new Map<number, SeasonMeasurement>();
  const registeredSeasons: number[] = [];

  for (const season of ordered) {
    const priorSeasons = DISTRICT_REGISTERED_SEASONS.filter((s) => s < season);
    const priorOutcomes: TeamEventOutcome[] = [];
    const priorInstances: AwardInstance[] = [];
    for (const prior of priorSeasons) {
      priorOutcomes.push(...loadOutcomes(prior));
      priorInstances.push(...loadInstances(prior));
    }
    const measurement = buildSeasonCells(season, priorOutcomes, priorInstances, rookieYears);
    bySeason.set(season, measurement);
    if (measurement.registered) registeredSeasons.push(season);
  }

  return { bySeason, registeredSeasons };
}

// ───────────────────────────── reporting ─────────────────────────────

function pmfString(cell: CellAccumulator): string {
  const distribution = toDistribution(cell);
  if (distribution === undefined) return "CANNOT BE SCORED (n=0)";
  return distribution.pmf.map((p) => p.toFixed(4)).join("  ");
}

function anyString(cell: CellAccumulator): string {
  const distribution = toDistribution(cell);
  if (distribution === undefined) return "   n/a";
  return `${((1 - distribution.pmf[0]!) * 100).toFixed(2)}%`;
}

function reportSeason(measurement: SeasonMeasurement): void {
  const supportHeader = AWARD_POINT_SUPPORT.map((v, i) => (i === AWARD_POINT_SUPPORT.length - 1 ? `${v}+` : String(v)).padStart(6)).join("");
  console.log(`── ${measurement.season} ── fit on seasons ${measurement.priorSeasons.join(", ") || "none"}`);
  console.log(`   cell                              n     P(any)   ${supportHeader}`);
  for (const bucket of DECORATION_BUCKETS) {
    for (const state of ROOKIE_STATES) {
      const key = cellKey(bucket, state);
      const cell = measurement.cells.get(key)!;
      const thin = !clearsCellBar(cell);
      console.log(
        `   ${key.padEnd(30)} ${String(cell.n).padStart(6)}   ${anyString(cell).padStart(7)}   ` +
          (thin ? `CANNOT BE SCORED (n < ${MIN_CELL_OBSERVATIONS})` : pmfString(cell))
      );
    }
  }
  for (const bucket of DECORATION_BUCKETS) {
    const cell = measurement.bucketPooled.get(bucket)!;
    console.log(
      `   POOLED ${bucket.padEnd(23)} ${String(cell.n).padStart(6)}   ${anyString(cell).padStart(7)}   ${pmfString(cell)}`
    );
  }
  console.log(
    `   POOLED season                  ${String(measurement.seasonPooled.n).padStart(6)}   ${anyString(measurement.seasonPooled).padStart(7)}   ${pmfString(
      measurement.seasonPooled
    )}`
  );
  const census = [...measurement.seasonPooled.unmodelled.entries()].sort((a, b) => a[0] - b[0]);
  console.log(
    `   UNMODELLED VALUES: ${census.length === 0 ? "none" : census.map(([value, count]) => `${value} x${count}`).join(", ")}`
  );
  console.log(`   ${measurement.registered ? "REGISTERED" : "NOT REGISTERED"}: ${measurement.registrationReason}`);
  console.log("");
}

function reportPracticalAnswer(result: MeasurementResult): void {
  const seasons = result.registeredSeasons;
  if (seasons.length === 0) {
    console.log(`── PRACTICAL ANSWER ──\n   No season cleared the registration bar. Nothing to state.\n`);
    return;
  }
  const latest = result.bySeason.get(seasons[seasons.length - 1]!)!;
  const anyFor = (cell: CellAccumulator | undefined): number | undefined => {
    const d = cell === undefined ? undefined : toDistribution(cell);
    return d === undefined ? undefined : 1 - d.pmf[0]!;
  };
  const none = anyFor(latest.bucketPooled.get("none"));
  const oneTwo = anyFor(latest.bucketPooled.get("one-or-two"));
  const threePlus = anyFor(latest.bucketPooled.get("three-or-more"));
  const veteranNone = anyFor(latest.cells.get(cellKey("none", "veteran")));
  const rookieNone = anyFor(latest.cells.get(cellKey("none", "rookie")));
  const pct = (v: number | undefined): string => (v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`);

  console.log(`── PRACTICAL ANSWER ──`);
  console.log(
    `   At a regular district event, a team that has never won a judged award takes home award points\n` +
      `   about ${pct(none)} of the time. A team with one or two prior judged awards: ${pct(oneTwo)}. A team with three\n` +
      `   or more: ${pct(threePlus)}. So prior decoration moves the chance by roughly ${
        none !== undefined && threePlus !== undefined ? `${((threePlus - none) * 100).toFixed(1)} percentage points` : "n/a"
      } from the\n` +
      `   bottom bucket to the top — a real effect, and one that ORDERS teams far better than it calibrates\n` +
      `   any single team's chance. Rookie status inside the undecorated bucket moves it from ${pct(veteranNone)}\n` +
      `   (veteran) to ${pct(rookieNone)} (rookie). A team whose rookie year TBA does not report is its own\n` +
      `   "unknown" row and is never folded into "veteran". Figures above are season ${latest.season}'s table,\n` +
      `   fit on seasons ${latest.priorSeasons.join(", ")}, and every one of them is reported in whichever\n` +
      `   direction it came out.`
  );
  console.log("");
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasons = parseSeasons(flagValue(args, "--seasons") ?? DEFAULT_SEASON_SPEC);
  const asJson = args.includes("--json");

  if (!asJson) {
    console.log(`DISTRICT AWARD BASE RATES — walk-forward, district tier only, by decoration bucket x rookie status.`);
    console.log(`seasons:    ${seasons.join(", ")}`);
    console.log(`support:    ${AWARD_POINT_SUPPORT.join(", ")} (top bin means 15 or more)`);
    console.log(`cell bar:   ${MIN_CELL_OBSERVATIONS} team-events; below it a cell prints CANNOT BE SCORED and is absent from the module`);
    console.log(`tier:       selected by each event_points_raw entry's OWN district_cmp boolean, never by joining to events`);
    console.log(`credential: none. Read-only corpus, no network request, no environment variable.`);
    console.log(``);
  }

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const result = measureDistrictAwardBaseRates(db, seasons);

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            command: MEASURED_COMMAND,
            date: MEASURED_DATE,
            registeredSeasons: result.registeredSeasons,
            seasons: [...result.bySeason.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([season, measurement]) => ({
                season,
                priorSeasons: measurement.priorSeasons,
                registered: measurement.registered,
                registrationReason: measurement.registrationReason,
                thinCells: measurement.thinCells,
                unmodelled: [...measurement.seasonPooled.unmodelled.entries()].sort((a, b) => a[0] - b[0]),
                table: measurement.seasonPooled.n > 0 ? toSeasonTable(measurement) : null,
              })),
          },
          null,
          2
        )
      );
      return;
    }

    for (const season of [...result.bySeason.keys()].sort((a, b) => a - b)) {
      reportSeason(result.bySeason.get(season)!);
    }
    console.log(`REGISTERED SEASONS: ${result.registeredSeasons.join(", ") || "none"}`);
    for (const season of [...result.bySeason.keys()].sort((a, b) => a - b)) {
      const measurement = result.bySeason.get(season)!;
      if (!measurement.registered) console.log(`   NOT ${season}: ${measurement.registrationReason}`);
    }
    console.log("");
    reportPracticalAnswer(result);
  } finally {
    db.close();
  }
}

// Guard: only auto-run `main()` when this file is the process entry point, so
// the pure helpers above can be imported by the test file without opening a
// corpus.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measure:district-award-base-rates failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
