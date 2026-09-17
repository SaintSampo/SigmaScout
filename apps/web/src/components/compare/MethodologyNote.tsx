/**
 * The one always-visible muted note beneath the accuracy table — never a
 * tooltip, never behind a disclosure toggle. It says what the highlight in
 * the table means and nothing else (sketch 017, variant A).
 *
 * Rewritten 2026-09-17. Three things this note used to carry are gone on
 * purpose:
 *   - the cold-start paragraph: `exclusionCounts.coldStart` is zero in every
 *     published season and view, so it explained a rule that excluded nothing;
 *   - the derived "Brier by season" sentence, which repeated the table above;
 *   - the "judgement call, not a statistical test" caption.
 *
 * This module still deliberately makes no claim about which seasons an
 * algorithm's hyperparameters were tuned on, and no significance claim: the
 * highlight rule in `lib/compareTie.ts` is a conservative threshold, not a
 * paired test. `AccuracyTable.tsx` must never mount this note inside itself.
 */
export const METHODOLOGY_NOTE_TESTID = "compare-methodology-note";

export const HIGHLIGHT_NOTE =
  "A highlighted number is clearly ahead of the next best. When two are too close to call, nothing is highlighted.";

export function MethodologyNote() {
  return (
    <div data-testid={METHODOLOGY_NOTE_TESTID} className="flex flex-col gap-[var(--spacing-xs)]">
      <p className="text-role-body text-[var(--color-text-muted)]">{HIGHLIGHT_NOTE}</p>
    </div>
  );
}
