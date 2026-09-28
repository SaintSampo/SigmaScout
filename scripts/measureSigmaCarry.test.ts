/**
 * `scripts/measureSigmaCarry.ts`, the Part 2 instrument for gates G2 to G4 of the pre-registered
 * Sigma-carry bar. The pure figures and the mechanical verdict are pinned directly; the measurement
 * loop runs on the committed 2022 digest slice, where it must show the two arms differing ONLY by the
 * knob: identical figures when there is nothing to carry, identical observation sets always, and a
 * candidate that never drops a match the incumbent prices.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult } from "../packages/core/algorithms/types.js";
import { resolvePublishAlgorithms } from "../packages/harness/publish.js";
import {
  bandCalibrationError,
  climatologyBonusProbability,
  climatologyRpPmf,
  EMPTY_RP_FIGURES,
  judgeRpPriorBar,
  judgeSigmaCarryBar,
  measureSigmaCarry,
  NOMINAL_1SIGMA_COVERAGE,
  poolColdSplit,
  poolRpFigures,
  poolSeasons,
  rpFiguresOf,
  SIGMA_CARRY_COUNTED_SEASONS,
  SIGMA_CARRY_REPLAY_SEASONS,
  type PooledSigmaCarry,
  type RpFigures,
} from "./measureSigmaCarry.js";

const fixture = JSON.parse(readFileSync(join("packages", "harness", "fixtures", "digest-slice.json"), "utf8")) as {
  sliceSeason: number;
  matches: MatchResult[];
};
const spr = resolvePublishAlgorithms("spr")[0] as AlgorithmModule<unknown>;

const figures = (bonusBrier: number, totalRpRps: number, n = 100): RpFigures => ({
  bonusCount: n,
  bonusBrier,
  totalRpCount: n,
  totalRpRps,
  outcomeCount: 0,
  outcomeBrier: Number.NaN,
});

/** A pooled result that passes every gate; each FAIL case below breaks exactly one thing. */
function passing(): PooledSigmaCarry {
  return {
    band: { incumbent: { n: 1000, inside1: 720, inside2: 950 }, candidate: { n: 1000, inside1: 700, inside2: 950 } },
    played: { incumbent: figures(0.2, 0.1), candidate: figures(0.19, 0.1) },
    matched: { incumbent: figures(0.2, 0.1), candidate: figures(0.2, 0.09) },
    fresh: { candidate: figures(0.18, 0.12), reference: figures(0.22, 0.15) },
    coverage: { incumbent: 500, candidate: 900, newlyCovered: 400, dropped: 0 },
  };
}

describe("the season lists are the pre-registered ones", () => {
  it("replays the published gapped list and counts every season but the cold-start 2016", () => {
    expect([...SIGMA_CARRY_REPLAY_SEASONS]).toEqual([2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026]);
    expect([...SIGMA_CARRY_COUNTED_SEASONS]).toEqual([2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026]);
    expect(NOMINAL_1SIGMA_COVERAGE).toBe(0.683);
  });
});

describe("the G4b climatology reference", () => {
  it("is Jeffreys-smoothed for a bonus: one half with no evidence, (k + 0.5)/(n + 1) with it", () => {
    expect(climatologyBonusProbability(0, 0)).toBe(0.5);
    expect(climatologyBonusProbability(3, 9)).toBe(0.35);
  });

  it("is a proper pmf over 0..maxRp for total RP, uniform with no evidence", () => {
    expect(climatologyRpPmf([0, 0, 0, 0, 0], 0, 4)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    const pmf = climatologyRpPmf([1, 5, 2, 0, 2], 10, 4);
    expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(pmf[1]).toBeCloseTo((5 + 0.2) / 11, 12);
    expect(() => climatologyRpPmf([1, 2], 3, 4)).toThrow(/counts for maxRp/);
  });
});

describe("figures", () => {
  it("rpFiguresOf's pooled bonus Brier is the mean over every observation, through the published builder", () => {
    const perBonus = [
      [
        { predicted: 0.9, actual: true },
        { predicted: 0.2, actual: false },
      ],
      [{ predicted: 0.6, actual: false }],
    ];
    const f = rpFiguresOf(["a", "b"], perBonus, [{ pmf: [0.5, 0.3, 0.2], actual: 1 }], []);
    const direct = ((0.9 - 1) ** 2 + 0.2 ** 2 + 0.6 ** 2) / 3;
    expect(f.bonusCount).toBe(3);
    expect(f.bonusBrier).toBeCloseTo(direct, 12);
    expect(f.totalRpCount).toBe(1);
    expect(f.outcomeCount).toBe(0);
  });

  it("pooling is count-weighted and skips empty parts", () => {
    const pooled = poolRpFigures([figures(0.1, 0.2, 100), figures(0.4, 0.5, 300), EMPTY_RP_FIGURES]);
    expect(pooled.bonusCount).toBe(400);
    expect(pooled.bonusBrier).toBeCloseTo(0.325, 12);
    expect(pooled.totalRpRps).toBeCloseTo(0.425, 12);
  });

  it("the band calibration error is |share inside one band - 0.683|", () => {
    expect(bandCalibrationError({ n: 1000, inside1: 700, inside2: 0 })).toBeCloseTo(0.017, 12);
    expect(Number.isNaN(bandCalibrationError({ n: 0, inside1: 0, inside2: 0 }))).toBe(true);
  });
});

describe("judgeSigmaCarryBar — the mechanical verdict", () => {
  it("PASS when every gate passes", () => {
    const verdict = judgeSigmaCarryBar(passing());
    expect(verdict.gates.map((g) => `${g.gate}:${g.status}`)).toEqual(["G2:PASS", "G3:PASS", "G4-cover:PASS", "G4a:PASS", "G4b:PASS"]);
    expect(verdict.overall).toBe("PASS");
  });

  it("each gate fails on its own condition, and ties pass the not-worse gates but not G4b", () => {
    const worseBand = { ...passing(), band: { incumbent: { n: 1000, inside1: 690, inside2: 0 }, candidate: { n: 1000, inside1: 720, inside2: 0 } } };
    expect(judgeSigmaCarryBar(worseBand).gates.find((g) => g.gate === "G2")!.status).toBe("FAIL");

    const worseBonus = { ...passing(), played: { incumbent: figures(0.2, 0.1), candidate: figures(0.2001, 0.09) } };
    expect(judgeSigmaCarryBar(worseBonus).gates.find((g) => g.gate === "G3")!.status).toBe("FAIL");
    const tiedPlayed = { ...passing(), played: { incumbent: figures(0.2, 0.1), candidate: figures(0.2, 0.1) } };
    expect(judgeSigmaCarryBar(tiedPlayed).gates.find((g) => g.gate === "G3")!.status).toBe("PASS");

    const dropped = { ...passing(), coverage: { incumbent: 500, candidate: 899, newlyCovered: 400, dropped: 1 } };
    expect(judgeSigmaCarryBar(dropped).gates.find((g) => g.gate === "G4-cover")!.status).toBe("FAIL");

    const worseMatched = { ...passing(), matched: { incumbent: figures(0.2, 0.1), candidate: figures(0.19, 0.11) } };
    expect(judgeSigmaCarryBar(worseMatched).gates.find((g) => g.gate === "G4a")!.status).toBe("FAIL");

    const tiedFresh = { ...passing(), fresh: { candidate: figures(0.2, 0.1), reference: figures(0.2, 0.2) } };
    expect(judgeSigmaCarryBar(tiedFresh).gates.find((g) => g.gate === "G4b")!.status).toBe("FAIL");
    expect(judgeSigmaCarryBar(tiedFresh).overall).toBe("FAIL");
  });

  it("VOID, never a silent score, when the arms saw different observation sets or nothing at all", () => {
    const mismatched = { ...passing(), played: { incumbent: figures(0.2, 0.1, 100), candidate: figures(0.1, 0.05, 99) } };
    expect(judgeSigmaCarryBar(mismatched).gates.find((g) => g.gate === "G3")!.status).toBe("VOID");
    expect(judgeSigmaCarryBar(mismatched).overall).toBe("VOID");

    const nothingNew = { ...passing(), fresh: { candidate: EMPTY_RP_FIGURES, reference: EMPTY_RP_FIGURES } };
    expect(judgeSigmaCarryBar(nothingNew).gates.find((g) => g.gate === "G4b")!.status).toBe("VOID");

    const failAndVoid = { ...mismatched, coverage: { ...passing().coverage, dropped: 2 } };
    expect(judgeSigmaCarryBar(failAndVoid).overall).toBe("FAIL");
  });
});

describe("measureSigmaCarry on the committed 2022 slice", () => {
  const streamFor = (season: number): MatchResult[] => {
    if (season === fixture.sliceSeason) return fixture.matches;
    // A synthetic second season: the same matches, re-keyed and re-dated, so the carry has somewhere to land.
    return fixture.matches.map((m) => ({
      ...m,
      matchKey: m.matchKey.replace(String(fixture.sliceSeason), String(season)),
      eventKey: m.eventKey.replace(String(fixture.sliceSeason), String(season)),
    }));
  };

  it("with nothing to carry (a one-season run), the arms' played figures are IDENTICAL and the candidate drops nothing", () => {
    const [season] = measureSigmaCarry({ seasons: [2022], counted: new Set([2022]), algorithm: spr, streamFor });
    expect(season).toBeDefined();
    expect(season!.band.candidate).toEqual(season!.band.incumbent);
    expect(season!.band.incumbent.n).toBeGreaterThan(0);
    expect(season!.played.candidate).toEqual(season!.played.incumbent);
    expect(season!.played.incumbent.bonusCount).toBeGreaterThan(0);
    expect(season!.matched.candidate).toEqual(season!.matched.incumbent);
    expect(season!.coverage.dropped).toBe(0);
    expect(season!.coverage.candidate).toBe(season!.coverage.incumbent + season!.coverage.newlyCovered);
    // The rookie rule really does price the later events' cold rosters.
    expect(season!.coverage.newlyCovered).toBeGreaterThan(0);
    expect(season!.fresh.candidate.totalRpCount).toBe(season!.fresh.reference.totalRpCount);
    expect(season!.fresh.candidate.bonusCount).toBe(season!.fresh.reference.bonusCount);
  });

  it("with a carry, the second season's arms differ but always score the same observation sets", () => {
    const seasons = measureSigmaCarry({ seasons: [2022, 2023], counted: new Set([2023]), algorithm: spr, streamFor });
    expect(seasons.map((s) => s.season)).toEqual([2023]);
    const s = seasons[0]!;
    expect(s.band.candidate.n).toBe(s.band.incumbent.n);
    expect(s.played.candidate.totalRpCount).toBe(s.played.incumbent.totalRpCount);
    expect(s.played.candidate.bonusCount).toBe(s.played.incumbent.bonusCount);
    expect(s.coverage.dropped).toBe(0);
    // Non-vacuity: the carry moved the played-row pricing.
    expect(s.played.candidate.totalRpRps).not.toBe(s.played.incumbent.totalRpRps);
    const verdict = judgeSigmaCarryBar(poolSeasons(seasons));
    expect(verdict.gates.map((g) => g.gate)).toEqual(["G2", "G3", "G4-cover", "G4a", "G4b"]);
  });
});

// ──────── bar R and the retry (260928-n6i-PREREG.md) ─────────────────────

describe("judgeRpPriorBar — bar R's mechanical verdict", () => {
  const pooledOf = (played: { incumbent: RpFigures; candidate: RpFigures }, matched: { incumbent: RpFigures; candidate: RpFigures }) => ({
    ...passing(),
    played,
    matched,
  });

  it("PASS when R1 improves both metrics strictly and R2 is not worse on either, in the order R1, R2", () => {
    const verdict = judgeRpPriorBar(
      pooledOf({ incumbent: figures(0.2, 0.1), candidate: figures(0.19, 0.09) }, { incumbent: figures(0.2, 0.1), candidate: figures(0.2, 0.1) })
    );
    expect(verdict.gates.map((g) => `${g.gate}:${g.status}`)).toEqual(["R1:PASS", "R2:PASS"]);
    expect(verdict.overall).toBe("PASS");
  });

  it("R1 is strict on both metrics: a tie on either FAILS it", () => {
    const tiedBonus = judgeRpPriorBar(
      pooledOf({ incumbent: figures(0.2, 0.1), candidate: figures(0.2, 0.09) }, { incumbent: figures(0.2, 0.1), candidate: figures(0.19, 0.09) })
    );
    expect(tiedBonus.gates.find((g) => g.gate === "R1")!.status).toBe("FAIL");
    expect(tiedBonus.overall).toBe("FAIL");
    const tiedRps = judgeRpPriorBar(
      pooledOf({ incumbent: figures(0.2, 0.1), candidate: figures(0.19, 0.1) }, { incumbent: figures(0.2, 0.1), candidate: figures(0.19, 0.09) })
    );
    expect(tiedRps.gates.find((g) => g.gate === "R1")!.status).toBe("FAIL");
    const worse = judgeRpPriorBar(
      pooledOf({ incumbent: figures(0.2, 0.1), candidate: figures(0.21, 0.09) }, { incumbent: figures(0.2, 0.1), candidate: figures(0.19, 0.09) })
    );
    expect(worse.gates.find((g) => g.gate === "R1")!.status).toBe("FAIL");
  });

  it("R2 is not-worse: ties pass, either metric worse fails", () => {
    const strictPlayed = { incumbent: figures(0.2, 0.1), candidate: figures(0.19, 0.09) };
    expect(judgeRpPriorBar(pooledOf(strictPlayed, { incumbent: figures(0.2, 0.1), candidate: figures(0.2, 0.1) })).gates.find((g) => g.gate === "R2")!.status).toBe("PASS");
    expect(
      judgeRpPriorBar(pooledOf(strictPlayed, { incumbent: figures(0.2, 0.1), candidate: figures(0.2001, 0.09) })).gates.find((g) => g.gate === "R2")!.status
    ).toBe("FAIL");
    expect(
      judgeRpPriorBar(pooledOf(strictPlayed, { incumbent: figures(0.2, 0.1), candidate: figures(0.19, 0.1001) })).gates.find((g) => g.gate === "R2")!.status
    ).toBe("FAIL");
  });

  it("VOID on an observation-count mismatch or an empty set; FAIL outranks VOID overall", () => {
    const mismatched = judgeRpPriorBar(
      pooledOf({ incumbent: figures(0.2, 0.1, 100), candidate: figures(0.1, 0.05, 99) }, { incumbent: figures(0.2, 0.1), candidate: figures(0.2, 0.1) })
    );
    expect(mismatched.gates.find((g) => g.gate === "R1")!.status).toBe("VOID");
    expect(mismatched.overall).toBe("VOID");
    const empty = judgeRpPriorBar(pooledOf({ incumbent: figures(0.2, 0.1), candidate: figures(0.19, 0.09) }, { incumbent: EMPTY_RP_FIGURES, candidate: EMPTY_RP_FIGURES }));
    expect(empty.gates.find((g) => g.gate === "R2")!.status).toBe("VOID");
    const failAndVoid = judgeRpPriorBar(
      pooledOf({ incumbent: figures(0.2, 0.1, 100), candidate: figures(0.1, 0.05, 99) }, { incumbent: figures(0.2, 0.1), candidate: figures(0.3, 0.1) })
    );
    expect(failAndVoid.overall).toBe("FAIL");
  });
});

describe("measureSigmaCarry bar R and retry modes on the committed 2022 slice", () => {
  const streamFor = (season: number): MatchResult[] => {
    if (season !== fixture.sliceSeason) throw new Error(`unexpected season ${season}`);
    return fixture.matches;
  };
  const oneSeason = { seasons: [2022], counted: new Set([2022]), algorithm: spr, streamFor } as const;

  /**
   * Every slice event after the first has a debut team, so the all-or-nothing Sigma refusal prices none
   * of them pre-event. A re-keyed repeat of the first event, appended last, has a fully seen roster, so
   * bar R's matched set (and so its cold split) is non-empty.
   */
  const withRepeatEvent = (season: number): MatchResult[] => {
    const matches = streamFor(season);
    const firstEvent = matches[0]!.eventKey;
    const repeat = matches
      .filter((m) => m.eventKey === firstEvent)
      .map((m) => ({ ...m, eventKey: `${firstEvent}rpt`, matchKey: m.matchKey.replace(firstEvent, `${firstEvent}rpt`) }));
    return [...matches, ...repeat];
  };

  it("bar R: Sigma is untouched, both arms price the same set, and the prior moves the played rows", () => {
    const seasons = measureSigmaCarry({ ...oneSeason, streamFor: withRepeatEvent, rpPriorArms: true });
    const s = seasons[0]!;
    expect(s.band.candidate).toEqual(s.band.incumbent);
    expect(s.played.candidate.bonusCount).toBe(s.played.incumbent.bonusCount);
    expect(s.played.candidate.totalRpCount).toBe(s.played.incumbent.totalRpCount);
    expect(s.played.incumbent.bonusCount).toBeGreaterThan(0);
    // Non-vacuity: the prior moved played-row pricing.
    expect(s.played.candidate.bonusBrier).not.toBe(s.played.incumbent.bonusBrier);
    expect(s.coverage.candidate).toBe(s.coverage.incumbent);
    expect(s.coverage.newlyCovered).toBe(0);
    expect(s.coverage.dropped).toBe(0);
    expect(s.matched.candidate.bonusCount).toBe(s.matched.incumbent.bonusCount);
    expect(s.matched.candidate.totalRpCount).toBe(s.matched.incumbent.totalRpCount);
    expect(s.matched.incumbent.bonusCount).toBeGreaterThan(0);

    const keys = Object.keys(s.coldSplit);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(["0", "1", "2", "3"]).toContain(key);
    const sum = (arm: "incumbent" | "candidate"): number => keys.reduce((n, key) => n + s.coldSplit[key]![arm].bonusCount, 0);
    expect(sum("incumbent")).toBe(s.matched.incumbent.bonusCount);
    expect(sum("candidate")).toBe(s.matched.candidate.bonusCount);

    const pooledSplit = poolColdSplit(seasons);
    expect(Object.keys(pooledSplit).sort()).toEqual([...keys].sort());
    expect(judgeRpPriorBar(poolSeasons(seasons)).gates.map((g) => g.gate)).toEqual(["R1", "R2"]);
  });

  it("retry: both arms carry the prior, so with nothing to carry the played figures are identical, and they differ from the default run's", () => {
    const [retry] = measureSigmaCarry({ ...oneSeason, rpColdPrior: true });
    const [incumbentBar] = measureSigmaCarry(oneSeason);
    expect(retry!.played.candidate).toEqual(retry!.played.incumbent);
    expect(retry!.coverage.dropped).toBe(0);
    expect(retry!.played.incumbent.bonusBrier).not.toBe(incumbentBar!.played.incumbent.bonusBrier);
  });

  it("refuses bar R and the retry together", () => {
    expect(() => measureSigmaCarry({ ...oneSeason, rpPriorArms: true, rpColdPrior: true })).toThrow(/rpPriorArms.*rpColdPrior|rpColdPrior.*rpPriorArms/);
  });
});
