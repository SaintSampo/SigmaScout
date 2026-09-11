import type { ReactElement, ReactNode } from "react";
import {
  SIGMA_FIGURES,
  SIGMA_LEAD,
  SIGMA_SECTIONS,
  type SigmaFigureId,
} from "./sigmaContent.js";
import {
  MATCH_GEOMETRY,
  allianceMarkPositions,
  axisTicks,
  padAxisDomain,
  scaleToPlot,
} from "../team/matchAxis.js";
import {
  allianceSwingBandVariance,
} from "../../../../../packages/harness/swingFactor.js";
import {
  DEFAULT_SIGMA_SCORE_OPTIONS,
  SigmaScoreAccumulator,
} from "../../../../../packages/harness/sigmaScore.js";

/**
 * One team's Sigma Score over an illustrative miss list, computed by the SAME
 * accumulator the pipeline publishes with.
 *
 * The figures below never hand-compute a drawn value. That is the rule the
 * previous version of this page established and it is worth keeping: a drawing
 * that recomputes the estimator in its own way is free to drift from the
 * shipped one, and a teaching figure that quietly disagrees with the site is
 * worse than no figure.
 *
 * A fixed talent is supplied so the drawing is deterministic and does not
 * depend on population state it has no way to show.
 */
function illustrativeSigma(misses: readonly number[], talent = 40): number {
  const accumulator = new SigmaScoreAccumulator();
  accumulator.observeTalent("frcExample", talent);
  for (const miss of misses) accumulator.fold("frcExample", miss);
  return accumulator.sigmaFor("frcExample");
}

/**
 * The `/methodology/sigma` page body (quick task 260910-u7g): every prose
 * string comes from `sigmaContent.ts`, and the six drawings are hand
 * authored inline SVG. Static, no artifact, no network — this page takes no
 * props and reads nothing from the server, because everything it explains is
 * a fact about how the site computes a number rather than a number the site
 * publishes.
 *
 * WHY THE FIGURES CALL THE SHIPPING CODE
 *
 * The three quantities the drawings depend on are computed at render time by
 * `packages/harness/swingFactor.ts` itself, never retyped here:
 *
 *   - F2's band width is `SigmaScoreAccumulator` over the illustrative
 *     miss array, and its dot opacities are the variance half life raised to
 *     each observation's age.
 *   - F3's two `±` labels are `SigmaScoreAccumulator` over each row's own
 *     dots, so a label can never drift from the marks beside it.
 *   - F4's combined bar is the square root of `allianceSwingBandVariance`, so
 *     the "±17.32, never ±30" claim the prose makes is measured on screen by
 *     the function that produces it in production.
 *
 * Neither the scale nor the half life is therefore typed anywhere in this
 * file as a number. If either constant moves, these pictures move with it.
 * The route test asserts that absence, which is why this comment names them
 * in words rather than restating either value.
 *
 * F5 goes further and imports `MATCH_GEOMETRY`, `allianceMarkPositions`,
 * `scaleToPlot`, `padAxisDomain` and `axisTicks` from the match table's own
 * axis module, so the figure explaining the match band is drawn by the same
 * geometry the shipped match table draws, not a lookalike that could drift
 * away from it.
 *
 * DESIGN CONSTRAINTS (`.claude/skills/sketch-findings-sigmascout/`, references
 * `uncertainty-display.md` and `chart-craft.md`), each of which this file is
 * checked against by `src/routes/methodology.sigma.test.tsx`:
 *
 *   - Every colour is a custom property. A literal hex value in this file
 *     fails the route test's source scan.
 *   - Alliance red and blue are FRC domain vocabulary and mean "alliance".
 *     Marks that are NOT alliances (a team's misses in F2 and F3, a single
 *     robot's swing in F4) wear neutral ink instead, so the colour encoding
 *     stays honest.
 *   - Green is ink, not paint. Nothing here is clickable, so the accent
 *     token never appears.
 *   - ONE shared value axis per figure, drawn once and labelled, since every
 *     axis here is zoomed rather than starting at a meaningful zero.
 *   - Coupled geometry derives from one computed source. `chart-craft.md`
 *     records the shipped drift this prevents: a dot that sat 4.5px off its
 *     band's centre because two numbers that had to agree were maintained
 *     separately.
 *   - No numeric label carries a leading minus, because a minus sign is a
 *     banned character on this page. Direction is named in words above and
 *     below the zero line and magnitudes are labelled unsigned.
 *
 * Fixed pixel widths inside a horizontally scrollable wrapper, deliberately,
 * rather than a responsive `width: 100%`: shrinking a 640px drawing onto a
 * 390px phone would take every label below legible size. The shipped match
 * plot already makes this same trade at 470px.
 */

/** The one width every figure on this page shares. */
const FIGURE_W = 640;
/** The left column that holds each figure's row labels and axis labels. */
const LABEL_GUTTER = 132;
/** Breathing room so a mark or label at the right extreme is never clipped. */
const FIGURE_RIGHT_PAD = 28;
/** Derived by subtraction, never a second hand typed width. */
const FIGURE_PLOT_W = FIGURE_W - LABEL_GUTTER - FIGURE_RIGHT_PAD;

const PLOT_LEFT = LABEL_GUTTER;
const PLOT_RIGHT = LABEL_GUTTER + FIGURE_PLOT_W;
/** The right edge of the label gutter's text, right aligned against it. */
const GUTTER_TEXT_X = LABEL_GUTTER - 10;

const TICK_FONT = 10;
const LABEL_FONT = 10;
const ANNOTATION_FONT = 11;

/**
 * The figure shell: an accessible name (both as `aria-label` and as the
 * `<title>` child), a horizontal scroll region so the page itself never
 * scrolls sideways, and the caption from the content module.
 */
function Figure({ figureId, height, children }: { figureId: SigmaFigureId; height: number; children: ReactNode }) {
  const figure = SIGMA_FIGURES.find((entry) => entry.id === figureId);
  if (figure === undefined) return null;
  return (
    <figure className="m-0 flex flex-col gap-[var(--spacing-xs)]">
      <div style={{ overflowX: "auto" }}>
        <svg
          width={FIGURE_W}
          height={height}
          viewBox={`0 0 ${FIGURE_W} ${height}`}
          role="img"
          aria-label={figure.title}
          style={{ display: "block" }}
        >
          <title>{figure.title}</title>
          {children}
        </svg>
      </div>
      <figcaption className="max-w-[72ch] text-role-label text-[var(--color-text-muted)]">{figure.caption}</figcaption>
    </figure>
  );
}

/**
 * The shared horizontal value axis: one line, a few labelled ticks, and the
 * axis's own name centred underneath. Every figure that scales a value left
 * to right draws exactly one of these.
 */
function ValueAxis({
  y,
  ticks,
  xFor,
  name,
}: {
  y: number;
  ticks: readonly number[];
  xFor: (value: number) => number;
  name: string;
}) {
  return (
    <g>
      <line x1={PLOT_LEFT} y1={y} x2={PLOT_RIGHT} y2={y} stroke="var(--color-border)" strokeWidth={1} />
      {ticks.map((tick, index) => (
        <g key={`${tick}:${index}`}>
          <line x1={xFor(tick)} y1={y} x2={xFor(tick)} y2={y + 5} stroke="var(--color-border)" strokeWidth={1} />
          <text x={xFor(tick)} y={y + 18} textAnchor="middle" fontSize={TICK_FONT} fill="var(--color-text-muted)">
            {tick}
          </text>
        </g>
      ))}
      <text
        x={PLOT_LEFT + FIGURE_PLOT_W / 2}
        y={y + 34}
        textAnchor="middle"
        fontSize={TICK_FONT}
        fill="var(--color-text-muted)"
      >
        {name}
      </text>
    </g>
  );
}

/** A right aligned label in the gutter, the same treatment in every figure. */
function GutterLabel({ y, children }: { y: number; children: ReactNode }) {
  return (
    <text x={GUTTER_TEXT_X} y={y} textAnchor="end" fontSize={LABEL_FONT} fill="var(--color-text-muted)">
      {children}
    </text>
  );
}

/* ------------------------------------------------------------------ */
/* F1 — where the number starts                                        */
/* ------------------------------------------------------------------ */

/** Example match, labelled as an example in the figure's own caption. */
const F1_PREDICTED = 150;
const F1_ACTUAL = 168;
const F1_ROSTER_SIZE = 3;
const F1_H = 216;
const F1_BAND_Y = 44;
const F1_BAND_H = 14;
const F1_CHIP_Y = 108;
const F1_CHIP_H = 28;
const F1_CHIP_GAP = 6;
const F1_AXIS_Y = 166;

function EvenSplitFigure(): ReactElement {
  const domain = padAxisDomain(F1_PREDICTED, F1_ACTUAL);
  const xFor = (value: number) => PLOT_LEFT + scaleToPlot(value, domain, FIGURE_PLOT_W);
  const xPredicted = xFor(F1_PREDICTED);
  const xActual = xFor(F1_ACTUAL);
  const gapW = xActual - xPredicted;
  // One computed source for both the band's centre line and the marks on it.
  const bandCentre = F1_BAND_Y + F1_BAND_H / 2;
  const chipW = (gapW - F1_CHIP_GAP * (F1_ROSTER_SIZE - 1)) / F1_ROSTER_SIZE;
  const share = (F1_ACTUAL - F1_PREDICTED) / F1_ROSTER_SIZE;

  return (
    <Figure figureId="even-split" height={F1_H}>
      <GutterLabel y={bandCentre + 4}>one alliance</GutterLabel>
      <rect x={xPredicted} y={F1_BAND_Y} width={gapW} height={F1_BAND_H} fill="var(--alliance-red-soft)" rx={3} />
      <text
        x={xPredicted + gapW / 2}
        y={F1_BAND_Y - 10}
        textAnchor="middle"
        fontSize={ANNOTATION_FONT}
        fill="var(--color-text-primary)"
      >
        {`${F1_ACTUAL - F1_PREDICTED} points more than predicted`}
      </text>
      <rect
        x={xPredicted - 1.5}
        y={bandCentre - MATCH_GEOMETRY.TICK_H / 2}
        width={3}
        height={MATCH_GEOMETRY.TICK_H}
        fill="var(--alliance-red)"
      />
      <circle
        cx={xActual}
        cy={bandCentre}
        r={6}
        fill="var(--color-bg-surface)"
        stroke="var(--alliance-red)"
        strokeWidth={3}
      />
      <text x={xPredicted} y={F1_BAND_Y + 34} textAnchor="middle" fontSize={LABEL_FONT} fill="var(--color-text-muted)">
        {`predicted ${F1_PREDICTED}`}
      </text>
      <text x={xActual} y={F1_BAND_Y + 34} textAnchor="middle" fontSize={LABEL_FONT} fill="var(--color-text-muted)">
        {`actually scored ${F1_ACTUAL}`}
      </text>

      <GutterLabel y={F1_CHIP_Y + F1_CHIP_H / 2 + 4}>{"each robot's share"}</GutterLabel>
      {Array.from({ length: F1_ROSTER_SIZE }, (_, index) => {
        const chipX = xPredicted + index * (chipW + F1_CHIP_GAP);
        return (
          <g key={index}>
            <rect
              x={chipX}
              y={F1_CHIP_Y}
              width={chipW}
              height={F1_CHIP_H}
              rx={4}
              fill="var(--alliance-red-soft)"
              stroke="var(--alliance-red)"
              strokeWidth={1}
            />
            <text
              x={chipX + chipW / 2}
              y={F1_CHIP_Y + F1_CHIP_H / 2 + 4}
              textAnchor="middle"
              fontSize={ANNOTATION_FONT}
              fill="var(--color-text-primary)"
            >
              {`${share} points`}
            </text>
          </g>
        );
      })}

      <ValueAxis y={F1_AXIS_Y} ticks={axisTicks(domain)} xFor={xFor} name="alliance score" />
    </Figure>
  );
}

/* ------------------------------------------------------------------ */
/* F2 — one team, many matches                                         */
/* ------------------------------------------------------------------ */

/**
 * Example misses for one team, oldest first, labelled as an example in the
 * figure's caption. Chosen so the team's own average sits well above zero:
 * that gap IS the story, because it is the model's steady bias rather than
 * anything the robot did, and the shaded band beside it is Sigma.
 */
const F2_EXAMPLE_MISSES = [15, 20, 17, 23, 18, 22, 16, 21, 19, 20];
const F2_H = 288;
const F2_MISS_MAX = 30;
const F2_ZERO_Y = 214;
const F2_MISS_PX = 170;
const F2_AXIS_TOP_Y = 34;
const F2_AXIS_BOTTOM_Y = 244;
const F2_FIRST_DOT_X = 70;
const F2_LAST_DOT_PAD = 20;

function LevelAndSwingFigure(): ReactElement {
  const decay = 0.5 ** (1 / DEFAULT_SIGMA_SCORE_OPTIONS.varHalfLife);
  const lastIndex = F2_EXAMPLE_MISSES.length - 1;
  const weights = F2_EXAMPLE_MISSES.map((_, index) => decay ** (lastIndex - index));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const weightedMean =
    F2_EXAMPLE_MISSES.reduce((sum, miss, index) => sum + miss * (weights[index] as number), 0) / totalWeight;
  // The drawn band width is the SHIPPING function's answer, not a guess at it.
  const swing = illustrativeSigma(F2_EXAMPLE_MISSES);

  const yFor = (miss: number) => F2_ZERO_Y - (miss / F2_MISS_MAX) * F2_MISS_PX;
  const step = (FIGURE_PLOT_W - F2_FIRST_DOT_X - F2_LAST_DOT_PAD) / lastIndex;
  const xFor = (index: number) => PLOT_LEFT + F2_FIRST_DOT_X + index * step;
  const meanY = yFor(weightedMean);
  const bandTopY = yFor(weightedMean + swing);
  const bandBottomY = yFor(weightedMean - swing);

  return (
    <Figure figureId="level-and-swing" height={F2_H}>
      <rect
        x={PLOT_LEFT}
        y={bandTopY}
        width={FIGURE_PLOT_W}
        height={bandBottomY - bandTopY}
        fill="var(--sim-band-overlay)"
      />
      <line x1={PLOT_LEFT} y1={F2_ZERO_Y} x2={PLOT_RIGHT} y2={F2_ZERO_Y} stroke="var(--color-text-muted)" strokeWidth={1} />
      <line
        x1={PLOT_LEFT}
        y1={meanY}
        x2={PLOT_RIGHT}
        y2={meanY}
        stroke="var(--color-text-primary)"
        strokeWidth={1}
        strokeDasharray="5 4"
      />

      <line x1={PLOT_LEFT} y1={F2_AXIS_TOP_Y} x2={PLOT_LEFT} y2={F2_AXIS_BOTTOM_Y} stroke="var(--color-border)" strokeWidth={1} />
      {[0, 10, 20, 30].map((tick) => (
        <g key={tick}>
          <line x1={PLOT_LEFT - 5} y1={yFor(tick)} x2={PLOT_LEFT} y2={yFor(tick)} stroke="var(--color-border)" strokeWidth={1} />
          <text x={GUTTER_TEXT_X} y={yFor(tick) + 4} textAnchor="end" fontSize={TICK_FONT} fill="var(--color-text-muted)">
            {tick}
          </text>
        </g>
      ))}
      <GutterLabel y={F2_AXIS_BOTTOM_Y + 14}>miss in points</GutterLabel>

      {F2_EXAMPLE_MISSES.map((miss, index) => (
        <circle
          key={index}
          cx={xFor(index)}
          cy={yFor(miss)}
          r={5}
          fill="var(--color-text-primary)"
          fillOpacity={weights[index] as number}
        />
      ))}

      <text x={PLOT_LEFT + 4} y={28} fontSize={LABEL_FONT} fill="var(--color-text-muted)">
        scored more than predicted
      </text>
      <text x={PLOT_LEFT + 4} y={F2_ZERO_Y + 20} fontSize={LABEL_FONT} fill="var(--color-text-muted)">
        scored less than predicted
      </text>
      <text x={PLOT_RIGHT - 4} y={bandTopY - 12} textAnchor="end" fontSize={ANNOTATION_FONT} fill="var(--color-text-primary)">
        the shaded band is Sigma
      </text>

      <line x1={PLOT_LEFT + 26} y1={meanY} x2={PLOT_LEFT + 26} y2={F2_ZERO_Y} stroke="var(--color-text-primary)" strokeWidth={1} />
      <line x1={PLOT_LEFT + 20} y1={meanY} x2={PLOT_LEFT + 32} y2={meanY} stroke="var(--color-text-primary)" strokeWidth={1} />
      <line x1={PLOT_LEFT + 20} y1={F2_ZERO_Y} x2={PLOT_LEFT + 32} y2={F2_ZERO_Y} stroke="var(--color-text-primary)" strokeWidth={1} />
      <text x={PLOT_LEFT + 46} y={F2_ZERO_Y - 10} fontSize={ANNOTATION_FONT} fill="var(--color-text-primary)">
        {"this gap is the model's steady bias, not the robot's swing"}
      </text>

      <text x={xFor(0)} y={F2_ZERO_Y + 44} textAnchor="middle" fontSize={TICK_FONT} fill="var(--color-text-muted)">
        oldest match
      </text>
      <text x={xFor(lastIndex)} y={F2_ZERO_Y + 44} textAnchor="middle" fontSize={TICK_FONT} fill="var(--color-text-muted)">
        newest match
      </text>
    </Figure>
  );
}

/* ------------------------------------------------------------------ */
/* F2b — evidence moves the reading off the prior                      */
/* ------------------------------------------------------------------ */

/**
 * The figure that carries SIGMA'S DISTINCTIVE IDEA, and the one with no
 * equivalent on the page this replaced.
 *
 * Three example teams, identical in every way except how many matches they have
 * played. Each row is a track running from the PRIOR (what robots of this
 * strength usually do) on the left to that team's OWN measured spread on the
 * right. The published Sigma sits on that track, and more matches slide it
 * further toward its own evidence.
 *
 * Every drawn position is a real `SigmaScoreAccumulator` reading, not a sketch
 * of one: each row folds its own miss list and asks the shipped accumulator
 * where it landed. A hand-drawn approximation here would be the exact drift the
 * rest of this page's figures were built to avoid.
 *
 * The three rows deliberately share ONE miss pattern, repeated, so the only
 * thing differing between them is the COUNT. If the rows also differed in how
 * erratic they were, the figure would be showing two effects at once and
 * demonstrating neither.
 */
const F2B_PATTERN = [14, -12, 15, -13, 12, -14, 13, -15, 14, -12, 15, -13, 12, -14, 13, -15, 14, -12, 15, -13];
const F2B_MATCH_COUNTS = [2, 6, 20];
const F2B_TALENT = 40;
const F2B_H = 216;
const F2B_ROW_Y = [58, 112, 166];
const F2B_TRACK_PAD = 46;

function EvidenceFigure(): ReactElement {
  // The left anchor: the prior alone, before this team has played anything.
  const priorOnly = new SigmaScoreAccumulator();
  priorOnly.observeTalent("frcFresh", F2B_TALENT);
  const priorValue = priorOnly.sigmaFor("frcFresh");

  const rows = F2B_MATCH_COUNTS.map((count) => ({
    count,
    sigma: illustrativeSigma(F2B_PATTERN.slice(0, count), F2B_TALENT),
  }));

  // The right anchor: the widest reading any row reached, so the track spans
  // the whole journey the figure is about.
  const ownEvidence = Math.max(...rows.map((row) => row.sigma));
  const lo = Math.min(priorValue, ...rows.map((row) => row.sigma));
  const hi = Math.max(priorValue, ownEvidence);
  const span = hi - lo || 1;

  const trackLeft = PLOT_LEFT + F2B_TRACK_PAD;
  const trackRight = PLOT_RIGHT - F2B_TRACK_PAD;
  const xFor = (value: number) => trackLeft + ((value - lo) / span) * (trackRight - trackLeft);

  return (
    <Figure figureId="evidence" height={F2B_H}>
      <text x={trackLeft} y={26} textAnchor="middle" fontSize={LABEL_FONT} fill="var(--color-text-muted)">
        what similar robots do
      </text>
      <text x={trackRight} y={26} textAnchor="middle" fontSize={LABEL_FONT} fill="var(--color-text-muted)">
        what this robot showed
      </text>
      {rows.map((row, index) => {
        const y = F2B_ROW_Y[index] as number;
        return (
          <g key={row.count}>
            <GutterLabel y={y - 4}>{`${row.count} matches played`}</GutterLabel>
            <line
              x1={trackLeft}
              y1={y}
              x2={trackRight}
              y2={y}
              stroke="var(--color-border-subtle)"
              strokeWidth={2}
              strokeLinecap="round"
            />
            <circle cx={xFor(row.sigma)} cy={y} r={7} fill="var(--color-text-primary)" />
            <text
              x={xFor(row.sigma)}
              y={y - 14}
              textAnchor="middle"
              fontSize={ANNOTATION_FONT}
              fill="var(--color-text-primary)"
            >
              {row.sigma.toFixed(2)}
            </text>
          </g>
        );
      })}
    </Figure>
  );
}

/* ------------------------------------------------------------------ */
/* F3 — same rating, different swing                                   */
/* ------------------------------------------------------------------ */

/** Two example teams. Both arrays are drawn AND labelled from the same call. */
const F3_STEADY_MISSES = [19, 20, 21, 20, 19, 20, 21, 20, 19, 20];
const F3_SWINGY_MISSES = [6, 31, 14, 27, 9, 29, 12, 25, 17, 22];
const F3_EXAMPLE_TOTAL = "42.00";
const F3_MISS_MAX = 40;
const F3_H = 250;
const F3_STEADY_ROW_Y = 64;
const F3_SWINGY_ROW_Y = 158;
const F3_ROW_JITTER = 7;
const F3_AXIS_Y = 200;

function SameRatingRow({
  rowY,
  misses,
  teamLabel,
  xFor,
}: {
  rowY: number;
  misses: readonly number[];
  teamLabel: string;
  xFor: (miss: number) => number;
}) {
  // The label and the marks come from ONE call, so they cannot disagree.
  const swing = illustrativeSigma(misses);
  return (
    <g>
      <GutterLabel y={rowY - 10}>{teamLabel}</GutterLabel>
      <GutterLabel y={rowY + 4}>{`Total ${F3_EXAMPLE_TOTAL}`}</GutterLabel>
      <text x={GUTTER_TEXT_X} y={rowY + 20} textAnchor="end" fontSize={ANNOTATION_FONT} fill="var(--color-text-primary)">
        {`Sigma ${swing.toFixed(2)}`}
      </text>
      {misses.map((miss, index) => (
        <circle
          key={index}
          cx={xFor(miss)}
          cy={rowY + ((index % 3) - 1) * F3_ROW_JITTER}
          r={5}
          fill="var(--color-text-primary)"
          fillOpacity={0.65}
        />
      ))}
    </g>
  );
}

function SameRatingFigure(): ReactElement {
  const xFor = (miss: number) => PLOT_LEFT + (miss / F3_MISS_MAX) * FIGURE_PLOT_W;
  return (
    <Figure figureId="same-rating" height={F3_H}>
      <SameRatingRow rowY={F3_STEADY_ROW_Y} misses={F3_STEADY_MISSES} teamLabel="steady team" xFor={xFor} />
      <SameRatingRow rowY={F3_SWINGY_ROW_Y} misses={F3_SWINGY_MISSES} teamLabel="swingy team" xFor={xFor} />
      <ValueAxis
        y={F3_AXIS_Y}
        ticks={[0, 10, 20, 30, 40]}
        xFor={xFor}
        name="how far off the prediction was, in points"
      />
    </Figure>
  );
}

/* ------------------------------------------------------------------ */
/* F4 — squares add                                                    */
/* ------------------------------------------------------------------ */

const F4_ROBOT_SWING = 10;
const F4_ROSTER = ["robot one", "robot two", "robot three"] as const;
const F4_SWING_MAX = 36;
const F4_H = 246;
const F4_BAR_H = 12;
const F4_COMBINED_BAR_H = 16;
const F4_ROBOT_ROW_Y = [36, 62, 88];
const F4_COMBINED_Y = 124;
const F4_WRONG_Y = 158;
const F4_AXIS_Y = 196;

function SquaresAddFigure(): ReactElement {
  // The combined width is the SHIPPING function's answer. ±17.32 is measured
  // here, not typed here.
  const swingByTeam = new Map<string, number>(F4_ROSTER.map((key) => [key, F4_ROBOT_SWING]));
  const combined = Math.sqrt(allianceSwingBandVariance([...F4_ROSTER], swingByTeam) ?? 0);
  const naive = F4_ROBOT_SWING * F4_ROSTER.length;
  const xFor = (swing: number) => PLOT_LEFT + (swing / F4_SWING_MAX) * FIGURE_PLOT_W;
  const lengthOf = (swing: number) => xFor(swing) - PLOT_LEFT;

  return (
    <Figure figureId="squares-add" height={F4_H}>
      {F4_ROSTER.map((label, index) => {
        const barY = F4_ROBOT_ROW_Y[index] as number;
        return (
          <g key={label}>
            <GutterLabel y={barY + F4_BAR_H / 2 + 4}>{label}</GutterLabel>
            <rect
              x={PLOT_LEFT}
              y={barY}
              width={lengthOf(F4_ROBOT_SWING)}
              height={F4_BAR_H}
              rx={2}
              fill="var(--color-text-primary)"
              fillOpacity={0.5}
            />
            <text
              x={xFor(F4_ROBOT_SWING) + 8}
              y={barY + F4_BAR_H / 2 + 4}
              fontSize={ANNOTATION_FONT}
              fill="var(--color-text-primary)"
            >
              {`±${F4_ROBOT_SWING}`}
            </text>
          </g>
        );
      })}

      <GutterLabel y={F4_COMBINED_Y + F4_COMBINED_BAR_H / 2 + 4}>all three together</GutterLabel>
      <rect
        x={PLOT_LEFT}
        y={F4_COMBINED_Y}
        width={lengthOf(combined)}
        height={F4_COMBINED_BAR_H}
        rx={3}
        fill="var(--alliance-red-soft)"
        stroke="var(--alliance-red)"
        strokeWidth={1.5}
      />
      <text
        x={xFor(combined) + 8}
        y={F4_COMBINED_Y + F4_COMBINED_BAR_H / 2 + 4}
        fontSize={12}
        fontWeight={600}
        fill="var(--color-text-primary)"
      >
        {`±${combined.toFixed(2)}`}
      </text>

      <GutterLabel y={F4_WRONG_Y + F4_COMBINED_BAR_H / 2 + 4}>adding them straight up</GutterLabel>
      <rect
        x={PLOT_LEFT}
        y={F4_WRONG_Y}
        width={lengthOf(naive)}
        height={F4_COMBINED_BAR_H}
        rx={3}
        fill="var(--loser-ink)"
        fillOpacity={0.35}
        stroke="var(--loser-ink)"
        strokeWidth={1}
      />
      <text
        x={xFor(naive) - 8}
        y={F4_WRONG_Y + F4_COMBINED_BAR_H / 2 + 4}
        textAnchor="end"
        fontSize={ANNOTATION_FONT}
        fill="var(--color-text-primary)"
      >
        {`±${naive}, the wrong answer`}
      </text>

      <ValueAxis y={F4_AXIS_Y} ticks={[0, 12, 24, 36]} xFor={xFor} name="swing in points" />
    </Figure>
  );
}

/* ------------------------------------------------------------------ */
/* F5 — reading the match band                                         */
/* ------------------------------------------------------------------ */

interface ExampleMatch {
  readonly redPredicted: number;
  readonly redSpread: number;
  readonly bluePredicted: number;
  readonly blueSpread: number;
  readonly reading: string;
}

/** Three example matches, from heavy overlap to clean separation. */
const F5_EXAMPLE_MATCHES: readonly ExampleMatch[] = [
  { redPredicted: 150, redSpread: 18, bluePredicted: 154, blueSpread: 20, reading: "close to a coin flip" },
  { redPredicted: 140, redSpread: 15, bluePredicted: 165, blueSpread: 16, reading: "a slight favourite" },
  { redPredicted: 120, redSpread: 12, bluePredicted: 190, blueSpread: 14, reading: "a strong favourite" },
];
const F5_TOP = 18;
/**
 * `chart-craft.md`'s "grouping is proximity" finding: two marks in the same
 * row must be markedly closer to each other than to the neighbouring row, or
 * a reader pairs them wrongly. The two alliance band centres are 22px apart
 * (that spacing is `MATCH_GEOMETRY`'s, locked so each band shares a baseline
 * with its own roster text in the shipped table). 26px of gap puts the rows
 * 64px apart, a ratio of about 2.9, which beats the shipped table's own ~2.1
 * because this figure has no roster text to align against and can afford the
 * room. The zebra tint on alternate rows reinforces the block on top of that.
 */
const F5_ROW_GAP = 26;
const F5_AXIS_Y = 264;
const F5_H = 312;

function MatchBandFigure(): ReactElement {
  const extents = F5_EXAMPLE_MATCHES.flatMap((match) => [
    match.redPredicted - match.redSpread,
    match.redPredicted + match.redSpread,
    match.bluePredicted - match.blueSpread,
    match.bluePredicted + match.blueSpread,
  ]);
  const domain = padAxisDomain(Math.min(...extents), Math.max(...extents));
  const xFor = (value: number) => PLOT_LEFT + scaleToPlot(value, domain, FIGURE_PLOT_W);
  // Both alliances' marks derive from `allianceMarkPositions`, the same single
  // computed source the shipped match table uses.
  const red = allianceMarkPositions(MATCH_GEOMETRY.Y_RED);
  const blue = allianceMarkPositions(MATCH_GEOMETRY.Y_BLUE);

  return (
    <Figure figureId="match-band" height={F5_H}>
      {F5_EXAMPLE_MATCHES.map((match, index) => {
        const rowTop = F5_TOP + index * (MATCH_GEOMETRY.PLOT_H + F5_ROW_GAP);
        const alliances = [
          { marks: red, predicted: match.redPredicted, spread: match.redSpread, soft: "var(--alliance-red-soft)", ink: "var(--alliance-red)" },
          { marks: blue, predicted: match.bluePredicted, spread: match.blueSpread, soft: "var(--alliance-blue-soft)", ink: "var(--alliance-blue)" },
        ];
        return (
          <g key={match.reading}>
            {index % 2 === 0 && (
              <rect
                x={0}
                y={rowTop - 6}
                width={FIGURE_W}
                height={MATCH_GEOMETRY.PLOT_H + 4}
                fill="var(--color-border)"
                fillOpacity={0.35}
              />
            )}
            <GutterLabel y={rowTop + (red.centre + blue.centre) / 2 + 4}>{match.reading}</GutterLabel>
            {alliances.map((alliance) => (
              <g key={alliance.ink}>
                <rect
                  x={xFor(alliance.predicted - alliance.spread)}
                  y={rowTop + alliance.marks.bandTop}
                  width={xFor(alliance.predicted + alliance.spread) - xFor(alliance.predicted - alliance.spread)}
                  height={MATCH_GEOMETRY.BAND_H}
                  rx={4}
                  fill={alliance.soft}
                />
                <rect
                  x={xFor(alliance.predicted) - 1.5}
                  y={rowTop + alliance.marks.tickTop}
                  width={3}
                  height={MATCH_GEOMETRY.TICK_H}
                  fill={alliance.ink}
                />
              </g>
            ))}
          </g>
        );
      })}
      <ValueAxis y={F5_AXIS_Y} ticks={axisTicks(domain)} xFor={xFor} name="predicted score" />
    </Figure>
  );
}

/**
 * Keyed by figure id so `tsc` fails loudly if a sixth figure is added to
 * `SIGMA_FIGURE_IDS` without a renderer, rather than the page silently
 * dropping it.
 */
const FIGURE_RENDERERS: Record<SigmaFigureId, () => ReactElement> = {
  "even-split": EvenSplitFigure,
  "level-and-swing": LevelAndSwingFigure,
  evidence: EvidenceFigure,
  "same-rating": SameRatingFigure,
  "squares-add": SquaresAddFigure,
  "match-band": MatchBandFigure,
};

export function SigmaPage() {
  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      <p className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">{SIGMA_LEAD}</p>
      {SIGMA_SECTIONS.map((section) => {
        const DrawFigure = section.figureId === undefined ? undefined : FIGURE_RENDERERS[section.figureId];
        return (
          <section key={section.id} id={section.id} className="flex flex-col gap-[var(--spacing-xs)]">
            <h2 className="text-role-heading text-[var(--color-text-primary)]">{section.heading}</h2>
            {section.paragraphs.map((paragraph, index) => (
              <p key={index} className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">
                {paragraph}
              </p>
            ))}
            {DrawFigure !== undefined && <DrawFigure />}
          </section>
        );
      })}
    </div>
  );
}
