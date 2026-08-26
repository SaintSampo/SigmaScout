import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { algorithmsManifestQueryOptions } from "@/lib/api/manifests";
import { metricKeysFor } from "@/lib/metricKeys";
import { resolveSortKey } from "@/lib/resolveSortKey";
import type { YearChangeableSearch } from "@/lib/searchParams";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

/** Display labels for the three published ids — a build-time constant, never derived from the manifest. */
const ALGORITHM_DISPLAY_LABELS: Readonly<Record<PublishedAlgorithmId, string>> = {
  opr: "OPR",
  epa: "EPA",
  sigma1: "Sigma1",
};

interface AlgorithmOption {
  id: PublishedAlgorithmId;
  label: string;
}

/**
 * Merges the fetched manifest OVER the build-time id list (05-UI-SPEC.md's
 * "Algorithm dropdown" populated/partial rows):
 *  - render order is ALWAYS `PUBLISHED_ALGORITHM_IDS`'s own order — this
 *    function only ever walks that constant, never `data.algorithms`, so a
 *    manifest entry whose id is not in the constant is ignored entirely
 *    (never rendered) and the manifest's own array order can never leak
 *    through.
 *  - an id in the constant but missing from the manifest (or the manifest
 *    hasn't resolved yet, or it failed) renders with no version suffix —
 *    the empty/loading/error backstops are all the SAME "no version yet"
 *    branch, never a remount and never an error banner.
 *
 * Exported (not module-private) so `AlgorithmSelect.test.tsx` can assert the
 * merge behaviour directly via `renderHook`, decoupled from Radix `Select`'s
 * own conditional (open-only) content mounting.
 */
export function useAlgorithmOptions(): AlgorithmOption[] {
  const { data } = useQuery(algorithmsManifestQueryOptions());
  return PUBLISHED_ALGORITHM_IDS.map((id): AlgorithmOption => {
    const entry = data?.algorithms.find((candidate) => candidate.id === id);
    const baseLabel = ALGORITHM_DISPLAY_LABELS[id];
    return { id, label: entry === undefined ? baseLabel : `${baseLabel} ${entry.version}` };
  });
}

/**
 * The resolved artifact version for one published algorithm id, or
 * `undefined` while the manifest is pending/failed/missing that id — the
 * one seam `routes/teams.tsx` (and later Phase 6-8 pages) needs to know
 * when it is safe to fire an artifact fetch (05-05-PLAN.md Task 2: "until
 * it resolves, the artifact query stays disabled rather than firing with a
 * placeholder version").
 */
export function useAlgorithmVersion(algorithmId: PublishedAlgorithmId): string | undefined {
  const { data } = useQuery(algorithmsManifestQueryOptions());
  return data?.algorithms.find((candidate) => candidate.id === algorithmId)?.version;
}

/**
 * See `YearSelect.tsx`'s identical `CrossRouteNavigate` doc comment: this
 * component is also mounted once at the root layout, so `useNavigate()`'s
 * route-specific search-updater type cannot describe "any route in the
 * tree" — this narrow, local cast is the documented escape hatch.
 */
type CrossRouteNavigate = (opts: { search: (prev: YearChangeableSearch) => YearChangeableSearch }) => Promise<void>;

/**
 * NAV-02's algorithm dropdown. The three options are present from the
 * FIRST paint — `PUBLISHED_ALGORITHM_IDS` is a build-time constant, so this
 * control can never be empty even before the manifest fetch resolves
 * (05-UI-SPEC.md "Algorithm dropdown" empty row). Changing the algorithm
 * holds position: same route, same filters, same sort DIRECTION, with the
 * sort KEY re-resolved through `resolveSortKey` against the new pair's key
 * set (D-13) — only the values change. No colour, dot or badge indicates
 * freshness anywhere in this component (only sigma1 folds live, and this
 * phase does not surface per-algorithm freshness at all).
 */
export function AlgorithmSelect() {
  const search = useSearch({ strict: false }) as YearChangeableSearch & { algorithm: PublishedAlgorithmId };
  const navigate = useNavigate() as unknown as CrossRouteNavigate;
  const options = useAlgorithmOptions();

  function handleChange(value: string) {
    // Radix `Select`'s `onValueChange` is typed as a plain `string`, but
    // every `<SelectItem value={...}>` below is built from
    // `PUBLISHED_ALGORITHM_IDS` (Task 3's own `useAlgorithmOptions`), so
    // `value` can only ever be one of those three ids at runtime.
    const newAlgorithm = value as PublishedAlgorithmId;
    // NAV-02 adjacency edge: reselecting the already-selected value is a
    // no-op — no navigation, no refetch, no duplicate history entry.
    if (newAlgorithm === search.algorithm) return;
    const nextSort = search.sort === undefined ? undefined : resolveSortKey(search.sort, metricKeysFor(newAlgorithm, search.year));
    navigate({
      search: (prev) => ({ ...prev, algorithm: newAlgorithm, sort: nextSort }),
    });
  }

  return (
    <Select value={search.algorithm} onValueChange={handleChange}>
      <SelectTrigger aria-label="Algorithm" className="min-w-0 max-w-[18rem] shrink">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
