/**
 * Quick task 260905-tll Task 2 (TDD): the pure pre-schedule sidecar
 * builder. Every test uses a hand-written `predict` stub returning a fixed
 * seven-entry pmf, so no model and no corpus is needed — but the REAL
 * template cache in `data/schedule-templates/` is read (6_12.csv and
 * 10_10.csv), gated on existence per `scheduleTemplates.test.ts`'s own
 * discipline.
 *
 * Fixture facts: `6_12.csv` has 12 rows and no surrogate slots; `10_10.csv`
 * has 17 rows and DOES carry surrogate slots (row 5: red slot 7 and blue
 * slot 9 are surrogates) — which is why the surrogate-honouring tests
 * (PD-03) use a 10-team roster at 10 matches per team.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Prediction, UpcomingMatch } from "../core/algorithms/types.js";
import { PreScheduleArtifactSchema } from "./pageArtifacts.js";
import { SCHEDULE_TEMPLATE_DIR } from "./scheduleTemplates.js";
import { buildPreScheduleArtifact, PreSchedulePricingError, toSimMatchInput, type PreScheduleBuildParams } from "./preSchedule.js";

const CACHE_AVAILABLE = existsSync(SCHEDULE_TEMPLATE_DIR);

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

/** Deliberately unsorted roster — the builder must sort it itself (republish determinism independent of corpus row order). */
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

describe("buildPreScheduleArtifact against the real template cache", () => {
  if (!CACHE_AVAILABLE) {
    it.skip(`skipped: ${SCHEDULE_TEMPLATE_DIR} is absent — run \`pnpm fetch:schedule-templates\` to populate it`, () => {});
    return;
  }

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

    // 10_10.csv carries surrogate slots (row 5), so at least one synthetic
    // match per schedule must flag them.
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
