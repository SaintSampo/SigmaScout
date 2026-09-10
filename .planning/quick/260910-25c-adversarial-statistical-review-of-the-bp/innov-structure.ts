/**
 * Two discriminating tests on BPR's innovations. DESIGN ERA ONLY (<=2022).
 *
 * TEST 1 - within-match correlation. The model adds red and blue predictive
 *   variance as if the two alliances' score errors were independent. If they
 *   are positively correlated (shared field, game pace, refereeing), the stated
 *   margin variance is too large and the learned tau is silently absorbing it.
 *
 * TEST 2 - where the championship over-prediction comes from. Regress the
 *   standardized innovation z on the alliance's OWN predicted strength and its
 *   OPPONENT's predicted strength. A negative OPPONENT coefficient is the
 *   signature of unmodelled defensive suppression; a negative OWN coefficient
 *   is the signature of selection bias (winner's curse) in the ratings.
 */
import { readFileSync } from "node:fs";
import { loadMatches } from "../../../packages/bpr/data.js";
import { BprModel, DEFAULTS, type BprParams } from "../../../packages/bpr/model.js";

const raw = JSON.parse(readFileSync("packages/bpr/frozen-params.json", "utf8")) as { params?: BprParams };
const params: BprParams = { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };
const model = new BprModel(params);

const zr: number[] = [], zb: number[] = [];
const rows: Array<{ z: number; own: number; opp: number; champs: boolean }> = [];

for (const m of loadMatches("data/corpus.sqlite")) {
  if (m.year > 2022) break;
  const isElim = m.compLevel !== "qm";
  const pred = model.predict(m.redTeams, m.blueTeams, m.year, isElim);
  const fr = model.forecast(m.redTeams, m.year), fb = model.forecast(m.blueTeams, m.year);
  if (fr.scale > 0) {
    const a = ((3 * m.redOut) / fr.scale - fr.mu) / Math.sqrt(fr.v);
    const c = ((3 * m.blueOut) / fb.scale - fb.mu) / Math.sqrt(fb.v);
    zr.push(a); zb.push(c);
    const champs = m.eventType === 3 || m.eventType === 4;
    rows.push({ z: a, own: fr.mu, opp: fb.mu, champs });
    rows.push({ z: c, own: fb.mu, opp: fr.mu, champs });
  }
  const outcome = m.winner === "red" ? 1 : m.winner === "blue" ? 0 : 0.5;
  model.update(m.redTeams, m.blueTeams, m.year, m.redOut, m.blueOut, m.redFoul, m.blueFoul, outcome, isElim, pred);
}

// --- TEST 1 ---
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const mr = mean(zr), mb = mean(zb);
let cov = 0, vr = 0, vb = 0;
for (let i = 0; i < zr.length; i++) { cov += (zr[i]! - mr) * (zb[i]! - mb); vr += (zr[i]! - mr) ** 2; vb += (zb[i]! - mb) ** 2; }
const rho = cov / Math.sqrt(vr * vb);
console.log("TEST 1 - within-match correlation of the two alliances' innovations");
console.log(`  matches n = ${zr.length}`);
console.log(`  corr(z_red, z_blue) = ${rho.toFixed(4)}     [the model assumes 0]`);
console.log(`  implied honest margin variance = ${(1 - rho).toFixed(3)}x the variance BPR states`);
console.log(`  -> a scale-only correction of sqrt(1-rho) = ${Math.sqrt(1 - rho).toFixed(4)} on the margin sd,`);
console.log(`     which is what a learned tau near ${Math.sqrt(1 - rho).toFixed(2)} would look like.\n`);

// --- TEST 2: OLS z ~ 1 + own + opp ---
function ols(sel: (r: { champs: boolean }) => boolean, label: string) {
  const d = rows.filter(sel);
  const n = d.length;
  const X = d.map((r) => [1, r.own, r.opp]);
  const y = d.map((r) => r.z);
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) { b[j]! += X[i]![j]! * y[i]!; for (let k = 0; k < 3; k++) A[j]![k]! += X[i]![j]! * X[i]![k]!; }
  // Gaussian elimination
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let i = 0; i < 3; i++) {
    let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r]![i]!) > Math.abs(M[p]![i]!)) p = r;
    [M[i], M[p]] = [M[p]!, M[i]!];
    for (let r = 0; r < 3; r++) { if (r === i) continue; const f = M[r]![i]! / M[i]![i]!; for (let c = i; c < 4; c++) M[r]![c]! -= f * M[i]![c]!; }
  }
  const beta = [0, 1, 2].map((i) => M[i]![3]! / M[i]![i]!);
  let rss = 0; for (let i = 0; i < n; i++) { const yh = beta[0]! + beta[1]! * X[i]![1]! + beta[2]! * X[i]![2]!; rss += (y[i]! - yh) ** 2; }
  const s2 = rss / (n - 3);
  // naive SEs from (X'X)^-1 diagonal via re-solving unit vectors
  const inv = (col: number) => {
    const N = A.map((r, i) => [...r, i === col ? 1 : 0]);
    for (let i = 0; i < 3; i++) {
      let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(N[r]![i]!) > Math.abs(N[p]![i]!)) p = r;
      [N[i], N[p]] = [N[p]!, N[i]!];
      for (let r = 0; r < 3; r++) { if (r === i) continue; const f = N[r]![i]! / N[i]![i]!; for (let c = i; c < 4; c++) N[r]![c]! -= f * N[i]![c]!; }
    }
    return N[col]![3]! / N[col]![col]!;
  };
  console.log(`  ${label}  (n=${n})`);
  console.log(`    intercept        ${beta[0]!.toFixed(4)}`);
  console.log(`    OWN strength     ${beta[1]!.toFixed(4)}  (+-${(1.96 * Math.sqrt(s2 * inv(1))).toFixed(4)})   <- negative = winner's curse / selection`);
  console.log(`    OPPONENT strength ${beta[2]!.toFixed(4)}  (+-${(1.96 * Math.sqrt(s2 * inv(2))).toFixed(4)})   <- negative = unmodelled defensive suppression`);
}
console.log("TEST 2 - OLS of z on own and opponent predicted strength");
console.log("  (naive SEs; observations cluster by match and event, so intervals are optimistic)\n");
ols(() => true, "ALL design-era");
console.log("");
ols((r) => !r.champs, "non-championship only");
console.log("");
ols((r) => r.champs, "championship only");
