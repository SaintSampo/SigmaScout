/**
 * Quick task 260905-tpx, Instrument B — the derivation reference for the
 * own-spread-relative RP process-noise candidate
 * (`.planning/todos/pending/rp-process-noise-own-scale.md`).
 *
 * Measures, for 2022, 2023 and 2024 only, the per-season-per-threshold-
 * variable population variance of each rating-eligible teammate's per-team
 * SHARE of that alliance-variable's observed sum — exactly the quantity
 * `packages/core/algorithms/sigma1/rp/state.ts`'s `foldRpObservation` folds
 * into `RpLeague.rpVariableMean` (`observedShare = observedSum /
 * allianceTeams.length`, folded once per rating-eligible teammate).
 *
 * Run with: npx tsx measure-rp-spread.ts
 *
 * Imports the REAL season rule modules (never reimplements threshold
 * parsing), following `packages/harness/rpConservativeBranch.ts`'s own
 * shape: read-only corpus access, plain `async function main()`, entry-point
 * guard so importing this module has no side effect.
 */
import { openCorpusReadOnly, type Corpus } from "../../../packages/corpus/db.js";
import { isRpEligibleEventType } from "../../../packages/core/algorithms/sigma1/rp/constants.js";
import { rpRuleModuleForSeason } from "../../../packages/core/algorithms/sigma1/rp/rules.js";
import { emptyExpandingStats, foldObservation, type ExpandingStats } from "../../../packages/core/scoring/expandingStats.js";

const CORPUS_PATH = "data/corpus.sqlite";
const SEASONS = [2022, 2023, 2024] as const;

// The defaults the relative constants are derived FROM (kalman.ts:76/91, params.ts:633).
const DEFAULT_WITHIN_EVENT = 0.5;
const DEFAULT_EVENT_BOUNDARY = 8;
const DEFAULT_COLD_START_VARIANCE = 25;

interface QualRow {
  match_key: string;
  event_type: number;
  score_breakdown_raw: string;
  red_teams: string;
  blue_teams: string;
  red_surrogates: string;
  blue_surrogates: string;
}

function sampleQualMatches(db: Corpus, year: number): QualRow[] {
  return db
    .prepare(
      `SELECT m.match_key, e.event_type, m.score_breakdown_raw, m.red_teams, m.blue_teams, m.red_surrogates, m.blue_surrogates
       FROM matches m
       JOIN events e ON e.event_key = m.event_key
       WHERE e.year = ? AND m.comp_level = 'qm' AND m.has_score_breakdown = 1
         AND m.winner IS NOT NULL AND e.is_offseason = 0
       ORDER BY m.sort_time ASC, m.match_key ASC`
    )
    .all(year) as QualRow[];
}

/** season -> variableName -> ExpandingStats */
type SeasonVariableStats = Map<number, Map<string, ExpandingStats>>;

function measureSeason(db: Corpus, season: number, accByVariable: Map<string, ExpandingStats>): { skippedRowCount: number; n: number } {
  const module = rpRuleModuleForSeason(season);
  const rows = sampleQualMatches(db, season);

  let skippedRowCount = 0;
  let n = 0;

  for (const row of rows) {
    if (!isRpEligibleEventType(row.event_type)) {
      skippedRowCount++;
      continue;
    }
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(row.score_breakdown_raw);
    } catch {
      skippedRowCount++;
      continue;
    }

    const sides: Array<{ side: "red" | "blue"; teams: string; surrogates: string }> = [
      { side: "red", teams: row.red_teams, surrogates: row.red_surrogates },
      { side: "blue", teams: row.blue_teams, surrogates: row.blue_surrogates },
    ];

    for (const { side, teams, surrogates } of sides) {
      let parsed: ReturnType<typeof module.parse>;
      try {
        parsed = module.parse(rawJson, side, row.event_type);
      } catch {
        skippedRowCount++;
        continue;
      }

      let teamArray: unknown[];
      let surrogateArray: unknown[];
      try {
        teamArray = JSON.parse(teams);
        surrogateArray = JSON.parse(surrogates);
      } catch {
        skippedRowCount++;
        continue;
      }
      const eligibleCount = teamArray.length - surrogateArray.length;
      if (eligibleCount <= 0) {
        // Every team on this alliance was a surrogate — the model's own
        // foldRpObservation treats this as a genuine no-op (allianceTeams.length
        // === 0). Nothing to fold.
        continue;
      }

      for (const [name, value] of Object.entries(parsed.thresholdVariables)) {
        const observedShare = value / eligibleCount;
        let stats = accByVariable.get(name) ?? emptyExpandingStats();
        for (let i = 0; i < eligibleCount; i++) stats = foldObservation(stats, observedShare);
        accByVariable.set(name, stats);
        n += eligibleCount;
      }
    }
  }

  return { skippedRowCount, n };
}

function fmt(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toFixed(digits);
}

async function main(): Promise<void> {
  const db = openCorpusReadOnly(CORPUS_PATH);
  const bySeasonVariable: SeasonVariableStats = new Map();
  const skippedBySeasoN: Map<number, number> = new Map();

  try {
    for (const season of SEASONS) {
      const accByVariable = new Map<string, ExpandingStats>();
      const { skippedRowCount } = measureSeason(db, season, accByVariable);
      bySeasonVariable.set(season, accByVariable);
      skippedBySeasoN.set(season, skippedRowCount);
    }
  } finally {
    db.close();
  }

  console.log("Per-season-per-variable RP threshold spread (measured, walk-forward-safe fold)");
  console.log("season | variable | count | mean | populationVariance (m2/count) | sqrt(variance)");
  console.log("---|---|---|---|---|---");

  // (season, variable) -> { count, variance }
  const pairs: Array<{ season: number; variable: string; count: number; variance: number }> = [];

  for (const season of SEASONS) {
    const accByVariable = bySeasonVariable.get(season)!;
    const names = Array.from(accByVariable.keys()).sort();
    for (const name of names) {
      const stats = accByVariable.get(name)!;
      const variance = stats.count >= 2 ? stats.m2 / stats.count : NaN;
      console.log(`${season} | ${name} | ${stats.count} | ${fmt(stats.mean)} | ${fmt(variance)} | ${fmt(Math.sqrt(variance))}`);
      if (stats.count >= 2) {
        pairs.push({ season, variable: name, count: stats.count, variance });
      }
    }
    console.log(`  (season ${season} skippedRowCount=${skippedBySeasoN.get(season)})`);
  }

  console.log("");
  console.log("Reference aggregates over every 2022-2024 (season, variable) pair:");

  const totalCount = pairs.reduce((s, p) => s + p.count, 0);
  const weightedMean = pairs.reduce((s, p) => s + p.variance * p.count, 0) / totalCount;
  const unweightedMean = pairs.reduce((s, p) => s + p.variance, 0) / pairs.length;

  console.log(`  WEIGHTED (observation-count-weighted mean of population variances): ${fmt(weightedMean)}`);
  console.log(`  UNWEIGHTED (simple mean across (season, variable) pairs): ${fmt(unweightedMean)}`);
  console.log("");

  console.log("Derived relative constants UNDER THE WEIGHTED aggregate (the one the patch uses):");
  console.log(`  withinEventRel   = ${DEFAULT_WITHIN_EVENT} / ${fmt(weightedMean)} = ${fmt(DEFAULT_WITHIN_EVENT / weightedMean, 10)}`);
  console.log(`  eventBoundaryRel = ${DEFAULT_EVENT_BOUNDARY} / ${fmt(weightedMean)} = ${fmt(DEFAULT_EVENT_BOUNDARY / weightedMean, 10)}`);
  console.log(`  coldStartRel     = ${DEFAULT_COLD_START_VARIANCE} / ${fmt(weightedMean)} = ${fmt(DEFAULT_COLD_START_VARIANCE / weightedMean, 10)}`);
  console.log("");

  console.log("Derived relative constants under the UNWEIGHTED aggregate (printed for comparison only):");
  console.log(`  withinEventRel   = ${DEFAULT_WITHIN_EVENT} / ${fmt(unweightedMean)} = ${fmt(DEFAULT_WITHIN_EVENT / unweightedMean, 10)}`);
  console.log(`  eventBoundaryRel = ${DEFAULT_EVENT_BOUNDARY} / ${fmt(unweightedMean)} = ${fmt(DEFAULT_EVENT_BOUNDARY / unweightedMean, 10)}`);
  console.log(`  coldStartRel     = ${DEFAULT_COLD_START_VARIANCE} / ${fmt(unweightedMean)} = ${fmt(DEFAULT_COLD_START_VARIANCE / unweightedMean, 10)}`);
}

main().catch((err) => {
  console.error("measure-rp-spread failed:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
