import { Link } from "@tanstack/react-router";
import type { TeamSearch } from "../../lib/searchParams.js";

/**
 * Shared shape both empty states take (06-01-PLAN.md Task 3). `nickname` is
 * the RAW published value (may be `""`) — both components fall back to
 * `Team {teamNumber}` themselves, matching `SeasonHeader`'s own fallback
 * rule, so a caller never has to pre-compute the fallback twice.
 */
export interface TeamStateProps {
  teamNumber: number;
  nickname: string;
  year: number;
  /** D-05's `activeYears` — `undefined` when unknown (e.g. the current year's fetch itself 404'd, so the team's active-year list was never learned this session; see 06-CONTEXT.md's D-05 bootstrap wrinkle) or empty. */
  activeYears?: readonly number[];
}

function displayNickname(nickname: string, teamNumber: number): string {
  return nickname === "" ? `Team ${teamNumber}` : nickname;
}

/**
 * D-19: a year the team's URL names but did not play. Keeps the page,
 * states the fact, and offers the team's active years as one-click links —
 * never a silent redirect. When `activeYears` is undefined or empty, the
 * chip row (and its "This team's active seasons:" label) is omitted
 * ENTIRELY rather than left dangling with nothing after it (E4 partial).
 */
export function YearMismatchEmptyState({ teamNumber, nickname, year, activeYears }: TeamStateProps) {
  const name = displayNickname(nickname, teamNumber);
  const hasActiveYears = activeYears !== undefined && activeYears.length > 0;

  return (
    <div className="flex flex-col items-center gap-[var(--spacing-sm)] px-[var(--spacing-lg)] py-[var(--spacing-2xl)] text-center">
      <p className="text-role-heading text-[var(--color-text-primary)]">{`${name} didn't compete in ${year}`}</p>
      {hasActiveYears && (
        <p className="text-role-body text-[var(--color-text-muted)]">
          {"This team's active seasons: "}
          <span className="inline-flex flex-wrap justify-center gap-[var(--spacing-sm)]">
            {activeYears.map((activeYear) => (
              <Link
                key={activeYear}
                to="/team/$teamNumber"
                from="/team/$teamNumber"
                params={{ teamNumber: String(teamNumber) }}
                search={(prev: TeamSearch) => ({ ...prev, year: activeYear })}
                className="text-[var(--color-accent)] underline-offset-2 hover:underline"
              >
                {activeYear}
              </Link>
            ))}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * E5 empty: a valid team-year whose artifact carries zero events — an
 * upstream data gap, deliberately distinct copy from D-19 above (that copy
 * would falsely assert the team didn't compete). No Retry: the fetch
 * succeeded, so retrying returns the same empty artifact.
 */
export function NoEventDataState({ teamNumber, nickname, year }: TeamStateProps) {
  const name = displayNickname(nickname, teamNumber);

  return (
    <div className="flex flex-col items-center gap-[var(--spacing-sm)] px-[var(--spacing-lg)] py-[var(--spacing-2xl)] text-center">
      <p className="text-role-heading text-[var(--color-text-primary)]">{`No event data for ${name} in ${year} yet.`}</p>
      <p className="text-role-body text-[var(--color-text-muted)]">This usually means results haven't published yet. Check back shortly.</p>
    </div>
  );
}
