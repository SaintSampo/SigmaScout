/**
 * Harness registry + promoted-version resolution tests (ALGO-05/ALGO-06).
 *
 * ALGO-06: `applyPromotedOverrides`/`loadPromotedVpr`/`loadSearchWinnerVpr`
 * are the D-13/D-14 link that makes `--algorithm vpr` mean the committed
 * PROMOTED version rather than the Phase-2-reproducing defaults. `digest.test.ts`
 * proves a promoted version reproduces its own digest; nothing there proves the
 * CLI actually LOADS it. A silent fallback to defaults would leave every digest
 * test green while every real run scored the wrong model — so each assertion
 * below is made against an observable (a version identity, or a differing
 * predict/update stream), never against the mere presence of an object.
 *
 * ALGO-05: the adaptation on/off MECHANISM is already proven in
 * `sigma1/params.test.ts` (adaptation-off bitwise identical, adaptation-on
 * differs). What is proven here is the layer above it — that the harness
 * REGISTRY exposes `vpr-adapt` and `vpr-defaults` as genuinely distinct
 * modules, which is what the ALGO-05 holdout comparison actually runs through.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ALGORITHMS, applyPromotedOverrides, loadPromotedVpr, loadSearchWinnerVpr } from "./cli.js";
import { makeSigma1, type Sigma1State } from "../core/algorithms/sigma1/index.js";
import { DEFAULT_SIGMA1_PARAMS, SIGMA1_CODE_VERSION, type Sigma1Params } from "../core/algorithms/sigma1/params.js";
import type { AlgorithmModule, MatchResult, UpcomingMatch } from "../core/algorithms/types.js";
import { resolveOnSearchWinner } from "./searchWinner.js";
import { PromotedVersionSchema } from "./promote.js";
import { PROMOTED_VPR_VERSION_PATH } from "./promotedVersionPath.js";

/**
 * The committed promoted version `applyPromotedOverrides` resolves for the
 * `vpr` id. This file IS committed (`.gitignore`'s `data/*` + negation), so
 * unlike `reports/tune-joint-on.json` it is always present, in CI included.
 *
 * READ from the pinned file's own `version` field (quick task 260904-2i9),
 * not derived or re-typed. This used to be DERIVED from `SIGMA1_CODE_VERSION`
 * plus a hardcoded `+tuned-2026-08` suffix (quick task 260903-5dp) — but the
 * pin's collapse to `promotedVersionPath.ts` moved the live param-set name to
 * `rolling-2026-09`, which made that hand-typed suffix wrong the same way a
 * hardcoded `5.0.0+...` literal was wrong before it. Reading the value the
 * pinned file itself declares means a future re-pin can never desync this
 * constant from what `applyPromotedOverrides` actually resolves — there is no
 * second copy of the identity left to go stale.
 *
 * What this test actually defends is UNWEAKENED by the change: the assertions
 * below are about the `+{paramSetName}` half — that `vpr-defaults` and
 * `vpr-adapt` resolve to DISTINCT identities and neither collides with the
 * promoted one — and those suffixes are still literal here. The promoted
 * half was never the thing under test; `digest.test.ts` is what pins a
 * committed version file's identity to the code that produced it.
 */
const PROMOTED_VERSION_IDENTITY = PromotedVersionSchema.parse(
  JSON.parse(readFileSync(PROMOTED_VPR_VERSION_PATH, "utf8"))
).version;
const DEFAULTS_VERSION_IDENTITY = `${SIGMA1_CODE_VERSION}+defaults`;
const ADAPT_VERSION_IDENTITY = `${SIGMA1_CODE_VERSION}+defaults-adapt`;

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function makeTempDir(prefix: string): string {
  tempDir = mkdtempSync(join(tmpdir(), prefix));
  return tempDir;
}

// --- fixtures ---------------------------------------------------------------
// Same shape as `sigma1/params.test.ts`'s own fixture, kept local rather than
// exported from there: a test fixture shared across packages would couple two
// suites' failure modes together.

function match(overrides: Partial<MatchResult> & Pick<MatchResult, "matchKey">): MatchResult {
  return {
    eventKey: overrides.matchKey.split("_")[0] ?? "2024test",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: [],
    blueTeams: [],
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    winner: "red",
    redScore: 0,
    blueScore: 0,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: false,
    scoreBreakdownRaw: null,
    eventType: 0,
    ...overrides,
  };
}

function rawBreakdown2024Uniform(perComponentValue: number): string {
  const side = {
    autoLeavePoints: perComponentValue,
    autoAmpNotePoints: perComponentValue,
    autoSpeakerNotePoints: perComponentValue,
    teleopAmpNotePoints: perComponentValue,
    teleopSpeakerNotePoints: perComponentValue,
    teleopSpeakerNoteAmplifiedPoints: perComponentValue,
    endGameOnStagePoints: perComponentValue,
    endGameParkPoints: perComponentValue,
    endGameHarmonyPoints: perComponentValue,
    endGameNoteInTrapPoints: perComponentValue,
    endGameSpotLightBonusPoints: perComponentValue,
    adjustPoints: perComponentValue,
    foulPoints: perComponentValue,
    // `rp/2024.ts`'s own Zod schema requires a DIFFERENT required-field set
    // than `breakdown/2024.ts`'s, and `update()` parses this same raw JSON
    // through both. Placeholder values: the RP pmf's CONTENT is asserted in
    // `rp/distribution.test.ts`, never here — this file only needs the pmf
    // to be emitted at all (the rpMonteCarloDraws restore proof).
    autoAmpNoteCount: 0,
    autoSpeakerNoteCount: 0,
    teleopAmpNoteCount: 0,
    teleopSpeakerNoteCount: 0,
    teleopSpeakerNoteAmplifiedCount: 0,
    endGameTotalStagePoints: 0,
    endGameRobot1: "None",
    endGameRobot2: "None",
    endGameRobot3: "None",
    coopertitionBonusAchieved: false,
    melodyBonusAchieved: false,
    ensembleBonusAchieved: false,
    melodyBonusThresholdCoop: 0,
    melodyBonusThresholdNonCoop: 0,
    ensembleBonusStagePointsThreshold: 0,
    ensembleBonusOnStageRobotsThreshold: 0,
  };
  return JSON.stringify({ red: side, blue: side });
}

function toUpcoming(m: MatchResult): UpcomingMatch {
  return {
    matchKey: m.matchKey,
    eventKey: m.eventKey,
    compLevel: m.compLevel,
    setNumber: m.setNumber,
    matchNumber: m.matchNumber,
    redTeams: m.redTeams,
    blueTeams: m.blueTeams,
    redSurrogates: m.redSurrogates,
    blueSurrogates: m.blueSurrogates,
    eventType: m.eventType,
  };
}

/**
 * The swinging per-component sequence from `params.test.ts`: large/small/large
 * so each team crosses `adaptationMinObservations` with a genuinely non-unit
 * mean squared normalized innovation. That is what gives `adaptationFactor`
 * room to diverge from exactly 1 — a flat sequence would leave adaptation-on
 * and adaptation-off identical and produce a false "not wired" reading.
 */
function swingingSequence(): MatchResult[] {
  const values = [10, 10, 80, 5, 80, 5];
  return values.map((value, i) =>
    match({
      matchKey: `2024eventa_qm${i + 1}`,
      eventKey: "2024eventa",
      redTeams: ["T1", "T2", "T3"],
      blueTeams: ["T4", "T5", "T6"],
      redScore: 13 * value,
      blueScore: 13 * value,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: rawBreakdown2024Uniform(value),
    })
  );
}

/**
 * Replays the swinging fixture through an arbitrary module and returns its
 * prediction stream. Comparing two modules' streams is the only way to observe
 * a Sigma1 module's params from outside: `makeSigma1` closes over `params`, so
 * `AlgorithmModule` exposes no params accessor by design (D-27 keeps the
 * contract plain data). Behaviour is the observable; the object is not.
 */
function predictionStream(algorithm: AlgorithmModule<unknown>): string {
  let state = algorithm.initState([]);
  const predictions: unknown[] = [];
  for (const m of swingingSequence()) {
    predictions.push(algorithm.predict(state, toUpcoming(m)));
    state = algorithm.update(state, m);
  }
  return JSON.stringify(predictions);
}

/** A schema-valid promoted-version object wrapping an arbitrary param set. */
function promotedVersionFile(paramSetName: string, params: Sigma1Params): string {
  return JSON.stringify({
    id: "vpr",
    codeVersion: "2.0.0",
    paramSetName,
    version: `2.0.0+${paramSetName}`,
    params,
    provenance: {
      searchArtifact: "reports/test.json",
      corpusIdentity: "data/corpus.sqlite",
      promotedAt: "2026-08-16T20:00:00.000Z",
      objective: 0.15,
      tuneSeasons: [2022, 2023, 2024],
    },
    digest: {
      sliceSeason: 2022,
      sliceEventKeys: ["test"],
      sliceMatchCount: 100,
      predictionStreamSha256: "0".repeat(64),
      headlineMetrics: [],
    },
  });
}

// --- ALGO-06: promoted version resolution -----------------------------------

describe("loadPromotedVpr (ALGO-06)", () => {
  it("returns undefined for a path that does not exist, rather than throwing — this is the documented fallback contract", () => {
    expect(loadPromotedVpr("vpr", join(tmpdir(), "definitely-not-a-real-version-file.json"))).toBeUndefined();
  });

  it("builds a module carrying the FILE's version identity, not the caller's default", () => {
    const dir = makeTempDir("promoted-identity-");
    const versionPath = join(dir, "version.json");
    writeFileSync(versionPath, promotedVersionFile("test-tuned", DEFAULT_SIGMA1_PARAMS));

    const loaded = loadPromotedVpr("vpr", versionPath);

    expect(loaded).toBeDefined();
    expect(loaded?.id).toBe("vpr");
    expect(loaded?.version).toBe(`${SIGMA1_CODE_VERSION}+test-tuned`);
  });

  it("threads the file's params into the module's actual predict/update path — a tuned file produces a DIFFERENT prediction stream than defaults", () => {
    const dir = makeTempDir("promoted-params-");
    const versionPath = join(dir, "version.json");
    // Perturb a field `params.test.ts` already proves is read by the replay
    // path, so a lack of difference can only mean the params were dropped.
    const tuned: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, processNoiseWithinEventRel: 5e-3 };
    writeFileSync(versionPath, promotedVersionFile("test-tuned", tuned));

    const loaded = loadPromotedVpr("vpr", versionPath);
    const untuned = makeSigma1({ id: "vpr", linkMode: "predictive-variance" });

    expect(loaded).toBeDefined();
    expect(predictionStream(loaded as AlgorithmModule<Sigma1State>)).not.toBe(
      predictionStream(untuned as AlgorithmModule<Sigma1State>)
    );
  });

  it("throws on a schema-invalid version file rather than silently falling back to defaults", () => {
    const dir = makeTempDir("promoted-malformed-");
    const versionPath = join(dir, "malformed.json");
    writeFileSync(versionPath, JSON.stringify({ id: "vpr", codeVersion: "2.0.0", params: {} }));

    expect(() => loadPromotedVpr("vpr", versionPath)).toThrow();
  });

  it("throws on a non-finite param value (D-13's finite discipline), never coercing it", () => {
    const dir = makeTempDir("promoted-nonfinite-");
    const versionPath = join(dir, "nonfinite.json");
    // NaN serializes to JSON `null`, which the schema must also reject.
    writeFileSync(versionPath, promotedVersionFile("bad", { ...DEFAULT_SIGMA1_PARAMS, processNoiseWithinEventRel: NaN }));

    expect(() => loadPromotedVpr("vpr", versionPath)).toThrow();
  });
});

describe("loadSearchWinnerVpr (ALGO-06 / D-06)", () => {
  /** A `tune.ts --stage joint` artifact whose winner fixes rpMonteCarloDraws to 0, exactly as the real search does for speed. */
  function searchArtifact(winnerIndex: number): string {
    return JSON.stringify({
      winnerIndex,
      candidates: [
        { index: 0, params: { ...DEFAULT_SIGMA1_PARAMS, rpMonteCarloDraws: 0 } },
        { index: 1, params: { ...DEFAULT_SIGMA1_PARAMS, rpMonteCarloDraws: 0, processNoiseWithinEventRel: 5e-4 } },
      ],
    });
  }

  it("returns undefined when the search artifact is absent — reports/ is gitignored, so this is the normal CI path", () => {
    expect(loadSearchWinnerVpr("vpr-adapt", join(tmpdir(), "no-such-search.json"), "w")).toBeUndefined();
  });

  it("returns undefined when winnerIndex names no candidate, rather than throwing or picking an arbitrary one", () => {
    const dir = makeTempDir("search-nowinner-");
    const artifactPath = join(dir, "search.json");
    writeFileSync(artifactPath, searchArtifact(999));

    expect(loadSearchWinnerVpr("vpr-adapt", artifactPath, "w")).toBeUndefined();
  });

  it("restores rpMonteCarloDraws to the versioned default — the loaded module EMITS an RP pmf, though its source artifact recorded 0 draws", () => {
    const dir = makeTempDir("search-draws-");
    const artifactPath = join(dir, "search.json");
    writeFileSync(artifactPath, searchArtifact(1));

    const loaded = loadSearchWinnerVpr("vpr-adapt", artifactPath, "tune-joint-on-winner");
    expect(loaded).toBeDefined();
    expect(loaded?.id).toBe("vpr-adapt");
    expect(loaded?.version).toBe(`${SIGMA1_CODE_VERSION}+tune-joint-on-winner`);

    // The restore is only observable through predict(): rpPmfForMatch
    // short-circuits to no pmf at 0 draws. A control module built with the
    // artifact's own un-restored 0 proves the assertion below can fail.
    const restored = loaded as AlgorithmModule<Sigma1State>;
    const control = makeSigma1({
      id: "vpr-adapt-control",
      linkMode: "predictive-variance",
      params: { ...DEFAULT_SIGMA1_PARAMS, rpMonteCarloDraws: 0 },
    });
    const upcoming = toUpcoming(swingingSequence()[0] as MatchResult);

    const restoredPrediction = restored.predict(restored.initState([]), upcoming);
    const controlPrediction = control.predict(control.initState([]), upcoming);

    expect(restoredPrediction.redRpPmf?.length ?? 0).toBeGreaterThan(0);
    expect(controlPrediction.redRpPmf?.length ?? 0).toBe(0);
    expect(DEFAULT_SIGMA1_PARAMS.rpMonteCarloDraws).toBeGreaterThan(0);
  });
});

/**
 * F-2 (quick task 260903-tk6): direct coverage of `searchWinner.ts`'s
 * `resolveOnSearchWinner` — the leaf-module resolution `loadSearchWinnerVpr`
 * above now wraps and `selectionProvenance.ts`'s `vprAdaptSelectedOnSeasons`
 * delegates to, so the two can never disagree about `vpr-adapt`.
 */
describe("resolveOnSearchWinner (F-2, quick task 260903-tk6)", () => {
  /** Same shape as `loadSearchWinnerVpr`'s own `searchArtifact` fixture above, with an optional top-level `seasons`. */
  function searchArtifactWithSeasons(winnerIndex: number, seasons: readonly number[] | undefined): string {
    return JSON.stringify({
      winnerIndex,
      candidates: [
        { index: 0, params: { ...DEFAULT_SIGMA1_PARAMS, rpMonteCarloDraws: 0 } },
        { index: 1, params: { ...DEFAULT_SIGMA1_PARAMS, rpMonteCarloDraws: 0, processNoiseWithinEventRel: 5e-4 } },
      ],
      ...(seasons !== undefined ? { seasons } : {}),
    });
  }

  it("an artifact carrying a top-level seasons field returns it verbatim", () => {
    const dir = makeTempDir("search-winner-seasons-");
    const artifactPath = join(dir, "search.json");
    writeFileSync(artifactPath, searchArtifactWithSeasons(1, [2022, 2023, 2024]));

    const resolved = resolveOnSearchWinner(artifactPath);
    expect(resolved).toBeDefined();
    expect(resolved?.seasons).toEqual([2022, 2023, 2024]);
  });

  it("an artifact omitting seasons returns a winner with seasons undefined, not a silent []", () => {
    const dir = makeTempDir("search-winner-no-seasons-");
    const artifactPath = join(dir, "search.json");
    writeFileSync(artifactPath, searchArtifactWithSeasons(1, undefined));

    const resolved = resolveOnSearchWinner(artifactPath);
    expect(resolved).toBeDefined();
    expect(resolved?.seasons).toBeUndefined();
  });

  it("a winner whose params fail this code version's schema returns undefined, exactly like an absent artifact", () => {
    const dir = makeTempDir("search-winner-stale-");
    const artifactPath = join(dir, "search.json");
    writeFileSync(
      artifactPath,
      JSON.stringify({
        winnerIndex: 0,
        candidates: [{ index: 0, params: { someRetiredFieldName: 1.5 } }],
        seasons: [2022, 2023, 2024],
      })
    );

    expect(resolveOnSearchWinner(artifactPath)).toBeUndefined();
  });
});

describe("applyPromotedOverrides (ALGO-06 / D-13 / D-14)", () => {
  it("swaps the vpr entry for the COMMITTED promoted version — `--algorithm vpr` does not silently mean untuned defaults", () => {
    const untuned = makeSigma1({ id: "vpr", linkMode: "predictive-variance" });
    expect(untuned.version).toBe(DEFAULTS_VERSION_IDENTITY);

    const [overridden] = applyPromotedOverrides([untuned]);

    expect(overridden?.version).toBe(PROMOTED_VERSION_IDENTITY);
    expect(overridden?.version).not.toBe(untuned.version);
    expect(overridden).not.toBe(untuned);
  });

  it("the swapped-in module's tuned params reach the predict/update path — its prediction stream differs from the untuned module's", () => {
    const untuned = makeSigma1({ id: "vpr", linkMode: "predictive-variance" });
    const [overridden] = applyPromotedOverrides([untuned]);

    expect(predictionStream(overridden as AlgorithmModule<Sigma1State>)).not.toBe(
      predictionStream(untuned as AlgorithmModule<Sigma1State>)
    );
  });

  it("leaves every non-vpr/non-vpr-adapt module referentially identical", () => {
    const opr = ALGORITHMS["opr"] as AlgorithmModule<unknown>;
    const epa = ALGORITHMS["epa"] as AlgorithmModule<unknown>;
    const defaults = ALGORITHMS["vpr-defaults"] as AlgorithmModule<unknown>;

    const result = applyPromotedOverrides([opr, epa, defaults]);

    expect(result[0]).toBe(opr);
    expect(result[1]).toBe(epa);
    expect(result[2]).toBe(defaults);
  });

  it("falls back to the passed-in vpr-adapt module when the on-search artifact is absent, preserving pre-override behaviour", () => {
    // reports/ is gitignored; when it is absent the adapt entry must survive
    // untouched. When it IS present the override fires and the module is
    // rebuilt — both are correct, so assert the invariant true either way:
    // the id is preserved and a module is always returned.
    const adapt = ALGORITHMS["vpr-adapt"] as AlgorithmModule<unknown>;
    const [result] = applyPromotedOverrides([adapt]);

    expect(result).toBeDefined();
    expect(result?.id).toBe("vpr-adapt");
  });

  // Test 5 (plan 07-16 Task 1, T-07-16-05): adjacency — `vpr` and
  // `vpr-adapt` do not collide. Applied to a registry containing BOTH, each
  // routes to its OWN branch (the published id to the committed version
  // file, the variant to the search-artifact loader), asserted by reading
  // each returned module's `.id` back rather than trusting call order or a
  // `startsWith`/substring test, which would resolve one into the other.
  it("routes vpr and vpr-adapt to their own distinct override branches without collision", () => {
    const baseVpr = makeSigma1({ id: "vpr", linkMode: "predictive-variance" });
    const baseAdapt = makeSigma1({ id: "vpr-adapt", linkMode: "predictive-variance" });

    const [overriddenVpr, overriddenAdapt] = applyPromotedOverrides([baseVpr, baseAdapt]);

    expect(overriddenVpr?.id).toBe("vpr");
    expect(overriddenAdapt?.id).toBe("vpr-adapt");
    // The published entry resolves the committed version pin (a real,
    // different version string); the adaptation entry either falls back to
    // its passed-in module (reports/ absent in CI) or resolves its own
    // search-artifact loader — never the published version's identity.
    expect(overriddenVpr?.version).toBe(PROMOTED_VERSION_IDENTITY);
    expect(overriddenAdapt?.version).not.toBe(PROMOTED_VERSION_IDENTITY);
  });

  it("is a pure mapping: it returns a new array and never mutates the one it was given", () => {
    const untuned = makeSigma1({ id: "vpr", linkMode: "predictive-variance" });
    const input = [untuned];

    const result = applyPromotedOverrides(input);

    expect(result).not.toBe(input);
    expect(input[0]).toBe(untuned);
    expect(input).toHaveLength(1);
  });
});

// --- ALGO-05: registry wiring for the on-vs-off comparison -------------------

describe("ALGORITHMS registry wiring (ALGO-05)", () => {
  const REQUIRED_IDS = [
    "opr",
    "epa",
    "vpr",
    "vpr-defaults",
    "vpr-seasonsd",
    "vpr-normalcdf",
    "vpr-adapt",
  ] as const;

  it.each(REQUIRED_IDS)("registers %s", (id) => {
    expect(ALGORITHMS[id]).toBeDefined();
  });

  it("every module's own .id matches the key it is registered under — a mismatch would mislabel a whole artifact's rows", () => {
    for (const [key, module] of Object.entries(ALGORITHMS)) {
      expect(module.id).toBe(key);
    }
  });

  it("vpr-defaults and vpr-adapt carry EXACTLY distinct version identities (D-13)", () => {
    // Exact equality, not `toContain`: "defaults-adapt" contains "defaults",
    // so a substring check would pass even if both ids resolved to the same
    // adaptation-on module — precisely the regression this test exists for.
    expect(ALGORITHMS["vpr-defaults"]?.version).toBe(DEFAULTS_VERSION_IDENTITY);
    expect(ALGORITHMS["vpr-adapt"]?.version).toBe(ADAPT_VERSION_IDENTITY);
    expect(ALGORITHMS["vpr-defaults"]?.version).not.toBe(ALGORITHMS["vpr-adapt"]?.version);
  });

  it("the registered vpr-adapt and vpr-defaults modules produce GENUINELY different prediction streams over one shared fixture — the on/off comparison is not scoring the same module twice", () => {
    const off = ALGORITHMS["vpr-defaults"] as AlgorithmModule<Sigma1State>;
    const on = ALGORITHMS["vpr-adapt"] as AlgorithmModule<Sigma1State>;

    expect(predictionStream(on)).not.toBe(predictionStream(off));
  });

  it("both registered modules are individually reproducible — a differing stream above is adaptation, never run-to-run noise", () => {
    const off = ALGORITHMS["vpr-defaults"] as AlgorithmModule<Sigma1State>;
    const on = ALGORITHMS["vpr-adapt"] as AlgorithmModule<Sigma1State>;

    expect(predictionStream(off)).toBe(predictionStream(off));
    expect(predictionStream(on)).toBe(predictionStream(on));
  });
});
