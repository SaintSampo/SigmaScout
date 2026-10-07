/**
 * ONE outcome list, as the verdict drawer draws it (sketch 025 variant A, quick
 * task 261006-lxp): a CSS grid of labelled chance bars, one row per named
 * outcome, each row reading label, bar, chance, points.
 *
 * WHY NAMES RATHER THAN A HISTOGRAM. The Playoffs and Awards cells pay one of
 * four or five values, and every one of them has a name the reader already uses;
 * the Alliance selection cell lists its routes the same way where the run
 * reported them. The names are the axis.
 *
 * THE BAR'S WIDTH IS THE CHANCE, as a percentage of its track, so a row at 50%
 * fills exactly half and the track and the bar can never disagree. The width is
 * geometry, not colour: every colour comes from theme.css's verdict block.
 *
 * ORDERED BY POINTS DESCENDING, which the caller guarantees; this component does
 * not sort, because a second ordering rule here would be a second answer to
 * "which outcome is best".
 */
import { districtLedgerOutcomeChance, districtLedgerOutcomePointsLabel } from "./districtLedgerCopy.js";
import type { VerdictOutcomeRow } from "./ledgerVerdict.js";

export interface DistrictOutcomeListProps {
  readonly rows: readonly VerdictOutcomeRow[];
  /** The list's accessible name. */
  readonly label: string;
  readonly testId?: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function DistrictOutcomeList({ rows, label, testId }: DistrictOutcomeListProps) {
  // Since quick task 261007-3ik the verdict model drops the implicit "Out before
  // the top four" row from the rendered list, and an alliance already placed
  // fifth to eighth while the bracket runs lists only that row, so its Playoffs
  // pane is the headline and tiles alone. An empty labelled list would announce
  // a list with nothing in it to a screen reader and leave an empty grid box on
  // screen. The guard lives here rather than in the drawer because this
  // component owns what an outcome list looks like; the drawer passes
  // `chart.rows` straight through.
  if (rows.length === 0) return null;
  return (
    <div role="list" aria-label={label} className="district-ledger-verdict-outcomes" data-testid={testId}>
      {rows.map((row) => {
        const zero = row.chance <= 0 ? " district-ledger-verdict-outcomes__zero" : "";
        return (
          <div role="listitem" key={row.key} className="district-ledger-verdict-outcomes__row" data-testid="district-ledger-outcome-row" data-outcome={row.key}>
            <span className={`district-ledger-verdict-outcomes__label${zero}`}>{row.label}</span>
            <span aria-hidden="true" className="district-ledger-verdict-outcomes__track">
              <span
                data-testid="district-ledger-outcome-bar"
                className="district-ledger-verdict-outcomes__fill"
                style={{ width: `${String(clamp01(row.chance) * 100)}%` }}
              />
            </span>
            <span className={`district-ledger-verdict-outcomes__chance${zero}`}>{districtLedgerOutcomeChance(row.chance)}</span>
            <span className="district-ledger-verdict-outcomes__points">{districtLedgerOutcomePointsLabel(row.points, row.pointsHigh)}</span>
          </div>
        );
      })}
    </div>
  );
}
