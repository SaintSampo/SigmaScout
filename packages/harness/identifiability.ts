/**
 * SC-3's identifiability check (ALGO-03, D-06): can the observables this
 * project actually has — 3-vs-3 alliance-sum component totals, never a
 * per-robot read (RESEARCH.md Assumption A1) — pin down a per-team,
 * per-component mean the way Sigma1's Kalman update assumes? This is the
 * concrete answer to the failure log's unidentifiable 4D offense/defense/
 * time-allocation collapse: D-06's response was "estimate offense only, no
 * defense latent," and this script is the check that the response actually
 * worked, run against the real corpus rather than argued on paper.
 *
 * Standalone runnable script (`pnpm identifiability --seasons 2022-2026`),
 * following `cli.ts`'s own shape: `parseArgs`, `async function main()`, an
 * entry-point guard so importing this module never has the side effect of
 * running a real corpus pass.
 *
 * ── Sampling design (documented per this plan's own requirement — an
 * identifiability claim whose sample is undisclosed is exactly the kind of
 * undocumented reasoning this project's failure log is about) ──
 *
 * A full-season design matrix is roughly 36,000 rows x 3,700 columns
 * (`opr.ts`'s own file header). A dense SVD at that scale is not tractable:
 * `opr.ts` measured a dense solve at n=1,500 teams taking ~21s with CUBIC
 * scaling, so n≈3,700 would run for hours-to-days. This script instead
 * draws a FIXED, SEEDED subset of `SAMPLE_EVENT_COUNT` events per season —
 * a Mulberry32 PRNG seeded with `SAMPLE_SEED` below, deterministic and
 * reproducible across runs (same sample every time, not a fresh random draw
 * per invocation) — large enough that teams attending multiple sampled
 * events are common, which is what makes the alliance-participation graph
 * connected enough to test at all. Measured this session at
 * `SAMPLE_EVENT_COUNT = 25`: ~800-900 distinct teams and ~1,700-2,200
 * matches per season (2022: 775 teams/1,760 matches; 2024: 891 teams/2,190
 * matches; 2026: 781 teams/2,029 matches — sampled from a real run against
 * `data/corpus.sqlite`). Every reported number states this SAMPLED scale
 * alongside it (`sampledEventCount`/`sampledMatchCount`/`rowCount` in the
 * JSON output) — never presented as if it were a full-season result.
 *
 * ── Why rank/conditionNumber are computed ONCE per season, not once per
 * component ──
 *
 * The 0/1 design matrix (which teams' columns get a 1 in which alliance
 * observation row) is built purely from which teams shared an alliance in
 * the sampled matches — it does NOT depend on any component's actual
 * value. Every component within a season is parsed from the SAME
 * `score_breakdown` payload for the SAME alliance, so the row set (and
 * therefore the matrix) is identical for every component that season.
 * `rank`/`conditionNumber` are therefore computed once per season (via
 * `ml-matrix`'s `SingularValueDecomposition` — never a hand-rolled
 * elimination, matching `opr.ts`'s own reasoning and RESEARCH.md's Don't
 * Hand-Roll table: "early-season systems are ill-conditioned by
 * construction, and a bespoke elimination is exactly the kind of code that
 * looks finished until one team's row makes it diverge") and reported
 * IDENTICALLY for every component that season. What DOES vary per
 * component is `nonZeroFraction`/`teamsWithFiveObservations` — a component
 * whose observations are mostly zero is unidentifiable in practice even on
 * a perfectly-conditioned design matrix, which is exactly why this plan's
 * own framing ("a component observed in 3% of matches is not identifiable
 * regardless of what the condition number says") treats these as two
 * separate checks, not one.
 *
 * ── Pass/fail thresholds (stated explicitly, applied by the script, never
 * left to prose) ──
 *
 *   - `CONDITION_NUMBER_CEILING = 1e8`: double-precision floats carry
 *     ~15-16 significant decimal digits; solving a linear system with
 *     condition number C loses roughly log10(C) digits of accuracy (a
 *     standard numerical-analysis heuristic — see Golub & Van Loan's
 *     treatment of conditioning). A ceiling of 1e8 leaves ~7-8 digits of
 *     precision intact — generous headroom for FRC point totals (tens to
 *     low hundreds of points) while still catching a genuinely
 *     disconnected or near-disconnected alliance-participation graph.
 *   - `MIN_NONZERO_FRACTION = 0.05` (5%): below this, almost every team's
 *     estimate for that component is dominated by its cold-start prior
 *     rather than real data, regardless of how well-conditioned the design
 *     matrix is — a deliberately conservative floor set ABOVE the plan's
 *     own "3% is clearly not identifiable" example, so this check does not
 *     wait until the failure is already obvious to flag it.
 *   - A component additionally FAILS if the season's design matrix is not
 *     full column rank (`rank === teamColumnCount`): a rank deficiency
 *     means the alliance-participation graph is disconnected into two or
 *     more clusters whose relative ratings are not identifiable AT ALL —
 *     this would not otherwise show up as a large `conditionNumber`,
 *     because `conditionNumber` here is computed only over the surviving
 *     (non-negligible) singular values, per the SVD's own `rank` cutoff.
 *
 * A component failing any of these is not automatically a defect — D-04
 * already predicts fouls will be the weakest member of the set, and a
 * plain "fail" verdict there is exactly the honest, expected finding this
 * check exists to surface, not a bug to fix.
 */
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { Matrix, SingularValueDecomposition } from "ml-matrix";
import { openCorpusReadOnly, type Corpus } from "../corpus/db.js";
import { ratingEligibleTeams } from "../core/algorithms/opr.js";
import { componentMapForSeason, parseBreakdown } from "../core/algorithms/breakdown/index.js";

const CORPUS_PATH = "data/corpus.sqlite";
const DEFAULT_OUT_PATH = join("reports", "identifiability.json");

/** See file header for the reasoning and the measured yield at this setting. */
const SAMPLE_EVENT_COUNT = 25;
const SAMPLE_SEED = 42;

/** See file header — both stated and justified there, not just here as bare numbers. */
const CONDITION_NUMBER_CEILING = 1e8;
const MIN_NONZERO_FRACTION = 0.05;

/**
 * 2024's breakdown map (plan 02-01) predates the `diagnosticKeys`
 * convention `breakdown/constants.ts`'s header documents (`optional: 2024's
 * map predates this convention`) — this is the one documented exception,
 * sourced from this phase's RESEARCH.md-verified field table
 * (`foulCount`/`techFoulCount`, identical to 2022/2023/2025's fields)
 * rather than left unspecified.
 */
const FOUL_DIAGNOSTIC_FALLBACK: Readonly<Record<number, readonly string[]>> = {
  2024: ["foulCount", "techFoulCount"],
};

/** Deterministic PRNG (Mulberry32) — same seed always produces the same event sample, so this script's output is reproducible across runs, not a fresh random draw each time. */
export function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let t2 = Math.imul(t ^ (t >>> 15), t | 1);
    t2 ^= t2 + Math.imul(t2 ^ (t2 >>> 7), t2 | 61);
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

export interface AllianceRow {
  readonly matchKey: string;
  readonly eventKey: string;
  readonly teams: readonly string[];
  readonly components: Readonly<Record<string, number>>;
}

interface MatchDbRow {
  match_key: string;
  event_key: string;
  red_teams: string;
  blue_teams: string;
  red_surrogates: string;
  blue_surrogates: string;
  has_score_breakdown: number;
  score_breakdown_raw: string | null;
}

interface FoulDiagnostics {
  readonly fieldNames: readonly string[];
  readonly matchesWithBreakdown: number;
  readonly matchesWithAnyFoulRecorded: number;
}

interface SampleResult {
  readonly totalEventCount: number;
  readonly sampledEventCount: number;
  readonly sampledMatchCount: number;
  readonly skippedMatchCount: number;
  readonly rows: readonly AllianceRow[];
  readonly foulDiagnostics: FoulDiagnostics;
}

function foulDiagnosticKeys(season: number, diagnosticKeys: readonly string[] | undefined): readonly string[] {
  if (diagnosticKeys && diagnosticKeys.length > 0) return diagnosticKeys;
  const fallback = FOUL_DIAGNOSTIC_FALLBACK[season];
  if (fallback) return fallback;
  throw new Error(
    `identifiability: no foul diagnostic keys known for season ${season} (registered fallback seasons: ${Object.keys(FOUL_DIAGNOSTIC_FALLBACK).join(", ")})`
  );
}

/**
 * T-02-13 (threat register): reads the corpus through `openCorpusReadOnly`
 * only, matching `runSeasonsMode` — an analysis script must not be the one
 * path that can mutate the data every published figure traces back to.
 * Draws the seeded event sample, then reads every played match in those
 * events, parses each side's `score_breakdown` through the season's own
 * registered component map (throwing rows are counted and skipped, never
 * silently coerced), and separately tallies the raw foul-diagnostic fields
 * (D-04) directly off the unparsed JSON, since those fields are deliberately
 * NOT part of any component map's output.
 */
function sampleSeason(db: Corpus, season: number): SampleResult {
  const seasonMap = componentMapForSeason(season);
  const diagnosticFields = foulDiagnosticKeys(season, seasonMap.diagnosticKeys);

  const allEvents = (
    db.prepare(`SELECT event_key FROM events WHERE year = ? AND is_offseason = 0 ORDER BY event_key`).all(season) as {
      event_key: string;
    }[]
  ).map((r) => r.event_key);
  const sampledEvents = seededShuffle(allEvents, SAMPLE_SEED).slice(0, SAMPLE_EVENT_COUNT);

  if (sampledEvents.length === 0) {
    return {
      totalEventCount: allEvents.length,
      sampledEventCount: 0,
      sampledMatchCount: 0,
      skippedMatchCount: 0,
      rows: [],
      foulDiagnostics: { matchesWithBreakdown: 0, matchesWithAnyFoulRecorded: 0, fieldNames: diagnosticFields },
    };
  }

  const placeholders = sampledEvents.map(() => "?").join(",");
  const matchRows = db
    .prepare(
      `SELECT match_key, event_key, red_teams, blue_teams, red_surrogates, blue_surrogates, has_score_breakdown, score_breakdown_raw
       FROM matches WHERE event_key IN (${placeholders}) AND winner IS NOT NULL`
    )
    .all(...sampledEvents) as MatchDbRow[];

  const rows: AllianceRow[] = [];
  let skippedMatchCount = 0;
  let matchesWithBreakdown = 0;
  let matchesWithAnyFoulRecorded = 0;

  for (const row of matchRows) {
    if (row.has_score_breakdown !== 1 || row.score_breakdown_raw === null) continue;

    let rawJson: unknown;
    let redParsed: Readonly<Record<string, number>>;
    let blueParsed: Readonly<Record<string, number>>;
    try {
      rawJson = JSON.parse(row.score_breakdown_raw);
      redParsed = parseBreakdown(season, row.score_breakdown_raw, "red")!;
      blueParsed = parseBreakdown(season, row.score_breakdown_raw, "blue")!;
    } catch {
      // A malformed/unexpected payload for this match — counted, never
      // silently coerced to zero (ASVS V5, matching this phase's other
      // parse boundaries).
      skippedMatchCount++;
      continue;
    }

    matchesWithBreakdown++;
    const rawObj = rawJson as { red?: Record<string, unknown>; blue?: Record<string, unknown> };
    const hasFoul = diagnosticFields.some((key) => {
      const redVal = Number(rawObj.red?.[key] ?? 0);
      const blueVal = Number(rawObj.blue?.[key] ?? 0);
      return redVal > 0 || blueVal > 0;
    });
    if (hasFoul) matchesWithAnyFoulRecorded++;

    const redTeamsRaw = JSON.parse(row.red_teams) as string[];
    const blueTeamsRaw = JSON.parse(row.blue_teams) as string[];
    const redSurrogates = JSON.parse(row.red_surrogates) as string[];
    const blueSurrogates = JSON.parse(row.blue_surrogates) as string[];

    const redTeams = ratingEligibleTeams(redTeamsRaw, redSurrogates);
    const blueTeams = ratingEligibleTeams(blueTeamsRaw, blueSurrogates);

    // An all-surrogate alliance contributes no observation — matches
    // opr.ts's/sigma1's own no-op treatment of the same case.
    if (redTeams.length > 0)
      rows.push({ matchKey: row.match_key, eventKey: row.event_key, teams: redTeams, components: redParsed });
    if (blueTeams.length > 0)
      rows.push({ matchKey: row.match_key, eventKey: row.event_key, teams: blueTeams, components: blueParsed });
  }

  return {
    totalEventCount: allEvents.length,
    sampledEventCount: sampledEvents.length,
    sampledMatchCount: matchRows.length,
    skippedMatchCount,
    rows,
    foulDiagnostics: { matchesWithBreakdown, matchesWithAnyFoulRecorded, fieldNames: diagnosticFields },
  };
}

export interface DesignMatrixResult {
  readonly rowCount: number;
  readonly teamColumnCount: number;
  readonly rank: number;
  readonly largestSingularValue: number;
  readonly smallestNonNegligibleSingularValue: number;
  readonly conditionNumber: number;
  readonly fullColumnRank: boolean;
}

/**
 * Builds the shared 0/1 alliance-participation design matrix from `rows`
 * and runs `ml-matrix`'s `SingularValueDecomposition` over it — see file
 * header for why this is computed once per season rather than once per
 * component.
 */
export function computeDesignMatrix(rows: readonly AllianceRow[]): DesignMatrixResult {
  const teamIndex = new Map<string, number>();
  for (const row of rows) {
    for (const team of row.teams) {
      if (!teamIndex.has(team)) teamIndex.set(team, teamIndex.size);
    }
  }
  const teamColumnCount = teamIndex.size;
  const rowCount = rows.length;

  if (rowCount === 0 || teamColumnCount === 0) {
    return {
      rowCount,
      teamColumnCount,
      rank: 0,
      largestSingularValue: 0,
      smallestNonNegligibleSingularValue: 0,
      conditionNumber: Number.POSITIVE_INFINITY,
      fullColumnRank: false,
    };
  }

  const M = Matrix.zeros(rowCount, teamColumnCount);
  rows.forEach((row, r) => {
    for (const team of row.teams) {
      M.set(r, teamIndex.get(team)!, 1);
    }
  });

  const svd = new SingularValueDecomposition(M);
  const rank = svd.rank;
  const diagonal = svd.diagonal;
  const largestSingularValue = diagonal[0] ?? 0;
  const smallestNonNegligibleSingularValue = rank > 0 ? diagonal[rank - 1]! : 0;
  const conditionNumber =
    rank > 0 && smallestNonNegligibleSingularValue > 0 ? largestSingularValue / smallestNonNegligibleSingularValue : Number.POSITIVE_INFINITY;

  return {
    rowCount,
    teamColumnCount,
    rank,
    largestSingularValue,
    smallestNonNegligibleSingularValue,
    conditionNumber,
    fullColumnRank: rank === teamColumnCount,
  };
}

export interface ConnectedComponentInfo {
  readonly componentIndex: number;
  readonly teamCount: number;
  readonly eventKeys: readonly string[];
}

export interface ConnectedComponentsResult {
  readonly componentCount: number;
  /** Sorted descending by `teamCount` — index 0 is the primary (largest) component. */
  readonly components: readonly ConnectedComponentInfo[];
}

/**
 * Gap 1 (02-06 checkpoint follow-up): when a season's design matrix is not
 * full column rank, `evaluateComponent`'s `reasons` already says the
 * participation graph is disconnected — but not WHICH events form the
 * disconnected islands. This is the union-find pass that answers that,
 * shipped in the script itself rather than left as an ad-hoc, uncommitted
 * pass, so the attribution in `sigma1-identifiability.md` is reproducible
 * by re-running `pnpm identifiability`, not merely asserted.
 *
 * Connectivity model: every `AllianceRow` is a hyperedge over the 2-3
 * rating-eligible teams that shared that alliance — union all teams in a
 * row together. This is the same connectivity `computeDesignMatrix`'s rank
 * deficiency already detects (a rank-deficient alliance-participation
 * design matrix means this graph has more than one component; the design
 * matrix's rank equals `teamColumnCount - componentCount + 1` for a
 * connected-clique-per-row incidence structure like this one — the
 * standard OPR-style system matrix result), computed independently here via
 * plain union-find rather than re-derived from the SVD, so the two checks
 * corroborate each other rather than one being a restatement of the other.
 *
 * Deterministic: driven entirely by `rows`, which is itself the fixed,
 * seeded sample `sampleSeason` already produced — no additional randomness
 * is introduced here, so the same corpus + the same `SAMPLE_SEED` always
 * yields the same component structure.
 */
export function computeConnectedComponents(rows: readonly AllianceRow[]): ConnectedComponentsResult {
  const teamIndex = new Map<string, number>();
  for (const row of rows) {
    for (const team of row.teams) {
      if (!teamIndex.has(team)) teamIndex.set(team, teamIndex.size);
    }
  }
  const n = teamIndex.size;
  if (n === 0) return { componentCount: 0, components: [] };

  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (const row of rows) {
    if (row.teams.length === 0) continue;
    const first = teamIndex.get(row.teams[0]!)!;
    for (let i = 1; i < row.teams.length; i++) {
      union(first, teamIndex.get(row.teams[i]!)!);
    }
  }

  const rootToTeamCount = new Map<number, number>();
  for (const team of teamIndex.keys()) {
    const root = find(teamIndex.get(team)!);
    rootToTeamCount.set(root, (rootToTeamCount.get(root) ?? 0) + 1);
  }

  const rootToEvents = new Map<number, Set<string>>();
  for (const row of rows) {
    if (row.teams.length === 0) continue;
    const root = find(teamIndex.get(row.teams[0]!)!);
    if (!rootToEvents.has(root)) rootToEvents.set(root, new Set());
    rootToEvents.get(root)!.add(row.eventKey);
  }

  const unsorted = [...rootToTeamCount.entries()].map(([root, teamCount]) => ({
    teamCount,
    eventKeys: [...(rootToEvents.get(root) ?? new Set<string>())].sort(),
  }));
  unsorted.sort((a, b) => b.teamCount - a.teamCount);

  return {
    componentCount: unsorted.length,
    components: unsorted.map((c, i) => ({ componentIndex: i, teamCount: c.teamCount, eventKeys: c.eventKeys })),
  };
}

interface ComponentVerdict {
  readonly rank: number;
  readonly conditionNumber: number | null;
  readonly largestSingularValue: number;
  readonly smallestNonNegligibleSingularValue: number;
  readonly nonZeroFraction: number;
  readonly teamsWithFiveObservations: number;
  readonly verdict: "pass" | "fail";
  readonly reasons: readonly string[];
}

/** Applies the thresholds from the file header to one component, given the season's shared design matrix. */
function evaluateComponent(component: string, rows: readonly AllianceRow[], design: DesignMatrixResult): ComponentVerdict {
  let nonZeroCount = 0;
  const perTeamNonZero = new Map<string, number>();
  for (const row of rows) {
    const value = row.components[component] ?? 0;
    const isNonZero = Math.abs(value) > 1e-9;
    if (isNonZero) {
      nonZeroCount++;
      for (const team of row.teams) perTeamNonZero.set(team, (perTeamNonZero.get(team) ?? 0) + 1);
    }
  }
  const nonZeroFraction = rows.length > 0 ? nonZeroCount / rows.length : 0;
  const teamsWithFiveObservations = [...perTeamNonZero.values()].filter((count) => count >= 5).length;

  const reasons: string[] = [];
  if (!design.fullColumnRank) {
    reasons.push(
      `design matrix rank ${design.rank} < ${design.teamColumnCount} team columns — participation graph is disconnected, some teams' relative ratings are not identifiable at all this season`
    );
  }
  if (design.conditionNumber > CONDITION_NUMBER_CEILING) {
    reasons.push(
      `condition number ${design.conditionNumber.toExponential(3)} exceeds ceiling ${CONDITION_NUMBER_CEILING.toExponential(0)}`
    );
  }
  if (nonZeroFraction < MIN_NONZERO_FRACTION) {
    reasons.push(
      `non-zero observation fraction ${(nonZeroFraction * 100).toFixed(1)}% is below the ${(MIN_NONZERO_FRACTION * 100).toFixed(0)}% floor`
    );
  }

  return {
    rank: design.rank,
    conditionNumber: Number.isFinite(design.conditionNumber) ? design.conditionNumber : null,
    largestSingularValue: design.largestSingularValue,
    smallestNonNegligibleSingularValue: design.smallestNonNegligibleSingularValue,
    nonZeroFraction,
    teamsWithFiveObservations,
    verdict: reasons.length === 0 ? "pass" : "fail",
    reasons,
  };
}

function parseSeasonsRange(spec: string): number[] {
  const rangeMatch = /^(\d{4})-(\d{4})$/.exec(spec);
  if (!rangeMatch) {
    throw new Error(`--seasons must be a range like "2022-2026", got "${spec}"`);
  }
  const start = Number.parseInt(rangeMatch[1]!, 10);
  const end = Number.parseInt(rangeMatch[2]!, 10);
  if (end < start) {
    throw new Error(`--seasons range end (${end}) must be >= start (${start})`);
  }
  const seasons: number[] = [];
  for (let year = start; year <= end; year++) seasons.push(year);
  return seasons;
}

function fmtCondition(value: number): string {
  return Number.isFinite(value) ? value.toExponential(3) : "Infinity";
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      seasons: { type: "string" },
      "identifiability-out": { type: "string" },
    },
  });
  if (!values.seasons) {
    throw new Error("--seasons is required (e.g. --seasons 2022-2026)");
  }
  const seasons = parseSeasonsRange(values.seasons);
  const outPath = values["identifiability-out"] ?? DEFAULT_OUT_PATH;

  const db = openCorpusReadOnly(CORPUS_PATH); // T-02-13: read-only, matching runSeasonsMode
  const seasonResults: Record<string, unknown> = {};
  try {
    for (const season of seasons) {
      const seasonMap = componentMapForSeason(season);
      const sample = sampleSeason(db, season);
      const design = computeDesignMatrix(sample.rows);

      console.log(
        `Season ${season}: sampled ${sample.sampledEventCount}/${sample.totalEventCount} events, ` +
          `${sample.rows.length} alliance observations from ${sample.sampledMatchCount} matches ` +
          `(${sample.skippedMatchCount} skipped) — design matrix ${design.rowCount}x${design.teamColumnCount}, ` +
          `rank ${design.rank}, condition number ${fmtCondition(design.conditionNumber)}`
      );

      // Gap 1: attribute WHICH events form the disconnected islands, not
      // just that the graph is disconnected — see computeConnectedComponents's
      // header for why this reuses the design matrix's own connectivity.
      let connectedComponents: ConnectedComponentsResult | null = null;
      if (!design.fullColumnRank) {
        connectedComponents = computeConnectedComponents(sample.rows);
        console.log(
          `  [${season}] participation graph disconnected: ${connectedComponents.componentCount} components ` +
            `(sizes ${connectedComponents.components.map((c) => c.teamCount).join(", ")})`
        );
        for (const component of connectedComponents.components.slice(1)) {
          console.log(
            `    component #${component.componentIndex} — ${component.teamCount} teams, events: ${component.eventKeys.join(", ")}`
          );
        }
      }

      const components: Record<string, ComponentVerdict> = {};
      for (const component of seasonMap.components) {
        const verdict = evaluateComponent(component, sample.rows, design);
        components[component] = verdict;
        console.log(
          `  [${season}] ${component}: ${verdict.verdict.toUpperCase()} — rank=${verdict.rank} ` +
            `condition=${verdict.conditionNumber !== null ? verdict.conditionNumber.toExponential(3) : "Infinity"} ` +
            `nonZeroFraction=${(verdict.nonZeroFraction * 100).toFixed(1)}% teamsWith5Obs=${verdict.teamsWithFiveObservations}` +
            `${verdict.reasons.length > 0 ? ` (${verdict.reasons.join("; ")})` : ""}`
        );
      }

      const foulFraction =
        sample.foulDiagnostics.matchesWithBreakdown > 0
          ? sample.foulDiagnostics.matchesWithAnyFoulRecorded / sample.foulDiagnostics.matchesWithBreakdown
          : 0;
      console.log(
        `  [${season}] foul diagnostics (${sample.foulDiagnostics.fieldNames.join("/")}): ` +
          `${sample.foulDiagnostics.matchesWithAnyFoulRecorded}/${sample.foulDiagnostics.matchesWithBreakdown} matches ` +
          `(${(foulFraction * 100).toFixed(1)}%) recorded any foul`
      );

      seasonResults[String(season)] = {
        totalEventCount: sample.totalEventCount,
        sampledEventCount: sample.sampledEventCount,
        sampledMatchCount: sample.sampledMatchCount,
        skippedMatchCount: sample.skippedMatchCount,
        designMatrix: {
          rowCount: design.rowCount,
          teamColumnCount: design.teamColumnCount,
          rank: design.rank,
          largestSingularValue: design.largestSingularValue,
          smallestNonNegligibleSingularValue: design.smallestNonNegligibleSingularValue,
          conditionNumber: Number.isFinite(design.conditionNumber) ? design.conditionNumber : null,
          fullColumnRank: design.fullColumnRank,
        },
        // Gap 1: only emitted when the graph is actually disconnected — a
        // fully-connected season has nothing to attribute (componentCount
        // would trivially be 1).
        connectedComponents:
          connectedComponents === null
            ? null
            : {
                componentCount: connectedComponents.componentCount,
                components: connectedComponents.components.map((c) => ({
                  componentIndex: c.componentIndex,
                  teamCount: c.teamCount,
                  eventKeys: c.eventKeys,
                })),
              },
        foulDiagnostics: {
          fieldNames: sample.foulDiagnostics.fieldNames,
          matchesWithBreakdown: sample.foulDiagnostics.matchesWithBreakdown,
          matchesWithAnyFoulRecorded: sample.foulDiagnostics.matchesWithAnyFoulRecorded,
          fraction: foulFraction,
        },
        components,
      };
    }
  } finally {
    db.close();
  }

  const result = {
    generatedAt: new Date().toISOString(),
    samplingDesign: {
      seed: SAMPLE_SEED,
      eventsPerSeasonRequested: SAMPLE_EVENT_COUNT,
      conditionNumberCeiling: CONDITION_NUMBER_CEILING,
      minNonZeroFraction: MIN_NONZERO_FRACTION,
    },
    seasons: seasonResults,
  };

  // T-02-02 (threat register): mirrors writeArtifact's / predictions.ts's /
  // metricHistory.ts's secret-scrub discipline. This script only opens the
  // corpus read-only (T-02-13) and never has the TBA API key in scope (no
  // network calls happen here) — there is nothing to scrub, matching
  // runSeasonsMode's own `secretToScrub: undefined` precedent.
  const serialized = JSON.stringify(result, null, 2);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialized, "utf8");
  console.log(`Wrote ${outPath}`);
}

// Guard: only auto-run `main()` when this file is the process entry point,
// matching cli.ts's own guard — importing this module must never have the
// side effect of running a real corpus pass.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("identifiability failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
