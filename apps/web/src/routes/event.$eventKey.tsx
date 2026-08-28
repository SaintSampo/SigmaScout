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
 * for — at this point exactly `breakdown`. Each expansion plan (07-11,
 * 07-12, 07-13, 07-14) appends its own id here in the same edit where it
 * adds its trigger. This narrowing exists because `EventSearchSchema`'s
 * `.catch()` cannot help here: `insights` (etc.) is a valid member of
 * `EVENT_TABS`'s enum, so it parses cleanly and would otherwise hand Radix a
 * value with no matching trigger or content — an empty panel between waves.
 */
const REGISTERED_EVENT_TABS: readonly EventTab[] = ["breakdown"];

function resolveActiveTab(tab: EventTab): EventTab {
  return REGISTERED_EVENT_TABS.includes(tab) ? tab : DEFAULT_EVENT_TAB;
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

  function renderBreakdownContent() {
    if (is404) {
      return (
        <EmptyState
          heading={`No published results for ${eventKey} yet`}
          body="This usually means results haven't published yet. Check back shortly."
        />
      );
    }

    if (error) {
      return <ErrorState resource={`event ${eventKey}`} year={season} onRetry={() => void refetch()} />;
    }

    if (isPending || data === undefined) {
      return <BreakdownTabSkeleton algorithmId={algorithm} season={season} />;
    }

    // The rendered column set follows `artifact.season` — the published
    // field — never the `?year=` search param, so a hand-edited year cannot
    // produce a mismatched column set (07-01-PLAN.md Decision 1).
    return <BreakdownTab artifact={data} algorithmId={algorithm} season={data.season} />;
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
            <TabsTrigger value="breakdown" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
              Breakdown
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="breakdown" data-testid="breakdown-panel" className="min-w-0 mt-[var(--spacing-lg)]">
          {renderBreakdownContent()}
        </TabsContent>
      </Tabs>
    </div>
  );
}
