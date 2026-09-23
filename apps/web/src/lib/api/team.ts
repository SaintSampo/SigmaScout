/**
 * The team-season artifact fetcher: artifactKey -> fetch -> Zod parse ->
 * typed result. Mirrors `apps/web/src/lib/api/teams.ts` verbatim in shape
 * (06-PATTERNS.md) — only the schema/params/query-key differ, since the team
 * page needs one team's own season artifact rather than the whole season's
 * table.
 *
 * Import depth: identical to `teams.ts` — `apps/web/src/lib/api/` sits five
 * path segments below the repo root, and this file lives in the same
 * directory. No `@sigmascout/*` workspace alias exists anywhere in this repo
 * (06-PATTERNS.md), so this is a plain relative path with the explicit `.js`
 * extension.
 *
 * `teamKey` (the corpus's own `frc{number}` key) is a caller-supplied param,
 * not derived here — `apps/web/src/lib/teamKey.ts`'s `toTeamKey` is the one
 * place that conversion happens (06-RESEARCH.md Pitfall 4); this fetcher only
 * ever forwards whatever key it is given.
 */
import { artifactKey, TeamSeasonArtifactSchema, type TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { artifactUrl } from "../artifactOrigin.js";
import { markArtifactParsed } from "../perfMarks.js";
import { EVENT_POLL_INTERVAL_MS, shouldPollTeamArtifact } from "../liveEvent.js";
import type { Query } from "@tanstack/react-query";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

export interface FetchTeamArtifactParams {
  teamKey: string;
  year: number;
  algorithmId: string;
  version: string;
}

export async function fetchTeamArtifact({ teamKey, year, algorithmId, version }: FetchTeamArtifactParams): Promise<TeamSeasonArtifact> {
  const key = artifactKey({ page: "team", teamKey, year, algorithmId, version });
  const res = await fetch(artifactUrl(key));
  if (!res.ok) {
    throw new ArtifactFetchError("team", year, res.status);
  }
  const body: unknown = await res.json();
  try {
    const parsed = TeamSeasonArtifactSchema.parse(body);
    // 06-VALIDATION.md's parse-to-paint split, same convention as
    // `teams.ts`'s own `markArtifactParsed()` call — marked immediately
    // after the schema parse resolves, before returning.
    markArtifactParsed();
    return parsed;
  } catch (err) {
    throw new ArtifactValidationError("team", year, err);
  }
}

/**
 * While the team still has an unplayed row at an event whose schedule is
 * current, the query refetches every `EVENT_POLL_INTERVAL_MS` — the same
 * cadence and the same rule `eventQueryOptions` uses, because since quick task
 * 260923-3w7 this file is how the live Worker's writes reach the robot page.
 * Between 260917-jr4 and then the tick wrote no team artifact at all and the
 * page reconstructed its live rows from the event artifact's poll; there is
 * nothing to reconstruct now, so the poll belongs here.
 *
 * `refetchIntervalInBackground` is deliberately left unset (false): TanStack
 * fires an interval refetch only while the window is focused, so a hidden tab
 * stops polling and resumes when it is shown again.
 */
export function teamQueryOptions(params: FetchTeamArtifactParams) {
  return {
    queryKey: ["team", params.teamKey, params.year, params.algorithmId, params.version] as const,
    queryFn: () => fetchTeamArtifact(params),
    refetchInterval: (query: Query<TeamSeasonArtifact, Error, TeamSeasonArtifact, readonly ["team", string, number, string, string]>): number | false =>
      shouldPollTeamArtifact(query.state.data, Date.now()) ? EVENT_POLL_INTERVAL_MS : false,
  };
}
