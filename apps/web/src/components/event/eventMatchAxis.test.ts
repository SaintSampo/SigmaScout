import { describe, expect, it } from "vitest";
import { PLOT_W, padAxisDomain } from "../team/matchAxis.js";
import {
  compareEventMatchRows,
  computeEventAxisDomain,
  EVENT_COMP_LEVEL_RANK,
  isElimCompLevel,
  isQualCompLevel,
  mergeEventMatches,
  type EventCompLevel,
  type EventMatch,
  type EventMatchRow,
  type EventUpcomingMatch,
} from "./eventMatchAxis.js";

/**
 * 07-VALIDATION.md's Wave 0 EVNT-04 test file (07-12-PLAN.md Task 1) — the
 * ordering, adjacency and empty probe evidence for the shared event-scoped
 * match machinery `QualsTab` (this plan), `ElimsTab` (07-13) and
 * `AlliancesTab` (07-14) all consume. Fixtures are hand-written object
 * literals shaped like `EventMatchSchema`/`EventUpcomingMatchSchema` rows,
 * mirroring `matchAxis.test.ts`'s own `makeMatch(overrides)` factory pattern
 * — never a network response.
 */

function makePlayed(overrides: Partial<EventMatch> = {}): EventMatch {
  return {
    matchKey: "2024casj_qm1",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc118"],
    blueTeams: ["frc254"],
    predictedWinner: "red",
    pRedWin: 0.6,
    predictedRedScore: 250,
    predictedBlueScore: 220,
    actualWinner: "red",
    actualRedScore: 260,
    actualBlueScore: 200,
    ...overrides,
  } as EventMatch;
}

function makeUpcoming(overrides: Partial<EventUpcomingMatch> = {}): EventUpcomingMatch {
  return {
    matchKey: "2024casj_qm2",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 2,
    redTeams: ["frc118"],
    blueTeams: ["frc254"],
    predictedWinner: "red",
    pRedWin: 0.55,
    predictedRedScore: 240,
    predictedBlueScore: 230,
    ...overrides,
  } as EventUpcomingMatch;
}

describe("Geometry single-sourcing", () => {
  it("PLOT_W is importable from matchAxis.js and is a positive finite number", () => {
    expect(Number.isFinite(PLOT_W)).toBe(true);
    expect(PLOT_W).toBeGreaterThan(0);
  });

  it("padAxisDomain widens a tight range, never narrows it", () => {
    const domain = padAxisDomain(100, 110);
    expect(domain.max - domain.min).toBeGreaterThan(10);
  });

  it("padAxisDomain never returns a min below zero", () => {
    expect(padAxisDomain(-50, -40).min).toBeGreaterThanOrEqual(0);
    expect(padAxisDomain(3, 8).min).toBeGreaterThanOrEqual(0);
    expect(padAxisDomain(0, 0).min).toBeGreaterThanOrEqual(0);
  });
});

describe("Comp-level predicates and rank", () => {
  it("EVENT_COMP_LEVEL_RANK has exactly the five keys, strictly increasing in qm/ef/qf/sf/f order", () => {
    const levels: EventCompLevel[] = ["qm", "ef", "qf", "sf", "f"];
    expect(Object.keys(EVENT_COMP_LEVEL_RANK).sort()).toEqual([...levels].sort());
    for (let i = 1; i < levels.length; i++) {
      expect(EVENT_COMP_LEVEL_RANK[levels[i]!]).toBeGreaterThan(EVENT_COMP_LEVEL_RANK[levels[i - 1]!]);
    }
  });

  it("isQualCompLevel/isElimCompLevel partition the enum", () => {
    const levels: EventCompLevel[] = ["qm", "ef", "qf", "sf", "f"];
    expect(isQualCompLevel("qm")).toBe(true);
    for (const level of ["ef", "qf", "sf", "f"] as const) {
      expect(isQualCompLevel(level)).toBe(false);
    }
    expect(isElimCompLevel("qm")).toBe(false);
    for (const level of ["ef", "qf", "sf", "f"] as const) {
      expect(isElimCompLevel(level)).toBe(true);
    }
    for (const level of levels) {
      expect(isQualCompLevel(level) !== isElimCompLevel(level)).toBe(true);
    }
  });
});

function rowFor(overrides: Partial<EventMatchRow>): EventMatchRow {
  return {
    matchKey: "m",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc1"],
    blueTeams: ["frc2"],
    predictedWinner: "red",
    pRedWin: 0.5,
    predictedRedScore: 100,
    predictedBlueScore: 100,
    played: false,
    ...overrides,
  };
}

describe("Ordering — the bracket chain (tie-break half, no sortTime anywhere in this group)", () => {
  it("orders qm before ef before qf before sf before f", () => {
    const levels: EventCompLevel[] = ["f", "sf", "qf", "ef", "qm"];
    const rows = levels.map((compLevel, index) => rowFor({ matchKey: `m${index}`, compLevel, setNumber: 1, matchNumber: 1 }));
    const sorted = [...rows].sort(compareEventMatchRows);
    expect(sorted.map((r) => r.compLevel)).toEqual(["qm", "ef", "qf", "sf", "f"]);
  });

  it("orders by ascending setNumber then ascending matchNumber within one comp level", () => {
    const rows = [
      rowFor({ matchKey: "a", compLevel: "qf", setNumber: 2, matchNumber: 1 }),
      rowFor({ matchKey: "b", compLevel: "qf", setNumber: 1, matchNumber: 2 }),
      rowFor({ matchKey: "c", compLevel: "qf", setNumber: 1, matchNumber: 1 }),
    ];
    const sorted = [...rows].sort(compareEventMatchRows);
    expect(sorted.map((r) => r.matchKey)).toEqual(["c", "b", "a"]);
  });

  it("breaks a tie on identical (compLevel,setNumber,matchNumber) by matchKey lexicographically, never zero", () => {
    const a = rowFor({ matchKey: "2024casj_qm1", setNumber: 1, matchNumber: 1 });
    const b = rowFor({ matchKey: "2024casj_qm1b", setNumber: 1, matchNumber: 1 });
    expect(compareEventMatchRows(a, b)).not.toBe(0);
    expect(compareEventMatchRows(a, b) < 0).toBe(true);
    expect(compareEventMatchRows(b, a) > 0).toBe(true);
  });
});

describe("Ordering — the leading sortTime comparison (07-13 amendment)", () => {
  it("orders two timed rows by ascending time even when the bracket chain disagrees", () => {
    // Chain would order b (qf1) before a (qf2); sortTime reverses it.
    const a = rowFor({ matchKey: "a", compLevel: "qf", setNumber: 2, matchNumber: 1, sortTime: 100 });
    const b = rowFor({ matchKey: "b", compLevel: "qf", setNumber: 1, matchNumber: 1, sortTime: 200 });
    const sorted = [a, b].sort(compareEventMatchRows);
    expect(sorted.map((r) => r.matchKey)).toEqual(["a", "b"]);
  });

  it("the 2022nhgrs series-major case: WITH timestamps yields real play order; WITHOUT timestamps yields series-major order", () => {
    // qf sets 1-4, two matches per set, real play order qf1m1 qf2m1 qf3m1 qf4m1 qf1m2 qf2m2 qf3m2 qf4m2
    const withTime: EventMatchRow[] = [
      rowFor({ matchKey: "qf1m1", compLevel: "qf", setNumber: 1, matchNumber: 1, sortTime: 1 }),
      rowFor({ matchKey: "qf2m1", compLevel: "qf", setNumber: 2, matchNumber: 1, sortTime: 2 }),
      rowFor({ matchKey: "qf3m1", compLevel: "qf", setNumber: 3, matchNumber: 1, sortTime: 3 }),
      rowFor({ matchKey: "qf4m1", compLevel: "qf", setNumber: 4, matchNumber: 1, sortTime: 4 }),
      rowFor({ matchKey: "qf1m2", compLevel: "qf", setNumber: 1, matchNumber: 2, sortTime: 5 }),
      rowFor({ matchKey: "qf2m2", compLevel: "qf", setNumber: 2, matchNumber: 2, sortTime: 6 }),
      rowFor({ matchKey: "qf3m2", compLevel: "qf", setNumber: 3, matchNumber: 2, sortTime: 7 }),
      rowFor({ matchKey: "qf4m2", compLevel: "qf", setNumber: 4, matchNumber: 2, sortTime: 8 }),
    ];
    // Shuffle input order so the assertion doesn't pass by input-order coincidence.
    const shuffled = [withTime[3]!, withTime[0]!, withTime[6]!, withTime[1]!, withTime[7]!, withTime[2]!, withTime[5]!, withTime[4]!];
    const sortedWithTime = [...shuffled].sort(compareEventMatchRows);
    expect(sortedWithTime.map((r) => r.matchKey)).toEqual(["qf1m1", "qf2m1", "qf3m1", "qf4m1", "qf1m2", "qf2m2", "qf3m2", "qf4m2"]);

    const withoutTime = withTime.map((r) => ({ ...r, sortTime: undefined }));
    const shuffledNoTime = [withoutTime[3]!, withoutTime[0]!, withoutTime[6]!, withoutTime[1]!, withoutTime[7]!, withoutTime[2]!, withoutTime[5]!, withoutTime[4]!];
    const sortedNoTime = [...shuffledNoTime].sort(compareEventMatchRows);
    expect(sortedNoTime.map((r) => r.matchKey)).toEqual(["qf1m1", "qf1m2", "qf2m1", "qf2m2", "qf3m1", "qf3m2", "qf4m1", "qf4m2"]);
  });

  it("two rows carrying an identical sortTime fall through to the bracket chain, never returned as equal", () => {
    const a = rowFor({ matchKey: "2024casj_qf2m1", compLevel: "qf", setNumber: 2, matchNumber: 1, sortTime: 500 });
    const b = rowFor({ matchKey: "2024casj_qf1m1", compLevel: "qf", setNumber: 1, matchNumber: 1, sortTime: 500 });
    const sorted = [a, b].sort(compareEventMatchRows);
    expect(sorted.map((r) => r.matchKey)).toEqual(["2024casj_qf1m1", "2024casj_qf2m1"]);
    expect(compareEventMatchRows(a, b)).not.toBe(0);
  });

  it("a row WITH sortTime sorts first over a row without one, regardless of what the chain would say", () => {
    // Chain alone would order b (qm1) before a (qm2); presence split reverses it.
    const a = rowFor({ matchKey: "a", compLevel: "qm", setNumber: 1, matchNumber: 2, sortTime: 10 });
    const b = rowFor({ matchKey: "b", compLevel: "qm", setNumber: 1, matchNumber: 1, sortTime: undefined });
    const sorted = [a, b].sort(compareEventMatchRows);
    expect(sorted.map((r) => r.matchKey)).toEqual(["a", "b"]);
  });

  it("transitivity holds under mixing: all six permutations of a timed/untimed three-row fixture yield the identical output sequence", () => {
    // A: late time. B: no time. C: early time. Chain would place B before C, and A before B.
    const a = rowFor({ matchKey: "A", compLevel: "qm", setNumber: 1, matchNumber: 1, sortTime: 900 });
    const b = rowFor({ matchKey: "B", compLevel: "qm", setNumber: 2, matchNumber: 1, sortTime: undefined });
    const c = rowFor({ matchKey: "C", compLevel: "qm", setNumber: 3, matchNumber: 1, sortTime: 100 });

    const rows = [a, b, c];
    function permutations<T>(arr: T[]): T[][] {
      if (arr.length <= 1) return [arr];
      const result: T[][] = [];
      for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        for (const perm of permutations(rest)) {
          result.push([arr[i]!, ...perm]);
        }
      }
      return result;
    }

    const outputs = permutations(rows).map((perm) => [...perm].sort(compareEventMatchRows).map((r) => r.matchKey));
    for (const output of outputs) {
      expect(output).toEqual(["C", "A", "B"]);
    }
  });

  it("totality survives the amendment: over a mixed timed/untimed fixture every distinct-matchKey pair is non-zero", () => {
    const rows: EventMatchRow[] = [
      rowFor({ matchKey: "a", sortTime: 5 }),
      rowFor({ matchKey: "b", sortTime: undefined }),
      rowFor({ matchKey: "c", sortTime: 5 }),
      rowFor({ matchKey: "d", sortTime: undefined }),
    ];
    for (const x of rows) {
      for (const y of rows) {
        if (x.matchKey !== y.matchKey) {
          expect(compareEventMatchRows(x, y)).not.toBe(0);
        }
      }
    }
  });

  it("no fabricated time reaches a row: merging a fixture with no sortTime yields rows whose sortTime is strictly undefined", () => {
    const merged = mergeEventMatches([makePlayed({ sortTime: undefined })], [], isQualCompLevel);
    expect(merged[0]!.sortTime).toBe(undefined);
  });

  it("mergeEventMatches returns the same matchKey sequence regardless of input array order", () => {
    const played = [makePlayed({ matchKey: "p1", matchNumber: 1 }), makePlayed({ matchKey: "p2", matchNumber: 3 })];
    const upcoming = [makeUpcoming({ matchKey: "u1", matchNumber: 2 }), makeUpcoming({ matchKey: "u2", matchNumber: 4 })];

    const forward = mergeEventMatches(played, upcoming, isQualCompLevel).map((r) => r.matchKey);
    const shuffledPlayed = [played[1]!, played[0]!];
    const shuffledUpcoming = [upcoming[1]!, upcoming[0]!];
    const reversed = mergeEventMatches(shuffledPlayed, shuffledUpcoming, isQualCompLevel).map((r) => r.matchKey);

    expect(reversed).toEqual(forward);
  });

  it("the 2023nhgrs shape: 3 played + 3 upcoming merge to 6 rows in matchNumber order, interleaved by number not concatenated by source", () => {
    const played = [1, 2, 3].map((n) => makePlayed({ matchKey: `p${n}`, matchNumber: n }));
    const upcoming = [4, 5, 6].map((n) => makeUpcoming({ matchKey: `u${n}`, matchNumber: n }));
    const merged = mergeEventMatches(played, upcoming, isQualCompLevel);
    expect(merged.map((r) => r.matchNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(merged.slice(0, 3).every((r) => r.played)).toBe(true);
    expect(merged.slice(3).every((r) => !r.played)).toBe(true);
  });

  it("an upcoming row whose matchNumber falls between two played rows sorts into that position, not the end", () => {
    const played = [makePlayed({ matchKey: "p1", matchNumber: 1 }), makePlayed({ matchKey: "p3", matchNumber: 3 })];
    const upcoming = [makeUpcoming({ matchKey: "u2", matchNumber: 2 })];
    const merged = mergeEventMatches(played, upcoming, isQualCompLevel);
    expect(merged.map((r) => r.matchKey)).toEqual(["p1", "u2", "p3"]);
  });
});

describe("Adjacency", () => {
  it("two rows sharing an identical (compLevel,setNumber,matchNumber) but differing matchKey both appear, separated in matchKey order", () => {
    const played = [
      makePlayed({ matchKey: "2024casj_qm1", matchNumber: 1 }),
      makePlayed({ matchKey: "2024casj_qm1b", matchNumber: 1 }),
    ];
    const merged = mergeEventMatches(played, [], isQualCompLevel);
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.matchKey)).toEqual(["2024casj_qm1", "2024casj_qm1b"]);
  });

  it("a matchKey present in both arrays yields exactly one output row, played, carrying the played row's actual scores", () => {
    const played = [makePlayed({ matchKey: "shared", actualRedScore: 300, actualBlueScore: 100 })];
    const upcoming = [makeUpcoming({ matchKey: "shared" })];
    const merged = mergeEventMatches(played, upcoming, isQualCompLevel);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.played).toBe(true);
    expect(merged[0]!.actualRedScore).toBe(300);
    expect(merged[0]!.actualBlueScore).toBe(100);
  });

  it("computeEventAxisDomain over two rows whose predicted bands exactly touch spans both, dropping neither extent", () => {
    const rows: EventMatchRow[] = [
      rowFor({ matchKey: "a", predictedRedScore: 100, predictedBlueScore: 100, redScoreVarianceOwn: 100, blueScoreVarianceOwn: 100 }), // band [90,110]
      rowFor({ matchKey: "b", predictedRedScore: 130, predictedBlueScore: 130, redScoreVarianceOwn: 400, blueScoreVarianceOwn: 400 }), // band [110,150]
    ];
    const domain = computeEventAxisDomain(rows);
    expect(domain.min).toBeLessThanOrEqual(90);
    expect(domain.max).toBeGreaterThanOrEqual(150);
  });

  it("a row whose variance fields are both exactly 0 contributes its predicted scores and no wider extent", () => {
    const rows: EventMatchRow[] = [rowFor({ matchKey: "a", predictedRedScore: 100, predictedBlueScore: 120, redScoreVarianceOwn: 0, blueScoreVarianceOwn: 0 })];
    const domain = computeEventAxisDomain(rows);
    expect(domain.min).toBeLessThanOrEqual(100);
    expect(domain.max).toBeGreaterThanOrEqual(120);
  });
});

describe("Empty and single", () => {
  it("mergeEventMatches([], [], isQualCompLevel) returns an empty array", () => {
    expect(mergeEventMatches([], [], isQualCompLevel)).toEqual([]);
  });

  it("the Einstein shape: matches all sf/f, upcoming empty — empty under isQualCompLevel, non-empty under isElimCompLevel", () => {
    const matches = [makePlayed({ matchKey: "sf1", compLevel: "sf" }), makePlayed({ matchKey: "f1", compLevel: "f" })];
    expect(mergeEventMatches(matches, [], isQualCompLevel)).toEqual([]);
    expect(mergeEventMatches(matches, [], isElimCompLevel).length).toBeGreaterThan(0);
  });

  it("the 2025srsd shape: empty matches with 3 upcoming quals yields 3 rows, all played false", () => {
    const upcoming = [1, 2, 3].map((n) => makeUpcoming({ matchKey: `u${n}`, matchNumber: n }));
    const merged = mergeEventMatches([], upcoming, isQualCompLevel);
    expect(merged).toHaveLength(3);
    expect(merged.every((r) => !r.played)).toBe(true);
  });

  it("a single row yields a domain whose max is strictly greater than its min", () => {
    const domain = computeEventAxisDomain([rowFor({ matchKey: "a", predictedRedScore: 100, predictedBlueScore: 100 })]);
    expect(domain.max).toBeGreaterThan(domain.min);
  });

  it("computeEventAxisDomain([]) returns a finite domain with max strictly greater than min", () => {
    const domain = computeEventAxisDomain([]);
    expect(Number.isFinite(domain.min)).toBe(true);
    expect(Number.isFinite(domain.max)).toBe(true);
    expect(domain.max).toBeGreaterThan(domain.min);
  });

  it("a row carrying neither variance field contributes only its predicted+actual point values and does not throw", () => {
    const row = rowFor({
      matchKey: "a",
      predictedRedScore: 100,
      predictedBlueScore: 120,
      redScoreVarianceOwn: undefined,
      blueScoreVarianceOwn: undefined,
      played: true,
      actualRedScore: 105,
      actualBlueScore: 115,
    });
    expect(() => computeEventAxisDomain([row])).not.toThrow();
    const domain = computeEventAxisDomain([row]);
    expect(domain.min).toBeLessThanOrEqual(100);
    expect(domain.max).toBeGreaterThanOrEqual(120);
  });

  it("a row carrying only redScoreVarianceOwn contributes red's band extents and blue's point value", () => {
    const row = rowFor({
      matchKey: "a",
      predictedRedScore: 100,
      predictedBlueScore: 100,
      redScoreVarianceOwn: 400,
      blueScoreVarianceOwn: undefined,
    });
    const domain = computeEventAxisDomain([row]);
    expect(domain.max).toBeGreaterThanOrEqual(120); // 100 + sqrt(400)
  });
});

describe("Domain content (D-12)", () => {
  it("the domain spans played AND upcoming rows: an upcoming row's high score is accommodated", () => {
    const played = [makePlayed({ matchKey: "p1", predictedRedScore: 200, predictedBlueScore: 200, actualRedScore: 200, actualBlueScore: 200 })];
    const upcoming = [makeUpcoming({ matchKey: "u1", predictedRedScore: 400, predictedBlueScore: 380 })];
    const merged = mergeEventMatches(played, upcoming, isQualCompLevel);
    const domain = computeEventAxisDomain(merged);
    expect(domain.max).toBeGreaterThan(400);
  });

  it("actual scores widen the domain: a badly-missed prediction's dot is never clipped", () => {
    const played = [makePlayed({ matchKey: "p1", predictedRedScore: 100, predictedBlueScore: 100, actualRedScore: 500, actualBlueScore: 90 })];
    const domain = computeEventAxisDomain(mergeEventMatches(played, [], isQualCompLevel));
    expect(domain.max).toBeGreaterThan(500);
  });
});
