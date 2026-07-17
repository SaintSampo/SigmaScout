// Browser-side data loading. Fetches the static JSON artifacts the pipeline
// emits and hands back a ready-to-query SeasonModelView. Kept out of core/ so
// core stays environment-agnostic (no fetch, no import.meta).

import { SeasonModelView } from "../core/inference";
import type {
  EventData,
  EventInfo,
  Manifest,
  RpSeasonModel,
  Season,
  SeasonEventsIndex,
  SeasonStateFile,
  SeasonTeamsIndex,
  TeamKey,
  TeamSeasonData,
} from "../core/types";

// Vite rewrites BASE_URL to the deploy subpath, so this works on GitHub Pages
// project sites (/SigmaScout/) and at a domain root alike.
const DATA_ROOT = `${import.meta.env.BASE_URL}data`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return (await res.json()) as T;
}

export function loadManifest(): Promise<Manifest> {
  return getJson<Manifest>(`${DATA_ROOT}/manifest.json`);
}

export async function loadSeason(season: Season): Promise<SeasonModelView> {
  const file = await getJson<SeasonStateFile>(
    `${DATA_ROOT}/seasons/${season}.json`,
  );
  return new SeasonModelView(file.model, file.teams);
}

export function loadTeamIndex(season: Season): Promise<SeasonTeamsIndex> {
  return getJson<SeasonTeamsIndex>(`${DATA_ROOT}/teams/${season}/index.json`);
}

export function loadTeam(season: Season, team: TeamKey): Promise<TeamSeasonData> {
  return getJson<TeamSeasonData>(`${DATA_ROOT}/teams/${season}/${team}.json`);
}

export function loadEvents(season: Season): Promise<EventInfo[]> {
  return getJson<EventInfo[]>(`${DATA_ROOT}/events/${season}.json`);
}

export function loadEventsIndex(season: Season): Promise<SeasonEventsIndex> {
  return getJson<SeasonEventsIndex>(`${DATA_ROOT}/events/${season}/index.json`);
}

export function loadEventData(season: Season, key: string): Promise<EventData> {
  return getJson<EventData>(`${DATA_ROOT}/events/${season}/${key}.json`);
}

export function loadRpModel(season: Season): Promise<RpSeasonModel> {
  return getJson<RpSeasonModel>(`${DATA_ROOT}/rp/${season}.json`);
}
