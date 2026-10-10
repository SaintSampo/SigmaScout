/**
 * The Champ Locks tab — the FIRST Championship tier, as sketch 022's two-row
 * ledger.
 *
 * THE SAME LEDGER AS THE DISTRICT LOCKS TAB, with two rows per team instead of
 * one row per event: District points (the team's district-tier events summed
 * per category) and DCMP points (the District Championship's four categories at
 * the 3x weight). Every cell renderer, chip, definition, legend key and drawer
 * pane comes from `LedgerParts.tsx`, and the milestone picker from
 * `LocksMilestonePicker.tsx`, rather than from a second copy, so a refinement
 * shipped on one tab reaches the other (quick task 260925-xab).
 *
 * WHAT IS DIFFERENT, AND WHY:
 *
 * - THE FIELD IS A QUESTION BEFORE IT IS A FACT. A team's place in the District
 *   Championship field is settled only once the DCMP has started or once TBA
 *   lists it as registered. Until then the four DCMP cells print what the team
 *   would earn IF THERE, and the chance of being there is folded in exactly
 *   ONCE, into the grand total (sketch 022 variant A). The chance is printed
 *   once too, on the row label. Once the District Championship is the
 *   selected event (a championship has started at the position, the reader is
 *   at a DCMP's own Schedule stop, or Now after one started) a team with no
 *   dcmp-tier row leaves the TABLE (`champTeamHiddenAtDcmp`, quick task
 *   261007-mxf); it stays in the rows, so the champ run, the cutoff, the gaps
 *   and the status counts still see it. At the live position that waits for
 *   the PROVEN field (quick task 261010-66y): the artifact learns a
 *   championship key only from team rows, so while TBA has posted one
 *   division or one of two championships a team with no row may simply not
 *   be posted yet. It stays in the table and reads as it did before the
 *   championship started, the championship's awards do not read final for
 *   the range state, and the award draws are still drawn.
 * - BEFORE THE CHAMPIONSHIP STARTS, NOW ESTIMATES IT AND A REWOUND STOP BAKES
 *   IT. `remainingEvents` is built from TBA registrations, so for most of the
 *   district season nothing names the DCMP, and on a rewind the real roster
 *   is future knowledge. At Now the DCMP row's Subtotal is priced from how
 *   teams at the same place in past championship fields scored, seasons
 *   before the one shown only (`hypotheticalDcmp.ts`, quick task 260927-6bf),
 *   and its four category cells read "not yet priced". At a rewound stop the
 *   championship is baked in the Web Worker over the teams the district tier
 *   shows as Locked, Prequalified or In range there, at the stop's as-of state
 *   (`useSimulatedDcmpBake`, quick task 261007-mxf): four real cells inside
 *   that field, "out of range" outside it, with a labelled district only
 *   grand total. Once the field is a fact (the DCMP has started, or a team is
 *   registered at the live position) the event's own prediction takes over.
 * - TWO CHANCE RUNS, in a fixed order, with the DCMP bake between them on a
 *   rewound stop: the per event run, the district chance run, the district
 *   line (which cuts In range), the DCMP bake, then the champ run. The
 *   district run's marginal becomes the "to be there" chance, that chance
 *   weights the grand total, and only then does the champ run rank those
 *   grand totals against `cmpSlots`. The memos below are ordered so each
 *   reads only what is already resolved.
 *
 * THE PREDICTED CUTOFF is the one number the controls card and every grand
 * total dashed rule share. Until the DCMP awards post it is the SIMULATED
 * LINE (decision L2): in each champ run the DCMP winning alliance and the
 * drawn Impact, Engineering Inspiration and Rookie All Star winners take their
 * slots first, and the line is read from the teams left. ONE `champRangeState`
 * feeds both the cutoff view and the chips, so In range and Out of range cut
 * at the printed number. Per Jacob's 2026-09-27 chip timing decision, while
 * anything upstream is still computing those two chips read a neutral
 * "Pending" and the stat line prints no figure; they settle ONCE, and a
 * terminal refusal reads "No call" with its reason, never the rank rule.
 * Locked, Locked out and the award locks render immediately. The line's 10 to
 * 90 likely range is shown beside it (`SHOW_SIMULATED_CHAMP_LIKELY_RANGE`,
 * Jacob, 2026-09-27). Once the DCMP awards post, nothing is drawn any more and
 * the shipped midpoint rule and rank chips stand.
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
import {
  ControlsCard,
  GrandTotalContent,
  LedgerCell,
  StatusCell,
  StatusChips,
  TeamCell,
  UNAVAILABLE_CELL_CLASS,
  ledgerRangeCallChip,
  stageWordKey,
  type CellInteraction,
  type DistrictLedgerNavigate,
  type StatusPlaceholder,
} from "./LedgerParts.js";
import type { DistrictCellPricing } from "./districtLedgerOutcomes.js";
import { predictedCutoff, simulatedCutoffRange, type LedgerCutoffView } from "./predictedCutoff.js";
import { ledgerRunProgress } from "./ledgerRunProgress.js";
import { champCutoffTuning } from "../../../../../packages/core/districts/hypotheticalDcmp.js";
import {
  CHAMP_LEDGER_COLUMN_LABELS,
  CHAMP_LEDGER_DISTRICT_ONLY_LINE,
  CHAMP_LEDGER_ESTIMATED_DCMP_LINE,
  CHAMP_LEDGER_LOCKED_WINNER_LABEL,
  CHAMP_LEDGER_NOT_IN_FIELD_CELL,
  CHAMP_LEDGER_NOT_IN_FIELD_LINE,
  CHAMP_LEDGER_NOT_YET_PRICED_CELL,
  CHAMP_LEDGER_OUT_OF_RANGE_CELL,
  CHAMP_LEDGER_OUT_OF_RANGE_LINE,
  CHAMP_LEDGER_ROW_LABELS,
  CHAMP_LEDGER_STATUS_DEFINITIONS,
  CHAMP_LEDGER_TAB_LABEL,
  CHAMP_LEDGER_VERDICT_SUBTOTAL_TITLES,
  DISTRICT_LEDGER_CAVEAT,
  DISTRICT_LEDGER_NO_MATCHES,
  DISTRICT_LEDGER_PROVENANCE,
  DISTRICT_LEDGER_VERDICT_CELL_TITLES,
  champLedgerDcmpStageLine,
  champLedgerDistrictSourceLine,
  champLedgerFieldChanceLine,
  districtLedgerChanceLine,
} from "./districtLedgerCopy.js";
import { buildVerdictModel, champGrandSourceChips, ledgerGrandVerdict, verdictCategoryChips } from "./ledgerVerdict.js";
import { VerdictDrawer } from "./LedgerVerdictDrawer.js";
import { applyLedgerRangeState, districtRangeState, type LedgerRangeCall } from "./ledgerRangeState.js";
import { buildAdvancementChanceRun } from "./districtLedgerChances.js";
import {
  buildChampAdvancementChanceRun,
  buildChampAwardDraws,
  champCutoffView,
  champDcmpAwardsFinal,
  champFieldChances,
  champRangeState,
  dcmpSimulatedField,
  hypotheticalDcmpEstimates,
  reconcileChampAdvancementChances,
  simulatedDcmpState,
} from "./champLedgerChances.js";
import { useDistrictAdvancementChance } from "./useDistrictAdvancementChance.js";
import { DISTRICT_LEDGER_STATUS_KEYS, computeDistrictLedgerStatuses } from "./districtLedgerStatus.js";
import type { DistrictLedgerShownState, DistrictLedgerShownStatusKey } from "./districtFieldOverlay.js";
import { applyChampRangeState, computeChampLedgerStatuses, type ChampDisplayStatusModel } from "./champLedgerStatus.js";
import {
  buildChampLedgerRows,
  champCellNamesOutcomes,
  champContributions,
  champDcmpStageSource,
  champFieldMembership,
  champFieldProofAtNow,
  champTeamHiddenAtDcmp,
  champTierEvents,
  dcmpEventKeysFor,
  dcmpStartedForTeam,
  type ChampDcmpEstimate,
  type ChampLedgerCell,
  type ChampLedgerRow,
  type ChampLedgerRowKind,
  type ChampLedgerTeam,
  type SimulatedDcmpPricing,
} from "./champLedgerRows.js";
import {
  DISTRICT_TIMELINE_NOW_ID,
  buildDistrictTimeline,
  districtStageAtPosition,
  eventStartedAtPosition,
  resolveDistrictTimelinePosition,
  timelineEventsOf,
} from "./districtTimeline.js";
import { asOfScheduleStopEventKey } from "./asOfRewind.js";
import { useAsOfRewind } from "./useAsOfRewind.js";
import { useSimulatedDcmpBake } from "./useSimulatedDcmpBake.js";
import {
  buildDistrictLedgerRows,
  deriveStageFromState,
  liveStageByEvent,
  tierEvents,
  type DistrictLedgerCell,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import { champLiveFetchKeys, useDistrictEventArtifacts, useDistrictLedgerData } from "./useDistrictLedgerData.js";
import { LocksMilestonePicker } from "./LocksMilestonePicker.js";
import { districtMilestoneEvents } from "./districtMilestones.js";

/** The three TEXT columns (Team, Status, Source); every other header centres over its boxed cells, exactly as the district tier's does. */
const TEXT_COLUMN_INDEXES: ReadonlySet<number> = new Set([0, 1, 3]);

/** Both rows always render, so the Team, Status and Grand total cells always span exactly two. */
const CHAMP_ROW_SPAN = 2;

/** The estimate map while the estimate is not ready: supplied rather than omitted, so the real roster never prices a rewound position. */
const NO_ESTIMATES: ReadonlyMap<string, ChampDcmpEstimate> = new Map();

export interface ChampLocksLedgerProps {
  artifact: DistrictArtifact;
  algorithm: PublishedAlgorithmId;
  season: number;
}

/**
 * A champ cell, rendered.
 *
 * The three shipped kinds go straight to `LedgerCell`. The three this tier adds
 * (the em dash, "not yet priced" and "out of range") are rendered here, and COLOUR IS NEVER THE ONLY ENCODING for either: the em
 * dash and the words both say which one it is, and `data-cell` carries the same
 * distinction for a test.
 */
function ChampCell({
  cell,
  interaction,
  variant,
  pricing,
}: {
  cell: ChampLedgerCell;
  interaction: CellInteraction;
  variant?: "total";
  /** The DCMP row prices its cells at the dcmp tier; the District points row, a sum over events, passes none. */
  pricing?: DistrictCellPricing;
}) {
  if (cell.kind === "notInField" || cell.kind === "notYetPriced" || cell.kind === "outOfRange") {
    const dataCell = cell.kind === "notInField" ? "not-in-field" : cell.kind === "notYetPriced" ? "not-yet-priced" : "out-of-range";
    const text =
      cell.kind === "notInField"
        ? CHAMP_LEDGER_NOT_IN_FIELD_CELL
        : cell.kind === "notYetPriced"
          ? CHAMP_LEDGER_NOT_YET_PRICED_CELL
          : CHAMP_LEDGER_OUT_OF_RANGE_CELL;
    return (
      <TableCell data-cell={dataCell} data-cell-id={cell.id} className="numeric-cell">
        <span className={UNAVAILABLE_CELL_CLASS}>{text}</span>
      </TableCell>
    );
  }
  return <LedgerCell cell={cell} interaction={interaction} variant={variant} pricing={pricing} />;
}

/**
 * The Source cell: the row's label, and one small line underneath.
 *
 * THE SMALL LINE ANSWERS ONE QUESTION PER ROW. The District points row names
 * its events with their week and stage. The DCMP row says, in priority order,
 * that the team is not in the field, or that it is outside the simulated field
 * (a rewound stop before the championship, quick task 261007-mxf), or the
 * chance it will be there, or the championship's own stage.
 */
function SourceCell({ row, team }: { row: ChampLedgerRow; team: ChampLedgerTeam }) {
  const sources = row.sources.map((source) => ({ eventName: source.eventName, week: source.week, stage: stageWordKey(source.stage) }));
  // THE DCMP ROW'S STAGE LINE follows the event still being played (quick task
  // 261009-tx8, R10): the division while it has an open category, then the
  // finals, then the final word. A district with one championship has one
  // source and prints what it printed.
  const dcmpSource = row.kind === "dcmp" ? champDcmpStageSource(row.sources) : undefined;
  const dcmp = dcmpSource === undefined ? undefined : { week: dcmpSource.week, stage: stageWordKey(dcmpSource.stage) };
  const small =
    row.kind === "district"
      ? champLedgerDistrictSourceLine(sources)
      : team.membership === "out" || row.subtotal.kind === "notInField"
        ? CHAMP_LEDGER_NOT_IN_FIELD_LINE
        : row.subtotal.kind === "outOfRange"
          ? CHAMP_LEDGER_OUT_OF_RANGE_LINE
          : team.fieldChance !== undefined
            ? champLedgerFieldChanceLine(team.fieldChance)
            : row.estimated
              ? CHAMP_LEDGER_ESTIMATED_DCMP_LINE
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
 * ONE drawer row at a time across the whole table, spanning every column,
 * carrying the ONE verdict pane for the clicked cell (sketch 025 variant A,
 * quick task 261006-lxp).
 *
 * THE TIER FOLLOWS THE ROW THE CELL CAME FROM. A DCMP cell's outcome lists are
 * priced at the 3x weight by `districtPlayoffOutcomes`/`districtAwardOutcomes`
 * themselves; a District points cell is a SUM over several events, so no named
 * outcome covers its support and it draws the histogram instead. Both
 * subtotals can be open at once, so a subtotal's eyebrow names which.
 */
function ChampDrawerRow({
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
  team: ChampLedgerTeam;
  /** Which of the team's two rows the clicked cell belongs to; `undefined` for the grand total, which belongs to neither. */
  row: ChampLedgerRowKind | undefined;
  cell: Extract<DistrictLedgerCell, { kind: "open" }>;
  cutoff: LedgerCutoffView;
  columnCount: number;
  /** The raw chance the Status cell prints, or `undefined` where it prints none. */
  chance: number | undefined;
  /** The DISPLAYED status, with the range call that withholds it. */
  status: { readonly status: DistrictLedgerShownState; readonly rangeCall?: LedgerRangeCall } | undefined;
  season: number;
  isRookie: boolean;
}) {
  const isGrandTotal = cell.cell === "grandTotal" || row === undefined;
  const cellTitle = isGrandTotal
    ? DISTRICT_LEDGER_VERDICT_CELL_TITLES.grandTotal
    : cell.cell === "eventTotal"
      ? CHAMP_LEDGER_VERDICT_SUBTOTAL_TITLES[row]
      : DISTRICT_LEDGER_VERDICT_CELL_TITLES[cell.cell];
  const model = buildVerdictModel({
    cell,
    cellTitle,
    teamNumber: team.teamNumber,
    nickname: team.nickname,
    season,
    isRookie,
    tier: row === "dcmp" ? "dcmp" : "district",
    namedOutcomes: champCellNamesOutcomes(row, cell),
    ...(isGrandTotal
      ? {
          grand: { verdict: ledgerGrandVerdict({ statusKey: status?.status, rangeCall: status?.rangeCall, chance }), cutoff },
          sourceChips: champGrandSourceChips(champContributions(team), {
            membership: team.membership,
            grandTotalIsDistrictOnly: team.grandTotalIsDistrictOnly,
            rookieBonus: team.rookieBonus,
          }),
        }
      : {}),
    ...(!isGrandTotal && cell.cell === "eventTotal"
      ? {
          total: row === "dcmp" ? { kind: "dcmp" as const, fieldChance: team.fieldChance } : { kind: "district" as const },
          sourceChips: verdictCategoryChips(
            (row === "dcmp" ? team.dcmpRow : team.districtRow).cells,
            row === "dcmp" ? { season, tier: "dcmp", isRookie } : undefined
          ),
        }
      : {}),
  });
  return (
    <TableRow data-testid="champ-ledger-drawer" data-drawer-cell={cell.id} className="district-ledger-row--drawer">
      <TableCell colSpan={columnCount}>
        <VerdictDrawer model={model} />
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
  const [hiddenStatuses, setHiddenStatuses] = useState<ReadonlySet<DistrictLedgerShownStatusKey>>(() => new Set());

  const events = useMemo(() => champTierEvents(artifact), [artifact]);
  const dcmpEventKeys = useMemo(() => dcmpEventKeysFor(artifact), [artifact]);
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
  const startedDcmpKeysNow = useMemo(() => new Set(dcmpEventKeys.filter((key) => startedKeys.includes(key))), [dcmpEventKeys, startedKeys]);

  /**
   * THE FIELD PROOF AT NOW, once per artifact (quick task 261010-66y): the
   * artifact learns a championship key only from team rows, so at a live
   * championship a division or a second championship TBA has not posted yet
   * is invisible. Every reader of the field below takes the one flag derived
   * from this, `fieldProven`. The year is the clock's, for the season over
   * line; a tab left open across 1 January reads the old year until reload,
   * which keeps that line off.
   */
  const fieldProofNow = useMemo(() => champFieldProofAtNow(artifact, startedDcmpKeysNow, new Date().getUTCFullYear()), [artifact, startedDcmpKeysNow]);

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
  // At Live a divisioned championship's started keys stay fetched until its
  // finals event has finished, for the joint proof (261009-kt3, widened by
  // 261010-66y: the window between the divisions and the finals).
  const liveFetchKeys = useMemo(() => champLiveFetchKeys(inProgressKeys, startedKeys, dcmpEventKeys), [inProgressKeys, startedKeys, dcmpEventKeys]);
  const activeEventKeys = rewinding ? startedKeys : liveFetchKeys;
  const artifacts = useDistrictEventArtifacts(activeEventKeys);

  const milestoneEvents = useMemo(() => districtMilestoneEvents(artifact, ["district", "dcmp"]), [artifact]);
  const timeline = useMemo(
    () => buildDistrictTimeline({ events: timelineEventsOf(events, milestoneEvents), eventArtifacts: artifacts.eventArtifacts }),
    [events, milestoneEvents, artifacts.eventArtifacts]
  );
  const positionIndex = resolveDistrictTimelinePosition(timeline, search.at);
  const atNow = positionIndex >= timeline.nowIndex;
  // True at every rewound position; at Now false exactly while some field
  // fixing key has started and the field is not proven (quick task 261010-66y).
  const fieldProven = !atNow || !fieldProofNow.unprovenAfterStart;

  const stageByEvent = useMemo(
    () => districtStageAtPosition(timeline, positionIndex, nowStageByEvent),
    [timeline, positionIndex, nowStageByEvent]
  );

  /**
   * THE NUMBER READING, beside the field reading above and never in place of
   * it (quick task 261009-vp9). `nowStageByEvent` and `stageByEvent` say what
   * has happened on the field (the state alone): they keep feeding the as-of
   * rewind, the run assembly and its bracket facts, the award draws and the awards final flag. These two say
   * which categories' NUMBERS are final (the state AND the points that prove
   * it): they feed the rows at a rewound stop, and so the grey cells and
   * everything the lock math reads, and they tell the run which of TBA's own
   * playoff and award points it may take as known (`pointsFinalByEvent`).
   */
  const nowFinalByEvent = useMemo(() => liveStageByEvent(artifact, ["district", "dcmp"]), [artifact]);
  const finalByEvent = useMemo(
    () => districtStageAtPosition(timeline, positionIndex, nowFinalByEvent),
    [timeline, positionIndex, nowFinalByEvent]
  );

  /** Every district team, sorted: the roster the first championship is planned over at a rewound stop. */
  const allDistrictTeamKeys = useMemo(() => artifact.teams.map((team) => team.teamKey).sort(), [artifact]);

  /**
   * The as-of state at a rewound stop, on the District Locks tab's own terms
   * (quick task 261005-5g0). The first championship carries every district
   * team as its roster (quick task 261007-mxf), so the one load resolves each
   * at the cut and the Locked plus In range bake assembles from it. Only a
   * GENERATED plan reads the override; the main run never posts that plan.
   */
  const candidates = useMemo(
    () =>
      events.map((event) => ({
        eventKey: event.eventKey,
        tier: event.tier,
        week: event.week,
        ...(event.eventKey === dcmpEventKeys[0] ? { roster: allDistrictTeamKeys } : {}),
      })),
    [events, dcmpEventKeys, allDistrictTeamKeys]
  );
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
   * The championships whose field is a FACT at the position: one for almost
   * every district, two for 2026 California (quick task 261006-lwo). At "now"
   * that is each one's own `state` block; rewound it is the rail, because a
   * finished event's state block would report "started" at every position
   * behind it.
   *
   * A CHAMPIONSHIP'S OWN SCHEDULE STOP COUNTS (quick task 261007-mxf). Its
   * schedule is posted there, so its field is a fact: `planAsOfEvent` already
   * prices that event REAL at its Schedule stop, and the hide rule needs
   * membership to read out there. This one set carries that through
   * `skipEventKeys` (the championship joins the main run as REAL), the field
   * membership, the estimate's field chance and the simulated DCMP (inactive
   * there).
   */
  const scheduleStopEventKey = asOfScheduleStopEventKey(search.at);
  const startedDcmpEventKeys = useMemo(
    () =>
      atNow
        ? startedDcmpKeysNow
        : new Set(dcmpEventKeys.filter((key) => eventStartedAtPosition(timeline, positionIndex, key) || key === scheduleStopEventKey)),
    [dcmpEventKeys, atNow, startedDcmpKeysNow, timeline, positionIndex, scheduleStopEventKey]
  );

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

  /** The milestone picker's one commit, with the District Locks tab's own navigate options. */
  function handleAtChange(id: string): void {
    void navigate({ search: (prev) => ({ ...prev, at: id === DISTRICT_TIMELINE_NOW_ID ? undefined : id }), replace: true, resetScroll: false });
  }

  /**
   * At a rewound stop, an unstarted District Championship stays out of the
   * MAIN run: it is baked separately over the simulated Locked plus In range
   * field (`useSimulatedDcmpBake`, quick task 261007-mxf), which is what
   * replaces the old exclusion. Folding it into this run would move the run's
   * signature once the field landed and re-run every district event.
   */
  const skipEventKeys = useMemo(() => {
    if (atNow) return undefined;
    const notStarted = dcmpEventKeys.filter((key) => !startedDcmpEventKeys.has(key));
    return notStarted.length === 0 ? undefined : new Set(notStarted);
  }, [atNow, startedDcmpEventKeys, dcmpEventKeys]);

  const data = useDistrictLedgerData({
    artifact,
    activeEventKeys,
    eventArtifacts: artifacts.eventArtifacts,
    stageByEvent,
    pointsFinalByEvent: finalByEvent,
    allowedEventKeys,
    tierByEvent,
    asOf,
    skipEventKeys,
  });

  // The controls card's progress bar (quick task 261007-481): the tab is
  // waiting exactly while the event artifacts load or the run is pending.
  const mainRunProgress = ledgerRunProgress({ artifactsLoading: artifacts.isLoading, runPending: data.runPending, runState: data.runState });

  // THE ONE PENDING CONDITION (quick task 261007-4qr): event artifacts or a
  // baked sidecar still loading, or the run not landed for the current inputs.
  // Both tier passes and the champ fold print "pending" under it, and the range
  // state holds the Status column at Pending under it, so the two cannot
  // disagree.
  const distributionsPending = artifacts.isLoading || data.isLoading || data.runPending;

  const passOptions = useMemo(
    () => ({
      artifact,
      distributions: data.distributions,
      // Both tier passes read the NUMBER at a rewound stop, and the field
      // for the not picked note. At Now both are absent and the builder
      // derives each from the artifact itself.
      stageByEvent: atNow ? undefined : finalByEvent,
      fieldStageByEvent: atNow ? undefined : stageByEvent,
      unavailableEvents: data.unavailableEvents,
      gaps: { ...data.gaps, missingEventArtifacts: artifacts.missingEventArtifacts },
      distributionsPending,
    }),
    [artifact, data.distributions, atNow, stageByEvent, finalByEvent, data.unavailableEvents, data.gaps, artifacts.missingEventArtifacts, distributionsPending]
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
  // While a rewound stop's as-of objects load nothing is assembled yet, so the
  // idle run is in flight rather than "nothing to simulate".
  const runSignature =
    asOf?.status === "loading" ? null : data.runState.status === "complete" ? data.runState.signature : data.runState.status === "idle" ? "" : null;

  const districtChanceRun = useMemo(
    () => buildAdvancementChanceRun({ artifact, teams: districtRows.teams, statuses: districtStatuses, runSignature, positionId }),
    [artifact, districtRows.teams, districtStatuses, runSignature, positionId]
  );
  const districtChanceState = useDistrictAdvancementChance(districtChanceRun);

  /**
   * THE "TO BE THERE" CHANCE per team: 1 for a district-locked team, 0 for a
   * locked-out one, the district run's marginal in between, and ABSENT while
   * that run is in flight. Where the district tier has nothing open the run is
   * refused and In range and Out of range read 1 and 0, a settled tie of facts.
   */
  const districtTierSettled = useMemo(() => !districtRows.teams.some((team) => team.hasOpenCategory), [districtRows.teams]);
  const districtRunCurrent = districtChanceState.status === "complete" && districtChanceState.signature === districtChanceRun?.signature;
  const fieldChanceByTeam = useMemo(
    () =>
      champFieldChances(
        districtStatuses,
        districtChanceState.status === "complete" && districtRunCurrent ? districtChanceState.chanceByTeam : undefined,
        districtTierSettled && districtChanceRun === undefined
      ),
    [districtStatuses, districtChanceState, districtRunCurrent, districtTierSettled, districtChanceRun]
  );

  /**
   * THE DISTRICT TIER AS THE DISTRICT LOCKS TAB SHOWS IT (quick task
   * 261007-mxf): that tab's own recipe, so In range here is the chip that tab
   * shows at the same stop. The boundary rule's kind over the district rows,
   * the capacity and the verdicts' qualifier sets and reservation; the range
   * state from the district chance run this tab already runs, with the same
   * per event condition the champ range state reads; then the chips.
   */
  const districtBoundaryKind = useMemo(
    () =>
      predictedCutoff({
        teams: districtRows.teams,
        capacity: artifact.dcmpSlots,
        qualifiers: { awardQualified: new Set(districtStatuses.awardQualified), prequalified: new Set(districtStatuses.prequalified) },
        reservedSlots: districtStatuses.reservedSlots,
      }).kind,
    [districtRows.teams, artifact.dcmpSlots, districtStatuses]
  );
  const districtShownRange = useMemo(
    () =>
      districtRangeState({
        boundaryKind: districtBoundaryKind,
        perEventRunSignature: distributionsPending ? null : (runSignature ?? ""),
        perEventRunFailed: data.runState.status === "error",
        run: {
          built: districtChanceRun !== undefined,
          status: districtChanceState.status,
          current: districtRunCurrent,
          excludedTeams: districtChanceRun?.excludedTeams ?? [],
          ...(districtChanceState.status === "complete" && districtChanceState.cutoffByRun !== undefined
            ? { cutoffByRun: districtChanceState.cutoffByRun }
            : {}),
          ...(districtChanceState.status === "complete" ? { draws: districtChanceState.draws } : {}),
        },
      }),
    [districtBoundaryKind, distributionsPending, runSignature, data.runState.status, districtChanceRun, districtChanceState, districtRunCurrent]
  );
  const districtShown = useMemo(
    () => applyLedgerRangeState(districtStatuses, districtRows.teams, districtShownRange),
    [districtStatuses, districtRows.teams, districtShownRange]
  );

  /**
   * THE SIMULATED DCMP (quick task 261007-mxf): at a rewound stop before any
   * championship has started, in a district that publishes one, the DCMP is
   * baked over the Locked plus In range field in a second Worker request.
   * Everywhere else (Now, a started championship) the shipped pricing stands
   * and `simulatedDcmp` is undefined.
   */
  const simulatedDcmpActive = asOf !== undefined && !atNow && dcmpEventKeys.length > 0 && startedDcmpEventKeys.size === 0;
  const simulatedField = useMemo(
    () => (simulatedDcmpActive ? dcmpSimulatedField(districtShown, districtShownRange) : undefined),
    [simulatedDcmpActive, districtShown, districtShownRange]
  );
  const simulatedBake = useSimulatedDcmpBake({
    active: simulatedDcmpActive,
    asOf,
    artifact,
    eventKey: dcmpEventKeys[0],
    field: simulatedField,
  });
  const simulatedDcmp = useMemo(
    (): SimulatedDcmpPricing | undefined => (simulatedField === undefined ? undefined : { field: simulatedField, bake: simulatedBake.bake }),
    [simulatedField, simulatedBake.bake]
  );
  const simulatedDcmpStatus = simulatedDcmp === undefined ? undefined : simulatedDcmpState(simulatedDcmp);

  // The controls card's bar also covers the DCMP bake's wait, indeterminate.
  const runProgress = mainRunProgress ?? (simulatedDcmpStatus === "pending" ? ({ kind: "indeterminate" } as const) : undefined);

  /**
   * THE DCMP ESTIMATE BY FIELD RANK, walk-forward, for every district team
   * (quick task 260927-6bf). Its field rank weighs each rival by the same
   * chance the grand totals are mixed at.
   */
  const estimates = useMemo(() => {
    const sourceByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
    return hypotheticalDcmpEstimates({
      season: artifact.year,
      districtTeams: districtRows.teams,
      fieldChanceFor: (teamKey) => {
        const team = sourceByKey.get(teamKey);
        if (team === undefined) return undefined;
        const membership = champFieldMembership(team, dcmpStartedForTeam(team, startedDcmpEventKeys, dcmpEventKeys, fieldProven), atNow);
        return membership === "in" ? 1 : membership === "out" ? 0 : fieldChanceByTeam.get(teamKey);
      },
      spreadScale: champCutoffTuning(artifact.year).setting.spreadScale,
    });
  }, [artifact, districtRows.teams, startedDcmpEventKeys, dcmpEventKeys, atNow, fieldChanceByTeam, fieldProven]);

  /**
   * ALWAYS a map, empty until the estimate is ready: with one supplied the
   * real DCMP row prices a team ONLY where the field is a fact for it, so a
   * rewound position never reads the real roster, not even for the instant
   * the estimate is still coming.
   */
  const rows = useMemo(
    () =>
      buildChampLedgerRows({
        ...passOptions,
        fieldChanceByTeam,
        startedDcmpEventKeys,
        atLivePosition: atNow,
        fieldProven,
        dcmpEstimateByTeam: estimates.kind === "ready" ? estimates.byTeam : NO_ESTIMATES,
        ...(simulatedDcmp === undefined ? {} : { simulatedDcmp }),
      }),
    [passOptions, fieldChanceByTeam, startedDcmpEventKeys, atNow, fieldProven, estimates, simulatedDcmp]
  );

  const statuses = useMemo(
    () => computeChampLedgerStatuses({ artifact, teams: rows.teams, districtLockedOut, distributions: data.distributions, fieldProven }),
    [artifact, rows.teams, districtLockedOut, data.distributions, fieldProven]
  );

  /** The DCMP award draws AT THE POSITION: the rail's stages when rewound, each event's own `state` block at now. */
  const awardDraws = useMemo(
    () => buildChampAwardDraws({ artifact, ...(atNow ? {} : { stageByEvent }), fieldProven }),
    [artifact, atNow, stageByEvent, fieldProven]
  );

  /**
   * THE SECOND RUN, suppressed while any grand total is district-only.
   *
   * After quick task 260927-6bf that happens only where the estimate could not
   * price a team: a season with no earlier history, an estimate still coming,
   * or a team in the field whose DCMP could not be priced. Each of those is a
   * `pending` or `noCall` arm below, never a silent zero.
   */
  // With the simulated DCMP, the champ run waits for the bake (null until it
  // is ready) and its signature carries the bake's, so a re-bake re-runs it
  // even when every grand total's length is unchanged (quick task 261007-mxf).
  const champRunSignature =
    simulatedDcmpStatus === undefined
      ? runSignature
      : simulatedDcmpStatus === "ready" && runSignature !== null
        ? `${runSignature}#${simulatedBake.signature}`
        : null;
  const champChanceRun = useMemo(() => {
    if (rows.gaps.teamsWithDistrictOnlyGrandTotal.length > 0) return undefined;
    return buildChampAdvancementChanceRun({
      artifact,
      teams: rows.teams,
      statuses,
      runSignature: champRunSignature,
      positionId,
      dcmpEventKey: rows.dcmpEventKey,
      fieldChanceByTeam,
      awardDraws,
    });
  }, [artifact, rows, statuses, champRunSignature, positionId, fieldChanceByTeam, awardDraws]);

  const champChanceState = useDistrictAdvancementChance(champChanceRun);
  const champRunCurrent = champChanceState.status === "complete" && champChanceState.signature === champChanceRun?.signature;

  /**
   * THE ONE RANGE STATE (decision L2): read by the chips AND the cutoff view,
   * so the two can never disagree about where the line is or whether it is in
   * yet.
   */
  const rangeState = useMemo(() => {
    // Never final while the field is not proven (quick task 261010-66y).
    const dcmpAwardsFinal = champDcmpAwardsFinal(dcmpEventKeys, stageByEvent, fieldProven);
    return champRangeState({
      dcmpAwardsFinal,
      cmpSlots: artifact.cmpSlots,
      // NOT the bare `runSignature`: on the first paint the run is `idle`
      // because its effect has not started it, and event artifacts or
      // sidecars may still be loading, and each of those reads as "nothing to
      // run" there. Treating them as in flight is what keeps a transient
      // refusal from flashing No call before the line arrives.
      perEventRunSignature: distributionsPending ? null : (runSignature ?? ""),
      perEventRunFailed: data.runState.status === "error",
      districtRun: {
        built: districtChanceRun !== undefined,
        status: districtChanceState.status,
        current: districtRunCurrent,
      },
      estimates: estimates.kind,
      ...(simulatedDcmpStatus === undefined ? {} : { simulatedDcmp: simulatedDcmpStatus }),
      unpricedInTeams: rows.teams.filter((team) => team.membership === "in" && team.grandTotalIsDistrictOnly).length,
      champRun: {
        built: champChanceRun !== undefined,
        status: champChanceState.status,
        current: champRunCurrent,
        excludedTeams: champChanceRun?.excludedTeams ?? [],
        ...(champChanceState.status === "complete" && champChanceState.cutoffByRun !== undefined ? { cutoffByRun: champChanceState.cutoffByRun } : {}),
        ...(champChanceState.status === "complete" ? { draws: champChanceState.draws } : {}),
      },
    });
  }, [
    dcmpEventKeys,
    stageByEvent,
    fieldProven,
    artifact.cmpSlots,
    runSignature,
    distributionsPending,
    data.runState.status,
    districtChanceRun,
    districtChanceState.status,
    districtRunCurrent,
    estimates.kind,
    simulatedDcmpStatus,
    rows.teams,
    champChanceRun,
    champChanceState,
    champRunCurrent,
  ]);

  /** What the chips SHOW. The champ run above keeps reading `statuses`, the verdicts, so there is no cycle. */
  const displayStatuses: ChampDisplayStatusModel = useMemo(
    () => applyChampRangeState(statuses, rows.teams, rangeState),
    [statuses, rows.teams, rangeState]
  );

  const chances = useMemo(
    () =>
      champChanceState.status === "complete" && champRunCurrent
        ? reconcileChampAdvancementChances(champChanceState.chanceByTeam, displayStatuses)
        : undefined,
    [champChanceState, champRunCurrent, displayStatuses]
  );
  const chanceLineFor = (teamKey: string): string | undefined => {
    const chance = chances?.byTeam.get(teamKey);
    return chance === undefined ? undefined : districtLedgerChanceLine(chance);
  };
  /** The withheld chip, from the ONE mapping both tabs read (quick task 261004-uw4). */
  const placeholderFor = (teamKey: string): StatusPlaceholder | undefined =>
    ledgerRangeCallChip(displayStatuses.byTeam.get(teamKey)?.rangeCall, displayStatuses.noCallReason);

  /**
   * THE PREDICTED CUTOFF, built ONCE from the SAME range state and handed to
   * both the stat line and every grand total dashed rule (quick tasks
   * 260926-37q and 260927-6bf).
   *
   * `settled` is the shipped midpoint over this tab's own qualifier sets and
   * its always zero reservation, with the run's likely range where the run
   * ranked the same field. Every other arm is `champCutoffView`'s.
   */
  const cutoff = useMemo<LedgerCutoffView>(
    () =>
      champCutoffView({
        state: rangeState,
        teams: rows.teams,
        displayStatus: (teamKey) => displayStatuses.byTeam.get(teamKey)?.status,
        settledView: () => {
          const value = predictedCutoff({
            teams: rows.teams,
            capacity: artifact.cmpSlots,
            qualifiers: { awardQualified: new Set(statuses.awardQualified), prequalified: new Set(statuses.prequalified) },
            reservedSlots: statuses.reservedSlots,
          });
          const likely =
            value.kind === "predicted" && champChanceState.status === "complete" && champRunCurrent && champChanceRun?.excludedTeams.length === 0
              ? simulatedCutoffRange(champChanceState.cutoffByRun, champChanceState.draws)
              : undefined;
          return { cutoff: value, likely, districtOnly: rows.gaps.teamsWithDistrictOnlyGrandTotal.length > 0 };
        },
      }),
    [rangeState, rows, displayStatuses, artifact.cmpSlots, statuses, champChanceState, champRunCurrent, champChanceRun]
  );

  const activeStatuses = useMemo(
    () => new Set(DISTRICT_LEDGER_STATUS_KEYS.filter((status) => !hiddenStatuses.has(status))),
    [hiddenStatuses]
  );
  /**
   * THE HIDE RULE (quick task 261007-mxf): once the District Championship is
   * the selected event (a championship has started at the position, the reader
   * is at a DCMP's own Schedule stop, or Now after one started) a team with no
   * dcmp-tier row leaves the TABLE. Only the table: it stays in `rows.teams`,
   * so the champ run, the predicted cutoff, the disclosed gaps and the status
   * counts still see it. The search and the status filter compose with it.
   *
   * NOT WHILE THE FIELD IS NOT PROVEN (quick task 261010-66y): a team with no
   * row may be a team of a division or a championship TBA has not posted
   * yet, so nobody is hidden as "not in the field" until the field is proven.
   */
  const dcmpSelected = startedDcmpEventKeys.size > 0 && fieldProven;
  const visibleTeams = useMemo(() => {
    const trimmed = query.trim();
    const shown = rows.teams.filter((team) => !champTeamHiddenAtDcmp(team, dcmpSelected));
    const searched = trimmed.length === 0 ? shown : shown.filter((team) => String(team.teamNumber).startsWith(trimmed));
    if (hiddenStatuses.size === 0) return searched;
    return searched.filter((team) => {
      const status = displayStatuses.byTeam.get(team.teamKey)?.status;
      if (status === undefined || status === "capacityUnknown") return true;
      return !hiddenStatuses.has(status);
    });
  }, [rows.teams, query, hiddenStatuses, displayStatuses, dcmpSelected]);

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
    <div className="flex flex-col gap-[var(--spacing-md)]" data-testid="champ-ledger-tab">
      <ControlsCard query={query} onQueryChange={setQuery} cutoff={cutoff} progress={runProgress}>
        <LocksMilestonePicker timeline={timeline} events={milestoneEvents} at={search.at} positionIndex={positionIndex} onAtChange={handleAtChange} />
        <StatusChips counts={displayStatuses.counts} active={activeStatuses} onToggle={toggleStatus} withheld={displayStatuses.withheld !== undefined} definitions={CHAMP_LEDGER_STATUS_DEFINITIONS} />
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
              const status = displayStatuses.byTeam.get(team.teamKey);
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
                        // The ALL-TIER earned total AT THE POSITION: the champ
                        // race counts DCMP points too, and a rewound header
                        // prints only what was earned by then (finding 4).
                        earnedAtPosition: team.earnedAtPosition,
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
                      placeholder={placeholderFor(team.teamKey)}
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
                    <ChampCell
                      key={cell.id}
                      cell={cell}
                      interaction={interaction}
                      pricing={row.kind === "dcmp" ? { season, tier: "dcmp", isRookie: isRookieByTeam.get(team.teamKey) === true } : undefined}
                    />
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
