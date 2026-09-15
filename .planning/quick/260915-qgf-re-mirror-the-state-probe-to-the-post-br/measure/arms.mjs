/**
 * Pure data: the nine measurement arms and their pairwise differences,
 * matching `apps/worker/src/stateProbe.ts`'s `resolveRpArm` and its `phaseB`
 * param exactly (see `stateProbe.test.ts` Groups 8 and 9, which pin the same
 * ids and the same phaseB behaviour by equality).
 *
 * Adapted from `260914-nhc/measure/arms.mjs`. That copy is LEFT UNTOUCHED: it
 * is the record of how the 2026-09-14 COMPONENT PROFILE numbers were produced
 * and must stay reproducible.
 *
 * No dependencies, no network, no side effects — safe to import from both
 * `measure-arms.mjs` (the driver) and `analyze-arms.mjs` (the analyzer).
 */

/**
 * Common query shared by every arm request. Deliberately byte-for-byte the
 * same string 2026-09-14 used, so the roster, fold count and algorithm tier
 * are identical and the two runs are comparable on those axes.
 *
 * `upcoming=60` MEANS SOMETHING DIFFERENT NOW. Before 260915-isq it was a
 * Phase A pricing loop — 60 predict/band/RP-pmf triples, and the dominant CPU
 * term the 2026-09-14 profile measured. Since 260915-isq the tick prices no
 * upcoming match at all: 60 now sizes Phase B's schedule-only row rebuild and
 * keeps the event's `state` block alive (a block is dropped once no upcoming
 * match is left). Same query string, different tick.
 */
export const COMMON_QUERY = "season=2026&teamCount=21&folded=2&upcoming=60&algorithms=spr";

/**
 * The nine arms, in a fixed order — the same round-robin shape that produced
 * n=12-13 per arm on 2026-09-14.
 *
 * `query` is the arm-specific fragment appended after `COMMON_QUERY`.
 * `expectedId` is the `params.rpArm.id` the probe must echo back.
 * `expectedPhaseB` is the `params.phaseB` it must echo — REQUIRED, because
 * `allPhaseB` shares an `expectedId` with `all` and `nonePhaseB` with `none`;
 * the id alone can no longer tell those pairs apart. The driver aborts at
 * warm-up on a mismatch in either field.
 */
export const ARMS = [
  { name: "all", query: "rp=1", expectedId: "all", expectedPhaseB: false },
  { name: "none", query: "rp=0", expectedId: "none", expectedPhaseB: false },
  { name: "resumeOnly", query: "rpSkip=foldedPmf,observe,beliefs", expectedId: "skip:foldedPmf,observe,beliefs", expectedPhaseB: false },
  { name: "skipFoldedPmf", query: "rpSkip=foldedPmf", expectedId: "skip:foldedPmf", expectedPhaseB: false },
  { name: "skipFormula", query: "rpSkip=formula", expectedId: "skip:formula", expectedPhaseB: false },
  { name: "skipObserve", query: "rpSkip=observe", expectedId: "skip:observe", expectedPhaseB: false },
  { name: "skipBeliefs", query: "rpSkip=beliefs", expectedId: "skip:beliefs", expectedPhaseB: false },
  { name: "allPhaseB", query: "rp=1&phaseB=1", expectedId: "all", expectedPhaseB: true },
  { name: "nonePhaseB", query: "rp=0&phaseB=1", expectedId: "none", expectedPhaseB: true },
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
  { label: "foldedPmf", minuend: "all", subtrahend: "skipFoldedPmf", meaning: "rpFieldsFor on 2 folded matches — the ONLY pmf loop left" },
  { label: "formula", minuend: "all", subtrahend: "skipFormula", meaning: "analyticRpPmf plus field construction, folded loop" },
  { label: "wrapper", minuend: "skipFormula", subtrahend: "skipFoldedPmf", meaning: "gates, momentsFor, rosterIsFullyWarm and apply, folded loop" },
  { label: "observe", minuend: "all", subtrahend: "skipObserve", meaning: "foldObservedRp plus observeMatch plus the bonus-flag capture" },
  { label: "beliefs", minuend: "all", subtrahend: "skipBeliefs", meaning: "withRpBeliefs plus withRpMeanShift" },
  { label: "phaseB", minuend: "allPhaseB", subtrahend: "all", meaning: "Phase B's merge/splice/stringify, on top of a full RP Phase A" },
  { label: "phaseBNoRp", minuend: "nonePhaseB", subtrahend: "none", meaning: "the same Phase B work with RP fully ablated — isolates Phase B from any RP interaction" },
];

/**
 * Differences the 2026-09-14 COMPONENT PROFILE reported that NO LONGER EXIST,
 * listed so a reader diffing this table against that one can see the rows were
 * removed on purpose rather than lost.
 *
 * Both name the upcoming-match RP pricing loop, which `processEvent` no longer
 * has: 260915-isq deleted it, and the browser prices upcoming matches from the
 * event artifact's `state` block instead. The probe's `rpSkip=upcomingPmf`
 * component is retired for the same reason — it is still RECOGNIZED and
 * answers NOT APPLICABLE, so an operator running the old command gets told
 * why rather than silently measuring the `all` arm twice.
 */
export const RETIRED_DIFFERENCES = [
  { label: "upcomingPmf", wasMinuend: "all", wasSubtrahend: "skipUpcomingPmf", reason: "the upcoming RP pricing loop was deleted from processEvent's Phase A by 260915-isq; there is no upcoming pmf to skip" },
  { label: "bothPmf", wasMinuend: "all", wasSubtrahend: "skipBothPmf", reason: "with only one pmf loop left, `bothPmf` is exactly `foldedPmf` — a duplicate row, not a lost one" },
];
