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
  readonly to:
    | "/methodology/epa-vs-statbotics"
    | "/methodology/compare"
    | "/methodology/swing"
    | "/methodology/acknowledgments";
  readonly title: string;
  readonly blurb: string;
  readonly testId: string;
}

/**
 * The first card's slot (quick task 260908-n5o) previously held the former
 * Intro to VPR page, retired and purged as part of this same task. This
 * card takes its place, in the same first position.
 *
 * The hub shows FOUR cards as of quick task 260909-3fj, which added the Swing
 * Factor page in third position and left Acknowledgments last.
 *
 * ORDER IS LOAD BEARING. `MethodologyCards.tsx` destructures this array
 * POSITIONALLY (it cannot `.map()` over it — see that file's own doc comment
 * for the typed-search reason), so reordering these entries without also
 * reordering that destructure would render the wrong blurb under the wrong
 * title while every existing test stayed green. `methodologyCardData.test.ts`
 * pins the order by equality for exactly that reason.
 *
 * A card's `title` must contain no regular expression metacharacter:
 * `methodology.index.test.tsx` builds a `RegExp` straight from it.
 */
export const METHODOLOGY_CARDS: readonly MethodologyCardDescriptor[] = [
  {
    to: "/methodology/epa-vs-statbotics",
    title: "Our EPA vs Statbotics' EPA",
    blurb: "Both sites publish a rating called EPA. See where the two numbers come apart, and by how much.",
    testId: "methodology-card-epa-vs-statbotics",
  },
  {
    to: "/methodology/compare",
    title: "Algorithm accuracy",
    blurb: "How BPR's predictions score against OPR and EPA, season by season.",
    testId: "methodology-card-compare",
  },
  {
    to: "/methodology/swing",
    title: "Swing Factor and the match band",
    blurb: "What the grey ± beside a rating means, and how to read the coloured bars on a match row.",
    testId: "methodology-card-swing",
  },
  {
    to: "/methodology/acknowledgments",
    title: "Acknowledgments",
    blurb: "The projects and data SigmaScout is built on — The Blue Alliance, Statbotics, and more.",
    testId: "methodology-card-acknowledgments",
  },
] as const;
