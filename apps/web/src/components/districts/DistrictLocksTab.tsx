/**
 * The Districts page's District-Locks/Champ-Locks tabs — ONE component,
 * taking `which` ("district" or "champ") as a prop, rendered by both tabs
 * (this plan's own instruction: "rendered by both the District Locks and
 * Champ Locks tabs"). Per team: current points, maximum still attainable,
 * status, and the page's actual question — points still needed to lock, or
 * an explicit "not attainable this season" when `pointsToLock` is `null`. A
 * `"unknown"` status (TBA published no capacity for this district-year)
 * renders as an honest "Capacity not published", never as a guessed number —
 * `packages/core/districts/locks.ts`'s own contract for `slots: null`.
 *
 * Status is rendered as plain text, not a colour-coded badge: this site's
 * one interactive accent (`--color-accent`) is reserved for interactive/
 * active elements only (sketch-findings-sigmascout's palette rule), and no
 * other semantic colour token exists for a three-way "good/neutral/bad"
 * verdict — plain, unambiguous wording is the plain-language-first choice
 * the sketch skill's calibration guidance already establishes for a
 * similarly load-bearing verdict.
 */
import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/StateViews";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { teamNumberFromKey } from "@/lib/teamKey";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

type DistrictTeam = DistrictArtifact["teams"][number];
type LockVerdict = DistrictTeam["districtLock"];

export type DistrictLockKind = "district" | "champ";

const LOCK_KIND_LABEL: Record<DistrictLockKind, string> = {
  district: "District Championship",
  champ: "FIRST Championship",
};

const STATUS_LABEL: Record<LockVerdict["status"], string> = {
  locked: "Locked",
  eliminated: "Eliminated",
  contending: "Contending",
  unknown: "Capacity not published",
};

/**
 * The conservatism caveat, plainly worded (must-have: "a locked verdict is a
 * guarantee; a team that is not locked has not been eliminated, and declines
 * and wildcards can only ever help"), the exact rule
 * `packages/core/districts/locks.ts`'s own doc comments establish for why
 * declines/waitlist/wildcard movement are not modeled at all — that
 * omission only ever makes a `locked` verdict MORE conservative, never
 * wrong.
 */
export const DISTRICT_LOCKS_CAVEAT =
  "A locked verdict is a guarantee. A team that is not locked has not been eliminated — declines, waitlist movement and wildcard slots can only ever help a team's chances, never hurt them.";

function formatPoints(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Never returns a number for `"unknown"` or an unattainable `null` — those two cases each get their own honest, non-numeric string. */
function formatPointsToLock(verdict: LockVerdict): string {
  if (verdict.status === "unknown") return "—";
  if (verdict.status === "locked") return "0";
  if (verdict.pointsToLock === null) return "Not attainable this season";
  return `${formatPoints(verdict.pointsToLock)} more points`;
}

export interface DistrictLocksTabProps {
  artifact: DistrictArtifact;
  which: DistrictLockKind;
  algorithm: PublishedAlgorithmId;
  season: number;
}

export function DistrictLocksTab({ artifact, which, algorithm, season }: DistrictLocksTabProps) {
  if (artifact.teams.length === 0) {
    return (
      <EmptyState
        heading={`No teams for ${artifact.displayName}`}
        body={`No district ranking data found for ${artifact.displayName}. Check back later.`}
      />
    );
  }

  const slots = which === "district" ? artifact.dcmpSlots : artifact.cmpSlots;
  const cutLine = which === "district" ? artifact.insights.dcmpCutLinePoints : artifact.insights.cmpCutLinePoints;
  const teams = [...artifact.teams].sort((a, b) => a.rank - b.rank);

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]" data-testid={`district-${which}-locks-tab`}>
      <div className="data-card flex flex-wrap items-center gap-[var(--spacing-lg)] p-[var(--spacing-md)]">
        <div>
          <span className="text-role-label text-[var(--color-text-muted)]">{LOCK_KIND_LABEL[which]} capacity</span>
          <p className="text-role-heading">{slots === null ? "Capacity not published" : slots}</p>
        </div>
        <div>
          <span className="text-role-label text-[var(--color-text-muted)]">Current cut line</span>
          <p className="text-role-heading">{cutLine === null ? "—" : formatPoints(cutLine)}</p>
        </div>
      </div>
      <p className="text-role-body text-[var(--color-text-muted)]">{DISTRICT_LOCKS_CAVEAT}</p>
      <div className="data-card w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rank</TableHead>
              <TableHead>Team #</TableHead>
              <TableHead>Team Name</TableHead>
              <TableHead>Current Points</TableHead>
              <TableHead>Max Attainable</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Points Still Needed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.map((team) => {
              const teamNumber = team.teamNumber ?? teamNumberFromKey(team.teamKey);
              const nickname = team.nickname ?? `Team ${teamNumber}`;
              const verdict = which === "district" ? team.districtLock : team.champLock;
              const maxRemaining = which === "district" ? team.maxRemainingDistrict : team.maxRemainingChamp;
              const maxAttainable = team.pointTotal + maxRemaining;
              return (
                <TableRow key={team.teamKey} data-testid={`district-${which}-lock-row`} data-status={verdict.status}>
                  <TableCell className="numeric-cell">{team.rank}</TableCell>
                  <TableCell className="numeric-cell">
                    <Link to="/team/$teamNumber" params={{ teamNumber: String(teamNumber) }} search={{ year: season, algorithm, tab: "overview" }}>
                      {teamNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="truncate">{nickname}</TableCell>
                  <TableCell className="numeric-cell">{formatPoints(team.pointTotal)}</TableCell>
                  <TableCell className="numeric-cell">{formatPoints(maxAttainable)}</TableCell>
                  <TableCell data-testid={`district-${which}-lock-status`} className="whitespace-nowrap">
                    {STATUS_LABEL[verdict.status]}
                  </TableCell>
                  <TableCell data-testid={`district-${which}-lock-points-to-lock`} className="whitespace-nowrap">
                    {formatPointsToLock(verdict)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
