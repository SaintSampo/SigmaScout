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
 * is written (D-04, plan 07-18): every other model-name render in the app —
 * the Teams-page rank column header (D-20, `columns.tsx`), the Insights
 * tab's fallback notice (D-08, `InsightsTab.tsx`), the Breakdown tab's
 * model-estimates caption (D-11, `BreakdownTab.tsx`), and the home podium —
 * reads through `algorithmDisplayLabel` below rather than holding a second
 * literal, so a future rename needs no second edit anywhere in that list.
 *
 * D-03 (quick task 260904-5px) narrows this: the RIBBON OPTION for EPA is
 * the one exception, reading the manifest-derived `epaStatboticsLabel` below
 * instead of this short label, whenever the served EPA version is at or above
 * `EPA_STATBOTICS_LABEL_MIN_MAJOR`. Every other render everywhere else in the
 * app keeps the short `EPA` from this constant, unconditionally — the full
 * name is scoped to the ribbon dropdown alone.
 */
const ALGORITHM_DISPLAY_LABELS: Readonly<Record<PublishedAlgorithmId, string>> = {
  opr: "OPR",
  epa: "EPA",
  vpr: "VPR",
  bpr: "BPR",
};

/**
 * D-03 (quick task 260904-5px) — the ribbon dropdown's EPA option, ONLY,
 * reads this full name instead of the short `ALGORITHM_DISPLAY_LABELS.epa` +
 * version-suffix pattern every other option uses, gated on the manifest's
 * resolved `epa` version (`useAlgorithmOptions` below). Every other
 * model-name render in the app (table headers, the Insights notice, the
 * Breakdown caption, the podium) keeps reading the short `EPA` via
 * `algorithmDisplayLabel` — this constant is the ribbon option only.
 *
 * The gate exists because R2 does not necessarily serve what the code just
 * shipped: this repo's own failure log is a documentation-describes-a-
 * deleted-model story, and a HARDCODED name would keep claiming itself
 * during the window between this code shipping and the republish that
 * actually re-publishes EPA artifacts — the site would be claiming a number
 * it is not yet serving. Reading the manifest instead makes the gate
 * self-correcting: it needs no second edit when the republish lands, and no
 * coordination with it either. That property is UNCHANGED by everything
 * below. The full name embeds its own version, which is why the ordinary
 * `${baseLabel} ${entry.version}` suffix is not appended a second time on
 * this branch.
 *
 * **The trailing number is OUR OWN `epa` code version, not a Statbotics
 * release.** Quick task 260904-5px shipped this label as "EPA Statbotics 3.0"
 * and then updated it to "5.0" mid-task "once the final version was known" —
 * it has always tracked whatever `epa.version` ships. It is therefore DERIVED
 * from the manifest here (`epaStatboticsLabel`), never written out as a
 * literal, so it cannot go stale behind a version bump again.
 *
 * That derivation is also what keeps 5px's own threat model honest: its
 * T-5px-04 row names "the UI claiming `EPA Statbotics 3.0` while R2 still
 * serves `epa@2.0.0+baseline`" as a SPOOFING threat, mitigated precisely by
 * naming the version actually being served. A hardcoded number under a bumped
 * model re-opens that threat, which is what quick task 260908-615 initially
 * did (holding the label at "5.0" while shipping 6.0.0) and then corrected.
 */
const EPA_STATBOTICS_LABEL_PREFIX = "EPA Statbotics";

/**
 * The lowest `epa` code-version major that gets the full Statbotics-parity
 * name at all. Below it, the option falls back to the ordinary
 * `${baseLabel} ${entry.version}` form.
 *
 * This is a FLOOR on the label's applicability, not a claim about which
 * Statbotics release is tracked: EPA's Statbotics-parity work landed across
 * 3.0.0 (no-foul `total_points`) and 5.0.0 (the elimination discount), and
 * this repo has used the full name since 5.x. Versions at or above it name
 * themselves; versions below it read the honest older version string, which
 * is the behavior the existing pre-5.0 test has always pinned.
 */
export const EPA_STATBOTICS_LABEL_MIN_MAJOR = 5;

/**
 * `"6.0.0+baseline"` -> `"EPA Statbotics 6.0"`; `null` when the version does
 * not parse or predates `EPA_STATBOTICS_LABEL_MIN_MAJOR`, in which case the
 * caller falls through to the honest `${baseLabel} ${entry.version}` branch
 * rather than assuming a version is new enough to claim the parity name.
 *
 * Renders MAJOR.MINOR — the same shape the hand-written literal always had
 * ("3.0", "5.0"), dropping the patch segment and the `+paramSetName` suffix.
 */
function epaStatboticsLabel(version: string): string | null {
  const [major, minor] = version.split("+")[0]!.split(".");
  const majorNumber = Number.parseInt(major ?? "", 10);
  const minorNumber = Number.parseInt(minor ?? "", 10);
  if (!Number.isInteger(majorNumber) || !Number.isInteger(minorNumber)) return null;
  if (majorNumber < EPA_STATBOTICS_LABEL_MIN_MAJOR) return null;
  return `${EPA_STATBOTICS_LABEL_PREFIX} ${majorNumber}.${minorNumber}`;
}

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
    // D-03 (quick task 260904-5px): EPA gets its full Statbotics-parity name
    // ONLY when the manifest says so, and that name NAMES THE SERVED VERSION
    // — every other id/version keeps today's `${baseLabel} ${entry.version}`
    // branch, including a pre-5.0 EPA (which still reads the honest older
    // version string).
    //
    // Quick task 260908-615: the number is now derived from the manifest
    // rather than hardcoded, so a version bump updates the label instead of
    // leaving it claiming a version R2 is not serving. See
    // `EPA_STATBOTICS_LABEL_PREFIX`.
    if (id === "epa" && entry !== undefined) {
      const label = epaStatboticsLabel(entry.version);
      if (label !== null) return { id, label };
    }
    return { id, label: entry === undefined ? baseLabel : `${baseLabel} ${entry.version}` };
  });
}

/**
 * The base (no version suffix) display label for one published algorithm id
 * (07-01-PLAN.md Task 2) — the SAME `ALGORITHM_DISPLAY_LABELS` entry
 * `useAlgorithmOptions` above already reads, exposed as a plain function so a
 * non-hook call site (e.g. the Breakdown tab's D-11 model-estimates caption)
 * can read it without a manifest fetch. Gives 07-18's D-04 relabel exactly
 * one place to change.
 */
export function algorithmDisplayLabel(algorithmId: PublishedAlgorithmId): string {
  return ALGORITHM_DISPLAY_LABELS[algorithmId];
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
 * freshness anywhere in this component (only VPR folds live, and this
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
    // `teamsSortKeyUniverse`, not `metricKeysFor` (2026-09-04, 260904-5zg):
    // now that EPA also has a grouped view (D-2), a grouped sort key like
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
      {/* Pine ribbon control treatment (2026-09-01 redesign): translucent white on the dark green bar. */}
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
