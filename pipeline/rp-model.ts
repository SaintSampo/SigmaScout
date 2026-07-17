// Fit the ranking-point model: for each bonus RP, a logistic regression that
// predicts P(bonus achieved) from an alliance's earned component scores. Fit
// separately for regular vs championship events so raised thresholds (e.g. 2026
// Energized at DCMP/champs) are learned from data, not hand-coded.

import type {
  ComponentId,
  EventInfo,
  RpBonusModel,
  RpSeasonModel,
  Season,
} from "../src/core/types";
import type { ObservedMatch } from "./fetch";
import { rpConfigFor } from "./rp-config";

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const logit = (p: number) => Math.log(p / (1 - p));
const clamp01 = (p: number) => Math.min(1 - 1e-4, Math.max(1e-4, p));

interface Logistic {
  bias: number;
  weights: number[];
}

/**
 * Full-batch logistic regression with standardized features + light L2. Returns
 * coefficients in RAW feature space so they apply directly to component scores.
 */
function logisticFit(X: number[][], y: number[]): Logistic {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  if (n === 0) return { bias: 0, weights: new Array(d).fill(0) };

  // Degenerate label (all 0 or all 1): constant probability, no slope.
  const pBar = y.reduce((s, v) => s + v, 0) / n;
  if (pBar <= 1e-6 || pBar >= 1 - 1e-6) {
    return { bias: logit(clamp01(pBar)), weights: new Array(d).fill(0) };
  }

  // Standardize features.
  const mu = new Array(d).fill(0);
  const sd = new Array(d).fill(0);
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < n; i++) mu[j] += X[i][j];
    mu[j] /= n;
    for (let i = 0; i < n; i++) sd[j] += (X[i][j] - mu[j]) ** 2;
    sd[j] = Math.sqrt(sd[j] / n) || 1;
  }
  const Z = X.map((row) => row.map((v, j) => (v - mu[j]) / sd[j]));

  let b0 = 0;
  const b = new Array(d).fill(0);
  const lr = 0.3;
  const l2 = 1e-3;
  for (let iter = 0; iter < 400; iter++) {
    let g0 = 0;
    const g = new Array(d).fill(0);
    for (let i = 0; i < n; i++) {
      let z = b0;
      for (let j = 0; j < d; j++) z += b[j] * Z[i][j];
      const err = sigmoid(z) - y[i];
      g0 += err;
      for (let j = 0; j < d; j++) g[j] += err * Z[i][j];
    }
    b0 -= lr * (g0 / n);
    for (let j = 0; j < d; j++) b[j] -= lr * (g[j] / n + l2 * b[j]);
  }

  // Convert standardized coefficients back to raw feature space.
  const weights = b.map((bj, j) => bj / sd[j]);
  let bias = b0;
  for (let j = 0; j < d; j++) bias -= (b[j] * mu[j]) / sd[j];
  return { bias, weights };
}

/** Fit the full per-season RP model from official-event matches. */
export function fitRpModel(
  season: Season,
  matches: ObservedMatch[],
  events: EventInfo[],
): RpSeasonModel {
  const cfg = rpConfigFor(season);
  const components: ComponentId[] = ["auto", "teleop", "endgame"];
  const levelOf = new Map(events.map((e) => [e.key, e]));

  // Collect (features, label) per bonus, per level, from both alliances.
  type Bucket = { X: number[][]; y: number[] };
  const data: Record<string, Bucket[]> = {
    regular: cfg.bonuses.map(() => ({ X: [], y: [] })),
    champ: cfg.bonuses.map(() => ({ X: [], y: [] })),
  };

  for (const m of matches) {
    const ev = levelOf.get(m.eventKey);
    if (!ev?.official) continue; // skip off/pre-season
    if (m.redBonuses.length !== cfg.bonuses.length) continue; // unconfigured
    const level = ev.level ?? "regular";
    const push = (feats: Record<ComponentId, number>, flags: boolean[]) => {
      const x = components.map((c) => feats[c] ?? 0);
      for (let i = 0; i < cfg.bonuses.length; i++) {
        data[level][i].X.push(x);
        data[level][i].y.push(flags[i] ? 1 : 0);
      }
    };
    push(m.redByComponent, m.redBonuses);
    push(m.blueByComponent, m.blueBonuses);
  }

  const bonuses: RpBonusModel[] = cfg.bonuses.map((b, i) => {
    const reg = logisticFit(data.regular[i].X, data.regular[i].y);
    const champBucket = data.champ[i];
    // Champs can be sparse early; fall back to the regular fit if too few.
    const champ = champBucket.y.length >= 200 ? logisticFit(champBucket.X, champBucket.y) : reg;
    const toWeights = (l: Logistic) =>
      Object.fromEntries(components.map((c, j) => [c, l.weights[j]])) as Record<
        ComponentId,
        number
      >;
    return {
      name: b.name,
      byLevel: {
        regular: { bias: reg.bias, weights: toWeights(reg) },
        champ: { bias: champ.bias, weights: toWeights(champ) },
      },
    };
  });

  return {
    season,
    win: cfg.win,
    tie: cfg.tie,
    loss: cfg.loss,
    bonuses,
    componentIds: components,
  };
}
