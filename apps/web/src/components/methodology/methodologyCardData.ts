/**
 * The `/methodology` hub's card descriptors (quick task 260905-phf Task 1).
 * The single source of the hub's titles, blurbs and target routes —
 * `MethodologyCards.tsx` and `methodology.index.test.tsx` both derive from
 * this constant rather than hand-typing a second copy, matching this
 * repo's established "derive from a named constant" discipline
 * (e.g. `MethodologyNote.tsx`, `AccuracyTable.tsx`).
 *
 * Named `methodologyCardData.ts`, not `methodologyCards.ts` (the plan's
 * literal filename) — Rule 3 fix: this repo builds on a case-insensitive
 * Windows filesystem, and `methodologyCards.ts` differs from the component
 * file `MethodologyCards.tsx` by case only. Rolldown's Windows module
 * resolution collapsed both to one on-disk entity and resolved imports of
 * either specifier to whichever file the OS returned first, causing a
 * "MethodologyCards is not exported" build failure that reproduced
 * consistently. Every other data/component pair in this codebase
 * (`calibrationCards.ts`/`CalibrationSection.tsx`, `coverageRows.ts`/
 * `DataCoverageTable.tsx`) already differs by more than case for exactly
 * this reason; this file follows that same established convention.
 */
export interface MethodologyCardDescriptor {
  readonly to: "/methodology/vpr" | "/methodology/compare";
  readonly title: string;
  readonly blurb: string;
  readonly testId: string;
}

export const METHODOLOGY_CARDS: readonly MethodologyCardDescriptor[] = [
  {
    to: "/methodology/vpr",
    title: "Intro to VPR",
    blurb: "What VPR is and what the ± beside it means, in plain language.",
    testId: "methodology-card-vpr",
  },
  {
    to: "/methodology/compare",
    title: "Algorithm accuracy",
    blurb: "How VPR's predictions score against OPR and EPA, season by season.",
    testId: "methodology-card-compare",
  },
] as const;
