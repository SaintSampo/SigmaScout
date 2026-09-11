/**
 * The Compare page's RP calibration section (F1, D-09, D-11) — one
 * plain-language card per published algorithm showing how often each
 * predicted bonus ranking point actually happened. Modelled on
 * `CalibrationSection.tsx`'s live card form: a headline sentence at full
 * ink, a per-bonus readable row list with counts and sparse tags, and a
 * small inline-SVG deviation-bars chart demoted beneath the sentence as
 * supporting evidence. Display form settled by
 * `.claude/skills/sketch-findings-sigmascout/references/simulation-and-compare.md`
 * — do not re-decide it.
 *
 * Takes `artifactsByYear` ONLY, deliberately NOT `compLevelView`: bonus
 * ranking points exist only in QUALIFICATION matches, so this section reads
 * the `qualification` slice unconditionally — the same pinning
 * `MethodologyNote` already applies to the combined view. Feeding it the
 * switcher would let a reader select a view with no data and read the empty
 * result as "no accuracy" instead of "not applicable."
 *
 * Colour only ever through `var(--compare-algo-*)` tokens
 * (`comparePalette.test.ts` enforces the no-raw-hex rule file-wide). Every
 * algorithm label comes from `algorithmDisplayLabel` at run time, never a
 * hardcoded string, so the in-flight BPR/SPR display rename cannot leave
 * this section behind.
 */
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMPARE_SEASONS } from "../../lib/api/compare.js";
import { algorithmDisplayLabel } from "../ribbon/AlgorithmSelect.js";
import { fmtPct, niceCeil } from "./calibrationCards.js";
import { buildRpCalibrationCard, rpCardHeadlineSentence, type RpCalibrationCardModel } from "./rpCalibrationCards.js";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

export const RP_CALIBRATION_SECTION_TESTID = "compare-rp-calibration-section";
export const RP_CALIBRATION_YEAR_SELECT_TESTID = "compare-rp-calibration-year-select";
export const rpCalibrationCardTestId = (algorithmId: string) => `compare-rp-calibration-card-${algorithmId}`;
export const rpCalibrationCardSentenceTestId = (algorithmId: string) => `compare-rp-calibration-sentence-${algorithmId}`;

/** Defaults to the most recent season, matching `CalibrationSection`'s `DEFAULT_CALIBRATION_YEAR` convention. */
export const DEFAULT_RP_CALIBRATION_YEAR = 2026;

/** Rendered — a sentence, never a zero — when a season/algorithm's slice carries no `rpCalibration` record: the artifact predates the field, or this season/algorithm has not been measured yet. */
export const RP_CALIBRATION_ABSENT_TEXT = "Bonus ranking point accuracy has not been measured for this artifact yet.";

/**
 * States the measured population in words (D-09's per-bonus framing): every
 * qualification match in the corpus, offseason events INCLUDED — unlike the
 * win-probability calibration above, which excludes them.
 *
 * D-04 PROVENANCE (added 2026-09-11, plan 09-06). The second sentence names
 * the seasons that informed the model's own family choice and states that the
 * headline comes from the seasons that did not. Without it a reader could take
 * a figure from a season the model was chosen on and read it as
 * out-of-sample — which is the one thing the two-slice split exists to
 * prevent. This is a COPY change to this existing constant: no component, no
 * card, no schema key and no test id moves with it.
 */
export const RP_CALIBRATION_EXPLAINER =
  "These cards show how often each predicted bonus ranking point actually happened, checked against every qualification match in the corpus — including offseason events, unlike the win-probability calibration above. " +
  "The 2016-2020 and 2022 seasons were used to choose the model, so the accuracy reported for 2023 onward is measured on seasons that had no say in that choice.";

export interface RpCalibrationSectionProps {
  readonly artifactsByYear: ReadonlyMap<number, CompareArtifact>;
}

const MINI_W = 260;
const MINI_H = 88;
const MINI_MARGIN = { left: 8, right: 8, top: 8, bottom: 6 };

/** One bar per bonus the card carries, from the zero line, sharing scale `d` across all three cards so a bar's height means the same thing card to card — same shape as `CalibrationSection.tsx`'s `MiniDeviationChart`. */
function MiniDeviationChart({ card, algorithmId, d }: { card: RpCalibrationCardModel; algorithmId: PublishedAlgorithmId; d: number }) {
  const x0 = MINI_MARGIN.left;
  const x1 = MINI_W - MINI_MARGIN.right;
  const yZero = MINI_H / 2;
  const yScale = (MINI_H / 2 - MINI_MARGIN.top) / d;
  const slotW = (x1 - x0) / Math.max(card.bonuses.length, 1);
  const barW = slotW * 0.62;

  return (
    <svg
      viewBox={`0 0 ${MINI_W} ${MINI_H}`}
      style={{ width: "100%", maxWidth: MINI_W, height: "auto", display: "block" }}
      role="img"
      aria-label={`${algorithmDisplayLabel(algorithmId)} ranking point deviation by bonus`}
    >
      <line x1={x0} y1={yZero} x2={x1} y2={yZero} stroke="var(--color-text-muted)" strokeWidth={1} strokeDasharray="3 3" />
      {card.bonuses.map((row, i) => {
        const deviation = row.observedFrequency - row.meanPredicted;
        const cx = x0 + slotW * i + slotW / 2;
        const h = Math.abs(deviation) * yScale;
        const y = deviation >= 0 ? yZero - h : yZero;
        return (
          <rect
            key={row.name}
            x={cx - barW / 2}
            y={y}
            width={barW}
            height={Math.max(h, 0.5)}
            fill={`var(--compare-algo-${algorithmId})`}
            fillOpacity={row.sparse ? 0.45 : 0.9}
          >
            <title>{`${row.name}: predicted ${fmtPct(row.meanPredicted, 1)}%, actual ${fmtPct(row.observedFrequency, 1)}% (${row.count.toLocaleString("en-US")} matches)`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function SparseTag() {
  // Deliberately NEUTRAL — never a tier token, matching CalibrationSection's
  // own SparseTag: `comparePalette.test.ts` enforces that the tier
  // vocabulary and the compare-algo trio are kept off one rendered surface.
  return (
    <span className="rounded-[4px] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-[6px] text-role-label text-[var(--color-text-muted)]">
      small sample
    </span>
  );
}

function RpCalibrationCard({ algorithmId, card, d }: { algorithmId: PublishedAlgorithmId; card: RpCalibrationCardModel; d: number }) {
  const label = algorithmDisplayLabel(algorithmId);
  return (
    <div data-testid={rpCalibrationCardTestId(algorithmId)} className="event-card flex min-w-0 flex-col gap-[var(--spacing-sm)] p-[var(--spacing-md)] shadow-sm">
      <div className="flex items-center gap-[var(--spacing-xs)]">
        <span aria-hidden="true" className="inline-block size-[10px] rounded-full" style={{ background: `var(--compare-algo-${algorithmId})` }} />
        <span className="text-role-label font-semibold text-[var(--color-text-primary)]">{label}</span>
      </div>
      <p data-testid={rpCalibrationCardSentenceTestId(algorithmId)} className="text-role-body text-[var(--color-text-primary)]">
        {card.headline === null ? (
          RP_CALIBRATION_ABSENT_TEXT
        ) : (
          <>
            {rpCardHeadlineSentence(label, card.headline)}
            {card.headline.sparse && (
              <>
                {" "}
                <SparseTag />
              </>
            )}
          </>
        )}
      </p>
      {/* Absence renders ONLY the sentence above — no chart, no rows, and
          critically no "%" anywhere in the card body, so a reader cannot
          mistake "not measured" for "measured at 0%." */}
      {card.headline !== null && (
        <>
          <MiniDeviationChart card={card} algorithmId={algorithmId} d={d} />
          <div className="flex flex-col">
            {card.bonuses.map((row) => (
              <div key={row.name} className="flex items-baseline gap-[var(--spacing-sm)] border-t border-[var(--color-border)] py-[3px] text-role-label">
                <span className="min-w-0 flex-1 shrink-0 text-[var(--color-text-muted)]">{row.name}</span>
                <span className="min-w-0 flex-1 text-[var(--color-text-primary)]">
                  {"predicted "}
                  <b className="numeric-cell">{`${fmtPct(row.meanPredicted, 1)}%`}</b>
                  {" → actual "}
                  <b className="numeric-cell">{`${fmtPct(row.observedFrequency, 1)}%`}</b>
                </span>
                <span className="numeric-cell flex shrink-0 items-baseline gap-[var(--spacing-xs)] text-[var(--color-text-muted)]">
                  {row.count.toLocaleString("en-US")}
                  {row.sparse && <SparseTag />}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function RpCalibrationSection({ artifactsByYear }: RpCalibrationSectionProps) {
  const [year, setYear] = useState<number>(DEFAULT_RP_CALIBRATION_YEAR);
  const artifact = artifactsByYear.get(year);

  const cards = PUBLISHED_ALGORITHM_IDS.map((algorithmId) => {
    const slice = artifact?.slices.find((s) => s.algorithmId === algorithmId && s.season === year && s.compLevelView === "qualification");
    return { algorithmId, card: buildRpCalibrationCard(slice?.rpCalibration) };
  });
  // The shared scale: one `d` across all three cards so a bar's height means
  // the same thing card to card — same discipline as CalibrationSection.
  const d = niceCeil(
    cards.reduce((m, c) => Math.max(m, c.card.maxAbsDeviation), 0),
    0.05
  );

  return (
    <div data-testid={RP_CALIBRATION_SECTION_TESTID} className="mt-[var(--spacing-xl)]">
      <div className="mb-[var(--spacing-sm)] flex flex-wrap items-center justify-between gap-[var(--spacing-sm)]">
        <h2 className="text-role-heading text-[var(--color-text-primary)]">Ranking Point Accuracy</h2>
        <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
          <SelectTrigger data-testid={RP_CALIBRATION_YEAR_SELECT_TESTID} aria-label="Year" className="tap-target w-[5.5rem]">
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
      <p className="mb-[var(--spacing-md)] max-w-[72ch] text-role-body text-[var(--color-text-muted)]">{RP_CALIBRATION_EXPLAINER}</p>
      <div className="grid gap-[var(--spacing-md)] md:grid-cols-3">
        {cards.map(({ algorithmId, card }) => (
          <RpCalibrationCard key={algorithmId} algorithmId={algorithmId} card={card} d={d} />
        ))}
      </div>
    </div>
  );
}
