/**
 * The rules-based schedule generator, the only source of pre-schedule pairing
 * structure since quick task 260913-pnp. Every test here checks a rule the
 * module header STATES, so the header cannot drift away from the code without a
 * failure — the "README described a model that had been deleted" pattern the
 * failure log names.
 *
 * No corpus, no network, no files: the generator is pure and its output shape
 * is checked structurally, so these run everywhere including CI.
 */
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../core/algorithms/simulation/rankSimulation.js";
import {
  buildPreScheduleArtifact,
  ScheduleStructureCache,
  SCHEDULE_STRUCTURE_CACHE_CELLS,
  SHARED_STRUCTURE_CACHE,
  type PreScheduleBuildParams,
} from "./preSchedule.js";
import type { PreScheduleArtifact } from "./pageArtifacts.js";
import type { Prediction, UpcomingMatch } from "../core/algorithms/types.js";
import {
  DEFAULT_RESTARTS,
  GeneratedScheduleError,
  MAX_SCHEDULE_TEAMS,
  MIN_SCHEDULE_TEAMS,
  defaultMatchesPerTeam,
  generateSchedule,
  matchesPerTeamFor,
  objectiveOf,
  scheduleBalance,
  scheduleMatchCount,
  surrogateSlotCount,
  type ScheduleMatch,
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

describe("scheduleMatchCount / surrogateSlotCount — the six-slot geometry", () => {
  it("matchCount is ceil(numTeams * matchesPerTeam / 6) for every sampled cell", () => {
    for (const [n, m] of CELLS) {
      expect(scheduleMatchCount(n, m)).toBe(Math.ceil((n * m) / 6));
    }
  });

  it("surrogate slots are exactly the leftover, and zero when the product divides by six", () => {
    expect(surrogateSlotCount(14, 9)).toBe(0);
    expect(surrogateSlotCount(21, 12)).toBe(0);
    expect(surrogateSlotCount(75, 10)).toBe(0);
    // 40 teams at 11: 74 matches give 444 slots for 440 appearances, 4 over.
    // 76 at 10: 127 matches give 762 slots for 760, 2 over.
    expect(surrogateSlotCount(40, 11)).toBe(4);
    expect(surrogateSlotCount(76, 10)).toBe(2);
  });
});

describe("matchesPerTeamFor / defaultMatchesPerTeam", () => {
  it("truncates rather than rounds, and clamps into 1..14", () => {
    expect(matchesPerTeamFor(10, 16)).toBe(9); // trunc(96 / 10) = 9, not 10
    expect(matchesPerTeamFor(100, 1)).toBe(1); // trunc(6 / 100) = 0, clamped up
    expect(matchesPerTeamFor(10, 1000)).toBe(14); // trunc(600) clamped down
  });

  it("assumes 10 for a Championship Division (event type 3) and 12 otherwise", () => {
    expect(defaultMatchesPerTeam(3)).toBe(10);
    expect(defaultMatchesPerTeam(0)).toBe(12);
    expect(defaultMatchesPerTeam(1)).toBe(12);
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

describe("generateSchedule — the ScheduleMatch shape buildPreScheduleArtifact consumes", () => {
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

describe("generateSchedule — loud failures and the servable range", () => {
  it("MIN_SCHEDULE_TEAMS is 6 and MAX_SCHEDULE_TEAMS is 1024", () => {
    expect(MIN_SCHEDULE_TEAMS).toBe(6);
    expect(MAX_SCHEDULE_TEAMS).toBe(1024);
  });

  it("throws GeneratedScheduleError below six teams and below one match per team", () => {
    expect(() => generateSchedule(5, 10, mulberry32(1))).toThrow(GeneratedScheduleError);
    expect(() => generateSchedule(20, 0, mulberry32(1))).toThrow(GeneratedScheduleError);
  });

  it("throws GeneratedScheduleError above MAX_SCHEDULE_TEAMS, before any construction work", () => {
    let rngCalls = 0;
    const countingRng = (): number => {
      rngCalls += 1;
      return 0.5;
    };
    expect(() => generateSchedule(MAX_SCHEDULE_TEAMS + 1, 10, countingRng)).toThrow(GeneratedScheduleError);
    // Construction's first act is the surrogate shuffle, which draws from the
    // stream; an untouched stream means the throw came first.
    expect(rngCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildPreScheduleArtifact's generated structures (quick task 260913-pnp)
// ---------------------------------------------------------------------------

/**
 * FNV-1a 32-bit — this test's OWN copy of the seed contract, written out so a
 * change to the builder's hash or salt strings fails here rather than passing
 * against itself. Every structure seed is `fnv1a32("generate|n|mpt|k")` and
 * every shuffle seed `fnv1a32("eventKey|algorithmVersion|shuffle|k")`.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** This test's OWN copy of the Fisher–Yates contract: `slots[structureSlot]` is the sorted-roster index in that slot. */
function shuffleSlots(count: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const slots = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = slots[i]!;
    slots[i] = slots[j]!;
    slots[j] = tmp;
  }
  return slots;
}

function expectedStructure(numTeams: number, matchesPerTeam: number, k: number): ScheduleMatch[] {
  return generateSchedule(numTeams, matchesPerTeam, mulberry32(fnv1a32(`generate|${numTeams}|${matchesPerTeam}|${k}`)), DEFAULT_RESTARTS);
}

/** Undoes schedule `k`'s own published shuffle, recovering the structure's slot indices (flags are not published, so only `r`/`b`). */
function unshuffled(artifact: PreScheduleArtifact, k: number): { red: number[]; blue: number[] }[] {
  const slots = shuffleSlots(artifact.roster.length, artifact.schedules[k]!.seed);
  const slotOf = new Array<number>(slots.length);
  for (const [slot, rosterIndex] of slots.entries()) slotOf[rosterIndex] = slot;
  return artifact.schedules[k]!.matches.map((m) => ({ red: m.r.map((i) => slotOf[i]!), blue: m.b.map((i) => slotOf[i]!) }));
}

const STUB_PMF = [0.05, 0.1, 0.15, 0.2, 0.25, 0.15, 0.1];
function stubPredict(_match: UpcomingMatch): Prediction {
  return { winner: "red", pRedWin: 0.5, redScore: 50, blueScore: 45, redRpPmf: [...STUB_PMF], blueRpPmf: [...STUB_PMF] };
}

function rosterOf(size: number): string[] {
  return Array.from({ length: size }, (_, i) => `frc${i + 1}`);
}

function builderParams(overrides: Partial<PreScheduleBuildParams> = {}): PreScheduleBuildParams {
  return {
    eventKey: "2026casj",
    season: 2026,
    eventType: 0,
    week: null,
    algorithmId: "spr",
    algorithmVersion: "3.0.0+baseline",
    roster: rosterOf(12),
    matchesPerTeam: 6,
    pricedFrom: "pre-event-walk-forward",
    scheduleCount: 3,
    drawsPerSchedule: 10,
    generation: "gen-test",
    computedAt: "2026-09-06T00:00:00.000Z",
    predict: stubPredict,
    ...overrides,
  };
}

describe("buildPreScheduleArtifact — one generated structure per schedule", () => {
  it("gives each schedule scheduleMatchCount(12, 6) matches, and two identical calls are deep-equal", () => {
    const first = buildPreScheduleArtifact(builderParams())!;
    const again = buildPreScheduleArtifact(builderParams())!;
    expect(first.schedules).toHaveLength(3);
    for (const schedule of first.schedules) expect(schedule.matches).toHaveLength(scheduleMatchCount(12, 6));
    expect(again).toEqual(first);
  });

  it("EXACT CONSTRUCTION: schedule k's r/b arrays are generate|12|6|k's structure mapped through schedule k's own seeded shuffle", () => {
    // A builder that reused one structure for every k fails this at k=1.
    // Balance-profile inequality is NOT used as the proof: the generator
    // minimises exactly those quantities, so different k can legitimately tie.
    const artifact = buildPreScheduleArtifact(builderParams())!;
    for (let k = 0; k < artifact.schedules.length; k++) {
      const schedule = artifact.schedules[k]!;
      const slots = shuffleSlots(12, schedule.seed);
      const structure = expectedStructure(12, 6, k);
      expect(schedule.matches.map((m) => m.r)).toEqual(structure.map((m) => m.red.map((slot) => slots[slot]!)));
      expect(schedule.matches.map((m) => m.b)).toEqual(structure.map((m) => m.blue.map((slot) => slots[slot]!)));
    }
  });

  it("publishes shuffle seeds equal to fnv1a32(eventKey|algorithmVersion|shuffle|k), exactly as before", () => {
    const artifact = buildPreScheduleArtifact(builderParams())!;
    expect(artifact.schedules.map((s) => s.seed)).toEqual([0, 1, 2].map((k) => fnv1a32(`2026casj|3.0.0+baseline|shuffle|${k}`)));
  });

  it("SHARED BY SHAPE: two events with the same roster size and matches per team get identical structures per k and different seeds", () => {
    const a = buildPreScheduleArtifact(builderParams({ eventKey: "2026casj" }))!;
    const b = buildPreScheduleArtifact(builderParams({ eventKey: "2026milw", roster: rosterOf(12).map((t) => `${t}0`) }))!;
    for (let k = 0; k < a.schedules.length; k++) {
      expect(b.schedules[k]!.seed).not.toBe(a.schedules[k]!.seed);
      expect(unshuffled(b, k)).toEqual(unshuffled(a, k));
      expect(unshuffled(a, k)).toEqual(expectedStructure(12, 6, k).map((m) => ({ red: [...m.red], blue: [...m.blue] })));
    }
  });

  it("a 13-team build at 6 matches per team gets a different structure at k=0", () => {
    const twelve = buildPreScheduleArtifact(builderParams())!;
    const thirteen = buildPreScheduleArtifact(builderParams({ roster: rosterOf(13) }))!;
    expect(unshuffled(thirteen, 0)).toEqual(expectedStructure(13, 6, 0).map((m) => ({ red: [...m.red], blue: [...m.blue] })));
    expect(unshuffled(thirteen, 0)).not.toEqual(unshuffled(twelve, 0));
  });
});

describe("ScheduleStructureCache — transparent, bounded, compact", () => {
  it("the shared instance is capped at SCHEDULE_STRUCTURE_CACHE_CELLS (128)", () => {
    expect(SCHEDULE_STRUCTURE_CACHE_CELLS).toBe(128);
    expect(SHARED_STRUCTURE_CACHE.maxCells).toBe(SCHEDULE_STRUCTURE_CACHE_CELLS);
    expect(SHARED_STRUCTURE_CACHE.cellCount).toBeLessThanOrEqual(SCHEDULE_STRUCTURE_CACHE_CELLS);
  });

  it("serves fresh-equal structures on first request, on a warm read, and after its cell was evicted and regenerated, never holding more cells than its cap", () => {
    const cache = new ScheduleStructureCache(2);
    const keys: readonly (readonly [number, number, number])[] = [
      [12, 6, 0],
      [12, 6, 1],
      [13, 6, 0],
      [14, 6, 0], // third cell: evicts 12|6, the least recently used
      [12, 6, 1], // regenerated after eviction
      [13, 6, 0], // warm
    ];
    for (const [n, mpt, k] of keys) {
      const cold = cache.get(n, mpt, k);
      expect(cold).toEqual(expectedStructure(n, mpt, k));
      const warm = cache.get(n, mpt, k);
      expect(warm).toEqual(cold);
      expect(JSON.stringify(warm)).toBe(JSON.stringify(expectedStructure(n, mpt, k)));
      expect(cache.cellCount).toBeLessThanOrEqual(2);
    }
    expect(cache.hasCell(14, 6)).toBe(false); // evicted when 12|6 came back
    expect(cache.hasCell(12, 6)).toBe(true);
    expect(cache.hasCell(13, 6)).toBe(true);
  });

  it("evicts the least recently USED cell, not the oldest inserted", () => {
    const cache = new ScheduleStructureCache(2);
    cache.get(6, 2, 0);
    cache.get(7, 2, 0);
    cache.get(6, 2, 0); // touch 6|2, so 7|2 is now least recent
    cache.get(8, 2, 0);
    expect(cache.hasCell(6, 2)).toBe(true);
    expect(cache.hasCell(7, 2)).toBe(false);
    expect(cache.hasCell(8, 2)).toBe(true);
  });

  it("a caller mutating a returned structure cannot reach the cache", () => {
    const cache = new ScheduleStructureCache(1);
    const first = cache.get(10, 10, 0);
    (first[0]!.red as number[])[0] = 999;
    (first[0]!.redSurrogate as boolean[])[0] = true;
    expect(cache.get(10, 10, 0)).toEqual(expectedStructure(10, 10, 0));
  });

  it("round-trips surrogate flags and wide (two-byte) slot indices above 128 teams", () => {
    const cache = new ScheduleStructureCache(2);
    // 10 at 10 carries 2 surrogate slots; 130 at 2 needs indices past one byte.
    expect(cache.get(10, 10, 3)).toEqual(expectedStructure(10, 10, 3));
    expect(cache.get(10, 10, 3)).toEqual(expectedStructure(10, 10, 3));
    expect(cache.get(130, 2, 0)).toEqual(expectedStructure(130, 2, 0));
    expect(cache.get(130, 2, 0)).toEqual(expectedStructure(130, 2, 0));
  });

  it("a roster the generator refuses throws GeneratedScheduleError without inserting a cell", () => {
    const cache = new ScheduleStructureCache(1);
    cache.get(6, 2, 0);
    expect(() => cache.get(5, 2, 0)).toThrow(GeneratedScheduleError);
    expect(cache.hasCell(5, 2)).toBe(false);
    expect(cache.hasCell(6, 2)).toBe(true);
  });
});
