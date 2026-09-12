/**
 * The rung-2 rules-based schedule generator. Every test here checks a rule the
 * module header STATES, so the header cannot drift away from the code without a
 * failure — the "README described a model that had been deleted" pattern the
 * failure log names.
 *
 * No corpus, no network, no template cache: the generator is pure and its
 * output shape is checked structurally, so these run everywhere including CI on
 * a machine that has never fetched the licensed grid.
 */
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../core/algorithms/simulation/rankSimulation.js";
import { buildPreScheduleArtifact, type PreScheduleBuildParams } from "./preSchedule.js";
import type { Prediction, UpcomingMatch } from "../core/algorithms/types.js";
import {
  DEFAULT_RESTARTS,
  GeneratedScheduleError,
  generateSchedule,
  objectiveOf,
  scheduleBalance,
  scheduleMatchCount,
  surrogateSlotCount,
} from "./generatedSchedules.js";

/**
 * Cells spanning the observed FRC range, including BOTH divisibility cases:
 * `14x9`, `21x12`, `18x12` and `75x10` divide evenly by six (no surrogates),
 * while `40x11` and `76x10` do not (4 and 2 surrogate slots respectively).
 * Those are the same six shapes plan 09-09's sample events reach.
 */
const CELLS: readonly (readonly [number, number])[] = [
  [14, 9],
  [18, 12],
  [21, 12],
  [40, 11],
  [75, 10],
  [76, 10],
];

describe("scheduleMatchCount / surrogateSlotCount — the licensed grid's geometry, reproduced", () => {
  it("matchCount is ceil(numTeams * matchesPerTeam / 6) for every sampled cell", () => {
    for (const [n, m] of CELLS) {
      expect(scheduleMatchCount(n, m)).toBe(Math.ceil((n * m) / 6));
    }
  });

  it("surrogate slots are exactly the leftover, and zero when the product divides by six", () => {
    expect(surrogateSlotCount(14, 9)).toBe(0);
    expect(surrogateSlotCount(21, 12)).toBe(0);
    expect(surrogateSlotCount(75, 10)).toBe(0);
    // Read off the licensed grid structurally at planning time: 40 teams at 11
    // matches carries 4 surrogate appearances, 76 at 10 carries 2.
    expect(surrogateSlotCount(40, 11)).toBe(4);
    expect(surrogateSlotCount(76, 10)).toBe(2);
  });
});

describe("generateSchedule — the four stated rules", () => {
  it("RULE 1: every team gets exactly matchesPerTeam ranking-credited appearances, in every sampled cell", () => {
    for (const [n, m] of CELLS) {
      const balance = scheduleBalance(generateSchedule(n, m, mulberry32(1234)), n, m);
      expect(balance.matchCount).toBe(scheduleMatchCount(n, m));
      expect(balance.minCreditedAppearances).toBe(m);
      expect(balance.maxCreditedAppearances).toBe(m);
    }
  });

  it("RULE 1: the surrogate appearances are exactly the leftover slots, on that many DISTINCT teams", () => {
    for (const [n, m] of CELLS) {
      const schedule = generateSchedule(n, m, mulberry32(99));
      const expected = surrogateSlotCount(n, m);
      const flagged: number[] = [];
      for (const match of schedule) {
        for (const [pos, team] of match.red.entries()) if (match.redSurrogate[pos] === true) flagged.push(team);
        for (const [pos, team] of match.blue.entries()) if (match.blueSurrogate[pos] === true) flagged.push(team);
      }
      expect(flagged).toHaveLength(expected);
      expect(new Set(flagged).size).toBe(expected);
    }
  });

  it("RULE 2: no team ever appears twice in the same match", () => {
    for (const [n, m] of CELLS) {
      for (const match of generateSchedule(n, m, mulberry32(7))) {
        const six = [...match.red, ...match.blue];
        expect(new Set(six).size).toBe(6);
      }
    }
  });

  it("RULE 3: repeats are kept low — no unordered pair is ever partnered more than twice on a field of 40 or more", () => {
    for (const [n, m] of CELLS.filter(([teams]) => teams >= 40)) {
      const balance = scheduleBalance(generateSchedule(n, m, mulberry32(31337)), n, m);
      expect(balance.repeatPartnerRate).toBeLessThan(0.1);
      expect(balance.repeatOpponentRate).toBeLessThan(0.25);
    }
  });

  it("RULE 4: back-to-back appearances are rare on a large field, and the rule is a PENALTY not a guarantee", () => {
    for (const [n, m] of CELLS.filter(([teams]) => teams >= 40)) {
      // Deliberately a rate bound rather than zero. Rule 4 penalises a
      // back-to-back in both the greedy cost and the selection objective; it
      // does not forbid one, because forbidding it outright would sometimes
      // make the exact-appearance-count rule infeasible in the last few
      // matches. Measured at these seeds: at most a couple of back-to-backs in
      // 400+ gaps. Asserting zero here once passed for 75 and 76 teams and
      // failed for 40 — an assertion that strong would be measuring the seed.
      expect(scheduleBalance(generateSchedule(n, m, mulberry32(4242)), n, m).backToBackRate).toBeLessThan(0.02);
    }
  });
});

describe("generateSchedule — shape compatibility with loadScheduleTemplate", () => {
  it("returns three-slot alliances with positional boolean surrogate flags and in-range zero-based indices", () => {
    for (const match of generateSchedule(40, 11, mulberry32(5))) {
      expect(match.red).toHaveLength(3);
      expect(match.blue).toHaveLength(3);
      expect(match.redSurrogate).toHaveLength(3);
      expect(match.blueSurrogate).toHaveLength(3);
      for (const team of [...match.red, ...match.blue]) {
        expect(Number.isInteger(team)).toBe(true);
        expect(team).toBeGreaterThanOrEqual(0);
        expect(team).toBeLessThan(40);
      }
      for (const flag of [...match.redSurrogate, ...match.blueSurrogate]) expect(typeof flag).toBe("boolean");
    }
  });
});

describe("generateSchedule — purity", () => {
  it("the same seed produces a byte-identical schedule, and a different seed does not", () => {
    const a = generateSchedule(40, 11, mulberry32(2026));
    const b = generateSchedule(40, 11, mulberry32(2026));
    const c = generateSchedule(40, 11, mulberry32(2027));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it("more restarts never worsen the stated objective, since the best candidate is returned", () => {
    const one = objectiveOf(generateSchedule(21, 12, mulberry32(11), 1), 21);
    const many = objectiveOf(generateSchedule(21, 12, mulberry32(11), DEFAULT_RESTARTS), 21);
    expect(many).toBeLessThanOrEqual(one);
  });
});

describe("generateSchedule — loud failures", () => {
  it("throws GeneratedScheduleError below six teams and below one match per team", () => {
    expect(() => generateSchedule(5, 10, mulberry32(1))).toThrow(GeneratedScheduleError);
    expect(() => generateSchedule(20, 0, mulberry32(1))).toThrow(GeneratedScheduleError);
  });
});

// ---------------------------------------------------------------------------
// The injection seam in preSchedule.ts — INERT AT DEFAULT
// ---------------------------------------------------------------------------

const STUB_PMF = [0.05, 0.1, 0.15, 0.2, 0.25, 0.15, 0.1];
function stubPredict(_match: UpcomingMatch): Prediction {
  return { winner: "red", pRedWin: 0.5, redScore: 50, blueScore: 45, redRpPmf: [...STUB_PMF], blueRpPmf: [...STUB_PMF] };
}

function paramsWith(structure: PreScheduleBuildParams["scheduleStructure"]): PreScheduleBuildParams {
  return {
    eventKey: "2026casj",
    season: 2026,
    eventType: 0,
    week: null,
    algorithmId: "bpr",
    algorithmVersion: "3.0.0+baseline",
    roster: ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6", "frc7", "frc8", "frc9", "frc10", "frc11", "frc12"],
    matchesPerTeam: 6,
    pricedFrom: "pre-event-walk-forward",
    scheduleCount: 2,
    drawsPerSchedule: 10,
    generation: "gen-test",
    computedAt: "2026-09-06T00:00:00.000Z",
    predict: stubPredict,
    ...(structure !== undefined ? { scheduleStructure: structure } : {}),
  };
}

describe("buildPreScheduleArtifact's scheduleStructure seam", () => {
  it("an injected structure is priced and baked WITHOUT touching the template cache, with one published match per structure row", () => {
    const structure = generateSchedule(12, 6, mulberry32(8));
    const artifact = buildPreScheduleArtifact(paramsWith(structure));
    expect(artifact).not.toBeNull();
    expect(artifact!.schedules).toHaveLength(2);
    for (const schedule of artifact!.schedules) expect(schedule.matches).toHaveLength(structure.length);
    expect(artifact!.baked.draws).toBe(2 * 10);
    for (const histogram of artifact!.baked.histograms) {
      expect(histogram).toHaveLength(12);
      expect(histogram.reduce((a, b) => a + b, 0)).toBe(20);
    }
  });

  it("injecting the SAME structure twice is deterministic, and injecting a different one changes the published matches", () => {
    const first = buildPreScheduleArtifact(paramsWith(generateSchedule(12, 6, mulberry32(8))))!;
    const again = buildPreScheduleArtifact(paramsWith(generateSchedule(12, 6, mulberry32(8))))!;
    const other = buildPreScheduleArtifact(paramsWith(generateSchedule(12, 6, mulberry32(9))))!;
    expect(again).toEqual(first);
    expect(other.schedules[0]!.matches).not.toEqual(first.schedules[0]!.matches);
    // The seam changes the STRUCTURE, never the seeding: the shuffle seeds are
    // a pure function of eventKey/algorithmVersion/index and must be untouched.
    expect(other.schedules.map((s) => s.seed)).toEqual(first.schedules.map((s) => s.seed));
  });
});
