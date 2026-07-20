import { useMemo, useState } from "react";
import type { SeasonModelView } from "../core/inference";
import { AllianceSelect } from "./AllianceSelect";
import { formatProbability } from "../lib/format";

interface Props {
  view: SeasonModelView;
}

const pct = formatProbability;
const num = (n: number) => n.toFixed(1);

/** Live, client-side match prediction from shipped model state. */
export function MatchPredictor({ view }: Props) {
  const [red, setRed] = useState<(number | null)[]>([254, 118, 973]);
  const [blue, setBlue] = useState<(number | null)[]>([1678, 2056, 148]);

  const setSlot =
    (setter: typeof setRed) => (slot: number, team: number | null) =>
      setter((prev) => prev.map((t, i) => (i === slot ? team : t)));

  const redTeams = red.filter((t): t is number => t != null);
  const blueTeams = blue.filter((t): t is number => t != null);
  const ready = redTeams.length === 3 && blueTeams.length === 3;

  const prediction = useMemo(
    () => (ready ? view.predictMatch({ red: redTeams, blue: blueTeams }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, red.join(","), blue.join(",")],
  );

  return (
    <section className="panel">
      <h2>Match predictor</h2>
      <div className="alliances">
        <AllianceSelect
          side="red"
          teams={view.teamList}
          selected={red}
          onChange={setSlot(setRed)}
        />
        <AllianceSelect
          side="blue"
          teams={view.teamList}
          selected={blue}
          onChange={setSlot(setBlue)}
        />
      </div>

      {prediction ? (
        <div className="result">
          <div className="winbar">
            <div
              className="red-fill"
              style={{ width: pct(prediction.redWinProbability) }}
            >
              RED {pct(prediction.redWinProbability)}
            </div>
            <div
              className="blue-fill"
              style={{ width: pct(1 - prediction.redWinProbability) }}
            >
              {pct(1 - prediction.redWinProbability)} BLUE
            </div>
          </div>

          <div className="scoreline">
            <span className="red-score">{num(prediction.red.mean)}</span>
            <span className="margin">
              predicted margin{" "}
              {prediction.predictedMargin >= 0 ? "+" : ""}
              {num(prediction.predictedMargin)}
            </span>
            <span className="blue-score">{num(prediction.blue.mean)}</span>
          </div>

          <table className="breakdown">
            <thead>
              <tr>
                <th>Component</th>
                <th>Red</th>
                <th>Blue</th>
              </tr>
            </thead>
            <tbody>
              {view.model.components.map((c) => (
                <tr key={c}>
                  <td>{c}</td>
                  <td>{num(prediction.red.byComponent[c])}</td>
                  <td>{num(prediction.blue.byComponent[c])}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="note">
            Win probability integrates both alliances' score uncertainty (σ_red ={" "}
            {num(Math.sqrt(prediction.red.variance))}, σ_blue ={" "}
            {num(Math.sqrt(prediction.blue.variance))}), not just the mean margin.
          </p>
          {prediction.missingTeams.length > 0 && (
            <p className="note">
              Using season prior for unseen team(s):{" "}
              {prediction.missingTeams.join(", ")}.
            </p>
          )}
        </div>
      ) : (
        <p className="note">Pick three teams per alliance to see a prediction.</p>
      )}
    </section>
  );
}
