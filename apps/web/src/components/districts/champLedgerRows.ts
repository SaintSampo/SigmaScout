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
 */
import { convolveDistrictGrandTotal } from "../../../../../packages/core/districts/ledgerSimulation.js";
import { pointPercentiles, pointQuantile, type PointPercentiles } from "../../../../../packages/core/districts/pointSummary.js";
import { maxEventPoints, type DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import {
  DISTRICT_CATEGORIES,
  GRAND_TOTAL_CELL_ID,
  buildDistrictLedgerRows,
  deriveStageFromState,
  openDistrictLedgerCell,
  pointMassDistribution,
  tierEvents,
  type DistrictCategory,
  type DistrictCellKind,
  type DistrictEventDistributions,
  type DistrictEventStage,
  type DistrictLedgerCell,
  type DistrictLedgerGaps,
  type DistrictLedgerTeam,
  type DistrictPointDistribution,
  type DistrictStageFinality,
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

/** One source event behind a row, for the row's small line ("{short name} Wk {week + 1} · {stage word}"). */
export interface ChampLedgerSource {
  readonly eventKey: string;
  readonly eventName: string;
  readonly week: number | null;
  readonly stage: DistrictEventStage;
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
 * Whether THIS team's championship has started at the position: its own dcmp
 * row's event where it has one, or EVERY championship for a team with no row
 * yet — the conservative reading, since a team with no row is only "out" of
 * the field once no championship can still list it.
 */
export function dcmpStartedForTeam(team: DistrictTeam, startedDcmpEventKeys: ReadonlySet<string>, dcmpEventKeys: readonly string[]): boolean {
  const own = tierEvents(team, "dcmp")[0]?.eventKey;
  if (own !== undefined) return startedDcmpEventKeys.has(own);
  return dcmpEventKeys.length > 0 && dcmpEventKeys.every((key) => startedDcmpEventKeys.has(key));
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
  const startedDcmpEventKeys: ReadonlySet<string> =
    options.startedDcmpEventKeys ??
    (options.dcmpStarted === undefined ? startedDcmpEventKeysAtNow(artifact) : options.dcmpStarted ? new Set(dcmpEventKeys) : new Set<string>());

  const passOptions = {
    artifact,
    distributions,
    ...(stageByEvent === undefined ? {} : { stageByEvent }),
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

  for (const team of artifact.teams) {
    const districtEntry = districtByTeam.get(team.teamKey);
    const dcmpEntry = dcmpByTeam.get(team.teamKey);
    if (districtEntry === undefined || dcmpEntry === undefined) continue;

    const dcmpStarted = dcmpStartedForTeam(team, startedDcmpEventKeys, dcmpEventKeys);
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
    const { row: dcmpRow, winChance, outsideSimulatedField } = buildDcmpRow(
      dcmpEntry,
      membership,
      dcmpEventTotalCeiling,
      fieldIsFact,
      options.dcmpEstimateByTeam?.get(team.teamKey),
      dcmpCeilings,
      simulated
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
    const dcmpOpen = rowHasOpenCell(dcmpRow) || dcmpRow.subtotal.kind === "open";
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
    sources: entry.rows.map((row) => ({ eventKey: row.eventKey, eventName: row.eventName, week: row.week, stage: row.stage })),
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
  for (const part of parts) {
    if (part === undefined || part.kind === "unavailable") return { id, cell, kind: "unavailable" };
    if (part.kind === "final") {
      earned += part.earned;
      distributions.push(pointMassDistribution(part.earned));
      continue;
    }
    everyPartFinal = false;
    distributions.push(part.distribution);
  }
  if (everyPartFinal) return { id, cell, kind: "final", earned };
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
  simulated: SimulatedDcmpReading | undefined
): { readonly row: ChampLedgerRow; readonly winChance: number; readonly outsideSimulatedField: boolean } {
  const row = entry.rows[0];
  const sources: ChampLedgerSource[] =
    row === undefined ? [] : [{ eventKey: row.eventKey, eventName: row.eventName, week: row.week, stage: row.stage }];

  const wholeRow = (
    kind: "notInField" | "notYetPriced" | "outOfRange",
    outsideSimulatedField = false
  ): { row: ChampLedgerRow; winChance: number; outsideSimulatedField: boolean } => ({
    row: {
      kind: "dcmp",
      cells: DISTRICT_CATEGORIES.map((category) => ({ id: champCellId("dcmp", category), cell: category, kind })),
      subtotal: { id: champCellId("dcmp", "eventTotal"), cell: "eventTotal", kind },
      sources,
      estimated: false,
    },
    winChance: 0,
    outsideSimulatedField,
  });

  const unavailableRow = (pending: boolean): { row: ChampLedgerRow; winChance: number; outsideSimulatedField: boolean } => {
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
    };
  };

  if (membership === "out") return wholeRow("notInField");

  // The row is the team's OWN championship, whichever of the district's it attends.
  if (fieldIsFact && row !== undefined) {
    const subtotal = reId(row.eventTotal, champCellId("dcmp", "eventTotal"), "eventTotal", eventTotalCeiling);
    // NO SUBTOTAL MEANS NOTHING WAS PRICED. The championship is on the
    // artifact but the tab read neither a baked sidecar nor an event artifact
    // for it; the estimate below stands in where it is supplied.
    if (subtotal.kind !== "unavailable") {
      const elimIndex = DISTRICT_CATEGORIES.indexOf("elim");
      return {
        row: {
          kind: "dcmp",
          cells: DISTRICT_CATEGORIES.map((category, index) => reId(row.cells[index], champCellId("dcmp", category), category)),
          subtotal,
          sources,
          estimated: false,
        },
        winChance: winChanceOf(row.cells[elimIndex], ceilings.elim),
        outsideSimulatedField: false,
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
    };
  }

  return wholeRow("notYetPriced");
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
