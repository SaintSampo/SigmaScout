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
  GrandTotalContent,
  LedgerCell,
  RewindSlider,
  StatusCell,
  StatusChips,
  TeamCell,
  UNAVAILABLE_CELL_CLASS,
  stageWordKey,
  type CellInteraction,
  type DistrictLedgerNavigate,
} from "./LedgerParts.js";
import {
  CHAMP_LEDGER_COLUMN_LABELS,
  CHAMP_LEDGER_DISTRICT_ONLY_LINE,
  CHAMP_LEDGER_LOCKED_WINNER_LABEL,
  CHAMP_LEDGER_NOT_IN_FIELD_CELL,
  CHAMP_LEDGER_NOT_IN_FIELD_LINE,
  CHAMP_LEDGER_NOT_YET_PRICED_CELL,
  CHAMP_LEDGER_ROW_LABELS,
  CHAMP_LEDGER_TAB_LABEL,
  DISTRICT_LEDGER_CAVEAT,
  DISTRICT_LEDGER_NO_MATCHES,
  DISTRICT_LEDGER_PROVENANCE,
  champLedgerDistrictSourceLine,
  champLedgerFieldChanceLine,
  districtLedgerChanceLine,
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
  dcmpEventKeyFor,
  type ChampLedgerCell,
  type ChampLedgerRow,
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
  const stageLine = champLedgerDistrictSourceLine(sources);
  const small =
    row.kind === "district"
      ? stageLine
      : team.membership === "out"
        ? CHAMP_LEDGER_NOT_IN_FIELD_LINE
        : team.fieldChance !== undefined
          ? champLedgerFieldChanceLine(team.fieldChance)
          : stageLine;
  return (
    <TableCell data-testid="champ-ledger-source-cell" data-row={row.kind} className="align-middle">
      <span className="district-ledger-event-name">{CHAMP_LEDGER_ROW_LABELS[row.kind]}</span>
      {small.length > 0 && <span className="district-ledger-event-stage">{small}</span>}
    </TableCell>
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
   * Today's line comes from the CHAMP status model, never from
   * `districtLedgerStatLine`: that function does not narrow the pool by the
   * DCMP's own award qualifiers, so it would print a different number from the
   * artifact's own `insights.cmpCutLinePoints`.
   */
  const statLine = useMemo(
    () => ({ todaysLineFloor: statuses.todaysLine, openCells: 0, totalCells: 0 }),
    [statuses.todaysLine]
  );

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
      <ControlsCard query={query} onQueryChange={setQuery} statLine={statLine}>
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
                openCellId: search.drawerTeam === team.teamNumber ? search.drawerCell : undefined,
                onToggle: (cellId) => handleCellToggle(team.teamNumber, cellId),
              };
              const status = statuses.byTeam.get(team.teamKey);
              return team.rows.map((row, rowIndex) => (
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
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
