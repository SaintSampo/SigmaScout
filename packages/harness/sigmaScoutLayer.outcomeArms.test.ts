/**
 * Tests for the shipped WIN+TIE outcome half of `SigmaScoutLayer`, folded over
 * the committed 2022 spr digest slice `sigmaScoutLayer.matchBand.test.ts` pins.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult, Prediction } from "../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";
import { WalkForwardSimulator, toLeakProofUpcoming } from "./replay.js";
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

/** Folds the fixture's PLAYED matches through one `SigmaScoutLayer`, as `sigmaScoutLayer.matchBand.test.ts`'s played pass does. */
function runLayer(algorithm: AlgorithmModule<unknown>, fixture: DigestSliceFixture): DecomposedRow[] {
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

  const layer = new SigmaScoutLayer(RP_RULE_MODULES[fixture.sliceSeason], algorithm.id);
  const rows: DecomposedRow[] = [];
  for (const record of records) {
    const folded = layer.foldPlayed(record.match, record.prediction, talentAfterMatch.get(record.match.matchKey));
    rows.push({ matchKey: record.match.matchKey, prediction: folded.prediction });
  }
  return rows;
}

/**
 * The played pass of `runLayer`, then every slice match enriched as an
 * upcoming match from the final state — the same two passes
 * `sigmaScoutLayer.matchBand.test.ts`'s RP digest hashes.
 */
function runLayerWithUpcoming(algorithm: AlgorithmModule<unknown>, fixture: DigestSliceFixture): DecomposedRow[] {
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

  const layer = new SigmaScoutLayer(RP_RULE_MODULES[fixture.sliceSeason], algorithm.id);
  const rows: DecomposedRow[] = [];
  for (const record of records) {
    const folded = layer.foldPlayed(record.match, record.prediction, talentAfterMatch.get(record.match.matchKey));
    rows.push({ matchKey: record.match.matchKey, prediction: folded.prediction });
  }
  const finalState = records.finalStates.get(algorithm.id);
  for (const match of stream) {
    const upcoming = toLeakProofUpcoming(match);
    const enriched = layer.enrichUpcoming(upcoming, algorithm.predict(finalState, upcoming));
    rows.push({ matchKey: match.matchKey, prediction: enriched.prediction });
  }
  return rows;
}

const OUTCOME_HALF_FIELDS = ["matchOutcomePmf", "redOutcomeRp", "blueOutcomeRp"] as const;

function outcomeHalfDigest(rows: readonly DecomposedRow[]): string {
  const serialized = rows.map((row) => {
    const out: Record<string, unknown> = { matchKey: row.matchKey };
    for (const field of OUTCOME_HALF_FIELDS) out[field] = (row.prediction as unknown as Record<string, unknown>)[field] ?? null;
    return out;
  });
  return createHash("sha256").update(JSON.stringify(serialized)).digest("hex");
}

/**
 * Pinned digest of the outcome half over the played and upcoming passes,
 * captured before the lattice+meanShift bonus change. NEVER EDIT: a mismatch
 * means a bonus-half change reached the outcome half.
 */
const PINNED_OUTCOME_HALF_DIGEST = "b4a746d8d54df7487e0b3782014a5f34bfff7d6db2145261072644ecf2cc4cbf";

const BONUS_HALF_FIELDS = ["redBonusRpPmf", "blueBonusRpPmf", "redBonusRp", "blueBonusRp"] as const;

function bonusHalfDigest(rows: readonly DecomposedRow[]): string {
  const serialized = rows.map((row) => {
    const out: Record<string, unknown> = { matchKey: row.matchKey };
    for (const field of BONUS_HALF_FIELDS) out[field] = (row.prediction as unknown as Record<string, unknown>)[field] ?? null;
    return out;
  });
  return createHash("sha256").update(JSON.stringify(serialized)).digest("hex");
}

/**
 * Pinned digest of the bonus half on the shipped lattice+meanShift source.
 * NEVER EDIT except on a developer-decided bonus-half model change: a mismatch
 * otherwise means an outcome-half change reached the bonus half.
 */
const PINNED_BONUS_HALF_DIGEST = "db06b44e954d6b860314a7581b4120defb47140e8adc3d361700e33893d78ca2";

describe("SHIPPED outcome half (260913-qyn, WIN+TIE) on the default two-argument SigmaScoutLayer", () => {
  const fixture = loadFixture();
  const algorithms = resolvePublishAlgorithms(undefined);
  const spr = algorithms.find((a) => a.id === "spr") as AlgorithmModule<unknown>;

  it("non-vacuity: the slice actually produces decomposed rows for spr", () => {
    const rows = runLayer(spr, fixture);
    expect(rows.some((r) => r.prediction.matchOutcomePmf !== undefined)).toBe(true);
  });

  it("WIN shipped: the decisive share matchOutcomePmf[0]/(matchOutcomePmf[0]+matchOutcomePmf[2]) is within 1e-12 of pRedWin on every decomposed row", () => {
    const rows = runLayer(spr, fixture);
    const decomposed = rows.filter((r) => r.prediction.matchOutcomePmf !== undefined);
    expect(decomposed.length).toBeGreaterThan(0);
    for (const row of decomposed) {
      const pmf = row.prediction.matchOutcomePmf!;
      const decisiveShare = pmf[0]! / (pmf[0]! + pmf[2]!);
      expect(Math.abs(decisiveShare - row.prediction.pRedWin)).toBeLessThan(1e-12);
    }
  });

  it("TIE shipped: some row has matchOutcomePmf[1] > 0", () => {
    const rows = runLayer(spr, fixture);
    const decomposed = rows.filter((r) => r.prediction.matchOutcomePmf !== undefined);
    expect(decomposed.length).toBeGreaterThan(0);
    expect(decomposed.some((r) => r.prediction.matchOutcomePmf![1]! > 0)).toBe(true);
  });

  it("the outcome half (played and upcoming passes) is bitwise equal to the digest pinned before the 260914-01x bonus ship", () => {
    const rows = runLayerWithUpcoming(spr, fixture);
    expect(rows.some((r) => r.prediction.matchOutcomePmf !== undefined)).toBe(true);
    expect(outcomeHalfDigest(rows)).toBe(PINNED_OUTCOME_HALF_DIGEST);
  });

  it("the bonus half is bitwise equal to the digest pinned on the shipped lattice+meanShift source (260914-01x)", () => {
    const rows = runLayer(spr, fixture);
    expect(bonusHalfDigest(rows)).toBe(PINNED_BONUS_HALF_DIGEST);
  });
});
