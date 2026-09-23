import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEFAULT_EVENT_TAB, EventSearchSchema, type EventTab } from "../lib/searchParams.js";
import { isValidEventKey, seasonFromEventKey } from "../lib/eventKey.js";
import { eventQueryOptions } from "../lib/api/event.js";
import { preScheduleQueryOptions } from "../lib/api/preSchedule.js";
import { ArtifactFetchError } from "../lib/api/errors.js";
import { useAlgorithmVersion } from "../components/ribbon/AlgorithmSelect.js";
import { EmptyState, ErrorState } from "../components/StateViews.js";
import { EventHeader, EventHeaderSkeleton } from "../components/event/EventHeader.js";
import { BreakdownTab, BreakdownTabSkeleton } from "../components/event/BreakdownTab.js";
import { InsightsTab, InsightsTabSkeleton } from "../components/event/InsightsTab.js";
import { QualsTab, QualsTabSkeleton } from "../components/event/QualsTab.js";
import { AlliancesTab, AlliancesTabSkeleton, hasAllianceData } from "../components/event/AlliancesTab.js";
import { ElimsTab, ElimsTabSkeleton } from "../components/event/ElimsTab.js";
import { SimulationTab, SimulationTabSkeleton } from "../components/event/SimulationTab.js";
import { usesSigmaScore } from "../../../../packages/harness/sigmaScore.js";
import type { EventArtifact } from "../../../../packages/harness/pageArtifacts.js";

/**
 * The `/event/{eventKey}` route: the single artifact-fetch path, the
 * scrollable tab strip (its own DOM-sibling scroll region relative to the
 * Breakdown table's), and the page's four non-populated states.
 */
export const Route = createFileRoute("/event/$eventKey")({
  validateSearch: EventSearchSchema,
  component: EventPage,
});

/**
 * Every id `EVENT_TABS` declares now has a trigger AND a content panel —
 * this narrowing array is kept rather than removed because
 * `EventSearchSchema`'s `.catch()` cannot help here on its own: an id is a
 * valid member of `EVENT_TABS`'s enum whether or not this route has a
 * matching trigger/panel for it, so the narrowing is what stops an empty
 * panel and stays as the one list a reader checks against the tab strip
 * below.
 *
 * `alliances` sits BETWEEN `quals` and `elims`, matching `EVENT_TABS`'s own
 * fixed declared order. `simulation` is appended LAST, also matching that
 * order.
 *
 * Registering an id here is not the ONLY reachability rule on this page.
 * `simulation` is registered (has a trigger and a panel) but still
 * conditionally UNREACHABLE — a Sigma-algorithm-only rule plain-disables its
 * trigger on OPR/EPA (see `isSimulationDisabled` below), a second narrowing
 * this array cannot express on its own.
 */
const REGISTERED_EVENT_TABS: readonly EventTab[] = ["insights", "breakdown", "quals", "alliances", "elims", "simulation"];

/**
 * `isAlliancesDisabled` and `isSimulationDisabled` extend this narrowing
 * rather than adding a third/fourth mechanism: a tab whose trigger is
 * CURRENTLY disabled resolves to `DEFAULT_EVENT_TAB` the same way an
 * unregistered id does, so a shared `?tab=alliances`/`?tab=simulation` link
 * on a disabled tab lands on the default tab instead of opening a disabled
 * tab onto an empty panel. Resolve only — this never navigates and never
 * rewrites the search param, so the URL stays shareable and
 * back/forward-navigable for a reader who DOES have the right data/algorithm
 * selected.
 *
 * Takes `tab` plus one named-field options object rather than a second
 * positional boolean — this function is module-private with exactly one
 * call site and no test importer, so a transposition between two adjacent
 * same-typed booleans would compile cleanly and type-check cleanly while
 * silently disabling the wrong tab. Named fields make that transposition a
 * compile error instead of a rendering bug.
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
 * The route's ONE shared page-state branch order, extracted here rather
 * than copied into each tab's own render function — six independent copies
 * of the invalid-key / 404 / other-error / pending / populated branch order
 * would be six chances for that ordering to become true for some tabs and
 * false for others. Every render function below calls this one function;
 * none restates the branch order itself.
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

  // The established pattern, mirrored by `team.$teamNumber.tsx`: the
  // artifact query stays DISABLED until the algorithms manifest resolves a
  // real version, and disabled entirely for an invalid event key so no
  // fetch ever fires against a nonsense key.
  const version = useAlgorithmVersion(algorithm);

  const { data, isPending, error, refetch, isPlaceholderData } = useQuery({
    ...eventQueryOptions({ eventKey, algorithmId: algorithm, version: version ?? "" }),
    enabled: isValidKey && version !== undefined,
    placeholderData: keepPreviousData,
  });

  // The Alliances trigger is disabled only once the artifact for THIS event
  // key has genuinely resolved — data present, not pending, no error, and
  // NOT placeholder data. `placeholderData: keepPreviousData` (above) means
  // `data` can still be the PREVIOUS event's artifact mid-navigation;
  // deriving the disabled state from it would let one event's alliance
  // array decide another event's trigger. Disabling is itself a claim about
  // this event's data, so an unresolved/errored/placeholder query leaves the
  // trigger enabled rather than asserting a claim the page cannot support.
  const isAlliancesDisabled = !isPending && !error && !isPlaceholderData && data !== undefined && !hasAllianceData(data);
  // Deliberately NOT gated on query state the way `isAlliancesDisabled`
  // above is: disabling Alliances is a CLAIM about THIS event's alliance
  // data, and a claim must not be made from another event's
  // keep-previous-data artifact. This rule makes no claim about data at
  // all — it depends only on the already-resolved `algorithm` search param,
  // which `RootSearchSchema` has already coerced to a member of the
  // published id set before this component ever reads it. Gating it on
  // query state would make a nav element's state wait on a fetch for no
  // reason, and would blur two genuinely different rules into one shape.
  const isSimulationDisabled = !usesSigmaScore(algorithm);
  const activeTab = resolveActiveTab(tab, { isAlliancesDisabled, isSimulationDisabled });

  /**
   * The pre-schedule sidecar is LAZY — fetched only while the Simulation
   * tab is genuinely the active tab, never with the main event artifact.
   *
   * **This gate MUST live here and never inside `SimulationTab`.** Radix
   * keeps every `TabsContent` mounted with `hidden`, so `SimulationTab`
   * renders on EVERY event page view regardless of which tab is active. A
   * `useQuery` placed inside it would therefore fetch a ~160KB sidecar on
   * every event page load in the app, defeating the lazy requirement
   * entirely.
   *
   * `!isSimulationDisabled` is part of the gate because the tab is
   * Sigma-algorithm-only: on OPR/EPA the trigger is disabled,
   * `resolveActiveTab` sends `?tab=simulation` back to the default tab, and
   * no sidecar exists for those algorithms anyway (they model no ranking
   * points, so `buildPreScheduleArtifact` returns `null` and publishes
   * nothing).
   */
  const isPreScheduleEnabled = isValidKey && version !== undefined && !isSimulationDisabled && activeTab === "simulation";
  const { data: preSchedule, isPending: isPreScheduleQueryPending } = useQuery({
    ...preScheduleQueryOptions({ eventKey, algorithmId: algorithm, version: version ?? "" }),
    enabled: isPreScheduleEnabled,
  });
  // A DISABLED TanStack Query reports `status: "pending"` forever, so the
  // raw flag alone would tell `SimulationTab` "the sidecar is still coming"
  // on every event where it is never coming at all. Conjoining the gate is
  // what makes this flag mean what its name says.
  const preScheduleIsPending = isPreScheduleEnabled && isPreScheduleQueryPending;

  if (!isValidKey) {
    return (
      <div className="p-[var(--spacing-lg)]">
        <p className="text-role-heading text-[var(--color-text-primary)]">{`"${eventKey}" is not a valid event key.`}</p>
      </div>
    );
  }

  const season = seasonFromEventKey(eventKey);

  function handleTabChange(value: string) {
    const nextTab = value as EventTab;
    // The updater form — spreads `prev` so `year`/`algorithm` survive,
    // matching `team.$teamNumber.tsx`'s `handleTabChange`.
    void navigate({ search: (prev) => ({ ...prev, tab: nextTab }) });
  }

  // A 404 means no artifact was ever published for this event. Every OTHER
  // fetch failure (500, network error, a validation failure) stays the
  // ordinary page-level error.
  const is404 = error instanceof ArtifactFetchError && error.status === 404;

  // The rendered column set follows `artifact.season` — the published field
  // — never the `?year=` search param, so a hand-edited year cannot produce
  // a mismatched column set. Both panels below pass `artifact.season` to
  // their populated renderer for that reason.
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

  // The header renders on the populated and pending branches only, and on
  // NO error branch (including the 404) — the tab content's own
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
      renderPopulated: (artifact) => (
        <SimulationTab
          artifact={artifact}
          algorithmId={algorithm}
          season={artifact.season}
          // `?? null` collapses the two ABSENT states the query can report
          // — "not fetched yet" (`undefined`) and "fetched, no sidecar
          // published for this event" (`null`, the fetcher's own 404
          // answer) — into the one thing the tab needs to know: there is no
          // baked result to show. The pending flag beside it is what keeps
          // those two distinguishable where it matters.
          preSchedule={preSchedule ?? null}
          preScheduleIsPending={preScheduleIsPending}
        />
      ),
    });
  }

  // The Breakdown tab's own column set (14 metric columns plus the leading
  // `teamNumber`/`nickname` identity block) is wider than the shared
  // `max-w-[1200px]` (below) was ever sized for — most of that width is the
  // value-display box's own real-geometry floor plus the widest real "value
  // ± spread" string this component ever renders. `BreakdownTab.tsx`'s own
  // `<table>` declares an EXACT pixel `width` (`table.getTotalSize()`, never
  // `"100%"`) and scrolls inside its own card, so the outer page cap below
  // can stay constant for every tab without ever clipping or stretching the
  // table.
  return (
    // Same `max-w-[1200px]` centred content column `team.$teamNumber.tsx`
    // uses, kept CONSTANT across every tab — an uncapped Breakdown tab made
    // the header and tab strip jump sideways on every switch into or out of
    // it. Breakdown's wide table scrolls inside its own card instead of
    // dropping the page cap.
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      {/*
        The identity header — a DOM SIBLING of the tab strip below, never
        its ancestor and never its descendant, so a long name truncates
        rather than scrolls and the strip's own scroll region stays
        untouched.
      */}
      <div className="mb-[var(--spacing-lg)]">{renderHeader()}</div>
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        {/*
          A page-chrome-level scroll region, a DOM SIBLING of the Breakdown
          table's own `breakdown-table-scroll` region — never its ancestor
          and never its descendant, so the two can never trap one another.
        */}
        <div data-testid="event-tab-strip-scroll" className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
          {/*
            `w-full flex-wrap justify-start`: the strip's scroll region is
            kept — several e2e specs assert its touch-action, overscroll and
            sibling-not-nested properties — but the tabs WRAP instead of
            running off the end, so the content can never exceed the
            container and the scroller therefore never has anything to
            scroll. Wrapping to a second line is also a better
            narrow-viewport answer than a horizontally scrolling strip whose
            scrollbar is hidden (`[scrollbar-width:none]`), which would give
            a reader no cue that tabs were off-screen at all.
          */}
          <TabsList variant="line" className="w-full flex-wrap justify-start border-b border-[var(--color-border)]">
            <TabsTrigger value="insights" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
              Insights
            </TabsTrigger>
            <TabsTrigger value="breakdown" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
              Breakdown
            </TabsTrigger>
            <TabsTrigger value="quals" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
              Qualifications
            </TabsTrigger>
            {/*
              A greyed tab explains itself on hover, via a native `title`
              (the same quiet mechanism as AlliancesTab's disclosure). It
              lives on this wrapper span because the disabled trigger itself
              carries `pointer-events-none` and can never receive the hover.
              The span is inert when the tab is enabled.
            */}
            <span
              className="inline-flex"
              title={isAlliancesDisabled ? "Alliance selection results haven't been published for this event yet." : undefined}
            >
              <TabsTrigger
                value="alliances"
                disabled={isAlliancesDisabled}
                className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]"
              >
                Alliances
              </TabsTrigger>
            </span>
            <TabsTrigger value="elims" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
              Playoffs
            </TabsTrigger>
            {/* Same wrapper-span `title` treatment as Alliances above, and for the same pointer-events-none reason. */}
            <span
              className="inline-flex"
              title={isSimulationDisabled ? "Simulation is only available on SPR. Switch the algorithm selector to SPR." : undefined}
            >
              <TabsTrigger
                value="simulation"
                disabled={isSimulationDisabled}
                className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]"
              >
                Simulation
              </TabsTrigger>
            </span>
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
