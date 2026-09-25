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
 *
 * RESERVED SLOTS (quick task 260925-ms7). One slot is HELD BACK for every
 * district-tier event whose consuming award has not been posted yet at the
 * position being evaluated:
 *
 *     pointsSlots = max(slots - awardQualifiedRankedCount, 0)      // unreserved
 *     lockSlots   = max(pointsSlots - reservedSlots, 0)            // reserved
 *
 * `lockSlots` decides `"locked"`; `pointsSlots` decides `"eliminated"` and
 * the published cut line. Without the reservation the lock test is briefly
 * one slot too generous and a team on the knife edge reports `"locked"` one
 * step before the award consumes the slot and eliminates it — measured 13
 * times over 921,658 team-positions by quick task 260925-ma5, every one at a
 * position where an event's playoffs were decided and its Impact award was
 * not. Applying the same reservation to the elimination test instead breaks
 * the opposite promise 551 times; `computeLocksSplit` states why in full.
 *
 * A posted award and a reservation never both count for the same event: the
 * caller reserves only for events whose award is NOT final at the position,
 * and `awardQualified` can only contain a team whose award IS.
 * `packages/core/districts/reservedSlots.ts` owns the counting rule; this file
 * owns nothing but the subtraction.
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
  return computeLocksSplit(teams, slots, slots);
}

/**
 * `computeLocks` with the two sides of the verdict asked against DIFFERENT
 * slot counts: `lockSlots` decides `"locked"` (and `pointsToLock`),
 * `eliminationSlots` decides `"eliminated"`. `computeLocks` passes the same
 * number twice, which is every caller except the reservation path.
 *
 * WHY THE TWO CAN DIFFER, and why the split is not a hedge. The two verdicts
 * are opposite guarantees and their worst cases point opposite ways. For
 * `"locked"` the worst case is that a pending Impact award goes to a team
 * that would NOT have qualified on points, so it takes a slot out of the
 * points race: the lock test must see the smaller, RESERVED count. For
 * `"eliminated"` the worst case is the mirror image -- the award goes to a
 * team ahead in the points race, which frees a slot below it -- so the
 * elimination test must see the UNRESERVED count. Reserving on both sides at
 * once double counts: it withholds the slot AND leaves the prospective winner
 * in the pool as a rival. Measured, not reasoned: applying the reservation to
 * the elimination side too turned quick task 260925-ma5's sweep from 0
 * tenet-B violations into 551 (teams told the slot was already gone that went
 * on to qualify on points).
 *
 * `lockSlots <= eliminationSlots` is required and always holds in practice
 * (the reservation only ever subtracts). It is also what keeps the two
 * branches mutually exclusive: `eliminationCount <= threatCount` always, so
 * `threatCount < lockSlots <= eliminationSlots` forces
 * `eliminationCount < eliminationSlots`.
 */
function computeLocksSplit(teams: readonly LockTeamInput[], lockSlots: number, eliminationSlots: number): LockResult[] {
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
    if (threatCount < lockSlots) status = "locked";
    else if (eliminationCount >= eliminationSlots) status = "eliminated";
    else status = "contending";

    const pointsToLock = status === "locked" ? 0 : findPointsToLock(sortedCeilings, n, floorT, team.maxRemaining, lockSlots);

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
 * `reservedSlots` DEFAULTS TO 0, which is exactly today's behaviour, so a
 * caller that has not yet worked out how many awards are still to come reads
 * the same verdicts it always did rather than a silently different set.
 *
 * PROPERTY (locks.test.ts): adding an award qualifier to a district never
 * improves a non-qualified rival's status.
 */
/**
 * The narrowed pool/slot-count derivation shared by
 * `computeLocksWithQualifiers` and `cutLinePointsWithQualifiers`. Both
 * award-qualified and prequalified teams are removed from the pool; only
 * award-qualified (consuming) membership reduces `pointsSlots`, floored at
 * zero. Extracted so the verdicts and the published cut line can never drift
 * apart — a past bug let a published cut line name a team the verdicts had
 * already marked `"eliminated"`.
 *
 * `pointsSlots` is the UNRESERVED count and is what both the elimination test
 * and the published cut line read. `lockSlots` subtracts `reservedSlots` on
 * top and is read by the `"locked"` test alone — see `computeLocksSplit` for
 * why the two sides differ, and the file header for what the reservation is.
 *
 * A NEGATIVE `reservedSlots` IS CLAMPED TO ZERO rather than widening the
 * pool. The only direction a bad argument could do real harm is the one that
 * publishes a guarantee that is not true, and this closes it.
 */
function qualifierPool(
  teams: readonly LockTeamInput[],
  slots: number,
  qualifiers: QualifierSets,
  reservedSlots: number
): { pool: LockTeamInput[]; pointsSlots: number; lockSlots: number } {
  const awardQualifiedRankedCount = teams.filter((t) => qualifiers.awardQualified.has(t.teamKey)).length;
  const pointsSlots = Math.max(slots - awardQualifiedRankedCount, 0);
  const lockSlots = Math.max(pointsSlots - Math.max(reservedSlots, 0), 0);
  const pool = teams.filter((t) => !qualifiers.awardQualified.has(t.teamKey) && !qualifiers.prequalified.has(t.teamKey));
  return { pool, pointsSlots, lockSlots };
}

export function computeLocksWithQualifiers(
  teams: readonly LockTeamInput[],
  slots: number | null,
  qualifiers: QualifierSets,
  reservedSlots = 0
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

  const { pool, pointsSlots, lockSlots } = qualifierPool(teams, slots, qualifiers, reservedSlots);
  const poolByTeam = new Map(computeLocksSplit(pool, lockSlots, pointsSlots).map((r) => [r.teamKey, r] as const));

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
 * IT READS THE UNRESERVED `pointsSlots`, deliberately, and takes no
 * `reservedSlots` argument. The reservation exists because a pending Impact
 * award may take a slot out of the points race; but the same pending award's
 * winner is still IN the pool at this position, competing, so subtracting the
 * slot without removing the rival would push the published line up twice for
 * one award. Holding the line at the unreserved count keeps it the best
 * available estimate of where the line finishes, and both invariants below
 * survive it: a stricter lock test only shrinks the locked set, and the
 * elimination test is the one this line is derived against.
 *
 * INVARIANT (locks.test.ts's seeded property test, run with and without a
 * reservation): for every non-null result `c`, every
 * `computeLocksWithQualifiers` result run against the same inputs satisfies
 * `pointTotal > c` implies not `"eliminated"`, and `pointTotal < c` implies
 * not `"locked"`.
 */
export function cutLinePointsWithQualifiers(teams: readonly LockTeamInput[], slots: number | null, qualifiers: QualifierSets): number | null {
  if (slots === null) return null;
  const { pool, pointsSlots } = qualifierPool(teams, slots, qualifiers, 0);
  if (pointsSlots === 0 || pool.length === 0) return null;
  const sortedDesc = pool.map((t) => t.pointTotal).sort((a, b) => b - a);
  const idx = Math.min(pointsSlots, pool.length) - 1;
  return sortedDesc[idx]!;
}
