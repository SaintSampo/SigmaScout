/**
 * The SELECTION BAR, measured as a PAIRED event-clustered quantity (P2).
 *
 * `260908-vqr-REVIEW.md` measured a 1.45x design effect using MARGINAL standard
 * errors and correctly refused to conclude from it, because an ablation delta
 * is a PAIRED difference: both variants are scored on the SAME matches, so the
 * shared match-difficulty variance cancels inside the difference before any
 * resampling happens. `packages/harness/eventBootstrap.ts`'s own header spells
 * out why the distinction decides whether a rule is honest — a level SE where a
 * paired SE belongs sets the bar far too high.
 *
 * The review's rough 0.45pp is therefore NOT adopted here. It came from the
 * marginal SE and can differ materially in either direction.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { accuracyCall } from "../../../../packages/core/scoring/brier.js";
import { eventBlockedBootstrap } from "../../../../packages/harness/eventBootstrap.js";

const DIR = "reports/260909-03b/ablate";
const FULL = "full-model-tuned.jsonl";
const RESAMPLES = 2000;

interface Row {
  matchKey: string;
  eventKey: string;
  season: number;
  compLevel: string;
  eventType: number;
  pRed: number;
  actualWinner: "red" | "blue" | "tie";
}

/** A paired unit: both models' hit indicators on ONE match. */
interface Unit {
  readonly eventKey: string;
  /** 1 when the match is in the accuracy denominator (not a tie), else 0. */
  readonly inDen: number;
  /** variantHit - fullHit, in {-1, 0, +1}. Zero for an excluded match. */
  readonly dHit: number;
  /** The full model's own hit indicator, for the LEVEL SE cross-check. */
  readonly fullHit: number;
  readonly eventType: number;
}

function read(file: string): Map<string, Row> {
  const out = new Map<string, Row>();
  const text = readFileSync(join(DIR, file), "utf8");
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const r = JSON.parse(line) as Row;
    out.set(r.matchKey, r);
  }
  return out;
}

const hit = (p: number, w: Row["actualWinner"]): number | null => {
  const c = accuracyCall({ pRedWin: p, actualWinner: w });
  return c === null ? null : c ? 1 : 0;
};

/** mean(variant hits) - mean(full hits), over the accuracy denominator. */
function pairedAccuracyDelta(sample: readonly Unit[]): number {
  let den = 0;
  let sum = 0;
  for (const u of sample) {
    den += u.inDen;
    sum += u.dHit;
  }
  return den > 0 ? sum / den : 0;
}

function levelAccuracy(sample: readonly Unit[]): number {
  let den = 0;
  let sum = 0;
  for (const u of sample) {
    den += u.inDen;
    sum += u.fullHit;
  }
  return den > 0 ? sum / den : 0;
}

function main(): void {
  const full = read(FULL);
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".jsonl") && f !== FULL)
    .sort();

  console.log("PAIRED event-clustered selection bar - DESIGN ERA 2016-2022");
  console.log(`  full-model file: ${FULL}  (${full.size} scored matches)`);
  console.log(`  resamples: ${RESAMPLES}`);
  console.log("");

  // ---- The full model's LEVEL SE, and the design-effect cross-check. ----
  const levelUnits: Unit[] = [];
  for (const [, r] of full) {
    const h = hit(r.pRed, r.actualWinner);
    levelUnits.push({
      eventKey: r.eventKey,
      inDen: h === null ? 0 : 1,
      dHit: 0,
      fullHit: h ?? 0,
      eventType: r.eventType,
    });
  }
  const level = eventBlockedBootstrap(levelUnits, levelAccuracy, { resamples: RESAMPLES });
  const den = levelUnits.reduce((a, u) => a + u.inDen, 0);
  const p = level.pointEstimate;
  const naiveSe = Math.sqrt((p * (1 - p)) / den);
  console.log("LEVEL (one model's own accuracy) - the marginal quantity the review used");
  console.log(`  accuracy        ${(100 * p).toFixed(3)}%   n(den) ${den}   events ${level.eventCount}`);
  console.log(`  clustered SE    ${(100 * level.standardError).toFixed(4)}pp`);
  console.log(`  naive binomial  ${(100 * naiveSe).toFixed(4)}pp`);
  console.log(`  DESIGN EFFECT   ${(level.standardError / naiveSe).toFixed(3)}x  (review measured 1.45x)`);
  console.log(`  => a LEVEL two-sigma bar would be ${(200 * level.standardError).toFixed(3)}pp`);
  console.log("");

  // ---- The PAIRED quantity, per ablation variant, on two populations. ----
  const slices: Array<[string, (u: Unit) => boolean]> = [
    ["FULL DESIGN ERA", () => true],
    ["CHAMPS (type 2,3,4)", (u) => u.eventType >= 2 && u.eventType <= 4],
  ];

  for (const [sliceName, keep] of slices) {
    console.log(`=== ${sliceName} ===`);
    console.log("  variant                                        dAcc(pp)  pairedSE  2sigma   95% interval          excl.0");
    for (const file of files) {
      const variant = read(file);
      const units: Unit[] = [];
      for (const [key, f] of full) {
        const v = variant.get(key);
        if (v === undefined) continue;
        const fh = hit(f.pRed, f.actualWinner);
        const vh = hit(v.pRed, v.actualWinner);
        const u: Unit = {
          eventKey: f.eventKey,
          inDen: fh === null || vh === null ? 0 : 1,
          dHit: fh === null || vh === null ? 0 : vh - fh,
          fullHit: fh ?? 0,
          eventType: f.eventType,
        };
        if (keep(u)) units.push(u);
      }
      if (units.length < 2) {
        console.log(`  ${file.replace(".jsonl", "").padEnd(45)} (too few units)`);
        continue;
      }
      const b = eventBlockedBootstrap(units, pairedAccuracyDelta, { resamples: RESAMPLES });
      const excludesZero = b.percentile.lower > 0 || b.percentile.upper < 0;
      console.log(
        `  ${file.replace(".jsonl", "").padEnd(45)} ` +
          `${((100 * b.pointEstimate >= 0 ? "+" : "") + (100 * b.pointEstimate).toFixed(3)).padStart(8)}  ` +
          `${(100 * b.standardError).toFixed(4).padStart(8)}  ` +
          `${(200 * b.standardError).toFixed(3).padStart(6)}  ` +
          `[${(100 * b.percentile.lower).toFixed(3)}, ${(100 * b.percentile.upper).toFixed(3)}]`.padStart(20) +
          `  ${excludesZero ? "YES" : "no"}`,
      );
    }
    console.log("");
  }
}

main();
