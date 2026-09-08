import { describe, expect, it } from "vitest";
import type { BprMatch } from "./data.js";
import { runEval } from "./evaluate.js";
import { BprModel, DEFAULTS, type BprParams } from "./model.js";

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
    winner: "red",
    ...over,
  };
}

/** A synthetic season where team strength is a known function of team number. */
function season(n: number, scale = 1, year = 2016): BprMatch[] {
  const out: BprMatch[] = [];
  for (let i = 0; i < n; i += 1) {
    const r = [(i % 12) + 1, ((i * 5) % 12) + 1, ((i * 7) % 12) + 1];
    const b = [((i * 3) % 12) + 13, ((i * 11) % 12) + 13, ((i * 2) % 12) + 13];
    const redOut = (30 + 3 * (r[0] ?? 0) + 2 * (r[1] ?? 0) + (i % 7)) * scale;
    const blueOut = (30 + 3 * ((b[0] ?? 0) - 12) + 2 * ((b[1] ?? 0) - 12) + (i % 5)) * scale;
    out.push(
      match({
        matchKey: `2016test_qm${i}`,
        sortTime: i,
        year,
        redTeams: r.map((t) => `frc${t}`),
        blueTeams: b.map((t) => `frc${t}`),
        redOut,
        blueOut,
        redRaw: redOut,
        blueRaw: blueOut,
        winner: redOut > blueOut ? "red" : redOut < blueOut ? "blue" : "tie",
      }),
    );
  }
  return out;
}

const YEARS = new Set([2016]);

describe("walk-forward integrity", () => {
  it("does not let a match's own result influence its prediction", () => {
    // The single guarantee the whole exercise rests on. Flip one match's
    // result and every prediction up to and including it must be unchanged;
    // only predictions AFTER it may move.
    const a = season(200);
    const b = a.map((m, i) =>
      i === 120 ? { ...m, redOut: 5, winner: "blue" as const } : m,
    );

    const predsOf = (ms: BprMatch[]): number[] => {
      const model = new BprModel(DEFAULTS);
      const out: number[] = [];
      for (const m of ms) {
        const isElim = m.compLevel !== "qm";
        const p = model.predict(m.redTeams, m.blueTeams, m.year, isElim);
        out.push(p.pRed);
        const outcome = m.winner === "red" ? 1 : m.winner === "blue" ? 0 : 0.5;
        model.update(
          m.redTeams,
          m.blueTeams,
          m.year,
          m.redOut,
          m.blueOut,
          m.redFoul,
          m.blueFoul,
          outcome,
          isElim,
          p,
        );
      }
      return out;
    };

    const pa = predsOf(a);
    const pb = predsOf(b);
    for (let i = 0; i <= 120; i += 1) {
      expect(pb[i]).toBeCloseTo(pa[i] ?? 0, 12);
    }
    expect(pb.slice(121)).not.toEqual(pa.slice(121));
  });

  it("never scores a year it was told to stop before", () => {
    const ms = [...season(50, 1, 2016), ...season(50, 1, 2022)];
    const r = runEval(ms, DEFAULTS, {
      scoreYears: new Set([2016, 2022]),
      stopAfterYear: 2016,
    });
    expect(r.perYear.has(2022)).toBe(false);
    expect(r.perYear.get(2016)?.n).toBe(50);
  });
});

describe("scale-free state", () => {
  it("gives identical win probabilities when a season's scores are rescaled", () => {
    // The property that lets one hyperparameter set apply to a season whose
    // scoring level was never observed at design time. 2018 alliances scored
    // ~4x what 2016 alliances did; the model must not care.
    const base = runEval(season(300, 1), DEFAULTS, { scoreYears: YEARS });
    const big = runEval(season(300, 17.3), DEFAULTS, { scoreYears: YEARS });
    expect(big.accuracy).toBeCloseTo(base.accuracy, 12);
    expect(big.logLoss).toBeCloseTo(base.logLoss, 9);
  });
});

describe("knobs are inert at their defaults", () => {
  const ms = season(300);
  const baseline = runEval(ms, DEFAULTS, { scoreYears: YEARS });

  const cases: Array<[string, Partial<BprParams>]> = [
    ["rank weights", { w2: 1, w3: 1 }],
    ["defensive suppression", { defPriorVar: 0, defQ: 0 }],
    ["huber clip", { huberK: 1e9 }],
    ["side bias", { biasLr: 0 }],
    ["heteroscedastic noise", { obsSdSlope: 0 }],
  ];

  for (const [name, patch] of cases) {
    it(`${name} at default reproduces the base model exactly`, () => {
      const r = runEval(ms, { ...DEFAULTS, ...patch }, { scoreYears: YEARS });
      expect(r.accuracy).toBe(baseline.accuracy);
      expect(r.logLoss).toBeCloseTo(baseline.logLoss, 12);
    });
  }

  it("rank weights actually change predictions when enabled", () => {
    const r = runEval(ms, { ...DEFAULTS, w2: 0.7, w3: 0.5 }, { scoreYears: YEARS });
    expect(r.logLoss).not.toBeCloseTo(baseline.logLoss, 6);
  });
});

describe("metrics", () => {
  it("excludes ties from the accuracy denominator but scores them in Brier", () => {
    const ms = [
      match({ matchKey: "m1", sortTime: 1, winner: "tie", redOut: 50, blueOut: 50 }),
      match({ matchKey: "m2", sortTime: 2 }),
    ];
    const r = runEval(ms, DEFAULTS, { scoreYears: YEARS });
    expect(r.overall.n).toBe(2);
    expect(r.overall.ties).toBe(1);
    expect(r.overall.decided).toBe(1);
  });
});
