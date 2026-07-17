import { useMemo, useState } from "react";
import type { SeasonTeamsIndex } from "../core/types";
import { href } from "../lib/router";

interface Props {
  season: number;
  index: SeasonTeamsIndex;
}

/** Searchable, ranked team directory for a season. */
export function TeamDirectory({ season, index }: Props) {
  const [query, setQuery] = useState("");

  // index.teams is pre-sorted by rating, so position = rank.
  const ranked = useMemo(
    () => index.teams.map((t, i) => ({ ...t, rank: i + 1 })),
    [index],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter(
      (t) => String(t.team).includes(q) || (t.name ?? "").toLowerCase().includes(q),
    );
  }, [ranked, query]);

  return (
    <section className="panel">
      <div className="dir-head">
        <h2>Teams · {season}</h2>
        <input
          className="search"
          placeholder="Search team # or name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <table className="leaderboard">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>Name</th>
            <th>Rating</th>
            <th title="Cross-season strength (z-score)">z</th>
            <th title="Match-to-match tolerance (± points, 1 SD)">±</th>
            <th>Record</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 300).map((t) => (
            <tr key={t.team}>
              <td className="rank">{t.rank}</td>
              <td>
                <a href={href(`team/${season}/${t.team}`)}>{t.team}</a>
              </td>
              <td className="muted-cell">{t.name ?? "—"}</td>
              <td>
                <strong>{t.overall.toFixed(1)}</strong>
              </td>
              <td>{t.normalizedRating?.toFixed(2) ?? "—"}</td>
              <td>{t.tolerance !== undefined ? `±${t.tolerance.toFixed(0)}` : "—"}</td>
              <td className="rank">
                {t.wins}-{t.losses}
                {t.ties ? `-${t.ties}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 300 && (
        <p className="note">
          Showing top 300 of {filtered.length}. Refine your search to narrow.
        </p>
      )}
      {filtered.length === 0 && <p className="note">No teams match “{query}”.</p>}
    </section>
  );
}
