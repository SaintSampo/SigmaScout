/**
 * SINGLE-SHOT holdout evaluation on 2023-2026.
 *
 * This is the only file in the package permitted to score the holdout seasons.
 * It refuses to run unless every SEALED PATH — the model, the evaluator, the
 * data loader, the driver, the shipped port, and the parameter files a run
 * names — is committed with a clean working tree, and it prints a blob sha for
 * each, so the numbers it prints provably belong to one specific revision.
 * Re-running it after editing the model and re-tuning would silently turn the
 * holdout into a second training set; the git check is what makes that misuse
 * visible rather than invisible.
 *
 * `--years` binds the HALT-AFTER season to the maximum year named. Naming 2023
 * therefore means the replay stops at the end of 2023 and a 2024 match is never
 * stepped at all — the later seasons stay genuinely unspent as a structural
 * consequence of the loop bound, not as a promise about what gets printed.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
// A parameterless resampler: no tuned knobs, no VPR knowledge, no information
// about any season. Reusing the tested helper does NOT breach the b4t design
// firewall (which exists to keep VPR's TUNED parameters out of BPR's design),
// and is strictly better than adding a fourth hand-rolled resampler.
import { eventBlockedBootstrap } from "../harness/eventBootstrap.js";
import { accuracyCall } from "../core/scoring/brier.js";
import { HOLDOUT_YEARS, matches } from "./cli.js";
import { runEval, formatResult } from "./evaluate.js";
import type { BprMatch } from "./data.js";
import { DEFAULTS, type BprParams } from "./model.js";
import { assertSealed, SEALED_CODE_PATHS, type CommandRunner } from "./sealedPaths.js";

const defaultRunner: CommandRunner = (file, args) =>
  execFileSync(file, [...args], { encoding: "utf8" });

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Resolves `--years` against HOLDOUT_YEARS. A design year is rejected with a
 * message pointing at score.ts, so the two eras stay reachable only through
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
        `holdout: ${y} is not a holdout year - use packages/spr/score.ts for design years (2016-2022)`,
      );
    }
    years.add(y);
  }
  if (years.size === 0) throw new Error(`holdout: --years named no years`);
  // The halt-after year is BOUND to the maximum named year, so naming 2023
  // structurally prevents stepping a single 2024 match.
  return { years, stopAfterYear: Math.max(...years) };
}

function load(path: string): BprParams {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { params?: BprParams };
  return { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };
}

/**
 * One match, scored by BOTH models. Exported (with the two statistics below)
 * so a design-era contrast measures the SAME quantity with the SAME code a
 * holdout run would use - which is what lets a design-era interval serve as a
 * valid pre-registration for a later holdout interval, rather than being a
 * second hand-rolled approximation of it. Exporting changes nothing about what
 * this file computes or how main() behaves.
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
    throw new Error("usage: holdout.ts <frozen-params.json> [--candidate <p>] [--years <csv>] [--out <jsonl>] [--dry-run] --break-seal");
  }
  if (!process.argv.includes("--break-seal")) {
    throw new Error(
      "holdout: refusing to run without --break-seal.\n" +
        "This evaluation is single-shot by design. Every extra run costs a\n" +
        "little of the holdout's independence, so it must be deliberate.",
    );
  }

  const dryRun = process.argv.includes("--dry-run");
  const candidatePath = argValue("--candidate");
  const outPath = argValue("--out");
  const { years, stopAfterYear } = resolveYears(argValue("--years"));

  const sealedPaths = [...SEALED_CODE_PATHS, path];
  if (candidatePath !== undefined) sealedPaths.push(candidatePath);
  const seal = assertSealed(sealedPaths, defaultRunner);

  console.log("BPR holdout evaluation");
  console.log(`  HEAD:          ${seal.head}`);
  console.log("  sealed paths:");
  for (const p of seal.paths) console.log(`    ${p.blob}  ${p.path}`);
  console.log(`  incumbent:     ${path}`);
  console.log(`  candidate:     ${candidatePath ?? "(none - incumbent only)"}`);
  console.log(`  seasons:       ${[...years].sort((a, b) => a - b).join(", ")}`);
  console.log(`  halt after:    ${stopAfterYear}  (no match from a later season is stepped)`);
  console.log(`  out:           ${outPath ?? "(none)"}`);

  if (dryRun) {
    console.log("");
    console.log("  --dry-run: plan resolved, NOTHING evaluated. No holdout season was read.");
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
// (no --break-seal) or, far worse, evaluate a holdout season.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
