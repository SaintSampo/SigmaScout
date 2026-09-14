/**
 * Corpus-wide RP reconciliation: every bonus flag and summed RP total, recomputed from
 * `score_breakdown_raw`, must reproduce TBA's recorded value. Follows
 * `breakdown/reconciliation.test.ts`'s shape (corpus guard, read-only open,
 * offseason exclusion, explicit skip rather than a silent pass).
 *
 * Sample: the full season population of played, non-offseason `qm` matches with a
 * breakdown. A prefix cap would hide a tier-concentrated failure, because event keys
 * sort alphabetically and higher-tier events cluster.
 *
 * A few season/bonus pairs carry named tolerances for measured residuals (data
 * artifacts or modeling gaps, never a threshold error, never widened for a rule
 * change); everything else reconciles at exactly 0 mismatches at every tier.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../../corpus/db.js";
import { eventTierFor, type EventTier } from "./constants.js";
import { RP_REGISTERED_SEASONS, rpRuleModuleForSeason } from "./rules.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

interface RpSampleRow {
  match_key: string;
  event_key: string;
  event_type: number;
  winner: "red" | "blue" | "tie";
  red_rp_earned: number | null;
  blue_rp_earned: number | null;
  score_breakdown_raw: string;
}

interface EliminationRow {
  match_key: string;
  red_rp_earned: number | null;
  blue_rp_earned: number | null;
}

/** Full season population; no `LIMIT` (see file header). */
function sampleQualMatches(db: ReturnType<typeof openCorpusReadOnly>, year: number): RpSampleRow[] {
  return db
    .prepare(
      `SELECT m.match_key, m.event_key, e.event_type, m.winner,
              m.red_rp_earned, m.blue_rp_earned, m.score_breakdown_raw
       FROM matches m
       JOIN events e ON e.event_key = m.event_key
       WHERE e.year = ? AND m.comp_level = 'qm' AND m.has_score_breakdown = 1
         AND m.winner IS NOT NULL AND e.is_offseason = 0
       ORDER BY m.match_key ASC`
    )
    .all(year) as RpSampleRow[];
}

/** Full elimination population: no `has_score_breakdown` filter, no `LIMIT`. */
function eliminationRows(db: ReturnType<typeof openCorpusReadOnly>, year: number): EliminationRow[] {
  return db
    .prepare(
      `SELECT m.match_key, m.red_rp_earned, m.blue_rp_earned
       FROM matches m
       JOIN events e ON e.event_key = m.event_key
       WHERE e.year = ? AND m.comp_level != 'qm' AND m.winner IS NOT NULL AND e.is_offseason = 0`
    )
    .all(year) as EliminationRow[];
}

/** Missing-breakdown population — reported, not asserted, so the fallback path is scoped against a measured population. */
function missingBreakdownCount(db: ReturnType<typeof openCorpusReadOnly>, year: number): { missing: number; total: number } {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN m.has_score_breakdown = 0 THEN 1 ELSE 0 END) AS missing,
         COUNT(*) AS total
       FROM matches m
       JOIN events e ON e.event_key = m.event_key
       WHERE e.year = ? AND m.comp_level = 'qm' AND m.winner IS NOT NULL AND e.is_offseason = 0`
    )
    .get(year) as { missing: number; total: number };
  return row;
}

/** Measured exception rate plus a small margin per `(season, bonus, eventType)`. Must never be widened to cover a rule change. */
interface Tolerance {
  season: number;
  bonus: string;
  eventTypes: readonly number[];
  /** Measured exception rate (mismatches / population), plus a small margin. */
  rate: number;
}

const KNOWN_TOLERANCES: readonly Tolerance[] = [
  // 2016 Capture: one false positive in 22,158 sides (`2016melew_qm24` red). Only type 1 is listed;
  // every other tier stays bound to 0 by the absence of an entry.
  { season: 2016, bonus: "capture", eventTypes: [1], rate: 0.0005 },
  // 2022 Cargo: small mismatch rate at Regional/District running in both directions, so a data
  // artifact rather than a threshold error (which only misses in one direction).
  { season: 2022, bonus: "cargoBonus", eventTypes: [0, 1, 2, 3, 5, 100], rate: 0.005 },
  // 2024 Ensemble: ~7-7.8% residual from the on-stage-robot-count condition, spread across ~185
  // events; 0.085 keeps a margin above the measured ceiling.
  { season: 2024, bonus: "ensembleBonus", eventTypes: [0, 1, 2, 3, 5, 100], rate: 0.085 },
  // 2025 Auto: "No" cannot distinguish "did not leave" from "never enabled"; ~2% overall.
  { season: 2025, bonus: "autoBonus", eventTypes: [0, 1, 2, 3, 5, 100], rate: 0.03 },
  // 2025 Coral: the gate needs BOTH alliances' coopertitionCriteriaMet. Residuals are all false
  // positives; 0.005 keeps a margin above the measured ceiling.
  { season: 2025, bonus: "coralBonus", eventTypes: [0, 1, 2, 3, 5, 100], rate: 0.005 },
  // 2025 Barge: ~4% residual, mostly base tier and always a false negative there; under 1% elsewhere.
  { season: 2025, bonus: "bargeBonus", eventTypes: [0, 1, 2, 3, 5, 100], rate: 0.05 },
  // 2019 Complete Rocket: the recomputed rule only under-fires (0 false positives at every tier).
  // Tier-varying, about 1.4% at base to 3.8% higher; 0.04 keeps a margin above the ceiling.
  { season: 2019, bonus: "completeRocket", eventTypes: [0, 1, 2, 3, 5, 100], rate: 0.04 },
];

function toleranceFor(season: number, bonus: string, eventType: number): Tolerance | undefined {
  return KNOWN_TOLERANCES.find((t) => t.season === season && t.bonus === bonus && t.eventTypes.includes(eventType));
}

/**
 * Summed RP inherits the bonus-flag tolerances: one mismatched flag shifts the total by
 * exactly 1, so the summed rate cannot exceed the sum of that tier's bonus rates.
 * Reusing the same constants keeps the two from drifting apart.
 */
function summedRpToleranceFor(season: number, eventType: number): number {
  return KNOWN_TOLERANCES.filter((t) => t.season === season && t.eventTypes.includes(eventType)).reduce((sum, t) => sum + t.rate, 0);
}

describe.each(RP_REGISTERED_SEASONS)("season %i RP reconciliation", (year) => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found — run the ingest pipeline (pnpm ingest) first`, () => {});
    return;
  }

  const module = rpRuleModuleForSeason(year);
  const db = openCorpusReadOnly(CORPUS_PATH);
  let rows: RpSampleRow[];
  try {
    rows = sampleQualMatches(db, year);
  } finally {
    db.close();
  }

  it(`samples at least one played ${year} qm match with a score breakdown`, () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it("bonus flag reconciliation: recomputed bonusFlags === TBA's own recordedBonusFlags, grouped by event_type and bonus name", () => {
    // groupKey -> { mismatch: number; total: number }
    const groups = new Map<string, { mismatch: number; total: number }>();

    for (const row of rows) {
      const rawJson: unknown = JSON.parse(row.score_breakdown_raw);
      for (const side of ["red", "blue"] as const) {
        const parsed = module.parse(rawJson, side, row.event_type);
        for (const bonus of module.bonusNames) {
          const key = `${row.event_type}|${bonus}`;
          const bucket = groups.get(key) ?? { mismatch: 0, total: 0 };
          bucket.total++;
          if (parsed.bonusFlags[bonus] !== parsed.recordedBonusFlags[bonus]) bucket.mismatch++;
          groups.set(key, bucket);
        }
      }
    }

    // Print the full per-event_type, per-bonus mismatch report before asserting.
    const report = [...groups.entries()]
      .map(([key, { mismatch, total }]) => {
        const [eventType, bonus] = key.split("|") as [string, string];
        const rate = total > 0 ? mismatch / total : 0;
        return { eventType: Number(eventType), bonus, mismatch, total, rate: `${(rate * 100).toFixed(3)}%` };
      })
      .sort((a, b) => a.bonus.localeCompare(b.bonus) || a.eventType - b.eventType);
    // eslint-disable-next-line no-console
    console.log(`\n[RP reconciliation ${year}] bonus flag mismatch report:`, JSON.stringify(report, null, 2));

    for (const [key, { mismatch, total }] of groups) {
      const [eventTypeStr, bonus] = key.split("|") as [string, string];
      const eventType = Number(eventTypeStr);
      const tolerance = toleranceFor(year, bonus, eventType);
      const rate = total > 0 ? mismatch / total : 0;
      if (tolerance !== undefined) {
        expect(
          rate <= tolerance.rate,
          `season ${year} ${bonus} at event_type ${eventType}: measured rate ${rate} exceeds the named tolerance ${tolerance.rate} — this tolerance covers a known data artifact / documented modeling gap and must never be widened to cover a NEW rule error`
        ).toBe(true);
      } else {
        expect(mismatch, `season ${year} ${bonus} at event_type ${eventType}: ${mismatch}/${total} mismatches with no named tolerance — this is a rule error, fix the threshold table (must never be chased by special-casing an event key)`).toBe(0);
      }
    }
  });

  it("summed RP reconciliation: (winRp | tieRp | 0) + totalRp === red_rp_earned / blue_rp_earned", () => {
    // groupKey (event_type) -> { mismatch: number; total: number }
    const groups = new Map<number, { mismatch: number; total: number }>();

    for (const row of rows) {
      if (row.red_rp_earned === null || row.blue_rp_earned === null) continue;
      const rawJson: unknown = JSON.parse(row.score_breakdown_raw);
      for (const side of ["red", "blue"] as const) {
        const parsed = module.parse(rawJson, side, row.event_type);
        const outcome = row.winner === side ? "win" : row.winner === "tie" ? "tie" : "loss";
        const baseRp = outcome === "win" ? parsed.winRp : outcome === "tie" ? parsed.tieRp : 0;
        const summedRp = baseRp + parsed.totalRp;
        const expected = side === "red" ? row.red_rp_earned : row.blue_rp_earned;

        const bucket = groups.get(row.event_type) ?? { mismatch: 0, total: 0 };
        bucket.total++;
        if (summedRp !== expected) bucket.mismatch++;
        groups.set(row.event_type, bucket);
      }
    }

    const report = [...groups.entries()].map(([eventType, { mismatch, total }]) => ({
      eventType,
      mismatch,
      total,
      rate: `${((total > 0 ? mismatch / total : 0) * 100).toFixed(3)}%`,
    }));
    // eslint-disable-next-line no-console
    console.log(`\n[RP reconciliation ${year}] summed-RP mismatch report:`, JSON.stringify(report, null, 2));

    let checked = 0;
    for (const [eventType, { mismatch, total }] of groups) {
      checked += total;
      const allowedRate = summedRpToleranceFor(year, eventType);
      const rate = total > 0 ? mismatch / total : 0;
      if (allowedRate > 0) {
        expect(
          rate <= allowedRate,
          `season ${year} at event_type ${eventType}: summed-RP mismatch rate ${rate} exceeds the tolerance inherited from this event_type's bonus-flag tolerances (${allowedRate}) — must never be widened beyond what the bonus-flag tolerances above already justify`
        ).toBe(true);
      } else {
        expect(mismatch, `season ${year} at event_type ${eventType}: ${mismatch}/${total} summed-RP mismatches with no bonus-flag tolerance to explain them — this is a rule error`).toBe(0);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("2025/2026 pin win RP at 3 via the summed-RP reconciliation above", () => {
    if (year !== 2025 && year !== 2026) return;
    expect(module.winRp).toBe(3);
  });
});

/**
 * For single-condition bonuses with a clean tiered scalar threshold, matches exactly at
 * the threshold must recompute `true` (`>=`, never `>`). Compound conditions are
 * skipped (a single boundary is not well-defined). A tier with no boundary matches is
 * logged explicitly rather than silently passing.
 */
describe("exact-boundary behaviour (>= semantics, must_haves backstop)", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found`, () => {});
    return;
  }

  interface BoundaryCheck {
    season: number;
    bonus: string;
    variable: string;
    threshold: Readonly<Record<EventTier, number>>;
  }

  const CHECKS: readonly BoundaryCheck[] = [
    { season: 2018, bonus: "faceTheBoss", variable: "endgamePoints", threshold: { base: 90, districtChampionship: 90, championship: 90 } },
    { season: 2019, bonus: "habDocking", variable: "habClimbPoints", threshold: { base: 15, districtChampionship: 15, championship: 15 } },
    { season: 2020, bonus: "shieldOperational", variable: "endgamePoints", threshold: { base: 65, districtChampionship: 65, championship: 65 } },
    { season: 2022, bonus: "hangarBonus", variable: "endgamePoints", threshold: { base: 16, districtChampionship: 16, championship: 16 } },
    {
      season: 2023,
      bonus: "activationBonus",
      variable: "totalChargeStationPoints",
      threshold: { base: 26, districtChampionship: 26, championship: 26 },
    },
    { season: 2025, bonus: "bargeBonus", variable: "endGameBargePoints", threshold: { base: 14, districtChampionship: 14, championship: 16 } },
    { season: 2026, bonus: "energized", variable: "hubTotalCount", threshold: { base: 100, districtChampionship: 240, championship: 360 } },
    { season: 2026, bonus: "supercharged", variable: "hubTotalCount", threshold: { base: 360, districtChampionship: 360, championship: 500 } },
    { season: 2026, bonus: "traversal", variable: "totalTowerPoints", threshold: { base: 50, districtChampionship: 50, championship: 50 } },
  ];

  const db = openCorpusReadOnly(CORPUS_PATH);
  let allRows: Map<number, RpSampleRow[]>;
  try {
    allRows = new Map(RP_REGISTERED_SEASONS.map((year) => [year, sampleQualMatches(db, year)]));
  } finally {
    db.close();
  }

  for (const check of CHECKS) {
    it(`${check.season} ${check.bonus}: matches exactly AT a tier's threshold recompute as achieved`, () => {
      const module = rpRuleModuleForSeason(check.season);
      const rows = allRows.get(check.season) ?? [];
      const tiers: readonly EventTier[] = ["base", "districtChampionship", "championship"];
      const foundByTier = new Map<EventTier, number>();

      for (const row of rows) {
        const tier = eventTierFor(row.event_type);
        const thresholdValue = check.threshold[tier];
        const rawJson: unknown = JSON.parse(row.score_breakdown_raw);
        for (const side of ["red", "blue"] as const) {
          const parsed = module.parse(rawJson, side, row.event_type);
          if (parsed.thresholdVariables[check.variable] === thresholdValue) {
            foundByTier.set(tier, (foundByTier.get(tier) ?? 0) + 1);
            expect(
              parsed.bonusFlags[check.bonus],
              `match ${row.match_key} (${side}): ${check.variable}=${thresholdValue} at tier ${tier} did not recompute ${check.bonus} as achieved (>= semantics violated)`
            ).toBe(true);
          }
        }
      }

      for (const tier of tiers) {
        if ((foundByTier.get(tier) ?? 0) === 0) {
          // eslint-disable-next-line no-console
          console.log(`[RP boundary ${check.season} ${check.bonus}] no sampled match sits exactly at the ${tier} threshold (${check.threshold[tier]}) for ${check.variable} — boundary case not observed, not confirmed, at this tier.`);
        }
      }
    });
  }
});

/**
 * Elimination invariant: over every played elimination match, `red_rp_earned` and
 * `blue_rp_earned` are 0.
 *
 * Seasons listed here report elimination RP as SQL `NULL` rather than `0` (from 2018
 * TBA populates an explicit `0`). The invariant holds in both representations; the
 * list pins the representation so an ingest that turns zeros into nulls fails loudly
 * instead of passing under a `?? 0`. Qualification populations carry no nulls.
 */
const NULL_ELIMINATION_RP_SEASONS: readonly number[] = [2016, 2017];

describe.each(RP_REGISTERED_SEASONS)("season %i elimination RP invariant", (year) => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found`, () => {});
    return;
  }

  it("no played elimination match awards a non-zero RP, full population (reported as 0 from 2018 on, as NULL for 2016/2017)", () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    let rows: EliminationRow[];
    try {
      rows = eliminationRows(db, year);
    } finally {
      db.close();
    }

    const reportsNull = NULL_ELIMINATION_RP_SEASONS.includes(year);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const side of ["red", "blue"] as const) {
        const value = side === "red" ? row.red_rp_earned : row.blue_rp_earned;

        // The substantive invariant, in whichever representation the season uses.
        expect(value ?? 0, `match ${row.match_key}: ${side}_rp_earned is a non-zero RP in elimination play`).toBe(0);

        // The representation pin — see NULL_ELIMINATION_RP_SEASONS above.
        if (reportsNull) {
          expect(value, `match ${row.match_key}: ${side}_rp_earned should be NULL in ${year} elimination play`).toBeNull();
        } else {
          expect(value, `match ${row.match_key}: ${side}_rp_earned should be 0 in elimination play`).toBe(0);
        }
      }
    }
  });
});

/**
 * 2024 threshold cross-check: the hardcoded tier table agrees with TBA's shipped
 * per-match `melodyBonusThresholdCoop`/`melodyBonusThresholdNonCoop` values. Those
 * fields are read only here, never for `bonusFlags` (see `2024.ts`).
 */
describe("2024 threshold cross-check (TBA's own shipped thresholds)", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found`, () => {});
    return;
  }

  it("hardcoded MELODY_BONUS_THRESHOLD_* tables agree with melodyBonusThresholdCoop/NonCoop for every sampled 2024 match", () => {
    const module = rpRuleModuleForSeason(2024);
    const db = openCorpusReadOnly(CORPUS_PATH);
    let rows: RpSampleRow[];
    try {
      rows = sampleQualMatches(db, 2024);
    } finally {
      db.close();
    }

    interface Raw2024Side {
      melodyBonusThresholdCoop: number;
      melodyBonusThresholdNonCoop: number;
    }

    let checked = 0;
    for (const row of rows) {
      const rawJson = JSON.parse(row.score_breakdown_raw) as { red: Raw2024Side; blue: Raw2024Side };
      for (const side of ["red", "blue"] as const) {
        const parsed = module.parse(rawJson, side, row.event_type);
        const shipped = rawJson[side];
        checked++;
        expect(parsed.thresholdVariables.melodyBonusThresholdNonCoop, `match ${row.match_key} (${side}): hardcoded non-coop threshold disagrees with TBA's shipped value`).toBe(
          shipped.melodyBonusThresholdNonCoop
        );
        expect(parsed.thresholdVariables.melodyBonusThresholdCoop, `match ${row.match_key} (${side}): hardcoded coop threshold disagrees with TBA's shipped value`).toBe(
          shipped.melodyBonusThresholdCoop
        );
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

/**
 * 2025 Coral coopertition regression pin (synthetic, runs without the corpus): the own
 * alliance's `coopertitionCriteriaMet` alone must not relax 4-of-4 to 3-of-4; both
 * alliances' flags are required.
 */
describe("2025 Coral Bonus: coopertition requires BOTH alliances' criteria met (regression pin)", () => {
  const module = rpRuleModuleForSeason(2025);

  function reefSide(overrides: { trough: number; botRow: number; midRow: number; topRow: number }) {
    return { trough: overrides.trough, tba_botRowCount: overrides.botRow, tba_midRowCount: overrides.midRow, tba_topRowCount: overrides.topRow };
  }

  function makeSide(opts: { coopertitionCriteriaMet: boolean; reef: { trough: number; botRow: number; midRow: number; topRow: number } }) {
    const zeroReef = { trough: 0, tba_botRowCount: 0, tba_midRowCount: 0, tba_topRowCount: 0 };
    return {
      autoLineRobot1: "Yes",
      autoLineRobot2: "Yes",
      autoLineRobot3: "Yes",
      autoCoralCount: 1,
      autoReef: zeroReef,
      teleopReef: reefSide(opts.reef),
      endGameBargePoints: 0,
      coopertitionCriteriaMet: opts.coopertitionCriteriaMet,
      autoBonusAchieved: false,
      coralBonusAchieved: false,
      bargeBonusAchieved: false,
    };
  }

  it("own alliance meets coopertition criteria, opponent does NOT: 3-of-4 relaxation must NOT apply (coralBonus false, not true)", () => {
    // own: 3 of 4 levels at >=5 (topRow=0). Passes an own-flag-only gate, must fail the
    // both-alliances rule (falls back to strict 4-of-4).
    const red = makeSide({ coopertitionCriteriaMet: true, reef: { trough: 5, botRow: 5, midRow: 5, topRow: 0 } });
    const blue = makeSide({ coopertitionCriteriaMet: false, reef: { trough: 0, botRow: 0, midRow: 0, topRow: 0 } });
    const rawJson = { red, blue };

    const parsedRed = module.parse(rawJson, "red", 0);
    expect(parsedRed.bonusFlags.coralBonus, "own-alone coopertitionCriteriaMet must not relax the 4-of-4 requirement when the opponent's criteria are not met").toBe(false);
  });

  it("BOTH alliances meet coopertition criteria: 3-of-4 relaxation DOES apply (coralBonus true)", () => {
    const red = makeSide({ coopertitionCriteriaMet: true, reef: { trough: 5, botRow: 5, midRow: 5, topRow: 0 } });
    const blue = makeSide({ coopertitionCriteriaMet: true, reef: { trough: 0, botRow: 0, midRow: 0, topRow: 0 } });
    const rawJson = { red, blue };

    const parsedRed = module.parse(rawJson, "red", 0);
    expect(parsedRed.bonusFlags.coralBonus, "when BOTH alliances meet coopertition criteria, 3-of-4 levels at threshold should achieve the bonus").toBe(true);
  });
});

/** Missing-breakdown population: reported, not asserted, so the fallback path is scoped against a measured population. */
describe("missing-breakdown population report (informational)", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found`, () => {});
    return;
  }

  it.each(RP_REGISTERED_SEASONS)("season %i: has_score_breakdown = 0 rate among played qm matches", (year) => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    let counts: { missing: number; total: number };
    try {
      counts = missingBreakdownCount(db, year);
    } finally {
      db.close();
    }
    const rate = counts.total > 0 ? counts.missing / counts.total : 0;
    // eslint-disable-next-line no-console
    console.log(`[RP missing-breakdown ${year}] ${counts.missing}/${counts.total} (${(rate * 100).toFixed(2)}%)`);
    expect(counts.total).toBeGreaterThan(0);
  });
});
