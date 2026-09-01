import { useEffect, useMemo, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { TeamsSearchSchema } from "../lib/searchParams.js";
import { teamsQueryOptions } from "../lib/api/teams.js";
import { markFirstRowsRendered, measureParseToPaint } from "../lib/perfMarks.js";
import { useAlgorithmVersion } from "../components/ribbon/AlgorithmSelect.js";
import { hasGroupedTeamsView } from "../lib/metricKeys.js";
import { resolveSortKey } from "../lib/resolveSortKey.js";
import { buildTeamRows, sortTeamRows, WIN_RATE_SORT_KEY } from "../components/teams-table/rowModel.js";
import { displayedMetricKeys, type TeamsTableView } from "../components/teams-table/columns.js";
import { TeamsTable, type TeamsTableStatus } from "../components/teams-table/TeamsTable.js";

export const Route = createFileRoute("/teams")({
  validateSearch: TeamsSearchSchema,
  component: TeamsPage,
});

function TeamsPage() {
  // 05-06-PLAN.md Task 3: the real table replaces the tracer's plain one,
  // with sort bound to the URL (D-14) instead of a hard-coded slice.
  const { year, algorithm, sort, sortDir, cols } = Route.useSearch();
  const navigate = Route.useNavigate();

  // Decision T1 (2026-09-01 redesign): grouped Auto/Teleop/Endgame/Total by
  // default, the full component set behind the URL-backed `cols` toggle.
  // Algorithms whose teams artifact carries no phase metrics (EPA today)
  // resolve to the components view regardless — `displayedMetricKeys`
  // handles that — so the toggle is only rendered where it does anything.
  const view: TeamsTableView = cols === "components" ? "components" : "grouped";
  const canToggleView = hasGroupedTeamsView(algorithm);

  // 05-05-PLAN.md Task 2: until the algorithms manifest resolves a real
  // version, the artifact query below stays DISABLED rather than firing
  // with a placeholder version.
  const version = useAlgorithmVersion(algorithm);

  // `placeholderData: keepPreviousData` keeps the PREVIOUS artifact on
  // screen while a year/algorithm switch's new query resolves, rather than
  // dropping to the loading skeleton (which collapses the virtualized
  // container's height and, verified against the deployed page, resets
  // scroll position to the top) — a real UX regression this plan's own
  // "keeps the scroll position" requirement rules out. A row whose stale
  // metrics don't match the new column set simply renders an em-dash
  // (`MetricValue`'s own absent-metric case) until fresh data lands.
  const { data, isPending, error, refetch } = useQuery({
    ...teamsQueryOptions({ year, algorithmId: algorithm, version: version ?? "" }),
    enabled: version !== undefined,
    placeholderData: keepPreviousData,
  });

  // The DISPLAYED metric key set PLUS the reserved win-rate sentinel — the
  // valid sort keys for the current view. A sort naming a column the other
  // view shows (e.g. `phaseAuto` while components are expanded) resolves to
  // Total via the same `resolveSortKey` fallback as any stale key.
  const validSortKeys = useMemo(() => [...displayedMetricKeys(algorithm, year, view), WIN_RATE_SORT_KEY], [algorithm, year, view]);
  const effectiveSortKey = resolveSortKey(sort, validSortKeys);

  // "the URL never claims a sort the table is not showing" (this plan's own
  // key_links entry) — fires only when an EXPLICIT, stale `sort` param needs
  // correcting (a hand-edited URL, or a key valid for a different year/algo
  // pair). A plain ABSENT `sort` (the common first-visit case) resolves to
  // the total key locally without forcing a redirect on every load.
  useEffect(() => {
    if (sort !== undefined && sort !== effectiveSortKey) {
      navigate({ search: (prev) => ({ ...prev, sort: effectiveSortKey }), replace: true });
    }
  }, [sort, effectiveSortKey, navigate]);

  // 05-VALIDATION.md's "Measurement Gate (NAV-06)" — the render side of the
  // parse-to-paint split. Fires once per artifact load (guarded on the
  // specific `data` reference, not a boolean), never on the skeleton render.
  const markedDataRef = useRef<typeof data>(undefined);
  useEffect(() => {
    if (!data || markedDataRef.current === data) return;
    markedDataRef.current = data;
    markFirstRowsRendered();
    const durationMs = measureParseToPaint();
    console.log(JSON.stringify({ event: "teams-parse-to-paint", season: data.season, durationMs }));
  }, [data]);

  // Clicking a sortable header writes the new key/direction back to the URL
  // with the updater form so year/algorithm survive (05-05's D-14 pattern).
  // Re-clicking the ACTIVE column toggles direction; clicking a different
  // column starts it at descending (the common "biggest first" reading for
  // this project's metrics).
  function handleSortChange(columnId: string) {
    navigate({
      search: (prev) => {
        const nextDirection: "asc" | "desc" = prev.sort === columnId && prev.sortDir === "desc" ? "asc" : "desc";
        return { ...prev, sort: columnId, sortDir: nextDirection };
      },
    });
  }

  const rows = useMemo(() => {
    if (!data) return [];
    return sortTeamRows(buildTeamRows(data, algorithm), effectiveSortKey, sortDir);
  }, [data, algorithm, effectiveSortKey, sortDir]);

  let status: TeamsTableStatus;
  if (isPending) status = "loading";
  else if (error) status = "error";
  else if (rows.length === 0) status = "empty";
  else status = "success";

  function handleViewToggle() {
    navigate({
      search: (prev) => ({ ...prev, cols: view === "components" ? undefined : "components" }),
    });
  }

  return (
    <div className="p-[var(--spacing-lg)]">
      <div className="mb-[var(--spacing-md)] flex items-center justify-between gap-[var(--spacing-md)]">
        <h1 className="text-role-heading text-[var(--color-text-primary)]">Teams {year}</h1>
        {canToggleView && (
          <button
            type="button"
            data-testid="teams-view-toggle"
            onClick={handleViewToggle}
            className="text-role-label rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-[var(--spacing-sm)] py-[var(--spacing-xs)] text-[var(--color-accent)] hover:bg-[var(--color-bg-inset)]"
          >
            {view === "components" ? "◂ Grouped view" : "All components ▸"}
          </button>
        )}
      </div>
      <TeamsTable
        status={status}
        rows={rows}
        algorithmId={algorithm}
        season={year}
        view={view}
        sortKey={effectiveSortKey}
        sortDirection={sortDir}
        onSortChange={handleSortChange}
        onRetry={() => void refetch()}
      />
    </div>
  );
}
