/**
 * The Districts page's Insights tab — deliberately lean, per this plan's own
 * deferral list: "capacity, cut lines, counts, lock/eliminated tallies and a
 * top-N table. No charts, no join against the algorithm-scoped team
 * metrics." This tab reads exclusively from `DistrictArtifact.insights`
 * (already computed by `scripts/publishDistricts.ts`) plus a top-N slice of
 * `artifact.teams` sorted by official rank — it does not recompute anything
 * a lock tab already owns.
 */
import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/StateViews";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { teamNumberFromKey } from "@/lib/teamKey";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

/** How many top-ranked teams the lean summary table shows — a fixed, small, readable slice, never the full roster (that is Breakdown's job). */
const TOP_TEAM_COUNT = 10;

function formatPoints(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatSlots(slots: number | null): string {
  return slots === null ? "Capacity not published" : String(slots);
}

function formatCutLine(points: number | null): string {
  return points === null ? "—" : formatPoints(points);
}

export interface DistrictInsightsTabProps {
  artifact: DistrictArtifact;
  algorithm: PublishedAlgorithmId;
  season: number;
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="data-card flex flex-col gap-[var(--spacing-xs)] p-[var(--spacing-md)]">
      <span className="text-role-label text-[var(--color-text-muted)]">{label}</span>
      <span className="text-role-heading">{value}</span>
    </div>
  );
}

export function DistrictInsightsTab({ artifact, algorithm, season }: DistrictInsightsTabProps) {
  if (artifact.teams.length === 0) {
    return (
      <EmptyState
        heading={`No teams for ${artifact.displayName}`}
        body={`No district ranking data found for ${artifact.displayName}. Check back later.`}
      />
    );
  }

  const { insights } = artifact;
  const topTeams = [...artifact.teams].sort((a, b) => a.rank - b.rank).slice(0, TOP_TEAM_COUNT);

  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      <div className="grid grid-cols-2 gap-[var(--spacing-md)] sm:grid-cols-4">
        <SummaryTile label="Teams" value={String(insights.teamCount)} />
        <SummaryTile label="Events" value={String(insights.eventCount)} />
        <SummaryTile label="District Championship capacity" value={formatSlots(artifact.dcmpSlots)} />
        <SummaryTile label="FIRST Championship capacity" value={formatSlots(artifact.cmpSlots)} />
        <SummaryTile label="District Championship cut line" value={formatCutLine(insights.dcmpCutLinePoints)} />
        <SummaryTile label="FIRST Championship cut line" value={formatCutLine(insights.cmpCutLinePoints)} />
        <SummaryTile label="District: locked / eliminated" value={`${insights.districtLockedCount} / ${insights.districtEliminatedCount}`} />
        <SummaryTile label="Championship: locked / eliminated" value={`${insights.champLockedCount} / ${insights.champEliminatedCount}`} />
      </div>
      <div className="data-card w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rank</TableHead>
              <TableHead>Team #</TableHead>
              <TableHead>Team Name</TableHead>
              <TableHead>Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topTeams.map((team) => {
              const teamNumber = team.teamNumber ?? teamNumberFromKey(team.teamKey);
              const nickname = team.nickname ?? `Team ${teamNumber}`;
              return (
                <TableRow key={team.teamKey} data-testid="district-insights-row">
                  <TableCell className="numeric-cell">{team.rank}</TableCell>
                  <TableCell className="numeric-cell">
                    <Link to="/team/$teamNumber" params={{ teamNumber: String(teamNumber) }} search={{ year: season, algorithm, tab: "overview" }}>
                      {teamNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="truncate">{nickname}</TableCell>
                  <TableCell className="numeric-cell">{formatPoints(team.pointTotal)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
