/**
 * The `/methodology` hub's card descriptors. The single source of the
 * hub's titles, blurbs and target routes — `MethodologyCards.tsx` and
 * `methodology.index.test.tsx` both derive from this constant rather than
 * hand-typing a second copy, matching this repo's established "derive from
 * a named constant" discipline (e.g. `MethodologyNote.tsx`,
 * `AccuracyTable.tsx`).
 *
 * Named `methodologyCardData.ts`, not `methodologyCards.ts`: this repo
 * builds on a case-insensitive Windows filesystem, and `methodologyCards.ts`
 * would differ from the component file `MethodologyCards.tsx` by case
 * only, which collapses both to one on-disk entity under Windows module
 * resolution. Every other data/component pair in this codebase
 * (`calibrationCards.ts`/`CalibrationSection.tsx`, `coverageRows.ts`/
 * `DataCoverageTable.tsx`) already differs by more than case for exactly
 * this reason.
 */
export interface MethodologyCardDescriptor {
  readonly to:
    | "/methodology/spr"
    | "/methodology/epa-vs-statbotics"
    | "/methodology/compare"
    | "/methodology/sigma"
    | "/methodology/awards"
    | "/methodology/acknowledgments";
  readonly title: string;
  readonly blurb: string;
  readonly testId: string;
}

/**
 * The SPR explainer, the site's premier rating and the most fundamental of
 * the six, reads first; Acknowledgments stays last.
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
    to: "/methodology/spr",
    title: "What SPR measures",
    blurb: "SPR is the rating SigmaScout uses to rank teams. See what the number is and what it isn't.",
    testId: "methodology-card-spr",
  },
  {
    to: "/methodology/epa-vs-statbotics",
    title: "Our EPA vs Statbotics' EPA",
    blurb: "Both sites publish a rating called EPA. See where the two numbers come apart, and by how much.",
    testId: "methodology-card-epa-vs-statbotics",
  },
  {
    to: "/methodology/compare",
    title: "Algorithm accuracy",
    blurb: "How SPR's predictions score against OPR and EPA, season by season.",
    testId: "methodology-card-compare",
  },
  {
    to: "/methodology/sigma",
    title: "Sigma Score and the match band",
    blurb: "What a team's Sigma number means, and how to read the coloured bars on a match row.",
    testId: "methodology-card-sigma",
  },
  {
    to: "/methodology/awards",
    title: "Predicting awards",
    blurb: "Can awards be predicted before an event? What worked and what did not.",
    testId: "methodology-card-awards",
  },
  {
    to: "/methodology/acknowledgments",
    title: "Acknowledgments",
    blurb: "The projects and data SigmaScout is built on: The Blue Alliance, Statbotics, and more.",
    testId: "methodology-card-acknowledgments",
  },
] as const;
