/**
 * The deterministic golden-oracle grid generator (09-02 Task 1 Steps 2/3;
 * D-02, D-07, Pitfall 4, T-09-02-01). Pure, exported, entry-point guarded —
 * importing this module never runs a generation pass, following
 * `packages/harness/identifiability.ts`'s own shape (`async function main()`
 * + `isEntryPoint` guard).
 *
 * `buildGridRows(season, eventType)` synthesizes a value grid over every
 * threshold variable a season declares and evaluates it through that
 * season's LIVE `predictThresholds` — so running this script against the
 * pre-rewrite tree captures pre-rewrite behavior, and calling the same
 * function again post-rewrite reproduces it if and only if nothing changed.
 * `digestRows(rows)` hashes a set of already-evaluated rows into one sha256
 * digest. `main()` (this file's own entry point) writes the committed
 * oracle, `packages/core/rankingPoints/predictThresholdsGolden.json`.
 *
 * **Regeneration is gated on the GRID itself changing — never on a failing
 * assertion.** Regenerating to make a red `predictThresholdsGolden.test.ts`
 * green launders a behavior regression into the oracle that exists to catch
 * exactly that. If the test goes red and the cause is not an obvious,
 * nameable transcription slip, stop and report — do not touch this file's
 * committed output.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { mulberry32 } from "../packages/harness/identifiability.js";
import { RP_REGISTERED_SEASONS, rpRuleModuleForSeason } from "../packages/core/rankingPoints/rules.js";

/** Bumped only when the grid's own shape changes (ladder, row families, row counts) — never in response to a red test. */
export const GRID_VERSION = 1;

const GOLDEN_JSON_PATH = join("packages", "core", "rankingPoints", "predictThresholdsGolden.json");

/**
 * The three real TBA `event_type` values exercising `eventTierFor`'s
 * base / districtChampionship / championship mapping — never an `EventTier`
 * named directly, so the mapping itself stays on the path this grid
 * exercises.
 */
export const GRID_EVENT_TYPES = [0, 2, 3] as const;

/** How many independently-drawn rows the random family contributes per (season, eventType) grid. */
export const RANDOM_ROWS_PER_SEASON_TIER = 3000;

/** The "far from every threshold" value every OTHER variable takes in the boundary family's "others-high" context. */
const HIGH_CONTEXT_VALUE = 1000;

/**
 * Every tiered-threshold and plain-definitional-constant value reachable
 * from any season module's `predictThresholds`, sourced by season/bonus so
 * a future threshold correction is visible as a diff here too. See
 * 09-02-PLAN.md's "seven bonus mechanisms, mapped to all 21 bonuses" table
 * for the per-bonus provenance of these numbers.
 */
const THRESHOLD_VALUES: readonly number[] = [
  // 2016: breach (4), capture tower (0), capture robot (3), the damaged-defense indicator (2)
  4, 0, 3, 2,
  // 2017: kPa (40), rotor (4)
  40, 4,
  // 2018: auto-run (15), face-the-boss (90), the autoQuest fallback floor (1)
  15, 90, 1,
  // 2019: hab docking (15)
  15,
  // 2020: shield operational (65)
  65,
  // 2022: quintet auto-cargo (5), cargo quintet (18), cargo non-quintet (20), hangar (16)
  5, 18, 20, 16,
  // 2023: activation (26), sustainability non-coop (5, 5, 6 across tiers)
  26, 5, 6,
  // 2024: melody non-coop (18, 21, 25 across tiers), ensemble stage points (10), ensemble on-stage robots (2)
  18, 21, 25, 10, 2,
  // 2025: coral strict (5, 5, 7 across tiers), barge (14, 14, 16 across tiers), auto-line-required (3), auto-coral-required (1)
  5, 7, 14, 16, 3, 1,
  // 2026: energized (100, 240, 360 across tiers), supercharged (360, 360, 500 across tiers), traversal (50)
  100, 240, 360, 500, 50,
];

function multiplesUpTo(step: number, max: number): number[] {
  const out: number[] = [];
  for (let v = step; v <= max; v += step) out.push(v);
  return out;
}

/**
 * Every raw point value the three divisor-based derivations can legitimately
 * take: 2016's tower halves (divisors 5 and 15, up to 45), 2017's rotor
 * halves (divisors 60 and 40, up to 240/160), 2023's links (divisor 5, up to
 * 30) — see 09-02-PLAN.md Task 1 Step 2.
 */
const DIVISOR_RAW_POINTS: readonly number[] = [
  ...multiplesUpTo(5, 45),
  ...multiplesUpTo(15, 45),
  ...multiplesUpTo(60, 240),
  ...multiplesUpTo(40, 160),
  ...multiplesUpTo(5, 30),
];

/**
 * The frozen, ascending, deduplicated integer ladder every threshold
 * variable's boundary and random rows draw from: every `THRESHOLD_VALUES`
 * entry AND that value minus one, unioned with `DIVISOR_RAW_POINTS`.
 */
export const VALUE_LADDER: readonly number[] = Object.freeze(
  Array.from(new Set([...THRESHOLD_VALUES.flatMap((v) => [v, v - 1]), ...DIVISOR_RAW_POINTS])).sort((a, b) => a - b)
);

/**
 * Asserts `VALUE_LADDER` is sorted, deduplicated and non-empty, throwing
 * otherwise — so a later careless edit to `THRESHOLD_VALUES`/
 * `DIVISOR_RAW_POINTS` cannot silently narrow grid coverage without the
 * generator itself noticing.
 */
function assertLadderValid(): void {
  if (VALUE_LADDER.length === 0) {
    throw new Error("rpPredictThresholdsGolden: VALUE_LADDER is empty");
  }
  for (let i = 1; i < VALUE_LADDER.length; i++) {
    if (VALUE_LADDER[i]! <= VALUE_LADDER[i - 1]!) {
      throw new Error(
        `rpPredictThresholdsGolden: VALUE_LADDER is not strictly ascending/deduplicated at index ${i} (${VALUE_LADDER[i - 1]} -> ${VALUE_LADDER[i]})`
      );
    }
  }
}

export interface GridRow {
  readonly season: number;
  readonly eventType: number;
  readonly values: Readonly<Record<string, number>>;
  readonly bonusFlags: Readonly<Record<string, boolean>>;
  readonly totalRp: number;
}

/**
 * Synthesizes and evaluates a full value grid for one (season, eventType)
 * pair through that season's LIVE `predictThresholds` — two row families,
 * concatenated in a fixed order:
 *
 * - **Boundary family:** for each threshold variable and each context
 *   (`"others-zero"` | `"others-high"`), one row per `VALUE_LADDER` entry
 *   with that variable at the ladder value and every OTHER variable at `0`
 *   or `HIGH_CONTEXT_VALUE` respectively.
 * - **Random family:** `RANDOM_ROWS_PER_SEASON_TIER` rows, each variable
 *   drawn independently from `VALUE_LADDER` by `mulberry32`, seeded
 *   deterministically as `season * 1000 + eventType` so a row stream is
 *   reproducible from its coordinates alone.
 */
export function buildGridRows(season: number, eventType: number): GridRow[] {
  assertLadderValid();
  const module = rpRuleModuleForSeason(season);
  const variables = module.thresholdVariables;
  const rows: GridRow[] = [];

  const evaluate = (values: Record<string, number>): GridRow => {
    const result = module.predictThresholds(values, eventType);
    return { season, eventType, values, bonusFlags: result.bonusFlags, totalRp: result.totalRp };
  };

  for (const variable of variables) {
    for (const context of ["others-zero", "others-high"] as const) {
      const otherValue = context === "others-zero" ? 0 : HIGH_CONTEXT_VALUE;
      for (const ladderValue of VALUE_LADDER) {
        const values: Record<string, number> = {};
        for (const other of variables) {
          values[other.name] = other.name === variable.name ? ladderValue : otherValue;
        }
        rows.push(evaluate(values));
      }
    }
  }

  const rng = mulberry32(season * 1000 + eventType);
  for (let i = 0; i < RANDOM_ROWS_PER_SEASON_TIER; i++) {
    const values: Record<string, number> = {};
    for (const variable of variables) {
      const idx = Math.floor(rng() * VALUE_LADDER.length);
      values[variable.name] = VALUE_LADDER[idx]!;
    }
    rows.push(evaluate(values));
  }

  return rows;
}

/**
 * Hashes `rows` into one sha256 hex digest over a canonical newline-joined
 * stream — one line per row: season, event type, each variable value in
 * `thresholdVariables` declaration order, each bonus flag as `0`/`1` in
 * `bonusNames` order, and `totalRp`. Serializing bonus flags in
 * `bonusNames` order means a silently reordered bonus array changes the
 * digest — the point (T-09-02-02).
 */
export function digestRows(rows: readonly GridRow[]): string {
  const lines = rows.map((row) => {
    const module = rpRuleModuleForSeason(row.season);
    const parts: string[] = [String(row.season), String(row.eventType)];
    for (const variable of module.thresholdVariables) {
      parts.push(String(row.values[variable.name] ?? 0));
    }
    for (const bonusName of module.bonusNames) {
      parts.push(row.bonusFlags[bonusName] ? "1" : "0");
    }
    parts.push(String(row.totalRp));
    return parts.join("|");
  });
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

interface GoldenFile {
  readonly gridVersion: number;
  readonly generatedFromCommit: string;
  readonly rowsPerSeasonTier: number;
  readonly digests: Record<string, string>;
  readonly fireCounts: Record<string, number>;
}

async function main(): Promise<void> {
  const generatedFromCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  const digests: Record<string, string> = {};
  const fireCounts: Record<string, number> = {};

  for (const season of RP_REGISTERED_SEASONS) {
    const module = rpRuleModuleForSeason(season);
    for (const eventType of GRID_EVENT_TYPES) {
      const rows = buildGridRows(season, eventType);
      digests[`${season}:${eventType}`] = digestRows(rows);

      for (const bonusName of module.bonusNames) {
        const key = `${season}:${eventType}:${bonusName}`;
        fireCounts[key] = rows.filter((row) => row.bonusFlags[bonusName] === true).length;
      }
    }
  }

  const golden: GoldenFile = {
    gridVersion: GRID_VERSION,
    generatedFromCommit,
    rowsPerSeasonTier: RANDOM_ROWS_PER_SEASON_TIER,
    digests,
    fireCounts,
  };

  mkdirSync(dirname(GOLDEN_JSON_PATH), { recursive: true });
  writeFileSync(GOLDEN_JSON_PATH, `${JSON.stringify(golden, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${GOLDEN_JSON_PATH}: ${Object.keys(digests).length} digests, ${Object.keys(fireCounts).length} fire counts, from commit ${generatedFromCommit}`
  );
}

// Guard: only auto-run `main()` when this file is the process entry point —
// importing this module (as `predictThresholdsGolden.test.ts` does) must
// never have the side effect of writing the golden file.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("rp:golden failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
