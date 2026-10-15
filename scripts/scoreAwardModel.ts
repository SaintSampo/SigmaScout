/**
 * THE AWARD MODEL SCORER (quick task 261014-i8i): the SHIPPED award cell,
 * scored walk forward against what happened, per tier, 2023 to 2026.
 *
 *     npx tsx scripts/scoreAwardModel.ts --expect-district-digest <hex>
 *     pnpm score:award-model -- --expect-district-digest <hex>
 *
 * WHAT IT SCORES. Every team event is priced by `eventAwardOutcomeOdds`, the
 * exact odds twin of `simulateDistrictEvent`'s award draw, read from the SAME
 * per event resolution the draw uses. So the scorer scores whatever the site
 * ships, never a copy of it that could drift.
 *
 * THE POPULATION, fixed by the 2026-10-14 review and pinned by its test:
 *  - seasons 2023, 2024, 2025 and 2026;
 *  - rows from `district_rankings.event_points_raw`, each entry's OWN
 *    `district_cmp` deciding its tier;
 *  - events that carry at least one `event_awards_all` row;
 *  - fields of at least 11 teams.
 *
 * WALK FORWARD. Each team's profile is built the way the publisher builds it
 * (quick task 261014-qje, Q-09): the decoration count (`priorDecorationCount`,
 * published as `priorJudgedAwards`) and prior Impact wins
 * (`priorImpactWinCount`) from seasons strictly before the event's own, and
 * the rookie state from the team's rookie year. The award tables themselves
 * are walk forward by construction (each season's tables were measured on
 * earlier seasons only).
 *
 * THE ONE AWARD SLATE (quick task 261014-qje, Q-01). Every district tier event
 * is priced from the slate `buildDistrictAwardSlate` builds, with eligibility
 * from `districtAwardEligibility` (the district's own teams, the corpus weeks,
 * every award final, weights from the one award model, Q-11); every DCMP tier event
 * from `buildDcmpAwardSlate` as below. Both reach `eventAwardOutcomeOdds`
 * through its `awardSlate` field.
 *
 * ELIGIBILITY for the DCMP audits comes from the ONE core helper
 * (`dcmpAwardEligibility`) with the district's own district tier events and
 * every award final, which is the situation at DCMP week. The review counted
 * eligibility over every district in the season; the run prints how many team
 * events the two readings disagree on.
 *
 * "FLAT GUESS AT THE OBSERVED RATE" is the in sample Brier of predicting the
 * rows' own mean: ybar times (1 minus ybar).
 *
 * THE DISTRICT DIGEST is a sha256 over every district tier team event's odds,
 * rounded to 12 decimals, in key order. A DCMP change must leave it equal.
 *
 * THE DCMP SLATE. Each DCMP tier event is priced from the slate the shipped
 * callers build (`buildDcmpAwardSlate`): the district's corpus DCMP tier keys,
 * the district's `cmpSlots` from `selectDistrictsForYear`, the eligibility
 * above (every award final), the event as the target. So the DCMP block scores
 * the shipped slate.
 *
 * THREE HARD GATES, each printed PASS or FAIL (quick task 261014-i8i): the
 * DCMP any award Brier is below its flat guess; the Impact, Engineering
 * Inspiration and Rookie All Star mass on ineligible DCMP team events is
 * exactly 0; the district tier digest equals `--expect-district-digest`. Any
 * FAIL, or a missing digest, exits 1.
 *
 * SNAPSHOTS AND THE 261014-mii ACCEPTANCE (quick task 261014-mii):
 *
 *     npx tsx scripts/scoreAwardModel.ts --write-snapshot <path> [--label <name>]
 *     npx tsx scripts/scoreAwardModel.ts --before <path> [--write-snapshot <path>]
 *
 * `--write-snapshot` writes this run's scores as JSON: per tier n, said,
 * happened, Brier, flat guess, the class map, the review class map, ten
 * reliability bins, the Impact row sums, the DCMP audits and the district
 * digest; since quick task 261014-qje also (optional fields, so an older
 * snapshot still parses) the Q-09 decoration class map, any award per season,
 * rookies per season, the Impact Brier, the district eligibility audit and the
 * expected against real winners per award slot.
 *
 * `--before` reads such a snapshot and replaces the three gates above with the
 * SEVEN PASS BAR GATES of quick task 261014-qje (`passBarGates`), fixed and
 * approved by Jacob before any scoring: 1 the district any award Brier
 * strictly below BEFORE; 2 every review class, under the frozen review rule
 * and under the Q-09 count, inside its chance wobble or smaller than BEFORE; 3
 * rookies in 2025 and in 2026, gap and Brier no worse; 4 the Impact row equals
 * the Impact draw; 5 the district Impact Brier no worse; 6 the DCMP any award
 * Brier no worse; 7 exactly zero where an award cannot go. Any missing BEFORE
 * field and any changed team event count FAILS. The digest gate does not apply
 * in that mode; both digests are printed. Without `--before` the gates are
 * exactly the three above.
 *
 * Read only corpus, no network request, no environment variable. A snapshot is
 * the one file the scorer writes, and only when asked.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  openCorpusReadOnly,
  selectDistrictRankings,
  selectDistrictsForYear,
  type Corpus,
} from "../packages/corpus/db.js";
import { decorationBucket, rookieStateFor, type DecorationBucket, type RookieState } from "../packages/core/districts/awardBaseRates.js";
import { dcmpAwardEligibility, dcmpEligibilityChance, type DcmpEligibilityTeam } from "../packages/core/districts/dcmpAwardEligibility.js";
import { buildDcmpAwardSlate } from "../packages/core/districts/dcmpAwardSlate.js";
import {
  eventAwardOutcomeOdds,
  type AwardOutcomeOdds,
  type DistrictAwardProfile,
} from "../packages/core/districts/ledgerSimulation.js";
import type { DistrictTier } from "../packages/core/districts/pointModel.js";
import { districtTierWeight } from "../packages/core/districts/qualPoints.js";
import {
  buildDistrictAwardSlate,
  districtAwardEligibility,
  highestAwardSlot,
  type AwardSlateInput,
  type AwardSlot,
  type SlateEligibility,
} from "../packages/core/districts/awardSlate.js";
import { loadAwardInstances, loadRookieYears, priorDecorationCount, priorImpactWinCount, type AwardInstance } from "./measureAwardSlate.js";

const CORPUS_PATH = "data/corpus.sqlite";

/** The scored seasons, exactly the review's. Pinned by an equality test. */
export const SCORED_SEASONS: readonly number[] = [2023, 2024, 2025, 2026];

/** The smallest field scored. Below it a "field" is a points row artifact, not an event. */
export const MIN_SCORED_FIELD_SIZE = 11;

const IMPACT_AWARD_TYPE = 0;
const ENGINEERING_INSPIRATION_AWARD_TYPE = 9;
const ROOKIE_ALL_STAR_AWARD_TYPE = 10;

/** A DCMP tier event's role, read from TBA's event_type (5 is a division; 2 with a division child is a finals; 2 otherwise is a single championship). */
export type ScoredDcmpRole = "single" | "division" | "finals";

/** One scored team event. */
export interface ScoredTeamEvent {
  readonly season: number;
  readonly tier: DistrictTier;
  readonly eventKey: string;
  readonly teamKey: string;
  /** DCMP tier only. */
  readonly role?: ScoredDcmpRole;
  readonly bucket: DecorationBucket;
  readonly rookieState: RookieState;
  /**
   * The team event's class under the frozen review rule (`legacyReviewClass`),
   * reporting only, so a BEFORE and an AFTER run compare the same team events.
   */
  readonly reviewClass: string;
  /**
   * The team event's class under the Q-09 decoration count
   * (`priorDecorationCount`), reporting only (quick task 261014-qje), so a
   * BEFORE and an AFTER run compare the same team events under the new
   * definition too.
   */
  readonly decorationClass: string;
  readonly odds: AwardOutcomeOdds;
  /** The tier weight the base scale odds are multiplied by. */
  readonly weight: number;
  /** The real award points TBA recorded. */
  readonly awardPoints: number;
  readonly wonImpact: boolean;
  readonly wonEngineeringInspiration: boolean;
  readonly wonRookieAllStar: boolean;
  /** DCMP tier only: eligibility per the one core helper, with the district's own district tier events. */
  readonly eligible?: { readonly impact: boolean; readonly engineeringInspiration: boolean; readonly rookieAllStar: boolean };
  /** DCMP tier only: eligibility as the review read it, over every district tier event in the season. */
  readonly eligibleAnyDistrict?: { readonly impact: boolean; readonly engineeringInspiration: boolean; readonly rookieAllStar: boolean };
  /**
   * District tier only (quick task 261014-qje, Q-05): whether the team already
   * held Impact, Engineering Inspiration or Rookie All Star from an EARLIER
   * week district event that season, every award final.
   */
  readonly heldEarlier?: { readonly impact: boolean; readonly engineeringInspiration: boolean; readonly rookieAllStar: boolean };
  /** The slot of the team's single highest award at this event (`highestAwardSlot`), or undefined for none. */
  readonly realSlot?: AwardSlot;
}

// ───────────────────────────── pure accumulators ─────────────────────────────

/** A binary forecast accumulator: predicted chance p against outcome y in {0, 1}. */
export interface BinaryAccumulator {
  n: number;
  sumP: number;
  sumY: number;
  sumSquaredError: number;
}

export function emptyBinary(): BinaryAccumulator {
  return { n: 0, sumP: 0, sumY: 0, sumSquaredError: 0 };
}

export function addBinary(acc: BinaryAccumulator, p: number, y: 0 | 1): void {
  acc.n++;
  acc.sumP += p;
  acc.sumY += y;
  acc.sumSquaredError += (p - y) ** 2;
}

export function brierOf(acc: BinaryAccumulator): number {
  return acc.sumSquaredError / acc.n;
}

/** The in sample Brier of predicting the rows' own mean: ybar (1 - ybar). */
export function flatBrierOf(acc: BinaryAccumulator): number {
  const ybar = acc.sumY / acc.n;
  return ybar * (1 - ybar);
}

/** The chance of any award: every outcome above 0 points. */
export function anyAwardChance(odds: AwardOutcomeOdds): number {
  return odds.p10 + odds.p8 + odds.p5;
}

/** The model's expected award points at the event's own scale. */
export function expectedAwardPoints(odds: AwardOutcomeOdds, weight: number): number {
  return weight * (10 * odds.p10 + 8 * odds.p8 + 5 * odds.p5);
}

/** The reader's label for a decoration class: the bucket, plus "rookie" for a rookie. */
export function classLabel(bucket: DecorationBucket, rookieState: RookieState): string {
  const name = bucket === "three-or-more" ? "three or more" : bucket === "one-or-two" ? "one or two" : "none";
  return rookieState === "rookie" ? `${name} rookie` : name;
}

/**
 * THE REVIEW'S DECORATION RULE, FROZEN (quick task 261014-mii, decision M-09):
 * the award types the 2026-10-14 review's classes excluded, exactly as the
 * shipped rule did on 4337d8d2. REPORTING ONLY: it labels scored team events so
 * a BEFORE and an AFTER run compare the same team events, and it never prices
 * anything.
 */
export const LEGACY_REVIEW_EXCLUDED_TYPES: ReadonlySet<number> = Object.freeze(new Set([1, 2, 14]));

/**
 * A team event's class under the review's rule (decision M-09): distinct
 * `(year, eventKey, awardType)` wins of any type outside
 * `LEGACY_REVIEW_EXCLUDED_TYPES`, over EVERY corpus season strictly before
 * `season`, bucketed and labelled with `classLabel`. Reporting only, it never
 * prices anything; the priced class comes from the shipped helpers.
 */
export function legacyReviewClass(instances: readonly AwardInstance[], teamKey: string, season: number, rookieState: RookieState): string {
  const seen = new Set<string>();
  for (const instance of instances) {
    if (instance.teamKey !== teamKey || instance.year >= season) continue;
    if (LEGACY_REVIEW_EXCLUDED_TYPES.has(instance.awardType)) continue;
    seen.add(`${instance.year}|${instance.eventKey}|${instance.awardType}`);
  }
  return classLabel(decorationBucket(seen.size), rookieState);
}

/** One of ten equal width bins of the predicted any award chance. */
export interface ReliabilityBin {
  n: number;
  sumP: number;
  sumY: number;
}

export const RELIABILITY_BIN_COUNT = 10;

export function emptyReliabilityBins(): ReliabilityBin[] {
  return Array.from({ length: RELIABILITY_BIN_COUNT }, () => ({ n: 0, sumP: 0, sumY: 0 }));
}

/** The bin a predicted chance falls in: [0, 0.1) is 0, ..., [0.9, 1] is 9. */
export function reliabilityBinIndex(p: number): number {
  return Math.min(RELIABILITY_BIN_COUNT - 1, Math.max(0, Math.floor(p * RELIABILITY_BIN_COUNT)));
}

/**
 * THE IMPACT ROW AUDIT: the sum of `p10` (what the drawer's Impact row shows),
 * the sum of the Impact draw itself (`impact`), and the real Impact wins. The
 * difference between the first two is the folded stack mass the Impact row
 * prices as Impact.
 */
export interface ImpactRowAudit {
  said: number;
  impactDraw: number;
  realWins: number;
}

/** The DCMP eligibility audit of one award type. */
export interface EligibilityAudit {
  /** The model's expected count of this award (Impact: the Impact award mass; EI: a veteran's 8 point mass; RAS: a rookie's 8 point mass). */
  expected: number;
  /** The part of `expected` on team events not eligible for the award. */
  onIneligible: number;
  /** The real winners, and how many of them were not eligible. */
  realWinners: number;
  winnersIneligible: number;
  /** Team events eligible for the award. */
  eligibleTeamEvents: number;
  /** The CELL's mass on ineligible team events: the 10 point outcome for Impact, the 8 point one for EI (veterans) and RAS (rookies). The AFTER gate requires exactly 0. */
  cellMassOnIneligible: number;
  /** Team events whose eligibility differs between the per district helper and the review's any district reading. */
  disagreementsWithAnyDistrict: number;
}

export function emptyAudit(): EligibilityAudit {
  return { expected: 0, onIneligible: 0, realWinners: 0, winnersIneligible: 0, eligibleTeamEvents: 0, cellMassOnIneligible: 0, disagreementsWithAnyDistrict: 0 };
}

/**
 * THE DISTRICT ELIGIBILITY AUDIT of one award (quick task 261014-qje, Q-05):
 * team events holding the award from an earlier week district event that
 * season, the award's mass on them (Impact: p10; Engineering Inspiration: a
 * veteran's p8; Rookie All Star: a rookie's p8), and real repeat winners.
 */
export interface HeldEarlierAudit {
  teamEvents: number;
  mass: number;
  repeatWinners: number;
}

export function emptyHeldEarlierAudit(): HeldEarlierAudit {
  return { teamEvents: 0, mass: 0, repeatWinners: 0 };
}

/** Expected against real winners per award slot (district tier). The 5 point slots share one expected mass (`p5`). */
export interface SlotWinnerAudit {
  expected: { impact: number; engineeringInspiration: number; rookieAllStar: number; fivePoint: number };
  real: Record<AwardSlot, number>;
}

export function emptySlotWinnerAudit(): SlotWinnerAudit {
  return {
    expected: { impact: 0, engineeringInspiration: 0, rookieAllStar: 0, fivePoint: 0 },
    real: { impact: 0, engineeringInspiration: 0, rookieAllStar: 0, judgedRookie: 0, judged: 0 },
  };
}

/** One tier's whole report. */
export interface TierReport {
  readonly tier: DistrictTier;
  readonly events: Set<string>;
  readonly anyAward: BinaryAccumulator;
  readonly byClass: Map<string, BinaryAccumulator>;
  /** The same accumulators keyed by the frozen review class (`legacyReviewClass`). */
  readonly byReviewClass: Map<string, BinaryAccumulator>;
  readonly byRole: Map<ScoredDcmpRole, BinaryAccumulator>;
  readonly reliability: ReliabilityBin[];
  readonly impactRow: ImpactRowAudit;
  modelPoints: number;
  realPoints: number;
  readonly census: Map<number, number>;
  readonly impact: EligibilityAudit;
  readonly engineeringInspiration: EligibilityAudit;
  readonly rookieAllStar: EligibilityAudit;
  /** The same any award accumulators keyed by the Q-09 decoration class (quick task 261014-qje). */
  readonly byDecorationClass: Map<string, BinaryAccumulator>;
  /** Any award per season. */
  readonly bySeason: Map<number, BinaryAccumulator>;
  /** Any award per season, rookie state rookie only. */
  readonly rookieBySeason: Map<number, BinaryAccumulator>;
  /** Did this team win Impact: the Impact draw (`odds.impact`) against the real Impact win. */
  readonly impactWon: BinaryAccumulator;
  /** District tier only: the earlier week holders of each award (Q-05). */
  readonly heldEarlier: { impact: HeldEarlierAudit; engineeringInspiration: HeldEarlierAudit; rookieAllStar: HeldEarlierAudit };
  /** Expected against real winners per award slot. */
  readonly slots: SlotWinnerAudit;
}

export function emptyTierReport(tier: DistrictTier): TierReport {
  return {
    tier,
    events: new Set(),
    anyAward: emptyBinary(),
    byClass: new Map(),
    byReviewClass: new Map(),
    byRole: new Map(),
    reliability: emptyReliabilityBins(),
    impactRow: { said: 0, impactDraw: 0, realWins: 0 },
    modelPoints: 0,
    realPoints: 0,
    census: new Map(),
    impact: emptyAudit(),
    engineeringInspiration: emptyAudit(),
    rookieAllStar: emptyAudit(),
    byDecorationClass: new Map(),
    bySeason: new Map(),
    rookieBySeason: new Map(),
    impactWon: emptyBinary(),
    heldEarlier: { impact: emptyHeldEarlierAudit(), engineeringInspiration: emptyHeldEarlierAudit(), rookieAllStar: emptyHeldEarlierAudit() },
    slots: emptySlotWinnerAudit(),
  };
}

function addKeyed<K>(map: Map<K, BinaryAccumulator>, key: K, p: number, y: 0 | 1): void {
  let acc = map.get(key);
  if (acc === undefined) {
    acc = emptyBinary();
    map.set(key, acc);
  }
  addBinary(acc, p, y);
}

function auditOne(
  audit: EligibilityAudit,
  expectedMass: number,
  cellMass: number,
  won: boolean,
  eligible: boolean,
  eligibleAnyDistrict: boolean | undefined
): void {
  audit.expected += expectedMass;
  if (eligible) audit.eligibleTeamEvents++;
  else {
    audit.onIneligible += expectedMass;
    audit.cellMassOnIneligible += cellMass;
  }
  if (won) {
    audit.realWinners++;
    if (!eligible) audit.winnersIneligible++;
  }
  if (eligibleAnyDistrict !== undefined && eligibleAnyDistrict !== eligible) audit.disagreementsWithAnyDistrict++;
}

/** Folds one team event into its tier's report. */
export function addTeamEvent(report: TierReport, row: ScoredTeamEvent): void {
  const pAny = anyAwardChance(row.odds);
  const y: 0 | 1 = row.awardPoints > 0 ? 1 : 0;
  report.events.add(row.eventKey);
  addBinary(report.anyAward, pAny, y);
  const label = classLabel(row.bucket, row.rookieState);
  if (!report.byClass.has(label)) report.byClass.set(label, emptyBinary());
  addBinary(report.byClass.get(label)!, pAny, y);
  if (!report.byReviewClass.has(row.reviewClass)) report.byReviewClass.set(row.reviewClass, emptyBinary());
  addBinary(report.byReviewClass.get(row.reviewClass)!, pAny, y);
  const bin = report.reliability[reliabilityBinIndex(pAny)]!;
  bin.n++;
  bin.sumP += pAny;
  bin.sumY += y;
  report.impactRow.said += row.odds.p10;
  report.impactRow.impactDraw += row.odds.impact;
  if (row.wonImpact) report.impactRow.realWins++;
  if (row.role !== undefined) {
    if (!report.byRole.has(row.role)) report.byRole.set(row.role, emptyBinary());
    addBinary(report.byRole.get(row.role)!, pAny, y);
  }
  report.modelPoints += expectedAwardPoints(row.odds, row.weight);
  report.realPoints += row.awardPoints;
  report.census.set(row.awardPoints, (report.census.get(row.awardPoints) ?? 0) + 1);
  addKeyed(report.byDecorationClass, row.decorationClass, pAny, y);
  addKeyed(report.bySeason, row.season, pAny, y);
  if (row.rookieState === "rookie") addKeyed(report.rookieBySeason, row.season, pAny, y);
  addBinary(report.impactWon, row.odds.impact, row.wonImpact ? 1 : 0);
  {
    const rookie = row.rookieState === "rookie";
    report.slots.expected.impact += row.odds.p10;
    if (rookie) report.slots.expected.rookieAllStar += row.odds.p8;
    else report.slots.expected.engineeringInspiration += row.odds.p8;
    report.slots.expected.fivePoint += row.odds.p5;
    if (row.realSlot !== undefined) report.slots.real[row.realSlot]++;
    if (row.heldEarlier !== undefined) {
      const held = row.heldEarlier;
      if (held.impact) {
        report.heldEarlier.impact.teamEvents++;
        report.heldEarlier.impact.mass += row.odds.p10;
        if (row.wonImpact) report.heldEarlier.impact.repeatWinners++;
      }
      if (held.engineeringInspiration) {
        report.heldEarlier.engineeringInspiration.teamEvents++;
        report.heldEarlier.engineeringInspiration.mass += rookie ? 0 : row.odds.p8;
        if (row.wonEngineeringInspiration) report.heldEarlier.engineeringInspiration.repeatWinners++;
      }
      if (held.rookieAllStar) {
        report.heldEarlier.rookieAllStar.teamEvents++;
        report.heldEarlier.rookieAllStar.mass += rookie ? row.odds.p8 : 0;
        if (row.wonRookieAllStar) report.heldEarlier.rookieAllStar.repeatWinners++;
      }
    }
  }
  if (row.eligible !== undefined) {
    const rookie = row.rookieState === "rookie";
    auditOne(report.impact, row.odds.impact, row.odds.p10, row.wonImpact, row.eligible.impact, row.eligibleAnyDistrict?.impact);
    // Engineering Inspiration: the veteran 8 point outcome. No rookie has won it at either tier.
    auditOne(
      report.engineeringInspiration,
      rookie ? 0 : row.odds.p8,
      rookie ? 0 : row.odds.p8,
      row.wonEngineeringInspiration,
      row.eligible.engineeringInspiration,
      row.eligibleAnyDistrict?.engineeringInspiration
    );
    auditOne(
      report.rookieAllStar,
      rookie ? row.odds.p8 : 0,
      rookie ? row.odds.p8 : 0,
      row.wonRookieAllStar,
      row.eligible.rookieAllStar,
      row.eligibleAnyDistrict?.rookieAllStar
    );
  }
}

/** Every tier's report over the scored rows. */
export function scoreTeamEvents(rows: readonly ScoredTeamEvent[]): Map<DistrictTier, TierReport> {
  const out = new Map<DistrictTier, TierReport>([
    ["district", emptyTierReport("district")],
    ["dcmp", emptyTierReport("dcmp")],
  ]);
  for (const row of rows) addTeamEvent(out.get(row.tier)!, row);
  return out;
}

/**
 * THE DISTRICT TIER DIGEST: sha256 over every district tier team event's four
 * outcome odds, each rounded to 12 decimals, one line per team event, in
 * `season|eventKey|teamKey` order. Independent of the rows' input order.
 */
export function districtOddsDigest(rows: readonly ScoredTeamEvent[]): { digest: string; lines: number } {
  const lines = rows
    .filter((row) => row.tier === "district")
    .map((row) =>
      [String(row.season), row.eventKey, row.teamKey, row.odds.p10.toFixed(12), row.odds.p8.toFixed(12), row.odds.p5.toFixed(12), row.odds.p0.toFixed(12)].join("|")
    )
    .sort();
  const hash = createHash("sha256");
  for (const line of lines) hash.update(`${line}\n`);
  return { digest: hash.digest("hex"), lines: lines.length };
}

/** TBA event_type roles of a season's DCMP tier keys: 5 is a division; 2 with a type 5 child (its key plus digits) is a finals; 2 otherwise is a single championship. */
export function dcmpRolesByEventType(eventTypes: ReadonlyMap<string, number>, dcmpKeys: Iterable<string>): Map<string, ScoredDcmpRole> {
  const divisions = [...eventTypes].filter(([, type]) => type === 5).map(([key]) => key);
  const out = new Map<string, ScoredDcmpRole>();
  for (const key of dcmpKeys) {
    const type = eventTypes.get(key);
    if (type === 5) out.set(key, "division");
    else if (divisions.some((division) => division.length > key.length && division.startsWith(key) && /^\d+$/.test(division.slice(key.length)))) out.set(key, "finals");
    else out.set(key, "single");
  }
  return out;
}

// ───────────────────────────── corpus reads ─────────────────────────────

interface RankingRow {
  readonly districtKey: string;
  readonly tier: DistrictTier;
  readonly eventKey: string;
  readonly teamKey: string;
  readonly awardPoints: number;
}

/** Every entry of every district's rankings for one season, the entry's own `district_cmp` deciding its tier. */
function loadRankingRows(db: Corpus, season: number): RankingRow[] {
  const out: RankingRow[] = [];
  for (const district of selectDistrictsForYear(db, season)) {
    for (const ranking of selectDistrictRankings(db, district.districtKey)) {
      let entries: unknown;
      try {
        entries = JSON.parse(ranking.eventPointsRaw);
      } catch {
        continue;
      }
      if (!Array.isArray(entries)) continue;
      for (const entry of entries as Record<string, unknown>[]) {
        if (typeof entry !== "object" || entry === null) continue;
        if (typeof entry["event_key"] !== "string" || typeof entry["award_points"] !== "number" || typeof entry["district_cmp"] !== "boolean") continue;
        out.push({
          districtKey: district.districtKey,
          tier: entry["district_cmp"] ? "dcmp" : "district",
          eventKey: entry["event_key"],
          teamKey: ranking.teamKey,
          awardPoints: entry["award_points"],
        });
      }
    }
  }
  return out;
}

function loadEventTypes(db: Corpus, season: number): Map<string, number> {
  const rows = db.prepare(`SELECT event_key, event_type FROM events WHERE year = ?`).all(season) as { event_key: string; event_type: number }[];
  return new Map(rows.map((row) => [row.event_key, row.event_type]));
}

/** Each event's TBA competition week for one season; null where the corpus holds none (quick task 261014-qje, Q-05). */
export function loadEventWeeks(db: Corpus, season: number): Map<string, number | null> {
  const rows = db.prepare(`SELECT event_key, week FROM events WHERE year = ?`).all(season) as { event_key: string; week: number | null }[];
  return new Map(rows.map((row) => [row.event_key, row.week]));
}

/** Whether event `other` is strictly earlier than `event`: a smaller week, both known (Q-05). A null week is never earlier. */
export function isEarlierWeek(weeks: ReadonlyMap<string, number | null>, other: string, event: string): boolean {
  if (other === event) return false;
  const a = weeks.get(other);
  const b = weeks.get(event);
  return a !== null && a !== undefined && b !== null && b !== undefined && a < b;
}

/** The corpus load the scorer runs on: every scored team event, with its odds from the shipped resolution. */
export interface ScorerLoad {
  readonly rows: ScoredTeamEvent[];
  readonly unknownRookieStateTeamEvents: number;
  /** District tier scored team events whose own event, or one of the team's other district tier events that season, has no week (quick task 261014-qje). */
  readonly nullWeekTeamEvents: number;
}

export function loadScoredTeamEvents(db: Corpus, seasons: readonly number[] = SCORED_SEASONS): ScorerLoad {
  const rookieYears = loadRookieYears(db);
  const corpusSeasons = (db.prepare(`SELECT DISTINCT year FROM event_awards_all ORDER BY year`).all() as { year: number }[]).map((row) => row.year);
  const instancesByTeam = new Map<string, AwardInstance[]>();
  const instancesBySeason = new Map<number, AwardInstance[]>();
  for (const year of corpusSeasons) {
    const instances = loadAwardInstances(db, year);
    instancesBySeason.set(year, instances);
    for (const instance of instances) {
      if (instance.teamKey === null) continue;
      const list = instancesByTeam.get(instance.teamKey);
      if (list === undefined) instancesByTeam.set(instance.teamKey, [instance]);
      else list.push(instance);
    }
  }

  const rows: ScoredTeamEvent[] = [];
  let unknownRookieStateTeamEvents = 0;
  let nullWeekTeamEvents = 0;
  for (const season of seasons) {
    const weeks = loadEventWeeks(db, season);
    const seasonInstances = instancesBySeason.get(season) ?? [];
    const eventsWithAwardRows = new Set(seasonInstances.map((instance) => instance.eventKey));
    const wonAt = new Map<string, Set<number>>();
    for (const instance of seasonInstances) {
      if (instance.teamKey === null) continue;
      const key = `${instance.eventKey}|${instance.teamKey}`;
      const set = wonAt.get(key);
      if (set === undefined) wonAt.set(key, new Set([instance.awardType]));
      else set.add(instance.awardType);
    }
    const seasonInstancesByTeam = new Map<string, AwardInstance[]>();
    for (const instance of seasonInstances) {
      if (instance.teamKey === null) continue;
      const list = seasonInstancesByTeam.get(instance.teamKey);
      if (list === undefined) seasonInstancesByTeam.set(instance.teamKey, [instance]);
      else list.push(instance);
    }

    const rankingRows = loadRankingRows(db, season);

    // The review's any district reading: a team holding the award at ANY district tier event this season.
    const allDistrictTierKeys = new Set(rankingRows.filter((row) => row.tier === "district").map((row) => row.eventKey));
    const anyDistrictWinners = new Map<number, Set<string>>([
      [IMPACT_AWARD_TYPE, new Set()],
      [ENGINEERING_INSPIRATION_AWARD_TYPE, new Set()],
      [ROOKIE_ALL_STAR_AWARD_TYPE, new Set()],
    ]);
    for (const instance of seasonInstances) {
      if (instance.teamKey === null || !allDistrictTierKeys.has(instance.eventKey)) continue;
      anyDistrictWinners.get(instance.awardType)?.add(instance.teamKey);
    }

    // THE PROFILES the publisher builds (quick task 261014-qje, Q-09): the
    // decoration count `priorDecorationCount`, published as
    // `priorJudgedAwards`, and the prior Impact wins.
    const profileCache = new Map<string, DistrictAwardProfile>();
    const profileOf = (teamKey: string): DistrictAwardProfile => {
      let profile = profileCache.get(teamKey);
      if (profile === undefined) {
        const instances = instancesByTeam.get(teamKey) ?? [];
        const priorJudgedAwards = priorDecorationCount(instances, teamKey, season);
        const priorImpactWins = priorImpactWinCount(instances, teamKey, season);
        const rookieState = rookieStateFor(rookieYears.get(teamKey) ?? null, season);
        profile = { bucket: decorationBucket(priorJudgedAwards), rookieState, priorJudgedAwards, priorImpactWins };
        profileCache.set(teamKey, profile);
      }
      return profile;
    };

    // The per district reading, through the ONE core helper: each district's
    // own teams, their district tier events, every award final.
    const eligibilityByDistrict = new Map<string, ReturnType<typeof dcmpAwardEligibility>>();
    const eligibilityTeamsByDistrict = new Map<string, DcmpEligibilityTeam[]>();
    const rowsByDistrict = new Map<string, RankingRow[]>();
    for (const row of rankingRows) {
      const list = rowsByDistrict.get(row.districtKey);
      if (list === undefined) rowsByDistrict.set(row.districtKey, [row]);
      else list.push(row);
    }
    for (const [districtKey, districtRows] of rowsByDistrict) {
      const teamOrder: string[] = [];
      const districtEvents = new Map<string, Set<string>>();
      for (const row of districtRows) {
        if (!districtEvents.has(row.teamKey)) {
          districtEvents.set(row.teamKey, new Set());
          teamOrder.push(row.teamKey);
        }
        if (row.tier === "district") districtEvents.get(row.teamKey)!.add(row.eventKey);
      }
      const teams: DcmpEligibilityTeam[] = teamOrder.map((teamKey) => ({
        teamKey,
        rookie: rookieStateFor(rookieYears.get(teamKey) ?? null, season) === "rookie",
        heldAwards: (seasonInstancesByTeam.get(teamKey) ?? []).map((instance) => ({ eventKey: instance.eventKey, awardType: instance.awardType })),
        districtEventKeys: [...districtEvents.get(teamKey)!],
      }));
      // Every award is final, so no open event exists and no weight changes a
      // chance; the shipped profiles are passed all the same (Q-11).
      eligibilityByDistrict.set(districtKey, dcmpAwardEligibility({ season, teams, awardFinal: () => true, profileOf: (teamKey) => profileOf(teamKey) }));
      eligibilityTeamsByDistrict.set(districtKey, teams);
    }

    // Each team's district tier events, per district (quick task 261014-qje,
    // Q-05): the earlier week holders the district eligibility reads.
    const districtEventsByDistrictTeam = new Map<string, Set<string>>();
    for (const row of rankingRows) {
      if (row.tier !== "district") continue;
      const key = `${row.districtKey}|${row.teamKey}`;
      const set = districtEventsByDistrictTeam.get(key);
      if (set === undefined) districtEventsByDistrictTeam.set(key, new Set([row.eventKey]));
      else set.add(row.eventKey);
    }

    const dcmpKeys = new Set(rankingRows.filter((row) => row.tier === "dcmp").map((row) => row.eventKey));
    const roles = dcmpRolesByEventType(loadEventTypes(db, season), dcmpKeys);

    // THE SLATE INPUTS the shipped callers read: each district's corpus DCMP
    // tier keys and its published cmpSlots (the champ draws' fallback is 0).
    const dcmpKeysByDistrict = new Map<string, Set<string>>();
    for (const row of rankingRows) {
      if (row.tier !== "dcmp") continue;
      const set = dcmpKeysByDistrict.get(row.districtKey);
      if (set === undefined) dcmpKeysByDistrict.set(row.districtKey, new Set([row.eventKey]));
      else set.add(row.eventKey);
    }
    const cmpSlotsByDistrict = new Map(selectDistrictsForYear(db, season).map((district) => [district.districtKey, district.cmpSlots] as const));

    const byEvent = new Map<string, RankingRow[]>();
    for (const row of rankingRows) {
      const list = byEvent.get(row.eventKey);
      if (list === undefined) byEvent.set(row.eventKey, [row]);
      else list.push(row);
    }

    // THE DISTRICT ELIGIBILITY (Q-05): per district and event, the shipped
    // helper over the district's teams, the corpus weeks, every award final,
    // weights from the one award model (Q-11) through `profileOf`.
    const districtEligibilityCache = new Map<string, Map<string, SlateEligibility>>();
    const districtEligibilityAt = (districtKey: string, eventKey: string): Map<string, SlateEligibility> => {
      const key = `${districtKey}|${eventKey}`;
      let cached = districtEligibilityCache.get(key);
      if (cached === undefined) {
        const list = districtAwardEligibility({
          season,
          eventKey,
          teams: eligibilityTeamsByDistrict.get(districtKey) ?? [],
          weekOf: (other) => weeks.get(other) ?? null,
          awardFinal: () => true,
          profileOf,
        });
        cached = new Map(list.map((entry) => [entry.teamKey, entry] as const));
        districtEligibilityCache.set(key, cached);
      }
      return cached;
    };

    for (const [eventKey, field] of byEvent) {
      if (!eventsWithAwardRows.has(eventKey)) continue;
      if (field.length < MIN_SCORED_FIELD_SIZE) continue;
      const tier = field[0]!.tier;
      const weight = districtTierWeight(season, tier);
      const awardProfiles = new Map<string, DistrictAwardProfile>();
      for (const row of field) awardProfiles.set(row.teamKey, profileOf(row.teamKey));
      const awardField = field.map((row) => ({ teamKey: row.teamKey }));
      const eligibility = tier === "dcmp" ? eligibilityByDistrict.get(field[0]!.districtKey) : undefined;
      let awardSlate: AwardSlateInput;
      if (tier === "dcmp") {
        const districtKey = field[0]!.districtKey;
        awardSlate = buildDcmpAwardSlate({
          season,
          districtKey,
          cmpSlots: cmpSlotsByDistrict.get(districtKey) ?? 0,
          dcmpEventKeys: [...(dcmpKeysByDistrict.get(districtKey) ?? [])].sort(),
          target: { eventKey },
          eligibility: eligibility!,
        });
      } else {
        // Each team's eligibility from its OWN district's helper output.
        const districtEligibility: SlateEligibility[] = [];
        for (const row of field) {
          const entry = districtEligibilityAt(row.districtKey, eventKey).get(row.teamKey);
          if (entry !== undefined) districtEligibility.push(entry);
        }
        awardSlate = buildDistrictAwardSlate({ season, awardField, eligibility: districtEligibility });
      }
      const odds = eventAwardOutcomeOdds({ eventKey, season, tier, awardField, awardProfiles, awardSlate });
      for (const row of field) {
        const profile = awardProfiles.get(row.teamKey)!;
        if (profile.rookieState === "unknown") unknownRookieStateTeamEvents++;
        const won = wonAt.get(`${eventKey}|${row.teamKey}`) ?? new Set<number>();
        let heldEarlier: ScoredTeamEvent["heldEarlier"];
        if (tier === "district") {
          const ownEvents = districtEventsByDistrictTeam.get(`${row.districtKey}|${row.teamKey}`) ?? new Set<string>();
          if (weeks.get(eventKey) == null || [...ownEvents].some((other) => weeks.get(other) == null)) nullWeekTeamEvents++;
          const earlier = new Set([...ownEvents].filter((other) => isEarlierWeek(weeks, other, eventKey)));
          const heldTypes = new Set(
            (seasonInstancesByTeam.get(row.teamKey) ?? []).filter((instance) => earlier.has(instance.eventKey)).map((instance) => instance.awardType)
          );
          heldEarlier = {
            impact: heldTypes.has(IMPACT_AWARD_TYPE),
            engineeringInspiration: heldTypes.has(ENGINEERING_INSPIRATION_AWARD_TYPE),
            rookieAllStar: heldTypes.has(ROOKIE_ALL_STAR_AWARD_TYPE),
          };
        }
        const realSlot = highestAwardSlot(won);
        const scored: ScoredTeamEvent = {
          season,
          tier,
          eventKey,
          teamKey: row.teamKey,
          ...(tier === "dcmp" ? { role: roles.get(eventKey) ?? "single" } : {}),
          bucket: profile.bucket,
          rookieState: profile.rookieState,
          reviewClass: legacyReviewClass(instancesByTeam.get(row.teamKey) ?? [], row.teamKey, season, profile.rookieState),
          decorationClass: classLabel(decorationBucket(priorDecorationCount(instancesByTeam.get(row.teamKey) ?? [], row.teamKey, season)), profile.rookieState),
          odds: odds.get(row.teamKey)!,
          weight,
          awardPoints: row.awardPoints,
          wonImpact: won.has(IMPACT_AWARD_TYPE),
          wonEngineeringInspiration: won.has(ENGINEERING_INSPIRATION_AWARD_TYPE),
          wonRookieAllStar: won.has(ROOKIE_ALL_STAR_AWARD_TYPE),
          ...(heldEarlier === undefined ? {} : { heldEarlier }),
          ...(realSlot === undefined ? {} : { realSlot }),
          ...(eligibility === undefined
            ? {}
            : {
                eligible: {
                  impact: dcmpEligibilityChance(eligibility, row.teamKey, 0) > 0,
                  engineeringInspiration: dcmpEligibilityChance(eligibility, row.teamKey, 9) > 0,
                  rookieAllStar: dcmpEligibilityChance(eligibility, row.teamKey, 10) > 0,
                },
                eligibleAnyDistrict: {
                  impact: anyDistrictWinners.get(IMPACT_AWARD_TYPE)!.has(row.teamKey),
                  engineeringInspiration: anyDistrictWinners.get(ENGINEERING_INSPIRATION_AWARD_TYPE)!.has(row.teamKey),
                  rookieAllStar: anyDistrictWinners.get(ROOKIE_ALL_STAR_AWARD_TYPE)!.has(row.teamKey),
                },
              }),
        };
        rows.push(scored);
      }
    }
  }
  return { rows, unknownRookieStateTeamEvents, nullWeekTeamEvents };
}

// ───────────────────────────── reporting ─────────────────────────────

const pct = (value: number): string => (value * 100).toFixed(1);

function anyAwardLine(acc: BinaryAccumulator): string {
  return `said ${pct(acc.sumP / acc.n)}%, happened ${pct(acc.sumY / acc.n)}%, Brier ${brierOf(acc).toFixed(4)}, flat guess at the observed rate ${flatBrierOf(acc).toFixed(4)} (n=${String(acc.n)})`;
}

function auditLines(name: string, audit: EligibilityAudit, expectedWhat: string): string[] {
  return [
    `  ${name}: ${audit.expected.toFixed(1)} expected (${expectedWhat}), ${audit.onIneligible.toFixed(1)} on ineligible team events, ` +
      `${String(audit.realWinners)} real winners, ${String(audit.winnersIneligible)} of them ineligible, ${String(audit.eligibleTeamEvents)} eligible team events`,
    `     cell mass on ineligible team events: ${audit.cellMassOnIneligible.toFixed(6)}; eligibility differs from the any district reading on ${String(audit.disagreementsWithAnyDistrict)} team event(s)`,
  ];
}

/** The review's four classes, in print order. A2 gates exactly these. */
export const REVIEW_CLASSES: readonly string[] = ["three or more", "one or two", "none", "none rookie"];
const CLASS_ORDER = REVIEW_CLASSES;

function classesLine(byClass: ReadonlyMap<string, BinaryAccumulator>): string {
  const labels = [...byClass.keys()].sort((a, b) => {
    const ia = CLASS_ORDER.indexOf(a);
    const ib = CLASS_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  return labels
    .map((label) => {
      const acc = byClass.get(label)!;
      return `${label} ${pct(acc.sumP / acc.n)} vs ${pct(acc.sumY / acc.n)} (n=${String(acc.n)})`;
    })
    .join("; ");
}

/** The printed block for one tier. */
export function tierReportLines(report: TierReport): string[] {
  const n = report.anyAward.n;
  const lines: string[] = [];
  lines.push(`${report.tier === "dcmp" ? "DCMP" : "DISTRICT"} TIER: ${String(n)} team events at ${String(report.events.size)} events`);
  lines.push(`  any award: ${anyAwardLine(report.anyAward)}`);
  lines.push(`  by bucket (said vs happened): ${classesLine(report.byClass)}`);
  lines.push(`  by review class, frozen review rule (said vs happened): ${classesLine(report.byReviewClass)}`);
  const row = report.impactRow;
  lines.push(
    `  Impact row: said ${row.said.toFixed(3)} (Impact draw ${row.impactDraw.toFixed(3)}, folded stacks ${(row.said - row.impactDraw).toFixed(3)}), real Impact wins ${String(row.realWins)}`
  );
  lines.push(`  reliability (any award chance bin: said vs happened, n):`);
  report.reliability.forEach((bin, i) => {
    const range = `${(i / RELIABILITY_BIN_COUNT).toFixed(1)} to ${((i + 1) / RELIABILITY_BIN_COUNT).toFixed(1)}`;
    lines.push(bin.n === 0 ? `    ${range}: empty` : `    ${range}: ${pct(bin.sumP / bin.n)} vs ${pct(bin.sumY / bin.n)} (n=${String(bin.n)})`);
  });
  for (const role of ["single", "division", "finals"] as const) {
    const acc = report.byRole.get(role);
    if (acc !== undefined) lines.push(`  any award, ${role}: ${anyAwardLine(acc)}`);
  }
  lines.push(`  mean award points per team: model ${(report.modelPoints / n).toFixed(2)}, real ${(report.realPoints / n).toFixed(2)}`);
  lines.push(
    `  real point census: ${[...report.census]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([points, count]) => `${String(points)} x${String(count)}`)
      .join(", ")} (${String(n)} team events)`
  );
  lines.push(`  by decoration class, Q-09 count (said vs happened): ${classesLine(report.byDecorationClass)}`);
  for (const [season, acc] of [...report.bySeason].sort((a, b) => a[0] - b[0])) lines.push(`  any award, ${String(season)}: ${anyAwardLine(acc)}`);
  for (const [season, acc] of [...report.rookieBySeason].sort((a, b) => a[0] - b[0])) lines.push(`  rookies, ${String(season)}: ${anyAwardLine(acc)}`);
  lines.push(
    `  won Impact (the Impact draw against a real Impact win): said ${report.impactWon.sumP.toFixed(3)}, real ${String(report.impactWon.sumY)}, Brier ${report.impactWon.n === 0 ? "none" : brierOf(report.impactWon).toFixed(6)} (n=${String(report.impactWon.n)})`
  );
  const slots = report.slots;
  lines.push(
    `  expected vs real winners per award slot: Impact ${slots.expected.impact.toFixed(1)} vs ${String(slots.real.impact)}; ` +
      `Engineering Inspiration (veteran p8) ${slots.expected.engineeringInspiration.toFixed(1)} vs ${String(slots.real.engineeringInspiration)}; ` +
      `Rookie All Star (rookie p8) ${slots.expected.rookieAllStar.toFixed(1)} vs ${String(slots.real.rookieAllStar)}; ` +
      `5 point (p5) ${slots.expected.fivePoint.toFixed(1)} vs ${String(slots.real.judgedRookie + slots.real.judged)} (judgedRookie ${String(slots.real.judgedRookie)}, judged ${String(slots.real.judged)})`
  );
  if (report.tier === "district") {
    const held = report.heldEarlier;
    lines.push(
      `  district eligibility audit (held from an earlier week district event, every award final): ` +
        `Impact ${String(held.impact.teamEvents)} team events, p10 mass ${held.impact.mass.toFixed(6)}, ${String(held.impact.repeatWinners)} repeat winner(s); ` +
        `Engineering Inspiration ${String(held.engineeringInspiration.teamEvents)} team events, veteran p8 mass ${held.engineeringInspiration.mass.toFixed(6)}, ${String(held.engineeringInspiration.repeatWinners)} repeat winner(s); ` +
        `Rookie All Star ${String(held.rookieAllStar.teamEvents)} team events, rookie p8 mass ${held.rookieAllStar.mass.toFixed(6)}, ${String(held.rookieAllStar.repeatWinners)} repeat winner(s)`
    );
  }
  if (report.tier === "dcmp") {
    lines.push(...auditLines("Impact", report.impact, "Impact award mass"));
    lines.push(...auditLines("Engineering Inspiration", report.engineeringInspiration, "veteran 8 point outcome mass"));
    lines.push(...auditLines("Rookie All Star", report.rookieAllStar, "rookie 8 point outcome mass"));
  }
  return lines;
}

/** One hard gate's verdict. */
export interface AcceptanceGate {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

/**
 * THE THREE HARD GATES (quick task 261014-i8i): the DCMP any award Brier is
 * below its flat guess at the observed rate; the Impact, Engineering
 * Inspiration and Rookie All Star mass on ineligible DCMP team events is
 * exactly 0 (both the award's own mass and its cell's); the district tier
 * digest equals the expected one. A missing expected digest FAILS.
 */
export function acceptanceGates(dcmp: TierReport, districtDigest: string, expectedDistrictDigest: string | undefined): AcceptanceGate[] {
  const brier = brierOf(dcmp.anyAward);
  const flat = flatBrierOf(dcmp.anyAward);
  const audits = [
    ["Impact", dcmp.impact],
    ["Engineering Inspiration", dcmp.engineeringInspiration],
    ["Rookie All Star", dcmp.rookieAllStar],
  ] as const;
  const zeroMass = dcmp.anyAward.n > 0 && audits.every(([, audit]) => audit.onIneligible === 0 && audit.cellMassOnIneligible === 0);
  return [
    {
      name: "DCMP any award Brier below the flat guess at the observed rate",
      pass: dcmp.anyAward.n > 0 && brier < flat,
      detail: `Brier ${brier.toFixed(4)} vs flat ${flat.toFixed(4)} (n=${String(dcmp.anyAward.n)})`,
    },
    {
      name: "Impact, Engineering Inspiration and Rookie All Star mass on ineligible DCMP team events is exactly 0",
      pass: zeroMass,
      detail: audits.map(([label, audit]) => `${label} ${String(audit.onIneligible)} award / ${String(audit.cellMassOnIneligible)} cell`).join("; "),
    },
    {
      name: "district tier digest equals the expected digest",
      pass: expectedDistrictDigest !== undefined && expectedDistrictDigest === districtDigest,
      detail:
        expectedDistrictDigest === undefined
          ? `no --expect-district-digest given; this run's digest is ${districtDigest}`
          : `expected ${expectedDistrictDigest}, got ${districtDigest}`,
    },
  ];
}

/** The printed gate lines: one `GATE PASS:` or `GATE FAIL:` line per gate. */
export function gateLines(gates: readonly AcceptanceGate[]): string[] {
  return gates.map((gate) => `GATE ${gate.pass ? "PASS" : "FAIL"}: ${gate.name} (${gate.detail})`);
}

// ───────────────────────────── snapshots (quick task 261014-mii) ─────────────────────────────

const ClassScoreSchema = z.object({ n: z.number().int().nonnegative(), said: z.number(), happened: z.number() });
const ReliabilityBinScoreSchema = z.object({ lo: z.number(), hi: z.number(), n: z.number().int().nonnegative(), said: z.number().nullable(), happened: z.number().nullable() });
const AuditScoreSchema = z.object({
  expected: z.number(),
  onIneligible: z.number(),
  realWinners: z.number().int(),
  winnersIneligible: z.number().int(),
  eligibleTeamEvents: z.number().int(),
  cellMassOnIneligible: z.number(),
  disagreementsWithAnyDistrict: z.number().int(),
});
/** One binary score: n, said, happened and Brier, null on an empty accumulator. */
const BinaryScoreSchema = z.object({
  n: z.number().int().nonnegative(),
  said: z.number().nullable(),
  happened: z.number().nullable(),
  brier: z.number().nullable(),
});
const HeldEarlierScoreSchema = z.object({ teamEvents: z.number().int().nonnegative(), mass: z.number(), repeatWinners: z.number().int().nonnegative() });
const SlotWinnerScoreSchema = z.object({
  expected: z.object({ impact: z.number(), engineeringInspiration: z.number(), rookieAllStar: z.number(), fivePoint: z.number() }),
  real: z.object({
    impact: z.number().int(),
    engineeringInspiration: z.number().int(),
    rookieAllStar: z.number().int(),
    judgedRookie: z.number().int(),
    judged: z.number().int(),
  }),
});
const TierSnapshotSchema = z.object({
  n: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
  /** null on an empty tier, never NaN. */
  said: z.number().nullable(),
  happened: z.number().nullable(),
  brier: z.number().nullable(),
  flat: z.number().nullable(),
  classes: z.record(z.string(), ClassScoreSchema),
  reviewClasses: z.record(z.string(), ClassScoreSchema),
  reliability: z.array(ReliabilityBinScoreSchema),
  impactRow: z.object({ said: z.number(), impactDraw: z.number(), realWins: z.number().int() }),
  audits: z.object({ impact: AuditScoreSchema, engineeringInspiration: AuditScoreSchema, rookieAllStar: AuditScoreSchema }).optional(),
  // ── quick task 261014-qje: OPTIONAL, so a snapshot written before them (261014-mii) still parses ──
  /** The same classes under the Q-09 decoration count. */
  decorationClasses: z.record(z.string(), ClassScoreSchema).optional(),
  /** Any award per season, keyed by the season as a string. */
  seasons: z.record(z.string(), BinaryScoreSchema).optional(),
  /** Any award per season, rookie state rookie only. */
  rookieSeasons: z.record(z.string(), BinaryScoreSchema).optional(),
  /** Did this team win Impact: `said` is the summed Impact draw, `happened` the real Impact win rate. */
  impactWon: BinaryScoreSchema.optional(),
  /** District tier only: the earlier week holders of each award (Q-05). */
  heldEarlier: z.object({ impact: HeldEarlierScoreSchema, engineeringInspiration: HeldEarlierScoreSchema, rookieAllStar: HeldEarlierScoreSchema }).optional(),
  slots: SlotWinnerScoreSchema.optional(),
});
/** A scorer snapshot: what `--write-snapshot` writes and `--before` reads. */
export const ScoreSnapshotSchema = z.object({
  label: z.string().min(1),
  timestamp: z.string().min(1),
  seasons: z.array(z.number().int()),
  districtDigest: z.string().regex(/^[0-9a-f]{64}$/),
  districtDigestLines: z.number().int().nonnegative(),
  district: TierSnapshotSchema,
  dcmp: TierSnapshotSchema,
});
export type ScoreSnapshot = z.infer<typeof ScoreSnapshotSchema>;
type TierSnapshot = z.infer<typeof TierSnapshotSchema>;
type BinaryScore = z.infer<typeof BinaryScoreSchema>;

function classScores(byClass: ReadonlyMap<string, BinaryAccumulator>): Record<string, { n: number; said: number; happened: number }> {
  const out: Record<string, { n: number; said: number; happened: number }> = {};
  for (const [label, acc] of [...byClass].sort((a, b) => a[0].localeCompare(b[0]))) out[label] = { n: acc.n, said: acc.sumP / acc.n, happened: acc.sumY / acc.n };
  return out;
}

function binaryScore(acc: BinaryAccumulator): BinaryScore {
  return {
    n: acc.n,
    said: acc.n === 0 ? null : acc.sumP / acc.n,
    happened: acc.n === 0 ? null : acc.sumY / acc.n,
    brier: acc.n === 0 ? null : brierOf(acc),
  };
}

function seasonScores(bySeason: ReadonlyMap<number, BinaryAccumulator>): Record<string, BinaryScore> {
  const out: Record<string, BinaryScore> = {};
  for (const [season, acc] of [...bySeason].sort((a, b) => a[0] - b[0])) out[String(season)] = binaryScore(acc);
  return out;
}

function auditScore(audit: EligibilityAudit): z.infer<typeof AuditScoreSchema> {
  return { ...audit };
}

/** One tier's snapshot. */
export function tierSnapshot(report: TierReport): TierSnapshot {
  const acc = report.anyAward;
  return {
    n: acc.n,
    events: report.events.size,
    said: acc.n === 0 ? null : acc.sumP / acc.n,
    happened: acc.n === 0 ? null : acc.sumY / acc.n,
    brier: acc.n === 0 ? null : brierOf(acc),
    flat: acc.n === 0 ? null : flatBrierOf(acc),
    classes: classScores(report.byClass),
    reviewClasses: classScores(report.byReviewClass),
    reliability: report.reliability.map((bin, i) => ({
      lo: i / RELIABILITY_BIN_COUNT,
      hi: (i + 1) / RELIABILITY_BIN_COUNT,
      n: bin.n,
      said: bin.n === 0 ? null : bin.sumP / bin.n,
      happened: bin.n === 0 ? null : bin.sumY / bin.n,
    })),
    impactRow: { ...report.impactRow },
    ...(report.tier === "dcmp"
      ? { audits: { impact: auditScore(report.impact), engineeringInspiration: auditScore(report.engineeringInspiration), rookieAllStar: auditScore(report.rookieAllStar) } }
      : {}),
    decorationClasses: classScores(report.byDecorationClass),
    seasons: seasonScores(report.bySeason),
    rookieSeasons: seasonScores(report.rookieBySeason),
    impactWon: binaryScore(report.impactWon),
    ...(report.tier === "district"
      ? { heldEarlier: { impact: { ...report.heldEarlier.impact }, engineeringInspiration: { ...report.heldEarlier.engineeringInspiration }, rookieAllStar: { ...report.heldEarlier.rookieAllStar } } }
      : {}),
    slots: { expected: { ...report.slots.expected }, real: { ...report.slots.real } },
  };
}

/** The whole run's snapshot. */
export function scoreSnapshot(
  label: string,
  timestamp: string,
  reports: ReadonlyMap<DistrictTier, TierReport>,
  digest: { digest: string; lines: number },
  seasons: readonly number[] = SCORED_SEASONS
): ScoreSnapshot {
  return {
    label,
    timestamp,
    seasons: [...seasons],
    districtDigest: digest.digest,
    districtDigestLines: digest.lines,
    district: tierSnapshot(reports.get("district")!),
    dcmp: tierSnapshot(reports.get("dcmp")!),
  };
}

export function writeScoreSnapshot(path: string, snapshot: ScoreSnapshot): void {
  writeFileSync(path, `${JSON.stringify(ScoreSnapshotSchema.parse(snapshot), null, 2)}\n`, "utf8");
}

/** Reads and validates a snapshot; a malformed file throws rather than scoring against garbage. */
export function readScoreSnapshot(path: string): ScoreSnapshot {
  return ScoreSnapshotSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** The tolerance gate 4 allows between the Impact row and the Impact draw. */
export const IMPACT_ROW_TOLERANCE = 1e-9;

/** The seasons gate 3 reads rookies in, each on its own. */
export const PASS_BAR_ROOKIE_SEASONS: readonly number[] = [2025, 2026];

/**
 * A class's chance wobble: two standard errors of what happened,
 * `2 sqrt(h (1 - h) / n)`, from the class's own happened rate and size.
 */
export function chanceWobble(happened: number, n: number): number {
  return n > 0 ? 2 * Math.sqrt((happened * (1 - happened)) / n) : 0;
}

const fmt = (value: number | null | undefined, digits = 6): string => (value === null || value === undefined ? "none" : value.toFixed(digits));
const pts = (value: number): string => (value * 100).toFixed(2);

/**
 * THE PASS BAR (quick task 261014-qje), every gate against the BEFORE
 * snapshot, fixed and approved by Jacob before any scoring. Any missing
 * BEFORE field FAILS, and a changed team event count anywhere FAILS.
 *
 *  1. District any award Brier strictly below BEFORE.
 *  2. Class calibration: in each of the four review classes, under the frozen
 *     review rule AND under the Q-09 decoration count, the AFTER gap between
 *     said and happened is at most the BEFORE class's chance wobble, or
 *     strictly smaller than the BEFORE gap; n equal.
 *  3. Rookies in 2025 and in 2026, each season on its own: gap and Brier no
 *     worse than BEFORE; n equal.
 *  4. The district Impact row equals the Impact draw within 1e-9.
 *  5. The district Impact Brier (did this team win Impact) no worse than
 *     BEFORE; n equal.
 *  6. The DCMP any award Brier no worse than BEFORE; n equal.
 *  7. Exactly zero where an award cannot go: DCMP Impact, Engineering
 *     Inspiration and Rookie All Star on ineligible team events; district
 *     Impact, Engineering Inspiration and Rookie All Star on a team that
 *     already won that same award at an earlier week district event.
 */
export function passBarGates(before: ScoreSnapshot, district: TierReport, dcmp: TierReport): AcceptanceGate[] {
  const after = tierSnapshot(district);
  const afterDcmp = tierSnapshot(dcmp);
  const gates: AcceptanceGate[] = [];

  // 1
  {
    const b = before.district;
    const sameN = after.n === b.n;
    gates.push({
      name: "1 district any award Brier strictly below BEFORE",
      pass: sameN && after.brier !== null && b.brier !== null && after.brier < b.brier,
      detail: `BEFORE ${fmt(b.brier)} (n=${String(b.n)}), AFTER ${fmt(after.brier)} (n=${String(after.n)})${sameN ? "" : " n MISMATCH"}`,
    });
  }

  // 2
  {
    const details: string[] = [];
    let pass = true;
    const views = [
      ["frozen review rule", before.district.reviewClasses, after.reviewClasses],
      ["Q-09 decoration count", before.district.decorationClasses, after.decorationClasses],
    ] as const;
    for (const [viewName, beforeClasses, afterClasses] of views) {
      for (const label of REVIEW_CLASSES) {
        const b = beforeClasses?.[label];
        const a = afterClasses?.[label];
        if (b === undefined || a === undefined) {
          pass = false;
          details.push(`${viewName} ${label}: missing ${b === undefined ? "BEFORE" : "AFTER"}`);
          continue;
        }
        const wobble = chanceWobble(b.happened, b.n);
        const gapBefore = Math.abs(b.said - b.happened);
        const gapAfter = Math.abs(a.said - a.happened);
        const sameN = a.n === b.n;
        const inside = gapAfter <= wobble;
        const smaller = gapAfter < gapBefore;
        const ok = sameN && (inside || smaller);
        if (!ok) pass = false;
        details.push(
          `${viewName} ${label}: AFTER gap ${pts(gapAfter)} points, wobble ${pts(wobble)}, BEFORE gap ${pts(gapBefore)}` +
            (sameN ? ` (n=${String(a.n)})` : ` (n MISMATCH: BEFORE ${String(b.n)}, AFTER ${String(a.n)})`) +
            (ok ? (inside ? " inside the wobble" : " smaller than BEFORE") : " FAILS")
        );
      }
    }
    gates.push({ name: "2 class calibration, each class inside its chance wobble or smaller than BEFORE, same team events", pass, detail: details.join("; ") });
  }

  // 3
  {
    const details: string[] = [];
    let pass = true;
    for (const season of PASS_BAR_ROOKIE_SEASONS) {
      const b = before.district.rookieSeasons?.[String(season)];
      const a = after.rookieSeasons?.[String(season)];
      if (b === undefined || a === undefined || b.said === null || b.happened === null || b.brier === null || a.said === null || a.happened === null || a.brier === null) {
        pass = false;
        details.push(`${String(season)}: missing ${b === undefined || b.brier === null ? "BEFORE" : "AFTER"}`);
        continue;
      }
      const gapBefore = Math.abs(b.said - b.happened);
      const gapAfter = Math.abs(a.said - a.happened);
      const sameN = a.n === b.n;
      const ok = sameN && gapAfter <= gapBefore && a.brier <= b.brier;
      if (!ok) pass = false;
      details.push(
        `${String(season)}: gap ${pts(gapBefore)} to ${pts(gapAfter)} points, Brier ${fmt(b.brier)} to ${fmt(a.brier)}` +
          (sameN ? ` (n=${String(a.n)})` : ` (n MISMATCH: BEFORE ${String(b.n)}, AFTER ${String(a.n)})`) +
          (ok ? "" : " FAILS")
      );
    }
    gates.push({ name: "3 rookies in 2025 and in 2026, gap and Brier no worse than BEFORE", pass, detail: details.join("; ") });
  }

  // 4
  {
    const diff = district.impactRow.said - district.impactRow.impactDraw;
    gates.push({
      name: "4 district Impact row equals the Impact draw",
      pass: district.anyAward.n > 0 && Math.abs(diff) <= IMPACT_ROW_TOLERANCE,
      detail:
        `AFTER said ${district.impactRow.said.toFixed(6)}, Impact draw ${district.impactRow.impactDraw.toFixed(6)}, difference ${diff.toExponential(3)}, real Impact wins ${String(district.impactRow.realWins)}; ` +
        `BEFORE said ${before.district.impactRow.said.toFixed(6)}, Impact draw ${before.district.impactRow.impactDraw.toFixed(6)}`,
    });
  }

  // 5
  {
    const b = before.district.impactWon;
    const a = after.impactWon!;
    const sameN = b !== undefined && a.n === b.n;
    gates.push({
      name: "5 district Impact Brier (did this team win Impact) no worse than BEFORE",
      pass: b !== undefined && sameN && b.brier !== null && a.brier !== null && a.brier <= b.brier,
      detail:
        b === undefined
          ? `missing BEFORE; AFTER ${fmt(a.brier)} (n=${String(a.n)})`
          : `BEFORE ${fmt(b.brier)} (n=${String(b.n)}), AFTER ${fmt(a.brier)} (n=${String(a.n)})${sameN ? "" : " n MISMATCH"}`,
    });
  }

  // 6
  {
    const b = before.dcmp;
    const sameN = afterDcmp.n === b.n;
    gates.push({
      name: "6 DCMP any award Brier no worse than BEFORE",
      pass: sameN && afterDcmp.brier !== null && b.brier !== null && afterDcmp.brier <= b.brier,
      detail: `BEFORE ${fmt(b.brier)} (n=${String(b.n)}), AFTER ${fmt(afterDcmp.brier)} (n=${String(afterDcmp.n)})${sameN ? "" : " n MISMATCH"}`,
    });
  }

  // 7
  {
    const dcmpAudits = [
      ["Impact", dcmp.impact],
      ["Engineering Inspiration", dcmp.engineeringInspiration],
      ["Rookie All Star", dcmp.rookieAllStar],
    ] as const;
    const held = [
      ["Impact", district.heldEarlier.impact],
      ["Engineering Inspiration", district.heldEarlier.engineeringInspiration],
      ["Rookie All Star", district.heldEarlier.rookieAllStar],
    ] as const;
    const dcmpZero = dcmp.anyAward.n > 0 && dcmpAudits.every(([, audit]) => audit.onIneligible === 0 && audit.cellMassOnIneligible === 0);
    const districtZero = district.anyAward.n > 0 && held.every(([, audit]) => audit.mass === 0);
    gates.push({
      name: "7 exactly zero where an award cannot go (DCMP ineligible team events; district earlier week holders of the same award)",
      pass: dcmpZero && districtZero,
      detail:
        `DCMP ${dcmpAudits.map(([label, audit]) => `${label} ${String(audit.onIneligible)} award / ${String(audit.cellMassOnIneligible)} cell`).join(", ")}; ` +
        `district ${held.map(([label, audit]) => `${label} ${String(audit.mass)} on ${String(audit.teamEvents)} holder team events`).join(", ")}`,
    });
  }
  return gates;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "expect-district-digest": { type: "string" },
      "write-snapshot": { type: "string" },
      before: { type: "string" },
      label: { type: "string" },
    },
    strict: true,
  });
  const expectedDigest = values["expect-district-digest"];
  const beforePath = values.before;
  const snapshotPath = values["write-snapshot"];
  const before = beforePath === undefined ? undefined : readScoreSnapshot(beforePath);
  console.log(`AWARD MODEL SCORE: the shipped award cell, walk forward, per tier.`);
  console.log(`seasons:    ${SCORED_SEASONS.join(", ")}`);
  console.log(`population: district_rankings entries (own district_cmp decides the tier), events with any award row, fields of at least ${String(MIN_SCORED_FIELD_SIZE)}`);
  console.log(`odds:       eventAwardOutcomeOdds, the same resolution simulateDistrictEvent draws from`);
  console.log(`credential: none. Read only corpus, no network request, no environment variable.`);
  console.log(``);
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const load = loadScoredTeamEvents(db);
    const reports = scoreTeamEvents(load.rows);
    for (const tier of ["dcmp", "district"] as const) {
      for (const line of tierReportLines(reports.get(tier)!)) console.log(line);
      console.log(``);
    }
    console.log(`team events with an unknown rookie state (priced as their own class): ${String(load.unknownRookieStateTeamEvents)}`);
    console.log(`district tier team events touching a null week (never earlier, Q-05): ${String(load.nullWeekTeamEvents)}`);
    const digest = districtOddsDigest(load.rows);
    console.log(`DISTRICT TIER DIGEST: ${digest.digest} (${String(digest.lines)} team events)`);
    console.log(``);
    if (snapshotPath !== undefined) {
      const label = values.label ?? basename(snapshotPath).replace(/\.json$/, "");
      writeScoreSnapshot(snapshotPath, scoreSnapshot(label, new Date().toISOString(), reports, digest));
      console.log(`snapshot written: ${snapshotPath} (label ${label})`);
      console.log(``);
    }
    let gates: AcceptanceGate[];
    if (before === undefined) {
      gates = acceptanceGates(reports.get("dcmp")!, digest.digest, expectedDigest);
    } else {
      console.log(`BEFORE snapshot: ${beforePath!} (label ${before.label}, ${before.timestamp})`);
      console.log(`district digest BEFORE ${before.districtDigest}, AFTER ${digest.digest}`);
      console.log(``);
      gates = passBarGates(before, reports.get("district")!, reports.get("dcmp")!);
    }
    for (const line of gateLines(gates)) console.log(line);
    if (gates.some((gate) => !gate.pass)) process.exitCode = 1;
  } finally {
    db.close();
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("score:award-model failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
