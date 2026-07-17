// Multi-season walk-forward eval for cross-season carryover.
//
//   npm run eval:carry
//
// For each consecutive season pair (S -> S+1): fit S, normalize it to a z-map,
// seed S+1's per-team priors from it at strength rho, then prequentially predict
// S+1. We split log-loss into EARLY matches (teams with little in-season data
// yet — where a good prior matters most) and ALL matches. Carryover should help
// the early bucket; if it also helps overall, even better.

import { fetchSeasonMatches, componentsFor } from "./fetch";
import type { ObservedMatch } from "./fetch";
import { estimatePriors, type Priors } from "./priors";
import { KalmanModel, type KalmanConfig, type TeamPrior } from "./kalman";
import { normalizeSeason, buildTeamPriors } from "./carryover";
import { probAGreaterThanB } from "../src/core/stats";
import type { ComponentId, Season } from "../src/core/types";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  /* rely on real env */
}

const SEASONS: Season[] = [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025];
const ALPHA = 0.01;
const EARLY_GP = 6; // a match is "early" if its teams average < this many prior games
const EPS = 1e-6;
const clamp = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));

function makeCfg(
  components: ComponentId[],
  priors: Priors,
  teamPriors: Map<number, TeamPrior>,
): KalmanConfig {
  const processNoise: Record<ComponentId, number> = {};
  for (const c of components) processNoise[c] = ALPHA * priors.measurementNoise[c];
  return {
    components,
    priorMean: priors.priorMean,
    priorVariance: priors.priorVariance,
    measurementNoise: priors.measurementNoise,
    processNoise,
    eventGapInflation: 3.0,
    adaptStrength: 0,
    adaptDecay: 0.7,
    teamPriors,
  };
}

interface Acc {
  llEarly: number;
  nEarly: number;
  llAll: number;
  nAll: number;
}
const zero = (): Acc => ({ llEarly: 0, nEarly: 0, llAll: 0, nAll: 0 });

async function fitZMap(season: Season): Promise<Map<number, number>> {
  const components = componentsFor(season);
  const matches = await fetchSeasonMatches(season);
  const priors = estimatePriors(matches, components);
  const model = new KalmanModel(makeCfg(components, priors, new Map()));
  for (const m of matches) model.step(m);
  return normalizeSeason(model.toStateFile(season));
}

function evalNext(
  matches: ObservedMatch[],
  components: ComponentId[],
  priors: Priors,
  teamPriors: Map<number, TeamPrior>,
  acc: Acc,
): void {
  const model = new KalmanModel(makeCfg(components, priors, teamPriors));
  const gp = new Map<number, number>();
  for (const m of matches) {
    if (m.redTeams.length !== 3 || m.blueTeams.length !== 3) continue;
    model.advanceMatch(m);
    const red = model.predictAlliance(m.redTeams);
    const blue = model.predictAlliance(m.blueTeams);
    const teams = [...m.redTeams, ...m.blueTeams];
    const meanGp = teams.reduce((s, t) => s + (gp.get(t) ?? 0), 0) / 6;

    if (m.redScore !== m.blueScore) {
      const p = clamp(probAGreaterThanB(red.mean, red.variance, blue.mean, blue.variance));
      const y = m.redScore > m.blueScore ? 1 : 0;
      const ll = -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      acc.llAll += ll;
      acc.nAll++;
      if (meanGp < EARLY_GP) {
        acc.llEarly += ll;
        acc.nEarly++;
      }
    }
    model.observeMatch(m);
    for (const t of teams) gp.set(t, (gp.get(t) ?? 0) + 1);
  }
}

async function main() {
  const rhos = [0, 0.3, 0.5, 0.6, 0.75, 0.9];
  const totals = new Map(rhos.map((r) => [r, zero()]));

  for (let i = 0; i < SEASONS.length - 1; i++) {
    const prev = SEASONS[i];
    const next = SEASONS[i + 1];
    process.stdout.write(`  ${prev} -> ${next}: fitting ${prev}… `);
    const zMap = await fitZMap(prev);

    const components = componentsFor(next);
    const matches = await fetchSeasonMatches(next);
    const priors = estimatePriors(matches, components);

    for (const rho of rhos) {
      const teamPriors = buildTeamPriors(zMap, priors, components, rho);
      evalNext(matches, components, priors, teamPriors, totals.get(rho)!);
    }
    console.log(`done (${zMap.size} carried)`);
  }

  console.log(`\n  Carryover sweep (averaged over ${SEASONS.length - 1} season transitions):\n`);
  console.log("  rho    earlyLogLoss   allLogLoss");
  console.log("  " + "-".repeat(40));
  let bestEarly = { rho: 0, ll: Infinity };
  for (const rho of rhos) {
    const a = totals.get(rho)!;
    const early = a.llEarly / a.nEarly;
    const all = a.llAll / a.nAll;
    if (early < bestEarly.ll) bestEarly = { rho, ll: early };
    console.log(
      `  ${rho.toFixed(2)}   ${early.toFixed(4)}        ${all.toFixed(4)}` +
        (rho === 0 ? "   (no carryover)" : ""),
    );
  }
  console.log("  " + "-".repeat(40));
  const base = totals.get(0)!;
  console.log(
    `  Best early rho=${bestEarly.rho}: ` +
      `${(base.llEarly / base.nEarly).toFixed(4)} -> ${bestEarly.ll.toFixed(4)} ` +
      `on ${base.nEarly} early matches.`,
  );
}

main().catch((e) => {
  console.error("\nCarryover eval failed:\n" + (e?.message ?? e));
  process.exit(1);
});
