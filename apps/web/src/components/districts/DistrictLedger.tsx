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
 * THE PREDICTED CUTOFF is the one number the controls card, every grand total
 * dashed rule AND the In range and Out of range chips share (quick task
 * 261004-uw4). All of them read ONE range state, `districtRangeState`, through
 * the mechanism in `ledgerRangeState.ts` that the Champ Locks tab also reads.
 * While anything is still open:
 *
 * - The chance run landed and left no team out: the cutoff is the MEDIAN of
 *   the per run simulated line, its likely range is the 10th to 90th
 *   percentile from the same call, and In range and Out of range cut at that
 *   number.
 * - The chance run landed but left a team out: the simulated line is taken
 *   over a smaller field, so the shipped midpoint rule stands, with no likely
 *   range, the chips cut at the median projections, and every other team's
 *   chance still printed.
 * - Either run is still in flight: the stat line reads pending, no dashed rule
 *   is drawn, and the two chips read Pending. A run that failed or could not
 *   be built reads not available with its reason, and the two chips read No
 *   call. Neither ever prints a figure.
 *
 * Where every team still racing for points is settled the cutoff is the
 * midpoint of the last team In range and the first team Out of range, with no
 * tilde. Locked, Locked out and Prequalified come straight from the verdicts
 * and render immediately in every one of those arms.
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
// Locks tab renders the same cells, chips and drawer panes rather than
// a second copy of them (quick task 260925-xab).
import {
  ControlsCard,
  GrandTotalContent,
  LedgerCell,
  StatusCell,
  StatusChips,
  TeamCell,
  ledgerRangeCallChip,
  stageWord,
  type CellInteraction,
  type DistrictLedgerNavigate,
} from "./LedgerParts.js";
import {
  DISTRICT_LEDGER_CAVEAT,
  DISTRICT_LEDGER_COLUMN_LABELS,
  DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_NO_MATCHES,
  DISTRICT_LEDGER_PROVENANCE,
  DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_TAB_LABEL,
  DISTRICT_LEDGER_UNAVAILABLE_CELL,
  DISTRICT_LEDGER_VERDICT_CELL_TITLES,
  districtLedgerChanceLine,
  districtLedgerShortEventName,
  districtLedgerVerdictEventCellTitle,
} from "./districtLedgerCopy.js";
import { buildVerdictModel, districtGrandSourceChips, ledgerGrandVerdict, verdictCategoryChips } from "./ledgerVerdict.js";
import { VerdictDrawer } from "./LedgerVerdictDrawer.js";
import { buildAdvancementChanceRun, reconcileAdvancementChances } from "./districtLedgerChances.js";
import { useDistrictAdvancementChance } from "./useDistrictAdvancementChance.js";
import { computeDistrictLedgerStatuses } from "./districtLedgerStatus.js";
import {
  DISTRICT_LEDGER_SHOWN_STATUS_KEYS,
  applyChampionshipFieldOverlay,
  type DistrictLedgerShownState,
  type DistrictLedgerShownStatusKey,
} from "./districtFieldOverlay.js";
import {
  DISTRICT_TIMELINE_NOW_ID,
  buildDistrictTimeline,
  districtStageAtPosition,
  resolveDistrictTimelinePosition,
  timelineEventsOf,
} from "./districtTimeline.js";
import { useAsOfRewind } from "./useAsOfRewind.js";
import {
  buildDistrictLedgerRows,
  deriveStageFromState,
  districtEventContributions,
  districtTierEvents,
  filterDistrictLedgerTeams,
  inProgressDistrictEventKeys,
  liveStageByEvent,
  type DistrictLedgerCell,
  type DistrictLedgerEventRow,
  type DistrictLedgerTeam,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import { useDistrictEventArtifacts, useDistrictLedgerData } from "./useDistrictLedgerData.js";
import { LocksMilestonePicker } from "./LocksMilestonePicker.js";
import { districtMilestoneEvents } from "./districtMilestones.js";
import { applyLedgerRangeState, districtRangeState, ledgerCutoffView, type LedgerRangeCall } from "./ledgerRangeState.js";
import { ledgerRunProgress } from "./ledgerRunProgress.js";
import { predictedCutoff, type LedgerCutoffView } from "./predictedCutoff.js";

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
 * carrying the ONE verdict pane for the clicked cell (sketch 025 variant A,
 * quick task 261006-lxp): its headline, tiles, one chart and, for a total, its
 * source line.
 *
 * `row` is the event row the clicked cell belongs to, and `undefined` for the
 * grand total. A team can have two open event rows, one live and one baked, so
 * a per event cell's eyebrow names its event.
 */
function DrawerRow({
  team,
  row,
  cell,
  cutoff,
  columnCount,
  chance,
  status,
  season,
  isRookie,
}: {
  team: DistrictLedgerTeam;
  row: DistrictLedgerEventRow | undefined;
  cell: Extract<DistrictLedgerCell, { kind: "open" }>;
  cutoff: LedgerCutoffView;
  columnCount: number;
  /** The raw chance the Status cell prints, or `undefined` where it prints none. */
  chance: number | undefined;
  /** The DISPLAYED status, with the range call that withholds it. */
  status: { readonly status: DistrictLedgerShownState; readonly rangeCall?: LedgerRangeCall } | undefined;
  season: number;
  /** The artifact's own `awardProfile.rookie`. A veteran's Rookie All Star row is omitted rather than printed at zero. */
  isRookie: boolean;
}) {
  const isGrandTotal = cell.cell === "grandTotal" || row === undefined;
  const cellTitle = isGrandTotal
    ? DISTRICT_LEDGER_VERDICT_CELL_TITLES.grandTotal
    : districtLedgerVerdictEventCellTitle(DISTRICT_LEDGER_VERDICT_CELL_TITLES[cell.cell], row.eventName);
  const model = buildVerdictModel({
    cell,
    cellTitle,
    teamNumber: team.teamNumber,
    nickname: team.nickname,
    season,
    isRookie,
    tier: "district",
    namedOutcomes: true,
    ...(isGrandTotal
      ? {
          grand: { verdict: ledgerGrandVerdict({ statusKey: status?.status, rangeCall: status?.rangeCall, chance }), cutoff },
          sourceChips: districtGrandSourceChips(districtEventContributions(team), team.rookieBonus),
        }
      : {}),
    ...(!isGrandTotal && cell.cell === "eventTotal"
      ? {
          total: { kind: "event" as const, eventName: row.eventName },
          sourceChips: verdictCategoryChips(row.cells, { season, tier: "district", isRookie }),
        }
      : {}),
  });
  return (
    <TableRow data-testid="district-ledger-drawer" data-drawer-cell={cell.id} className="district-ledger-row--drawer">
      <TableCell colSpan={columnCount}>
        <VerdictDrawer model={model} />
      </TableCell>
    </TableRow>
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
  const [hiddenStatuses, setHiddenStatuses] = useState<ReadonlySet<DistrictLedgerShownStatusKey>>(() => new Set());

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
  const milestoneEvents = useMemo(() => districtMilestoneEvents(artifact, ["district"]), [artifact]);

  const timeline = useMemo(
    () => buildDistrictTimeline({ events: timelineEventsOf(districtEvents, milestoneEvents), eventArtifacts: artifacts.eventArtifacts }),
    [districtEvents, milestoneEvents, artifacts.eventArtifacts]
  );
  const positionIndex = resolveDistrictTimelinePosition(timeline, search.at);
  const atNow = positionIndex >= timeline.nowIndex;

  const stageByEvent = useMemo(
    () => districtStageAtPosition(timeline, positionIndex, nowStageByEvent),
    [timeline, positionIndex, nowStageByEvent]
  );

  /**
   * THE NUMBER READING, beside the field reading above and never in place of
   * it (quick task 261009-vp9). `nowStageByEvent` and `stageByEvent` say what
   * has happened on the field (the state alone): they keep feeding the as-of
   * rewind, the run assembly and its bracket facts. These two say
   * which categories' NUMBERS are final (the state AND the points that prove
   * it): they feed the rows at a rewound stop, and so the grey cells and
   * everything the lock math reads, and they tell the run which of TBA's own
   * playoff and award points it may take as known (`pointsFinalByEvent`).
   */
  const nowFinalByEvent = useMemo(() => liveStageByEvent(artifact, ["district"]), [artifact]);
  const finalByEvent = useMemo(
    () => districtStageAtPosition(timeline, positionIndex, nowFinalByEvent),
    [timeline, positionIndex, nowFinalByEvent]
  );

  /**
   * THE AS-OF STATE AT A REWOUND STOP (quick task 261005-5g0): every event with
   * an open category is simulated from the model as it stood at the stop, never
   * from a stored prediction. Enabled from the raw `?at=` while the fetch set
   * loads, so no Live run starts in between, and off once the id resolves to
   * now (an unknown id reads as Live).
   */
  const candidates = useMemo(() => districtEvents.map((event) => ({ eventKey: event.eventKey, tier: "district" as const, week: event.week })), [districtEvents]);
  const asOf = useAsOfRewind({
    enabled: rewinding && (artifacts.isLoading || !atNow),
    artifactsLoading: artifacts.isLoading,
    unloadedEventKeys: artifacts.missingEventArtifacts,
    districtArtifact: artifact,
    timeline,
    positionIndex,
    eventArtifacts: artifacts.eventArtifacts,
    stageByEvent,
    at: search.at,
    candidates,
  });

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

  /** The milestone picker's one commit: `now` clears the param, anything else is stored verbatim for the resolver. */
  function handleAtChange(id: string): void {
    // `replace`: stepping through milestones is browsing one control, not a trail of history entries.
    void navigate({ search: (prev) => ({ ...prev, at: id === DISTRICT_TIMELINE_NOW_ID ? undefined : id }), replace: true, resetScroll: false });
  }

  const data = useDistrictLedgerData({
    artifact,
    activeEventKeys,
    eventArtifacts: artifacts.eventArtifacts,
    stageByEvent,
    pointsFinalByEvent: finalByEvent,
    asOf,
  });

  // The controls card's progress bar (quick task 261007-481): the tab is
  // waiting exactly while the event artifacts load or the run is pending.
  const runProgress = ledgerRunProgress({ artifactsLoading: artifacts.isLoading, runPending: data.runPending, runState: data.runState });

  // THE ONE PENDING CONDITION (quick task 261007-4qr): event artifacts or a
  // baked sidecar still loading, or the run not landed for the current inputs.
  // The cells print "pending" under it and the range state holds the Status
  // column at Pending under it, so the two cannot disagree.
  const distributionsPending = artifacts.isLoading || data.isLoading || data.runPending;

  const rows = useMemo(
    () =>
      buildDistrictLedgerRows({
        artifact,
        distributions: data.distributions,
        // The rows read the NUMBER at a rewound stop, and the field for the
        // not picked note. At Now both are absent and the builder derives
        // each from the artifact itself.
        stageByEvent: atNow ? undefined : finalByEvent,
        fieldStageByEvent: atNow ? undefined : stageByEvent,
        unavailableEvents: data.unavailableEvents,
        gaps: { ...data.gaps, missingEventArtifacts: artifacts.missingEventArtifacts },
        distributionsPending,
      }),
    [artifact, data.distributions, atNow, stageByEvent, finalByEvent, data.unavailableEvents, data.gaps, artifacts.missingEventArtifacts, distributionsPending]
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
  const positionId = timeline.positions[positionIndex]?.id ?? DISTRICT_TIMELINE_NOW_ID;
  // While a rewound stop's as-of objects load nothing is assembled yet, so the
  // idle run is in flight rather than "nothing to simulate".
  const runSignature =
    asOf?.status === "loading" ? null : data.runState.status === "complete" ? data.runState.signature : data.runState.status === "idle" ? "" : null;
  const chanceRun = useMemo(
    () => buildAdvancementChanceRun({ artifact, teams: rows.teams, statuses, runSignature, positionId }),
    [artifact, rows.teams, statuses, runSignature, positionId]
  );

  const chanceState = useDistrictAdvancementChance(chanceRun);
  /** A result for a stale signature is still pending: the run for THESE inputs has not landed. */
  const chanceRunCurrent = chanceState.status === "complete" && chanceState.signature === chanceRun?.signature;

  /**
   * THE BOUNDARY RULE'S OWN READING at this position: the shipped midpoint of
   * the last team In range and the first team Out of range (quick task
   * 260926-37q), over the tab's own sorted rows, the artifact's capacity and
   * the SAME qualifier sets and reservation the verdicts were computed with.
   *
   * Since quick task 261004-uw4 it is printed in two places only: where it is
   * not a prediction at all (final, absent, capacity unknown), and in the
   * excluded team fallback below. Its KIND is what tells the range state
   * whether there is a prediction to make.
   */
  const boundaryCutoff = useMemo(
    () =>
      predictedCutoff({
        teams: rows.teams,
        capacity: artifact.dcmpSlots,
        qualifiers: { awardQualified: new Set(statuses.awardQualified), prequalified: new Set(statuses.prequalified) },
        reservedSlots: statuses.reservedSlots,
      }),
    [rows.teams, artifact.dcmpSlots, statuses]
  );

  /**
   * THE ONE RANGE STATE (quick task 261004-uw4): read by the chips, the two
   * filter counts, the stat line and every dashed rule, so none of them can
   * disagree about where the line is or whether it is in yet.
   *
   * THE THREE WAY RULE, while the boundary rule would predict:
   *
   * 1. The chance run landed and left NO team out: `simulated`. The headline
   *    is the median of the per run line with its 10 to 90 range from the
   *    same call, and In range and Out of range cut at that number.
   * 2. The chance run landed but LEFT A TEAM OUT: `settled`, which is today's
   *    behaviour exactly. `prepareChanceRanking` excludes a team whose grand
   *    total could not be built, so the simulated line is the slot th highest
   *    of a SMALLER field and is not the district's line (measured on the
   *    2026 PNW fixture rewound to `2026wasam:awards`: a cutoff of 54 beside
   *    a simulated range of 49 to 51). So the boundary midpoint prints with
   *    no likely range, the chips keep the median rule, and every other
   *    team's chance still prints: silencing a whole district for one
   *    unpriceable team is what quick task 260925-uf8 closed.
   * 3. Otherwise NO FIGURE: `pending` while a run is in flight, and `noCall`
   *    with its reason when the per event run failed, the chance run failed
   *    (a browser that cannot construct a Worker included) or could not be
   *    built. Never a headline from fallback projections, which is how a
   *    failed run printed a predicted cutoff of zero with every team In range.
   *
   * Where the boundary rule does NOT predict (final, absent, capacity
   * unknown) the state is `settled` whatever is in flight, so those arms read
   * exactly as they did.
   */
  const rangeState = useMemo(
    () =>
      districtRangeState({
        boundaryKind: boundaryCutoff.kind,
        // NOT the bare `runSignature`, on the champ tab's own recipe: on the
        // first paint the run is `idle` because its effect has not started it,
        // and event artifacts or sidecars may still be loading, and each of
        // those reads as "nothing to run" there. Treating them as in flight
        // keeps a transient refusal from flashing No call before the line
        // arrives.
        perEventRunSignature: distributionsPending ? null : (runSignature ?? ""),
        perEventRunFailed: data.runState.status === "error",
        run: {
          built: chanceRun !== undefined,
          status: chanceState.status,
          current: chanceRunCurrent,
          excludedTeams: chanceRun?.excludedTeams ?? [],
          ...(chanceState.status === "complete" && chanceState.cutoffByRun !== undefined ? { cutoffByRun: chanceState.cutoffByRun } : {}),
          ...(chanceState.status === "complete" ? { draws: chanceState.draws } : {}),
        },
      }),
    [boundaryCutoff.kind, distributionsPending, data.runState.status, runSignature, chanceRun, chanceState, chanceRunCurrent]
  );

  /**
   * THE CHAMPIONSHIP FIELD (quick task 261005-04t, D-06). On the Live view
   * only, once the District Championship has started and capacity is
   * published, who is in its field decides what the tab SHOWS: Locked,
   * Declined or Locked out. At every rewound position, and at Live before the
   * championship starts, this is the raw model untouched. It changes the shown
   * status and nothing else: `verdict` and `lockedBy` stay the guarantee, and
   * the chance run, the boundary cutoff and their qualifier sets above keep
   * reading the raw `statuses`.
   */
  const shownStatuses = useMemo(() => applyChampionshipFieldOverlay(statuses, artifact, { atLive: atNow }), [statuses, artifact, atNow]);

  /**
   * What the chips SHOW. Only In range and Out of range ever differ from
   * `shownStatuses`; Locked, Declined, Locked out, Prequalified and the
   * capacity refusal pass through in every arm. The chance run above keeps
   * reading `statuses`, the verdicts, so there is no cycle.
   */
  const displayStatuses = useMemo(() => applyLedgerRangeState(shownStatuses, rows.teams, rangeState), [shownStatuses, rows.teams, rangeState]);

  const chances = useMemo(
    () =>
      chanceState.status === "complete" && chanceRunCurrent ? reconcileAdvancementChances(chanceState.chanceByTeam, displayStatuses) : undefined,
    [chanceState, chanceRunCurrent, displayStatuses]
  );
  /** One team's printed line, or `undefined` where nothing is printed — a pending run, a withheld call and a guaranteed status are the same absence here. */
  const chanceLineFor = (teamKey: string): string | undefined => {
    const chance = chances?.byTeam.get(teamKey);
    return chance === undefined ? undefined : districtLedgerChanceLine(chance);
  };

  /**
   * THE PREDICTED CUTOFF, built ONCE from the SAME range state the chips read
   * and handed to both the stat line and every grand total dashed rule (quick
   * tasks 260926-37q and 261004-uw4).
   *
   * `simulated` prints the median of the per run line with its likely range
   * from the same call, so the figure cannot sit outside the range beside it.
   * `pending` and `noCall` print no figure and draw no rule. `settled` is the
   * boundary rule's own reading with no likely range: the settled cutoff, the
   * absent and capacity unknown arms, and the excluded team fallback.
   *
   * Like the chip counts, it describes the DISTRICT and not the filtered view.
   */
  const cutoff = useMemo<LedgerCutoffView>(
    () =>
      ledgerCutoffView({
        state: rangeState,
        teams: rows.teams,
        displayStatus: (teamKey) => displayStatuses.byTeam.get(teamKey)?.status,
        settledView: () => ({ cutoff: boundaryCutoff, likely: undefined, districtOnly: false }),
        showLikelyRange: true,
      }),
    [rangeState, rows.teams, displayStatuses, boundaryCutoff]
  );
  const activeStatuses = useMemo(
    () => new Set(DISTRICT_LEDGER_SHOWN_STATUS_KEYS.filter((status) => !hiddenStatuses.has(status))),
    [hiddenStatuses]
  );
  const visibleTeams = useMemo(() => {
    const searched = filterDistrictLedgerTeams(rows.teams, query);
    if (hiddenStatuses.size === 0) return searched;
    return searched.filter((team) => {
      const status = displayStatuses.byTeam.get(team.teamKey)?.status;
      if (status === undefined || status === "capacityUnknown") return true;
      return !hiddenStatuses.has(status);
    });
  }, [rows.teams, query, hiddenStatuses, displayStatuses]);

  /**
   * At most ONE drawer is open across the whole table. An unknown team number
   * or an unknown cell id resolves to closed rather than to a neighbouring
   * cell, which is why this is a lookup rather than an index.
   */
  const openDrawer = useMemo(() => {
    if (search.drawerTeam === undefined || search.drawerCell === undefined) return undefined;
    const team = rows.teams.find((entry) => entry.teamNumber === search.drawerTeam);
    if (team === undefined) return undefined;
    // The event row the cell belongs to travels with it, so the drawer can name
    // the event; the grand total belongs to no row.
    const candidates: { cell: DistrictLedgerCell; row: DistrictLedgerEventRow | undefined }[] = [
      ...team.rows.flatMap((row) => [...row.cells, row.eventTotal].map((cell) => ({ cell, row }))),
      { cell: team.grandTotal, row: undefined },
    ];
    const found = candidates.find((entry) => entry.cell.id === search.drawerCell);
    if (found === undefined || found.cell.kind !== "open") return undefined;
    return { team, cell: found.cell, row: found.row };
  }, [rows.teams, search.drawerTeam, search.drawerCell]);

  function toggleStatus(status: DistrictLedgerShownStatusKey): void {
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
      <ControlsCard query={query} onQueryChange={setQuery} cutoff={cutoff} progress={runProgress}>
        <LocksMilestonePicker timeline={timeline} events={milestoneEvents} at={search.at} positionIndex={positionIndex} onAtChange={handleAtChange} />
        <StatusChips
          counts={displayStatuses.counts}
          active={activeStatuses}
          onToggle={toggleStatus}
          withheld={displayStatuses.withheld !== undefined}
          fieldOverlay={displayStatuses.fieldOverlay}
          // The definitions follow the rule the chips are cut by: the field
          // overlay prints the field's own sentences; otherwise `settled` (a
          // finished position, and the excluded team fallback) keeps the
          // median rule's own sentences, and every other arm reads the cutoff's.
          definitions={
            displayStatuses.fieldOverlay
              ? DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS
              : rangeState.kind === "settled"
                ? DISTRICT_LEDGER_STATUS_DEFINITIONS
                : DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS
          }
        />
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
              // The DISPLAYED status, and the neutral chip that replaces an In
              // range or Out of range call while it is withheld.
              const status = displayStatuses.byTeam.get(team.teamKey);
              const withheldChip = ledgerRangeCallChip(status?.rangeCall, displayStatuses.noCallReason);
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
                        <StatusCell status={status} rowSpan={1} chanceLine={chanceLineFor(team.teamKey)} placeholder={withheldChip} />
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
                            status={status}
                            rowSpan={Math.max(team.rowCount, 1)}
                            chanceLine={chanceLineFor(team.teamKey)}
                            placeholder={withheldChip}
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
                          <LedgerCell
                            key={cell.id}
                            cell={cell}
                            interaction={interaction}
                            pricing={{ season, tier: "district", isRookie: isRookieByTeam.get(team.teamKey) === true }}
                          />
                        ))}
                      </TableRow>
                    ));
              if (openDrawer?.team.teamKey !== team.teamKey) return dataRows;
              return [
                ...dataRows,
                <DrawerRow
                  key={`${team.teamKey}-drawer`}
                  team={team}
                  row={openDrawer.row}
                  cell={openDrawer.cell}
                  cutoff={cutoff}
                  columnCount={DISTRICT_LEDGER_COLUMN_LABELS.length}
                  chance={chances?.byTeam.get(team.teamKey)}
                  status={status}
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
