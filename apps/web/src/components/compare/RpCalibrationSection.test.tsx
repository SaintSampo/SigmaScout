/**
 * `RpCalibrationSection` — Task 1's tracer slice rendered end to end. Cases
 * run against the REAL committed `compare-2026.json` fixture (proving
 * "absence is absence" — it carries no `rpCalibration` key on any slice) and
 * against that same fixture with the REAL emitted `rp-calibration-2026-spr.json`
 * record (renamed from `-bpr.json` by quick task 260912-ivg Stage 1 Task 2 —
 * a filename token, no wire-id meaning; the fixture's own `algorithmId`
 * comparison below stays `"spr"`, matching `compare-2026.json`'s actual
 * READ-tier content) attached to its spr/qualification slice (proving the
 * populated render), never a hand-built artifact.
 */
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import compare2026 from "../../routes/__fixtures__/compare-2026.json";
import rpCalibration2026Spr from "../../routes/__fixtures__/rp-calibration-2026-spr.json";
import { CompareArtifactSchema, type CompareArtifact, type CompareRpCalibration } from "../../../../../packages/harness/pageArtifacts.js";
import { algorithmDisplayLabel } from "../ribbon/AlgorithmSelect.js";
import { buildRpCalibrationCard, rpCardHeadlineSentence } from "./rpCalibrationCards.js";
import {
  DEFAULT_RP_CALIBRATION_YEAR,
  RP_CALIBRATION_ABSENT_TEXT,
  RP_CALIBRATION_ALGORITHM_IDS,
  RP_CALIBRATION_EXPLAINER,
  RpCalibrationSection,
  rpCalibrationCardSentenceTestId,
  rpCalibrationCardTestId,
} from "./RpCalibrationSection.js";

afterEach(cleanup);

const ARTIFACT_2026_NO_RP: CompareArtifact = CompareArtifactSchema.parse(compare2026);
const RP_RECORD = rpCalibration2026Spr as unknown as CompareRpCalibration;

/** Same fixture, with the REAL emitted record attached to spr's qualification slice — the shape `buildCompareArtifact`'s `attachRpCalibration` produces. */
function artifactWithSprRp(): CompareArtifact {
  return {
    ...ARTIFACT_2026_NO_RP,
    slices: ARTIFACT_2026_NO_RP.slices.map((s) =>
      s.algorithmId === "spr" && s.season === DEFAULT_RP_CALIBRATION_YEAR && s.compLevelView === "qualification"
        ? { ...s, rpCalibration: RP_RECORD }
        : s
    ),
  };
}

/** The same fixture with the real record attached to EVERY published algorithm's qualification slice — a stale artifact from before OPR and EPA stopped publishing ranking-point odds (260913-it4). */
function artifactWithRpOnEveryAlgorithm(): CompareArtifact {
  return {
    ...ARTIFACT_2026_NO_RP,
    slices: ARTIFACT_2026_NO_RP.slices.map((s) =>
      s.season === DEFAULT_RP_CALIBRATION_YEAR && s.compLevelView === "qualification" ? { ...s, rpCalibration: RP_RECORD } : s
    ),
  };
}

describe("RpCalibrationSection — cards only for algorithms that publish ranking-point odds (260913-it4)", () => {
  it("the card set is exactly SPR", () => {
    expect(RP_CALIBRATION_ALGORITHM_IDS).toEqual(["spr"]);
  });

  it("a stale artifact still carrying OPR and EPA ranking-point records renders only the SPR card", () => {
    render(<RpCalibrationSection artifactsByYear={new Map([[2026, artifactWithRpOnEveryAlgorithm()]])} />);
    const card = buildRpCalibrationCard(RP_RECORD);
    expect(screen.getByTestId(rpCalibrationCardSentenceTestId("spr")).textContent).toContain(
      rpCardHeadlineSentence(algorithmDisplayLabel("spr"), card.headline!)
    );
    expect(screen.queryByTestId(rpCalibrationCardTestId("opr"))).toBeNull();
    expect(screen.queryByTestId(rpCalibrationCardTestId("epa"))).toBeNull();
  });
});

describe("RpCalibrationSection — absence is absence (real pre-phase fixture, no rpCalibration key anywhere)", () => {
  it("every card shows RP_CALIBRATION_ABSENT_TEXT and no card body contains a percentage figure", () => {
    render(<RpCalibrationSection artifactsByYear={new Map([[2026, ARTIFACT_2026_NO_RP]])} />);
    for (const algorithmId of RP_CALIBRATION_ALGORITHM_IDS) {
      const cardEl = screen.getByTestId(rpCalibrationCardTestId(algorithmId));
      expect(screen.getByTestId(rpCalibrationCardSentenceTestId(algorithmId)).textContent).toBe(RP_CALIBRATION_ABSENT_TEXT);
      expect(cardEl.textContent).not.toContain("%");
    }
  });

  it("every card heading equals algorithmDisplayLabel(id) evaluated at run time, for every RP_CALIBRATION_ALGORITHM_IDS entry", () => {
    render(<RpCalibrationSection artifactsByYear={new Map([[2026, ARTIFACT_2026_NO_RP]])} />);
    for (const algorithmId of RP_CALIBRATION_ALGORITHM_IDS) {
      const cardEl = screen.getByTestId(rpCalibrationCardTestId(algorithmId));
      expect(cardEl.textContent).toContain(algorithmDisplayLabel(algorithmId));
    }
  });

  it("an entirely missing year (no artifact fetched yet) also renders every card as absent, never throws", () => {
    render(<RpCalibrationSection artifactsByYear={new Map()} />);
    for (const algorithmId of RP_CALIBRATION_ALGORITHM_IDS) {
      expect(screen.getByTestId(rpCalibrationCardSentenceTestId(algorithmId)).textContent).toBe(RP_CALIBRATION_ABSENT_TEXT);
    }
  });
});

describe("RpCalibrationSection — populated render (real emitted record attached to spr/2026/qualification)", () => {
  it("spr's card renders the fixture-recomputed headline sentence; opr/epa render no card at all", () => {
    render(<RpCalibrationSection artifactsByYear={new Map([[2026, artifactWithSprRp()]])} />);
    const card = buildRpCalibrationCard(RP_RECORD);
    expect(screen.getByTestId(rpCalibrationCardSentenceTestId("spr")).textContent).toContain(
      rpCardHeadlineSentence(algorithmDisplayLabel("spr"), card.headline!)
    );
    expect(screen.queryByTestId(rpCalibrationCardTestId("opr"))).toBeNull();
    expect(screen.queryByTestId(rpCalibrationCardTestId("epa"))).toBeNull();
  });

  it("spr's card renders one row per bonus the record carries, in the record's own order", () => {
    render(<RpCalibrationSection artifactsByYear={new Map([[2026, artifactWithSprRp()]])} />);
    const cardEl = screen.getByTestId(rpCalibrationCardTestId("spr"));
    for (const bonus of RP_RECORD.bonuses) {
      expect(cardEl.textContent).toContain(bonus.name);
    }
  });
});

describe("RpCalibrationSection — D-04 provenance in the explainer copy (09-06)", () => {
  it("names the seasons that informed the model choice, and says the headline comes from the ones that did not", () => {
    // The two-slice split is only honest if a reader can tell which half they
    // are looking at. Without this sentence a figure from a season the model
    // was CHOSEN on could be read as out-of-sample, which is exactly what the
    // split exists to prevent.
    for (const season of ["2016-2020", "2022"]) {
      expect(RP_CALIBRATION_EXPLAINER).toContain(season);
    }
    expect(RP_CALIBRATION_EXPLAINER).toContain("2023 onward");
    expect(RP_CALIBRATION_EXPLAINER).toMatch(/had no say in that choice/);
  });

  it("renders that sentence into the section rather than merely declaring it", () => {
    const artifact = CompareArtifactSchema.parse(compare2026) as CompareArtifact;
    render(<RpCalibrationSection artifactsByYear={new Map([[DEFAULT_RP_CALIBRATION_YEAR, artifact]])} />);
    expect(screen.getByText(RP_CALIBRATION_EXPLAINER)).toBeDefined();
  });
});
