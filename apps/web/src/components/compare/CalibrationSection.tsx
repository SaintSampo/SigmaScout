/**
 * The Compare page's Calibration section — sketch 006 variant C's TRUE form
 * (2026-09-01 rebuild, user correction of 08-10): per-algorithm
 * PLAIN-LANGUAGE CARDS. Each published algorithm gets one card carrying a
 * headline sentence anchored at the ~70% confidence bin, a bin-by-bin list
 * of readable rows ("predicted 74% → actual 71%", sample counts, sparse
 * tags, empties named rather than hidden), and a small deviation-bars
 * chart as supporting evidence — plain inline SVG, no Recharts, no lazy
 * chunk. What 08-10 shipped (one sentence over a demoted three-series
 * reliability diagram with a clickable legend) was a different reading of
 * "C" and is replaced wholesale; `CalibrationChart.tsx` is deleted with it.
 *
 * Still true from the original section contract:
 *  - a LOCAL year `Select` (the Compare page's documented NAV-02 exception),
 *    defaulting to the most recent season;
 *  - 08-06's single `compLevelView` state consumed as a prop, never
 *    re-declared here;
 *  - every rendered number derives from the fetched artifacts at run time
 *    (D-10 discipline) via `calibrationCards.ts`;
 *  - series colour only ever through `var(--compare-algo-*)` tokens
 *    (`comparePalette.test.ts` enforces the no-raw-hex rule file-wide).
 */
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMPARE_SEASONS, type CompareCompLevelView } from "../../lib/api/compare.js";
import { algorithmDisplayLabel } from "../ribbon/AlgorithmSelect.js";
import { buildCalibrationCard, cardHeadlineSentence, fmtPct, niceCeil, SPARSE_N, type CalibrationCardModel } from "./calibrationCards.js";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

export const CALIBRATION_SECTION_TESTID = "compare-calibration-section";
export const CALIBRATION_YEAR_SELECT_TESTID = "compare-calibration-year-select";
export const calibrationCardTestId = (algorithmId: string) => `compare-calibration-card-${algorithmId}`;
export const calibrationCardSentenceTestId = (algorithmId: string) => `compare-calibration-sentence-${algorithmId}`;

/** Defaults to the most recent year, per the Copywriting Contract's year-selector row. */
export const DEFAULT_CALIBRATION_YEAR = 2026;

/** The sketch's empty-bin sentence, verbatim. */
export const CALIBRATION_EMPTY_RANGE_TEXT = "No matches landed in this confidence range.";
/** The sketch's sparse tag, verbatim. */
export const CALIBRATION_SPARSE_TAG = "small sample";

/**
 * The Copywriting Contract's concept explainer, with Decision 2's ONE
 * correction: the UI-SPEC's own row has the diagonal orientation inverted.
 * Its own worked case — OPR predicted 85.3%, observed 52.8% — plots BELOW
 * the diagonal (observed < predicted) and that same document calls it "a
 * 32.5pp overconfidence gap," so BELOW must be the more-confident clause and
 * ABOVE must be the too-cautious one. Every other word is the approved copy,
 * unchanged. (The variant-C cards state each bin in words, so the "line"
 * imagery here maps to each card's deviation bars: below zero = more
 * confident than reality, above zero = too cautious.)
 */
export const CALIBRATION_EXPLAINER =
  "These cards show how well each algorithm's confidence matches reality. Predictions are grouped by how confident the model was (for example, '70% sure Red wins'), then checked against how often Red actually won in that group. A bar below the zero line means the algorithm was more confident than it should have been; a bar above means it was too cautious.";

export interface CalibrationSectionProps {
  readonly artifactsByYear: ReadonlyMap<number, CompareArtifact>;
  /** 08-06's single compLevelView state, read here as a prop — declared nowhere in this file as its own state. */
  readonly compLevelView: CompareCompLevelView;
}

const MINI_W = 260;
const MINI_H = 88;
const MINI_MARGIN = { left: 8, right: 8, top: 8, bottom: 6 };

/** The sketch's mini deviation chart: one bar per valid bin at its nominal midpoint, from the zero line, sharing scale `d` across all three cards. */
function MiniDeviationChart({ card, algorithmId, d }: { card: CalibrationCardModel; algorithmId: PublishedAlgorithmId; d: number }) {
  const x0 = MINI_MARGIN.left;
  const x1 = MINI_W - MINI_MARGIN.right;
  const yZero = MINI_H / 2;
  const yScale = (MINI_H / 2 - MINI_MARGIN.top) / d;
  const slotW = (x1 - x0) / 10;
  const barW = slotW * 0.62;

  return (
    <svg
      viewBox={`0 0 ${MINI_W} ${MINI_H}`}
      style={{ width: "100%", maxWidth: MINI_W, height: "auto", display: "block" }}
      role="img"
      aria-label={`${algorithmDisplayLabel(algorithmId)} calibration deviation by confidence bin`}
    >
      <line x1={x0} y1={yZero} x2={x1} y2={yZero} stroke="var(--color-text-muted)" strokeWidth={1} strokeDasharray="3 3" />
      {card.rows.map((row, i) => {
        if (row.point === null) return null;
        const deviation = row.point.observedFrequency - row.point.meanPredicted;
        const cx = x0 + slotW * i + slotW / 2;
        const h = Math.abs(deviation) * yScale;
        const y = deviation >= 0 ? yZero - h : yZero;
        return (
          <rect
            key={row.rangeLabel}
            x={cx - barW / 2}
            y={y}
            width={barW}
            height={Math.max(h, 0.5)}
            fill={`var(--compare-algo-${algorithmId})`}
            fillOpacity={row.point.count < SPARSE_N ? 0.45 : 0.9}
          >
            <title>{`${row.rangeLabel}: predicted ${fmtPct(row.point.meanPredicted, 1)}%, actual ${fmtPct(row.point.observedFrequency, 1)}% (${row.point.count.toLocaleString("en-US")} matches)`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function SparseTag() {
  // Deliberately NEUTRAL — never a tier token: `comparePalette.test.ts`
  // enforces that the tier vocabulary and the compare-algo trio are kept off
  // one rendered surface (the EPA violet / epic purple collision).
  return (
    <span className="rounded-[4px] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-[6px] text-role-label text-[var(--color-text-muted)]">
      {CALIBRATION_SPARSE_TAG}
    </span>
  );
}

function CalibrationCard({ algorithmId, card, d }: { algorithmId: PublishedAlgorithmId; card: CalibrationCardModel; d: number }) {
  const label = algorithmDisplayLabel(algorithmId);
  return (
    <div data-testid={calibrationCardTestId(algorithmId)} className="event-card flex min-w-0 flex-col gap-[var(--spacing-sm)] p-[var(--spacing-md)] shadow-sm">
      <div className="flex items-center gap-[var(--spacing-xs)]">
        <span aria-hidden="true" className="inline-block size-[10px] rounded-full" style={{ background: `var(--compare-algo-${algorithmId})` }} />
        <span className="text-role-label font-semibold text-[var(--color-text-primary)]">{label}</span>
      </div>
      <p data-testid={calibrationCardSentenceTestId(algorithmId)} className="text-role-body text-[var(--color-text-primary)]">
        {card.headline === null ? (
          "No usable bins in this view."
        ) : (
          <>
            {cardHeadlineSentence(label, card.headline)}
            {card.headline.count < SPARSE_N && (
              <>
                {" "}
                <SparseTag />
              </>
            )}
          </>
        )}
      </p>
      <MiniDeviationChart card={card} algorithmId={algorithmId} d={d} />
      <div className="flex flex-col">
        {card.rows.map((row) => (
          <div key={row.rangeLabel} className="flex items-baseline gap-[var(--spacing-sm)] border-t border-[var(--color-border)] py-[3px] text-role-label">
            <span className="numeric-cell w-[52px] shrink-0 text-[var(--color-text-muted)]">{row.rangeLabel}</span>
            {row.point === null ? (
              <span className="min-w-0 flex-1 text-[var(--color-text-muted)]">{CALIBRATION_EMPTY_RANGE_TEXT}</span>
            ) : (
              <>
                <span className="min-w-0 flex-1 text-[var(--color-text-primary)]">
                  {"predicted "}
                  <b className="numeric-cell">{`${fmtPct(row.point.meanPredicted, 1)}%`}</b>
                  {" → actual "}
                  <b className="numeric-cell">{`${fmtPct(row.point.observedFrequency, 1)}%`}</b>
                </span>
                <span className="numeric-cell flex shrink-0 items-baseline gap-[var(--spacing-xs)] text-[var(--color-text-muted)]">
                  {row.point.count.toLocaleString("en-US")}
                  {row.point.count < SPARSE_N && <SparseTag />}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalibrationSection({ artifactsByYear, compLevelView }: CalibrationSectionProps) {
  const [year, setYear] = useState<number>(DEFAULT_CALIBRATION_YEAR);
  const artifact = artifactsByYear.get(year);

  const cards = PUBLISHED_ALGORITHM_IDS.map((algorithmId) => {
    const slice = artifact?.slices.find((s) => s.algorithmId === algorithmId && s.season === year && s.compLevelView === compLevelView);
    return { algorithmId, card: buildCalibrationCard(slice ?? { calibrationBins: [] }) };
  });
  // The sketch's shared scale: one `d` across all three cards so a bar's
  // height means the same thing card to card.
  const d = niceCeil(
    cards.reduce((m, c) => Math.max(m, c.card.maxAbsDeviation), 0),
    0.05,
  );

  return (
    <div data-testid={CALIBRATION_SECTION_TESTID} className="mt-[var(--spacing-xl)]">
      <div className="mb-[var(--spacing-sm)] flex flex-wrap items-center justify-between gap-[var(--spacing-sm)]">
        <h2 className="text-role-heading text-[var(--color-text-primary)]">Calibration</h2>
        <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
          <SelectTrigger data-testid={CALIBRATION_YEAR_SELECT_TESTID} aria-label="Year" className="tap-target w-[5.5rem]">
            <SelectValue>{year}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {COMPARE_SEASONS.map((season) => (
              <SelectItem key={season} value={String(season)}>
                {season}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="mb-[var(--spacing-md)] max-w-[72ch] text-role-body text-[var(--color-text-muted)]">{CALIBRATION_EXPLAINER}</p>
      <div className="grid gap-[var(--spacing-md)] md:grid-cols-3">
        {cards.map(({ algorithmId, card }) => (
          <CalibrationCard key={algorithmId} algorithmId={algorithmId} card={card} d={d} />
        ))}
      </div>
    </div>
  );
}
