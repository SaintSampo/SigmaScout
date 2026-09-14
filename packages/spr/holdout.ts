/**
 * Paired walk-forward evaluation on 2023-2026.
 *
 * Scores one parameter file (incumbent only) or two (incumbent vs candidate,
 * paired over the same match stream) on the 2023-2026 seasons. The design
 * years (2016-2022) are evaluated by `cli.ts`; this entry point covers the
 * later seasons. 2023-2026 was released for use on 2026-09-14 (quick task
 * 260914-ndu), so a run needs no special flag and may be repeated.
 *
 * `--years` binds the halt-after season to the maximum year named. Naming
 * 2023 therefore means the replay stops at the end of 2023 and a 2024
 * match is never stepped at all, which keeps a single-season run cheap.
 */
import { pathToFileURL } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
// A parameterless resampler: no tuned knobs, no season-specific knowledge.
// Reusing the tested helper is strictly better than a fourth hand-rolled one.
import { eventBlockedBootstrap } from "../harness/eventBootstrap.js";
import { accuracyCall } from "../core/scoring/brier.js";
import { HOLDOUT_YEARS, matches } from "./cli.js";
import { runEval, formatResult } from "./evaluate.js";
import type { BprMatch } from "./data.js";
import { DEFAULTS, type BprParams } from "./model.js";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Resolves `--years` against HOLDOUT_YEARS. A design year is rejected with a
 * message pointing at cli.ts, so the two eras stay reachable only through
 * their own entry points.
 */
export function resolveYears(csv: string | undefined): {
  years: Set<number>;
  stopAfterYear: number;
} {
  if (csv === undefined) {
    const years = new Set(HOLDOUT_YEARS);
    return { years, stopAfterYear: Math.max(...years) };
  }
  const years = new Set<number>();
  for (const raw of csv.split(",")) {
    const y = Number(raw.trim());
    if (!Number.isFinite(y)) throw new Error(`holdout: bad year in "${csv}"`);
    if (!HOLDOUT_YEARS.has(y)) {
      throw new Error(
        `holdout: ${y} is not a holdout year - design years (2016-2022) are evaluated by packages/spr/cli.ts`,
      );
    }
    years.add(y);
  }
  if (years.size === 0) throw new Error(`holdout: --years named no years`);
  // The halt-after year is bound to the maximum named year, so naming 2023
  // structurally prevents stepping a single 2024 match.
  return { years, stopAfterYear: Math.max(...years) };
}

function load(path: string): BprParams {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { params?: BprParams };
  return { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };
}

/**
 * One match, scored by both models. Exported (with the two statistics
 * below) so a design-era contrast measures the same quantity with the same
 * code a 2023-2026 run uses, rather than a second hand-rolled approximation
 * of it.
 */
export interface Paired {
  readonly eventKey: string;
  readonly matchKey: string;
  readonly season: number;
  readonly compLevel: string;
  readonly eventType: number;
  readonly actualWinner: BprMatch["winner"];
  readonly pIncumbent: number;
  readonly pCandidate: number;
}

export function meanBrierDelta(units: readonly Paired[]): number {
  if (units.length === 0) return 0;
  let sum = 0;
  for (const u of units) {
    const t = u.actualWinner === "red" ? 1 : u.actualWinner === "blue" ? 0 : 0.5;
    sum += (u.pCandidate - t) ** 2 - (u.pIncumbent - t) ** 2;
  }
  return sum / units.length;
}

export function meanAccuracyDelta(units: readonly Paired[]): number {
  let n = 0;
  let sum = 0;
  for (const u of units) {
    const inc = accuracyCall({ pRedWin: u.pIncumbent, actualWinner: u.actualWinner });
    const cand = accuracyCall({ pRedWin: u.pCandidate, actualWinner: u.actualWinner });
    if (inc === null || cand === null) continue;
    n += 1;
    sum += (cand ? 1 : 0) - (inc ? 1 : 0);
  }
  return n > 0 ? sum / n : 0;
}

function main(): void {
  const path = process.argv[2];
  if (path === undefined || path.startsWith("--")) {
    throw new Error("usage: holdout.ts <frozen-params.json> [--candidate <p>] [--years <csv>] [--out <jsonl>] [--dry-run]");
  }

  const dryRun = process.argv.includes("--dry-run");
  const candidatePath = argValue("--candidate");
  const outPath = argValue("--out");
  const { years, stopAfterYear } = resolveYears(argValue("--years"));

  console.log("SPR 2023-2026 evaluation");
  console.log(`  incumbent:     ${path}`);
  console.log(`  candidate:     ${candidatePath ?? "(none - incumbent only)"}`);
  console.log(`  seasons:       ${[...years].sort((a, b) => a - b).join(", ")}`);
  console.log(`  halt after:    ${stopAfterYear}  (no match from a later season is stepped)`);
  console.log(`  out:           ${outPath ?? "(none)"}`);

  if (dryRun) {
    console.log("");
    console.log("  --dry-run: plan resolved, NOTHING evaluated. No season was read.");
    return;
  }

  const params = load(path);

  if (candidatePath === undefined) {
    console.log("");
    const all = runEval(matches(), params, { scoreYears: years, stopAfterYear });
    console.log(formatResult(all, "ALL matches (quals + playoffs)"));
    console.log("");
    const quals = runEval(matches(), params, { scoreYears: years, stopAfterYear, qualsOnly: true });
    console.log(formatResult(quals, "Qualification matches only"));
    return;
  }

  // ---- Paired incumbent-vs-candidate over the SAME match stream. ----
  const candidateParams = load(candidatePath);
  const collect = (p: BprParams): Map<string, { m: BprMatch; pRed: number }> => {
    const out = new Map<string, { m: BprMatch; pRed: number }>();
    runEval(matches(), p, {
      scoreYears: years,
      stopAfterYear,
      onScored: (m, pRed) => out.set(m.matchKey, { m, pRed }),
    });
    return out;
  };
  const inc = collect(params);
  const cand = collect(candidateParams);

  const units: Paired[] = [];
  for (const [key, i] of inc) {
    const c = cand.get(key);
    if (c === undefined) continue;
    units.push({
      eventKey: i.m.eventKey,
      matchKey: key,
      season: i.m.year,
      compLevel: i.m.compLevel,
      eventType: i.m.eventType,
      actualWinner: i.m.winner,
      pIncumbent: i.pRed,
      pCandidate: c.pRed,
    });
  }

  if (outPath !== undefined) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, units.map((u) => JSON.stringify(u)).join("\n") + "\n");
  }

  console.log("");
  console.log(formatResult(runEval(matches(), params, { scoreYears: years, stopAfterYear }), "INCUMBENT"));
  console.log("");
  console.log(formatResult(runEval(matches(), candidateParams, { scoreYears: years, stopAfterYear }), "CANDIDATE"));
  console.log("");

  const report = (label: string, pool: readonly Paired[]): void => {
    if (pool.length < 2) {
      console.log(`  ${label.padEnd(22)} (too few matches to measure)`);
      return;
    }
    const acc = eventBlockedBootstrap(pool, (s) => meanAccuracyDelta(s as Paired[]));
    const bri = eventBlockedBootstrap(pool, (s) => meanBrierDelta(s as Paired[]));
    console.log(
      `  ${label.padEnd(22)} n=${String(pool.length).padStart(6)} events=${String(acc.eventCount).padStart(4)}  ` +
        `dAcc ${(100 * acc.pointEstimate >= 0 ? "+" : "") + (100 * acc.pointEstimate).toFixed(3)}pp ` +
        `[${(100 * acc.percentile.lower).toFixed(3)}, ${(100 * acc.percentile.upper).toFixed(3)}] ` +
        `SE ${(100 * acc.standardError).toFixed(3)}  |  ` +
        `dBrier ${(bri.pointEstimate >= 0 ? "+" : "") + bri.pointEstimate.toFixed(5)} ` +
        `[${bri.percentile.lower.toFixed(5)}, ${bri.percentile.upper.toFixed(5)}]`,
    );
  };

  console.log("PAIRED candidate - incumbent (event-blocked, same matches both models)");
  report("combined", units);
  report("champs (type 2,3,4)", units.filter((u) => u.eventType >= 2 && u.eventType <= 4));
  report("non-champs", units.filter((u) => u.eventType < 2 || u.eventType > 4));
}

// Only run when invoked directly. holdout.test.ts imports `resolveYears` from
// this module, and an unguarded main() would make merely importing it throw
// (no parameter file argument) or start a full evaluation.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
