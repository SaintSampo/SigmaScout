import { useNavigate, useSearch } from "@tanstack/react-router";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SEASONS } from "@/lib/seasons";
import { applyYearChange, type YearChangeableSearch } from "@/lib/searchParams";

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

export function YearSelect() {
  const search = useSearch({ strict: false }) as YearChangeableSearch;
  const navigate = useNavigate() as unknown as CrossRouteNavigate;

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
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SEASONS.map((season) => (
          <SelectItem key={season} value={String(season)}>
            {season}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
