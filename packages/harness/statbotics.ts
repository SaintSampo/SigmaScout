/**
 * A clearly-labelled Statbotics per-season accuracy figure alongside our own
 * numbers, so every report shows the target.
 *
 * `api.statbotics.io/v3/year/{year}` has been observed to reproducibly
 * return HTTP 500. `statboticsReference` still always attempts a live fetch
 * first — a future Statbotics fix is picked up automatically with no code
 * change — but never lets a fetch failure fail the run: any network error,
 * non-2xx status, or schema-validation failure falls back to
 * `STATBOTICS_REFERENCE_FALLBACK`, a dated manual constant. The returned
 * object always records which path produced the value (`fetched: true | false`).
 *
 * Winner-prediction accuracy lives at `metrics.win_prob.season.acc` in the
 * live v3 response shape, with Statbotics' own Brier score (directly
 * comparable to ours) alongside it at `metrics.win_prob.season.mse` — the
 * shape `StatboticsYearResponseSchema` parses below.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export interface StatboticsReference {
  season: number;
  /** Winner-prediction accuracy in [0, 1] — directly comparable to our own `winnerAccuracy`. */
  value: number;
  /** Statbotics' own winner-prediction Brier score (`metrics.win_prob.season.mse`) — directly comparable to our own `brierScore`. Optional: absent on a fallback row for a season the live shape has never been captured for (unreachable today — every fallback below, 2016-2020 and 2022-2026, carries one). */
  mse?: number;
  sourceLabel: string;
  matchPopulation: string;
  /** ISO date (YYYY-MM-DD) this value was captured or fetched. */
  capturedAt: string;
  /** `true` iff this value came from a live fetch this run; `false` iff the dated fallback was used. */
  fetched: boolean;
}

const StatboticsYearResponseSchema = z.object({
  metrics: z.object({
    win_prob: z.object({
      season: z.object({
        acc: z.number(),
        mse: z.number(),
      }),
    }),
  }),
});

/**
 * Every value below was fetched live from `/v3/year/{season}` and verified
 * against `metrics.win_prob.season.{acc,mse}` for every season the corpus
 * carries (2016-2020 and 2022-2026; 2021 is permanently excluded).
 * `sourceLabel` says "fetched and verified", and `fetched: false` still
 * marks every artifact that falls back to one of these (a live fetch is
 * always attempted first; this is the fallback path only).
 *
 * No site page reads these constants — they are consumed by harness report
 * runs only, so registering a season here changes nothing on the site.
 *
 * 2017 is the hardest season any of these numbers describes: its accuracy
 * (0.6694) is the LOWEST in the table and its Brier score (0.2023) is the
 * WORST — third-party evidence that 2017 is genuinely hard to predict, a
 * useful anchor for any future headline claim. 2018's accuracy (0.7435)
 * corroborates this project's own anti-additivity finding: 2018 is the
 * only corpus season whose red and blue alliance scores are
 * *anti*-correlated.
 */
export const STATBOTICS_REFERENCE_FALLBACK: Readonly<Record<number, StatboticsReference>> = {
  2016: {
    season: 2016,
    value: 0.7312,
    mse: 0.1799,
    sourceLabel: "Statbotics API (v3/year, fetched and verified 2026-09-07 — dated manual constant, not a live call)",
    matchPopulation: "all 2016 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-09-07",
    fetched: false,
  },
  2017: {
    season: 2017,
    value: 0.6694,
    mse: 0.2023,
    sourceLabel: "Statbotics API (v3/year, fetched and verified 2026-09-07 — dated manual constant, not a live call)",
    matchPopulation: "all 2017 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-09-07",
    fetched: false,
  },
  2018: {
    season: 2018,
    value: 0.7435,
    mse: 0.1747,
    sourceLabel: "Statbotics API (v3/year, fetched and verified 2026-09-07 — dated manual constant, not a live call)",
    matchPopulation: "all 2018 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-09-07",
    fetched: false,
  },
  2019: {
    season: 2019,
    value: 0.7322,
    mse: 0.1763,
    sourceLabel: "Statbotics API (v3/year, fetched and verified 2026-09-07 — dated manual constant, not a live call)",
    matchPopulation: "all 2019 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-09-07",
    fetched: false,
  },
  2020: {
    season: 2020,
    value: 0.7262,
    mse: 0.1834,
    sourceLabel: "Statbotics API (v3/year, fetched and verified 2026-09-07 — dated manual constant, not a live call)",
    matchPopulation: "all 2020 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-09-07",
    fetched: false,
  },
  2022: {
    season: 2022,
    value: 0.7815,
    mse: 0.1502,
    sourceLabel: "Statbotics API (v3/year, fetched and verified 2026-09-04 — dated manual constant, not a live call)",
    matchPopulation: "all 2022 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-09-04",
    fetched: false,
  },
  2023: {
    season: 2023,
    value: 0.7647,
    mse: 0.1608,
    sourceLabel: "Statbotics API (v3/year, fetched and verified 2026-09-04 — dated manual constant, not a live call)",
    matchPopulation: "all 2023 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-09-04",
    fetched: false,
  },
  2024: {
    season: 2024,
    value: 0.7627,
    mse: 0.162,
    sourceLabel: "Statbotics API (v3/year, fetched and verified 2026-09-04 — dated manual constant, not a live call)",
    matchPopulation: "all 2024 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-09-04",
    fetched: false,
  },
  2025: {
    season: 2025,
    value: 0.7839,
    mse: 0.1537,
    sourceLabel: "Statbotics API (v3/year, fetched and verified 2026-09-04 — dated manual constant, not a live call)",
    matchPopulation: "all 2025 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-09-04",
    fetched: false,
  },
  2026: {
    season: 2026,
    value: 0.7978,
    mse: 0.1483,
    sourceLabel: "Statbotics API (v3/year, fetched and verified 2026-09-04 — dated manual constant, not a live call)",
    matchPopulation: "all 2026 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-09-04",
    fetched: false,
  },
};

async function fetchStatboticsYear(season: number, fetchImpl: typeof fetch): Promise<StatboticsReference> {
  const response = await fetchImpl(`https://api.statbotics.io/v3/year/${season}`);
  if (!response.ok) {
    throw new Error(`Statbotics /v3/year/${season} returned HTTP ${response.status}`);
  }
  const body: unknown = await response.json();
  const parsed = StatboticsYearResponseSchema.parse(body);
  return {
    season,
    value: parsed.metrics.win_prob.season.acc,
    mse: parsed.metrics.win_prob.season.mse,
    sourceLabel: "Statbotics API (v3/year, live fetch)",
    matchPopulation: `all ${season} qualification + elimination matches (Statbotics EPA model)`,
    capturedAt: new Date().toISOString().slice(0, 10),
    fetched: true,
  };
}

function readCache(cachePath: string): Record<number, StatboticsReference> {
  if (!existsSync(cachePath)) return {};
  try {
    return JSON.parse(readFileSync(cachePath, "utf8")) as Record<number, StatboticsReference>;
  } catch {
    return {};
  }
}

function writeCache(cachePath: string, cache: Record<number, StatboticsReference>): void {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf8");
}

export interface StatboticsReferenceOptions {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * When provided, a successfully live-fetched value is cached to this path
   * (and read back on later calls) so a report run is not blocked by
   * Statbotics availability. Caching is opt-in — omit to run with no disk
   * side effects.
   */
  cachePath?: string;
}

/**
 * Returns the Statbotics reference row for a season. Always attempts a live
 * fetch first; any failure (network error, non-2xx status, schema mismatch)
 * falls back to the dated constant. Never throws for a Statbotics-side
 * failure: it is context for our numbers, not an input to them. Throws
 * only if `season` has neither a live result nor a fallback constant — see
 * `STATBOTICS_REFERENCE_FALLBACK`'s own keys for the currently-covered set,
 * which is every season the corpus carries (2016-2020 and 2022-2026; 2021
 * is permanently excluded).
 */
export async function statboticsReference(
  season: number,
  options: StatboticsReferenceOptions = {}
): Promise<StatboticsReference> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cache = options.cachePath ? readCache(options.cachePath) : {};

  const cached = cache[season];
  if (cached?.fetched) return cached;

  try {
    const fetched = await fetchStatboticsYear(season, fetchImpl);
    if (options.cachePath) {
      cache[season] = fetched;
      writeCache(options.cachePath, cache);
    }
    return fetched;
  } catch {
    const fallback = STATBOTICS_REFERENCE_FALLBACK[season];
    if (!fallback) {
      const covered = Object.keys(STATBOTICS_REFERENCE_FALLBACK)
        .map(Number)
        .sort((a, b) => a - b)
        .join(", ");
      throw new Error(`statboticsReference: no fallback constant for season ${season} (covered: ${covered})`);
    }
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Per-team Statbotics EPA, for a direct per-team comparison against our own
// `epa.teamMetrics()` output. This is a DIFFERENT endpoint and a DIFFERENT
// contract from `statboticsReference` above: that function's whole point is
// "never let a Statbotics outage fail a report run", so it swallows every
// failure into a dated fallback. There is no honest fallback for a per-team
// reference series — an empty result would silently read as "perfect
// agreement over zero teams" — so this function throws on any fetch or
// validation failure instead.
// ---------------------------------------------------------------------------

/**
 * One Statbotics team-year row, narrowed to exactly the fields
 * `scripts/epaVsStatbotics.ts` consumes. `totalPoints` is Statbotics'
 * `epa.total_points` — a NO-FOUL figure (verified live: `frc254`/2024
 * total_points 51.71 == auto 15.94 + teleop 29.48 + endgame 6.28) —
 * comparable to our own `total` metric only after our side's
 * `foulsCommitted` component is subtracted out (see `epaStatboticsCompare.ts`).
 */
export interface StatboticsTeamYearRow {
  readonly team: number;
  readonly totalPoints: number;
  readonly autoPoints: number;
  readonly teleopPoints: number;
  readonly endgamePoints: number;
  /** Statbotics `record.count` — this team's played-match count for the season, used for a minimum-match filter. */
  readonly matchCount: number;
}

const StatboticsTeamYearRawSchema = z.object({
  team: z.number(),
  epa: z.object({
    total_points: z.number(),
    breakdown: z.object({
      auto_points: z.number(),
      teleop_points: z.number(),
      endgame_points: z.number(),
    }),
  }),
  record: z.object({
    count: z.number(),
  }),
});

const StatboticsTeamYearsPageSchema = z.array(StatboticsTeamYearRawSchema);

const TEAM_YEARS_DEFAULT_PAGE_SIZE = 1000;

/**
 * `/v3/team_years` has been observed to return a transient HTTP 503
 * mid-page that a re-request resolves cleanly — a genuine transient
 * hiccup, not a real outage. A multi-season, multi-arm comparison run makes
 * a single flaky page costly to lose an entire long replay over, so a
 * page-level retry with a short fixed backoff is applied to non-2xx
 * responses only — a schema-validation failure is never retried, since
 * retrying cannot fix a shape mismatch.
 */
const TEAM_YEARS_MAX_FETCH_ATTEMPTS = 3;
const TEAM_YEARS_RETRY_DELAY_MS = 2000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchStatboticsTeamYearsOptions {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * When provided, a season's full row set is cached to this path (keyed by
   * season) and read back on later calls instead of re-paging the API.
   * Caching is opt-in — omit to run with no disk side effects.
   */
  cachePath?: string;
  /** Page size for `/v3/team_years`; defaults to 1000 (the API's own max). */
  pageSize?: number;
}

function readTeamYearsCache(cachePath: string): Record<number, StatboticsTeamYearRow[]> {
  if (!existsSync(cachePath)) return {};
  try {
    return JSON.parse(readFileSync(cachePath, "utf8")) as Record<number, StatboticsTeamYearRow[]>;
  } catch {
    return {};
  }
}

function writeTeamYearsCache(cachePath: string, cache: Record<number, StatboticsTeamYearRow[]>): void {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf8");
}

/**
 * Fetches every Statbotics team-year row for `season`, paging
 * `/v3/team_years?year={season}&limit={pageSize}&offset={n}` until a page
 * returns fewer rows than `pageSize`. Every row is Zod-validated at the
 * fetch boundary, picking only the fields this comparison consumes and
 * stripping everything else — matching this file's existing boundary
 * discipline. Throws on a non-2xx status or a schema-validation failure;
 * there is no honest partial-series fallback (see file header).
 */
export async function fetchStatboticsTeamYears(
  season: number,
  options: FetchStatboticsTeamYearsOptions = {}
): Promise<StatboticsTeamYearRow[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pageSize = options.pageSize ?? TEAM_YEARS_DEFAULT_PAGE_SIZE;
  const cache = options.cachePath ? readTeamYearsCache(options.cachePath) : {};

  const cached = cache[season];
  if (cached) return cached;

  const rows: StatboticsTeamYearRow[] = [];
  let offset = 0;
  for (;;) {
    const url = `https://api.statbotics.io/v3/team_years?year=${season}&limit=${pageSize}&offset=${offset}`;

    let response: Response | undefined;
    let lastStatus = 0;
    for (let attempt = 1; attempt <= TEAM_YEARS_MAX_FETCH_ATTEMPTS; attempt++) {
      const candidate = await fetchImpl(url);
      if (candidate.ok) {
        response = candidate;
        break;
      }
      lastStatus = candidate.status;
      if (attempt < TEAM_YEARS_MAX_FETCH_ATTEMPTS) {
        await delay(TEAM_YEARS_RETRY_DELAY_MS);
      }
    }
    if (!response) {
      throw new Error(
        `fetchStatboticsTeamYears: ${url} returned HTTP ${lastStatus} after ${TEAM_YEARS_MAX_FETCH_ATTEMPTS} attempts`
      );
    }

    const body: unknown = await response.json();
    const page = StatboticsTeamYearsPageSchema.parse(body);
    for (const raw of page) {
      rows.push({
        team: raw.team,
        totalPoints: raw.epa.total_points,
        autoPoints: raw.epa.breakdown.auto_points,
        teleopPoints: raw.epa.breakdown.teleop_points,
        endgamePoints: raw.epa.breakdown.endgame_points,
        matchCount: raw.record.count,
      });
    }
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  if (options.cachePath) {
    cache[season] = rows;
    writeTeamYearsCache(options.cachePath, cache);
  }

  return rows;
}
