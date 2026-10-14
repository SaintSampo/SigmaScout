import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ALLIANCE_PICKS_LEAD,
  CALIBRATION_FIXED_ORDER,
  CALIBRATION_LABELS,
  CALIBRATION_WEIGHTED_DRAFT,
  calibrationRow,
  calibrationTooltip,
  formatChance,
  HOW_IT_SCORES_SECTION,
  PICK_CHART_LABELS,
  PICK_ROUND_LABELS,
  PICK_TABLE_CAPTION,
  PICK_TABLE_SECTION,
  pickBarTooltip,
  pickChances,
  pickCounts,
  RESULTS_TABLE,
  SAID_VERSUS_HAPPENED_SUBSECTION,
  TEAMS_LEFT_DEFAULT,
  TEAMS_LEFT_MAX,
  TEAMS_LEFT_MIN,
  WHAT_IT_LEAVES_OUT_SECTION,
  type CalibrationPoint,
  type PickRound,
} from "./alliancePicksContent.js";

/**
 * The body of `/methodology/alliance-picks` (quick task 261014-ol7). Every
 * word, label and figure comes from `alliancePicksContent.ts`; the pick table
 * chart reads `PICK_POSITION_COUNTS` through it, so the page cannot drift from
 * the shipped table.
 *
 * Charts are hand drawn SVG on the site's own tokens, sized in real pixels
 * from the measured container width (the `TeamsBubbleChart.tsx` pattern), so
 * axis text stays 12px on a phone instead of shrinking with a viewBox. The site
 * has one (light) theme, so the tokens carry it.
 *
 * Colour: nothing in either chart is clickable, so neither uses the accent.
 * The pick bars are the Simulation tab's neutral histogram treatment. The two
 * calibration series are told apart by SHAPE first (a hollow ring against a
 * filled dot) and by ink second, never by hue alone.
 */

const PARAGRAPH_CLASS = "max-w-[72ch] text-role-body text-[var(--color-text-primary)]";
const PANEL_CLASS = "event-card flex min-w-0 flex-col gap-[var(--spacing-sm)] p-[var(--spacing-md)]";
const CAPTION_CLASS = "max-w-[72ch] text-role-label text-[var(--color-text-muted)]";
const AXIS_TEXT = { fontSize: 12, fill: "var(--color-text-muted)" } as const;

/** Measures the container's real width; jsdom measures 0, so the fallback keeps tests drawing a real chart. */
function useMeasuredWidth(fallback: number): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const measure = (): void => {
      const measured = ref.current?.getBoundingClientRect().width ?? 0;
      setWidth(measured > 0 ? Math.round(measured) : fallback);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fallback]);
  return [ref, width];
}

interface TooltipState {
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

/**
 * A pointer only duplicate of a table row, so `aria-hidden` (the table view is
 * the accessible copy). It hangs off the left of its anchor on the left half
 * of the chart and off the right on the right half, so it never runs out of
 * the panel without measuring itself.
 */
function ChartTooltip({ tip, width }: { tip: TooltipState | null; width: number }) {
  if (tip === null) return null;
  const leftHalf = tip.x < width / 2;
  return (
    <div
      aria-hidden="true"
      data-testid="alliance-picks-tooltip"
      style={{
        left: tip.x,
        top: tip.y,
        transform: `translate(${leftHalf ? "-12px" : "calc(-100% + 12px)"}, calc(-100% - 8px))`,
      }}
      className="pointer-events-none absolute w-max max-w-[16rem] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-[var(--spacing-sm)] py-[var(--spacing-xs)] text-role-label text-[var(--color-text-primary)] shadow-sm"
    >
      {tip.text}
    </div>
  );
}

function SmallTable({ head, rows, testId }: { head: readonly string[]; rows: readonly (readonly string[])[]; testId: string }) {
  return (
    <div className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
      <table data-slot="table" data-testid={testId} className="zebra-rows w-auto text-sm">
        <TableHeader>
          <TableRow>
            {head.map((cell) => (
              <TableHead key={cell} className="text-role-label">
                {cell}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, r) => (
            <TableRow key={r}>
              {row.map((cell, index) => (
                <TableCell key={index} className={index > 0 && /\d/.test(cell) ? "numeric-cell" : "whitespace-normal"}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  );
}

/** Same disclosure for both charts: the accessible table view, closed by default. */
function TableView({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="text-role-body">
      <summary className="cursor-pointer text-role-label text-[var(--color-text-muted)]">{label}</summary>
      <div className="pt-[var(--spacing-sm)]">{children}</div>
    </details>
  );
}

/** A bar with rounded top corners only, so it sits flat on the baseline. */
function topRoundedBar(x: number, y: number, w: number, h: number, radius: number): string {
  if (h <= 0) return "";
  const r = Math.min(radius, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// ---------------------------------------------------------------------------
// The pick table chart
// ---------------------------------------------------------------------------

const PICK_CHART_HEIGHT = 240;
const PICK_MARGIN = { left: 40, right: 8, top: 12, bottom: 40 } as const;
/** Smallest gap between two x axis labels, in pixels. */
const PICK_LABEL_GAP = 22;

export function PickTableChart() {
  const [round, setRound] = useState<PickRound>("first");
  const [teamsLeft, setTeamsLeft] = useState(TEAMS_LEFT_DEFAULT);
  const [hovered, setHovered] = useState<number | null>(null);
  const [ref, width] = useMeasuredWidth(720);

  const chances = pickChances(pickCounts(round), teamsLeft);
  const bestThree = chances.slice(0, 3).reduce((total, value) => total + value, 0);

  const plotW = width - PICK_MARGIN.left - PICK_MARGIN.right;
  const plotH = PICK_CHART_HEIGHT - PICK_MARGIN.top - PICK_MARGIN.bottom;
  const baseline = PICK_MARGIN.top + plotH;
  const topPercent = Math.max(10, Math.ceil((Math.max(...chances) * 100) / 10) * 10);
  const gridSteps = Array.from({ length: topPercent / 10 + 1 }, (_, index) => index * 10);
  const step = plotW / teamsLeft;
  const barW = Math.max(2, step - 2);
  const labelEvery = [1, 2, 5, 10].find((every) => every * step >= PICK_LABEL_GAP) ?? 10;
  const yFor = (percent: number): number => baseline - (percent / topPercent) * plotH;

  const tip: TooltipState | null =
    hovered !== null && hovered < chances.length
      ? {
          x: PICK_MARGIN.left + hovered * step + step / 2,
          y: Math.min(yFor(chances[hovered]! * 100), baseline - 6),
          text: pickBarTooltip(hovered + 1, chances[hovered]!),
        }
      : null;

  return (
    <div className={`${PANEL_CLASS} max-w-[760px]`} data-testid="pick-table-chart">
      <div className="flex flex-wrap items-center gap-x-[var(--spacing-lg)] gap-y-[var(--spacing-sm)]">
        <div role="group" aria-label={PICK_CHART_LABELS.roundGroup} className="inline-flex gap-[var(--spacing-xs)]">
          {(["first", "second"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              variant={option === round ? "default" : "ghost"}
              aria-pressed={option === round}
              className="tap-target"
              onClick={() => setRound(option)}
            >
              {PICK_ROUND_LABELS[option]}
            </Button>
          ))}
        </div>
        <label className="flex min-w-[220px] flex-1 items-center gap-[var(--spacing-sm)] text-role-label text-[var(--color-text-muted)]">
          {PICK_CHART_LABELS.teamsLeft}
          <input
            type="range"
            min={TEAMS_LEFT_MIN}
            max={TEAMS_LEFT_MAX}
            step={1}
            value={teamsLeft}
            onChange={(event) => setTeamsLeft(Number(event.target.value))}
            className="min-w-0 flex-1 accent-[var(--color-accent)]"
          />
          <output data-testid="pick-table-teams-left" className="numeric-cell min-w-[2ch] text-right font-semibold text-[var(--color-text-primary)]">
            {teamsLeft}
          </output>
        </label>
      </div>

      <div className="flex flex-wrap gap-x-[var(--spacing-lg)] gap-y-[var(--spacing-xs)] text-role-label text-[var(--color-text-muted)]" data-testid="pick-table-stats">
        <span>
          <b className="numeric-cell mr-[var(--spacing-xs)] text-role-heading text-[var(--color-text-primary)]">{formatChance(chances[0] ?? 0)}</b>
          {PICK_CHART_LABELS.bestTeam}
        </span>
        <span>
          <b className="numeric-cell mr-[var(--spacing-xs)] text-role-heading text-[var(--color-text-primary)]">{formatChance(bestThree)}</b>
          {PICK_CHART_LABELS.bestThree}
        </span>
      </div>

      <div ref={ref} className="relative min-w-0" onPointerLeave={() => setHovered(null)}>
        <svg
          width={width}
          height={PICK_CHART_HEIGHT}
          viewBox={`0 0 ${width} ${PICK_CHART_HEIGHT}`}
          role="img"
          aria-label={`${PICK_ROUND_LABELS[round]} chance by place in line with ${teamsLeft} teams left`}
          className="block overflow-visible"
        >
          {gridSteps.map((percent) => (
            <g key={percent}>
              <line x1={PICK_MARGIN.left} x2={width - PICK_MARGIN.right} y1={yFor(percent)} y2={yFor(percent)} stroke="var(--color-border)" />
              <text x={PICK_MARGIN.left - 8} y={yFor(percent) + 4} textAnchor="end" {...AXIS_TEXT}>
                {`${percent}%`}
              </text>
            </g>
          ))}
          {chances.map((chance, index) => {
            const x = PICK_MARGIN.left + index * step + (step - barW) / 2;
            const h = ((chance * 100) / topPercent) * plotH;
            const showLabel = index === 0 || (index + 1) % labelEvery === 0;
            return (
              <g key={index}>
                <path
                  d={topRoundedBar(x, baseline - h, barW, h, 4)}
                  fill={hovered === index ? "var(--color-text-primary)" : "var(--color-text-muted)"}
                  fillOpacity={hovered === index ? 1 : 0.55}
                />
                {showLabel && (
                  <text x={x + barW / 2} y={baseline + 18} textAnchor="middle" {...AXIS_TEXT}>
                    {String(index + 1)}
                  </text>
                )}
                <rect
                  x={PICK_MARGIN.left + index * step}
                  y={PICK_MARGIN.top}
                  width={step}
                  height={plotH}
                  fill="transparent"
                  data-testid="pick-table-bar-hit"
                  onPointerEnter={() => setHovered(index)}
                />
              </g>
            );
          })}
          <line x1={PICK_MARGIN.left} x2={width - PICK_MARGIN.right} y1={baseline} y2={baseline} stroke="var(--color-text-muted)" />
          <text x={PICK_MARGIN.left + plotW / 2} y={PICK_CHART_HEIGHT - 4} textAnchor="middle" {...AXIS_TEXT}>
            {PICK_CHART_LABELS.xAxis}
          </text>
        </svg>
        <ChartTooltip tip={tip} width={width} />
      </div>

      <p className={CAPTION_CLASS}>{PICK_TABLE_CAPTION}</p>
      <TableView label={PICK_CHART_LABELS.showTable}>
        <SmallTable
          testId="pick-table-table"
          head={PICK_CHART_LABELS.tableHead}
          rows={chances.map((chance, index) => [String(index + 1), formatChance(chance)])}
        />
      </TableView>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The said versus happened chart
// ---------------------------------------------------------------------------

const CAL_MARGIN = { left: 56, right: 20, top: 16, bottom: 44 } as const;

/** Space kept between a note and the perfect line, in pixels. */
const NOTE_CLEARANCE = 8;

/** A safe overestimate of a 12px semibold note's width: no layout pass is needed to keep it off the line. */
function noteWidth(text: string): number {
  return text.length * 7;
}

interface AnnotationPlacement {
  readonly x: number;
  readonly y: number;
  readonly anchor: "start" | "end";
  readonly leader: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
}

interface CalibrationMark {
  readonly key: string;
  readonly model: string;
  readonly point: CalibrationPoint;
}

export function CalibrationChart() {
  const [hovered, setHovered] = useState<string | null>(null);
  const [ref, width] = useMeasuredWidth(560);
  const height = Math.round(Math.min(400, Math.max(280, width * 0.75)));
  const plotW = width - CAL_MARGIN.left - CAL_MARGIN.right;
  const plotH = height - CAL_MARGIN.top - CAL_MARGIN.bottom;
  const xFor = (percent: number): number => CAL_MARGIN.left + (percent / 100) * plotW;
  const yFor = (percent: number): number => CAL_MARGIN.top + plotH - (percent / 100) * plotH;
  const ticks = [0, 20, 40, 60, 80, 100];

  const marks: CalibrationMark[] = [
    ...CALIBRATION_WEIGHTED_DRAFT.map((point, index) => ({ key: `w${index}`, model: CALIBRATION_LABELS.weightedDraft, point })),
    ...CALIBRATION_FIXED_ORDER.map((point, index) => ({ key: `f${index}`, model: CALIBRATION_LABELS.fixedOrder, point })),
  ];
  const hoveredMark = marks.find((mark) => mark.key === hovered);
  const tip: TooltipState | null =
    hoveredMark === undefined
      ? null
      : { x: xFor(hoveredMark.point.said), y: yFor(hoveredMark.point.happened) - 8, text: calibrationTooltip(hoveredMark.model, hoveredMark.point) };

  const [fixedZero, fixedHundred] = CALIBRATION_FIXED_ORDER;
  // The two notes go in the empty triangles either side of the perfect line,
  // placed from where that line runs rather than at a fixed offset: on a phone
  // a fixed offset put both notes across the line and onto the filled points.
  // "1 in 5 picked" sits above the line, "1 in 10 not picked" below it, each
  // tied to its hollow point by a short leader.
  const diagonalY = (px: number): number => yFor(((px - CAL_MARGIN.left) / plotW) * 100);
  const zeroNote: AnnotationPlacement | null =
    fixedZero === undefined
      ? null
      : (() => {
          const cx = xFor(fixedZero.said);
          const cy = yFor(fixedZero.happened);
          const left = cx + 12;
          const right = left + noteWidth(CALIBRATION_LABELS.fixedZeroNote);
          const y = Math.min(cy - 14, diagonalY(right) - NOTE_CLEARANCE - 3);
          return { x: left, y, anchor: "start", leader: { x1: cx + 5, y1: cy - 5, x2: left - 2, y2: y - 4 } };
        })();
  const hundredNote: AnnotationPlacement | null =
    fixedHundred === undefined
      ? null
      : (() => {
          const cx = xFor(fixedHundred.said);
          const cy = yFor(fixedHundred.happened);
          const right = cx - 6;
          const left = right - noteWidth(CALIBRATION_LABELS.fixedHundredNote);
          const y = Math.max(cy + 26, diagonalY(left) + NOTE_CLEARANCE + 12);
          return { x: right, y, anchor: "end", leader: { x1: cx, y1: cy + 9, x2: cx, y2: y - 13 } };
        })();

  return (
    <div className={`${PANEL_CLASS} max-w-[600px]`} data-testid="calibration-chart">
      <div className="flex flex-wrap gap-x-[var(--spacing-lg)] gap-y-[var(--spacing-xs)] text-role-label text-[var(--color-text-muted)]">
        <span className="inline-flex items-center gap-[var(--spacing-xs)]">
          <span aria-hidden="true" className="inline-block size-[12px] rounded-full border-2 border-[var(--color-text-muted)] bg-[var(--color-bg-surface)]" />
          {CALIBRATION_LABELS.fixedOrder}
        </span>
        <span className="inline-flex items-center gap-[var(--spacing-xs)]">
          <span aria-hidden="true" className="inline-block size-[10px] rounded-full bg-[var(--color-text-primary)]" />
          {CALIBRATION_LABELS.weightedDraft}
        </span>
        <span className="inline-flex items-center gap-[var(--spacing-xs)]">
          <span aria-hidden="true" className="inline-block w-[18px] border-t-2 border-dashed border-[var(--color-text-muted)]" />
          {CALIBRATION_LABELS.perfect}
        </span>
      </div>

      <div ref={ref} className="relative min-w-0" onPointerLeave={() => setHovered(null)}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${CALIBRATION_LABELS.xAxis} against ${CALIBRATION_LABELS.yAxis.toLowerCase()}`}
          className="block overflow-visible"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={CAL_MARGIN.left} x2={width - CAL_MARGIN.right} y1={yFor(t)} y2={yFor(t)} stroke="var(--color-border)" />
              <line x1={xFor(t)} x2={xFor(t)} y1={CAL_MARGIN.top} y2={CAL_MARGIN.top + plotH} stroke="var(--color-border)" />
              <text x={CAL_MARGIN.left - 10} y={yFor(t) + 4} textAnchor="end" {...AXIS_TEXT}>
                {`${t}%`}
              </text>
              <text x={xFor(t)} y={CAL_MARGIN.top + plotH + 20} textAnchor="middle" {...AXIS_TEXT}>
                {`${t}%`}
              </text>
            </g>
          ))}
          <line
            x1={xFor(0)}
            y1={yFor(0)}
            x2={xFor(100)}
            y2={yFor(100)}
            stroke="var(--color-text-muted)"
            strokeOpacity={0.6}
            strokeWidth={2}
            strokeDasharray="5 5"
          />
          <text x={CAL_MARGIN.left + plotW / 2} y={height - 4} textAnchor="middle" {...AXIS_TEXT}>
            {CALIBRATION_LABELS.xAxis}
          </text>
          <text
            x={14}
            y={CAL_MARGIN.top + plotH / 2}
            textAnchor="middle"
            transform={`rotate(-90 14 ${CAL_MARGIN.top + plotH / 2})`}
            {...AXIS_TEXT}
          >
            {CALIBRATION_LABELS.yAxis}
          </text>

          {CALIBRATION_WEIGHTED_DRAFT.map((point, index) => (
            <circle
              key={`w${index}`}
              data-testid="calibration-weighted-point"
              cx={xFor(point.said)}
              cy={yFor(point.happened)}
              r={hovered === `w${index}` ? 6.5 : 5}
              fill="var(--color-text-primary)"
              stroke="var(--color-bg-surface)"
              strokeWidth={1.5}
            />
          ))}
          {CALIBRATION_FIXED_ORDER.map((point, index) => (
            <circle
              key={`f${index}`}
              data-testid="calibration-fixed-point"
              cx={xFor(point.said)}
              cy={yFor(point.happened)}
              r={hovered === `f${index}` ? 8.5 : 7}
              fill="var(--color-bg-surface)"
              stroke="var(--color-text-muted)"
              strokeWidth={2.5}
            />
          ))}
          {zeroNote !== null && (
            <g data-testid="calibration-note">
              <line {...zeroNote.leader} stroke="var(--color-text-muted)" strokeWidth={1} />
              <text x={zeroNote.x} y={zeroNote.y} textAnchor={zeroNote.anchor} fontSize={12} fontWeight={600} fill="var(--color-text-primary)">
                {CALIBRATION_LABELS.fixedZeroNote}
              </text>
            </g>
          )}
          {hundredNote !== null && (
            <g data-testid="calibration-note">
              <line {...hundredNote.leader} stroke="var(--color-text-muted)" strokeWidth={1} />
              <text x={hundredNote.x} y={hundredNote.y} textAnchor={hundredNote.anchor} fontSize={12} fontWeight={600} fill="var(--color-text-primary)">
                {CALIBRATION_LABELS.fixedHundredNote}
              </text>
            </g>
          )}
          {marks.map((mark) => (
            <circle
              key={`hit-${mark.key}`}
              cx={xFor(mark.point.said)}
              cy={yFor(mark.point.happened)}
              r={12}
              fill="transparent"
              data-testid="calibration-point-hit"
              onPointerEnter={() => setHovered(mark.key)}
            />
          ))}
        </svg>
        <ChartTooltip tip={tip} width={width} />
      </div>

      <TableView label={CALIBRATION_LABELS.showTable}>
        <SmallTable
          testId="calibration-table"
          head={CALIBRATION_LABELS.tableHead}
          rows={[
            ...CALIBRATION_FIXED_ORDER.map((point) => calibrationRow(CALIBRATION_LABELS.fixedOrder, point)),
            ...CALIBRATION_WEIGHTED_DRAFT.map((point) => calibrationRow(CALIBRATION_LABELS.weightedDraft, point)),
          ]}
        />
      </TableView>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function AlliancePicksPage() {
  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      <p className={PARAGRAPH_CLASS}>{ALLIANCE_PICKS_LEAD}</p>

      <section id={PICK_TABLE_SECTION.id} className="flex flex-col gap-[var(--spacing-sm)]">
        <h2 className="text-role-heading text-[var(--color-text-primary)]">{PICK_TABLE_SECTION.heading}</h2>
        {PICK_TABLE_SECTION.paragraphs.map((paragraph, index) => (
          <p key={index} className={PARAGRAPH_CLASS}>
            {paragraph}
          </p>
        ))}
        <PickTableChart />
      </section>

      <section id={HOW_IT_SCORES_SECTION.id} className="flex flex-col gap-[var(--spacing-sm)]">
        <h2 className="text-role-heading text-[var(--color-text-primary)]">{HOW_IT_SCORES_SECTION.heading}</h2>
        {HOW_IT_SCORES_SECTION.paragraphs.map((paragraph, index) => (
          <p key={index} className={PARAGRAPH_CLASS}>
            {paragraph}
          </p>
        ))}
        <div className="flex flex-col gap-[var(--spacing-xs)]">
          <SmallTable testId="alliance-picks-results" head={RESULTS_TABLE.head} rows={RESULTS_TABLE.rows} />
          <p className={CAPTION_CLASS}>{RESULTS_TABLE.caption}</p>
        </div>
        {HOW_IT_SCORES_SECTION.afterTable.map((paragraph, index) => (
          <p key={index} className={PARAGRAPH_CLASS}>
            {paragraph}
          </p>
        ))}

        <section id={SAID_VERSUS_HAPPENED_SUBSECTION.id} className="mt-[var(--spacing-sm)] flex flex-col gap-[var(--spacing-sm)]">
          <h3 className="text-role-body font-semibold text-[var(--color-text-primary)]">{SAID_VERSUS_HAPPENED_SUBSECTION.heading}</h3>
          {SAID_VERSUS_HAPPENED_SUBSECTION.paragraphs.map((paragraph, index) => (
            <p key={index} className={PARAGRAPH_CLASS}>
              {paragraph}
            </p>
          ))}
          <CalibrationChart />
        </section>
      </section>

      <section id={WHAT_IT_LEAVES_OUT_SECTION.id} className="flex flex-col gap-[var(--spacing-sm)]">
        <h2 className="text-role-heading text-[var(--color-text-primary)]">{WHAT_IT_LEAVES_OUT_SECTION.heading}</h2>
        <ul className="flex max-w-[72ch] list-disc flex-col gap-[var(--spacing-xs)] pl-[var(--spacing-lg)] text-role-body text-[var(--color-text-primary)]">
          {WHAT_IT_LEAVES_OUT_SECTION.items.map((item) => (
            <li key={item.label}>
              <span className="font-semibold">{item.label}</span> {item.detail}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
