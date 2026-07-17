import { useMemo, useState } from "react";
import type {
  EventData,
  MatchRecord,
  RpSeasonModel,
  TeamKey,
  TeamSimResult,
} from "../core/types";
import { simulateEvent } from "../core/simulate";
import { href } from "../lib/router";
import { predictionAccuracy } from "../lib/metrics";
import { strengthOfSchedule } from "../lib/sos";

interface Props {
  season: number;
  data: EventData;
  rpModel: RpSeasonModel | null;
}

type Tab = "insights" | "sos" | "quals" | "alliances" | "elims" | "sim";
const TABS: { id: Tab; label: string }[] = [
  { id: "insights", label: "Insights" },
  { id: "sos", label: "Strength of Schedule" },
  { id: "quals", label: "Qual Matches" },
  { id: "alliances", label: "Playoff Alliances" },
  { id: "elims", label: "Elimination" },
  { id: "sim", label: "Simulation" },
];

export function EventPage({ season, data, rpModel }: Props) {
  const [tab, setTab] = useState<Tab>("insights");

  const overall = useMemo(() => {
    const m = new Map<TeamKey, number>();
    for (const t of data.teams) {
      m.set(
        t.team,
        data.componentIds.reduce((s, c) => s + t.components[c].mean, 0),
      );
    }
    return m;
  }, [data]);

  const nameOf = useMemo(
    () => new Map(data.teams.map((t) => [t.team, t.name])),
    [data],
  );

  return (
    <div>
      <a className="back" href={href(`events/${season}`)}>
        ← All events
      </a>
      <section className="panel">
        <h1 className="team-title">{data.event.name}</h1>
        <div className="muted">
          {season}
          {data.event.week !== undefined ? ` · Week ${data.event.week + 1}` : ""}
          {data.event.city ? ` · ${data.event.city}` : ""} · {data.teams.length} teams
        </div>
      </section>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "insights" && (
        <Insights data={data} season={season} overall={overall} />
      )}
      {tab === "sos" && <ScheduleStrength data={data} season={season} />}
      {tab === "quals" && (
        <MatchList
          title="Qualification matches"
          matches={data.qualMatches}
          season={season}
          showRp
        />
      )}
      {tab === "alliances" && (
        <Alliances data={data} season={season} overall={overall} nameOf={nameOf} />
      )}
      {tab === "elims" && (
        <MatchList title="Elimination matches" matches={data.elimMatches} season={season} />
      )}
      {tab === "sim" && <Simulation data={data} season={season} rpModel={rpModel} nameOf={nameOf} />}

      <EventAccuracy data={data} season={season} />
    </div>
  );
}

function EventAccuracy({ data, season }: { data: EventData; season: number }) {
  const acc = predictionAccuracy([...data.qualMatches, ...data.elimMatches]);
  return (
    <p className="pred-accuracy">
      {acc.total > 0 && (
        <>
          Model correctly predicted <strong>{acc.pct.toFixed(0)}%</strong> of this
          event's matches ({acc.correct}/{acc.total}) ·{" "}
        </>
      )}
      <strong>{data.seasonAccuracy.toFixed(0)}%</strong> across the {season} season
    </p>
  );
}

const teamLink = (season: number, t: TeamKey) => (
  <a href={href(`team/${season}/${t}`)}>{t}</a>
);

// --- Insights: actual rankings + rating (sortable) ---
type RankSortKey = "rank" | "rs" | "rp" | "record" | "rating";

function Insights({
  data,
  season,
  overall,
}: {
  data: EventData;
  season: number;
  overall: Map<TeamKey, number>;
}) {
  const [sortKey, setSortKey] = useState<RankSortKey>("rank");
  // 1 = ascending, -1 = descending.
  const [dir, setDir] = useState<1 | -1>(1);

  const valueOf = (r: EventData["rankings"][number], key: RankSortKey): number => {
    switch (key) {
      case "rank":
        return r.rank;
      case "rs":
        return r.rankingScore;
      case "rp":
        return r.rp;
      case "record":
        return r.wins - r.losses;
      case "rating":
        return overall.get(r.team) ?? -Infinity;
    }
  };

  const sorted = useMemo(
    () => [...data.rankings].sort((a, b) => (valueOf(a, sortKey) - valueOf(b, sortKey)) * dir),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, sortKey, dir],
  );

  const onSort = (key: RankSortKey) => {
    if (key === sortKey) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setDir(key === "rank" ? 1 : -1); // rank: 1 best; others: higher is better
    }
  };

  const arrow = (key: RankSortKey) => (sortKey === key ? (dir === 1 ? " ▲" : " ▼") : "");
  const Th = ({ k, label, title }: { k: RankSortKey; label: string; title?: string }) => (
    <th className="sortable" title={title} onClick={() => onSort(k)}>
      {label}
      {arrow(k)}
    </th>
  );

  if (data.rankings.length === 0)
    return <section className="panel"><p className="note">No rankings posted for this event.</p></section>;
  return (
    <section className="panel">
      <h2>Rankings</h2>
      <table className="leaderboard">
        <thead>
          <tr>
            <Th k="rank" label="Rank" />
            <th>Team</th>
            <Th k="rs" label="RS" title="Ranking score = average RP" />
            <Th k="rp" label="RP" />
            <Th k="record" label="Record" />
            <Th k="rating" label="Rating" title="SigmaScout rating" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.team}>
              <td className="rank">{r.rank}</td>
              <td>{teamLink(season, r.team)}</td>
              <td>{r.rankingScore.toFixed(2)}</td>
              <td>{r.rp}</td>
              <td className="rank">
                {r.wins}-{r.losses}
                {r.ties ? `-${r.ties}` : ""}
              </td>
              <td>{overall.get(r.team)?.toFixed(0) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// --- Strength of schedule ---
function ScheduleStrength({ data, season }: { data: EventData; season: number }) {
  const rows = useMemo(() => strengthOfSchedule(data), [data]);
  if (rows.length === 0)
    return <section className="panel"><p className="note">No qualification schedule yet.</p></section>;

  return (
    <section className="panel">
      <h2>Strength of schedule</h2>
      <p className="note">
        How often <em>this event's average</em> robot would win each team's qual
        schedule, given their actual partners and opponents. Lower = tougher draw
        (strong opponents and/or weak partners). Opponents/Partners are shown
        relative to the event-average team, so a strong event doesn't inflate
        everyone. Hardest schedules first.
      </p>
      <table className="leaderboard">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th title="Avg opponent strength vs the event-average team (+ = tougher)">
              Opponents
            </th>
            <th title="Avg partner strength vs the event-average team (− = weaker)">
              Partners
            </th>
            <th title="Win probability the event-average robot would have on this schedule">
              SoS (avg-team win)
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.team}>
              <td className="rank">{i + 1}</td>
              <td>{teamLink(season, r.team)}</td>
              <td className={r.oppRel >= 0 ? "delta-hard" : "delta-easy"}>
                {r.oppRel >= 0 ? "+" : ""}
                {r.oppRel.toFixed(0)}
              </td>
              <td className={r.partnerRel >= 0 ? "delta-easy" : "delta-hard"}>
                {r.partnerRel >= 0 ? "+" : ""}
                {r.partnerRel.toFixed(0)}
              </td>
              <td>
                <OddsBar p={r.avgTeamWinRate} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// --- Neutral match list ---
function MatchList({
  title,
  matches,
  season,
  showRp,
}: {
  title: string;
  matches: MatchRecord[];
  season: number;
  showRp?: boolean;
}) {
  if (matches.length === 0)
    return <section className="panel"><p className="note">No {title.toLowerCase()} yet.</p></section>;
  const label = (m: MatchRecord) =>
    `${m.compLevel.toUpperCase()}${m.compLevel === "qm" ? "" : `${m.setNumber}-`}${m.matchNumber}`;
  return (
    <section className="panel">
      <h2>{title}</h2>
      <table className="matches">
        <thead>
          <tr>
            <th>Match</th>
            <th>Red</th>
            <th>Blue</th>
            <th>Prediction</th>
            <th>Result</th>
            {showRp && <th>RP</th>}
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => {
            const redWon = m.played && (m.redActual ?? 0) > (m.blueActual ?? 0);
            const blueWon = m.played && (m.blueActual ?? 0) > (m.redActual ?? 0);
            return (
              <tr key={m.key}>
                <td className="muted-cell">{label(m)}</td>
                <td className={`alliance-red ${redWon ? "won" : ""}`}>
                  {m.red.map((t, i) => (
                    <span key={t}>
                      {i > 0 && " "}
                      {teamLink(season, t)}
                    </span>
                  ))}
                </td>
                <td className={`alliance-blue ${blueWon ? "won" : ""}`}>
                  {m.blue.map((t, i) => (
                    <span key={t}>
                      {i > 0 && " "}
                      {teamLink(season, t)}
                    </span>
                  ))}
                </td>
                <td>
                  <span className="predwin">
                    {Math.round(m.prediction.redWinProb * 100)}%
                  </span>
                  <span className="predscore">
                    {m.prediction.redScore.toFixed(0)}–{m.prediction.blueScore.toFixed(0)}
                  </span>
                </td>
                <td>
                  {m.played ? (
                    <span className="score">
                      {m.redActual}–{m.blueActual}
                    </span>
                  ) : (
                    <span className="muted">upcoming</span>
                  )}
                </td>
                {showRp && (
                  <td className="muted-cell">
                    {m.played ? `${m.redRp ?? 0} / ${m.blueRp ?? 0}` : "—"}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// --- Playoff alliances ---
function Alliances({
  data,
  season,
  overall,
  nameOf,
}: {
  data: EventData;
  season: number;
  overall: Map<TeamKey, number>;
  nameOf: Map<TeamKey, string | undefined>;
}) {
  if (data.alliances.length === 0)
    return <section className="panel"><p className="note">Alliances not selected yet.</p></section>;
  return (
    <section className="panel">
      <h2>Playoff alliances</h2>
      <table className="leaderboard">
        <thead>
          <tr>
            <th>#</th>
            <th>Captain</th>
            <th>Picks</th>
            <th title="Combined predicted alliance score (top 3 robots)">Strength</th>
          </tr>
        </thead>
        <tbody>
          {data.alliances.map((a) => {
            const strength = a.picks
              .slice(0, 3)
              .reduce((s, t) => s + (overall.get(t) ?? 0), 0);
            return (
              <tr key={a.number}>
                <td className="rank">{a.number}</td>
                <td>
                  {teamLink(season, a.picks[0])}{" "}
                  <span className="muted">{nameOf.get(a.picks[0]) ?? ""}</span>
                </td>
                <td>
                  {a.picks.slice(1).map((t, i) => (
                    <span key={t}>
                      {i > 0 && ", "}
                      {teamLink(season, t)}
                    </span>
                  ))}
                </td>
                <td>
                  <strong>{strength.toFixed(0)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// --- Simulation ---
function Simulation({
  data,
  season,
  rpModel,
  nameOf,
}: {
  data: EventData;
  season: number;
  rpModel: RpSeasonModel | null;
  nameOf: Map<TeamKey, string | undefined>;
}) {
  const maxQual = data.qualMatches.reduce((m, q) => Math.max(m, q.matchNumber), 0);
  // For a live event, default to projecting from the first unplayed match.
  const firstUnplayed = data.qualMatches
    .filter((m) => !m.played)
    .reduce((min, m) => Math.min(min, m.matchNumber), Infinity);
  const [fromMatch, setFromMatch] = useState(
    Number.isFinite(firstUnplayed) ? firstUnplayed : 1,
  );
  const [iterations, setIterations] = useState(1000);
  const [results, setResults] = useState<TeamSimResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = () => {
    if (!rpModel) return;
    setBusy(true);
    // Let the button paint "running" before the (fast) synchronous sim.
    setTimeout(() => {
      const res = simulateEvent({
        teams: data.teams,
        residualVariance: data.residualVariance,
        qualMatches: data.qualMatches,
        rpModel,
        level: data.event.level ?? "regular",
        settings: { fromQualMatch: fromMatch, iterations },
      });
      setResults(res);
      setBusy(false);
    }, 10);
  };

  if (!rpModel)
    return <section className="panel"><p className="note">No RP model available for {season}.</p></section>;

  return (
    <section className="panel">
      <h2>Simulation</h2>
      <p className="note">
        Replays the event {iterations.toLocaleString()} times. Qual matches before
        the start match use actual results; the rest are simulated from team
        ratings. Projected rank is the average across runs.
      </p>
      <div className="sim-controls">
        <label>
          From qual match{" "}
          <input
            type="number"
            min={1}
            max={maxQual}
            value={fromMatch}
            onChange={(e) => setFromMatch(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label>
          Iterations{" "}
          <select value={iterations} onChange={(e) => setIterations(Number(e.target.value))}>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
            <option value={2000}>2000</option>
            <option value={5000}>5000</option>
          </select>
        </label>
        <button className="link-btn" onClick={run} disabled={busy}>
          {busy ? "Running…" : "Run simulation"}
        </button>
      </div>

      {results && (
        <table className="leaderboard sim-results">
          <thead>
            <tr>
              <th>Proj</th>
              <th>Team</th>
              <th title="Mean projected rank ± SD">Rank</th>
              <th title="5th–95th percentile">Range</th>
              <th title="Probability of finishing rank 1">#1</th>
              <th title="Probability of a top-8 finish">Top 8</th>
              <th>Proj RP</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={r.team}>
                <td className="rank">{i + 1}</td>
                <td>
                  {teamLink(season, r.team)}{" "}
                  <span className="muted">{nameOf.get(r.team) ?? ""}</span>
                </td>
                <td>
                  {r.meanRank.toFixed(1)}
                  <span className="muted"> ±{r.sdRank.toFixed(1)}</span>
                </td>
                <td className="muted-cell">
                  {r.p5Rank}–{r.p95Rank}
                </td>
                <td>{(r.pRank1 * 100).toFixed(0)}%</td>
                <td>
                  <OddsBar p={r.pTop8} />
                </td>
                <td>{r.meanRp.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function OddsBar({ p }: { p: number }) {
  return (
    <span className="odds">
      <span className="odds-fill" style={{ width: `${Math.round(p * 100)}%` }} />
      <span className="odds-label">{(p * 100).toFixed(0)}%</span>
    </span>
  );
}
