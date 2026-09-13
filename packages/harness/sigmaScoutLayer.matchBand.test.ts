/**
 * Quick task 260913-g66: the published Match Band is separated from the
 * internal win-odds variance.
 *
 * THE RP PIN (Step A, D1a). The digests in `PINNED_RP_DIGESTS` were captured
 * on UNMODIFIED source, before any line of the separation was written. They
 * hash every ranking-point and simulation field the layer produces
 * (`redRpPmf`, `blueRpPmf`, `matchOutcomePmf`, `redOutcomeRp`, `blueOutcomeRp`,
 * `redBonusRpPmf`, `blueBonusRpPmf`, `redBonusRp`, `blueBonusRp`) over the
 * committed 2022 digest slice, played AND upcoming passes, raw floats, no
 * rounding. The separation is display-only: win odds must keep today's
 * uncorrected variance, so these fields must be byte-identical afterwards.
 *
 * NEVER EDIT THE PINNED DIGESTS. A mismatch here is a finding about the code
 * (something fed the corrected display band into `#rpFieldsFor`), not a
 * fixture to refresh.
 *
 * The slice is read from the committed fixture ONLY, never the corpus, so the
 * digest is deterministic whether or not `data/corpus.sqlite` is present.
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

/** Captured on unmodified source (HEAD 4310e961) before any 260913-g66 edit. Never edit. */
const PINNED_RP_DIGESTS: Readonly<Record<string, string>> = {
  opr: "7d126361ae9de7ad80edf40ca2a3bc160017034f893b2ac4f469baa91ca8e858",
  epa: "4cf67297a2f46aeb54baa2315fa6414f01c433e45bc3daa95eb9c7af8dea33e1",
  spr: "18d8d9011db5df9adeeb2f1c9204ba02fa80e0f7685c1276ec91e753a0839ab4",
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

  it("resolves exactly the three pinned algorithms", () => {
    expect(algorithms.map((a) => a.id).sort()).toEqual(Object.keys(PINNED_RP_DIGESTS).sort());
  });

  for (const algorithm of algorithms) {
    it(`${algorithm.id}: the nine RP fields hash to the digest pinned on unmodified source`, () => {
      const run = runLayer(algorithm as AlgorithmModule<unknown>, fixture);
      // Non-vacuity: the RP layer actually produced a pmf on this slice.
      expect(run.rows.some((row) => row.prediction.redRpPmf !== undefined)).toBe(true);
      expect(rpDigest(run)).toBe(PINNED_RP_DIGESTS[algorithm.id]);
    });
  }
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

  for (const id of ["opr", "epa"]) {
    it(`${id}: no matchBand key from foldPlayed or enrichUpcoming, while win odds still price a pmf`, () => {
      const algorithm = byId(id);
      const { records, finalState } = replay(algorithm);
      const layer = new SigmaScoutLayer(RP_RULE_MODULES[fixture.sliceSeason], id);

      let playedPmfs = 0;
      for (const record of records) {
        const folded = layer.foldPlayed(record.match, record.prediction);
        expect("matchBand" in folded).toBe(false);
        if (folded.prediction.redRpPmf !== undefined) playedPmfs++;
      }
      // Warm rosters exist and priced a pmf: the Swing win-odds variance is still live.
      expect(playedPmfs).toBeGreaterThan(0);

      let upcomingPmfs = 0;
      for (const match of fixture.matches) {
        const upcoming = toLeakProofUpcoming(match);
        const enriched = layer.enrichUpcoming(upcoming, algorithm.predict(finalState, upcoming));
        expect("matchBand" in enriched).toBe(false);
        if (enriched.prediction.redRpPmf !== undefined) upcomingPmfs++;
      }
      expect(upcomingPmfs).toBeGreaterThan(0);
    });
  }
});
