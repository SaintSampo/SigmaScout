import { useMemo } from "react";
import type { MatchRecord, TeamKey, TeamSeasonData } from "../core/types";
import { href } from "../lib/router";
import { predictionAccuracy } from "../lib/metrics";
import { formatProbability } from "../lib/format";

interface Props {
  data: TeamSeasonData;
}

const pct = formatProbability;
const compLabel = (m: MatchRecord) =>
  `${m.compLevel.toUpperCase()}${m.compLevel === "qm" ? "" : `${m.setNumber}-`}${m.matchNumber}`;

/** One team's season page: stats, events, and full match history with the
 *  prediction each match had *before* it was played, next to the result. */
export function TeamPage({ data }: Props) {
  const season = data.season;

  // Group matches by event, preserving the (already time-sorted) order.
  const byEvent = useMemo(() => {
    const groups: { event: string; name: string; matches: MatchRecord[] }[] = [];
    const idx = new Map<string, number>();
    for (const m of data.matches) {
      let i = idx.get(m.event);
      if (i === undefined) {
        i = groups.length;
        idx.set(m.event, i);
        const ev = data.events.find((e) => e.event === m.event);
        groups.push({ event: m.event, name: ev?.name ?? m.event, matches: [] });
      }
      groups[i].matches.push(m);
    }
    return groups;
  }, [data]);

  return (
    <div>
      <a className="back" href={href(`teams/${season}`)}>
        ← All teams
      </a>

      <section className="panel team-header">
        <div>
          <h1 className="team-title">
            {data.team} <span className="team-name">{data.name ?? ""}</span>
          </h1>
          <div className="muted">{season} season</div>
        </div>
        <div className="stat-row">
          <Stat label="Record" value={`${data.wins}-${data.losses}-${data.ties}`} />
          <Stat label="Rating" value={data.overall.toFixed(1)} />
          <Stat
            label="Strength (z)"
            value={data.normalizedRating?.toFixed(2) ?? "—"}
          />
          <Stat
            label="Tolerance"
            value={data.tolerance !== undefined ? `±${data.tolerance.toFixed(0)}` : "—"}
          />
          <Stat label="Matches" value={String(data.matchesPlayed)} />
        </div>
        <div className="stat-row">
          {data.componentIds.map((c) => (
            <Stat key={c} label={c} value={data.components[c].mean.toFixed(1)} />
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Events</h2>
        <table className="leaderboard">
          <thead>
            <tr>
              <th>Wk</th>
              <th>Event</th>
              <th>Record</th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.event}>
                <td className="rank">{e.week ?? "—"}</td>
                <td>
                  <a href={href(`event/${season}/${e.event}`)}>{e.name}</a>
                </td>
                <td>
                  {e.wins}-{e.losses}
                  {e.ties ? `-${e.ties}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {byEvent.map((g) => (
        <section className="panel" key={g.event}>
          <h2>{g.name}</h2>
          <table className="matches">
            <thead>
              <tr>
                <th>Match</th>
                <th>Red</th>
                <th>Blue</th>
                <th>Prediction</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {g.matches.map((m) => (
                <MatchRow key={m.key} m={m} team={data.team} season={season} />
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <PredictionAccuracy matches={data.matches} label="this team's matches" />
    </div>
  );
}

function PredictionAccuracy({ matches, label }: { matches: MatchRecord[]; label: string }) {
  const acc = predictionAccuracy(matches);
  if (acc.total === 0) return null;
  return (
    <p className="pred-accuracy">
      Model correctly predicted <strong>{acc.pct.toFixed(0)}%</strong> of {label} (
      {acc.correct}/{acc.total})
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function TeamList({
  teams,
  season,
  highlight,
}: {
  teams: TeamKey[];
  season: number;
  highlight: TeamKey;
}) {
  return (
    <>
      {teams.map((t, i) => (
        <span key={t}>
          {i > 0 && " "}
          <a
            href={href(`team/${season}/${t}`)}
            className={t === highlight ? "self" : undefined}
          >
            {t}
          </a>
        </span>
      ))}
    </>
  );
}

function MatchRow({
  m,
  team,
  season,
}: {
  m: MatchRecord;
  team: TeamKey;
  season: number;
}) {
  const onRed = m.red.includes(team);
  const teamWinProb = onRed ? m.prediction.redWinProb : 1 - m.prediction.redWinProb;
  const my = onRed ? m.redActual : m.blueActual;
  const opp = onRed ? m.blueActual : m.redActual;

  let result: "W" | "L" | "T" | "" = "";
  if (m.played && my !== undefined && opp !== undefined) {
    result = my > opp ? "W" : my < opp ? "L" : "T";
  }
  // Was the pre-match prediction directionally right?
  const predictedWin = teamWinProb > 0.5;
  const correct = result === "W" ? predictedWin : result === "L" ? !predictedWin : null;

  return (
    <tr>
      <td className="muted-cell">{compLabel(m)}</td>
      <td className={onRed ? "alliance-red self-alliance" : "alliance-red"}>
        <TeamList teams={m.red} season={season} highlight={team} />
      </td>
      <td className={!onRed ? "alliance-blue self-alliance" : "alliance-blue"}>
        <TeamList teams={m.blue} season={season} highlight={team} />
      </td>
      <td>
        <span className="predwin">{pct(teamWinProb)} win</span>
        <span className="predscore">
          {m.prediction.redScore.toFixed(0)}–{m.prediction.blueScore.toFixed(0)}
        </span>
      </td>
      <td>
        {m.played ? (
          <span className="result">
            <span className={`badge ${result.toLowerCase()}`}>{result}</span>
            <span className="score">
              {m.redActual}–{m.blueActual}
            </span>
            {correct !== null && (
              <span className={correct ? "tick ok" : "tick bad"}>
                {correct ? "✓" : "✗"}
              </span>
            )}
          </span>
        ) : (
          <span className="muted">upcoming</span>
        )}
      </td>
    </tr>
  );
}
