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
import { isDemoTeamKey } from "../core/algorithms/demoTeams.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { WalkForwardSimulator } from "./replay.js";
import { SigmaScoutLayer, type UpcomingLayerRecord } from "./sigmaScoutLayer.js";
import { buildEventArtifact, resolvePublishAlgorithms } from "./publish.js";
import { usesSigmaScore } from "./sigmaScore.js";
import {
  serializeState,
  withRpBeliefs,
  withRpMeanShift,
  withSigmaBeliefs,
  withSigmaPopulation,
  type StateRow,
} from "./stateSnapshot.js";
import { EventStateBlockSchema, type EventStateBlock, type EventStateBlockRow } from "./pageArtifacts.js";
import { buildEventStateBlock, priceUpcomingFromState, type ScheduledMatchInput } from "./eventStatePricing.js";

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
