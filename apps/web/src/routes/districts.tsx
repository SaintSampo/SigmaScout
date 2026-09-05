import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_DISTRICT_TAB, DISTRICT_TABS, DistrictsSearchSchema, type DistrictTab } from "../lib/searchParams.js";
import { districtQueryOptions, districtsIndexQueryOptions } from "../lib/api/districts.js";
import { ArtifactFetchError } from "../lib/api/errors.js";
import { EmptyState, ErrorState } from "../components/StateViews.js";
import { DistrictSelect } from "../components/districts/DistrictSelect.js";
import { DistrictInsightsTab } from "../components/districts/DistrictInsightsTab.js";
import { DistrictBreakdownTab } from "../components/districts/DistrictBreakdownTab.js";
import { DistrictLocksTab } from "../components/districts/DistrictLocksTab.js";
import type { DistrictArtifact } from "../../../../packages/harness/pageArtifacts.js";

/**
 * The `/districts` route (quick task 260905-lic Task 3): the fourth ribbon
 * page, backed by two artifacts with no algorithm dependency at all
 * (`lib/api/districts.ts`'s own doc comment). `algorithm` still flows
 * through `RootSearchSchema` (validated at `__root.tsx`'s router boundary)
 * only so every `Link to="/team/$teamNumber"` on this page can pass it
 * through unchanged — this page never uses it to select a fetch.
 */
export const Route = createFileRoute("/districts")({
  validateSearch: DistrictsSearchSchema,
  component: DistrictsPage,
});

/**
 * Every id `DISTRICT_TABS` declares has a trigger and a content panel from
 * this task's first commit — unlike `event.$eventKey.tsx`'s
 * `REGISTERED_EVENT_TABS`, there is no per-wave partial-registration state
 * here to guard against. This narrowing array (and `resolveActiveTab` below)
 * are kept anyway, mirroring the event page's own shape exactly, per this
 * plan's own instruction to reuse "the same `REGISTERED_*_TABS` +
 * `resolveActiveTab` ... branch order the event page uses."
 */
const REGISTERED_DISTRICT_TABS: readonly DistrictTab[] = [...DISTRICT_TABS];

function resolveActiveTab(tab: DistrictTab): DistrictTab {
  if (!REGISTERED_DISTRICT_TABS.includes(tab)) return DEFAULT_DISTRICT_TAB;
  return tab;
}

/**
 * This route's own version of `event.$eventKey.tsx`'s shared `renderTabState`
 * — the identical 404/error/pending/populated branch order, restated here
 * (not imported) because it is typed against `DistrictArtifact`, not
 * `EventArtifact`, and this route's fetch carries no algorithm/version to
 * gate on. Every one of this route's four tab-content renderers calls this
 * one function; none restates the branch order itself.
 */
function renderDistrictTabState({
  is404,
  error,
  isPending,
  data,
  districtKey,
  onRetry,
  renderPending,
  renderPopulated,
}: {
  is404: boolean;
  error: unknown;
  isPending: boolean;
  data: DistrictArtifact | undefined;
  districtKey: string;
  onRetry: () => void;
  renderPending: () => ReactNode;
  renderPopulated: (artifact: DistrictArtifact) => ReactNode;
}): ReactNode {
  if (is404) {
    return (
      <EmptyState
        heading={`No published district data for ${districtKey} yet`}
        body="This usually means the district hasn't been published yet. Check back shortly."
      />
    );
  }

  if (error) {
    return <ErrorState resource={`district ${districtKey}`} onRetry={onRetry} />;
  }

  if (isPending || data === undefined) {
    return renderPending();
  }

  return renderPopulated(data);
}

function DistrictsIndexSkeleton() {
  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function DistrictsTabSkeleton() {
  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function DistrictsPage() {
  const { year, algorithm, district, tab } = Route.useSearch();
  const navigate = Route.useNavigate();

  const indexQuery = useQuery({ ...districtsIndexQueryOptions({ year }), placeholderData: keepPreviousData });

  // `enabled: district !== undefined` — this route's own D-07: "with no
  // `?district=`, render an empty state prompting a selection, not a
  // silently auto-picked district." The detail fetch never fires until a
  // real district key exists in the URL.
  const districtQuery = useQuery({
    ...districtQueryOptions({ districtKey: district ?? "", year }),
    enabled: district !== undefined,
    placeholderData: keepPreviousData,
  });

  const activeTab = resolveActiveTab(tab);

  function handleTabChange(value: string) {
    void navigate({ search: (prev) => ({ ...prev, tab: value as DistrictTab }) });
  }

  function handleDistrictChange(districtKey: string) {
    // Preserves every other search param (year, algorithm, tab) — the
    // updater form, matching every other control's navigation pattern in
    // this app (e.g. `event.$eventKey.tsx`'s `handleTabChange`).
    void navigate({ search: (prev) => ({ ...prev, district: districtKey }) });
  }

  const indexError = indexQuery.error;
  const indexIs404 = indexError instanceof ArtifactFetchError && indexError.status === 404;
  const indexOtherError = indexError !== null && !(indexError instanceof ArtifactFetchError && indexError.status === 404);

  const districtError = districtQuery.error;
  const districtIs404 = districtError instanceof ArtifactFetchError && districtError.status === 404;

  function renderInsightsContent() {
    return renderDistrictTabState({
      is404: districtIs404,
      error: districtError,
      isPending: districtQuery.isPending,
      data: districtQuery.data,
      districtKey: district ?? "",
      onRetry: () => void districtQuery.refetch(),
      renderPending: () => <DistrictsTabSkeleton />,
      renderPopulated: (artifact) => <DistrictInsightsTab artifact={artifact} algorithm={algorithm} season={year} />,
    });
  }

  function renderBreakdownContent() {
    return renderDistrictTabState({
      is404: districtIs404,
      error: districtError,
      isPending: districtQuery.isPending,
      data: districtQuery.data,
      districtKey: district ?? "",
      onRetry: () => void districtQuery.refetch(),
      renderPending: () => <DistrictsTabSkeleton />,
      renderPopulated: (artifact) => <DistrictBreakdownTab artifact={artifact} algorithm={algorithm} season={year} />,
    });
  }

  function renderDistrictLocksContent() {
    return renderDistrictTabState({
      is404: districtIs404,
      error: districtError,
      isPending: districtQuery.isPending,
      data: districtQuery.data,
      districtKey: district ?? "",
      onRetry: () => void districtQuery.refetch(),
      renderPending: () => <DistrictsTabSkeleton />,
      renderPopulated: (artifact) => <DistrictLocksTab artifact={artifact} which="district" algorithm={algorithm} season={year} />,
    });
  }

  function renderChampLocksContent() {
    return renderDistrictTabState({
      is404: districtIs404,
      error: districtError,
      isPending: districtQuery.isPending,
      data: districtQuery.data,
      districtKey: district ?? "",
      onRetry: () => void districtQuery.refetch(),
      renderPending: () => <DistrictsTabSkeleton />,
      renderPopulated: (artifact) => <DistrictLocksTab artifact={artifact} which="champ" algorithm={algorithm} season={year} />,
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      <h1 className="text-role-heading mb-[var(--spacing-md)]">Districts</h1>

      {indexIs404 && (
        <EmptyState
          heading="No published district data yet"
          body="This usually means districts haven't been published for this year yet. Check back shortly."
        />
      )}

      {!indexIs404 && indexOtherError && <ErrorState resource="district list" year={year} onRetry={() => void indexQuery.refetch()} />}

      {!indexIs404 && !indexOtherError && (indexQuery.isPending || indexQuery.data === undefined) && <DistrictsIndexSkeleton />}

      {!indexIs404 && !indexOtherError && indexQuery.data !== undefined && (
        <>
          <div className="mb-[var(--spacing-lg)]">
            <DistrictSelect districts={indexQuery.data.districts} value={district} onValueChange={handleDistrictChange} />
          </div>

          {district === undefined ? (
            <EmptyState heading="Pick a district" body="Choose a district above to see its standings, breakdown and championship locks." />
          ) : (
            <Tabs value={activeTab} onValueChange={handleTabChange}>
              <div className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
                <TabsList variant="line" className="w-full flex-wrap justify-start border-b border-[var(--color-border)]">
                  <TabsTrigger value="insights" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
                    Insights
                  </TabsTrigger>
                  <TabsTrigger value="breakdown" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
                    Breakdown
                  </TabsTrigger>
                  <TabsTrigger value="district-locks" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
                    District Locks
                  </TabsTrigger>
                  <TabsTrigger value="champ-locks" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
                    Champ Locks
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="insights" data-testid="district-insights-panel" className="min-w-0 mt-[var(--spacing-lg)]">
                {renderInsightsContent()}
              </TabsContent>
              <TabsContent value="breakdown" data-testid="district-breakdown-panel" className="min-w-0 mt-[var(--spacing-lg)]">
                {renderBreakdownContent()}
              </TabsContent>
              <TabsContent value="district-locks" data-testid="district-locks-panel" className="min-w-0 mt-[var(--spacing-lg)]">
                {renderDistrictLocksContent()}
              </TabsContent>
              <TabsContent value="champ-locks" data-testid="champ-locks-panel" className="min-w-0 mt-[var(--spacing-lg)]">
                {renderChampLocksContent()}
              </TabsContent>
            </Tabs>
          )}
        </>
      )}
    </div>
  );
}
