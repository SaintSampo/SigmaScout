/**
 * The published Match Band is display-only and separate from the win-odds
 * variance.
 *
 * THE RP PIN. `PINNED_RP_DIGESTS` hashes the nine ranking-point and simulation
 * fields the layer produces over the committed 2022 digest slice, played and
 * upcoming passes, raw floats. A mismatch is a finding about the code (e.g. the
 * corrected display band reaching `#rpFieldsFor`), not a fixture to refresh;
 * the pin changes only on a developer-decided model change. The mean shift is
 * live on this slice (its three 2022 variables pass warmup after
 * `2022azva_qm48`). OPR and EPA publish no RP fields, asserted by absence.
 *
 * The slice comes from the committed fixture only, never the corpus, so the
 * digest is deterministic.
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
import { SigmaScoreAccumulator, sigmaMatchBandVariance, usesSigmaScore } from "./sigmaScore.js";

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

/** Pinned digest, captured on the shipped lattice+meanShift source. Never edit except on a developer-decided model change. */
const PINNED_RP_DIGESTS: Readonly<Record<string, string>> = {
  spr: "0172067f94b2ea52338eff58f9683973634b57ef0e925c0adee95a569b511caa",
};

const RP_FIELDS = [
  "redRpPmf",
  "blueRpPmf",
  "matchOutcomePmf",
  "redOutcomeRp",
  "blueOutcomeRp",
  "redBonusRpPmf",
  "blueBonusRpPmf",
  "redBonusRp",
  "blueBonusRp",
] as const;

interface LayerRun {
  /** Per played match then per upcoming match, in order: the key plus its prediction. */
  readonly rows: { matchKey: string; prediction: Prediction }[];
}

/**
 * Folds the slice through one `SigmaScoutLayer` the way `publishSeasons` does
 * (Sigma talent captured from `teamMetrics` after each match), then enriches
 * every slice match as an upcoming match from the final state.
 */
function runLayer(algorithm: AlgorithmModule<unknown>, fixture: DigestSliceFixture): LayerRun {
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
  const rows: { matchKey: string; prediction: Prediction }[] = [];
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
  return { rows };
}

function rpDigest(run: LayerRun): string {
  const serialized = run.rows.map((row) => {
    const out: Record<string, unknown> = { matchKey: row.matchKey };
    for (const field of RP_FIELDS) out[field] = (row.prediction as unknown as Record<string, unknown>)[field] ?? null;
    return out;
  });
  return createHash("sha256").update(JSON.stringify(serialized)).digest("hex");
}

describe("RP and simulation fields are byte-identical to pre-260913-g66 output (D1a pin)", () => {
  const fixture = loadFixture();
  const algorithms = resolvePublishAlgorithms(undefined);
  const byId = (id: string) => algorithms.find((a) => a.id === id) as AlgorithmModule<unknown>;

  it("resolves exactly opr, epa and spr", () => {
    expect(algorithms.map((a) => a.id).sort()).toEqual(["epa", "opr", "spr"]);
  });

  it("spr: the nine RP fields hash to the digest pinned on unmodified source", () => {
    const algorithm = byId("spr");
    const run = runLayer(algorithm, fixture);
    // Non-vacuity: the RP layer actually produced a pmf on this slice.
    expect(run.rows.some((row) => row.prediction.redRpPmf !== undefined)).toBe(true);
      expect(rpDigest(run)).toBe(PINNED_RP_DIGESTS[algorithm.id]);
  });

  /** The same played and upcoming passes carry none of the nine RP fields. */
  function expectNoRpFields(id: string): void {
    const run = runLayer(byId(id), fixture);
    // Non-vacuity: both passes produced rows (played, then every slice match as upcoming).
    expect(run.rows.length).toBe(fixture.matches.length * 2);
    expect(fixture.matches.length).toBeGreaterThan(0);
    for (const row of run.rows) {
      for (const field of RP_FIELDS) {
        expect(field in (row.prediction as unknown as Record<string, unknown>), `${id} ${row.matchKey} carries ${field}`).toBe(false);
      }
    }
    expect(new SigmaScoutLayer(RP_RULE_MODULES[fixture.sliceSeason], id).rpAccumulator).toBeUndefined();
  }

  it("opr: publishes no ranking-point field on any played or upcoming row (quick task 260913-it4)", () => {
    expectNoRpFields("opr");
  });

  it("epa: publishes no ranking-point field on any played or upcoming row (quick task 260913-it4)", () => {
    expectNoRpFields("epa");
  });
});

describe("sigmaMatchBandVariance (D1b)", () => {
  it("multiplies the win-odds variance by the roster size", () => {
    expect(sigmaMatchBandVariance(3, 300)).toBe(900);
    expect(sigmaMatchBandVariance(2, 12.5)).toBe(25);
  });

  it("returns undefined for an undefined variance, an empty roster, or a non-finite input", () => {
    expect(sigmaMatchBandVariance(3, undefined)).toBeUndefined();
    expect(sigmaMatchBandVariance(0, 300)).toBeUndefined();
    expect(sigmaMatchBandVariance(-1, 300)).toBeUndefined();
    expect(sigmaMatchBandVariance(3, Number.NaN)).toBeUndefined();
    expect(sigmaMatchBandVariance(3, Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(sigmaMatchBandVariance(Number.NaN, 300)).toBeUndefined();
  });
});

describe("the layer publishes a Sigma-only display band (D1b, D3)", () => {
  const fixture = loadFixture();
  const algorithms = resolvePublishAlgorithms(undefined);
  const byId = (id: string) => algorithms.find((a) => a.id === id) as AlgorithmModule<unknown>;

  /** Replays the slice, capturing talent the way publish.ts does; returns records, talent and the final state. */
  function replay(algorithm: AlgorithmModule<unknown>) {
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
    return { records, talentAfterMatch, finalState: records.finalStates.get(algorithm.id) };
  }

  it("spr: foldPlayed and enrichUpcoming bands equal roster size times a parallel SigmaScoreAccumulator's win-odds variance", () => {
    const algorithm = byId("spr");
    const { records, talentAfterMatch, finalState } = replay(algorithm);
    const layer = new SigmaScoutLayer(RP_RULE_MODULES[fixture.sliceSeason], "spr");
    const parallel = new SigmaScoreAccumulator();

    let playedBands = 0;
    for (const record of records) {
      const redWinOdds = parallel.bandVarianceFor(record.match.redTeams);
      const blueWinOdds = parallel.bandVarianceFor(record.match.blueTeams);
      const talent = talentAfterMatch.get(record.match.matchKey);
      const folded = layer.foldPlayed(record.match, record.prediction, talent);
      parallel.foldMatch(record.match, record.prediction);
      if (talent !== undefined) for (const [teamKey, value] of talent) parallel.observeTalent(teamKey, value);

      expect(folded.matchBand?.red).toBe(record.match.redTeams.length * redWinOdds!);
      expect(folded.matchBand?.blue).toBe(record.match.blueTeams.length * blueWinOdds!);
      playedBands++;
    }
    expect(playedBands).toBeGreaterThan(0);

    for (const match of fixture.matches) {
      const upcoming = toLeakProofUpcoming(match);
      const enriched = layer.enrichUpcoming(upcoming, algorithm.predict(finalState, upcoming));
      expect(enriched.matchBand?.red).toBe(match.redTeams.length * parallel.bandVarianceFor(match.redTeams)!);
      expect(enriched.matchBand?.blue).toBe(match.blueTeams.length * parallel.bandVarianceFor(match.blueTeams)!);
    }
  });

  it("spr: a never-seen roster still gets no upcoming band, the same gating win odds have", () => {
    const layer = new SigmaScoutLayer(RP_RULE_MODULES[fixture.sliceSeason], "spr");
    const match = toLeakProofUpcoming(fixture.matches[0]!);
    const enriched = layer.enrichUpcoming(match, byId("spr").predict(byId("spr").initState([...match.redTeams, ...match.blueTeams]), match));
    expect("matchBand" in enriched).toBe(false);
  });

  /** OPR and EPA: no band, no pmf, no Sigma figure and no RP beliefs. */
  function expectNoLevelTwoFeatures(id: string): void {
    const algorithm = byId(id);
    const { records, finalState } = replay(algorithm);
    const layer = new SigmaScoutLayer(RP_RULE_MODULES[fixture.sliceSeason], id);

    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      const folded = layer.foldPlayed(record.match, record.prediction);
      expect("matchBand" in folded).toBe(false);
      expect(folded.prediction.redRpPmf).toBeUndefined();
    }

    for (const match of fixture.matches) {
      const upcoming = toLeakProofUpcoming(match);
      const enriched = layer.enrichUpcoming(upcoming, algorithm.predict(finalState, upcoming));
      expect("matchBand" in enriched).toBe(false);
      expect(enriched.prediction.redRpPmf).toBeUndefined();
    }

    expect(layer.sigmaScoreByTeam().size).toBe(0);
    expect(layer.rpVariableBeliefs().size).toBe(0);
    expect(layer.rpAccumulator).toBeUndefined();
  }

  it("opr: no matchBand key and no pmf from foldPlayed or enrichUpcoming, and no consistency or RP state", () => {
    expectNoLevelTwoFeatures("opr");
  });

  it("epa: no matchBand key and no pmf from foldPlayed or enrichUpcoming, and no consistency or RP state", () => {
    expectNoLevelTwoFeatures("epa");
  });
});
