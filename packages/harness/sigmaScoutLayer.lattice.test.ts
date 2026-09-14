/**
 * The lattice marginal family end to end through the real `SigmaScoutLayer`, on
 * the committed 2022 spr digest slice, played and upcoming passes. The
 * production module is the lattice side; the comparison is a gaussian-declared
 * variant built inline. Both carry the mean shift, so they differ by family alone.
 *
 * The outcome half (`matchOutcomePmf`, `redOutcomeRp`, `blueOutcomeRp`) must
 * be elementwise `===` control's on every row: the lattice family is a bonus-
 * half change and may not reach the win/tie split.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult, Prediction } from "../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import type { RpRuleModule } from "../core/rankingPoints/constants.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";
import { WalkForwardSimulator, toLeakProofUpcoming } from "./replay.js";
import { resolvePublishAlgorithms } from "./publish.js";
import { usesSigmaScore } from "./sigmaScore.js";

const DIGEST_SLICE_FIXTURE_PATH = join("packages", "harness", "fixtures", "digest-slice.json");

interface DigestSliceFixture {
  sliceSeason: number;
  matches: MatchResult[];
}

interface Row {
  readonly matchKey: string;
  readonly prediction: Prediction;
}

function runLayer(algorithm: AlgorithmModule<unknown>, stream: readonly MatchResult[], ruleModule: RpRuleModule): Row[] {
  const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
  const talentAfterMatch = new Map<string, Map<string, number>>();
  const records = new WalkForwardSimulator([...stream]).runAll([algorithm], teams, undefined, (match, algorithmId, state) => {
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

  const layer = new SigmaScoutLayer(ruleModule, algorithm.id);
  const rows: Row[] = [];
  for (const record of records) {
    const folded = layer.foldPlayed(record.match, record.prediction, talentAfterMatch.get(record.match.matchKey));
    rows.push({ matchKey: record.match.matchKey, prediction: folded.prediction });
  }
  const finalState = records.finalStates.get(algorithm.id);
  for (const match of stream) {
    const upcoming = toLeakProofUpcoming(match);
    rows.push({ matchKey: match.matchKey, prediction: layer.enrichUpcoming(upcoming, algorithm.predict(finalState, upcoming)).prediction });
  }
  return rows;
}

function expectNormalized(pmf: readonly number[] | undefined, label: string): void {
  expect(pmf, label).toBeDefined();
  expect(pmf!.every((p) => Number.isFinite(p) && p >= 0 && p <= 1), label).toBe(true);
  expect(Math.abs(pmf!.reduce((a, b) => a + b, 0) - 1), label).toBeLessThan(1e-9);
}

describe("tracer: the lattice family through SigmaScoutLayer (260914-01x)", () => {
  const fixture = JSON.parse(readFileSync(DIGEST_SLICE_FIXTURE_PATH, "utf8")) as DigestSliceFixture;
  const spr = resolvePublishAlgorithms(undefined).find((a) => a.id === "spr") as AlgorithmModule<unknown>;
  const lattice = RP_RULE_MODULES[fixture.sliceSeason]!;
  const control: RpRuleModule = {
    ...lattice,
    thresholdVariables: lattice.thresholdVariables.map((v) => ({ ...v, marginalFamily: "gaussian" as const })),
  };
  const controlRows = runLayer(spr, fixture.matches, control);
  const latticeRows = runLayer(spr, fixture.matches, lattice);

  it("the production module declares lattice on every variable, and the gaussian comparison variant flips every variable", () => {
    expect(lattice.thresholdVariables.every((v) => v.marginalFamily === "lattice")).toBe(true);
    expect(control.thresholdVariables.every((v) => v.marginalFamily === "gaussian")).toBe(true);
  });

  it("produces bonus probabilities in [0, 1] and normalized pmfs on every row that carries RP odds", () => {
    expect(latticeRows.length).toBe(controlRows.length);
    const withRp = latticeRows.filter((r) => r.prediction.redRpPmf !== undefined);
    expect(withRp.length).toBeGreaterThan(0);
    expect(withRp.length).toBe(controlRows.filter((r) => r.prediction.redRpPmf !== undefined).length);
    for (const [i, row] of latticeRows.entries()) {
      expect(row.prediction.redRpPmf === undefined, `${row.matchKey} RP presence matches control`).toBe(controlRows[i]!.prediction.redRpPmf === undefined);
      if (row.prediction.redRpPmf === undefined) continue;
      const p = row.prediction;
      expectNormalized(p.redRpPmf, `${row.matchKey} redRpPmf`);
      expectNormalized(p.blueRpPmf, `${row.matchKey} blueRpPmf`);
      if (p.redBonusRpPmf !== undefined) expectNormalized(p.redBonusRpPmf, `${row.matchKey} redBonusRpPmf`);
      if (p.blueBonusRpPmf !== undefined) expectNormalized(p.blueBonusRpPmf, `${row.matchKey} blueBonusRpPmf`);
      for (const q of [...(p.redBonusRp ?? []), ...(p.blueBonusRp ?? [])]) expect(q >= 0 && q <= 1, `${row.matchKey} bonus odds`).toBe(true);
    }
  });

  it("differs from control on at least one row, and its outcome half is elementwise === control's on every row", () => {
    let bonusDiffers = false;
    for (let i = 0; i < controlRows.length; i++) {
      const c = controlRows[i]!.prediction;
      const l = latticeRows[i]!.prediction;
      expect(latticeRows[i]!.matchKey).toBe(controlRows[i]!.matchKey);
      for (const field of ["matchOutcomePmf", "redOutcomeRp", "blueOutcomeRp"] as const) {
        const cv = c[field];
        const lv = l[field];
        expect(lv === undefined, `${controlRows[i]!.matchKey} ${field} presence`).toBe(cv === undefined);
        if (cv === undefined || lv === undefined) continue;
        expect(lv.length).toBe(cv.length);
        for (let k = 0; k < cv.length; k++) expect(lv[k] === cv[k], `${controlRows[i]!.matchKey} ${field}[${k}]`).toBe(true);
      }
      const cb = [...(c.redBonusRp ?? []), ...(c.blueBonusRp ?? [])];
      const lb = [...(l.redBonusRp ?? []), ...(l.blueBonusRp ?? [])];
      if (cb.some((value, k) => value !== lb[k])) bonusDiffers = true;
    }
    expect(bonusDiffers).toBe(true);
  });
});
