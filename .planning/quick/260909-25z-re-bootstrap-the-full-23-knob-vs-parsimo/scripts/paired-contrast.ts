/**
 * The FULL-vs-PARSIMONIOUS contrast, measured as a PAIRED event-clustered
 * quantity on the post-P3 unified path (quick task 260909-25z).
 *
 * ORIENTATION, fixed in RULE.md before any number existed and used everywhere:
 *
 *     delta = CANDIDATE - INCUMBENT = FULL - PARSIMONIOUS
 *
 * A POSITIVE accuracy delta means the FULL variant is better.
 * A NEGATIVE Brier delta means the FULL variant is better.
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

function main(): void {
  const [label, incumbentPath, candidatePath] = process.argv.slice(2);
  if (label === undefined || incumbentPath === undefined || candidatePath === undefined) {
    throw new Error(
      "usage: paired-contrast.ts <arm-label> <incumbent(parsimonious).json> <candidate(full).json>",
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

  const outPath = `reports/260909-25z/${label}.jsonl`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, units.map((u) => JSON.stringify(u)).join("\n") + "\n");

  console.log(`=== ARM ${label} ===  DESIGN ERA 2016-2022 ONLY, post-P3 unified path`);
  console.log(`  INCUMBENT (parsimonious side): ${incumbentPath}`);
  console.log(`  CANDIDATE (full side):         ${candidatePath}`);
  console.log(`  orientation: delta = FULL - PARSIMONIOUS`);
  console.log(`  resamples: ${RESAMPLES}   seed: eventBootstrap default (42)`);
  console.log(`  paired units: ${units.length}   jsonl: ${outPath}`);
  console.log("");
  console.log(formatResult(inc.result, `INCUMBENT (parsimonious) ${incumbentPath}`));
  console.log("");
  console.log(formatResult(cand.result, `CANDIDATE (full) ${candidatePath}`));
  console.log("");
  console.log(
    `  LEVELS  parsimonious acc ${(100 * inc.result.accuracy).toFixed(3)}%  brier ${inc.result.brier.toFixed(5)}  ll ${inc.result.logLoss.toFixed(5)}`,
  );
  console.log(
    `          full         acc ${(100 * cand.result.accuracy).toFixed(3)}%  brier ${cand.result.brier.toFixed(5)}  ll ${cand.result.logLoss.toFixed(5)}`,
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

  console.log("PAIRED  FULL - PARSIMONIOUS  (event-blocked, same matches both models)");
  report("combined", units);
  report("champs (type 2,3,4)", units.filter((u) => u.eventType >= 2 && u.eventType <= 4));
  report("non-champs", units.filter((u) => u.eventType < 2 || u.eventType > 4));
  console.log("");
  console.log("  Reading: dAcc POSITIVE => full better. dBrier NEGATIVE => full better.");
}

main();
