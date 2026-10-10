/**
 * The Champ Locks tab's PURE row model: two rows per team — District points and
 * DCMP points — folded from TWO passes of the shipped
 * `buildDistrictLedgerRows`, one per tier, over the same distributions and the
 * same position.
 *
 * NO REACT IMPORT AND NO CALL TO `simulateDistrictEvent`, following
 * `districtLedgerRows.ts`'s own discipline exactly: gather, fold, disclose
 * every gap, call no simulator.
 *
 * WHY TWO PASSES RATHER THAN A SECOND BUILDER. Every cell rule this tab needs —
 * the grey-is-the-artifact's-own-number rule, the form assignment, the playoff
 * milestone, the alliance-selection routes, the per-team degradation — already
 * lives in `buildDistrictLedgerRows`, and quick task 260925-xab's whole premise
 * is that the two tabs must not drift. So that builder takes a tier and this
 * module folds its output; the only arithmetic invented here is the District
 * points row's per-category convolution across a team's district events, and
 * the mixture that weights the DCMP row by the chance of being in the field.
 *
 * VARIANT A (sketch 022). While a team's place in the District Championship
 * field is still open, the four DCMP cells print what the team would earn IF
 * THERE, unconditionally, and the chance of being there is folded in exactly
 * ONCE — into the grand total, through `mixFieldMembership`. Variant B (folding
 * the chance into every cell) was not built: it makes each cell honest alone at
 * the cost of erasing the "if there" amount a bubble team's reader is looking
 * for.
 *
 * AT THE LIVE POSITION A TEAM WITH NO CHAMPIONSHIP ROW READS OUT ONLY ONCE THE
 * FIELD IS PROVEN (quick task 261010-66y). The artifact learns a championship
 * key only from team rows, so a division or a second championship TBA has not
 * posted yet is invisible, and its teams used to read out of the field the
 * moment the posted event started: on the real 2026 FIM artifact walked one
 * division at a time, 41 Locked were taken back. One core rule decides
 * (`packages/core/districts/dcmpFieldProof.ts`): every field fixing key
 * started, every one carrying a posted row, and the field complete by
 * capacity, by a posted finals row or, in a season that is over, by Awards
 * final. `champFieldProofAtNow` reads it off the artifact and
 * `buildChampLedgerRows` hands every reader ONE flag, `fieldProven`: true at
 * every rewound position, and at the live position false exactly while some
 * field fixing key has started and the field is not proven. While it is
 * false a team with no row reads `open`, with its bubble chance and the
 * estimate row, exactly as it does before the championship starts. A team
 * with its own row is unchanged. The limits are stated in the core module's
 * header.
 *
 * AN UNPRICED DCMP GIVES A LABELLED DISTRICT-ONLY GRAND TOTAL, NOT A BLANK ONE.
 * This module first refused the grand total outright whenever it held no DCMP
 * distribution, on the reasoning that a district-only figure under a column
 * headed "Grand total" is a plausible, complete, wrong number. That reasoning
 * was right about the danger and wrong about the frequency: `remainingEvents`
 * is built from TBA REGISTRATIONS, and a team registers for its District
 * Championship only after it has qualified, so for most of the district season
 * nothing on the artifact names the DCMP at all — no event key to fetch, no
 * sidecar to read, and therefore a blank grand total for every team in the
 * district, all season.
 *
 * So the number is printed and LABELLED instead: the grand total falls back to
 * the district-only convolution, the team carries `grandTotalIsDistrictOnly`,
 * the DCMP row's cells read "not yet priced" rather than an em dash (which
 * already means "not in the field") or "not available" (which means a
 * prediction was attempted and refused), and the tab prints "district only"
 * under the figure. A reader is never shown a number without being told which
 * number it is. The team is still named in the disclosed gaps.
 *
 * A team OUTSIDE THE SIMULATED FIELD gets the same labelled district only
 * total (quick task 261007-mxf): at a rewound stop before the championship
 * starts, the DCMP is simulated over the Locked plus In range teams, and a
 * Locked out or Out of range team is priced at zero championship points. That
 * is a priced figure, not a missing one, so it is never named in
 * `teamsWithDistrictOnlyGrandTotal` and never suppresses the champ run.
 */
import { convolveDistrictGrandTotal } from "../../../../../packages/core/districts/ledgerSimulation.js";
import { pointPercentiles, pointQuantile, type PointPercentiles } from "../../../../../packages/core/districts/pointSummary.js";
import { maxEventPoints, type DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import { dcmpFieldProof, fieldFixingDcmpKeys, type DcmpFieldProof } from "../../../../../packages/core/districts/dcmpFieldProof.js";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import {
  DISTRICT_CATEGORIES,
  GRAND_TOTAL_CELL_ID,
  buildDistrictLedgerRows,
  deriveStageFromState,
  liveStageByEvent,
  openDistrictLedgerCell,
  pointMassDistribution,
  tierEvents,
  type DistrictCategory,
  type DistrictCellKind,
  type DistrictEventDistributions,
  type DistrictEventStage,
  type DistrictLedgerCell,
  type DistrictLedgerEventRow,
  type DistrictLedgerGaps,
  type DistrictLedgerTeam,
  type DistrictPointDistribution,
  type DistrictStageFinality,
  type SettledPlayoffs,
} from "./districtLedgerRows.js";

type DistrictTeam = DistrictArtifact["teams"][number];

/** The two rows every team carries, in the fixed order the table renders them. */
export const CHAMP_LEDGER_ROWS = ["district", "dcmp"] as const;

export type ChampLedgerRowKind = (typeof CHAMP_LEDGER_ROWS)[number];

/**
 * A champ-tier cell's drawer id.
 *
 * DELIBERATELY DISJOINT from `districtCellId`'s `eventKey:cell` ids: a
 * `?drawerCell=` shared between the two tabs must resolve on one of them and
 * nowhere on the other, never onto a neighbouring cell. An event key can never
 * be the literal `district-row` or `dcmp-row`.
 */
export function champCellId(row: ChampLedgerRowKind, cell: DistrictCellKind): string {
  return `${row}-row:${cell}`;
}

/** Whether a team is in the District Championship field at this position — a FACT once the DCMP has started, and an open question before. */
export type ChampFieldMembership = "in" | "out" | "open";

/**
 * One rendered champ cell.
 *
 * THREE VARIANTS PAST THE SHIPPED THREE, and with `unavailable` they are the
 * four readings an empty DCMP cell can give, each saying something different:
 *
 * - `notInField` — the team is not in the field: the DCMP has started without
 *   it, or the district tier has Locked it out. The cell prints an em dash.
 * - `notYetPriced` — the tab holds no DCMP distribution at all, because the
 *   artifact does not name the championship yet (the pre-registration window)
 *   or because no sidecar and no event artifact could be read for it. Nothing
 *   was predicted, so the cell says so in words.
 * - `outOfRange` — at a rewound stop before the championship starts, the DCMP
 *   is simulated over the Locked plus In range field (quick task 261007-mxf),
 *   and this team is outside that simulated field: "out of range".
 *
 * None is `unavailable`, which stays what it always was: a prediction was
 * attempted for this cell and refused.
 */
export type ChampLedgerCell =
  | DistrictLedgerCell
  | { readonly id: string; readonly cell: DistrictCellKind; readonly kind: "notInField" }
  | { readonly id: string; readonly cell: DistrictCellKind; readonly kind: "notYetPriced" }
  | { readonly id: string; readonly cell: DistrictCellKind; readonly kind: "outOfRange" };

/**
 * THE SIMULATED DCMP FIELD at a rewound stop before any championship has
 * started (quick task 261007-mxf), from the district tier's SHOWN statuses
 * (`champLedgerChances.ts` `dcmpSimulatedField`):
 *
 * - `pending` while the district line is still settling;
 * - `refused` where the roster cannot be decided (No call, or a team whose
 *   capacity is unknown);
 * - `ready` with the sorted roster (Prequalified, Locked and In range), the Out
 *   of range teams and nothing else.
 *
 * The Locked out set rides every arm, so an em dash renders at once.
 */
export type SimulatedDcmpField =
  | { readonly status: "pending"; readonly lockedOut: ReadonlySet<string> }
  | { readonly status: "refused"; readonly lockedOut: ReadonlySet<string> }
  | {
      readonly status: "ready";
      readonly roster: readonly string[];
      readonly outOfRange: ReadonlySet<string>;
      readonly lockedOut: ReadonlySet<string>;
    };

/** The Web Worker bake of the one generated championship over the simulated field (`useSimulatedDcmpBake.ts`). */
export type SimulatedDcmpBake =
  | { readonly status: "pending" }
  | { readonly status: "unavailable" }
  | { readonly status: "ready"; readonly distributions: DistrictEventDistributions };

/** The field and its bake, as `buildChampLedgerRows` reads them. */
export interface SimulatedDcmpPricing {
  readonly field: SimulatedDcmpField;
  readonly bake: SimulatedDcmpBake;
}

/** One team's reading under the simulated field: the readings table in quick task 261007-mxf's plan. */
type SimulatedDcmpReading =
  | { readonly kind: "lockedOut" }
  | { readonly kind: "outOfRange" }
  | { readonly kind: "pending" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "baked"; readonly record: Readonly<Record<DistrictCellKind, DistrictPointDistribution | undefined>> };

function simulatedDcmpReading(pricing: SimulatedDcmpPricing, teamKey: string): SimulatedDcmpReading {
  const { field, bake } = pricing;
  if (field.lockedOut.has(teamKey)) return { kind: "lockedOut" };
  if (field.status === "pending") return { kind: "pending" };
  if (field.status === "refused") return { kind: "unavailable" };
  if (field.outOfRange.has(teamKey)) return { kind: "outOfRange" };
  if (!field.roster.includes(teamKey)) return { kind: "unavailable" };
  if (bake.status === "pending") return { kind: "pending" };
  if (bake.status === "unavailable") return { kind: "unavailable" };
  const record = bake.distributions.byTeam.get(teamKey);
  return record === undefined ? { kind: "unavailable" } : { kind: "baked", record };
}

/**
 * One source event behind a row, for the row's small line ("{short name} Wk
 * {week + 1} · {stage word}"), and the per event facts the status module's
 * floor and ceiling read: the stage, and since quick task 261008-26o the
 * playoff points a knocked out team's Playoffs are settled at.
 */
export interface ChampLedgerSource {
  readonly eventKey: string;
  readonly eventName: string;
  readonly week: number | null;
  readonly stage: DistrictEventStage;
  /** The pass row's own `settledElim` (`DistrictLedgerEventRow`), present only where that row carries one. */
  readonly settledElim?: SettledPlayoffs;
}

/** One pass row as a source, copying `settledElim` only where it is defined so a source without it deep equals the shipped one. */
function sourceOf(row: DistrictLedgerEventRow): ChampLedgerSource {
  return {
    eventKey: row.eventKey,
    eventName: row.eventName,
    week: row.week,
    stage: row.stage,
    ...(row.settledElim === undefined ? {} : { settledElim: row.settledElim }),
  };
}

/** One of a team's two rows: its four category cells, its subtotal and the events behind it. */
export interface ChampLedgerRow {
  readonly kind: ChampLedgerRowKind;
  readonly cells: readonly ChampLedgerCell[];
  readonly subtotal: ChampLedgerCell;
  readonly sources: readonly ChampLedgerSource[];
  /**
   * True on a DCMP row priced from the walk-forward estimate by field rank
   * (`packages/core/districts/hypotheticalDcmp.ts`) rather than from the
   * championship's own event: its four category cells read "not yet priced"
   * and only its Subtotal is open. Always false on the District points row.
   */
  readonly estimated: boolean;
}

/** One team's District Championship part, as the champ run draws it. */
export interface ChampDcmpPart {
  readonly distribution: DistrictPointDistribution;
  /** 1 for a team in the field, the supplied chance for an open one. */
  readonly fieldChance: number;
  /** The chance of being on the DCMP winning alliance: the estimate's win share, or the event row's Playoffs mass at the winner value. */
  readonly winChance: number;
}

/** One team's walk-forward DCMP estimate, as `champLedgerChances.ts`'s `hypotheticalDcmpEstimates` hands it over. */
export interface ChampDcmpEstimate {
  readonly distribution: DistrictPointDistribution;
  readonly winChance: number;
}

/** One event at one tier, as the timeline and the fetch lists want it. */
export interface ChampTierEvent {
  readonly eventKey: string;
  readonly eventName: string;
  readonly week: number | null;
  readonly tier: DistrictTier;
}

/**
 * Every event the champ tab reads, across BOTH tiers, deduplicated and in the
 * order they were first seen: the district events the District points row sums
 * and the one District Championship the DCMP row prices.
 *
 * Moved here from `ChampLocksLedger.tsx` (quick task 260927-6bf) so the
 * offline backtest builds the same timeline the tab builds.
 */
export function champTierEvents(artifact: DistrictArtifact): ChampTierEvent[] {
  const byKey = new Map<string, ChampTierEvent>();
  for (const tier of ["district", "dcmp"] as const) {
    for (const team of artifact.teams) {
      for (const entry of tierEvents(team, tier)) {
        if (byKey.has(entry.eventKey)) continue;
        byKey.set(entry.eventKey, { eventKey: entry.eventKey, eventName: entry.eventName, week: entry.week, tier });
      }
    }
  }
  return [...byKey.values()];
}

/** One team's whole champ ledger entry: two rows, one grand total, and the projection the sort and the status both read. */
export interface ChampLedgerTeam {
  readonly teamKey: string;
  readonly teamNumber: number;
  readonly nickname: string;
  /** Exactly two rows, always `["district", "dcmp"]` in that order. */
  readonly rows: readonly ChampLedgerRow[];
  readonly districtRow: ChampLedgerRow;
  readonly dcmpRow: ChampLedgerRow;
  readonly membership: ChampFieldMembership;
  /** The chance this team is in the DCMP field, for a membership of `"open"` only. `undefined` where the run did not rank the team — DISCLOSED, never a silent zero. */
  readonly fieldChance: number | undefined;
  /**
   * A `DistrictLedgerCell`, never one of the two champ-only kinds: a grand
   * total is always a number, a prediction or an honest refusal. The DCMP row's
   * own cells carry "not in the field" and "not yet priced"; the grand total
   * beside them still has a district half to report.
   */
  readonly grandTotal: DistrictLedgerCell;
  /**
   * True when the grand total above is the DISTRICT-ONLY total: the tab holds
   * no DCMP distribution for this team, or (quick task 261007-mxf) the team is
   * outside the simulated Locked plus In range field at a rewound stop, where
   * its championship points are zero. The tab prints "district only" under the
   * figure; see this module's header for why the number is printed and
   * labelled rather than withheld.
   */
  readonly grandTotalIsDistrictOnly: boolean;
  /** The continuous median of the predicted grand total, or the earned all-tier total for a team with no open category. */
  readonly projection: number;
  readonly hasOpenCategory: boolean;
  /** 1-based index in the sorted order — the `#` the Team cell prints and the In range rank rule reads. */
  readonly position: number;
  readonly rookieBonus: number;
  /** The artifact's own `pointTotal`: the earned all-tier total at the end of the artifact. */
  readonly earnedAllTierTotal: number;
  /**
   * THE EARNED TOTAL AT THE POSITION (quick task 260927-6bf, finding 4): the
   * number the Team cell prints, the sort's first tie-break and the
   * unavailable grand total's fallback projection. At "now" it is exactly
   * `earnedAllTierTotal`. Rewound, it is `pointTotal` minus, over every
   * district and dcmp tier event, the earned points of each category not final
   * at the position: the same subtraction `champLedgerStatus.ts` makes for the
   * floor, so a rewound header never prints DCMP points earned later.
   */
  readonly earnedAtPosition: number;
  /**
   * The DISTRICT PART the champ run draws: the district subtotal convolved with
   * the rookie bonus and adjustments. `undefined` where the district subtotal
   * could not be built.
   */
  readonly districtPart: DistrictPointDistribution | undefined;
  /** The DCMP PART the champ run draws beside it. `undefined` for a team out of the field and for a district only team. */
  readonly dcmpPart: ChampDcmpPart | undefined;
  /**
   * WHETHER THIS TEAM CAN STILL TURN OUT TO BE IN THE FIELD (quick task
   * 261010-66y, reading R23): true exactly when the team has NO ROW AT A FIELD
   * FIXING KEY and the field is still open at the position by the rule a
   * team with no championship row reads (`fieldSettledForRowlessTeam`): not
   * every field fixing key has started, or at the live position the field is
   * not proven. False for every team with a row at a field fixing key, a
   * points row or a registration.
   *
   * READ BY THE STATUS MODULE ALONE, FOR THE CEILING ALONE
   * (`champLedgerStatus.ts`, decision 4): the one hypothetical championship
   * goes to a team for which this is true. Membership, the DCMP row's cells
   * and every display are what they were.
   *
   * WHY IT IS NOT `membership`. For a team with no championship row at all
   * the two say the same thing (this is true exactly when membership does
   * not read `out`). They differ for a team whose ONLY championship row is at
   * a divisioned championship's finals key: an award given at the finals to
   * a team that played in no division (20 such teams over the local
   * seasons). Its membership follows its finals row, which exists only
   * because the award was posted. At a stop before that it had no row at
   * all, and the ceiling must read it as the team with no row it then was,
   * or the ceiling reads the future off who ends with a finals row.
   *
   * Always set by `buildChampLedgerRows`. Optional only so a hand built team
   * needs no edit; absent, the status module reads the condition of before
   * this field existed (not `out`, and no championship source at all).
   */
  readonly fieldRowOpen?: boolean;
}

/** One row's contribution to the grand total, for the grand total drawer's two-row list. */
export interface ChampContribution {
  readonly row: ChampLedgerRowKind;
  readonly earned: number | undefined;
  readonly open: PointPercentiles | undefined;
  /** The chance the DCMP row is weighted by, on the DCMP row alone. `undefined` on the District points row and wherever the field is settled. */
  readonly fieldChance: number | undefined;
  /** True where this row contributed nothing because it was never priced — the list says so rather than printing "settled", which would claim the row is finished. */
  readonly notYetPriced: boolean;
}

/** Every gap the champ fold could not close: the two passes' own gaps, unioned, plus the one this tab adds. */
export interface ChampLedgerGaps extends DistrictLedgerGaps {
  /**
   * Teams whose place in the DCMP field is still OPEN and for which no field
   * chance was supplied — because the advancement run is still in flight, or
   * because it did not rank them at all.
   *
   * Their grand total folds the DCMP row in at a chance of ONE. A silent zero
   * would erase every DCMP point from a bubble team's grand total and sort it
   * down the table, which is a far larger lie than the one this disclosure
   * costs.
   */
  readonly teamsWithoutFieldChance: readonly string[];
  /**
   * Teams whose grand total is the DISTRICT-ONLY total because the tab holds no
   * DCMP distribution for them — the pre-registration window, or a
   * championship whose sidecar and event artifact could both not be read.
   *
   * Their figure is printed and labelled "district only" rather than withheld;
   * the champ ADVANCEMENT CHANCE is suppressed while this list is non-empty,
   * because ranking district-only totals against `cmpSlots` would rank a
   * different quantity than the column prints.
   *
   * A team outside the simulated field at a rewound stop (quick task
   * 261007-mxf) also carries a labelled district only total but is NEVER
   * named here: it is priced, at zero championship points, so its total is the
   * quantity the column prints and the champ run still runs.
   */
  readonly teamsWithDistrictOnlyGrandTotal: readonly string[];
}

export interface ChampLedgerRowsResult {
  readonly teams: readonly ChampLedgerTeam[];
  readonly gaps: ChampLedgerGaps;
  /** The FIRST dcmp-tier event key in sort order, or `undefined` where the district publishes none — kept for the chance run's signature; every other reader wants `dcmpEventKeys`. */
  readonly dcmpEventKey: string | undefined;
  /** Every dcmp-tier event key the artifact carries, sorted. One for almost every district; two for 2026 California. */
  readonly dcmpEventKeys: readonly string[];
  /**
   * THE ONE FLAG every reader of the field takes (quick task 261010-66y):
   * true at every rewound position, and at the live position false exactly
   * while some field fixing key has started and the field is not proven
   * (`champFieldProofAtNow`). A live caller of `computeChampLedgerStatuses`
   * must pass it on: absent reads true there.
   */
  readonly fieldProven: boolean;
}

/**
 * Every dcmp-tier event key the district publishes, unioned over every team's
 * `eventPoints` and `remainingEvents`, sorted.
 *
 * Empty when the district publishes none — a district whose championship is
 * not on the wire yet. The DCMP row's cells then render `unavailable` rather
 * than blank, and the grand total with them; see this module's header for why
 * that is the honest answer rather than a district-only fallback.
 *
 * MOST DISTRICTS PUBLISH ONE championship; 2026 California published two
 * (`2026cancmp`, `2026cascmp`, the same week, each with its own winners and
 * judged awards). Until quick task 261006-lwo this module read only the first
 * key, so the second championship's award winners never left the points pool
 * and three published-eliminated teams read Locked at Now. Every reader that
 * gates on "the DCMP" now walks this list; each team's own row is built from
 * its own championship by the dcmp pass, as it always was.
 */
export function dcmpEventKeysFor(artifact: DistrictArtifact): string[] {
  const keys = new Set<string>();
  for (const team of artifact.teams) for (const entry of tierEvents(team, "dcmp")) keys.add(entry.eventKey);
  return [...keys].sort();
}

/** The first of `dcmpEventKeysFor`, for the chance run's signature and the tests that pin it. Not a gate: see `dcmpEventKeysFor`. */
export function dcmpEventKeyFor(artifact: DistrictArtifact): string | undefined {
  return dcmpEventKeysFor(artifact)[0];
}

/**
 * The dcmp keys whose start FIXES THE FIELD (quick task 261009-pgq, D1): every
 * key except a divisioned championship's finals key.
 *
 * A key K is a finals key when another dcmp key is K plus one digit
 * (`2026micmp` beside `2026micmp1` to `2026micmp4`, `2026necmp` beside
 * `2026necmp1` and `2026necmp2`). The finals are played among the division
 * winners and admit nobody new, so they say nothing about who is in the field.
 * A single championship keeps its one key and 2026 California keeps both
 * (`2026cancmp`, `2026cascmp`: neither is the other plus a digit). Division
 * keys published without their parent are kept as they are.
 *
 * A rule on the keys alone, not a call to `championshipShape`, so a shape the
 * joint proof refuses still gets the same field rule.
 *
 * The function lives in `packages/core/districts/dcmpFieldProof.ts` since
 * quick task 261010-66y, beside the proof that reads it, and is re-exported
 * here so every import stands.
 */
export { fieldFixingDcmpKeys };

/**
 * THE FIELD PROOF AT NOW, from the artifact alone (quick task 261010-66y).
 * The started keys are the caller's (the state's own word, the field
 * reading); the awards final keys are the number reading
 * (`liveStageByEvent`); the rule is `dcmpFieldProof`. The tab computes it
 * once per artifact and hands every reader the one flag,
 * `!proof.unprovenAfterStart`; `buildChampLedgerRows` computes the same thing
 * where no flag is supplied at the live position.
 */
export function champFieldProofAtNow(artifact: DistrictArtifact, startedDcmpEventKeys: ReadonlySet<string>, nowYear: number): DcmpFieldProof {
  const awardsFinalKeys = new Set<string>();
  for (const [eventKey, final] of liveStageByEvent(artifact, ["dcmp"])) if (final.award) awardsFinalKeys.add(eventKey);
  return dcmpFieldProof({
    teams: artifact.teams,
    dcmpSlots: artifact.dcmpSlots,
    season: artifact.year,
    nowYear,
    startedKeys: startedDcmpEventKeys,
    awardsFinalKeys,
  });
}

/**
 * Whether THIS team's championship field question is settled at the position.
 *
 * A TEAM WITH ITS OWN dcmp ROW reads its own first key, as it always did.
 *
 * A TEAM WITH NO ROW is out of the field once every FIELD FIXING key has
 * started (`fieldFixingDcmpKeys`) AND THE FIELD IS PROVEN (`fieldProven`,
 * quick task 261010-66y): the one championship of a single district, both of
 * 2026 California's, and every DIVISION of a divisioned championship. The
 * keys are only the ones the artifact has seen. At a live championship TBA
 * can post one division, or one of two championships, before the others, and
 * every key the artifact then knows has started while most of the field is
 * on no row yet. So while the field is not proven
 * (`packages/core/districts/dcmpFieldProof.ts`) a team with no row is not
 * settled: it reads as it does before the championship starts. `fieldProven`
 * defaults to true, which is every rewound position and every caller that
 * reads a finished season.
 *
 * Until quick task 261009-pgq (D1) the rule waited for every dcmp key, the
 * finals key included. The finals start days after the divisions and list only
 * division winners, so at "Divisions final, finals not started" a rowless team
 * still carried one whole hypothetical DCMP (249 points in 2026) that nothing
 * could pay it. A single championship and two championships read exactly as
 * before, since every one of their keys is field fixing.
 *
 * WHAT THE RULE CANNOT SEE, MEASURED. A team REGISTERED at a division or a
 * single DCMP that earned no points there (judging only, or a no show) carries
 * no row at Now, so the artifact cannot tell it from an unregistered team.
 * Corpus 2023 to 2026, every single and division DCMP event: 18 such teams.
 * Every one is `eliminated` at Now, and every one finished at least 113 points
 * below its district's cut line (gaps 113 to 217, totals 0 to 56). A 45 point
 * award could not have carried one past a locked team.
 *
 * The one way left to such a team is a CONSUMING award, which takes a slot at
 * any point total. The joint proof already counts it: a rowless team read as
 * `out` stays in `rows.teams`, so `champLedgerStatus.ts` keeps it as a rival
 * in the proof's pool at extra 0, where one consuming award covers it.
 * `champLedgerStatus.test.ts` asserts that (the 261009-pgq guard). A district
 * whose rowless registrant sat near the line is the case to re-examine.
 */
export function dcmpStartedForTeam(team: DistrictTeam, startedDcmpEventKeys: ReadonlySet<string>, dcmpEventKeys: readonly string[], fieldProven = true): boolean {
  const own = tierEvents(team, "dcmp")[0]?.eventKey;
  if (own !== undefined) return startedDcmpEventKeys.has(own);
  return fieldSettledForRowlessTeam(startedDcmpEventKeys, dcmpEventKeys, fieldProven);
}

/**
 * THE RULE A TEAM WITH NO CHAMPIONSHIP ROW READS THE FIELD BY: the field is
 * settled, and such a team is out of it, once every FIELD FIXING key has
 * started and the field is proven (`fieldProven` is false only at the live
 * position while a field fixing key has started and the proof fails; quick
 * task 261010-66y). The no row branch of `dcmpStartedForTeam`, named so
 * `ChampLedgerTeam.fieldRowOpen` reads the same started set and the same
 * flag as membership does (reading R23).
 */
export function fieldSettledForRowlessTeam(startedDcmpEventKeys: ReadonlySet<string>, dcmpEventKeys: readonly string[], fieldProven = true): boolean {
  if (!fieldProven) return false;
  const fieldFixing = fieldFixingDcmpKeys(dcmpEventKeys);
  return fieldFixing.length > 0 && fieldFixing.every((key) => startedDcmpEventKeys.has(key));
}

/**
 * Whether the Champ Locks TABLE omits a team once the District Championship is
 * the selected event (quick task 261007-mxf): the team has no dcmp-tier row on
 * the artifact, so it is neither in the championship's field nor eligible for
 * an award there.
 *
 * A judging only registrant already carries a dcmp-tier row and is never
 * hidden; the hidden teams are exactly the membership `out` teams wherever one
 * championship is played. The predicate reads the row itself (the DCMP row's
 * empty `sources`), so it also hides a rowless team while a divisioned (FIM)
 * or two championship (2026 California) district has started one of them: a
 * team registered at no championship cannot attend any.
 *
 * The table only. The team stays in `rows.teams`, so the champ run, the
 * predicted cutoff, the disclosed gaps and the status counts still see it.
 *
 * A TEAM IS NOT HIDDEN AS "NOT IN THE FIELD" WHILE THE FIELD IS NOT PROVEN
 * (quick task 261010-66y). At a live championship the artifact may know one
 * division, or one of two championships, and a team with no row may be a
 * team of an event TBA has not posted yet. The caller hands `dcmpSelected`
 * as: a championship is the selected event AND the field is proven
 * (`ChampLedgerRowsResult.fieldProven`).
 */
export function champTeamHiddenAtDcmp(team: Pick<ChampLedgerTeam, "dcmpRow">, dcmpSelected: boolean): boolean {
  return dcmpSelected && team.dcmpRow.sources.length === 0;
}

/**
 * Whether a team is in the District Championship field, at a POSITION.
 *
 * THREE CASES, and the middle one is the correction this function took on
 * 2026-09-26:
 *
 * 1. THE DCMP HAS STARTED. The field is a fact: a team with a dcmp-tier
 *    `eventPoints` or `remainingEvents` entry is in it, and a team without one
 *    is not.
 * 2. IT HAS NOT STARTED AND THE READER IS AT THE LIVE POSITION. A dcmp-tier
 *    registration IS a qualification: `scripts/publishDistricts.ts` builds
 *    `remainingEvents` from TBA registrations, and TBA lists a team on the
 *    District Championship only after it has been invited. So a registered
 *    team reads `"in"` — the earlier `"open"` reading printed a bubble chance
 *    beside a team whose place was already settled. A team with NO dcmp row
 *    still reads `"open"`, never `"out"`: registrations arrive in batches and
 *    an absent one is not yet an exclusion.
 * 3. IT HAS NOT STARTED AND THE READER IS REWOUND. Every team the district
 *    verdict has not settled reads `"open"`, registration or not — at that
 *    position the registration is FUTURE KNOWLEDGE, and the whole point of the
 *    slider is to show what was known then. A team the district tier has
 *    already Locked still reads chance 1 through `champLedgerChances.ts`, so
 *    the certainty that WAS knowable is not lost.
 */
export function champFieldMembership(team: DistrictTeam, dcmpStarted: boolean, atLivePosition = false): ChampFieldMembership {
  const registered = tierEvents(team, "dcmp").length > 0;
  if (dcmpStarted) return registered ? "in" : "out";
  if (atLivePosition && registered) return "in";
  return "open";
}

/**
 * The DCMP subtotal weighted by the chance of being in the field:
 * `chance * total + (1 - chance) * pointMass(0)`, returned in THE one
 * distribution representation at denominator 1.
 *
 * THE TWO CERTAIN CASES ALLOCATE NOTHING AND CANNOT DRIFT. A `chance >= 1`
 * returns `total` itself and a `chance <= 0` returns a point mass at zero, so a
 * settled field never goes through a floating-point mixing step that could move
 * a median by a rounding error.
 */
export function mixFieldMembership(total: DistrictPointDistribution, chance: number): DistrictPointDistribution {
  if (!Number.isFinite(chance) || chance >= 1) return total;
  if (chance <= 0) return pointMassDistribution(0);
  const counts = new Float64Array(Math.max(total.counts.length, 1));
  for (let i = 0; i < total.counts.length; i++) counts[i] = (chance * (total.counts[i] ?? 0)) / total.denominator;
  counts[0]! += 1 - chance;
  return { counts, denominator: 1 };
}

export interface BuildChampLedgerRowsOptions {
  readonly artifact: DistrictArtifact;
  /** `eventKey -> the distributions the tab holds for it`, across BOTH tiers — the champ tab's one run covers the district events and the DCMP together. */
  readonly distributions: ReadonlyMap<string, DistrictEventDistributions>;
  /** `eventKey -> the stage at the current position`, across both tiers. Absent falls back to each row's own `state` block, which is the "now" answer. */
  readonly stageByEvent?: ReadonlyMap<string, DistrictStageFinality>;
  /**
   * `eventKey -> what has happened on the FIELD at the current position`,
   * across both tiers (quick task 261009-vp9). Forwarded to both tier passes,
   * where it answers one question only: whether selection is over, for the
   * not picked note. See `BuildDistrictLedgerRowsOptions.fieldStageByEvent`.
   */
  readonly fieldStageByEvent?: ReadonlyMap<string, DistrictStageFinality>;
  readonly unavailableEvents?: readonly { readonly eventKey: string; readonly name: string }[];
  readonly gaps?: Partial<DistrictLedgerGaps>;
  /**
   * `teamKey -> the chance the team is in the DCMP field`, for a membership of
   * `"open"`. A team absent from this map is named in
   * `gaps.teamsWithoutFieldChance` and folded at a chance of one.
   */
  readonly fieldChanceByTeam?: ReadonlyMap<string, number>;
  /**
   * Whether the District Championship has STARTED at this position — every
   * championship at once. Superseded by `startedDcmpEventKeys` where that is
   * supplied; kept for callers and tests with one championship. Defaults to
   * each dcmp event's own `state` block at "now".
   */
  readonly dcmpStarted?: boolean;
  /**
   * The dcmp-tier event keys that have STARTED at this position (quick task
   * 261006-lwo). The tab supplies the position-aware set so a rewind back past
   * a championship's first match reopens the field question in the same step;
   * `dcmpStartedForTeam` reads it per team.
   */
  readonly startedDcmpEventKeys?: ReadonlySet<string>;
  /**
   * Whether the reader is at the LIVE position rather than rewound. Defaults to
   * false, which is the conservative reading: a rewound position treats a
   * dcmp-tier registration as future knowledge. The tab supplies the real
   * answer — see `champFieldMembership`'s three cases.
   */
  readonly atLivePosition?: boolean;
  /**
   * `teamKey -> the walk-forward DCMP estimate by field rank` (quick task
   * 260927-6bf). A team whose field is not yet a fact at this position, or
   * whose championship the tab could not price, is priced from this instead of
   * reading "not yet priced"; see `buildDcmpRow`'s five cases.
   */
  readonly dcmpEstimateByTeam?: ReadonlyMap<string, ChampDcmpEstimate>;
  /**
   * THE SIMULATED DCMP (quick task 261007-mxf): supplied only at a rewound
   * stop before any championship has started, where the championship is baked
   * over the Locked plus In range field. A team whose field is not a fact is
   * read from it (`buildDcmpRow`'s case 3) and the estimate is never consulted.
   * Absent everywhere else, which is the shipped behaviour byte for byte.
   */
  readonly simulatedDcmp?: SimulatedDcmpPricing;
  /**
   * THE TAB'S OWN PENDING CONDITION (quick task 261007-4qr), passed to both
   * tier passes: see `BuildDistrictLedgerRowsOptions.distributionsPending`. A
   * subtotal folded from pending parts only is pending, and so is the grand
   * total when every part it lacks is. Absent reads as false, the shipped
   * behaviour.
   */
  readonly distributionsPending?: boolean;
  /**
   * WHETHER THE FIELD IS PROVEN (quick task 261010-66y): see
   * `ChampLedgerRowsResult.fieldProven`. The tab supplies the flag it computed
   * once per artifact. Absent, it is true at a rewound position and
   * `!champFieldProofAtNow(...).unprovenAfterStart` at the live one, so a
   * sweep, a script or a test is safe without passing it.
   */
  readonly fieldProven?: boolean;
  /**
   * The calendar year at the time of the call, for the field proof's season
   * over line. Read only where `fieldProven` is absent at the live position.
   * Defaults to the clock; a test passes it.
   */
  readonly nowYear?: number;
}

/**
 * Folds the two tier passes into two rows and one grand total per team, then
 * sorts.
 *
 * THE SORT: descending by the median projected grand total, then by the earned
 * all-tier total, then by team number. The tie-break asserts NOTHING about
 * which of two equal-projection teams is better — `rankRows.ts`'s own framing —
 * and the resulting 1-based `position` is both the `#` the Team cell prints and
 * what the champ status module's In range rank rule reads.
 */
export function buildChampLedgerRows(options: BuildChampLedgerRowsOptions): ChampLedgerRowsResult {
  const { artifact, distributions, stageByEvent, unavailableEvents = [], fieldChanceByTeam } = options;
  const season = artifact.year;
  const districtCeilings = maxEventPoints(season, "district");
  const dcmpCeilings = maxEventPoints(season, "dcmp");
  const districtEventTotalCeiling =
    districtCeilings.qual + districtCeilings.alliance + districtCeilings.elim + districtCeilings.award;
  const dcmpEventTotalCeiling = dcmpCeilings.qual + dcmpCeilings.alliance + dcmpCeilings.elim + dcmpCeilings.award;

  const dcmpEventKeys = dcmpEventKeysFor(artifact);
  const dcmpEventKey = dcmpEventKeys[0];
  // Which dcmp keys are a team's OWN championship (a division, a single DCMP)
  // rather than a divisioned championship's finals: computed once, and handed
  // to `buildDcmpRow` to pick each team's primary row (quick task 261009-tx8).
  const fieldFixingKeys: ReadonlySet<string> = new Set(fieldFixingDcmpKeys(dcmpEventKeys));
  const startedDcmpEventKeys: ReadonlySet<string> =
    options.startedDcmpEventKeys ??
    (options.dcmpStarted === undefined ? startedDcmpEventKeysAtNow(artifact) : options.dcmpStarted ? new Set(dcmpEventKeys) : new Set<string>());
  // THE ONE FLAG (quick task 261010-66y): true at every rewound position; at
  // the live position false exactly while a field fixing key has started and
  // the field is not proven. Before any has started nothing changes at all.
  const fieldProven =
    options.fieldProven ??
    ((options.atLivePosition ?? false) ? !champFieldProofAtNow(artifact, startedDcmpEventKeys, options.nowYear ?? new Date().getUTCFullYear()).unprovenAfterStart : true);

  const passOptions = {
    artifact,
    distributions,
    ...(stageByEvent === undefined ? {} : { stageByEvent }),
    ...(options.fieldStageByEvent === undefined ? {} : { fieldStageByEvent: options.fieldStageByEvent }),
    unavailableEvents,
    ...(options.gaps === undefined ? {} : { gaps: options.gaps }),
    // Both tier passes read the tab's one pending condition (quick task 261007-4qr).
    ...(options.distributionsPending === undefined ? {} : { distributionsPending: options.distributionsPending }),
  };
  const districtPass = buildDistrictLedgerRows({ ...passOptions, tier: "district" });
  const dcmpPass = buildDistrictLedgerRows({ ...passOptions, tier: "dcmp" });

  const districtByTeam = new Map(districtPass.teams.map((team) => [team.teamKey, team] as const));
  const dcmpByTeam = new Map(dcmpPass.teams.map((team) => [team.teamKey, team] as const));
  const sourceByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));

  const teamsWithoutFieldChance = new Set<string>();
  const teamsWithDistrictOnlyGrandTotal = new Set<string>();
  const teamsWithUnavailableGrandTotal = new Set([
    ...districtPass.gaps.teamsWithUnavailableGrandTotal,
    ...dcmpPass.gaps.teamsWithUnavailableGrandTotal,
  ]);

  const built: ChampLedgerTeam[] = [];
  // Whether the field is settled for a team with no row at a field fixing
  // key: the same started set and the same flag the membership rule reads
  // (reading R23, `ChampLedgerTeam.fieldRowOpen`). One answer per position.
  const rowlessFieldSettled = fieldSettledForRowlessTeam(startedDcmpEventKeys, dcmpEventKeys, fieldProven);

  for (const team of artifact.teams) {
    const districtEntry = districtByTeam.get(team.teamKey);
    const dcmpEntry = dcmpByTeam.get(team.teamKey);
    if (districtEntry === undefined || dcmpEntry === undefined) continue;

    const dcmpStarted = dcmpStartedForTeam(team, startedDcmpEventKeys, dcmpEventKeys, fieldProven);
    const membership = champFieldMembership(team, dcmpStarted, options.atLivePosition ?? false);
    const suppliedChance = fieldChanceByTeam?.get(team.teamKey);
    if (membership === "open" && suppliedChance === undefined) teamsWithoutFieldChance.add(team.teamKey);
    const chance = membership === "in" ? 1 : membership === "out" ? 0 : (suppliedChance ?? 1);
    const fieldChance = membership === "open" ? suppliedChance : undefined;

    const districtRow = foldDistrictRow(districtEntry, districtCeilings, districtEventTotalCeiling);
    // WITHOUT AN ESTIMATE MAP OR A SIMULATED DCMP the shipped rule stands
    // unchanged: any priced championship row is read, which is what the tab
    // renders until it supplies either. WITH one, the championship's own row is
    // read only where the field is a fact for this team (`buildDcmpRow`'s case 2).
    const fieldIsFact =
      (options.dcmpEstimateByTeam === undefined && options.simulatedDcmp === undefined) ||
      dcmpStarted ||
      ((options.atLivePosition ?? false) && membership === "in");
    const simulated =
      !fieldIsFact && options.simulatedDcmp !== undefined ? simulatedDcmpReading(options.simulatedDcmp, team.teamKey) : undefined;
    const { row: dcmpRow, winChance, outsideSimulatedField, finalsOpen } = buildDcmpRow(
      dcmpEntry,
      membership,
      dcmpEventTotalCeiling,
      fieldIsFact,
      options.dcmpEstimateByTeam?.get(team.teamKey),
      dcmpCeilings,
      simulated,
      fieldFixingKeys
    );

    // THE DCMP WAS NEVER PRICED — no championship on the artifact, or no
    // sidecar and no event artifact for the one it names. The grand total falls
    // back to the district-only convolution and says so; see this module's
    // header. Only this case joins `teamsWithDistrictOnlyGrandTotal`.
    const unpriced = dcmpRow.subtotal.kind === "notYetPriced";
    if (unpriced) teamsWithDistrictOnlyGrandTotal.add(team.teamKey);
    // OUTSIDE THE SIMULATED FIELD (quick task 261007-mxf): a Locked out or Out
    // of range team at a rewound stop is priced, at zero championship points,
    // so its grand total is the same labelled district only figure without
    // suppressing the champ run.
    const districtOnly = unpriced || outsideSimulatedField;

    const districtOpen = rowHasOpenCell(districtRow);
    // AN OPEN DCMP SUBTOTAL COUNTS (quick task 260927-6bf): an estimated row
    // has no open category cell, and without this a chance 1 team whose
    // district is final would fold as final.
    // A FINALS CATEGORY STILL OPEN COUNTS TOO (quick task 261009-tx8, B2): the
    // DCMP row shows the division alone until the finals points are earned, so
    // without this a division that is all final would settle the grand total
    // and the predicted cutoff while the finals can still pay.
    const dcmpOpen = rowHasOpenCell(dcmpRow) || dcmpRow.subtotal.kind === "open" || finalsOpen;
    const hasOpenCategory = districtOpen || dcmpOpen || (!districtOnly && membership === "open" && chance < 1);

    const shift = Math.max(0, Math.round(team.rookieBonus)) + Math.max(0, Math.round(team.adjustments));
    const grandCeiling =
      districtEventTotalCeiling * Math.max(districtRow.sources.length, 1) + (districtOnly ? 0 : dcmpEventTotalCeiling) + shift;

    let grandTotal: DistrictLedgerCell;
    let projection: number;
    const districtPart = distributionOf(districtRow.subtotal);
    const dcmpPart = districtOnly
      ? undefined
      : membership === "out"
        ? pointMassDistribution(0)
        : distributionOf(dcmpRow.subtotal);
    const earnedAll = team.pointTotal;
    const earnedAtPosition = earnedAtPositionOf(team, stageByEvent);

    // The two parts the champ run draws SEPARATELY, so its DCMP winner and its
    // DCMP points come from one draw (quick task 260927-6bf).
    let districtRunPart: DistrictPointDistribution | undefined;
    if (districtPart !== undefined) {
      try {
        districtRunPart = { counts: convolveDistrictGrandTotal([districtPart], Math.round(team.rookieBonus), Math.round(team.adjustments)), denominator: 1 };
      } catch {
        districtRunPart = undefined;
      }
    }
    const dcmpRunPart: ChampDcmpPart | undefined =
      dcmpPart === undefined || membership === "out" ? undefined : { distribution: dcmpPart, fieldChance: chance, winChance };

    if (districtPart === undefined || (!districtOnly && dcmpPart === undefined)) {
      // PENDING only when EVERY missing part's subtotal is still arriving
      // (quick task 261007-4qr); a refused or unpriced part keeps it plain.
      const missingSubtotals: ChampLedgerCell[] = [];
      if (districtPart === undefined) missingSubtotals.push(districtRow.subtotal);
      if (!districtOnly && dcmpPart === undefined) missingSubtotals.push(dcmpRow.subtotal);
      const pending = missingSubtotals.every((cell) => cell.kind === "unavailable" && cell.pending === true);
      grandTotal = pending
        ? { id: GRAND_TOTAL_CELL_ID, cell: "grandTotal", kind: "unavailable", pending: true }
        : { id: GRAND_TOTAL_CELL_ID, cell: "grandTotal", kind: "unavailable" };
      projection = earnedAtPosition;
      teamsWithUnavailableGrandTotal.add(team.teamKey);
    } else {
      try {
        const parts = dcmpPart === undefined ? [districtPart] : [districtPart, mixFieldMembership(dcmpPart, chance)];
        const counts = convolveDistrictGrandTotal(parts, Math.round(team.rookieBonus), Math.round(team.adjustments));
        const distribution: DistrictPointDistribution = { counts, denominator: 1 };
        if (hasOpenCategory) {
          grandTotal = openDistrictLedgerCell(GRAND_TOTAL_CELL_ID, "grandTotal", distribution, grandCeiling);
          projection = pointQuantile(counts, 0.5, 1);
        } else {
          // Nothing is open and the field is settled, so the convolution is a
          // point mass: taking its quantile would reproduce the same number by
          // a longer route while inviting a reader to think a prediction was
          // involved.
          const earned =
            earnedOf(districtRow.subtotal) + (districtOnly || membership === "out" ? 0 : earnedOf(dcmpRow.subtotal)) + shift;
          grandTotal = { id: GRAND_TOTAL_CELL_ID, cell: "grandTotal", kind: "final", earned };
          projection = earned;
        }
      } catch {
        // DEGRADE PER TEAM, never per table — `buildDistrictLedgerRows`' own
        // rule, for the same reason: an absorbed refusal becomes a plausible,
        // complete, wrong row.
        grandTotal = { id: GRAND_TOTAL_CELL_ID, cell: "grandTotal", kind: "unavailable" };
        projection = earnedAtPosition;
        teamsWithUnavailableGrandTotal.add(team.teamKey);
      }
    }

    built.push({
      teamKey: team.teamKey,
      teamNumber: districtEntry.teamNumber,
      nickname: districtEntry.nickname,
      rows: [districtRow, dcmpRow],
      districtRow,
      dcmpRow,
      membership,
      fieldChance,
      grandTotal,
      grandTotalIsDistrictOnly: districtOnly && grandTotal.kind !== "unavailable",
      projection,
      hasOpenCategory,
      position: 0,
      rookieBonus: districtEntry.rookieBonus,
      earnedAllTierTotal: earnedAll,
      earnedAtPosition,
      districtPart: districtRunPart,
      dcmpPart: dcmpRunPart,
      fieldRowOpen: !rowlessFieldSettled && !tierEvents(team, "dcmp").some((entry) => fieldFixingKeys.has(entry.eventKey)),
    });
  }

  built.sort((a, b) => {
    if (a.projection !== b.projection) return b.projection - a.projection;
    if (a.earnedAtPosition !== b.earnedAtPosition) return b.earnedAtPosition - a.earnedAtPosition;
    return a.teamNumber - b.teamNumber;
  });

  const teams = built.map((team, index) => ({ ...team, position: index + 1 }));

  return {
    teams,
    dcmpEventKey,
    dcmpEventKeys,
    fieldProven,
    gaps: {
      ...unionGaps(districtPass.gaps, dcmpPass.gaps),
      teamsWithUnavailableGrandTotal: [...teamsWithUnavailableGrandTotal].sort(),
      teamsWithoutFieldChance: [...teamsWithoutFieldChance].sort(),
      teamsWithDistrictOnlyGrandTotal: [...teamsWithDistrictOnlyGrandTotal].sort(),
    },
  };
}

/**
 * `ChampLedgerTeam.earnedAtPosition`: `pointTotal` at "now" (no
 * `stageByEvent`), and rewound, `pointTotal` minus each category not final at
 * the position over every district and dcmp tier event. A category's stage is
 * the position's own where the rail supplies one, the event's `state` block
 * otherwise.
 */
export function earnedAtPositionOf(team: DistrictArtifact["teams"][number], stageByEvent: ReadonlyMap<string, DistrictStageFinality> | undefined): number {
  let earned = team.pointTotal;
  if (stageByEvent === undefined) return earned;
  for (const tier of ["district", "dcmp"] as const) {
    for (const entry of tierEvents(team, tier)) {
      if (entry.earned === undefined) continue;
      const final = stageByEvent.get(entry.eventKey) ?? deriveStageFromState(entry.state).final;
      for (const category of DISTRICT_CATEGORIES) if (!final[category]) earned -= entry.earned[category];
    }
  }
  return earned;
}

/**
 * The grand total drawer's TWO rows, derived from the very subtotal cells the
 * table above already renders — never from a second pass over the artifact — so
 * the list cannot describe a different pair of rows than the table does.
 */
export function champContributions(team: ChampLedgerTeam): readonly ChampContribution[] {
  return CHAMP_LEDGER_ROWS.map((kind) => {
    const row = kind === "district" ? team.districtRow : team.dcmpRow;
    const distribution = row.subtotal.kind === "open" ? row.subtotal.distribution : undefined;
    return {
      row: kind,
      earned: row.subtotal.kind === "final" ? row.subtotal.earned : undefined,
      open: distribution === undefined ? undefined : pointPercentiles(distribution.counts, distribution.denominator),
      fieldChance: kind === "dcmp" ? team.fieldChance : undefined,
      notYetPriced: row.subtotal.kind === "notYetPriced",
    };
  });
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

/**
 * The District points row: the team's district-tier events summed per category.
 *
 * A category is GREY only when it is final at EVERY district-tier event the
 * team has — a team with one event finished and one still to play has earned
 * part of its qualification points and is still predicting the rest, which is
 * one open cell and not two. Otherwise the cell is the exact convolution of the
 * per-event parts, where a final part is a point mass at its earned value and
 * an open part is that event's own distribution. Any per-event cell the tab
 * could not build makes the aggregate unavailable rather than a sum missing a
 * term.
 */
function foldDistrictRow(
  entry: DistrictLedgerTeam,
  ceilings: ReturnType<typeof maxEventPoints>,
  eventTotalCeiling: number
): ChampLedgerRow {
  const eventCount = Math.max(entry.rows.length, 1);
  const categoryCeiling: Readonly<Record<DistrictCategory, number>> = {
    qual: ceilings.qual,
    alliance: ceilings.alliance,
    elim: ceilings.elim,
    award: ceilings.award,
  };

  const cells = DISTRICT_CATEGORIES.map((category, index) =>
    foldCells(
      champCellId("district", category),
      category,
      entry.rows.map((row) => row.cells[index]),
      categoryCeiling[category] * eventCount
    )
  );

  const subtotal = foldCells(
    champCellId("district", "eventTotal"),
    "eventTotal",
    entry.rows.map((row) => row.eventTotal),
    eventTotalCeiling * eventCount
  );

  return {
    kind: "district",
    cells,
    subtotal,
    sources: entry.rows.map(sourceOf),
    estimated: false,
  };
}

/**
 * One category's aggregate across a team's events: grey where every part is
 * grey, unavailable where any part is, and the exact convolution otherwise.
 *
 * A team with ZERO events at this tier gets a grey ZERO rather than an
 * unavailable: it has earned no points at this tier and that is a settled fact,
 * not a missing measurement.
 */
function foldCells(
  id: string,
  cell: DistrictCellKind,
  parts: readonly (DistrictLedgerCell | undefined)[],
  ceiling: number
): ChampLedgerCell {
  // PENDING PROPAGATES ONLY THROUGH PENDING PARTS (quick task 261007-4qr): one
  // missing or plainly unavailable part makes the fold plain unavailable, as
  // before; otherwise any part still arriving makes the fold pending. Final
  // and open parts alone fold exactly as they always did.
  let anyPending = false;
  for (const part of parts) {
    if (part === undefined || (part.kind === "unavailable" && part.pending !== true)) return { id, cell, kind: "unavailable" };
    if (part.kind === "unavailable") anyPending = true;
  }
  if (anyPending) return { id, cell, kind: "unavailable", pending: true };

  const distributions: DistrictPointDistribution[] = [];
  let earned = 0;
  let everyPartFinal = true;
  // A SUM OF FINAL PARTS IS "UP TO" WHEN ANY PART IS (quick task 261010-66y,
  // D6): one event's settled Playoffs value that is not TBA's own number yet
  // makes the whole sum a most, never an exact figure. A fold with an open
  // part is an open cell and carries no such flag.
  let anyUpTo = false;
  for (const part of parts) {
    if (part === undefined || part.kind === "unavailable") return { id, cell, kind: "unavailable" };
    if (part.kind === "final") {
      earned += part.earned;
      if (part.upTo === true) anyUpTo = true;
      distributions.push(pointMassDistribution(part.earned));
      continue;
    }
    everyPartFinal = false;
    distributions.push(part.distribution);
  }
  if (everyPartFinal) return anyUpTo ? { id, cell, kind: "final", earned, upTo: true } : { id, cell, kind: "final", earned };
  try {
    const counts = convolveDistrictGrandTotal(distributions, 0, 0);
    return openDistrictLedgerCell(id, cell, { counts, denominator: 1 }, ceiling);
  } catch {
    return { id, cell, kind: "unavailable" };
  }
}

/**
 * The DCMP points row, and the chance the team is on the DCMP winning alliance.
 *
 * FIVE CASES, in priority order (quick task 260927-6bf; case 3 quick task
 * 261007-mxf):
 *
 * 1. A team OUTSIDE the field gets `notInField` in every cell (the em dash).
 * 2. The field is a FACT for this team (the DCMP has started, or the reader is
 *    at the live position and the team is registered) and the championship's
 *    own row is priced: that row VERBATIM, its four cells with their playoff
 *    milestone and selection routes carried through and its event total as
 *    the Subtotal. Its win chance is the Playoffs cell's mass at the winner
 *    value; 0 once that cell is final, because a posted winner is already a
 *    fact in the statuses. A registered team missing from the posted schedule
 *    reaches this case once its championship is simulated, because its event
 *    row is priced from awards alone (`districtLedgerRows.ts`
 *    `awardOnlyTeams`, quick task 260927-vmb): the Subtotal is open and the
 *    Playoffs cell is a grey zero, so its win chance is 0.
 *
 *    WHICH ROW, AT A DIVISIONED CHAMPIONSHIP (quick task 261009-tx8, B2). A
 *    team that reached the finals, or won an award there, carries TWO dcmp
 *    rows: its division's and the finals'. The row read here is the PRIMARY
 *    row, the first pass row whose key is field fixing
 *    (`fieldFixingDcmpKeys`: a division, a single DCMP), else the first row,
 *    so a team whose only dcmp row is the finals reads that row as before.
 *    The pass sorts same week rows by name, which at FIM puts the finals row
 *    first; reading the first row printed frc27's finals 0, 0, 60, 30 at 2026
 *    FIM and hid its division's 66, 48, 90, 0.
 *
 *    THE FINALS ARE ADDED ONCE EARNED. For each category, every finals row
 *    cell that is FINAL at the position adds its earned value: a final primary
 *    cell becomes the sum, and an open primary cell moved up by a value above
 *    0 becomes a plain open cell over the shifted distribution, flagged
 *    `shiftedByFinals` (no milestone, no routes: no named outcome covers the
 *    shifted support). A value of 0 leaves the primary cell untouched. A
 *    finals category that is NOT final at the position adds nothing: the
 *    finals are not priced, and nothing is fabricated. The Subtotal gains the
 *    sum of the added values, so the cells always add up to it. The win
 *    chance stays the PRIMARY row's own Playoffs cell, read before any
 *    addition. `finalsOpen` reports a finals row with anything still open.
 * 3. Otherwise, at a rewound stop before any championship has started, where
 *    the tab supplies the SIMULATED DCMP (the Locked plus In range field baked
 *    in the Web Worker): the team's reading. Locked out gives the em dash and
 *    Out of range the "out of range" cell, both in every cell and both
 *    `outsideSimulatedField`; a field or bake still in flight gives pending
 *    cells; a refused field, a failed bake or a team the bake has no record
 *    for gives plain unavailable cells. A baked team gets four open cells and
 *    an open Subtotal built from its record, exactly the cells a baked sidecar
 *    gives, with case 2's win chance. A record missing any distribution reads
 *    unavailable. The estimate below is never consulted while this case is
 *    supplied.
 * 4. Otherwise, when a walk-forward ESTIMATE is supplied for the team: the
 *    four category cells read "not yet priced", the Subtotal is open over the
 *    estimate, and `estimated` is true. `sources` stays the dcmp pass's own,
 *    so the status floors and ceilings are untouched. At the live position
 *    before the DCMP field is a fact, case 2 cannot fire for an unregistered
 *    team, so it lands here; a rewound stop takes case 3 instead.
 * 5. Otherwise `notYetPriced` in every cell: the district only fallback.
 *
 * Anything narrower in case 2 (one category the run refused while the others
 * priced) keeps the shipped `unavailable` on that cell alone.
 */
function buildDcmpRow(
  entry: DistrictLedgerTeam,
  membership: ChampFieldMembership,
  eventTotalCeiling: number,
  fieldIsFact: boolean,
  estimate: ChampDcmpEstimate | undefined,
  ceilings: ReturnType<typeof maxEventPoints>,
  simulated: SimulatedDcmpReading | undefined,
  fieldFixingKeys: ReadonlySet<string>
): DcmpRowResult {
  // THE PRIMARY ROW (quick task 261009-tx8, B2): the team's own championship,
  // which at a divisioned one is its division and not the finals. See case 2.
  const row = entry.rows.find((candidate) => fieldFixingKeys.has(candidate.eventKey)) ?? entry.rows[0];
  const finalsRows = row === undefined ? [] : entry.rows.filter((candidate) => candidate !== row && !fieldFixingKeys.has(candidate.eventKey));
  // EVERY dcmp pass row is a source, in pass order (quick task 261009-kt3,
  // CONTEXT D3): a team at a divisioned championship carries its division row
  // and, once paid there, its finals row, and the status module folds both into
  // the floor and the ceiling. The order is NOT changed here: the status module
  // reads the first element. The cells read the primary row plus the finals
  // once earned, and the small stage line asks `champDcmpStageSource`.
  const sources: ChampLedgerSource[] = entry.rows.map(sourceOf);

  const wholeRow = (
    kind: "notInField" | "notYetPriced" | "outOfRange",
    outsideSimulatedField = false
  ): DcmpRowResult => ({
    row: {
      kind: "dcmp",
      cells: DISTRICT_CATEGORIES.map((category) => ({ id: champCellId("dcmp", category), cell: category, kind })),
      subtotal: { id: champCellId("dcmp", "eventTotal"), cell: "eventTotal", kind },
      sources,
      estimated: false,
    },
    winChance: 0,
    outsideSimulatedField,
    finalsOpen: false,
  });

  const unavailableRow = (pending: boolean): DcmpRowResult => {
    const cell = (id: string, kind: DistrictCellKind): ChampLedgerCell =>
      pending ? { id, cell: kind, kind: "unavailable", pending: true } : { id, cell: kind, kind: "unavailable" };
    return {
      row: {
        kind: "dcmp",
        cells: DISTRICT_CATEGORIES.map((category) => cell(champCellId("dcmp", category), category)),
        subtotal: cell(champCellId("dcmp", "eventTotal"), "eventTotal"),
        sources,
        estimated: false,
      },
      winChance: 0,
      outsideSimulatedField: false,
      finalsOpen: false,
    };
  };

  if (membership === "out") return wholeRow("notInField");

  // The row is the team's OWN championship, whichever of the district's it attends.
  if (fieldIsFact && row !== undefined) {
    const ownSubtotal = reId(row.eventTotal, champCellId("dcmp", "eventTotal"), "eventTotal", eventTotalCeiling);
    // NO SUBTOTAL MEANS NOTHING WAS PRICED. The championship is on the
    // artifact but the tab read neither a baked sidecar nor an event artifact
    // for it; the estimate below stands in where it is supplied. The gate reads
    // the PRIMARY row's Subtotal, before any finals value is added.
    if (ownSubtotal.kind !== "unavailable") {
      const elimIndex = DISTRICT_CATEGORIES.indexOf("elim");
      // The finals points already earned, per category; `undefined` where no
      // finals row has that category final at the position.
      let addedTotal = 0;
      let anyAdded = false;
      const cells = DISTRICT_CATEGORIES.map((category, index) => {
        const own = reId(row.cells[index], champCellId("dcmp", category), category);
        const added = finalsEarned(finalsRows.map((finals) => finals.cells[index]));
        if (added === undefined) return own;
        anyAdded = true;
        addedTotal += added;
        return withFinalsAdded(own, added, ceilings[category] + added);
      });
      return {
        row: {
          kind: "dcmp",
          cells,
          subtotal: anyAdded ? withFinalsAdded(ownSubtotal, addedTotal, eventTotalCeiling + addedTotal) : ownSubtotal,
          sources,
          estimated: false,
        },
        // The PRIMARY row's own Playoffs cell, read before any addition.
        winChance: winChanceOf(row.cells[elimIndex], ceilings.elim),
        outsideSimulatedField: false,
        finalsOpen: finalsRows.some((finals) => finals.eventTotal.kind !== "final" || finals.cells.some((cell) => cell.kind !== "final")),
      };
    }
  }

  if (simulated !== undefined) {
    switch (simulated.kind) {
      case "lockedOut":
        return wholeRow("notInField", true);
      case "outOfRange":
        return wholeRow("outOfRange", true);
      case "pending":
        return unavailableRow(true);
      case "unavailable":
        return unavailableRow(false);
      case "baked": {
        const { record } = simulated;
        const total = record.eventTotal;
        if (total === undefined || DISTRICT_CATEGORIES.some((category) => record[category] === undefined)) return unavailableRow(false);
        const cells = DISTRICT_CATEGORIES.map((category) =>
          openDistrictLedgerCell(champCellId("dcmp", category), category, record[category]!, ceilings[category])
        );
        return {
          row: {
            kind: "dcmp",
            cells,
            subtotal: openDistrictLedgerCell(champCellId("dcmp", "eventTotal"), "eventTotal", total, eventTotalCeiling),
            sources,
            estimated: false,
          },
          winChance: winChanceOf(cells[DISTRICT_CATEGORIES.indexOf("elim")], ceilings.elim),
          outsideSimulatedField: false,
          finalsOpen: false,
        };
      }
    }
  }

  if (estimate !== undefined) {
    return {
      row: {
        kind: "dcmp",
        cells: DISTRICT_CATEGORIES.map((category) => ({ id: champCellId("dcmp", category), cell: category, kind: "notYetPriced" as const })),
        subtotal: openDistrictLedgerCell(champCellId("dcmp", "eventTotal"), "eventTotal", estimate.distribution, eventTotalCeiling),
        sources,
        estimated: true,
      },
      winChance: estimate.winChance,
      outsideSimulatedField: false,
      finalsOpen: false,
    };
  }

  return wholeRow("notYetPriced");
}

/** What `buildDcmpRow` returns. `finalsOpen` is true only in case 2, where a finals row beside the primary row has a category or an event total not final at the position. */
interface DcmpRowResult {
  readonly row: ChampLedgerRow;
  readonly winChance: number;
  readonly outsideSimulatedField: boolean;
  readonly finalsOpen: boolean;
}

/** The sum of `earned` over the cells that are FINAL, or `undefined` where none is: an unearned finals category adds nothing rather than a zero. */
function finalsEarned(cells: readonly (DistrictLedgerCell | undefined)[]): number | undefined {
  let added: number | undefined;
  for (const cell of cells) {
    if (cell?.kind === "final") added = (added ?? 0) + cell.earned;
  }
  return added;
}

/**
 * One DCMP row cell with finals points already earned added to it (quick task
 * 261009-tx8, B2).
 *
 * A final cell becomes the sum. An open cell moved up by a value above 0 goes
 * through this module's own `foldCells` with a final part at that value, which
 * builds a PLAIN open cell (no milestone, no routes, no not picked flag) over
 * the shifted distribution, and is flagged `shiftedByFinals`. An open cell with
 * 0 added, and every other kind, is returned untouched.
 */
function withFinalsAdded(cell: ChampLedgerCell, added: number, ceiling: number): ChampLedgerCell {
  if (cell.kind === "final") return { ...cell, earned: cell.earned + added };
  if (cell.kind !== "open" || added <= 0) return cell;
  const shifted = foldCells(cell.id, cell.cell, [cell, { id: cell.id, cell: cell.cell, kind: "final", earned: added }], ceiling);
  return shifted.kind === "open" ? { ...shifted, shiftedByFinals: true } : shifted;
}

/**
 * Whether a Champ Locks cell's drawer lists NAMED outcomes (quick task
 * 261009-tx8, B2): true on the DCMP row, whose cells are one event's, unless
 * the cell is an open cell flagged `shiftedByFinals`, whose support no named
 * playoff or award outcome covers. False on the District points row (a sum over
 * several events) and for the grand total, which belongs to neither row.
 */
export function champCellNamesOutcomes(row: ChampLedgerRowKind | undefined, cell: ChampLedgerCell): boolean {
  if (row !== "dcmp") return false;
  return !(cell.kind === "open" && cell.shiftedByFinals === true);
}

/**
 * The source the DCMP row's small STAGE LINE reads (quick task 261009-tx8,
 * reading R10): the row's sources division first, then finals, each group in
 * pass order, and the first of them that still has an open category at the
 * position. With none open it is the first in that order, whose stage word is
 * then the final word; an empty list gives `undefined`.
 *
 * So the line reads the division's stage while the division is being played,
 * the finals' stage once the division is done and the finals are not, and the
 * final word once both are done.
 *
 * THE ROW'S OWN KEYS ARE ENOUGH for the ordering. A division source is one
 * whose key `fieldFixingDcmpKeys` keeps when given just these keys: with both
 * rows present the finals key is the one another key extends by a digit, and
 * with one row there is nothing to order. `sources` itself is NOT reordered:
 * the status module reads its first element.
 */
export function champDcmpStageSource(sources: readonly ChampLedgerSource[]): ChampLedgerSource | undefined {
  const divisionKeys = new Set(fieldFixingDcmpKeys(sources.map((source) => source.eventKey)));
  const ordered = [
    ...sources.filter((source) => divisionKeys.has(source.eventKey)),
    ...sources.filter((source) => !divisionKeys.has(source.eventKey)),
  ];
  return ordered.find((source) => DISTRICT_CATEGORIES.some((category) => !source.stage.final[category])) ?? ordered[0];
}

/** The chance of being on the winning alliance: a Playoffs cell's mass at the winner value, 0 for any cell that is not open. */
function winChanceOf(elim: ChampLedgerCell | undefined, winnerElimPoints: number): number {
  if (elim?.kind !== "open") return 0;
  return Math.min(Math.max((elim.distribution.counts[winnerElimPoints] ?? 0) / elim.distribution.denominator, 0), 1);
}

/** The dcmp pass's cell under the champ tab's own drawer id — the cell's content is untouched. */
function reId(
  cell: DistrictLedgerCell | undefined,
  id: string,
  kind: DistrictCellKind,
  ceiling?: number
): ChampLedgerCell {
  if (cell === undefined) return { id, cell: kind, kind: "unavailable" };
  if (cell.kind === "open" && ceiling !== undefined) return { ...cell, id, ceiling };
  return { ...cell, id };
}

function rowHasOpenCell(row: ChampLedgerRow): boolean {
  return row.cells.some((cell) => cell.kind === "open");
}

function distributionOf(cell: ChampLedgerCell): DistrictPointDistribution | undefined {
  if (cell.kind === "final") return pointMassDistribution(cell.earned);
  if (cell.kind === "open") return cell.distribution;
  return undefined;
}

function earnedOf(cell: ChampLedgerCell): number {
  return cell.kind === "final" ? cell.earned : 0;
}

/** The dcmp-tier event keys that have started at "now", read from their own `state` blocks and nothing else. */
function startedDcmpEventKeysAtNow(artifact: DistrictArtifact): Set<string> {
  const started = new Set<string>();
  for (const team of artifact.teams) {
    for (const entry of tierEvents(team, "dcmp")) {
      if (deriveStageFromState(entry.state).started) started.add(entry.eventKey);
    }
  }
  return started;
}

function unionGaps(left: DistrictLedgerGaps, right: DistrictLedgerGaps): DistrictLedgerGaps {
  const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])].sort();
  const events = new Map<string, string>();
  for (const entry of [...left.unavailableEvents, ...right.unavailableEvents]) events.set(entry.eventKey, entry.name);
  return {
    missingEventArtifacts: union(left.missingEventArtifacts, right.missingEventArtifacts),
    eventsWithExcludedMatches: union(left.eventsWithExcludedMatches, right.eventsWithExcludedMatches),
    teamsWithoutAwardProfile: union(left.teamsWithoutAwardProfile, right.teamsWithoutAwardProfile),
    eventsWithFallbackFieldSize: union(left.eventsWithFallbackFieldSize, right.eventsWithFallbackFieldSize),
    eventsWithPartialAllianceList: union(left.eventsWithPartialAllianceList, right.eventsWithPartialAllianceList),
    eventsWithUnresolvedElimMatches: union(left.eventsWithUnresolvedElimMatches, right.eventsWithUnresolvedElimMatches),
    eventsWithUnknownSelectionRoutes: union(left.eventsWithUnknownSelectionRoutes, right.eventsWithUnknownSelectionRoutes),
    teamsWithUnavailableGrandTotal: union(left.teamsWithUnavailableGrandTotal, right.teamsWithUnavailableGrandTotal),
    unavailableEvents: [...events.entries()].map(([eventKey, name]) => ({ eventKey, name })).sort((a, b) => a.eventKey.localeCompare(b.eventKey)),
  };
}
