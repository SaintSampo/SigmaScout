/**
 * Tests for `SigmaScoutLayer`'s measurement-only third constructor
 * parameter, `rpOutcomeArms` (quick task 260913-qyn, Task 1 Step 2). This is
 * the INERTNESS proof required before any arm figure is measured: a layer
 * given no `rpOutcomeArms` (or an empty one) must reproduce EXACTLY what the
 * two-argument constructor always produced, and each arm flag must move
 * only the outcome half it names — never the bonus half.
 *
 * Folded over `packages/harness/fixtures/digest-slice.json`, the same
 * committed fixture `sigmaScoutLayer.matchBand.test.ts` pins its RP digest
 * against, so this file exercises a real 2022 spr slice rather than a
 * synthetic one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult, Prediction } from "../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { SigmaScoutLayer, type RpOutcomeArms } from "./sigmaScoutLayer.js";
import { WalkForwardSimulator } from "./replay.js";
import { resolvePublishAlgorithms } from "./publish.js";
import { usesSigmaScore } from "./sigmaScore.js";

const DIGEST_SLICE_FIXTURE_PATH = join("packages", "harness", "fixtures", "digest-slice.json");

interface DigestSliceFixture {
  sliceSeason: number;
  sliceEventKeys: string[];
  extractedAt: string;
  corpusIdentity: string;
  matches: MatchResult[];
}

function loadFixture(): DigestSliceFixture {
  return JSON.parse(readFileSync(DIGEST_SLICE_FIXTURE_PATH, "utf8")) as DigestSliceFixture;
}

interface DecomposedRow {
  readonly matchKey: string;
  readonly prediction: Prediction;
}

/**
 * Folds the fixture's PLAYED matches through one `SigmaScoutLayer` built
 * with the given `rpOutcomeArms` — enough to exercise `#rpFieldsFor`'s
 * decomposition on every row, the same construction
 * `sigmaScoutLayer.matchBand.test.ts`'s `runLayer` uses for its played pass.
 */
function runLayer(algorithm: AlgorithmModule<unknown>, fixture: DigestSliceFixture, rpOutcomeArms?: RpOutcomeArms): DecomposedRow[] {
  const stream = fixture.matches;
  const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
  const talentAfterMatch = new Map<string, Map<string, number>>();
  const records = new WalkForwardSimulator(stream).runAll([algorithm], teams, undefined, (match, algorithmId, state) => {
    if (!usesSigmaScore(algorithmId)) return;
    const involvedTeams = [...match.redTeams, ...match.blueTeams];
    const metrics = algorithm.teamMetrics(state, involvedTeams);
    const talent = new Map<string, number>();
    for (const teamKey of involvedTeams) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) talent.set(teamKey, total);
    }
    talentAfterMatch.set(match.matchKey, talent);
  });

  const layer = new SigmaScoutLayer(RP_RULE_MODULES[fixture.sliceSeason], algorithm.id, rpOutcomeArms);
  const rows: DecomposedRow[] = [];
  for (const record of records) {
    const folded = layer.foldPlayed(record.match, record.prediction, talentAfterMatch.get(record.match.matchKey));
    rows.push({ matchKey: record.match.matchKey, prediction: folded.prediction });
  }
  return rows;
}

describe("SigmaScoutLayer's rpOutcomeArms constructor parameter (260913-qyn, measurement-only)", () => {
  const fixture = loadFixture();
  const algorithms = resolvePublishAlgorithms(undefined);
  const spr = algorithms.find((a) => a.id === "spr") as AlgorithmModule<unknown>;

  it("non-vacuity: the slice actually produces decomposed rows for spr", () => {
    const rows = runLayer(spr, fixture);
    expect(rows.some((r) => r.prediction.matchOutcomePmf !== undefined)).toBe(true);
  });

  it("the default (two-argument) layer and a layer given an EMPTY rpOutcomeArms produce bitwise-equal RP fields", () => {
    const control = runLayer(spr, fixture);
    const empty = runLayer(spr, fixture, {});
    expect(empty).toEqual(control);
  });

  it("the win layer's matchOutcomePmf[0] === prediction.pRedWin on every decomposed row", () => {
    const rows = runLayer(spr, fixture, { win: true });
    const decomposed = rows.filter((r) => r.prediction.matchOutcomePmf !== undefined);
    expect(decomposed.length).toBeGreaterThan(0);
    for (const row of decomposed) {
      expect(row.prediction.matchOutcomePmf![0]).toBe(row.prediction.pRedWin);
    }
  });

  it("the tie layer has matchOutcomePmf[1] > 0 on some row", () => {
    const rows = runLayer(spr, fixture, { tie: true });
    const decomposed = rows.filter((r) => r.prediction.matchOutcomePmf !== undefined);
    expect(decomposed.length).toBeGreaterThan(0);
    expect(decomposed.some((r) => r.prediction.matchOutcomePmf![1]! > 0)).toBe(true);
  });

  it("every arm layer's bonus-half fields (redBonusRpPmf, blueBonusRpPmf, redBonusRp, blueBonusRp) are elementwise === control's, on every row", () => {
    const control = runLayer(spr, fixture);
    const arms: readonly RpOutcomeArms[] = [{ win: true }, { tie: true }, { win: true, tie: true }];
    for (const arm of arms) {
      const rows = runLayer(spr, fixture, arm);
      expect(rows.length).toBe(control.length);
      for (let i = 0; i < rows.length; i++) {
        expect(rows[i]!.matchKey).toBe(control[i]!.matchKey);
        const controlPred = control[i]!.prediction;
        const armPred = rows[i]!.prediction;
        for (const field of ["redBonusRpPmf", "blueBonusRpPmf", "redBonusRp", "blueBonusRp"] as const) {
          expect(armPred[field], `${JSON.stringify(arm)} row ${i} field ${field}`).toEqual(controlPred[field]);
        }
      }
    }
  });
});
