/**
 * The Districts page's CHAMP LOCKS tab — the FIRST Championship tier, and
 * since 2026-09-25 (quick task 260925-ots) that tier only.
 *
 * NARROWED FROM TWO TIERS TO ONE. This component used to take a
 * `which` ("district" or "champ") prop and serve both tabs. Phase 10 replaced
 * the District Locks tab with the Road to District Champs ledger
 * (`DistrictLedger.tsx`), so the `which="district"` arm lost its last
 * production call site. It is deleted rather than kept warm: an arm nothing
 * renders is an arm nothing checks, and a reader of this file should not have
 * to work out which half of every ternary is live. The champ output is
 * unchanged, test ids included.
 *
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
 * to the DCMP tier via each award's own `eventKey` cross-referenced against
 * the team's `eventPoints`/`remainingEvents` (see
 * `DistrictQualifyingAwardSchema`'s doc comment). No DCMP-tier award is
 * award-only, which is why nothing here annotates one — the "(award-only
 * invite)" annotation belonged to the deleted district arm.
 *
 * One header card (`LocksHeaderCard`): a single wrapping stat row reading
 * capacity, Lock Line, then a "Remaining district points: X / Y per team"
 * stat, computed client-side by `districtLocksHeaderStats.ts` (the published
 * artifact carries no dedicated aggregate field for it).
 *
 * Per-team district-points detail lives as COLUMNS behind a single expand
 * toggle, never as expandable rows. Toggled on, every default column above
 * stays exactly as it is; Rookie Bonus and Adjustments append as two more
 * columns, then every event the roster has ever played — the union across
 * BOTH tiers, in chronological (week) order — appends as a
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
import { computeChampLocksHeaderStats, type DistrictEventTier } from "./districtLocksHeaderStats.js";

type DistrictTeam = DistrictArtifact["teams"][number];
type LockVerdict = DistrictTeam["districtLock"];
type QualifyingAward = DistrictTeam["qualifyingAwards"][number];
type DistrictEventPoints = DistrictTeam["eventPoints"][number];

/** The capacity stat's noun. The tab serves the FIRST Championship tier and only that tier. */
const LOCK_KIND_LABEL = "FIRST Championship";

/** The tier `qualifyingAwards`/`eventPoints`/`remainingEvents` use here — see `DistrictQualifyingAwardSchema`'s own doc comment on why `eventKey` (not this component) is the source of truth for which tier an award belongs to. */
const LOCK_TIER: DistrictEventTier = "dcmp";

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

/** This tab's relevant subset of `team.qualifyingAwards` — filtered to `LOCK_TIER`. */
function awardsForTab(team: DistrictTeam): QualifyingAward[] {
  return team.qualifyingAwards.filter((award) => tierForEventKey(team, award.eventKey) === LOCK_TIER);
}

/** No "(award-only invite)" annotation: a DCMP-tier award is never award-only (see `DistrictQualifyingAwardSchema`), so there has never been one to print here. */
function AwardsCell({ awards }: { awards: QualifyingAward[] }) {
  if (awards.length === 0) return <>—</>;
  return (
    <>
      {awards.map((award, index) => (
        <span key={`${award.eventKey}-${award.awardType}`}>
          {index > 0 && ", "}
          {award.label}
        </span>
      ))}
    </>
  );
}

/**
 * The Locks page's ONE header card (quick task 260914-3zj) — a single
 * wrapping stat row: capacity, Lock Line, then this tab's own remaining
 * district points stat. The district tab's played/upcoming event chip row
 * lived in this card too until the district arm was deleted (260925-ots).
 */
function LocksHeaderCard({ artifact, slots, cutLine }: { artifact: DistrictArtifact; slots: number | null; cutLine: number | null }) {
  const champStats = computeChampLocksHeaderStats(artifact.teams, artifact.year);

  return (
    <div className="data-card flex flex-col gap-[var(--spacing-md)] p-[var(--spacing-md)]" data-testid="champ-locks-header-stats">
      <div className="flex flex-wrap items-center gap-[var(--spacing-lg)]" data-testid="champ-locks-header-stat-row">
        <div>
          <span className="text-role-label text-[var(--color-text-muted)]">{LOCK_KIND_LABEL} capacity</span>
          <p className="text-role-heading">{slots === null ? "Capacity not published" : `${slots} Teams`}</p>
        </div>
        <div>
          <span className="text-role-label text-[var(--color-text-muted)]">Lock Line</span>
          <p className="text-role-heading">{cutLine === null ? "—" : `${formatPoints(cutLine)} Points`}</p>
        </div>
        <div>
          <span className="text-role-label text-[var(--color-text-muted)]">Remaining district points</span>
          <p className="text-role-heading" data-testid="champ-locks-remaining-district-points">
            {champStats.seasonCeiling === null
              ? formatPoints(champStats.maxRemainingAcrossRoster)
              : `${formatPoints(champStats.maxRemainingAcrossRoster)} / ${formatPoints(champStats.seasonCeiling)} per team`}
          </p>
        </div>
      </div>
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
  algorithm: PublishedAlgorithmId;
  season: number;
}

export function DistrictLocksTab({ artifact, algorithm, season }: DistrictLocksTabProps) {
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

  const slots = artifact.cmpSlots;
  const cutLine = artifact.insights.cmpCutLinePoints;
  const teams = [...artifact.teams].sort((a, b) => a.rank - b.rank);
  const showEventColumns = columnsExpanded && allEvents.length > 0;

  return (
    <div className="flex flex-col gap-[var(--spacing-md)]" data-testid="district-champ-locks-tab">
      <LocksHeaderCard artifact={artifact} slots={slots} cutLine={cutLine} />
      <p className="text-role-body text-[var(--color-text-muted)]">{DISTRICT_LOCKS_CAVEAT}</p>
      <div className="flex justify-end">
        <button
          type="button"
          data-testid="district-champ-locks-column-toggle"
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
              <TableRow data-testid="district-champ-locks-event-band-row">
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
                    data-testid={`district-champ-locks-event-band-${event.eventKey}`}
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
              const verdict = team.champLock;
              const maxRemaining = team.maxRemainingChamp;
              const maxAttainable = team.pointTotal + maxRemaining;
              const chipClass = statusChipClass(verdict.status);
              return (
                <TableRow key={team.teamKey} data-testid="district-champ-lock-row" data-status={verdict.status}>
                  <TableCell className="numeric-cell">{team.rank}</TableCell>
                  <TableCell className="numeric-cell">
                    <Link to="/team/$teamNumber" params={{ teamNumber: String(teamNumber) }} search={{ year: season, algorithm, tab: "overview" }}>
                      {teamNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="truncate">{nickname}</TableCell>
                  <TableCell className="numeric-cell">{formatPoints(team.pointTotal)}</TableCell>
                  <TableCell className="numeric-cell">{formatPoints(maxAttainable)}</TableCell>
                  <TableCell data-testid="district-champ-lock-status" className="whitespace-nowrap">
                    {chipClass === undefined ? STATUS_LABEL[verdict.status] : <span className={chipClass}>{STATUS_LABEL[verdict.status]}</span>}
                  </TableCell>
                  <TableCell data-testid="district-champ-lock-awards" className="whitespace-nowrap">
                    <AwardsCell awards={awardsForTab(team)} />
                  </TableCell>
                  <TableCell data-testid="district-champ-lock-points-to-lock" className="whitespace-nowrap">
                    {formatPointsToLock(verdict)}
                  </TableCell>
                  {columnsExpanded && (
                    <>
                      <TableCell data-testid="district-champ-lock-rookie-bonus" className="numeric-cell">
                        {formatPoints(team.rookieBonus)}
                      </TableCell>
                      <TableCell data-testid="district-champ-lock-adjustments" className="numeric-cell">
                        {formatPoints(team.adjustments)}
                      </TableCell>
                      {showEventColumns &&
                        allEvents.flatMap((event) => {
                          const eventPoints = team.eventPoints.find((entry) => entry.eventKey === event.eventKey);
                          return [
                            <TableCell key={`${event.eventKey}-qual`} data-testid={`district-champ-lock-event-${event.eventKey}-qual`} className="numeric-cell">
                              <EventComponentCell eventPoints={eventPoints} component="qual" />
                            </TableCell>,
                            <TableCell key={`${event.eventKey}-alliance`} data-testid={`district-champ-lock-event-${event.eventKey}-alliance`} className="numeric-cell">
                              <EventComponentCell eventPoints={eventPoints} component="alliance" />
                            </TableCell>,
                            <TableCell key={`${event.eventKey}-elim`} data-testid={`district-champ-lock-event-${event.eventKey}-elim`} className="numeric-cell">
                              <EventComponentCell eventPoints={eventPoints} component="elim" />
                            </TableCell>,
                            <TableCell key={`${event.eventKey}-award`} data-testid={`district-champ-lock-event-${event.eventKey}-award`} className="numeric-cell">
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
