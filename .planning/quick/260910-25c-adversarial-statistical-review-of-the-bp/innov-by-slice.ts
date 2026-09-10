/**
 * Innovation bias by event type / comp level, and the converged link
 * temperature tau, for the PROMOTED (frozen) BPR parameters.
 *
 * DESIGN ERA ONLY (year <= 2022). Never reads 2023+. Read-only: no parameter
 * is written, no artifact republished. Diagnostic, not a tune.
 */
import { readFileSync } from "node:fs";
import { loadMatches } from "../../../packages/bpr/data.js";
import { BprModel, DEFAULTS, type BprParams } from "../../../packages/bpr/model.js";

const LAST_DESIGN_YEAR = 2022;
const raw = JSON.parse(readFileSync("packages/bpr/frozen-params.json", "utf8")) as { params?: BprParams };
const params: BprParams = { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };
const model = new BprModel(params);

interface Rec { z: number; year: number; eventType: number; isElim: boolean; isChamps: boolean }
const recs: Rec[] = [];
const tauByYear = new Map<number, number>();

for (const m of loadMatches("data/corpus.sqlite")) {
  if (m.year > LAST_DESIGN_YEAR) break;
  const isElim = m.compLevel !== "qm";
  const pred = model.predict(m.redTeams, m.blueTeams, m.year, isElim);
  const isChamps = m.eventType === 3 || m.eventType === 4;
  for (const [keys, out] of [[m.redTeams, m.redOut], [m.blueTeams, m.blueOut]] as const) {
    const f = model.forecast(keys as string[], m.year);
    if (f.scale > 0) {
      const u = (3 * (out as number)) / f.scale;
      recs.push({ z: (u - f.mu) / Math.sqrt(f.v), year: m.year, eventType: m.eventType, isElim, isChamps });
    }
  }
  const outcome = m.winner === "red" ? 1 : m.winner === "blue" ? 0 : 0.5;
  model.update(m.redTeams, m.blueTeams, m.year, m.redOut, m.blueOut, m.redFoul, m.blueFoul, outcome, isElim, pred);
  tauByYear.set(m.year, (model as unknown as { logTau: number }).logTau);
}

const stat = (zs: number[]) => {
  const n = zs.length; if (n === 0) return { n: 0, mean: 0, sd: 0 };
  const mean = zs.reduce((a, b) => a + b, 0) / n;
  return { n, mean, sd: Math.sqrt(zs.reduce((a, b) => a + (b - mean) ** 2, 0) / n) };
};
const show = (label: string, f: (r: Rec) => boolean) => {
  const s = stat(recs.filter(f).map((r) => r.z));
  if (s.n === 0) return;
  const se = s.sd / Math.sqrt(s.n);
  console.log(`  ${label.padEnd(34)} n=${String(s.n).padStart(6)}  mean z ${s.mean >= 0 ? " " : ""}${s.mean.toFixed(4)} (+-${(1.96 * se).toFixed(4)})   sd z ${s.sd.toFixed(4)}`);
};

console.log(`BPR innovation diagnostics, frozen params, DESIGN ERA 2016-${LAST_DESIGN_YEAR}\n`);
console.log("OVERALL");
show("all alliance-observations", () => true);
console.log("\nBY EVENT TYPE  (mean z < 0 = model OVER-predicts alliance output)");
show("regional/district (type 0,1)", (r) => r.eventType === 0 || r.eventType === 1);
show("district championship (type 2)", (r) => r.eventType === 2);
show("CHAMPIONSHIP division (type 3)", (r) => r.eventType === 3);
show("CHAMPIONSHIP final (type 4)", (r) => r.eventType === 4);
show("all championship (type 3,4)", (r) => r.isChamps);
console.log("\nBY COMP LEVEL");
show("qualification", (r) => !r.isElim);
show("elimination", (r) => r.isElim);
console.log("\nCONVERGED LINK TEMPERATURE tau (=1.0 would mean the filter's own variance is honest)");
for (const [y, lt] of [...tauByYear].sort((a, b) => a[0] - b[0])) {
  console.log(`  end of ${y}:  tau = ${Math.exp(lt).toFixed(4)}`);
}
