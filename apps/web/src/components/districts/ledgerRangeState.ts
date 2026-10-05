/**
 * THE ONE RANGE STATE both Locks tabs read (quick tasks 260927-6bf and
 * 261004-uw4).
 *
 * THE RULE, once: ONE state feeds the chips, the two filter counts, the stat
 * line and every grand total dashed rule, on both tabs. A surface that built
 * any of those from a second derivation is how the District Locks headline
 * came to sit below its own printed likely range: the headline was the
 * midpoint of two MEDIAN projections and the range was the 10th to 90th
 * percentile of the per run line, two different quantities printed side by
 * side.
 *
 * Extracted from the champ tab's mechanism rather than copied beside it. The
 * champ names (`ChampRangeState`, `champRangeState`, `applyChampRangeState`,
 * `champCutoffView`) are now aliases of and delegations to what is here, and
 * the champ suites pass unedited, which is the proof that tab did not move.
 *
 * Pure: no React, no Worker type, and no estimator of its own. The line is
 * `predictedCutoff.ts`'s `simulatedLine`, and the percentile convention is the
 * one that function already reads.
 */
import type { DistrictLedgerShownCounts, DistrictLedgerShownState } from "./districtFieldOverlay.js";
import {
  simulatedLine,
  type ChampNoCallReason,
  type LedgerCutoffView,
  type PredictedCutoff,
  type SimulatedCutoffRange,
} from "./predictedCutoff.js";

/**
 * Exactly four arms (decision L2 and Jacob's 2026-09-27 chip timing decision):
 *
 * - `settled`: THE TAB'S OWN SHIPPED RULE STANDS and this state changes
 *   nothing. On both tabs that is a position where nothing is drawn any more.
 *   On the District Locks tab it is also the excluded team fallback; see
 *   `districtRangeState`.
 * - `pending`: something upstream of the line is still computing.
 * - `simulated`: the run is complete, excluded no team and returned a line:
 *   its median and its 10 to 90 likely range, from one call.
 * - `noCall`: a TERMINAL refusal, with its reason.
 *
 * Every transient condition maps to `pending`, never `noCall`, so a reader can
 * only ever see `pending` to `simulated`, `pending` to `noCall`, or anything
 * to `settled`.
 */
export type LedgerRangeState =
  | { readonly kind: "settled" }
  | { readonly kind: "pending" }
  | { readonly kind: "simulated"; readonly points: number; readonly likely: SimulatedCutoffRange }
  | { readonly kind: "noCall"; readonly reason: ChampNoCallReason };

/** What a contending team's chip SHOWS while the simulated line is not in hand: a neutral placeholder, never the tab's verdict level rule. */
export type LedgerRangeCall = "pending" | "noCall";

/** A Worker run as a range state needs to see it: whether one was built, and the hook's state. */
export interface LedgerRangeRunInput {
  /** Whether the builder returned a run to post. */
  readonly built: boolean;
  readonly status: "idle" | "running" | "complete" | "error";
  /** For `complete`: whether the result's signature is the CURRENT run's. A stale result is still pending. */
  readonly current?: boolean;
}

/** The run the LINE is read from: the run input, plus what a completed run says about its field and its line. */
export interface LedgerRangeLineRunInput extends LedgerRangeRunInput {
  readonly excludedTeams?: readonly string[];
  readonly cutoffByRun?: ArrayLike<number>;
  readonly draws?: number;
}

/**
 * The state a line run alone decides, in order: not built is a refusal, a
 * failed run is a refusal, anything not complete for the current inputs is
 * pending, a run that left a team out is a refusal, a run with no line is a
 * refusal, and otherwise the line.
 */
export function rangeStateFromRun(run: LedgerRangeLineRunInput): LedgerRangeState {
  if (!run.built) return { kind: "noCall", reason: "runRefused" };
  if (run.status === "error") return { kind: "noCall", reason: "workerError" };
  if (run.status !== "complete" || run.current === false) return { kind: "pending" };
  if ((run.excludedTeams?.length ?? 0) > 0) return { kind: "noCall", reason: "teamsExcluded" };
  const line = run.draws === undefined ? undefined : simulatedLine(run.cutoffByRun, run.draws);
  if (line === undefined) return { kind: "noCall", reason: "noLine" };
  return { kind: "simulated", points: line.points, likely: line.likely };
}

export interface DistrictRangeStateInputs {
  /** The kind of `predictedCutoff` at this position: the boundary rule's own reading. */
  readonly boundaryKind: PredictedCutoff["kind"];
  /** The per event run's signature, `null` while it is in flight. */
  readonly perEventRunSignature: string | null;
  /** The per event run FAILED in the Worker: terminal, never `pending` forever. Absent reads as false. */
  readonly perEventRunFailed?: boolean;
  /** The district advancement chance run, whose per run line the headline is read from. */
  readonly run: LedgerRangeLineRunInput;
}

/**
 * THE DISTRICT LOCKS TAB'S RANGE STATE (quick task 261004-uw4).
 *
 * THE THREE WAY RULE, while anything is still open:
 *
 * 1. THE RUN LANDED AND LEFT NO TEAM OUT: `simulated`. The headline is the
 *    median of the per run line, its likely range is the 10th to 90th
 *    percentile from the SAME call, and In range and Out of range cut at that
 *    number.
 * 2. THE RUN LANDED BUT LEFT A TEAM OUT: `settled`, the excluded team
 *    fallback. The simulated line there is the slot th highest of a SMALLER
 *    field, so it is not the district's line, and withholding every team's
 *    chance for one team whose grand total could not be built is the
 *    regression quick task 260925-uf8 closed. So the tab's shipped rule
 *    stands exactly as it did: the boundary midpoint as the predicted cutoff
 *    with no likely range, In range and Out of range cut at the median
 *    projections, and every other team's chance still printed.
 * 3. NOTHING USABLE CAME BACK: `pending` while either run is in flight (no
 *    figure, no dashed rule, Pending chips), and `noCall` with its reason
 *    when a run failed or could not be built (no figure, No call chips).
 *    Never a headline built from fallback projections, which is how a failed
 *    run came to print a predicted cutoff of zero with every team In range.
 *
 * `settled` is ALSO every position where the boundary rule did not predict
 * (final, absent, capacity unknown): the simulated line replaces only the
 * boundary rule's `predicted` arm, and nothing in flight or failed can turn a
 * settled position into a pending or refused one.
 *
 * WHY "NOT BUILT" IS `teamsExcluded`. With a predicted boundary the capacity
 * is published, the district has teams and a pool team is still open; with a
 * landed per event run the signature is not null. `prepareChanceRanking` can
 * then refuse only through its three exclusion bounds (the excluded set could
 * fill the capacity, nothing open survived the exclusion, or nothing survived
 * at all), and each of those means teams' grand totals could not be built.
 */
export function districtRangeState(inputs: DistrictRangeStateInputs): LedgerRangeState {
  if (inputs.boundaryKind !== "predicted") return { kind: "settled" };
  if (inputs.perEventRunFailed === true) return { kind: "noCall", reason: "workerError" };
  if (inputs.perEventRunSignature === null) return { kind: "pending" };

  const { run } = inputs;
  if (!run.built) return { kind: "noCall", reason: "teamsExcluded" };
  // The excluded team fallback: only for a run that LANDED for the current
  // inputs. A failed run is still a refusal and a run in flight is still
  // pending, both decided by `rangeStateFromRun` below.
  const landed = run.status === "complete" && run.current !== false;
  if (landed && (run.excludedTeams?.length ?? 0) > 0) return { kind: "settled" };
  return rangeStateFromRun(run);
}

/**
 * The minimum one team's status result must carry for the range state to call
 * it again. `rangeCall` is named here, optional, so a result that never
 * carried one (the district tier's) and one that may (a displayed result)
 * both satisfy it.
 */
export interface RangeCallableStatusResult {
  readonly status: DistrictLedgerShownState;
  readonly rangeCall?: LedgerRangeCall;
}

/**
 * The minimum a status model must carry. STRUCTURAL, the pattern
 * `ChanceRankingTeam`, `VerdictLookup` and `CutoffRankingTeam` already use, so
 * the district tier's `DistrictLedgerStatusModel` and the champ tier's
 * `ChampLedgerStatusModel` both satisfy it with no adapter, and every other
 * field of either model passes through by spread.
 */
export interface RangeCallableStatusModel<Result extends RangeCallableStatusResult> {
  readonly byTeam: ReadonlyMap<string, Result>;
  readonly counts: DistrictLedgerShownCounts;
}

/** The minimum the chips and the cutoff view read per team: the median the tab's own sort ordered on. */
export interface RangeCallableTeam {
  readonly teamKey: string;
  readonly projection: number;
}

/** One team's DISPLAYED status. `rangeCall` is set only for a contending team whose In range or Out of range call is withheld. */
export type LedgerDisplayStatusResult<Result extends RangeCallableStatusResult> = Result & { readonly rangeCall?: LedgerRangeCall };

/** The four fields the range state decides. Everything else on a status model is the verdicts' and passes through. */
export interface LedgerDisplayFields<Result extends RangeCallableStatusResult> {
  readonly byTeam: ReadonlyMap<string, LedgerDisplayStatusResult<Result>>;
  readonly counts: DistrictLedgerShownCounts;
  /** Set while the In range and Out of range calls are withheld: their filter chips print an em dash, never a count. */
  readonly withheld: LedgerRangeCall | undefined;
  /** The named terminal reason, for the `noCall` arm alone. */
  readonly noCallReason: ChampNoCallReason | undefined;
}

/** The statuses the chips render: the verdict model, with the contending teams' calls taken from the range state. */
export type LedgerDisplayStatusModel<Model, Result extends RangeCallableStatusResult> = Omit<Model, "byTeam" | "counts"> & LedgerDisplayFields<Result>;

/** The four decided fields, from the verdicts' own map and counts. Generic over the result alone, so no field of it is lost. */
function rangeCalledFields<Result extends RangeCallableStatusResult>(
  verdicts: ReadonlyMap<string, Result>,
  verdictCounts: DistrictLedgerShownCounts,
  teams: readonly RangeCallableTeam[],
  state: LedgerRangeState
): LedgerDisplayFields<Result> {
  // The SAME map and the SAME counts object: a settled position hands back
  // exactly what the verdicts produced.
  if (state.kind === "settled") return { byTeam: verdicts, counts: verdictCounts, withheld: undefined, noCallReason: undefined };
  const projectionByTeam = new Map(teams.map((team) => [team.teamKey, team.projection] as const));
  const byTeam = new Map<string, LedgerDisplayStatusResult<Result>>();
  const counts: { -readonly [Key in keyof DistrictLedgerShownCounts]: DistrictLedgerShownCounts[Key] } = { ...verdictCounts, inRange: 0, outOfRange: 0 };
  for (const [teamKey, result] of verdicts) {
    if (result.status !== "inRange" && result.status !== "outOfRange") {
      byTeam.set(teamKey, result);
      continue;
    }
    if (state.kind === "simulated") {
      const projection = projectionByTeam.get(teamKey);
      const status = projection !== undefined && projection >= state.points ? "inRange" : "outOfRange";
      counts[status] += 1;
      byTeam.set(teamKey, { ...result, status });
      continue;
    }
    byTeam.set(teamKey, { ...result, status: "capacityUnknown", rangeCall: state.kind });
  }
  return {
    byTeam,
    counts,
    withheld: state.kind === "simulated" ? undefined : state.kind,
    noCallReason: state.kind === "noCall" ? state.reason : undefined,
  };
}

/**
 * THE CHIPS, from the ONE range state the cutoff view also reads.
 *
 * Touches ONLY contending teams, the ones the tab's verdict level rule called
 * In range or Out of range. Locked, the award locked variants, Locked out,
 * Prequalified and the capacity refusal come straight from the verdicts in
 * every arm, so they render immediately, and every other field of the model
 * passes through untouched.
 *
 * - `settled`: the tab's shipped rule, unchanged.
 * - `simulated`: In range iff the median projection is at or above the line.
 * - `pending` and `noCall`: the call is WITHHELD. The team is carried as
 *   `capacityUnknown`, the one state that already means no chip call, no
 *   chance line and visible under every filter, with `rangeCall` naming why,
 *   and the two counts read as withheld. The verdict level ordering never
 *   leaves this function in these two arms.
 */
export function applyLedgerRangeState<Result extends RangeCallableStatusResult, Model extends RangeCallableStatusModel<Result>>(
  statuses: Model & RangeCallableStatusModel<Result>,
  teams: readonly RangeCallableTeam[],
  state: LedgerRangeState
): LedgerDisplayStatusModel<Model & RangeCallableStatusModel<Result>, Result> {
  const { byTeam, counts, ...verdictFields } = statuses;
  return { ...verdictFields, ...rangeCalledFields<Result>(byTeam, counts, teams, state) };
}

export interface LedgerCutoffViewOptions {
  /** The ONE state the chips were cut with. */
  readonly state: LedgerRangeState;
  /** The tab's own sorted rows. */
  readonly teams: readonly RangeCallableTeam[];
  /** The DISPLAYED statuses: `applyLedgerRangeState`'s output for the same state. */
  readonly displayStatus: (teamKey: string) => string | undefined;
  /** The tab's shipped boundary view, built only for the `settled` arm. */
  readonly settledView: () => LedgerCutoffView;
  /** Whether the `simulated` arm carries its likely range. */
  readonly showLikelyRange: boolean;
  /** Stamped on the returned view in every arm when supplied, and omitted entirely when not. */
  readonly tier?: "district";
}

/**
 * THE CUTOFF VIEW, from the SAME state the chips read, so the stat line, every
 * grand total dashed rule and every chip describe one number:
 *
 * - `settled`: the tab's shipped boundary view, unchanged.
 * - `pending`: no figure, no range, no dashed rule.
 * - `noCall`: `unavailable`, carrying the reason, and no dashed rule.
 * - `simulated`: a `predicted` arm with `source: "simulated"` printing the
 *   simulated line. Its boundary pair is the lowest In range median and the
 *   highest Out of range median as the chips were cut, the line itself
 *   standing in for an empty side, so the between property holds by
 *   construction.
 */
export function ledgerCutoffView(options: LedgerCutoffViewOptions): LedgerCutoffView {
  const { state } = options;
  const tier = options.tier === undefined ? {} : { tier: options.tier };
  if (state.kind === "settled") return options.tier === undefined ? options.settledView() : { ...options.settledView(), ...tier };
  if (state.kind === "pending") return { cutoff: { kind: "pending" }, likely: undefined, districtOnly: false, ...tier };
  if (state.kind === "noCall") return { cutoff: { kind: "unavailable", reason: state.reason }, likely: undefined, districtOnly: false, ...tier };
  let lowestIn = Number.POSITIVE_INFINITY;
  let highestOut = Number.NEGATIVE_INFINITY;
  for (const team of options.teams) {
    const status = options.displayStatus(team.teamKey);
    if (status === "inRange") lowestIn = Math.min(lowestIn, team.projection);
    else if (status === "outOfRange") highestOut = Math.max(highestOut, team.projection);
  }
  const boundary = {
    above: Number.isFinite(lowestIn) ? lowestIn : state.points,
    below: Number.isFinite(highestOut) ? highestOut : state.points,
  };
  return {
    cutoff: { kind: "predicted", points: state.points, boundary, source: "simulated" },
    likely: options.showLikelyRange ? state.likely : undefined,
    districtOnly: false,
    ...tier,
  };
}
