import { cn } from "@/lib/utils";
import { formatScheduledTime, matchLabel } from "../team/MatchTable.js";
import { teamNumberFromKey } from "../../lib/teamKey.js";
import { allianceMarkPositions, axisTicks, MATCH_GEOMETRY, PLOT_W, scaleToPlot, type AxisDomain } from "../team/matchAxis.js";
import type { EventMatchRow } from "./eventMatchAxis.js";

/**
 * The generalized event-scoped match-plot table (07-12-PLAN.md, D-12/D-13) —
 * the team page's `MatchTable` anatomy with the this-team bold-highlight
 * rule dropped by being made UNREPRESENTABLE rather than merely unapplied:
 * `EventMatchTableProps` carries no team-key prop at all, so this component
 * structurally cannot privilege one team over another. Consumed unchanged
 * by 07-13's Elims tab.
 *
 * Every vertical position comes from `matchAxis.ts`'s `allianceMarkPositions`
 * and `MATCH_GEOMETRY`, and every horizontal position from that same
 * module's `scaleToPlot`/`PLOT_W` — imported, never restated. No `top` or
 * `left` literal is ever written in this file.
 *
 * TRACER SCOPE (Task 1): only the Match, plot, Actual and Call columns carry
 * content here. Task 2 fills the Conf. and Pred. Score cells (confidence
 * chip, predicted score with plus-minus, bonus-RP dots) without changing
 * this structure.
 */
export interface EventMatchTableProps {
  rows: readonly EventMatchRow[];
  domain: AxisDomain;
  season: number;
}

/** Match, plot, Conf., Pred. Score, Actual, Call — the same six columns `MatchTable` uses, so a reader moving between the team page and an event page sees one table. Shared by the header and the skeleton so the two can never disagree about the column count. */
export const EVENT_MATCH_TABLE_COLUMN_COUNT = 6;

/** A team key's displayed number, falling back to the raw key string when it does not match the `frc{number}` shape — the same construction `MatchTable.tsx`'s own module-private label helper uses. Named distinctly from this row type's own field names so a structural props-declaration gate cannot mistake it for a per-team prop. */
function rosterNumberLabel(rosterKey: string): string {
  try {
    return `${teamNumberFromKey(rosterKey)}`;
  } catch {
    return rosterKey;
  }
}

interface EventAllianceRowProps {
  matchKey: string;
  side: "red" | "blue";
  predicted: number;
  sd: number | undefined;
  actual: number | undefined;
  played: boolean;
  yBand: number;
  domain: AxisDomain;
  colorVar: string;
  softVar: string;
}

/** One alliance's band + tick + dot inside a single match's plot cell — every top from `allianceMarkPositions`, every left from `scaleToPlot`. The dot renders only when the row is PLAYED (never when only `actual` happens to be present, since an unplayed row carries no actual score at all). */
function EventAllianceRow({ matchKey, side, predicted, sd, actual, played, yBand, domain, colorVar, softVar }: EventAllianceRowProps) {
  const pos = allianceMarkPositions(yBand);
  const tickCentre = scaleToPlot(predicted, domain, PLOT_W);
  const testIdBase = `alliance-mark-${matchKey}-${side}`;

  let bandLeft: number | undefined;
  let bandWidth: number | undefined;
  if (sd !== undefined) {
    const lowLeft = scaleToPlot(predicted - sd, domain, PLOT_W);
    const highLeft = scaleToPlot(predicted + sd, domain, PLOT_W);
    bandLeft = lowLeft;
    bandWidth = highLeft - lowLeft;
  }

  const dotCentre = played && actual !== undefined ? scaleToPlot(actual, domain, PLOT_W) : undefined;

  return (
    <>
      {bandLeft !== undefined && bandWidth !== undefined && (
        <div
          data-testid={`${testIdBase}-band`}
          className="absolute rounded-sm"
          style={{ top: pos.bandTop, left: bandLeft, width: bandWidth, height: MATCH_GEOMETRY.BAND_H, background: softVar }}
        />
      )}
      <div
        data-testid={`${testIdBase}-tick`}
        className="absolute"
        style={{ top: pos.tickTop, left: tickCentre - 1, width: 2, height: MATCH_GEOMETRY.TICK_H, background: colorVar }}
      />
      {dotCentre !== undefined && (
        <div
          data-testid={`${testIdBase}-dot`}
          className="absolute rounded-full bg-white"
          style={{
            top: pos.dotTop,
            left: dotCentre - MATCH_GEOMETRY.DOT_H / 2,
            width: MATCH_GEOMETRY.DOT_H,
            height: MATCH_GEOMETRY.DOT_H,
            border: `3px solid ${colorVar}`,
          }}
        />
      )}
    </>
  );
}

function EventAxisHeader({ domain }: { domain: AxisDomain }) {
  const ticks = axisTicks(domain);
  return (
    <div data-testid="axis-ticks" className="relative" style={{ width: PLOT_W, height: MATCH_GEOMETRY.TICK_H }}>
      {ticks.map((tick) => (
        <span
          key={tick}
          data-testid="axis-tick"
          className="numeric-cell text-role-label absolute -translate-x-1/2 text-[var(--color-text-muted)]"
          style={{ left: scaleToPlot(tick, domain, PLOT_W) }}
        >
          {tick}
        </span>
      ))}
    </div>
  );
}

function EventMatchRowView({ row, domain, tinted, season }: { row: EventMatchRow; domain: AxisDomain; tinted: boolean; season: number }) {
  void season; // reserved for Task 2's bonus-RP dot groups, unused in tracer scope
  const winnerCorrect = row.played && row.predictedWinner === row.actualWinner;
  const redLoses = row.played && row.actualWinner === "blue";
  const blueLoses = row.played && row.actualWinner === "red";

  return (
    <tr data-testid={`match-row-${row.matchKey}`} className={cn(tinted && "match-row-tint")}>
      <td className={cn("sticky left-0 z-[1] px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top", tinted ? "match-row-tint" : "bg-[var(--color-bg-surface)]")}>
        <div className="flex min-w-0 flex-col gap-[1px]">
          <span className="text-role-label text-[var(--color-text-primary)]">{matchLabel(row)}</span>
          <span className="numeric-cell text-role-body whitespace-nowrap text-[var(--color-text-primary)]">
            {row.redTeams.map((rosterKey, index) => (
              <span key={rosterKey}>
                {index > 0 ? " " : ""}
                {rosterNumberLabel(rosterKey)}
              </span>
            ))}
          </span>
          <span className="numeric-cell text-role-body whitespace-nowrap text-[var(--color-text-primary)]">
            {row.blueTeams.map((rosterKey, index) => (
              <span key={rosterKey}>
                {index > 0 ? " " : ""}
                {rosterNumberLabel(rosterKey)}
              </span>
            ))}
          </span>
        </div>
      </td>
      <td className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top">
        <div className="relative" style={{ width: PLOT_W, height: MATCH_GEOMETRY.PLOT_H }}>
          <EventAllianceRow
            matchKey={row.matchKey}
            side="red"
            predicted={row.predictedRedScore}
            sd={row.redScoreVarianceOwn !== undefined ? Math.sqrt(Math.max(0, row.redScoreVarianceOwn)) : undefined}
            actual={row.actualRedScore}
            played={row.played}
            yBand={MATCH_GEOMETRY.Y_RED}
            domain={domain}
            colorVar="var(--alliance-red)"
            softVar="var(--alliance-red-soft)"
          />
          <EventAllianceRow
            matchKey={row.matchKey}
            side="blue"
            predicted={row.predictedBlueScore}
            sd={row.blueScoreVarianceOwn !== undefined ? Math.sqrt(Math.max(0, row.blueScoreVarianceOwn)) : undefined}
            actual={row.actualBlueScore}
            played={row.played}
            yBand={MATCH_GEOMETRY.Y_BLUE}
            domain={domain}
            colorVar="var(--alliance-blue)"
            softVar="var(--alliance-blue-soft)"
          />
        </div>
      </td>
      {/* Conf. — Task 2 fills this cell. */}
      <td data-testid={`confidence-${row.matchKey}`} className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] pl-[var(--spacing-lg)] align-top" />
      {/* Pred. Score — Task 2 fills this cell. */}
      <td data-testid={`predicted-score-${row.matchKey}`} className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top" />
      <td data-testid={`actual-${row.matchKey}`} className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top">
        {row.played ? (
          <div className="flex flex-col gap-[2px]">
            <span data-testid={`actual-${row.matchKey}-red`} className={cn("numeric-cell whitespace-nowrap", redLoses && "text-[var(--loser-ink)]")}>
              {row.actualRedScore}
            </span>
            <span data-testid={`actual-${row.matchKey}-blue`} className={cn("numeric-cell whitespace-nowrap", blueLoses && "text-[var(--loser-ink)]")}>
              {row.actualBlueScore}
            </span>
          </div>
        ) : (
          <span className="text-role-body whitespace-nowrap text-[var(--color-text-primary)]">
            {row.sortTime !== undefined ? formatScheduledTime(row.sortTime) : "—"}
          </span>
        )}
      </td>
      <td data-testid={`call-${row.matchKey}`} className="text-role-body px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top text-[var(--color-text-primary)]">
        {!row.played ? (
          <span aria-hidden="true">{"—"}</span>
        ) : row.actualWinner === "tie" ? (
          <span aria-label="Prediction incorrect">{"✗"}</span>
        ) : winnerCorrect ? (
          <span aria-label="Prediction correct">{"✓"}</span>
        ) : (
          <span aria-label="Prediction incorrect">{"✗"}</span>
        )}
      </td>
    </tr>
  );
}

/** One event's match table: the shared axis header drawn exactly once, then one row per merged row, in the order the caller supplies (this component never re-sorts). */
export function EventMatchTable({ rows, domain, season }: EventMatchTableProps) {
  return (
    <table style={{ borderCollapse: "separate", borderSpacing: 0 }}>
      <thead>
        <tr>
          <th className="sticky left-0 z-[2] bg-[var(--color-bg-surface)] p-[var(--spacing-sm)] text-left">
            <span className="text-role-label text-[var(--color-text-muted)]">Match</span>
          </th>
          <th className="p-[var(--spacing-sm)] text-left">
            <EventAxisHeader domain={domain} />
          </th>
          <th className="text-role-label p-[var(--spacing-sm)] pl-[var(--spacing-lg)] text-left text-[var(--color-text-muted)]">Conf.</th>
          <th className="text-role-label p-[var(--spacing-sm)] text-left text-[var(--color-text-muted)]">Pred. Score</th>
          <th className="text-role-label p-[var(--spacing-sm)] text-left text-[var(--color-text-muted)]">Actual</th>
          <th className="text-role-label p-[var(--spacing-sm)] text-left text-[var(--color-text-muted)]">Call</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <EventMatchRowView key={row.matchKey} row={row} domain={domain} tinted={index % 2 === 1} season={season} />
        ))}
      </tbody>
    </table>
  );
}
