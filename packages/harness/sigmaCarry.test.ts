/**
 * The Sigma-carry CANDIDATE (`sigmaCarry.ts`), pinned on the committed 2022 digest slice.
 *
 * Four properties, each with a non-vacuity partner:
 *   1. INERT AT DEFAULT. A layer with no options, `undefined` options, or options without `sigmaCarry`
 *      folds, prices and persists byte-identically; and switching the candidate ON with nothing to
 *      carry in (a cold-start season) changes no output either, so the checkpoint bookkeeping itself
 *      is inert.
 *   2. SEASON S IS SEEDED FROM SEASON S-1 ONLY. The next layer starts from exactly the carry it is
 *      handed, and from nothing else.
 *   3. THE CARRY INSTANT IS THE LAST OFFICIAL MATCH. Offseason folds after it move the live layer but
 *      not the carry; Week 0 folds nothing at all.
 *   4. THE ROOKIE RULE is defined for a never-seen team when on, and changes nothing about a team that
 *      already has a total and a belief.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult } from "../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { resolvePublishAlgorithms } from "./publish.js";
import { toLeakProofUpcoming, WalkForwardSimulator, type PredictionRecord } from "./replay.js";
import {
  acrossSigmaBoundary,
  candidateRosterRatings,
  candidateSigmaMap,
  seasonOwnPopulation,
  ZERO_SIGMA_POPULATION,
  type SigmaSeasonCarry,
} from "./sigmaCarry.js";
import { SigmaScoreAccumulator, type SigmaBelief } from "./sigmaScore.js";
import { SigmaScoutLayer, type SigmaScoutLayerOptions } from "./sigmaScoutLayer.js";

interface DigestSliceFixture {
  sliceSeason: number;
  matches: MatchResult[];
}

const fixture = JSON.parse(readFileSync(join("packages", "harness", "fixtures", "digest-slice.json"), "utf8")) as DigestSliceFixture;
const spr = resolvePublishAlgorithms("spr")[0] as AlgorithmModule<unknown>;
const RULES = RP_RULE_MODULES[fixture.sliceSeason];

interface Replayed {
  readonly records: readonly PredictionRecord[];
  readonly talentAfterMatch: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

/** One SPR replay of `stream`, talent captured after each match exactly as `publishSeasons` captures it. */
function replay(stream: readonly MatchResult[]): Replayed {
  const teams = [...new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
  const talentAfterMatch = new Map<string, Map<string, number>>();
  const records = new WalkForwardSimulator(stream).runAll([spr], teams, undefined, (match, _id, state) => {
    const involved = [...match.redTeams, ...match.blueTeams];
    const metrics = spr.teamMetrics(state, involved);
    const talent = new Map<string, number>();
    for (const teamKey of involved) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) talent.set(teamKey, total);
    }
    talentAfterMatch.set(match.matchKey, talent);
  });
  return { records, talentAfterMatch };
}

/** Folds every record into `layer` and returns what each fold returned, in order. */
function foldAll(layer: SigmaScoutLayer, replayed: Replayed): unknown[] {
  return replayed.records.map((r) => layer.foldPlayed(r.match, r.prediction, replayed.talentAfterMatch.get(r.match.matchKey)));
}

/** Every observable output of a layer after a full fold: the fold records, the finished scores, the seed passengers and the upcoming pricing. */
function observe(options: SigmaScoutLayerOptions | undefined, replayed: Replayed, ruleModule = RULES): unknown {
  const layer = options === undefined ? new SigmaScoutLayer(ruleModule, "spr") : new SigmaScoutLayer(ruleModule, "spr", options);
  const folded = foldAll(layer, replayed);
  // The enriched record's `match` is the leak-proof Proxy, so only the priced fields are compared.
  const upcoming = fixture.matches.slice(0, 12).map((m) => {
    const enriched = layer.enrichUpcoming(toLeakProofUpcoming(m), replayed.records[0]!.prediction);
    return { prediction: enriched.prediction, matchBand: enriched.matchBand };
  });
  return {
    folded,
    upcoming,
    scores: [...layer.sigmaScoreByTeam()],
    beliefs: [...layer.sigmaBeliefs()],
    population: layer.sigmaPopulation(),
    rp: [...layer.rpVariableBeliefs()],
    shift: layer.rpMeanShiftState(),
  };
}

const officialReplay = replay(fixture.matches);

/** The fixture's matches re-keyed onto a fresh event of `eventType`, stamped after every official match. */
function relabelled(eventType: number, eventKey: string, count: number): MatchResult[] {
  return fixture.matches.slice(0, count).map((m, i) => ({ ...m, matchKey: `${eventKey}_qm${i + 1}`, eventKey, eventType, compLevel: "qm" as const }));
}

describe("acrossSigmaBoundary and seasonOwnPopulation", () => {
  it("resets the bias term and keeps the volatility evidence and talent, in fresh copies", () => {
    const belief: SigmaBelief = { meanWeight: 7.5, mean: 3.25, varWeight: 9.1, sumSquares: 412.5, talent: 18 };
    const input = new Map([["frc1", belief]]);
    const crossed = acrossSigmaBoundary(input);
    expect(crossed.get("frc1")).toEqual({ meanWeight: 0, mean: 0, varWeight: 9.1, sumSquares: 412.5, talent: 18 });
    crossed.get("frc1")!.varWeight = 0;
    expect(belief.varWeight).toBe(9.1);
  });

  it("subtracts what the season carried in, and passes the carried-in population through a season that folded nothing", () => {
    const carriedIn = { sumSquares: 100, talentSquares: 400, count: 10 };
    expect(seasonOwnPopulation({ sumSquares: 130, talentSquares: 460, count: 13 }, carriedIn)).toEqual({ sumSquares: 30, talentSquares: 60, count: 3 });
    expect(seasonOwnPopulation(carriedIn, carriedIn)).toEqual(carriedIn);
    expect(seasonOwnPopulation({ sumSquares: 5, talentSquares: 9, count: 2 }, ZERO_SIGMA_POPULATION)).toEqual({ sumSquares: 5, talentSquares: 9, count: 2 });
  });
});

describe("SigmaScoutLayer with the Sigma-carry candidate", () => {
  it("INERT: no options, undefined options and options without sigmaCarry are byte-identical, and carry nothing", () => {
    const base = JSON.stringify(observe(undefined, officialReplay));
    expect(JSON.stringify(observe({}, officialReplay))).toBe(base);
    const explicitUndefined = new SigmaScoutLayer(RULES, "spr", undefined);
    foldAll(explicitUndefined, officialReplay);
    expect(explicitUndefined.sigmaCarryOut()).toBeUndefined();
  });

  it("INERT BOOKKEEPING: the candidate ON with nothing carried in (a cold-start season) produces identical outputs, offseason checkpoint included", () => {
    expect(JSON.stringify(observe({ sigmaCarry: { from: undefined } }, officialReplay))).toBe(JSON.stringify(observe(undefined, officialReplay)));
    const withOffseason = replay([...fixture.matches, ...relabelled(99, "2022offs", 30)]);
    expect(JSON.stringify(observe({ sigmaCarry: { from: undefined } }, withOffseason))).toBe(JSON.stringify(observe(undefined, withOffseason)));
  });

  it("the carry out resets every bias, keeps the live volatility evidence, and holds the season's OWN population", () => {
    const layer = new SigmaScoutLayer(RULES, "spr", { sigmaCarry: { from: undefined } });
    foldAll(layer, officialReplay);
    const carry = layer.sigmaCarryOut()!;
    const live = layer.sigmaBeliefs();
    expect(carry.beliefs.size).toBe(live.size);
    expect(carry.beliefs.size).toBeGreaterThan(0);
    for (const [teamKey, belief] of carry.beliefs) {
      expect(belief.mean).toBe(0);
      expect(belief.meanWeight).toBe(0);
      expect(belief.varWeight).toBe(live.get(teamKey)!.varWeight);
      expect(belief.sumSquares).toBe(live.get(teamKey)!.sumSquares);
      expect(belief.talent).toBe(live.get(teamKey)!.talent);
    }
    expect(carry.population).toEqual(layer.sigmaPopulation());
  });

  it("SEASON S STARTS FROM S-1's CARRY AND NOTHING ELSE: before any fold, the next layer reads exactly the carried accumulator", () => {
    const first = new SigmaScoutLayer(RULES, "spr", { sigmaCarry: { from: undefined } });
    foldAll(first, officialReplay);
    const carry = first.sigmaCarryOut()!;

    const next = new SigmaScoutLayer(RULES, "spr", { sigmaCarry: { from: carry } });
    const reference = SigmaScoreAccumulator.fromBeliefs(carry.beliefs, carry.population);
    expect([...next.sigmaScoreByTeam()]).toEqual([...reference.scoreByTeam()]);
    expect(next.sigmaPopulation()).toEqual(carry.population);

    // A deep copy of the carry gives the same layer; the layer never reaches back into its source.
    const copy: SigmaSeasonCarry = {
      beliefs: new Map([...carry.beliefs].map(([k, b]) => [k, { ...b }])),
      population: { ...carry.population },
    };
    const fromCopy = new SigmaScoutLayer(RULES, "spr", { sigmaCarry: { from: copy } });
    const nextOut = JSON.stringify(foldAll(next, officialReplay));
    expect(JSON.stringify(foldAll(fromCopy, officialReplay))).toBe(nextOut);

    // Non-vacuity: the carried season prices differently from a cold one.
    expect(JSON.stringify(foldAll(new SigmaScoutLayer(RULES, "spr"), officialReplay))).not.toBe(nextOut);

    // And the season it hands on counts only what it folded itself.
    const handedOn = next.sigmaCarryOut()!;
    expect(handedOn.population.count).toBe(next.sigmaPopulation()!.count - carry.population.count);
    expect(handedOn.population.count).toBe(carry.population.count);
  });

  it("THE CARRY INSTANT IS THE LAST OFFICIAL MATCH: offseason folds after it move the live layer, not the carry", () => {
    const officialOnly = new SigmaScoutLayer(RULES, "spr", { sigmaCarry: { from: undefined } });
    foldAll(officialOnly, officialReplay);
    const expected = JSON.stringify([...officialOnly.sigmaCarryOut()!.beliefs, officialOnly.sigmaCarryOut()!.population]);

    const withOffseason = replay([...fixture.matches, ...relabelled(99, "2022offs", 30)]);
    const layer = new SigmaScoutLayer(RULES, "spr", { sigmaCarry: { from: undefined } });
    foldAll(layer, withOffseason);
    const carry = layer.sigmaCarryOut()!;
    expect(JSON.stringify([...carry.beliefs, carry.population])).toBe(expected);
    // Non-vacuity: the offseason folds really did move the live state.
    expect(layer.sigmaPopulation()!.count).toBeGreaterThan(officialOnly.sigmaPopulation()!.count);
  });

  it("a Week 0 match after official play folds nothing and leaves the carry where it was", () => {
    const officialOnly = new SigmaScoutLayer(RULES, "spr", { sigmaCarry: { from: undefined } });
    foldAll(officialOnly, officialReplay);
    const withWeekZero = replay([...fixture.matches, ...relabelled(100, "2022week0", 12)]);
    const layer = new SigmaScoutLayer(RULES, "spr", { sigmaCarry: { from: undefined } });
    foldAll(layer, withWeekZero);
    expect(JSON.stringify([...layer.sigmaCarryOut()!.beliefs])).toBe(JSON.stringify([...officialOnly.sigmaCarryOut()!.beliefs]));
    expect(layer.sigmaPopulation()).toEqual(officialOnly.sigmaPopulation());
  });

  it("a season with no official match carries from its end state (replay.ts's own carryStates fallback)", () => {
    const offseasonOnly = replay(relabelled(99, "2022offs", 30));
    const layer = new SigmaScoutLayer(RULES, "spr", { sigmaCarry: { from: undefined } });
    foldAll(layer, offseasonOnly);
    const carry = layer.sigmaCarryOut()!;
    expect(carry.population).toEqual(layer.sigmaPopulation());
    expect(carry.beliefs.size).toBe(layer.sigmaBeliefs().size);
  });

  it("the carry never reads the rule module: a Sigma-only layer hands on exactly what a full layer does", () => {
    const full = new SigmaScoutLayer(RULES, "spr", { sigmaCarry: { from: undefined } });
    const sigmaOnly = new SigmaScoutLayer(undefined, "spr", { sigmaCarry: { from: undefined } });
    foldAll(full, officialReplay);
    foldAll(sigmaOnly, officialReplay);
    const a = full.sigmaCarryOut()!;
    const b = sigmaOnly.sigmaCarryOut()!;
    expect(JSON.stringify([...b.beliefs, b.population])).toBe(JSON.stringify([...a.beliefs, a.population]));
  });

  it("a non-Sigma algorithm carries nothing even with the candidate on", () => {
    const layer = new SigmaScoutLayer(RULES, "epa", { sigmaCarry: { from: undefined } });
    expect(layer.sigmaCarryOut()).toBeUndefined();
    expect(layer.sigmaPriorAtTalent(10)).toBeUndefined();
  });
});

describe("SigmaScoreAccumulator.priorSigmaAtTalent", () => {
  it("is exactly what sigmaFor reads for a team whose only information is its talent, and priorSigmaFor is it at the stored talent", () => {
    const layer = new SigmaScoutLayer(RULES, "spr");
    foldAll(layer, officialReplay);
    const accumulator = SigmaScoreAccumulator.fromBeliefs(layer.sigmaBeliefs(), layer.sigmaPopulation());
    for (const talent of [0.5, 12, 37.25, 90]) {
      const probe = SigmaScoreAccumulator.fromBeliefs(new Map(), layer.sigmaPopulation());
      probe.observeTalent("frc-never-seen", talent);
      expect(probe.sigmaFor("frc-never-seen")).toBeCloseTo(accumulator.priorSigmaAtTalent(talent), 12);
    }
    for (const teamKey of [...layer.sigmaBeliefs().keys()].slice(0, 20)) {
      expect(accumulator.priorSigmaFor(teamKey)).toBe(accumulator.priorSigmaAtTalent(layer.sigmaBeliefs().get(teamKey)!.talent));
    }
    // Non-vacuity: the prior really scales with the talent it is handed (the slice's population is past
    // MIN_POPULATION_FOR_TALENT_PRIOR, and 12 and 30 sit inside the clamp band).
    expect(accumulator.priorSigmaAtTalent(30)).toBeCloseTo(2.5 * accumulator.priorSigmaAtTalent(12), 9);
  });
});

describe("candidateRosterRatings — the rookie rule", () => {
  const prior = (talent: number): number => 2 + talent / 10;

  it("keeps a team's published total and belief, and rates a never-seen team with the unseen total and the prior at it", () => {
    const ratings = candidateRosterRatings({
      roster: ["frcVet", "frcRookie"],
      totalByTeam: new Map([["frcVet", 40]]),
      unseenTotal: 20,
      sigmaByTeam: new Map([["frcVet", 7]]),
      priorSigmaAtTalent: prior,
    });
    expect(ratings.get("frcVet")).toEqual({ total: 40, sigma: 7, unseenByAlgorithm: false, priorOnlySigma: false });
    expect(ratings.get("frcRookie")).toEqual({ total: 20, sigma: 4, unseenByAlgorithm: true, priorOnlySigma: true });
    expect([...candidateSigmaMap(ratings)]).toEqual([
      ["frcVet", 7],
      ["frcRookie", 4],
    ]);
  });

  it("a team with a total but no belief gets the prior at ITS total; one with a belief but no total keeps the belief", () => {
    const ratings = candidateRosterRatings({
      roster: ["frcA", "frcB"],
      totalByTeam: new Map([["frcA", 60]]),
      unseenTotal: 20,
      sigmaByTeam: new Map([["frcB", 5]]),
      priorSigmaAtTalent: prior,
    });
    expect(ratings.get("frcA")).toEqual({ total: 60, sigma: 8, unseenByAlgorithm: false, priorOnlySigma: true });
    expect(ratings.get("frcB")).toEqual({ total: 20, sigma: 5, unseenByAlgorithm: true, priorOnlySigma: false });
  });

  it("without an unseen total a never-seen team stays unrated, and a non-finite total never becomes a talent", () => {
    const ratings = candidateRosterRatings({
      roster: ["frcRookie", "frcNaN"],
      totalByTeam: new Map([["frcNaN", Number.NaN]]),
      unseenTotal: undefined,
      sigmaByTeam: new Map(),
      priorSigmaAtTalent: prior,
    });
    expect(ratings.get("frcRookie")).toEqual({ total: undefined, sigma: undefined, unseenByAlgorithm: false, priorOnlySigma: false });
    expect(ratings.get("frcNaN")).toEqual({ total: undefined, sigma: undefined, unseenByAlgorithm: false, priorOnlySigma: false });
    expect(candidateSigmaMap(ratings).size).toBe(0);
  });
});
