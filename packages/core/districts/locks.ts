/**
 * Pure district/champ lock math. No corpus import, no I/O. `floor(T) =
 * T.pointTotal` (worst case: T scores nothing more). `ceiling(R) =
 * R.pointTotal + R.maxRemaining`. `threatCount(T)` counts every other team
 * `R` with `ceiling(R) >= floor(T)` — `>=` not `>`, since a tie is settled
 * by a tiebreaker this model does not carry and must count as a possible
 * loss. `status(T) === "locked"` exactly when `threatCount(T) < slots`.
 *
 * Every team's own ceiling is always `>= its own floor`, so `threatCount(T)`
 * is `(count of all teams with ceiling >= floor(T)) - 1`, computable by one
 * binary search into a single sorted-ceilings array shared by every team
 * rather than a quadratic pairwise scan. The symmetric fact holds for
 * elimination against a shared sorted-floors array. Both are O(log n) per
 * team after one O(n log n) sort, so the whole district resolves in
 * O(n log n).
 */

export interface LockTeamInput {
  readonly teamKey: string;
  readonly pointTotal: number;
  readonly maxRemaining: number;
}

/**
 * `"lockedAward"` and `"prequalified"` join the four base statuses:
 * `"lockedAward"` is a team the points math alone would not yet guarantee,
 * but an award already does (a team can be both; the award is still what's
 * cited). `"prequalified"` is a Championship-only curated pre-qualification
 * (Hall of Fame, prior-year Championship results) that needs no points at
 * all and is never removed from anyone's `slots` allocation.
 */
export type LockStatus = "locked" | "lockedAward" | "prequalified" | "eliminated" | "contending" | "unknown";

export interface LockResult {
  readonly teamKey: string;
  readonly status: LockStatus;
  /**
   * The smallest non-negative integer of additional points that would make
   * this team locked. `0` when already locked. `null` when even scoring
   * every remaining point (`maxRemaining`) would not be enough -- "not
   * attainable this season" -- and also `null` for every team when `slots`
   * is `null` (capacity not published).
   */
  readonly pointsToLock: number | null;
  /** The number of OTHER teams whose ceiling meets or exceeds this team's floor -- exposed for the UI's cut-line/threat display. */
  readonly threatCount: number;
}

/** First index in `sortedAsc` whose value is `>= x` (a standard binary-search lower bound). Returns `sortedAsc.length` when every value is `< x`. */
function lowerBound(sortedAsc: readonly number[], x: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedAsc[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index in `sortedAsc` whose value is `> x` (a standard binary-search upper bound). Returns `sortedAsc.length` when every value is `<= x`. */
function upperBound(sortedAsc: readonly number[], x: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedAsc[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Smallest `d` in `[0, maxRemaining]` such that `(n - lowerBound(sortedCeilings, floorT + d)) - 1 < slots`
 * (i.e. `T`'s own threatCount, recomputed at a hypothetical `floor(T) + d`,
 * drops below `slots`). `sortedCeilings` includes `T`'s own real ceiling
 * (unaffected by the hypothetical `d`, since `floorT + d <= ceiling(T)` for
 * every `d` in range) -- the same "-1 for self" trick applies throughout the
 * search range, not just at `d = 0`. Returns `null` when not even
 * `d = maxRemaining` achieves it.
 */
function findPointsToLock(sortedCeilings: readonly number[], n: number, floorT: number, maxRemaining: number, slots: number): number | null {
  const threatCountAt = (d: number): number => n - lowerBound(sortedCeilings, floorT + d) - 1;
  if (threatCountAt(maxRemaining) >= slots) return null;
  let lo = 0;
  let hi = maxRemaining;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (threatCountAt(mid) < slots) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Computes every team's district/champ lock verdict for one set of `slots`.
 * `slots: null` (TBA published no capacity) yields `status === "unknown"`
 * and `pointsToLock === null` for every team -- it never falls back to a
 * guessed capacity.
 */
export function computeLocks(teams: readonly LockTeamInput[], slots: number | null): LockResult[] {
  if (slots === null) {
    return teams.map((t) => ({ teamKey: t.teamKey, status: "unknown", pointsToLock: null, threatCount: 0 }));
  }

  const n = teams.length;
  const ceilings = teams.map((t) => t.pointTotal + t.maxRemaining);
  const floors = teams.map((t) => t.pointTotal);
  const sortedCeilings = [...ceilings].sort((a, b) => a - b);
  const sortedFloors = [...floors].sort((a, b) => a - b);

  return teams.map((team, index) => {
    const floorT = floors[index]!;
    const ceilingT = ceilings[index]!;

    const threatCount = n - lowerBound(sortedCeilings, floorT) - 1;
    const eliminationCount = n - upperBound(sortedFloors, ceilingT);

    let status: LockStatus;
    if (threatCount < slots) status = "locked";
    else if (eliminationCount >= slots) status = "eliminated";
    else status = "contending";

    const pointsToLock = status === "locked" ? 0 : findPointsToLock(sortedCeilings, n, floorT, team.maxRemaining, slots);

    return { teamKey: team.teamKey, status, pointsToLock, threatCount };
  });
}

/**
 * Award-qualified and pre-qualified team keys for one
 * `computeLocksWithQualifiers` call. `awardQualified` is a CONSUMING set:
 * each member reduces the pool's available `slots` by one and is itself
 * removed from the points-competing pool. `prequalified` is a
 * NON-CONSUMING set: each member is likewise removed from the pool but does
 * not reduce `slots`. The two sets are expected to be disjoint in practice
 * but this function does not enforce that — membership in either alone is
 * sufficient to report `"lockedAward"`/`"prequalified"`.
 */
export interface QualifierSets {
  readonly awardQualified: ReadonlySet<string>;
  readonly prequalified: ReadonlySet<string>;
}

/**
 * `computeLocks`'s award/pre-qualification-aware wrapper. Every team in
 * `qualifiers.prequalified` reports `"prequalified"`; every remaining team
 * in `qualifiers.awardQualified` reports `"lockedAward"` (a team that is
 * both award-qualified and points-safe still reports `"lockedAward"` — the
 * award is what guarantees it). Every other team runs through the ordinary
 * `computeLocks` pure points math, against a narrowed pool (both qualified
 * sets excluded) and a narrowed `slots` count. `slots: null` still yields
 * `"unknown"` for every points-competing team, but a prequalified/
 * award-qualified team's status is unaffected by an unpublished capacity.
 *
 * PROPERTY (locks.test.ts): adding an award qualifier to a district never
 * improves a non-qualified rival's status.
 */
/**
 * The narrowed pool/slot-count derivation shared by
 * `computeLocksWithQualifiers` and `cutLinePointsWithQualifiers`. Both
 * award-qualified and prequalified teams are removed from the pool; only
 * award-qualified (consuming) membership reduces `pointsSlots`, floored at
 * zero. Extracted so the verdicts and the published cut line can never
 * drift apart — a past bug let a published cut line name a team the
 * verdicts had already marked `"eliminated"`.
 */
function qualifierPool(teams: readonly LockTeamInput[], slots: number, qualifiers: QualifierSets): { pool: LockTeamInput[]; pointsSlots: number } {
  const awardQualifiedRankedCount = teams.filter((t) => qualifiers.awardQualified.has(t.teamKey)).length;
  const pointsSlots = Math.max(slots - awardQualifiedRankedCount, 0);
  const pool = teams.filter((t) => !qualifiers.awardQualified.has(t.teamKey) && !qualifiers.prequalified.has(t.teamKey));
  return { pool, pointsSlots };
}

export function computeLocksWithQualifiers(
  teams: readonly LockTeamInput[],
  slots: number | null,
  qualifiers: QualifierSets
): LockResult[] {
  const qualifiedResult = (teamKey: string, status: "lockedAward" | "prequalified"): LockResult => ({
    teamKey,
    status,
    pointsToLock: 0,
    threatCount: 0,
  });

  if (slots === null) {
    return teams.map((t) => {
      if (qualifiers.prequalified.has(t.teamKey)) return qualifiedResult(t.teamKey, "prequalified");
      if (qualifiers.awardQualified.has(t.teamKey)) return qualifiedResult(t.teamKey, "lockedAward");
      return { teamKey: t.teamKey, status: "unknown", pointsToLock: null, threatCount: 0 };
    });
  }

  const { pool, pointsSlots } = qualifierPool(teams, slots, qualifiers);
  const poolByTeam = new Map(computeLocks(pool, pointsSlots).map((r) => [r.teamKey, r] as const));

  return teams.map((t) => {
    if (qualifiers.prequalified.has(t.teamKey)) return qualifiedResult(t.teamKey, "prequalified");
    if (qualifiers.awardQualified.has(t.teamKey)) return qualifiedResult(t.teamKey, "lockedAward");
    return poolByTeam.get(t.teamKey)!;
  });
}

/**
 * The published cut line: the point total a points-competing team must
 * reach to be safe, sharing `qualifierPool`'s exact pool/slot derivation
 * with `computeLocksWithQualifiers` so the two can never disagree. Returns
 * `null` for a `null` `slots`, a `pointsSlots` of zero, or an empty pool.
 * Otherwise the pool is sorted descending by `pointTotal` and the value at
 * index `min(pointsSlots, pool.length) - 1` is returned, the same clamp
 * `computeLocks`'s own pointsSlots-sized cutoff implies.
 *
 * INVARIANT (locks.test.ts's seeded property test): for every non-null
 * result `c`, every `computeLocksWithQualifiers` result run against the
 * same inputs satisfies `pointTotal > c` implies not `"eliminated"`, and
 * `pointTotal < c` implies not `"locked"`.
 */
export function cutLinePointsWithQualifiers(teams: readonly LockTeamInput[], slots: number | null, qualifiers: QualifierSets): number | null {
  if (slots === null) return null;
  const { pool, pointsSlots } = qualifierPool(teams, slots, qualifiers);
  if (pointsSlots === 0 || pool.length === 0) return null;
  const sortedDesc = pool.map((t) => t.pointTotal).sort((a, b) => b - a);
  const idx = Math.min(pointsSlots, pool.length) - 1;
  return sortedDesc[idx]!;
}
