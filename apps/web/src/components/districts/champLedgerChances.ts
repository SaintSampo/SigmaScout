/**
 * The Champ Locks tab's two PURE chance halves: the "to be there" chance that
 * weights the DCMP row, and the SECOND advancement run over the champ grand
 * totals.
 *
 * No React, no `Worker`, and no estimator of its own. Both runs go through the
 * shipped `useDistrictAdvancementChance` hook and the shipped
 * `advancementChances` draws; this module owns only the widening, the
 * composition and the narrowing.
 *
 * WHY THERE IS NO PER-RUN FIELD MEMBERSHIP HERE. Requirement 2's "to be there"
 * chance is the per-team MARGINAL, which `advancementChances` already returns
 * as `chanceByTeam` — that map is literally the share of runs in which a team
 * sits inside the district's points slots, which IS the chance of being in the
 * DCMP field. Conditioning the DCMP's own predictions on a per-run field would
 * be a different and larger piece of work (an optional `membershipByRun` inside
 * `packages/core/districts/advancementChance.ts`'s existing per-run loop), and
 * it is deliberately not built: the DCMP's predictions come from the shipped
 * per-event machinery on the DCMP event artifact's REAL roster, so no run needs
 * a field of its own.
 *
 * THE CHIP STILL WINS. `reconcileChampAdvancementChances` is the shipped
 * narrowing at the champ tier: a chance prints under In range and Out of range
 * alone, and a disagreement with a guarantee is counted and never printed.
 */
import type {
  AdvancementChanceAwardDraw,
  AdvancementChanceInputs,
  AdvancementChanceTeam,
  AdvancementChanceWeightedTeam,
} from "../../../../../packages/core/districts/advancementChance.js";
import { awardBaseRate, awardPointsBucketIndex } from "../../../../../packages/core/districts/awardBaseRates.js";
import {
  DCMP_DRAWN_AWARD_TYPES,
  champCutoffTuning,
  dcmpAwardCountDistribution,
  hypotheticalDcmpPart,
  hypotheticalDcmpTable,
  normalizedFieldRanks,
  type ChampCutoffSetting,
  type DcmpDrawnAwardType,
} from "../../../../../packages/core/districts/hypotheticalDcmp.js";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import {
  prepareChanceRanking,
  reconcileAdvancementChances,
  type DistrictAdvancementChanceRun,
  type DistrictLedgerChanceModel,
} from "./districtLedgerChances.js";
import { awardProfileOrZero, deriveStageFromState, tierEvents, type DistrictStageFinality } from "./districtLedgerRows.js";
import type { DistrictLedgerStatusModel } from "./districtLedgerStatus.js";
import { dcmpEventKeyFor, type ChampDcmpEstimate, type ChampLedgerTeam } from "./champLedgerRows.js";
import type { ChampLedgerStatusModel } from "./champLedgerStatus.js";
import {
  SHOW_SIMULATED_CHAMP_LIKELY_RANGE,
  simulatedChampLine,
  type ChampNoCallReason,
  type LedgerCutoffView,
  type SimulatedCutoffRange,
} from "./predictedCutoff.js";

/**
 * THE CHANCE OF BEING IN THE DISTRICT CHAMPIONSHIP FIELD, per team.
 *
 * The district-tier run's raw marginal, WIDENED BY THE DISTRICT-TIER VERDICTS
 * so a guarantee is never printed as a probability:
 *
 * - `locked` and `prequalified` read exactly 1. They are in the field.
 * - `lockedOut` reads exactly 0. They are not.
 * - `inRange` and `outOfRange` read the marginal, which is the whole question.
 * - Every other team — an unpublished capacity, or a team the run could not
 *   rank — is ABSENT from the returned map, which reads as `undefined` at the
 *   call site and is DISCLOSED there as `gaps.teamsWithoutFieldChance`.
 *
 * A SILENT ZERO WOULD BE THE WORST ANSWER AVAILABLE. It erases every DCMP point
 * from a bubble team's grand total and sorts it down the table, which is a far
 * larger lie than an absence the tab names.
 *
 * This is the one and only new consumer of the shipped district run: no second
 * estimator, and no change to `packages/core`.
 */
export function districtFieldMembershipChances(
  rawChanceByTeam: ReadonlyMap<string, number>,
  districtStatuses: DistrictLedgerStatusModel
): ReadonlyMap<string, number> {
  const byTeam = new Map<string, number>();
  for (const [teamKey, result] of districtStatuses.byTeam) {
    if (result.status === "locked" || result.status === "prequalified") {
      byTeam.set(teamKey, 1);
      continue;
    }
    if (result.status === "lockedOut") {
      byTeam.set(teamKey, 0);
      continue;
    }
    if (result.status !== "inRange" && result.status !== "outOfRange") continue;
    const raw = rawChanceByTeam.get(teamKey);
    if (raw === undefined) continue;
    byTeam.set(teamKey, raw);
  }
  return byTeam;
}

export interface BuildChampAdvancementChanceRunOptions {
  readonly artifact: DistrictArtifact;
  /** The champ rows built AT THIS POSITION, in `champLedgerRows.ts`'s own sorted order. */
  readonly teams: readonly ChampLedgerTeam[];
  /** The champ verdicts at the SAME position — the source of the qualifier sets. */
  readonly statuses: ChampLedgerStatusModel;
  /** The per-event run's own signature when its result is in hand, or `null` while a run is in flight. `null` suppresses the request entirely. */
  readonly runSignature: string | null;
  /** The rewind position id, so moving the slider always re-runs. */
  readonly positionId: string;
  /** The dcmp event key this fold read — a district whose championship key changes is a different race. */
  readonly dcmpEventKey: string | undefined;
  /** The per-team field chance the grand totals were mixed at. A moving field chance moves every grand total, so it moves the signature. */
  readonly fieldChanceByTeam: ReadonlyMap<string, number>;
  /**
   * CHAMP MODE (quick task 260927-6bf): the DCMP award draw specs from
   * `buildChampAwardDraws`. When SUPPLIED, even as an empty array, each team
   * is posted as its split district and DCMP parts so the run decides the
   * winning alliance and the drawn awards per run. When ABSENT the shipped
   * run is posted byte for byte.
   */
  readonly awardDraws?: readonly AdvancementChanceAwardDraw[];
}

/**
 * The champ chance signature.
 *
 * MIRRORS `chanceSignature`'s composition — the artifact's identity and publish
 * timestamp, the capacity, the position, the per-event run's signature, the
 * qualifier sets, the reservation and each team's own grand-total shape — and
 * adds the two things only this tier has: the dcmp event key, and the per-team
 * FIELD CHANCE. The field chance is in it because it is an input the grand
 * totals are a function of and nothing else in the list moves with it: a
 * district run that shifts one bubble team from 40% to 60% leaves the artifact,
 * the position, the per-event signature and every grand-total LENGTH untouched,
 * so a signature blind to it would leave the champ chances quietly stale in the
 * minutes they matter.
 */
function champChanceSignature(
  options: BuildChampAdvancementChanceRunOptions,
  chanceTeams: AdvancementChanceInputs["teams"],
  excludedTeams: readonly string[]
): string {
  const { artifact, statuses, runSignature, positionId, dcmpEventKey, fieldChanceByTeam } = options;
  return [
    excludedTeams.join("+"),
    artifact.districtKey,
    artifact.generation,
    artifact.computedAt,
    String(artifact.cmpSlots),
    dcmpEventKey ?? "-",
    positionId,
    runSignature ?? "",
    String(statuses.reservedSlots),
    statuses.awardQualified.join("+"),
    statuses.prequalified.join("+"),
    [...fieldChanceByTeam]
      .map(([teamKey, chance]) => `${teamKey}=${chance.toFixed(6)}`)
      .sort()
      .join(","),
    chanceTeams.map((team) => `${team.teamKey}=${String(team.counts.length)}/${String(team.denominator)}`).join(","),
    // CHAMP MODE ONLY, appended so the shipped signature is unchanged without it:
    // the award draw spec and each team's DCMP part, both inputs the line is a
    // function of and nothing above moves with.
    ...(options.awardDraws === undefined
      ? []
      : [
          champModeSignature(options.awardDraws),
          chanceTeams
            .map((team) =>
              team.dcmp === undefined
                ? `${team.teamKey}:-`
                : `${team.teamKey}:${String(team.dcmp.counts.length)}/${String(team.dcmp.denominator)}@${team.dcmp.fieldChance.toFixed(6)}w${team.dcmp.winChance.toFixed(6)}`
            )
            .join(","),
        ]),
  ].join("|");
}

function champModeSignature(awardDraws: readonly AdvancementChanceAwardDraw[]): string {
  const weighted = (entries: readonly AdvancementChanceWeightedTeam[]): string =>
    entries.map((entry) => `${entry.teamKey}*${entry.weight.toFixed(6)}`).join(";");
  return awardDraws
    .map(
      (draw) =>
        `${String(draw.awardType)}[${draw.countWeights.map((weight) => weight.toFixed(6)).join(";")}]{${weighted(draw.candidates)}}` +
        draw.pendingEvents.map((event) => `(${event.eventKey}:${weighted(event.entrants)})`).join("")
    )
    .join("/");
}

/**
 * The SECOND advancement run: each team's CHAMP grand total (the variant-A
 * mixture, chance of being in the field already folded in) ranked against
 * `artifact.cmpSlots`.
 *
 * Every refusal is `prepareChanceRanking`'s — the shipped four, plus the two
 * exclusion bounds — reading `cmpSlots` in place of `dcmpSlots`. Nothing is
 * restated here but the capacity.
 */
export function buildChampAdvancementChanceRun(
  options: BuildChampAdvancementChanceRunOptions
): DistrictAdvancementChanceRun | undefined {
  const { artifact, teams, statuses, runSignature, awardDraws } = options;
  const prepared = prepareChanceRanking(teams, artifact.cmpSlots, runSignature);
  if (prepared === undefined) return undefined;

  // CHAMP MODE: the SAME included teams (every refusal and the exclusion rule
  // above are untouched), each posted as its split district and DCMP parts.
  const byKey = new Map(teams.map((team) => [team.teamKey, team] as const));
  const chanceTeams: AdvancementChanceTeam[] =
    awardDraws === undefined
      ? prepared.chanceTeams
      : prepared.chanceTeams.map((chanceTeam) => {
          const team = byKey.get(chanceTeam.teamKey);
          if (team?.districtPart === undefined) return chanceTeam;
          const dcmp = team.dcmpPart;
          return {
            teamKey: chanceTeam.teamKey,
            counts: team.districtPart.counts,
            denominator: team.districtPart.denominator,
            ...(dcmp === undefined
              ? {}
              : {
                  dcmp: {
                    counts: dcmp.distribution.counts,
                    denominator: dcmp.distribution.denominator,
                    fieldChance: dcmp.fieldChance,
                    winChance: dcmp.winChance,
                  },
                }),
          };
        });

  const inputs: AdvancementChanceInputs = {
    teams: chanceTeams,
    slots: artifact.cmpSlots!,
    awardQualified: statuses.awardQualified,
    prequalified: statuses.prequalified,
    // ALWAYS ZERO at this tier — `champLedgerStatus.ts`'s decision 2. The run
    // must count the slots exactly as the verdicts beside it did.
    reservedSlots: statuses.reservedSlots,
    ...(awardDraws === undefined ? {} : { awardDraws }),
  };
  return {
    inputs,
    signature: champChanceSignature(options, chanceTeams, prepared.excludedTeams),
    excludedTeams: prepared.excludedTeams,
  };
}

/**
 * The shipped narrowing at the champ tier: a chance prints under In range and
 * Out of range alone, and a disagreement with a guarantee is counted in `gaps`
 * and never printed.
 *
 * Delegates to `reconcileAdvancementChances` rather than restating it, so the
 * two tabs cannot come to disagree about which chips may carry a number.
 */
export function reconcileChampAdvancementChances(
  chanceByTeam: ReadonlyMap<string, number>,
  champStatuses: ChampLedgerStatusModel
): DistrictLedgerChanceModel {
  return reconcileAdvancementChances(chanceByTeam, champStatuses);
}

// ---------------------------------------------------------------------------
// The simulated line (quick task 260927-6bf)
// ---------------------------------------------------------------------------

/**
 * THE FIELD CHANCE, including the settled district tier.
 *
 * `districtFieldMembershipChances`' rule, with one case it could not see:
 * where the district run was REFUSED because no district team has an open
 * category (`districtTierSettled`), there is no marginal to read, and In range
 * reads 1 and Out of range 0 — the verdicts are final there, so the field is a
 * settled tie of facts. While the district run is in flight (`raw` absent and
 * the tier not settled) In range and Out of range are ABSENT, never a guess.
 */
export function champFieldChances(
  districtStatuses: DistrictLedgerStatusModel,
  rawChanceByTeam: ReadonlyMap<string, number> | undefined,
  districtTierSettled: boolean
): ReadonlyMap<string, number> {
  const byTeam = new Map<string, number>();
  for (const [teamKey, result] of districtStatuses.byTeam) {
    if (result.status === "locked" || result.status === "prequalified") {
      byTeam.set(teamKey, 1);
      continue;
    }
    if (result.status === "lockedOut") {
      byTeam.set(teamKey, 0);
      continue;
    }
    if (result.status !== "inRange" && result.status !== "outOfRange") continue;
    const raw = rawChanceByTeam?.get(teamKey);
    if (raw !== undefined) {
      byTeam.set(teamKey, raw);
      continue;
    }
    if (rawChanceByTeam === undefined && districtTierSettled) byTeam.set(teamKey, result.status === "inRange" ? 1 : 0);
  }
  return byTeam;
}

/** One district team as the estimate reads it: its district projection. */
export interface HypotheticalDcmpEstimateTeam {
  readonly teamKey: string;
  readonly projection: number;
}

export interface HypotheticalDcmpEstimatesOptions {
  readonly season: number;
  /** The DISTRICT pass's teams at this position: the projection a field rank is taken on. */
  readonly districtTeams: readonly HypotheticalDcmpEstimateTeam[];
  /** In 1, out 0, open the field chance; `undefined` for an open team whose chance is not in yet. */
  readonly fieldChanceFor: (teamKey: string) => number | undefined;
  /** K3, from `champCutoffTuning(season).setting.spreadScale`. */
  readonly spreadScale: number;
}

/**
 * The three results the estimate can give, kept apart because they mean
 * different things to `champRangeState`: `noTable` is TERMINAL (no earlier
 * season to learn from), `awaitingFieldChances` is TRANSIENT (a field chance
 * is still coming).
 */
export type HypotheticalDcmpEstimates =
  | { readonly kind: "ready"; readonly byTeam: ReadonlyMap<string, ChampDcmpEstimate> }
  | { readonly kind: "noTable" }
  | { readonly kind: "awaitingFieldChances" };

/**
 * Every district team's DCMP estimate by FIELD RANK: the team's place in the
 * field chance weighted ranking of the district projections, looked up in the
 * walk-forward table for the season. Nothing about the real DCMP roster is
 * read, which is what keeps a rewound position free of registrations.
 */
export function hypotheticalDcmpEstimates(options: HypotheticalDcmpEstimatesOptions): HypotheticalDcmpEstimates {
  const table = hypotheticalDcmpTable(options.season);
  if (table === undefined) return { kind: "noTable" };
  const ranked: { teamKey: string; projection: number; fieldChance: number }[] = [];
  for (const team of options.districtTeams) {
    const fieldChance = options.fieldChanceFor(team.teamKey);
    if (fieldChance === undefined) return { kind: "awaitingFieldChances" };
    ranked.push({ teamKey: team.teamKey, projection: team.projection, fieldChance });
  }
  const ranks = normalizedFieldRanks(ranked);
  const byTeam = new Map<string, ChampDcmpEstimate>();
  for (const team of ranked) {
    const part = hypotheticalDcmpPart(table, ranks.get(team.teamKey)!, options.spreadScale);
    byTeam.set(team.teamKey, { distribution: { counts: part.counts, denominator: part.denominator }, winChance: part.winChance });
  }
  return { kind: "ready", byTeam };
}

export interface BuildChampAwardDrawsOptions {
  readonly artifact: DistrictArtifact;
  /** The stage per event AT THE POSITION; `undefined` at now, where each event's own `state` block answers. */
  readonly stageByEvent?: ReadonlyMap<string, DistrictStageFinality>;
  /** Overrides the season's walk-forward setting; the backtest passes each grid setting explicitly. */
  readonly setting?: ChampCutoffSetting;
}

/** Impact weights by the 10 point award cell, Engineering Inspiration and Rookie All Star by the 8 point one. */
const DECORATION_POINTS: Readonly<Record<DcmpDrawnAwardType, number>> = { 0: 10, 9: 8, 10: 8 };

/**
 * One team's weight for one DCMP award. ELIGIBILITY FIRST: Rookie All Star is
 * rookies only, Engineering Inspiration veterans only, Impact anyone. A team
 * with no award profile reads the ZERO profile (Jacob, 2026-09-27): a veteran
 * with no decorations, so it is ineligible for Rookie All Star, exactly as
 * before, and under `decoration` it weighs as the `none` bucket rather than 1.
 * `decoration` weights by the award base rate cell the award cell already
 * prices from, falling back to 1 for a season with no table.
 */
function awardWeight(team: DistrictArtifact["teams"][number], awardType: DcmpDrawnAwardType, season: number, setting: ChampCutoffSetting): number {
  const profile = awardProfileOrZero(team);
  if (awardType === 10 && profile.rookieState !== "rookie") return 0;
  if (awardType === 9 && profile.rookieState === "rookie") return 0;
  if (setting.weighting === "uniform") return 1;
  try {
    const rate = awardBaseRate(season, profile.bucket, profile.rookieState);
    return rate.pmf[awardPointsBucketIndex(DECORATION_POINTS[awardType])!] ?? 0;
  } catch {
    return 1;
  }
}

/**
 * The DCMP judged award draws for the champ run at one position (Impact,
 * Engineering Inspiration, Rookie All Star, in that order).
 *
 * - NONE once the DCMP awards stage is final at the position: posted awards
 *   are facts already in `statuses.awardQualified`.
 * - Candidates are the teams holding that award at a DISTRICT tier event
 *   whose award stage is final at the position: the DCMP winner of a judged
 *   award had won the same award at a district event that season in 148 of
 *   149 (Impact), 110 of 111 (EI) and 84 of 85 (RAS) cases.
 * - Each district event whose award stage is still open contributes one
 *   entrant per run from its own roster, which is public before the event.
 * - A DCMP tier award is NEVER a candidate.
 */
export function buildChampAwardDraws(options: BuildChampAwardDrawsOptions): AdvancementChanceAwardDraw[] {
  const { artifact, stageByEvent } = options;
  const season = artifact.year;
  const setting = options.setting ?? champCutoffTuning(season).setting;

  const nowAwardFinal = new Map<string, boolean>();
  const districtEventKeys = new Set<string>();
  const entrantsByEvent = new Map<string, DistrictArtifact["teams"][number][]>();
  for (const team of artifact.teams) {
    for (const tier of ["district", "dcmp"] as const) {
      for (const entry of tierEvents(team, tier)) {
        if (!nowAwardFinal.has(entry.eventKey)) nowAwardFinal.set(entry.eventKey, deriveStageFromState(entry.state).final.award);
        if (tier !== "district") continue;
        districtEventKeys.add(entry.eventKey);
        const list = entrantsByEvent.get(entry.eventKey) ?? [];
        list.push(team);
        entrantsByEvent.set(entry.eventKey, list);
      }
    }
  }
  const awardFinal = (eventKey: string): boolean => stageByEvent?.get(eventKey)?.award ?? nowAwardFinal.get(eventKey) ?? false;

  const dcmpEventKey = dcmpEventKeyFor(artifact);
  if (dcmpEventKey !== undefined && awardFinal(dcmpEventKey)) return [];

  const countWeights = dcmpAwardCountDistribution(season, artifact.districtKey, artifact.cmpSlots ?? 0, setting.countMode);
  const pendingKeys = [...districtEventKeys].filter((eventKey) => !awardFinal(eventKey)).sort();

  return DCMP_DRAWN_AWARD_TYPES.map((awardType) => {
    const candidates: AdvancementChanceWeightedTeam[] = [];
    for (const team of artifact.teams) {
      const held = team.qualifyingAwards.some(
        (award) => award.awardType === awardType && districtEventKeys.has(award.eventKey) && awardFinal(award.eventKey)
      );
      if (held) candidates.push({ teamKey: team.teamKey, weight: awardWeight(team, awardType, season, setting) });
    }
    const pendingEvents = pendingKeys.map((eventKey) => ({
      eventKey,
      entrants: (entrantsByEvent.get(eventKey) ?? []).map((team) => ({ teamKey: team.teamKey, weight: awardWeight(team, awardType, season, setting) })),
    }));
    return { awardType, countWeights: [...countWeights[awardType]], candidates, pendingEvents };
  });
}

/** The TERMINAL refusal reasons, declared beside the cutoff arm that carries them. */
export type { ChampNoCallReason };

/**
 * THE ONE STATE both the chips and the cutoff view read (decision L2 and
 * Jacob's 2026-09-27 chip timing decision). Exactly four arms:
 *
 * - `settled`: the DCMP awards stage is final at the position, or `cmpSlots`
 *   is null. Nothing is drawn any more, so the shipped rank rule stands.
 * - `pending`: something upstream of the line is still computing.
 * - `simulated`: the champ run is complete, excluded no team and returned a
 *   line: its median and its 10 to 90 likely range.
 * - `noCall`: a TERMINAL refusal, with its reason.
 *
 * Every transient condition maps to `pending`, never `noCall`, so a reader can
 * only ever see `pending` to `simulated`, `pending` to `noCall`, or anything
 * to `settled` when the slider moves.
 */
export type ChampRangeState =
  | { readonly kind: "settled" }
  | { readonly kind: "pending" }
  | { readonly kind: "simulated"; readonly points: number; readonly likely: SimulatedCutoffRange }
  | { readonly kind: "noCall"; readonly reason: ChampNoCallReason };

/** A Worker run as `champRangeState` needs to see it: whether one was built, and the hook's state. */
export interface ChampRangeRunInput {
  /** Whether the builder returned a run to post. */
  readonly built: boolean;
  readonly status: "idle" | "running" | "complete" | "error";
  /** For `complete`: whether the result's signature is the CURRENT run's. A stale result is still pending. */
  readonly current?: boolean;
}

export interface ChampRangeStateInputs {
  /** The DCMP awards stage is final at the position. */
  readonly dcmpAwardsFinal: boolean;
  readonly cmpSlots: number | null;
  /** The per event run's signature, `null` while it is in flight. */
  readonly perEventRunSignature: string | null;
  /** The per event run FAILED in the Worker: terminal, never `pending` forever. Absent reads as false. */
  readonly perEventRunFailed?: boolean;
  readonly districtRun: ChampRangeRunInput;
  readonly estimates: HypotheticalDcmpEstimates["kind"];
  /** Teams whose membership is `in` but whose DCMP row could not be priced. */
  readonly unpricedInTeams: number;
  readonly champRun: ChampRangeRunInput & {
    readonly excludedTeams?: readonly string[];
    readonly cutoffByRun?: ArrayLike<number>;
    readonly draws?: number;
  };
}

/** Pure, and read by BOTH the chips and the cutoff view, so the two can never disagree. */
export function champRangeState(inputs: ChampRangeStateInputs): ChampRangeState {
  if (inputs.dcmpAwardsFinal || inputs.cmpSlots === null) return { kind: "settled" };
  if (inputs.perEventRunFailed === true) return { kind: "noCall", reason: "workerError" };
  if (inputs.perEventRunSignature === null) return { kind: "pending" };

  const district = inputs.districtRun;
  if (district.built) {
    if (district.status === "error") return { kind: "noCall", reason: "workerError" };
    if (district.status !== "complete" || district.current === false) return { kind: "pending" };
  }

  if (inputs.estimates === "noTable") return { kind: "noCall", reason: "noHistoryTable" };
  // Awaiting a field chance is transient only while the per event run or the
  // district run is on its way, and both of those returned `pending` above;
  // with neither coming, the missing chance is final.
  if (inputs.estimates === "awaitingFieldChances") return { kind: "noCall", reason: "noFieldChance" };
  if (inputs.unpricedInTeams > 0) return { kind: "noCall", reason: "unpricedDcmp" };

  const champ = inputs.champRun;
  if (!champ.built) return { kind: "noCall", reason: "runRefused" };
  if (champ.status === "error") return { kind: "noCall", reason: "workerError" };
  if (champ.status !== "complete" || champ.current === false) return { kind: "pending" };
  if ((champ.excludedTeams?.length ?? 0) > 0) return { kind: "noCall", reason: "teamsExcluded" };
  const line = champ.draws === undefined ? undefined : simulatedChampLine(champ.cutoffByRun, champ.draws);
  if (line === undefined) return { kind: "noCall", reason: "noLine" };
  return { kind: "simulated", points: line.points, likely: line.likely };
}

/** The minimum `champCutoffView` reads per team: its median, and the chip it is shown with. */
export interface ChampCutoffViewTeam {
  readonly teamKey: string;
  readonly projection: number;
}

export interface ChampCutoffViewOptions {
  /** The ONE state the chips were cut with. */
  readonly state: ChampRangeState;
  /** The tab's own sorted rows. */
  readonly teams: readonly ChampCutoffViewTeam[];
  /** The DISPLAYED statuses: `applyChampRangeState`'s output for the same state. */
  readonly displayStatus: (teamKey: string) => string | undefined;
  /** The shipped midpoint view, built only for the `settled` arm. */
  readonly settledView: () => LedgerCutoffView;
}

/**
 * THE CUTOFF VIEW, from the SAME `ChampRangeState` the chips read (decision
 * L2), so the stat line, every grand total dashed rule and every chip describe
 * one number:
 *
 * - `settled`: the shipped midpoint view, unchanged.
 * - `pending`: no figure, no range, no dashed rule.
 * - `noCall`: `unavailable`, carrying the reason, and no dashed rule.
 * - `simulated`: a `predicted` arm with `source: "simulated"` printing the
 *   simulated line. Its boundary pair is the lowest In range median and the
 *   highest Out of range median as the chips were cut, the line itself
 *   standing in for an empty side, so the between property holds by
 *   construction. The likely range rides along only while
 *   `SHOW_SIMULATED_CHAMP_LIKELY_RANGE` is on, which it is (Jacob,
 *   2026-09-27).
 */
export function champCutoffView(options: ChampCutoffViewOptions): LedgerCutoffView {
  const { state } = options;
  if (state.kind === "settled") return options.settledView();
  if (state.kind === "pending") return { cutoff: { kind: "pending" }, likely: undefined, districtOnly: false };
  if (state.kind === "noCall") return { cutoff: { kind: "unavailable", reason: state.reason }, likely: undefined, districtOnly: false };
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
    likely: SHOW_SIMULATED_CHAMP_LIKELY_RANGE ? state.likely : undefined,
    districtOnly: false,
  };
}
