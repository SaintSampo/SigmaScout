/**
 * Tests for the SHIPPED outcome half (quick task 260913-qyn, Task 2 Step 2):
 * WIN+TIE was the accepted arm with the lowest pooled RPS
 * (`data/baselines/rp-outcome-arms-2026-09.json`, ship: win+tie), so its
 * identities are now the DEFAULT two-argument `SigmaScoutLayer`'s behavior —
 * there is no longer a measurement-only third constructor argument to
 * select between arms.
 *
 * Folded over `packages/harness/fixtures/digest-slice.json`, the same
 * committed fixture `sigmaScoutLayer.matchBand.test.ts` pins its RP digest
 * against, so this file exercises a real 2022 spr slice rather than a
 * synthetic one.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult, Prediction } from "../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";
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
 * Folds the fixture's PLAYED matches through one two-argument
 * `SigmaScoutLayer` — the same construction `sigmaScoutLayer.matchBand.test.ts`'s
 * `runLayer` uses for its played pass, and the only construction that exists
 * now that the measurement-only third argument is deleted.
 */
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
 * Captured from the CONTROL arm during Task 2's measurement, before the
 * collapse edit deleted the four-layer fold — `assertBonusHalfIdentical` ran
 * on every folded record across the whole 2016-2020,2022 selection slice and
 * never threw, which is what proves this digest is unaffected by which
 * outcome arm was active. NEVER EDIT: a mismatch here means the shipped WIN+TIE
 * change reached the bonus half, which the bar never measured and never
 * approved.
 */
const PINNED_BONUS_HALF_DIGEST = "0cbffcb5a9c07ed328fc4afe8f22ee8ecec6b120f2e79e3709c8d0989343f518";

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

  it("the bonus half is bitwise equal to the digest pinned on the control arm before the collapse edit", () => {
    const rows = runLayer(spr, fixture);
    expect(bonusHalfDigest(rows)).toBe(PINNED_BONUS_HALF_DIGEST);
  });
});
