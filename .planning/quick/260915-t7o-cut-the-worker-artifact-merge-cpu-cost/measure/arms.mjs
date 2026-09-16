/**
 * Pure data: the THIRTEEN Phase B breakdown arms and their differences,
 * matching `apps/worker/src/stateProbe.ts`'s `resolvePhaseBArm`,
 * `parsePhaseBUpcomingParam` and its `phaseB`/`phaseBTeams` params exactly
 * (see `stateProbe.test.ts` Group 10, which pins the same ids, the same `ran`
 * sets and the same counters by equality).
 *
 * Adapted from `260915-qgf/measure/arms.mjs`. That copy is LEFT UNTOUCHED: it
 * is the record of how the 2026-09-15 numbers — Phase A fixed, Phase B at
 * +64.0 ± 9.3 ms — were produced, and must stay reproducible. `260914-nhc`'s
 * copy is untouched for the same reason, one generation further back.
 *
 * WHAT THIS RIG IS FOR. qgf measured Phase B as ONE lump: +64.0 ms covering
 * `JSON.parse`, zod validation, the merge (state-block splice included) and
 * `JSON.stringify`, across one ~106 KB event artifact and twelve ~32 KB team
 * artifacts. Every fix anyone might build reduces ONE of those terms. Building
 * a fix before splitting the lump is guessing, so this rig splits it.
 *
 * No dependencies, no network, no side effects — safe to import from both
 * `measure-arms.mjs` (the driver) and `analyze-arms.mjs` (the analyzer).
 */

/**
 * The 21 roster keys are pinned rather than discovered (orchestrator,
 * 2026-09-15), BYTE-FOR-BYTE the same list qgf pinned. Discovery orders
 * `algorithm_state` by scope_key and picks up keys with no RP or Sigma beliefs
 * (and the demo pseudo-team), which suppressed every RP pmf —
 * `rpPmfsProduced: 0`, so the RP arms measured nothing — and 404'd phaseB's
 * team-artifact fetch, which would abort every arm in THIS rig at the warm-up
 * gate. These 21 all carry both passengers and have published team artifacts.
 * With them: resumed 21, bandsProduced 4, rpPmfsProduced 2.
 *
 * DO NOT "improve" this list. A different roster makes these numbers
 * incomparable with qgf's 64.0 ms anchor, which is the only continuity this
 * breakdown has.
 */
const WARM_ROSTER = [
  "frc1", "frc100", "frc10000", "frc10002", "frc10004", "frc10011", "frc10014",
  "frc10015", "frc10016", "frc10017", "frc10019", "frc1002", "frc10021", "frc10029",
  "frc10032", "frc10034", "frc10043", "frc10045", "frc10050", "frc10059", "frc10063",
].join(",");

/**
 * Common query shared by every arm request — deliberately byte-for-byte the
 * same string qgf used, so the roster, fold count, schedule size and algorithm
 * tier are identical and the `phaseB` difference below is directly comparable
 * to qgf's +64.0 ms.
 *
 * `upcoming=60` sizes Phase B's schedule-only row rebuild and keeps the event's
 * `state` block alive (a block is dropped once no upcoming match is left). It
 * prices NO Phase A work: the tick has not priced an upcoming match since
 * 260915-isq.
 */
export const COMMON_QUERY = `season=2026&teamCount=21&folded=2&upcoming=60&algorithms=spr&teams=${WARM_ROSTER}`;

/**
 * The thirteen arms, in a fixed order.
 *
 * `query` is the arm-specific fragment appended after `COMMON_QUERY`.
 * `expectedId` is the `params.rpArm.id` the probe must echo (every arm here
 *   runs a full RP Phase A, so it is "all" throughout — Phase A is not what
 *   this rig splits).
 * `expectedPhaseB` is `params.phaseB`.
 * `expectedPhaseBArmId` is `params.phaseBArm.id`.
 * `expectedPhaseBUpcoming` is `params.phaseBUpcoming`.
 *
 * ALL FOUR ARE REQUIRED and all four are checked at the warm-up gate. Eleven
 * of these arms share `expectedId: "all"` and ten share `expectedPhaseB: true`;
 * without the two new fields the driver would happily record thirteen arms as
 * two, and a cpuTime would be attributed to an arm that never ran.
 */
export const ARMS = [
  { name: "all", query: "rp=1", expectedId: "all", expectedPhaseB: false, expectedPhaseBArmId: "all", expectedPhaseBUpcoming: "published" },
  { name: "allPhaseB", query: "rp=1&phaseB=1", expectedId: "all", expectedPhaseB: true, expectedPhaseBArmId: "all", expectedPhaseBUpcoming: "published" },
  { name: "pbSkipEventParse", query: "rp=1&phaseB=1&phaseBSkip=eventParse", expectedId: "all", expectedPhaseB: true, expectedPhaseBArmId: "skip:eventParse", expectedPhaseBUpcoming: "published" },
  { name: "pbSkipEventValidate", query: "rp=1&phaseB=1&phaseBSkip=eventValidate", expectedId: "all", expectedPhaseB: true, expectedPhaseBArmId: "skip:eventValidate", expectedPhaseBUpcoming: "published" },
  { name: "pbSkipEventMerge", query: "rp=1&phaseB=1&phaseBSkip=eventMerge", expectedId: "all", expectedPhaseB: true, expectedPhaseBArmId: "skip:eventMerge", expectedPhaseBUpcoming: "published" },
  { name: "pbSkipEventStringify", query: "rp=1&phaseB=1&phaseBSkip=eventStringify", expectedId: "all", expectedPhaseB: true, expectedPhaseBArmId: "skip:eventStringify", expectedPhaseBUpcoming: "published" },
  { name: "pbTeams0", query: "rp=1&phaseB=1&phaseBTeams=0", expectedId: "all", expectedPhaseB: true, expectedPhaseBArmId: "all", expectedPhaseBUpcoming: "published" },
  { name: "pbSkipTeamValidate", query: "rp=1&phaseB=1&phaseBSkip=teamValidate", expectedId: "all", expectedPhaseB: true, expectedPhaseBArmId: "skip:teamValidate", expectedPhaseBUpcoming: "published" },
  { name: "pbSkipTeamMerge", query: "rp=1&phaseB=1&phaseBSkip=teamMerge", expectedId: "all", expectedPhaseB: true, expectedPhaseBArmId: "skip:teamMerge", expectedPhaseBUpcoming: "published" },
  { name: "pbSkipTeamStringify", query: "rp=1&phaseB=1&phaseBSkip=teamStringify", expectedId: "all", expectedPhaseB: true, expectedPhaseBArmId: "skip:teamStringify", expectedPhaseBUpcoming: "published" },
  { name: "pbSchedAll", query: "rp=1&phaseB=1&phaseBUpcoming=scheduled", expectedId: "all", expectedPhaseB: true, expectedPhaseBArmId: "all", expectedPhaseBUpcoming: "scheduled" },
  { name: "pbSchedSkipEventParse", query: "rp=1&phaseB=1&phaseBUpcoming=scheduled&phaseBSkip=eventParse", expectedId: "all", expectedPhaseB: true, expectedPhaseBArmId: "skip:eventParse", expectedPhaseBUpcoming: "scheduled" },
  { name: "pbSchedSkipEventValidate", query: "rp=1&phaseB=1&phaseBUpcoming=scheduled&phaseBSkip=eventValidate", expectedId: "all", expectedPhaseB: true, expectedPhaseBArmId: "skip:eventValidate", expectedPhaseBUpcoming: "scheduled" },
];

/** `name -> arm`, for quick lookup by the driver's `--arms` flag and the analyzer's joins. */
export const ARMS_BY_NAME = new Map(ARMS.map((arm) => [arm.name, arm]));

/**
 * Arms whose `upcoming` rows were REBUILT into the schedule-only shape before
 * the measured region. Their ABSOLUTE cpuTime is not comparable to a
 * published-shape arm's — the reshape costs CPU and the payload shrinks — so
 * only a difference BETWEEN TWO of them means anything. The analyzer refuses
 * to build a cross-shape difference except the one named
 * `unionOrderPenalty`, which is a difference OF differences and therefore has
 * the reshape cancelled out of it twice.
 */
export const SCHEDULED_SHAPE_ARMS = ARMS.filter((arm) => arm.expectedPhaseBUpcoming === "scheduled").map((arm) => arm.name);

/**
 * MEASURED pairwise differences: each is two real arms, subtracted. See
 * `docs/worker-operations.md`'s "Pre-event probe" runbook for how each maps
 * back onto `runSprPhaseB`'s components.
 */
export const DIFFERENCES = [
  { label: "phaseB", minuend: "allPhaseB", subtrahend: "all", meaning: "ALL of Phase B on top of a full RP Phase A — the continuity anchor against qgf's +64.0 ms" },
  { label: "eventHalf", minuend: "allPhaseB", subtrahend: "pbSkipEventParse", meaning: "the whole event half: JSON.parse + zod + merge/splice + stringify of the ~106 KB event artifact" },
  { label: "eventValidate", minuend: "allPhaseB", subtrahend: "pbSkipEventValidate", meaning: "LiveEventArtifactSchema.parse alone, PUBLISHED row shape" },
  { label: "eventMergeAndStringify", minuend: "allPhaseB", subtrahend: "pbSkipEventMerge", meaning: "mergeEventArtifact (state-block splice included) plus the stringify it forces off with it" },
  { label: "eventStringify", minuend: "allPhaseB", subtrahend: "pbSkipEventStringify", meaning: "JSON.stringify of the merged event artifact alone" },
  { label: "teamHalf", minuend: "allPhaseB", subtrahend: "pbTeams0", meaning: "all twelve team artifacts: JSON.parse + zod + merge + stringify each" },
  { label: "teamValidate", minuend: "allPhaseB", subtrahend: "pbSkipTeamValidate", meaning: "TeamSeasonArtifactSchema.parse x12" },
  { label: "teamMergeAndStringify", minuend: "allPhaseB", subtrahend: "pbSkipTeamMerge", meaning: "mergeTeamSeasonArtifact x12 plus the stringifies it forces off with it" },
  { label: "teamStringify", minuend: "allPhaseB", subtrahend: "pbSkipTeamStringify", meaning: "JSON.stringify of the merged team artifacts alone, x12" },
  {
    label: "eventValidateScheduledShape",
    minuend: "pbSchedAll",
    subtrahend: "pbSchedSkipEventValidate",
    meaning: "LiveEventArtifactSchema.parse alone, SCHEDULE-ONLY row shape — the shape the live Worker reads back from its own writes on every tick after the first",
  },
  {
    label: "eventHalfScheduledShape",
    minuend: "pbSchedAll",
    subtrahend: "pbSchedSkipEventParse",
    meaning: "the whole event half against the schedule-only row shape — the live-shape counterpart of eventHalf",
  },
];

/**
 * DERIVED residuals. NONE of these is a measured arm difference: each is a
 * linear combination of ARM MEANS, so its standard error is computed from the
 * arm variances directly (sqrt(Σ cᵢ² · varᵢ / nᵢ)) rather than by naively
 * adding the SEs of differences that all share the `allPhaseB` arm and are
 * therefore correlated.
 *
 * `expression` is the human-readable difference arithmetic; `coefficients` is
 * that same arithmetic reduced to arm means, which is what is actually
 * computed. The two must agree — `--self-test` checks one of them by hand.
 *
 * Read every row here as an ESTIMATE WITH A REMAINDER IN IT. A residual absorbs
 * whatever the named terms did not account for, including non-additivity
 * between them. It is not a measurement of the thing its label names; it is
 * what is left over once the measured terms are removed.
 */
export const DERIVED_DIFFERENCES = [
  {
    label: "eventMerge",
    expression: "eventMergeAndStringify - eventStringify",
    coefficients: { pbSkipEventStringify: 1, pbSkipEventMerge: -1 },
    meaning: "mergeEventArtifact alone, the state-block splice included (DERIVED)",
  },
  {
    label: "eventJsonParse",
    expression: "eventHalf - eventValidate - eventMergeAndStringify",
    coefficients: { allPhaseB: -1, pbSkipEventParse: -1, pbSkipEventValidate: 1, pbSkipEventMerge: 1 },
    meaning: "JSON.parse of the ~106 KB event artifact alone (DERIVED — absorbs any non-additivity in the event half)",
  },
  {
    label: "teamMerge",
    expression: "teamMergeAndStringify - teamStringify",
    coefficients: { pbSkipTeamStringify: 1, pbSkipTeamMerge: -1 },
    meaning: "mergeTeamSeasonArtifact alone, x12 (DERIVED)",
  },
  {
    label: "teamJsonParse",
    expression: "teamHalf - teamValidate - teamMergeAndStringify",
    coefficients: { allPhaseB: -1, pbTeams0: -1, pbSkipTeamValidate: 1, pbSkipTeamMerge: 1 },
    meaning: "JSON.parse of the twelve team artifacts alone (DERIVED — absorbs any non-additivity in the team half)",
  },
  {
    label: "unionOrderPenalty",
    expression: "eventValidateScheduledShape - eventValidate",
    coefficients: { pbSchedAll: 1, pbSchedSkipEventValidate: -1, allPhaseB: -1, pbSkipEventValidate: 1 },
    meaning:
      "what the union's ORDER costs: a schedule-only row fails EventUpcomingMatchSchema's 8-refine, ~24-field option before EventScheduledMatchSchema accepts it. A difference OF differences, so the reshape's own cost cancels twice (DERIVED)",
  },
];

/**
 * Counters that MUST be identical across every sample of every arm where the
 * component that produces them actually RAN. A mismatch means the arms are not
 * comparable and the numbers must be discarded — the analyzer reports it and
 * exits non-zero rather than averaging over it.
 *
 * `excluded` lists the arms where a skip legitimately zeroes the field, so
 * their samples are not part of that field's equality group. `all` is excluded
 * from every one of them: it runs no Phase B at all.
 */
export const PHASE_B_CONSTANT_WHERE_RAN = [
  { field: "playedRowFactsBuilt", excluded: ["all"], note: "playedRowFactsFor runs in EVERY phaseB arm regardless of skips, so it cancels in every difference" },
  { field: "eventArtifactBytes", excluded: ["all"], note: "the fetched bytes — the fetch is unskippable, so every phaseB arm must see the same artifact" },
  { field: "mergedEventBytes", excluded: ["all", "pbSkipEventParse", "pbSkipEventMerge", "pbSkipEventStringify", "pbSchedSkipEventParse"], note: "the stringified merged event; the reshape cannot change it, because the merge reads only matchKey/sortTime off existing.upcoming" },
  { field: "mergedEventStateRows", excluded: ["all", "pbSkipEventParse", "pbSkipEventMerge", "pbSchedSkipEventParse"], note: "the spliced state block's row count" },
  { field: "mergedEventUpcomingRows", excluded: ["all", "pbSkipEventParse", "pbSkipEventMerge", "pbSchedSkipEventParse"], note: "rebuilt from Phase A's schedule, so it is the same in the published and scheduled shapes" },
  { field: "mergedEventPlayedRows", excluded: ["all", "pbSkipEventParse", "pbSkipEventMerge", "pbSchedSkipEventParse"], note: "the merged played rows" },
  { field: "teamParsesRun", excluded: ["all", "pbTeams0"], note: "one JSON.parse per loop iteration, so it equals phaseBTeams even when teamValidate is skipped" },
  { field: "teamMergesRun", excluded: ["all", "pbTeams0", "pbSkipTeamMerge"], note: "the team merges" },
  { field: "mergedTeamBytes", excluded: ["all", "pbTeams0", "pbSkipTeamMerge", "pbSkipTeamStringify"], note: "the summed stringified team bytes" },
];

/**
 * The reshape's own counters, checked by SHAPE rather than across all arms:
 * every `scheduled` arm must report the SAME non-zero row count and the SAME
 * reshaped size (the reshape ran identically in each), and every
 * `published` phaseB arm must report 0 (it did not run at all). This is what
 * makes "the reshape cancels in the difference pair" a checked fact rather
 * than a claim in a comment.
 */
export const RESHAPE_FIELDS = ["eventUpcomingReshapedRows", "reshapedEventTextBytes"];

/**
 * Differences qgf reported that this rig does NOT, listed so a reader diffing
 * the two tables can see the rows were dropped on purpose rather than lost.
 *
 * Every RP component difference is gone: Phase A was re-mirrored and measured
 * on 2026-09-15 and is no longer the blocker — Phase B is. Re-run qgf's own
 * rig, unchanged, if an RP component number is wanted again.
 */
export const RETIRED_DIFFERENCES = [
  { label: "total", wasMinuend: "all", wasSubtrahend: "none", reason: "the RP path's own cost; measured 2026-09-15 by the qgf rig, which is left intact for exactly this" },
  { label: "resume", wasMinuend: "resumeOnly", wasSubtrahend: "none", reason: "an RP Phase A component — out of scope for a Phase B breakdown" },
  { label: "foldedPmf", wasMinuend: "all", wasSubtrahend: "skipFoldedPmf", reason: "an RP Phase A component — out of scope for a Phase B breakdown" },
  { label: "formula", wasMinuend: "all", wasSubtrahend: "skipFormula", reason: "an RP Phase A component — out of scope for a Phase B breakdown" },
  { label: "wrapper", wasMinuend: "skipFormula", wasSubtrahend: "skipFoldedPmf", reason: "an RP Phase A component — out of scope for a Phase B breakdown" },
  { label: "observe", wasMinuend: "all", wasSubtrahend: "skipObserve", reason: "an RP Phase A component — out of scope for a Phase B breakdown" },
  { label: "beliefs", wasMinuend: "all", wasSubtrahend: "skipBeliefs", reason: "an RP Phase A component — out of scope for a Phase B breakdown" },
  {
    label: "phaseBNoRp",
    wasMinuend: "nonePhaseB",
    wasSubtrahend: "none",
    reason: "qgf already showed Phase B's cost does not interact with the RP arm (64.0 with RP on, 63.8 with it off); spending a thirteenth arm's worth of rounds re-confirming that buys less than splitting the lump does",
  },
];
