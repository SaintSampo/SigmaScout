/**
 * D-4 (quick task 260903-krp) compatibility guard. `apps/web/src/lib/api/compare.ts`
 * imports `CompareArtifactSchema` straight from `packages/harness/pageArtifacts.ts`
 * — there is no separate client read schema — so a required-field change to
 * `CompareSliceSchema` is a live-site change in the same commit. This suite
 * proves the schema parses BOTH shapes the live deploy can encounter:
 *
 *   - TODAY's published 5.0.0 artifacts, which carry `seasonLabel` on every
 *     slice (the retired fixed tune/holdout split);
 *   - the post-republish shape, which omits it entirely, since
 *     `aggregateScores` no longer produces the field (quick task 260903-krp).
 *
 * Bidirectional, not merely "doesn't crash": the present-key case must still
 * round-trip the key through parsing (tolerance means optional, not
 * stripped) and the absent-key case must parse cleanly too.
 *
 * The first case is built from a REAL committed `compare-*.json` fixture,
 * never a hand-built object — a hand-built object would prove nothing about
 * the bytes actually in production. The second case is a structural clone of
 * that SAME fixture with the key deleted, so the two cases can never drift
 * apart from each other. Per this task's own guardrail, this file must never
 * cause `apps/web/src/routes/__fixtures__/compare-*.json` to be regenerated —
 * it only reads that fixture, never writes it.
 */
import { describe, expect, it } from "vitest";
import { CompareArtifactSchema, type CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import compare2022 from "../../routes/__fixtures__/compare-2022.json";

/** A structural clone of `artifact` with `seasonLabel` deleted from every slice — the post-republish shape. */
function withoutSeasonLabel(artifact: unknown): unknown {
  const clone = structuredClone(artifact) as { slices: Array<Record<string, unknown>> };
  for (const slice of clone.slices) {
    delete slice.seasonLabel;
  }
  return clone;
}

describe("CompareArtifactSchema — D-4 bidirectional seasonLabel compatibility", () => {
  it("parses a committed 5.0.0 fixture, which carries seasonLabel on every slice, without error", () => {
    expect(() => CompareArtifactSchema.parse(compare2022)).not.toThrow();
  });

  it("carries seasonLabel through parsing when present — tolerance means optional, never stripped", () => {
    const fixtureSlices = (compare2022 as { slices: Array<{ seasonLabel?: string }> }).slices;
    expect(fixtureSlices.length).toBeGreaterThan(0);
    expect(fixtureSlices.every((s) => s.seasonLabel !== undefined)).toBe(true);

    const parsed = CompareArtifactSchema.parse(compare2022) as CompareArtifact;
    expect(parsed.slices).toHaveLength(fixtureSlices.length);
    for (let i = 0; i < parsed.slices.length; i++) {
      expect(parsed.slices[i]!.seasonLabel).toBe(fixtureSlices[i]!.seasonLabel);
    }
  });

  it("parses the same fixture with seasonLabel deleted from every slice — the post-republish shape — without error", () => {
    const postRepublishShape = withoutSeasonLabel(compare2022);
    expect(() => CompareArtifactSchema.parse(postRepublishShape)).not.toThrow();

    const parsed = CompareArtifactSchema.parse(postRepublishShape) as CompareArtifact;
    expect(parsed.slices.length).toBeGreaterThan(0);
    for (const slice of parsed.slices) {
      expect(slice.seasonLabel).toBeUndefined();
    }
  });

  it("headlineEligible remains required and is unaffected by seasonLabel's presence or absence", () => {
    const withLabel = CompareArtifactSchema.parse(compare2022) as CompareArtifact;
    const withoutLabel = CompareArtifactSchema.parse(withoutSeasonLabel(compare2022)) as CompareArtifact;

    expect(withLabel.slices.every((s) => typeof s.headlineEligible === "boolean")).toBe(true);
    expect(withoutLabel.slices.map((s) => s.headlineEligible)).toEqual(withLabel.slices.map((s) => s.headlineEligible));
  });
});
