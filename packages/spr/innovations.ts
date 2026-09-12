/**
 * Is the filter's own variance claim honest?
 *
 * For every alliance-score observation the model forecasts a mean mu and a
 * variance v. The standardized innovation z = (observed - mu) / sqrt(v) should
 * have sd = 1 if v is right. sd(z) > 1 means the model is over-confident about
 * scores and its Kalman gains are too large; sd(z) < 1 means the reverse.
 *
 * Binning sd(z) by predicted alliance strength tests specifically whether the
 * constant observation noise assumption holds, i.e. whether strong alliances
 * are genuinely noisier than weak ones.
 *
 * Restricted to design-era years unless --allow-holdout is passed, so it cannot
 * quietly become a tuning signal against the sealed seasons.
 */
import { readFileSync } from "node:fs";
import { loadMatches } from "./data.js";
import { BprModel, DEFAULTS, type BprParams } from "./model.js";

interface Z {
  z: number;
  mu: number;
  week: number | null;
}

function stats(zs: number[]): { n: number; mean: number; sd: number } {
  const n = zs.length;
  if (n === 0) return { n: 0, mean: 0, sd: 0 };
  const mean = zs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(zs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { n, mean, sd };
}

function main(): void {
  const paramsPath = process.argv[2] ?? "packages/spr/frozen-params.json";
  const year = Number(process.argv[3] ?? "2023");
  const weeks = new Set((process.argv[4] ?? "0,1").split(",").map((s) => Number(s.trim())));
  const allowHoldout = process.argv.includes("--allow-holdout");
  if (year > 2022 && !allowHoldout) {
    throw new Error(`innovations: ${year} is a holdout season; pass --allow-holdout to inspect`);
  }

  const raw = JSON.parse(readFileSync(paramsPath, "utf8")) as { params?: BprParams };
  const params: BprParams = { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };
  const model = new BprModel(params);

  const recs: Z[] = [];
  for (const m of loadMatches("data/corpus.sqlite")) {
    const isElim = m.compLevel !== "qm";
    const pred = model.predict(m.redTeams, m.blueTeams, m.year, isElim);

    if (m.year === year && m.week !== null && weeks.has(m.week)) {
      for (const [teams, out] of [
        [m.redTeams, m.redOut],
        [m.blueTeams, m.blueOut],
      ] as const) {
        const f = model.forecast(teams, m.year);
        if (f.scale > 0 && f.v > 0) {
          const u = (3 * out) / f.scale;
          recs.push({ z: (u - f.mu) / Math.sqrt(f.v), mu: f.mu, week: m.week });
        }
      }
    }

    const outcome = m.winner === "red" ? 1 : m.winner === "blue" ? 0 : 0.5;
    model.update(
      m.redTeams,
      m.blueTeams,
      m.year,
      m.redOut,
      m.blueOut,
      m.redFoul,
      m.blueFoul,
      outcome,
      isElim,
      pred,
    );
  }

  const all = stats(recs.map((r) => r.z));
  console.log(`Innovation diagnostics - ${year} weeks ${[...weeks].sort().join(",")}`);
  console.log(`  alliance observations: ${all.n}`);
  console.log(`  mean z ${all.mean.toFixed(4)}   sd z ${all.sd.toFixed(4)}   (sd should be 1.000)`);
  console.log(
    `  -> stated variance is ${(1 / all.sd ** 2).toFixed(2)}x the realized variance`,
  );
  // Careful: a Kalman gain is P / (pv + obsVar), a RATIO. Inflating numerator
  // and denominator together leaves learning untouched and only misstates the
  // uncertainty. The online tau absorbs exactly this kind of global scale error
  // in the win probability, so the overall level below is largely self-correcting.
  // What tau cannot absorb is a strength-DEPENDENT error, because it is one
  // scalar. That is what the quintile table is for.
  console.log("     (a global level error is largely absorbed by the online tau;");
  console.log("      the quintile trend below is the part tau cannot fix)");
  console.log("");

  // Heteroscedasticity: does spread grow with predicted alliance strength?
  const sorted = [...recs].sort((a, b) => a.mu - b.mu);
  const q = Math.floor(sorted.length / 5);
  console.log("sd(z) by predicted alliance strength (quintiles of mu)");
  console.log("  quintile      n   mean mu   sd z");
  for (let i = 0; i < 5; i += 1) {
    const chunk = sorted.slice(i * q, i === 4 ? sorted.length : (i + 1) * q);
    const s = stats(chunk.map((r) => r.z));
    const muMean = chunk.reduce((a, r) => a + r.mu, 0) / chunk.length;
    console.log(
      `  Q${i + 1}       ${String(s.n).padStart(6)}   ${muMean.toFixed(3).padStart(6)}   ${s.sd.toFixed(4)}`,
    );
  }
  console.log("");

  console.log("sd(z) by week");
  for (const w of [...weeks].sort((a, b) => a - b)) {
    const s = stats(recs.filter((r) => r.week === w).map((r) => r.z));
    if (s.n === 0) continue;
    console.log(`  week ${w}  n ${String(s.n).padStart(5)}  mean ${s.mean.toFixed(4)}  sd ${s.sd.toFixed(4)}`);
  }
}

main();
