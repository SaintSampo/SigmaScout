/**
 * The FIRST district point model's QUALIFICATION component: how many
 * district points a team earns for where it finished in an event's
 * qualification ranking.
 *
 * The formula is the Admin Manual's own (District Tournaments section): an
 * inverse-error-function curve on the team's rank and the event's field
 * size, scaled to 10 points and offset by 12, then rounded up. It is
 * reproduced here rather than re-derived — the three magic numbers below
 * (the 1.07 shape constant, the 10-point scale, the 12-point offset) are
 * the manual's, not this module's, and changing any of them is a change to
 * FIRST's published rules rather than a tuning knob.
 *
 * VERIFIED, not asserted: every district-tier `qual_points` value TBA has
 * ever reported in the ingested corpus equals this function's output
 * exactly — 29,796 of 29,796 rows across all ten registered seasons
 * (2016-2020, 2022-2026), zero mismatches, with only 75 unresolvable rows
 * (all in 2020, the truncated season, which carry no `event_rankings` row
 * at all). That measurement supersedes the narrower 20,389-of-20,389 over
 * six seasons quoted in `10-RESEARCH.md`. (10-01-PLAN.md's Fact 4 quotes
 * the total as 29,896; its own per-season figures, every one of which this
 * module reproduces exactly, sum to 29,796 — the total was an arithmetic
 * slip, not a missing population.) The proof is
 * `pointFormulas.reconciliation.test.ts`, which re-derives it from
 * `data/corpus.sqlite` on every run in a checkout that has the corpus.
 * `qualPoints.test.ts` is the pure-fixture half that CI actually executes,
 * because the reconciliation test skips wherever the corpus is absent — a
 * green skip proves nothing, so the unit tests are load-bearing.
 *
 * A browser-safe leaf module: its only import is the `./pointModel.js`
 * sibling, so no DOM and no Node built-in enters its graph and the Worker,
 * the Node pipeline and the browser bundle can all take it.
 *
 * NO DEPENDENCY WAS ADDED FOR `erfinv`. The repo has an `erf` in
 * `packages/core/algorithms/spr.ts`, but it is module-private and there is
 * no `erfinv` anywhere; per `10-RESEARCH.md`'s Package Legitimacy Audit the
 * answer is fifteen lines of hand-written Winitzki approximation, not a new
 * package in the browser bundle.
 */
import { maxEventPoints, type DistrictTier } from "./pointModel.js";

/**
 * Thrown by `erfinv` for an argument at or beyond magnitude 1, where
 * `ln(1 - x*x)` is undefined or infinite. Thrown rather than returning
 * `NaN`/`Infinity`: a silent non-finite here propagates through
 * `qualPoints` into a published district point value, which is the one
 * outcome this module exists to make impossible.
 */
export class ErfInvDomainError extends Error {
  constructor(x: number) {
    super(`qualPoints: erfinv is undefined at ${x} — its argument must satisfy |x| < 1, refusing to return a non-finite value`);
    this.name = "ErfInvDomainError";
  }
}

/**
 * Thrown by `qualPoints` for a rank/field-size pair that cannot describe a
 * real qualification ranking. Validate-before-compute, the same discipline
 * `rankSimulation.ts` applies to its pmfs: the failure mode being guarded
 * against is not a crash but a plausible-looking wrong point value.
 */
export class InvalidRankInputError extends Error {
  constructor(message: string) {
    super(`qualPoints: ${message}`);
    this.name = "InvalidRankInputError";
  }
}

/**
 * The inverse error function, via Winitzki's approximation with constant
 * `a = 0.147`. Odd by construction (the sign is factored out before the
 * radicals), exact at 0, and accurate to roughly 2e-3 absolute over the
 * open interval — which is far inside the `Math.ceil` rounding `qualPoints`
 * applies on top, and is why the reconciliation test finds zero mismatches
 * against TBA's own integers rather than off-by-one drift.
 */
export function erfinv(x: number): number {
  if (!Number.isFinite(x) || Math.abs(x) >= 1) throw new ErfInvDomainError(x);
  const a = 0.147;
  const ln1mx2 = Math.log(1 - x * x);
  const term1 = 2 / (Math.PI * a) + ln1mx2 / 2;
  const term2 = ln1mx2 / a;
  const sign = x < 0 ? -1 : 1;
  return sign * Math.sqrt(Math.sqrt(term1 * term1 - term2) - term1);
}

/** The manual's shape constant. Named so the formula below reads as the manual's, not as three unexplained literals. */
const SHAPE_CONSTANT = 1.07;
/** The manual's point scale: the spread between the offset and the top-of-field value. */
const POINT_SCALE = 10;
/** The manual's point offset: the value the curve is centred on. */
const POINT_OFFSET = 12;

/**
 * The base (regular district event, unweighted) qualification points for a
 * team that finished `rank` of `fieldSize` in qualification.
 *
 * Monotonically non-increasing in `rank` for a fixed `fieldSize`: rank 1 is
 * the field's top value (22, the ceiling `pointModel.ts` declares for this
 * component) and rank `fieldSize` its bottom.
 */
export function qualPoints(rank: number, fieldSize: number): number {
  if (!Number.isInteger(fieldSize)) throw new InvalidRankInputError(`fieldSize must be an integer, got ${fieldSize}`);
  if (fieldSize < 1) throw new InvalidRankInputError(`fieldSize must be at least 1, got ${fieldSize}`);
  if (!Number.isInteger(rank)) throw new InvalidRankInputError(`rank must be an integer, got ${rank}`);
  if (rank < 1) throw new InvalidRankInputError(`rank must be at least 1, got ${rank}`);
  if (rank > fieldSize) throw new InvalidRankInputError(`rank ${rank} exceeds fieldSize ${fieldSize}`);

  const val = (fieldSize - 2 * rank + 2) / (SHAPE_CONSTANT * fieldSize);
  return Math.ceil((erfinv(val) * POINT_SCALE) / erfinv(1 / SHAPE_CONSTANT) + POINT_OFFSET);
}

/**
 * The District Championship weight for `season`: 1 at the `"district"`
 * tier, and at `"dcmp"` the ratio of `pointModel.ts`'s two declared
 * qualification ceilings.
 *
 * DERIVED, never a literal 3. `pointModel.ts` keeps its own per-season
 * weight table module-private, so the ratio of its two public ceilings is
 * the only way to read that table without copying it — and an unregistered
 * season raises `UnknownDistrictSeasonError` for free rather than silently
 * weighting by a default.
 *
 * THIS IS THE ONE COPY OF THE DCMP WEIGHT IN PHASE 10.
 * `selectionPoints.ts` and `bracket.ts` both import this function rather
 * than re-deriving the ratio. It lives here rather than in
 * `pointModel.ts` deliberately: `pointModel.ts` is shipped code the
 * District and Champ Locks tabs already depend on, and this phase has no
 * reason to touch it. Do not "clean this up" by moving it — that creates a
 * third location for a number that must have exactly one.
 */
export function districtTierWeight(season: number, tier: DistrictTier): number {
  if (tier === "district") {
    // Called for its throw, not its value: an unregistered season must fail
    // here rather than silently returning a weight of 1.
    maxEventPoints(season, "district");
    return 1;
  }
  const dcmpQual = maxEventPoints(season, "dcmp").qual;
  const districtQual = maxEventPoints(season, "district").qual;
  return dcmpQual / districtQual;
}

/** `qualPoints` at the tier's weight — the value TBA reports as an `event_points_raw` entry's `qual_points`. */
export function districtQualPoints(season: number, tier: DistrictTier, rank: number, fieldSize: number): number {
  return qualPoints(rank, fieldSize) * districtTierWeight(season, tier);
}
