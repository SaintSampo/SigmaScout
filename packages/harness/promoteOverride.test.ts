/**
 * `promote.ts`'s `--set-param` override mechanism (quick task 260901-is2
 * Task 4, D-Q2's delivery vehicle for `linkC = 0.5`).
 *
 * Deliberately a SEPARATE file from `digest.test.ts`, which owns the
 * corpus-backed reproducibility gate and is expensive: everything here is
 * pure (no corpus, no replay, no filesystem), which is the whole reason
 * `applyParamOverrides`/`parseParamOverrides` are exported at all — `main`
 * is not exported, so without that boundary the only way to exercise a
 * typo'd `--set-param` key would be a full corpus run.
 *
 * The property this file exists to pin is NOT "the merge works". It is that
 * the override cannot construct a parameter set that would be invalid to
 * ship: an unknown key, a non-finite number, or a cross-parameter invariant
 * violation each fails before anything is written, and every override that
 * IS applied is recorded in the committed file's provenance in
 * machine-readable form.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGMA1_PARAMS, SIGMA1_PARAM_KEYS, Sigma1ParamsSchema, type Sigma1Params } from "../core/algorithms/sigma1/params.js";
import { applyParamOverrides, parseParamOverrides, PromotedVersionSchema, type PromotedVersion } from "./promote.js";

/** A structurally valid promoted-version file, used to prove the three new provenance fields are additive. */
function promotedVersionFixture(provenanceExtras: Record<string, unknown> = {}): unknown {
  return {
    id: "vpr",
    codeVersion: "9.9.9",
    paramSetName: "fixture",
    version: "9.9.9+fixture",
    params: DEFAULT_SIGMA1_PARAMS,
    provenance: {
      searchArtifact: "reports/tune-fixture.json",
      corpusIdentity: "data/corpus.sqlite",
      promotedAt: "2026-09-01T00:00:00.000Z",
      objective: 0.17,
      tuneSeasons: [2022, 2023, 2024],
      ...provenanceExtras,
    },
    digest: {
      sliceSeason: 2022,
      sliceEventKeys: ["2022alhu"],
      sliceMatchCount: 265,
      predictionStreamSha256: "a".repeat(64),
      headlineMetrics: [{ season: 2022, brierScore: 0.17, winnerAccuracy: 0.69 }],
    },
  };
}

describe("applyParamOverrides", () => {
  it("changes exactly the named field and leaves every other parameter untouched", () => {
    const result = applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["linkC=0.5"]);

    expect(result.linkC).toBe(0.5);
    // Deep-equal on the rest: rebuilding the input from the result by
    // restoring only `linkC` must reproduce the input exactly, which is a
    // stronger statement than spot-checking a few neighbouring fields.
    expect({ ...result, linkC: DEFAULT_SIGMA1_PARAMS.linkC }).toEqual(DEFAULT_SIGMA1_PARAMS);
    // The input is not mutated — `promote.ts` still reports the search
    // winner's own values elsewhere in provenance.
    expect(DEFAULT_SIGMA1_PARAMS.linkC).not.toBe(0.5);
  });

  it("applies two repeated --set-param specs, both of them", () => {
    const result = applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["linkC=0.5", "covShrinkage=0.4"]);

    expect(result.linkC).toBe(0.5);
    expect(result.covShrinkage).toBe(0.4);
    expect({ ...result, linkC: DEFAULT_SIGMA1_PARAMS.linkC, covShrinkage: DEFAULT_SIGMA1_PARAMS.covShrinkage }).toEqual(
      DEFAULT_SIGMA1_PARAMS
    );
  });

  it("applies the LAST spec when the same key is given twice (a repeated flag is not an error, but is not ambiguous either)", () => {
    expect(applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["linkC=0.5", "linkC=0.7"]).linkC).toBe(0.7);
  });

  it("throws on an unknown key, naming the key and listing the valid ones", () => {
    expect(() => applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["linkCc=0.5"])).toThrow(/linkCc/);
    // The message lists the valid keys, so a typo is self-correcting at the
    // terminal rather than sending the operator to read params.ts.
    expect(() => applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["linkCc=0.5"])).toThrow(/linkC\b/);
  });

  it("throws on a spec with no `=`, or with an empty key", () => {
    expect(() => applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["linkC"])).toThrow(/key=value/);
    expect(() => applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["=0.5"])).toThrow(/key=value/);
  });

  it("throws on a non-numeric, NaN, Infinity, or empty value for a numeric parameter", () => {
    expect(() => applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["linkC=abc"])).toThrow(/finite number/);
    expect(() => applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["linkC=NaN"])).toThrow(/finite number/);
    expect(() => applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["linkC=Infinity"])).toThrow(/finite number/);
    // `Number("")` is 0, so an empty value would otherwise be silently
    // promoted into a real parameter value rather than rejected.
    expect(() => applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["linkC="])).toThrow(/empty value/);
  });

  it("accepts only true/false for the one boolean parameter", () => {
    expect(applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["adaptationEnabled=true"]).adaptationEnabled).toBe(true);
    expect(applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["adaptationEnabled=false"]).adaptationEnabled).toBe(false);
    // `1` is the coercion that would quietly turn a MODE into a number —
    // `Sigma1ParamsSchema` would catch it downstream, but the operator
    // deserves the error at the flag, naming the flag.
    expect(() => applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["adaptationEnabled=1"])).toThrow(/boolean parameter/);
    expect(() => applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["adaptationEnabled=yes"])).toThrow(/boolean parameter/);
  });

  it("reads boolean-ness from DEFAULT_SIGMA1_PARAMS rather than a hand-typed list, so a second boolean parameter cannot be left behind", () => {
    // Not a restatement of the implementation: it pins the FACT the
    // implementation depends on — that exactly one parameter is boolean
    // today. If a second one is added, this assertion fails and the author
    // is sent to re-read the boolean branch above.
    const booleanKeys = SIGMA1_PARAM_KEYS.filter((key) => typeof DEFAULT_SIGMA1_PARAMS[key] === "boolean");
    expect(booleanKeys).toEqual(["adaptationEnabled"]);
  });
});

describe("applyParamOverrides + Sigma1ParamsSchema (the invariant boundary)", () => {
  it("cannot construct an invalid parameter set: a cross-parameter invariant violation is rejected by the schema, not written", () => {
    // D-07: processNoiseEventBoundary must strictly EXCEED
    // processNoiseWithinEvent. The override itself is syntactically fine —
    // 0.1 is a finite number for a known key — so this is precisely the
    // case that would slip through if the schema were not the gate.
    const overridden = applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["processNoiseEventBoundary=0.1"]);
    expect(overridden.processNoiseEventBoundary).toBe(0.1);
    expect(overridden.processNoiseEventBoundary).toBeLessThan(overridden.processNoiseWithinEvent);

    expect(() => Sigma1ParamsSchema.parse(overridden)).toThrow(/D-07/);
  });

  it("a legitimate override still parses cleanly through the schema", () => {
    const overridden = applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["linkC=0.5"]);
    const parsed: Sigma1Params = Sigma1ParamsSchema.parse(overridden);
    expect(parsed.linkC).toBe(0.5);
  });
});

describe("parseParamOverrides (the provenance record)", () => {
  it("returns the same values it applies, typed as number or boolean", () => {
    expect(parseParamOverrides(["linkC=0.5", "adaptationEnabled=true"])).toEqual({ linkC: 0.5, adaptationEnabled: true });
  });

  it("returns an empty record for no specs", () => {
    expect(parseParamOverrides([])).toEqual({});
  });
});

describe("PromotedVersionSchema provenance shape", () => {
  it("validates a file with NO override fields — every already-committed version file keeps parsing", () => {
    const parsed: PromotedVersion = PromotedVersionSchema.parse(promotedVersionFixture());
    expect(parsed.provenance.paramOverrides).toBeUndefined();
    expect(parsed.provenance.note).toBeUndefined();
    expect(parsed.provenance.objectiveAppliesToPromotedParams).toBeUndefined();
  });

  it("validates a file carrying all three override fields", () => {
    const parsed = PromotedVersionSchema.parse(
      promotedVersionFixture({
        paramOverrides: { linkC: 0.5 },
        note: "linkC re-selected post-estimator-change",
        objectiveAppliesToPromotedParams: false,
      })
    );
    expect(parsed.provenance.paramOverrides).toEqual({ linkC: 0.5 });
    expect(parsed.provenance.note).toBe("linkC re-selected post-estimator-change");
    expect(parsed.provenance.objectiveAppliesToPromotedParams).toBe(false);
  });

  it("rejects an empty provenance note — an unexplained divergence must not be representable", () => {
    expect(() =>
      PromotedVersionSchema.parse(
        promotedVersionFixture({ paramOverrides: { linkC: 0.5 }, note: "", objectiveAppliesToPromotedParams: false })
      )
    ).toThrow();
  });

  it("rejects a non-number, non-boolean override value", () => {
    expect(() =>
      PromotedVersionSchema.parse(
        promotedVersionFixture({ paramOverrides: { linkC: "0.5" }, note: "x", objectiveAppliesToPromotedParams: false })
      )
    ).toThrow();
  });
});
