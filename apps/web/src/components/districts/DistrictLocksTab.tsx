/**
 * The Districts page's District-Locks/Champ-Locks tabs — ONE component,
 * taking `which` ("district" or "champ") as a prop, rendered by both tabs
 * (this plan's own instruction: "rendered by both the District Locks and
 * Champ Locks tabs"). Per team: current points, maximum still attainable,
 * status, the awards ("Sent by") sending it, and the page's actual
 * question — points still needed to lock, or an explicit "not attainable
 * this season"/allocation note. A `"unknown"` status (TBA published no
 * capacity for this district-year) renders as an honest "Capacity not
 * published", never as a guessed number — `packages/core/districts/locks.ts`'s
 * own contract for `slots: null`.
 *
 * Revision R2 (quick task 260905-lic, `260905-lic-RESEARCH-awards.md`) widens
 * this component three ways:
 *   - Status now renders as a COLOUR-CODED chip for four of the six
 *     verdicts, per the user's own explicit mapping: green = locked on
 *     district points, blue = locked by an award, red = eliminated, purple =
 *     prequalified. `contending`/`unknown` stay the ORIGINAL plain-text
 *     treatment — this site's one interactive accent is otherwise reserved
 *     for interactive/active elements only (sketch-findings-sigmascout's
 *     palette rule), and the user's mapping only names the four statuses
 *     above, so only those four break that reservation. The status WORD
 *     always stays visible alongside the colour — colour is never the only
 *     encoding.
 *   - An awards ("Sent by") column, from `team.qualifyingAwards`, filtered to
 *     THIS tab's tier via each award's own `eventKey` cross-referenced
 *     against the team's `eventPoints`/`remainingEvents` (the schema's own
 *     documented way to recover which tier an award recipiency belongs to —
 *     see `DistrictQualifyingAwardSchema`'s doc comment). District-tier
 *     award-only invites (Engineering Inspiration, Rookie All Star) are
 *     annotated "(award-only invite)"; DCMP-tier awards never carry that
 *     annotation (none are award-only at that tier).
 *   - A richer header: the District Locks tab additionally shows a per-team
 *     season ceiling, a played/upcoming event schedule strip, and a
 *     district-wide points pool (distributed, and an explicitly-marked "~"
 *     estimate for what remains); the Champ Locks tab shows a
 *     "Remaining district points: X / Y pre-DCMP" line. Both are computed
 *     client-side by `districtLocksHeaderStats.ts` — see that module's own
 *     doc comment for why (the published artifact carries no dedicated
 *     aggregate field for either).
 */
import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/StateViews";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { teamNumberFromKey } from "@/lib/teamKey";
import { cn } from "@/lib/utils";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { computeChampLocksHeaderStats, computeDistrictLocksHeaderStats, type DistrictEventTier } from "./districtLocksHeaderStats.js";

type DistrictTeam = DistrictArtifact["teams"][number];
type LockVerdict = DistrictTeam["districtLock"];
type QualifyingAward = DistrictTeam["qualifyingAwards"][number];

export type DistrictLockKind = "district" | "champ";

const LOCK_KIND_LABEL: Record<DistrictLockKind, string> = {
  district: "District Championship",
  champ: "FIRST Championship",
};

/** The tier `qualifyingAwards`/`eventPoints`/`remainingEvents` use for each tab — see `DistrictQualifyingAwardSchema`'s own doc comment on why `eventKey` (not this component) is the source of truth for which tier an award belongs to. */
const LOCK_KIND_TIER: Record<DistrictLockKind, DistrictEventTier> = {
  district: "district",
  champ: "dcmp",
};

const STATUS_LABEL: Record<LockVerdict["status"], string> = {
  locked: "Locked",
  lockedAward: "Locked (Award)",
  prequalified: "Prequalified",
  eliminated: "Eliminated",
  contending: "Contending",
  unknown: "Capacity not published",
};

/**
 * The four statuses the user's colour mapping names, and ONLY those four —
 * `contending`/`unknown` are deliberately absent, so `statusChipClass` below
 * falls through to the original plain-text render for them.
 */
const STATUS_CHIP_MODIFIER: Partial<Record<LockVerdict["status"], string>> = {
  locked: "lock-status-chip--locked",
  lockedAward: "lock-status-chip--locked-award",
  eliminated: "lock-status-chip--eliminated",
  prequalified: "lock-status-chip--prequalified",
};

function statusChipClass(status: LockVerdict["status"]): string | undefined {
  const modifier = STATUS_CHIP_MODIFIER[status];
  return modifier === undefined ? undefined : cn("lock-status-chip", modifier);
}

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

/**
 * Never returns a bare number for `"unknown"` or an unattainable `null` —
 * those two cases each get their own honest, non-numeric string.
 * `allocationNote` (revision R2a, the `2025fsc` special-allocation case)
 * takes precedence over every other case: when the pipeline has flagged a
 * district-year the ordinary model does not apply to at all, that honest
 * note is strictly more informative than any of this function's other
 * branches, unknown-capacity included.
 */
function formatPointsToLock(verdict: LockVerdict): string {
  if (verdict.allocationNote !== null) return verdict.allocationNote;
  if (verdict.status === "unknown") return "—";
  if (verdict.pointsToLock === null) return "Not attainable this season";
  return verdict.pointsToLock === 0 ? "0" : `${formatPoints(verdict.pointsToLock)} more points`;
}

/** Which tier (per `eventKey`) a team's own `eventPoints`/`remainingEvents` cross-reference reports — the schema's own documented way to recover an award recipiency's tier (`DistrictQualifyingAwardSchema`'s doc comment). `undefined` when neither array has a row for this `eventKey` (should not happen for a published award, but never assumed). */
function tierForEventKey(team: DistrictTeam, eventKey: string): DistrictEventTier | undefined {
  return team.eventPoints.find((event) => event.eventKey === eventKey)?.tier ?? team.remainingEvents.find((event) => event.eventKey === eventKey)?.tier;
}

/** This tab's relevant subset of `team.qualifyingAwards` — filtered to the tier `which` renders, per `LOCK_KIND_TIER`. */
function awardsForTab(team: DistrictTeam, which: DistrictLockKind): QualifyingAward[] {
  const tier = LOCK_KIND_TIER[which];
  return team.qualifyingAwards.filter((award) => tierForEventKey(team, award.eventKey) === tier);
}

function AwardsCell({ awards, which }: { awards: QualifyingAward[]; which: DistrictLockKind }) {
  if (awards.length === 0) return <>—</>;
  return (
    <>
      {awards.map((award, index) => (
        <span key={`${award.eventKey}-${award.awardType}`}>
          {index > 0 && ", "}
          {award.label}
          {/* Award-only invites (Engineering Inspiration, Rookie All Star at
              the district-event tier) never grant a play slot — only the
              District Locks tab's own tier ever carries one (schema doc
              comment on `DistrictQualifyingAwardSchema`: DCMP-tier awards
              are never award-only). */}
          {which === "district" && award.awardOnly && " (award-only invite)"}
        </span>
      ))}
    </>
  );
}

function DistrictScheduleStrip({ artifact }: { artifact: DistrictArtifact }) {
  const stats = computeDistrictLocksHeaderStats(artifact.teams, "district", artifact.year);

  return (
    <div className="data-card flex flex-col gap-[var(--spacing-md)] p-[var(--spacing-md)]" data-testid="district-locks-header-stats">
      <div className="flex flex-wrap items-center gap-[var(--spacing-lg)]">
        <div>
          <span className="text-role-label text-[var(--color-text-muted)]">Pre-DCMP points remaining</span>
          <p className="text-role-heading" data-testid="district-locks-ceiling">
            {stats.perTeamCeiling === null
              ? "Not yet known"
              : `${formatPoints(stats.maxRemainingAcrossRoster)} / ${formatPoints(stats.perTeamCeiling)} per team`}
          </p>
        </div>
        <div>
          <span className="text-role-label text-[var(--color-text-muted)]">District points distributed</span>
          <p className="text-role-heading" data-testid="district-locks-distributed">
            {formatPoints(Math.round(stats.pointsPool.distributed))}
          </p>
        </div>
        <div>
          <span className="text-role-label text-[var(--color-text-muted)]">Still to be distributed (est.)</span>
          <p className="text-role-heading" data-testid="district-locks-remaining-estimate">
            ~{formatPoints(Math.round(stats.pointsPool.remainingEstimate))}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-[var(--spacing-sm)]" data-testid="district-locks-schedule-strip">
        {stats.schedule.map((event) => (
          <span
            key={event.eventKey}
            data-testid="district-locks-schedule-event"
            data-played={event.played}
            className="event-chip event-chip--week"
          >
            {event.eventName} — {event.played ? "Played" : "Upcoming"}
            {event.maxPoints !== null && ` (${formatPoints(event.maxPoints)} max)`}
          </span>
        ))}
      </div>
    </div>
  );
}

function ChampRemainingDistrictPoints({ artifact }: { artifact: DistrictArtifact }) {
  const stats = computeChampLocksHeaderStats(artifact.teams, artifact.year);

  return (
    <div className="data-card flex items-center gap-[var(--spacing-lg)] p-[var(--spacing-md)]" data-testid="champ-locks-header-stats">
      <div>
        <span className="text-role-label text-[var(--color-text-muted)]">Remaining district points</span>
        <p className="text-role-heading" data-testid="champ-locks-remaining-district-points">
          {stats.preDcmpCeiling === null
            ? formatPoints(stats.maxRemainingAcrossRoster)
            : `${formatPoints(stats.maxRemainingAcrossRoster)} / ${formatPoints(stats.preDcmpCeiling)} pre-DCMP`}
        </p>
      </div>
    </div>
  );
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
      {which === "district" ? <DistrictScheduleStrip artifact={artifact} /> : <ChampRemainingDistrictPoints artifact={artifact} />}
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
              <TableHead>Sent by</TableHead>
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
              const chipClass = statusChipClass(verdict.status);
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
                    {chipClass === undefined ? STATUS_LABEL[verdict.status] : <span className={chipClass}>{STATUS_LABEL[verdict.status]}</span>}
                  </TableCell>
                  <TableCell data-testid={`district-${which}-lock-awards`} className="whitespace-nowrap">
                    <AwardsCell awards={awardsForTab(team, which)} which={which} />
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
