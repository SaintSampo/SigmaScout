/**
 * Fake R2 binding recording keys/bodies/options and put-call counts, per
 * this plan's Task 2 acceptance criteria: zero puts on validation failure,
 * zero puts (deferred, non-throwing) on budget exhaustion, exactly one put
 * at `artifactKey`'s key for each of the five page kinds, cache-control/
 * content-type metadata, and the secret-scrub refusal.
 */
import { describe, expect, it } from "vitest";
import { artifactKey, type ArtifactKeyParams } from "../../../packages/harness/pageArtifacts.js";
import { ArtifactReadBudgetExhaustedError, ArtifactSecretLeakError, readArtifactObject, writeArtifactObject } from "../src/artifactWriter.js";
import { SubrequestBudget } from "../src/subrequestBudget.js";
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
  return { DB: {} as unknown, ARTIFACTS: r2 as unknown, MANIFEST: {} as unknown, TBA_API_KEY: TBA_KEY } as Env;
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
      const budget = new SubrequestBudget();

      const result = await writeArtifactObject(env, budget, fixture.page, fixture.params, fixture.artifact);

      expect(result.deferred).toBe(false);
      expect(r2.putCallCount).toBe(1);
      expect(r2.puts[0]?.key).toBe(artifactKey(fixture.params));
    }
  });

  it("sets a JSON content type and a 60s max-age cache-control on every successful put", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(r2);
    const budget = new SubrequestBudget();

    await writeArtifactObject(env, budget, "event", fixtures[3]!.params, fixtures[3]!.artifact);

    const options = r2.puts[0]?.options;
    expect(options?.httpMetadata?.contentType).toBe("application/json");
    expect(options?.httpMetadata?.cacheControl).toBe("public, max-age=60");
  });

  it("issues zero puts on a schema validation failure, and throws", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(r2);
    const budget = new SubrequestBudget();

    await expect(writeArtifactObject(env, budget, "event", fixtures[3]!.params, { not: "a valid event artifact" })).rejects.toThrow();
    expect(r2.putCallCount).toBe(0);
  });

  it("issues zero puts and returns a deferred (non-throwing) result when the budget is exhausted", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(r2);
    const budget = new SubrequestBudget(0, 0); // usableCap 0 -- every tryConsume fails

    const result = await writeArtifactObject(env, budget, "event", fixtures[3]!.params, fixtures[3]!.artifact);

    expect(result.deferred).toBe(true);
    expect(r2.putCallCount).toBe(0);
  });

  it("refuses to write a body containing the configured secret value, throwing ArtifactSecretLeakError and issuing zero puts", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(r2);
    const budget = new SubrequestBudget();
    const leaking = { ...(fixtures[1]!.artifact as Record<string, unknown>), nickname: `leaked-${TBA_KEY}` };

    await expect(writeArtifactObject(env, budget, "team", fixtures[1]!.params, leaking)).rejects.toBeInstanceOf(ArtifactSecretLeakError);
    expect(r2.putCallCount).toBe(0);
  });
});

describe("readArtifactObject", () => {
  it("returns undefined for a missing key rather than throwing", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(r2);
    const budget = new SubrequestBudget();

    const result = await readArtifactObject(env, budget, "v1/event/2026casj/opr@3.0.0+baseline.json");
    expect(result).toBeUndefined();
  });

  it("returns the stored text for an existing key", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(r2);
    const budget = new SubrequestBudget();
    await writeArtifactObject(env, budget, "event", fixtures[3]!.params, fixtures[3]!.artifact);

    const result = await readArtifactObject(env, budget, artifactKey(fixtures[3]!.params));
    expect(result).toBeDefined();
    expect(JSON.parse(result!)).toMatchObject({ eventKey: "2026casj" });
  });

  it("throws ArtifactReadBudgetExhaustedError when the budget cannot afford the read", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(r2);
    const budget = new SubrequestBudget(0, 0);

    await expect(readArtifactObject(env, budget, "v1/event/2026casj/opr@3.0.0+baseline.json")).rejects.toBeInstanceOf(ArtifactReadBudgetExhaustedError);
    expect(r2.getCallCount).toBe(0);
  });
});
