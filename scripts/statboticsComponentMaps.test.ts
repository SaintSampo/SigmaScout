/**
 * Proof for `statboticsComponentMaps.ts` — mechanism 1 sub-gap 1a, 2024 only
 * (quick task 260911-pon).
 *
 * Four things are proven, against REAL 2024 corpus payloads rather than
 * invented numbers:
 *
 *  1. the emitted component names are exactly two, pinned by EQUALITY;
 *  2. the no-foul total equals the shipped map's `auto + teleop + endgame`
 *     exactly, for every sampled alliance-side;
 *  3. it also equals `totalPoints - foulPoints - adjustPoints` off the same
 *     raw payload — reference section 2's additive identity, CHECKED against
 *     data rather than assumed;
 *  4. `foulsCommitted` is bit-identical to the shipped map's, and the shipped
 *     `breakdown2024` object is UNTOUCHED after this map has been used.
 *
 * Number 4's second half is the anti-monkey-patch guard.
 * `experiments/260910-4x0/granularity.ts` built its arms by assigning over
 * `breakdown2024.components` and `breakdown2024.parse`; the `componentMapArm`
 * seam exists to retire that, and this test exists so the pattern cannot
 * silently return.
 *
 * Reads `data/corpus.sqlite` read-only and SKIPS with an explicit message if
 * the corpus is absent, so a fresh clone fails for the right reason or not at
 * all.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { breakdown2024 } from "../packages/core/algorithms/breakdown/2024.js";
import { FOULS_COMMITTED_COMPONENT } from "../packages/core/algorithms/breakdown/constants.js";
import {
  NO_FOUL_POINTS_COMPONENT,
  statboticsScoreRead2024,
  statboticsScoreReadMapForSeason,
} from "./statboticsComponentMaps.js";

const CORPUS_PATH = "data/corpus.sqlite";
const SAMPLE_SIZE = 2000;
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

/**
 * The shipped 2024 map's component names, restated here as an EQUALITY pin
 * rather than read off the object. A test that iterated the live list would
 * silently accept a new entry appearing; only an equality pin fails loudly,
 * which is the whole point of the untouched-shipped-map guard below.
 */
const SHIPPED_2024_COMPONENTS = ["auto", "teleop", "endgame", "adjust", "foulsCommitted"] as const;

interface SampledRow {
  match_key: string;
  event_key: string;
  score_breakdown_raw: string;
}

function sample2024(limit: number): SampledRow[] {
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    return db
      .prepare(
        `SELECT m.match_key, m.event_key, m.score_breakdown_raw
           FROM matches m
           JOIN events e ON e.event_key = m.event_key
          WHERE e.year = 2024 AND m.has_score_breakdown = 1 AND m.winner IS NOT NULL AND e.is_offseason = 0
          ORDER BY m.match_key ASC
          LIMIT ?`
      )
      .all(limit) as SampledRow[];
  } finally {
    db.close();
  }
}

function numberField(raw: Record<string, Record<string, unknown> | undefined>, side: "red" | "blue", key: string): number {
  const value = raw[side]?.[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`corpus payload ${side}.${key} missing or non-finite`);
  }
  return value;
}

describe("statboticsScoreRead2024 — the emitted shape", () => {
  it("emits exactly two components, pinned by equality", () => {
    // EQUALITY, not a membership loop. A loop over a hardcoded list would pass
    // unchanged if a third component appeared; this fails.
    expect([...statboticsScoreRead2024.components]).toEqual([NO_FOUL_POINTS_COMPONENT, FOULS_COMMITTED_COMPONENT]);
    expect([...statboticsScoreRead2024.components]).toEqual(["noFoulPoints", "foulsCommitted"]);
  });

  it("is live for 2024 and inert for every other corpus season", () => {
    expect(statboticsScoreReadMapForSeason(2024)).toBe(statboticsScoreRead2024);
    for (const season of [2016, 2017, 2018, 2019, 2022, 2023, 2025, 2026]) {
      expect(statboticsScoreReadMapForSeason(season)).toBeUndefined();
    }
  });
});

describe.skipIf(!CORPUS_AVAILABLE)("statboticsScoreRead2024 — against real 2024 corpus breakdowns", () => {
  const rows = CORPUS_AVAILABLE ? sample2024(SAMPLE_SIZE) : [];

  it("sampled a non-empty population", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it("emits the shipped map's auto + teleop + endgame, exactly, on every sampled side", () => {
    const mismatches: string[] = [];
    for (const row of rows) {
      const raw: unknown = JSON.parse(row.score_breakdown_raw);
      for (const side of ["red", "blue"] as const) {
        const shipped = breakdown2024.parse(raw, side);
        const faithful = statboticsScoreRead2024.parse(raw, side);
        const expected = shipped["auto"]! + shipped["teleop"]! + shipped["endgame"]!;
        if (faithful[NO_FOUL_POINTS_COMPONENT] !== expected) {
          mismatches.push(`${row.match_key}/${side}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("equals totalPoints - foulPoints - adjustPoints — the additive identity, checked against data", () => {
    // Reference section 2's shared cleaner DEFINES
    // `no_foul_points = score - foulPoints - adjustPoints`. If this fails on
    // some matches the count and the event keys are reported rather than
    // papered over, because a residual here would be TBA's own arithmetic and
    // the next reader needs to see which events carry it.
    const failures: { match: string; event: string; side: string; gap: number }[] = [];
    for (const row of rows) {
      const raw = JSON.parse(row.score_breakdown_raw) as Record<string, Record<string, unknown> | undefined>;
      for (const side of ["red", "blue"] as const) {
        const faithful = statboticsScoreRead2024.parse(raw, side);
        const identity =
          numberField(raw, side, "totalPoints") -
          numberField(raw, side, "foulPoints") -
          numberField(raw, side, "adjustPoints");
        const gap = faithful[NO_FOUL_POINTS_COMPONENT]! - identity;
        if (gap !== 0) failures.push({ match: row.match_key, event: row.event_key, side, gap });
      }
    }
    if (failures.length > 0) {
      const events = [...new Set(failures.map((f) => f.event))].join(", ");
      throw new Error(
        `additive identity failed on ${failures.length} of ${rows.length * 2} sampled sides; events: ${events}; ` +
          `first: ${JSON.stringify(failures[0])}`
      );
    }
    expect(failures).toEqual([]);
  });

  it("carries foulsCommitted through bit-identically", () => {
    for (const row of rows) {
      const raw: unknown = JSON.parse(row.score_breakdown_raw);
      for (const side of ["red", "blue"] as const) {
        const shipped = breakdown2024.parse(raw, side);
        const faithful = statboticsScoreRead2024.parse(raw, side);
        expect(faithful[FOULS_COMMITTED_COMPONENT]).toBe(shipped[FOULS_COMMITTED_COMPONENT]);
      }
    }
  });

  it("leaves the shipped breakdown2024 object untouched — the anti-monkey-patch guard", () => {
    const parseBefore = breakdown2024.parse;
    const row = rows[0]!;
    const raw: unknown = JSON.parse(row.score_breakdown_raw);
    statboticsScoreRead2024.parse(raw, "red");
    statboticsScoreRead2024.parse(raw, "blue");

    expect([...breakdown2024.components]).toEqual([...SHIPPED_2024_COMPONENTS]);
    expect(breakdown2024.parse).toBe(parseBefore);
    // And the shipped parse still emits its own five components, not this
    // map's two — i.e. nothing was assigned over it.
    expect(Object.keys(breakdown2024.parse(raw, "red")).sort()).toEqual([...SHIPPED_2024_COMPONENTS].sort());
  });
});
