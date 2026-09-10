/**
 * Unified cold-start predicate (D-01, quick task 260909-t5q): a match is
 * cold start iff ALL SIX of its robots are making their CORPUS-GLOBAL first
 * appearance — zero prior PLAYED matches anywhere in the ingested corpus,
 * strictly before this match, evaluated walk-forward (predict-before-update,
 * matching this project's one standing rule for every algorithm).
 *
 * Dependency-free leaf: no Node APIs, no database import, so this module
 * stays importable unchanged by the Phase 4 Cloudflare Worker — the same
 * discipline `predictionValidity.ts` follows, and for the same reason this
 * is hoisted here rather than implemented three times (once per algorithm).
 * That triple implementation is exactly what "unify" in this task's name
 * means to end: OPR, EPA and BPR must consult this ONE predicate through
 * ONE seam (`packages/harness/replay.ts`'s `WalkForwardSimulator`) so all
 * three produce the identical excluded set.
 *
 * Why corpus-global, not per-algorithm state or season-global (D-01):
 *
 *   - Per-algorithm state ("has MY rating store seen this team?") was
 *     REJECTED. OPR is event-scoped, so a per-algorithm rule would flag
 *     every event's opening matches in every season and hand each algorithm
 *     a DIFFERENT excluded set — the opposite of unification, and it would
 *     make Compare's coverage rows disagree across algorithms exactly the
 *     way this task exists to stop.
 *   - Season-global first appearance was also REJECTED. It would flag every
 *     season's week-1 openers, not just the corpus's true first season
 *     (2016) — a much larger and less honest exclusion than the structural
 *     class this task targets.
 */

/** The minimal structural shape the index builder needs from a match — no MatchResult import, so this stays a leaf. */
export interface ColdStartCandidateMatch {
  readonly matchKey: string;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
}

/**
 * Builds the set of cold-start match keys from a chronological, played-match
 * stream. One pass, holding a mutable set of team keys already seen: for
 * each match, first ask whether ANY of its six teams is already in the seen
 * set (cold start iff the answer is no — i.e. NONE of the six has a prior
 * match), THEN add all six to the seen set. Asking before adding is what
 * makes this walk-forward — a team seen only in THIS match does not count
 * as a prior appearance for this match's own cold-start determination.
 *
 * The caller owns supplying a stream that is:
 *   - chronological, in this project's one total order (the same order
 *     `packages/corpus/db.ts`'s `selectMatchesChronological` produces), and
 *   - restricted to PLAYED matches (a match with no recorded winner cannot
 *     teach the predicate anything about who has played before).
 *
 * The definition is corpus-global per D-01: the caller's stream should
 * normally span the WHOLE ingested corpus, not one season or one event —
 * see `packages/harness/corpusColdStart.ts` for the harness-side builder
 * that supplies exactly that.
 */
export function buildColdStartIndex(chronologicalMatches: readonly ColdStartCandidateMatch[]): ReadonlySet<string> {
  const seenTeams = new Set<string>();
  const coldStartMatchKeys = new Set<string>();

  for (const match of chronologicalMatches) {
    const teams = [...match.redTeams, ...match.blueTeams];
    const anyTeamAlreadySeen = teams.some((team) => seenTeams.has(team));
    if (!anyTeamAlreadySeen) {
      coldStartMatchKeys.add(match.matchKey);
    }
    for (const team of teams) seenTeams.add(team);
  }

  return coldStartMatchKeys;
}

/**
 * Builds the frozen, mutation-proof empty set `NO_COLD_START_INDEX` is
 * assigned below. `Object.freeze` alone does NOT make `Set.prototype.add`
 * throw on a frozen instance (it silently mutates the internal slot
 * regardless — verified against this project's Node/V8 version), so the
 * throwing behavior is provided explicitly by overriding `add`/`delete`/
 * `clear` on this one instance before freezing it, rather than relying on a
 * platform guarantee that does not hold.
 */
function buildFrozenEmptyColdStartIndex(): ReadonlySet<string> {
  const set = new Set<string>();
  const refuseMutation = (): never => {
    throw new TypeError(
      "NO_COLD_START_INDEX is the shared empty sentinel for 'no corpus-global view available' — it must never be mutated. Build a real index via buildColdStartIndex instead."
    );
  };
  Object.defineProperty(set, "add", { value: refuseMutation, writable: false, configurable: false });
  Object.defineProperty(set, "delete", { value: refuseMutation, writable: false, configurable: false });
  Object.defineProperty(set, "clear", { value: refuseMutation, writable: false, configurable: false });
  return Object.freeze(set);
}

/**
 * The sentinel a caller passes when it has no corpus-global view to build a
 * real index from (mirrors `packages/harness/score.ts`'s
 * `ELIGIBILITY_NOT_CLAIMED` convention: a named exported constant whose doc
 * comment states what it costs, never an anonymous default a reader has to
 * infer).
 *
 * Cost of using this: NO match is ever flagged cold start, so
 * `WalkForwardSimulator`'s default behavior is byte-identical to before this
 * task — every existing caller that does not pass a real index is provably
 * unaffected by this feature's existence.
 */
export const NO_COLD_START_INDEX: ReadonlySet<string> = buildFrozenEmptyColdStartIndex();

/** The forced-tie probability every cold-start prediction carries (D-01). Exact, never a tolerance-based comparison. */
export const COLD_START_TIE_PROBABILITY = 0.5 as const;

/**
 * Returns a COPY of `prediction` with `pRedWin` forced to exactly
 * `COLD_START_TIE_PROBABILITY`, every other field forwarded unchanged.
 * Generic over any shape carrying a `pRedWin` number, so this stays agnostic
 * to the concrete `Prediction` interface (`packages/core/algorithms/types.ts`)
 * and to whatever wrapper `packages/harness/replay.ts`'s records add.
 *
 * `winner` (when present on `T`) is deliberately LEFT UNCHANGED: it is typed
 * red-or-blue with no tie member, and OPR's existing dead-even predictions
 * already carry a tiebroken winner alongside a 0.5 probability — leaving it
 * here is consistent with that existing convention, not a novel one.
 */
export function applyColdStartTie<T extends { pRedWin: number }>(prediction: T): T {
  return { ...prediction, pRedWin: COLD_START_TIE_PROBABILITY };
}
