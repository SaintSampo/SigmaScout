import { describe, it, expect } from "vitest";
import { statboticsReference, STATBOTICS_REFERENCE_FALLBACK } from "./statbotics.js";

/** A minimal live-shaped `/v3/year/{season}` fixture — only the fields `StatboticsYearResponseSchema` reads, plus a couple of untouched sibling fields to prove unknown fields are tolerated. */
function liveYearFixture(acc: number, mse: number): unknown {
  return {
    year: 2025,
    score_mean: 120.4,
    score_sd: 24.1,
    percentiles: {},
    breakdown: {},
    metrics: {
      win_prob: {
        season: { count: 17846, conf: 0.7011, acc, mse },
        champs: { count: 1141, conf: 0.7526, acc: 0.773, mse: 0.1525 },
      },
      score_pred: { season: { count: 35692, rmse: 24.39, error: -3.1 } },
    },
  };
}

function fetchImplReturning(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () =>
    ({
      ok,
      status,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

describe("statboticsReference — live-shaped payload", () => {
  it("parses a live-shaped payload to the right accuracy and Brier (mse)", async () => {
    const fetchImpl = fetchImplReturning(liveYearFixture(0.7839, 0.1537));
    const result = await statboticsReference(2025, { fetchImpl });
    expect(result.fetched).toBe(true);
    expect(result.value).toBe(0.7839);
    expect(result.mse).toBe(0.1537);
    expect(result.sourceLabel).toContain("live fetch");
  });
});

describe("statboticsReference — malformed/missing payload falls back rather than throwing", () => {
  it("falls back when the payload has no metrics field at all (the pre-fix broken shape)", async () => {
    // The exact shape the OLD schema expected (`{ epa_acc: number }`) — no
    // `metrics` key, so the new schema's parse must fail and this call must
    // fall back rather than throw.
    const fetchImpl = fetchImplReturning({ epa_acc: 0.71 });
    const result = await statboticsReference(2025, { fetchImpl });
    expect(result.fetched).toBe(false);
    expect(result).toEqual(STATBOTICS_REFERENCE_FALLBACK[2025]);
  });

  it("falls back when metrics.win_prob.season is present but missing acc/mse", async () => {
    const fetchImpl = fetchImplReturning({ metrics: { win_prob: { season: {} } } });
    const result = await statboticsReference(2024, { fetchImpl });
    expect(result.fetched).toBe(false);
    expect(result).toEqual(STATBOTICS_REFERENCE_FALLBACK[2024]);
  });

  it("falls back on a non-2xx status without throwing", async () => {
    const fetchImpl = fetchImplReturning({}, false, 500);
    const result = await statboticsReference(2022, { fetchImpl });
    expect(result.fetched).toBe(false);
    expect(result).toEqual(STATBOTICS_REFERENCE_FALLBACK[2022]);
  });
});

describe("STATBOTICS_REFERENCE_FALLBACK — every constant carries a fetched-and-verified label", () => {
  it.each(Object.entries(STATBOTICS_REFERENCE_FALLBACK))("season %s", (_season, reference) => {
    expect(reference.fetched).toBe(false);
    expect(reference.sourceLabel).toContain("fetched and verified");
    expect(reference.sourceLabel).not.toContain("unverified estimate");
    expect(reference.mse).toBeDefined();
    expect(reference.value).toBeGreaterThan(0);
    expect(reference.value).toBeLessThanOrEqual(1);
  });
});
