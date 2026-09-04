/**
 * `seasonParamSets.ts`'s schema, resolver, and facade — plus Leg A of the
 * plan's `<equivalence_gate>` (D-4), the acceptance bar for the whole quick
 * task 260904-100: a UNIFORM `paramSetsBySeason`, synthesized from the
 * CURRENT committed incumbent, must reproduce that incumbent's committed
 * `predictionStreamSha256` BITWISE, through this facade — never against a
 * freshly computed baseline.
 *
 * Leg B (the real season-boundary differential) is added by Task 2, as its
 * own `describe` block in this same file.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeSigma1 } from "../core/algorithms/sigma1/index.js";
import { DEFAULT_SIGMA1_PARAMS, SIGMA1_CODE_VERSION } from "../core/algorithms/sigma1/params.js";
import type { AlgorithmModule, MatchResult } from "../core/algorithms/types.js";
import { openCorpusReadOnly, selectMatchesChronological, type Corpus } from "../corpus/db.js";
import type { DigestSliceFixture } from "./fixtures/extract-digest-slice.js";
import { computePredictionStreamDigest, PromotedVersionSchema, type PromotedVersion } from "./promote.js";
import { toLeakProofUpcoming, WalkForwardSimulator, type PredictionRecord } from "./replay.js";
import { seasonBoundaryFor } from "./seasonBoundary.js";
import { makeSeasonalSigma1, resolveParamSets, type SeasonParamSet } from "./seasonParamSets.js";

const CORPUS_PATH = "data/corpus.sqlite";
// Mirrors `tune.ts`'s `INCUMBENT_VERSION_PATH` for the same reason (quick
// task 260904-2i9): this is the D-T7 acceptance baseline, not the live pin,
// so it deliberately does NOT follow `promotedVersionPath.ts`'s re-pin to
// `rolling-2026-09`.
const INCUMBENT_VERSION_PATH = join("data", "algorithm-versions", `vpr@${SIGMA1_CODE_VERSION}+tuned-2026-08.json`);
const DIGEST_SLICE_FIXTURE_PATH = join("packages", "harness", "fixtures", "digest-slice.json");

// The CURRENT committed digest (D-4) — pinned as a LITERAL AND cross-checked
// below against the committed file's own `digest.predictionStreamSha256`, so
// neither a code change nor an edit to the version file can move the target
// (T-260904-01).
//
// Updated for `vpr@8.0.0+tuned-2026-08.json` (quick task 260904-6a1, Task 3):
// the file was re-promoted under the adjust-pinning model change, via
// `pnpm promote --from-version data/algorithm-versions/vpr@7.0.0+tuned-2026-08.json --name tuned-2026-08`
// — a real replay, never hand-typed.
const COMMITTED_DIGEST = "88ad64b02ec5214c4ba34e2af450478fb3afe951ad25ded1ae43667048ab386d";

const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);
const FIXTURE_AVAILABLE = existsSync(DIGEST_SLICE_FIXTURE_PATH);
const INCUMBENT_AVAILABLE = existsSync(INCUMBENT_VERSION_PATH);

function loadIncumbentFile(): PromotedVersion {
  const raw: unknown = JSON.parse(readFileSync(INCUMBENT_VERSION_PATH, "utf8"));
  return PromotedVersionSchema.parse(raw);
}

/** Same dual-source idiom `digest.test.ts` uses: corpus when present, the committed fixture otherwise. */
function resolveIncumbentSliceMatches(promoted: PromotedVersion): MatchResult[] | undefined {
  if (CORPUS_AVAILABLE) {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      return selectMatchesChronological(db, { year: promoted.digest.sliceSeason, excludeOffseason: true }).filter((match) =>
        promoted.digest.sliceEventKeys.includes(match.eventKey)
      );
    } finally {
      db.close();
    }
  }
  if (FIXTURE_AVAILABLE) {
    const fixture = JSON.parse(readFileSync(DIGEST_SLICE_FIXTURE_PATH, "utf8")) as DigestSliceFixture;
    if (
      fixture.sliceSeason === promoted.digest.sliceSeason &&
      fixture.sliceEventKeys.length === promoted.digest.sliceEventKeys.length &&
      fixture.sliceEventKeys.every((key) => promoted.digest.sliceEventKeys.includes(key))
    ) {
      return fixture.matches;
    }
  }
  return undefined;
}

/** Builds a uniform `paramSetsBySeason` version — the SAME set for every named season — from a legacy `params` source file. This is the D-4 equivalence gate's own input. */
function synthesizeUniformPromotedVersion(source: PromotedVersion, seasons: readonly number[]): PromotedVersion {
  if (source.params === undefined) throw new Error("test fixture: source has no params to synthesize from");
  const entry: SeasonParamSet = {
    params: source.params,
    selectedOnSeasons: [...(source.provenance.tuneSeasons ?? [])],
    sourceKind: "carried-version",
    sourceArtifact: source.provenance.searchArtifact ?? "(unknown)",
  };
  const paramSetsBySeason: Record<string, SeasonParamSet> = {};
  for (const season of seasons) paramSetsBySeason[String(season)] = entry;
  const { params: _omit, ...rest } = source;
  // Task 3 (quick task 260904-100): a "paramSetsBySeason" file FORBIDS
  // top-level provenance.searchArtifact/objective/tuneSeasons/adaptationMode/
  // objectiveAppliesToPromotedParams — strip them from the legacy source's
  // provenance (they now live on `entry` above, per season) before writing
  // the synthesized file's own minimal top-level provenance.
  const {
    searchArtifact: _searchArtifact,
    objective: _objective,
    tuneSeasons: _tuneSeasons,
    adaptationMode: _adaptationMode,
    objectiveAppliesToPromotedParams: _objectiveAppliesToPromotedParams,
    ...minimalProvenance
  } = rest.provenance;
  return PromotedVersionSchema.parse({ ...rest, provenance: minimalProvenance, paramSetsBySeason });
}

const DUMMY_DIGEST_HASH = "b".repeat(64);

/**
 * A structurally valid `PromotedVersion` base, decoupled from any real
 * committed file, for the pure schema/resolver behavior tests below.
 *
 * Task 3 (quick task 260904-100): a "params" file's top-level provenance
 * REQUIRES `searchArtifact`/`objective`/`tuneSeasons`, while a
 * "paramSetsBySeason" file FORBIDS them (they become ambiguous under a
 * per-season map) — so which provenance shape this builds depends on which
 * of `params`/`paramSetsBySeason` the caller asks for. A caller asking for
 * NEITHER (the "rejects a file carrying NEITHER" test) gets the minimal
 * shape, which is still correctly rejected by the exactly-one check.
 */
function baseFixture(overrides: { params?: unknown; paramSetsBySeason?: unknown } = {}): unknown {
  const provenance =
    "params" in overrides
      ? {
          searchArtifact: "reports/tune-fixture.json",
          corpusIdentity: "data/corpus.sqlite",
          promotedAt: "2026-09-04T00:00:00.000Z",
          objective: 0.17,
          tuneSeasons: [2022, 2023, 2024],
        }
      : {
          corpusIdentity: "data/corpus.sqlite",
          promotedAt: "2026-09-04T00:00:00.000Z",
        };
  return {
    id: "vpr",
    codeVersion: "9.9.9",
    paramSetName: "fixture",
    version: "9.9.9+fixture",
    provenance,
    digest: {
      sliceSeason: 2022,
      sliceEventKeys: ["2022alhu"],
      sliceMatchCount: 1,
      predictionStreamSha256: DUMMY_DIGEST_HASH,
      headlineMetrics: [],
    },
    ...("params" in overrides ? { params: overrides.params } : {}),
    ...("paramSetsBySeason" in overrides ? { paramSetsBySeason: overrides.paramSetsBySeason } : {}),
  };
}

describe("PromotedVersionSchema — exactly one of params / paramSetsBySeason (D-1/D-2)", () => {
  it("a params-only file (today's shape) still parses", () => {
    expect(() => PromotedVersionSchema.parse(baseFixture({ params: DEFAULT_SIGMA1_PARAMS }))).not.toThrow();
  });

  it("a paramSetsBySeason-only file parses", () => {
    const entry: SeasonParamSet = {
      params: DEFAULT_SIGMA1_PARAMS,
      selectedOnSeasons: [2019, 2020],
      sourceKind: "search-winner",
      sourceArtifact: "reports/fixture.json",
    };
    expect(() => PromotedVersionSchema.parse(baseFixture({ paramSetsBySeason: { "2022": entry } }))).not.toThrow();
  });

  it("rejects a file carrying BOTH params and paramSetsBySeason", () => {
    const entry: SeasonParamSet = {
      params: DEFAULT_SIGMA1_PARAMS,
      selectedOnSeasons: [],
      sourceKind: "carried-version",
      sourceArtifact: "x",
    };
    expect(() =>
      PromotedVersionSchema.parse(baseFixture({ params: DEFAULT_SIGMA1_PARAMS, paramSetsBySeason: { "2022": entry } }))
    ).toThrow(/exactly one/);
  });

  it("rejects a file carrying NEITHER", () => {
    expect(() => PromotedVersionSchema.parse(baseFixture())).toThrow(/exactly one/);
  });
});

describe("resolveParamSets", () => {
  it("a legacy params file resolves to the SAME set for every season, never throwing", () => {
    const promoted = PromotedVersionSchema.parse(baseFixture({ params: DEFAULT_SIGMA1_PARAMS })) as PromotedVersion;
    const resolved = resolveParamSets(promoted);
    expect(resolved.isUniform).toBe(true);
    expect(resolved.forSeason(2019).params).toEqual(DEFAULT_SIGMA1_PARAMS);
    expect(resolved.forSeason(2099).params).toEqual(DEFAULT_SIGMA1_PARAMS);
  });

  it("a paramSetsBySeason file resolves each covered season to its own recorded set", () => {
    const entry2022: SeasonParamSet = {
      params: DEFAULT_SIGMA1_PARAMS,
      selectedOnSeasons: [2019, 2020],
      sourceKind: "search-winner",
      sourceArtifact: "a.json",
    };
    const entry2023: SeasonParamSet = {
      params: DEFAULT_SIGMA1_PARAMS,
      selectedOnSeasons: [2022, 2023, 2024],
      sourceKind: "carried-version",
      sourceArtifact: "b.json",
    };
    const promoted = PromotedVersionSchema.parse(
      baseFixture({ paramSetsBySeason: { "2022": entry2022, "2023": entry2023 } })
    ) as PromotedVersion;
    const resolved = resolveParamSets(promoted);
    expect(resolved.isUniform).toBe(false);
    expect(resolved.seasons).toEqual([2022, 2023]);
    expect(resolved.forSeason(2022)).toEqual(entry2022);
    expect(resolved.forSeason(2023)).toEqual(entry2023);
  });

  it("throws, naming the season AND the covered set, for a season the map does not cover", () => {
    const entry: SeasonParamSet = {
      params: DEFAULT_SIGMA1_PARAMS,
      selectedOnSeasons: [],
      sourceKind: "carried-version",
      sourceArtifact: "a.json",
    };
    const promoted = PromotedVersionSchema.parse(baseFixture({ paramSetsBySeason: { "2022": entry } })) as PromotedVersion;
    expect(() => resolveParamSets(promoted).forSeason(2023)).toThrow(/2023/);
    expect(() => resolveParamSets(promoted).forSeason(2023)).toThrow(/2022/);
  });
});

describe("D-4 equivalence gate, Leg A: a uniform paramSetsBySeason reproduces the CURRENT committed digest bitwise", () => {
  if (!INCUMBENT_AVAILABLE) {
    it.skip(`skipped: ${INCUMBENT_VERSION_PATH} not found`, () => {});
    return;
  }

  const incumbent = loadIncumbentFile();

  it("the pinned literal agrees with the committed file's own digest.predictionStreamSha256 — neither can move independently", () => {
    expect(incumbent.digest.predictionStreamSha256).toBe(COMMITTED_DIGEST);
  });

  const matches = resolveIncumbentSliceMatches(incumbent);
  if (!matches) {
    it.skip(
      `skipped: neither ${CORPUS_PATH} nor a matching ${DIGEST_SLICE_FIXTURE_PATH} was found for the incumbent's recorded slice`,
      () => {}
    );
    return;
  }

  it("reproduces the committed digest through makeSeasonalSigma1 over a UNIFORM per-season map (the acceptance bar, D-4)", () => {
    // Every corpus season carries the SAME set — this is the equivalence
    // gate's whole point: the per-season machinery must be a faithful
    // generalisation of today's single-set replay, not a rewrite that
    // happens to run.
    const seasons = [2019, 2020, 2022, 2023, 2024, 2025, 2026];
    const uniform = synthesizeUniformPromotedVersion(incumbent, seasons);
    const algorithm = makeSeasonalSigma1(uniform, { id: uniform.id, linkMode: "predictive-variance" });
    const teams = Array.from(new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
    const simulator = new WalkForwardSimulator(matches);
    const records = simulator.run(algorithm, teams);
    expect(computePredictionStreamDigest(records)).toBe(COMMITTED_DIGEST);
  });

  it("the incumbent (its own legacy params shape) still reproduces its own digest through the same facade", () => {
    const algorithm = makeSeasonalSigma1(incumbent, { id: incumbent.id, linkMode: "predictive-variance" });
    const teams = Array.from(new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
    const simulator = new WalkForwardSimulator(matches);
    const records = simulator.run(algorithm, teams);
    expect(computePredictionStreamDigest(records)).toBe(COMMITTED_DIGEST);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// D-4 Leg B (Task 2): the season-boundary differential. Leg A above never
// crosses a season boundary (it replays a single-season slice), so it
// cannot exercise `carrySeason` dispatch or D-3's incoming-season fork. This
// is EVIDENCE for the boundary path, and is NOT a substitute for Leg A's
// committed-digest bar — Leg A is the bar (D-4). This loop deliberately
// lives ONLY in this test file: production code's three independent season
// loops (`cli.ts`, `tune.ts`, `publish.ts`) are never edited by this quick
// task (see `<findings>` item 1) — the facade under test is what makes that
// safe.
// ─────────────────────────────────────────────────────────────────────────

/** `tune.ts`'s `boundedSeasonStream` shape, reproduced here rather than imported (it is module-private): the season's own full chronological order, subset-filtered to its first `eventsLimit` event keys — never a re-derivation of chronological order. */
function boundedTwoEventStream(db: Corpus, season: number): MatchResult[] {
  const eventRows = db
    .prepare(`SELECT event_key FROM events WHERE year = ? AND is_offseason = 0 ORDER BY event_key ASC LIMIT 2`)
    .all(season) as { event_key: string }[];
  const allowedEvents = new Set(eventRows.map((row) => row.event_key));
  return selectMatchesChronological(db, { year: season, excludeOffseason: true }).filter((match) => allowedEvents.has(match.eventKey));
}

/**
 * The IDENTICAL boundary-threading shape `runSeasons`/`runBoundedSeasons` use
 * in production (`seasonBoundaryFor`, then `carrySeason` into the next
 * season's initial state) — confined to this test, per this block's own
 * header. Single-algorithm, since Leg B compares two SEPARATE single-module
 * replays rather than one shared-stream multi-algorithm run.
 */
function replayTwoSeasonsWithCarry(
  algorithm: AlgorithmModule<any>,
  seasons: readonly number[],
  streamsBySeason: ReadonlyMap<number, readonly MatchResult[]>
): PredictionRecord[] {
  const all: PredictionRecord[] = [];
  let state: unknown;
  for (const [seasonIdx, season] of seasons.entries()) {
    const boundary = seasonBoundaryFor(seasons, seasonIdx);
    const stream = streamsBySeason.get(season)!;
    const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));

    if (boundary.isColdStart) {
      state = algorithm.initState(teams);
    } else {
      if (!algorithm.carrySeason) {
        throw new Error(`replayTwoSeasonsWithCarry: algorithm "${algorithm.id}" has no carrySeason implementation`);
      }
      state = algorithm.carrySeason(state, boundary);
    }

    for (const match of stream) {
      const prediction = algorithm.predict(state, toLeakProofUpcoming(match));
      all.push({ match, prediction });
      state = algorithm.update(state, match);
    }
  }
  return all;
}

describe("D-4 equivalence gate, Leg B (evidence, not the bar): the season-boundary differential", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found — Leg B needs the real corpus to cross a real season boundary`, () => {});
    return;
  }
  if (!INCUMBENT_AVAILABLE) {
    it.skip(`skipped: ${INCUMBENT_VERSION_PATH} not found`, () => {});
    return;
  }

  it("replaying 2022 then 2023 (first 2 events each) through a plain makeSigma1 module and through the facade over a uniform map produces byte-identical prediction streams", () => {
    const incumbent = loadIncumbentFile();
    if (incumbent.params === undefined) throw new Error("test fixture: incumbent has no params");

    const seasons = [2022, 2023];
    const db = openCorpusReadOnly(CORPUS_PATH);
    let streamsBySeason: Map<number, MatchResult[]>;
    try {
      streamsBySeason = new Map(seasons.map((season) => [season, boundedTwoEventStream(db, season)]));
    } finally {
      db.close();
    }
    for (const season of seasons) {
      expect(streamsBySeason.get(season)!.length).toBeGreaterThan(0);
    }

    const plainModule = makeSigma1({
      id: "leg-b-plain",
      linkMode: "predictive-variance",
      params: incumbent.params,
      paramSetName: incumbent.paramSetName,
    });
    const plainRecords = replayTwoSeasonsWithCarry(plainModule, seasons, streamsBySeason);
    const plainDigest = computePredictionStreamDigest(plainRecords);

    const uniform = synthesizeUniformPromotedVersion(incumbent, seasons);
    const facadeModule = makeSeasonalSigma1(uniform, { id: "leg-b-facade", linkMode: "predictive-variance" });
    const facadeRecords = replayTwoSeasonsWithCarry(facadeModule, seasons, streamsBySeason);
    const facadeDigest = computePredictionStreamDigest(facadeRecords);

    // Leg B is EVIDENCE for the boundary path — see this block's own header.
    // Leg A (above) is the acceptance bar (D-4); this assertion must never be
    // read as a substitute for it.
    expect(facadeDigest).toBe(plainDigest);
  });
});
