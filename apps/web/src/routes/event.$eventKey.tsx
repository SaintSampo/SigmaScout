import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEFAULT_EVENT_TAB, EventSearchSchema, type EventTab } from "../lib/searchParams.js";
import { isValidEventKey, seasonFromEventKey } from "../lib/eventKey.js";
import { eventQueryOptions } from "../lib/api/event.js";
import { ArtifactFetchError } from "../lib/api/errors.js";
import { useAlgorithmVersion } from "../components/ribbon/AlgorithmSelect.js";
import { EmptyState, ErrorState } from "../components/StateViews.js";
import { EventHeader, EventHeaderSkeleton } from "../components/event/EventHeader.js";
import { BreakdownTab, BreakdownTabSkeleton } from "../components/event/BreakdownTab.js";
import { InsightsTab, InsightsTabSkeleton } from "../components/event/InsightsTab.js";
import { QualsTab, QualsTabSkeleton } from "../components/event/QualsTab.js";
import { AlliancesTab, AlliancesTabSkeleton, hasAllianceData } from "../components/event/AlliancesTab.js";
import { ElimsTab, ElimsTabSkeleton } from "../components/event/ElimsTab.js";
import { SimulationTab, SimulationTabSkeleton, SIMULATION_ALGORITHM_ID } from "../components/event/SimulationTab.js";
import type { EventArtifact } from "../../../../packages/harness/pageArtifacts.js";

/**
 * The `/event/{eventKey}` route (07-01-PLAN.md). Task 1's tracer proved the
 * single artifact-fetch path; this task adds the scrollable tab strip (its
 * own DOM-sibling scroll region relative to the Breakdown table's) and the
 * page's four non-populated states.
 */
export const Route = createFileRoute("/event/$eventKey")({
  validateSearch: EventSearchSchema,
  component: EventPage,
});

/**
 * Every id `EVENT_TABS` declares now has a trigger AND a content panel
 * (07-14-PLAN.md registered `alliances`; 08-09-PLAN.md registers the last
 * one, `simulation`) — this narrowing array is kept rather than removed
 * because `EventSearchSchema`'s `.catch()` cannot help here on its own: an
 * id is a valid member of `EVENT_TABS`'s enum whether or not this route has
 * a matching trigger/panel for it, so the narrowing is what stopped an empty
 * panel between waves and stays as the one list a reader checks against the
 * tab strip below.
 *
 * `alliances` sits BETWEEN `quals` and `elims`, matching `EVENT_TABS`'s own
 * fixed declared order and 07-13's comment asking that plan to insert it
 * exactly there rather than append it. `simulation` is appended LAST,
 * matching `EVENT_TABS`'s own declared order.
 *
 * 08-09: registering an id here is no longer the ONLY reachability rule on
 * this page. `simulation` is registered (has a trigger and a panel) but
 * still conditionally UNREACHABLE — D-04's VPR-only rule plain-disables its
 * trigger on OPR/EPA (see `isSimulationDisabled` below), a second narrowing
 * this array cannot express on its own.
 */
const REGISTERED_EVENT_TABS: readonly EventTab[] = ["insights", "breakdown", "quals", "alliances", "elims", "simulation"];

/**
 * `isAlliancesDisabled` and `isSimulationDisabled` extend this narrowing
 * rather than adding a third/fourth mechanism (07-14-PLAN.md Task 3, D-17;
 * 08-09-PLAN.md Task 3, D-04): a tab whose trigger is CURRENTLY disabled
 * resolves to `DEFAULT_EVENT_TAB` the same way an unregistered id does, so a
 * shared `?tab=alliances`/`?tab=simulation` link on a disabled tab lands on
 * the default tab instead of opening a disabled tab onto an empty panel.
 * Resolve only — this never navigates and never rewrites the search param,
 * so the URL stays shareable and back/forward-navigable for a reader who
 * DOES have the right data/algorithm selected. This is what makes
 * 07-UI-SPEC.md's E7 `empty` dismissal true rather than merely asserted, and
 * what 08-09-PLAN.md's own resolve-only truth extends by one branch.
 *
 * PD-01 (08-09-PLAN.md): takes `tab` plus one named-field options object
 * rather than a second positional boolean — this function is module-private
 * with exactly one call site and no test importer, so a transposition
 * between two adjacent same-typed booleans would compile cleanly and
 * type-check cleanly while silently disabling the wrong tab. Named fields
 * make that transposition a compile error instead of a rendering bug.
 */
function resolveActiveTab(
  tab: EventTab,
  { isAlliancesDisabled, isSimulationDisabled }: { isAlliancesDisabled: boolean; isSimulationDisabled: boolean },
): EventTab {
  if (!REGISTERED_EVENT_TABS.includes(tab)) return DEFAULT_EVENT_TAB;
  if (tab === "alliances" && isAlliancesDisabled) return DEFAULT_EVENT_TAB;
  if (tab === "simulation" && isSimulationDisabled) return DEFAULT_EVENT_TAB;
  return tab;
}

/**
 * The route's ONE shared page-state branch order (07-11-PLAN.md Decision 4),
 * extracted here rather than copied into each tab's own render function.
 * 07-01-PLAN.md Task 3 built this inline inside the `breakdown` `TabsContent`
 * alone; 07-12/07-13/07-14 each add another panel to this same file, and
 * four independent copies of the invalid-key / 404 / other-error / pending /
 * populated branch order is four chances for UI-SPEC's "inherits the
 * page-level error" rows to become true for some tabs and false for others.
 * Both `renderBreakdownContent` and `renderInsightsContent` below call this
 * one function; neither restates the branch order itself.
 *
 * Every branch here — 404, other error, pending — is byte-identical to what
 * 07-01 shipped for Breakdown; this refactor is deliberately
 * behaviour-preserving, proven by every pre-existing assertion in this file
 * continuing to pass unmodified.
 */
function renderTabState({
  is404,
  error,
  isPending,
  data,
  eventKey,
  season,
  onRetry,
  renderPending,
  renderPopulated,
}: {
  is404: boolean;
  error: unknown;
  isPending: boolean;
  data: EventArtifact | undefined;
  eventKey: string;
  season: number;
  onRetry: () => void;
  renderPending: () => ReactNode;
  renderPopulated: (artifact: EventArtifact) => ReactNode;
}): ReactNode {
  if (is404) {
    return (
      <EmptyState
        heading={`No published results for ${eventKey} yet`}
        body="This usually means results haven't published yet. Check back shortly."
      />
    );
  }

  if (error) {
    return <ErrorState resource={`event ${eventKey}`} year={season} onRetry={onRetry} />;
  }

  if (isPending || data === undefined) {
    return renderPending();
  }

  return renderPopulated(data);
}

function EventPage() {
  const { eventKey } = Route.useParams();
  const { algorithm, tab } = Route.useSearch();
  const navigate = Route.useNavigate();

  const isValidKey = isValidEventKey(eventKey);

  // 05-05-PLAN.md Task 2's established pattern, mirrored here (and by
  // `team.$teamNumber.tsx`): the artifact query stays DISABLED until the
  // algorithms manifest resolves a real version, and disabled entirely for
  // an invalid event key so no fetch ever fires against a nonsense key.
  const version = useAlgorithmVersion(algorithm);

  const { data, isPending, error, refetch, isPlaceholderData } = useQuery({
    ...eventQueryOptions({ eventKey, algorithmId: algorithm, version: version ?? "" }),
    enabled: isValidKey && version !== undefined,
    placeholderData: keepPreviousData,
  });

  if (!isValidKey) {
    return (
      <div className="p-[var(--spacing-lg)]">
        <p className="text-role-heading text-[var(--color-text-primary)]">{`"${eventKey}" is not a valid event key.`}</p>
      </div>
    );
  }

  const season = seasonFromEventKey(eventKey);

  // D-17: the Alliances trigger is disabled only once the artifact for THIS
  // event key has genuinely resolved — data present, not pending, no error,
  // and NOT placeholder data. `placeholderData: keepPreviousData` (above)
  // means `data` can still be the PREVIOUS event's artifact mid-navigation;
  // deriving the disabled state from it would let one event's alliance
  // array decide another event's trigger — the same class of wrong-
  // provenance problem 07-11 refused when it declined to guess the fallback
  // header before the artifact resolved. Disabling is itself a claim about
  // this event's data, so an unresolved/errored/placeholder query leaves the
  // trigger enabled rather than asserting a claim the page cannot support.
  const isAlliancesDisabled = !isPending && !error && !isPlaceholderData && data !== undefined && !hasAllianceData(data);
  // D-04 (08-09-PLAN.md Task 3): deliberately NOT gated on query state the
  // way `isAlliancesDisabled` above is. `isAlliancesDisabled` waits for
  // `data` to be present, non-pending, non-error and non-placeholder
  // specifically because disabling Alliances is a CLAIM about THIS event's
  // alliance data, and a claim must not be made from another event's
  // keep-previous-data artifact. D-04's rule makes no claim about data at
  // all — it depends only on the already-resolved `algorithm` search param,
  // which `RootSearchSchema` has already coerced to a member of the
  // published id set before this component ever reads it. Gating it on
  // query state would make a nav element's state wait on a fetch for no
  // reason, and would blur two genuinely different rules into one shape.
  const isSimulationDisabled = algorithm !== SIMULATION_ALGORITHM_ID;
  const activeTab = resolveActiveTab(tab, { isAlliancesDisabled, isSimulationDisabled });

  function handleTabChange(value: string) {
    const nextTab = value as EventTab;
    // The updater form — spreads `prev` so `year`/`algorithm` survive,
    // matching `team.$teamNumber.tsx`'s `handleTabChange`.
    void navigate({ search: (prev) => ({ ...prev, tab: nextTab }) });
  }

  // A 404 means no artifact was ever published for this event — measured
  // live for every offseason event until 07-09 wires --include-offseason.
  // Every OTHER fetch failure (500, network error, a validation failure)
  // stays the ordinary page-level error.
  const is404 = error instanceof ArtifactFetchError && error.status === 404;

  // The rendered column set follows `artifact.season` — the published field
  // — never the `?year=` search param, so a hand-edited year cannot produce
  // a mismatched column set (07-01-PLAN.md Decision 1). Both panels below
  // pass `artifact.season` to their populated renderer for that reason.
  function renderBreakdownContent() {
    return renderTabState({
      is404,
      error,
      isPending,
      data,
      eventKey,
      season,
      onRetry: () => void refetch(),
      renderPending: () => <BreakdownTabSkeleton algorithmId={algorithm} season={season} />,
      renderPopulated: (artifact) => <BreakdownTab artifact={artifact} algorithmId={algorithm} season={artifact.season} />,
    });
  }

  function renderInsightsContent() {
    return renderTabState({
      is404,
      error,
      isPending,
      data,
      eventKey,
      season,
      onRetry: () => void refetch(),
      renderPending: () => <InsightsTabSkeleton algorithmId={algorithm} season={season} />,
      renderPopulated: (artifact) => <InsightsTab artifact={artifact} algorithmId={algorithm} season={artifact.season} />,
    });
  }

  function renderQualsContent() {
    return renderTabState({
      is404,
      error,
      isPending,
      data,
      eventKey,
      season,
      onRetry: () => void refetch(),
      renderPending: () => <QualsTabSkeleton />,
      renderPopulated: (artifact) => <QualsTab artifact={artifact} algorithmId={algorithm} season={artifact.season} />,
    });
  }

  function renderAlliancesContent() {
    return renderTabState({
      is404,
      error,
      isPending,
      data,
      eventKey,
      season,
      onRetry: () => void refetch(),
      renderPending: () => <AlliancesTabSkeleton algorithmId={algorithm} season={season} />,
      renderPopulated: (artifact) => <AlliancesTab artifact={artifact} algorithmId={algorithm} season={artifact.season} />,
    });
  }

  // PD-05: the header renders on the populated and pending branches only,
  // and on NO error branch (including the 404) — the tab content's own
  // EmptyState/ErrorState already name the event key and are the page's
  // whole message there. `data === undefined` covers both "still pending"
  // and "the manifest version hasn't resolved yet, so the query is
  // disabled" identically, matching every other branch in this file that
  // already treats those two as one state.
  function renderHeader() {
    if (error) return null;
    if (data === undefined) return <EventHeaderSkeleton />;
    return <EventHeader artifact={data} />;
  }

  function renderElimsContent() {
    return renderTabState({
      is404,
      error,
      isPending,
      data,
      eventKey,
      season,
      onRetry: () => void refetch(),
      renderPending: () => <ElimsTabSkeleton />,
      renderPopulated: (artifact) => <ElimsTab artifact={artifact} algorithmId={algorithm} season={artifact.season} />,
    });
  }

  function renderSimulationContent() {
    return renderTabState({
      is404,
      error,
      isPending,
      data,
      eventKey,
      season,
      onRetry: () => void refetch(),
      renderPending: () => <SimulationTabSkeleton />,
      renderPopulated: (artifact) => <SimulationTab artifact={artifact} algorithmId={algorithm} season={artifact.season} />,
    });
  }

  // 07-UAT.md G-7: the Breakdown tab's own column set (14 metric columns at
  // `size: 120`, plus the pinned `teamNumber`/`nickname` identity block) is
  // 1988px wide — most of that width is the value-display box's own
  // real-geometry floor (`.metric-tier`'s `min-width: 80px` plus `TableCell`'s
  // `p-2` padding, plus the widest real "value ± spread" string this
  // component ever renders, measured at ~97px content width against a real
  // deployed 2024 event artifact — see this task's SUMMARY for the exact
  // capture), not the header text this task also fixes. The shared
  // `max-w-[1200px]` (below) was never sized for that, so this tab alone
  // drops the cap: `BreakdownTab.tsx`'s own `<table>` now declares an EXACT
  // pixel `width` (`table.getTotalSize()`, never `"100%"`), so widening this
  // wrapper can only ever let the table use MORE of a wide viewport — it can
  // never stretch the table past its own declared total on an ultra-wide
  // monitor. Scoped to `breakdown` alone: every other tab keeps the
  // unmodified 1200px cap below (Quals/Elims's own fixed 470px plot-width
  // math, named in the comment this branch replaces, depends on it staying
  // put).
  const isBreakdownActive = activeTab === "breakdown";

  return (
    // Same `max-w-[1200px]` centred content column `team.$teamNumber.tsx`
    // uses, for the same stated reason (the fixed 470px plot width math the
    // Quals and Elims tabs will carry in 07-12/07-13) — EXCEPT on the
    // Breakdown tab (07-UAT.md G-7), which drops the cap entirely rather
    // than substituting a second fixed number: the table's own declared
    // width (above) is what actually bounds it, so there is no "wide
    // enough" constant to pick that would not eventually need revisiting as
    // the declared metric-column count/width changes.
    <div className={`mx-auto w-full p-[var(--spacing-lg)] ${isBreakdownActive ? "" : "max-w-[1200px]"}`}>
      {/*
        07-15-PLAN.md Task 1's identity header — a DOM SIBLING of the tab
        strip below, never its ancestor and never its descendant, so a long
        name truncates rather than scrolls and the strip's own scroll region
        stays untouched.
      */}
      <div className="mb-[var(--spacing-lg)]">{renderHeader()}</div>
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        {/*
          The THIRD independent scroll region 07-RESEARCH.md's Open Question
          5 resolves: page-chrome level, a DOM SIBLING of the Breakdown
          table's own `breakdown-table-scroll` region — never its ancestor
          and never its descendant, so the two can never trap one another.
        */}
        <div data-testid="event-tab-strip-scroll" className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
          <TabsList variant="line" className="border-b border-[var(--color-border)]">
            <TabsTrigger value="insights" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
              Insights
            </TabsTrigger>
            <TabsTrigger value="breakdown" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
              Breakdown
            </TabsTrigger>
            <TabsTrigger value="quals" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
              Quals
            </TabsTrigger>
            {/*
              D-17: `disabled` alone is the whole treatment — no title, no
              accessible-description reference, no icon, no badge, no custom
              class. `apps/web/src/components/ui/tabs.tsx` already removes
              pointer events and halves opacity for a disabled trigger; Radix
              supplies the disabled semantics. The Copywriting Contract's own
              row for this element reads that there is no copy at all.
            */}
            <TabsTrigger
              value="alliances"
              disabled={isAlliancesDisabled}
              className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]"
            >
              Alliances
            </TabsTrigger>
            <TabsTrigger value="elims" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
              Elims
            </TabsTrigger>
            {/*
              D-04 (08-09-PLAN.md Task 3), reusing Phase 7 D-17's treatment
              verbatim: `disabled` alone is the whole treatment — no title, no
              accessible-description reference, no icon, no badge, no custom
              class. `apps/web/src/components/ui/tabs.tsx` already removes
              pointer events and halves opacity for a disabled trigger; Radix
              supplies the disabled semantics. The Copywriting Contract's own
              row for this element reads that there is no copy at all. The
              one sentence specific to D-04: the accepted cost is that a user
              on OPR or EPA sees a dead tab with no hint, taken deliberately
              so the site keeps exactly one rule for a tab you cannot use.
            */}
            <TabsTrigger
              value="simulation"
              disabled={isSimulationDisabled}
              className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]"
            >
              Simulation
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="insights" data-testid="insights-panel" className="min-w-0 mt-[var(--spacing-lg)]">
          {renderInsightsContent()}
        </TabsContent>
        <TabsContent value="breakdown" data-testid="breakdown-panel" className="min-w-0 mt-[var(--spacing-lg)]">
          {renderBreakdownContent()}
        </TabsContent>
        <TabsContent value="quals" data-testid="quals-panel" className="min-w-0 mt-[var(--spacing-lg)]">
          {renderQualsContent()}
        </TabsContent>
        <TabsContent value="alliances" data-testid="alliances-panel" className="min-w-0 mt-[var(--spacing-lg)]">
          {renderAlliancesContent()}
        </TabsContent>
        <TabsContent value="elims" data-testid="elims-panel" className="min-w-0 mt-[var(--spacing-lg)]">
          {renderElimsContent()}
        </TabsContent>
        <TabsContent value="simulation" data-testid="simulation-panel" className="min-w-0 mt-[var(--spacing-lg)]">
          {renderSimulationContent()}
        </TabsContent>
      </Tabs>
    </div>
  );
}
