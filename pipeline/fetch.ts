// Data ingestion from The Blue Alliance (v3). Needs a free read key in the
// TBA_AUTH_KEY env var (thebluealliance.com/account -> "Read API Key").
//
// The only season-specific piece is the score-breakdown -> component mapping,
// isolated in DECOMPOSERS. Everything else is generic.

import type { ComponentId, EventInfo, Season } from "../src/core/types";
import { RP_CONFIG } from "./rp-config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const TBA_BASE = "https://www.thebluealliance.com/api/v3";
const CACHE_DIR = resolve(process.cwd(), ".cache");

/** One alliance's observed score for one match, decomposed by component. */
export interface ObservedMatch {
  season: Season;
  eventKey: string;
  /** TBA match key, e.g. "2026alhu_qm11". */
  key: string;
  /** "qm" | "ef" | "qf" | "sf" | "f". */
  compLevel: string;
  /** Match number within its comp level (and set, for playoffs). */
  matchNumber: number;
  setNumber: number;
  /** ISO timestamp; used for time-ordering the filter and display. */
  playedAt: string;
  redTeams: number[];
  blueTeams: number[];
  redByComponent: Record<ComponentId, number>;
  blueByComponent: Record<ComponentId, number>;
  /**
   * Official final alliance scores (INCLUDING foul points). These decide who
   * actually won and are what the scoreboard shows — use them for results and
   * W/L. The *ByComponent sums exclude fouls (correct for skill estimation) and
   * can therefore disagree with the winner, so never derive outcomes from them.
   */
  redScore: number;
  blueScore: number;
  /** Actual ranking points earned by each alliance this match. */
  redRp: number;
  blueRp: number;
  /** Bonus-RP achievement flags, aligned to RP_CONFIG[season].bonuses ([] if
   *  the season has no RP config). Used to fit the RP model. */
  redBonuses: boolean[];
  blueBonuses: boolean[];
}

function authKey(): string {
  const key = process.env.TBA_AUTH_KEY;
  if (!key) {
    throw new Error(
      "TBA_AUTH_KEY is not set. Get a free read key at " +
        "https://www.thebluealliance.com/account and put it in .env " +
        "(TBA_AUTH_KEY=...).",
    );
  }
  return key;
}

async function tbaGet<T>(path: string): Promise<T> {
  const res = await fetch(`${TBA_BASE}${path}`, {
    headers: { "X-TBA-Auth-Key": authKey(), Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`TBA ${path} -> ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// --- Minimal shapes of the TBA responses we touch ---

interface TbaMatch {
  key: string;
  comp_level: string; // qm, ef, qf, sf, f
  match_number: number;
  set_number: number;
  event_key: string;
  actual_time: number | null;
  predicted_time: number | null;
  time: number | null;
  alliances: {
    red: { team_keys: string[]; score: number };
    blue: { team_keys: string[]; score: number };
  };
  score_breakdown: {
    red: Record<string, number | boolean>;
    blue: Record<string, number | boolean>;
  } | null;
}

const teamNum = (key: string) => Number(key.replace("frc", ""));

interface TbaEvent {
  key: string;
  name: string;
  short_name: string | null;
  week: number | null;
  city: string | null;
  start_date: string | null;
  end_date: string | null;
  event_type: number;
}

// TBA event_type ints that count as championship-level (raised RP thresholds):
// 2=District CMP, 3=CMP Division, 4=CMP Finals, 5=District CMP Division.
const CHAMP_TYPES = new Set([2, 3, 4, 5]);
// Official competition types are 0..6; 99=offseason, 100=preseason.
const isOfficialType = (t: number) => t >= 0 && t <= 6;

/** Event metadata for a season (names, weeks, locations, level). */
export async function fetchEvents(season: Season): Promise<EventInfo[]> {
  const evs = await tbaGet<TbaEvent[]>(`/events/${season}`);
  return evs.map((e) => ({
    key: e.key,
    name: e.name,
    shortName: e.short_name ?? undefined,
    week: e.week ?? undefined,
    city: e.city ?? undefined,
    startDate: e.start_date ?? undefined,
    endDate: e.end_date ?? undefined,
    level: CHAMP_TYPES.has(e.event_type) ? "champ" : "regular",
    official: isOfficialType(e.event_type),
    offseason: e.event_type === 99,
  }));
}

/** A single scheduled match (played or not) for one event. */
export interface ScheduleEntry {
  key: string;
  compLevel: string;
  matchNumber: number;
  setNumber: number;
  time?: string;
  red: number[];
  blue: number[];
  played: boolean;
}

/** All matches for an event — INCLUDING unplayed/scheduled ones (for live events). */
export async function fetchEventSchedule(eventKey: string): Promise<ScheduleEntry[]> {
  const matches = await tbaGet<TbaMatch[]>(`/event/${eventKey}/matches`);
  return matches
    .filter((m) => m.alliances.red.team_keys.length === 3 && m.alliances.blue.team_keys.length === 3)
    .map((m) => ({
      key: m.key,
      compLevel: m.comp_level,
      matchNumber: m.match_number,
      setNumber: m.set_number,
      time: playedAtIso(m),
      red: m.alliances.red.team_keys.map(teamNum),
      blue: m.alliances.blue.team_keys.map(teamNum),
      played: m.score_breakdown != null,
    }));
}

interface TbaRanking {
  rank: number;
  team_key: string;
  record: { wins: number; losses: number; ties: number } | null;
  matches_played: number;
  sort_orders: number[];
}

/** Actual current rankings for an event ([] if none posted yet). */
export async function fetchEventRankings(
  eventKey: string,
): Promise<import("../src/core/types").RankingRow[]> {
  const data = await tbaGet<{ rankings: TbaRanking[] | null }>(
    `/event/${eventKey}/rankings`,
  );
  if (!data.rankings) return [];
  return data.rankings.map((r) => {
    const rankingScore = r.sort_orders?.[0] ?? 0; // [0] is Ranking Score = avg RP
    return {
      rank: r.rank,
      team: teamNum(r.team_key),
      rankingScore,
      rp: Math.round(rankingScore * r.matches_played),
      wins: r.record?.wins ?? 0,
      losses: r.record?.losses ?? 0,
      ties: r.record?.ties ?? 0,
      matchesPlayed: r.matches_played,
    };
  });
}

/** Playoff alliance selections for an event ([] if not selected yet). */
export async function fetchEventAlliances(
  eventKey: string,
): Promise<import("../src/core/types").AllianceSelection[]> {
  const data = await tbaGet<{ picks: string[] }[] | null>(
    `/event/${eventKey}/alliances`,
  );
  if (!data) return [];
  return data.map((a, i) => ({
    number: i + 1,
    picks: a.picks.map(teamNum),
  }));
}

/** Global team-number -> nickname map (all teams), cached under .cache/. */
export async function fetchTeamNames(): Promise<Map<number, string>> {
  const cacheFile = resolve(CACHE_DIR, "team-names.json");
  try {
    const arr = JSON.parse(await readFile(cacheFile, "utf8")) as [number, string][];
    return new Map(arr);
  } catch {
    /* fetch below */
  }
  const map = new Map<number, string>();
  for (let page = 0; page < 40; page++) {
    const teams = await tbaGet<{ team_number: number; nickname: string }[]>(
      `/teams/${page}/simple`,
    );
    if (teams.length === 0) break;
    for (const t of teams) map.set(t.team_number, t.nickname);
  }
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFile, JSON.stringify([...map]));
  return map;
}

const num = (v: number | boolean | undefined) =>
  typeof v === "number" ? v : 0;

/** Season -> (one alliance's raw breakdown) -> component scores. */
type Decomposer = (b: Record<string, number | boolean>) => Record<ComponentId, number>;

/**
 * 2016 FIRST Stronghold. Verified against live data (2016necmp_f1m1):
 *   auto    = autoPoints (reach + auto crossings + auto boulders)
 *   endgame = teleopChallengePoints + teleopScalePoints (tower challenge/scale)
 *   teleop  = teleopPoints - endgame  (crossings + boulders + breach + capture)
 * teleopPoints ALREADY includes breach/capture, so we must NOT add them again
 * (verified: auto + teleop + endgame == totalPoints when fouls == 0). Foul and
 * adjust points are intentionally excluded — fouls are the OPPONENT's
 * contribution, not this alliance's, so folding them in would corrupt OPR.
 */
const decompose2016: Decomposer = (b) => {
  const endgame = num(b.teleopChallengePoints) + num(b.teleopScalePoints);
  return {
    auto: num(b.autoPoints),
    teleop: num(b.teleopPoints) - endgame,
    endgame,
  };
};

/**
 * Standard pattern for 2017+ games: TBA reports `autoPoints`, `teleopPoints`
 * (which INCLUDES the endgame), and a game-specific endgame field. So:
 *   auto    = autoPoints
 *   endgame = sum of the named endgame field(s)
 *   teleop  = teleopPoints - endgame
 * Fouls/adjust excluded (opponent-caused). Verified per season via `inspect`
 * that auto + teleop + endgame == totalPoints - foulPoints - adjustPoints.
 */
const standard =
  (...endgameFields: string[]): Decomposer =>
  (b) => {
    const endgame = endgameFields.reduce((s, f) => s + num(b[f]), 0);
    return {
      auto: num(b.autoPoints),
      teleop: num(b.teleopPoints) - endgame,
      endgame,
    };
  };

/**
 * 2023 Charged Up is the odd one out: `teleopPoints` = teleop game pieces +
 * endgame charge + park, but `linkPoints` (the link bonus) sits OUTSIDE
 * teleopPoints. Verified (2023alhu_f1m1 red): auto 49 + teleop 79 + links 30 =
 * total 158. So we fold links into teleop and keep charge+park as endgame.
 */
const decompose2023: Decomposer = (b) => {
  const endgame = num(b.endGameChargeStationPoints) + num(b.endGameParkPoints);
  return {
    auto: num(b.autoPoints),
    teleop: num(b.teleopPoints) - endgame + num(b.linkPoints),
    endgame,
  };
};

/**
 * 2026 uses total*Points field names, and the "Tower" climb points are nested
 * INSIDE those totals (not a separate addend): total = totalAutoPoints +
 * totalTeleopPoints (+ foul + adjust). autoTowerPoints is already within
 * totalAutoPoints and endGameTowerPoints within totalTeleopPoints. Verified over
 * 1200+ alliance-scores including non-zero climbs:
 *   auto    = totalAutoPoints (includes auto-phase climb)
 *   endgame = endGameTowerPoints
 *   teleop  = totalTeleopPoints - endGameTowerPoints
 */
const decompose2026: Decomposer = (b) => {
  const endgame = num(b.endGameTowerPoints);
  return {
    auto: num(b.totalAutoPoints),
    teleop: num(b.totalTeleopPoints) - endgame,
    endgame,
  };
};

const THREE: ComponentId[] = ["auto", "teleop", "endgame"];

const DECOMPOSERS: Record<number, { components: ComponentId[]; fn: Decomposer }> = {
  2016: { components: THREE, fn: decompose2016 },
  2017: { components: THREE, fn: standard("teleopTakeoffPoints") }, // Steamworks: climb
  2018: { components: THREE, fn: standard("endgamePoints") }, // Power Up: climb/park
  2019: { components: THREE, fn: standard("habClimbPoints") }, // Deep Space: hab climb
  2020: { components: THREE, fn: standard("endgamePoints") }, // Infinite Recharge: hang/park
  2022: { components: THREE, fn: standard("endgamePoints") }, // Rapid React: traversal climb
  2023: { components: THREE, fn: decompose2023 }, // Charged Up: links sit outside teleopPoints
  2024: { components: THREE, fn: standard("endGameTotalStagePoints") }, // Crescendo: stage
  2025: { components: THREE, fn: standard("endGameBargePoints") }, // Reefscape: barge/climb
  2026: { components: THREE, fn: decompose2026 }, // Tower: separate totalAuto/Teleop/Tower fields
};

export function componentsFor(season: Season): ComponentId[] {
  const d = DECOMPOSERS[season];
  if (!d) throw new Error(`No decomposer defined for season ${season} yet.`);
  return d.components;
}

function playedAtIso(m: TbaMatch): string {
  const unix = m.actual_time ?? m.time ?? m.predicted_time;
  return unix ? new Date(unix * 1000).toISOString() : `${m.event_key}`;
}

/** Extract this season's bonus-RP achievement flags from a raw breakdown. */
function bonusFlagsFor(season: Season) {
  const cfg = RP_CONFIG[season];
  return (bd: Record<string, number | boolean>): boolean[] =>
    cfg ? cfg.bonuses.map((b) => bd[b.field] === true) : [];
}

/**
 * Fetch all played, decomposed matches for a season, caching the result under
 * .cache/ so repeated eval/build runs don't refetch from TBA. Pass
 * refresh=true to force a network pull.
 */
export async function fetchSeasonMatches(
  season: Season,
  refresh = false,
): Promise<ObservedMatch[]> {
  const cacheFile = resolve(CACHE_DIR, `matches-${season}.json`);
  if (!refresh) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, "utf8")) as ObservedMatch[];
      console.log(`  loaded ${cached.length} matches from cache`);
      return cached;
    } catch {
      /* no cache — fall through to network */
    }
  }
  const matches = await fetchSeasonMatchesFromNetwork(season);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(matches));
  return matches;
}

async function fetchSeasonMatchesFromNetwork(season: Season): Promise<ObservedMatch[]> {
  const decomposer = DECOMPOSERS[season];
  if (!decomposer) throw new Error(`No decomposer defined for season ${season} yet.`);

  const eventKeys = await tbaGet<string[]>(`/events/${season}/keys`);
  console.log(`  ${eventKeys.length} events in ${season}`);
  const bonusFlags = bonusFlagsFor(season);

  const out: ObservedMatch[] = [];
  let done = 0;
  // Modest concurrency: polite to TBA, still quick.
  const CONCURRENCY = 6;
  for (let i = 0; i < eventKeys.length; i += CONCURRENCY) {
    const batch = eventKeys.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((ek) => tbaGet<TbaMatch[]>(`/event/${ek}/matches`)),
    );
    for (const matches of results) {
      for (const m of matches) {
        if (!m.score_breakdown) continue; // unplayed
        out.push({
          season,
          eventKey: m.event_key,
          key: m.key,
          compLevel: m.comp_level,
          matchNumber: m.match_number,
          setNumber: m.set_number,
          playedAt: playedAtIso(m),
          redTeams: m.alliances.red.team_keys.map(teamNum),
          blueTeams: m.alliances.blue.team_keys.map(teamNum),
          redByComponent: decomposer.fn(m.score_breakdown.red),
          blueByComponent: decomposer.fn(m.score_breakdown.blue),
          redScore: m.alliances.red.score,
          blueScore: m.alliances.blue.score,
          redRp: num(m.score_breakdown.red.rp),
          blueRp: num(m.score_breakdown.blue.rp),
          redBonuses: bonusFlags(m.score_breakdown.red),
          blueBonuses: bonusFlags(m.score_breakdown.blue),
        });
      }
    }
    done += batch.length;
    if (done % 30 < CONCURRENCY) console.log(`  fetched ${done}/${eventKeys.length} events`);
  }
  out.sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  console.log(`  ${out.length} played matches`);
  return out;
}

function reconcile(season: Season, side: Record<string, number | boolean>): string {
  const d = DECOMPOSERS[season].fn(side);
  const sum = d.auto + d.teleop + d.endgame;
  const total = num(side.totalPoints);
  const expected = total - num(side.foulPoints) - num(side.adjustPoints);
  const ok = Math.abs(sum - expected) < 1e-6;
  return (
    `auto=${d.auto} teleop=${d.teleop} endgame=${d.endgame} | sum=${sum} ` +
    `vs total-foul-adjust=${expected} ${ok ? "OK" : "*** MISMATCH ***"}`
  );
}

/** Inspect one event by key. */
export async function inspectEvent(eventKey: string): Promise<void> {
  const season = Number(eventKey.slice(0, 4)) as Season;
  const matches = await tbaGet<TbaMatch[]>(`/event/${eventKey}/matches`);
  await inspectSample(season, matches, eventKey);
}

/** Inspect a whole season: find the first event with a played match and dump it. */
export async function inspectSeason(season: Season): Promise<void> {
  const eventKeys = await tbaGet<string[]>(`/events/${season}/keys`);
  for (const ek of eventKeys) {
    const matches = await tbaGet<TbaMatch[]>(`/event/${ek}/matches`);
    if (matches.some((m) => m.score_breakdown)) {
      await inspectSample(season, matches, ek);
      return;
    }
  }
  console.log(`No played matches found in ${season}`);
}

async function inspectSample(
  season: Season,
  matches: TbaMatch[],
  eventKey: string,
): Promise<void> {
  const sample = matches.find((m) => m.score_breakdown);
  if (!sample) {
    console.log("No played matches found in", eventKey);
    return;
  }
  const red = sample.score_breakdown!.red;
  const pointsKeys = Object.keys(red)
    .filter((k) => /points$/i.test(k))
    .sort();
  console.log(`\n=== ${season} — ${sample.key} ===`);
  console.log("*Points fields:", pointsKeys.join(", "));
  console.log("  totalPoints=%s foulPoints=%s", red.totalPoints, red.foulPoints);
  if (!DECOMPOSERS[season]) {
    console.log("  (no decomposer for this season yet — raw red breakdown below)");
    console.log(JSON.stringify(red, null, 2));
    return;
  }
  console.log("  red  ->", reconcile(season, red));
  console.log("  blue ->", reconcile(season, sample.score_breakdown!.blue));
}
