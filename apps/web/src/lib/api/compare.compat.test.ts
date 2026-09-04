/**
 * Retired-key tolerance guard. `apps/web/src/lib/api/compare.ts` imports
 * `CompareArtifactSchema` straight from `packages/harness/pageArtifacts.ts` —
 * there is no separate client read schema — so a slice-field change there is a
 * live-site change in the same commit.
 *
 * History: the retired fixed tune/holdout split's `seasonLabel` was carried as
 * an OPTIONAL field (D-4, quick task 260903-krp) while live 5.0.0 artifacts
 * still carried the key, and this file proved the schema parsed both shapes.
 * The 2026-09-04 republish (epa@5.0.0 / vpr@8.0.0+rolling-2026-09b) removed
 * the last producer, and the field was then DELETED from `CompareSliceSchema`
 * outright, per the D-1 rule that the deletion rides the republish.
 *
 * What must stay true forever after: artifacts that PREDATE the deletion —
 * the committed `compare-*.json` fixtures are real examples, carrying
 * `seasonLabel` on every slice — must keep parsing, with the unknown retired
 * key stripped rather than rejected. That fails if anyone makes this schema
 * `.strict()`, which is exactly the regression this suite exists to catch.
 *
 * The fixture is a REAL committed `compare-*.json`, never a hand-built object
 * — a hand-built object would prove nothing about bytes that actually shipped.
 * Per the original guardrail, this file must never cause
 * `apps/web/src/routes/__fixtures__/compare-*.json` to be regenerated — it
 * only reads that fixture, never writes it.
 */
import { describe, expect, it } from "vitest";
import { CompareArtifactSchema, type CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import compare2022 from "../../routes/__fixtures__/compare-2022.json";

describe("CompareArtifactSchema — retired seasonLabel key tolerance", () => {
  it("the committed pre-deletion fixture really does carry the retired key on every slice (guards the premise, not the schema)", () => {
    const fixtureSlices = (compare2022 as { slices: Array<{ seasonLabel?: string }> }).slices;
    expect(fixtureSlices.length).toBeGreaterThan(0);
    expect(fixtureSlices.every((s) => s.seasonLabel !== undefined)).toBe(true);
  });

  it("parses an artifact carrying the retired key without error — the schema must never become .strict()", () => {
    expect(() => CompareArtifactSchema.parse(compare2022)).not.toThrow();
  });

  it("strips the retired key from the parsed object instead of reading it through", () => {
    const parsed = CompareArtifactSchema.parse(compare2022) as CompareArtifact;
    expect(parsed.slices.length).toBeGreaterThan(0);
    for (const slice of parsed.slices) {
      expect("seasonLabel" in slice).toBe(false);
    }
  });

  it("headlineEligible remains required and survives parsing unchanged", () => {
    const fixtureSlices = (compare2022 as { slices: Array<{ headlineEligible: boolean }> }).slices;
    const parsed = CompareArtifactSchema.parse(compare2022) as CompareArtifact;
    expect(parsed.slices.every((s) => typeof s.headlineEligible === "boolean")).toBe(true);
    expect(parsed.slices.map((s) => s.headlineEligible)).toEqual(fixtureSlices.map((s) => s.headlineEligible));
  });
});
