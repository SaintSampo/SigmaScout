import { describe, expect, it } from "vitest";
import { buildSearchResults, matchEvents, matchTeams, SEARCH_RESULT_CAP, type SearchEventRow, type SearchTeamRow } from "./search-index";

/** A minimal, valid `SearchTeamRow` fixture, overridable per test. */
function team(overrides: Partial<SearchTeamRow> = {}): SearchTeamRow {
  return {
    teamKey: `frc${overrides.teamNumber ?? 1114}`,
    teamNumber: 1114,
    nickname: "Simbotics",
    record: { wins: 7, losses: 3, ties: 0 },
    metrics: { total: { value: 50 } },
    eventCount: 1,
    matchCount: 10,
    ...overrides,
  };
}

/** A minimal, valid `SearchEventRow` fixture, overridable per test. */
function event(overrides: Partial<SearchEventRow> = {}): SearchEventRow {
  return {
    eventKey: "2024casj",
    name: "Silicon Valley Regional",
    eventType: 0,
    isOffseason: false,
    startDate: "2024-03-01",
    week: 2,
    teamCount: 40,
    matchCount: 80,
    playedMatchCount: 80,
    country: "USA",
    stateProv: "CA",
    districtKey: null,
    ...overrides,
  };
}

describe("matchTeams", () => {
  it("number-prefix: '1114' matches 1114, 11140 and 11141 — a prefix match, not an equality check", () => {
    const teams = [team({ teamNumber: 1114, nickname: "Simbotics" }), team({ teamNumber: 11140, nickname: "A" }), team({ teamNumber: 11141, nickname: "B" }), team({ teamNumber: 254, nickname: "C" })];
    const result = matchTeams(teams, "1114");
    expect(result.map((m) => m.teamNumber)).toEqual([1114, 11140, 11141]);
  });

  it("number-prefix: '111' matches 1114 but excludes 2111 — prefix, not substring", () => {
    const teams = [team({ teamNumber: 1114, nickname: "Simbotics" }), team({ teamNumber: 2111, nickname: "Other" })];
    const result = matchTeams(teams, "111");
    expect(result.map((m) => m.teamNumber)).toEqual([1114]);
  });

  it("a numeric query does not match mid-number — '114' does not match 51142", () => {
    const teams = [team({ teamNumber: 51142, nickname: "Midnumber" })];
    expect(matchTeams(teams, "114")).toHaveLength(0);
  });

  it("name-substring: 'simb' matches a team nicknamed Simbotics, anywhere in the name", () => {
    const teams = [team({ teamNumber: 1114, nickname: "Simbotics" }), team({ teamNumber: 254, nickname: "The Cheesy Poofs" })];
    const result = matchTeams(teams, "simb");
    expect(result.map((m) => m.teamNumber)).toEqual([1114]);
  });

  it("case-insensitivity: 'SIMB' and 'simb' return the same teams", () => {
    const teams = [team({ teamNumber: 1114, nickname: "Simbotics" })];
    expect(matchTeams(teams, "SIMB")).toEqual(matchTeams(teams, "simb"));
    expect(matchTeams(teams, "SIMB")).toHaveLength(1);
  });

  it("an empty or whitespace-only query returns no results rather than everything", () => {
    const teams = [team({ teamNumber: 1114 }), team({ teamNumber: 254 })];
    expect(matchTeams(teams, "")).toEqual([]);
    expect(matchTeams(teams, "   ")).toEqual([]);
  });

  it("a team with no nickname is matched by number and rendered by number without throwing", () => {
    const teams = [team({ teamNumber: 1114, nickname: "" })];
    expect(() => matchTeams(teams, "1114")).not.toThrow();
    const result = matchTeams(teams, "1114");
    expect(result).toEqual([{ kind: "team", teamKey: "frc1114", teamNumber: 1114, nickname: "" }]);
  });

  it("returns matches sorted by ascending team number", () => {
    const teams = [team({ teamNumber: 11142, nickname: "Z" }), team({ teamNumber: 1114, nickname: "A" }), team({ teamNumber: 11140, nickname: "B" })];
    const result = matchTeams(teams, "111");
    expect(result.map((m) => m.teamNumber)).toEqual([1114, 11140, 11142]);
  });

  it("ADVERSARIAL INPUT (T-05-01): a query full of regex metacharacters returns within a few milliseconds and does not hang, over a realistically sized fixture", () => {
    const bigFixture = Array.from({ length: 5000 }, (_, i) => team({ teamNumber: 1000 + i, nickname: `Team Nickname ${i}` }));
    const adversarialQuery = "(a+)+$.*.*.*.*.*[^]{0,}(?:a|a)*\\1\\2\\3";

    const start = performance.now();
    const result = matchTeams(bigFixture, adversarialQuery);
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(100);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("matchEvents", () => {
  it("'silicon' matches an event named Silicon Valley Regional", () => {
    const events = [event({ eventKey: "2024casj", name: "Silicon Valley Regional" }), event({ eventKey: "2024txho", name: "Houston Regional" })];
    const result = matchEvents(events, "silicon");
    expect(result.map((m) => m.eventKey)).toEqual(["2024casj"]);
  });

  it("'2024' matches events whose KEY or NAME contains it — the same rule applied to both fields", () => {
    const events = [
      event({ eventKey: "2024casj", name: "Silicon Valley Regional" }),
      event({ eventKey: "casj25", name: "2024 Rewind Offseason" }),
      event({ eventKey: "txho25", name: "Houston Regional" }),
    ];
    const result = matchEvents(events, "2024");
    expect(result.map((m) => m.eventKey).sort()).toEqual(["2024casj", "casj25"]);
  });

  it("an empty or whitespace-only query returns no results rather than everything", () => {
    const events = [event()];
    expect(matchEvents(events, "")).toEqual([]);
    expect(matchEvents(events, "  ")).toEqual([]);
  });

  it("an event match whose week is null carries week: null through to the match object", () => {
    const events = [event({ eventKey: "2024off1", name: "Offseason Bash", week: null })];
    const result = matchEvents(events, "offseason");
    expect(result).toEqual([{ kind: "event", eventKey: "2024off1", name: "Offseason Bash", week: null }]);
  });

  it("returns matches sorted by ascending start date, then ascending event key", () => {
    const events = [
      event({ eventKey: "2024zzz", name: "Regional Z", startDate: "2024-03-01" }),
      event({ eventKey: "2024aaa", name: "Regional A", startDate: "2024-01-01" }),
      event({ eventKey: "2024mmm", name: "Regional M", startDate: "2024-03-01" }),
    ];
    const result = matchEvents(events, "regional");
    expect(result.map((m) => m.eventKey)).toEqual(["2024aaa", "2024mmm", "2024zzz"]);
  });
});

describe("buildSearchResults", () => {
  it("caps the combined team+event output at SEARCH_RESULT_CAP (8)", () => {
    const teams = Array.from({ length: 6 }, (_, i) => team({ teamNumber: 1000 + i, nickname: `Match Team ${i}` }));
    const events = Array.from({ length: 6 }, (_, i) => event({ eventKey: `2024m${i}`, name: `Match Event ${i}` }));
    const result = buildSearchResults({ teams, events, query: "match", eventsStatus: "loaded" });
    expect(result.teams.length + result.events.length).toBe(SEARCH_RESULT_CAP);
  });

  it("returns team and event matches in separate groups, each in its own stable order", () => {
    const teams = [team({ teamNumber: 2, nickname: "Match B" }), team({ teamNumber: 1, nickname: "Match A" })];
    const events = [event({ eventKey: "2024b", name: "Match Event B", startDate: "2024-02-01" }), event({ eventKey: "2024a", name: "Match Event A", startDate: "2024-01-01" })];
    const result = buildSearchResults({ teams, events, query: "match", eventsStatus: "loaded" });
    expect(result.teams.map((t) => t.teamNumber)).toEqual([1, 2]);
    expect(result.events.map((e) => e.eventKey)).toEqual(["2024a", "2024b"]);
  });

  it("with only teams loaded (events still loading): returns the team group and an explicit not-yet-loaded marker for events", () => {
    const teams = [team({ teamNumber: 1114, nickname: "Simbotics" })];
    const result = buildSearchResults({ teams, events: [event({ name: "Simbotics Classic" })], query: "sim", eventsStatus: "loading" });
    expect(result.teams).toHaveLength(1);
    expect(result.events).toEqual([]);
    expect(result.eventsStatus).toBe("loading");
  });

  it("with the events load failed: returns the team group and an explicit failed marker, distinct from the not-yet-loaded marker", () => {
    const teams = [team({ teamNumber: 1114, nickname: "Simbotics" })];
    const result = buildSearchResults({ teams, events: [event({ name: "Simbotics Classic" })], query: "sim", eventsStatus: "failed" });
    expect(result.teams).toHaveLength(1);
    expect(result.events).toEqual([]);
    expect(result.eventsStatus).toBe("failed");
    expect(result.eventsStatus).not.toBe("loading");
  });

  it("an empty query returns an empty result set entirely, in every eventsStatus", () => {
    const teams = [team()];
    const events = [event()];
    expect(buildSearchResults({ teams, events, query: "", eventsStatus: "loaded" })).toEqual({ teams: [], events: [], eventsStatus: "loaded" });
  });
});
