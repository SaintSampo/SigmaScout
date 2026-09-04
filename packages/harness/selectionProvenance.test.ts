import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SIGMA1_PARAMS, SIGMA1_CODE_VERSION } from "../core/algorithms/sigma1/params.js";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import { ALGORITHMS, applyPromotedOverrides } from "./cli.js";
import { PromotedVersionSchema } from "./promote.js";
import { resolvePublishAlgorithms } from "./publish.js";
import type { HarnessPredictionInput } from "./score.js";
import { aggregateScoresForRun, selectedOnSeasonsFor, vprSelectedOnSeasonsFromPath } from "./selectionProvenance.js";

/**
 * Read independently of `selectionProvenance.ts`'s own path construction —
 * this is what actually proves the module reads the SAME committed file
 * `cli.ts`/`publish.ts` load for `vpr`, rather than merely asserting a value
 * this test also computed the same (wrong) way.
 */
const INDEPENDENTLY_RESOLVED_VPR_VERSION_PATH = join(
  "data",
  "algorithm-versions",
  `vpr@${SIGMA1_CODE_VERSION}+tuned-2026-08.json`
);

function readCommittedVprProvenance() {
  const raw: unknown = JSON.parse(readFileSync(INDEPENDENTLY_RESOLVED_VPR_VERSION_PATH, "utf8"));
  return PromotedVersionSchema.parse(raw);
}

describe("selectedOnSeasonsFor", () => {
  it("vpr's selected-on seasons deep-equal the committed version file's own provenance.tuneSeasons, for EVERY season asked (today's legacy params file)", () => {
    const committed = readCommittedVprProvenance();
    const result = selectedOnSeasonsFor(["vpr"]);
    expect(result.vpr!(2019)).toEqual(committed.provenance.tuneSeasons);
    expect(result.vpr!(2026)).toEqual(committed.provenance.tuneSeasons);
  });

  it("opr, epa, and vpr-defaults — never-tuned baselines — come back with an explicit empty array each, not an omission", () => {
    const result = selectedOnSeasonsFor(["opr", "epa", "vpr-defaults"]);
    expect(result.opr!(2024)).toEqual([]);
    expect(result.epa!(2024)).toEqual([]);
    expect(result["vpr-defaults"]!(2024)).toEqual([]);
  });

  it("an unregistered algorithm id throws, naming the id", () => {
    expect(() => selectedOnSeasonsFor(["not-a-real-algorithm"])).toThrow(/not-a-real-algorithm/);
  });

  it("resolves the SAME version identity resolvePublishAlgorithms(undefined) resolves for vpr — guards against a second, drifting resolution", () => {
    const committed = readCommittedVprProvenance();
    const resolved = resolvePublishAlgorithms(undefined);
    const vprModule = resolved.find((m) => m.id === "vpr");
    expect(vprModule).toBeDefined();
    expect(vprModule!.version).toBe(committed.version);
  });

  /**
   * F-2 (quick task 260903-tk6): the `vpr-adapt` case that has never
   * existed. Written so it holds BOTH on a developer machine with a stale
   * `reports/tune-joint-on.json` (this checkout, 2026-09-03: the file
   * exists but its winner's params fail this code version's schema) AND in
   * CI where `reports/` is empty — it asserts the STRUCTURAL equivalence
   * `resolveOnSearchWinner`'s sharing guarantees, never a gitignored file's
   * presence.
   */
  it("vpr-adapt's selected-on set is non-empty IF AND ONLY IF applyPromotedOverrides actually resolves the search winner, not the untuned base", () => {
    const base = ALGORITHMS["vpr-adapt"];
    expect(base).toBeDefined();
    const [resolved] = applyPromotedOverrides([base!]);

    // The search-winner branch always builds with paramSetName
    // "tune-joint-on-winner" (`cli.ts`'s `applyPromotedOverrides`); the
    // untuned fallback keeps the base module's own "defaults-adapt" version
    // untouched. This is the one observable that distinguishes "the search
    // winner actually runs" from "vpr-adapt degraded to defaults."
    const isSearchWinnerRunning = resolved?.version === `${SIGMA1_CODE_VERSION}+tune-joint-on-winner`;

    // `season` is arbitrary and ignored by `vprAdaptSelectedOnSeasons` — a
    // search artifact is one set, selected on one window, not a per-season
    // governance to resolve.
    const selectedOnFn = selectedOnSeasonsFor(["vpr-adapt"])["vpr-adapt"];
    const selectedOn = selectedOnFn ? selectedOnFn(2022) : undefined;
    expect((selectedOn?.length ?? 0) > 0).toBe(isSearchWinnerRunning);
  });
});

describe("vprSelectedOnSeasonsFromPath — per-season provenance (D-1/D-2, quick task 260904-100)", () => {
  const tempDirs: string[] = [];

  function writeVersion(body: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "selection-provenance-per-season-"));
    tempDirs.push(dir);
    const path = join(dir, "version.json");
    writeFileSync(path, JSON.stringify(body), "utf8");
    return path;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function perSeasonFixture(): unknown {
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
          sourceArtifact: "reports/tune-joint-on-origin2022.json",
        },
        "2023": {
          params: DEFAULT_SIGMA1_PARAMS,
          selectedOnSeasons: [2022, 2023, 2024],
          sourceKind: "carried-version",
          sourceArtifact: "reports/tune-joint-off.json",
        },
      },
      provenance: {
        corpusIdentity: "data/corpus.sqlite",
        promotedAt: "2026-09-04T00:00:00.000Z",
      },
      digest: {
        sliceSeason: 2022,
        sliceEventKeys: ["2022alhu"],
        sliceMatchCount: 1,
        predictionStreamSha256: "c".repeat(64),
        headlineMetrics: [],
      },
    };
  }

  it("resolves each covered season to its OWN selectedOnSeasons — never a single flat list for both", () => {
    const path = writeVersion(perSeasonFixture());
    expect(vprSelectedOnSeasonsFromPath(path, 2022)).toEqual([2019, 2020]);
    expect(vprSelectedOnSeasonsFromPath(path, 2023)).toEqual([2022, 2023, 2024]);
  });

  it("throws, naming the season, for a season the per-season map does not cover — never []", () => {
    const path = writeVersion(perSeasonFixture());
    expect(() => vprSelectedOnSeasonsFromPath(path, 2026)).toThrow(/2026/);
  });

  it("returns [] for a missing file, mirroring applyPromotedOverrides' own fallback — the same condition, not a second one", () => {
    expect(vprSelectedOnSeasonsFromPath(join(tmpdir(), "definitely-does-not-exist-260904-100.json"), 2022)).toEqual([]);
  });
});

/**
 * F-1 (quick task 260903-tk6): direct coverage of `aggregateScoresForRun` —
 * the single derivation `cli.ts:777` and `publish.ts:1517/1998` used to
 * independently rebuild. Both assertions below live in ONE test so a single
 * command demonstrates the two reverts this task's SUMMARY records as
 * observed RED: narrowing the corpus-season source to the seasons the run
 * happens to be scoring (reddens the opr assertion), and replacing the
 * selected-on source with an all-empty map (reddens the vpr assertion).
 */
describe("aggregateScoresForRun", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-selection-provenance-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function event(overrides: Partial<CorpusEvent> = {}): CorpusEvent {
    return {
      eventKey: "2024casj",
      year: 2024,
      eventType: 0,
      isOffseason: false,
      startDate: "2024-03-01",
      name: "2024casj",
      week: null,
      country: null,
      stateProv: null,
      districtKey: null,
      ...overrides,
    };
  }

  function match(overrides: Partial<CorpusMatch> = {}): CorpusMatch {
    return {
      matchKey: "2024casj_qm1",
      eventKey: "2024casj",
      compLevel: "qm",
      matchNumber: 1,
      setNumber: 1,
      sortTime: 1_000,
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc4", "frc5", "frc6"],
      redSurrogates: [],
      blueSurrogates: [],
      redDqs: [],
      blueDqs: [],
      winner: "red",
      winnerImputed: false,
      redScore: 100,
      blueScore: 50,
      redRpEarned: 2,
      blueRpEarned: 0,
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
      ...overrides,
    };
  }

  function prediction(
    overrides: Partial<HarnessPredictionInput> & Pick<HarnessPredictionInput, "matchKey" | "season" | "algorithmId">
  ): HarnessPredictionInput {
    return {
      eventKey: "2024casj",
      compLevel: "qm",
      pRedWin: 0.6,
      predictedRedScore: 60,
      predictedBlueScore: 40,
      actualWinner: "red",
      isOffseason: false,
      isSurrogateAffected: false,
      ...overrides,
    };
  }

  it("corpusSeasons comes from the corpus (2022/2023 priors), not from the seasons the run scores; selectedOnSeasons comes from the registry, not a hand-built map — opr eligible, vpr ineligible on 2024", () => {
    upsertEvent(db, event({ eventKey: "2022prior", year: 2022 }));
    upsertMatch(db, match({ matchKey: "2022prior_qm1", eventKey: "2022prior" }));
    upsertEvent(db, event({ eventKey: "2023prior", year: 2023 }));
    upsertMatch(db, match({ matchKey: "2023prior_qm1", eventKey: "2023prior" }));
    upsertEvent(db, event({ eventKey: "2024casj", year: 2024 }));
    upsertMatch(db, match({ matchKey: "2024casj_qm1", eventKey: "2024casj" }));

    // The run's OWN predictions cover 2024 only — 2022/2023 exist in the
    // corpus as priors but are never scored by this call.
    const predictions: HarnessPredictionInput[] = [
      prediction({ matchKey: "2024casj_qm1", season: 2024, algorithmId: "opr" }),
      prediction({ matchKey: "2024casj_qm1", season: 2024, algorithmId: "vpr" }),
    ];

    const slices = aggregateScoresForRun(db, predictions, ["opr", "vpr"]);
    const combined = slices.filter((s) => s.compLevelView === "combined");

    const oprSlice = combined.find((s) => s.algorithmId === "opr" && s.season === 2024);
    const vprSlice = combined.find((s) => s.algorithmId === "vpr" && s.season === 2024);

    // opr: never tuned (selectedOn = []), and the CORPUS supplies two priors
    // (2022, 2023) even though the run scored one season — reddens if the
    // corpus-season source is narrowed to the run's own scored seasons.
    expect(oprSlice?.headlineEligible).toBe(true);
    // vpr: 2024 is inside the committed version file's provenance.tuneSeasons
    // — reddens if the selected-on source is replaced by an all-empty map.
    expect(vprSlice?.headlineEligible).toBe(false);
  });
});
