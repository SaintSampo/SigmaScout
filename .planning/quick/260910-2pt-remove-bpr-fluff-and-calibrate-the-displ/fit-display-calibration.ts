/**
 * Fit the DISPLAY-TIME variance calibration for BPR.
 *
 * BPR's emitted per-alliance variance is `pv + obsSd^2`. Quick task 260910-25c
 * measured its standardized innovation at sd(z) = 0.7062 over the design era,
 * with a strong trend in predicted alliance strength (2022 quintiles: 0.551 ->
 * 1.001). The published `X +/- Y` is therefore ~1.4x too wide, and wrongly so by
 * a strength-dependent amount.
 *
 * This fits sd(z) = a + b * (mu - 3) on the DESIGN ERA ONLY, so the emitted
 * variance can be multiplied by c(mu)^2 at display time. The fit touches no
 * Kalman gain and no win probability - it only rescales what is shown.
 *
 * DESIGN ERA ONLY (year <= 2022). Never reads 2023+.
 */
import { readFileSync } from "node:fs";
import { loadMatches } from "../../../packages/bpr/data.js";
import { BprModel, DEFAULTS, type BprParams } from "../../../packages/bpr/model.js";

const LAST_DESIGN_YEAR = 2022;
const raw = JSON.parse(readFileSync("packages/bpr/frozen-params.json", "utf8")) as { params?: BprParams };
const params: BprParams = { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };
const model = new BprModel(params);

const recs: Array<{ z: number; mu: number }> = [];
for (const m of loadMatches("data/corpus.sqlite")) {
  if (m.year > LAST_DESIGN_YEAR) break;
  const isElim = m.compLevel !== "qm";
  const pred = model.predict(m.redTeams, m.blueTeams, m.year, isElim);
  for (const [keys, out] of [[m.redTeams, m.redOut], [m.blueTeams, m.blueOut]] as const) {
    const f = model.forecast(keys as string[], m.year);
    if (f.scale > 0 && f.v > 0) {
      recs.push({ z: ((3 * (out as number)) / f.scale - f.mu) / Math.sqrt(f.v), mu: f.mu });
    }
  }
  const outcome = m.winner === "red" ? 1 : m.winner === "blue" ? 0 : 0.5;
  model.update(m.redTeams, m.blueTeams, m.year, m.redOut, m.blueOut, m.redFoul, m.blueFoul, outcome, isElim, pred);
}

const sd = (v: number[]): number => {
  const mu = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length);
};

console.log(`BPR display-variance calibration fit - DESIGN ERA 2016-${LAST_DESIGN_YEAR}`);
console.log(`  alliance-observations: ${recs.length}`);
console.log(`  overall sd(z) = ${sd(recs.map((r) => r.z)).toFixed(4)}   (1.000 = honest)\n`);

// Decile bins in predicted strength; sd(z) per bin is the fit target.
const sorted = [...recs].sort((a, b) => a.mu - b.mu);
const nb = 10;
const q = Math.floor(sorted.length / nb);
const bins: Array<{ mu: number; s: number; n: number }> = [];
console.log("  decile   n       mean mu    sd(z)");
for (let i = 0; i < nb; i += 1) {
  const chunk = sorted.slice(i * q, i === nb - 1 ? sorted.length : (i + 1) * q);
  const mu = chunk.reduce((a, r) => a + r.mu, 0) / chunk.length;
  const s = sd(chunk.map((r) => r.z));
  bins.push({ mu, s, n: chunk.length });
  console.log(`    D${String(i + 1).padStart(2)}  ${String(chunk.length).padStart(6)}   ${mu.toFixed(4).padStart(8)}   ${s.toFixed(4)}`);
}

// Weighted least squares of sd(z) on (mu - 3), weights = bin count.
let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
for (const b of bins) {
  const x = b.mu - 3, w = b.n;
  sw += w; sx += w * x; sy += w * b.s; sxx += w * x * x; sxy += w * x * b.s;
}
const bSlope = (sw * sxy - sx * sy) / (sw * sxx - sx * sx);
const aInt = (sy - bSlope * sx) / sw;

console.log(`\n  WLS fit:  sd(z) = ${aInt.toFixed(4)} + ${bSlope.toFixed(4)} * (mu - 3)`);

const muMin = sorted[0]!.mu, muMax = sorted[sorted.length - 1]!.mu;
console.log(`  observed mu range: ${muMin.toFixed(3)} .. ${muMax.toFixed(3)}`);
console.log(`  c at mu=0: ${(aInt + bSlope * -3).toFixed(4)}   c at mu=6: ${(aInt + bSlope * 3).toFixed(4)}`);

// Residual check: apply the fit and re-measure. sd should land on 1.0 per bin.
const cOf = (mu: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, aInt + bSlope * (mu - 3)));
for (const [lo, hi] of [[0.05, 5], [0.40, 1.30]] as const) {
  const zc = recs.map((r) => r.z / cOf(r.mu, lo, hi));
  console.log(`\n  AFTER calibration (clamp ${lo}..${hi}): overall sd(z) = ${sd(zc).toFixed(4)}`);
  const sc = [...recs].sort((a, b) => a.mu - b.mu);
  const out: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const c2 = sc.slice(i * Math.floor(sc.length / 5), i === 4 ? sc.length : (i + 1) * Math.floor(sc.length / 5));
    out.push(sd(c2.map((r) => r.z / cOf(r.mu, lo, hi))).toFixed(4));
  }
  console.log(`    by strength quintile: ${out.join("  ")}`);
}
