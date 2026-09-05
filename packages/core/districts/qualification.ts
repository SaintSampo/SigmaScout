/**
 * Award-based qualification model (quick task 260905-lic revision R2a),
 * declarative and pure -- no corpus import, no I/O. Encodes
 * `260905-lic-RESEARCH-awards.md`'s Q1/Q2/Q4/Q5 findings: which TBA
 * `award_type` values grant a full advancement slot at each of the two
 * tiers this pipeline models (`"district"` = a regular district event
 * feeding DCMP qualification, `"dcmp"` = the District Championship itself
 * feeding FIRST Championship qualification), which are merely "award-only
 * invites" with no slot, and each award's per-season display label.
 *
 * THE RULE DID NOT CHANGE ACROSS THE CORPUS WINDOW (research headline): every
 * one of 2019-2026 uses the identical four-criterion structure at the
 * district-event tier and the identical four-consuming-method structure at
 * the DCMP tier. The only thing that changed is the *display name* of
 * award_type 0, at the 2023 boundary -- `award_type` itself is NEVER branched
 * on by name (research Q4: "an award type must be enumerated for every type
 * of award ever awarded... ONCE A TYPE IS ENUMERATED, IT MUST NOT BE
 * CHANGED"). Both consuming-type sets and both display names below are
 * therefore declared ONCE, not per-season, except where the season itself
 * decides the label.
 */

/** The two event tiers this qualification model distinguishes -- matches `pointModel.ts`'s own `DistrictTier` vocabulary exactly (a regular district event advancing to DCMP, or the District Championship itself advancing to Champs). */
export type AwardTier = "district" | "dcmp";

/** TBA's own enumerated award_type constants this pipeline reads (research Q4). */
export const AWARD_TYPE_IMPACT = 0;
export const AWARD_TYPE_WINNER = 1;
export const AWARD_TYPE_ENGINEERING_INSPIRATION = 9;
export const AWARD_TYPE_ROOKIE_ALL_STAR = 10;

/**
 * Consuming (slot-granting) award types at the district-event tier (research
 * Q1/Q5): ONLY the Impact/Chairman's winner at a regular district event
 * grants a full DCMP qualification slot. Engineering Inspiration and Rookie
 * All Star winners at this tier are "award-only invites" -- they qualify to
 * COMPETE FOR the award at the DCMP, but grant no play slot and are never
 * removed from the district points pool (research Q5: TBA's own
 * `calculate_for_district` sets `non_consuming = set()` for this tier).
 */
export const DISTRICT_TIER_CONSUMING_AWARD_TYPES: ReadonlySet<number> = new Set([AWARD_TYPE_IMPACT]);

/** Award types that are display-only "award-only invite" at the district-event tier -- shown in the awards column, never granting a slot and never removed from the points pool (research Q1/Q5). */
export const DISTRICT_TIER_AWARD_ONLY_TYPES: ReadonlySet<number> = new Set([
  AWARD_TYPE_ENGINEERING_INSPIRATION,
  AWARD_TYPE_ROOKIE_ALL_STAR,
]);

/**
 * Consuming award types at the DCMP tier (Championship qualification,
 * research Q2/Q5): FIRST Impact, Winning Alliance, Engineering Inspiration
 * and Rookie All Star ALL consume a Championship slot when won AT the
 * District Championship itself -- none are award-only at this tier (every
 * one of TBA's `DCMP_WINNER`/`DCMP_IMPACT`/`DCMP_ENGINEERING_INSPIRATION`/
 * `DCMP_ROOKIE_ALL_STAR` qualification methods carries `eats_district_slot:
 * True`).
 */
export const DCMP_TIER_CONSUMING_AWARD_TYPES: ReadonlySet<number> = new Set([
  AWARD_TYPE_IMPACT,
  AWARD_TYPE_WINNER,
  AWARD_TYPE_ENGINEERING_INSPIRATION,
  AWARD_TYPE_ROOKIE_ALL_STAR,
]);

/** The consuming (slot-granting) award-type set for `tier` -- the single source both `qualifyingAwardsForTeam`-style composition and `locks.ts`'s award-qualified-set construction should read, so the two can never disagree about which award types grant a slot at which tier. */
export function consumingAwardTypesForTier(tier: AwardTier): ReadonlySet<number> {
  return tier === "district" ? DISTRICT_TIER_CONSUMING_AWARD_TYPES : DCMP_TIER_CONSUMING_AWARD_TYPES;
}

/**
 * True when `awardType` is qualification-relevant to display at `tier`'s own
 * tab (research's own per-tab award-type sets: "district tab: district-event
 * 0/9/10 with 9/10 flagged awardOnly; champ tab: DCMP 0/9/10/1"). At the
 * district tier this is the union of the consuming set (Impact) and the
 * award-only set (EI, RAS) -- Winner (1) is NOT relevant at a regular
 * district event, since Winning Alliance is not one of the four
 * district-event qualification criteria (research Q1). At the DCMP tier this
 * is exactly the consuming set, which already contains all four types.
 */
export function isQualificationRelevantAward(awardType: number, tier: AwardTier): boolean {
  if (tier === "dcmp") return DCMP_TIER_CONSUMING_AWARD_TYPES.has(awardType);
  return DISTRICT_TIER_CONSUMING_AWARD_TYPES.has(awardType) || DISTRICT_TIER_AWARD_ONLY_TYPES.has(awardType);
}

/** True when `awardType` at `tier` is an "award-only invite" -- qualifies to compete for the award, grants no play slot. Only possible at the district-event tier (research Q1/Q5: every DCMP-tier consuming award type is a full qualifier, none are award-only). */
export function isAwardOnly(awardType: number, tier: AwardTier): boolean {
  return tier === "district" && DISTRICT_TIER_AWARD_ONLY_TYPES.has(awardType);
}

/** Thrown by `awardDisplayName` for an award_type this module carries no display label for -- never silently falls back to a raw number or TBA's own (unstable, differently-cased) name string. */
export class UnknownAwardTypeError extends Error {
  constructor(awardType: number) {
    super(
      `qualification: no declared display label for award_type ${awardType} -- this module only labels the four qualification-relevant types (0, 1, 9, 10); a caller should have filtered upstream (packages/ingest/districts.ts's QUALIFICATION_RELEVANT_AWARD_TYPES)`
    );
    this.name = "UnknownAwardTypeError";
  }
}

/**
 * The display label for one award_type, at `season` (research Q4: "Present
 * it as 'Chairman's Award' for 2019-2022 and 'FIRST Impact Award' for 2023+
 * if the label matters to the reader -- that display split is the ONLY
 * place the 2023 boundary belongs"). Never branches on TBA's own `name`
 * string -- `award_type` alone, plus this one season boundary, is the entire
 * rule.
 */
export function awardDisplayName(awardType: number, season: number): string {
  switch (awardType) {
    case AWARD_TYPE_IMPACT:
      return season >= 2023 ? "FIRST Impact Award" : "Chairman's Award";
    case AWARD_TYPE_WINNER:
      return "Winner";
    case AWARD_TYPE_ENGINEERING_INSPIRATION:
      return "Engineering Inspiration";
    case AWARD_TYPE_ROOKIE_ALL_STAR:
      return "Rookie All Star";
    default:
      throw new UnknownAwardTypeError(awardType);
  }
}

/**
 * District-years the official points model does not apply to at all
 * (research's "2025 FIRST South Carolina" documented exception): FSC does
 * not have enough Championship slots for the ordinary points/award-slot
 * model to work, and instead issues five explicit named invitations
 * (Winning Alliance Captain, Winning Alliance First Pick, FIRST Impact Award
 * Winner, Engineering Inspiration Award Winner, next-highest District
 * Points). `districtKey` is TBA's year-prefixed key. This exception is
 * GONE in 2026 (`2026fsc` uses the standard model with 7 slots, verified
 * live against the 2026 eligibility page) -- it is deliberately not carried
 * forward to any other year for this district.
 */
const SPECIAL_ALLOCATION_DISTRICTS: ReadonlySet<string> = new Set(["2025fsc"]);

/** The honest "not modeled" note for a district-year the ordinary champ-slot cut-line math does not apply to (currently only `2025fsc`, see `SPECIAL_ALLOCATION_DISTRICTS` above), or `null` for every other district-year. */
export function specialAllocationNote(districtKey: string): string | null {
  return SPECIAL_ALLOCATION_DISTRICTS.has(districtKey) ? "special allocation — not modeled" : null;
}
