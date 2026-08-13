/**
 * D-04's reference row: a clearly-labelled Statbotics per-season accuracy
 * figure alongside our own numbers, so every report shows the target before
 * our own EPA reimplementation exists (Phase 2).
 *
 * Plan 01's recon (docs/data/tba-field-recon.md) found `api.statbotics.io/v3/year/{year}`
 * reproducibly returns HTTP 500 across three URL shapes; re-confirmed live
 * during this plan's execution (2026-08-13, same day). `statboticsReference`
 * still always attempts a live fetch first — a future Statbotics fix is
 * picked up automatically with no code change — but never lets a fetch
 * failure fail the run (T-01-12): any network error, non-2xx status, or
 * schema-validation failure falls back to `STATBOTICS_REFERENCE_FALLBACK`,
 * a dated manual constant. The returned object always records which path
 * produced the value (`fetched: true | false`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export interface StatboticsReference {
  season: number;
  /** Winner-prediction accuracy in [0, 1] — directly comparable to our own `winnerAccuracy`. */
  value: number;
  sourceLabel: string;
  matchPopulation: string;
  /** ISO date (YYYY-MM-DD) this value was captured or fetched. */
  capturedAt: string;
  /** `true` iff this value came from a live fetch this run; `false` iff the dated fallback was used. */
  fetched: boolean;
}

const StatboticsYearResponseSchema = z.object({
  epa_acc: z.number(),
});

/**
 * Dated manual constant (captured 2026-08-13, the date docs/data/tba-field-recon.md
 * recorded the endpoint's failure and this module's implementation re-confirmed it
 * live). KNOWN STUB: these per-season values are best-available estimates of
 * Statbotics' publicly-stated EPA winner-prediction accuracy (commonly cited in
 * the ~0.70-0.72 range) — they have NOT been individually verified against
 * Statbotics' own published blog/site figures for each season, because that
 * page renders its numbers client-side from the same broken API and this
 * pipeline has no browser-rendering capability. `sourceLabel` says so
 * explicitly and `fetched: false` marks every artifact that uses these
 * values. See "Known Stubs" in 01-05-SUMMARY.md — replace with verified,
 * individually-sourced numbers before treating any of these as a claim.
 */
export const STATBOTICS_REFERENCE_FALLBACK: Readonly<Record<number, StatboticsReference>> = {
  2022: {
    season: 2022,
    value: 0.7,
    sourceLabel: "Statbotics (dated manual constant, unverified estimate — see Known Stubs)",
    matchPopulation: "all 2022 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-08-13",
    fetched: false,
  },
  2023: {
    season: 2023,
    value: 0.7,
    sourceLabel: "Statbotics (dated manual constant, unverified estimate — see Known Stubs)",
    matchPopulation: "all 2023 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-08-13",
    fetched: false,
  },
  2024: {
    season: 2024,
    value: 0.71,
    sourceLabel: "Statbotics (dated manual constant, unverified estimate — see Known Stubs)",
    matchPopulation: "all 2024 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-08-13",
    fetched: false,
  },
  2025: {
    season: 2025,
    value: 0.71,
    sourceLabel: "Statbotics (dated manual constant, unverified estimate — see Known Stubs)",
    matchPopulation: "all 2025 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-08-13",
    fetched: false,
  },
  2026: {
    season: 2026,
    value: 0.71,
    sourceLabel: "Statbotics (dated manual constant, unverified estimate — see Known Stubs)",
    matchPopulation: "all 2026 qualification + elimination matches (Statbotics EPA model)",
    capturedAt: "2026-08-13",
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
    value: parsed.epa_acc,
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
 * failure — a Statbotics outage is context for our numbers, not an input to
 * them (T-01-12). Throws only if `season` has neither a live result nor a
 * fallback constant (outside the covered 2022-2026 range).
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
      throw new Error(`statboticsReference: no fallback constant for season ${season} (covered: 2022-2026)`);
    }
    return fallback;
  }
}
