// Pipeline orchestrator: fetch (TBA) -> train (ridge OPR) -> emit static JSON.
//
//   npm run pipeline                 # build all SEASONS below
//   npm run pipeline -- 2016         # build just 2016
//   npm run pipeline -- inspect 2016necmp   # dump one event's raw breakdown
//
// Needs TBA_AUTH_KEY (in .env or the environment).

import { fetchSeasonMatches, componentsFor, inspectEvent, inspectSeason } from "./fetch";
import { estimatePriors } from "./priors";
import { KalmanModel, type KalmanConfig } from "./kalman";
import { buildTeamPriors, normalizeSeason } from "./carryover";
import type { ComponentId, Manifest, Season } from "../src/core/types";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env if present (Node >= 20.12). Harmless if the file is absent.
try {
  process.loadEnvFile(resolve(process.cwd(), ".env"));
} catch {
  /* no .env — rely on real environment variables */
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(ROOT, "public", "data");

// Seasons we currently have a decomposer for. 2021 is skipped (no traditional
// season — the at-home game has no comparable alliance scores).
const SEASONS: Season[] = [
  2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026,
];

// Learning-rate multiplier (process noise Q = ALPHA * R) and adaptive-gain
// strength (KAPPA), tuned per season by `npm run eval`.
const ALPHA = 0.01;
const KAPPA = 0; // adaptive gain — off; did not beat fixed rate (see eval)
const RHO = 0.6; // cross-season carryover strength, tuned by `npm run eval:carry`

/** Reconstruct the carryover map from the most recent already-built season on
 *  disk that precedes `season`, so partial rebuilds inherit carryover. */
async function loadCarryFromDisk(season: Season): Promise<Map<number, number>> {
  const prev = SEASONS.filter((s) => s < season).pop();
  if (prev === undefined) return new Map();
  try {
    const raw = await readFile(resolve(DATA_DIR, `seasons/${prev}.json`), "utf8");
    return normalizeSeason(JSON.parse(raw));
  } catch {
    return new Map(); // previous season not built yet — no carryover
  }
}

async function writeJson(relPath: string, data: unknown) {
  const full = resolve(DATA_DIR, relPath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(data) + "\n");
  console.log(`wrote ${relPath}`);
}

/**
 * Fit one season. `carry` is the previous season's normalized-strength map, used
 * to seed per-team priors for returning teams. Returns THIS season's map to
 * chain into the next season.
 */
async function buildSeason(
  season: Season,
  carry: Map<number, number>,
): Promise<Map<number, number>> {
  console.log(`\n=== ${season} ===`);
  const components = componentsFor(season);
  const matches = await fetchSeasonMatches(season);

  // Seed measurement noise + cold-start priors from a quick ridge-OPR fit.
  const priors = estimatePriors(matches, components);
  const processNoise: Record<ComponentId, number> = {};
  for (const c of components) processNoise[c] = ALPHA * priors.measurementNoise[c];

  // Cross-season carryover: returning teams start from last season's strength.
  const teamPriors = buildTeamPriors(carry, priors, components, RHO);

  const cfg: KalmanConfig = {
    components,
    priorMean: priors.priorMean,
    priorVariance: priors.priorVariance,
    measurementNoise: priors.measurementNoise,
    processNoise,
    eventGapInflation: 3.0,
    adaptStrength: KAPPA,
    adaptDecay: 0.7,
    teamPriors,
  };
  const model = new KalmanModel(cfg);
  for (const m of matches) model.step(m);

  const state = model.toStateFile(season);
  const nextCarry = normalizeSeason(state); // annotates normalizedRating too
  await writeJson(`seasons/${season}.json`, state);
  console.log(
    `  ${state.teams.length} teams rated (alpha=${ALPHA}, rho=${RHO}, ` +
      `${teamPriors.size} seeded from prior season)`,
  );
  return nextCarry;
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "inspect") {
    const target = args[1];
    if (!target) throw new Error("usage: pipeline inspect <eventKey|season>");
    // A bare 4-digit number is a season; anything else is an event key.
    if (/^\d{4}$/.test(target)) await inspectSeason(Number(target) as Season);
    else await inspectEvent(target);
    return;
  }

  const seasons = (args.length ? args.map(Number) : SEASONS).sort((a, b) => a - b);
  // Seed the chain from the previously-built season on disk, so partial builds
  // (e.g. just 2024) still inherit carryover from 2023.
  let carry = await loadCarryFromDisk(seasons[0]);
  for (const season of seasons) {
    carry = await buildSeason(season, carry);
  }

  // The manifest always advertises the full canonical season list, not just the
  // subset built in this run, so partial rebuilds don't drop seasons from the UI.
  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    seasons: SEASONS,
    tuning: { alpha: ALPHA, rho: RHO, kappa: KAPPA },
  };
  await writeJson("manifest.json", manifest);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("\nPipeline failed:\n" + (err?.message ?? err));
  process.exit(1);
});
