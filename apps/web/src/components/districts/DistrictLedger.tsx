/**
 * The District Locks tab — the district tier's whole page.
 *
 * WHAT RENDERS WHERE, and WHICH NUMBERS COME FROM WHERE:
 *
 * - Every GREY cell is TBA's own number, read straight off the district
 *   artifact's `eventPoints[category]`. It is never a value derived from the
 *   simulation, because 10-04's ranking comparator's team-key tiebreak is not
 *   TBA's official tiebreak and a derived qualification-points value can
 *   honestly disagree with the earned one for tied teams.
 * - Every BLUE cell is a prediction from this site's own simulation: the joint
 *   `simulateDistrictEvent` run in a Web Worker for an event in progress, or
 *   10-06's baked marginals for an event that has not started. The words come
 *   from `districtLedgerCopy.ts`; the numbers and the FORM come from 10-04's
 *   `pointSummary.ts`.
 *
 * THE PREDICTED CUTOFF is the one number the controls card and every grand
 * total dashed rule share: the midpoint of the last team In range and the
 * first team Out of range, over the same median projections the table is
 * sorted by. It follows the ranking and never moves a status.
 *
 * THE GREY/BLUE RULE IS NEVER HUE ALONE, per the sketch README's language
 * rules: a grey cell holds ONE integer and is not focusable; a blue cell holds
 * TWO lines and is a real `<button>`. `data-cell` carries the same distinction
 * for a test, so no assertion in this file's suite depends on a colour.
 *
 * Every colour reaches the page through a CSS custom property. Where a
 * `text-role-*` class sits beside a colour custom property the class list is
 * written as a PLAIN STRING rather than passed through `cn()` — tailwind-merge
 * drops the role class in that combination and only a screenshot catches it
 * (project memory `project_cn_drops_text_role_classes`).
 */
import { useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { EmptyState } from "@/components/StateViews";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
// The ledger's shared presentational parts, extracted UNCHANGED so the Champ
// Locks tab renders the same cells, chips, drawer panes and slider rather than
// a second copy of them (quick task 260925-xab).
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
  likelyRangeText,
  stageWord,
  type CellInteraction,
  type DistrictLedgerNavigate,
} from "./LedgerParts.js";
import {
  DISTRICT_LEDGER_CAVEAT,
  DISTRICT_LEDGER_COLUMN_LABELS,
  DISTRICT_LEDGER_NO_MATCHES,
  DISTRICT_LEDGER_PROVENANCE,
  DISTRICT_LEDGER_TAB_LABEL,
  DISTRICT_LEDGER_CONTRIBUTION_CAPTION,
  DISTRICT_LEDGER_CONTRIBUTION_COLUMN_LABELS,
  DISTRICT_LEDGER_CONTRIBUTION_LIST_LABEL,
  DISTRICT_LEDGER_CONTRIBUTION_SETTLED,
  DISTRICT_LEDGER_UNAVAILABLE_CELL,
  districtLedgerChanceLine,
  districtLedgerContributionEarned,
  districtLedgerShortEventName,
} from "./districtLedgerCopy.js";
import { buildAdvancementChanceRun, reconcileAdvancementChances } from "./districtLedgerChances.js";
import { useDistrictAdvancementChance } from "./useDistrictAdvancementChance.js";
import {
  DISTRICT_LEDGER_STATUS_KEYS,
  computeDistrictLedgerStatuses,
  type DistrictLedgerStatusKey,
} from "./districtLedgerStatus.js";
import {
  DISTRICT_TIMELINE_NOW_ID,
  buildDistrictTimeline,
  districtStageAtPosition,
  resolveDistrictTimelinePosition,
  startMatchKeyAtPosition,
} from "./districtTimeline.js";
import {
  buildDistrictLedgerRows,
  deriveStageFromState,
  districtEventContributions,
  districtTierEvents,
  filterDistrictLedgerTeams,
  inProgressDistrictEventKeys,
  type DistrictEventContribution,
  type DistrictLedgerCell,
  type DistrictLedgerEventRow,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import { useDistrictEventArtifacts, useDistrictLedgerData } from "./useDistrictLedgerData.js";
import { predictedCutoff, simulatedCutoffRange, type LedgerCutoffView } from "./predictedCutoff.js";

/** The first three columns are words; every column after them is a number, and a number column is centred under a centred header. */
/** The three text columns (Team, Status, Event); every other header centres over its boxed cells. Jacob's order, 2026-09-25: Team, Status, Grand total, Event, Event total, then the four categories. */
const TEXT_COLUMN_INDEXES: ReadonlySet<number> = new Set([0, 1, 3]);

export interface DistrictLedgerProps {
  artifact: DistrictArtifact;
  algorithm: PublishedAlgorithmId;
  season: number;
}

function EventCell({ row }: { row: DistrictLedgerEventRow }) {
  return (
    <TableCell data-testid="district-ledger-event-cell" className="whitespace-nowrap align-middle">
      <span className="district-ledger-event-name">{districtLedgerShortEventName(row.eventName)}</span>
      {row.week !== null && <span className="district-ledger-event-week"> Wk {String(row.week + 1)}</span>}
      <span className="district-ledger-event-stage">{stageWord(row.stage)}</span>
    </TableCell>
  );
}

/**
 * ONE drawer row at a time across the whole table, spanning every column,
 * carrying the clicked cell's histogram beside the grand total's.
 */
function DrawerRow({
  cell,
  grandTotal,
  cutoff,
  columnCount,
  rookieBonus,
  chanceLine,
  season,
  isRookie,
  contributions,
}: {
  cell: Extract<DistrictLedgerCell, { kind: "open" }>;
  grandTotal: DistrictLedgerCell;
  cutoff: LedgerCutoffView;
  columnCount: number;
  rookieBonus: number;
  /** This team's printed chance line, or `undefined` where no chance is printed — the caption follows the line rather than announcing one that is not there. */
  chanceLine: string | undefined;
  season: number;
  /** The artifact's own `awardProfile.rookie`. A veteran's Rookie All Star row is omitted rather than printed at zero. */
  isRookie: boolean;
  /** One row per district-tier event, for the GRAND TOTAL drawer's contribution list. */
  contributions: readonly DistrictEventContribution[];
}) {
  // THE GRAND TOTAL IS DRAWN ONCE. When the clicked cell IS the grand total its
  // own plot is the left pane, and the right pane is the per-event contribution
  // list rather than a second copy of the same histogram (Jacob, 2026-09-25).
  const isGrandTotal = cell.cell === "grandTotal";
  return (
    <TableRow data-testid="district-ledger-drawer" data-drawer-cell={cell.id} className="district-ledger-row--drawer">
      <TableCell colSpan={columnCount}>
        <div className="flex flex-wrap gap-[var(--spacing-lg)]">
          {isGrandTotal ? (
            <>
              <GrandTotalPlot cell={cell} cutoff={cutoff} rookieBonus={rookieBonus} chanceLine={chanceLine} />
              <DistrictContributionList contributions={contributions} />
            </>
          ) : (
            <>
              <DrawerCellPane cell={cell} season={season} isRookie={isRookie} />
              {grandTotal.kind === "open" && (
                <GrandTotalPlot cell={grandTotal} cutoff={cutoff} rookieBonus={rookieBonus} chanceLine={chanceLine} />
              )}
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * The grand total drawer's right pane: one row per district-tier event, so a
 * reader can see WHICH event the spread comes from.
 *
 * REPLACES A SECOND COPY OF THE SAME HISTOGRAM. Clicking the grand total used to
 * draw its plot as the clicked cell AND again as the grand total beside it —
 * identical bars, identical band, identical tick, twice (Jacob, 2026-09-25:
 * "do not draw the same histogram twice").
 */
function DistrictContributionList({ contributions }: { contributions: readonly DistrictEventContribution[] }) {
  return (
    <div className="flex flex-col gap-[var(--spacing-xs)]" data-testid="district-ledger-drawer-contributions">
      <table className="district-ledger-contributions">
        <caption className="sr-only">{DISTRICT_LEDGER_CONTRIBUTION_LIST_LABEL}</caption>
        <thead>
          <tr>
            <th scope="col">{DISTRICT_LEDGER_CONTRIBUTION_COLUMN_LABELS.event}</th>
            <th scope="col">{DISTRICT_LEDGER_CONTRIBUTION_COLUMN_LABELS.earned}</th>
            <th scope="col">{DISTRICT_LEDGER_CONTRIBUTION_COLUMN_LABELS.open}</th>
          </tr>
        </thead>
        <tbody>
          {contributions.map((entry) => (
            <tr key={entry.eventKey} data-testid="district-ledger-contribution-row" data-event={entry.eventKey}>
              <th scope="row" className="district-ledger-contributions__event">
                {districtLedgerShortEventName(entry.eventName)}
              </th>
              <td className="district-ledger-contributions__earned">{districtLedgerContributionEarned(entry.earned)}</td>
              <td className="district-ledger-contributions__open">
                {entry.open === undefined ? (
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
      <span className="district-ledger-pane-caption">{DISTRICT_LEDGER_CONTRIBUTION_CAPTION}</span>
    </div>
  );
}

/**
 * The exported tab is the IMPLEMENTATION WRAPPED IN A BOUNDARY, so every call
 * site gets the containment rather than whichever one remembered to ask for it
 * (phase 10 review, WR-09).
 *
 * `DistrictLedgerContent` below calls three functions that each document
 * themselves as refusing rather than fabricating — `convolveDistrictGrandTotal`
 * (`NegativeDistrictShiftError`), `maxEventPoints` (`UnknownDistrictSeasonError`)
 * and `pointCellSummary` (`EmptyDistributionError`) — from inside render-path
 * `useMemo`s. `buildDistrictLedgerRows` now degrades PER TEAM for the failures
 * it can attribute to one team; this boundary catches the rest, so a refusal
 * that applies to the whole table costs this tab and not the whole Locks page.
 *
 * `ErrorBoundary` renders a keyed Fragment, never a wrapper element, so this
 * indirection changes no rendered DOM on the ordinary path.
 */
export function DistrictLedger(props: DistrictLedgerProps) {
  return (
    <ErrorBoundary resource={`the ${DISTRICT_LEDGER_TAB_LABEL} tab`}>
      <DistrictLedgerContent {...props} />
    </ErrorBoundary>
  );
}

function DistrictLedgerContent({ artifact, algorithm, season }: DistrictLedgerProps) {
  // `strict: false` plus a narrow local cast — the documented escape hatch for
  // a control mounted inside a route whose search type it does not own.
  const search = useSearch({ strict: false }) as { at?: string; drawerTeam?: number; drawerCell?: string };
  const navigate = useNavigate() as unknown as DistrictLedgerNavigate;

  const [query, setQuery] = useState("");
  const [hiddenStatuses, setHiddenStatuses] = useState<ReadonlySet<DistrictLedgerStatusKey>>(() => new Set());

  /** The district's own district-tier events, deduplicated, in the order they were first seen. */
  const districtEvents = useMemo(() => {
    const byKey = new Map<string, { eventKey: string; eventName: string; week: number | null }>();
    for (const team of artifact.teams) {
      for (const entry of districtTierEvents(team)) {
        if (!byKey.has(entry.eventKey)) byKey.set(entry.eventKey, { eventKey: entry.eventKey, eventName: entry.eventName, week: entry.week });
      }
    }
    return [...byKey.values()];
  }, [artifact]);

  /** The "now" answer: 10-03's `state` blocks, and nothing else. */
  const nowStageByEvent = useMemo(() => {
    const map = new Map<string, DistrictStageFinality>();
    for (const team of artifact.teams) {
      for (const entry of districtTierEvents(team)) {
        if (map.has(entry.eventKey)) continue;
        map.set(entry.eventKey, deriveStageFromState(entry.state).final);
      }
    }
    return map;
  }, [artifact]);

  /**
   * The artifact's own rookie flag per team, for the Awards drawer's outcome
   * list: a veteran's Rookie All Star row is OMITTED rather than printed at
   * zero, because a veteran cannot win it and the draw consumes no randomness
   * for it. An artifact that publishes no `awardProfile` yields no entry, and an
   * outcome the tab cannot establish is not an outcome to offer.
   */
  const isRookieByTeam = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const team of artifact.teams) {
      if (team.awardProfile !== undefined) map.set(team.teamKey, team.awardProfile.rookie);
    }
    return map;
  }, [artifact]);

  const inProgressKeys = useMemo(() => inProgressDistrictEventKeys(artifact), [artifact]);
  const startedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const team of artifact.teams) {
      for (const entry of districtTierEvents(team)) {
        if (deriveStageFromState(entry.state).started) keys.add(entry.eventKey);
      }
    }
    return [...keys].sort();
  }, [artifact]);

  // The FETCH set, decided from the raw search param rather than from the
  // resolved position, which is what keeps artifacts -> timeline -> stage
  // acyclic: a rewind widens it to every started district-tier event, because
  // the interleaved timeline is built from those artifacts' own schedules.
  // At "now" it is the in-progress events alone, so a finished or unstarted
  // district fetches nothing at all (SC-5).
  const rewinding = search.at !== undefined && search.at !== DISTRICT_TIMELINE_NOW_ID;
  const activeEventKeys = rewinding ? startedKeys : inProgressKeys;
  const artifacts = useDistrictEventArtifacts(activeEventKeys);

  const timeline = useMemo(
    () => buildDistrictTimeline({ events: districtEvents, eventArtifacts: artifacts.eventArtifacts }),
    [districtEvents, artifacts.eventArtifacts]
  );
  const positionIndex = resolveDistrictTimelinePosition(timeline, search.at);
  const atNow = positionIndex >= timeline.nowIndex;

  const stageByEvent = useMemo(
    () => districtStageAtPosition(timeline, positionIndex, nowStageByEvent),
    [timeline, positionIndex, nowStageByEvent]
  );
  // At "now" no override is supplied at all, so each event falls back to its
  // own first unplayed row — the honest live answer, which a rewound position
  // replaces with the first row strictly after the step.
  const startMatchKeyByEvent = useMemo(() => {
    if (atNow) return undefined;
    const map = new Map<string, string | null>();
    for (const event of districtEvents) map.set(event.eventKey, startMatchKeyAtPosition(timeline, positionIndex, event.eventKey));
    return map;
  }, [atNow, districtEvents, timeline, positionIndex]);

  /**
   * The drawer is driven by the two typed search params, so it is shareable and
   * survives a reload. An unknown team or cell id resolves to CLOSED, never to
   * a neighbouring cell — the same rule the timeline resolver follows.
   */
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
    // `replace`: a drag is one gesture, not a trail of history entries.
    void navigate({ search: (prev) => ({ ...prev, at: id === DISTRICT_TIMELINE_NOW_ID ? undefined : id }), replace: true, resetScroll: false });
  }

  const data = useDistrictLedgerData({
    artifact,
    activeEventKeys,
    eventArtifacts: artifacts.eventArtifacts,
    stageByEvent,
    startMatchKeyByEvent,
  });

  const rows = useMemo(
    () =>
      buildDistrictLedgerRows({
        artifact,
        distributions: data.distributions,
        stageByEvent: atNow ? undefined : stageByEvent,
        unavailableEvents: data.unavailableEvents,
        gaps: { ...data.gaps, missingEventArtifacts: artifacts.missingEventArtifacts },
      }),
    [artifact, data.distributions, atNow, stageByEvent, data.unavailableEvents, data.gaps, artifacts.missingEventArtifacts]
  );

  const statuses = useMemo(() => computeDistrictLedgerStatuses({ artifact, teams: rows.teams }), [artifact, rows.teams]);

  /**
   * THE ADVANCEMENT CHANCE, in three steps that each refuse rather than guess.
   *
   * `buildAdvancementChanceRun` decides whether there is anything to rank at
   * all (a published capacity, something still open, a run that is not in
   * flight, and a grand total for every single team); the hook runs it in the
   * district Worker, so the main thread never ranks a whole district a thousand
   * times; `reconcileAdvancementChances` narrows the raw run set to the teams
   * whose chip is allowed to carry a number.
   *
   * `runState.status === "complete"` carries the per-event run's exact
   * signature, and a `null` in its place suppresses the whole request: while
   * the run is in flight the grand totals are still being built. `"idle"` is
   * NOT in flight — it is the SC-5 case where there was nothing to simulate,
   * and the baked distributions are already in hand — so it passes an empty
   * signature rather than a null.
   */
  const chanceRun = useMemo(() => {
    const runSignature =
      data.runState.status === "complete" ? data.runState.signature : data.runState.status === "idle" ? "" : null;
    return buildAdvancementChanceRun({
      artifact,
      teams: rows.teams,
      statuses,
      runSignature,
      positionId: timeline.positions[positionIndex]?.id ?? DISTRICT_TIMELINE_NOW_ID,
    });
  }, [artifact, rows.teams, statuses, data.runState, timeline, positionIndex]);

  const chanceState = useDistrictAdvancementChance(chanceRun);
  const chances = useMemo(
    () => (chanceState.status === "complete" ? reconcileAdvancementChances(chanceState.chanceByTeam, statuses) : undefined),
    [chanceState, statuses]
  );
  /** One team's printed line, or `undefined` where nothing is printed — a pending run and a guaranteed status are the same absence here. */
  const chanceLineFor = (teamKey: string): string | undefined => {
    const chance = chances?.byTeam.get(teamKey);
    return chance === undefined ? undefined : districtLedgerChanceLine(chance);
  };

  /**
   * THE PREDICTED CUTOFF, built ONCE and handed to both the stat line and every
   * grand total dashed rule, so the two cannot disagree (quick task
   * 260926-37q).
   *
   * It reads the tab's own sorted rows, the artifact's capacity and the SAME
   * qualifier sets and reservation the verdicts beside it were computed with,
   * so the line it draws is the line those verdicts were cut at. The likely
   * range comes from the chance run's own per run simulated line, and is
   * absent while that run is in flight, at a settled position and at every arm
   * but the predicted one.
   *
   * Like the chip counts, it describes the DISTRICT and not the filtered view.
   */
  const cutoff = useMemo<LedgerCutoffView>(() => {
    const value = predictedCutoff({
      teams: rows.teams,
      capacity: artifact.dcmpSlots,
      qualifiers: { awardQualified: new Set(statuses.awardQualified), prequalified: new Set(statuses.prequalified) },
      reservedSlots: statuses.reservedSlots,
    });
    /**
     * THE RANGE IS REFUSED WHERE THE RUN RANKED A DIFFERENT FIELD.
     *
     * `prepareChanceRanking` EXCLUDES a team whose grand total could not be
     * built, so with a non empty `excludedTeams` the simulated line is the
     * slot th highest of a SMALLER pool and sits below the cutoff, which is
     * taken over the whole one. Measured on the 2026 PNW fixture rewound to
     * `2026wasam:awards`, where 32 of 126 grand totals refuse: the stat line
     * read a cutoff of 54 beside a likely range of 49 to 51, a range that
     * cannot contain the number beside it. An absent range is this tab's own
     * answer for a number it cannot stand behind.
     */
    const likely =
      value.kind === "predicted" && chanceState.status === "complete" && chanceRun?.excludedTeams.length === 0
        ? simulatedCutoffRange(chanceState.cutoffByRun, chanceState.draws)
        : undefined;
    return { cutoff: value, likely, districtOnly: false };
  }, [rows.teams, artifact.dcmpSlots, statuses, chanceState, chanceRun]);
  const activeStatuses = useMemo(
    () => new Set(DISTRICT_LEDGER_STATUS_KEYS.filter((status) => !hiddenStatuses.has(status))),
    [hiddenStatuses]
  );
  const visibleTeams = useMemo(() => {
    const searched = filterDistrictLedgerTeams(rows.teams, query);
    if (hiddenStatuses.size === 0) return searched;
    return searched.filter((team) => {
      const status = statuses.byTeam.get(team.teamKey)?.status;
      if (status === undefined || status === "capacityUnknown") return true;
      return !hiddenStatuses.has(status);
    });
  }, [rows.teams, query, hiddenStatuses, statuses]);

  /**
   * At most ONE drawer is open across the whole table. An unknown team number
   * or an unknown cell id resolves to closed rather than to a neighbouring
   * cell, which is why this is a lookup rather than an index.
   */
  const openDrawer = useMemo(() => {
    if (search.drawerTeam === undefined || search.drawerCell === undefined) return undefined;
    const team = rows.teams.find((entry) => entry.teamNumber === search.drawerTeam);
    if (team === undefined) return undefined;
    const candidates: DistrictLedgerCell[] = [
      ...team.rows.flatMap((row) => [...row.cells, row.eventTotal]),
      team.grandTotal,
    ];
    const cell = candidates.find((entry) => entry.id === search.drawerCell);
    if (cell === undefined || cell.kind !== "open") return undefined;
    return { team, cell };
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
    <div className="flex flex-col gap-[var(--spacing-md)]" data-testid="district-ledger-tab">
      <ControlsCard query={query} onQueryChange={setQuery} cutoff={cutoff}>
        <RewindSlider timeline={timeline} positionIndex={positionIndex} onPositionChange={handlePositionChange} />
        <StatusChips counts={statuses.counts} active={activeStatuses} onToggle={toggleStatus} />
      </ControlsCard>
      <p className="text-[var(--color-text-muted)]" data-testid="district-ledger-caveat">
        {DISTRICT_LEDGER_CAVEAT} {DISTRICT_LEDGER_PROVENANCE}
      </p>
      {visibleTeams.length === 0 && <p className="text-[var(--color-text-muted)]">{DISTRICT_LEDGER_NO_MATCHES}</p>}
      {/* The shipped table wrapper, verbatim, so the scroll arbitration this
          site already has an e2e suite around is inherited rather than rebuilt. */}
      <div className="data-card w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <Table className="district-ledger-table">
          <TableHeader>
            <TableRow>
              {DISTRICT_LEDGER_COLUMN_LABELS.map((label, index) => (
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
              const dataRows =
                team.rows.length === 0
                  ? [
                      <TableRow
                        key={team.teamKey}
                        data-testid="district-ledger-row"
                        data-team={team.teamKey}
                        className="district-ledger-row--team-start"
                      >
                        <TeamCell team={team} season={season} algorithm={algorithm} />
                        <StatusCell status={statuses.byTeam.get(team.teamKey)} rowSpan={1} chanceLine={chanceLineFor(team.teamKey)} />
                        <LedgerCell cell={team.grandTotal} interaction={interaction} />
                        <TableCell colSpan={DISTRICT_LEDGER_COLUMN_LABELS.length - 3} className="text-[var(--color-text-muted)]">
                          {DISTRICT_LEDGER_UNAVAILABLE_CELL}
                        </TableCell>
                      </TableRow>,
                    ]
                  : team.rows.map((row, rowIndex) => (
                      <TableRow
                        key={`${team.teamKey}-${row.eventKey}`}
                        data-testid="district-ledger-row"
                        data-team={team.teamKey}
                        className={rowIndex === 0 ? "district-ledger-row--team-start" : "district-ledger-row--team-inner"}
                      >
                        {rowIndex === 0 && <TeamCell team={team} season={season} algorithm={algorithm} />}
                        {rowIndex === 0 && (
                          <StatusCell
                            status={statuses.byTeam.get(team.teamKey)}
                            rowSpan={Math.max(team.rowCount, 1)}
                            chanceLine={chanceLineFor(team.teamKey)}
                          />
                        )}
                        {rowIndex === 0 && (
                          <TableCell rowSpan={Math.max(team.rowCount, 1)} data-testid="district-ledger-grand-total" className="numeric-cell align-middle">
                            <GrandTotalContent cell={team.grandTotal} interaction={interaction} />
                          </TableCell>
                        )}
                        <EventCell row={row} />
                        <LedgerCell cell={row.eventTotal} interaction={interaction} variant="total" />
                        {row.cells.map((cell) => (
                          <LedgerCell key={cell.id} cell={cell} interaction={interaction} />
                        ))}
                      </TableRow>
                    ));
              if (openDrawer?.team.teamKey !== team.teamKey) return dataRows;
              return [
                ...dataRows,
                <DrawerRow
                  key={`${team.teamKey}-drawer`}
                  cell={openDrawer.cell}
                  grandTotal={team.grandTotal}
                  cutoff={cutoff}
                  columnCount={DISTRICT_LEDGER_COLUMN_LABELS.length}
                  rookieBonus={team.rookieBonus}
                  chanceLine={chanceLineFor(team.teamKey)}
                  season={season}
                  isRookie={isRookieByTeam.get(team.teamKey) === true}
                  contributions={districtEventContributions(team)}
                />,
              ];
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
