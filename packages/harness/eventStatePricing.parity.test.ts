/**
 * EXACT PARITY between the browser pricer (`eventStatePricing.ts`) and the
 * offline publisher, over the committed 2022 digest slice.
 *
 * Offline truth is built the way `publish.ts` builds it: a walk-forward replay
 * collecting each match's talent, `SigmaScoutLayer.foldPlayed` over every
 * played record in order, `layer.enrichUpcoming(m, spr.predict(finalState, m))`
 * for each withheld match, then `buildEventArtifact`. The pricer instead gets
 * the serialized final state (the publisher's passenger chain, in its order),
 * cut down to a `state` block and sent through the wire: `JSON.stringify`,
 * `JSON.parse`, `EventStateBlockSchema.parse`. Only that wire copy is priced.
 *
 * No tolerance anywhere: rows compare with `toEqual`, and their JSON
 * normalizations with `toStrictEqual`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MatchResult, UpcomingMatch } from "../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { spr, type SprState } from "../core/algorithms/spr.js";
import { DEMO_PSEUDO_TEAM_KEY, isDemoTeamKey } from "../core/algorithms/demoTeams.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { loadRpRuleModule } from "../core/rankingPoints/rulesLoader.js";
import { isRpEligibleEventType, type RpRuleModule } from "../core/rankingPoints/constants.js";
import { RP_MEAN_SHIFT_WARMUP_OBSERVATIONS } from "../core/rankingPoints/meanShift.js";
import { WalkForwardSimulator } from "./replay.js";
import { SigmaScoutLayer, type UpcomingLayerRecord } from "./sigmaScoutLayer.js";
import { buildEventArtifact, buildTeamSeasonArtifact, resolvePublishAlgorithms } from "./publish.js";
import { roundPmf, roundTo, ROUNDING_RULE } from "./rounding.js";
import { SigmaScoreAccumulator, usesSigmaScore } from "./sigmaScore.js";
import { RpMomentsAccumulator } from "../core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator } from "../core/rankingPoints/meanShift.js";
import { priceUpcomingRows, type UpcomingPricingModel } from "./upcomingPricing.js";
import {
  deserializeState,
  readRpBeliefs,
  readSigmaBeliefs,
  readSigmaPopulation,
  serializeState,
  withRpBeliefs,
  withRpMeanShift,
  withSigmaBeliefs,
  withSigmaPopulation,
  readRpMeanShift,
  STATE_SNAPSHOT_SHAPE_VERSION,
  type StateRow,
} from "./stateSnapshot.js";
import {
  EventStateBlockSchema,
  type EventStateBlock,
  type EventStateBlockRow,
  type EventUpcomingMatch,
  type TeamSeasonMatch,
} from "./pageArtifacts.js";
import {
  buildEventStateBlock,
  EventStateBlockError,
  priceUpcomingFromState,
  RpRuleModuleSeasonMismatchError,
  type PriceUpcomingResult,
  type ScheduledMatchInput,
} from "./eventStatePricing.js";

// Compile-time: a block row feeds `deserializeState` and the passenger readers as a `StateRow`.
const blockRowIsStateRow: (row: EventStateBlockRow) => StateRow = (row) => row;
void blockRowIsStateRow;

interface DigestSliceFixture {
  sliceSeason: number;
  matches: MatchResult[];
}

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/digest-slice.json", import.meta.url), "utf8")) as DigestSliceFixture;
const SEASON = 2022;
const GENERATION = "parity-gen";
const COMPUTED_AT = "2026-09-15T00:00:00.000Z";

/** The plain `UpcomingMatch` shape `selectScheduledMatches` returns; never the leak-proof proxy (the team builder reads `"winner" in match`). */
function toUpcoming(m: MatchResult): UpcomingMatch {
  return {
    matchKey: m.matchKey,
    eventKey: m.eventKey,
    compLevel: m.compLevel,
    setNumber: m.setNumber,
    matchNumber: m.matchNumber,
    redTeams: [...m.redTeams],
    blueTeams: [...m.blueTeams],
    redSurrogates: [...m.redSurrogates],
    blueSurrogates: [...m.blueSurrogates],
    eventType: m.eventType,
    week: m.week,
  };
}

function rosterKeys(matches: readonly { redTeams: readonly string[]; blueTeams: readonly string[] }[]): string[] {
  return matches.flatMap((m) => [...m.redTeams, ...m.blueTeams]);
}

interface OfflineArm {
  readonly layer: SigmaScoutLayer;
  readonly finalState: SprState;
  /** The publisher's seed rows: `serializeState`, then every level-2 passenger, in `publish.ts`'s order. */
  readonly rows: StateRow[];
}

/** Replays `played` exactly as `publish.ts` drives SPR and its level-2 layer. */
function runOfflineArm(played: readonly MatchResult[], upcoming: readonly UpcomingMatch[], extraTeams: readonly string[] = []): OfflineArm {
  const teams = Array.from(new Set([...rosterKeys(played), ...rosterKeys(upcoming), ...extraTeams])).filter((k) => !isDemoTeamKey(k));
  const talentAfterMatch = new Map<string, Map<string, number>>();
  const records = new WalkForwardSimulator(played).runAll([spr], teams, undefined, (match, algorithmId, state) => {
    const involvedTeams = [...match.redTeams, ...match.blueTeams];
    const metrics = spr.teamMetrics(state as SprState, involvedTeams);
    if (usesSigmaScore(algorithmId)) {
      const talent = new Map<string, number>();
      for (const teamKey of involvedTeams) {
        const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
        if (total !== undefined) talent.set(teamKey, total);
      }
      talentAfterMatch.set(`${algorithmId}:${match.matchKey}`, talent);
    }
  });
  const layer = new SigmaScoutLayer(RP_RULE_MODULES[SEASON], "spr");
  for (const r of records) layer.foldPlayed(r.match, r.prediction, talentAfterMatch.get(`${r.algorithmId}:${r.match.matchKey}`));
  const finalState = records.finalStates.get("spr") as SprState;

  let rows = withRpBeliefs(
    withSigmaBeliefs(serializeState("spr", spr.version, finalState, { generation: GENERATION, computedAt: COMPUTED_AT }), layer.sigmaBeliefs()),
    layer.rpVariableBeliefs()
  );
  const sigmaPopulation = layer.sigmaPopulation();
  if (sigmaPopulation !== undefined) rows = withSigmaPopulation(rows, sigmaPopulation);
  const rpMeanShift = layer.rpMeanShiftState();
  if (rpMeanShift !== undefined) rows = withRpMeanShift(rows, rpMeanShift);
  return { layer, finalState, rows };
}

function offlineRecords(arm: OfflineArm, upcoming: readonly UpcomingMatch[]): UpcomingLayerRecord[] {
  return upcoming.map((m) => arm.layer.enrichUpcoming(m, spr.predict(arm.finalState, m)));
}

/** The block exactly as a browser would receive it: stringified, parsed and schema-parsed. */
function wireBlock(block: EventStateBlock): EventStateBlock {
  return EventStateBlockSchema.parse(JSON.parse(JSON.stringify(block)));
}

function scheduleOnly(m: UpcomingMatch, sortTime: number | undefined): ScheduledMatchInput {
  return {
    matchKey: m.matchKey,
    compLevel: m.compLevel,
    setNumber: m.setNumber,
    matchNumber: m.matchNumber,
    ...(sortTime !== undefined ? { sortTime } : {}),
    redTeams: [...m.redTeams],
    blueTeams: [...m.blueTeams],
  };
}

function jsonNormal<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

function expectExactRows(actual: readonly unknown[], expected: readonly unknown[]): void {
  expect(actual.length).toBe(expected.length);
  expect(actual).toEqual(expected);
  expect(jsonNormal(actual)).toStrictEqual(jsonNormal(expected));
}

// ---------------------------------------------------------------------------
// The slice: E's final 12 qm matches and every E playoff match are withheld.
// ---------------------------------------------------------------------------

const EVENT_KEY = FIXTURE.matches[FIXTURE.matches.length - 1]!.eventKey;
const eventMatches = FIXTURE.matches.filter((m) => m.eventKey === EVENT_KEY);
const withheldQm = eventMatches.filter((m) => m.compLevel === "qm").slice(-12);
const withheldPlayoff = eventMatches.filter((m) => m.compLevel !== "qm");
const withheldKeys = new Set([...withheldQm, ...withheldPlayoff].map((m) => m.matchKey));
const played = FIXTURE.matches.filter((m) => !withheldKeys.has(m.matchKey));
const upcomingQm = withheldQm.map(toUpcoming);

/** Every other withheld match carries a sort time; the rest carry none. */
function sortTimesFor(upcoming: readonly UpcomingMatch[]): Map<string, number> {
  const out = new Map<string, number>();
  upcoming.forEach((m, i) => {
    if (i % 2 === 0) out.set(m.matchKey, 1_650_000_000 + i * 480);
  });
  return out;
}

describe("eventStatePricing parity (tracer): warm qualification matches", () => {
  it("the fixture slice is what the test claims", () => {
    expect(FIXTURE.sliceSeason).toBe(SEASON);
    expect(withheldQm).toHaveLength(12);
    expect(withheldPlayoff.length).toBeGreaterThan(0);
    expect(played.length + withheldKeys.size).toBe(FIXTURE.matches.length);
    // The publisher drives the very module the pricer bundles.
    expect(resolvePublishAlgorithms("spr")[0]).toBe(spr);
  });

  it("a JSON+zod round-tripped state block prices the withheld qm matches to buildEventArtifact's exact upcoming rows", () => {
    const arm = runOfflineArm(played, upcomingQm);
    const sortTimes = sortTimesFor(upcomingQm);
    const published = buildEventArtifact({
      eventKey: EVENT_KEY,
      season: SEASON,
      algorithmId: "spr",
      algorithmVersion: spr.version,
      predictions: [],
      upcoming: offlineRecords(arm, upcomingQm),
      teams: [],
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      sortTimeByMatchKey: sortTimes,
    }).upcoming;

    const block = wireBlock(buildEventStateBlock(arm.rows, rosterKeys(upcomingQm)));
    const priced = priceUpcomingFromState({
      state: block,
      eventKey: EVENT_KEY,
      season: SEASON,
      eventType: upcomingQm[0]!.eventType,
      ruleModule: RP_RULE_MODULES[SEASON],
      upcoming: upcomingQm.map((m) => scheduleOnly(m, sortTimes.get(m.matchKey))),
    });

    expectExactRows(priced.event, published);

    // Non-vacuity: every warm qm row carries the full level-2 set.
    for (const row of priced.event) {
      expect(row.redMatchBandVariance, row.matchKey).toBeTypeOf("number");
      expect(row.blueMatchBandVariance, row.matchKey).toBeTypeOf("number");
      expect(row.redRpPmf, row.matchKey).toBeDefined();
      expect(row.blueRpPmf, row.matchKey).toBeDefined();
      expect(row.matchOutcomePmf, row.matchKey).toBeDefined();
      expect(row.redBonusRp, row.matchKey).toBeDefined();
    }
    expect(priced.event.filter((row) => row.sortTime !== undefined)).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// The full matrix: team rows, unseen team, RP-ineligible, playoffs, mean shift
// ---------------------------------------------------------------------------

/** Every RP-derived key an upcoming row can carry. */
const RP_ROW_KEYS = ["redRpPmf", "blueRpPmf", "matchOutcomePmf", "redBonusRpPmf", "blueBonusRpPmf", "redBonusRp", "blueBonusRp"] as const;

interface CaseResult {
  readonly records: UpcomingLayerRecord[];
  readonly priced: PriceUpcomingResult;
  readonly publishedEvent: EventUpcomingMatch[];
  readonly publishedTeam: TeamSeasonMatch[];
}

/**
 * Prices `upcoming` both ways and asserts exact equality on every event row
 * and every team row before returning them for case-specific assertions.
 */
function expectCaseParity(params: {
  arm: OfflineArm;
  upcoming: readonly UpcomingMatch[];
  eventType: number;
  sortTimes: ReadonlyMap<string, number>;
  ruleModule: RpRuleModule | undefined;
  block?: EventStateBlock;
}): CaseResult {
  const { arm, upcoming, eventType, sortTimes, ruleModule } = params;
  const records = offlineRecords(arm, upcoming);
  const publishedEvent = buildEventArtifact({
    eventKey: EVENT_KEY,
    season: SEASON,
    algorithmId: "spr",
    algorithmVersion: spr.version,
    predictions: [],
    upcoming: records,
    teams: [],
    generation: GENERATION,
    computedAt: COMPUTED_AT,
    sortTimeByMatchKey: sortTimes,
  }).upcoming;
  // One synthetic team whose single event lists every upcoming record in order.
  const publishedTeam = buildTeamSeasonArtifact({
    teamKey: "frc1",
    teamNumber: 1,
    nickname: "Parity",
    season: SEASON,
    algorithmId: "spr",
    algorithmVersion: spr.version,
    seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {}, metricsBasis: "season-final" },
    events: [{ eventKey: EVENT_KEY, eventName: EVENT_KEY, startDate: "2022-04-07", matches: records }],
    metricHistory: [],
    generation: GENERATION,
    computedAt: COMPUTED_AT,
    sortTimeByMatchKey: sortTimes,
  }).events[0]!.matches;

  const block = params.block ?? wireBlock(buildEventStateBlock(arm.rows, rosterKeys(upcoming)));
  const priced = priceUpcomingFromState({
    state: block,
    eventKey: EVENT_KEY,
    season: SEASON,
    eventType,
    ruleModule,
    upcoming: upcoming.map((m) => scheduleOnly(m, sortTimes.get(m.matchKey))),
  });

  expectExactRows(priced.event, publishedEvent);
  expectExactRows(priced.team, publishedTeam);
  return { records, priced, publishedEvent, publishedTeam };
}

/** A key on no roster anywhere in the fixture: a team the season has never seen play. */
const UNSEEN_TEAM = "frc8888";
const E_TEAMS = Array.from(new Set(rosterKeys(eventMatches)));

const unseenQm: UpcomingMatch = {
  matchKey: `${EVENT_KEY}_qm901`,
  eventKey: EVENT_KEY,
  compLevel: "qm",
  setNumber: 1,
  matchNumber: 901,
  redTeams: [UNSEEN_TEAM, E_TEAMS[0]!, E_TEAMS[1]!],
  blueTeams: [E_TEAMS[2]!, E_TEAMS[3]!, E_TEAMS[4]!],
  redSurrogates: [],
  blueSurrogates: [],
  eventType: withheldQm[0]!.eventType,
  week: withheldQm[0]!.week,
};

const emptySf: UpcomingMatch = {
  matchKey: `${EVENT_KEY}_sf9m1`,
  eventKey: EVENT_KEY,
  compLevel: "sf",
  setNumber: 9,
  matchNumber: 1,
  redTeams: [],
  blueTeams: [],
  redSurrogates: [],
  blueSurrogates: [],
  eventType: withheldQm[0]!.eventType,
  week: withheldQm[0]!.week,
};

const upcomingAll: UpcomingMatch[] = [...withheldQm.map(toUpcoming), ...withheldPlayoff.map(toUpcoming), unseenQm, emptySf];
const sortTimesAll = sortTimesFor(upcomingAll);

describe("eventStatePricing parity: the full gating matrix", async () => {
  // The offline arm uses RP_RULE_MODULES; the pricer gets the per-season loader's module.
  const loadedRuleModule = await loadRpRuleModule(SEASON);
  // The unseen team is on the replay's team list, as publish.ts's teamsThisSeason would put it.
  const arm = runOfflineArm(played, upcomingAll, [UNSEEN_TEAM]);
  const ELIGIBLE = unseenQm.eventType;

  it("the injected rule module is the loader's, and it is the publisher's object", () => {
    expect(loadedRuleModule).toBe(RP_RULE_MODULES[SEASON]);
    expect(rosterKeys(FIXTURE.matches)).not.toContain(UNSEEN_TEAM);
    expect(arm.rows.some((row) => row.scopeKind === "team" && row.scopeKey === UNSEEN_TEAM)).toBe(true);
  });

  it("every event row and team row matches exactly, with and without sortTime", () => {
    const { priced } = expectCaseParity({ arm, upcoming: upcomingAll, eventType: ELIGIBLE, sortTimes: sortTimesAll, ruleModule: loadedRuleModule });
    expect(priced.event).toHaveLength(upcomingAll.length);
    expect(priced.team.some((row) => row.sortTime === undefined)).toBe(true);
    expect(priced.team.some((row) => row.sortTime !== undefined)).toBe(true);
  });

  it("unseen team (offline rule): its alliance gets no band, the other alliance keeps one, and the match carries no RP key", () => {
    const { priced } = expectCaseParity({ arm, upcoming: upcomingAll, eventType: ELIGIBLE, sortTimes: sortTimesAll, ruleModule: loadedRuleModule });
    const index = upcomingAll.indexOf(unseenQm);
    // Checked on the wire form: an `undefined`-valued key never reaches JSON.
    for (const row of [jsonNormal(priced.event[index]!), jsonNormal(priced.team[index]!)] as Record<string, unknown>[]) {
      expect(row.matchKey).toBe(unseenQm.matchKey);
      expect(row).not.toHaveProperty("redMatchBandVariance");
      expect(row.blueMatchBandVariance).toBeTypeOf("number");
      for (const key of RP_ROW_KEYS) expect(row, key).not.toHaveProperty(key);
    }
  });

  it("playoffs: real qf/sf/f rows carry no bonus marginals, and an empty-roster sf matches exactly", () => {
    const { priced } = expectCaseParity({ arm, upcoming: upcomingAll, eventType: ELIGIBLE, sortTimes: sortTimesAll, ruleModule: loadedRuleModule });
    const playoffIndexes = upcomingAll.flatMap((m, i) => (m.compLevel !== "qm" ? [i] : []));
    expect(playoffIndexes.length).toBe(withheldPlayoff.length + 1);
    for (const i of playoffIndexes) {
      for (const row of [jsonNormal(priced.event[i]!), jsonNormal(priced.team[i]!)] as Record<string, unknown>[]) {
        expect(row, String(row.matchKey)).not.toHaveProperty("redBonusRp");
        expect(row, String(row.matchKey)).not.toHaveProperty("blueBonusRp");
      }
    }
    const empty = jsonNormal(priced.event[upcomingAll.indexOf(emptySf)]!) as Record<string, unknown>;
    expect(empty.redTeams).toEqual([]);
    expect(empty).not.toHaveProperty("redMatchBandVariance");
    expect(empty).not.toHaveProperty("blueMatchBandVariance");
  });

  it("RP-ineligible event type: bands price, no RP key appears, and every row still matches exactly", () => {
    const INELIGIBLE = 99;
    expect(isRpEligibleEventType(INELIGIBLE)).toBe(false);
    const upcoming = upcomingAll.map((m) => ({ ...m, eventType: INELIGIBLE }));
    const { priced } = expectCaseParity({ arm, upcoming, eventType: INELIGIBLE, sortTimes: sortTimesAll, ruleModule: loadedRuleModule });
    for (let i = 0; i < withheldQm.length; i++) {
      for (const row of [jsonNormal(priced.event[i]!), jsonNormal(priced.team[i]!)] as Record<string, unknown>[]) {
        expect(row.redMatchBandVariance, String(row.matchKey)).toBeTypeOf("number");
        expect(row.blueMatchBandVariance, String(row.matchKey)).toBeTypeOf("number");
        for (const key of RP_ROW_KEYS) expect(row, `${String(row.matchKey)} ${key}`).not.toHaveProperty(key);
      }
    }
  });

  it("the in-memory model arm — the live Worker's own path — prices to the same rows, with no block in sight", () => {
    // The tick never holds a `state` block: it deserializes D1 rows, folds, and
    // prices from the accumulators in its hand. This arm is that path, one
    // assertion away from the block arm above, so the extraction of
    // `priceUpcomingRows` cannot silently start meaning something else for one
    // of its two callers. Quick task 260923-3w6.
    const { publishedEvent, publishedTeam } = expectCaseParity({
      arm,
      upcoming: upcomingAll,
      eventType: ELIGIBLE,
      sortTimes: sortTimesAll,
      ruleModule: loadedRuleModule,
    });

    const rows = arm.rows;
    const model: UpcomingPricingModel = {
      algorithm: spr,
      state: deserializeState(spr.id, rows) as SprState,
      sigmaScores: SigmaScoreAccumulator.fromBeliefs(readSigmaBeliefs(rows), readSigmaPopulation(rows)).scoreByTeam(),
      ruleModule: loadedRuleModule,
      rp: RpMomentsAccumulator.fromBeliefs(loadedRuleModule!, readRpBeliefs(rows)),
      shift: RpMeanShiftAccumulator.fromState(loadedRuleModule!, readRpMeanShift(rows)),
    };
    const priced = priceUpcomingRows({
      model,
      eventKey: EVENT_KEY,
      season: SEASON,
      eventType: ELIGIBLE,
      upcoming: upcomingAll.map((m) => scheduleOnly(m, sortTimesAll.get(m.matchKey))),
    });

    expectExactRows(priced.event, publishedEvent);
    expectExactRows(priced.team, publishedTeam);
    // Non-vacuity: the arm really priced level-2 fields, not bare predictions.
    expect(priced.event[0]!.redMatchBandVariance).toBeTypeOf("number");
    expect(priced.event[0]!.redRpPmf).toBeDefined();
  });

  it("mean shift non-vacuity: every variable is past warmup, and dropping the passenger moves at least one warm qm pmf", () => {
    const block = wireBlock(buildEventStateBlock(arm.rows, rosterKeys(upcomingAll)));
    const shift = readRpMeanShift(block.rows);
    expect(shift).toBeDefined();
    expect(Object.keys(shift!.variables).sort()).toEqual(loadedRuleModule!.thresholdVariables.map((v) => v.name).sort());
    for (const [name, v] of Object.entries(shift!.variables)) {
      expect(v.count, name).toBeGreaterThanOrEqual(RP_MEAN_SHIFT_WARMUP_OBSERVATIONS);
      expect(v.sum, name).not.toBe(0);
    }

    const withShift = expectCaseParity({ arm, upcoming: upcomingAll, eventType: ELIGIBLE, sortTimes: sortTimesAll, ruleModule: loadedRuleModule, block });
    const unshiftedBlock: EventStateBlock = {
      ...block,
      rows: block.rows.map((row) => {
        if (row.scopeKind !== "league") return row;
        const parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
        delete parsed.sigmascoutRpMeanShift;
        return { ...row, stateJson: JSON.stringify(parsed) };
      }),
    };
    expect(readRpMeanShift(unshiftedBlock.rows)).toBeUndefined();
    const unshifted = priceUpcomingFromState({
      state: unshiftedBlock,
      eventKey: EVENT_KEY,
      season: SEASON,
      eventType: ELIGIBLE,
      ruleModule: loadedRuleModule,
      upcoming: upcomingAll.map((m) => scheduleOnly(m, sortTimesAll.get(m.matchKey))),
    });
    const moved = withheldQm.filter((_, i) => JSON.stringify(unshifted.event[i]!.redRpPmf) !== JSON.stringify(withShift.priced.event[i]!.redRpPmf));
    expect(moved.length).toBeGreaterThan(0);
  });

  it("independent rounding check: one warm row's band and pmf are the offline record's values rounded in the test", () => {
    const { records, priced } = expectCaseParity({ arm, upcoming: upcomingAll, eventType: ELIGIBLE, sortTimes: sortTimesAll, ruleModule: loadedRuleModule });
    const record = records[0]!;
    const row = priced.event[0]!;
    expect(record.matchBand?.red).toBeTypeOf("number");
    expect(row.redMatchBandVariance).toBe(roundTo(record.matchBand!.red!, ROUNDING_RULE.variance));
    expect(record.prediction.redRpPmf).toBeDefined();
    expect(row.redRpPmf).toEqual(roundPmf(record.prediction.redRpPmf!));
    // Really rounded, not passed through.
    expect(row.redMatchBandVariance).not.toBe(record.matchBand!.red);
  });

  describe("error contract", () => {
    const good = wireBlock(buildEventStateBlock(arm.rows, rosterKeys(upcomingAll)));
    const price = (state: EventStateBlock, ruleModule: RpRuleModule | undefined = loadedRuleModule) =>
      priceUpcomingFromState({
        state,
        eventKey: EVENT_KEY,
        season: SEASON,
        eventType: ELIGIBLE,
        ruleModule,
        upcoming: [scheduleOnly(upcomingAll[0]!, undefined)],
      });

    it("the unmodified block prices", () => {
      expect(price(good).event).toHaveLength(1);
    });

    it("algorithmVersion mismatch throws EventStateBlockError", () => {
      const stale = "3.0.0+stale";
      expect(() => price({ ...good, algorithmVersion: stale, rows: good.rows.map((r) => ({ ...r, algorithmVersion: stale })) })).toThrow(
        EventStateBlockError
      );
      // One row from another version is refused too.
      expect(() => price({ ...good, rows: good.rows.map((r, i) => (i === 1 ? { ...r, algorithmVersion: stale } : r)) })).toThrow(
        EventStateBlockError
      );
    });

    it("snapshotShapeVersion mismatch throws EventStateBlockError", () => {
      expect(() => price({ ...good, snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION - 1 })).toThrow(EventStateBlockError);
    });

    it("a missing league row throws EventStateBlockError, at read and at build time", () => {
      expect(() => price({ ...good, rows: good.rows.filter((r) => r.scopeKind !== "league") })).toThrow(EventStateBlockError);
      expect(() => buildEventStateBlock(arm.rows.filter((r) => r.scopeKind !== "league"), E_TEAMS)).toThrow(EventStateBlockError);
    });

    it("a rule module from another season throws RpRuleModuleSeasonMismatchError", () => {
      expect(RP_RULE_MODULES[2023]!.season).toBe(2023);
      expect(() => price(good, RP_RULE_MODULES[2023])).toThrow(RpRuleModuleSeasonMismatchError);
    });
  });
});

// ---------------------------------------------------------------------------
// Demo-key probe: one replay with a demo robot beside real teammates
// ---------------------------------------------------------------------------

const DEMO_TEAM = "frc9975";

describe("eventStatePricing parity: demo-key probe", () => {
  const firstEventQm = played.findIndex((m) => m.eventKey === EVENT_KEY && m.compLevel === "qm");
  const playedDemo = played.map((m, i) => (i === firstEventQm ? { ...m, redTeams: [DEMO_TEAM, ...m.redTeams.slice(1)] } : m));
  const demoQm: UpcomingMatch = {
    ...unseenQm,
    matchKey: `${EVENT_KEY}_qm902`,
    matchNumber: 902,
    redTeams: [DEMO_TEAM, E_TEAMS[5]!, E_TEAMS[6]!],
    blueTeams: [E_TEAMS[7]!, E_TEAMS[8]!, E_TEAMS[9]!],
  };
  const upcomingDemo = [...withheldQm.map(toUpcoming), demoQm];
  const demoIndex = upcomingDemo.length - 1;
  const sortTimes = sortTimesFor(upcomingDemo);
  const arm = runOfflineArm(playedDemo, upcomingDemo);
  const records = offlineRecords(arm, upcomingDemo);
  const publishedEvent = buildEventArtifact({
    eventKey: EVENT_KEY,
    season: SEASON,
    algorithmId: "spr",
    algorithmVersion: spr.version,
    predictions: [],
    upcoming: records,
    teams: [],
    generation: GENERATION,
    computedAt: COMPUTED_AT,
    sortTimeByMatchKey: sortTimes,
  }).upcoming;
  const block = wireBlock(buildEventStateBlock(arm.rows, rosterKeys(upcomingDemo)));
  const priced = priceUpcomingFromState({
    state: block,
    eventKey: EVENT_KEY,
    season: SEASON,
    eventType: demoQm.eventType,
    ruleModule: RP_RULE_MODULES[SEASON],
    upcoming: upcomingDemo.map((m) => scheduleOnly(m, sortTimes.get(m.matchKey))),
  });

  it("the probe is real: the demo robot played, and the block carries SPR's pseudo-team row AND the raw demo key's passenger-only row", () => {
    expect(firstEventQm).toBeGreaterThanOrEqual(0);
    expect(playedDemo[firstEventQm]!.redTeams).toContain(DEMO_TEAM);
    expect(block.rows.some((row) => row.scopeKey === DEMO_PSEUDO_TEAM_KEY)).toBe(true);
    // The raw key has no level-1 state (SPR keys it as the pseudo team), so its
    // row holds level-2 passengers and nothing else (quick task 260918-wfc).
    const demoRow = block.rows.find((row) => row.scopeKey === DEMO_TEAM);
    expect(demoRow, "the demo robot's beliefs did not reach the block").toBeDefined();
    expect(Object.keys(JSON.parse(demoRow!.stateJson) as object).every((key) => key.startsWith("sigmascout"))).toBe(true);
  });

  it("every row without the demo robot matches exactly, and the demo row's prediction fields match", () => {
    expectExactRows(priced.event.slice(0, demoIndex), publishedEvent.slice(0, demoIndex));
    const pricedDemo = priced.event[demoIndex]!;
    const offlineDemo = publishedEvent[demoIndex]!;
    for (const key of [
      "matchKey",
      "sortTime",
      "redTeams",
      "blueTeams",
      "predictedWinner",
      "pRedWin",
      "predictedRedScore",
      "predictedBlueScore",
      "redScoreVarianceOwn",
      "blueScoreVarianceOwn",
      "blueMatchBandVariance",
    ] as const) {
      expect(pricedDemo[key], key).toEqual(offlineDemo[key]);
    }
  });

  it("the demo row matches offline EXACTLY, band and ranking points included (the KNOWN GAP this pinned until 260918-wfc is closed)", () => {
    const offlineDemo = jsonNormal(publishedEvent[demoIndex]!) as Record<string, unknown>;
    // Non-vacuity: offline prices the demo alliance's band and the match's RP
    // from the raw demo key's beliefs, so equality below covers those fields.
    for (const key of ["redMatchBandVariance", ...RP_ROW_KEYS]) expect(offlineDemo, key).toHaveProperty(key);
    expectExactRows([priced.event[demoIndex]!], [publishedEvent[demoIndex]!]);
  });
});
