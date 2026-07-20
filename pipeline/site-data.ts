// Site data builder: produces the browsable artifacts (team pages, event list,
// match records) for one season.
//
//   npm run site -- 2026
//
// The key detail: as the Kalman filter streams matches in time order, the state
// right before folding match k in IS "everything known just before match k" — so
// the prediction we capture there is exactly the pre-match prediction a played
// match should display. (Unplayed matches, once live data flows, would instead
// show the current best prediction — same snapshot shape.)

import {
  fetchSeasonMatches,
  componentsFor,
  fetchEvents,
  fetchTeamNames,
} from "./fetch";
import { normalizeSeason } from "./carryover";
import { buildEventFiles } from "./event-data";
import { fitSeason, groupByTeam, buildTeamData, ALPHA, RHO } from "./season-fit";
import type { Season, SeasonTeamsIndex, TeamIndexEntry } from "../src/core/types";
import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  /* rely on real env */
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(ROOT, "public", "data");
const BUILT_SEASONS = [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026];

async function writeJson(relPath: string, data: unknown) {
  const full = resolve(DATA_DIR, relPath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(data));
}

/** Carryover z-map from the most recent already-built season before `season`. */
async function loadCarry(season: Season): Promise<Map<number, number>> {
  const prev = BUILT_SEASONS.filter((s) => s < season).pop();
  if (prev === undefined) return new Map();
  try {
    const raw = await readFile(resolve(DATA_DIR, `seasons/${prev}.json`), "utf8");
    return normalizeSeason(JSON.parse(raw));
  } catch {
    return new Map();
  }
}

async function main() {
  const season = (Number(process.argv[2]) || 2026) as Season;
  const components = componentsFor(season);
  console.log(`Building site data for ${season}…`);

  const [matches, events, names] = await Promise.all([
    fetchSeasonMatches(season),
    fetchEvents(season),
    fetchTeamNames(),
  ]);
  const eventByKey = new Map(events.map((e) => [e.key, e]));
  console.log(`  ${matches.length} matches, ${events.length} events`);

  // Fit the season, seeded with cross-season carryover. Shared with the
  // incremental updater so the two paths can never diverge.
  const carry = await loadCarry(season);
  const fit = fitSeason(season, matches, components, carry);
  const { state, records, tolerance } = fit;
  const perTeam = groupByTeam(records);

  // Fresh dir so deleted/renamed teams don't linger.
  const teamsDir = `teams/${season}`;
  await rm(resolve(DATA_DIR, teamsDir), { recursive: true, force: true });

  const index: TeamIndexEntry[] = [];
  for (const [team, teamMatches] of perTeam) {
    const built = buildTeamData(
      season,
      team,
      teamMatches,
      fit,
      components,
      names,
      eventByKey,
    );
    if (!built) continue;
    await writeJson(`${teamsDir}/${team}.json`, built.data);
    index.push(built.index);
  }

  index.sort((a, b) => b.overall - a.overall);
  const teamsIndex: SeasonTeamsIndex = { season, teams: index };
  await writeJson(`teams/${season}/index.json`, teamsIndex);
  await writeJson(`events/${season}.json`, events);

  console.log(
    `  wrote ${index.length} team files + index + ${events.length} events for ${season}.`,
  );

  console.log(`  season prediction accuracy: ${fit.seasonAccuracy.toFixed(1)}%`);

  // Per-event pages: reuse this fit's match predictions + ratings.
  await buildEventFiles(season, records, state, events, names, DATA_DIR, fit.seasonAccuracy);
}

main().catch((e) => {
  console.error("\nSite-data build failed:\n" + (e?.message ?? e));
  process.exit(1);
});
