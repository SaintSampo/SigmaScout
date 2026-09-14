import { cn } from "@/lib/utils";
import { SkeletonRows } from "../Skeletons.js";
import { predictionPercent } from "../../lib/predictionPercent.js";
// The five leaf plot/chip/score-line/badge components below are shared
// with the team-page originals, reused here rather than duplicated.
import {
  AllianceChip,
  AllianceRow,
  AxisHeader,
  CallBadge,
  formatScheduledTime,
  matchBandSd,
  matchLabel,
  PredictedScoreLine,
  ActualScoreLine,
  teamNumberLabel,
} from "../team/MatchTable.js";
import { Link } from "@tanstack/react-router";
import { MATCH_GEOMETRY, PLOT_W, type AxisDomain } from "../team/matchAxis.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import type { EventMatchRow } from "./eventMatchAxis.js";

/**
 * The generalized event-scoped match-plot table — the team page's
 * `MatchTable` anatomy with the this-team bold-highlight rule dropped by
 * being made UNREPRESENTABLE rather than merely unapplied:
 * `EventMatchTableProps` carries no team-key prop at all, so this component
 * structurally cannot privilege one team over another.
 *
 * Every vertical position comes from `matchAxis.ts`'s `allianceMarkPositions`
 * and `MATCH_GEOMETRY`, and every horizontal position from that same
 * module's `scaleToPlot`/`PLOT_W` — imported, never restated. No `top` or
 * `left` literal is ever written in this file.
 */
export interface EventMatchTableProps {
  rows: readonly EventMatchRow[];
  domain: AxisDomain;
  season: number;
  /** Carried onto each roster-number link so the destination keeps the reader's algorithm. */
  algorithm: PublishedAlgorithmId;
}

/** Match, plot, Conf., Pred. Score, Actual, Call — the same six columns `MatchTable` uses, so a reader moving between the team page and an event page sees one table. Shared by the header and the skeleton so the two can never disagree about the column count. (A seventh Video column was unwired; `MatchVideoCell` and its parser remain in the tree, unrendered.) */
export const EVENT_MATCH_TABLE_COLUMN_COUNT = 6;

const EVENT_MATCH_TABLE_HEADERS = ["Match", "", "Confidence", "Prediction", "Actual", "Call"] as const;

function EventMatchRowView({ row, domain, tinted, season, algorithm }: { row: EventMatchRow; domain: AxisDomain; tinted: boolean; season: number; algorithm: PublishedAlgorithmId }) {
  const confidence = row.predictedWinner === "red" ? row.pRedWin : 1 - row.pRedWin;
  const winnerCorrect = row.played && row.predictedWinner === row.actualWinner;
  const redLoses = row.played && row.actualWinner === "blue";
  const blueLoses = row.played && row.actualWinner === "red";

  return (
    <tr data-testid={`match-row-${row.matchKey}`} className={cn(tinted ? "match-row-tint" : "match-row-untinted")}>
      <td className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top">
        <div className="flex min-w-0 flex-col gap-[1px]">
          {/* The Match-column label is a link to that match's own page,
              carrying the reader's current algorithm and season — the SAME
              `text-role-label text-[var(--color-text-primary)]` treatment
              plus `hover:underline` the roster-number links below already
              use, so both lines of the cell read as the same affordance.
              Never joins the `.match-alliance-num*` class family (that is
              the roster-number links' own class, asserted distinct by this
              file's own test). */}
          <Link
            to="/match/$matchKey"
            params={{ matchKey: row.matchKey }}
            search={{ year: season, algorithm }}
            className="text-role-label text-[var(--color-text-primary)] hover:underline"
          >
            {matchLabel(row)}
          </Link>
          <span className="numeric-cell text-role-body whitespace-nowrap text-[var(--color-text-primary)]">
            {/* `.match-alliance-nums--even` (theme.css) fixes the line's
                width and distributes the leftover space, so red and blue
                occupy the same box no matter how many digits each roster
                carries. */}
            <span className="match-alliance-nums match-alliance-nums--even">
              {row.redTeams.map((rosterKey) => (
                /* Every roster number links to that team's page. Plain ink
                   (the alliance rows already carry colour); underline on
                   hover marks it interactive. */
                <Link
                  key={rosterKey}
                  to="/team/$teamNumber"
                  params={{ teamNumber: teamNumberLabel(rosterKey) }}
                  search={{ year: season, algorithm, tab: "overview" }}
                  className="hover:underline"
                >
                  {teamNumberLabel(rosterKey)}
                </Link>
              ))}
            </span>
          </span>
          <span className="numeric-cell text-role-body whitespace-nowrap text-[var(--color-text-primary)]">
            {/* `.match-alliance-nums--even` (theme.css) fixes the line's
                width and distributes the leftover space, so red and blue
                occupy the same box no matter how many digits each roster
                carries. */}
            <span className="match-alliance-nums match-alliance-nums--even">
              {row.blueTeams.map((rosterKey) => (
                /* Every roster number links to that team's page. Plain ink
                   (the alliance rows already carry colour); underline on
                   hover marks it interactive. */
                <Link
                  key={rosterKey}
                  to="/team/$teamNumber"
                  params={{ teamNumber: teamNumberLabel(rosterKey) }}
                  search={{ year: season, algorithm, tab: "overview" }}
                  className="hover:underline"
                >
                  {teamNumberLabel(rosterKey)}
                </Link>
              ))}
            </span>
          </span>
        </div>
      </td>
      <td className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top">
        <div className="relative" style={{ width: PLOT_W, height: MATCH_GEOMETRY.PLOT_H }}>
          <AllianceRow
            matchKey={row.matchKey}
            side="red"
            predicted={row.predictedRedScore}
            sd={matchBandSd(row.redMatchBandVariance)}
            actual={row.played ? row.actualRedScore : undefined}
            yBand={MATCH_GEOMETRY.Y_RED}
            domain={domain}
            colorVar="var(--alliance-red)"
            softVar="var(--alliance-red-soft)"
          />
          <AllianceRow
            matchKey={row.matchKey}
            side="blue"
            predicted={row.predictedBlueScore}
            sd={matchBandSd(row.blueMatchBandVariance)}
            actual={row.played ? row.actualBlueScore : undefined}
            yBand={MATCH_GEOMETRY.Y_BLUE}
            domain={domain}
            colorVar="var(--alliance-blue)"
            softVar="var(--alliance-blue-soft)"
          />
        </div>
      </td>
      <td data-testid={`confidence-${row.matchKey}`} className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] pl-[var(--spacing-lg)] align-top">
        <span className="flex items-center gap-[var(--spacing-xs)]">
          <AllianceChip side={row.predictedWinner} />
          <span className="numeric-cell text-role-body whitespace-nowrap text-[var(--color-text-primary)]">{predictionPercent(confidence)}%</span>
        </span>
      </td>
      <td data-testid={`predicted-score-${row.matchKey}`} className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top">
        <div className="flex flex-col gap-[2px]">
          <PredictedScoreLine matchKey={row.matchKey} side="red" score={row.predictedRedScore} variance={row.redMatchBandVariance} season={season} bonusRp={row.redBonusRp} compLevel={row.compLevel} />
          <PredictedScoreLine matchKey={row.matchKey} side="blue" score={row.predictedBlueScore} variance={row.blueMatchBandVariance} season={season} bonusRp={row.blueBonusRp} compLevel={row.compLevel} />
        </div>
      </td>
      <td data-testid={`actual-${row.matchKey}`} className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top">
        {row.played ? (
          <div className="flex flex-col gap-[2px]">
            <ActualScoreLine matchKey={row.matchKey} side="red" score={row.actualRedScore!} isLoser={redLoses} season={season} actualBonusRp={row.actualRedBonusRp} compLevel={row.compLevel} />
            <ActualScoreLine matchKey={row.matchKey} side="blue" score={row.actualBlueScore!} isLoser={blueLoses} season={season} actualBonusRp={row.actualBlueBonusRp} compLevel={row.compLevel} />
          </div>
        ) : (
          <span className="text-role-body whitespace-nowrap text-[var(--color-text-primary)]">
            {row.sortTime !== undefined ? formatScheduledTime(row.sortTime) : ""}
          </span>
        )}
      </td>
      <td data-testid={`call-${row.matchKey}`} className="text-role-body px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top text-[var(--color-text-primary)]">
        <CallBadge played={row.played} coldStart={row.coldStart === true} winnerCorrect={winnerCorrect} />
      </td>
    </tr>
  );
}

/** One event's match table: the shared axis header drawn exactly once, then one row per merged row, in the order the caller supplies (this component never re-sorts). */
export function EventMatchTable({ rows, domain, season, algorithm }: EventMatchTableProps) {
  return (
    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
      <thead>
        <tr>
          {/* No column in this table is frozen during horizontal scroll; Match scrolls with the rest of the row. */}
          <th className="p-[var(--spacing-sm)] text-left">
            <span className="text-role-label text-[var(--color-text-muted)]">Match</span>
          </th>
          <th className="p-[var(--spacing-sm)] text-left">
            <AxisHeader domain={domain} />
          </th>
          <th className="text-role-label p-[var(--spacing-sm)] pl-[var(--spacing-lg)] text-left text-[var(--color-text-muted)]">Confidence</th>
          <th className="text-role-label p-[var(--spacing-sm)] text-left text-[var(--color-text-muted)]">Prediction</th>
          <th className="text-role-label p-[var(--spacing-sm)] text-left text-[var(--color-text-muted)]">Actual</th>
          <th className="text-role-label p-[var(--spacing-sm)] text-left text-[var(--color-text-muted)]">Call</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <EventMatchRowView key={row.matchKey} row={row} domain={domain} tinted={index % 2 === 1} season={season} algorithm={algorithm} />
        ))}
      </tbody>
    </table>
  );
}

/**
 * The pending state's placeholder — the real header labels above
 * `SkeletonRows` sized by `EVENT_MATCH_TABLE_COLUMN_COUNT`, so the pending
 * state has the shape of the table that is loading rather than a spinner.
 * Reuses `SkeletonRows` verbatim rather than a second skeleton primitive.
 */
export function EventMatchTableSkeleton({ rowCount }: { rowCount: number }) {
  return (
    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
      <thead>
        <tr>
          {EVENT_MATCH_TABLE_HEADERS.map((label, index) => (
            <th key={index} className="text-role-label p-[var(--spacing-sm)] text-left text-[var(--color-text-muted)]">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <SkeletonRows rows={rowCount} columns={EVENT_MATCH_TABLE_COLUMN_COUNT} />
      </tbody>
    </table>
  );
}
