import { cn } from "@/lib/utils";
import { BonusRpDots } from "./BonusRpDots.js";
import { teamNumberFromKey } from "../../lib/teamKey.js";
import { allianceMarkPositions, axisTicks, MATCH_GEOMETRY, PLOT_W, scaleToPlot, type AxisDomain, type TeamSeasonMatch } from "./matchAxis.js";
import { bonusRpForSeason, bonusStatesFromFlags, bonusStatesFromProbabilities } from "../../lib/bonusRp.js";
// G-06.1-26 (plan 06.1-08, PD-19): imported directly from core rather than
// copied into apps/web — `rp/constants.ts` has zero runtime imports of its
// own, so (unlike `BONUS_RP_BY_SEASON` in `bonusRp.ts`) importing it does not
// drag the Sigma1 RP implementation into the browser bundle. Precedent:
// `apps/web/src/lib/metricKeys.ts` already imports directly from
// `packages/core/algorithms/breakdown/index.ts`. Guarded as a browser-safe
// entry point by `packages/harness/browserSafeSchemas.test.ts` (plan 06.1-08
// Task 3).
import { isBonusRpCompLevel } from "../../../../../packages/core/algorithms/sigma1/rp/constants.js";

/**
 * The band/tick/dot row anatomy on one shared axis, drawn once per event
 * section (06-08-PLAN.md Task 2). Sketch 003 variant C, selected in
 * `uncertainty-display.md` — the overlap between the two alliance bands IS
 * the win probability, drawn rather than asserted. Every vertical position
 * comes from `matchAxis.ts`'s `allianceMarkPositions` — no `top` literal is
 * ever written in this file (enforced by `06-08-PLAN.md`'s own grep
 * acceptance criterion).
 */
export interface MatchTableProps {
  matches: readonly TeamSeasonMatch[];
  domain: AxisDomain;
  teamKey: string;
  /** Selects the season's bonus-RP set for the per-match dots — two bonuses for 2022–2024, three for 2025–2026. */
  season: number;
}

const COMP_LEVEL_LABELS: Record<TeamSeasonMatch["compLevel"], string> = {
  qm: "Qual",
  ef: "Eighths",
  qf: "Quarterfinal",
  sf: "Semifinal",
  f: "Final",
};

/**
 * The Match column's human label. Prefers the published `setNumber`/
 * `matchNumber`; falls back to the opaque `matchKey`'s own suffix only when
 * those are absent — deriving a display string by parsing an opaque key is
 * the same class of mistake `eventName: eventKey` already shipped
 * (06-RESEARCH.md Pitfall 1), so the fallback exists but is never the
 * primary path.
 */
export function matchLabel(match: Pick<TeamSeasonMatch, "compLevel" | "setNumber" | "matchNumber" | "matchKey">): string {
  const levelLabel = COMP_LEVEL_LABELS[match.compLevel];
  if (match.setNumber !== undefined && match.matchNumber !== undefined) {
    if (match.compLevel === "qm") {
      return `${levelLabel} ${match.matchNumber}`;
    }
    return `${levelLabel} ${match.setNumber}-${match.matchNumber}`;
  }
  const separatorIndex = match.matchKey.lastIndexOf("_");
  return separatorIndex === -1 ? match.matchKey : match.matchKey.slice(separatorIndex + 1);
}

/**
 * `Sat 10:32 AM` in the viewer's own locale/timezone, from an epoch-seconds
 * `sortTime` (D-08's scheduled-match Actual column). Promoted to an export
 * (07-12-PLAN.md Task 1, step 2a) so `EventMatchTable.tsx` renders the
 * identical string for the identical instant rather than reimplementing the
 * date-format construction, which would be free to drift in weekday
 * abbreviation, hour cycle or separator.
 */
export function formatScheduledTime(sortTime: number): string {
  const date = new Date(sortTime * 1000);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
  return `${weekday} ${time}`;
}

function teamNumberLabel(teamKey: string): string {
  try {
    return `${teamNumberFromKey(teamKey)}`;
  } catch {
    return teamKey;
  }
}

interface AllianceRowProps {
  matchKey: string;
  side: "red" | "blue";
  predicted: number;
  sd: number | undefined;
  actual: number | undefined;
  yBand: number;
  domain: AxisDomain;
  colorVar: string;
  softVar: string;
}

/** One alliance's band + tick + dot inside a single match's plot cell — every top from `allianceMarkPositions`, every left from `scaleToPlot`. */
function AllianceRow({ matchKey, side, predicted, sd, actual, yBand, domain, colorVar, softVar }: AllianceRowProps) {
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

  const dotCentre = actual !== undefined ? scaleToPlot(actual, domain, PLOT_W) : undefined;

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

function AxisHeader({ domain }: { domain: AxisDomain }) {
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

/**
 * The Confidence column's predicted-winner chip — exactly two possible
 * values, reusing the SAME `--alliance-*` tokens the plotted band/tick/dot
 * marks already use (`.alliance-chip--{side}`, theme.css), rather than a
 * bare "Red"/"Blue" string sitting alone (06-09-PLAN.md Task 3's polish
 * pass, "chips for bounded categorical values where a bare string sits
 * today").
 */
function AllianceChip({ side }: { side: "red" | "blue" }) {
  return <span className={cn("alliance-chip", side === "red" ? "alliance-chip--red" : "alliance-chip--blue")}>{side === "red" ? "Red" : "Blue"}</span>;
}

/**
 * One alliance's predicted score with its bonus-RP dots above it.
 *
 * The score is rounded to a whole number: a predicted score is an estimate
 * whose own uncertainty is already drawn as the interval band in the plot
 * column, so a decimal here implies a precision the band explicitly denies.
 */
function PredictedScoreLine({
  matchKey,
  side,
  score,
  variance,
  season,
  bonusRp,
  compLevel,
}: {
  matchKey: string;
  side: "red" | "blue";
  score: number;
  /** This alliance's OWN predicted-score variance (D-01). Published by VPR; absent for OPR/EPA, which model no alliance-level own variance — those rows then show a bare score, never a fabricated ±. */
  variance: number | undefined;
  season: number;
  /** This alliance's own predicted per-bonus probabilities (`TeamSeasonMatchSchema.redBonusRp`/`blueBonusRp`, plan 06.1-05), positionally aligned to the season's bonus list. Undefined when the Monte Carlo did not run for this match. */
  bonusRp: readonly number[] | undefined;
  /** G-06.1-26 (plan 06.1-08): this match's own `compLevel`, fed to `isBonusRpCompLevel` to gate `BonusRpDots`' `applicable` prop. */
  compLevel: TeamSeasonMatch["compLevel"];
}) {
  const sd = variance === undefined ? undefined : Math.sqrt(Math.max(0, variance));
  const bonusCount = bonusRpForSeason(season).length;
  const bonusStates = bonusStatesFromProbabilities(bonusRp, bonusCount);
  return (
    <span className="flex items-center gap-[var(--spacing-xs)]">
      <BonusRpDots season={season} side={side} kind="predicted" matchKey={matchKey} states={bonusStates} probabilities={bonusRp} applicable={isBonusRpCompLevel(compLevel)} />
      <span data-testid={`predicted-score-${matchKey}-${side}`} className="numeric-cell whitespace-nowrap text-[var(--color-text-primary)]">
        {Math.round(score)}
        {sd !== undefined && <span className="text-role-spread-suffix text-[var(--color-text-muted)]">{` ± ${Math.round(sd)}`}</span>}
      </span>
    </span>
  );
}

function ActualScoreLine({
  matchKey,
  side,
  score,
  isLoser,
  season,
  actualBonusRp,
  compLevel,
}: {
  matchKey: string;
  side: "red" | "blue";
  score: number;
  isLoser: boolean;
  season: number;
  /** This alliance's own actual per-bonus flags (`TeamSeasonMatchSchema.actualRedBonusRp`/`actualBlueBonusRp`, plan 06.1-05), positionally aligned to the season's bonus list. `null` means the pipeline looked and the fact is not derivable; undefined means the artifact predates the field or the season has no registered RP rules. */
  actualBonusRp: readonly boolean[] | null | undefined;
  /** G-06.1-26 (plan 06.1-08): this match's own `compLevel`, fed to `isBonusRpCompLevel` to gate `BonusRpDots`' `applicable` prop — the defence-in-depth guard against already-published playoff rows that still carry populated actual per-bonus arrays. */
  compLevel: TeamSeasonMatch["compLevel"];
}) {
  const bonusCount = bonusRpForSeason(season).length;
  const bonusStates = bonusStatesFromFlags(actualBonusRp, bonusCount);
  return (
    <span className="flex items-center gap-[var(--spacing-xs)]">
      <BonusRpDots season={season} side={side} kind="actual" matchKey={matchKey} states={bonusStates} applicable={isBonusRpCompLevel(compLevel)} />
      {/* The RP total is deliberately not printed here — bonus RP is the dots
          beside it, and win/tie RP is already carried by the Confidence chip
          and the Call column. */}
      <span data-testid={`actual-${matchKey}-${side}`} className={cn("numeric-cell whitespace-nowrap", isLoser && "text-[var(--loser-ink)]")}>
        {score}
      </span>
    </span>
  );
}

function MatchRow({ match, domain, teamKey, tinted, season }: { match: TeamSeasonMatch; domain: AxisDomain; teamKey: string; tinted: boolean; season: number }) {
  const played = match.actualWinner !== undefined;
  const teamIsRed = match.redTeams.includes(teamKey);
  const teamIsBlue = match.blueTeams.includes(teamKey);

  const confidence = match.predictedWinner === "red" ? match.pRedWin : 1 - match.pRedWin;
  const winnerCorrect = played && match.predictedWinner === match.actualWinner;

  const redLoses = played && match.actualWinner === "blue";
  const blueLoses = played && match.actualWinner === "red";

  return (
    <tr data-testid={`match-row-${match.matchKey}`} className={cn(tinted ? "match-row-tint" : "match-row-untinted")}>
      <td className={cn("sticky left-0 z-[1] px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top", tinted ? "match-row-tint" : "match-row-untinted")}>
        <div className="flex min-w-0 flex-col gap-[1px]">
          <span className="text-role-label text-[var(--color-text-primary)]">{matchLabel(match)}</span>
          <span className="numeric-cell text-role-body whitespace-nowrap text-[var(--color-text-primary)]">
            {match.redTeams.map((key, index) => (
              <span key={key} className={cn(teamIsRed && "font-semibold")}>
                {index > 0 ? " " : ""}
                {teamNumberLabel(key)}
              </span>
            ))}
          </span>
          <span className="numeric-cell text-role-body whitespace-nowrap text-[var(--color-text-primary)]">
            {match.blueTeams.map((key, index) => (
              <span key={key} className={cn(teamIsBlue && "font-semibold")}>
                {index > 0 ? " " : ""}
                {teamNumberLabel(key)}
              </span>
            ))}
          </span>
        </div>
      </td>
      <td className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top">
        <div className="relative" style={{ width: PLOT_W, height: MATCH_GEOMETRY.PLOT_H }}>
          <AllianceRow
            matchKey={match.matchKey}
            side="red"
            predicted={match.predictedRedScore}
            sd={match.redScoreVarianceOwn !== undefined ? Math.sqrt(Math.max(0, match.redScoreVarianceOwn)) : undefined}
            actual={match.actualRedScore}
            yBand={MATCH_GEOMETRY.Y_RED}
            domain={domain}
            colorVar="var(--alliance-red)"
            softVar="var(--alliance-red-soft)"
          />
          <AllianceRow
            matchKey={match.matchKey}
            side="blue"
            predicted={match.predictedBlueScore}
            sd={match.blueScoreVarianceOwn !== undefined ? Math.sqrt(Math.max(0, match.blueScoreVarianceOwn)) : undefined}
            actual={match.actualBlueScore}
            yBand={MATCH_GEOMETRY.Y_BLUE}
            domain={domain}
            colorVar="var(--alliance-blue)"
            softVar="var(--alliance-blue-soft)"
          />
        </div>
      </td>
      <td data-testid={`confidence-${match.matchKey}`} className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] pl-[var(--spacing-lg)] align-top">
        <span className="flex items-center gap-[var(--spacing-xs)]">
          <AllianceChip side={match.predictedWinner} />
          <span className="numeric-cell text-role-body whitespace-nowrap text-[var(--color-text-primary)]">{Math.round(confidence * 100)}%</span>
        </span>
      </td>
      <td data-testid={`predicted-score-${match.matchKey}`} className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top">
        <div className="flex flex-col gap-[2px]">
          <PredictedScoreLine matchKey={match.matchKey} side="red" score={match.predictedRedScore} variance={match.redScoreVarianceOwn} season={season} bonusRp={match.redBonusRp} compLevel={match.compLevel} />
          <PredictedScoreLine matchKey={match.matchKey} side="blue" score={match.predictedBlueScore} variance={match.blueScoreVarianceOwn} season={season} bonusRp={match.blueBonusRp} compLevel={match.compLevel} />
        </div>
      </td>
      <td data-testid={`actual-${match.matchKey}`} className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top">
        {played ? (
          <div className="flex flex-col gap-[2px]">
            <ActualScoreLine matchKey={match.matchKey} side="red" score={match.actualRedScore!} isLoser={redLoses} season={season} actualBonusRp={match.actualRedBonusRp} compLevel={match.compLevel} />
            <ActualScoreLine matchKey={match.matchKey} side="blue" score={match.actualBlueScore!} isLoser={blueLoses} season={season} actualBonusRp={match.actualBlueBonusRp} compLevel={match.compLevel} />
          </div>
        ) : (
          <span className="text-role-body whitespace-nowrap text-[var(--color-text-primary)]">
            {match.sortTime !== undefined ? formatScheduledTime(match.sortTime) : "—"}
          </span>
        )}
      </td>
      <td data-testid={`call-${match.matchKey}`} className="text-role-body px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top text-[var(--color-text-primary)]">
        {!played ? (
          <span aria-hidden="true">{"—"}</span>
        ) : winnerCorrect ? (
          <span aria-label="Prediction correct">{"✓"}</span>
        ) : (
          <span aria-label="Prediction incorrect">{"✗"}</span>
        )}
      </td>
    </tr>
  );
}

/** One event's match table: the shared axis header drawn exactly once, then one row per published match, in the exact order the artifact carries them (never re-sorted client-side). */
export function MatchTable({ matches, domain, teamKey, season }: MatchTableProps) {
  return (
    <table style={{ borderCollapse: "separate", borderSpacing: 0 }}>
      <thead>
        <tr>
          <th className="sticky left-0 z-[2] bg-[var(--color-bg-surface)] p-[var(--spacing-sm)] text-left">
            <span className="text-role-label text-[var(--color-text-muted)]">Match</span>
          </th>
          <th className="p-[var(--spacing-sm)] text-left">
            <AxisHeader domain={domain} />
          </th>
          <th className="text-role-label p-[var(--spacing-sm)] pl-[var(--spacing-lg)] text-left text-[var(--color-text-muted)]">Conf.</th>
          <th className="text-role-label p-[var(--spacing-sm)] text-left text-[var(--color-text-muted)]">Pred. Score</th>
          <th className="text-role-label p-[var(--spacing-sm)] text-left text-[var(--color-text-muted)]">Actual</th>
          <th className="text-role-label p-[var(--spacing-sm)] text-left text-[var(--color-text-muted)]">Call</th>
        </tr>
      </thead>
      <tbody>
        {matches.map((match, index) => (
          <MatchRow key={match.matchKey} match={match} domain={domain} teamKey={teamKey} tinted={index % 2 === 1} season={season} />
        ))}
      </tbody>
    </table>
  );
}
