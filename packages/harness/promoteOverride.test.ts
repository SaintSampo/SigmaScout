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
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SIGMA1_PARAMS,
  SIGMA1_CODE_VERSION,
  SIGMA1_PARAM_KEYS,
  SIGMA1_REFERENCE_SCORE_VARIANCE,
  Sigma1ParamsSchema,
  type Sigma1Params,
} from "../core/algorithms/sigma1/params.js";
import {
  applyParamOverrides,
  loadFromVersionFile,
  parseParamOverrides,
  PromotedVersionSchema,
  resolvePromotionSourcePath,
  type PromotedVersion,
} from "./promote.js";

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
    // D-07: processNoiseEventBoundaryRel must strictly EXCEED
    // processNoiseWithinEventRel. The override itself is syntactically fine —
    // 1e-5 is a finite number for a known key — so this is precisely the
    // case that would slip through if the schema were not the gate.
    const overridden = applyParamOverrides(DEFAULT_SIGMA1_PARAMS, ["processNoiseEventBoundaryRel=1e-5"]);
    expect(overridden.processNoiseEventBoundaryRel).toBe(1e-5);
    expect(overridden.processNoiseEventBoundaryRel).toBeLessThan(overridden.processNoiseWithinEventRel);

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

/** A structurally valid `paramSetsBySeason` fixture — the per-season alternative to `promotedVersionFixture` above. */
function perSeasonPromotedVersionFixture(topLevelProvenanceExtras: Record<string, unknown> = {}): unknown {
  return {
    id: "vpr",
    codeVersion: "9.9.9",
    paramSetName: "fixture",
    version: "9.9.9+fixture",
    paramSetsBySeason: {
      "2022": {
        params: DEFAULT_SIGMA1_PARAMS,
        selectedOnSeasons: [2019, 2020],
        sourceKind: "search-winner",
        sourceArtifact: "reports/tune-fixture-2022.json",
      },
    },
    provenance: {
      corpusIdentity: "data/corpus.sqlite",
      promotedAt: "2026-09-04T00:00:00.000Z",
      ...topLevelProvenanceExtras,
    },
    digest: {
      sliceSeason: 2022,
      sliceEventKeys: ["2022alhu"],
      sliceMatchCount: 1,
      predictionStreamSha256: "d".repeat(64),
      headlineMetrics: [],
    },
  };
}

describe("PromotedVersionSchema — provenance shape by file kind (Task 3, quick task 260904-100)", () => {
  it("a paramSetsBySeason file with a MINIMAL top-level provenance (no searchArtifact/objective/tuneSeasons) parses", () => {
    expect(() => PromotedVersionSchema.parse(perSeasonPromotedVersionFixture())).not.toThrow();
  });

  it("REJECTS a paramSetsBySeason file that also carries top-level provenance.tuneSeasons", () => {
    expect(() => PromotedVersionSchema.parse(perSeasonPromotedVersionFixture({ tuneSeasons: [2022, 2023, 2024] }))).toThrow(
      /paramSetsBySeason.*must not carry/s
    );
  });

  it("REJECTS a paramSetsBySeason file that also carries top-level provenance.searchArtifact", () => {
    expect(() => PromotedVersionSchema.parse(perSeasonPromotedVersionFixture({ searchArtifact: "reports/x.json" }))).toThrow(
      /paramSetsBySeason.*must not carry/s
    );
  });

  it("REJECTS a paramSetsBySeason file that also carries top-level provenance.objective", () => {
    expect(() => PromotedVersionSchema.parse(perSeasonPromotedVersionFixture({ objective: 0.17 }))).toThrow(
      /paramSetsBySeason.*must not carry/s
    );
  });

  it("REQUIRES a params file to still carry searchArtifact/objective/tuneSeasons at the top level", () => {
    const missingTuneSeasons = promotedVersionFixture();
    delete (missingTuneSeasons as { provenance: Record<string, unknown> }).provenance.tuneSeasons;
    expect(() => PromotedVersionSchema.parse(missingTuneSeasons)).toThrow(/requires provenance/);
  });
});

/**
 * `--from-version` (quick task 260901-trz). Both halves tested PURELY — the
 * source-flag rule and the version-file reader take no corpus and run no
 * replay, so the only thing needing a full promotion is the digest, which
 * `digest.test.ts` already owns.
 */
describe("resolvePromotionSourcePath — exactly one source", () => {
  it("resolves --from to a search artifact", () => {
    expect(resolvePromotionSourcePath("reports/tune-tracer.json", undefined, undefined)).toEqual({
      kind: "search-artifact",
      path: "reports/tune-tracer.json",
    });
  });

  it("resolves --from-version to a committed version file", () => {
    expect(resolvePromotionSourcePath(undefined, "data/algorithm-versions/vpr@3.0.0+tuned-2026-08.json", undefined)).toEqual({
      kind: "version-file",
      path: "data/algorithm-versions/vpr@3.0.0+tuned-2026-08.json",
    });
  });

  it("resolves --adaptation to its matching joint-search log, still a search artifact", () => {
    expect(resolvePromotionSourcePath(undefined, undefined, "off").kind).toBe("search-artifact");
  });

  it("THROWS when BOTH are given — silently preferring one would make the committed lineage a coin flip", () => {
    expect(() => resolvePromotionSourcePath("reports/a.json", "data/algorithm-versions/b.json", undefined)).toThrow(
      /--from and --from-version are alternatives/
    );
    // Including the `--adaptation` shorthand, which fills in `--from`.
    expect(() => resolvePromotionSourcePath(undefined, "data/algorithm-versions/b.json", "on")).toThrow(
      /--from and --from-version are alternatives/
    );
  });

  it("THROWS when NEITHER is given", () => {
    expect(() => resolvePromotionSourcePath(undefined, undefined, undefined)).toThrow(/one of --from/);
  });
});

describe("loadFromVersionFile — provenance for a migrated promotion", () => {
  const tempDirs: string[] = [];
  function writeVersion(body: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "promote-fromversion-"));
    tempDirs.push(dir);
    const path = join(dir, "version.json");
    writeFileSync(path, JSON.stringify(body), "utf8");
    return path;
  }
  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  /** The FROZEN 3.0.0 shape — the retired `tracer-check` values, which satisfy every invariant without an override. */
  const LEGACY_PARAMS = {
    processNoiseWithinEvent: 0.5,
    processNoiseEventBoundary: 4,
    consistencyEwmaAlpha: 0.2,
    shrinkagePriorMatches: 8,
    minConsistencyVariance: 1,
    covEwmaAlpha: 0.1,
    covShrinkage: 0.3,
    linkC: 1,
    coldStartTeamTotal: 20,
    coldStartConsistencyVariance: 25,
    fallbackScoreSd: 25,
    consistencyCarryDecay: 0.5,
    carryMeanReversion: 0.4,
    carryLastYearWeight: 0.7,
    carryPriorYearWeight: 0.3,
    rpMonteCarloSeed: 42,
    rpMonteCarloDraws: 2000,
    adaptationEnabled: false,
    adaptationEwmaAlpha: 0.2,
    adaptationExponent: 0.5,
    adaptationMinFactor: 0.25,
    adaptationMaxFactor: 4,
    adaptationMinObservations: 3,
  };

  function legacyVersionFile(provenanceExtras: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "vpr",
      codeVersion: "3.0.0",
      paramSetName: "tuned-2026-08",
      version: "3.0.0+tuned-2026-08",
      params: LEGACY_PARAMS,
      provenance: {
        searchArtifact: "reports/tune-joint-off.json",
        corpusIdentity: "data/corpus.sqlite",
        promotedAt: "2026-09-01T00:00:00.000Z",
        objective: 0.17076606538105618,
        tuneSeasons: [2022, 2023, 2024],
        seed: 42,
        survivors: ["linkC", "covEwmaAlpha"],
        ...provenanceExtras,
      },
      digest: {
        sliceSeason: 2022,
        sliceEventKeys: ["2022alhu"],
        sliceMatchCount: 100,
        predictionStreamSha256: "a".repeat(64),
        headlineMetrics: [],
      },
    };
  }

  it("migrates a 3.0.0 file's params and records WHICH map it applied", () => {
    const source = loadFromVersionFile(writeVersion(legacyVersionFile()));

    expect(source.params.processNoiseWithinEventRel).toBeCloseTo(0.5 / SIGMA1_REFERENCE_SCORE_VARIANCE, 12);
    expect(source.provenance.derivedFromVersion).toBe("3.0.0+tuned-2026-08");
    // COMPOSED since 5.0.0 (D-V4): loadFromVersionFile chains the one-hop maps
    // rather than owning a 3-to-current map of its own, and records EVERY tag
    // so a reader can tell exactly which conversions ran.
    //
    // THREE hops since 7.0.0 (D-Y1, quick task 260903-750). The third was added
    // without touching the 3.x branch at all — `migrate4to5` composes through
    // `migrate6to7` internally — which is precisely the property the chained
    // design exists for, and precisely why the TAG has to be asserted rather
    // than assumed: a hop can now join the chain without any edit visible at
    // the call site, so this literal is the only thing that notices.
    expect(source.provenance.paramShapeMigration).toBe(
      "sigma1-3.0.0-absolute-to-4.0.0-scale-relative" +
        "+sigma1-4.0.0-shrinkage-to-5.0.0-variance-decomposition" +
        "+sigma1-6.0.0-variance-decomposition-to-7.0.0-recency-swing"
    );
  });

  it("sets objectiveAppliesToPromotedParams FALSE even with no --set-param — a stronger statement than the override case", () => {
    // The recorded objective was computed by a DIFFERENT code version on a
    // DIFFERENTLY-SHAPED parameter set. It does not describe the shipped set,
    // and that must be a machine-readable fact rather than something a reader
    // is expected to infer from `derivedFromVersion`.
    const source = loadFromVersionFile(writeVersion(legacyVersionFile()));
    expect(source.provenance.objectiveAppliesToPromotedParams).toBe(false);
  });

  it("carries the SEARCH lineage forward unchanged — it still honestly describes where the parameters came from", () => {
    const source = loadFromVersionFile(writeVersion(legacyVersionFile()));
    expect(source.provenance.searchArtifact).toBe("reports/tune-joint-off.json");
    expect(source.provenance.objective).toBe(0.17076606538105618);
    expect(source.provenance.tuneSeasons).toEqual([2022, 2023, 2024]);
    expect(source.provenance.seed).toBe(42);
    expect(source.provenance.survivors).toEqual(["linkC", "covEwmaAlpha"]);
  });

  it("carries a PRIOR promotion's paramOverrides/note forward — the linkC=0.5 correction must survive the migration", () => {
    // This is the failure `--from-version` exists to prevent: `linkC = 0.5`
    // lives only in the committed version file, and its explanation lives only
    // in that file's note. Dropping either on migration would leave a shipped
    // value unexplained the moment the source file is retired.
    const source = loadFromVersionFile(
      writeVersion(
        legacyVersionFile({
          paramOverrides: { linkC: 0.5 },
          note: "linkC re-selected post-estimator-change (D-Q2)",
          objectiveAppliesToPromotedParams: false,
        })
      )
    );
    expect(source.provenance.paramOverrides).toEqual({ linkC: 0.5 });
    expect(source.provenance.note).toContain("linkC re-selected");
  });

  it("promotes a CURRENT-shape file as-is, with no migration tag", () => {
    const current = {
      ...legacyVersionFile(),
      codeVersion: SIGMA1_CODE_VERSION,
      version: `${SIGMA1_CODE_VERSION}+tuned-2026-08`,
      params: DEFAULT_SIGMA1_PARAMS,
    };
    const source = loadFromVersionFile(writeVersion(current));
    expect(source.params).toEqual(DEFAULT_SIGMA1_PARAMS);
    expect(source.provenance.paramShapeMigration).toBeUndefined();
    // Still false: the objective was computed by a different code version.
    expect(source.provenance.objectiveAppliesToPromotedParams).toBe(false);
  });

  it("REFUSES a codeVersion it has no map for, rather than guessing at a shape it has never seen", () => {
    const future = { ...legacyVersionFile(), codeVersion: "99.0.0", version: "99.0.0+x" };
    expect(() => loadFromVersionFile(writeVersion(future))).toThrow(/parameter-shape map/);
  });
});
