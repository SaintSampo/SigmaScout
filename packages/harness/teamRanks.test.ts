import { describe, expect, it } from "vitest";
import {
  buildTeamRankScopes,
  compareTeamsByTotal,
  deriveTeamRegions,
  isRealPublishedTeamKey,
  USA_COUNTRY_VALUE,
  type RankableTeamRow,
  type SeasonEventGeoRow,
} from "./teamRanks.js";

const OFFICIAL_REGIONAL_EVENT_TYPE = 0;
const CHAMPIONSHIP_FINALS_EVENT_TYPE = 4;
const OFFSEASON_EVENT_TYPE = 99;
const PRESEASON_EVENT_TYPE = 100;

function event(overrides: Partial<SeasonEventGeoRow> & Pick<SeasonEventGeoRow, "eventKey" | "startDate">): SeasonEventGeoRow {
  return {
    eventType: OFFICIAL_REGIONAL_EVENT_TYPE,
    country: null,
    stateProv: null,
    districtKey: null,
    ...overrides,
  };
}

describe("isRealPublishedTeamKey", () => {
  it("frc1114 is real", () => {
    expect(isRealPublishedTeamKey("frc1114")).toBe(true);
  });

  it("frc5199B (letter-suffixed second robot) is not real", () => {
    expect(isRealPublishedTeamKey("frc5199B")).toBe(false);
  });

  it("frc0 is not real", () => {
    expect(isRealPublishedTeamKey("frc0")).toBe(false);
  });

  it("frc9970 is real", () => {
    expect(isRealPublishedTeamKey("frc9970")).toBe(true);
  });
});

describe("compareTeamsByTotal", () => {
  it("sorts higher total first", () => {
    const a = { teamNumber: 1, metrics: { total: { value: 10 } } };
    const b = { teamNumber: 2, metrics: { total: { value: 20 } } };
    expect(compareTeamsByTotal(a, b)).toBeGreaterThan(0);
    expect(compareTeamsByTotal(b, a)).toBeLessThan(0);
  });

  it("breaks equal totals by ascending team number", () => {
    const a = { teamNumber: 200, metrics: { total: { value: 10 } } };
    const b = { teamNumber: 100, metrics: { total: { value: 10 } } };
    expect(compareTeamsByTotal(a, b)).toBeGreaterThan(0);
    expect(compareTeamsByTotal(b, a)).toBeLessThan(0);
  });

  it("a row with no total entry sorts last", () => {
    const withTotal = { teamNumber: 999, metrics: { total: { value: 1 } } };
    const withoutTotal = { teamNumber: 1, metrics: {} };
    expect(compareTeamsByTotal(withoutTotal, withTotal)).toBeGreaterThan(0);
    expect(compareTeamsByTotal(withTotal, withoutTotal)).toBeLessThan(0);
  });

  it("two rows with no total entry still order by team number", () => {
    const a = { teamNumber: 200, metrics: {} };
    const b = { teamNumber: 100, metrics: {} };
    expect(compareTeamsByTotal(a, b)).toBeGreaterThan(0);
    expect(compareTeamsByTotal(b, a)).toBeLessThan(0);
  });
});

describe("deriveTeamRegions", () => {
  it("resolves country/stateProv/districtKey from three Michigan fim events", () => {
    const events = [
      event({ eventKey: "2026mitry", startDate: "2026-03-01", eventType: 1, country: "USA", stateProv: "MI", districtKey: "fim" }),
      event({ eventKey: "2026mikok", startDate: "2026-03-08", eventType: 1, country: "USA", stateProv: "MI", districtKey: "fim" }),
      event({ eventKey: "2026micmp", startDate: "2026-04-01", eventType: 2, country: "USA", stateProv: "MI", districtKey: "fim" }),
    ];
    const regions = deriveTeamRegions({
      teamEventKeys: new Map([["frc1114", new Set(["2026mitry", "2026mikok", "2026micmp"])]]),
      events,
    });
    expect(regions.get("frc1114")).toEqual({ country: "USA", stateProv: "MI", districtKey: "fim" });
  });

  it("a neutral-site championship (eventType 4) does not relocate a district team", () => {
    const events = [
      event({ eventKey: "2026mitry", startDate: "2026-03-01", eventType: 1, country: "USA", stateProv: "MI", districtKey: "fim" }),
      event({ eventKey: "2026mikok", startDate: "2026-03-08", eventType: 1, country: "USA", stateProv: "MI", districtKey: "fim" }),
      event({
        eventKey: "2026hop",
        startDate: "2026-04-15",
        eventType: CHAMPIONSHIP_FINALS_EVENT_TYPE,
        country: "USA",
        stateProv: "TX",
        districtKey: null,
      }),
    ];
    const regions = deriveTeamRegions({
      teamEventKeys: new Map([["frc1114", new Set(["2026mitry", "2026mikok", "2026hop"])]]),
      events,
    });
    expect(regions.get("frc1114")).toEqual({ country: "USA", stateProv: "MI", districtKey: "fim" });
  });

  it("breaks a frequency tie by the earliest-starting event, regardless of input order", () => {
    const ontarioEvent = event({ eventKey: "2026onnob", startDate: "2026-03-01", eventType: 1, country: "CAN", stateProv: "ON", districtKey: "ont" });
    const nyRegional = event({ eventKey: "2026nyrye", startDate: "2026-03-15", eventType: OFFICIAL_REGIONAL_EVENT_TYPE, country: "USA", stateProv: "NY", districtKey: null });

    const forward = deriveTeamRegions({
      teamEventKeys: new Map([["frc254", new Set(["2026onnob", "2026nyrye"])]]),
      events: [ontarioEvent, nyRegional],
    });
    const reversed = deriveTeamRegions({
      teamEventKeys: new Map([["frc254", new Set(["2026onnob", "2026nyrye"])]]),
      events: [nyRegional, ontarioEvent],
    });

    expect(forward.get("frc254")).toEqual({ country: "CAN", stateProv: "ON", districtKey: "ont" });
    expect(reversed.get("frc254")).toEqual({ country: "CAN", stateProv: "ON", districtKey: "ont" });
  });

  it("offseason-only and preseason-only events leave every field absent", () => {
    const events = [
      event({ eventKey: "2026offszn", startDate: "2026-06-01", eventType: OFFSEASON_EVENT_TYPE, country: "USA", stateProv: "MI", districtKey: "fim" }),
      event({ eventKey: "2026week0", startDate: "2026-01-05", eventType: PRESEASON_EVENT_TYPE, country: "USA", stateProv: "MI", districtKey: "fim" }),
    ];
    const regions = deriveTeamRegions({
      teamEventKeys: new Map([["frc1", new Set(["2026offszn", "2026week0"])]]),
      events,
    });
    expect(regions.get("frc1")).toEqual({});
  });

  it("a team with zero events has every field absent", () => {
    const regions = deriveTeamRegions({
      teamEventKeys: new Map([["frc2", new Set<string>()]]),
      events: [],
    });
    expect(regions.get("frc2")).toEqual({});
  });

  it("a team whose events all carry null geo has every field absent, as a distinct case from an empty string", () => {
    const events = [event({ eventKey: "2026nullgeo", startDate: "2026-03-01", eventType: 1 })];
    const regions = deriveTeamRegions({
      teamEventKeys: new Map([["frc3", new Set(["2026nullgeo"])]]),
      events,
    });
    const region = regions.get("frc3");
    expect(region).toEqual({});
    expect(region?.country).toBeUndefined();
    expect(region?.country).not.toBe("");
  });
});

/** Builds a pool of real teams plus one non-real team, for `buildTeamRankScopes` fixtures. `regionByTeamKey` overrides the default (no region) per team. */
function buildRows(
  teams: ReadonlyArray<{ teamKey: string; teamNumber: number; total: number | undefined; region?: Partial<Pick<RankableTeamRow, "country" | "stateProv" | "districtKey">> }>,
): RankableTeamRow[] {
  return teams.map(({ teamKey, teamNumber, total, region }) => ({
    teamKey,
    teamNumber,
    metrics: total === undefined ? {} : { total: { value: total } },
    ...region,
  }));
}

describe("buildTeamRankScopes", () => {
  it("a US district team resolves four scopes in order world, country, district, state", () => {
    const rows = buildRows([
      { teamKey: "frc1114", teamNumber: 1114, total: 50, region: { country: "USA", stateProv: "MI", districtKey: "fim" } },
      { teamKey: "frc27", teamNumber: 27, total: 40, region: { country: "USA", stateProv: "MI", districtKey: "fim" } },
      { teamKey: "frc16", teamNumber: 16, total: 30, region: { country: "USA", stateProv: "OH", districtKey: "fim" } },
      { teamKey: "frc118", teamNumber: 118, total: 60, region: { country: "USA", stateProv: "AL" } },
      { teamKey: "frc254", teamNumber: 254, total: 70, region: { country: "CAN", stateProv: "ON", districtKey: "ont" } },
    ]);

    const scopes = buildTeamRankScopes({ rows, teamKey: "frc1114" });
    expect(scopes.map((s) => s.scope)).toEqual(["world", "country", "district", "state"]);
  });

  it("a Canadian team in the ont district resolves three scopes: world, country, district", () => {
    const rows = buildRows([
      { teamKey: "frc254", teamNumber: 254, total: 70, region: { country: "CAN", stateProv: "ON", districtKey: "ont" } },
      { teamKey: "frc1114", teamNumber: 1114, total: 50, region: { country: "USA", stateProv: "MI", districtKey: "fim" } },
    ]);

    const scopes = buildTeamRankScopes({ rows, teamKey: "frc254" });
    expect(scopes.map((s) => s.scope)).toEqual(["world", "country", "district"]);
  });

  it("a US non-district team resolves three scopes: world, country, state", () => {
    const rows = buildRows([
      { teamKey: "frc118", teamNumber: 118, total: 60, region: { country: "USA", stateProv: "AL" } },
      { teamKey: "frc1114", teamNumber: 1114, total: 50, region: { country: "USA", stateProv: "MI", districtKey: "fim" } },
    ]);

    const scopes = buildTeamRankScopes({ rows, teamKey: "frc118" });
    expect(scopes.map((s) => s.scope)).toEqual(["world", "country", "state"]);
  });

  it("an Israeli team in the isr district resolves three scopes: world, country, district", () => {
    const rows = buildRows([
      { teamKey: "frc1937", teamNumber: 1937, total: 45, region: { country: "Israel", districtKey: "isr" } },
      { teamKey: "frc1114", teamNumber: 1114, total: 50, region: { country: "USA", stateProv: "MI", districtKey: "fim" } },
    ]);

    const scopes = buildTeamRankScopes({ rows, teamKey: "frc1937" });
    expect(scopes.map((s) => s.scope)).toEqual(["world", "country", "district"]);
  });

  it("each scope's rank is the target's 1-based position within its own pool, and total is that pool's size", () => {
    const rows = buildRows([
      { teamKey: "frc1114", teamNumber: 1114, total: 50, region: { country: "USA", stateProv: "MI", districtKey: "fim" } },
      { teamKey: "frc27", teamNumber: 27, total: 40, region: { country: "USA", stateProv: "MI", districtKey: "fim" } },
      { teamKey: "frc16", teamNumber: 16, total: 60, region: { country: "USA", stateProv: "MI", districtKey: "fim" } },
    ]);

    const scopes = buildTeamRankScopes({ rows, teamKey: "frc1114" });
    const world = scopes.find((s) => s.scope === "world")!;
    const country = scopes.find((s) => s.scope === "country")!;
    const district = scopes.find((s) => s.scope === "district")!;
    const state = scopes.find((s) => s.scope === "state")!;

    // frc16 (60) > frc1114 (50) > frc27 (40) -- frc1114 is 2nd of 3 in every pool here.
    expect(world).toEqual({ scope: "world", rank: 2, total: 3 });
    expect(country).toEqual({ scope: "country", value: "USA", rank: 2, total: 3 });
    expect(district).toEqual({ scope: "district", value: "fim", rank: 2, total: 3 });
    expect(state).toEqual({ scope: "state", value: "MI", rank: 2, total: 3 });
  });

  it("the World scope's rank equals the target's index+1 in the real-team pool sorted by compareTeamsByTotal", () => {
    const rows = buildRows([
      { teamKey: "frc1", teamNumber: 1, total: 10 },
      { teamKey: "frc2", teamNumber: 2, total: 90 },
      { teamKey: "frc3", teamNumber: 3, total: 50 },
      { teamKey: "frc4", teamNumber: 4, total: 30 },
    ]);

    const sorted = [...rows].sort(compareTeamsByTotal);
    for (const row of rows) {
      const expectedRank = sorted.findIndex((r) => r.teamKey === row.teamKey) + 1;
      const scopes = buildTeamRankScopes({ rows, teamKey: row.teamKey });
      const world = scopes.find((s) => s.scope === "world");
      expect(world?.rank).toBe(expectedRank);
      expect(world?.total).toBe(sorted.length);
    }
  });

  it("a target with no total metric yields an empty array", () => {
    const rows = buildRows([
      { teamKey: "frc1114", teamNumber: 1114, total: undefined, region: { country: "USA", stateProv: "MI", districtKey: "fim" } },
      { teamKey: "frc27", teamNumber: 27, total: 40 },
    ]);
    expect(buildTeamRankScopes({ rows, teamKey: "frc1114" })).toEqual([]);
  });

  it("a teamKey absent from the input rows yields an empty array", () => {
    const rows = buildRows([{ teamKey: "frc27", teamNumber: 27, total: 40 }]);
    expect(buildTeamRankScopes({ rows, teamKey: "frc9999999" })).toEqual([]);
  });

  it("non-real team keys are excluded from every pool before ranking", () => {
    const rows = buildRows([
      { teamKey: "frc1114", teamNumber: 1114, total: 50, region: { country: "USA", stateProv: "MI", districtKey: "fim" } },
      // An offseason B-team with a huge offseason-only total, at the parent's team number.
      { teamKey: "frc1114B", teamNumber: 1114, total: 9999, region: { country: "USA", stateProv: "MI", districtKey: "fim" } },
      { teamKey: "frc27", teamNumber: 27, total: 40, region: { country: "USA", stateProv: "MI", districtKey: "fim" } },
    ]);

    const scopes = buildTeamRankScopes({ rows, teamKey: "frc1114" });
    const world = scopes.find((s) => s.scope === "world")!;
    // With frc1114B excluded, frc1114 (50) is 1st of 2 real teams, not pushed to 2nd/3rd.
    expect(world).toEqual({ scope: "world", rank: 1, total: 2 });
  });
});

describe("USA_COUNTRY_VALUE", () => {
  it("is the literal TBA spelling", () => {
    expect(USA_COUNTRY_VALUE).toBe("USA");
  });
});
