/**
 * `features.ts`'s hermetic suite — no corpus access, synthetic streams only,
 * so this stays fast. Covers: outcome-blindness (a 3-trap-surface Proxy),
 * prefix invariance (the lookahead detector), antisymmetry (both the
 * structural swap AND the symmetrized-probability identity), the season
 * boundary, equality-pinned feature enumeration, and event classes.
 */
import { describe, expect, it } from "vitest";
import type { GbrMatch } from "./data.js";
import { eventClassOf } from "./data.js";
import {
  carrySeason,
  extractFeatures,
  FEATURE_NAMES,
  initSeasonState,
  negateFeatures,
  SYMMETRIC,
  updateStates,
  type SeasonState,
} from "./features.js";

function match(over: Partial<GbrMatch> & Pick<GbrMatch, "matchKey">): GbrMatch {
  return {
    eventKey: "2016test",
    year: 2016,
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redSurrogates: [],
    blueSurrogates: [],
    winner: "red",
    redScore: 60,
    blueScore: 45,
    scoreBreakdownRaw: null,
    eventType: 0,
    ...over,
  };
}

/** A synthetic season where team strength is a deterministic function of team number. */
function syntheticSeason(n: number, year = 2016): GbrMatch[] {
  const out: GbrMatch[] = [];
  for (let i = 0; i < n; i += 1) {
    const r = [(i % 12) + 1, ((i * 5) % 12) + 1, ((i * 7) % 12) + 1];
    const b = [((i * 3) % 12) + 13, ((i * 11) % 12) + 13, ((i * 2) % 12) + 13];
    const redScore = 30 + 3 * (r[0] ?? 0) + 2 * (r[1] ?? 0) + (i % 7);
    const blueScore = 30 + (b[0] ?? 0) - 12 + 2 * ((b[1] ?? 0) - 12) + (i % 5);
    out.push(
      match({
        matchKey: `2016test_qm${i}`,
        matchNumber: i + 1,
        year,
        redTeams: r.map((t) => `frc${t}`),
        blueTeams: b.map((t) => `frc${t}`),
        redScore,
        blueScore,
        winner: redScore > blueScore ? "red" : redScore < blueScore ? "blue" : "tie",
      }),
    );
  }
  return out;
}

describe("outcome-blindness", () => {
  it("extractFeatures never touches winner/redScore/blueScore/scoreBreakdownRaw", () => {
    const OUTCOME_KEYS = new Set(["winner", "redScore", "blueScore", "scoreBreakdownRaw"]);
    const base = match({ matchKey: "guard_qm1" });

    const guarded = new Proxy(base, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && OUTCOME_KEYS.has(prop)) {
          throw new Error(`extractFeatures read outcome-bearing field "${prop}" via get`);
        }
        return Reflect.get(target, prop, receiver);
      },
      getOwnPropertyDescriptor(target, prop) {
        if (typeof prop === "string" && OUTCOME_KEYS.has(prop)) {
          throw new Error(`extractFeatures probed outcome-bearing field "${prop}" via getOwnPropertyDescriptor`);
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
      ownKeys(target) {
        // A key-enumeration trap that itself throws would break Object.keys
        // on every access, including legitimate ones extractFeatures may
        // perform. Filtering the outcome keys out of the enumerated set is
        // the third trap surface — extractFeatures must never rely on
        // enumerating this object's keys to find an outcome field.
        return Reflect.ownKeys(target).filter((k) => !(typeof k === "string" && OUTCOME_KEYS.has(k)));
      },
    });

    const state = initSeasonState(2016);
    expect(() => extractFeatures(state, guarded)).not.toThrow();
  });
});

describe("prefix invariance", () => {
  it("the feature vector at match k is byte-identical whether or not later matches exist", () => {
    const season = syntheticSeason(40);
    const checkpoints = [1, 5, 15, 30, 39];

    // Full run: record the feature vector observed at each checkpoint index.
    const fullRun = new Map<number, Float64Array>();
    {
      const state = initSeasonState(2016);
      for (let i = 0; i < season.length; i += 1) {
        const m = season[i]!;
        const vec = extractFeatures(state, m);
        if (checkpoints.includes(i)) fullRun.set(i, vec);
        updateStates(state, m);
      }
    }

    // Truncated runs: replay only matches[0..k), recording the vector at k-1.
    for (const k of checkpoints) {
      const state = initSeasonState(2016);
      let lastVec: Float64Array | null = null;
      for (let i = 0; i <= k; i += 1) {
        const m = season[i]!;
        const vec = extractFeatures(state, m);
        if (i === k) lastVec = vec;
        else updateStates(state, m);
      }
      const expected = fullRun.get(k);
      expect(expected).toBeDefined();
      expect(Array.from(lastVec!)).toEqual(Array.from(expected!));
    }
  });
});

describe("antisymmetry", () => {
  it("a genuine alliance swap re-extracts to exactly negateFeatures(x)", () => {
    const state = initSeasonState(2016);
    // Warm the state with a few matches so features are non-trivial.
    for (const m of syntheticSeason(10)) updateStates(state, m);

    const m = match({
      matchKey: "swap_qm1",
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc4", "frc5", "frc6"],
      compLevel: "sf",
      eventType: 1,
    });
    const swapped = match({
      matchKey: "swap_qm1",
      redTeams: m.blueTeams,
      blueTeams: m.redTeams,
      redSurrogates: m.blueSurrogates,
      blueSurrogates: m.redSurrogates,
      compLevel: m.compLevel,
      eventType: m.eventType,
    });

    const x = extractFeatures(state, m);
    const y = extractFeatures(state, swapped);
    const negated = negateFeatures(x);

    for (let i = 0; i < 25; i += 1) {
      expect(y[i]).toBeCloseTo(negated[i]!, 9);
    }
    // f0..f16 negate; f17..f24 are identical.
    for (let i = 0; i <= 16; i += 1) {
      expect(y[i]).toBeCloseTo(-(x[i] ?? 0), 9);
    }
    for (let i = 17; i <= 24; i += 1) {
      expect(y[i]).toBeCloseTo(x[i] ?? 0, 9);
    }
  });

  it("the symmetrized win probability satisfies p(swap) = 1 - p(x) within 1e-9", () => {
    // Purely algebraic identity: p(x) = (g(x) + 1 - g(negate(x))) / 2 for ANY
    // scoring function g, because negateFeatures is involutive
    // (negate(negate(x)) === x). Uses a toy scoring function since gbdt.ts
    // does not exist yet at this task.
    const toyScore = (v: Float64Array): number => {
      let s = 0;
      for (let i = 0; i < v.length; i += 1) s += (i + 1) * (v[i] ?? 0);
      return s;
    };
    const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
    const symmetrizedP = (v: Float64Array): number => {
      const gx = sigmoid(toyScore(v));
      const gNeg = sigmoid(toyScore(negateFeatures(v)));
      return (gx + (1 - gNeg)) / 2;
    };

    const state = initSeasonState(2016);
    for (const m of syntheticSeason(10)) updateStates(state, m);
    const x = extractFeatures(state, match({ matchKey: "sym_qm1" }));
    const swapped = negateFeatures(x);

    const px = symmetrizedP(x);
    const pSwap = symmetrizedP(swapped);
    expect(Math.abs(pSwap - (1 - px))).toBeLessThan(1e-9);
  });
});

describe("season boundary", () => {
  it("re-seeds Welford, zeros per-season fields, and applies the carryover rule", () => {
    const season = syntheticSeason(30);
    let state = initSeasonState(2016);
    for (const m of season) updateStates(state, m);

    const prevMean = state.mean;
    const prevSd = Math.max(Math.sqrt(state.M2 / (state.count - 1)), 1);
    const playedTeam = "frc1"; // appears in the synthetic season
    const marginZEwmaBefore = state.teams.get(playedTeam)!.marginZEwma;

    // A rookie-in-name-only team that never played: manufacture a stale
    // prevSeasonRating on it before carrying the boundary, to prove the
    // "did not play" branch decays the STALE value rather than freezing it.
    state.teams.set("frcstale", {
      ...state.teams.get(playedTeam)!,
      prevSeasonRating: 2.5,
      matchCount: 0,
      matchesThisEvent: 0,
      playedThisSeason: false,
      veteranSeasons: 1,
    });

    const next = carrySeason(state, 2017);

    expect(next.count).toBe(50);
    expect(next.mean).toBeCloseTo(prevMean, 9);
    const expectedM2 = prevSd * prevSd * 49;
    expect(next.M2).toBeCloseTo(expectedM2, 6);
    // Reproduces prevSd exactly.
    const nextSd = Math.max(Math.sqrt(next.M2 / (next.count - 1)), 1);
    expect(nextSd).toBeCloseTo(prevSd, 9);

    const played = next.teams.get(playedTeam)!;
    expect(played.matchCount).toBe(0);
    expect(played.matchesThisEvent).toBe(0);
    expect(played.scoreZEwma).toBe(0);
    expect(played.marginZEwma).toBe(0);
    expect(played.winEwma).toBe(0);
    expect(played.currentEventKey).toBeNull();
    expect(played.prevSeasonRating).toBeCloseTo(marginZEwmaBefore * 0.6, 9);
    expect(played.veteranSeasons).toBe(1); // 0 -> 1, first season played

    const stale = next.teams.get("frcstale")!;
    expect(stale.prevSeasonRating).toBeCloseTo(2.5 * 0.6, 9);
    expect(stale.veteranSeasons).toBe(1); // unchanged — did not play

    // A rookie never seen before this season boundary.
    expect(next.teams.has("frcrookie")).toBe(false);
    const state2 = initSeasonState(2016);
    expect(state2.teams.has("frcrookie")).toBe(false);
  });
});

describe("feature enumeration — equality pins, never iteration", () => {
  it("FEATURE_NAMES has exactly 25 entries", () => {
    expect(FEATURE_NAMES.length).toBe(25);
  });

  it("FEATURE_NAMES matches the pinned array exactly", () => {
    expect(FEATURE_NAMES).toEqual([
      "scoreZEwmaDiff",
      "marginZEwmaDiff",
      "winEwmaDiff",
      "scoreZMeanDiff",
      "marginZMeanDiff",
      "winMeanDiff",
      "autoShareEwmaDiff",
      "teleopShareEwmaDiff",
      "endgameShareEwmaDiff",
      "oppStrengthEwmaDiff",
      "prevSeasonRatingDiff",
      "veteranSeasonsDiff",
      "matchCountDiff",
      "matchesThisEventDiff",
      "marginZEwmaMinDiff",
      "marginZEwmaMaxDiff",
      "coldStartFlagDiff",
      "isElim",
      "eventClassRegional",
      "eventClassDistrict",
      "eventClassChamps",
      "eventClassOffseason",
      "meanMatchesThisEventAllSix",
      "meanMatchCountAllSix",
      "bothColdStart",
    ]);
  });

  it("SYMMETRIC has exactly 8 true entries", () => {
    expect(SYMMETRIC.filter(Boolean).length).toBe(8);
  });
});

describe("event classes (P-4)", () => {
  it("maps all nine observed event_type values by equality", () => {
    expect(eventClassOf(0)).toBe("regional");
    expect(eventClassOf(1)).toBe("district");
    expect(eventClassOf(2)).toBe("champs");
    expect(eventClassOf(3)).toBe("champs");
    expect(eventClassOf(4)).toBe("champs");
    expect(eventClassOf(5)).toBe("champs");
    expect(eventClassOf(6)).toBe("champs");
    expect(eventClassOf(99)).toBe("offseason");
    expect(eventClassOf(100)).toBe("offseason");
  });

  it("throws for an unmapped event_type", () => {
    expect(() => eventClassOf(42)).toThrow(/unmapped event_type 42/);
  });
});

describe("cold-start and zero-team guards", () => {
  it("extractFeatures throws for an empty alliance", () => {
    const state = initSeasonState(2016);
    const empty = match({ matchKey: "empty_qm1", redTeams: [] });
    expect(() => extractFeatures(state, empty)).toThrow(/empty alliance/);
  });

  it("every feature value is finite on the very first match of a season, and cold-start flags read 1", () => {
    const state: SeasonState = initSeasonState(2016);
    const m = syntheticSeason(1)[0]!;
    const vec = extractFeatures(state, m);
    for (let i = 0; i < vec.length; i += 1) {
      expect(Number.isFinite(vec[i])).toBe(true);
    }
    expect(vec[24]).toBe(1); // bothColdStart
    expect(vec[16]).toBe(0); // coldStartFlagDiff — both sides equally cold
  });
});
