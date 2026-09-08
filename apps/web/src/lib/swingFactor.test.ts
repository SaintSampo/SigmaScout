import { describe, expect, it } from "vitest";
import { swingFactorForTeam, swingFactorFromDeviations, SWING_FACTOR_HALF_LIFE_MATCHES, SWING_FACTOR_SCALE } from "./swingFactor.js";
import { PAGE_ARTIFACT_SCHEMA_VERSION, type TeamSeasonArtifact } from "../../../../packages/harness/pageArtifacts.js";

type TeamSeasonMatch = TeamSeasonArtifact["events"][number]["matches"][number];

function baseMatch(overrides: Partial<TeamSeasonMatch> = {}): TeamSeasonMatch {
  return {
    matchKey: "2026miket_qm1",
    season: 2026,
    eventKey: "2026miket",
    compLevel: "qm",
    algorithmId: "opr",
    algorithmVersion: "1.0.0",
    predictedWinner: "red",
    pRedWin: 0.5,
    predictedRedScore: 100,
    predictedBlueScore: 100,
    redTeams: ["frc1114", "frc254", "frc2056"],
    blueTeams: ["frc118", "frc971", "frc148"],
    ...overrides,
  };
}

function baseArtifact(overrides: Partial<TeamSeasonArtifact> = {}): TeamSeasonArtifact {
  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "opr",
    algorithmVersion: "1.0.0",
    teamKey: "frc1114",
    teamNumber: 1114,
    nickname: "Simbotics",
    season: 2026,
    seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {} },
    events: [],
    metricHistory: [],
    ...overrides,
  };
}

describe("swingFactorFromDeviations", () => {
  it("returns undefined for an empty list — a domain check, not a floor", () => {
    expect(swingFactorFromDeviations([])).toBeUndefined();
  });

  // 2026-09-08, developer decision: the estimator CENTRES about the team's own
  // weighted mean deviation, so it reports the robot's swing rather than the
  // model's systematic bias. The three cases below previously pinned the
  // ABOUT-ZERO behaviour and are rewritten, not deleted, so the change of
  // meaning is visible in the diff rather than silently dropped.
  it("returns undefined for exactly one observation — one point cannot separate bias from swing", () => {
    expect(swingFactorFromDeviations([4])).toBeUndefined();
    expect(swingFactorFromDeviations([-4])).toBeUndefined();
  });

  it("reports a LARGE swing for opposite-signed deviations and NO swing for identical ones — the whole point of centring", () => {
    const oppositeSign = swingFactorFromDeviations([5, -5]) as number;
    const sameSign = swingFactorFromDeviations([5, 5]) as number;
    expect(sameSign).toBeCloseTo(0, 10);
    expect(oppositeSign).toBeGreaterThan(0);
  });

  it("returns exactly 0 for the same deviation repeated k times — a robot the model misses by a CONSTANT is perfectly consistent", () => {
    for (const k of [2, 5, 20]) {
      const deviations = Array.from({ length: k }, () => 3);
      expect(swingFactorFromDeviations(deviations)).toBeCloseTo(0, 10);
    }
  });

  it("is invariant to a constant shift of every deviation — a pure model bias cannot move it", () => {
    const base = [4, -2, 7, 1, -3];
    const shifted = base.map((d) => d + 250);
    expect(swingFactorFromDeviations(shifted)).toBeCloseTo(swingFactorFromDeviations(base) as number, 8);
  });

  it("matches the standard weighted-unbiased sample variance on an independently computed case", () => {
    // Two observations, weights w (older) and 1 (newer). The weighted
    // unbiased variance about the weighted mean, worked out independently of
    // the module's one-pass form.
    const decay = 0.5 ** (1 / SWING_FACTOR_HALF_LIFE_MATCHES);
    const [older, newer] = [2, 10];
    const sumW = decay + 1;
    const mean = (decay * older + newer) / sumW;
    const numerator = decay * (older - mean) ** 2 + (newer - mean) ** 2;
    const denominator = sumW - (decay * decay + 1) / sumW;
    const expected = SWING_FACTOR_SCALE * Math.sqrt(numerator / denominator);
    expect(swingFactorFromDeviations([older, newer])).toBeCloseTo(expected, 10);
  });

  it("weights an observation exactly halfLife matches old at half the newest observation's weight", () => {
    // A single observation followed by (halfLife) folds of zero: the
    // original observation's surviving weight after halfLife more folds is
    // exactly 0.5 of a fold made right now — recomputed here via the exact
    // same recurrence the module uses, as an independent check on the
    // module's output rather than a restatement of its internals.
    const halfLife = SWING_FACTOR_HALF_LIFE_MATCHES;
    const decay = 0.5 ** (1 / halfLife);
    const series = [10, ...Array(halfLife).fill(0)];
    let ws = 0;
    let wsum = 0;
    let w = 0;
    let w2 = 0;
    for (const d of series) {
      ws = decay * ws + d * d;
      wsum = decay * wsum + d;
      w = decay * w + 1;
      w2 = decay * decay * w2 + 1;
    }
    const expected = SWING_FACTOR_SCALE * Math.sqrt((ws - (wsum * wsum) / w) / (w - w2 / w));
    expect(swingFactorFromDeviations(series)).toBeCloseTo(expected, 10);
  });

  it("a recent large deviation moves the result more than an equally large deviation six matches older", () => {
    const recentLarge = swingFactorFromDeviations([1, 1, 1, 1, 1, 1, 10]);
    const oldLarge = swingFactorFromDeviations([10, 1, 1, 1, 1, 1, 1]);
    expect(recentLarge as number).toBeGreaterThan(oldLarge as number);
  });

  it("ordering is load-bearing: reversing the observation list changes the result whenever the deviations differ", () => {
    const forward = swingFactorFromDeviations([1, 1, 1, 9]);
    const reversed = swingFactorFromDeviations([9, 1, 1, 1]);
    expect(forward).not.toBeCloseTo(reversed as number, 6);
  });

  // Found while centring (2026-09-08), and worth pinning so a future reader
  // meets it as a property rather than as a suspected bug: at EXACTLY two
  // observations the centred spread is order-INVARIANT. Both points sit
  // symmetrically about their own weighted mean, and the algebra collapses to
  // `w * (a - b)^2 / (w + 1)`, which depends only on |a - b|. Recency
  // weighting still moves the MEAN, but the spread about it cannot tell the
  // two orderings apart. Order becomes load-bearing again from k = 3.
  it("is order-invariant at exactly two observations — a property of centring, not a bug", () => {
    expect(swingFactorFromDeviations([2, 8])).toBeCloseTo(swingFactorFromDeviations([8, 2]) as number, 12);
  });

  it("throws on a non-finite deviation rather than skipping or coercing it", () => {
    expect(() => swingFactorFromDeviations([1, Number.NaN, 2])).toThrow(/non-finite/);
    expect(() => swingFactorFromDeviations([Number.POSITIVE_INFINITY])).toThrow(/non-finite/);
  });
});

describe("swingFactorForTeam", () => {
  it("returns undefined for a team with no played matches", () => {
    const artifact = baseArtifact({ events: [] });
    expect(swingFactorForTeam(artifact, "frc1114")).toBeUndefined();
  });

  it("returns undefined when every match is unplayed (no actual scores)", () => {
    const artifact = baseArtifact({
      events: [{ eventKey: "2026miket", eventName: "Kettering", startDate: "2026-03-01", matches: [baseMatch()] }],
    });
    expect(swingFactorForTeam(artifact, "frc1114")).toBeUndefined();
  });

  it("skips a row naming the team on neither roster", () => {
    const match = baseMatch({
      redTeams: ["frc254", "frc2056", "frc118"],
      blueTeams: ["frc971", "frc148", "frc33"],
      actualRedScore: 120,
      actualBlueScore: 100,
    });
    const artifact = baseArtifact({
      events: [{ eventKey: "2026miket", eventName: "Kettering", startDate: "2026-03-01", matches: [match] }],
    });
    expect(swingFactorForTeam(artifact, "frc1114")).toBeUndefined();
  });

  it("uses the team's OWN alliance residual: a red-alliance team's deviation is (actualRedScore - predictedRedScore) / redTeams.length", () => {
    const matches = [130, 70].map((actualRedScore, index) =>
      baseMatch({
        matchKey: `2026miket_qm${index + 1}`,
        redTeams: ["frc1114", "frc254", "frc2056"],
        blueTeams: ["frc118", "frc971", "frc148"],
        predictedRedScore: 100,
        predictedBlueScore: 90,
        actualRedScore,
        actualBlueScore: 90,
      })
    );
    const artifact = baseArtifact({
      events: [{ eventKey: "2026miket", eventName: "Kettering", startDate: "2026-03-01", matches }],
    });
    // Deviations = (130 - 100) / 3 = 10, then (70 - 100) / 3 = -10.
    expect(swingFactorForTeam(artifact, "frc1114")).toBeCloseTo(swingFactorFromDeviations([10, -10]) as number, 10);
  });

  it("uses the blue alliance's own residual for a blue-roster team, never the red one", () => {
    const matches = [96, 84].map((actualBlueScore, index) =>
      baseMatch({
        matchKey: `2026miket_qm${index + 1}`,
        redTeams: ["frc254", "frc2056", "frc33"],
        blueTeams: ["frc1114", "frc971", "frc148"],
        predictedRedScore: 100,
        predictedBlueScore: 90,
        actualRedScore: 400, // large red deviation, irrelevant to frc1114 (blue)
        actualBlueScore,
      })
    );
    const artifact = baseArtifact({
      events: [{ eventKey: "2026miket", eventName: "Kettering", startDate: "2026-03-01", matches }],
    });
    // Deviations = (96 - 90) / 3 = 2, then (84 - 90) / 3 = -2. Had the red
    // residual leaked in, the result would be enormous rather than this.
    expect(swingFactorForTeam(artifact, "frc1114")).toBeCloseTo(swingFactorFromDeviations([2, -2]) as number, 10);
  });

  it("skips a row where the team's own roster is empty", () => {
    const match = baseMatch({
      redTeams: [],
      blueTeams: ["frc118", "frc971", "frc148"],
      actualRedScore: 100,
      actualBlueScore: 90,
    });
    // frc1114 is not on either roster here anyway, but this specifically
    // exercises the empty-roster guard by naming an artifact whose events
    // list has only this row.
    const artifact = baseArtifact({
      events: [{ eventKey: "2026miket", eventName: "Kettering", startDate: "2026-03-01", matches: [match] }],
    });
    expect(swingFactorForTeam(artifact, "frc1114")).toBeUndefined();
  });

  it("skips unplayed rows without consuming a decay step — an unplayed row sandwiched between two identical played rows changes nothing", () => {
    const played = baseMatch({
      redTeams: ["frc1114", "frc254", "frc2056"],
      blueTeams: ["frc118", "frc971", "frc148"],
      predictedRedScore: 100,
      actualRedScore: 106,
      actualBlueScore: 100,
    });
    const unplayed = baseMatch({ matchKey: "2026miket_qm2" }); // no actual* fields
    const withGap = baseArtifact({
      events: [
        {
          eventKey: "2026miket",
          eventName: "Kettering",
          startDate: "2026-03-01",
          matches: [played, unplayed, played],
        },
      ],
    });
    const withoutGap = baseArtifact({
      events: [
        {
          eventKey: "2026miket",
          eventName: "Kettering",
          startDate: "2026-03-01",
          matches: [played, played],
        },
      ],
    });
    expect(swingFactorForTeam(withGap, "frc1114")).toBeCloseTo(swingFactorForTeam(withoutGap, "frc1114") as number, 10);
  });

  it("includes elimination matches alongside qualification matches", () => {
    const qm = baseMatch({
      compLevel: "qm",
      redTeams: ["frc1114", "frc254", "frc2056"],
      predictedRedScore: 100,
      actualRedScore: 104,
      actualBlueScore: 90,
    });
    const sf = baseMatch({
      matchKey: "2026miket_sf1m1",
      compLevel: "sf",
      redTeams: ["frc1114", "frc254", "frc2056"],
      predictedRedScore: 100,
      actualRedScore: 112,
      actualBlueScore: 90,
    });
    const artifact = baseArtifact({
      events: [{ eventKey: "2026miket", eventName: "Kettering", startDate: "2026-03-01", matches: [qm, sf] }],
    });
    const deviations = [(104 - 100) / 3, (112 - 100) / 3];
    expect(swingFactorForTeam(artifact, "frc1114")).toBeCloseTo(swingFactorFromDeviations(deviations) as number, 10);
  });

  it("orders matches by ascending event startDate, then array order within an event, before folding", () => {
    const earlyMatch = baseMatch({
      matchKey: "2026micmp_qm1",
      redTeams: ["frc1114", "frc254", "frc2056"],
      predictedRedScore: 100,
      actualRedScore: 110,
      actualBlueScore: 90,
    });
    const lateMatch = baseMatch({
      matchKey: "2026miket_qm1",
      redTeams: ["frc1114", "frc254", "frc2056"],
      predictedRedScore: 100,
      actualRedScore: 106,
      actualBlueScore: 90,
    });
    // Events supplied out of chronological order in the artifact itself —
    // the function must sort them, not trust artifact order.
    const artifact = baseArtifact({
      events: [
        { eventKey: "2026miket", eventName: "Kettering", startDate: "2026-04-01", matches: [lateMatch] },
        { eventKey: "2026micmp", eventName: "State Champs", startDate: "2026-03-01", matches: [earlyMatch] },
      ],
    });
    // Chronological order is [earlyMatch (dev=10/3), lateMatch (dev=6/3)] —
    // oldest first, per swingFactorFromDeviations' own ordering contract.
    const expected = swingFactorFromDeviations([10 / 3, 6 / 3]);
    expect(swingFactorForTeam(artifact, "frc1114")).toBeCloseTo(expected as number, 10);
  });

  it("reconciliation: a VPR fixture whose per-match rows and published total spread were built consistently yields a browser value equal to the published one", () => {
    const deviations = [4, -2, 7, 1];
    const matches: TeamSeasonMatch[] = deviations.map((deviation, index) => {
      const predicted = 100;
      const actual = predicted + deviation * 3; // roster length 3
      return baseMatch({
        matchKey: `2026miket_qm${index + 1}`,
        algorithmId: "vpr",
        algorithmVersion: "9.0.0",
        redTeams: ["frc1114", "frc254", "frc2056"],
        predictedRedScore: predicted,
        actualRedScore: actual,
        actualBlueScore: 90,
      });
    });
    const publishedSpread = swingFactorFromDeviations(deviations) as number;
    const artifact = baseArtifact({
      algorithmId: "vpr",
      algorithmVersion: "9.0.0",
      seasonStats: { record: { wins: 4, losses: 0, ties: 0 }, metrics: { total: { value: 110, spread: publishedSpread } } },
      events: [{ eventKey: "2026miket", eventName: "Kettering", startDate: "2026-03-01", matches }],
    });

    expect(swingFactorForTeam(artifact, "frc1114")).toBeCloseTo(artifact.seasonStats.metrics.total?.spread as number, 10);
  });
  // Quick task 260908-5wd follow-up, found by running the real site against
  // live 2026 data: a real team's header almost always resolves an
  // as-of-last-official-match snapshot, so the merge originally SKIPPED and
  // the Swing Factor never appeared for OPR/EPA in production even though
  // every unit test passed. The window is now bounded instead of skipped.
  describe("untilMatchKey bounds the observation window to the header's as-of instant", () => {
    function threeMatchArtifact() {
      const devs = [6, -3, 12];
      const matches: TeamSeasonMatch[] = devs.map((deviation, index) =>
        baseMatch({
          matchKey: `2026miket_qm${index + 1}`,
          redTeams: ["frc1114", "frc254", "frc2056"],
          predictedRedScore: 100,
          actualRedScore: 100 + deviation * 3,
          actualBlueScore: 90,
        })
      );
      return { devs, artifact: baseArtifact({ events: [{ eventKey: "2026miket", eventName: "Kettering", startDate: "2026-03-01", matches }] }) };
    }

    it("folds only matches up to and including the bound", () => {
      const { devs, artifact } = threeMatchArtifact();
      expect(swingFactorForTeam(artifact, "frc1114", { untilMatchKey: "2026miket_qm2" })).toBeCloseTo(
        swingFactorFromDeviations(devs.slice(0, 2)) as number,
        10
      );
    });

    it("bounding on the LAST match equals the unbounded whole-season value", () => {
      const { artifact } = threeMatchArtifact();
      expect(swingFactorForTeam(artifact, "frc1114", { untilMatchKey: "2026miket_qm3" })).toBeCloseTo(
        swingFactorForTeam(artifact, "frc1114") as number,
        10
      );
    });

    it("an absent bound is the whole season, exactly as before this option existed", () => {
      const { devs, artifact } = threeMatchArtifact();
      expect(swingFactorForTeam(artifact, "frc1114", {})).toBeCloseTo(swingFactorFromDeviations(devs) as number, 10);
    });

    it("publishes NOTHING for a bound that never appears, rather than silently measuring a different span", () => {
      const { artifact } = threeMatchArtifact();
      expect(swingFactorForTeam(artifact, "frc1114", { untilMatchKey: "2026miket_qm99" })).toBeUndefined();
    });

    it("a bound landing on the team's FIRST match publishes nothing — one observation cannot separate bias from swing", () => {
      const { artifact } = threeMatchArtifact();
      expect(swingFactorForTeam(artifact, "frc1114", { untilMatchKey: "2026miket_qm1" })).toBeUndefined();
    });
  });
});
