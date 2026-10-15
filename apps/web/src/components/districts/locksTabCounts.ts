/**
 * The slot count each Locks tab prints beside its label (quick task
 * 261015-s1t, prototype 01 of the Locks tab sketch), and the rule that keeps
 * it equal to the Locked chip in the table under it.
 *
 * TWO SOURCES, IN ORDER:
 *
 * 1. THE MOUNTED LEDGER'S OWN COUNT. Each ledger reports the `locked` count
 *    its status chips print (`onLockedCount`), so the open tab always reads
 *    exactly what its table reads: the field view at Live, a rewound stop,
 *    the joint proof's extra locks on the champ tier, all of it, by
 *    construction rather than by a second computation.
 * 2. THE ARTIFACT, for the tab whose ledger is not mounted. The district
 *    tier applies the same championship field rule the District Locks table
 *    applies at Live (`championshipFieldLockedCount`), and otherwise counts
 *    the published verdicts: `locked` and `lockedAward` each hold a slot,
 *    `prequalified` never does (`packages/core/districts/locks.ts`: the
 *    slots are worked out after the prequalified teams are taken out).
 *
 * A report is keyed by the artifact it was computed from, so a report from
 * the previous district never prints over the next one while
 * `keepPreviousData` still shows the old rows.
 */
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { championshipFieldLockedCount } from "./districtFieldOverlay.js";
import { locksTabSlotsText } from "./districtLedgerCopy.js";

export type LocksTier = "district" | "champ";

/** What a mounted ledger reports: the Locked count its chips print, and the artifact it counted. */
export interface LocksTabLockedReport {
  readonly districtKey: string;
  readonly locked: number;
}

/** The route's memory of the latest report per tier, all for one artifact. */
export interface LocksTabReportedCounts {
  readonly districtKey?: string;
  readonly district?: number;
  readonly champ?: number;
}

export function mergeLocksTabReport(prev: LocksTabReportedCounts, tier: LocksTier, report: LocksTabLockedReport): LocksTabReportedCounts {
  const sameArtifact = prev.districtKey === report.districtKey;
  if (sameArtifact && prev[tier] === report.locked) return prev;
  const base: LocksTabReportedCounts = sameArtifact ? prev : { districtKey: report.districtKey };
  return { ...base, [tier]: report.locked };
}

function holdsSlot(status: DistrictArtifact["teams"][number]["districtLock"]["status"]): boolean {
  return status === "locked" || status === "lockedAward";
}

/** Source 2: the counts the artifact alone supports, used for a tab whose ledger has not reported. */
export function locksTabFallbackCounts(artifact: DistrictArtifact, nowYear?: number): { readonly district: number; readonly champ: number } {
  const district = championshipFieldLockedCount(artifact, nowYear) ?? artifact.teams.filter((team) => holdsSlot(team.districtLock.status)).length;
  const champ = artifact.teams.filter((team) => holdsSlot(team.champLock.status)).length;
  return { district, champ };
}

/**
 * The printed count. "N of M slots called" while the Locked count fits the
 * published capacity; a bare "N locked" where it does not (a championship
 * field larger than its slot count: 2026 FIM seated 161 teams for 160 slots)
 * or where no capacity is published.
 */
export function locksTabCountText(locked: number, slots: number | null): string {
  if (slots !== null && locked > slots) return locksTabSlotsText(locked, null);
  return locksTabSlotsText(locked, slots);
}

export function locksTabCounts(
  artifact: DistrictArtifact | undefined,
  reported: LocksTabReportedCounts,
  nowYear?: number
): { readonly district: string; readonly champ: string } | undefined {
  if (artifact === undefined) return undefined;
  const fallback = locksTabFallbackCounts(artifact, nowYear);
  const fromLedger = reported.districtKey === artifact.districtKey ? reported : {};
  return {
    district: locksTabCountText(fromLedger.district ?? fallback.district, artifact.dcmpSlots),
    champ: locksTabCountText(fromLedger.champ ?? fallback.champ, artifact.cmpSlots),
  };
}
