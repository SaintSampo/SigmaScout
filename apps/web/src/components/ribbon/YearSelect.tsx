import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SEASONS } from "@/lib/seasons";
import { applyYearChange, type YearChangeableSearch } from "@/lib/searchParams";
import { teamQueryOptions } from "@/lib/api/team";
import { toTeamKey } from "@/lib/teamKey";
import { algorithmsManifestQueryOptions } from "@/lib/api/manifests";

/**
 * NAV-02's year dropdown. Options are `SEASONS` (Task 1) — descending,
 * current season first — with NO fetch dependency, so no loading state and
 * no error state (05-UI-SPEC.md "Year dropdown" row). Roughly five to eight
 * options: shadcn `Select`'s own built-in scroll handles overflow, no
 * custom treatment.
 *
 * Mounted once at the root layout (`Ribbon`), so it is visible on every
 * route — `useSearch({ strict: false })` reads whatever the CURRENT route's
 * validated search happens to be (year/algorithm always present via
 * `RootSearchSchema`; sort/sortDir present only on routes that extend it,
 * e.g. Teams) rather than being coupled to one specific route's own search
 * type.
 */
/**
 * `useNavigate()`'s search-updater type is resolved against the SPECIFIC
 * active route — but this component is mounted once at the root layout and
 * must work no matter which child route (each with its own search schema:
 * root-only on Events/Compare, root-extended on Teams) is currently active.
 * TanStack Router's typed search params have no single type that covers
 * "any route in the tree" for a cross-route search-updater call, so this
 * narrow, local cast is the documented escape hatch (mirrors
 * `__root.test.tsx`'s identical, already-reviewed cast) — the runtime
 * behavior (spread `prev`, override specific fields) is unaffected either
 * way.
 */
type CrossRouteNavigate = (opts: { search: (prev: YearChangeableSearch) => YearChangeableSearch }) => Promise<void>;

/** D-15's route shape: `/team/{number}`, the plain team number, never `frc{number}`. Matches with or without a trailing path segment so this stays correct if a future plan adds one (e.g. an event-detail sub-path). */
const TEAM_ROUTE_PATTERN = /^\/team\/(\d+)(?:\/|$)/;

/**
 * D-18's constrained year dropdown, modelled directly on
 * `AlgorithmSelect.tsx`'s `useAlgorithmOptions` "upgrade in place, never
 * remount" shape: render the unconstrained/global list first, narrow once
 * `activeYears` resolves, degrade back to the global list in every
 * unresolved case (loading, error, non-team route, empty/absent
 * `activeYears`).
 *
 * `YearSelect` mounts once at the root layout, above the route tree, so it
 * cannot use a strict route hook for the team route's own typed params —
 * `useLocation()` reading the raw pathname is the same escape-hatch class as
 * this file's own `useSearch({ strict: false })` cast one line below.
 *
 * This hook must not issue a SECOND fetch of the team artifact: it builds
 * the EXACT SAME `teamQueryOptions` query key the `/team/$teamNumber` route
 * itself already queries with, and reads with `enabled: false` — TanStack
 * Query's cache is keyed, not per-call, so this observer subscribes to (and
 * re-renders when) the route's own already-enabled query resolves, without
 * ever triggering a fetch of its own (D-07: one artifact per page).
 *
 * The algorithm-version lookup is INLINED here (reading the same
 * `algorithms-manifest` query key `AlgorithmSelect.tsx`'s `useAlgorithmVersion`
 * uses) rather than calling that hook directly, because `useAlgorithmVersion`
 * has no `enabled` toggle — it would fire the manifest fetch unconditionally
 * on every route, including the vast majority (`/teams`, `/events`,
 * `/compare`) where this hook needs no version at all. Gating it on
 * `isTeamRoute` here keeps this hook self-contained and inert off a team
 * route, without changing `AlgorithmSelect.tsx`'s own contract.
 *
 * Exported (not module-private) so `YearSelect.test.tsx` can assert the
 * narrow-over-time behaviour directly via `renderHook`, decoupled from
 * Radix `Select`'s own conditional (open-only) content mounting — the same
 * reason `AlgorithmSelect.tsx`'s `useAlgorithmOptions` is exported.
 */
export function useConstrainedYears(): readonly number[] {
  const location = useLocation();
  const search = useSearch({ strict: false }) as YearChangeableSearch;
  const match = TEAM_ROUTE_PATTERN.exec(location.pathname);
  const isTeamRoute = match !== null;
  const teamNumber = match !== null ? Number(match[1]) : Number.NaN;
  const teamKey = isTeamRoute ? toTeamKey(teamNumber) : "";

  const { data: manifest } = useQuery({ ...algorithmsManifestQueryOptions(), enabled: isTeamRoute });
  const version = manifest?.algorithms.find((entry) => entry.id === search.algorithm)?.version;

  const { data } = useQuery({
    ...teamQueryOptions({ teamKey, year: search.year, algorithmId: search.algorithm, version: version ?? "" }),
    enabled: false,
  });

  if (!isTeamRoute || data === undefined) return SEASONS;
  const { activeYears } = data;
  if (activeYears === undefined || activeYears.length === 0) return SEASONS;
  // Render descending, matching the global dropdown's own SEASONS order —
  // the published array's own order is not a sort guarantee.
  return [...activeYears].sort((a, b) => b - a);
}

export function YearSelect() {
  const search = useSearch({ strict: false }) as YearChangeableSearch;
  const navigate = useNavigate() as unknown as CrossRouteNavigate;
  const years = useConstrainedYears();

  function handleChange(value: string) {
    const newYear = Number(value);
    // NAV-02 adjacency edge: reselecting the already-selected value is a
    // no-op — no navigation, no refetch, no duplicate history entry.
    if (newYear === search.year) return;
    navigate({
      // The shared D-11 year-change handler (searchParams.ts, Task 2):
      // preserves filters/sort/column state and re-resolves the sort key
      // through the same resolveSortKey the algorithm-change path uses.
      search: (prev) => applyYearChange(prev, newYear),
    });
  }

  return (
    <Select value={String(search.year)} onValueChange={handleChange}>
      <SelectTrigger aria-label="Year" className="w-[5.5rem]">
        {/*
          D-19: explicit children, not Radix's own item-derived label. Radix
          `Select.Value` only auto-derives its displayed text by portaling a
          MATCHING, currently-rendered `SelectItem`'s text into this node
          (`@radix-ui/react-select`'s `SelectItemText` "bubble" mechanism) —
          when the routed year isn't in the constrained `years` list, no
          `SelectItem` for it exists to bubble from, and the trigger would
          render blank. Passing `search.year` directly here decouples the
          CLOSED trigger's displayed value from which options happen to be
          OPEN-state selectable, satisfying "the control and the URL never
          disagree" for every year, matched or not.
        */}
        <SelectValue>{search.year}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {years.map((season) => (
          <SelectItem key={season} value={String(season)}>
            {season}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
