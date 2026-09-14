/**
 * The pure pre-schedule sidecar builder, tested with a `predict` stub returning
 * a fixed seven-entry pmf, so no model, corpus or files are needed.
 *
 * 6 teams at 12 matches per team gives 12 matches and no surrogate slots; 10
 * teams at 10 gives 17 matches with 2 surrogate slots, hence the 10-team roster
 * in the surrogate tests.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Prediction, UpcomingMatch } from "../core/algorithms/types.js";
import { PreScheduleArtifactSchema } from "./pageArtifacts.js";
import {
  buildPreScheduleArtifact,
  buildFieldAveragedPreScheduleArtifact,
  buildFieldContributions,
  fieldMeanShiftVector,
  PreSchedulePricingError,
  toSimMatchInput,
  type FieldAveragedPreScheduleBuildParams,
  type FieldContributionInputs,
  type PreScheduleBuildParams,
} from "./preSchedule.js";
import { RpMomentsAccumulator } from "../core/rankingPoints/empiricalMoments.js";
import { RP_MEAN_SHIFT_WARMUP_OBSERVATIONS, RpMeanShiftAccumulator } from "../core/rankingPoints/meanShift.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { fieldStatistics } from "../core/rankingPoints/fieldAveraged.js";

/** Sums to exactly 1 and survives `roundPmf` unchanged (every entry already at pmf precision). */
const STUB_PMF = [0.05, 0.1, 0.15, 0.2, 0.25, 0.15, 0.1];

function stubPredict(_match: UpcomingMatch): Prediction {
  return {
    winner: "red",
    pRedWin: 0.5,
    redScore: 50,
    blueScore: 45,
    redRpPmf: [...STUB_PMF],
    blueRpPmf: [...STUB_PMF],
  };
}

/** Deliberately unsorted roster: the builder must sort it itself. */
const SIX_TEAM_ROSTER = ["frc6", "frc2", "frc10", "frc1", "frc4", "frc3"];
const SIX_TEAM_ROSTER_SORTED = ["frc1", "frc10", "frc2", "frc3", "frc4", "frc6"];

function baseParams(overrides: Partial<PreScheduleBuildParams> = {}): PreScheduleBuildParams {
  return {
    eventKey: "2026casj",
    season: 2026,
    eventType: 0,
    week: null,
    algorithmId: "vpr",
    algorithmVersion: "9.0.0+rolling-2026-09c",
    roster: SIX_TEAM_ROSTER,
    matchesPerTeam: 12,
    pricedFrom: "pre-event-walk-forward",
    scheduleCount: 3,
    drawsPerSchedule: 10,
    generation: "gen-test",
    computedAt: "2026-09-06T00:00:00.000Z",
    predict: stubPredict,
    ...overrides,
  };
}

describe("toSimMatchInput (PD-03 — the one implementation the builder hands simulateRanks)", () => {
  it("excludes surrogate team keys from the SimMatchInput team-key lists, keeping the pmfs verbatim", () => {
    const upcoming: UpcomingMatch = {
      matchKey: "2026casj_presim0_qm5",
      eventKey: "2026casj",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 5,
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc4", "frc5", "frc6"],
      redSurrogates: ["frc2"],
      blueSurrogates: [],
      eventType: 0,
      week: null,
    };
    const input = toSimMatchInput(upcoming, STUB_PMF, STUB_PMF);
    expect(input.redTeamKeys).toEqual(["frc1", "frc3"]);
    expect(input.blueTeamKeys).toEqual(["frc4", "frc5", "frc6"]);
    expect(input.redRpPmf).toEqual(STUB_PMF);
    expect(input.blueRpPmf).toEqual(STUB_PMF);
  });

  const decompositionUpcoming: UpcomingMatch = {
    matchKey: "2026casj_presim0_qm5",
    eventKey: "2026casj",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 5,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redSurrogates: ["frc2"],
    blueSurrogates: [],
    eventType: 0,
    week: null,
  };
  const STUB_OUTCOME = {
    outcomePmf: [0.5, 0, 0.5],
    redOutcomeRp: [2, 1, 0],
    blueOutcomeRp: [0, 1, 2],
    redBonusRpPmf: [1],
    blueBonusRpPmf: [1],
  };

  it("a fifth `outcome` argument populates SimMatchInput.outcome without disturbing PD-03's surrogate exclusion", () => {
    const input = toSimMatchInput(decompositionUpcoming, STUB_PMF, STUB_PMF, STUB_OUTCOME);
    expect(input.outcome).toEqual(STUB_OUTCOME);
    expect(input.redTeamKeys).toEqual(["frc1", "frc3"]);
    expect(input.blueTeamKeys).toEqual(["frc4", "frc5", "frc6"]);
  });

  it("omitting the fifth argument leaves SimMatchInput.outcome entirely absent, not an empty or zero-filled object", () => {
    const input = toSimMatchInput(decompositionUpcoming, STUB_PMF, STUB_PMF);
    expect("outcome" in input).toBe(false);
    expect(input.outcome).toBeUndefined();
  });
});

describe("buildPreScheduleArtifact over generated pairing structures", () => {
  it("two calls with identical parameters produce deep-equal artifacts (seeds, shuffles, histograms and all)", () => {
    const first = buildPreScheduleArtifact(baseParams());
    const second = buildPreScheduleArtifact(baseParams());
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
  });

  it("a roster whose sorted order differs from its input order produces the same artifact from both orders", () => {
    const fromUnsorted = buildPreScheduleArtifact(baseParams({ roster: SIX_TEAM_ROSTER }));
    const fromSorted = buildPreScheduleArtifact(baseParams({ roster: SIX_TEAM_ROSTER_SORTED }));
    expect(fromUnsorted).not.toBeNull();
    expect(fromSorted).toEqual(fromUnsorted);
    expect(fromUnsorted!.roster).toEqual(SIX_TEAM_ROSTER_SORTED);
  });

  it("changing only eventKey changes the shuffles; changing only algorithmVersion does too", () => {
    const base = buildPreScheduleArtifact(baseParams())!;
    const otherEvent = buildPreScheduleArtifact(baseParams({ eventKey: "2026milw" }))!;
    const otherVersion = buildPreScheduleArtifact(baseParams({ algorithmVersion: "9.0.1+rolling-2026-10a" }))!;
    // The published seed IS the shuffle (a pure function of the seed), so a
    // changed seed on every schedule is a changed shuffle on every schedule.
    for (let k = 0; k < base.schedules.length; k++) {
      expect(otherEvent.schedules[k]!.seed).not.toBe(base.schedules[k]!.seed);
      expect(otherVersion.schedules[k]!.seed).not.toBe(base.schedules[k]!.seed);
    }
  });

  it("returns null after pricing exactly ONE synthetic match when predict carries no redRpPmf", () => {
    let calls = 0;
    const rpLessPredict = (_match: UpcomingMatch): Prediction => {
      calls += 1;
      return { winner: "red", pRedWin: 0.5, redScore: 50, blueScore: 45 };
    };
    const result = buildPreScheduleArtifact(baseParams({ predict: rpLessPredict }));
    expect(result).toBeNull();
    expect(calls).toBe(1);
  });

  it("a pmf that goes missing partway through pricing throws PreSchedulePricingError naming the synthetic match key", () => {
    let calls = 0;
    const flakyPredict = (match: UpcomingMatch): Prediction => {
      calls += 1;
      if (calls === 1) return stubPredict(match);
      return { winner: "red", pRedWin: 0.5, redScore: 50, blueScore: 45 };
    };
    expect(() => buildPreScheduleArtifact(baseParams({ predict: flakyPredict }))).toThrow(PreSchedulePricingError);
    calls = 0;
    expect(() => buildPreScheduleArtifact(baseParams({ predict: flakyPredict }))).toThrow(/2026casj_presim0_qm2/);
  });

  it("every roster team gets exactly one baked histogram, of length roster.length, summing to scheduleCount * drawsPerSchedule", () => {
    const artifact = buildPreScheduleArtifact(baseParams())!;
    expect(artifact.roster).toEqual(SIX_TEAM_ROSTER_SORTED);
    expect(artifact.baked.histograms).toHaveLength(6);
    expect(artifact.baked.draws).toBe(3 * 10);
    for (const histogram of artifact.baked.histograms) {
      expect(histogram).toHaveLength(6);
      expect(histogram.reduce((total, count) => total + count, 0)).toBe(3 * 10);
    }
  });

  it("synthetic match keys are presim-shaped and matchNumber is one-based", () => {
    const artifact = buildPreScheduleArtifact(baseParams())!;
    // 6 teams at 12 matches per team -> ceil(72/6) = 12 matches per schedule.
    expect(artifact.schedules).toHaveLength(3);
    for (const schedule of artifact.schedules) {
      expect(schedule.matches).toHaveLength(12);
    }
  });

  it("a team occupying a surrogate slot is handed to predict inside the alliance AND flagged in redSurrogates/blueSurrogates (PD-03)", () => {
    const tenTeamRoster = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6", "frc7", "frc8", "frc9", "frc11"];
    const seen: UpcomingMatch[] = [];
    const spyPredict = (match: UpcomingMatch): Prediction => {
      seen.push(match);
      return stubPredict(match);
    };
    const artifact = buildPreScheduleArtifact(
      baseParams({ roster: tenTeamRoster, matchesPerTeam: 10, scheduleCount: 2, predict: spyPredict })
    );
    expect(artifact).not.toBeNull();

    // 10 teams at 10 matches per team leaves surrogateSlotCount(10, 10) = 2
    // surrogate slots, so at least one synthetic match per schedule flags one.
    const withSurrogates = seen.filter((match) => match.redSurrogates.length > 0 || match.blueSurrogates.length > 0);
    expect(withSurrogates.length).toBeGreaterThan(0);
    for (const match of withSurrogates) {
      for (const surrogate of match.redSurrogates) {
        expect(match.redTeams).toContain(surrogate);
      }
      for (const surrogate of match.blueSurrogates) {
        expect(match.blueTeams).toContain(surrogate);
      }
    }
  });

  it("the returned object round-trips through PreScheduleArtifactSchema.parse unchanged", () => {
    const artifact = buildPreScheduleArtifact(baseParams())!;
    expect(PreScheduleArtifactSchema.parse(artifact)).toEqual(artifact);
  });
});

// ---------------------------------------------------------------------------
// The FIELD-AVERAGED path
// ---------------------------------------------------------------------------

/** 2023 — two threshold variables, `winRp` 2, `tieRp` 1, three bonuses. */
const FA_RULE = RP_RULE_MODULES[2023]!;
const FA_VARIABLE_NAMES = FA_RULE.thresholdVariables.map((v) => v.name);
const FA_REGIONAL_EVENT_TYPE = 0;

/** Builds a real accumulator with `folds` alliance observations folded into each named team. */
function accumulatorWith(teams: readonly string[], folds: number): RpMomentsAccumulator {
  const accumulator = new RpMomentsAccumulator(FA_RULE);
  for (const teamKey of teams) {
    for (let i = 0; i < folds; i++) {
      const values: Record<string, number> = {};
      for (const [v, name] of FA_VARIABLE_NAMES.entries()) values[name] = 10 + v * 5 + i;
      accumulator.fold([teamKey], values);
    }
  }
  return accumulator;
}

function faInputs(overrides: Partial<FieldContributionInputs> = {}): FieldContributionInputs {
  const roster = ["frc3", "frc1", "frc2"];
  return {
    roster,
    rpAccumulator: accumulatorWith(roster, 4),
    sigmaScoreByTeam: new Map(roster.map((t) => [t, 12])),
    teamTotals: new Map(roster.map((t, i) => [t, 40 + i * 5])),
    ...overrides,
  };
}

describe("buildFieldContributions (plan 09-09 Task 2 — the all-or-nothing roster rule, reproduced)", () => {
  it("returns null when ANY roster team is missing a consistency figure", () => {
    const inputs = faInputs();
    const partial = new Map(inputs.sigmaScoreByTeam);
    partial.delete("frc2");
    expect(buildFieldContributions({ ...inputs, sigmaScoreByTeam: partial })).toBeNull();
  });

  it("returns null when ANY roster team is missing a TOTAL_METRIC_KEY total", () => {
    // Separate from the Sigma case: the absences have different causes, and one
    // case would let a fix for one silently break the other.
    const inputs = faInputs();
    const partial = new Map(inputs.teamTotals);
    partial.delete("frc2");
    expect(buildFieldContributions({ ...inputs, teamTotals: partial })).toBeNull();
  });

  it("returns null when the layer carries no RP accumulator at all", () => {
    expect(buildFieldContributions({ ...faInputs(), rpAccumulator: undefined })).toBeNull();
  });

  it("returns one contribution per roster team, in SORTED roster order, reading each team's OWN belief from a one-team momentsFor call", () => {
    const inputs = faInputs();
    const contributions = buildFieldContributions(inputs)!;
    expect(contributions.map((c) => c.teamKey)).toEqual(["frc1", "frc2", "frc3"]);
    for (const contribution of contributions) {
      // Against the accumulator directly: a one-team roster returns the team's own belief.
      const own = inputs.rpAccumulator!.momentsFor([contribution.teamKey], 0, 0);
      expect(contribution.variableMeans).toEqual(own.meanVector);
      expect(contribution.variableVariances).toEqual(own.varianceBlock.map((row, i) => row[i]));
      expect(contribution.scoreMean).toBe(inputs.teamTotals.get(contribution.teamKey));
      // `allianceSigmaBandVariance`'s own per-team term is `sigma * sigma`.
      expect(contribution.bandVariance).toBe(12 * 12);
    }
  });

  it("a team with no folded observations contributes ZEROS rather than being dropped", () => {
    const roster = ["frc1", "frc2", "frcCold"];
    const inputs: FieldContributionInputs = {
      roster,
      rpAccumulator: accumulatorWith(["frc1", "frc2"], 4),
      sigmaScoreByTeam: new Map(roster.map((t) => [t, 9])),
      teamTotals: new Map(roster.map((t) => [t, 50])),
    };
    const contributions = buildFieldContributions(inputs)!;
    expect(contributions).toHaveLength(3);
    const cold = contributions.find((c) => c.teamKey === "frcCold")!;
    expect([...cold.variableMeans]).toEqual(FA_VARIABLE_NAMES.map(() => 0));
    expect([...cold.variableVariances]).toEqual(FA_VARIABLE_NAMES.map(() => 0));
    // And the field statistics INCLUDE it: dropping it would shift
    // `meanOfVariableMeans` upward and silently narrow every band.
    const stats = fieldStatistics(contributions, FA_VARIABLE_NAMES);
    expect(stats.teamCount).toBe(3);
  });
});

describe("buildFieldAveragedPreScheduleArtifact (plan 09-09 Task 2)", () => {
  function faParams(overrides: Partial<FieldAveragedPreScheduleBuildParams> = {}): FieldAveragedPreScheduleBuildParams {
    return {
      eventKey: "2023gaalb",
      season: 2023,
      eventType: FA_REGIONAL_EVENT_TYPE,
      algorithmId: "spr",
      algorithmVersion: "3.0.0+baseline",
      matchesPerTeam: 12,
      pricedFrom: "pre-event-walk-forward",
      draws: 1000,
      generation: "gen-test",
      computedAt: "2026-09-11T00:00:00.000Z",
      ruleModule: FA_RULE,
      contributions: buildFieldContributions(faInputs())!,
      ...overrides,
    };
  }

  it("returns a parsed artifact whose roster is sorted, whose perTeamPmf shares that index space, and whose every scalar round-trips exactly", () => {
    const artifact = buildFieldAveragedPreScheduleArtifact(faParams())!;
    expect(artifact).not.toBeNull();
    expect(artifact.roster).toEqual(["frc1", "frc2", "frc3"]);
    expect(artifact.perTeamPmf).toHaveLength(3);
    for (const pmf of artifact.perTeamPmf) {
      expect(pmf).toHaveLength(FA_RULE.maxRp + 1);
      expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
    expect(artifact.matchesPerTeam).toBe(12);
    expect(artifact.draws).toBe(1000);
    expect(Number.isInteger(artifact.seed)).toBe(true);
    expect(artifact.generation).toBe("gen-test");
    expect(artifact.computedAt).toBe("2026-09-11T00:00:00.000Z");
    expect(artifact.algorithmId).toBe("spr");
    expect(artifact.algorithmVersion).toBe("3.0.0+baseline");
    expect(artifact.eventKey).toBe("2023gaalb");
    expect(artifact.season).toBe(2023);
    expect(artifact.pricedFrom).toBe("pre-event-walk-forward");
  });

  it("returns null, not a partial artifact, when the contributions list is empty (the buildFieldContributions null contract)", () => {
    expect(buildFieldAveragedPreScheduleArtifact(faParams({ contributions: [] }))).toBeNull();
  });

  it("is deterministic: two calls with identical params produce BYTE-identical JSON", () => {
    const first = JSON.stringify(buildFieldAveragedPreScheduleArtifact(faParams()));
    const second = JSON.stringify(buildFieldAveragedPreScheduleArtifact(faParams()));
    // `toBe` on the strings: key order is part of what a republish would churn in R2.
    expect(second).toBe(first);
  });

  it("changing only eventKey or only algorithmVersion changes the published seed", () => {
    const base = buildFieldAveragedPreScheduleArtifact(faParams())!;
    expect(buildFieldAveragedPreScheduleArtifact(faParams({ eventKey: "2023mrcmp" }))!.seed).not.toBe(base.seed);
    expect(buildFieldAveragedPreScheduleArtifact(faParams({ algorithmVersion: "3.0.1+x" }))!.seed).not.toBe(base.seed);
  });

  it("produces an artifact for a FIVE-team roster — below the generator's 6-team floor, which the schedule-based builder cannot serve at all", () => {
    // No pairing structure is built, so a roster below the generator's floor raises no GeneratedScheduleError.
    const roster = ["frc1", "frc2", "frc3", "frc4", "frc5"];
    const contributions = buildFieldContributions({
      roster,
      rpAccumulator: accumulatorWith(roster, 3),
      sigmaScoreByTeam: new Map(roster.map((t) => [t, 10])),
      teamTotals: new Map(roster.map((t, i) => [t, 40 + i])),
    })!;
    const artifact = buildFieldAveragedPreScheduleArtifact(faParams({ contributions }))!;
    expect(artifact.roster).toHaveLength(5);
    expect(artifact.perTeamPmf).toHaveLength(5);
  });

  it("never reads the filesystem: the whole build runs with no file access of any kind", () => {
    // The 5-team case above proves it positively; the import pin below proves it structurally.
    const artifact = buildFieldAveragedPreScheduleArtifact(faParams())!;
    expect(artifact.perTeamPmf.every((pmf) => pmf.every((p) => Number.isFinite(p)))).toBe(true);
  });
});

describe("the field-averaged presim and the mean shift (quick task 260914-01x, CD-05)", () => {
  const PAST_WARMUP = RP_MEAN_SHIFT_WARMUP_OBSERVATIONS + 50;
  /** Hand-set: shift = sum / count = 2 for the first variable and -1 for the second. */
  const shiftState = (count: number) => ({
    season: FA_RULE.season,
    variables: { [FA_VARIABLE_NAMES[0]!]: { count, sum: 2 * count }, [FA_VARIABLE_NAMES[1]!]: { count, sum: -count } },
  });

  function params(meanShift?: readonly number[]): FieldAveragedPreScheduleBuildParams {
    return {
      eventKey: "2023gaalb",
      season: 2023,
      eventType: FA_REGIONAL_EVENT_TYPE,
      algorithmId: "spr",
      algorithmVersion: "3.0.0+baseline",
      matchesPerTeam: 12,
      pricedFrom: "pre-event-walk-forward",
      draws: 1000,
      generation: "gen-test",
      computedAt: "2026-09-11T00:00:00.000Z",
      ruleModule: FA_RULE,
      contributions: buildFieldContributions(faInputs())!,
      ...(meanShift !== undefined ? { meanShift } : {}),
    };
  }

  it("fieldMeanShiftVector returns sum / count per variable when every roster team is warm and the shift is past warmup", () => {
    const inputs = faInputs();
    const vector = fieldMeanShiftVector({
      roster: inputs.roster,
      rpAccumulator: inputs.rpAccumulator,
      meanShift: RpMeanShiftAccumulator.fromState(FA_RULE, shiftState(PAST_WARMUP)),
    });
    expect(FA_VARIABLE_NAMES).toHaveLength(2);
    expect(vector).toEqual([2, -1]);
  });

  it("is all-or-nothing per event: ONE team without history, no shift, even when the others are warm", () => {
    const inputs = faInputs();
    expect(
      fieldMeanShiftVector({
        roster: [...inputs.roster, "frc404"],
        rpAccumulator: inputs.rpAccumulator,
        meanShift: RpMeanShiftAccumulator.fromState(FA_RULE, shiftState(PAST_WARMUP)),
      })
    ).toBeUndefined();
  });

  it("returns undefined before the warmup, and with no accumulator or no shift at all", () => {
    const inputs = faInputs();
    const base = { roster: inputs.roster, rpAccumulator: inputs.rpAccumulator };
    expect(fieldMeanShiftVector({ ...base, meanShift: RpMeanShiftAccumulator.fromState(FA_RULE, shiftState(RP_MEAN_SHIFT_WARMUP_OBSERVATIONS - 1)) })).toBeUndefined();
    expect(fieldMeanShiftVector({ ...base, meanShift: undefined })).toBeUndefined();
    expect(fieldMeanShiftVector({ ...base, rpAccumulator: undefined, meanShift: RpMeanShiftAccumulator.fromState(FA_RULE, shiftState(PAST_WARMUP)) })).toBeUndefined();
  });

  it("an absent shift builds a byte-identical artifact; a present one moves the per-team pmfs", () => {
    const today = JSON.stringify(buildFieldAveragedPreScheduleArtifact(params()));
    expect(JSON.stringify(buildFieldAveragedPreScheduleArtifact(params(undefined)))).toBe(today);
    const shifted = buildFieldAveragedPreScheduleArtifact(params([2, -1]))!;
    expect(JSON.stringify(shifted)).not.toBe(today);
    expect(shifted.roster).toEqual(JSON.parse(today).roster);
  });
});

describe("preSchedule.ts's static import surface (plan 09-09 Task 2)", () => {
  /** A set-equality pin on `preSchedule.ts`'s static import specifiers, so a change to where pairing structures come from is a failing test. */
  const EXPECTED_IMPORT_SPECIFIERS: readonly string[] = [
    "./pageArtifacts.js",
    "../core/rankingPoints/fieldAveraged.js",
    "../core/rankingPoints/empiricalMoments.js",
    "../core/rankingPoints/constants.js",
    // The mean-shift leaf, for `fieldMeanShiftVector`'s fully-warm check; no pricing math.
    "../core/rankingPoints/meanShift.js",
    "./generatedSchedules.js",
    "./rounding.js",
    "../core/algorithms/simulation/rankSimulation.js",
    "../core/algorithms/types.js",
  ];

  it("imports exactly the expected set of module specifiers, no more and no fewer", () => {
    const source = readFileSync(new URL("./preSchedule.ts", import.meta.url), "utf8");
    const found = new Set<string>();
    for (const match of source.matchAll(/from\s+"([^"]+)"/g)) found.add(match[1]!);
    expect([...found].sort()).toEqual([...EXPECTED_IMPORT_SPECIFIERS].sort());
  });
});
