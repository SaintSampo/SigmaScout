/**
 * The Districts page's Breakdown tab (must-have: "every source of district
 * points stays individually readable, never collapsed into an event total
 * alone"). A team's standing row (rank, total, rookie bonus, adjustments)
 * expands to a per-event table with qualification/alliance/playoff/award
 * points shown as four separate columns — the four components TBA reports
 * per event, verbatim, never summed into one number the reader cannot take
 * apart.
 *
 * Deliberately a plain table with expandable rows rather than the
 * algorithm-scoped `BreakdownTab.tsx`'s pivoted per-metric column matrix:
 * district data carries no tiers, no spreads and no algorithm dependency, so
 * there is nothing here that needs `@tanstack/react-table`'s column-pinning
 * machinery — a team's events vary in count and this data has no fixed
 * "metric key set" to build columns from the way `metricKeysFor` does.
 */
import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/StateViews";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { teamNumberFromKey } from "@/lib/teamKey";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

type DistrictTeam = DistrictArtifact["teams"][number];

const TIER_LABEL: Record<DistrictTeam["eventPoints"][number]["tier"], string> = {
  district: "District Event",
  dcmp: "District Championship",
};

function formatPoints(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export interface DistrictBreakdownTabProps {
  artifact: DistrictArtifact;
  algorithm: PublishedAlgorithmId;
  season: number;
}

export function DistrictBreakdownTab({ artifact, algorithm, season }: DistrictBreakdownTabProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if (artifact.teams.length === 0) {
    return (
      <EmptyState
        heading={`No teams for ${artifact.displayName}`}
        body={`No district ranking data found for ${artifact.displayName}. Check back later.`}
      />
    );
  }

  const teams = [...artifact.teams].sort((a, b) => a.rank - b.rank);

  function toggle(teamKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(teamKey)) {
        next.delete(teamKey);
      } else {
        next.add(teamKey);
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <div data-testid="district-breakdown-table-scroll" className="data-card w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rank</TableHead>
              <TableHead>Team #</TableHead>
              <TableHead>Team Name</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Rookie Bonus</TableHead>
              <TableHead>Adjustments</TableHead>
              <TableHead aria-hidden="true" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.map((team) => {
              const teamNumber = team.teamNumber ?? teamNumberFromKey(team.teamKey);
              const nickname = team.nickname ?? `Team ${teamNumber}`;
              const isExpanded = expanded.has(team.teamKey);
              return (
                <Fragment key={team.teamKey}>
                  <TableRow data-testid="district-breakdown-row" data-team-number={teamNumber}>
                    <TableCell className="numeric-cell">{team.rank}</TableCell>
                    <TableCell className="numeric-cell">
                      <Link to="/team/$teamNumber" params={{ teamNumber: String(teamNumber) }} search={{ year: season, algorithm, tab: "overview" }}>
                        {teamNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="truncate">{nickname}</TableCell>
                    <TableCell className="numeric-cell">{formatPoints(team.pointTotal)}</TableCell>
                    <TableCell className="numeric-cell">{formatPoints(team.rookieBonus)}</TableCell>
                    <TableCell className="numeric-cell">{formatPoints(team.adjustments)}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        data-testid={`district-breakdown-toggle-${team.teamKey}`}
                        aria-expanded={isExpanded}
                        onClick={() => toggle(team.teamKey)}
                        className="tap-target text-role-label whitespace-nowrap text-[var(--color-accent)]"
                      >
                        {isExpanded ? "Hide events ▾" : "Show events ▸"}
                      </button>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow data-testid={`district-breakdown-events-${team.teamKey}`}>
                      <TableCell colSpan={7} className="bg-[var(--color-bg-inset)] p-[var(--spacing-md)]">
                        {team.eventPoints.length === 0 ? (
                          <p className="text-role-body text-[var(--color-text-muted)]">No event points recorded yet.</p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Event</TableHead>
                                <TableHead>Tier</TableHead>
                                <TableHead>Qualification</TableHead>
                                <TableHead>Alliance Selection</TableHead>
                                <TableHead>Playoff Advancement</TableHead>
                                <TableHead>Award</TableHead>
                                <TableHead>Total</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {team.eventPoints.map((event) => (
                                <TableRow key={event.eventKey} data-testid="district-breakdown-event-row">
                                  <TableCell className="truncate">{event.eventName}</TableCell>
                                  <TableCell className="whitespace-nowrap">{TIER_LABEL[event.tier]}</TableCell>
                                  <TableCell className="numeric-cell">{formatPoints(event.qual)}</TableCell>
                                  <TableCell className="numeric-cell">{formatPoints(event.alliance)}</TableCell>
                                  <TableCell className="numeric-cell">{formatPoints(event.elim)}</TableCell>
                                  <TableCell className="numeric-cell">{formatPoints(event.award)}</TableCell>
                                  <TableCell className="numeric-cell">{formatPoints(event.total)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
