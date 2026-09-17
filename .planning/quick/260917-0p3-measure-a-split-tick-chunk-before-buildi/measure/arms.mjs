/**
 * Pure data: the FIVE split-tick arms, the pre-registered bar, and the
 * cross-arm invariants, matching `apps/worker/src/stateProbe.ts`'s
 * `resolveChunkArm` and its `phaseB`/`phaseBTeams` params exactly (see
 * `stateProbe.test.ts` Group 11, which pins the same id, the same counters and
 * the same unreconstructed-field list by equality).
 *
 * Adapted from `260915-t7o/measure/arms.mjs`, as that copy was adapted from
 * `260915-qgf`'s and that one from `260914-nhc`'s. EVERY OLDER COPY IS LEFT
 * UNTOUCHED: each is the record of how one set of published numbers was
 * produced, and must stay reproducible.
 *
 * WHAT THIS RIG IS FOR, AND HOW IT DIFFERS FROM EVERY RIG BEFORE IT. t7o split
 * Phase B into components and found the team half: 7.6 ± 1.8 ms of the tick's
 * 17.5 ms. But that 7.6 ms is an INCREMENT inside an already-warm invocation —
 * the request had already read D1, deserialized and folded before the team loop
 * started. A split tick's second chunk is a SEPARATE invocation that pays its
 * own start-up, so 7.6 ms is a LOWER BOUND on what it would cost, never an
 * answer. This rig measures the chunk itself.
 *
 * THEREFORE, UNUSUALLY FOR THIS RIG FAMILY: the headline figure is an ABSOLUTE
 * cpuTime, not a difference. Every previous headline here was a difference, and
 * differences cancel per-invocation overhead — which is exactly the term under
 * examination now, so it must NOT be cancelled. An absolute is only meaningful
 * within the reused-isolate stratum; see `HEADLINE_ABSOLUTES` below.
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
 * incomparable with the 17.5 ms and 7.6 ms anchors this measurement exists to
 * be read against, which is the only continuity a verdict can rest on.
 */
const WARM_ROSTER = [
  "frc1", "frc100", "frc10000", "frc10002", "frc10004", "frc10011", "frc10014",
  "frc10015", "frc10016", "frc10017", "frc10019", "frc1002", "frc10021", "frc10029",
  "frc10032", "frc10034", "frc10043", "frc10045", "frc10050", "frc10059", "frc10063",
].join(",");

/**
 * `event=` is pinned alongside `teams=` so the probe SKIPS discovery (orchestrator, 2026-09-16).
 * Each discovery query is an `ORDER BY scope_key` scan — about 2,100 rows read apiece against a
 * 5,000,000 rows/day free-tier cap — and the 2026-09-15 campaign (~740 requests) spent 5.5M rows on
 * discovery alone, exhausting the account's D1 reads for the UTC day. Every read then fails,
 * INCLUDING a live tick's. `2026alhu` is what discovery resolved to anyway, so the measured work is
 * unchanged. Keep both overrides together: dropping either one turns discovery back on.
 *
 * The two `chunk=teams` arms REFUSE to run without both of them rather than
 * falling back to discovery, so for those two this pinning is not merely
 * prudent — it is required.
 */
const PINNED_EVENT = "2026alhu";

export const COMMON_QUERY = `season=2026&teamCount=21&folded=2&upcoming=60&algorithms=spr&teams=${WARM_ROSTER}&event=${PINNED_EVENT}`;

/**
 * The five arms, in a fixed order.
 *
 * `query` is the arm-specific fragment appended after `COMMON_QUERY`.
 * `expectedId` is `params.rpArm.id`.
 * `expectedPhaseB` is `params.phaseB`.
 * `expectedPhaseBArmId` is `params.phaseBArm.id`.
 * `expectedPhaseBUpcoming` is `params.phaseBUpcoming`.
 * `expectedChunk` is `params.chunk` — NEW, and required on every arm including
 *   the three that carry it as `off`.
 *
 * ALL FIVE ARE CHECKED AT THE WARM-UP GATE. Without the fifth, the gate would
 * happily record the two chunk arms as one of the existing ones: `chunkTeams`
 * echoes `rpArm.id: "all"`, `phaseB: false` and `phaseBArm.id: "all"`, which is
 * character-for-character what the `all` arm echoes. It would then attribute a
 * cpuTime to an arm that never ran — the exact failure the fourth field was
 * added to prevent, one field further along.
 *
 * NOTE ON THE TWO CHUNK ARMS' rp/phaseB ECHOES: those params were PARSED and
 * NOT USED. `chunk=teams` runs no fold and no Phase B emulation at all, and
 * says so in its own first warning. Do not read `rpArm.id: "all"` there as
 * evidence that an RP path ran.
 */
export const ARMS = [
  {
    name: "all",
    query: "rp=1",
    expectedId: "all",
    expectedPhaseB: false,
    expectedPhaseBArmId: "all",
    expectedPhaseBUpcoming: "published",
    expectedChunk: "off",
    meaning: "Phase A alone — state read, fold, serialize, discard. The floor every other arm sits on",
  },
  {
    name: "allPhaseB",
    query: "rp=1&phaseB=1",
    expectedId: "all",
    expectedPhaseB: true,
    expectedPhaseBArmId: "all",
    expectedPhaseBUpcoming: "published",
    expectedChunk: "off",
    meaning: "the UNSPLIT full tick — Phase A plus all of Phase B. Measured 17.5 ms mean / p50 16 on 2026-09-17",
  },
  {
    name: "pbTeams0",
    query: "rp=1&phaseB=1&phaseBTeams=0",
    expectedId: "all",
    expectedPhaseB: true,
    expectedPhaseBArmId: "all",
    expectedPhaseBUpcoming: "published",
    expectedChunk: "off",
    meaning:
      "the CRON-SIDE chunk: Phase A plus the event half of Phase B with zero team merges. This is what chunk=event points at rather than adding a second code path. Measured 9.9 ms mean / p50 9 / 31% over on 2026-09-17",
  },
  {
    name: "chunkTeams",
    query: "chunk=teams",
    expectedId: "all",
    expectedPhaseB: false,
    expectedPhaseBArmId: "all",
    expectedPhaseBUpcoming: "published",
    expectedChunk: "teams",
    meaning:
      "THE ARM THE VERDICT TURNS ON: the teams-only consumer chunk as its OWN invocation — one event GET, reconstruct the merge inputs from its published played rows, then twelve team parses and merges. No D1 read, no deserialize, no fold. Read its ABSOLUTE cpuTime, not a difference",
  },
  {
    name: "chunkTeams0",
    query: "chunk=teams&phaseBTeams=0",
    expectedId: "all",
    expectedPhaseB: false,
    expectedPhaseBArmId: "all",
    expectedPhaseBUpcoming: "published",
    expectedChunk: "teams",
    meaning:
      "the same chunk with its team loop forced to zero — the chunk's FIXED OVERHEAD, dominated by parsing a ~106 KB event artifact it reads two rows out of. NOT padding: if this term is what breaks the bar, the fix is a message payload carrying those two rows instead of an artifact read, and only this arm can show that. THE ONE DROPPABLE ARM if the campaign must be shorter",
  },
];

/** `name -> arm`, for quick lookup by the driver's `--arms` flag and the analyzer's joins. */
export const ARMS_BY_NAME = new Map(ARMS.map((arm) => [arm.name, arm]));

/** Arms that run the `chunk=teams` path. They fold NOTHING and run NO Phase B, so every fold and phaseB counter reads 0 in them by construction — which is why they are excluded from those cross-arm pins below rather than failing them. */
export const CHUNK_ARMS = ARMS.filter((arm) => arm.expectedChunk === "teams").map((arm) => arm.name);

/**
 * THE PRE-REGISTERED BAR, written down BEFORE the run, in the words the plan's
 * ORCHESTRATOR-RUN section states it — carried here as DATA so the threshold
 * cannot drift between the plan and the analysis once a number is in front of
 * anyone.
 *
 * A chunk in the 10-13 ms band is a FAILURE of this bar, not a near miss to be
 * argued around after the fact. The one legitimate follow-up on a miss is the
 * specific one `chunkTeams0` exists to expose, and that is a NEW measurement,
 * not a reinterpretation of this one.
 */
export const PRE_REGISTERED_BAR = {
  arm: "chunkTeams",
  stratum: "reused",
  p50MaxMs: 8,
  meanMaxMs: 9,
  statedBefore:
    "2026-09-17, in .planning/quick/260917-0p3-measure-a-split-tick-chunk-before-buildi/260917-0p3-PLAN.md's ORCHESTRATOR-RUN section, BEFORE the run",
  text:
    "Splitting the tick is worth building only if the teams chunk lands comfortably under 10 ms on the reused-isolate stratum: p50 at or under 8 ms AND mean at or under 9 ms.",
  onMiss:
    "Splitting moves the cost without fixing it and the recommendation is to STOP — record that as the finding and close the direction. The one legitimate follow-up is the chunkTeams0 question: if the chunk's fixed overhead dominates and the team merges are cheap, the next question is a message payload carrying the played rows rather than an event-artifact read, and that is a NEW measurement.",
};

/**
 * The arms whose ABSOLUTE cpuTime is a reported figure rather than an input to
 * a difference. UNUSUAL FOR THIS RIG — every previous headline was a
 * difference — and stated here so nobody quotes one from the pooled column: an
 * absolute is meaningful only within the reused-isolate stratum, because a
 * fresh isolate pays platform cold-start (40.8 ms for `allPhaseB` on
 * 2026-09-17) that a difference would have cancelled.
 */
export const HEADLINE_ABSOLUTES = [
  { arm: "chunkTeams", meaning: "the teams chunk's own cost as a separate invocation — THE figure the verdict is decided on" },
  { arm: "chunkTeams0", meaning: "the chunk's fixed overhead: everything but the team loop, dominated by the event-artifact parse" },
  { arm: "allPhaseB", meaning: "the unsplit tick, for continuity against 17.5 ms" },
  { arm: "pbTeams0", meaning: "the cron-side chunk, for continuity against 9.9 ms" },
];

/**
 * What the 2026-09-17 t7o campaign measured on the SAME pinned roster and
 * event. If these do not reproduce, this run is not comparable to that one and
 * the chunk number must not be published either — a chunk figure is only worth
 * anything next to the in-tick increment it is being weighed against.
 */
export const CONTINUITY_ANCHORS = [
  { label: "allPhaseB (absolute mean, reused)", expected: 17.5, toleranceMs: 3.0, kind: "absolute", arm: "allPhaseB" },
  { label: "pbTeams0 (absolute mean, reused)", expected: 9.9, toleranceMs: 3.0, kind: "absolute", arm: "pbTeams0" },
  { label: "teamHalf (difference, reused)", expected: 7.6, toleranceMs: 3.6, kind: "difference", difference: "teamHalf" },
];

/**
 * MEASURED pairwise differences: each is two real arms, subtracted.
 *
 * There are only three now. The thirteen-arm Phase B component breakdown is
 * NOT repeated here — t7o's rig is left intact and is the place to re-run it.
 * See `RETIRED_DIFFERENCES`.
 */
export const DIFFERENCES = [
  {
    label: "phaseB",
    minuend: "allPhaseB",
    subtrahend: "all",
    meaning: "ALL of Phase B on top of a full RP Phase A — the continuity anchor against t7o's +11.8 ms",
  },
  {
    label: "teamHalf",
    minuend: "allPhaseB",
    subtrahend: "pbTeams0",
    meaning:
      "THE IN-TICK TEAM HALF as re-measured today: twelve team artifacts' parse + guard + merge + stringify, as an INCREMENT inside an already-warm invocation. The 7.6 ± 1.8 ms anchor. If this does not reproduce, the run is not comparable and the chunk number must not be published",
  },
  {
    label: "chunkTeamHalf",
    minuend: "chunkTeams",
    subtrahend: "chunkTeams0",
    meaning:
      "THE SAME TEAM HALF measured INSIDE the chunk: the twelve parses and merges with the chunk's fixed overhead subtracted out. Compare against teamHalf — a large gap between the two means the loop itself costs differently in a cold-ish separate invocation, not just that the invocation has overhead",
  },
];

/**
 * DERIVED residuals. NOT measured arm differences: each is a linear combination
 * of ARM MEANS, so its standard error is computed from the arm variances
 * directly (sqrt(Σ cᵢ² · varᵢ / nᵢ)) rather than by adding the SEs of
 * differences that share an arm and are therefore correlated.
 *
 * Read every row as an ESTIMATE WITH A REMAINDER IN IT. A residual absorbs
 * whatever the named terms did not account for, including non-additivity
 * between them.
 */
export const DERIVED_DIFFERENCES = [
  {
    label: "splitPenalty",
    expression: "chunkTeams(absolute) - teamHalf",
    coefficients: { chunkTeams: 1, allPhaseB: -1, pbTeams0: 1 },
    meaning:
      "THE NUMBER THIS WHOLE EXERCISE IS ABOUT: what a split COSTS. The chunk's absolute mean minus the same work's in-tick increment — everything a second invocation pays that an increment inside a warm one does not. A small penalty means the split is nearly free; a large one means splitting moves the cost rather than removing it (DERIVED)",
  },
];

/**
 * Counters that MUST be identical across every sample of every arm where the
 * component that produces them actually RAN. A mismatch means the arms are not
 * comparable and the numbers must be discarded — the analyzer reports it and
 * exits non-zero rather than averaging over it.
 *
 * `excluded` lists the arms where a skip legitimately zeroes the field. `all`
 * is excluded from every phaseB row (it runs no Phase B at all), and BOTH
 * CHUNK ARMS are excluded from every one of them: `chunk=teams` runs neither
 * the fold nor the Phase B emulation, so a zero there is the arm working as
 * designed, not a mismatch.
 */
export const PHASE_B_CONSTANT_WHERE_RAN = [
  { field: "playedRowFactsBuilt", excluded: ["all", ...CHUNK_ARMS], note: "playedRowFactsFor runs in EVERY phaseB arm regardless of skips, so it cancels in every difference" },
  { field: "eventArtifactBytes", excluded: ["all", ...CHUNK_ARMS], note: "the fetched bytes — the fetch is unskippable, so every phaseB arm must see the same artifact" },
  { field: "mergedEventBytes", excluded: ["all", ...CHUNK_ARMS], note: "the stringified merged event" },
  { field: "mergedEventStateRows", excluded: ["all", ...CHUNK_ARMS], note: "the spliced state block's row count" },
  { field: "mergedEventUpcomingRows", excluded: ["all", ...CHUNK_ARMS], note: "rebuilt from Phase A's schedule" },
  { field: "mergedEventPlayedRows", excluded: ["all", ...CHUNK_ARMS], note: "the merged played rows" },
  { field: "teamParsesRun", excluded: ["all", "pbTeams0", ...CHUNK_ARMS], note: "one JSON.parse per loop iteration, so it equals phaseBTeams" },
  { field: "teamMergesRun", excluded: ["all", "pbTeams0", ...CHUNK_ARMS], note: "the team merges" },
  { field: "mergedTeamBytes", excluded: ["all", "pbTeams0", ...CHUNK_ARMS], note: "the summed stringified team bytes" },
];

/**
 * The chunk-side replacements for the pins above: the counters that must agree
 * across the arms where the chunk ran, so a chunk cpuTime difference is a cost
 * difference and not two chunks reconstructing different things.
 *
 * `participating` is the opposite polarity from `excluded` above on purpose:
 * only two arms run the chunk at all, so naming them is shorter and cannot
 * drift when an arm is added.
 */
export const CHUNK_CONSTANT_WHERE_RAN = [
  { field: "matchesReconstructed", participating: CHUNK_ARMS, note: "both chunk arms rebuild the same played rows — the loop count is the only thing that differs" },
  { field: "artifactsFetched", participating: CHUNK_ARMS, note: "one event GET plus one team GET, in both" },
  { field: "eventArtifactBytes", participating: CHUNK_ARMS, note: "the same fetched event artifact" },
  { field: "playedRowFactsBuilt", participating: CHUNK_ARMS, note: "playedRowFactsFor runs before the team loop, so phaseBTeams=0 does not change it" },
  { field: "matchesWithActualBonusFlags", participating: CHUNK_ARMS, note: "the bonus inversion runs before the team loop too — a drop to 0 here means the published rows changed under the campaign" },
  { field: "teamParsesRun", participating: ["chunkTeams"], note: "twelve parses in the full chunk arm; chunkTeams0 legitimately reports 0 and is not part of this group" },
  { field: "teamMergesRun", participating: ["chunkTeams"], note: "twelve merges in the full chunk arm; chunkTeams0 legitimately reports 0" },
];

/**
 * Differences the t7o rig reported that this one does NOT, listed so a reader
 * diffing the two tables can see the rows were dropped on purpose rather than
 * lost. t7o's rig is left intact and is the place to re-run any of them.
 */
export const RETIRED_DIFFERENCES = [
  { label: "eventHalf", wasMinuend: "allPhaseB", wasSubtrahend: "pbSkipEventParse", reason: "a Phase B component breakdown — this rig prices a split boundary, not Phase B's internals; re-run t7o's rig, unchanged, for it" },
  { label: "eventValidate", wasMinuend: "allPhaseB", wasSubtrahend: "pbSkipEventValidate", reason: "same — and it collapsed to 0.7 ± 0.4 ms, unresolved, after fix F2" },
  { label: "eventMergeAndStringify", wasMinuend: "allPhaseB", wasSubtrahend: "pbSkipEventMerge", reason: "same" },
  { label: "eventStringify", wasMinuend: "allPhaseB", wasSubtrahend: "pbSkipEventStringify", reason: "same" },
  { label: "teamValidate", wasMinuend: "allPhaseB", wasSubtrahend: "pbSkipTeamValidate", reason: "same — 1.0 ± 2.1 ms, unresolved, after F2" },
  { label: "teamMergeAndStringify", wasMinuend: "allPhaseB", wasSubtrahend: "pbSkipTeamMerge", reason: "same" },
  { label: "teamStringify", wasMinuend: "allPhaseB", wasSubtrahend: "pbSkipTeamStringify", reason: "same" },
  { label: "eventValidateScheduledShape", wasMinuend: "pbSchedAll", wasSubtrahend: "pbSchedSkipEventValidate", reason: "the union-order question, answered by t7o: since F2 the tick's read path runs no union parse at all" },
  { label: "eventHalfScheduledShape", wasMinuend: "pbSchedAll", wasSubtrahend: "pbSchedSkipEventParse", reason: "same" },
  {
    label: "unionOrderPenalty",
    wasMinuend: "(derived)",
    wasSubtrahend: "(derived)",
    reason: "measured at -0.3 ± 2.6 ms against a >= 3 ms bar and left unresolved; F1 was never built and the read path has since changed under it",
  },
];
