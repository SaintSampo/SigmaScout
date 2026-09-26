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
 * AN UNAVAILABLE DCMP SUBTOTAL MAKES THE GRAND TOTAL UNAVAILABLE. The champ
 * grand total is DEFINED as district points plus DCMP points; a district that
 * publishes no dcmp-tier event at all, or a team the tab holds no DCMP
 * distribution for, cannot have one predicted. Silently falling back to the
 * district-only total would print a number labelled "grand total" that is
 * missing up to 249 points — a plausible, complete, wrong figure, which is the
 * exact failure `districtLedgerRows.ts` refuses everywhere else. The team keeps
 * its rows, its earned points and its earned-total projection, and is named in
 * the disclosed gaps.
 */
import { convolveDistrictGrandTotal } from "../../../../../packages/core/districts/ledgerSimulation.js";
import { pointPercentiles, pointQuantile, type PointPercentiles } from "../../../../../packages/core/districts/pointSummary.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
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

/** One rendered champ cell. The fourth variant is the em dash a team outside the field gets in every DCMP cell. */
export type ChampLedgerCell =
  | DistrictLedgerCell
  | { readonly id: string; readonly cell: DistrictCellKind; readonly kind: "notInField" };

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
  readonly grandTotal: ChampLedgerCell;
  /** The continuous median of the predicted grand total, or the earned all-tier total for a team with no open category. */
  readonly projection: number;
  readonly hasOpenCategory: boolean;
  /** 1-based index in the sorted order — the `#` the Team cell prints and the In range rank rule reads. */
  readonly position: number;
  readonly rookieBonus: number;
  /** The artifact's own `pointTotal`: the earned all-tier total, the sort's first tie-break. */
  readonly earnedAllTierTotal: number;
}

/** One row's contribution to the grand total, for the grand total drawer's two-row list. */
export interface ChampContribution {
  readonly row: ChampLedgerRowKind;
  readonly earned: number | undefined;
  readonly open: PointPercentiles | undefined;
  /** The chance the DCMP row is weighted by, on the DCMP row alone. `undefined` on the District points row and wherever the field is settled. */
  readonly fieldChance: number | undefined;
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
}

export interface ChampLedgerRowsResult {
  readonly teams: readonly ChampLedgerTeam[];
  readonly gaps: ChampLedgerGaps;
  /** The single dcmp-tier event key this fold read, or `undefined` where the district publishes none. */
  readonly dcmpEventKey: string | undefined;
}

/**
 * The district's single dcmp-tier event key, unioned over every team's
 * `eventPoints` and `remainingEvents`.
 *
 * `undefined` when the district publishes none — a district whose championship
 * is not on the wire yet. The DCMP row's cells then render `unavailable` rather
 * than blank, and the grand total with them; see this module's header for why
 * that is the honest answer rather than a district-only fallback.
 *
 * A district publishes ONE district championship. Where an artifact somehow
 * carries more than one dcmp-tier key the lexicographically first is taken, so
 * the answer is at least stable across renders.
 */
export function dcmpEventKeyFor(artifact: DistrictArtifact): string | undefined {
  const keys = new Set<string>();
  for (const team of artifact.teams) for (const entry of tierEvents(team, "dcmp")) keys.add(entry.eventKey);
  return [...keys].sort()[0];
}

/**
 * Whether a team is in the District Championship field.
 *
 * BEFORE THE DCMP STARTS THE ANSWER IS `"open"` FOR EVERY TEAM, including one
 * the artifact already lists a dcmp-tier row for. A published row before the
 * event starts is a registration, and this tab's whole variant-A premise is
 * that the field is a prediction until the event begins; reading a registration
 * as a settled field would print a certainty the season has not earned.
 *
 * Once it HAS started the field is a fact: a team with a dcmp-tier
 * `eventPoints` or `remainingEvents` entry is in it, and a team without one is
 * not.
 */
export function champFieldMembership(team: DistrictTeam, dcmpStarted: boolean): ChampFieldMembership {
  if (!dcmpStarted) return "open";
  return tierEvents(team, "dcmp").length > 0 ? "in" : "out";
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
   * Whether the District Championship has STARTED at this position. Defaults to
   * the dcmp event's own `state` block at "now"; the tab supplies the
   * position-aware answer so a rewind back past the DCMP's first match reopens
   * the field question in the same step.
   */
  readonly dcmpStarted?: boolean;
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

  const dcmpEventKey = dcmpEventKeyFor(artifact);
  const dcmpStarted = options.dcmpStarted ?? dcmpStartedAtNow(artifact, dcmpEventKey);

  const passOptions = { artifact, distributions, ...(stageByEvent === undefined ? {} : { stageByEvent }), unavailableEvents, ...(options.gaps === undefined ? {} : { gaps: options.gaps }) };
  const districtPass = buildDistrictLedgerRows({ ...passOptions, tier: "district" });
  const dcmpPass = buildDistrictLedgerRows({ ...passOptions, tier: "dcmp" });

  const districtByTeam = new Map(districtPass.teams.map((team) => [team.teamKey, team] as const));
  const dcmpByTeam = new Map(dcmpPass.teams.map((team) => [team.teamKey, team] as const));
  const sourceByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));

  const teamsWithoutFieldChance = new Set<string>();
  const teamsWithUnavailableGrandTotal = new Set([
    ...districtPass.gaps.teamsWithUnavailableGrandTotal,
    ...dcmpPass.gaps.teamsWithUnavailableGrandTotal,
  ]);

  const built: ChampLedgerTeam[] = [];

  for (const team of artifact.teams) {
    const districtEntry = districtByTeam.get(team.teamKey);
    const dcmpEntry = dcmpByTeam.get(team.teamKey);
    if (districtEntry === undefined || dcmpEntry === undefined) continue;

    const membership = champFieldMembership(team, dcmpStarted);
    const suppliedChance = fieldChanceByTeam?.get(team.teamKey);
    if (membership === "open" && suppliedChance === undefined) teamsWithoutFieldChance.add(team.teamKey);
    const chance = membership === "in" ? 1 : membership === "out" ? 0 : (suppliedChance ?? 1);
    const fieldChance = membership === "open" ? suppliedChance : undefined;

    const districtRow = foldDistrictRow(districtEntry, districtCeilings, districtEventTotalCeiling);
    const dcmpRow = buildDcmpRow(dcmpEntry, membership, dcmpEventKey, dcmpEventTotalCeiling);

    const districtOpen = rowHasOpenCell(districtRow);
    const dcmpOpen = rowHasOpenCell(dcmpRow);
    const hasOpenCategory = districtOpen || dcmpOpen || (membership === "open" && chance < 1);

    const shift = Math.max(0, Math.round(team.rookieBonus)) + Math.max(0, Math.round(team.adjustments));
    const grandCeiling =
      districtEventTotalCeiling * Math.max(districtRow.sources.length, 1) + dcmpEventTotalCeiling + shift;

    let grandTotal: ChampLedgerCell;
    let projection: number;
    const districtPart = distributionOf(districtRow.subtotal);
    const dcmpPart = membership === "out" ? pointMassDistribution(0) : distributionOf(dcmpRow.subtotal);
    const earnedAll = team.pointTotal;

    if (districtPart === undefined || dcmpPart === undefined) {
      grandTotal = { id: GRAND_TOTAL_CELL_ID, cell: "grandTotal", kind: "unavailable" };
      projection = earnedAll;
      teamsWithUnavailableGrandTotal.add(team.teamKey);
    } else {
      try {
        const counts = convolveDistrictGrandTotal(
          [districtPart, mixFieldMembership(dcmpPart, chance)],
          Math.round(team.rookieBonus),
          Math.round(team.adjustments)
        );
        const distribution: DistrictPointDistribution = { counts, denominator: 1 };
        if (hasOpenCategory) {
          grandTotal = openDistrictLedgerCell(GRAND_TOTAL_CELL_ID, "grandTotal", distribution, grandCeiling);
          projection = pointQuantile(counts, 0.5, 1);
        } else {
          // Nothing is open and the field is settled, so the convolution is a
          // point mass: taking its quantile would reproduce the same number by
          // a longer route while inviting a reader to think a prediction was
          // involved.
          const earned = earnedOf(districtRow.subtotal) + (membership === "out" ? 0 : earnedOf(dcmpRow.subtotal)) + shift;
          grandTotal = { id: GRAND_TOTAL_CELL_ID, cell: "grandTotal", kind: "final", earned };
          projection = earned;
        }
      } catch {
        // DEGRADE PER TEAM, never per table — `buildDistrictLedgerRows`' own
        // rule, for the same reason: an absorbed refusal becomes a plausible,
        // complete, wrong row.
        grandTotal = { id: GRAND_TOTAL_CELL_ID, cell: "grandTotal", kind: "unavailable" };
        projection = earnedAll;
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
      projection,
      hasOpenCategory,
      position: 0,
      rookieBonus: districtEntry.rookieBonus,
      earnedAllTierTotal: earnedAll,
    });
  }

  built.sort((a, b) => {
    if (a.projection !== b.projection) return b.projection - a.projection;
    if (a.earnedAllTierTotal !== b.earnedAllTierTotal) return b.earnedAllTierTotal - a.earnedAllTierTotal;
    return a.teamNumber - b.teamNumber;
  });

  const teams = built.map((team, index) => ({ ...team, position: index + 1 }));

  return {
    teams,
    dcmpEventKey,
    gaps: {
      ...unionGaps(districtPass.gaps, dcmpPass.gaps),
      teamsWithUnavailableGrandTotal: [...teamsWithUnavailableGrandTotal].sort(),
      teamsWithoutFieldChance: [...teamsWithoutFieldChance].sort(),
    },
  };
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
 * The DCMP points row: the dcmp pass's single row VERBATIM — its four cells
 * with their playoff milestone and selection routes carried through, and its
 * event total as the Subtotal.
 *
 * A team OUTSIDE the field gets `notInField` in every cell, which renders the
 * em dash. A team the tab holds no dcmp row for at all gets `unavailable`,
 * which is a different statement and is rendered differently.
 */
function buildDcmpRow(
  entry: DistrictLedgerTeam,
  membership: ChampFieldMembership,
  dcmpEventKey: string | undefined,
  eventTotalCeiling: number
): ChampLedgerRow {
  const row = entry.rows[0];
  const sources: ChampLedgerSource[] =
    row === undefined ? [] : [{ eventKey: row.eventKey, eventName: row.eventName, week: row.week, stage: row.stage }];

  if (membership === "out") {
    return {
      kind: "dcmp",
      cells: DISTRICT_CATEGORIES.map((category) => ({ id: champCellId("dcmp", category), cell: category, kind: "notInField" as const })),
      subtotal: { id: champCellId("dcmp", "eventTotal"), cell: "eventTotal", kind: "notInField" },
      sources,
    };
  }

  if (row === undefined || dcmpEventKey === undefined) {
    return {
      kind: "dcmp",
      cells: DISTRICT_CATEGORIES.map((category) => ({ id: champCellId("dcmp", category), cell: category, kind: "unavailable" as const })),
      subtotal: { id: champCellId("dcmp", "eventTotal"), cell: "eventTotal", kind: "unavailable" },
      sources,
    };
  }

  return {
    kind: "dcmp",
    cells: DISTRICT_CATEGORIES.map((category, index) => reId(row.cells[index], champCellId("dcmp", category), category)),
    subtotal: reId(row.eventTotal, champCellId("dcmp", "eventTotal"), "eventTotal", eventTotalCeiling),
    sources,
  };
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

/** Whether the District Championship has started at "now", read from its own `state` block and nothing else. */
function dcmpStartedAtNow(artifact: DistrictArtifact, dcmpEventKey: string | undefined): boolean {
  if (dcmpEventKey === undefined) return false;
  for (const team of artifact.teams) {
    for (const entry of tierEvents(team, "dcmp")) {
      if (entry.eventKey !== dcmpEventKey) continue;
      if (deriveStageFromState(entry.state).started) return true;
    }
  }
  return false;
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
