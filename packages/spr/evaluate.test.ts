/**
 * The MEASUREMENT contract, pinned on synthetic fixtures rather than the real
 * corpus (quick task 260909-03b, P3).
 *
 * Each case corresponds to one rule BPR previously got wrong in its own private
 * way, which is how it came to report a design-era figure that no other
 * algorithm's number was comparable to (260908-vqr F-01/F-08/F-12). A future
 * edit that quietly reintroduces half-credit scoring, drops the shared
 * population, or lets the D-07 surrogate exclusion touch the state stream fails
 * here rather than in a published number.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../corpus/db.js";
import { isSurrogateAffected, loadMatches, type BprMatch } from "./data.js";
import { runEval } from "./evaluate.js";
import { DEFAULTS } from "./model.js";

function match(over: Partial<BprMatch> & Pick<BprMatch, "matchKey">): BprMatch {
  return {
    eventKey: "2016test",
    year: 2016,
    compLevel: "qm",
    sortTime: 0,
    week: 0,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redOut: 60,
    blueOut: 50,
    redRaw: 60,
    blueRaw: 50,
    redFoul: 0,
    blueFoul: 0,
    redAdjust: 0,
    blueAdjust: 0,
    winner: "red",
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    eventType: 0,
    ...over,
  };
}

const YEARS = new Set([2016]);

describe("the no-call rule (D-Q3)", () => {
  it("puts a 0.5 prediction against a decided match IN the denominator and counts it a miss", () => {
    // Two identical teams on both sides with identical priors: the model has
    // no basis to prefer either alliance, so it predicts exactly 0.5.
    const m = match({
      matchKey: "m1",
      redTeams: ["frcA", "frcB", "frcC"],
      blueTeams: ["frcD", "frcE", "frcF"],
      winner: "red",
    });
    const r = runEval([m], DEFAULTS, { scoreYears: YEARS });

    expect(r.overall.noCall).toBe(1);
    // In the denominator...
    expect(r.overall.decided).toBe(1);
    // ...and never in the numerator. The retired rule scored 0.5 here.
    expect(r.overall.correct).toBe(0);
    expect(r.accuracy).toBe(0);
  });

  it("scores a no-call in Brier at 0.25, needing no special case", () => {
    const r = runEval([match({ matchKey: "m1", winner: "red" })], DEFAULTS, {
      scoreYears: YEARS,
    });
    expect(r.overall.noCall).toBe(1);
    expect(r.brier).toBeCloseTo(0.25, 12);
  });
});

describe("ties", () => {
  it("excludes an actual tie from the accuracy denominator but keeps it in Brier at target 0.5", () => {
    const r = runEval([match({ matchKey: "m1", winner: "tie" })], DEFAULTS, {
      scoreYears: YEARS,
    });

    expect(r.overall.n).toBe(1);
    expect(r.overall.ties).toBe(1);
    // Excluded from accuracy entirely — numerator AND denominator.
    expect(r.overall.decided).toBe(0);
    expect(r.overall.correct).toBe(0);
    // But present in the Brier population, scored against 0.5. The first
    // prediction is exactly 0.5, so the squared error is exactly 0.
    expect(r.overall.brier).toBeCloseTo(0, 12);
  });
});

describe("D-07 surrogate exclusion", () => {
  const stream = (surrogate: boolean): BprMatch[] => [
    match({
      matchKey: "m1",
      sortTime: 1,
      redOut: 90,
      blueOut: 40,
      redRaw: 90,
      blueRaw: 40,
      winner: "red",
      redSurrogates: surrogate ? ["frc2"] : [],
    }),
    match({
      matchKey: "m2",
      sortTime: 2,
      redOut: 70,
      blueOut: 55,
      redRaw: 70,
      blueRaw: 55,
      winner: "red",
    }),
  ];

  it("removes the surrogate-affected match from the scoreboard", () => {
    const scoredIn = runEval(stream(false), DEFAULTS, { scoreYears: YEARS });
    const scoredOut = runEval(stream(true), DEFAULTS, { scoreYears: YEARS });

    expect(scoredIn.overall.n).toBe(2);
    expect(scoredOut.overall.n).toBe(1);
  });

  it("leaves the state stream bit-identical, so a downstream prediction is unchanged", () => {
    // THE case that matters. The exclusion must touch the scoreboard and not
    // the model: the surrogate match is still predicted and still updated on,
    // so match 2's prediction must be the SAME double either way. If a future
    // edit `continue`s past the update instead of past the scoring, this fails.
    const capture = (surrogate: boolean): number[] => {
      const seen: number[] = [];
      runEval(stream(surrogate), DEFAULTS, {
        scoreYears: YEARS,
        onScored: (m, pRed) => {
          if (m.matchKey === "m2") seen.push(pRed);
        },
      });
      return seen;
    };

    const withScored = capture(false);
    const withExcluded = capture(true);

    expect(withScored).toHaveLength(1);
    expect(withExcluded).toHaveLength(1);
    // Bit-identical, not merely close.
    expect(withExcluded[0]).toBe(withScored[0]);
  });

  it("treats a surrogate on either alliance as affecting the match", () => {
    expect(isSurrogateAffected(match({ matchKey: "m", redSurrogates: ["frc1"] }))).toBe(true);
    expect(isSurrogateAffected(match({ matchKey: "m", blueSurrogates: ["frc4"] }))).toBe(true);
    expect(isSurrogateAffected(match({ matchKey: "m" }))).toBe(false);
  });
});

describe("the loaded population", () => {
  // These read the real corpus, so they are skipped where it is absent (CI).
  const CORPUS = "data/corpus.sqlite";
  let available = false;
  try {
    openCorpusReadOnly(CORPUS).close();
    available = true;
  } catch {
    available = false;
  }

  // Loaded ONCE for the whole block. Each of these cases used to call
  // loadMatches itself, which reads all ~152k matches (~3s alone, and well past
  // the 5s default timeout when the rest of the suite is running in parallel).
  let loaded: BprMatch[] = [];
  beforeAll(() => {
    if (available) loaded = loadMatches(CORPUS);
  }, 120_000);

  it.runIf(available)("excludes offseason matches altogether", () => {
    const keys = new Set(loaded.map((m) => m.matchKey));
    const db = openCorpusReadOnly(CORPUS);
    try {
      const offseason = db
        .prepare<[], { match_key: string }>(
          `select m.match_key from matches m join events e using(event_key)
            where e.is_offseason = 1 and m.winner is not null limit 200`,
        )
        .all();
      expect(offseason.length).toBeGreaterThan(0);
      for (const row of offseason) expect(keys.has(row.match_key)).toBe(false);
    } finally {
      db.close();
    }
  });

  it.runIf(available)("keeps event_type 100 matches the shared harness keeps", () => {
    // The retired private SQL dropped these — F-12's "~37/season the harness
    // keeps" half. This asserts the filter is genuinely gone.
    expect(loaded.some((m) => m.eventType === 100)).toBe(true);
  });

  it.runIf(available)("is globally non-decreasing in sort time, so no future match is stepped early", () => {
    // THE load-bearing ordering property for a walk-forward replay: the model
    // must never see a later-played match before an earlier-played one, across
    // events that overlap in the calendar.
    //
    // Deliberately NOT asserting that match numbers ascend within an event.
    // Measured 2026-09-09: TBA's sort_time is genuinely non-monotonic in match
    // number at a few events (2016ista played qm91-95 before qm81-86; 107 such
    // pairs in 2016 quals alone), and following actual play time there is
    // correct rather than a defect. Nor is the match_number TIEBREAK asserted:
    // the whole corpus holds exactly ONE adjacent same-event sort-time tie
    // (2018ncwin_qm12/qm32), so a tiebreak assertion would be vacuous. The
    // ordering change from the retired private SQL is immaterial on this
    // corpus; the POPULATION change is what moved the design-era figure.
    let regressions = 0;
    for (let i = 1; i < loaded.length; i += 1) {
      if (loaded[i]!.sortTime < loaded[i - 1]!.sortTime) regressions += 1;
    }
    expect(loaded.length).toBeGreaterThan(150_000);
    expect(regressions).toBe(0);
  });
});
