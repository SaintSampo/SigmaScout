/**
 * TEST-ONLY FIXTURE. Imported only by tests (the web-layer pricing parity
 * test and the local pricing fixture test); never bundled, never imported by
 * a browser module. It reads the committed digest slice from disk and drives
 * the Node publisher, so it could not be bundled even by accident.
 *
 * Builds a REAL offline SPR event artifact with a `state` block, the way
 * `publish.ts` builds one, from the committed 2022 digest slice:
 *
 * - a walk-forward replay collecting each match's talent;
 * - `SigmaScoutLayer.foldPlayed` over every played record, in order;
 * - the seed rows: `serializeState`, then every level-2 passenger in
 *   `publish.ts`'s order;
 * - `layer.enrichUpcoming(m, spr.predict(finalState, m))` for each withheld match;
 * - `buildEventArtifact` with `stateRows`, so the block is the publisher's.
 *
 * This mirrors the offline arm of `eventStatePricing.parity.test.ts` (left
 * unmodified). The slice's last event withholds its final 12 qualification
 * matches and every playoff match, which become `upcoming`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MatchResult, UpcomingMatch } from "../../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../../core/algorithms/types.js";
import { spr, type SprState } from "../../core/algorithms/spr.js";
import { isDemoTeamKey } from "../../core/algorithms/demoTeams.js";
import { RP_RULE_MODULES } from "../../core/rankingPoints/rules.js";
import { WalkForwardSimulator } from "../replay.js";
import { SigmaScoutLayer } from "../sigmaScoutLayer.js";
import { buildEventArtifact, buildTeamSeasonArtifact, eventScheduleIsCurrent } from "../publish.js";
import { usesSigmaScore } from "../sigmaScore.js";
import { serializeState, withRpBeliefs, withRpMeanShift, withSigmaBeliefs, withSigmaPopulation, type StateRow } from "../stateSnapshot.js";
import type { EventArtifact, TeamSeasonMatch } from "../pageArtifacts.js";

interface DigestSliceFixture {
  sliceSeason: number;
  matches: MatchResult[];
}

export const FIXTURE_SEASON = 2022;
export const FIXTURE_GENERATION = "fixture-gen";
/** The fixture's publish instant. Upcoming `sortTime`s are epoch ms just after it, so `eventScheduleIsCurrent` holds. */
export const FIXTURE_COMPUTED_AT = "2022-04-09T12:00:00.000Z";

export interface OfflineEventArtifactWithBlock {
  /** The JSON round-tripped offline artifact, `state` included. */
  readonly artifact: EventArtifact;
  /** The offline publisher's team-season row for every upcoming match, by match key. */
  readonly offlineTeamRowsByMatchKey: ReadonlyMap<string, TeamSeasonMatch>;
  /** The season-final seed rows the block was cut from. */
  readonly stateRows: readonly StateRow[];
}

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

let cached: OfflineEventArtifactWithBlock | undefined;

/** Built once per test process (the replay is the expensive part); every caller gets a fresh JSON copy. */
export function buildOfflineEventArtifactWithBlock(): OfflineEventArtifactWithBlock {
  cached ??= build();
  return {
    artifact: JSON.parse(JSON.stringify(cached.artifact)) as EventArtifact,
    offlineTeamRowsByMatchKey: new Map([...cached.offlineTeamRowsByMatchKey].map(([k, v]) => [k, JSON.parse(JSON.stringify(v)) as TeamSeasonMatch])),
    stateRows: cached.stateRows,
  };
}

function build(): OfflineEventArtifactWithBlock {
  const fixturePath = fileURLToPath(new URL("./digest-slice.json", import.meta.url));
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as DigestSliceFixture;
  if (fixture.sliceSeason !== FIXTURE_SEASON) throw new Error(`digest slice is season ${fixture.sliceSeason}, expected ${FIXTURE_SEASON}`);

  const eventKey = fixture.matches[fixture.matches.length - 1]!.eventKey;
  const eventMatches = fixture.matches.filter((m) => m.eventKey === eventKey);
  const withheldQm = eventMatches.filter((m) => m.compLevel === "qm").slice(-12);
  const withheldPlayoff = eventMatches.filter((m) => m.compLevel !== "qm");
  const withheldKeys = new Set([...withheldQm, ...withheldPlayoff].map((m) => m.matchKey));
  const played = fixture.matches.filter((m) => !withheldKeys.has(m.matchKey));
  const upcoming = [...withheldQm, ...withheldPlayoff].map(toUpcoming);
  const eventType = eventMatches[0]!.eventType;

  // --- The offline arm, as publish.ts drives SPR and its level-2 layer ---
  const teams = Array.from(new Set([...rosterKeys(played), ...rosterKeys(upcoming)])).filter((k) => !isDemoTeamKey(k));
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
  const layer = new SigmaScoutLayer(RP_RULE_MODULES[FIXTURE_SEASON], "spr");
  const eventPredictions = [];
  for (const r of records) {
    const folded = layer.foldPlayed(r.match, r.prediction, talentAfterMatch.get(`${r.algorithmId}:${r.match.matchKey}`));
    if (r.match.eventKey === eventKey) eventPredictions.push({ ...folded, ...(r.coldStart === true ? { coldStart: true as const } : {}) });
  }
  const finalState = records.finalStates.get("spr") as SprState;

  const stamp = { generation: FIXTURE_GENERATION, computedAt: FIXTURE_COMPUTED_AT };
  let stateRows = withRpBeliefs(withSigmaBeliefs(serializeState("spr", spr.version, finalState, stamp), layer.sigmaBeliefs()), layer.rpVariableBeliefs());
  const sigmaPopulation = layer.sigmaPopulation();
  if (sigmaPopulation !== undefined) stateRows = withSigmaPopulation(stateRows, sigmaPopulation);
  const rpMeanShift = layer.rpMeanShiftState();
  if (rpMeanShift !== undefined) stateRows = withRpMeanShift(stateRows, rpMeanShift);

  const upcomingRecords = upcoming.map((m) => layer.enrichUpcoming(m, spr.predict(finalState, m)));

  // Every other upcoming match carries an epoch-ms sort time just after the publish instant; the rest carry none.
  const computedAtMs = Date.parse(FIXTURE_COMPUTED_AT);
  const sortTimeByMatchKey = new Map<string, number>();
  upcoming.forEach((m, i) => {
    if (i % 2 === 0) sortTimeByMatchKey.set(m.matchKey, computedAtMs + (i + 1) * 8 * 60_000);
  });
  if (!eventScheduleIsCurrent({ scheduledTimes: [...sortTimeByMatchKey.values()], startDate: undefined, computedAt: FIXTURE_COMPUTED_AT })) {
    throw new Error("fixture schedule is not current; the publisher would attach no block");
  }

  const built = buildEventArtifact({
    eventKey,
    season: FIXTURE_SEASON,
    algorithmId: "spr",
    algorithmVersion: spr.version,
    predictions: eventPredictions,
    upcoming: upcomingRecords,
    teams: [],
    generation: FIXTURE_GENERATION,
    computedAt: FIXTURE_COMPUTED_AT,
    sortTimeByMatchKey,
    eventType,
    stateRows: () => stateRows,
  });
  const artifact = JSON.parse(JSON.stringify(built)) as EventArtifact;
  if (artifact.state === undefined) throw new Error("fixture artifact carries no state block; the parity would pass vacuously");

  // One synthetic team whose single event lists every upcoming record, as the parity test builds offline team rows.
  const teamRows = buildTeamSeasonArtifact({
    teamKey: "frc1",
    teamNumber: 1,
    nickname: "Parity",
    season: FIXTURE_SEASON,
    algorithmId: "spr",
    algorithmVersion: spr.version,
    seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {}, metricsBasis: "season-final" },
    events: [{ eventKey, eventName: eventKey, startDate: "2022-04-07", matches: upcomingRecords }],
    metricHistory: [],
    generation: FIXTURE_GENERATION,
    computedAt: FIXTURE_COMPUTED_AT,
    sortTimeByMatchKey,
  }).events[0]!.matches;
  const offlineTeamRowsByMatchKey = new Map(teamRows.map((row) => [row.matchKey, JSON.parse(JSON.stringify(row)) as TeamSeasonMatch]));

  return { artifact, offlineTeamRowsByMatchKey, stateRows };
}

/** The Worker's upcoming-row shape since 260915-isq: schedule fields only. */
export function toScheduleOnly<T extends { upcoming: readonly object[] }>(artifact: T): T {
  if ((artifact as { state?: unknown }).state === undefined) {
    throw new Error("toScheduleOnly: the artifact carries no state block, so a parity built on it would pass vacuously");
  }
  return {
    ...artifact,
    upcoming: artifact.upcoming.map((raw) => {
      const row = raw as { matchKey: string; compLevel: string; setNumber: number; matchNumber: number; sortTime?: number; redTeams: string[]; blueTeams: string[] };
      return {
        matchKey: row.matchKey,
        compLevel: row.compLevel,
        setNumber: row.setNumber,
        matchNumber: row.matchNumber,
        ...(row.sortTime !== undefined ? { sortTime: row.sortTime } : {}),
        redTeams: [...row.redTeams],
        blueTeams: [...row.blueTeams],
      };
    }),
  };
}
