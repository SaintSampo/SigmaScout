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
import { TeamsFilters } from "../components/teams-table/TeamsFilters.js";
import { applyTeamFilters, type TeamFilters as TeamFiltersModel } from "../components/teams-table/teamFilterModel.js";
import { TeamsBubbleChart } from "../components/teams-table/TeamsBubbleChart.js";

export const Route = createFileRoute("/teams")({
  validateSearch: TeamsSearchSchema,
  component: TeamsPage,
});

function TeamsPage() {
  // 05-06-PLAN.md Task 3: the real table replaces the tracer's plain one,
  // with sort bound to the URL (D-14) instead of a hard-coded slice.
  const { year, algorithm, sort, sortDir, cols, country, state, district, chart } = Route.useSearch();
  const navigate = Route.useNavigate();

  // Quick task 260909-tom (D-04): the bubble-chart toggle's state lives
  // entirely in `chart` — no local view state to hold or fall out of sync.
  const isChart = chart === "bubble";

  // Quick task 260905-ttv: the three region filter dimensions, read from the
  // URL exactly like every other search-param-backed piece of state on this
  // route.
  const filters: TeamFiltersModel = { country, state, district };
  const hasActiveFilter = country !== undefined || state !== undefined || district !== undefined;

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
    // Quick task 260905-ttv: rows are filtered BEFORE buildTeamRows, so the
    // rank column is the rank WITHIN the active filter, not the World rank
    // filtered down after the fact. This is the invariant the rank cards'
    // links depend on (see 260905-ttv-PLAN.md's
    // <the_invariant_this_task_rests_on>): a District rank card reading
    // "#3 of 60" must land on a table where the team shows "#3", not its
    // World rank. It is also what a reader coming from Statbotics expects a
    // filtered ranking to mean.
    const filteredTeams = applyTeamFilters(data.teams, filters);
    return sortTeamRows(buildTeamRows({ ...data, teams: filteredTeams }, algorithm), effectiveSortKey, sortDir);
  }, [data, algorithm, effectiveSortKey, sortDir, filters]);

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

  // Quick task 260909-tom: mirrors `handleViewToggle`'s updater form exactly
  // so year, algorithm, sort and the three region filters all survive a
  // chart-view toggle.
  function handleChartToggle() {
    navigate({
      search: (prev) => ({ ...prev, chart: prev.chart === "bubble" ? undefined : "bubble" }),
    });
  }

  // Quick task 260905-ttv: the updater form so year/algorithm/sort/cols all
  // survive, mirroring `events.tsx`'s `handleFiltersChange`/`handleClearFilters`.
  function handleFiltersChange(nextFilters: TeamFiltersModel) {
    navigate({
      search: (prev) => ({
        ...prev,
        country: nextFilters.country,
        state: nextFilters.state,
        district: nextFilters.district,
      }),
    });
  }

  function handleClearFilters() {
    navigate({
      search: (prev) => ({
        ...prev,
        country: undefined,
        state: undefined,
        district: undefined,
      }),
    });
  }

  return (
    <div className="p-[var(--spacing-lg)]">
      {/*
        One centered, CONTENT-WIDTH column holding the heading row and the
        table together (2026-09-01 user request). `w-fit` takes the widest
        child — always the table — so `mx-auto` centres the whole block, and
        the heading row, being a full-width flex child of that column, lands
        its `justify-between` ends exactly on the TABLE's left and right
        edges rather than on the page's. That is what puts the view toggle
        directly above the table's right edge at every viewport width and in
        both column views.
      */}
      <div className="mx-auto flex w-fit max-w-full flex-col">
        <div className="mb-[var(--spacing-md)] flex items-center justify-between gap-[var(--spacing-md)]">
          <h1 className="text-role-heading text-[var(--color-text-primary)]">Teams {year}</h1>
          <div className="flex items-center gap-[var(--spacing-sm)]">
            {/*
              Quick task 260909-tom: rendered UNCONDITIONALLY, unlike the
              `cols` toggle below (gated on `canToggleView`) — the chart view
              must always be reachable regardless of which algorithm is
              selected. `aria-pressed` carries the state; the visible LABEL
              stays the stable string "Bubble chart" in both states (never
              flipped with the state) so a screen-reader user is not told the
              state twice, once by the announcement and once by a relabelled
              name. The pressed style (accent border + inset background)
              gives the state a visible signal too, not announced-only.
            */}
            <button
              type="button"
              data-testid="teams-chart-toggle"
              onClick={handleChartToggle}
              aria-pressed={isChart}
              className={
                isChart
                  ? "text-role-label rounded-md border border-[var(--color-accent)] bg-[var(--color-bg-inset)] px-[var(--spacing-sm)] py-[var(--spacing-xs)] text-[var(--color-accent)]"
                  : "text-role-label rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-[var(--spacing-sm)] py-[var(--spacing-xs)] text-[var(--color-accent)] hover:bg-[var(--color-bg-inset)]"
              }
            >
              Bubble chart
            </button>
            {/* Quick task 260909-tom: hidden in chart mode -- it changes only table columns and would be a control with no effect there. */}
            {canToggleView && !isChart && (
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
        </div>
        {/*
          Quick task 260905-ttv: gated on `data !== undefined` (the artifact
          fetch itself succeeded), NOT on `status === "success"` — that local
          `status` also folds in the filtered row count, and hiding the
          controls the moment a filter empties the table would strand the
          reader with no way back except the empty state's own Clear-filters
          link. Option lists derive from `data.teams` UNFILTERED, so
          selecting a country never empties the district list.
        */}
        {data && (
          <div className="mb-[var(--spacing-md)]">
            <TeamsFilters rows={data.teams} filters={filters} onFiltersChange={handleFiltersChange} onClearFilters={handleClearFilters} />
          </div>
        )}
        {/*
          Quick task 260909-tom: `status === "success"` gates the chart body
          rather than the chart component duplicating the loading skeleton,
          the error state with its retry, and the filtered-to-zero empty
          state with its Clear-filters link — `TeamsTable` already owns all
          three. Falling back to `TeamsTable` for every non-success status
          means chart mode inherits those behaviours for free, with no
          second, driftable implementation of any of them.
        */}
        {isChart && status === "success" ? (
          // The centred column is `mx-auto flex w-fit`, which sizes to its
          // widest child — the svg has no intrinsic width to give it, so
          // without a declared width here the column collapses to zero.
          <div className="w-[1100px] max-w-full">
            <TeamsBubbleChart rows={rows} />
          </div>
        ) : (
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
            hasActiveFilter={hasActiveFilter}
            onClearFilters={handleClearFilters}
          />
        )}
      </div>
    </div>
  );
}
