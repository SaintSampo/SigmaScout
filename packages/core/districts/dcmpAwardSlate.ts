/**
 * THE DCMP AWARD SLATE (quick task 261014-i8i): how a District Championship
 * tier event prices its awards. Replaces the district tier tables at 3x, which
 * the 2026-10-14 review measured WORSE than a flat guess at the DCMP (Brier
 * 0.2504 against 0.2135; said 51.9% any award, happened 30.9%).
 *
 * ---------------------------------------------------------------------------
 * WHAT A SLATE IS
 * ---------------------------------------------------------------------------
 *
 * Per DCMP tier event, an EXPECTED COUNT of each award given AT THIS EVENT and
 * each team's ELIGIBILITY CHANCE for Impact, Engineering Inspiration and
 * Rookie All Star. The role decides what the event gives:
 *
 *  - `single`: a championship played as one event gives the consuming awards
 *    (Impact, Engineering Inspiration, Rookie All Star) AND judged awards;
 *  - `division`: a division gives judged awards ONLY;
 *  - `finals`: a divisioned championship's finals gives the consuming awards
 *    ONLY; its judged count is its own measured anchor, which is 0;
 *  - `wholeChampionship`: the generated simulated DCMP bake that stands for a
 *    whole championship: the consuming awards at the district's full share,
 *    plus the judged anchor of each of the district's single or division keys.
 *
 * HOW MANY. The consuming counts are the mean of `dcmpAwardCountDistribution`
 * (the champ draws' own count model) times the event's share: 1 over the
 * number of the district's championships for `single` and `finals`, 0 for a
 * `division`, 1 for `wholeChampionship`. The judged count is a measured anchor
 * per role (below).
 *
 * WHO. Within the award field, a team's Impact chance is a water fill of the
 * expected Impact count over weights `q times lift`, capped at `q`, its
 * eligibility chance, so a win never exceeds the chance of being eligible.
 * Engineering Inspiration is the same over veterans, Rookie All Star over
 * rookies with lift 1. Judged awards are water filled over the chance of NOT
 * winning a consuming award, so expected judged winners equal the judged count
 * and they go to teams that did not win a consuming award.
 *
 * THE DRAW keeps the highest single award: Impact, else the 8 point award,
 * else one judged award, else none. Never a stack.
 *
 * ---------------------------------------------------------------------------
 * WHERE THESE NUMBERS COME FROM
 * ---------------------------------------------------------------------------
 *
 * Every literal in `DCMP_AWARD_SLATE_TABLES` was copied from the printed
 * output of
 *
 *     npx tsx scripts/measureDcmpAwardSlate.ts
 *     pnpm measure:dcmp-award-slate
 *
 * run on 2026-10-14. Not hand typed and not remembered. The corpus guarded
 * describe in `scripts/measureDcmpAwardSlate.test.ts` re measures every
 * registered season and asserts each lift within 1e-9 and each n exactly.
 *
 * WALK FORWARD IN BOTH HALVES. Season Y's table reads only championships of
 * seasons strictly before Y, and each team's prior counts read only seasons
 * strictly before the championship's own.
 *
 * THE FALLBACKS, each named on the slate:
 *  - judged anchor: the role's mean in the most recent earlier season holding
 *    that role (`role`), else the pooled single plus division mean of the most
 *    recent earlier season holding either (`pooled`);
 *  - lifts: a class below 100 observations is not in the table and falls to
 *    the pooled rung, lift 1. Judged lifts fall cell, then bucket pooled, then
 *    season pooled: `AwardBaseRateSource`'s own three rungs;
 *  - a field in which any profile lacks either prior count prices every team
 *    at lift 1 (`season-pooled`): no team is priced from a fabricated class.
 *
 * NO AWARD PREDICTION REACHES `locks.ts`. A source test pins that this module
 * imports nothing from it: the slate prices cells only.
 */
import { decorationBucket, cellKey, type AwardBaseRateSource, type DecorationBucket } from "./awardBaseRates.js";
import { dcmpEligibilityChance, type DcmpAwardEligibility } from "./dcmpAwardEligibility.js";
import {
  champCutoffTuning,
  dcmpAwardCountDistribution,
  dcmpAwardCounts,
  type ChampCutoffSetting,
  type DcmpAwardCountAnchor,
  type DcmpDrawnAwardType,
} from "./hypotheticalDcmp.js";
import type { DistrictAwardProfile } from "./ledgerSimulation.js";

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** What one DCMP tier event gives. See the module header. */
export type DcmpSlateRole = "single" | "division" | "finals" | "wholeChampionship";

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

// ---------------------------------------------------------------------------
// The water fill
// ---------------------------------------------------------------------------

/**
 * Distributes `total` over teams in proportion to `weights`, never above each
 * team's cap: `t_j = min(cap_j, lambda weight_j)` with lambda chosen so the
 * sum is `total`. When the reachable caps sum to no more than `total`, every
 * team gets its cap. A zero weight or a zero cap never receives mass. A total
 * of 0 is all zeros.
 */
export function waterFill(weights: readonly number[], caps: readonly number[], total: number): number[] {
  const n = weights.length;
  const out = new Array<number>(n).fill(0);
  if (!(total > 0)) return out;
  const active: number[] = [];
  let capSum = 0;
  for (let j = 0; j < n; j++) {
    if (weights[j]! > 0 && caps[j]! > 0) {
      active.push(j);
      capSum += caps[j]!;
    }
  }
  if (capSum <= total) {
    for (const j of active) out[j] = caps[j]!;
    return out;
  }
  // Teams saturate in order of cap over weight. Walk them, capping each whose
  // proportional share would exceed its cap, then share what is left.
  active.sort((a, b) => caps[a]! / weights[a]! - caps[b]! / weights[b]!);
  let remaining = total;
  let weightLeft = active.reduce((sum, j) => sum + weights[j]!, 0);
  let k = 0;
  for (; k < active.length; k++) {
    const j = active[k]!;
    const lambda = remaining / weightLeft;
    if (lambda * weights[j]! < caps[j]!) break;
    out[j] = caps[j]!;
    remaining -= caps[j]!;
    weightLeft -= weights[j]!;
  }
  const lambda = remaining / weightLeft;
  for (; k < active.length; k++) {
    const j = active[k]!;
    out[j] = lambda * weights[j]!;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The measured tables
// ---------------------------------------------------------------------------

/** One measured lift: won over expected, over `n` observations. */
export interface DcmpSlateLift {
  readonly lift: number;
  readonly n: number;
}

/** One role's judged anchor: the mean judged winning teams per event, and the rung it came from. */
export interface DcmpJudgedAnchor {
  readonly count: number;
  /** `role`: the role's own most recent earlier season. `pooled`: single plus division pooled, most recent earlier season holding either. */
  readonly source: "role" | "pooled";
  readonly fromSeason: number;
  /** Events the mean is over. */
  readonly events: number;
}

/** One season's slate tables. A class absent from a lift table falls to lift 1. */
export interface DcmpAwardSlateSeasonTables {
  readonly judgedAnchor: Readonly<Record<DcmpEventRole, DcmpJudgedAnchor>>;
  /** By `decorationBucket(priorImpactWins)`, over Impact eligible team events. */
  readonly impactLift: Readonly<Partial<Record<DecorationBucket, DcmpSlateLift>>>;
  /** By `decorationBucket(priorJudgedAwards)`, over Engineering Inspiration eligible veteran team events. */
  readonly engineeringInspirationLift: Readonly<Partial<Record<DecorationBucket, DcmpSlateLift>>>;
  /** By `cellKey(decorationBucket(priorJudgedAwards), rookieState)`, over team events that won no consuming award. */
  readonly judgedLiftCells: Readonly<Record<string, DcmpSlateLift>>;
  /** The same, pooled over rookie state, by bucket. */
  readonly judgedLiftBuckets: Readonly<Partial<Record<DecorationBucket, DcmpSlateLift>>>;
}

/**
 * THE MEASURED TABLES, copied verbatim from the LITERAL BLOCK that
 * `npx tsx scripts/measureDcmpAwardSlate.ts` printed on 2026-10-14. A class
 * absent from a lift record measured below 100 observations (the script prints
 * it CANNOT BE SCORED) and falls to lift 1.
 */
// prettier-ignore
export const DCMP_AWARD_SLATE_TABLES: Readonly<Record<number, DcmpAwardSlateSeasonTables>> = {
  2023: {
    judgedAnchor: {
      single: { count: 11.625, source: "role", fromSeason: 2022, events: 8 },
      division: { count: 11.875, source: "role", fromSeason: 2022, events: 8 },
      finals: { count: 0, source: "role", fromSeason: 2022, events: 3 },
    },
    impactLift: { "none": { lift: 0.7635701598642937, n: 196 }, "one-or-two": { lift: 1.1067283024045813, n: 145 } },
    engineeringInspirationLift: { "three-or-more": { lift: 1.00069995363091, n: 234 } },
    judgedLiftCells: { "none|rookie": { lift: 1.2928986604860657, n: 187 }, "none|veteran": { lift: 0.650947965763757, n: 794 }, "one-or-two|veteran": { lift: 0.663929830177611, n: 667 }, "three-or-more|veteran": { lift: 1.313547974276478, n: 1291 } },
    judgedLiftBuckets: { "none": { lift: 0.7840805990621778, n: 981 }, "one-or-two": { lift: 0.663929830177611, n: 667 }, "three-or-more": { lift: 1.313547974276478, n: 1291 } },
  },
  2024: {
    judgedAnchor: {
      single: { count: 11.714285714285714, source: "role", fromSeason: 2023, events: 7 },
      division: { count: 11.9, source: "role", fromSeason: 2023, events: 10 },
      finals: { count: 0, source: "role", fromSeason: 2023, events: 4 },
    },
    impactLift: { "none": { lift: 0.7789405117074928, n: 224 }, "one-or-two": { lift: 1.068573503431782, n: 175 }, "three-or-more": { lift: 1.3530152895683831, n: 108 } },
    engineeringInspirationLift: { "three-or-more": { lift: 1.0008121002099253, n: 309 } },
    judgedLiftCells: { "none|rookie": { lift: 1.3108272060230615, n: 227 }, "none|veteran": { lift: 0.6351921743671172, n: 828 }, "one-or-two|veteran": { lift: 0.6448818893166153, n: 776 }, "three-or-more|veteran": { lift: 1.25332161791686, n: 1830 } },
    judgedLiftBuckets: { "none": { lift: 0.7933585718926491, n: 1055 }, "one-or-two": { lift: 0.6448818893166153, n: 776 }, "three-or-more": { lift: 1.25332161791686, n: 1830 } },
  },
  2025: {
    judgedAnchor: {
      single: { count: 11.714285714285714, source: "role", fromSeason: 2024, events: 7 },
      division: { count: 11.9, source: "role", fromSeason: 2024, events: 10 },
      finals: { count: 0, source: "role", fromSeason: 2024, events: 4 },
    },
    impactLift: { "none": { lift: 0.7626928150752749, n: 253 }, "one-or-two": { lift: 1.0590962651480598, n: 201 }, "three-or-more": { lift: 1.3289328773018325, n: 151 } },
    engineeringInspirationLift: { "three-or-more": { lift: 1.0006626494793114, n: 390 } },
    judgedLiftCells: { "none|rookie": { lift: 1.363832066442959, n: 259 }, "none|veteran": { lift: 0.6234339823138266, n: 867 }, "one-or-two|veteran": { lift: 0.6023717966907673, n: 884 }, "three-or-more|veteran": { lift: 1.2245632569917995, n: 2404 } },
    judgedLiftBuckets: { "none": { lift: 0.807518148619549, n: 1126 }, "one-or-two": { lift: 0.6023717966907673, n: 884 }, "three-or-more": { lift: 1.2245632569917995, n: 2404 } },
  },
  2026: {
    judgedAnchor: {
      single: { count: 12, source: "role", fromSeason: 2025, events: 8 },
      division: { count: 12, source: "role", fromSeason: 2025, events: 10 },
      finals: { count: 0, source: "role", fromSeason: 2025, events: 4 },
    },
    impactLift: { "none": { lift: 0.7303751052989234, n: 274 }, "one-or-two": { lift: 1.0587275648404237, n: 227 }, "three-or-more": { lift: 1.3141724471511398, n: 207 } },
    engineeringInspirationLift: { "three-or-more": { lift: 1.0043056071231207, n: 480 } },
    judgedLiftCells: { "none|rookie": { lift: 1.2520990004906614, n: 290 }, "none|veteran": { lift: 0.6226818654271552, n: 907 }, "one-or-two|veteran": { lift: 0.5741038794136627, n: 982 }, "three-or-more|veteran": { lift: 1.21348861291516, n: 3011 } },
    judgedLiftBuckets: { "none": { lift: 0.7880055987565971, n: 1197 }, "one-or-two": { lift: 0.5741038794136627, n: 982 }, "three-or-more": { lift: 1.21348861291516, n: 3011 } },
  },
};

/** The seasons the slate is registered for, from the table's own keys. */
export const DCMP_AWARD_SLATE_SEASONS: readonly number[] = Object.keys(DCMP_AWARD_SLATE_TABLES)
  .map(Number)
  .sort((a, b) => a - b);

/** Thrown for a season the slate has no table for: never a borrowed season. */
export class UnknownDcmpAwardSlateSeasonError extends Error {
  constructor(season: number) {
    super(`dcmpAwardSlate: no DCMP award slate table for season ${String(season)} (registered: ${DCMP_AWARD_SLATE_SEASONS.join(", ")})`);
    this.name = "UnknownDcmpAwardSlateSeasonError";
  }
}

/** Thrown when a slate is asked for an event key that is not one of the district's DCMP tier keys. */
export class UnknownDcmpSlateTargetError extends Error {
  constructor(eventKey: string, keys: readonly string[]) {
    super(`dcmpAwardSlate: ${eventKey} is not one of the district's DCMP tier keys (${keys.join(", ") || "none"})`);
    this.name = "UnknownDcmpSlateTargetError";
  }
}

export function dcmpAwardSlateTables(season: number): DcmpAwardSlateSeasonTables {
  const tables = DCMP_AWARD_SLATE_TABLES[season];
  if (tables === undefined) throw new UnknownDcmpAwardSlateSeasonError(season);
  return tables;
}

// ---------------------------------------------------------------------------
// The slate one DCMP tier event carries
// ---------------------------------------------------------------------------

/** One team's eligibility chances on a slate. */
export interface DcmpSlateEligibility {
  readonly teamKey: string;
  readonly impact: number;
  readonly engineeringInspiration: number;
  readonly rookieAllStar: number;
}

/**
 * THE SLATE one DCMP tier event's run carries. Plain data: it crosses a
 * `postMessage` structured clone boundary.
 */
export interface DcmpAwardSlateInput {
  readonly role: DcmpSlateRole;
  /** Expected count of each award given AT THIS EVENT. */
  readonly expected: {
    readonly impact: number;
    readonly engineeringInspiration: number;
    readonly rookieAllStar: number;
    readonly judged: number;
  };
  readonly sources: {
    /** Where the consuming counts came from: `dcmpAwardCounts`' own source. */
    readonly counts: DcmpAwardCountAnchor["source"];
    /** The judged anchor's rung. */
    readonly judged: DcmpJudgedAnchor["source"];
  };
  /** Only teams with a chance above 0 for at least one of the three, sorted by key. */
  readonly eligibility: readonly DcmpSlateEligibility[];
}

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
export function buildDcmpAwardSlate(input: BuildDcmpAwardSlateInput): DcmpAwardSlateInput {
  const tables = dcmpAwardSlateTables(input.season);
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

  let judged: number;
  let judgedSource: DcmpJudgedAnchor["source"];
  if (role === "wholeChampionship") {
    const judgedKeys = [...roles.values()].filter((entry): entry is "single" | "division" => entry === "single" || entry === "division");
    const anchors = judgedKeys.length === 0 ? [tables.judgedAnchor.single] : judgedKeys.map((entry) => tables.judgedAnchor[entry]);
    judged = anchors.reduce((sum, anchor) => sum + anchor.count, 0);
    judgedSource = anchors.some((anchor) => anchor.source === "pooled") ? "pooled" : "role";
  } else {
    judged = tables.judgedAnchor[role].count;
    judgedSource = tables.judgedAnchor[role].source;
  }

  const teamKeys = new Set<string>();
  for (const entry of input.eligibility) {
    for (const candidate of entry.candidates) teamKeys.add(candidate.teamKey);
    for (const event of entry.pendingEvents) for (const entrant of event.entrants) teamKeys.add(entrant.teamKey);
  }
  const eligibility: DcmpSlateEligibility[] = [];
  for (const teamKey of [...teamKeys].sort()) {
    const chances = {
      teamKey,
      impact: dcmpEligibilityChance(input.eligibility, teamKey, 0),
      engineeringInspiration: dcmpEligibilityChance(input.eligibility, teamKey, 9),
      rookieAllStar: dcmpEligibilityChance(input.eligibility, teamKey, 10),
    };
    if (chances.impact > 0 || chances.engineeringInspiration > 0 || chances.rookieAllStar > 0) eligibility.push(chances);
  }

  return {
    role,
    expected: {
      impact: meanOf(distribution[0]) * share,
      engineeringInspiration: meanOf(distribution[9]) * share,
      rookieAllStar: meanOf(distribution[10]) * share,
      judged,
    },
    sources: { counts: dcmpAwardCounts(input.season, input.districtKey, input.cmpSlots).source, judged: judgedSource },
    eligibility,
  };
}

// ---------------------------------------------------------------------------
// Who: the per team chances
// ---------------------------------------------------------------------------

/** One award field team's slate chances. `eight` is Engineering Inspiration for a veteran and Rookie All Star for a rookie. */
export interface DcmpSlateAssignment {
  readonly teamKey: string;
  readonly impact: number;
  readonly eight: number;
  readonly judged: number;
  /** The judged lift's rung. */
  readonly judgedSource: AwardBaseRateSource;
}

/** Thrown when a slate is priced for a field member with no award profile. */
export class MissingSlateProfileError extends Error {
  constructor(teamKey: string) {
    super(`dcmpSlateAssignments: ${teamKey} has no award profile`);
    this.name = "MissingSlateProfileError";
  }
}

/** Every award field team's chances under one slate, in award field order. See the module header. */
export function dcmpSlateAssignments(
  season: number,
  awardField: readonly { readonly teamKey: string }[],
  awardProfiles: ReadonlyMap<string, DistrictAwardProfile>,
  slate: DcmpAwardSlateInput
): readonly DcmpSlateAssignment[] {
  const tables = dcmpAwardSlateTables(season);
  const profiles = awardField.map((member) => {
    const profile = awardProfiles.get(member.teamKey);
    if (profile === undefined) throw new MissingSlateProfileError(member.teamKey);
    return profile;
  });
  // ALL OR NOTHING per event: one profile without both counts prices every
  // team at lift 1, never from a fabricated class.
  const complete = profiles.every((profile) => profile.priorJudgedAwards !== undefined && profile.priorImpactWins !== undefined);
  const eligibilityByTeam = new Map(slate.eligibility.map((entry) => [entry.teamKey, entry] as const));
  const isRookie = profiles.map((profile) => profile.rookieState === "rookie");

  const impactLift = profiles.map((profile) => (complete ? tables.impactLift[decorationBucket(profile.priorImpactWins!)]?.lift ?? 1 : 1));
  const eiLift = profiles.map((profile) => (complete ? tables.engineeringInspirationLift[decorationBucket(profile.priorJudgedAwards!)]?.lift ?? 1 : 1));
  const judgedLift: { lift: number; source: AwardBaseRateSource }[] = profiles.map((profile) => {
    if (!complete) return { lift: 1, source: "season-pooled" };
    const bucket = decorationBucket(profile.priorJudgedAwards!);
    const cell = tables.judgedLiftCells[cellKey(bucket, profile.rookieState)];
    if (cell !== undefined) return { lift: cell.lift, source: "cell" };
    const pooled = tables.judgedLiftBuckets[bucket];
    if (pooled !== undefined) return { lift: pooled.lift, source: "bucket-pooled" };
    return { lift: 1, source: "season-pooled" };
  });

  const qImpact = awardField.map((member) => eligibilityByTeam.get(member.teamKey)?.impact ?? 0);
  const qEi = awardField.map((member, j) => (isRookie[j] ? 0 : eligibilityByTeam.get(member.teamKey)?.engineeringInspiration ?? 0));
  const qRas = awardField.map((member, j) => (isRookie[j] ? eligibilityByTeam.get(member.teamKey)?.rookieAllStar ?? 0 : 0));

  const impact = waterFill(
    qImpact.map((q, j) => q * impactLift[j]!),
    qImpact,
    slate.expected.impact
  );
  const ei = waterFill(
    qEi.map((q, j) => q * eiLift[j]!),
    qEi,
    slate.expected.engineeringInspiration
  );
  const ras = waterFill(qRas, qRas, slate.expected.rookieAllStar);
  const eight = awardField.map((_, j) => (isRookie[j] ? ras[j]! : ei[j]!));

  const free = awardField.map((_, j) => (1 - impact[j]!) * (1 - eight[j]!));
  const filled = waterFill(
    free.map((room, j) => judgedLift[j]!.lift * room),
    free,
    slate.expected.judged
  );
  return awardField.map((member, j) => ({
    teamKey: member.teamKey,
    impact: impact[j]!,
    eight: eight[j]!,
    judged: free[j]! > 0 ? Math.min(1, filled[j]! / free[j]!) : 0,
    judgedSource: judgedLift[j]!.source,
  }));
}

/** One slate assignment's exact base scale outcome odds: the highest single award of Impact, then the 8 point award, then one judged award. */
export function slateAwardOutcomeOdds(assignment: DcmpSlateAssignment): { p10: number; p8: number; p5: number; p0: number; impact: number } {
  const pI = assignment.impact;
  const p8 = (1 - pI) * assignment.eight;
  const p5 = (1 - pI) * (1 - assignment.eight) * assignment.judged;
  return { p10: pI, p8, p5, p0: (1 - pI) * (1 - assignment.eight) * (1 - assignment.judged), impact: pI };
}
