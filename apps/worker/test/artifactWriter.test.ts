/**
 * Fake R2 binding recording keys/bodies/options and put-call counts: zero puts
 * on validation failure, exactly one put at `artifactKey`'s key for each of the
 * five page kinds, cache-control/content-type metadata, and the secret-scrub
 * refusal.
 *
 * The two budget-exhaustion cases this file also used to pin — a write returning
 * `{ deferred: true }` with zero puts, and a read throwing
 * `ArtifactReadBudgetExhaustedError` — were deleted with the budget itself by
 * quick task 260923-3w4. Neither behaviour exists to pin any more; see
 * `subrequestCounter.ts`'s header.
 */
import { describe, expect, it } from "vitest";
import { artifactKey, districtDetailKey, type ArtifactKeyParams } from "../../../packages/harness/pageArtifacts.js";
import { ArtifactSecretLeakError, DistrictArtifactSecretLeakError, readArtifactObject, writeArtifactObject, writeDistrictArtifactObject } from "../src/artifactWriter.js";
import { SubrequestCounter } from "../src/subrequestCounter.js";
import type { Env } from "../src/env.js";

const TBA_KEY = "test-tba-secret-value";

class FakeR2Object {
  constructor(private readonly value: string) {}
  async text(): Promise<string> {
    return this.value;
  }
}

interface RecordedPut {
  readonly key: string;
  readonly body: string;
  readonly options: { httpMetadata?: { contentType?: string; cacheControl?: string } };
}

class FakeR2Bucket {
  putCallCount = 0;
  getCallCount = 0;
  puts: RecordedPut[] = [];
  private readonly store = new Map<string, string>();

  async put(key: string, body: string, options: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<void> {
    this.putCallCount++;
    this.puts.push({ key, body, options });
    this.store.set(key, body);
  }

  async get(key: string): Promise<FakeR2Object | null> {
    this.getCallCount++;
    const value = this.store.get(key);
    return value === undefined ? null : new FakeR2Object(value);
  }
}

function makeEnv(r2: FakeR2Bucket): Env {
  return { DB: {} as unknown, ARTIFACTS: r2 as unknown, TBA_API_KEY: TBA_KEY } as Env;
}

// ---------------------------------------------------------------------------
// One valid fixture per page kind, with its matching key params.
// ---------------------------------------------------------------------------

const preamble = { schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" };
const algoPreamble = { ...preamble, algorithmId: "opr", algorithmVersion: "3.0.0+baseline" };

const fixtures: { readonly page: "teams" | "team" | "events" | "event" | "compare"; readonly params: ArtifactKeyParams; readonly artifact: unknown }[] = [
  {
    page: "teams",
    params: { page: "teams", year: 2026, algorithmId: "opr", version: "3.0.0+baseline" },
    artifact: { ...algoPreamble, season: 2026, teams: [] },
  },
  {
    page: "team",
    params: { page: "team", teamKey: "frc254", year: 2026, algorithmId: "opr", version: "3.0.0+baseline" },
    artifact: {
      ...algoPreamble,
      teamKey: "frc254",
      teamNumber: 254,
      nickname: "The Cheesy Poofs",
      season: 2026,
      seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {} },
      events: [],
      metricHistory: [],
    },
  },
  {
    page: "events",
    params: { page: "events", year: 2026, algorithmId: "opr", version: "3.0.0+baseline" },
    artifact: { ...algoPreamble, season: 2026, events: [] },
  },
  {
    page: "event",
    params: { page: "event", eventKey: "2026casj", algorithmId: "opr", version: "3.0.0+baseline" },
    artifact: { ...algoPreamble, eventKey: "2026casj", season: 2026, matches: [], upcoming: [], teams: [] },
  },
  {
    page: "compare",
    params: { page: "compare", year: 2026 },
    artifact: { ...preamble, algorithms: [{ id: "opr", version: "3.0.0+baseline", codeVersion: "3.0.0", paramSetName: "baseline" }], slices: [] },
  },
];

describe("writeArtifactObject", () => {
  it("issues exactly one put at artifactKey's key for each of the five page kinds", async () => {
    for (const fixture of fixtures) {
      const r2 = new FakeR2Bucket();
      const env = makeEnv(r2);
      const counter = new SubrequestCounter();

      await writeArtifactObject(env, counter, fixture.page, fixture.params, fixture.artifact);

      expect(r2.putCallCount).toBe(1);
      expect(counter.used).toBe(1);
      expect(r2.puts[0]?.key).toBe(artifactKey(fixture.params));
    }
  });

  it("sets a JSON content type and a 60s max-age cache-control on every successful put", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(r2);
    const counter = new SubrequestCounter();

    await writeArtifactObject(env, counter, "event", fixtures[3]!.params, fixtures[3]!.artifact);

    const options = r2.puts[0]?.options;
    expect(options?.httpMetadata?.contentType).toBe("application/json");
    expect(options?.httpMetadata?.cacheControl).toBe("public, max-age=60");
  });

  it("issues zero puts on a schema validation failure, throws, and leaves the subrequest count untouched (the witness `writeArtifactWithBootstrapRetry` reads)", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(r2);
    const counter = new SubrequestCounter();

    await expect(writeArtifactObject(env, counter, "event", fixtures[3]!.params, { not: "a valid event artifact" })).rejects.toThrow();
    expect(r2.putCallCount).toBe(0);
    expect(counter.used).toBe(0);
  });

  it("refuses to write a body containing the configured secret value, throwing ArtifactSecretLeakError and issuing zero puts", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(r2);
    const counter = new SubrequestCounter();
    const leaking = { ...(fixtures[1]!.artifact as Record<string, unknown>), nickname: `leaked-${TBA_KEY}` };

    await expect(writeArtifactObject(env, counter, "team", fixtures[1]!.params, leaking)).rejects.toBeInstanceOf(ArtifactSecretLeakError);
    expect(r2.putCallCount).toBe(0);
  });
});

describe("readArtifactObject", () => {
  it("returns undefined for a missing key rather than throwing", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(r2);
    const counter = new SubrequestCounter();

    const result = await readArtifactObject(env, counter, "v1/event/2026casj/opr@3.0.0+baseline.json");
    expect(result).toBeUndefined();
  });

  it("returns the stored text for an existing key", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(r2);
    const counter = new SubrequestCounter();
    await writeArtifactObject(env, counter, "event", fixtures[3]!.params, fixtures[3]!.artifact);

    const result = await readArtifactObject(env, counter, artifactKey(fixtures[3]!.params));
    expect(result).toBeDefined();
    expect(JSON.parse(result!)).toMatchObject({ eventKey: "2026casj" });
  });

  it("counts the read on the tick's subrequest counter whether or not the key exists", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(r2);
    const counter = new SubrequestCounter();

    await readArtifactObject(env, counter, "v1/event/2026casj/opr@3.0.0+baseline.json");
    expect(counter.used).toBe(1);
    expect(r2.getCallCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The district writer (10-05). Same body as `writeArtifactObject`, a key
// outside `PageKind`, and its own secret refusal (threat T-10-05-01).
// ---------------------------------------------------------------------------

/** A minimal but schema-valid published district artifact — one team, one played event, no remaining events. */
function districtArtifactFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...preamble,
    districtKey: "2026pnw",
    year: 2026,
    abbreviation: "pnw",
    displayName: "Pacific Northwest",
    dcmpSlots: 1,
    cmpSlots: 1,
    teams: [
      {
        teamKey: "frc1",
        teamNumber: 1,
        nickname: "The Juggernauts",
        rank: 1,
        pointTotal: 40,
        rookieBonus: 0,
        adjustments: 0,
        eventPoints: [{ eventKey: "2026wabon", eventName: "Bonney Lake", week: 1, tier: "district", qual: 20, alliance: 10, elim: 5, award: 5, total: 40 }],
        remainingEvents: [],
        maxRemainingDistrict: 0,
        maxRemainingChamp: 0,
        qualifyingAwards: [],
        districtLock: { status: "contending", pointsToLock: null, threatCount: 0, cutLinePoints: null, allocationNote: null },
        champLock: { status: "contending", pointsToLock: null, threatCount: 0, cutLinePoints: null, allocationNote: null },
      },
    ],
    insights: { teamCount: 1, eventCount: 1, dcmpCutLinePoints: null, cmpCutLinePoints: null, districtLockedCount: 0, districtEliminatedCount: 0, champLockedCount: 0, champEliminatedCount: 0 },
    ...overrides,
  };
}

describe("writeDistrictArtifactObject", () => {
  it("issues exactly one put at districtDetailKey, with the shared JSON content type and 60s cache-control", async () => {
    const r2 = new FakeR2Bucket();
    const counter = new SubrequestCounter();

    await writeDistrictArtifactObject(makeEnv(r2), counter, "2026pnw", districtArtifactFixture());

    expect(r2.putCallCount).toBe(1);
    expect(counter.used).toBe(1);
    expect(r2.puts[0]?.key).toBe(districtDetailKey("2026pnw"));
    expect(r2.puts[0]?.options.httpMetadata?.contentType).toBe("application/json");
    expect(r2.puts[0]?.options.httpMetadata?.cacheControl).toBe("public, max-age=60");
  });

  it("returns the serialized byte length of the VALIDATED object", async () => {
    const r2 = new FakeR2Bucket();
    const counter = new SubrequestCounter();
    const fixture = districtArtifactFixture();

    const bytes = await writeDistrictArtifactObject(makeEnv(r2), counter, "2026pnw", fixture);

    expect(bytes).toBe(r2.puts[0]!.body.length);
    expect(bytes).toBe(JSON.stringify(JSON.parse(r2.puts[0]!.body)).length);
  });

  it("throws on a schema-invalid artifact with ZERO puts and an untouched subrequest count", async () => {
    const r2 = new FakeR2Bucket();
    const counter = new SubrequestCounter();

    await expect(writeDistrictArtifactObject(makeEnv(r2), counter, "2026pnw", { not: "a district artifact" })).rejects.toThrow();
    expect(r2.putCallCount).toBe(0);
    expect(counter.used).toBe(0);
  });

  it("refuses a body containing the configured secret value, throwing DistrictArtifactSecretLeakError with zero puts", async () => {
    const r2 = new FakeR2Bucket();
    const counter = new SubrequestCounter();
    const leaking = districtArtifactFixture({ displayName: `Pacific Northwest ${TBA_KEY}` });

    await expect(writeDistrictArtifactObject(makeEnv(r2), counter, "2026pnw", leaking)).rejects.toBeInstanceOf(DistrictArtifactSecretLeakError);
    expect(r2.putCallCount).toBe(0);
    expect(counter.used).toBe(0);
  });
});
