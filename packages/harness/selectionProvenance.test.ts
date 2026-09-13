import { mkdtempSync, rmSync } from "node:fs";
import { PUBLISHED_ALGORITHM_IDS } from "./publishedAlgorithms.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import { BASE_PUBLISH_ALGORITHMS, resolvePublishAlgorithms } from "./publish.js";
import type { HarnessPredictionInput } from "./score.js";
import { aggregateScoresForRun, selectedOnSeasonsFor } from "./selectionProvenance.js";

describe("selectedOnSeasonsFor", () => {
  it("opr, epa, and spr — never-tuned algorithms — come back with an explicit empty array each, not an omission", () => {
    const result = selectedOnSeasonsFor(["opr", "epa", "spr"]);
    expect(result.opr!(2024)).toEqual([]);
    expect(result.epa!(2024)).toEqual([]);
    expect(result.spr!(2024)).toEqual([]);
  });

  it("registers a source for exactly the harness registry's ids", () => {
    expect(Object.keys(BASE_PUBLISH_ALGORITHMS)).toEqual(["opr", "epa", "spr"]);
    expect(Object.keys(selectedOnSeasonsFor(Object.keys(BASE_PUBLISH_ALGORITHMS)))).toEqual(["opr", "epa", "spr"]);
  });

  it("an unregistered algorithm id throws, naming the id", () => {
    expect(() => selectedOnSeasonsFor(["not-a-real-algorithm"])).toThrow(/not-a-real-algorithm/);
  });

  // Quick task 260913-it4 deleted the retired Sigma1 core together with its
  // registry entries, so its retired id must now be unregistered rather than
  // silently answering [].
  it("the retired vpr id is unregistered and throws, naming the id", () => {
    expect(() => selectedOnSeasonsFor(["vpr"])).toThrow(/"vpr"/);
  });

  it("publishing resolves exactly the published ids and never the retired vpr id", () => {
    const resolved = resolvePublishAlgorithms(undefined);
    expect(resolved.some((m) => m.id === "vpr")).toBe(false);
    expect(resolved.map((m) => m.id)).toEqual([...PUBLISHED_ALGORITHM_IDS]);
  });
});

/**
 * F-1 (quick task 260903-tk6): direct coverage of `aggregateScoresForRun` —
 * the single derivation two orchestrations used to independently
 * rebuild. The corpus-season assertion reddens if the corpus-season source is
 * narrowed to the seasons the run happens to be scoring; the unregistered-id
 * assertion reddens if the selected-on source stops being this module's
 * registry.
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
      videoKey: null,
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
      isColdStart: false,
      ...overrides,
    };
  }

  it("corpusSeasons comes from the corpus (2022/2023 priors), not from the seasons the run scores; selectedOnSeasons comes from the registry, not a hand-built map", () => {
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
      prediction({ matchKey: "2024casj_qm1", season: 2024, algorithmId: "spr" }),
    ];

    const slices = aggregateScoresForRun(db, predictions, ["opr", "spr"]);
    const combined = slices.filter((s) => s.compLevelView === "combined");

    // Never tuned (selectedOn = []), and the CORPUS supplies two priors
    // (2022, 2023) even though the run scored one season — reddens if the
    // corpus-season source is narrowed to the run's own scored seasons.
    expect(combined.find((s) => s.algorithmId === "opr" && s.season === 2024)?.headlineEligible).toBe(true);
    expect(combined.find((s) => s.algorithmId === "spr" && s.season === 2024)?.headlineEligible).toBe(true);

    // The selected-on source is the registry: an id it does not register
    // throws, naming the id, where a hand-built all-empty map would pass.
    expect(() =>
      aggregateScoresForRun(db, [prediction({ matchKey: "2024casj_qm1", season: 2024, algorithmId: "not-registered" })], ["not-registered"])
    ).toThrow(/not-registered/);
  });
});
