import { cn } from "@/lib/utils";
import { BonusRpDots } from "./BonusRpDots.js";
import { Link } from "@tanstack/react-router";
import { teamNumberFromKey } from "../../lib/teamKey.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { allianceMarkPositions, axisTicks, MATCH_GEOMETRY, PLOT_W, scaleToPlot, teamRowPrediction, type AxisDomain, type TeamSeasonMatch } from "./matchAxis.js";
import { bonusRpForSeason, bonusStatesFromFlags } from "../../lib/bonusRp.js";
import { snapToDevicePixelPhase, useDevicePixelPhaseStep } from "../../lib/devicePixelGrid.js";
import { predictionPercent } from "../../lib/predictionPercent.js";
import { sortTimeToEpochMs } from "../../lib/liveEvent.js";
// Imported directly from core rather than copied into apps/web —
// `rp/constants.ts` has zero runtime imports of its own, so importing it does
// not drag any server-only implementation into the browser bundle. Guarded as
// a browser-safe entry point by `packages/harness/browserSafeSchemas.test.ts`.
import { isBonusRpCompLevel } from "../../../../../packages/core/rankingPoints/constants.js";

/**
 * The band/tick/dot row anatomy on one shared axis, drawn once per event
 * section. The overlap between the two alliance bands is the win probability,
 * drawn rather than asserted. Every vertical position comes from
 * `matchAxis.ts`'s `allianceMarkPositions` — no `top` literal is ever written
 * in this file.
 */
export interface MatchTableProps {
  matches: readonly TeamSeasonMatch[];
  domain: AxisDomain;
  teamKey: string;
  /** Selects the season's bonus-RP set for the per-match dots — two bonuses for 2022–2024, three for 2025–2026. */
  season: number;
  /** Carried onto each roster-number link so the destination keeps the reader's algorithm, exactly as `EventMatchTable` does. */
  algorithm: PublishedAlgorithmId;
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
 * those are absent — the fallback exists but is never the primary path.
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
 * `Sat 10:32 AM PST` — the scheduled instant rendered in the viewer's own
 * locale/timezone, labelled with that zone. The published artifact carries no
 * event `timezone` field, so the venue's own zone cannot be shown — only the
 * reader's can, and unlabelled that would read as the venue's. This differs
 * from `eventDates.ts`'s UTC-pinning, which solves the opposite problem: an
 * event date must never shift off its calendar day, while a match time cannot
 * be pinned to the venue's zone without the artifact publishing one.
 *
 * Exported so `EventMatchTable.tsx` and `StartMatchPicker.tsx`'s summary row
 * render the identical string for the identical instant.
 */
export function formatScheduledTime(sortTime: number): string {
  // The published `sortTime` is epoch seconds for some events and epoch
  // milliseconds for others; `sortTimeToEpochMs` owns the unit rule.
  const epochMs = sortTimeToEpochMs(sortTime);
  const date = new Date(epochMs);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" }).format(date);
  return `${weekday} ${time}`;
}

/**
 * A team key's displayed number, falling back to the raw key string when it
 * does not match the `frc{number}` shape. Exported so `EventMatchTable.tsx`
 * and `StartMatchPicker.tsx` share this one implementation.
 */
export function teamNumberLabel(teamKey: string): string {
  try {
    return `${teamNumberFromKey(teamKey)}`;
  } catch {
    return teamKey;
  }
}

export interface AllianceRowProps {
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

/**
 * One alliance's band + tick + dot inside a single match's plot cell — every
 * top from `allianceMarkPositions`, every left from `scaleToPlot`. Shared with
 * `EventMatchTable.tsx`: this component carries no `played` gate of its own —
 * a caller who must never draw a dot for an unplayed row passes
 * `actual={undefined}` in that case.
 */
export function AllianceRow({ matchKey, side, predicted, sd, actual, yBand, domain, colorVar, softVar }: AllianceRowProps) {
  const pos = allianceMarkPositions(yBand);
  const tickCentre = scaleToPlot(predicted, domain, PLOT_W);
  const tickStep = useDevicePixelPhaseStep();
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
        /* The left edge is snapped onto the device-pixel grid so every tick in
           the table renders at the same weight — see `lib/devicePixelGrid.ts`.
           `tickStep` is 1 at dpr 1 and 2, where this was never broken. */
        style={{ top: pos.tickTop, left: snapToDevicePixelPhase(tickCentre - 1, tickStep), width: 2, height: MATCH_GEOMETRY.TICK_H, background: colorVar }}
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

export function AxisHeader({ domain }: { domain: AxisDomain }) {
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
 * The deliberate empty treatment for an upcoming match nobody could price
 * (260915-m4j): a schedule-only row written by the live Worker whose event
 * artifact carried no usable state block. A blank cell reads as missing
 * data, so the Confidence cell says so in muted words instead; the
 * Prediction and plot cells stay empty, and no mark is ever drawn at a
 * fabricated position. Token classes only.
 */
export function NoPrediction({ matchKey }: { matchKey: string }) {
  return (
    <span data-testid={`no-prediction-${matchKey}`} className="text-role-body whitespace-nowrap text-[var(--color-text-muted)]">
      No prediction
    </span>
  );
}

/**
 * The Confidence column's predicted-winner chip — exactly two possible
 * values, reusing the same `--alliance-*` tokens the plotted band/tick/dot
 * marks already use (`.alliance-chip--{side}`, theme.css).
 */
export function AllianceChip({ side }: { side: "red" | "blue" }) {
  return <span className={cn("alliance-chip", side === "red" ? "alliance-chip--red" : "alliance-chip--blue")}>{side === "red" ? "Red" : "Blue"}</span>;
}

/**
 * One alliance's predicted score with its bonus-RP dots above it.
 *
 * The score is rounded to a whole number: a predicted score is an estimate
 * whose own uncertainty is already drawn as the interval band in the plot
 * column, so a decimal here implies a precision the band explicitly denies.
 */
export function PredictedScoreLine({
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
  /** This alliance's published Match Band variance. Published for Sigma algorithms (SPR) only; absent for OPR and EPA rows and for stale artifacts, which then show a bare score, never a fabricated ±. */
  variance: number | undefined;
  season: number;
  /** This alliance's own predicted per-bonus probabilities, positionally aligned to the season's bonus list. Undefined when the Monte Carlo did not run for this match. */
  bonusRp: readonly number[] | undefined;
  /** This match's own `compLevel`, fed to `isBonusRpCompLevel` to gate `BonusRpDots`' `applicable` prop. Typed off `isBonusRpCompLevel`'s own parameter, not either caller's row type, since `TeamSeasonMatchSchema` and `EventMatchSchema` both use the same qm/ef/qf/sf/f enum and this component is shared by both. */
  compLevel: Parameters<typeof isBonusRpCompLevel>[0];
}) {
  const sd = variance === undefined ? undefined : Math.sqrt(Math.max(0, variance));
  return (
    <span className="flex items-center gap-[var(--spacing-xs)]">
      {/* Probabilities only: each dot draws its own bonusDotTier. */}
      <BonusRpDots season={season} side={side} kind="predicted" matchKey={matchKey} probabilities={bonusRp} applicable={isBonusRpCompLevel(compLevel)} />
      <span data-testid={`predicted-score-${matchKey}-${side}`} className="numeric-cell whitespace-nowrap text-[var(--color-text-primary)]">
        {Math.round(score)}
        {sd !== undefined && <span className="text-role-spread-suffix text-[var(--color-text-muted)]">{` ± ${Math.round(sd)}`}</span>}
      </span>
    </span>
  );
}

export function ActualScoreLine({
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
  /** This alliance's own actual per-bonus flags, positionally aligned to the season's bonus list. `null` means the pipeline looked and the fact is not derivable; undefined means the artifact predates the field or the season has no registered RP rules. */
  actualBonusRp: readonly boolean[] | null | undefined;
  /** This match's own `compLevel`, fed to `isBonusRpCompLevel` to gate `BonusRpDots`' `applicable` prop — the defence-in-depth guard against already-published playoff rows that still carry populated actual per-bonus arrays. See `PredictedScoreLine`'s identical note. */
  compLevel: Parameters<typeof isBonusRpCompLevel>[0];
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

function MatchRow({ match, domain, teamKey, tinted, season, algorithm }: { match: TeamSeasonMatch; domain: AxisDomain; teamKey: string; tinted: boolean; season: number; algorithm: PublishedAlgorithmId }) {
  const played = match.actualWinner !== undefined;
  const teamIsRed = match.redTeams.includes(teamKey);
  const teamIsBlue = match.blueTeams.includes(teamKey);
  // A roster key matching neither side — the published letter-suffixed shape
  // (`teamKey.ts`'s `frc5199B`, a second robot entered only at offseason
  // events) is the real case that reaches this — must not fall through the
  // chip chain below and read as a confident "Loss". `teamOnRoster` gates the
  // whole chain alongside `played`.
  const teamOnRoster = teamIsRed || teamIsBlue;

  // Undefined only for an upcoming row the browser could not price (260915-m4j):
  // "No prediction", an empty Prediction cell and an empty plot cell.
  const prediction = teamRowPrediction(match);
  const confidence = prediction === undefined ? undefined : prediction.predictedWinner === "red" ? prediction.pRedWin : 1 - prediction.pRedWin;
  const winnerCorrect = played && prediction !== undefined && prediction.predictedWinner === match.actualWinner;

  const redLoses = played && match.actualWinner === "blue";
  const blueLoses = played && match.actualWinner === "red";

  return (
    <tr data-testid={`match-row-${match.matchKey}`} className={cn(tinted ? "match-row-tint" : "match-row-untinted")}>
      <td className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top">
        <div className="flex min-w-0 flex-col gap-[1px]">
          {/* The Match-column label links to that match's own page, carrying
              the reader's current algorithm and season — the same
              `text-role-label text-[var(--color-text-primary)]` treatment
              plus `hover:underline` the roster-number links below already
              use. Never joins the `.match-alliance-num*` class family. */}
          <Link
            to="/match/$matchKey"
            params={{ matchKey: match.matchKey }}
            search={{ year: season, algorithm }}
            className="text-role-label text-[var(--color-text-primary)] hover:underline"
          >
            {matchLabel(match)}
          </Link>
          {/* The team's own alliance line rides a pill on
              `--alliance-{red,blue}-ground`; its own number rides
              `-ground-own` on top — the figure stays neutral
              `--color-text-primary` here, ground carries the signal. The 10px
              gap between roster numbers is `.match-alliance-nums`'s `gap`,
              not a text-node space. */}
          <span className="numeric-cell text-role-body whitespace-nowrap text-[var(--color-text-primary)]">
            <span className={cn("match-alliance-nums", teamIsRed && "match-alliance-nums--mine match-alliance-nums--red")}>
              {match.redTeams.map((key) => (
                /* Every roster number links to that team's page, the
                   same link `EventMatchTable` already renders. The ground
                   pill stays on the anchor itself. */
                <Link
                  key={key}
                  to="/team/$teamNumber"
                  params={{ teamNumber: teamNumberLabel(key) }}
                  search={{ year: season, algorithm, tab: "overview" }}
                  className={cn("match-alliance-num hover:underline", key === teamKey && "match-alliance-num--own")}
                >
                  {teamNumberLabel(key)}
                </Link>
              ))}
            </span>
          </span>
          <span className="numeric-cell text-role-body whitespace-nowrap text-[var(--color-text-primary)]">
            <span className={cn("match-alliance-nums", teamIsBlue && "match-alliance-nums--mine match-alliance-nums--blue")}>
              {match.blueTeams.map((key) => (
                /* Every roster number links to that team's page, the
                   same link `EventMatchTable` already renders. The ground
                   pill stays on the anchor itself. */
                <Link
                  key={key}
                  to="/team/$teamNumber"
                  params={{ teamNumber: teamNumberLabel(key) }}
                  search={{ year: season, algorithm, tab: "overview" }}
                  className={cn("match-alliance-num hover:underline", key === teamKey && "match-alliance-num--own")}
                >
                  {teamNumberLabel(key)}
                </Link>
              ))}
            </span>
          </span>
        </div>
      </td>
      {/* This team's outcome, computed from actualWinner against the side the
          roster puts the team on. Empty when unplayed, and empty when the
          team is on neither roster — a real third case: the published
          letter-suffixed key shape (`teamKey.ts`'s `frc5199B`, a team's
          second robot, offseason-only) matches neither `redTeams` nor
          `blueTeams` when the page renders the parent key, so the
          `teamOnRoster` gate below is required to avoid rendering a
          confident "Loss" for a match the team never played. */}
      <td data-testid={`result-${match.matchKey}`} className="w-[64px] px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top">
        {played &&
          teamOnRoster &&
          (match.actualWinner === "tie" ? (
            <span className="result-chip result-chip--tie">Tie</span>
          ) : (match.actualWinner === "red" && teamIsRed) || (match.actualWinner === "blue" && teamIsBlue) ? (
            <span className="result-chip result-chip--win">Win</span>
          ) : (
            <span className="result-chip result-chip--loss">Loss</span>
          ))}
      </td>
      <td data-testid={`actual-${match.matchKey}`} className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top">
        {played ? (
          <div className="flex flex-col gap-[2px]">
            <ActualScoreLine matchKey={match.matchKey} side="red" score={match.actualRedScore!} isLoser={redLoses} season={season} actualBonusRp={match.actualRedBonusRp} compLevel={match.compLevel} />
            <ActualScoreLine matchKey={match.matchKey} side="blue" score={match.actualBlueScore!} isLoser={blueLoses} season={season} actualBonusRp={match.actualBlueBonusRp} compLevel={match.compLevel} />
          </div>
        ) : (
          <span className="text-role-body whitespace-nowrap text-[var(--color-text-primary)]">
            {match.sortTime !== undefined ? formatScheduledTime(match.sortTime) : ""}
          </span>
        )}
      </td>
      <td data-testid={`predicted-score-${match.matchKey}`} className={cn("px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top", "match-table-rule")}>
        {prediction !== undefined && (
          <div className="flex flex-col gap-[2px]">
            <PredictedScoreLine matchKey={match.matchKey} side="red" score={prediction.predictedRedScore} variance={match.redMatchBandVariance} season={season} bonusRp={match.redBonusRp} compLevel={match.compLevel} />
            <PredictedScoreLine matchKey={match.matchKey} side="blue" score={prediction.predictedBlueScore} variance={match.blueMatchBandVariance} season={season} bonusRp={match.blueBonusRp} compLevel={match.compLevel} />
          </div>
        )}
      </td>
      <td data-testid={`confidence-${match.matchKey}`} className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top">
        {prediction === undefined || confidence === undefined ? (
          <NoPrediction matchKey={match.matchKey} />
        ) : (
          <span className="flex items-center gap-[var(--spacing-xs)]">
            <AllianceChip side={prediction.predictedWinner} />
            <span className="numeric-cell text-role-body whitespace-nowrap text-[var(--color-text-primary)]">{predictionPercent(confidence)}%</span>
          </span>
        )}
      </td>
      <td className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] pl-[var(--spacing-lg)] align-top">
        {/* The sized container stays for an unpriced row so the row keeps its height; it holds no mark. */}
        <div className="relative" style={{ width: PLOT_W, height: MATCH_GEOMETRY.PLOT_H }}>
          {prediction !== undefined && (
            <>
              <AllianceRow
                matchKey={match.matchKey}
                side="red"
                predicted={prediction.predictedRedScore}
                sd={matchBandSd(match.redMatchBandVariance)}
                actual={match.actualRedScore}
                yBand={MATCH_GEOMETRY.Y_RED}
                domain={domain}
                colorVar="var(--alliance-red)"
                softVar="var(--alliance-red-soft)"
              />
              <AllianceRow
                matchKey={match.matchKey}
                side="blue"
                predicted={prediction.predictedBlueScore}
                sd={matchBandSd(match.blueMatchBandVariance)}
                actual={match.actualBlueScore}
                yBand={MATCH_GEOMETRY.Y_BLUE}
                domain={domain}
                colorVar="var(--alliance-blue)"
                softVar="var(--alliance-blue-soft)"
              />
            </>
          )}
        </div>
      </td>
      <td data-testid={`call-${match.matchKey}`} className="text-role-body px-[var(--spacing-sm)] py-[var(--spacing-xs)] align-top text-[var(--color-text-primary)]">
        <CallBadge played={played} coldStart={match.coldStart === true} winnerCorrect={winnerCorrect} />
      </td>
    </tr>
  );
}

/** One event's match table: the shared axis header drawn exactly once, then one row per published match, in the exact order the artifact carries them (never re-sorted client-side). */
/**
 * The band's standard deviation, from the published Match Band variance: the
 * number of robots on the alliance times the sum of their squared Sigma
 * Scores. It is the display band only, never the win-odds variance.
 *
 * Published for Sigma algorithms (SPR) only. OPR and EPA rows carry none, so
 * those rows draw no band rather than a wrong one. Deliberately does not fall
 * back to the algorithm's own `*ScoreVarianceOwn`: that is a different
 * quantity at a different level. Absent means absent.
 */
export function matchBandSd(matchBandVariance: number | undefined): number | undefined {
  return matchBandVariance === undefined ? undefined : Math.sqrt(Math.max(0, matchBandVariance));
}

/**
 * The Call column's four-state badge — unplayed dash (aria-hidden), cold-start
 * dash (its own accessible label, distinct from both prediction outcomes),
 * hit check, and miss cross. Extracted and exported so `MatchRow` (below) and
 * `EventMatchTable.tsx`'s row view share one implementation. A tie needs no
 * branch of its own here: `winnerCorrect` is already `false` for a tie, which
 * falls through to the same miss badge a dedicated tie branch would render.
 */
export function CallBadge({ played, coldStart, winnerCorrect }: { played: boolean; coldStart: boolean; winnerCorrect: boolean }) {
  if (!played) {
    return (
      <span aria-hidden="true" className="call-badge call-none">
        {"—"}
      </span>
    );
  }
  if (coldStart) {
    // A structural cold start — every robot in this match was making its
    // corpus-global first appearance, so the algorithm had nothing to predict
    // from and the match is excluded from accuracy/Brier entirely. Same
    // neutral glyph and class as the not-played branch above, but unlike that
    // branch this one is exposed to assistive technology, with its own
    // accessible label distinct from both "Prediction correct" and
    // "Prediction incorrect". Taken from the row's own published flag, never
    // derived from a 0.5 win probability — that would sweep in an ordinary
    // no-call.
    return (
      <span aria-label="Not scored (no prior data)" className="call-badge call-none">
        {"—"}
      </span>
    );
  }
  return winnerCorrect ? (
    <span aria-label="Prediction correct" className="call-badge call-hit">
      {"✓"}
    </span>
  ) : (
    <span aria-label="Prediction incorrect" className="call-badge call-miss">
      {"✗"}
    </span>
  );
}

export function MatchTable({ matches, domain, teamKey, season, algorithm }: MatchTableProps) {
  return (
    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
      <thead>
        <tr>
          <th className="p-[var(--spacing-sm)] text-left">
            <span className="text-role-label text-[var(--color-text-muted)]">Match</span>
          </th>
          {/* W/L/T chip for this team, right of Match. No column in this table is sticky: Result and Match scroll with the rest of the row. */}
          <th className="w-[64px] p-[var(--spacing-sm)] text-left">
            <span className="text-role-label text-[var(--color-text-muted)]">Result</span>
          </th>
          <th className="text-role-label p-[var(--spacing-sm)] text-left text-[var(--color-text-muted)]">Actual</th>
          <th className={cn("text-role-label p-[var(--spacing-sm)] text-left text-[var(--color-text-muted)]", "match-table-rule")}>Prediction</th>
          <th className="text-role-label p-[var(--spacing-sm)] text-left text-[var(--color-text-muted)]">Confidence</th>
          <th className="p-[var(--spacing-sm)] pl-[var(--spacing-lg)] text-left">
            <AxisHeader domain={domain} />
          </th>
          <th className="text-role-label p-[var(--spacing-sm)] text-left text-[var(--color-text-muted)]">Call</th>
        </tr>
      </thead>
      <tbody>
        {matches.map((match, index) => (
          <MatchRow key={match.matchKey} match={match} domain={domain} teamKey={teamKey} tinted={index % 2 === 1} season={season} algorithm={algorithm} />
        ))}
      </tbody>
    </table>
  );
}
