import { describe, expect, it } from "vitest";
import { allianceKey, combineMatch, type AlliancePiece } from "./browserPresimPricing.js";
import { RpMomentsAccumulator, type RpTeamBeliefs } from "../packages/core/rankingPoints/empiricalMoments.js";
import { allianceBonusRpPmf, analyticRpPmf } from "../packages/core/rankingPoints/analyticPmf.js";
import { rpRuleModuleForSeason } from "../packages/core/rankingPoints/rules.js";

const RULES_2026 = rpRuleModuleForSeason(2026);
const HUB = "hubTotalCount";
const TOWER = "totalTowerPoints";
const RED = ["frc1", "frc2", "frc3"];
const BLUE = ["frc4", "frc5", "frc6"];

function beliefs(hubMean: number, towerMean: number): RpTeamBeliefs {
  return {
    [HUB]: { weight: 5.2, weightSquares: 3.1, mean: hubMean, m2: 40 },
    [TOWER]: { weight: 5.2, weightSquares: 3.1, mean: towerMean, m2: 18 },
  };
}

function accumulator(): RpMomentsAccumulator {
  const map = new Map<string, RpTeamBeliefs>([
    ["frc1", beliefs(22, 9)],
    ["frc2", beliefs(18, 12)],
    ["frc3", beliefs(25, 7)],
    ["frc4", beliefs(20, 10)],
    ["frc5", beliefs(15, 14)],
    ["frc6", beliefs(28, 6)],
  ]);
  return RpMomentsAccumulator.fromBeliefs(RULES_2026, map, {
    population: {
      season: 2026,
      variables: {
        [HUB]: { n: 40, mean: 60, m2: 4000 },
        [TOWER]: { n: 40, mean: 30, m2: 900 },
      },
    },
  });
}

describe("browserPresimPricing: the match-level combine", () => {
  it("equals analyticRpPmf on the same moments, pRedWin and 2026 rule module, with no tolerance", () => {
    const acc = accumulator();
    const red = acc.momentsFor(RED, 118.4, 210.5);
    const blue = acc.momentsFor(BLUE, 104.9, 190.25);
    const pRedWin = 0.6123;
    const expected = analyticRpPmf({ red, blue, ruleModule: RULES_2026, eventType: 0, compLevel: "qm", pRedWin });

    const piece = (moments: typeof red): AlliancePiece => {
      const bonus = allianceBonusRpPmf(moments, RULES_2026, 0);
      return {
        scoreMean: moments.scoreMean,
        scoreVariance: moments.scoreVariance,
        bonusPmf: bonus.pmf,
        bonusProbabilities: bonus.bonusProbabilities,
      };
    };
    const combined = combineMatch(piece(red), piece(blue), pRedWin, RULES_2026);

    expect(combined.redPmf).toEqual([...expected.redPmf]);
    expect(combined.bluePmf).toEqual([...expected.bluePmf]);
  });
});

describe("browserPresimPricing: the alliance cache key", () => {
  it("is the same for all six permutations of one triple", () => {
    const permutations = [
      ["frc1", "frc2", "frc3"],
      ["frc1", "frc3", "frc2"],
      ["frc2", "frc1", "frc3"],
      ["frc2", "frc3", "frc1"],
      ["frc3", "frc1", "frc2"],
      ["frc3", "frc2", "frc1"],
    ];
    const keys = new Set(permutations.map((p) => allianceKey(p)));
    expect(keys.size).toBe(1);
  });

  it("differs for different triples and does not mutate its argument", () => {
    const a = ["frc9", "frc2", "frc3"];
    expect(allianceKey(a)).not.toBe(allianceKey(["frc1", "frc2", "frc3"]));
    expect(allianceKey(["frc1", "frc2", "frc3"])).not.toBe(allianceKey(["frc1", "frc2", "frc33"]));
    expect(a).toEqual(["frc9", "frc2", "frc3"]);
  });
});
