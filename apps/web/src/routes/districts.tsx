import { useEffect, useMemo, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_DISTRICT_TAB, DISTRICT_TABS, DistrictsSearchSchema, type DistrictTab } from "../lib/searchParams.js";
import { districtQueryOptions, districtsIndexQueryOptions } from "../lib/api/districts.js";
import { ArtifactFetchError } from "../lib/api/errors.js";
import { EmptyState, ErrorState } from "../components/StateViews.js";
import { DistrictSelect } from "../components/districts/DistrictSelect.js";
import { ChampLocksLedger } from "../components/districts/ChampLocksLedger.js";
import { DistrictLedger } from "../components/districts/DistrictLedger.js";
import { CHAMP_LEDGER_TAB_LABEL, DISTRICT_LEDGER_TAB_LABEL, locksTabSlotsText } from "../components/districts/districtLedgerCopy.js";
import type { DistrictArtifact } from "../../../../packages/harness/pageArtifacts.js";

/**
 * The `/districts` route — the Locks page. The route PATH is unchanged;
 * only the tab strip and the nav label narrowed to locks only.
 *
 * The district artifacts carry no algorithm dependency at all
 * (`lib/api/districts.ts`'s own doc comment) — `algorithm` still flows
 * through `RootSearchSchema` (validated at `__root.tsx`'s router boundary)
 * so every `Link to="/team/$teamNumber"` on this page can pass it through
 * unchanged. Locks and district points never vary by algorithm, so this
 * route uses only two fetches (the district index and the selected
 * district).
 */
export const Route = createFileRoute("/districts")({
  validateSearch: DistrictsSearchSchema,
  component: DistrictsPage,
});

/**
 * Every id `DISTRICT_TABS` declares has a trigger and a content panel —
 * unlike `event.$eventKey.tsx`'s `REGISTERED_EVENT_TABS`, there is no
 * per-wave partial-registration state here to guard against. This narrowing
 * array (and `resolveActiveTab` below) are kept anyway, mirroring the event
 * page's own shape. It also catches a stale in-app `?tab=insights` link,
 * falling it back to `DEFAULT_DISTRICT_TAB`.
 */
const REGISTERED_DISTRICT_TABS: readonly DistrictTab[] = [...DISTRICT_TABS];

function resolveActiveTab(tab: DistrictTab): DistrictTab {
  if (!REGISTERED_DISTRICT_TABS.includes(tab)) return DEFAULT_DISTRICT_TAB;
  return tab;
}

/**
 * The slot count each tab prints beside its label (prototype 01 of the
 * 2026-10-15 Locks tab sketch: a segmented switch with counts).
 *
 * Read from the artifact's PUBLISHED verdicts and not from either ledger's
 * own status model: only the active tab's ledger is mounted, so the inactive
 * tab's count has to come from data the route already holds. `locked` and
 * `lockedAward` both hold one of the tier's slots. `prequalified` never does
 * (`packages/core/districts/locks.ts`: the slots are worked out after the
 * prequalified teams are taken out), so it is not counted. This is the LIVE
 * census; a rewound milestone inside a panel changes that panel's chips and
 * not these counts.
 */
function locksTabCounts(artifact: DistrictArtifact | undefined): { readonly district: string; readonly champ: string } | undefined {
  if (artifact === undefined) return undefined;
  const holdsSlot = (status: DistrictArtifact["teams"][number]["districtLock"]["status"]): boolean => status === "locked" || status === "lockedAward";
  const district = artifact.teams.filter((team) => holdsSlot(team.districtLock.status)).length;
  const champ = artifact.teams.filter((team) => holdsSlot(team.champLock.status)).length;
  return { district: locksTabSlotsText(district, artifact.dcmpSlots), champ: locksTabSlotsText(champ, artifact.cmpSlots) };
}

/**
 * The segmented strip's classes. The list drops the primitive's fixed `h-8`
 * (`h-auto!`, as the `line` variant does) because each trigger wears
 * `.tap-target`'s 44px minimum, and stretches its items so two triggers whose
 * counts wrap differently on a phone still stand the same height. Each
 * trigger is `flex-1`, so the two share the strip's full width, and wraps its
 * count under the label on a narrow phone instead of scrolling.
 *
 * `data-[state=active]`, NOT the primitive's `data-active:` variants: Radix
 * marks the open trigger with `data-state="active"` and never sets a
 * `data-active` attribute, so every `data-active:` class in `ui/tabs.tsx`
 * compiles to a `[data-active]` selector that matches nothing (measured on
 * the built page 2026-10-15: the active trigger had no such attribute and a
 * transparent background). The count chip reads the same state through a
 * named group on its trigger.
 *
 * No `text-[var(...)]` beside `text-role-nav`: tailwind-merge drops the role
 * class in that pairing (project memory `project_cn_drops_text_role_classes`);
 * the base trigger's own `text-foreground/60` and the active `text-foreground`
 * below carry the ink.
 */
const LOCKS_TAB_LIST_CLASS = "flex h-auto! w-full items-stretch gap-[3px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-inset)] p-[3px]";
const LOCKS_TAB_TRIGGER_CLASS =
  "group/lockstab tap-target h-auto flex-1 flex-wrap gap-x-[var(--spacing-sm)] gap-y-[var(--spacing-xs)] whitespace-normal rounded-md px-[var(--spacing-md)] py-[var(--spacing-sm)] text-role-nav data-[state=active]:bg-[var(--color-bg-surface)] data-[state=active]:text-foreground data-[state=active]:shadow-sm";
const LOCKS_TAB_COUNT_CLASS =
  "rounded-full bg-[var(--color-bg-surface)] px-[7px] text-[11px] leading-[18px] font-normal tabular-nums whitespace-nowrap text-[var(--color-text-muted)] group-data-[state=active]/lockstab:bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] group-data-[state=active]/lockstab:text-[var(--color-accent)]";

/**
 * This route's own version of `event.$eventKey.tsx`'s shared `renderTabState`
 * — the identical 404/error/pending/populated branch order, restated here
 * (not imported) because it is typed against `DistrictArtifact`, not
 * `EventArtifact`, and this route's fetch carries no algorithm/version to
 * gate on. Both of this route's tab-content renderers call this
 * one function; neither restates the branch order itself.
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

  // District keys are year-prefixed ("2026fnc"), so a ribbon year change
  // leaves `?district=` pointing at the old season. Once this year's index
  // resolves, carry the selection to the same district in the new year, or
  // clear it when that district has no entry for the year.
  const districtIsStale = district !== undefined && !district.startsWith(String(year));
  const indexForYear = indexQuery.isPlaceholderData ? undefined : indexQuery.data;
  const staleAbbreviation = districtIsStale ? district.slice(4) : undefined;
  const carriedDistrict =
    staleAbbreviation === undefined ? undefined : indexForYear?.districts.find((row) => row.abbreviation === staleAbbreviation)?.districtKey;
  const effectiveDistrict = districtIsStale ? carriedDistrict : district;

  useEffect(() => {
    if (!districtIsStale || indexForYear === undefined) return;
    void navigate({ search: (prev) => ({ ...prev, district: carriedDistrict }), replace: true });
  }, [districtIsStale, indexForYear, carriedDistrict, navigate]);

  // `enabled: effectiveDistrict !== undefined` — with no `?district=`, render
  // an empty state prompting a selection, not a silently auto-picked
  // district. The detail fetch never fires until a real district key
  // exists for the selected year.
  const districtQuery = useQuery({
    ...districtQueryOptions({ districtKey: effectiveDistrict ?? "", year }),
    enabled: effectiveDistrict !== undefined,
    placeholderData: keepPreviousData,
  });

  const activeTab = resolveActiveTab(tab);
  const tabCounts = useMemo(() => locksTabCounts(districtQuery.data), [districtQuery.data]);

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

  function renderDistrictLedgerContent() {
    return renderDistrictTabState({
      is404: districtIs404,
      error: districtError,
      isPending: districtQuery.isPending,
      data: districtQuery.data,
      districtKey: effectiveDistrict ?? "",
      onRetry: () => void districtQuery.refetch(),
      renderPending: () => <DistrictsTabSkeleton />,
      renderPopulated: (artifact) => <DistrictLedger artifact={artifact} algorithm={algorithm} season={year} />,
    });
  }

  function renderChampLocksContent() {
    return renderDistrictTabState({
      is404: districtIs404,
      error: districtError,
      isPending: districtQuery.isPending,
      data: districtQuery.data,
      districtKey: effectiveDistrict ?? "",
      onRetry: () => void districtQuery.refetch(),
      renderPending: () => <DistrictsTabSkeleton />,
      renderPopulated: (artifact) => <ChampLocksLedger artifact={artifact} algorithm={algorithm} season={year} />,
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      <h1 className="text-role-heading mb-[var(--spacing-md)]">Locks</h1>

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
            <DistrictSelect districts={indexQuery.data.districts} value={effectiveDistrict} onValueChange={handleDistrictChange} />
          </div>

          {districtIsStale && indexForYear === undefined ? (
            <DistrictsTabSkeleton />
          ) : effectiveDistrict === undefined ? (
            <EmptyState heading="Pick a district" body="Choose a district above to see its district and championship locks." />
          ) : (
            <Tabs value={activeTab} onValueChange={handleTabChange}>
              <TabsList className={LOCKS_TAB_LIST_CLASS}>
                <TabsTrigger value="road-to-district-champs" className={LOCKS_TAB_TRIGGER_CLASS}>
                  {DISTRICT_LEDGER_TAB_LABEL}
                  {tabCounts !== undefined && (
                    <span className={LOCKS_TAB_COUNT_CLASS} data-testid="district-locks-tab-count">
                      {tabCounts.district}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="champ-locks" className={LOCKS_TAB_TRIGGER_CLASS}>
                  {CHAMP_LEDGER_TAB_LABEL}
                  {tabCounts !== undefined && (
                    <span className={LOCKS_TAB_COUNT_CLASS} data-testid="champ-locks-tab-count">
                      {tabCounts.champ}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="road-to-district-champs" data-testid="road-to-district-champs-panel" className="min-w-0 mt-[var(--spacing-lg)]">
                {renderDistrictLedgerContent()}
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
