/**
 * Corpus-backed proof that each registered season's component map
 * reconciles against the alliance's own `totalPoints`: for every sampled
 * match, sum(offensive components of one alliance) + foulsCommitted(the
 * OTHER alliance) === that alliance's `totalPoints` — fouls are attributed
 * to whichever alliance committed them, not the alliance that received the
 * bonus (see each season module's own `foulsCommitted` comment for the
 * derivation).
 *
 * Reads `data/corpus.sqlite` read-only (a write attempted through this
 * handle fails at the SQLite layer). Skips with an explicit message, not a
 * silent pass, if the corpus file is absent, so a fresh clone's CI run does
 * not fail for the wrong reason.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../../../corpus/db.js";
import {
  ADJUST_COMPONENT,
  BREAKDOWN_REGISTERED_SEASONS,
  componentMapForSeason,
  FOULS_COMMITTED_COMPONENT,
  parseBreakdown,
  tryParseBreakdownPair,
} from "./index.js";
import { distributeResidual } from "./fallback.js";
import type { ParsedComponents } from "./constants.js";

const CORPUS_PATH = "data/corpus.sqlite";
const SAMPLE_SIZE = 2000;
const RECONCILIATION_TOLERANCE = 1e-6;
// 2021 is deliberately absent from BREAKDOWN_REGISTERED_SEASONS — no
// standard FRC season was played that year.

interface SampledBreakdownRow {
  match_key: string;
  score_breakdown_raw: string;
}

/**
 * One season's named, capped reconciliation tolerance. A season with no
 * entry here stays at an effective rate of exactly 0.
 *
 * `rate` is the measured exception rate (mismatches / sampled sides) as a
 * decimal fraction, plus a small stated margin — never a guess. `maxAbsGap`
 * caps the absolute size of any tolerated exception; an exception larger
 * than this fails regardless of `rate`, which is what keeps a genuine
 * regression failing even under an otherwise-satisfied rate budget. These
 * tolerances cover measured artifacts in TBA's own arithmetic and must
 * never be widened to cover a component-map error.
 */
interface BreakdownTolerance {
  readonly season: number;
  /** Measured exception rate (mismatches / sampled sides), plus a small margin. */
  readonly rate: number;
  /** Cap on the absolute gap any tolerated exception may show. */
  readonly maxAbsGap: number;
  /** Only set when every observed exception carries the same sign — never encoded from an assumption. */
  readonly direction?: "positive" | "negative";
}

/**
 * 2018: TBA's own roll-up-identity residual, measured over the full
 * official qual population, every exception carrying the same sign.
 * Proven to be TBA's own arithmetic, not a component-map defect, three
 * ways (see `2018.ts`'s file header). `0.008` keeps a small margin above
 * the measured rate.
 */
const KNOWN_BREAKDOWN_TOLERANCES: readonly BreakdownTolerance[] = [
  // 2016: TBA's own roll-up-identity residual, measured over the full
  // official non-offseason population, all comp levels, all exceptions
  // eliminations. Proven to be TBA's arithmetic, not a component-map
  // defect, the same three ways 2018's entry above is. `direction` is
  // deliberately omitted: the observed signs are mixed. `maxAbsGap: 25` is
  // the exact observed magnitude, so any larger gap still fails.
  //
  // 2017 gets no entry: 0 exceptions over the same full all-comp-level
  // population, so its absence here is a measured result.
  { season: 2016, rate: 0.001, maxAbsGap: 25 },
  { season: 2018, rate: 0.008, maxAbsGap: 2, direction: "positive" },
];

function breakdownToleranceFor(season: number): BreakdownTolerance | undefined {
  return KNOWN_BREAKDOWN_TOLERANCES.find((t) => t.season === season);
}

/**
 * Offseason events are excluded from the sample — same discipline
 * `selectMatchesChronological`'s `excludeOffseason` option already applies
 * for anything feeding ratings or scoring. Offseason breakdowns are
 * self-reported by event organizers rather than FMS-generated and are not
 * guaranteed to follow the official season schema (a live corpus check
 * found offseason matches missing fields as basic as `adjustPoints`
 * entirely). That is a genuine data-shape difference, not a component-map
 * defect, so this reconciliation proof is scoped to official matches.
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

describe.each(BREAKDOWN_REGISTERED_SEASONS)("season %i component map reconciliation", (year) => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found — run the ingest pipeline (pnpm ingest) first`, () => {});
    return;
  }

  const rows = sampleBreakdowns(year, SAMPLE_SIZE);

  it(`samples at least ${SAMPLE_SIZE} played ${year} matches with a score breakdown`, () => {
    expect(rows.length).toBeGreaterThanOrEqual(SAMPLE_SIZE);
  });

  it.each(["red", "blue"] as const)(
    `%s alliance: sum(offensive components) + foulsCommitted(opponent) === totalPoints${
      year === 2026 ? " (2026 hubScore nesting)" : ""
    }`,
    (side) => {
      const map = componentMapForSeason(year);
      const opponentSide = side === "red" ? "blue" : "red";

      const exceptions: { matchKey: string; gap: number }[] = [];

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

        if (Math.abs(gap) >= RECONCILIATION_TOLERANCE) {
          exceptions.push({ matchKey: row.match_key, gap });
        }
      }

      const sampledSides = rows.length;
      const rate = sampledSides > 0 ? exceptions.length / sampledSides : 0;
      // eslint-disable-next-line no-console
      console.log(
        `[breakdown reconciliation ${year} ${side}] ${exceptions.length}/${sampledSides} exceptions (${(rate * 100).toFixed(3)}%)` +
          (exceptions.length > 0 ? `, first few: ${JSON.stringify(exceptions.slice(0, 5))}` : "")
      );

      const tolerance = breakdownToleranceFor(year);
      if (tolerance === undefined) {
        expect(
          exceptions.length,
          `season ${year} (${side}): ${exceptions.length} reconciliation exceptions with no named tolerance — this is a component-map error, fix the map rather than adding a tolerance` +
            (exceptions.length > 0 ? ` (first few: ${JSON.stringify(exceptions.slice(0, 5))})` : "")
        ).toBe(0);
      } else {
        const offender = exceptions.find((e) => Math.abs(e.gap) > tolerance.maxAbsGap);
        expect(
          offender === undefined,
          `season ${year} (${side}): exception at match ${offender?.matchKey} has |gap| ${offender ? Math.abs(offender.gap) : 0} exceeding the named tolerance's maxAbsGap ${tolerance.maxAbsGap}`
        ).toBe(true);

        expect(
          rate <= tolerance.rate,
          `season ${year} (${side}): measured rate ${rate} exceeds the named tolerance ${tolerance.rate} — this tolerance covers a measured artifact in TBA's own arithmetic and must never be widened to cover a component-map error`
        ).toBe(true);

        if (tolerance.direction !== undefined) {
          const wrongSign = exceptions.find((e) => (tolerance.direction === "positive" ? e.gap <= 0 : e.gap >= 0));
          expect(
            wrongSign === undefined,
            `season ${year} (${side}): exception at match ${wrongSign?.matchKey} has gap ${wrongSign?.gap}, contradicting the tolerance's recorded direction "${tolerance.direction}"`
          ).toBe(true);
        }
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

describe("malformed breakdown handling", () => {
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

describe("2026: structurally different shape must not silently parse under another season's map", () => {
  it("throws when a real 2026 breakdown is parsed with componentMapForSeason(2025), rather than reading undefined for every field", () => {
    if (!CORPUS_AVAILABLE) return;
    const rows = sampleBreakdowns(2026, 1);
    const row = rows[0];
    if (!row) return;
    const rawJson: unknown = JSON.parse(row.score_breakdown_raw);
    const map2025 = componentMapForSeason(2025);
    expect(() => map2025.parse(rawJson, "red")).toThrow();
  });
});

describe("prototype-pollution regression", () => {
  /**
   * Six sites build `ParsedComponents` with `Object.create(null)` plus a
   * fixed allowlist loop, so a `__proto__`, `constructor`, or `prototype`
   * key in third-party TBA JSON cannot reach `Object.prototype`.
   *
   * The vector is injected into the raw JSON string and driven through
   * `parseBreakdown`, which owns the real `JSON.parse` boundary — the
   * actual path a poisoned corpus row would take. This matters: an object
   * literal written `{ __proto__: {...} }` sets the object's prototype and
   * creates no own property, so a literal-based fixture silently tests
   * nothing. `assertVectorIsLive` below fails loudly if that ever
   * regresses into a tautology.
   */
  const POISON_KEYS = ["__proto__", "constructor", "prototype"] as const;
  const POISON_JSON = POISON_KEYS.map((k) => `"${k}":{"polluted":true}`).join(",") + ",";

  /** Injects the poison keys at the top level AND inside the `red`/`blue` alliance objects. */
  function poison(raw: string): string {
    let out = `{${POISON_JSON}${raw.slice(1)}`;
    for (const side of ["red", "blue"] as const) {
      out = out.replace(`"${side}":{`, `"${side}":{${POISON_JSON}`);
    }
    return out;
  }

  /**
   * Guards the guard: proves the poisoned string really yields an OWN
   * `__proto__` key once parsed, so the assertions below can actually fail.
   */
  function assertVectorIsLive(poisoned: string): void {
    const obj = JSON.parse(poisoned) as Record<string, unknown>;
    for (const key of POISON_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(obj, key)).toBe(true);
    }
    const red = obj["red"] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(red, "__proto__")).toBe(true);
  }

  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found — run the ingest pipeline (pnpm ingest) first`, () => {});
  } else {
    it.each(BREAKDOWN_REGISTERED_SEASONS)(
      "season %i: a poisoned score_breakdown yields a null-prototype record and never touches Object.prototype",
      (year) => {
        const [row] = sampleBreakdowns(year, 1);
        expect(row, `no ${year} corpus fixture`).toBeDefined();

        const poisoned = poison(row!.score_breakdown_raw);
        assertVectorIsLive(poisoned);

        const parsed = parseBreakdown(year, poisoned, "red");
        expect(parsed).not.toBeNull();

        // The T-02-04 control itself.
        expect(Object.getPrototypeOf(parsed!)).toBe(null);

        // The allowlist loop admitted exactly the season's declared
        // components — no poison key became a rating component. A
        // spread-based construction would fail here.
        const declared = [...componentMapForSeason(year).components].sort();
        expect(Object.keys(parsed!).sort()).toEqual(declared);

        // Object.prototype is intact: nothing leaked globally.
        expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
        expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
      }
    );
  }

  it("distributeResidual (fallback.ts, the 6th construction site) returns a null-prototype record", () => {
    // JSON.parse — not a literal — so `__proto__` is a genuine own key.
    const predicted = JSON.parse(`{${POISON_JSON}"alpha":1,"beta":3}`) as ParsedComponents;
    expect(Object.prototype.hasOwnProperty.call(predicted, "__proto__")).toBe(true);

    const result = distributeResidual(100, predicted, ["alpha", "beta"]);

    expect(Object.getPrototypeOf(result)).toBe(null);
    expect(Object.keys(result).sort()).toEqual(["alpha", "beta"]);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("2026 field-rename assertion", () => {
  /**
   * 2026 renames foul fields to majorFoulCount/minorFoulCount. The old
   * field names (foulCount/techFoulCount) must not appear in the
   * implementation except as comments documenting the rename. This test
   * reads the file, strips comments, and asserts zero occurrences of the
   * old field names.
   */
  it("2026.ts: no foulCount or techFoulCount field reads (only comments documenting the rename)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.join(currentDir, "2026.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    // Strip comment lines and block comments from the content.
    // Lines starting with '//' are removed, and /* ... */ blocks are removed.
    let stripped = content
      .split("\n")
      .map((line) => {
        // Remove inline // comments
        const commentIdx = line.indexOf("//");
        if (commentIdx !== -1) {
          return line.substring(0, commentIdx);
        }
        return line;
      })
      .join("\n");

    // Remove /* ... */ block comments
    stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "");

    // Assert zero occurrences of the old field names in non-comment code
    const foulCountMatches = stripped.match(/\bfoulCount\b/g);
    const techFoulCountMatches = stripped.match(/\btechFoulCount\b/g);

    expect(foulCountMatches?.length ?? 0).toBe(0);
    expect(techFoulCountMatches?.length ?? 0).toBe(0);
  });
});

describe("2018 Scale/Switch split source gate", () => {
  /**
   * The corpus reconciliation proof above CANNOT catch a substitution of
   * TBA's fused ownership roll-ups for the required split components,
   * because the fused form reconciles EXACTLY too (see `2018.ts`'s file
   * header, "The roll-up hazards"). This is the identical class of hazard
   * `2019.ts`'s `autoPoints`/`sandStormBonusPoints` numeric-identity roll-up
   * gets its own gate for, in the "2019 roll-up source gate" block below —
   * a comment-stripped source scan is the only thing that can catch it,
   * since the corpus proof alone would pass either way.
   *
   * The negative half (no roll-up field read) is paired with a POSITIVE
   * assertion that both split pairs are actually present in `components` —
   * pinning the decision as a test, not only as a comment.
   */
  it("2018.ts: never reads TBA's fused ownership/roll-up fields or the teleop Force fields (only comments documenting why)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.join(currentDir, "2018.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    let stripped = content
      .split("\n")
      .map((line) => {
        const commentIdx = line.indexOf("//");
        return commentIdx !== -1 ? line.substring(0, commentIdx) : line;
      })
      .join("\n");
    stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "");

    const FORBIDDEN_FIELDS = [
      "autoPoints",
      "teleopPoints",
      "totalPoints",
      "autoOwnershipPoints",
      "teleopOwnershipPoints",
      "teleopSwitchForceSec",
      "teleopScaleForceSec",
    ];

    for (const field of FORBIDDEN_FIELDS) {
      const matches = stripped.match(new RegExp(`\\b${field}\\b`, "g"));
      expect(matches?.length ?? 0, `2018.ts reads forbidden roll-up/Force field "${field}" outside a comment`).toBe(0);
    }
  });

  it("2018.ts: components split BOTH auto and teleop ownership into separate Scale/Switch entries", () => {
    const components = componentMapForSeason(2018).components;
    expect(components).toContain("autoSwitchOwnership");
    expect(components).toContain("autoScaleOwnership");
    expect(components).toContain("teleopSwitchOwnership");
    expect(components).toContain("teleopScaleOwnership");
  });
});

describe("2019 roll-up source gate (BD-1)", () => {
  /**
   * `autoPoints` equals `sandStormBonusPoints` in every observed 2019 row, so
   * reading it in place of the sandstorm field still reconciles EXACTLY — the
   * corpus proof above passes either way (see `2019.ts`'s file header,
   * "Roll-up avoidance"). `teleopPoints` is the sum of the hatch/cargo/climb
   * parts, so reading it beside them double-counts. Same mechanics as the
   * 2018 gate: a comment-stripped source scan, paired with a POSITIVE
   * assertion that the independent components are the ones in `components`.
   */
  it("2019.ts: never reads TBA's autoPoints/teleopPoints/totalPoints roll-ups (only comments documenting why)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.join(currentDir, "2019.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    let stripped = content
      .split("\n")
      .map((line) => {
        const commentIdx = line.indexOf("//");
        return commentIdx !== -1 ? line.substring(0, commentIdx) : line;
      })
      .join("\n");
    stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "");

    const FORBIDDEN_FIELDS = ["autoPoints", "teleopPoints", "totalPoints"];

    for (const field of FORBIDDEN_FIELDS) {
      const matches = stripped.match(new RegExp(`\\b${field}\\b`, "g"));
      expect(matches?.length ?? 0, `2019.ts reads forbidden roll-up field "${field}" outside a comment`).toBe(0);
    }
  });

  it("2019.ts: components carry the sandstorm bonus and the three teleop parts, not their roll-ups (BD-1 pinned as a test)", () => {
    const components = componentMapForSeason(2019).components;
    expect(components).toContain("sandstormBonus");
    expect(components).toContain("hatchPanel");
    expect(components).toContain("cargo");
    expect(components).toContain("habClimb");
  });
});

/**
 * 260920-qgg: TBA omits `adjustPoints` entirely on both alliances at many
 * offseason events (measured: 12,210 alliance-sides across the corpus, all
 * offseason, never present-but-invalid). Before this fix that degraded the
 * whole breakdown to `kind: "malformed"`. These assertions are read
 * DIRECTLY against real 2026 offseason rows rather than a hand-built
 * fixture, so they keep working if the corpus is re-ingested — a
 * hand-typed payload could silently drift from TBA's real shape.
 */
describe("2026 offseason: absent adjustPoints defaults to 0, present-but-invalid still fails (260920-qgg)", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found — run the ingest pipeline (pnpm ingest) first`, () => {});
    return;
  }

  function all2026OffseasonBreakdownRows(): SampledBreakdownRow[] {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      return db
        .prepare(
          `SELECT m.match_key, m.score_breakdown_raw
           FROM matches m
           JOIN events e ON e.event_key = m.event_key
           WHERE e.year = 2026 AND e.is_offseason = 1 AND m.has_score_breakdown = 1 AND m.winner IS NOT NULL
           ORDER BY m.match_key ASC`
        )
        .all() as SampledBreakdownRow[];
    } finally {
      db.close();
    }
  }

  /** True when neither side's raw JSON carries an `adjustPoints` OWN key at all. */
  function missingAdjustPointsOnBothSides(row: SampledBreakdownRow): boolean {
    const rawJson = JSON.parse(row.score_breakdown_raw) as {
      red?: Record<string, unknown>;
      blue?: Record<string, unknown>;
    };
    return (
      rawJson.red !== undefined &&
      rawJson.blue !== undefined &&
      !Object.prototype.hasOwnProperty.call(rawJson.red, "adjustPoints") &&
      !Object.prototype.hasOwnProperty.call(rawJson.blue, "adjustPoints")
    );
  }

  it("a real 2026 offseason breakdown with no adjustPoints key on either side parses, with adjust === 0 on both sides", () => {
    const rows = all2026OffseasonBreakdownRows();
    const row = rows.find(missingAdjustPointsOnBothSides);
    expect(row, "no 2026 offseason match with adjustPoints absent on both sides found in the corpus").toBeDefined();

    const outcome = tryParseBreakdownPair(2026, row!.score_breakdown_raw);
    expect(outcome.kind).toBe("parsed");
    if (outcome.kind !== "parsed") throw new Error("unreachable");
    expect(outcome.red[ADJUST_COMPONENT]).toBe(0);
    expect(outcome.blue[ADJUST_COMPONENT]).toBe(0);
  });

  it("the identical payload with adjustPoints present as null, a string, or NaN on one side still yields malformed — absent is the ONLY admitted shape", () => {
    const rows = all2026OffseasonBreakdownRows();
    const row = rows.find(missingAdjustPointsOnBothSides);
    expect(row).toBeDefined();
    const base = JSON.parse(row!.score_breakdown_raw) as {
      red: Record<string, unknown>;
      blue: Record<string, unknown>;
    };

    for (const invalidValue of [null, "12", Number.NaN]) {
      const mutated = {
        red: { ...base.red, adjustPoints: invalidValue },
        blue: { ...base.blue },
      };
      const outcome = tryParseBreakdownPair(2026, JSON.stringify(mutated));
      expect(outcome.kind, `adjustPoints = ${JSON.stringify(invalidValue)} must still fail to parse`).toBe("malformed");
    }
  });

  it("reconciliation still holds for every 2026 offseason match that flips from malformed to parsed", () => {
    const rows = all2026OffseasonBreakdownRows();
    const map = componentMapForSeason(2026);
    let flippedCount = 0;

    for (const row of rows) {
      const outcome = tryParseBreakdownPair(2026, row.score_breakdown_raw);
      if (outcome.kind !== "parsed") continue;
      if (!missingAdjustPointsOnBothSides(row)) continue; // scope to the population this fix actually flips

      flippedCount += 1;
      const rawJson: unknown = JSON.parse(row.score_breakdown_raw);
      for (const side of ["red", "blue"] as const) {
        const opponentSide = side === "red" ? "blue" : "red";
        const ownComponents = map.parse(rawJson, side);
        const opponentComponents = map.parse(rawJson, opponentSide);
        const offensiveSum = Object.entries(ownComponents)
          .filter(([name]) => name !== FOULS_COMMITTED_COMPONENT)
          .reduce((sum, [, value]) => sum + value, 0);
        const reconciledTotal = offensiveSum + opponentComponents[FOULS_COMMITTED_COMPONENT]!;
        const expectedTotal = allianceTotalPoints(rawJson, side);
        expect(
          Math.abs(reconciledTotal - expectedTotal),
          `match ${row.match_key} (${side}): reconciled ${reconciledTotal} vs totalPoints ${expectedTotal}`
        ).toBeLessThan(RECONCILIATION_TOLERANCE);
      }
    }

    expect(flippedCount, "no 2026 offseason match flipped to parsed — this proof is vacuous without at least one").toBeGreaterThan(0);
  });
});

/**
 * 260920-qgg anti-masking guard #1: the corpus proof above cannot catch a
 * season module that silently degrades on a future missing REQUIRED
 * SCORING key — that would just move matches from "malformed" to
 * "malformed", invisible to a plain pass/fail check. Pinning the exact
 * still-malformed COUNT per season, over the FULL offseason population (not
 * a sample), makes a regression in either direction fail loudly: a RISE
 * means something newly stopped parsing, and a FALL means this committed
 * measurement itself is stale and must be re-measured, never loosened to
 * match a surprising new number.
 *
 * Iterates `BREAKDOWN_REGISTERED_SEASONS`, never a hand-written season list
 * — see that export's own doc comment for the failure mode a literal list
 * invites (a newly registered season silently skipped).
 */
describe("260920-qgg: per-season still-malformed offseason counts (anti-masking guard)", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found — run the ingest pipeline (pnpm ingest) first`, () => {});
    return;
  }

  /**
   * Measured at plan time against the FULL offseason population (quick task
   * 260920-qgg) — not a sample. 2022, 2023 and 2024 stay nonzero because
   * their still-malformed rows are missing real SCORING fields too, which
   * this fix must not default.
   */
  const EXPECTED_STILL_MALFORMED: Readonly<Record<number, number>> = {
    2016: 0,
    2017: 0,
    2018: 0,
    2019: 0,
    2020: 0,
    // cargo/foul/taxi/endgame fields absent, on top of adjustPoints.
    2022: 76,
    // The 1,008 adjust-missing rows also lack autoChargeStationPoints,
    // endGameChargeStationPoints and endGameParkPoints — absent SCORING
    // fields, not something this fix may default. 2023 gains nothing from
    // this change; that is the correct outcome, not an unfinished fix.
    2023: 1039,
    // note/stage/park fields absent, on top of adjustPoints.
    2024: 49,
    2025: 0,
    2026: 0,
  };

  function offseasonBreakdownRows(year: number): SampledBreakdownRow[] {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      return db
        .prepare(
          `SELECT m.match_key, m.score_breakdown_raw
           FROM matches m
           JOIN events e ON e.event_key = m.event_key
           WHERE e.year = ? AND e.is_offseason = 1 AND m.has_score_breakdown = 1 AND m.winner IS NOT NULL`
        )
        .all(year) as SampledBreakdownRow[];
    } finally {
      db.close();
    }
  }

  it.each(BREAKDOWN_REGISTERED_SEASONS)("season %i: still-malformed offseason count matches the committed measurement exactly", (year) => {
    const expected = EXPECTED_STILL_MALFORMED[year];
    expect(expected, `season ${year} has no entry in EXPECTED_STILL_MALFORMED — a newly registered season needs a measured one`).toBeDefined();

    const rows = offseasonBreakdownRows(year);
    const stillMalformed = rows.filter((row) => tryParseBreakdownPair(year, row.score_breakdown_raw).kind === "malformed");

    expect(
      stillMalformed.length,
      `season ${year}: measured ${stillMalformed.length} still-malformed offseason matches (of ${rows.length} total), ` +
        `committed table says ${expected} — a RISE means a future field started silently degrading, a FALL means this ` +
        `committed number is stale and must be re-measured, not loosened`
    ).toBe(expected);
  });
});

/**
 * 260920-qgg anti-masking guard #2: the corpus proof cannot catch a season
 * module that quietly supplies a zero for a SCORING field it failed to
 * read, because a zeroed component still reconciles whenever the alliance
 * genuinely scored nothing there. Only a source scan catches it. Mirrors
 * the "2018 Scale/Switch split source gate" mechanics above: a
 * comment-stripped negative scan, paired with a positive assertion that
 * every season module actually goes through the one shared symbol.
 */
describe("260920-qgg: anti-masking source gate — only ADJUST_POINTS_SCHEMA may default a field", () => {
  it("no season module under packages/core/algorithms/breakdown spells `.default(` itself, and every one imports ADJUST_POINTS_SCHEMA by name from ./constants.js", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const currentDir = path.dirname(fileURLToPath(import.meta.url));

    for (const year of BREAKDOWN_REGISTERED_SEASONS) {
      const filePath = path.join(currentDir, `${year}.ts`);
      const content = fs.readFileSync(filePath, "utf-8");

      let stripped = content
        .split("\n")
        .map((line) => {
          const commentIdx = line.indexOf("//");
          return commentIdx !== -1 ? line.substring(0, commentIdx) : line;
        })
        .join("\n");
      stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "");

      expect(
        stripped.includes(".default("),
        `${year}.ts calls .default( directly — only the shared ADJUST_POINTS_SCHEMA (constants.ts) may default a field`
      ).toBe(false);
      expect(
        /\bADJUST_POINTS_SCHEMA\b/.test(stripped),
        `${year}.ts does not import ADJUST_POINTS_SCHEMA by name from ./constants.js`
      ).toBe(true);
    }
  });
});
