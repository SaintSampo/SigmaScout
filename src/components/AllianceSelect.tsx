import type { TeamState } from "../core/types";

interface Props {
  side: "red" | "blue";
  teams: TeamState[];
  selected: (number | null)[];
  onChange: (slot: number, team: number | null) => void;
}

/** Three team dropdowns for one alliance. */
export function AllianceSelect({ side, teams, selected, onChange }: Props) {
  const sorted = [...teams].sort((a, b) => a.team - b.team);
  return (
    <div className={`alliance ${side}`}>
      <h3>{side} alliance</h3>
      {[0, 1, 2].map((slot) => (
        <select
          key={slot}
          value={selected[slot] ?? ""}
          onChange={(e) =>
            onChange(slot, e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">— pick team —</option>
          {sorted.map((t) => (
            <option key={t.team} value={t.team}>
              {t.team}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
