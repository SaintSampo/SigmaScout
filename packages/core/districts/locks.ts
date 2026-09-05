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

/**
 * `"lockedAward"` and `"prequalified"` join the four base statuses (revision
 * R2a, `260905-lic-RESEARCH-awards.md` Q1/Q5): `"lockedAward"` is a team the
 * points math alone would not yet guarantee, but an award already does --
 * the award is what guarantees it, so it reports `"lockedAward"` rather than
 * `"locked"` even when it is ALSO points-safe (a team can be both; the
 * award is still what's cited). `"prequalified"` is a Championship-only
 * (never district/DCMP-tier) curated pre-qualification (Hall of Fame,
 * prior-year Championship results) that needs no points at all and is
 * never removed from anyone's `slots` allocation.
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
 * Award-qualified and pre-qualified team keys for one `computeLocksWithQualifiers`
 * call (revision R2a, research Q5's slot arithmetic). `awardQualified` is a
 * CONSUMING set: each member reduces the pool's available `slots` by one
 * (research: `points_slots = max(slots - |consuming award qualifiers ∩
 * ranked|, 0)`) AND is itself removed from the points-competing pool (it is
 * neither a threat to, nor threatened by, anyone else). `prequalified` is a
 * NON-CONSUMING set: each member is likewise removed from the pool, but does
 * NOT reduce `slots` -- research Q5: `HALL_OF_FAME`/`PRIOR_YEAR_CMP_*` both
 * carry `eats_district_slot: False`. The two sets are expected to be
 * disjoint in practice (a district-event award qualifier and a
 * Championship pre-qualification are different tiers' concepts) but this
 * function does not enforce that -- membership in EITHER set alone is
 * sufficient to report that team `"lockedAward"`/`"prequalified"`.
 */
export interface QualifierSets {
  readonly awardQualified: ReadonlySet<string>;
  readonly prequalified: ReadonlySet<string>;
}

/**
 * `computeLocks`'s award/pre-qualification-aware wrapper (revision R2a).
 * Every team in `qualifiers.prequalified` reports `"prequalified"`; every
 * remaining team in `qualifiers.awardQualified` reports `"lockedAward"` (a
 * team that is BOTH award-qualified and points-safe still reports
 * `"lockedAward"` -- the award is what guarantees it, research's own
 * framing). Every other team runs through the ordinary `computeLocks` pure
 * points math, but against a NARROWED pool (both qualified sets excluded)
 * and a NARROWED `slots` count (`slots` minus the number of ranked
 * award-qualified teams, floored at zero) -- research Q5's
 * `calculate_cutoffs`. `slots: null` still yields `"unknown"` for every
 * points-competing team, but a prequalified/award-qualified team's status is
 * unaffected by an unpublished capacity: the guarantee those two statuses
 * express does not come from the points-based slot count at all.
 *
 * PROPERTY (locks.test.ts): adding an award qualifier to a district never
 * IMPROVES a non-qualified rival's status -- removing one ranked team from
 * both the pool and the slot count is, at worst, a wash for everyone still
 * in the pool (one fewer competitor, but also one fewer slot to compete
 * for), and at best it is strictly worse for a rival whose own ceiling was
 * never actually threatened by the now-removed team in the first place.
 */
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

  const awardQualifiedRankedCount = teams.filter((t) => qualifiers.awardQualified.has(t.teamKey)).length;
  const pointsSlots = Math.max(slots - awardQualifiedRankedCount, 0);

  const pool = teams.filter((t) => !qualifiers.awardQualified.has(t.teamKey) && !qualifiers.prequalified.has(t.teamKey));
  const poolByTeam = new Map(computeLocks(pool, pointsSlots).map((r) => [r.teamKey, r] as const));

  return teams.map((t) => {
    if (qualifiers.prequalified.has(t.teamKey)) return qualifiedResult(t.teamKey, "prequalified");
    if (qualifiers.awardQualified.has(t.teamKey)) return qualifiedResult(t.teamKey, "lockedAward");
    return poolByTeam.get(t.teamKey)!;
  });
}
