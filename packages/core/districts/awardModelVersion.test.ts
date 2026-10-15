/**
 * THE AWARD MODEL VERSION PIN (quick task 261014-qje, Q-13).
 *
 * A published district artifact names the award model its `awardProfile`
 * counts were derived for (`awardModelVersion`). That name is only honest if
 * the model behind it cannot change silently. This test hashes everything the
 * slate prices from (the slot map, the declared season award lists, the point
 * values and the measured tables) and pins the digest beside the version.
 *
 * A CHANGE TO ANY OF THEM MUST BUMP `DISTRICT_AWARD_MODEL_VERSION` AND RE PIN
 * THE DIGEST HERE, TOGETHER, IN ONE COMMIT. Re pinning the digest alone, with
 * the version left where it was, is exactly the silent change this test exists
 * to stop.
 *
 * Serialisation is canonical: maps become entry lists sorted by key, object
 * keys are sorted, so the digest reads the values and never the source order.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DISTRICT_POINT_AWARD_VALUES } from "./awardBaseRates.js";
import { AWARD_SLATE_TABLES, DISTRICT_AWARD_MODEL_VERSION, SEASON_AWARD_TYPES, TYPE_SLOT } from "./awardSlate.js";

/** The version and its digest, pinned together. */
const PINNED = { version: "2.0.0", digest: "c4a2a920fd475cf6fd358f0f098a2793980868226d0417123c97faef2db32c89" } as const;

function canonical(value: unknown): unknown {
  if (value instanceof Map) {
    return [...value.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, entry]) => [key, canonical(entry)]);
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

function awardModelDigest(): string {
  const payload = JSON.stringify(
    canonical({
      typeSlot: TYPE_SLOT,
      seasonAwardTypes: SEASON_AWARD_TYPES,
      districtPointAwardValues: DISTRICT_POINT_AWARD_VALUES,
      awardSlateTables: AWARD_SLATE_TABLES,
    })
  );
  return createHash("sha256").update(payload).digest("hex");
}

describe("DISTRICT_AWARD_MODEL_VERSION (quick task 261014-qje, Q-13)", () => {
  it("is the pinned version", () => {
    expect(DISTRICT_AWARD_MODEL_VERSION).toBe(PINNED.version);
  });

  it("the slot map, season award lists, point values and slate tables hash to the digest pinned beside the version", () => {
    const digest = awardModelDigest();
    expect(digest, `award model digest ${digest}: a table change must bump DISTRICT_AWARD_MODEL_VERSION and re pin both`).toBe(PINNED.digest);
  });

  it("the digest reads values, not source order", () => {
    const reordered = new Map([...TYPE_SLOT.entries()].reverse());
    expect(JSON.stringify(canonical(reordered))).toBe(JSON.stringify(canonical(TYPE_SLOT)));
  });
});
