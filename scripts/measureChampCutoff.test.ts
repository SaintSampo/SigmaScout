/**
 * `measureChampCutoff.ts`' coverage (quick task 260927-6bf).
 *
 * THREE JOBS:
 *
 *   1. The backtest runs end to end on the COMMITTED 2026 PNW fixture (the
 *      local publish set is gitignored), with an all final `state` block
 *      stamped on its nine events, and every leak check passes.
 *   2. The pre-registered gate refuses on every failing condition, including
 *      coverage one season either side of the 50 to 60 of 69 band.
 *   3. The pre-registered selection rule picks in its stated order.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "../packages/harness/pageArtifacts.js";
import { CHAMP_CUTOFF_DEFAULT_SETTING } from "../packages/core/districts/hypotheticalDcmp.js";
import {
  backtestDistrict,
  coverageInBand,
  gateVerdict,
  selectSetting,
  type BacktestSummary,
  type FitScore,
  type GateSummary,
  type LineStats,
} from "./measureChampCutoff.js";

const FINAL_STATE = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true };

/** The committed fixture predates `state`; stamp an all final block on every event row, as the 260926-37q harness did. */
function stampedFixture(): DistrictArtifact {
  const raw = JSON.parse(readFileSync("data/fixtures/phase10/district-2026pnw.json", "utf8")) as {
    teams: { eventPoints: Record<string, unknown>[]; remainingEvents: Record<string, unknown>[] }[];
  };
  for (const team of raw.teams) {
    for (const row of team.eventPoints) row.state = FINAL_STATE;
    for (const row of team.remainingEvents) row.state = FINAL_STATE;
  }
  return DistrictArtifactSchema.parse(raw);
}

describe("backtestDistrict on the committed 2026 PNW fixture", () => {
  const outcome = backtestDistrict(stampedFixture(), CHAMP_CUTOFF_DEFAULT_SETTING);

  it("scores the end of district season position: the last rail step before the DCMP", () => {
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.row.positionId).toBe("2026waahs:awards");
    expect(outcome.row.published).toBe(182);
    expect(outcome.row.cmpSlots).toBe(21);
  });

  it("passes every leak check: no DCMP award, registration or roster reaches the position", () => {
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.row.leaks).toEqual({ awardQualifiedEmpty: true, noMembershipFact: true, everyDcmpRowEstimated: true, noDcmpTierCandidate: true });
  });

  it("prints a line inside its own likely range, at the seeded value", () => {
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.row.p10).toBeLessThanOrEqual(outcome.row.simulated);
    expect(outcome.row.simulated).toBeLessThanOrEqual(outcome.row.p90);
    // Recorded from the first run: default setting, 1000 draws, seed 20260830.
    expect(outcome.row.simulated).toBe(SEEDED_SIMULATED);
    expect(outcome.row.oracleNaive).toBe(149);
    expect(outcome.row.oracleMinus3).toBe(182);
  });
});

/** Recorded from the first run of the test above. */
const SEEDED_SIMULATED = 176;

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

function stats(mae: number, bias: number, n = 69): LineStats {
  return { n, mae, bias };
}

function passingGate(overrides: Partial<BacktestSummary> = {}, gate: Partial<GateSummary> = {}): GateSummary {
  const scored: BacktestSummary = {
    n: 69,
    simulated: stats(15, -3),
    sameNaive: stats(30, -29),
    sameMinus3: stats(20, -18),
    oracleNaive: stats(20.26, -20.17),
    oracleMinus3: stats(9.0, -2.57),
    covered: 55,
    meanAwardSlots: 7.6,
    meanOutsideSlots: 3.0,
    ...overrides,
  };
  return { seasons: 69, scored, oracleNaive: stats(20.26, -20.17), oracleMinus3: stats(9.0, -2.57), ...gate };
}

describe("gateVerdict", () => {
  it("is GO when all five conditions hold, at both ends of the coverage band", () => {
    expect(gateVerdict(passingGate()).go).toBe(true);
    expect(gateVerdict(passingGate({ covered: 50 })).go).toBe(true);
    expect(gateVerdict(passingGate({ covered: 60 })).go).toBe(true);
  });

  it("is NO-GO when the oracle lines do not reproduce", () => {
    const verdict = gateVerdict(passingGate({}, { oracleNaive: stats(20.5, -20.4) }));
    expect(verdict.go).toBe(false);
    expect(verdict.conditions[0]!.pass).toBe(false);
    expect(gateVerdict(passingGate({}, { oracleMinus3: stats(9.1, -2.6) })).go).toBe(false);
  });

  it("is NO-GO when the simulated MAE does not beat the oracle naive MAE", () => {
    const verdict = gateVerdict(passingGate({ simulated: stats(20.3, -3), sameNaive: stats(40, -39) }));
    expect(verdict.go).toBe(false);
    expect(verdict.conditions[1]!.pass).toBe(false);
  });

  it("is NO-GO when the simulated MAE is above 0.75 x the same position naive MAE", () => {
    const verdict = gateVerdict(passingGate({ simulated: stats(16, -3), sameNaive: stats(21, -20) }));
    expect(verdict.go).toBe(false);
    expect(verdict.conditions[2]!.pass).toBe(false);
  });

  it("is NO-GO when the simulated bias is not smaller in size than the same position naive bias", () => {
    const verdict = gateVerdict(passingGate({ simulated: stats(15, 30) }));
    expect(verdict.go).toBe(false);
    expect(verdict.conditions[3]!.pass).toBe(false);
  });

  it("is NO-GO at 49 of 69 and at 61 of 69", () => {
    expect(gateVerdict(passingGate({ covered: 49 })).go).toBe(false);
    expect(gateVerdict(passingGate({ covered: 61 })).go).toBe(false);
    expect(gateVerdict(passingGate({ covered: 49 })).conditions[4]!.pass).toBe(false);
  });

  it("counts a season that printed no range as not covered", () => {
    // 49 covered of 68 lines is 72.06%, but of the 69 seasons it is 71.0%.
    expect(gateVerdict(passingGate({ n: 68, covered: 49 })).go).toBe(false);
    expect(gateVerdict(passingGate({ n: 68, covered: 50 })).go).toBe(true);
  });

  it("states the coverage band in integers: 50 to 60 of 69", () => {
    expect(coverageInBand(49, 69)).toBe(false);
    expect(coverageInBand(50, 69)).toBe(true);
    expect(coverageInBand(60, 69)).toBe(true);
    expect(coverageInBand(61, 69)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The selection rule
// ---------------------------------------------------------------------------

function score(covered: number, n: number, absErrorSum: number): FitScore {
  return { n, covered, absErrorSum };
}

describe("selectSetting", () => {
  it("takes the lowest MAE among the settings inside 72% to 88%", () => {
    // 20 seasons: 15 covered is 75% (in), 14 is 70% (out), 18 is 90% (out).
    expect(selectSetting([score(14, 20, 100), score(15, 20, 300), score(16, 20, 250), score(18, 20, 50)])).toBe(2);
  });

  it("with none inside, takes the coverage closest to 80%, ties to the lower MAE", () => {
    // 14 of 20 (70%) and 18 of 20 (90%) are both 10 points from 80%.
    expect(selectSetting([score(10, 20, 10), score(14, 20, 300), score(18, 20, 200)])).toBe(2);
  });

  it("breaks any remaining tie by the earlier grid order", () => {
    expect(selectSetting([score(15, 20, 200), score(15, 20, 200)])).toBe(0);
    expect(selectSetting([score(14, 20, 200), score(18, 20, 200)])).toBe(0);
  });

  it("picks the default for an empty fit set", () => {
    expect(selectSetting([])).toBe(0);
    expect(selectSetting([score(0, 0, 0), score(0, 0, 0)])).toBe(0);
  });
});
