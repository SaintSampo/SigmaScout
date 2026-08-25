import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TEAM_TABS, TeamSearchSchema } from "../lib/searchParams.js";
import { toTeamKey } from "../lib/teamKey.js";
import { teamQueryOptions } from "../lib/api/team.js";
import { useAlgorithmVersion } from "../components/ribbon/AlgorithmSelect.js";
import { ErrorState } from "../components/StateViews.js";
import { OverviewTab } from "../components/team/OverviewTab.js";

/**
 * The `/team/{number}` route (06-01-PLAN.md). Task 1's tracer proved the
 * single artifact-fetch path; this task adds D-16's tab shell — a typed
 * `?tab=` search param — and the two frozen composition seams
 * (`SeasonHeader`, `EventSectionList`, via `OverviewTab`) plans 06-07/06-08
 * fill without touching this file or each other's.
 */
export const Route = createFileRoute("/team/$teamNumber")({
  validateSearch: TeamSearchSchema,
  component: TeamPage,
});

/** A route param that is not a bare positive-integer string never fires a fetch — D-19's "explain, don't silently redirect" rule, applied one level up from D-19's own year mismatch (this is the path segment itself being nonsense). */
const TEAM_NUMBER_PATTERN = /^\d+$/;

type TeamTab = (typeof TEAM_TABS)[number];

function TeamPage() {
  const { teamNumber: teamNumberParam } = Route.useParams();
  const { year, algorithm, tab } = Route.useSearch();
  const navigate = Route.useNavigate();

  const isValidTeamNumber = TEAM_NUMBER_PATTERN.test(teamNumberParam) && Number.parseInt(teamNumberParam, 10) > 0;
  const teamNumber = isValidTeamNumber ? Number.parseInt(teamNumberParam, 10) : Number.NaN;
  const teamKey = isValidTeamNumber ? toTeamKey(teamNumber) : "";

  // 05-05-PLAN.md Task 2's established pattern, mirrored here: the artifact
  // query stays DISABLED until the algorithms manifest resolves a real
  // version, and disabled entirely for an invalid team number so no fetch
  // ever fires against a nonsense key.
  const version = useAlgorithmVersion(algorithm);

  const { data, isPending, error, refetch } = useQuery({
    ...teamQueryOptions({ teamKey, year, algorithmId: algorithm, version: version ?? "" }),
    enabled: isValidTeamNumber && version !== undefined,
    placeholderData: keepPreviousData,
  });

  if (!isValidTeamNumber) {
    return (
      <div className="p-[var(--spacing-lg)]">
        <p className="text-role-heading text-[var(--color-text-primary)]">{`"${teamNumberParam}" is not a valid team number.`}</p>
      </div>
    );
  }

  function handleTabChange(value: string) {
    const nextTab = value as TeamTab;
    // The updater form — spreads `prev` so `year`/`algorithm` survive,
    // matching every other control's navigation pattern in this app
    // (e.g. `AlgorithmSelect.tsx`'s `handleChange`).
    void navigate({ search: (prev) => ({ ...prev, tab: nextTab }) });
  }

  // Both tabs render from first paint regardless of query state
  // (06-UI-SPEC.md E8) — they gate CONTENT, never their own existence.
  return (
    <div className="p-[var(--spacing-lg)]">
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList variant="line" className="border-b border-[var(--color-border)]">
          <TabsTrigger value="overview" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
            Overview
          </TabsTrigger>
          <TabsTrigger value="history" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
            Metric History
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" data-testid="overview-panel" className="mt-[var(--spacing-lg)]">
          {error ? (
            <ErrorState resource={`team ${teamNumber}`} year={year} onRetry={() => void refetch()} />
          ) : isPending || data === undefined ? (
            // Task 3 replaces this with a shaped skeleton (header block +
            // 2-3 event-section skeleton cards) per the UI-SPEC's E1/E5
            // loading rows.
            <p className="text-role-body text-[var(--color-text-muted)]">Loading…</p>
          ) : (
            <OverviewTab artifact={data} algorithmId={algorithm} season={year} teamNumber={teamNumber} />
          )}
        </TabsContent>
        <TabsContent value="history" className="mt-[var(--spacing-lg)]">
          {/* plan 06-05 replaces this body with the real Recharts chart. */}
          <div data-testid="metric-history-panel" className="text-role-body text-[var(--color-text-muted)]">
            Metric history coming soon.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
