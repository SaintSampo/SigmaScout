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
import { BreakdownTab, BreakdownTabSkeleton } from "../components/event/BreakdownTab.js";
import { InsightsTab, InsightsTabSkeleton } from "../components/event/InsightsTab.js";
import { QualsTab, QualsTabSkeleton } from "../components/event/QualsTab.js";
import { ElimsTab, ElimsTabSkeleton } from "../components/event/ElimsTab.js";
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
 * Only the ids this route currently registers a trigger AND a content panel
 * for — `insights` (07-11-PLAN.md Task 3) and `breakdown` (07-01-PLAN.md
 * Task 3). Each further expansion plan (07-12, 07-13, 07-14) appends its own
 * id here in the same edit where it adds its trigger. This narrowing exists
 * because `EventSearchSchema`'s `.catch()` cannot help here: an id like
 * `quals` is a valid member of `EVENT_TABS`'s enum, so it parses cleanly and
 * would otherwise hand Radix a value with no matching trigger or content —
 * an empty panel between waves.
 *
 * `elims` is registered LAST (07-13-PLAN.md Decision 6). `EVENT_TABS`
 * declares the fixed order `insights, breakdown, quals, alliances, elims`;
 * at this wave `alliances` is not yet registered, so the rendered strip
 * reads Insights, Breakdown, Quals, Elims — correct relative order with one
 * member absent. 07-14 inserts its own Alliances trigger BETWEEN Quals and
 * Elims rather than appending, since `EVENT_TABS` places Alliances fourth.
 */
const REGISTERED_EVENT_TABS: readonly EventTab[] = ["insights", "breakdown", "quals", "elims"];

function resolveActiveTab(tab: EventTab): EventTab {
  return REGISTERED_EVENT_TABS.includes(tab) ? tab : DEFAULT_EVENT_TAB;
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

  const { data, isPending, error, refetch } = useQuery({
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
  const activeTab = resolveActiveTab(tab);

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

  return (
    // Same `max-w-[1200px]` centred content column `team.$teamNumber.tsx`
    // uses, for the same stated reason (the fixed 470px plot width math the
    // Quals and Elims tabs will carry in 07-12/07-13).
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        {/*
          The THIRD independent scroll region 07-RESEARCH.md's Open Question
          5 resolves: page-chrome level, a DOM SIBLING of the Breakdown
          table's own `breakdown-table-scroll` region — never its ancestor
          and never its descendant, so the two can never trap one another.
        */}
        <div data-testid="event-tab-strip-scroll" className="min-w-0 touch-pan-x overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
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
              07-14 inserts the Alliances trigger HERE, between Quals and
              Elims, because EVENT_TABS declares Alliances fourth and Elims
              fifth — this trigger stays last only until that plan lands.
            */}
            <TabsTrigger value="elims" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
              Elims
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
        <TabsContent value="elims" data-testid="elims-panel" className="min-w-0 mt-[var(--spacing-lg)]">
          {renderElimsContent()}
        </TabsContent>
      </Tabs>
    </div>
  );
}
