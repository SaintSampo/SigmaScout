/**
 * The Districts page's District-Locks/Champ-Locks tabs — ONE component,
 * taking `which` ("district" or "champ") as a prop, rendered by both tabs.
 * Per team: current points, maximum still attainable, status, the awards
 * ("Sent by") sending it, and points still needed to lock, or an explicit
 * "not attainable this season"/allocation note. A `"unknown"` status (TBA
 * published no capacity for this district-year) renders as an honest
 * "Capacity not published", never as a guessed number —
 * `packages/core/districts/locks.ts`'s own contract for `slots: null`.
 *
 * Status renders as a COLOUR-CODED chip for four of the six verdicts: green
 * = locked on district points, blue = locked by an award, red = eliminated,
 * purple = prequalified. `contending`/`unknown` stay the ORIGINAL
 * plain-text treatment — this site's one interactive accent is otherwise
 * reserved for interactive/active elements only. The status WORD always
 * stays visible alongside the colour — colour is never the only encoding.
 *
 * An awards ("Sent by") column, from `team.qualifyingAwards`, is filtered
 * to THIS tab's tier via each award's own `eventKey` cross-referenced
 * against the team's `eventPoints`/`remainingEvents` (see
 * `DistrictQualifyingAwardSchema`'s doc comment). District-tier award-only
 * invites (Engineering Inspiration, Rookie All Star) are annotated
 * "(award-only invite)"; DCMP-tier awards never carry that annotation.
 *
 * A richer header: the District Locks tab additionally shows a per-team
 * season ceiling, a played/upcoming event schedule strip, and a
 * district-wide points pool (distributed, and an explicitly-marked "~"
 * estimate for what remains); the Champ Locks tab shows a "Remaining
 * district points: X / Y pre-DCMP" line. Both are computed client-side by
 * `districtLocksHeaderStats.ts` (the published artifact carries no
 * dedicated aggregate field for either).
 *
 * Per-team district-points detail lives as COLUMNS behind a single expand
 * toggle, never as expandable rows. Toggled on, every default column above
 * stays exactly as it is; Rookie Bonus and Adjustments append as two more
 * columns, then every event either tab's roster has ever played — the union
 * across BOTH tiers, in chronological (week) order — appends as a
 * four-column band (Qualification, Alliance Selection, Playoff Advancement,
 * Award) grouped under an event-name header, mirroring
 * `event/BreakdownTab.tsx`'s own group-band pattern. A team that did not
 * play a given event renders an honest em-dash across that event's four
 * cells, never a fabricated zero.
 */
import { useMemo, useState } from "react";
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
type DistrictEventPoints = DistrictTeam["eventPoints"][number];

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

/** The expanded event-columns band's tooltip label per tier. */
const EVENT_TIER_LABEL: Record<DistrictEventPoints["tier"], string> = {
  district: "District Event",
  dcmp: "District Championship",
};

const STATUS_LABEL: Record<LockVerdict["status"], string> = {
  locked: "Locked",
  lockedAward: "Locked (Award)",
  prequalified: "Prequalified",
  eliminated: "Out of range",
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
 * The conservatism caveat: declines/waitlist/wildcard movement are not
 * modeled at all (`packages/core/districts/locks.ts`), and that omission
 * only ever makes a `locked` verdict MORE conservative, never wrong.
 */
export const DISTRICT_LOCKS_CAVEAT =
  "A locked verdict is a guarantee. A team that is not locked has not been eliminated: declines, waitlist movement and wildcard slots can only ever help a team's chances, never hurt them.";

function formatPoints(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Never returns a bare number for `"unknown"` or an unattainable `null` —
 * those two cases each get their own honest, non-numeric string.
 * `allocationNote` (the `2025fsc` special-allocation case) takes precedence
 * over every other case: when the pipeline has flagged a district-year the
 * ordinary model does not apply to at all, that honest note is strictly
 * more informative than any of this function's other branches.
 */
function formatPointsToLock(verdict: LockVerdict): string {
  if (verdict.allocationNote !== null) return verdict.allocationNote;
  if (verdict.status === "unknown") return "—";
  if (verdict.pointsToLock === null) return "Not attainable this season";
  return verdict.pointsToLock === 0 ? "0" : `${formatPoints(verdict.pointsToLock)} more points`;
}

/** Which tier (per `eventKey`) a team's own `eventPoints`/`remainingEvents` cross-reference reports (see `DistrictQualifyingAwardSchema`'s doc comment). `undefined` when neither array has a row for this `eventKey`. */
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
          {/* Award-only invites never grant a play slot; DCMP-tier awards
              are never award-only (see `DistrictQualifyingAwardSchema`). */}
          {which === "district" && award.awardOnly && " (award-only invite)"}
        </span>
      ))}
    </>
  );
}

/**
 * The Locks page's ONE header card per tab (quick task 260914-3zj) — a
 * single wrapping stat row (capacity, Lock Line, then the tab's own stats),
 * and on the district tab the played/upcoming event chip row below that
 * stat row, inside the same card. Content is unchanged from the former
 * two-card layout; only the nesting merged.
 */
function LocksHeaderCard({ artifact, which, slots, cutLine }: { artifact: DistrictArtifact; which: DistrictLockKind; slots: number | null; cutLine: number | null }) {
  const districtStats = which === "district" ? computeDistrictLocksHeaderStats(artifact.teams, "district", artifact.year) : null;
  const champStats = which === "champ" ? computeChampLocksHeaderStats(artifact.teams, artifact.year) : null;
  // Rounded separately so the two displayed numbers always add up.
  const availablePoints = districtStats === null ? null : Math.round(districtStats.pointsPool.remainingEstimate);
  const totalPoints = districtStats === null || availablePoints === null ? null : Math.round(districtStats.pointsPool.distributed) + availablePoints;

  return (
    <div className="data-card flex flex-col gap-[var(--spacing-md)] p-[var(--spacing-md)]" data-testid={`${which}-locks-header-stats`}>
      <div className="flex flex-wrap items-center gap-[var(--spacing-lg)]" data-testid={`${which}-locks-header-stat-row`}>
        <div>
          <span className="text-role-label text-[var(--color-text-muted)]">{LOCK_KIND_LABEL[which]} capacity</span>
          <p className="text-role-heading">{slots === null ? "Capacity not published" : `${slots} Teams`}</p>
        </div>
        <div>
          <span className="text-role-label text-[var(--color-text-muted)]">Lock Line</span>
          <p className="text-role-heading">{cutLine === null ? "—" : `${formatPoints(cutLine)} Points`}</p>
        </div>
        {districtStats !== null && (
          <>
            <div>
              <span className="text-role-label text-[var(--color-text-muted)]">Pre-DCMP points remaining</span>
              <p className="text-role-heading" data-testid="district-locks-ceiling">
                {districtStats.perTeamCeiling === null
                  ? "Not yet known"
                  : `${formatPoints(districtStats.maxRemainingAcrossRoster)} / ${formatPoints(districtStats.perTeamCeiling)} per team`}
              </p>
            </div>
            <div>
              <span className="text-role-label text-[var(--color-text-muted)]">District Points (Available/Total)</span>
              <p className="text-role-heading" data-testid="district-locks-points-pool">
                {formatPoints(availablePoints ?? 0)}/{formatPoints(totalPoints ?? 0)}
              </p>
            </div>
          </>
        )}
        {champStats !== null && (
          <div>
            <span className="text-role-label text-[var(--color-text-muted)]">Remaining district points</span>
            <p className="text-role-heading" data-testid="champ-locks-remaining-district-points">
              {champStats.preDcmpCeiling === null
                ? formatPoints(champStats.maxRemainingAcrossRoster)
                : `${formatPoints(champStats.maxRemainingAcrossRoster)} / ${formatPoints(champStats.preDcmpCeiling)} pre-DCMP`}
            </p>
          </div>
        )}
      </div>
      {districtStats !== null && (
        <div className="flex flex-wrap gap-[var(--spacing-sm)]" data-testid="district-locks-schedule-strip">
          {districtStats.schedule.map((event) => (
            <span
              key={event.eventKey}
              data-testid="district-locks-schedule-event"
              data-played={event.played}
              className="event-chip event-chip--week"
            >
              {event.eventName}: {event.played ? "Played" : "Upcoming"}
              {event.maxPoints !== null && ` (${formatPoints(event.maxPoints)} max)`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** One event column-band spec — the union of every event any roster team's `eventPoints` names, deduplicated by `eventKey`. */
interface DistrictEventColumn {
  eventKey: string;
  eventName: string;
  tier: DistrictEventPoints["tier"];
  week: number | null;
}

/**
 * Every distinct event across the WHOLE roster's `eventPoints` (both
 * tiers), in chronological (week) order — unknown week sorts last, then by
 * event name for a stable tie-break.
 */
function collectAllEvents(teams: readonly DistrictTeam[]): DistrictEventColumn[] {
  const byKey = new Map<string, DistrictEventColumn>();
  for (const team of teams) {
    for (const eventPoint of team.eventPoints) {
      if (!byKey.has(eventPoint.eventKey)) {
        byKey.set(eventPoint.eventKey, {
          eventKey: eventPoint.eventKey,
          eventName: eventPoint.eventName,
          tier: eventPoint.tier,
          week: eventPoint.week,
        });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.week !== b.week) {
      if (a.week === null) return 1;
      if (b.week === null) return -1;
      return a.week - b.week;
    }
    return a.eventName.localeCompare(b.eventName);
  });
}

/** One event-component cell — an honest em-dash when this team never played `event`, never a fabricated zero. */
function EventComponentCell({ eventPoints, component }: { eventPoints: DistrictEventPoints | undefined; component: "qual" | "alliance" | "elim" | "award" }) {
  if (eventPoints === undefined) return <>—</>;
  return <>{formatPoints(eventPoints[component])}</>;
}

export interface DistrictLocksTabProps {
  artifact: DistrictArtifact;
  which: DistrictLockKind;
  algorithm: PublishedAlgorithmId;
  season: number;
}

export function DistrictLocksTab({ artifact, which, algorithm, season }: DistrictLocksTabProps) {
  const [columnsExpanded, setColumnsExpanded] = useState(false);
  const allEvents = useMemo(() => collectAllEvents(artifact.teams), [artifact.teams]);

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
  const showEventColumns = columnsExpanded && allEvents.length > 0;

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]" data-testid={`district-${which}-locks-tab`}>
      <LocksHeaderCard artifact={artifact} which={which} slots={slots} cutLine={cutLine} />
      <p className="text-role-body text-[var(--color-text-muted)]">{DISTRICT_LOCKS_CAVEAT}</p>
      <div className="flex justify-end">
        <button
          type="button"
          data-testid={`district-${which}-locks-column-toggle`}
          aria-expanded={columnsExpanded}
          onClick={() => setColumnsExpanded((prev) => !prev)}
          className="text-role-label rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-[var(--spacing-sm)] py-[var(--spacing-xs)] text-[var(--color-accent)] hover:bg-[var(--color-bg-inset)]"
        >
          {columnsExpanded ? "◂ Fewer columns" : "Per-event columns ▸"}
        </button>
      </div>
      <div className="data-card w-full min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <Table>
          <TableHeader>
            {showEventColumns && (
              <TableRow data-testid={`district-${which}-locks-event-band-row`}>
                {/* The 8 default columns carry no band of their own — a
                    single spanning spacer, aria-hidden, matching
                    `event/BreakdownTab.tsx`'s own group-band spacer
                    treatment for its pinned identity columns. */}
                <TableHead aria-hidden="true" colSpan={8} className="h-auto py-1" />
                {/* Rookie Bonus / Adjustments are standalone columns, not a
                    group — an aria-hidden spacer, no band label. */}
                <TableHead aria-hidden="true" colSpan={2} className="h-auto py-1" />
                {allEvents.map((event) => (
                  <TableHead
                    key={event.eventKey}
                    data-testid={`district-${which}-locks-event-band-${event.eventKey}`}
                    colSpan={4}
                    title={EVENT_TIER_LABEL[event.tier]}
                    className="h-auto truncate py-1 text-center"
                  >
                    {event.eventName}
                  </TableHead>
                ))}
              </TableRow>
            )}
            <TableRow>
              <TableHead>Rank</TableHead>
              <TableHead>Team #</TableHead>
              <TableHead>Team Name</TableHead>
              <TableHead>Current Points</TableHead>
              <TableHead>Max Attainable</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent by</TableHead>
              <TableHead>Points Still Needed</TableHead>
              {columnsExpanded && (
                <>
                  <TableHead>Rookie Bonus</TableHead>
                  <TableHead>Adjustments</TableHead>
                  {showEventColumns &&
                    allEvents.flatMap((event) => [
                      <TableHead key={`${event.eventKey}-qual`}>Qualification</TableHead>,
                      <TableHead key={`${event.eventKey}-alliance`}>Alliance Selection</TableHead>,
                      <TableHead key={`${event.eventKey}-elim`}>Playoff Advancement</TableHead>,
                      <TableHead key={`${event.eventKey}-award`}>Award</TableHead>,
                    ])}
                </>
              )}
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
                  {columnsExpanded && (
                    <>
                      <TableCell data-testid={`district-${which}-lock-rookie-bonus`} className="numeric-cell">
                        {formatPoints(team.rookieBonus)}
                      </TableCell>
                      <TableCell data-testid={`district-${which}-lock-adjustments`} className="numeric-cell">
                        {formatPoints(team.adjustments)}
                      </TableCell>
                      {showEventColumns &&
                        allEvents.flatMap((event) => {
                          const eventPoints = team.eventPoints.find((entry) => entry.eventKey === event.eventKey);
                          return [
                            <TableCell key={`${event.eventKey}-qual`} data-testid={`district-${which}-lock-event-${event.eventKey}-qual`} className="numeric-cell">
                              <EventComponentCell eventPoints={eventPoints} component="qual" />
                            </TableCell>,
                            <TableCell key={`${event.eventKey}-alliance`} data-testid={`district-${which}-lock-event-${event.eventKey}-alliance`} className="numeric-cell">
                              <EventComponentCell eventPoints={eventPoints} component="alliance" />
                            </TableCell>,
                            <TableCell key={`${event.eventKey}-elim`} data-testid={`district-${which}-lock-event-${event.eventKey}-elim`} className="numeric-cell">
                              <EventComponentCell eventPoints={eventPoints} component="elim" />
                            </TableCell>,
                            <TableCell key={`${event.eventKey}-award`} data-testid={`district-${which}-lock-event-${event.eventKey}-award`} className="numeric-cell">
                              <EventComponentCell eventPoints={eventPoints} component="award" />
                            </TableCell>,
                          ];
                        })}
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
