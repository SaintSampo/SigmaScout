/**
 * SC-4 gap-closure (03-VERIFICATION.md, 03-08-PLAN.md): quantifies the
 * conservative-branch understatement `RpRuleModule.predictThresholds`'s doc
 * comment (`rp/constants.ts`) describes but never measured — the "evaluated
 * at its LESS-likely-to-achieve branch... UNDERSTATES that bonus's predicted
 * probability, never overstates it" claim. This script tests the "never
 * overstates" half rather than repeating it.
 *
 * Standalone runnable script (`pnpm rp:conservative-branch`), following
 * `identifiability.ts`'s own shape: no `parseArgs` options are needed here
 * (this script always covers every registered season — `RP_REGISTERED_SEASONS`
 * is the single source of that set, exactly `rules.ts`'s own dispatch-table
 * discipline), but the same `async function main()` + entry-point guard
 * pattern is used so importing this module never has the side effect of
 * running a real corpus pass.
 *
 * ── The measurement, isolated exactly ──
 *
 * `parse()` and `predictThresholds()` are fed the SAME observed values for
 * every played, non-offseason `qm` alliance-match: `parsed =
 * module.parse(rawJson, side, eventType)`, then `predicted =
 * module.predictThresholds(parsed.thresholdVariables, eventType)`. Any
 * difference between `parsed.bonusFlags[b]` and `predicted.bonusFlags[b]` is
 * attributable ENTIRELY to the untracked alliance-level gating signal
 * `predictThresholds` cannot see (coopertition flags, per-robot auto-leave
 * state) — every other input was identical, so there is no sampling noise
 * and no prediction uncertainty in this comparison, unlike a Monte Carlo
 * draw through `rp/distribution.ts`.
 *
 * Per (season, bonus): `understatedRate` = fraction of alliance-matches where
 * `parsed=true, predicted=false`; `overstatedRate` = the reverse (the
 * falsifiable half of the "never overstates" claim — reported plainly if
 * non-zero, never buried); `meanRpUnderstatement` = mean per-alliance-match
 * contribution of THIS bonus to `parsed.totalRp - predicted.totalRp` (i.e.
 * `understatedRate - overstatedRate`, since each bonus contributes exactly
 * +1/-1/0 to that difference per alliance-match — summing every bonus's
 * `meanRpUnderstatement` for a season reproduces the season-level mean of
 * `parsed.totalRp - predicted.totalRp` exactly, by construction); `n` = the
 * alliance-match count the rates are over (identical across every bonus in
 * a season, since all bonuses share the same row set).
 *
 * Every season 2022-2026 is run, including 2022/2026 whose `predictThresholds`
 * has no untracked gating signal at all (see each module's own header) — a
 * measured 0.0000 there is evidence the measurement discriminates affected
 * seasons from unaffected ones, not filler.
 *
 * Read-only and offline (T-03-25): opens the corpus with `openCorpusReadOnly`
 * only, writes no algorithm state, and its only output is this report — a
 * console table plus a gitignored JSON artifact under `reports/`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { openCorpusReadOnly, type Corpus } from "../corpus/db.js";
import { isRpEligibleEventType } from "../core/algorithms/sigma1/rp/constants.js";
import { RP_REGISTERED_SEASONS, rpRuleModuleForSeason } from "../core/algorithms/sigma1/rp/rules.js";

const CORPUS_PATH = "data/corpus.sqlite";
const DEFAULT_OUT_PATH = join("reports", "rpConservativeBranch.json");

interface QualRow {
  match_key: string;
  event_type: number;
  score_breakdown_raw: string;
}

/**
 * FULL season population — played, non-offseason `qm` matches with a
 * breakdown, mirroring `reconciliation.test.ts`'s `sampleQualMatches`
 * exactly (no `LIMIT`, `ORDER BY match_key ASC` for deterministic,
 * byte-identical-across-runs stdout).
 */
function sampleQualMatches(db: Corpus, year: number): QualRow[] {
  return db
    .prepare(
      `SELECT m.match_key, e.event_type, m.score_breakdown_raw
       FROM matches m
       JOIN events e ON e.event_key = m.event_key
       WHERE e.year = ? AND m.comp_level = 'qm' AND m.has_score_breakdown = 1
         AND m.winner IS NOT NULL AND e.is_offseason = 0
       ORDER BY m.match_key ASC`
    )
    .all(year) as QualRow[];
}

interface BonusAccumulator {
  understatedCount: number;
  overstatedCount: number;
  n: number;
}

interface BonusReport {
  season: number;
  bonus: string;
  understatedCount: number;
  overstatedCount: number;
  n: number;
  understatedRate: number;
  overstatedRate: number;
  meanRpUnderstatement: number;
}

interface SeasonReport {
  season: number;
  n: number;
  skippedRowCount: number;
  bonuses: readonly BonusReport[];
}

/**
 * Runs the isolated comparison for one season and returns a report per
 * bonus, in `module.bonusNames` order (a season's own declared order, not
 * re-sorted) so the printed table's row order is stable and traceable back
 * to the season module's own source.
 */
function measureSeason(db: Corpus, season: number): SeasonReport {
  const module = rpRuleModuleForSeason(season);
  const rows = sampleQualMatches(db, season);

  const accumulators = new Map<string, BonusAccumulator>();
  for (const bonus of module.bonusNames) {
    accumulators.set(bonus, { understatedCount: 0, overstatedCount: 0, n: 0 });
  }

  let skippedRowCount = 0;
  for (const row of rows) {
    if (!isRpEligibleEventType(row.event_type)) {
      // Defensive — `is_offseason = 0` in the query already excludes 99,
      // but this re-derives eligibility from the single source of truth
      // (`isRpEligibleEventType`) rather than trusting the SQL filter alone.
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

    for (const side of ["red", "blue"] as const) {
      let parsed: ReturnType<typeof module.parse>;
      try {
        parsed = module.parse(rawJson, side, row.event_type);
      } catch {
        // A malformed/unexpected payload for this alliance-match — counted,
        // never silently coerced (ASVS V5, matching this phase's other
        // parse boundaries).
        skippedRowCount++;
        continue;
      }
      const predicted = module.predictThresholds(parsed.thresholdVariables, row.event_type);

      for (const bonus of module.bonusNames) {
        const acc = accumulators.get(bonus)!;
        const p = parsed.bonusFlags[bonus] === true;
        const q = predicted.bonusFlags[bonus] === true;
        acc.n++;
        if (p && !q) acc.understatedCount++;
        if (!p && q) acc.overstatedCount++;
      }
    }
  }

  const bonuses: BonusReport[] = module.bonusNames.map((bonus) => {
    const acc = accumulators.get(bonus)!;
    const understatedRate = acc.n > 0 ? acc.understatedCount / acc.n : 0;
    const overstatedRate = acc.n > 0 ? acc.overstatedCount / acc.n : 0;
    return {
      season,
      bonus,
      understatedCount: acc.understatedCount,
      overstatedCount: acc.overstatedCount,
      n: acc.n,
      understatedRate,
      overstatedRate,
      meanRpUnderstatement: understatedRate - overstatedRate,
    };
  });

  const n = bonuses[0]?.n ?? 0;
  return { season, n, skippedRowCount, bonuses };
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(4)}%`;
}

function fmtRp(value: number): string {
  return value.toFixed(6);
}

async function main(): Promise<void> {
  if (!existsSync(CORPUS_PATH)) {
    console.log(`rp:conservative-branch skipped: ${CORPUS_PATH} not found — run the ingest pipeline (pnpm ingest) first`);
    return;
  }

  const outPath = DEFAULT_OUT_PATH;
  const db = openCorpusReadOnly(CORPUS_PATH);
  const seasonReports: SeasonReport[] = [];
  try {
    for (const season of RP_REGISTERED_SEASONS) {
      seasonReports.push(measureSeason(db, season));
    }
  } finally {
    db.close();
  }

  console.log("Conservative-branch understatement report — season x bonus (SC-4 gap closure)");
  console.log("season | bonus | understatedRate | overstatedRate | meanRpUnderstatement | n");
  const anyOverstated: BonusReport[] = [];
  for (const seasonReport of seasonReports) {
    for (const row of seasonReport.bonuses) {
      console.log(
        `${row.season} | ${row.bonus} | ${fmtPct(row.understatedRate)} | ${fmtPct(row.overstatedRate)} | ${fmtRp(row.meanRpUnderstatement)} | ${row.n}`
      );
      if (row.overstatedCount > 0) anyOverstated.push(row);
    }
  }

  if (anyOverstated.length > 0) {
    console.log(
      `OVERSTATED FOUND: the "conservative, never overstates" claim is FALSE for: ${anyOverstated
        .map((r) => `${r.season} ${r.bonus} (${fmtPct(r.overstatedRate)})`)
        .join(", ")}`
    );
  } else {
    console.log('Overstated check: no bonus in any season showed a non-zero overstatedRate — the "never overstates" claim held under measurement.');
  }

  const result = {
    generatedAt: null as string | null, // intentionally omitted from stdout-affecting content; see below
    seasons: Object.fromEntries(
      seasonReports.map((sr) => [
        String(sr.season),
        {
          n: sr.n,
          skippedRowCount: sr.skippedRowCount,
          bonuses: Object.fromEntries(
            sr.bonuses.map((b) => [
              b.bonus,
              {
                understatedCount: b.understatedCount,
                overstatedCount: b.overstatedCount,
                n: b.n,
                understatedRate: b.understatedRate,
                overstatedRate: b.overstatedRate,
                meanRpUnderstatement: b.meanRpUnderstatement,
              },
            ])
          ),
        },
      ])
    ),
  };
  // `generatedAt` is populated only in the written JSON artifact (never
  // printed to stdout) so `pnpm rp:conservative-branch`'s stdout stays
  // byte-identical across runs regardless of when it is invoked.
  result.generatedAt = new Date().toISOString();

  const serialized = JSON.stringify(result, null, 2);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialized, "utf8");
  console.log(`Wrote ${outPath}`);
}

// Guard: only auto-run `main()` when this file is the process entry point,
// matching `identifiability.ts`'s own guard — importing this module must
// never have the side effect of running a real corpus pass.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("rp:conservative-branch failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
