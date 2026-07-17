import { useEffect, useState } from "react";
import type {
  EventData,
  Manifest,
  RpSeasonModel,
  Season,
  SeasonEventsIndex,
  SeasonTeamsIndex,
  TeamSeasonData,
} from "./core/types";
import {
  loadManifest,
  loadTeamIndex,
  loadTeam,
  loadEventsIndex,
  loadEventData,
  loadRpModel,
} from "./lib/data";
import { useRoute, href } from "./lib/router";
import { TeamDirectory } from "./components/TeamDirectory";
import { TeamPage } from "./components/TeamPage";
import { EventsDirectory } from "./components/EventsDirectory";
import { EventPage } from "./components/EventPage";

// The season we currently have browsable team/event data for. (Others need a
// `npm run site -- <year>` pass.)
const SITE_SEASON = 2026;

export function App() {
  const route = useRoute();
  const [manifest, setManifest] = useState<Manifest | null>(null);

  useEffect(() => {
    loadManifest().then(setManifest).catch(() => {});
  }, []);

  // Route table
  let body: JSX.Element;
  if (route[0] === "team" && route[1] && route[2]) {
    body = <TeamRoute season={Number(route[1])} team={Number(route[2])} />;
  } else if (route[0] === "event" && route[1] && route[2]) {
    body = <EventRoute season={Number(route[1])} eventKey={route[2]} />;
  } else if (route[0] === "events" && route[1]) {
    body = <EventsRoute season={Number(route[1])} />;
  } else if (route[0] === "teams" && route[1]) {
    body = <DirectoryRoute season={Number(route[1])} />;
  } else {
    body = <DirectoryRoute season={SITE_SEASON} />;
  }

  return (
    <div className="app">
      <header className="masthead">
        <a href={href("")} className="brand">
          SigmaScout
        </a>
        <nav className="nav">
          <a href={href(`teams/${SITE_SEASON}`)}>Teams</a>
          <a href={href(`events/${SITE_SEASON}`)}>Events</a>
        </nav>
      </header>
      {body}
      <footer className="foot">
        {manifest && (
          <span>
            Data generated {new Date(manifest.generatedAt).toLocaleDateString()} ·
            α {manifest.tuning.alpha} · ρ {manifest.tuning.rho}
          </span>
        )}
      </footer>
    </div>
  );
}

function DirectoryRoute({ season }: { season: Season }) {
  const [index, setIndex] = useState<SeasonTeamsIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIndex(null);
    setError(null);
    loadTeamIndex(season)
      .then(setIndex)
      .catch(() => setError(`No browsable data for ${season} yet.`));
  }, [season]);

  if (error) return <div className="error">{error}</div>;
  if (!index) return <div className="loading">Loading teams…</div>;
  return <TeamDirectory season={season} index={index} />;
}

function TeamRoute({ season, team }: { season: Season; team: number }) {
  const [data, setData] = useState<TeamSeasonData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    loadTeam(season, team)
      .then(setData)
      .catch(() => setError(`Team ${team} not found for ${season}.`));
  }, [season, team]);

  if (error)
    return (
      <div>
        <a className="back" href={href(`teams/${season}`)}>
          ← All teams
        </a>
        <div className="error">{error}</div>
      </div>
    );
  if (!data) return <div className="loading">Loading team {team}…</div>;
  return <TeamPage data={data} />;
}

function EventsRoute({ season }: { season: Season }) {
  const [index, setIndex] = useState<SeasonEventsIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIndex(null);
    setError(null);
    loadEventsIndex(season)
      .then(setIndex)
      .catch(() => setError(`No event data for ${season} yet.`));
  }, [season]);

  if (error) return <div className="error">{error}</div>;
  if (!index) return <div className="loading">Loading events…</div>;
  return <EventsDirectory season={season} index={index} />;
}

function EventRoute({ season, eventKey }: { season: Season; eventKey: string }) {
  const [data, setData] = useState<EventData | null>(null);
  const [rpModel, setRpModel] = useState<RpSeasonModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    loadEventData(season, eventKey)
      .then(setData)
      .catch(() => setError(`Event ${eventKey} not found for ${season}.`));
    loadRpModel(season)
      .then(setRpModel)
      .catch(() => setRpModel(null));
  }, [season, eventKey]);

  if (error)
    return (
      <div>
        <a className="back" href={href(`events/${season}`)}>
          ← All events
        </a>
        <div className="error">{error}</div>
      </div>
    );
  if (!data) return <div className="loading">Loading event…</div>;
  return <EventPage season={season} data={data} rpModel={rpModel} />;
}
