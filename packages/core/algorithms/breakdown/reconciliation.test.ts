/**
 * Corpus-backed proof (D-01, D-02) that each registered season's component
 * map reconciles against the alliance's own `totalPoints`: for every
 * sampled match, sum(offensive components of one alliance) +
 * foulsCommitted(the OTHER alliance) === that alliance's `totalPoints` —
 * fouls are attributed to whichever alliance committed them, not the
 * alliance that received the bonus (see each season module's own
 * `foulsCommitted` comment for the derivation).
 *
 * Reads `data/corpus.sqlite` read-only (T-01-13's guarantee: a write
 * attempted through this handle fails at the SQLite layer). Skips with an
 * explicit message, not a silent pass, if the corpus file is absent, so a
 * fresh clone's CI run does not fail for the wrong reason.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../../../corpus/db.js";
import { componentMapForSeason, FOULS_COMMITTED_COMPONENT } from "./index.js";

const CORPUS_PATH = "data/corpus.sqlite";
const SAMPLE_SIZE = 2000;
const RECONCILIATION_TOLERANCE = 1e-6;
/**
 * Seasons registered in `breakdown/index.ts` at this point in the plan.
 * Task 1 registers 2022/2023 (2024 already registered by plan 02-01); Task
 * 2 extends this list to 2025/2026 as those season modules land (D-19:
 * additive, no dispatch branching).
 */
const REGISTERED_SEASONS = [2022, 2023, 2024] as const;

interface SampledBreakdownRow {
  match_key: string;
  score_breakdown_raw: string;
}

/**
 * Offseason events (`is_offseason = 1`, TBA `event_type = 99`) are excluded
 * from the sample — same discipline `selectMatchesChronological`'s
 * `excludeOffseason` option already applies for "anything feeding ratings
 * or scoring" (D-06). Offseason breakdowns are self-reported by event
 * organizers rather than FMS-generated and are not guaranteed to follow
 * the official season schema: a live corpus check found offseason matches
 * missing fields as basic as `adjustPoints` entirely. That is a genuine
 * data-shape difference in the corpus, not a component-map defect, so this
 * reconciliation proof is scoped to official (non-offseason) matches, the
 * population every per-season map is actually built to parse.
 */
function sampleBreakdowns(year: number, limit: number): SampledBreakdownRow[] {
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    return db
      .prepare(
        `SELECT m.match_key, m.score_breakdown_raw
         FROM matches m
         JOIN events e ON e.event_key = m.event_key
         WHERE e.year = ? AND m.has_score_breakdown = 1 AND m.winner IS NOT NULL AND e.is_offseason = 0
         ORDER BY m.match_key ASC
         LIMIT ?`
      )
      .all(year, limit) as SampledBreakdownRow[];
  } finally {
    db.close();
  }
}

function allianceTotalPoints(rawJson: unknown, side: "red" | "blue"): number {
  const obj = rawJson as Record<string, Record<string, unknown> | undefined>;
  const totalPoints = obj[side]?.["totalPoints"];
  if (typeof totalPoints !== "number" || !Number.isFinite(totalPoints)) {
    throw new Error(`corpus fixture ${side}.totalPoints missing or non-finite`);
  }
  return totalPoints;
}

const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

describe.each(REGISTERED_SEASONS)("season %i component map reconciliation (D-01, D-02)", (year) => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found — run the ingest pipeline (pnpm ingest) first`, () => {});
    return;
  }

  const rows = sampleBreakdowns(year, SAMPLE_SIZE);

  it(`samples at least ${SAMPLE_SIZE} played ${year} matches with a score breakdown`, () => {
    expect(rows.length).toBeGreaterThanOrEqual(SAMPLE_SIZE);
  });

  it.each(["red", "blue"] as const)(
    `%s alliance: sum(offensive components) + foulsCommitted(opponent) === totalPoints`,
    (side) => {
      const map = componentMapForSeason(year);
      const opponentSide = side === "red" ? "blue" : "red";

      for (const row of rows) {
        const rawJson: unknown = JSON.parse(row.score_breakdown_raw);
        const ownComponents = map.parse(rawJson, side);
        const opponentComponents = map.parse(rawJson, opponentSide);

        const offensiveSum = Object.entries(ownComponents)
          .filter(([name]) => name !== FOULS_COMMITTED_COMPONENT)
          .reduce((sum, [, value]) => sum + value, 0);
        const foulsCommittedByOpponent = opponentComponents[FOULS_COMMITTED_COMPONENT]!;
        const reconciledTotal = offensiveSum + foulsCommittedByOpponent;
        const expectedTotal = allianceTotalPoints(rawJson, side);
        const gap = reconciledTotal - expectedTotal;

        expect(
          Math.abs(gap) < RECONCILIATION_TOLERANCE,
          `match ${row.match_key} (${side}, season ${year}): reconciled total ${reconciledTotal} vs totalPoints ${expectedTotal} (gap ${gap})`
        ).toBe(true);
      }
    }
  );

  it(`no parsed ${year} component record has a key ending in Robot1/Robot2/Robot3`, () => {
    const map = componentMapForSeason(year);
    const row = rows[0];
    if (!row) return;
    const rawJson: unknown = JSON.parse(row.score_breakdown_raw);
    for (const side of ["red", "blue"] as const) {
      const components = map.parse(rawJson, side);
      for (const key of Object.keys(components)) {
        expect(/Robot[123]$/.test(key)).toBe(false);
      }
    }
  });
});

describe("malformed breakdown handling (T-02-01)", () => {
  it("2022: throws rather than emitting a zero when a mapped key is missing", async () => {
    const { breakdown2022 } = await import("./2022.js");
    const side = { autoCargoPoints: 5, teleopCargoPoints: 5, endgamePoints: 5, adjustPoints: 0, foulPoints: 0 };
    // autoTaxiPoints deliberately omitted.
    const malformed = { red: side, blue: side };
    expect(() => breakdown2022.parse(malformed, "red")).toThrow();
  });

  it("2022: throws rather than coercing a non-finite mapped value", async () => {
    const { breakdown2022 } = await import("./2022.js");
    const side = {
      autoTaxiPoints: Number.NaN,
      autoCargoPoints: 5,
      teleopCargoPoints: 5,
      endgamePoints: 5,
      adjustPoints: 0,
      foulPoints: 0,
    };
    const malformed = { red: side, blue: side };
    expect(() => breakdown2022.parse(malformed, "red")).toThrow();
  });

  it("2023: throws rather than emitting a zero when a mapped key is missing", async () => {
    const { breakdown2023 } = await import("./2023.js");
    const side = {
      autoMobilityPoints: 5,
      autoGamePiecePoints: 5,
      teleopGamePiecePoints: 5,
      linkPoints: 0,
      endGameChargeStationPoints: 0,
      endGameParkPoints: 0,
      adjustPoints: 0,
      foulPoints: 0,
    };
    // autoChargeStationPoints deliberately omitted.
    const malformed = { red: side, blue: side };
    expect(() => breakdown2023.parse(malformed, "red")).toThrow();
  });

  it("2023: throws rather than coercing a non-finite mapped value", async () => {
    const { breakdown2023 } = await import("./2023.js");
    const side = {
      autoMobilityPoints: Number.POSITIVE_INFINITY,
      autoGamePiecePoints: 5,
      autoChargeStationPoints: 0,
      teleopGamePiecePoints: 5,
      linkPoints: 0,
      endGameChargeStationPoints: 0,
      endGameParkPoints: 0,
      adjustPoints: 0,
      foulPoints: 0,
    };
    const malformed = { red: side, blue: side };
    expect(() => breakdown2023.parse(malformed, "red")).toThrow();
  });
});
