/**
 * Pure data: the nine measurement arms and their pairwise differences,
 * matching `apps/worker/src/stateProbe.ts`'s `resolveRpArm` exactly (see
 * `stateProbe.test.ts` Group 8, which pins the same nine ids by equality).
 *
 * No dependencies, no network, no side effects — safe to import from both
 * `measure-arms.mjs` (the driver) and `analyze-arms.mjs` (the analyzer).
 */

/** Common query shared by every arm request. `folded=2` mirrors the live tick's typical newly-folded count; `upcoming=60` is where the CPU goes (see docs/worker-operations.md). */
export const COMMON_QUERY = "season=2026&teamCount=21&folded=2&upcoming=60&algorithms=spr";

/**
 * The nine arms, in a fixed order. `query` is the arm-specific fragment
 * appended after `COMMON_QUERY`. `expectedId` is the `params.rpArm.id` the
 * probe must echo back — the driver aborts at warm-up on any mismatch.
 */
export const ARMS = [
  { name: "all", query: "rp=1", expectedId: "all" },
  { name: "none", query: "rp=0", expectedId: "none" },
  { name: "resumeOnly", query: "rpSkip=foldedPmf,upcomingPmf,observe,beliefs", expectedId: "skip:foldedPmf,upcomingPmf,observe,beliefs" },
  { name: "skipFoldedPmf", query: "rpSkip=foldedPmf", expectedId: "skip:foldedPmf" },
  { name: "skipUpcomingPmf", query: "rpSkip=upcomingPmf", expectedId: "skip:upcomingPmf" },
  { name: "skipBothPmf", query: "rpSkip=foldedPmf,upcomingPmf", expectedId: "skip:foldedPmf,upcomingPmf" },
  { name: "skipFormula", query: "rpSkip=formula", expectedId: "skip:formula" },
  { name: "skipObserve", query: "rpSkip=observe", expectedId: "skip:observe" },
  { name: "skipBeliefs", query: "rpSkip=beliefs", expectedId: "skip:beliefs" },
];

/** `name -> arm`, for quick lookup by the driver's `--arms` flag and the analyzer's joins. */
export const ARMS_BY_NAME = new Map(ARMS.map((arm) => [arm.name, arm]));

/**
 * Named pairwise differences the analyzer reports. `minuend`/`subtrahend` are
 * arm names from `ARMS`. See `docs/worker-operations.md`'s "Pre-event probe"
 * runbook for how each difference maps back onto `runSprFold`'s components.
 */
export const DIFFERENCES = [
  { label: "total", minuend: "all", subtrahend: "none", meaning: "every RP component" },
  { label: "resume", minuend: "resumeOnly", subtrahend: "none", meaning: "belief and mean-shift resume" },
  { label: "foldedPmf", minuend: "all", subtrahend: "skipFoldedPmf", meaning: "rpFieldsFor on 2 folded matches, expected below resolution" },
  { label: "upcomingPmf", minuend: "all", subtrahend: "skipUpcomingPmf", meaning: "rpFieldsFor on 60 upcoming matches" },
  { label: "bothPmf", minuend: "all", subtrahend: "skipBothPmf", meaning: "rpFieldsFor, both loops" },
  { label: "formula", minuend: "all", subtrahend: "skipFormula", meaning: "analyticRpPmf plus field construction, both loops" },
  { label: "wrapper", minuend: "skipFormula", subtrahend: "skipBothPmf", meaning: "gates, momentsFor, rosterIsFullyWarm and apply, both loops" },
  { label: "observe", minuend: "all", subtrahend: "skipObserve", meaning: "foldObservedRp plus observeMatch" },
  { label: "beliefs", minuend: "all", subtrahend: "skipBeliefs", meaning: "withRpBeliefs plus withRpMeanShift" },
];
