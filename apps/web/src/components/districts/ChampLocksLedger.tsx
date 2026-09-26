/**
 * The Champ Locks tab — the FIRST Championship tier, as sketch 022's two-row
 * ledger.
 *
 * THE SAME LEDGER AS THE DISTRICT LOCKS TAB, with two rows per team instead of
 * one row per event: District points (the team's district-tier events summed
 * per category) and DCMP points (the District Championship's four categories at
 * the 3x weight). Every cell renderer, chip, definition, legend key, drawer pane
 * and slider comes from `LedgerParts.tsx` rather than from a second copy, so a
 * refinement shipped on one tab reaches the other (quick task 260925-xab).
 *
 * WHAT IS DIFFERENT, AND WHY:
 *
 * - THE FIELD IS A QUESTION BEFORE IT IS A FACT. A team's place in the District
 *   Championship field is settled only once the DCMP has started or once TBA
 *   lists it as registered. Until then the four DCMP cells print what the team
 *   would earn IF THERE, and the chance of being there is folded in exactly
 *   ONCE, into the grand total (sketch 022 variant A). The chance is printed
 *   once too, on the row label.
 * - THE CHAMPIONSHIP IS OFTEN NOT ON THE ARTIFACT AT ALL. `remainingEvents` is
 *   built from TBA registrations and a team registers only after it qualifies,
 *   so for most of the district season nothing names the DCMP. The DCMP row
 *   then reads "not yet priced", the grand total falls back to the district-only
 *   figure and is LABELLED "district only", the statuses still compute from the
 *   artifact's own hypothetical-DCMP ceiling, and no champ chance is printed —
 *   ranking district-only totals against `cmpSlots` would rank a quantity the
 *   column does not print.
 * - TWO CHANCE RUNS, in a fixed order. The district run's marginal becomes the
 *   "to be there" chance, that chance weights the grand total, and only then
 *   does the champ run rank those grand totals against `cmpSlots`. The memos
 *   below are ordered so each reads only what is already resolved.
 *
 * THE PREDICTED CUTOFF is the one number the controls card and every grand
 * total dashed rule share, taken over the champ grand totals against
 * `cmpSlots`. In the pre registration window it is labelled "district only",
 * because that is what the totals behind it are, and it carries no likely
 * range there because the champ run that would produce one is suppressed.
 *
 * Every colour reaches the page through a CSS custom property, and every class
 * list that mixes a `text-role-*` class with a colour custom property is a
 * PLAIN STRING rather than a `cn()` call — tailwind-merge drops the role class
 * in that combination and only a screenshot catches it (project memory
 * `project_cn_drops_text_role_classes`).
 */
import { useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { EmptyState } from "@/components/StateViews";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import type { DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import {
  ControlsCard,
  DrawerCellPane,
  GrandTotalContent,
  GrandTotalPlot,
  LedgerCell,
  RewindSlider,
  StatusCell,
  StatusChips,
  TeamCell,
  UNAVAILABLE_CELL_CLASS,
  likelyRangeText,
  prefersReducedMotion,
  stageWordKey,
  type CellInteraction,
  type DistrictLedgerNavigate,
} from "./LedgerParts.js";
import { predictedCutoff, simulatedCutoffRange, type LedgerCutoffView } from "./predictedCutoff.js";
import {
  CHAMP_LEDGER_COLUMN_LABELS,
  CHAMP_LEDGER_CONTRIBUTION_CAPTION,
  CHAMP_LEDGER_CONTRIBUTION_COLUMN_SOURCE,
  CHAMP_LEDGER_CONTRIBUTION_LIST_LABEL,
  CHAMP_LEDGER_CONTRIBUTION_ROW_LABELS,
  CHAMP_LEDGER_DISTRICT_ONLY_LINE,
  CHAMP_LEDGER_LOCKED_WINNER_LABEL,
  CHAMP_LEDGER_NOT_IN_FIELD_CELL,
  CHAMP_LEDGER_NOT_IN_FIELD_LINE,
  CHAMP_LEDGER_NOT_YET_PRICED_CELL,
  CHAMP_LEDGER_ROW_LABELS,
  CHAMP_LEDGER_TAB_LABEL,
  DISTRICT_LEDGER_CAVEAT,
  DISTRICT_LEDGER_CONTRIBUTION_COLUMN_LABELS,
  DISTRICT_LEDGER_CONTRIBUTION_SETTLED,
  DISTRICT_LEDGER_NO_MATCHES,
  DISTRICT_LEDGER_PROVENANCE,
  champLedgerContributionChanceNote,
  champLedgerDcmpStageLine,
  champLedgerDistrictSourceLine,
  champLedgerFieldChanceLine,
  districtLedgerChanceLine,
  districtLedgerContributionEarned,
} from "./districtLedgerCopy.js";
import { buildAdvancementChanceRun, reconcileAdvancementChances } from "./districtLedgerChances.js";
import {
  buildChampAdvancementChanceRun,
  districtFieldMembershipChances,
  reconcileChampAdvancementChances,
} from "./champLedgerChances.js";
import { useDistrictAdvancementChance } from "./useDistrictAdvancementChance.js";
import {
  DISTRICT_LEDGER_STATUS_KEYS,
  computeDistrictLedgerStatuses,
  type DistrictLedgerStatusKey,
} from "./districtLedgerStatus.js";
import { computeChampLedgerStatuses } from "./champLedgerStatus.js";
import {
  buildChampLedgerRows,
  champContributions,
  dcmpEventKeyFor,
  type ChampContribution,
  type ChampLedgerCell,
  type ChampLedgerRow,
  type ChampLedgerRowKind,
  type ChampLedgerTeam,
} from "./champLedgerRows.js";
import {
  DISTRICT_TIMELINE_NOW_ID,
  buildDistrictTimeline,
  districtStageAtPosition,
  eventStartedAtPosition,
  resolveDistrictTimelinePosition,
  startMatchKeyAtPosition,
} from "./districtTimeline.js";
import {
  buildDistrictLedgerRows,
  deriveStageFromState,
  tierEvents,
  type DistrictLedgerCell,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import { useDistrictEventArtifacts, useDistrictLedgerData } from "./useDistrictLedgerData.js";

/** The three TEXT columns (Team, Status, Source); every other header centres over its boxed cells, exactly as the district tier's does. */
const TEXT_COLUMN_INDEXES: ReadonlySet<number> = new Set([0, 1, 3]);

/** Both rows always render, so the Team, Status and Grand total cells always span exactly two. */
const CHAMP_ROW_SPAN = 2;

export interface ChampLocksLedgerProps {
  artifact: DistrictArtifact;
  algorithm: PublishedAlgorithmId;
  season: number;
}

/** One event at one tier, as the timeline and the fetch lists want it. */
interface ChampTierEvent {
  readonly eventKey: string;
  readonly eventName: string;
  readonly week: number | null;
  readonly tier: DistrictTier;
}

/**
 * Every event the champ tab reads, across BOTH tiers, deduplicated and in the
 * order they were first seen — the district events the District points row sums
 * and the one District Championship the DCMP row prices.
 */
function champTierEvents(artifact: DistrictArtifact): ChampTierEvent[] {
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

/**
 * A champ cell, rendered.
 *
 * The three shipped kinds go straight to `LedgerCell`. The two this tier adds
 * are rendered here, and COLOUR IS NEVER THE ONLY ENCODING for either: the em
 * dash and the words both say which one it is, and `data-cell` carries the same
 * distinction for a test.
 */
function ChampCell({ cell, interaction, variant }: { cell: ChampLedgerCell; interaction: CellInteraction; variant?: "total" }) {
  if (cell.kind === "notInField" || cell.kind === "notYetPriced") {
    const isNotInField = cell.kind === "notInField";
    return (
      <TableCell data-cell={isNotInField ? "not-in-field" : "not-yet-priced"} data-cell-id={cell.id} className="numeric-cell">
        <span className={UNAVAILABLE_CELL_CLASS}>{isNotInField ? CHAMP_LEDGER_NOT_IN_FIELD_CELL : CHAMP_LEDGER_NOT_YET_PRICED_CELL}</span>
      </TableCell>
    );
  }
  return <LedgerCell cell={cell} interaction={interaction} variant={variant} />;
}

/**
 * The Source cell: the row's label, and one small line underneath.
 *
 * THE SMALL LINE ANSWERS ONE QUESTION PER ROW. The District points row names
 * its events with their week and stage. The DCMP row says, in priority order,
 * that the team is not in the field, or the chance it will be there, or the
 * championship's own stage.
 */
function SourceCell({ row, team }: { row: ChampLedgerRow; team: ChampLedgerTeam }) {
  const sources = row.sources.map((source) => ({ eventName: source.eventName, week: source.week, stage: stageWordKey(source.stage) }));
  const dcmp = sources[0];
  const small =
    row.kind === "district"
      ? champLedgerDistrictSourceLine(sources)
      : team.membership === "out"
        ? CHAMP_LEDGER_NOT_IN_FIELD_LINE
        : team.fieldChance !== undefined
          ? champLedgerFieldChanceLine(team.fieldChance)
          : dcmp === undefined
            ? ""
            : champLedgerDcmpStageLine(dcmp);
  return (
    // `whitespace-normal` overrides the shared `TableCell`'s own
    // `whitespace-nowrap`: without it the small line does not wrap at the cap
    // below, it OVERFLOWS it and prints underneath the Subtotal cell
    // (seen on a screenshot, 2026-09-26).
    <TableCell data-testid="champ-ledger-source-cell" data-row={row.kind} className="align-middle whitespace-normal">
      {/* CAPPED AND WRAPPING, unlike the district tier's Event cell. That one
          prints one shortened event name and stays on one line; this one
          prints every district event a team played, and a District
          Championship whose published name matches no shortening template
          ("Pacific Northwest FIRST District Championship"). Uncapped it pushed
          the Awards column off a 1440px screen, measured 2026-09-26. */}
      <div className="flex min-w-0 max-w-[230px] flex-col">
        <span className="district-ledger-event-name">{CHAMP_LEDGER_ROW_LABELS[row.kind]}</span>
        {small.length > 0 && <span className="district-ledger-event-stage">{small}</span>}
      </div>
    </TableCell>
  );
}

/**
 * The grand total drawer's right pane: ONE row per source, so a reader can see
 * which half of the champ total the spread comes from.
 *
 * `DistrictContributionList`'s shape and classes, with the one thing the
 * district tier has no equivalent of: the DCMP row prints the FIELD CHANCE it
 * is weighted by, which is why the two subtotals do not add to the grand total
 * while that chance is under one.
 */
function ChampContributionList({ contributions }: { contributions: readonly ChampContribution[] }) {
  return (
    <div className="flex flex-col gap-[var(--spacing-xs)]" data-testid="champ-ledger-drawer-contributions">
      <table className="district-ledger-contributions">
        <caption className="sr-only">{CHAMP_LEDGER_CONTRIBUTION_LIST_LABEL}</caption>
        <thead>
          <tr>
            <th scope="col">{CHAMP_LEDGER_CONTRIBUTION_COLUMN_SOURCE}</th>
            <th scope="col">{DISTRICT_LEDGER_CONTRIBUTION_COLUMN_LABELS.earned}</th>
            <th scope="col">{DISTRICT_LEDGER_CONTRIBUTION_COLUMN_LABELS.open}</th>
          </tr>
        </thead>
        <tbody>
          {contributions.map((entry) => (
            <tr key={entry.row} data-testid="champ-ledger-contribution-row" data-row={entry.row}>
              <th scope="row" className="district-ledger-contributions__event">
                {CHAMP_LEDGER_CONTRIBUTION_ROW_LABELS[entry.row]}
                {entry.fieldChance !== undefined && (
                  <span className="district-ledger-event-stage" data-testid="champ-ledger-contribution-chance">
                    {champLedgerContributionChanceNote(entry.fieldChance)}
                  </span>
                )}
              </th>
              <td className="district-ledger-contributions__earned">
                {entry.notYetPriced ? CHAMP_LEDGER_NOT_YET_PRICED_CELL : districtLedgerContributionEarned(entry.earned)}
              </td>
              <td className="district-ledger-contributions__open">
                {entry.notYetPriced ? (
                  // NOT "settled": nothing here is finished, it was never
                  // priced, and the two absences mean different things.
                  CHAMP_LEDGER_NOT_YET_PRICED_CELL
                ) : entry.open === undefined ? (
                  DISTRICT_LEDGER_CONTRIBUTION_SETTLED
                ) : (
                  <>
                    {`~${String(Math.round(entry.open.p50))}`}{" "}
                    <span className="district-ledger-contributions__range">
                      {likelyRangeText(Math.max(0, entry.open.p10), Math.max(0, entry.open.p90))}
                    </span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="district-ledger-pane-caption">{CHAMP_LEDGER_CONTRIBUTION_CAPTION}</span>
    </div>
  );
}

/**
 * ONE drawer row at a time across the whole table, spanning every column.
 *
 * THE TIER FOLLOWS THE ROW THE CELL CAME FROM. A DCMP cell's outcome lists are
 * priced at the 3x weight by `districtPlayoffOutcomes`/`districtAwardOutcomes`
 * themselves; a District points cell is a SUM over several events, so no named
 * outcome covers its support and it asks for the histogram instead.
 */
function ChampDrawerRow({
  cell,
  row,
  team,
  cutoff,
  columnCount,
  chanceLine,
  season,
  isRookie,
}: {
  cell: Extract<DistrictLedgerCell, { kind: "open" }>;
  /** Which of the team's two rows the clicked cell belongs to; `undefined` for the grand total, which belongs to neither. */
  row: ChampLedgerRowKind | undefined;
  team: ChampLedgerTeam;
  cutoff: LedgerCutoffView;
  columnCount: number;
  chanceLine: string | undefined;
  season: number;
  isRookie: boolean;
}) {
  const animated = prefersReducedMotion() ? "" : " district-ledger-drawer--animated";
  // THE GRAND TOTAL IS DRAWN ONCE. When the clicked cell IS the grand total its
  // own plot is the left pane and the contribution list is the right one,
  // rather than a second copy of the same histogram (Jacob, 2026-09-25).
  const isGrandTotal = cell.cell === "grandTotal";
  return (
    <TableRow data-testid="champ-ledger-drawer" data-drawer-cell={cell.id} className="district-ledger-row--drawer">
      <TableCell colSpan={columnCount}>
        <div className={`flex flex-wrap gap-[var(--spacing-lg)]${animated}`}>
          {isGrandTotal ? (
            <>
              <GrandTotalPlot cell={cell} cutoff={cutoff} rookieBonus={team.rookieBonus} chanceLine={chanceLine} />
              <ChampContributionList contributions={champContributions(team)} />
            </>
          ) : (
            <>
              <DrawerCellPane
                cell={cell}
                season={season}
                isRookie={isRookie}
                tier={row === "dcmp" ? "dcmp" : "district"}
                namedOutcomes={row === "dcmp"}
              />
              {team.grandTotal.kind === "open" && (
                <GrandTotalPlot cell={team.grandTotal} cutoff={cutoff} rookieBonus={team.rookieBonus} chanceLine={chanceLine} />
              )}
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * The exported tab is the IMPLEMENTATION WRAPPED IN A BOUNDARY, exactly as
 * `DistrictLedger` is and for the same reason (phase 10 review, WR-09): the
 * refusals `convolveDistrictGrandTotal`, `maxEventPoints` and `pointCellSummary`
 * raise are caught here rather than costing the whole Locks page.
 */
export function ChampLocksLedger(props: ChampLocksLedgerProps) {
  return (
    <ErrorBoundary resource={`the ${CHAMP_LEDGER_TAB_LABEL} tab`}>
      <ChampLocksLedgerContent {...props} />
    </ErrorBoundary>
  );
}

function ChampLocksLedgerContent({ artifact, algorithm, season }: ChampLocksLedgerProps) {
  // `strict: false` plus a narrow local cast — the documented escape hatch for
  // a control mounted inside a route whose search type it does not own.
  const search = useSearch({ strict: false }) as { at?: string; drawerTeam?: number; drawerCell?: string };
  const navigate = useNavigate() as unknown as DistrictLedgerNavigate;

  const [query, setQuery] = useState("");
  const [hiddenStatuses, setHiddenStatuses] = useState<ReadonlySet<DistrictLedgerStatusKey>>(() => new Set());

  const events = useMemo(() => champTierEvents(artifact), [artifact]);
  const dcmpEventKey = useMemo(() => dcmpEventKeyFor(artifact), [artifact]);
  const tierByEvent = useMemo(() => new Map(events.map((event) => [event.eventKey, event.tier] as const)), [events]);
  const allowedEventKeys = useMemo(() => events.map((event) => event.eventKey).sort(), [events]);

  /** The "now" answer, across BOTH tiers: the artifact's own `state` blocks, and nothing else. */
  const nowStageByEvent = useMemo(() => {
    const map = new Map<string, DistrictStageFinality>();
    for (const tier of ["district", "dcmp"] as const) {
      for (const team of artifact.teams) {
        for (const entry of tierEvents(team, tier)) {
          if (map.has(entry.eventKey)) continue;
          map.set(entry.eventKey, deriveStageFromState(entry.state).final);
        }
      }
    }
    return map;
  }, [artifact]);

  /** Started and not finished at "now", across both tiers — the fetch set at the live position. */
  const inProgressKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const tier of ["district", "dcmp"] as const) {
      for (const team of artifact.teams) {
        for (const entry of tierEvents(team, tier)) {
          const stage = deriveStageFromState(entry.state);
          if (stage.started && !stage.finished) keys.add(entry.eventKey);
        }
      }
    }
    return [...keys].sort();
  }, [artifact]);

  const startedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const tier of ["district", "dcmp"] as const) {
      for (const team of artifact.teams) {
        for (const entry of tierEvents(team, tier)) {
          if (deriveStageFromState(entry.state).started) keys.add(entry.eventKey);
        }
      }
    }
    return [...keys].sort();
  }, [artifact]);

  /** Whether the District Championship has started at the LIVE position, from its own `state` block. */
  const dcmpStartedNow = useMemo(() => {
    if (dcmpEventKey === undefined) return false;
    return startedKeys.includes(dcmpEventKey);
  }, [dcmpEventKey, startedKeys]);

  /**
   * The artifact's own rookie flag per team, for the Awards drawer's outcome
   * list: a veteran's Rookie All Star row is OMITTED rather than printed at
   * zero, because a veteran cannot win it and the draw consumes no randomness
   * for it.
   */
  const isRookieByTeam = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const team of artifact.teams) {
      if (team.awardProfile !== undefined) map.set(team.teamKey, team.awardProfile.rookie);
    }
    return map;
  }, [artifact]);

  const rewinding = search.at !== undefined && search.at !== DISTRICT_TIMELINE_NOW_ID;
  const activeEventKeys = rewinding ? startedKeys : inProgressKeys;
  const artifacts = useDistrictEventArtifacts(activeEventKeys);

  const timeline = useMemo(() => buildDistrictTimeline({ events, eventArtifacts: artifacts.eventArtifacts }), [events, artifacts.eventArtifacts]);
  const positionIndex = resolveDistrictTimelinePosition(timeline, search.at);
  const atNow = positionIndex >= timeline.nowIndex;

  const stageByEvent = useMemo(
    () => districtStageAtPosition(timeline, positionIndex, nowStageByEvent),
    [timeline, positionIndex, nowStageByEvent]
  );
  const startMatchKeyByEvent = useMemo(() => {
    if (atNow) return undefined;
    const map = new Map<string, string | null>();
    for (const event of events) map.set(event.eventKey, startMatchKeyAtPosition(timeline, positionIndex, event.eventKey));
    return map;
  }, [atNow, events, timeline, positionIndex]);

  /**
   * Whether the DCMP has started AT THE POSITION. At "now" that is the
   * artifact's own `state` block; rewound it is the rail, because a finished
   * event's state block would report "started" at every position behind it.
   */
  const dcmpStarted = useMemo(() => {
    if (dcmpEventKey === undefined) return false;
    return atNow ? dcmpStartedNow : eventStartedAtPosition(timeline, positionIndex, dcmpEventKey);
  }, [dcmpEventKey, atNow, dcmpStartedNow, timeline, positionIndex]);

  function handleCellToggle(teamNumber: number, cellId: string): void {
    void navigate({
      search: (prev) => {
        const alreadyOpen = prev.drawerTeam === teamNumber && prev.drawerCell === cellId;
        return alreadyOpen
          ? { ...prev, drawerTeam: undefined, drawerCell: undefined }
          : { ...prev, drawerTeam: teamNumber, drawerCell: cellId };
      },
      resetScroll: false,
    });
  }

  function handlePositionChange(index: number): void {
    const id = timeline.positions[index]?.id ?? DISTRICT_TIMELINE_NOW_ID;
    void navigate({ search: (prev) => ({ ...prev, at: id === DISTRICT_TIMELINE_NOW_ID ? undefined : id }), replace: true, resetScroll: false });
  }

  const data = useDistrictLedgerData({
    artifact,
    activeEventKeys,
    eventArtifacts: artifacts.eventArtifacts,
    stageByEvent,
    startMatchKeyByEvent,
    allowedEventKeys,
    tierByEvent,
  });

  const passOptions = useMemo(
    () => ({
      artifact,
      distributions: data.distributions,
      stageByEvent: atNow ? undefined : stageByEvent,
      unavailableEvents: data.unavailableEvents,
      gaps: { ...data.gaps, missingEventArtifacts: artifacts.missingEventArtifacts },
    }),
    [artifact, data.distributions, atNow, stageByEvent, data.unavailableEvents, data.gaps, artifacts.missingEventArtifacts]
  );

  /**
   * THE DISTRICT-TIER PASS, for the field chance alone. Its verdicts are what
   * widen the district run's raw marginal into the "to be there" chance, and
   * what decide whether a team can still reach the field at all.
   */
  const districtRows = useMemo(() => buildDistrictLedgerRows({ ...passOptions, tier: "district" }), [passOptions]);
  const districtStatuses = useMemo(
    () => computeDistrictLedgerStatuses({ artifact, teams: districtRows.teams }),
    [artifact, districtRows.teams]
  );
  const districtLockedOut = useMemo(() => {
    const keys = new Set<string>();
    for (const [teamKey, result] of districtStatuses.byTeam) if (result.status === "lockedOut") keys.add(teamKey);
    return keys;
  }, [districtStatuses]);

  const positionId = timeline.positions[positionIndex]?.id ?? DISTRICT_TIMELINE_NOW_ID;
  const runSignature = data.runState.status === "complete" ? data.runState.signature : data.runState.status === "idle" ? "" : null;

  const districtChanceRun = useMemo(
    () => buildAdvancementChanceRun({ artifact, teams: districtRows.teams, statuses: districtStatuses, runSignature, positionId }),
    [artifact, districtRows.teams, districtStatuses, runSignature, positionId]
  );
  const districtChanceState = useDistrictAdvancementChance(districtChanceRun);

  /** The "to be there" chance per team — 1 for a district-locked team, 0 for a locked-out one, the marginal in between, ABSENT where the run did not rank it. */
  const fieldChanceByTeam = useMemo(
    () =>
      districtChanceState.status === "complete"
        ? districtFieldMembershipChances(districtChanceState.chanceByTeam, districtStatuses)
        : new Map<string, number>(),
    [districtChanceState, districtStatuses]
  );

  const rows = useMemo(
    () => buildChampLedgerRows({ ...passOptions, fieldChanceByTeam, dcmpStarted, atLivePosition: atNow }),
    [passOptions, fieldChanceByTeam, dcmpStarted, atNow]
  );

  const statuses = useMemo(
    () => computeChampLedgerStatuses({ artifact, teams: rows.teams, districtLockedOut }),
    [artifact, rows.teams, districtLockedOut]
  );

  /**
   * THE SECOND RUN, suppressed while any grand total is district-only.
   *
   * A district-only total is not a champ grand total: ranking it against
   * `cmpSlots` would rank a quantity the column does not print, and the number
   * it produced would read as a chance of reaching the Championship. So the
   * chance line is ABSENT in the pre-registration window rather than wrong, and
   * never a silent zero.
   */
  const champChanceRun = useMemo(() => {
    if (rows.gaps.teamsWithDistrictOnlyGrandTotal.length > 0) return undefined;
    return buildChampAdvancementChanceRun({
      artifact,
      teams: rows.teams,
      statuses,
      runSignature,
      positionId,
      dcmpEventKey: rows.dcmpEventKey,
      fieldChanceByTeam,
    });
  }, [artifact, rows, statuses, runSignature, positionId, fieldChanceByTeam]);

  const champChanceState = useDistrictAdvancementChance(champChanceRun);
  const chances = useMemo(
    () => (champChanceState.status === "complete" ? reconcileChampAdvancementChances(champChanceState.chanceByTeam, statuses) : undefined),
    [champChanceState, statuses]
  );
  const chanceLineFor = (teamKey: string): string | undefined => {
    const chance = chances?.byTeam.get(teamKey);
    return chance === undefined ? undefined : districtLedgerChanceLine(chance);
  };

  /**
   * THE PREDICTED CUTOFF, built ONCE and handed to both the stat line and every
   * grand total dashed rule (quick task 260926-37q).
   *
   * It reads `cmpSlots`, this tab's OWN qualifier sets and its always zero
   * reservation, so the line it draws is the line the verdicts beside it were
   * cut at. `districtOnly` is the pre registration window's own gate, the same
   * one that suppresses the champ chance run, so the label says which grand
   * totals the cutoff was taken over.
   *
   * THE LIKELY RANGE COMES FROM THE CHAMP RUN, which is already suppressed in
   * that window — so the range is absent there BY CONSTRUCTION rather than by
   * a second condition restating the same rule.
   */
  const cutoff = useMemo<LedgerCutoffView>(() => {
    const value = predictedCutoff({
      teams: rows.teams,
      capacity: artifact.cmpSlots,
      qualifiers: { awardQualified: new Set(statuses.awardQualified), prequalified: new Set(statuses.prequalified) },
      reservedSlots: statuses.reservedSlots,
    });
    const likely =
      value.kind === "predicted" && champChanceState.status === "complete"
        ? simulatedCutoffRange(champChanceState.cutoffByRun, champChanceState.draws)
        : undefined;
    return { cutoff: value, likely, districtOnly: rows.gaps.teamsWithDistrictOnlyGrandTotal.length > 0 };
  }, [rows, artifact.cmpSlots, statuses, champChanceState]);

  const activeStatuses = useMemo(
    () => new Set(DISTRICT_LEDGER_STATUS_KEYS.filter((status) => !hiddenStatuses.has(status))),
    [hiddenStatuses]
  );
  const visibleTeams = useMemo(() => {
    const trimmed = query.trim();
    const searched = trimmed.length === 0 ? rows.teams : rows.teams.filter((team) => String(team.teamNumber).startsWith(trimmed));
    if (hiddenStatuses.size === 0) return searched;
    return searched.filter((team) => {
      const status = statuses.byTeam.get(team.teamKey)?.status;
      if (status === undefined || status === "capacityUnknown") return true;
      return !hiddenStatuses.has(status);
    });
  }, [rows.teams, query, hiddenStatuses, statuses]);

  /**
   * At most ONE drawer is open across the whole table, driven by the two typed
   * search params so it is shareable and survives a reload. An unknown team
   * number or an unknown cell id resolves to CLOSED, never to a neighbouring
   * cell — which is why this is a lookup rather than an index, and why the
   * champ cell ids are deliberately disjoint from the district tab's.
   */
  const openDrawer = useMemo(() => {
    if (search.drawerTeam === undefined || search.drawerCell === undefined) return undefined;
    const team = rows.teams.find((entry) => entry.teamNumber === search.drawerTeam);
    if (team === undefined) return undefined;
    if (search.drawerCell === team.grandTotal.id && team.grandTotal.kind === "open") {
      return { team, cell: team.grandTotal, row: undefined };
    }
    for (const row of team.rows) {
      for (const cell of [...row.cells, row.subtotal]) {
        if (cell.id !== search.drawerCell) continue;
        if (cell.kind !== "open") return undefined;
        return { team, cell, row: row.kind };
      }
    }
    return undefined;
  }, [rows.teams, search.drawerTeam, search.drawerCell]);

  function toggleStatus(status: DistrictLedgerStatusKey): void {
    setHiddenStatuses((previous) => {
      const next = new Set(previous);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  if (artifact.teams.length === 0) {
    return (
      <EmptyState
        heading={`No teams for ${artifact.displayName}`}
        body={`No district ranking data found for ${artifact.displayName}. Check back later.`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]" data-testid="champ-ledger-tab">
      <ControlsCard query={query} onQueryChange={setQuery} cutoff={cutoff}>
        <RewindSlider timeline={timeline} positionIndex={positionIndex} onPositionChange={handlePositionChange} />
        <StatusChips counts={statuses.counts} active={activeStatuses} onToggle={toggleStatus} />
      </ControlsCard>
      <p className="text-[var(--color-text-muted)]" data-testid="champ-ledger-caveat">
        {DISTRICT_LEDGER_CAVEAT} {DISTRICT_LEDGER_PROVENANCE}
      </p>
      {visibleTeams.length === 0 && <p className="text-[var(--color-text-muted)]">{DISTRICT_LEDGER_NO_MATCHES}</p>}
      <div className="data-card w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <Table className="district-ledger-table">
          <TableHeader>
            <TableRow>
              {CHAMP_LEDGER_COLUMN_LABELS.map((label, index) => (
                <TableHead key={label} className={TEXT_COLUMN_INDEXES.has(index) ? undefined : "text-center"}>
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleTeams.flatMap((team) => {
              const interaction: CellInteraction = {
                openCellId: openDrawer?.team.teamKey === team.teamKey ? openDrawer.cell.id : undefined,
                onToggle: (cellId) => handleCellToggle(team.teamNumber, cellId),
              };
              const status = statuses.byTeam.get(team.teamKey);
              const dataRows = team.rows.map((row, rowIndex) => (
                <TableRow
                  key={`${team.teamKey}-${row.kind}`}
                  data-testid="champ-ledger-row"
                  data-team={team.teamKey}
                  data-row={row.kind}
                  className={rowIndex === 0 ? "district-ledger-row--team-start" : "district-ledger-row--team-inner"}
                >
                  {rowIndex === 0 && (
                    <TeamCell
                      team={{
                        teamNumber: team.teamNumber,
                        nickname: team.nickname,
                        rowCount: CHAMP_ROW_SPAN,
                        position: team.position,
                        // The ALL-TIER earned total at this tier: the champ race
                        // counts DCMP points too, so the district tab's
                        // district-only figure would understate it.
                        earnedDistrictTotal: team.earnedAllTierTotal,
                        hasOpenCategory: team.hasOpenCategory,
                        projection: team.projection,
                        rookieBonus: team.rookieBonus,
                      }}
                      season={season}
                      algorithm={algorithm}
                    />
                  )}
                  {rowIndex === 0 && (
                    <StatusCell
                      status={status}
                      rowSpan={CHAMP_ROW_SPAN}
                      chanceLine={chanceLineFor(team.teamKey)}
                      awardLabel={status?.awardKind === "winner" ? CHAMP_LEDGER_LOCKED_WINNER_LABEL : undefined}
                    />
                  )}
                  {rowIndex === 0 && (
                    <TableCell rowSpan={CHAMP_ROW_SPAN} data-testid="champ-ledger-grand-total" className="numeric-cell align-middle">
                      <GrandTotalContent cell={team.grandTotal} interaction={interaction} />
                      {team.grandTotalIsDistrictOnly && (
                        <span className="district-ledger-team-meta block whitespace-nowrap" data-testid="champ-ledger-district-only">
                          {CHAMP_LEDGER_DISTRICT_ONLY_LINE}
                        </span>
                      )}
                    </TableCell>
                  )}
                  <SourceCell row={row} team={team} />
                  <ChampCell cell={row.subtotal} interaction={interaction} variant="total" />
                  {row.cells.map((cell) => (
                    <ChampCell key={cell.id} cell={cell} interaction={interaction} />
                  ))}
                </TableRow>
              ));
              if (openDrawer?.team.teamKey !== team.teamKey) return dataRows;
              return [
                ...dataRows,
                <ChampDrawerRow
                  key={`${team.teamKey}-drawer`}
                  cell={openDrawer.cell}
                  row={openDrawer.row}
                  team={team}
                  cutoff={cutoff}
                  columnCount={CHAMP_LEDGER_COLUMN_LABELS.length}
                  chanceLine={chanceLineFor(team.teamKey)}
                  season={season}
                  isRookie={isRookieByTeam.get(team.teamKey) === true}
                />,
              ];
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
