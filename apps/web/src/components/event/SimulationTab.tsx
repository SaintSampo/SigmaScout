import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/StateViews";
import { isQualCompLevel, mergeEventMatches } from "./eventMatchAxis.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The Simulation tab shell (EVNT-07, D-01…D-07, 08-09-PLAN.md). This plan
 * ships the panel's THREE states — zero qualification matches, qualification
 * matches with no ranking-point distributions, and ready-but-not-yet-run —
 * plus the pmf-presence predicate the route and 08-11 both read. It does
 * NOT ship the start-match picker (08-11), the run control (08-13) or the
 * rank-distribution table (08-14) — each of those plans mounts its own
 * child into the layout stack this component establishes below, at the
 * clearly-marked comment naming which plan owns that position.
 *
 * This component constructs no Web Worker and starts no computation. Radix
 * keeps every `TabsContent` mounted with `hidden`, so this component renders
 * on EVERY event page view regardless of which tab is active — a Worker
 * constructed here would spawn on every event page load in the app.
 * Construction stays lazy, inside 08-13's Run handler, which is also what
 * lets a component test that never clicks Run need no Worker mock at all.
 */
export interface SimulationTabProps {
  artifact: EventArtifact;
  algorithmId: string;
  season: number;
}

/**
 * D-04's one spelling of "which algorithm this tab needs" — the route
 * imports this for its disabled boolean (`algorithmId !== SIMULATION_ALGORITHM_ID`)
 * rather than hardcoding the string `"vpr"` a second time. This component
 * itself reads none of `algorithmId`/`season` on its props (PD-03) — Radix
 * keeps this panel mounted-but-hidden on every event page regardless of the
 * active algorithm, and re-deriving D-04's rule here a second time would give
 * the rule two homes that could drift; the route is the only place that
 * decides reachability.
 */
export const SIMULATION_ALGORITHM_ID: PublishedAlgorithmId = "vpr";

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
  "This event's matches don't carry the predicted ranking-point distributions the simulation needs. Offseason events are the usual reason — they sit outside the ranking-point model.";

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
 * `EVENT_TYPE_TIERS` (`packages/core/algorithms/sigma1/rp/constants.ts`,
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
 *    (start-match picker, run control, rank-distribution table), containing
 *    at this stage only the pre-run placeholder paragraph. Rendered as a
 *    plain muted body paragraph, deliberately NOT `EmptyState` (UI-SPEC S3
 *    `empty`): nothing failed and nothing returned zero rows, there is
 *    simply no simulation output yet, and a centred empty-state block would
 *    replace the picker/run-control 08-11/08-13 mount above it rather than
 *    sitting beneath them.
 */
export function SimulationTab({ artifact }: SimulationTabProps) {
  const qualRows = mergeEventMatches(artifact.matches, artifact.upcoming, isQualCompLevel);

  if (qualRows.length === 0) {
    return <EmptyState heading={SIMULATION_EMPTY_STATE_HEADING} body={SIMULATION_EMPTY_STATE_BODY} />;
  }

  if (!hasSimulatableRankInputs(artifact)) {
    return <EmptyState heading={SIMULATION_UNAVAILABLE_HEADING} body={SIMULATION_UNAVAILABLE_BODY} />;
  }

  return (
    <div data-testid={SIMULATION_STACK_TESTID} className="flex flex-col gap-[var(--spacing-lg)]">
      {/* 08-11 mounts the start-match picker here (max-height: 320px, internal overflow-y-auto). */}
      {/* 08-13 mounts the run control here (button + progress/timer). */}
      <p data-testid={SIMULATION_PRE_RUN_TESTID} className="text-role-body text-muted-foreground">
        {SIMULATION_PRE_RUN_BODY}
      </p>
      {/* 08-14 mounts the rank-distribution table here, replacing this pre-run paragraph once a run completes. */}
    </div>
  );
}
