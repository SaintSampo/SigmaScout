/**
 * A single rung-to-rung contrast on the BPR ladder, measured as a PAIRED
 * event-clustered quantity on the post-P3 unified path (quick task 260909-3oe).
 *
 * Derived from 260909-25z/scripts/paired-contrast.ts. The statistics, the
 * resampler, the scoring path and the resample count are UNCHANGED from that
 * script; what differs is the output directory, generic INCUMBENT/CANDIDATE
 * labelling (rungs vary, so "parsimonious"/"full" no longer name the sides),
 * two additional slices, and the no-call block.
 *
 * ORIENTATION, fixed in LADDER-RULE.md item 1 before any number existed:
 *
 *     delta = CANDIDATE - INCUMBENT
 *
 * A POSITIVE accuracy delta means the CANDIDATE is better.
 * A NEGATIVE Brier delta means the CANDIDATE is better.
 *
 * Why this reuses `holdout.ts`'s statistics rather than reimplementing them:
 * a design-era interval is only a valid pre-registration for a later holdout
 * interval if the two are the SAME quantity computed by the SAME code. A
 * second hand-rolled copy would silently permit a definitional drift (which
 * matches sit in the accuracy denominator, how a tie is handled) between the
 * number that licenses firing the test and the number the test prints.
 *
 * Why it uses `evalDesign`'s `onScored` hook rather than a private replay
 * loop: `onScored` is the post-P3 unified path. A private loop would be a
 * second scoring convention, which is the exact failure P3 existed to close.
 *
 * DESIGN ERA ONLY (2016-2022). `evalDesign` cannot reach a holdout season.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { evalDesign } from "../../../../packages/bpr/cli.js";
import { formatResult } from "../../../../packages/bpr/evaluate.js";
import { DEFAULTS, type BprParams } from "../../../../packages/bpr/model.js";
import type { BprMatch } from "../../../../packages/bpr/data.js";
import {
  meanAccuracyDelta,
  meanBrierDelta,
  type Paired,
} from "../../../../packages/bpr/holdout.js";
import { eventBlockedBootstrap } from "../../../../packages/harness/eventBootstrap.js";

const RESAMPLES = 2000;

function load(path: string): BprParams {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { params?: BprParams };
  return { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };
}

/** A no-call: an exactly-0.5 prediction, which D-Q3 scores as a miss. */
const isNoCall = (p: number): boolean => p === 0.5;

function main(): void {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const sliceArg = process.argv.includes("--slices=core") ? "core" : "full";
  const [label, incumbentPath, candidatePath] = argv;
  if (label === undefined || incumbentPath === undefined || candidatePath === undefined) {
    throw new Error(
      "usage: ladder-contrast.ts <label> <incumbent.json> <candidate.json> [--slices=core|full]",
    );
  }

  const incParams = load(incumbentPath);
  const candParams = load(candidatePath);

  const collect = (
    p: BprParams,
  ): { byKey: Map<string, { m: BprMatch; pRed: number }>; result: ReturnType<typeof evalDesign> } => {
    const byKey = new Map<string, { m: BprMatch; pRed: number }>();
    const result = evalDesign(p, { onScored: (m, pRed) => byKey.set(m.matchKey, { m, pRed }) });
    return { byKey, result };
  };

  const inc = collect(incParams);
  const cand = collect(candParams);

  const units: Paired[] = [];
  for (const [key, i] of inc.byKey) {
    const c = cand.byKey.get(key);
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

  const outPath = `reports/260909-3oe/${label}.jsonl`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, units.map((u) => JSON.stringify(u)).join("\n") + "\n");

  console.log(`=== CONTRAST ${label} ===  DESIGN ERA 2016-2022 ONLY, post-P3 unified path`);
  console.log(`  INCUMBENT: ${incumbentPath}`);
  console.log(`  CANDIDATE: ${candidatePath}`);
  console.log(`  orientation: delta = CANDIDATE - INCUMBENT`);
  console.log(`  resamples: ${RESAMPLES}   seed: eventBootstrap default (42)   slices: ${sliceArg}`);
  console.log(`  paired units: ${units.length}   jsonl: ${outPath}`);
  console.log("");
  console.log(formatResult(inc.result, `INCUMBENT ${incumbentPath}`));
  console.log("");
  console.log(formatResult(cand.result, `CANDIDATE ${candidatePath}`));
  console.log("");
  console.log(
    `  LEVELS  incumbent acc ${(100 * inc.result.accuracy).toFixed(3)}%  brier ${inc.result.brier.toFixed(5)}  ll ${inc.result.logLoss.toFixed(5)}`,
  );
  console.log(
    `          candidate acc ${(100 * cand.result.accuracy).toFixed(3)}%  brier ${cand.result.brier.toFixed(5)}  ll ${cand.result.logLoss.toFixed(5)}`,
  );
  console.log("");

  const report = (sliceLabel: string, pool: readonly Paired[]): void => {
    if (pool.length < 2) {
      console.log(`  ${sliceLabel.padEnd(22)} (too few matches to measure)`);
      return;
    }
    const acc = eventBlockedBootstrap(pool, (s) => meanAccuracyDelta(s as Paired[]), {
      resamples: RESAMPLES,
    });
    const bri = eventBlockedBootstrap(pool, (s) => meanBrierDelta(s as Paired[]), {
      resamples: RESAMPLES,
    });
    const accExcl = acc.percentile.lower > 0 || acc.percentile.upper < 0;
    const briExcl = bri.percentile.lower > 0 || bri.percentile.upper < 0;
    console.log(
      `  ${sliceLabel.padEnd(22)} n=${String(pool.length).padStart(6)} events=${String(acc.eventCount).padStart(4)}  ` +
        `dAcc ${((100 * acc.pointEstimate >= 0 ? "+" : "") + (100 * acc.pointEstimate).toFixed(3)).padStart(8)}pp ` +
        `SE ${(100 * acc.standardError).toFixed(4)} ` +
        `95% [${(100 * acc.percentile.lower).toFixed(3)}, ${(100 * acc.percentile.upper).toFixed(3)}] ` +
        `excl0 ${accExcl ? "YES" : "no "}  |  ` +
        `dBrier ${((bri.pointEstimate >= 0 ? "+" : "") + bri.pointEstimate.toFixed(5)).padStart(9)} ` +
        `95% [${bri.percentile.lower.toFixed(5)}, ${bri.percentile.upper.toFixed(5)}] ` +
        `excl0 ${briExcl ? "YES" : "no "}`,
    );
  };

  // Ex-no-call, per LADDER-RULE.md item 6: drop a unit if EITHER side no-calls.
  // The condition is symmetric across the two sides, so it cannot favour one.
  const exNoCall = units.filter((u) => !isNoCall(u.pIncumbent) && !isNoCall(u.pCandidate));
  const ex2016 = units.filter((u) => u.season !== 2016);

  console.log("PAIRED  CANDIDATE - INCUMBENT  (event-blocked, same matches both models)");
  report("combined (as-scored)", units);
  report("ex-no-call", exNoCall);
  if (sliceArg === "full") {
    report("ex-2016", ex2016);
    report("champs (type 2,3,4)", units.filter((u) => u.eventType >= 2 && u.eventType <= 4));
    report("non-champs", units.filter((u) => u.eventType < 2 || u.eventType > 4));
  }
  console.log("");
  console.log("  Reading: dAcc POSITIVE => candidate better. dBrier NEGATIVE => candidate better.");
  console.log("  ex-no-call drops units where EITHER side predicts exactly 0.5 (symmetric).");
  console.log("  Per LADDER-RULE.md item 6, ex-no-call is the estimate of a 2023 result.");
  console.log("");

  // ---------------------------------------------------------------------------
  // NO-CALL BLOCK. This IS the deterministic-tie-break measurement, and it lives
  // here rather than in a second script because it must read exactly the units
  // the contrast above pairs. A deterministic always-red rule scores exactly the
  // red-win rate on these units; always-blue scores its complement.
  // ---------------------------------------------------------------------------
  const incNoCallAll = units.filter((u) => isNoCall(u.pIncumbent));
  const candNoCallAll = units.filter((u) => isNoCall(u.pCandidate));

  console.log("NO-CALL BLOCK  (exact-0.5 predictions; D-Q3 scores an abstention on a decided match as a miss)");
  console.log(`  incumbent exact-0.5 units: ${incNoCallAll.length}`);
  console.log(`  candidate exact-0.5 units: ${candNoCallAll.length}`);
  console.log(`  dropped by ex-no-call:     ${units.length - exNoCall.length}`);
  console.log("");

  const pct = (n: number, d: number): string =>
    d > 0 ? `${((100 * n) / d).toFixed(2)}%` : "n/a";

  const tieBreak = (blockLabel: string, pool: readonly Paired[]): void => {
    // Ties carry no winner, so they sit outside the accuracy denominator - the
    // same exclusion meanAccuracyDelta applies via accuracyCall returning null.
    const decided = pool.filter((u) => u.actualWinner !== "tie");
    if (decided.length === 0) {
      console.log(`  ${blockLabel.padEnd(30)} (no decided units)`);
      return;
    }
    const candCorrect = decided.filter(
      (u) =>
        (u.pCandidate > 0.5 && u.actualWinner === "red") ||
        (u.pCandidate < 0.5 && u.actualWinner === "blue"),
    ).length;
    const redWon = decided.filter((u) => u.actualWinner === "red").length;
    const alwaysRed = redWon;
    const alwaysBlue = decided.length - redWon;
    const bestDeterministic = Math.max(alwaysRed, alwaysBlue);
    console.log(
      `  ${blockLabel.padEnd(30)} n=${String(decided.length).padStart(5)}  ` +
        `candidate correct ${String(candCorrect).padStart(5)} (${pct(candCorrect, decided.length).padStart(7)})  ` +
        `red won ${String(redWon).padStart(5)} (${pct(redWon, decided.length).padStart(7)})  ` +
        `best deterministic ${String(bestDeterministic).padStart(5)} (${pct(bestDeterministic, decided.length).padStart(7)}, ` +
        `${alwaysRed >= alwaysBlue ? "always-RED" : "always-BLUE"})`,
    );
  };

  console.log("  On the units where the INCUMBENT predicts exactly 0.5:");
  tieBreak("all", incNoCallAll);
  tieBreak("quals (compLevel=qm)", incNoCallAll.filter((u) => u.compLevel === "qm"));
  tieBreak("elims (compLevel!=qm)", incNoCallAll.filter((u) => u.compLevel !== "qm"));
  console.log("");
  console.log("  A zero-parameter tie-break scores the 'best deterministic' column. The");
  console.log("  learned side bias scores the 'candidate correct' column. Compare those two.");
  console.log("  model.ts:88-100: quals run 49.2-50.3% red but elims run 63-78% red, so the");
  console.log("  quals and elims rows measure two DIFFERENT effects and must not be merged.");

  const bySeason = new Map<number, number>();
  for (const u of incNoCallAll) bySeason.set(u.season, (bySeason.get(u.season) ?? 0) + 1);
  console.log("");
  console.log(
    `  incumbent no-calls by season: ${[...bySeason.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([s, n]) => `${s}=${n}`)
      .join("  ")}`,
  );
}

main();
