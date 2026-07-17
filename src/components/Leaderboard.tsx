import { useMemo } from "react";
import type { SeasonModelView } from "../core/inference";

interface Props {
  view: SeasonModelView;
}

const num = (n: number) => n.toFixed(1);

/** Teams ranked by overall rating (sum of component means). */
export function Leaderboard({ view }: Props) {
  const rows = useMemo(() => {
    return [...view.teamList]
      .map((t) => ({
        team: t.team,
        matches: t.matchesPlayed,
        overall: view.overallRating(t.team),
        normalized: t.normalizedRating,
        components: view.model.components.map((c) => ({
          id: c,
          mean: view.skillFor(t.team, c).mean,
        })),
      }))
      .sort((a, b) => b.overall - a.overall);
  }, [view]);

  return (
    <section className="panel">
      <h2>Team ratings — {view.model.season}</h2>
      <table className="leaderboard">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            {view.model.components.map((c) => (
              <th key={c}>{c}</th>
            ))}
            <th>Overall</th>
            <th title="Cross-season strength (z-score, comparable across games)">
              z
            </th>
            <th>GP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.team}>
              <td className="rank">{i + 1}</td>
              <td>{r.team}</td>
              {r.components.map((c) => (
                <td key={c.id}>{num(c.mean)}</td>
              ))}
              <td>
                <strong>{num(r.overall)}</strong>
              </td>
              <td>{r.normalized !== undefined ? r.normalized.toFixed(2) : "—"}</td>
              <td className="rank">{r.matches}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
