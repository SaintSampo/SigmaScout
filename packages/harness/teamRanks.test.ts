import { describe, expect, it } from "vitest";
import {
  buildTeamRankScopes,
  buildTeamRankScopesByTeam,
  compareTeamsByTotal,
  deriveTeamRegions,
  isRealPublishedTeamKey,
  percentileForRank,
  USA_COUNTRY_VALUE,
  type RankableTeamRow,
  type SeasonEventGeoRow,
  type TeamRankScope,
} from "./teamRanks.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { percentileRanks } from "./percentiles.js";

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

// Quick task 260913-nvn: the pre-change per-team implementation, pasted
// verbatim as a test-local reference so the sort-once rewrite is checked
// against the exact code it replaced, not against a re-derivation of it.
function referenceRankWithin(pool: readonly RankableTeamRow[], teamKey: string): { rank: number; total: number } | undefined {
  const sorted = [...pool].sort(compareTeamsByTotal);
  const index = sorted.findIndex((row) => row.teamKey === teamKey);
  if (index === -1) return undefined;
  return { rank: index + 1, total: sorted.length };
}

function referenceBuildTeamRankScopes(params: { rows: readonly RankableTeamRow[]; teamKey: string }): TeamRankScope[] {
  const realRows = params.rows.filter((row) => isRealPublishedTeamKey(row.teamKey));
  const target = realRows.find((row) => row.teamKey === params.teamKey);
  if (target === undefined) return [];
  if (target.metrics[TOTAL_METRIC_KEY]?.value === undefined) return [];

  const scopes: TeamRankScope[] = [];

  const worldRank = referenceRankWithin(realRows, params.teamKey);
  if (worldRank !== undefined) {
    scopes.push({ scope: "world", rank: worldRank.rank, total: worldRank.total });
  }

  if (target.country !== undefined) {
    const countryPool = realRows.filter((row) => row.country === target.country);
    const countryRank = referenceRankWithin(countryPool, params.teamKey);
    if (countryRank !== undefined) {
      scopes.push({ scope: "country", value: target.country, rank: countryRank.rank, total: countryRank.total });
    }
  }

  if (target.districtKey !== undefined) {
    const districtPool = realRows.filter((row) => row.districtKey === target.districtKey);
    const districtRank = referenceRankWithin(districtPool, params.teamKey);
    if (districtRank !== undefined) {
      scopes.push({ scope: "district", value: target.districtKey, rank: districtRank.rank, total: districtRank.total });
    }
  }

  if (target.country === USA_COUNTRY_VALUE && target.stateProv !== undefined) {
    const statePool = realRows.filter((row) => row.country === USA_COUNTRY_VALUE && row.stateProv === target.stateProv);
    const stateRank = referenceRankWithin(statePool, params.teamKey);
    if (stateRank !== undefined) {
      scopes.push({ scope: "state", value: target.stateProv, rank: stateRank.rank, total: stateRank.total });
    }
  }

  return scopes;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRoster(seed: number): RankableTeamRow[] {
  const random = mulberry32(seed);
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  const rows: RankableTeamRow[] = [];
  for (let i = 1; i <= 600; i++) {
    const teamNumber = 1 + Math.floor(random() * 9000);
    // A handful of non-real keys: letter-suffixed second robots and frc0.
    const roll = random();
    const teamKey = roll < 0.01 ? "frc0" : roll < 0.03 ? `frc${teamNumber}B` : `frc${i}`;
    const row: RankableTeamRow = {
      teamKey,
      teamNumber,
      // ~10% of rows carry no total; the rest draw from a small integer set so ties are common.
      metrics: random() < 0.1 ? {} : { [TOTAL_METRIC_KEY]: { value: pick([10, 20, 20, 30, 40, 40, 50]) } },
    };
    const country = pick(["USA", "USA", "Canada", "Israel", undefined]);
    if (country !== undefined) row.country = country;
    // Includes non-USA rows that still carry a stateProv (ON on a USA row, CA on a Canada row).
    const stateProv = pick(["CA", "TX", "ON", undefined]);
    if (stateProv !== undefined) row.stateProv = stateProv;
    const districtKey = pick(["fim", "ne", "ont", undefined]);
    if (districtKey !== undefined) row.districtKey = districtKey;
    rows.push(row);
  }
  // Shuffle so pool order is not team-number order.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
  }
  return rows;
}

describe("buildTeamRankScopesByTeam — sort-once equivalence with the per-team implementation", () => {
  it.each([1, 7, 42, 2026, 90210])("seed %i: every row's scopes deep-equal the pre-change per-team result", (seed) => {
    const rows = randomRoster(seed);
    // Fixture-vacuity guards: the roster must genuinely exercise ties, missing totals and non-real keys.
    expect(rows.some((row) => !isRealPublishedTeamKey(row.teamKey))).toBe(true);
    expect(rows.some((row) => row.metrics[TOTAL_METRIC_KEY] === undefined)).toBe(true);
    expect(rows.some((row) => row.country !== USA_COUNTRY_VALUE && row.stateProv !== undefined)).toBe(true);

    const byTeam = buildTeamRankScopesByTeam(rows);
    for (const row of rows) {
      expect(byTeam.get(row.teamKey), row.teamKey).toEqual(referenceBuildTeamRankScopes({ rows, teamKey: row.teamKey }));
    }
    expect(rows.some((row) => (byTeam.get(row.teamKey)?.length ?? 0) === 4), "non-vacuous: some row resolves all four scopes").toBe(true);

    // A key absent from the rows maps to nothing, where the per-team form answers an empty array.
    expect(byTeam.has("frc99999")).toBe(false);
    expect(referenceBuildTeamRankScopes({ rows, teamKey: "frc99999" })).toEqual([]);
    expect(buildTeamRankScopes({ rows, teamKey: "frc99999" })).toEqual([]);
  });

  it("returns an entry for every row key, including non-real keys and rows with no total", () => {
    const rows: RankableTeamRow[] = [
      { teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_METRIC_KEY]: { value: 10 } }, country: "USA" },
      { teamKey: "frc2", teamNumber: 2, metrics: {} },
      { teamKey: "frc5199B", teamNumber: 5199, metrics: { [TOTAL_METRIC_KEY]: { value: 99 } } },
      { teamKey: "frc0", teamNumber: 0, metrics: {} },
    ];
    const byTeam = buildTeamRankScopesByTeam(rows);
    expect([...byTeam.keys()].sort()).toEqual(["frc0", "frc1", "frc2", "frc5199B"]);
    expect(byTeam.get("frc2")).toEqual([]);
    expect(byTeam.get("frc5199B")).toEqual([]);
    expect(byTeam.get("frc0")).toEqual([]);
    expect(byTeam.get("frc1")).toEqual([
      // frc2 is a real row without a total: it still counts toward the world pool, sorted last.
      { scope: "world", rank: 1, total: 2 },
      { scope: "country", value: "USA", rank: 1, total: 1 },
    ]);
  });
});

describe("USA_COUNTRY_VALUE", () => {
  it("is the literal TBA spelling", () => {
    expect(USA_COUNTRY_VALUE).toBe("USA");
  });
});

describe("percentileForRank", () => {
  it("rank 1 of a large pool (3481) yields a value at or above the Legendary cut (95)", () => {
    expect(percentileForRank(1, 3481)).toBeGreaterThanOrEqual(95);
  });

  it("rank 3481 of 3481 (last place) yields a value below the Common band cut (50)", () => {
    expect(percentileForRank(3481, 3481)).toBeLessThan(50);
  });

  it("agrees EXACTLY with percentileRanks for the r-th-best member of a strictly-ordered pool of n (rounded identically)", () => {
    const n = 20;
    // A strictly-ordered pool: values n, n-1, ..., 1 (all distinct, no ties),
    // so percentileRanks's mid-rank formula reduces to the same computation
    // percentileForRank specialises to.
    const values = Array.from({ length: n }, (_, i) => n - i);
    const ranks = percentileRanks(values);
    for (let rank = 1; rank <= n; rank++) {
      // values[rank - 1] is the rank-th-best (largest-first) value.
      expect(percentileForRank(rank, n)).toBe(ranks[rank - 1]!);
    }
    // A pool size whose raw percentiles repeat, so rounding is really exercised.
    const m = 2500;
    const bigRanks = percentileRanks(Array.from({ length: m }, (_, i) => m - i));
    for (const rank of [1, 2, 126, 127, 625, 626, 1250, 1251, 2499, 2500]) {
      expect(percentileForRank(rank, m), `rank ${rank} of ${m}`).toBe(bigRanks[rank - 1]!);
    }
  });

  it("rounds to ROUNDING_RULE.percentile like a published percentile: rank 126 of 2500 is 94.98 raw and exactly 95 rounded", () => {
    expect(percentileForRank(126, 2500)).toBe(95);
    expect(percentileForRank(127, 2500)).toBe(94.9);
  });

  it("rank 1 of 1 yields exactly 50 -- a deliberate, tested outcome: a pool of one carries no information about whether its single member is good, so it lands mid-band rather than Legendary", () => {
    expect(percentileForRank(1, 1)).toBe(50);
  });

  it("is monotonic: for a fixed total, a better (lower) rank never returns a lower percentile", () => {
    const total = 50;
    let previous = -Infinity;
    for (let rank = total; rank >= 1; rank--) {
      const value = percentileForRank(rank, total);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("is always within the closed interval [0, 100]", () => {
    const total = 3481;
    for (const rank of [1, 2, 1740, 3480, 3481]) {
      const value = percentileForRank(rank, total);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});
