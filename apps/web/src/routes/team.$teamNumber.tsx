import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TeamSeasonArtifact } from "../../../../packages/harness/pageArtifacts.js";
import { TEAM_TABS, TeamSearchSchema } from "../lib/searchParams.js";
import { toTeamKey } from "../lib/teamKey.js";
import { teamQueryOptions } from "../lib/api/team.js";
import { ArtifactFetchError } from "../lib/api/errors.js";
import { useAlgorithmVersion } from "../components/ribbon/AlgorithmSelect.js";
import { ErrorState } from "../components/StateViews.js";
import { EventSectionSkeleton, TeamHeaderSkeleton } from "../components/Skeletons.js";
import { MetricHistoryTab } from "../components/team/MetricHistoryTab.js";
import { OverviewTab } from "../components/team/OverviewTab.js";
import { SeasonHeader } from "../components/team/SeasonHeader.js";
import { NoEventDataState, YearMismatchEmptyState } from "../components/team/TeamStates.js";

/**
 * The `/team/{number}` route (06-01-PLAN.md). Task 1's tracer proved the
 * single artifact-fetch path; Task 2 added D-16's tab shell; this task adds
 * the page's four non-populated states (loading, error, D-19 year-mismatch,
 * E5 zero-events).
 */
export const Route = createFileRoute("/team/$teamNumber")({
  validateSearch: TeamSearchSchema,
  component: TeamPage,
});

/** A route param that is not a bare positive-integer string never fires a fetch — D-19's "explain, don't silently redirect" rule, applied one level up from D-19's own year mismatch (this is the path segment itself being nonsense). */
const TEAM_NUMBER_PATTERN = /^\d+$/;

/** How many event-section skeleton cards render during the pending state (06-UI-SPEC.md E5 loading: "2-3 skeleton event-section cards"). */
const PENDING_EVENT_SECTION_SKELETON_COUNT = 3;

type TeamTab = (typeof TEAM_TABS)[number];

/**
 * D-05's `activeYears` is published only once plan 06-02's schema wave
 * lands; this worktree's copy of `pageArtifacts.ts` predates it (both plans
 * run in the same wave with no `depends_on` between them, per 06-01-PLAN.md's
 * frontmatter). This local, optional-field intersection is the same
 * "loose cast + graceful fallback" escape hatch `YearSelect.tsx`/
 * `AlgorithmSelect.tsx` already use for a cross-route search cast — it reads
 * correctly once the real field lands (an optional field intersected onto a
 * type that later gains it is a no-op) and degrades to `undefined` (the
 * schema's own "unknown" case, per D-05's bootstrap wrinkle) until then.
 */
type TeamSeasonArtifactWithActiveYears = TeamSeasonArtifact & { activeYears?: readonly number[] };

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

  // A 404 means "no artifact was ever published for this team-year" — D-05's
  // own bootstrap wrinkle (06-CONTEXT.md): the year the team did not play.
  // Every OTHER fetch failure (500, network error, a validation failure)
  // stays the ordinary page-level error.
  const is404 = error instanceof ArtifactFetchError && error.status === 404;

  function renderOverviewContent() {
    if (is404) {
      // No artifact means no identity was ever learned for this query —
      // `YearMismatchEmptyState`'s own `nickname=""` fallback renders
      // "Team {teamNumber}", an honest degrade rather than a guess.
      return <YearMismatchEmptyState teamNumber={teamNumber} nickname="" year={year} activeYears={undefined} />;
    }

    if (error) {
      return <ErrorState resource={`team ${teamNumber}`} year={year} onRetry={() => void refetch()} />;
    }

    if (isPending || data === undefined) {
      return (
        <div className="flex flex-col gap-[var(--spacing-xl)]">
          <TeamHeaderSkeleton />
          {Array.from({ length: PENDING_EVENT_SECTION_SKELETON_COUNT }, (_, index) => (
            <EventSectionSkeleton key={index} />
          ))}
        </div>
      );
    }

    if (data.events.length === 0) {
      const artifact = data as TeamSeasonArtifactWithActiveYears;
      const activeYears = artifact.activeYears;
      const yearMismatch = activeYears !== undefined && !activeYears.includes(year);

      return (
        <div className="flex flex-col gap-[var(--spacing-xl)]">
          {/* The identity chrome (name, number — image/TBA link join once
              plan 06-07 wires D-03) is not year-scoped and renders normally
              above the empty body, per D-19/E5's own instruction. */}
          <SeasonHeader artifact={data} algorithmId={algorithm} season={year} teamNumber={teamNumber} />
          {yearMismatch ? (
            <YearMismatchEmptyState teamNumber={teamNumber} nickname={data.nickname} year={year} activeYears={activeYears} />
          ) : (
            <NoEventDataState teamNumber={teamNumber} nickname={data.nickname} year={year} />
          )}
        </div>
      );
    }

    return <OverviewTab artifact={data} algorithmId={algorithm} season={year} teamNumber={teamNumber} />;
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
          {renderOverviewContent()}
        </TabsContent>
        <TabsContent value="history" className="mt-[var(--spacing-lg)]">
          {/* Testid kept on this always-present wrapper (06-01-PLAN.md
              Task 2's own test asserts it renders even before the artifact
              resolves) — `MetricHistoryTab` mounts inside it only once a
              real artifact is available; the pending/error/empty states
              above already cover the Overview panel's equivalents, and the
              chart's own dynamic-import loading/error states (D-14) are
              MetricHistoryTab's job, not this wrapper's. */}
          <div data-testid="metric-history-panel">
            {data !== undefined && !is404 && !error ? (
              <MetricHistoryTab artifact={data} algorithmId={algorithm} season={year} />
            ) : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
