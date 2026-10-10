/**
 * The live facts guard of the offline district publisher (quick task
 * 261009-ul3): the comparison's decision table and the guard's mode table.
 * No corpus and no network. Every fixture is a schema valid artifact built
 * with `DistrictArtifactSchema.parse`, so a broken fixture fails loudly and
 * can never pass as a "shape change".
 */
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "../packages/harness/pageArtifacts.js";
import {
  compareDistrictArtifacts,
  DistrictPublishRefusedError,
  formatDistrictRegression,
  guardLivePublish,
  type DistrictRegression,
  type PublishedReader,
} from "./districtPublishGuard.js";

type Team = DistrictArtifact["teams"][number];
type EventState = NonNullable<Team["eventPoints"][number]["state"]>;

const EVENT_A = "2026aaa";
const EVENT_B = "2026bbb";

/** Over: every flag true, the full schedule played. */
const DONE: EventState = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
/** Part played: no flag true. */
const PART: EventState = { qualMatchesPlayed: 40, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false };
/** Not started: nothing to lose. */
const NOTHING: EventState = { qualMatchesPlayed: 0, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false };

function lockVerdict() {
  return { status: "contending" as const, pointsToLock: null, threatCount: 0, cutLinePoints: null, allocationNote: null };
}

interface TeamSpec {
  readonly teamKey: string;
  /** `[eventKey, state or undefined, total]`: one `eventPoints` row each. */
  readonly points?: ReadonlyArray<readonly [string, EventState | undefined, number?]>;
  /** `[eventKey, state or undefined]`: one `remainingEvents` row each. */
  readonly remaining?: ReadonlyArray<readonly [string, EventState | undefined]>;
  /** `[eventKey, awardType]`: one `qualifyingAwards` entry each. */
  readonly awards?: ReadonlyArray<readonly [string, number]>;
}

function build(teams: readonly TeamSpec[], districtKey = "2026fnc"): DistrictArtifact {
  return DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-guard-test",
    computedAt: "2026-03-14T12:00:00.000Z",
    districtKey,
    year: 2026,
    abbreviation: "fnc",
    displayName: "FIRST North Carolina",
    dcmpSlots: 2,
    cmpSlots: 1,
    teams: teams.map((spec, index) => ({
      teamKey: spec.teamKey,
      rank: index + 1,
      pointTotal: 0,
      rookieBonus: 0,
      adjustments: 0,
      eventPoints: (spec.points ?? []).map(([eventKey, state, total]) => ({
        eventKey,
        eventName: eventKey,
        week: 1,
        tier: "district",
        qual: total ?? 30,
        alliance: 0,
        elim: 0,
        award: 0,
        total: total ?? 30,
        ...(state === undefined ? {} : { state: { ...state } }),
      })),
      remainingEvents: (spec.remaining ?? []).map(([eventKey, state]) => ({
        eventKey,
        eventName: eventKey,
        week: 2,
        tier: "district",
        maxPoints: 83,
        ...(state === undefined ? {} : { state: { ...state } }),
      })),
      maxRemainingDistrict: 0,
      maxRemainingChamp: 0,
      qualifyingAwards: (spec.awards ?? []).map(([eventKey, awardType]) => ({ eventKey, awardType, label: `Award ${awardType}`, awardOnly: false })),
      districtLock: lockVerdict(),
      champLock: lockVerdict(),
    })),
    insights: {
      teamCount: teams.length,
      eventCount: 2,
      dcmpCutLinePoints: null,
      cmpCutLinePoints: null,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
  });
}

/** Two teams, two events: both played event A, both still have event B ahead. */
function twoTeams(stateA: EventState | undefined, stateB: EventState | undefined, extra: { frc1Awards?: TeamSpec["awards"]; frc2Points?: boolean } = {}): DistrictArtifact {
  return build([
    { teamKey: "frc1", points: [[EVENT_A, stateA]], remaining: [[EVENT_B, stateB]], ...(extra.frc1Awards === undefined ? {} : { awards: extra.frc1Awards }) },
    { teamKey: "frc2", ...(extra.frc2Points === false ? {} : { points: [[EVENT_A, stateA]] as const }), remaining: [[EVENT_B, stateB]] },
  ]);
}

const kinds = (regressions: readonly DistrictRegression[]): string[] => regressions.map((regression) => regression.kind);

describe("compareDistrictArtifacts — the six facts (261009-ul3 D1)", () => {
  for (const flag of ["alliancesPicked", "playoffsDone", "awardsPosted"] as const) {
    it(`${flag} true live and false in this run is one regression, with no team key`, () => {
      const live = twoTeams({ ...PART, [flag]: true }, NOTHING);
      const next = twoTeams(PART, NOTHING);

      const regressions = compareDistrictArtifacts(live, next);

      expect(regressions).toEqual([{ districtKey: "2026fnc", eventKey: EVENT_A, kind: flag, live: "true", next: "false" }]);
      expect("teamKey" in regressions[0]!).toBe(false);
    });
  }

  it("qualMatchesPlayed lower in this run is one regression holding both counts", () => {
    const live = twoTeams({ ...PART, qualMatchesPlayed: 60 }, NOTHING);
    const next = twoTeams({ ...PART, qualMatchesPlayed: 40 }, NOTHING);

    expect(compareDistrictArtifacts(live, next)).toEqual([{ districtKey: "2026fnc", eventKey: EVENT_A, kind: "qualMatchesPlayed", live: "60", next: "40" }]);
  });

  it("an eventPoints row gone in this run, while the event is still present there, is one regression with the team key", () => {
    const live = twoTeams(PART, NOTHING);
    const next = twoTeams(PART, NOTHING, { frc2Points: false });

    const regressions = compareDistrictArtifacts(live, next);

    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatchObject({ eventKey: EVENT_A, teamKey: "frc2", kind: "eventPointsRow", next: "absent" });
    expect(regressions[0]!.live).toContain("30");
  });

  it("a qualifyingAwards entry gone in this run is one regression with the team key", () => {
    const live = twoTeams(DONE, NOTHING, { frc1Awards: [[EVENT_A, 0]] });
    const next = twoTeams(DONE, NOTHING);

    const regressions = compareDistrictArtifacts(live, next);

    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatchObject({ eventKey: EVENT_A, teamKey: "frc1", kind: "qualifyingAward", next: "absent" });
    expect(regressions[0]!.live).toContain("Award 0");
    expect(regressions[0]!.live).toContain("0");
  });

  it("the same award type held by a different team in this run is still a lost fact for the first team", () => {
    const live = build([{ teamKey: "frc1", points: [[EVENT_A, DONE]], awards: [[EVENT_A, 9]] }, { teamKey: "frc2", points: [[EVENT_A, DONE]] }]);
    const next = build([{ teamKey: "frc1", points: [[EVENT_A, DONE]] }, { teamKey: "frc2", points: [[EVENT_A, DONE]], awards: [[EVENT_A, 9]] }]);

    expect(compareDistrictArtifacts(live, next)).toMatchObject([{ teamKey: "frc1", kind: "qualifyingAward" }]);
  });

  it("a team missing from this run counts as having no row and no award", () => {
    const live = twoTeams(DONE, NOTHING, { frc1Awards: [[EVENT_A, 0]] });
    const next = build([{ teamKey: "frc2", points: [[EVENT_A, DONE]], remaining: [[EVENT_B, NOTHING]] }]);

    expect(compareDistrictArtifacts(live, next)).toMatchObject([
      { teamKey: "frc1", kind: "eventPointsRow" },
      { teamKey: "frc1", kind: "qualifyingAward" },
    ]);
  });
});

describe("compareDistrictArtifacts — what is clean (261009-ul3 D1)", () => {
  it("identical artifacts lose nothing", () => {
    const artifact = twoTeams(DONE, PART, { frc1Awards: [[EVENT_A, 0]] });

    expect(compareDistrictArtifacts(artifact, twoTeams(DONE, PART, { frc1Awards: [[EVENT_A, 0]] }))).toEqual([]);
  });

  it("a newer artifact (more matches, a flag false to true, an award added, a points row added) loses nothing", () => {
    const live = twoTeams({ ...PART, qualMatchesPlayed: 40 }, NOTHING, { frc2Points: false });
    const next = twoTeams({ ...PART, qualMatchesPlayed: 60, alliancesPicked: true }, NOTHING, { frc1Awards: [[EVENT_A, 0]] });

    expect(compareDistrictArtifacts(live, next)).toEqual([]);
  });

  it("an event only the published artifact names is not compared", () => {
    const live = build([{ teamKey: "frc1", points: [[EVENT_A, DONE], [EVENT_B, DONE]], awards: [[EVENT_B, 0]] }]);
    const next = build([{ teamKey: "frc1", points: [[EVENT_A, DONE]] }]);

    expect(compareDistrictArtifacts(live, next)).toEqual([]);
  });

  it("an event only this run names is not compared", () => {
    const live = build([{ teamKey: "frc1", points: [[EVENT_A, DONE]] }]);
    const next = build([{ teamKey: "frc1", points: [[EVENT_A, DONE]], remaining: [[EVENT_B, NOTHING]] }]);

    expect(compareDistrictArtifacts(live, next)).toEqual([]);
  });

  it("an event this run names only through an award entry is present, so its lost points row is seen", () => {
    const live = build([{ teamKey: "frc1", points: [[EVENT_A, undefined]] }]);
    const next = build([{ teamKey: "frc1", awards: [[EVENT_A, 0]] }]);

    expect(kinds(compareDistrictArtifacts(live, next))).toEqual(["eventPointsRow"]);
  });
});

describe("compareDistrictArtifacts — one state per event, and no state on this run's side (261009-ul3 R3, R4)", () => {
  it("no state block on any row of this run, while live shows true flags and 60 played, is four regressions reading no state", () => {
    const live = twoTeams(DONE, NOTHING);
    const next = twoTeams(undefined, NOTHING);

    const regressions = compareDistrictArtifacts(live, next);

    expect(kinds(regressions)).toEqual(["alliancesPicked", "playoffsDone", "awardsPosted", "qualMatchesPlayed"]);
    expect(regressions.map((regression) => regression.next)).toEqual(["no state", "no state", "no state", "no state"]);
    expect(regressions.map((regression) => regression.live)).toEqual(["true", "true", "true", "60"]);
  });

  it("live all false and zero played against no state loses nothing", () => {
    expect(compareDistrictArtifacts(twoTeams(NOTHING, NOTHING), twoTeams(undefined, undefined))).toEqual([]);
  });

  it("no state on the published side is nothing to lose, whatever this run says", () => {
    expect(compareDistrictArtifacts(twoTeams(undefined, undefined), twoTeams(PART, NOTHING))).toEqual([]);
  });

  it("a flag regressed on the rows of two teams is ONE regression for that event and flag", () => {
    const live = twoTeams({ ...PART, playoffsDone: true }, NOTHING);
    const next = twoTeams(PART, NOTHING);

    expect(kinds(compareDistrictArtifacts(live, next))).toEqual(["playoffsDone"]);
  });

  it("live state on one team's row only and this run's state on the other team's row only still compare", () => {
    const live = build([
      { teamKey: "frc1", points: [[EVENT_A, { ...PART, playoffsDone: true, qualMatchesPlayed: 60 }]] },
      { teamKey: "frc2", points: [[EVENT_A, undefined]] },
    ]);
    const next = build([
      { teamKey: "frc1", points: [[EVENT_A, undefined]] },
      { teamKey: "frc2", points: [[EVENT_A, PART]] },
    ]);

    const regressions = compareDistrictArtifacts(live, next);

    expect(regressions).toEqual([
      { districtKey: "2026fnc", eventKey: EVENT_A, kind: "playoffsDone", live: "true", next: "false" },
      { districtKey: "2026fnc", eventKey: EVENT_A, kind: "qualMatchesPlayed", live: "60", next: "40" },
    ]);
  });

  it("a state carried on a remainingEvents row is read the same way as one on an eventPoints row", () => {
    const live = twoTeams(NOTHING, { ...PART, alliancesPicked: true });
    const next = twoTeams(NOTHING, PART);

    expect(compareDistrictArtifacts(live, next)).toEqual([{ districtKey: "2026fnc", eventKey: EVENT_B, kind: "alliancesPicked", live: "true", next: "false" }]);
  });

  it("two regressed events come out in ascending event key order, state facts before team facts within an event", () => {
    // Event B is named first on every row, so the order below is the sort and not the insertion order.
    const live = build([
      { teamKey: "frc1", points: [[EVENT_B, DONE], [EVENT_A, DONE]], awards: [[EVENT_B, 0], [EVENT_A, 0]] },
      { teamKey: "frc2", points: [[EVENT_B, DONE], [EVENT_A, DONE]] },
    ]);
    const next = build([
      { teamKey: "frc1", points: [[EVENT_B, PART], [EVENT_A, PART]] },
      { teamKey: "frc2", remaining: [[EVENT_B, PART], [EVENT_A, PART]] },
    ]);

    const regressions = compareDistrictArtifacts(live, next);

    const perEvent = ["alliancesPicked", "playoffsDone", "awardsPosted", "qualMatchesPlayed", "eventPointsRow", "qualifyingAward"];
    expect(regressions.map((regression) => `${regression.eventKey} ${regression.kind}`)).toEqual([
      ...perEvent.map((kind) => `${EVENT_A} ${kind}`),
      ...perEvent.map((kind) => `${EVENT_B} ${kind}`),
    ]);
  });
});

describe("formatDistrictRegression (261009-ul3)", () => {
  it("is one line holding the district, the event, both values, and the team when there is one", () => {
    const withTeam = formatDistrictRegression({ districtKey: "2026pnw", eventKey: "2026wabon", teamKey: "frc2910", kind: "qualifyingAward", live: "Impact (award type 0)", next: "absent" });
    const withoutTeam = formatDistrictRegression({ districtKey: "2026pnw", eventKey: "2026wabon", kind: "qualMatchesPlayed", live: "60", next: "40" });

    for (const line of [withTeam, withoutTeam]) {
      expect(line).not.toMatch(/[\r\n]/);
      expect(line.startsWith("publishDistricts:")).toBe(true);
      expect(line).toContain("2026pnw");
      expect(line).toContain("2026wabon");
    }
    expect(withTeam).toContain("frc2910");
    expect(withTeam).toContain("Impact (award type 0)");
    expect(withTeam).toContain("absent");
    expect(withoutTeam).not.toContain("team");
    expect(withoutTeam).toContain("60");
    expect(withoutTeam).toContain("40");
  });
});

// ---------------------------------------------------------------------------
// guardLivePublish: the decision table
// ---------------------------------------------------------------------------

const STAGE = "at the fixture stage";
const BUCKET = "guard-test-bucket";

/** A fake reader over a table of answers, recording every key it was asked for. A key with no entry answers null. */
function fakeReader(answers: Readonly<Record<string, string | null | Error>>): { read: PublishedReader; asked: string[] } {
  const asked: string[] = [];
  const read: PublishedReader = async (bucket, key) => {
    expect(bucket).toBe(BUCKET);
    asked.push(key);
    const answer = answers[key] ?? null;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { read, asked };
}

/** This run's side: three districts, each one the part played two team artifact. */
function threeDetails(): Array<{ key: string; artifact: DistrictArtifact }> {
  return ["2026one", "2026two", "2026tri"].map((districtKey) => ({
    key: `v1/district/${districtKey}.json`,
    artifact: build(
      [
        { teamKey: "frc1", points: [[EVENT_A, PART]], remaining: [[EVENT_B, NOTHING]] },
        { teamKey: "frc2", points: [[EVENT_A, PART]], remaining: [[EVENT_B, NOTHING]] },
      ],
      districtKey
    ),
  }));
}

/** The published side of district `2026two`: playoffs done and one award this run does not have. */
function regressedLiveBody(): string {
  return JSON.stringify(
    build(
      [
        { teamKey: "frc1", points: [[EVENT_A, { ...PART, playoffsDone: true }]], remaining: [[EVENT_B, NOTHING]], awards: [[EVENT_A, 0]] },
        { teamKey: "frc2", points: [[EVENT_A, { ...PART, playoffsDone: true }]], remaining: [[EVENT_B, NOTHING]] },
      ],
      "2026two"
    )
  );
}

async function guard(options: {
  details?: Array<{ key: string; artifact: DistrictArtifact }>;
  answers: Readonly<Record<string, string | null | Error>>;
  mode: "enforce" | "report";
  allowRegress?: boolean;
}) {
  const details = options.details ?? threeDetails();
  const { read, asked } = fakeReader(options.answers);
  const log: string[] = [];
  let outcome: Awaited<ReturnType<typeof guardLivePublish>> | undefined;
  let error: unknown;
  try {
    outcome = await guardLivePublish({
      stage: STAGE,
      bucket: BUCKET,
      details,
      read,
      log: (line) => log.push(line),
      mode: options.mode,
      allowRegress: options.allowRegress ?? false,
    });
  } catch (caught) {
    error = caught;
  }
  return { outcome, error, log, asked, details };
}

const summaryLines = (log: readonly string[]): string[] => log.filter((line) => line.includes(STAGE));
const factLines = (log: readonly string[]): string[] => log.filter((line) => line.includes("2026two") && line.includes(EVENT_A));

describe("guardLivePublish — enforce (261009-ul3 D2)", () => {
  it("a regression rejects, with every fact line logged before the throw", async () => {
    const { outcome, error, log } = await guard({ answers: { "v1/district/2026two.json": regressedLiveBody() }, mode: "enforce" });

    expect(outcome).toBeUndefined();
    expect(error).toBeInstanceOf(DistrictPublishRefusedError);
    expect((error as Error).message).toContain("older than what is live");
    expect((error as Error).message).toContain("run the ingest first");
    expect((error as Error).message).toContain("docs/worker-operations.md");
    expect((error as Error).message).not.toMatch(/rebaseline/i);
    // playoffsDone, then the award: one line each.
    expect(factLines(log)).toHaveLength(2);
    expect(factLines(log)[1]).toContain("frc1");
  });

  it("--allow-regress prints the same list, says it was overridden and returns", async () => {
    const refused = await guard({ answers: { "v1/district/2026two.json": regressedLiveBody() }, mode: "enforce" });
    const { outcome, error, log } = await guard({ answers: { "v1/district/2026two.json": regressedLiveBody() }, mode: "enforce", allowRegress: true });

    expect(error).toBeUndefined();
    expect(outcome?.overridden).toBe(true);
    expect(outcome?.regressions).toHaveLength(2);
    expect(factLines(log)).toEqual(factLines(refused.log));
    expect(log.filter((line) => line.includes("--allow-regress"))).toHaveLength(1);
    expect(summaryLines(log)).toHaveLength(1);
  });

  it("null for every key is a first publish: resolves, every key counted as not published", async () => {
    const { outcome, error, log } = await guard({ answers: {}, mode: "enforce" });

    expect(error).toBeUndefined();
    expect(outcome).toEqual({ compared: 0, notPublished: 3, unparsed: 0, unreadable: 0, regressions: [], overridden: false });
    expect(summaryLines(log)).toHaveLength(1);
  });

  it("an identical published artifact is compared and clean", async () => {
    const details = threeDetails();
    const answers = Object.fromEntries(details.map((detail) => [detail.key, JSON.stringify(detail.artifact)]));

    const { outcome, error } = await guard({ details, answers, mode: "enforce" });

    expect(error).toBeUndefined();
    expect(outcome).toEqual({ compared: 3, notPublished: 0, unparsed: 0, unreadable: 0, regressions: [], overridden: false });
  });

  it("a body that is not JSON and one that fails the schema are shape changes: resolves, each key logged", async () => {
    const { outcome, error, log } = await guard({
      answers: { "v1/district/2026one.json": "not json", "v1/district/2026tri.json": "{}" },
      mode: "enforce",
    });

    expect(error).toBeUndefined();
    expect(outcome?.unparsed).toBe(2);
    expect(outcome?.notPublished).toBe(1);
    expect(log.some((line) => line.includes("v1/district/2026one.json"))).toBe(true);
    expect(log.some((line) => line.includes("v1/district/2026tri.json"))).toBe(true);
    expect(summaryLines(log)).toHaveLength(1);
  });

  it("a read failure rejects, naming the key and the reader's message, with or without --allow-regress", async () => {
    for (const allowRegress of [false, true]) {
      const { outcome, error } = await guard({
        answers: { "v1/district/2026two.json": new Error("fixture read failure 51c2") },
        mode: "enforce",
        allowRegress,
      });

      expect(outcome).toBeUndefined();
      expect(error).toBeInstanceOf(DistrictPublishRefusedError);
      expect((error as Error).message).toContain("v1/district/2026two.json");
      expect((error as Error).message).toContain("fixture read failure 51c2");
    }
  });

  it("names the FIRST failing key in input order, and never the error object or a stack", async () => {
    const { error } = await guard({
      answers: { "v1/district/2026tri.json": new Error("second failure"), "v1/district/2026one.json": new Error("first failure") },
      mode: "enforce",
    });

    expect((error as Error).message).toContain("v1/district/2026one.json");
    expect((error as Error).message).toContain("first failure");
    expect((error as Error).message).not.toContain("second failure");
    expect((error as Error).message).not.toContain("    at ");
  });

  it("with 40 keys and a failure in the first chunk, no key of a later chunk is read", async () => {
    const one = threeDetails()[0]!.artifact;
    const details = Array.from({ length: 40 }, (_, index) => ({ key: `v1/district/k${String(index).padStart(2, "0")}.json`, artifact: one }));

    const { error, asked } = await guard({ details, answers: { "v1/district/k03.json": new Error("chunk one failure") }, mode: "enforce" });

    expect(error).toBeInstanceOf(DistrictPublishRefusedError);
    expect(asked).toEqual(details.slice(0, 16).map((detail) => detail.key));
  });

  it("40 clean keys are all read, each exactly once", async () => {
    const one = threeDetails()[0]!.artifact;
    const details = Array.from({ length: 40 }, (_, index) => ({ key: `v1/district/k${String(index).padStart(2, "0")}.json`, artifact: one }));

    const { outcome, asked } = await guard({ details, answers: {}, mode: "enforce" });

    expect(outcome?.notPublished).toBe(40);
    expect([...asked].sort()).toEqual(details.map((detail) => detail.key));
  });
});

describe("guardLivePublish — report (261009-ul3 D2, a dry run with --check-live)", () => {
  it("a regression resolves and the fact lines are logged", async () => {
    const { outcome, error, log } = await guard({ answers: { "v1/district/2026two.json": regressedLiveBody() }, mode: "report" });

    expect(error).toBeUndefined();
    expect(outcome?.regressions).toHaveLength(2);
    expect(outcome?.overridden).toBe(false);
    expect(factLines(log)).toHaveLength(2);
    expect(summaryLines(log)).toHaveLength(1);
  });

  it("--allow-regress has nothing to override in a report: no override line", async () => {
    const { outcome, log } = await guard({ answers: { "v1/district/2026two.json": regressedLiveBody() }, mode: "report", allowRegress: true });

    expect(outcome?.overridden).toBe(false);
    expect(log.some((line) => line.includes("--allow-regress"))).toBe(false);
  });

  it("a reader that throws for one key resolves with unreadable 1, logs that key, and still compares the keys after it", async () => {
    const { outcome, error, log, asked } = await guard({
      answers: { "v1/district/2026one.json": new Error("fixture read failure 9d0e"), "v1/district/2026two.json": regressedLiveBody() },
      mode: "report",
    });

    expect(error).toBeUndefined();
    expect(outcome?.unreadable).toBe(1);
    expect(outcome?.compared).toBe(1);
    expect(outcome?.notPublished).toBe(1);
    expect(outcome?.regressions).toHaveLength(2);
    expect(asked).toHaveLength(3);
    expect(log.some((line) => line.includes("v1/district/2026one.json") && line.includes("fixture read failure 9d0e"))).toBe(true);
    expect(summaryLines(log)).toHaveLength(1);
  });
});
