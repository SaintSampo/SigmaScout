/**
 * ONE outcome list: a row per named outcome, its chance, its point value, and a
 * thin proportional mark.
 *
 * WHAT IT REPLACES AND WHY. The Playoffs and Awards drawers drew
 * `DistrictPointHistogram` over a 0-to-30 axis on a distribution with mass at
 * four values. The bars were correct and nearly unreadable: the reader had to
 * map an x position back onto a placement. These two categories are the only
 * ones whose outcomes have NAMES, so the names are the axis.
 *
 * THE MARK IS THIN AND THE LABELS ARE TEXT INK, per the dataviz skill's own
 * rules, and every colour is a shipped custom property — `--sim-hist-bar` for
 * the mark, exactly the one the histogram's own bars use, so the two surfaces
 * cannot drift apart in hue.
 *
 * GEOMETRY IS DERIVED FROM ONE SOURCE (chart craft: "derive coupled geometry;
 * never hand-tune both ends"). `OUTCOME_BAR_W` is the full-scale width and every
 * bar is `chance * OUTCOME_BAR_W`, so a bar at 50% is exactly half the track and
 * the track and the bar can never disagree.
 *
 * ORDERED BY POINTS DESCENDING, which the caller guarantees; this component does
 * not sort, because a second ordering rule here would be a second answer to
 * "which outcome is best".
 */
import {
  DISTRICT_LEDGER_OUTCOME_COLUMN_LABELS,
  districtLedgerOutcomeChance,
  districtLedgerOutcomePoints,
} from "./districtLedgerCopy.js";

/** The full-scale width of one row's mark, in pixels. A chance of 1 fills it exactly. */
export const OUTCOME_BAR_W = 64;

/** The mark's height. Thin by rule: it is a magnitude cue beside a printed number, never the number itself. */
export const OUTCOME_BAR_H = 4;

export interface DistrictOutcomeListRow {
  readonly key: string;
  readonly label: string;
  readonly points: number;
  readonly chance: number;
}

export interface DistrictOutcomeListProps {
  readonly rows: readonly DistrictOutcomeListRow[];
  /** The list's accessible name. */
  readonly label: string;
  /** This list's OWN caption — the two lists say different things, so neither is hardcoded here. */
  readonly caption: string;
  readonly testId?: string;
}

export function DistrictOutcomeList({ rows, label, caption, testId }: DistrictOutcomeListProps) {
  return (
    <div className="flex flex-col gap-[var(--spacing-xs)]" data-testid={testId}>
      <span className="sr-only">{label}</span>
      <table className="district-ledger-outcomes">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col">{label}</th>
            <th scope="col" className="district-ledger-outcomes__chance">
              {DISTRICT_LEDGER_OUTCOME_COLUMN_LABELS.chance}
            </th>
            <th scope="col" className="district-ledger-outcomes__points">
              {DISTRICT_LEDGER_OUTCOME_COLUMN_LABELS.points}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-testid="district-ledger-outcome-row" data-outcome={row.key}>
              <th scope="row" className="district-ledger-outcomes__label">
                {row.label}
              </th>
              <td className="district-ledger-outcomes__chance">
                <span className="district-ledger-outcomes__figure">{districtLedgerOutcomeChance(row.chance)}</span>
                {/* The track and its fill share ONE width source. `aria-hidden`:
                    the number beside it is the accessible value. */}
                <span
                  aria-hidden="true"
                  className="district-ledger-outcomes__track"
                  style={{ width: `${String(OUTCOME_BAR_W)}px`, height: `${String(OUTCOME_BAR_H)}px` }}
                >
                  <span
                    data-testid="district-ledger-outcome-bar"
                    className="district-ledger-outcomes__bar"
                    style={{ width: `${String(Math.max(0, Math.min(1, row.chance)) * OUTCOME_BAR_W)}px` }}
                  />
                </span>
              </td>
              <td className="district-ledger-outcomes__points">{districtLedgerOutcomePoints(row.points)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="district-ledger-pane-caption">{caption}</span>
    </div>
  );
}
