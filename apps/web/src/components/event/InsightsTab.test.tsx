/**
 * 07-VALIDATION.md's Wave 0 EVNT-02 test file, authored before the component
 * (07-11-PLAN.md Task 1, TDD). Every fixture is a hand-written
 * `EventArtifact`-shaped object, never a network response and never a
 * helper that reads a real artifact off disk — mirrors
 * `BreakdownTab.test.tsx`'s established fixture discipline exactly.
 *
 * This first describe-block set covers Task 1's pure data layer
 * (`buildInsightsRows`, `formatEventRecord`, `insightsFallbackNotice`) only.
 * Task 2 extends this same file with the rendered-table cases.
 */
import { describe, expect, it } from "vitest";
import { TOTAL_KEY } from "@/lib/metricKeys";
import { EventArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { buildInsightsRows, formatEventRecord, insightsFallbackNotice } from "./InsightsTab";

type ArtifactTeam = EventArtifact["teams"][number];

function team(overrides: Partial<ArtifactTeam> = {}): ArtifactTeam {
  return {
    teamKey: "frc254",
    teamNumber: 254,
    nickname: "The Cheesy Poofs",
    metrics: { [TOTAL_KEY]: { value: 48.33, spread: 2.32 } },
    ...overrides,
  };
}

/** Builds a valid artifact through `EventArtifactSchema.parse` — the real schema, proving the fixture matches the published shape. */
function makeArtifact(teams: ArtifactTeam[], overrides: Partial<EventArtifact> = {}): EventArtifact {
  return EventArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-27T00:00:00.000Z",
    algorithmId: "sigma1",
    algorithmVersion: "2.0.0+tuned-2026-08",
    eventKey: "2024casf",
    season: 2024,
    matches: [],
    upcoming: [],
    teams,
    ...overrides,
  });
}

describe("buildInsightsRows — official vs fallback ordering (EVNT-02, D-07/D-08)", () => {
  it("every team carrying a rank returns orderSource 'official' and rows in ascending rank order, regardless of input order", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc3", teamNumber: 3, rank: 3, metrics: { [TOTAL_KEY]: { value: 1 } } }),
      team({ teamKey: "frc1", teamNumber: 1, rank: 1, metrics: { [TOTAL_KEY]: { value: 3 } } }),
      team({ teamKey: "frc2", teamNumber: 2, rank: 2, metrics: { [TOTAL_KEY]: { value: 2 } } }),
    ]);
    const model = buildInsightsRows(artifact, "sigma1");
    expect(model.orderSource).toBe("official");
    expect(model.rows.map((row) => row.teamNumber)).toEqual([1, 2, 3]);
  });

  it("no team carrying a rank returns orderSource 'fallback' and rows in descending TOTAL_KEY order", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10 } } }),
      team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 30 } } }),
      team({ teamKey: "frc3", teamNumber: 3, metrics: { [TOTAL_KEY]: { value: 20 } } }),
    ]);
    const model = buildInsightsRows(artifact, "sigma1");
    expect(model.orderSource).toBe("fallback");
    expect(model.rows.map((row) => row.teamNumber)).toEqual([2, 3, 1]);
  });

  it("some teams ranked, some not: orderSource is 'official', ranked teams order ascending, every unranked team sorts after all ranked ones", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 1 } } }),
      team({ teamKey: "frc2", teamNumber: 2, rank: 2, metrics: { [TOTAL_KEY]: { value: 2 } } }),
      team({ teamKey: "frc3", teamNumber: 3, rank: 1, metrics: { [TOTAL_KEY]: { value: 3 } } }),
    ]);
    const model = buildInsightsRows(artifact, "sigma1");
    expect(model.orderSource).toBe("official");
    expect(model.rows.map((row) => row.teamNumber)).toEqual([3, 2, 1]);
    const firstUnrankedIndex = model.rows.findIndex((row) => row.displayRank === undefined);
    expect(firstUnrankedIndex).toBe(2);
  });

  it("two teams sharing the exact same rank return as two separate rows in ascending team-number order, row count unchanged, neither rank renumbered", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc9", teamNumber: 9, rank: 5, metrics: { [TOTAL_KEY]: { value: 1 } } }),
      team({ teamKey: "frc3", teamNumber: 3, rank: 5, metrics: { [TOTAL_KEY]: { value: 2 } } }),
    ]);
    const model = buildInsightsRows(artifact, "sigma1");
    expect(model.rows).toHaveLength(2);
    expect(model.rows.map((row) => row.teamNumber)).toEqual([3, 9]);
    expect(model.rows.map((row) => row.displayRank)).toEqual([5, 5]);
  });

  it("two unranked teams with exactly equal TOTAL_KEY values return in ascending team-number order", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc9", teamNumber: 9, metrics: { [TOTAL_KEY]: { value: 15 } } }),
      team({ teamKey: "frc3", teamNumber: 3, metrics: { [TOTAL_KEY]: { value: 15 } } }),
    ]);
    const model = buildInsightsRows(artifact, "sigma1");
    expect(model.rows.map((row) => row.teamNumber)).toEqual([3, 9]);
  });

  it("in fallback mode a team whose metrics carries no TOTAL_KEY entry sorts last", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, metrics: {} }),
      team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: -50 } } }),
    ]);
    const model = buildInsightsRows(artifact, "sigma1");
    expect(model.orderSource).toBe("fallback");
    expect(model.rows.map((row) => row.teamNumber)).toEqual([2, 1]);
  });

  it("feeding the same roster twice, once shuffled, returns the identical ordered sequence of teamKey values — official mode", () => {
    const teamsA = [
      team({ teamKey: "frc9", teamNumber: 9, rank: 3, metrics: { [TOTAL_KEY]: { value: 1 } } }),
      team({ teamKey: "frc3", teamNumber: 3, rank: 1, metrics: { [TOTAL_KEY]: { value: 2 } } }),
      team({ teamKey: "frc5", teamNumber: 5, rank: 2, metrics: { [TOTAL_KEY]: { value: 3 } } }),
    ];
    const teamsB = [teamsA[2] as ArtifactTeam, teamsA[0] as ArtifactTeam, teamsA[1] as ArtifactTeam];
    const modelA = buildInsightsRows(makeArtifact(teamsA), "sigma1");
    const modelB = buildInsightsRows(makeArtifact(teamsB), "sigma1");
    expect(modelA.rows.map((row) => row.teamKey)).toEqual(modelB.rows.map((row) => row.teamKey));
    expect(modelA.rows.map((row) => row.teamKey)).toEqual(["frc3", "frc5", "frc9"]);
  });

  it("feeding the same roster twice, once shuffled, returns the identical ordered sequence of teamKey values — fallback mode", () => {
    const teamsA = [
      team({ teamKey: "frc9", teamNumber: 9, metrics: { [TOTAL_KEY]: { value: 15 } } }),
      team({ teamKey: "frc3", teamNumber: 3, metrics: { [TOTAL_KEY]: { value: 40 } } }),
      team({ teamKey: "frc5", teamNumber: 5, metrics: { [TOTAL_KEY]: { value: 20 } } }),
    ];
    const teamsB = [teamsA[2] as ArtifactTeam, teamsA[0] as ArtifactTeam, teamsA[1] as ArtifactTeam];
    const modelA = buildInsightsRows(makeArtifact(teamsA), "sigma1");
    const modelB = buildInsightsRows(makeArtifact(teamsB), "sigma1");
    expect(modelA.rows.map((row) => row.teamKey)).toEqual(modelB.rows.map((row) => row.teamKey));
    expect(modelA.rows.map((row) => row.teamKey)).toEqual(["frc3", "frc5", "frc9"]);
  });

  it("displayRank equals the team's own published rank in official mode, undefined for an unranked team inside a ranked event", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, rank: 7, metrics: { [TOTAL_KEY]: { value: 1 } } }),
      team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 2 } } }),
    ]);
    const model = buildInsightsRows(artifact, "sigma1");
    const ranked = model.rows.find((row) => row.teamNumber === 1);
    const unranked = model.rows.find((row) => row.teamNumber === 2);
    expect(ranked?.displayRank).toBe(7);
    expect(unranked?.displayRank).toBeUndefined();
  });

  it("displayRank in fallback mode is the 1-based position in the returned order, starting at 1 with no gaps", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10 } } }),
      team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 30 } } }),
      team({ teamKey: "frc3", teamNumber: 3, metrics: { [TOTAL_KEY]: { value: 20 } } }),
    ]);
    const model = buildInsightsRows(artifact, "sigma1");
    expect(model.rows.map((row) => row.displayRank)).toEqual([1, 2, 3]);
  });

  it("an artifact with teams: [] returns zero rows and orderSource 'fallback' — no rank exists, so the discriminant is honest even with nothing to order", () => {
    const model = buildInsightsRows(makeArtifact([]), "sigma1");
    expect(model.rows).toHaveLength(0);
    expect(model.orderSource).toBe("fallback");
  });

  it("a one-team artifact returns one row through the same code path as a 43-team one", () => {
    const oneTeamModel = buildInsightsRows(makeArtifact([team({ rank: 1 })]), "sigma1");
    expect(oneTeamModel.rows).toHaveLength(1);

    const manyTeams = Array.from({ length: 43 }, (_, index) =>
      team({ teamKey: `frc${index + 1}`, teamNumber: index + 1, rank: index + 1, nickname: `Team ${index + 1}` }),
    );
    const manyTeamsModel = buildInsightsRows(makeArtifact(manyTeams), "sigma1");
    expect(manyTeamsModel.rows).toHaveLength(43);
  });
});

describe("buildInsightsRows — record/rp pass-through (EVNT-02 empty)", () => {
  it("record passes through verbatim: a published record carries exactly that object; a team with no record carries undefined", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, record: { wins: 4, losses: 2, ties: 1 } }),
      team({ teamKey: "frc2", teamNumber: 2 }),
    ]);
    const model = buildInsightsRows(artifact, "sigma1");
    const withRecord = model.rows.find((row) => row.teamNumber === 1);
    const withoutRecord = model.rows.find((row) => row.teamNumber === 2);
    expect(withRecord?.record).toEqual({ wins: 4, losses: 2, ties: 1 });
    expect(withoutRecord?.record).toBeUndefined();
  });

  it("rp passes through verbatim including a real 0; a team with no rp carries undefined", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, rp: 0 }),
      team({ teamKey: "frc2", teamNumber: 2 }),
    ]);
    const model = buildInsightsRows(artifact, "sigma1");
    const withRp = model.rows.find((row) => row.teamNumber === 1);
    const withoutRp = model.rows.find((row) => row.teamNumber === 2);
    expect(withRp?.rp).toBe(0);
    expect(withRp?.rp).not.toBeUndefined();
    expect(withoutRp?.rp).toBeUndefined();
  });

  it("teamNumber falls back to the team key's digits and nickname to a Team {number} string when either is absent", () => {
    const artifact = makeArtifact([{ teamKey: "frc42", metrics: { [TOTAL_KEY]: { value: 10 } } }]);
    const row = buildInsightsRows(artifact, "sigma1").rows[0];
    expect(row?.teamNumber).toBe(42);
    expect(row?.nickname).toBe("Team 42");
  });
});

describe("formatEventRecord (EVNT-02 empty)", () => {
  it("returns wins-losses-ties hyphenated for a published record", () => {
    expect(formatEventRecord({ wins: 4, losses: 2, ties: 1 })).toBe("4-2-1");
  });

  it("returns a single em-dash for an absent record", () => {
    expect(formatEventRecord(undefined)).toBe("—");
    expect(formatEventRecord(undefined)).toHaveLength(1);
  });

  it("returns the three-zero hyphenated string for a genuine all-zero record — never conflated with absence", () => {
    expect(formatEventRecord({ wins: 0, losses: 0, ties: 0 })).toBe("0-0-0");
  });
});

describe("insightsFallbackNotice (D-08 Copywriting Contract)", () => {
  it("begins with the hand-written literal leading clause and contains the given label", () => {
    const sentence = insightsFallbackNotice("Sigma1");
    expect(sentence.startsWith("This event has no official TBA ranking. Teams below are ordered by ")).toBe(true);
    expect(sentence).toContain("Sigma1");
  });
});
