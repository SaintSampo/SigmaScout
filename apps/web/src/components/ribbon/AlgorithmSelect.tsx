import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { algorithmsManifestQueryOptions } from "@/lib/api/manifests";
import { teamsSortKeyUniverse } from "@/lib/metricKeys";
import { resolveSortKey } from "@/lib/resolveSortKey";
import type { YearChangeableSearch } from "@/lib/searchParams";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

/**
 * Display labels for the published ids — a build-time constant, never
 * derived from the manifest. This is the SINGLE place the site's model name
 * is written: every other model-name render in the app (Teams-page rank
 * column header, Insights tab's fallback notice, Breakdown tab's
 * model-estimates caption, the home podium) reads through
 * `algorithmDisplayLabel` below rather than holding a second literal.
 */
const ALGORITHM_DISPLAY_LABELS: Readonly<Record<PublishedAlgorithmId, string>> = {
  opr: "OPR",
  epa: "EPA",
  spr: "SPR",
};

/**
 * `"4.0.0+baseline"` -> `"4.0"`: the MAJOR.MINOR every ribbon option shows
 * after its base label, dropping the patch segment and the `+paramSetName`
 * suffix. It is DERIVED from the manifest's served version, never written
 * out as a literal, so a bump to `5.0.0+baseline` reads `5.0` with no edit
 * here, and the site never names a version R2 is not yet serving. A version
 * that does not parse is returned whole rather than guessed at.
 */
function shortVersion(version: string): string {
  const [major, minor] = version.split("+")[0]!.split(".");
  const majorNumber = Number.parseInt(major ?? "", 10);
  const minorNumber = Number.parseInt(minor ?? "", 10);
  if (!Number.isInteger(majorNumber) || !Number.isInteger(minorNumber)) return version;
  return `${majorNumber}.${minorNumber}`;
}

interface AlgorithmOption {
  id: PublishedAlgorithmId;
  label: string;
}

/**
 * Merges the fetched manifest OVER the build-time id list:
 *  - render order is ALWAYS `PUBLISHED_ALGORITHM_IDS`'s own order — this
 *    function only ever walks that constant, never `data.algorithms`, so a
 *    manifest entry whose id is not in the constant is never rendered and
 *    the manifest's own array order can never leak through.
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
    return { id, label: entry === undefined ? baseLabel : `${baseLabel} ${shortVersion(entry.version)}` };
  });
}

/**
 * The base (no version suffix) display label for one published algorithm id
 * — the SAME `ALGORITHM_DISPLAY_LABELS` entry `useAlgorithmOptions` above
 * already reads, exposed as a plain function so a non-hook call site (e.g.
 * the Breakdown tab's model-estimates caption) can read it without a
 * manifest fetch.
 */
export function algorithmDisplayLabel(algorithmId: PublishedAlgorithmId): string {
  return ALGORITHM_DISPLAY_LABELS[algorithmId];
}

/**
 * The resolved artifact version for one published algorithm id, or
 * `undefined` while the manifest is pending/failed/missing that id — the
 * seam `routes/teams.tsx` and other pages need to know when it is safe to
 * fire an artifact fetch. Until it resolves, the artifact query stays
 * disabled rather than firing with a placeholder version.
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
 * The algorithm dropdown. The three options are present from the FIRST
 * paint — `PUBLISHED_ALGORITHM_IDS` is a build-time constant, so this
 * control can never be empty even before the manifest fetch resolves.
 * Changing the algorithm holds position: same route, same filters, same
 * sort DIRECTION, with the sort KEY re-resolved through `resolveSortKey`
 * against the new pair's key set — only the values change. No colour, dot
 * or badge indicates freshness anywhere in this component.
 */
export function AlgorithmSelect() {
  const search = useSearch({ strict: false }) as YearChangeableSearch & { algorithm: PublishedAlgorithmId };
  const navigate = useNavigate() as unknown as CrossRouteNavigate;
  const options = useAlgorithmOptions();

  function handleChange(value: string) {
    // Radix `Select`'s `onValueChange` is typed as a plain `string`, but
    // every `<SelectItem value={...}>` below is built from
    // `PUBLISHED_ALGORITHM_IDS`, so `value` can only ever be one of those
    // three ids at runtime.
    const newAlgorithm = value as PublishedAlgorithmId;
    // Reselecting the already-selected value is a no-op — no navigation, no
    // refetch, no duplicate history entry.
    if (newAlgorithm === search.algorithm) return;
    // `teamsSortKeyUniverse`, not `metricKeysFor`: a grouped sort key like
    // `phaseAuto` must survive an algorithm switch too — the same key
    // universe `searchParams.ts`'s `applyYearChange` already uses for the
    // year-change path, so both triggers share one resolution rule.
    const nextSort = search.sort === undefined ? undefined : resolveSortKey(search.sort, teamsSortKeyUniverse(newAlgorithm, search.year));
    navigate({
      search: (prev) => ({ ...prev, algorithm: newAlgorithm, sort: nextSort }),
    });
  }

  return (
    <Select value={search.algorithm} onValueChange={handleChange}>
      {/* Ribbon control treatment: translucent white on the dark green bar. */}
      <SelectTrigger
        aria-label="Algorithm"
        className="data-[size=default]:h-9 min-w-0 max-w-[18rem] shrink border-[var(--ribbon-control-border)] bg-[var(--ribbon-control-bg)] text-[15px] text-[var(--ribbon-ink)] [&_svg]:text-[var(--ribbon-ink-muted)]"
      >
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
