import { useCallback, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/StateViews";
import { StartMatchPicker, type StartSelection } from "./StartMatchPicker.js";
import { RunControl } from "./RunControl.js";
import { useSimulationRun } from "./useSimulationRun.js";
import { RankDistributionTable } from "./RankDistributionTable.js";
import { buildRankDistributionRows } from "./rankRows.js";
import { decodePreScheduleResult } from "../../lib/preScheduleResult.js";
import { buildQualRows, buildSimulationInputs, defaultStartMatchKey } from "../../lib/simulationInputs.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import type { EventArtifact, PreScheduleArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The Simulation tab shell (EVNT-07, D-01…D-07, 08-09-PLAN.md, 08-11-PLAN.md
 * Task 3). Ships the panel's THREE states — zero qualification matches,
 * qualification matches with no ranking-point distributions, and the layout
 * stack once both are cleared — plus the pmf-presence predicate the route
 * reads. This plan (08-11) adds the ONE state this component holds: the
 * selected start `matchKey`, initialized lazily to `defaultStartMatchKey`
 * and never re-applied (PD-07), because 08-13's Run handler and 08-14's rank
 * table both need the same selected start match, and a selection owned by
 * the picker would have to be lifted the moment either arrived. The layout
 * stack's picker position is filled by `StartMatchPicker` (08-11); the run
 * control (08-13) and the rank-distribution table (08-14) each still mount
 * their own child at the clearly-marked comment naming which plan owns that
 * position.
 *
 * This component itself constructs no Web Worker. `useSimulationRun()`
 * (08-13-PLAN.md Task 1) owns that lazily, inside its own `start()` handler
 * — never at module scope, never on mount. Radix keeps every `TabsContent`
 * mounted with `hidden`, so this component renders on EVERY event page view
 * regardless of which tab is active; a Worker constructed here (or by the
 * hook eagerly) would spawn on every event page load in the app. Calling
 * `useSimulationRun()` unconditionally is safe precisely because the hook
 * itself constructs nothing until its `start` is invoked — this is also
 * what lets a component test that never presses Run need no Worker mock at
 * all (`SimulationTab.test.tsx`'s I6).
 */
export interface SimulationTabProps {
  artifact: EventArtifact;
  algorithmId: string;
  season: number;
  /**
   * The event's pre-schedule sidecar (quick task 260905-tll), or `null`
   * when none is published for it — fetched LAZILY by the route
   * (`event.$eventKey.tsx`), never by this component, because Radix keeps
   * every `TabsContent` mounted-but-hidden and a query here would fetch on
   * every event page load. Optional so every existing caller and test that
   * predates the sidecar keeps compiling and keeps its current behaviour:
   * an omitted prop is exactly the "this event has no baked result" case.
   */
  preSchedule?: PreScheduleArtifact | null;
  /**
   * True only while the sidecar query is genuinely in flight — the route
   * conjoins its own `enabled` gate before passing this, because a DISABLED
   * TanStack Query reports `pending` forever. Distinguishes "no baked
   * result is coming" from "the baked result has not landed yet", which is
   * what stops this tab claiming an empty state it is about to contradict.
   */
  preScheduleIsPending?: boolean;
}

/**
 * D-04's one spelling of "which algorithm this tab needs" — the route
 * imports this for its disabled boolean (`!SIMULATION_AVAILABLE`)
 * rather than hardcoding the string `"vpr"` a second time. This component
 * does not use `algorithmId` to decide reachability itself (PD-03) — Radix
 * keeps this panel mounted-but-hidden on every event page regardless of the
 * active algorithm, and re-deriving D-04's rule here a second time would
 * give the rule two homes that could drift; the route is the only place
 * that decides reachability. `season` (08-14, Task 3) and `algorithmId`
 * (08-14, typecheck fix) ARE now read and threaded straight through to
 * `RankDistributionTable`'s own Team #/Nickname links, which need both for
 * their `TeamSearchSchema` search params — the tab is unavailable to every
 * algorithm since VPR's retirement, but the selected `algorithmId` is still
 * carried rather than assumed, the same discipline `InsightsTab.tsx` and
 * `BreakdownTab.tsx` already apply.
 */
/**
 * Whether ANY published algorithm can drive the rank simulation.
 *
 * Was `SIMULATION_ALGORITHM_ID = "vpr"` until 2026-09-09, when VPR left the
 * published set. It is now a capability question rather than an identity one,
 * which is the honest shape: the simulation needs per-match ranking-point
 * distributions (`redRpPmf`/`blueRpPmf`), and VPR was simply the only algorithm
 * that modelled them — measured 2026-09-09, BPR emits none and its presim
 * sidecar 404s where VPR's returned 200.
 *
 * So TODAY this is `false` and the Simulation trigger is disabled for every
 * algorithm. That is a real capability loss, recorded rather than hidden, and
 * the tab keeps its existing plain-disabled state rather than breaking.
 *
 * It is deliberately a constant and NOT a hardcoded `false` inline: when
 * ranking points are rebuilt as a SigmaScout-layer feature (see
 * `.planning/todos/pending/vpr-retirement-make-features-algorithm-agnostic.md`),
 * this is the single place that flips, and the tab lights up for every
 * algorithm at once rather than for a favoured one.
 */
export const SIMULATION_AVAILABLE = false;

/**
 * 08-UI-SPEC.md's Copywriting Contract, verbatim — the event genuinely has
 * zero published `qm` matches (rare; same population class as Phase 7's
 * Quals-tab empty case).
 */
export const SIMULATION_EMPTY_STATE_HEADING = "No qualification matches to simulate";
export const SIMULATION_EMPTY_STATE_BODY =
  "This event doesn't have a qualification schedule yet. Check back once matches are published.";

/**
 * Minted by THIS plan (08-09) — no Copywriting Contract row existed for this
 * state because 08-05 discovered it, on real published bytes, after that
 * contract was signed off: qualification matches exist but not one of them
 * carries both `redRpPmf`/`blueRpPmf` (see `hasSimulatableRankInputs` below
 * for the mechanism). The cause is stated as the USUAL reason, hedged, never
 * asserted as certain — `EventArtifactSchema` carries no `eventType` field
 * (see `packages/harness/pageArtifacts.ts` `EventArtifactSchema`, ~line 958),
 * so this component genuinely cannot confirm offseason is the reason for any
 * INDIVIDUAL event, only that it is the usual one across the corpus (368 of
 * the full corpus per STATE.md's Phase 06.1 ingest record). D-04's
 * no-explanation rule forbids naming an algorithm or the dropdown here —
 * guarded by a dedicated prohibition test in `SimulationTab.test.tsx`.
 */
export const SIMULATION_UNAVAILABLE_HEADING = "Rank simulation isn't available for this event";
export const SIMULATION_UNAVAILABLE_BODY =
  "This event's matches don't carry the predicted ranking-point distributions the simulation needs. Offseason events are the usual reason, since they sit outside the ranking-point model.";

/** 08-UI-SPEC.md's Copywriting Contract, verbatim — the pre-run placeholder (UI-SPEC S3 `empty` row: nothing failed, nothing returned zero rows, there is simply no simulation output yet). */
export const SIMULATION_PRE_RUN_BODY = "Pick a start match and run the simulation to see predicted ranks.";

/** The layout stack's testid — the mount point 08-11 (picker), 08-13 (run control) and 08-14 (rank table) each add a child to. */
export const SIMULATION_STACK_TESTID = "simulation-stack";

/** The pre-run placeholder paragraph's testid, distinct from the stack's own testid so a test can assert containment (PD-07's "the mount point" claim, made checkable). */
export const SIMULATION_PRE_RUN_TESTID = "simulation-pre-run";

/**
 * 08-UI-SPEC.md's Simulation Tab Contract, "Layout, top to bottom" — the
 * start-match picker's declared `max-height: 320px`. Named here (not
 * hand-picked) so `SimulationTabSkeleton`'s placeholder footprint is grounded
 * in the same declared geometry the real picker (08-11) will render at,
 * keeping the pending and populated footprints from jumping when data lands.
 */
export const SIMULATION_SKELETON_PICKER_HEIGHT_PX = 320;

/**
 * The pmf-presence predicate the route (08-09) and 08-11's input assembly
 * both read: does this event's qualification schedule carry AT LEAST ONE
 * `qm` row (across `artifact.matches` and `artifact.upcoming` together) with
 * BOTH `redRpPmf` and `blueRpPmf` present and non-empty. This answers only
 * "is this event in the pmf-bearing class at all" (PD-06) — it does NOT
 * validate that every remaining match after a chosen start match carries a
 * pmf pair; that sharper, per-row question belongs to 08-11's
 * `simulationInputs.ts`, which is where a per-match gap actually changes what
 * the Worker receives. Making this predicate stricter here would move a
 * decision into a plan that cannot act on it, and would show the unavailable
 * state on an event where the simulation could legitimately run over the
 * rows that DO carry pmfs.
 *
 * Reads the RAW artifact arrays, not the `mergeEventMatches`-produced merged
 * rows (PD-05) — `EventMatchRow` (`eventMatchAxis.ts`) deliberately carries
 * no pmf pair, and widening that shared Phase 7 type with a Phase 8 field
 * three plans before any renderer reads it would put a field on the row
 * model for nobody.
 *
 * Mechanism this predicate is detecting, recorded here so the next reader
 * does not have to rediscover it: `packages/core/algorithms/sigma1/index.ts`
 * (~line 748) gates pmf production on `isRpEligibleEventType(match.eventType)`;
 * TBA event type `99` (Offseason) is deliberately absent from
 * `EVENT_TYPE_TIERS` (`packages/core/rankingPoints/constants.ts`,
 * ~line 54); and the publisher's conditional spread then OMITS the
 * `redRpPmf`/`blueRpPmf` keys entirely rather than writing an empty array —
 * `{ redPmf: [], bluePmf: [] }` on the RP-ineligible branch, never a
 * degenerate certain-zero distribution (see that same file's comment above
 * line 748 for why a degenerate pmf was refused: it would be a POSITIVE
 * claim that an alliance certainly earns no ranking points, which is false
 * for an offseason match that does award RP under whatever rules that event
 * ran).
 */
export function hasSimulatableRankInputs(artifact: EventArtifact): boolean {
  const hasBothPmfs = (row: { compLevel: string; redRpPmf?: readonly number[]; blueRpPmf?: readonly number[] }): boolean =>
    row.compLevel === "qm" && (row.redRpPmf?.length ?? 0) > 0 && (row.blueRpPmf?.length ?? 0) > 0;

  return artifact.matches.some(hasBothPmfs) || artifact.upcoming.some(hasBothPmfs);
}

/**
 * The pending state's placeholder, footprint-matching the populated stack
 * (mirrors `ElimsTabSkeleton`'s purpose) so the panel does not jump when data
 * lands: the same outer stack container with two `Skeleton` blocks — one
 * sized to the picker's declared max-height region, one short block in the
 * run control's position. Renders no empty state, no unavailable state and
 * no pre-run text of any kind — a skeleton asserts nothing about the data.
 */
export function SimulationTabSkeleton() {
  return (
    <div data-testid={SIMULATION_STACK_TESTID} className="flex flex-col gap-[var(--spacing-lg)]">
      <Skeleton className="w-full" style={{ height: `${SIMULATION_SKELETON_PICKER_HEIGHT_PX}px` }} />
      <Skeleton className="h-8 w-40" />
    </div>
  );
}

/**
 * Branches in a fixed order (08-09-PLAN.md Task 2's `<action>`):
 *
 * 1. Zero qualification matches (`mergeEventMatches` over `qm` rows only, the
 *    same helper `QualsTab`/`ElimsTab` already use) — the canonical empty
 *    state, Copywriting Contract's exact strings. First because an event
 *    with no qualification matches also has no pmfs, and this sentence is
 *    the more specific and more accurate one there.
 * 2. Otherwise, `hasSimulatableRankInputs(artifact)` false — the canonical
 *    empty state again, this time with the unavailable heading/body. This IS
 *    a genuine absent-data state (nothing failed, but the data this feature
 *    needs genuinely does not exist for this event), unlike branch 3 below.
 * 3. Otherwise — the layout stack, in UI-SPEC's declared top-to-bottom order
 *    (start-match picker, run control, rank-distribution table): the picker
 *    (08-11), `RunControl` (08-13), and the rank-table position — 08-14's
 *    `RankDistributionTable` when a completed, CURRENT result exists,
 *    otherwise 08-09's pre-run placeholder paragraph, unchanged in copy,
 *    testid and styling. The placeholder is rendered as a plain muted body
 *    paragraph, deliberately NOT `EmptyState` (UI-SPEC S3 `empty`): nothing
 *    failed and nothing returned zero rows, there is simply no simulation
 *    output yet, and a centred empty-state block would replace the
 *    picker/run-control mount above it rather than sitting beneath them.
 */
export function SimulationTab({ artifact, algorithmId, season, preSchedule = null, preScheduleIsPending = false }: SimulationTabProps) {
  const qualRows = useMemo(() => buildQualRows(artifact), [artifact]);
  const hasPreSchedule = preSchedule !== null;

  // The reader's OWN choice — `null` until they make one. Kept separate
  // from the default below so "the reader has not chosen yet" stays a state
  // this component can actually observe.
  const [selection, setSelection] = useState<StartSelection | null>(null);

  // PD-07, unchanged in both mechanism and guarantee: the default start
  // MATCH is computed ONCE, in a lazy initializer, and never re-applied.
  // Recomputing it on every artifact change would move an unchosen start
  // match the moment the first unplayed match became played, mid-event.
  const [defaultMatchKey] = useState<string | null>(() => defaultStartMatchKey(qualRows));

  // The default applies only until the reader chooses, and the sidecar
  // outranks the default match (C-01): whenever a baked result exists, the
  // pre-schedule stop IS the opening view, for every covered event — live
  // and completed ones included, not only scheduleless ones.
  //
  // This is deliberately NOT folded into the lazy initializer above. The
  // sidecar is fetched lazily by the route and lands AFTER this component
  // first renders (Radix mounts it hidden on every event page), so an
  // initializer would have committed to a match selection before the baked
  // result ever arrived — and C-01 would then hold only for events whose
  // sidecar happened to be cached. Deriving it at render time is what makes
  // "the baked result is what you see first" true on a cold load too.
  const effectiveSelection: StartSelection | null = useMemo(() => {
    if (selection !== null) return selection;
    if (hasPreSchedule) return { kind: "preSchedule" };
    return defaultMatchKey !== null ? { kind: "match", matchKey: defaultMatchKey } : null;
  }, [selection, hasPreSchedule, defaultMatchKey]);

  // PD-06: the held selection is resolved against the CURRENT rows on every
  // render. A selected key no longer present in the current rows resolves
  // to "no selection" (never a neighbouring row) — and the held state is
  // NOT cleared on a miss, so a transient artifact shape (a live refetch
  // mid-flight) cannot permanently discard the reader's choice. The
  // pre-schedule kind is resolved against the sidecar's presence for the
  // same reason and with the same non-destructive discipline.
  const resolvedSelection: StartSelection | null =
    effectiveSelection === null
      ? null
      : effectiveSelection.kind === "preSchedule"
        ? hasPreSchedule
          ? effectiveSelection
          : null
        : qualRows.some((row) => row.matchKey === effectiveSelection.matchKey)
          ? effectiveSelection
          : null;

  const isPreScheduleSelected = resolvedSelection?.kind === "preSchedule";
  const resolvedMatchKey = resolvedSelection?.kind === "match" ? resolvedSelection.matchKey : null;

  const simulationInputs = useMemo(
    () => (resolvedMatchKey !== null ? buildSimulationInputs(artifact, resolvedMatchKey) : null),
    [artifact, resolvedMatchKey]
  );

  // The selected match's own qualification NUMBER — what the scope line names.
  const startMatchNumber = useMemo(() => {
    const selectedRow = resolvedMatchKey !== null ? qualRows.find((row) => row.matchKey === resolvedMatchKey) : undefined;
    return selectedRow ? selectedRow.matchNumber : null;
  }, [qualRows, resolvedMatchKey]);

  // 08-13, PD-02: the signature a completed result is checked against at
  // RENDER time, never in an effect. Detects a change of start match, a
  // match moving from upcoming to played (which changes remainingMatches's
  // length), a roster change (baselines.length) and a republished algorithm
  // version — the four ways this event's inputs can genuinely change under
  // the reader. Does NOT detect a pmf revised under an identical match count
  // and an identical algorithmVersion — a freshness check that overstated
  // its own reach would be worse than one that states its limit.
  const simulationSignature = useMemo(() => {
    const remainingCount = simulationInputs?.remainingMatches.length ?? 0;
    const baselineCount = simulationInputs?.baselines.length ?? 0;
    // The selection's KIND is folded in (C-02). Before the pre-schedule stop
    // existed a null selection folded to the literal "none"; a second
    // non-match selection therefore needs its own token, or the two would
    // be indistinguishable in the signature and a result computed under one
    // could be shown as current under the other. A real match key always
    // contains an underscore-qualified event key, so neither token can
    // collide with one.
    const selectionToken = isPreScheduleSelected ? "pre-schedule" : (resolvedMatchKey ?? "none");
    return `${artifact.algorithmVersion}|${selectionToken}|${remainingCount}|${baselineCount}`;
  }, [artifact.algorithmVersion, isPreScheduleSelected, resolvedMatchKey, simulationInputs]);

  const { state: runState, start: startRun } = useSimulationRun();

  const isResultCurrent = runState.status === "complete" && runState.signature === simulationSignature;
  const isRunning = runState.status === "running";
  // The button stays pressable on the pre-schedule stop even though pressing
  // it starts nothing (C-02): the reader's model is "this button shows me
  // the simulation for what I picked", and a disabled control there would
  // read as "this stop is broken" rather than "this stop is already
  // showing you its result".
  const canRun = simulationInputs !== null || isPreScheduleSelected;

  // 08-14: rows built ONLY when a completed result exists AND is current for
  // the present selection — the freshness gate (PD-02) has already been
  // applied above via `isResultCurrent`, so this performs no freshness check
  // of its own. Reads the completed `SimResult` exactly as 08-13 exposed it
  // (`runState.result`) — constructs no second Worker and repeats no run.
  const rankResult = useMemo(() => {
    // C-01: the baked path. Decoding is pure unpacking — no Worker, no
    // draws, no Monte Carlo — so the tab's first paint renders a full rank
    // table at zero client compute cost. It takes precedence over any run
    // state because the pre-schedule stop's result is not something a run
    // can produce.
    if (isPreScheduleSelected && preSchedule !== null) {
      const decoded = decodePreScheduleResult(preSchedule);
      return { rows: buildRankDistributionRows(decoded, artifact.teams), teamCount: decoded.rankHistograms.size };
    }
    if (runState.status !== "complete" || !isResultCurrent) return null;
    return { rows: buildRankDistributionRows(runState.result, artifact.teams), teamCount: runState.teamCount };
  }, [isPreScheduleSelected, preSchedule, runState, isResultCurrent, artifact.teams]);

  const handleRun = useCallback((): void => {
    // C-02: pressing the button on the pre-schedule stop is a deliberate
    // no-op — the baked result is already on screen and re-showing it is
    // exactly what the reader asked for. Returning before `startRun` is
    // what keeps the client engine from running for this stop at all.
    if (isPreScheduleSelected) return;
    if (simulationInputs === null || resolvedMatchKey === null) return;
    // COMMIT the selection the run is about to be computed for. Until this
    // point the reader may never have touched the picker, leaving
    // `selection` null and the effective selection DERIVED — and a derived
    // selection re-evaluates when the lazily-fetched sidecar lands, which
    // could be mid-run. That flipped the tab to the pre-schedule stop under
    // a running simulation: the run control kept counting draws while the
    // table below it rendered baked data for a different start point, and
    // the picker silently jumped to "Before schedule release". Pressing the
    // button is an unambiguous act of choosing, so record it as one.
    setSelection({ kind: "match", matchKey: resolvedMatchKey });
    startRun({ matches: simulationInputs.remainingMatches, baselines: simulationInputs.baselines, signature: simulationSignature });
  }, [isPreScheduleSelected, resolvedMatchKey, simulationInputs, simulationSignature, startRun]);

  // Both early returns are now skipped when a baked result EXISTS (C-15): a
  // scheduleless event trips both — it has no qualification rows and
  // therefore no pmf-bearing row either — and would otherwise render an
  // empty state on top of a perfectly good pipeline result.
  //
  // While the sidecar is still in flight the honest answer is neither the
  // empty state (which the arriving result may contradict a moment later)
  // nor the stack (whose picker and run control describe inputs this event
  // may not have). It is the SKELETON: we do not know yet. Rendering the
  // stack there was a real defect, not a cosmetic one — the route fetches a
  // sidecar for every VPR event regardless of season, so on every pre-2026
  // and offseason event that pending window would have shown an offseason
  // event an ENABLED run button over the exact inputs
  // `SIMULATION_UNAVAILABLE_*` exists to refuse, and shown a
  // qualification-less event a picker with no controls in it at all.
  //
  // Note the deliberate asymmetry: an event that clears both guards renders
  // its stack IMMEDIATELY and never waits on the sidecar. A pending fetch
  // only defers the two states that would otherwise be wrong.
  //
  // `SIMULATION_UNAVAILABLE_*` still fires for offseason events once that
  // fetch resolves, and does so without a special case: the pipeline
  // structurally cannot publish a sidecar for an RP-ineligible event
  // (PD-06), so `hasPreSchedule` is false exactly where that state is the
  // right answer.
  if (!hasPreSchedule && qualRows.length === 0) {
    if (preScheduleIsPending) return <SimulationTabSkeleton />;
    return <EmptyState heading={SIMULATION_EMPTY_STATE_HEADING} body={SIMULATION_EMPTY_STATE_BODY} />;
  }

  if (!hasPreSchedule && !hasSimulatableRankInputs(artifact)) {
    if (preScheduleIsPending) return <SimulationTabSkeleton />;
    return <EmptyState heading={SIMULATION_UNAVAILABLE_HEADING} body={SIMULATION_UNAVAILABLE_BODY} />;
  }

  return (
    <div data-testid={SIMULATION_STACK_TESTID} className="flex flex-col gap-[var(--spacing-lg)]">
      {/* 08-11 mounts the start-match picker here (max-height: 320px, internal overflow-y-auto). */}
      <StartMatchPicker
        rows={qualRows}
        selection={resolvedSelection}
        onSelect={setSelection}
        hasPreScheduleStop={hasPreSchedule}
        preScheduleScheduleCount={preSchedule?.schedules.length}
        preScheduleDraws={preSchedule?.baked.draws}
        inputs={simulationInputs}
        startMatchNumber={startMatchNumber}
        // 08-13: inert for the duration of a run, so a mid-run click cannot
        // change the start match under a running simulation (PD-09 on the
        // picker's own side).
        disabled={isRunning}
      />
      <RunControl state={runState} isResultCurrent={isResultCurrent} canRun={canRun} onRun={handleRun} />
      {/*
        The pre-run placeholder holds for the WHOLE run (UI-SPEC's explicit
        no-streaming decision, S3 `loading`/`error`) — a running or errored
        state never reaches `rankResult !== null` above, so this branch is
        unconditional on run status, not merely on the table's own presence.
        08-14 mounts `RankDistributionTable` here only once a completed,
        CURRENT result exists.
      */}
      {rankResult !== null ? (
        <RankDistributionTable rows={rankResult.rows} teamCount={rankResult.teamCount} season={season} algorithmId={algorithmId} />
      ) : (
        <p data-testid={SIMULATION_PRE_RUN_TESTID} className="text-role-body text-muted-foreground">
          {SIMULATION_PRE_RUN_BODY}
        </p>
      )}
    </div>
  );
}
