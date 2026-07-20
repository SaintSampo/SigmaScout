// Incremental updater for live events.
//
//   npm run update -- 2026              # auto-detect in-progress events
//   npm run update -- 2026 2026iri      # or name them explicitly
//
// Cost profile vs a full rebuild:
//   network : 1 event (matches + rankings + alliances) instead of ~285
//   fit     : full streaming Kalman over cached matches — sub-second, exact
//   writes  : ~50-100 affected team files + 1 event file + 2 indexes,
//             instead of ~4,000 files
//
// The fit is deliberately NOT resumed from persisted filter state: re-streaming
// cached matches is cheap and guarantees the incremental result is bit-identical
// to a full rebuild (no drift). Only I/O is incremental.

import {
  fetchSeasonMatches,
  fetchEventObservedMatches,
  fetchEvents,
  fetchTeamNames,
  componentsFor,
} from "./fetch";
import type { ObservedMatch } from "./fetch";
import { fitSeason, groupByTeam, buildTeamData } from "./season-fit";
import { normalizeSeason } from "./carryover";
import { buildEventFiles } from "./event-data";
import type { Season, SeasonTeamsIndex, TeamIndexEntry } from "../src/core/types";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  /* rely on env */
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(ROOT, "public", "data");
const CACHE_DIR = resolve(ROOT, ".cache");
const BUILT_SEASONS = [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026];

async function writeJson(relPath: string, data: unknown) {
  const full = resolve(DATA_DIR, relPath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(data));
}

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

/**
 * Events whose data may be stale: any event that has started recently and either
 * is still within its date window, or still shows unplayed matches in our data
 * (meaning reality has moved past our last snapshot). Staleness beats a pure
 * date window — an event that finished while we weren't looking still needs a
 * final pull.
 */
async function findStale(
  season: Season,
  events: { key: string; startDate?: string; endDate?: string }[],
): Promise<string[]> {
  const now = Date.now();
  const day = 86400000;
  const out: string[] = [];
  for (const e of events) {
    if (!e.startDate) continue;
    const start = Date.parse(`${e.startDate}T00:00:00Z`);
    const end = Date.parse(`${e.endDate ?? e.startDate}T00:00:00Z`) + day;
    if (start > now + day) continue; // hasn't started
    if (end < now - 14 * day) continue; // long finished; assume settled
    const ongoing = now >= start - day && now <= end + day;
    let hasUnplayed = false;
    try {
      const raw = await readFile(
        resolve(DATA_DIR, `events/${season}/${e.key}.json`),
        "utf8",
      );
      const d = JSON.parse(raw);
      hasUnplayed = [...d.qualMatches, ...d.elimMatches].some((m: { played: boolean }) => !m.played);
    } catch {
      hasUnplayed = true; // no file yet — pull it
    }
    if (ongoing || hasUnplayed) out.push(e.key);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const season = (Number(args[0]) || 2026) as Season;
  const explicit = args.slice(1);
  const components = componentsFor(season);
  const t0 = Date.now();

  const [cached, events, names] = await Promise.all([
    fetchSeasonMatches(season), // from cache — no network
    fetchEvents(season),
    fetchTeamNames(),
  ]);
  const eventByKey = new Map(events.map((e) => [e.key, e]));

  const targets = explicit.length ? explicit : await findStale(season, events);
  if (targets.length === 0) {
    console.log("No live or stale events found — nothing to update.");
    return;
  }
  console.log(
    `Updating ${targets.length} event(s): ${targets
      .map((k) => eventByKey.get(k)?.name ?? k)
      .join(", ")}`,
  );

  // Pull fresh matches for just those events and splice them into the cache.
  const known = new Set(cached.map((m) => m.key));
  let fresh: ObservedMatch[] = [];
  for (const ek of targets) {
    fresh = fresh.concat(await fetchEventObservedMatches(season, ek));
  }
  const newMatches = fresh.filter((m) => !known.has(m.key));
  const targetSet = new Set(targets);
  const merged = cached
    .filter((m) => !targetSet.has(m.eventKey)) // drop stale copies of these events
    .concat(fresh)
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt));

  console.log(
    `  ${newMatches.length} new match(es); season now ${merged.length} played matches`,
  );
  if (newMatches.length === 0 && merged.length === cached.length) {
    console.log("Nothing new — done.");
    return;
  }

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(resolve(CACHE_DIR, `matches-${season}.json`), JSON.stringify(merged));

  // Full (cheap, exact) refit over cached matches.
  const carry = await loadCarry(season);
  const fitStart = Date.now();
  const fit = fitSeason(season, merged, components, carry);
  console.log(
    `  refit in ${Date.now() - fitStart}ms · season accuracy ${fit.seasonAccuracy.toFixed(1)}%`,
  );

  // Only teams that played at the updated events had their ratings change.
  const affected = new Set<number>();
  for (const m of merged) {
    if (targetSet.has(m.eventKey)) for (const t of [...m.redTeams, ...m.blueTeams]) affected.add(t);
  }

  // Re-emit affected team files + refresh their rows in the directory index.
  const perTeam = groupByTeam(fit.records);
  const indexPath = resolve(DATA_DIR, `teams/${season}/index.json`);
  const index: SeasonTeamsIndex = JSON.parse(await readFile(indexPath, "utf8"));
  const rowByTeam = new Map<number, TeamIndexEntry>(index.teams.map((t) => [t.team, t]));

  let written = 0;
  for (const team of affected) {
    const built = buildTeamData(
      season,
      team,
      perTeam.get(team) ?? [],
      fit,
      components,
      names,
      eventByKey,
    );
    if (!built) continue;
    await writeJson(`teams/${season}/${team}.json`, built.data);
    rowByTeam.set(team, built.index);
    written++;
  }
  index.teams = [...rowByTeam.values()].sort((a, b) => b.overall - a.overall);
  await writeJson(`teams/${season}/index.json`, index);

  // Season state (ratings) + the updated events themselves.
  await writeJson(`seasons/${season}.json`, fit.state);
  await buildEventFiles(
    season,
    fit.records,
    fit.state,
    events,
    names,
    DATA_DIR,
    fit.seasonAccuracy,
    targets,
  );

  console.log(
    `Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
      `${written} team files, ${targets.length} event file(s), 2 indexes.`,
  );
}

main().catch((e) => {
  console.error("\nIncremental update failed:\n" + (e?.message ?? e));
  process.exit(1);
});
