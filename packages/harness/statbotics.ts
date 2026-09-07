/**
 * D-04's reference row: a clearly-labelled Statbotics per-season accuracy
 * figure alongside our own numbers, so every report shows the target before
 * our own EPA reimplementation exists (Phase 2).
 *
 * Plan 01's recon (docs/data/tba-field-recon.md) found `api.statbotics.io/v3/year/{year}`
 * reproducibly returns HTTP 500 across three URL shapes; re-confirmed live
 * during plan 01's execution (2026-08-13) and again on 2026-08-14 (Phase 2's
 * D-14). `statboticsReference` still always attempts a live fetch first — a
 * future Statbotics fix is picked up automatically with no code change —
 * but never lets a fetch failure fail the run (T-01-12): any network error,
 * non-2xx status, or schema-validation failure falls back to
 * `STATBOTICS_REFERENCE_FALLBACK`, a dated manual constant. The returned
 * object always records which path produced the value (`fetched: true | false`).
 *
 * **Quick task 260904-4aa correction.** The endpoint itself was never the
 * only problem: `StatboticsYearResponseSchema` parsed `{ epa_acc: number }`,
 * a shape live `/v3/year/{season}` has never returned in its current v3
 * form (verified live 2026-09-04) — winner-prediction accuracy lives at
 * `metrics.win_prob.season.acc`, with Statbotics' own Brier score
 * (directly comparable to ours) alongside it at
 * `metrics.win_prob.season.mse`. That meant every call to
 * `statboticsReference` was catching its OWN parse failure and returning
 * the fallback unconditionally — the API coming back up on its own changed
 * nothing, because the parse failed before the fallback was ever reached.
 * Fixed below by repointing the schema at the live shape; `mse` is
 * additionally now surfaced on `StatboticsReference`, and every fallback
 * constant is replaced with a live-fetched, individually-verified value
 * (see `STATBOTICS_REFERENCE_FALLBACK`'s own doc comment).
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
 * Quick task 260904-4aa: replaces the prior 0.70/0.71 dated-manual-constant
 * ESTIMATES (never individually verified — see git history for the retired
 * "KNOWN STUB" comment this replaces) with values fetched live from
 * `/v3/year/{season}` and verified 2026-09-04 against
 * `metrics.win_prob.season.{acc,mse}` for every one of 2022-2026. Every
 * value here is 6-9 winner-accuracy points HIGHER than the estimate it
 * replaces (e.g. 2022: 0.70 -> 0.7815), which makes the target SigmaScout
 * is measured against materially harder — that is the correction, not a
 * problem with it. `sourceLabel` says "fetched and verified" rather than
 * "unverified estimate", and `fetched: false` still marks every artifact
 * that falls back to one of these (a live fetch is always attempted first;
 * this is the fallback path only, per this module's own contract).
 *
 * **2018 and 2019 added 2026-09-07 (quick task 260907-12k), each fetched and
 * verified live the same day.** No site page reads these constants — they
 * are consumed by harness report runs only, so registering a season here
 * changes nothing on the site and is independent of `FIRST_SEASON` in
 * `apps/web/src/lib/seasons.ts` (still 2019; no 2016, 2017 or 2018
 * artifacts exist in R2).
 *
 * **2016, 2017 and 2020 added 2026-09-07 (quick task 260907-203)**, each
 * fetched live from `GET /v3/year/{season}` the same day and read from
 * `metrics.win_prob.season`: 2016 acc 0.7312 / mse 0.1799 over 13,286
 * matches, 2017 acc 0.6694 / mse 0.2023 over 15,429, 2020 acc 0.7262 /
 * mse 0.1834 over 4,634 (2020's small count is the cancelled season, not a
 * fetch problem). **The 2020 row CLOSES the named gap quick task 260907-12k
 * recorded** — that gap paragraph is deleted rather than left standing,
 * because a file that still claims an open gap it has already filled is the
 * "docs describe a deleted model" defect this project logs against itself.
 * With 2020 filled, every season the corpus carries (2016-2020, 2022-2026;
 * 2021 is permanently excluded) now resolves offline.
 *
 * **2017 is the hardest season any of these numbers describes.** Its 0.6694
 * is the LOWEST Statbotics winner accuracy of any season in this table —
 * below even 2018's 0.7435, and 5.7 accuracy points below the second-lowest
 * (2020's 0.7262), a gap wider than the entire spread of the 2016/2018/2019/
 * 2020 cluster. Its Brier score agrees independently: 0.2023 is the WORST
 * (highest) `mse` in the table. That is third-party evidence that 2017, and
 * not only 2018, is genuinely hard to predict — a useful anchor for any
 * future headline claim, and a reason not to read a weak SigmaScout 2017
 * result as a SigmaScout-specific failure.
 *
 * **Endpoint correction.** The correct path is `/v3/year/{season}`. An
 * earlier probe of `/v3/season/{season}` returned 404 — that is a
 * WRONG-PATH result, not evidence any season is unavailable from
 * Statbotics, and must never be re-recorded as such.
 *
 * **2018 corroborates this project's own anti-additivity finding.**
 * Statbotics' own 2018 winner accuracy (0.7435) sits well below its 2022
 * (0.7815) — independent, third-party confirmation that 2018 is a
 * genuinely harder season to predict, consistent with this project's own
 * measurement that 2018 is the only corpus season whose red and blue
 * alliance scores are *anti*-correlated (corr(red, blue) totalPoints
 * -0.4567, against +0.24..+0.52 in every other season). Useful as an anchor
 * for any future 2018 headline claim.
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
 * failure is context for our numbers, not an input to
 * them (T-01-12). Throws only if `season` has neither a live result nor a
 * fallback constant — see `STATBOTICS_REFERENCE_FALLBACK`'s own keys for the
 * currently-covered set, which as of 2026-09-07 is every season the corpus
 * carries (2016-2020 and 2022-2026; 2021 is permanently excluded). There is
 * no longer a named gap: 2020's, the last one, was filled by quick task
 * 260907-203.
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
// Quick task 260904-4aa (SC-2): per-team Statbotics EPA, for a direct
// per-team comparison against our own `epa.teamMetrics()` output. This is a
// DIFFERENT endpoint and a DIFFERENT contract from `statboticsReference`
// above: that function's whole point is "never let a Statbotics outage fail
// a report run", so it swallows every failure into a dated fallback. There
// is no honest fallback for a per-team reference series — an empty result
// would silently read as "perfect agreement over zero teams" — so this
// function throws on any fetch or validation failure instead.
// ---------------------------------------------------------------------------

/**
 * One Statbotics team-year row, narrowed to exactly the fields
 * `scripts/epaVsStatbotics.ts` consumes. `totalPoints` is Statbotics'
 * `epa.total_points` — a NO-FOUL figure (verified live 2026-09-04:
 * `frc254`/2024 total_points 51.71 == auto 15.94 + teleop 29.48 + endgame
 * 6.28) — comparable to our own `total` metric only after our side's
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
 * Rule 3 (blocking-issue) fix, found running this comparison for real:
 * `/v3/team_years` returned one transient HTTP 503 mid-page (season 2025,
 * offset 3000) that a re-request 5 seconds later resolved cleanly — a
 * genuine transient hiccup, not a real outage (the endpoint's live status is
 * this function's own `<precondition>`, checked once before any paging
 * starts). A multi-season, multi-arm comparison run (Task 2) makes a single
 * flaky page costly to lose an entire long replay over, so a page-level
 * retry with a short fixed backoff is applied to non-2xx responses only —
 * a schema-validation failure is never retried, since retrying cannot fix a
 * shape mismatch.
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
 * fetch boundary (T-4aa-01), picking only the fields this comparison
 * consumes and stripping everything else — matching this file's existing
 * boundary discipline. Throws on a non-2xx status or a schema-validation
 * failure; there is no honest partial-series fallback (see file header).
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
