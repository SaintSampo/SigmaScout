import { useMemo, useState } from "react";
import type { SeasonEventsIndex } from "../core/types";
import { href } from "../lib/router";

interface Props {
  season: number;
  index: SeasonEventsIndex;
}

/** Searchable list of a season's events, grouped by week. */
export function EventsDirectory({ season, index }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return index.events;
    return index.events.filter(
      (e) => e.name.toLowerCase().includes(q) || e.key.toLowerCase().includes(q),
    );
  }, [index, query]);

  return (
    <section className="panel">
      <div className="dir-head">
        <h2>Events · {season}</h2>
        <input
          className="search"
          placeholder="Search event name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <table className="leaderboard">
        <thead>
          <tr>
            <th>Wk</th>
            <th>Event</th>
            <th>Teams</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((e) => (
            <tr key={e.key}>
              <td className="rank">{e.week !== undefined ? e.week + 1 : "—"}</td>
              <td>
                <a href={href(`event/${season}/${e.key}`)}>{e.name}</a>
              </td>
              <td className="rank">{e.teamCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 && <p className="note">No events match “{query}”.</p>}
    </section>
  );
}
