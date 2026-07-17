// Monte Carlo event simulator. Framework-free so it runs in the browser (the
// Simulation tab) and in the pipeline (validation). Given team ratings, the
// schedule, and the RP model, it plays out the remaining qual matches many times
// and reports each team's ranking distribution.
//
// Each simulated match samples per-component alliance scores from the model's
// predictive distribution (team means/variances + irreducible per-alliance
// noise R), decides the winner on total earned score, awards base RP (win/tie/
// loss) plus Bernoulli-sampled bonus RP, and accumulates. Teams are then ranked
// by total RP (tiebreak: cumulative score), and each team's rank is recorded.

import type {
  ComponentId,
  EventTeam,
  MatchRecord,
  RpSeasonModel,
  SimSettings,
  TeamKey,
  TeamSimResult,
} from "./types";

export interface SimInput {
  teams: EventTeam[];
  /** Irreducible per-alliance score variance per component (from the season model). */
  residualVariance: Record<ComponentId, number>;
  qualMatches: MatchRecord[];
  rpModel: RpSeasonModel;
  level: "regular" | "champ";
  settings: SimSettings;
}

/** Deterministic-ish PRNG (mulberry32) so results are reproducible per run. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGaussian(rng: () => number) {
  return (mean: number, variance: number) => {
    // Box–Muller.
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * Math.sqrt(Math.max(variance, 0));
  };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function simulateEvent(input: SimInput): TeamSimResult[] {
  const { teams, residualVariance, rpModel, level, settings } = input;
  const comps = rpModel.componentIds;
  const teamComp = new Map(teams.map((t) => [t.team, t.components]));

  // Only teams that actually appear in the qual schedule get ranked.
  const qualTeams = new Set<TeamKey>();
  const quals = input.qualMatches
    .filter((m) => m.red.length === 3 && m.blue.length === 3)
    .sort((a, b) => a.matchNumber - b.matchNumber);
  for (const m of quals) for (const t of [...m.red, ...m.blue]) qualTeams.add(t);
  const teamList = [...qualTeams];

  // Fixed contributions from matches before the simulation start (actual results).
  const baseRp = new Map<TeamKey, number>(teamList.map((t) => [t, 0]));
  const baseTb = new Map<TeamKey, number>(teamList.map((t) => [t, 0]));
  const toSim: MatchRecord[] = [];
  for (const m of quals) {
    if (m.played && m.matchNumber < settings.fromQualMatch) {
      for (const t of m.red) {
        baseRp.set(t, baseRp.get(t)! + (m.redRp ?? 0));
        baseTb.set(t, baseTb.get(t)! + (m.redActual ?? 0));
      }
      for (const t of m.blue) {
        baseRp.set(t, baseRp.get(t)! + (m.blueRp ?? 0));
        baseTb.set(t, baseTb.get(t)! + (m.blueActual ?? 0));
      }
    } else {
      toSim.push(m);
    }
  }

  // Accumulators over iterations.
  const rankSum = new Map<TeamKey, number>(teamList.map((t) => [t, 0]));
  const rankSq = new Map<TeamKey, number>(teamList.map((t) => [t, 0]));
  const rankHist = new Map<TeamKey, number[]>(teamList.map((t) => [t, []]));
  const rank1 = new Map<TeamKey, number>(teamList.map((t) => [t, 0]));
  const top8 = new Map<TeamKey, number>(teamList.map((t) => [t, 0]));
  const rpSum = new Map<TeamKey, number>(teamList.map((t) => [t, 0]));

  const rng = makeRng(12345); // fixed seed → reproducible runs
  const gauss = makeGaussian(rng);
  const N = settings.iterations;

  const sampleAlliance = (t3: TeamKey[]): { total: number; byComp: number[] } => {
    const byComp: number[] = [];
    let total = 0;
    for (let ci = 0; ci < comps.length; ci++) {
      const c = comps[ci];
      let mean = 0;
      let variance = residualVariance[c] ?? 0;
      for (const t of t3) {
        const cc = teamComp.get(t)?.[c];
        if (cc) {
          mean += cc.mean;
          variance += cc.variance;
        }
      }
      const s = Math.max(0, gauss(mean, variance));
      byComp.push(s);
      total += s;
    }
    return { total, byComp };
  };

  const bonusRp = (byComp: number[]): number => {
    let rp = 0;
    for (const b of rpModel.bonuses) {
      const coef = b.byLevel[level];
      let z = coef.bias;
      for (let ci = 0; ci < comps.length; ci++) z += coef.weights[comps[ci]] * byComp[ci];
      if (rng() < sigmoid(z)) rp += 1;
    }
    return rp;
  };

  for (let iter = 0; iter < N; iter++) {
    const rp = new Map(baseRp);
    const tb = new Map(baseTb);
    for (const m of toSim) {
      const r = sampleAlliance(m.red);
      const b = sampleAlliance(m.blue);
      let redRp: number, blueRp: number;
      if (r.total > b.total) {
        redRp = rpModel.win;
        blueRp = rpModel.loss;
      } else if (r.total < b.total) {
        redRp = rpModel.loss;
        blueRp = rpModel.win;
      } else {
        redRp = blueRp = rpModel.tie;
      }
      redRp += bonusRp(r.byComp);
      blueRp += bonusRp(b.byComp);
      for (const t of m.red) {
        rp.set(t, rp.get(t)! + redRp);
        tb.set(t, tb.get(t)! + r.total);
      }
      for (const t of m.blue) {
        rp.set(t, rp.get(t)! + blueRp);
        tb.set(t, tb.get(t)! + b.total);
      }
    }

    // Rank by RP desc, then tiebreak score desc.
    const ranked = teamList
      .slice()
      .sort((x, y) => rp.get(y)! - rp.get(x)! || tb.get(y)! - tb.get(x)!);
    ranked.forEach((t, i) => {
      const rank = i + 1;
      rankSum.set(t, rankSum.get(t)! + rank);
      rankSq.set(t, rankSq.get(t)! + rank * rank);
      rankHist.get(t)!.push(rank);
      if (rank === 1) rank1.set(t, rank1.get(t)! + 1);
      if (rank <= 8) top8.set(t, top8.get(t)! + 1);
      rpSum.set(t, rpSum.get(t)! + rp.get(t)!);
    });
  }

  const pct = (arr: number[], q: number) => {
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
  };

  const results: TeamSimResult[] = teamList.map((t) => {
    const mean = rankSum.get(t)! / N;
    const varr = rankSq.get(t)! / N - mean * mean;
    const hist = rankHist.get(t)!;
    return {
      team: t,
      meanRank: mean,
      medianRank: pct(hist, 0.5),
      sdRank: Math.sqrt(Math.max(varr, 0)),
      p5Rank: pct(hist, 0.05),
      p95Rank: pct(hist, 0.95),
      pRank1: rank1.get(t)! / N,
      pTop8: top8.get(t)! / N,
      meanRp: rpSum.get(t)! / N,
    };
  });
  results.sort((a, b) => a.meanRank - b.meanRank);
  return results;
}
