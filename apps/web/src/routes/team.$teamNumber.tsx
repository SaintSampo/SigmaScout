import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { eventsQueryOptions } from "../lib/api/events.js";
import { officialSnapshotRow } from "../lib/officialSnapshot.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TEAM_TABS, TeamSearchSchema } from "../lib/searchParams.js";
import { toTeamKey } from "../lib/teamKey.js";
import { teamQueryOptions } from "../lib/api/team.js";
import { ArtifactFetchError } from "../lib/api/errors.js";
import { useAlgorithmVersion } from "../components/ribbon/AlgorithmSelect.js";
import { ErrorState } from "../components/StateViews.js";
import { EventSectionSkeleton, SeasonHeaderSkeleton } from "../components/Skeletons.js";
import { MetricHistoryTab } from "../components/team/MetricHistoryTab.js";
import { OverviewTab } from "../components/team/OverviewTab.js";
import { useLiveTeamSeason } from "../components/team/useLiveTeamSeason.js";
import { SeasonHeader } from "../components/team/SeasonHeader.js";
import { NoEventDataState, YearMismatchEmptyState } from "../components/team/TeamStates.js";

/**
 * The `/team/{number}` route: the single artifact-fetch path, the tab
 * shell, and the page's four non-populated states (loading, error,
 * year-mismatch, zero-events).
 */
export const Route = createFileRoute("/team/$teamNumber")({
  validateSearch: TeamSearchSchema,
  component: TeamPage,
});

/** A route param that is not a bare positive-integer string never fires a fetch — "explain, don't silently redirect" applied one level up from the year-mismatch case (this is the path segment itself being nonsense). */
const TEAM_NUMBER_PATTERN = /^\d+$/;

/** How many event-section skeleton cards render during the pending state. */
const PENDING_EVENT_SECTION_SKELETON_COUNT = 3;

type TeamTab = (typeof TEAM_TABS)[number];

function TeamPage() {
  const { teamNumber: teamNumberParam } = Route.useParams();
  const { year, algorithm, tab } = Route.useSearch();
  const navigate = Route.useNavigate();

  const isValidTeamNumber = TEAM_NUMBER_PATTERN.test(teamNumberParam) && Number.parseInt(teamNumberParam, 10) > 0;
  const teamNumber = isValidTeamNumber ? Number.parseInt(teamNumberParam, 10) : Number.NaN;
  const teamKey = isValidTeamNumber ? toTeamKey(teamNumber) : "";

  // The established pattern, mirrored across the app: the artifact query
  // stays DISABLED until the algorithms manifest resolves a real version,
  // and disabled entirely for an invalid team number so no fetch ever fires
  // against a nonsense key.
  const version = useAlgorithmVersion(algorithm);

  const { data, isPending, error, refetch } = useQuery({
    ...teamQueryOptions({ teamKey, year, algorithmId: algorithm, version: version ?? "" }),
    enabled: isValidTeamNumber && version !== undefined,
    placeholderData: keepPreviousData,
  });

  // The header tiles show the team's stats AS OF THEIR LAST OFFICIAL MATCH,
  // not the season-final values (which keep learning through
  // offseason/preseason play). The team artifact itself carries no
  // official/offseason flag per event, but the events/{year} artifact does
  // — one small, CDN-cached parallel fetch closes the gap with no
  // republish. Until it resolves (or if it errors) the tiles show the
  // season-final values, then swap.
  //
  // `headerMetrics` is the official snapshot or `undefined` and nothing
  // else — never a fallback to `data.seasonStats.metrics` here, which would
  // make `metricsOverride !== undefined` an untrustworthy signal for
  // labelling: a team with no resolvable official snapshot would still
  // receive a defined (but SEASON-FINAL) override, and labelling that "as
  // of last official match" would be a false claim. The prop now MEANS
  // "this is the official-match snapshot", which is the precondition
  // `SeasonHeader` needs before it can label the tiles that way. This is
  // behaviour-preserving for the RENDERED NUMBERS: `SeasonHeader.tsx`
  // already resolves `metricsOverride ?? artifact.seasonStats.metrics`
  // itself, so the season-final fallback still happens, one layer down.
  const eventsQuery = useQuery({
    ...eventsQueryOptions({ year, algorithmId: algorithm, version: version ?? "" }),
    enabled: isValidTeamNumber && version !== undefined,
  });
  // Resolves the snapshot ROW, not just its metrics, so the header can
  // bound its browser-computed consistency figure to the same as-of instant
  // the tiles beside it show. `headerMetrics` is derived from the row and
  // keeps its exact prior meaning, so the labelling precondition above is
  // untouched.
  // THE LIVE VIEW, resolved once for the whole page (260917-jr4). Called
  // unconditionally with a possibly-undefined artifact so the hook count
  // never depends on a branch; it returns `undefined` until the artifact
  // resolves, and the PUBLISHED values by identity when no event is live.
  const live = useLiveTeamSeason(data, algorithm);
  // Fed the EXTENDED history, not `data.metricHistory` — during a live
  // event the last official row is one the Worker folded since the last
  // republish, and the published array does not contain it.
  // `officialSnapshotRow` itself is untouched.
  const snapshotRow = live !== undefined && eventsQuery.data !== undefined ? officialSnapshotRow(live.metricHistory, eventsQuery.data.events) : undefined;
  const headerMetrics = snapshotRow?.metrics;

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

  // A 404 means "no artifact was ever published for this team-year" — the
  // year the team did not play. Every OTHER fetch failure (500, network
  // error, a validation failure) stays the ordinary page-level error.
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
          <SeasonHeaderSkeleton />
          {Array.from({ length: PENDING_EVENT_SECTION_SKELETON_COUNT }, (_, index) => (
            <EventSectionSkeleton key={index} />
          ))}
        </div>
      );
    }

    if (data.events.length === 0) {
      const activeYears = data.activeYears;
      const yearMismatch = activeYears !== undefined && !activeYears.includes(year);

      return (
        <div className="flex flex-col gap-[var(--spacing-xl)]">
          {/* The identity chrome (name, number) is not year-scoped and renders normally above the empty body. */}
          <div className="data-card p-[var(--spacing-md)]"><SeasonHeader artifact={data} algorithmId={algorithm} season={year} teamNumber={teamNumber} seasonStats={live?.seasonStats} metricsOverride={headerMetrics} snapshotMatchKey={snapshotRow?.matchKey} ranks={data.ranks} /></div>
          {yearMismatch ? (
            <YearMismatchEmptyState teamNumber={teamNumber} nickname={data.nickname} year={year} activeYears={activeYears} />
          ) : (
            <NoEventDataState teamNumber={teamNumber} nickname={data.nickname} year={year} />
          )}
        </div>
      );
    }

    return (
      <OverviewTab
        artifact={data}
        algorithmId={algorithm}
        season={year}
        teamNumber={teamNumber}
        events={live?.events}
        metricHistory={live?.metricHistory}
        seasonStats={live?.seasonStats}
        metricsOverride={headerMetrics}
        snapshotMatchKey={snapshotRow?.matchKey}
      />
    );
  }

  // Both tabs render from first paint regardless of query state — they gate
  // CONTENT, never their own existence.
  return (
    // The match table's plot column is a deliberate fixed ~470px, so the
    // table's natural width is ~905px and it can never fill a 1440px card —
    // an unconstrained page left dead space to the right of every match
    // table and stretched the metric tiles across the full viewport.
    // Constraining the content column (rather than stretching the table) is
    // what closes that gap, and it centres the page on wide displays.
    // 1200px leaves the 905px table comfortable margins without shrinking
    // the 6-up metric grid below a readable tile width.
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList variant="line" className="border-b border-[var(--color-border)]">
          <TabsTrigger value="overview" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
            Overview
          </TabsTrigger>
          <TabsTrigger value="history" className="tap-target text-role-nav data-active:after:bg-[var(--color-accent)]">
            Metric History
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" data-testid="overview-panel" className="min-w-0 mt-[var(--spacing-lg)]">
          {renderOverviewContent()}
        </TabsContent>
        <TabsContent value="history" className="mt-[var(--spacing-lg)]">
          {/* Testid kept on this always-present wrapper — a test asserts it
              renders even before the artifact resolves. `MetricHistoryTab`
              mounts inside it only once a real artifact is available; the
              pending/error/empty states above already cover the Overview
              panel's equivalents, and the chart's own dynamic-import
              loading/error states are MetricHistoryTab's job, not this
              wrapper's. */}
          <div data-testid="metric-history-panel">
            {data !== undefined && !is404 && !error ? (
              <MetricHistoryTab artifact={data} metricHistory={live?.metricHistory} algorithmId={algorithm} season={year} />
            ) : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
