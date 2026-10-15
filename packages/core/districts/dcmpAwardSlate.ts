/**
 * THE DCMP AWARD SLATE (quick task 261014-i8i, generalised by 261014-qje): what
 * is DCMP specific about how a District Championship tier event prices its
 * awards. Everything shared with the district tier (the slots, the declared
 * season lists, the measured tables, the water fill, the assignments, the
 * odds) lives in `awardSlate.ts`, the one award model (Q-01).
 *
 * ---------------------------------------------------------------------------
 * THE ROLES
 * ---------------------------------------------------------------------------
 *
 *  - `single`: a championship played as one event gives the qualifying awards
 *    (Impact, Engineering Inspiration, Rookie All Star) AND the 5 point awards;
 *  - `division`: a division gives 5 point awards ONLY;
 *  - `finals`: a divisioned championship's finals gives the qualifying awards
 *    ONLY; its 5 point counts are its own measured counts, which are 0;
 *  - `wholeChampionship`: the generated simulated DCMP bake that stands for a
 *    whole championship: the qualifying awards at the district's full share,
 *    plus the 5 point counts of each of the district's single or division
 *    keys (a single's when there are none).
 *
 * HOW MANY. The qualifying counts are the mean of `dcmpAwardCountDistribution`
 * (the champ draws' own count model) times the event's share: 1 over the
 * number of the district's championships for `single` and `finals`, 0 for a
 * `division`, 1 for `wholeChampionship`, unchanged from 261014-i8i so the DCMP
 * row and Champ Locks agree. The `judgedRookie` and `judged` counts are the sum
 * of the priced season's declared 5 point types' measured DCMP tier counts at
 * the role (Q-04): a type's mean distinct winners per event in the most recent
 * earlier season declaring it that holds that role (`role`), else the pooled
 * single plus division events of the most recent earlier season holding
 * either (`pooled`), else the new award prior (`new-award`, Q-10).
 *
 * WHO. Eligibility for the qualifying awards is `dcmpAwardEligibility`'s rule,
 * within each award's audience; the 5 point slots are open to their audience.
 * The chances come from `slateAssignments` (Q-08).
 *
 * NO AWARD PREDICTION REACHES `locks.ts`. A source test pins that this module
 * imports nothing from it: the slate prices cells only.
 */
import {
  awardSlateTables,
  declaredSlotCounts,
  MissingSlateProfileError,
  slateAwardOutcomeOdds,
  UnknownAwardSlateSeasonError,
  waterFill,
  weakestRule,
  DCMP_TIER_AWARD_SLATE_SEASONS,
  type AwardSlateExpected,
  type AwardSlateInput,
  type AwardSlateRole,
  type SlateAssignment,
  type SlateCountRule,
  type SlateEligibility,
} from "./awardSlate.js";
import { dcmpEligibilityChance, type DcmpAwardEligibility } from "./dcmpAwardEligibility.js";
import { champCutoffTuning, dcmpAwardCountDistribution, dcmpAwardCounts, type ChampCutoffSetting } from "./hypotheticalDcmp.js";

// Re exports, so every importer of the 261014-i8i module compiles unchanged (Q-01).
export { MissingSlateProfileError, slateAwardOutcomeOdds, waterFill };
/** The DCMP tier's registered seasons, from the one model's table keys. */
export const DCMP_AWARD_SLATE_SEASONS: readonly number[] = DCMP_TIER_AWARD_SLATE_SEASONS;
/** The one model's unregistered season error; the web's `instanceof` catches keep working. */
export const UnknownDcmpAwardSlateSeasonError = UnknownAwardSlateSeasonError;
export type UnknownDcmpAwardSlateSeasonError = UnknownAwardSlateSeasonError;
/** A DCMP tier event's slate is the one model's slate with a DCMP role. */
export type DcmpAwardSlateInput = AwardSlateInput;
export type DcmpSlateAssignment = SlateAssignment;
export type DcmpSlateEligibility = SlateEligibility;

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** What one DCMP tier event gives. See the module header. */
export type DcmpSlateRole = Exclude<AwardSlateRole, "district">;

/** The role a real DCMP tier key can take. */
export type DcmpEventRole = Exclude<DcmpSlateRole, "wholeChampionship">;

/**
 * Each key's role by KEY STRUCTURE, within one district's DCMP tier keys: a
 * DIVISION is another key in the set plus digits (`2024micmp1` of
 * `2024micmp`); a FINALS key has a division child in the set; anything else is
 * a SINGLE championship. The measurement script asserts this equals TBA's
 * event_type rule for every DCMP tier event in the corpus.
 */
export function dcmpEventRoles(keys: readonly string[]): Map<string, DcmpEventRole> {
  const set = new Set(keys);
  const isChildOf = (child: string, parent: string): boolean =>
    child.length > parent.length && child.startsWith(parent) && /^\d+$/.test(child.slice(parent.length));
  const out = new Map<string, DcmpEventRole>();
  for (const key of keys) {
    if ([...set].some((other) => other !== key && isChildOf(key, other))) out.set(key, "division");
    else if ([...set].some((other) => other !== key && isChildOf(other, key))) out.set(key, "finals");
    else out.set(key, "single");
  }
  return out;
}

/** Thrown when a slate is asked for an event key that is not one of the district's DCMP tier keys. */
export class UnknownDcmpSlateTargetError extends Error {
  constructor(eventKey: string, keys: readonly string[]) {
    super(`dcmpAwardSlate: ${eventKey} is not one of the district's DCMP tier keys (${keys.join(", ") || "none"})`);
    this.name = "UnknownDcmpSlateTargetError";
  }
}

// ---------------------------------------------------------------------------
// The DCMP slate builder
// ---------------------------------------------------------------------------

export interface BuildDcmpAwardSlateInput {
  readonly season: number;
  readonly districtKey: string;
  /** TBA's published `cmpSlots`; the champ draws' own fallback is 0. */
  readonly cmpSlots: number;
  /** The district's DCMP tier event keys. */
  readonly dcmpEventKeys: readonly string[];
  readonly target: { readonly eventKey: string } | "wholeChampionship";
  /** `dcmpAwardEligibility`'s output at the position, the same the champ draws read. */
  readonly eligibility: DcmpAwardEligibility;
  /** The champ cutoff setting; the season's own walk forward selection when absent. */
  readonly setting?: ChampCutoffSetting;
}

function meanOf(weights: readonly number[]): number {
  let total = 0;
  let mass = 0;
  weights.forEach((weight, count) => {
    total += weight * count;
    mass += weight;
  });
  return mass > 0 ? total / mass : 0;
}

/** Builds one DCMP tier event's slate. See the module header for every rule. */
export function buildDcmpAwardSlate(input: BuildDcmpAwardSlateInput): AwardSlateInput {
  // The season must be registered at the DCMP tier: never a borrowed season.
  awardSlateTables(input.season, "dcmp");
  const roles = dcmpEventRoles(input.dcmpEventKeys);
  let role: DcmpSlateRole;
  if (input.target === "wholeChampionship") role = "wholeChampionship";
  else {
    const found = roles.get(input.target.eventKey);
    if (found === undefined) throw new UnknownDcmpSlateTargetError(input.target.eventKey, input.dcmpEventKeys);
    role = found;
  }

  const setting = input.setting ?? champCutoffTuning(input.season).setting;
  const distribution = dcmpAwardCountDistribution(input.season, input.districtKey, input.cmpSlots, setting.countMode);
  const championships = Math.max(1, [...roles.values()].filter((entry) => entry === "single" || entry === "finals").length);
  const share = role === "division" ? 0 : role === "wholeChampionship" ? 1 : 1 / championships;

  // THE 5 POINT COUNTS (Q-04): the declared types' measured DCMP tier counts
  // at each role this event stands for.
  const countRoles: DcmpEventRole[] =
    role === "wholeChampionship"
      ? (() => {
          const judgedKeys = [...roles.values()].filter((entry): entry is "single" | "division" => entry === "single" || entry === "division");
          return judgedKeys.length === 0 ? ["single"] : judgedKeys;
        })()
      : [role];
  let judgedRookie = 0;
  let judged = 0;
  const judgedRules: SlateCountRule[] = [];
  const newAwardTypes = new Set<number>();
  for (const countRole of countRoles) {
    const sums = declaredSlotCounts(input.season, "dcmp", countRole, { skipQualifying: true });
    judgedRookie += sums.expected.judgedRookie;
    judged += sums.expected.judged;
    judgedRules.push(...sums.judgedRules);
    for (const type of sums.newAwardTypes) newAwardTypes.add(type);
  }

  const teamKeys = new Set<string>();
  for (const entry of input.eligibility) {
    for (const candidate of entry.candidates) teamKeys.add(candidate.teamKey);
    for (const event of entry.pendingEvents) for (const entrant of event.entrants) teamKeys.add(entrant.teamKey);
  }
  const eligibility: SlateEligibility[] = [];
  for (const teamKey of [...teamKeys].sort()) {
    const chances = {
      teamKey,
      impact: dcmpEligibilityChance(input.eligibility, teamKey, 0),
      engineeringInspiration: dcmpEligibilityChance(input.eligibility, teamKey, 9),
      rookieAllStar: dcmpEligibilityChance(input.eligibility, teamKey, 10),
    };
    if (chances.impact > 0 || chances.engineeringInspiration > 0 || chances.rookieAllStar > 0) eligibility.push(chances);
  }

  const expected: AwardSlateExpected = {
    impact: meanOf(distribution[0]) * share,
    engineeringInspiration: meanOf(distribution[9]) * share,
    rookieAllStar: meanOf(distribution[10]) * share,
    judgedRookie,
    judged,
  };
  return {
    role,
    expected,
    sources: {
      counts: dcmpAwardCounts(input.season, input.districtKey, input.cmpSlots).source,
      judged: weakestRule(judgedRules),
      ...(newAwardTypes.size > 0 ? { newAwardTypes: [...newAwardTypes].sort((a, b) => a - b) } : {}),
    },
    eligibility,
  };
}
