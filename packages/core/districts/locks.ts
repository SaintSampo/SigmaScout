/**
 * Pure district/champ lock math (quick task 260905-lic Task 2, `locks.test.ts`
 * written first). No corpus import, no I/O. `floor(T) = T.pointTotal` (the
 * worst case: T scores nothing more). `ceiling(R) = R.pointTotal +
 * R.maxRemaining`. `threatCount(T)` counts every OTHER team `R` with
 * `ceiling(R) >= floor(T)` -- the `>=` rule, not `>`: a tie is settled by a
 * tiebreaker this model does not carry, so a tie must count as a possible
 * loss. `status(T) === "locked"` exactly when `threatCount(T) < slots`.
 *
 * PERFORMANCE (must_haves: FiM ships ~500 teams, one sort plus a scan, not a
 * quadratic pairwise loop): every team's own ceiling is `>= its own floor`
 * (`maxRemaining >= 0`), so a team always counts itself among "teams whose
 * ceiling is >= this floor" -- which means `threatCount(T)` is exactly
 * `(count of ALL teams with ceiling >= floor(T)) - 1`, computable via one
 * binary search into a SINGLE sorted-ceilings array shared by every team,
 * rather than re-scanning the rival set per team. The symmetric fact holds
 * for elimination: a team's own floor is never `> its own ceiling`, so
 * `eliminationCount(T)` is exactly `count of ALL teams with floor >
 * ceiling(T)`, against one shared sorted-floors array. Both are O(log n) per
 * team after one O(n log n) sort, so the whole district resolves in
 * O(n log n).
 */

export interface LockTeamInput {
  readonly teamKey: string;
  readonly pointTotal: number;
  readonly maxRemaining: number;
}

export type LockStatus = "locked" | "eliminated" | "contending" | "unknown";

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
