/**
 * THE REWOUND LOCKS VIEW'S AS-OF PLAN (quick task 261005-5g0): at a rewound
 * stop, which instant the model is rebuilt at, what every event with an open
 * category is simulated from, and every team's state at that instant. One pure
 * module plus one async loader, no React.
 *
 * JACOB'S RULE, which this module exists to keep: a rewound stop predicts every
 * match still ahead from the ratings and odds as they stood at that stop.
 * Nothing here reads a stored per row prediction, `teams[].metrics` or a baked
 * sidecar. A REAL event's remaining rows are priced in the Web Worker from the
 * as-of state; a GENERATED event is baked in the Web Worker over generated
 * schedules with the as-of pricer; draft and playoff ratings come from the
 * same pricer. An event whose as-of objects are not published is UNAVAILABLE at
 * the stop, never the old stored odds.
 *
 * ONE ORDER. The cut is a row of one event's INDEX, `(t, eventKey, i)` from its
 * `m` list (`asOfState.ts`). Which rows are still to play and which count
 * toward a baseline is decided by that same order (`asOfAtOrBefore`), never by
 * the event artifact's row order or the timeline's own comparison.
 *
 * THE STOP'S CUT. `cutAtPosition` names the position's own row; this module
 * reads its `[t, i]` from the INDEX. A stage step takes every later row of its
 * own event at the same instant too, so a stage final at the stop leaves none
 * of its own rows after the cut. A position with no played row of its own (an
 * event with no artifact, a scheduled row not played yet, a step placed after
 * every timed step) walks back to the nearest earlier position that has one:
 * the state at a future instant is the state after the last real fold before
 * it. A played row whose INDEX is unpublished, or lacks the row, makes the
 * whole stop unavailable: no exact instant exists to rebuild at.
 *
 * MODES, per event with an open category at the stop:
 *
 *   - REAL when the event has a folded row at or before the cut, or the stop
 *     is the position immediately before its first match (its Schedule stop):
 *     its real schedule is known then. Remaining qualification rows are its
 *     rows strictly after the cut; baselines are the actual RP of its rows at
 *     or before it (TBA's own final ranking once every qualification row is).
 *   - GENERATED otherwise, including an event unstarted even today, whose baked
 *     sidecar is NOT used when rewound: `bakeDistrictEvent` runs in the Worker
 *     with `scripts/publishDistricts.ts`'s own parameters.
 */
import {
  asOfAtOrBefore,
  AS_OF_SEASON_START_CUT,
  type AsOfCut,
  type AsOfIndex,
  type AsOfLeagueTuple,
  type AsOfLog,
  type AsOfSeason,
  type AsOfStart,
  type AsOfTeamTuple,
} from "../../../../../packages/harness/asOfState.js";
import { asOfCutAtMatch, AsOfResolveError, resolveAsOf } from "../../../../../packages/harness/asOfLookup.js";
import type { UpcomingMatch } from "../../../../../packages/core/algorithms/types.js";
import type { SimTeamBaseline } from "../../../../../packages/core/algorithms/simulation/rankSimulation.js";
import type { DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import type { DistrictArtifact, EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { buildQualRows } from "../../lib/simulationInputs.js";
import { cutAtPosition, firstMatchPositionIndex, type DistrictTimeline } from "./districtTimeline.js";
import { DISTRICT_CATEGORIES, tierEvents, type DistrictStageFinality } from "./districtLedgerRows.js";

// ---------------------------------------------------------------------------
// The stop's cut
// ---------------------------------------------------------------------------

export type AsOfStopCut =
  | { readonly status: "ok"; readonly cut: AsOfCut; readonly id: string }
  | { readonly status: "pending"; readonly missingIndexes: readonly string[] }
  | { readonly status: "unavailable"; readonly reason: string };

/** A cut's stable id, for the run signature: `start`, or `eventKey@t#i`. */
export function asOfCutId(cut: AsOfCut): string {
  return cut.t === Number.NEGATIVE_INFINITY ? "start" : `${cut.eventKey}@${String(cut.t)}#${String(cut.i)}`;
}

/**
 * The stop's as-of cut. `indexes` holds every INDEX fetched so far (`null` for
 * known unpublished); an anchor whose event is not in it yet reports
 * `pending` with that event.
 */
export function resolveStopCut(timeline: DistrictTimeline, positionIndex: number, indexes: ReadonlyMap<string, AsOfIndex | null>): AsOfStopCut {
  for (let p = positionIndex; p >= 0; p--) {
    const anchor = cutAtPosition(timeline, p);
    if (anchor === null) continue;
    if (anchor.kind === "seasonStart") return { status: "ok", cut: AS_OF_SEASON_START_CUT, id: asOfCutId(AS_OF_SEASON_START_CUT) };
    if (!anchor.played) continue;
    const index = indexes.get(anchor.eventKey);
    if (index === undefined) return { status: "pending", missingIndexes: [anchor.eventKey] };
    if (index === null) return { status: "unavailable", reason: `${anchor.eventKey} has no published INDEX` };
    const at = asOfCutAtMatch(index, anchor.matchKey);
    if (at === undefined) return { status: "unavailable", reason: `${anchor.matchKey} is not in ${anchor.eventKey}'s INDEX` };
    let i = at.i;
    if (anchor.stage) while (index.m[i + 1] !== undefined && index.m[i + 1]![1] === at.t) i++;
    const cut: AsOfCut = { eventKey: at.eventKey, t: at.t, i };
    return { status: "ok", cut, id: asOfCutId(cut) };
  }
  return { status: "ok", cut: AS_OF_SEASON_START_CUT, id: asOfCutId(AS_OF_SEASON_START_CUT) };
}

// ---------------------------------------------------------------------------
// One event's plan
// ---------------------------------------------------------------------------

/** What `bakeDistrictEvent` needs beyond the event input and the pricer, mirroring `scripts/publishDistricts.ts`'s call. */
export interface AsOfBakeParams {
  readonly districtKey: string;
  readonly eventType: number;
  readonly week: number | null;
  readonly matchesPerTeam: number;
}

interface AsOfEventPlanBase {
  readonly eventKey: string;
  readonly tier: DistrictTier;
  /** Every roster team, in the order its baselines are built. */
  readonly roster: readonly string[];
}

export interface AsOfRealPlan extends AsOfEventPlanBase {
  readonly mode: "real";
  /** The rows strictly after the cut, in `(t, eventKey, i)` order: folded rows by `i`, then rows not folded yet in row order. */
  readonly rows: readonly UpcomingMatch[];
  readonly baselines: readonly SimTeamBaseline[];
}

export interface AsOfGeneratedPlan extends AsOfEventPlanBase {
  readonly mode: "generated";
  readonly bake: AsOfBakeParams;
}

export type AsOfEventPlan = AsOfRealPlan | AsOfGeneratedPlan;

/**
 * `generatedSchedules.ts`'s `defaultMatchesPerTeam`, restated so the main bundle
 * does not carry the schedule generator for one comparison. `asOfRewind.test.ts`
 * pins the two equal.
 */
export function asOfDefaultMatchesPerTeam(eventType: number): number {
  return eventType === 3 ? 10 : 12;
}

/** TBA `event_type` for an event whose artifact names none: a district event, or the District Championship. */
function fallbackEventType(tier: DistrictTier): number {
  return tier === "dcmp" ? 2 : 1;
}

/** The district artifact's registrations for one event at one tier, sorted. */
export function districtRegistrations(districtArtifact: DistrictArtifact, eventKey: string, tier: DistrictTier): string[] {
  const out: string[] = [];
  for (const team of districtArtifact.teams) {
    if (tierEvents(team, tier).some((entry) => entry.eventKey === eventKey)) out.push(team.teamKey);
  }
  return out.sort();
}

type RawQualRow = EventArtifact["matches"][number] | EventArtifact["upcoming"][number];

/**
 * TBA's final qualification ranking as baselines, for a cut every
 * qualification row is at or before: `districtLedgerRows.ts`'s
 * `finishedQualBaselines` arithmetic, which the live view printed at that
 * moment too. Restated, not imported, because that function is module private
 * there and stays byte for byte as it is.
 */
function finalRankingBaselines(artifact: EventArtifact): SimTeamBaseline[] {
  return artifact.teams.map((team) => {
    if (team.rp === undefined) return { teamKey: team.teamKey, earnedRpSum: 0, matchesPlayed: 0 };
    const denominator = team.record === undefined ? 0 : team.record.wins + team.record.losses + team.record.ties;
    if (denominator <= 0) return { teamKey: team.teamKey, earnedRpSum: 0, matchesPlayed: 0 };
    return { teamKey: team.teamKey, earnedRpSum: Math.round(team.rp * denominator), matchesPlayed: denominator };
  });
}

export interface AsOfQualSplit {
  readonly rows: UpcomingMatch[];
  readonly baselines: SimTeamBaseline[];
}

/**
 * One event's qualification rows split at the cut, in the ONE order.
 *
 * Remaining: every row not at or before the cut, folded rows by their INDEX
 * row and then rows not folded yet in the artifact's own row order (a row
 * folded after the cut was played before any row still unplayed today).
 * Baselines: the summed actual RP of the rows at or before the cut, exactly as
 * `buildSimulationInputs`' rewind path sums it, over the artifact's teams plus
 * every team on a remaining row; or TBA's final ranking when no row remains.
 */
export function asOfQualSplit(params: {
  readonly eventKey: string;
  readonly tier: DistrictTier;
  readonly eventArtifact: EventArtifact;
  readonly index: AsOfIndex | null;
  readonly cut: AsOfCut;
  readonly week: number | null;
}): AsOfQualSplit {
  const { eventKey, eventArtifact, index, cut } = params;
  const rows = buildQualRows(eventArtifact);
  const rowByKey = new Map<string, number>();
  index?.m.forEach(([matchKey], i) => rowByKey.set(matchKey, i));
  const raw = new Map<string, RawQualRow>();
  for (const match of eventArtifact.upcoming) if (match.compLevel === "qm") raw.set(match.matchKey, match);
  for (const match of eventArtifact.matches) if (match.compLevel === "qm") raw.set(match.matchKey, match);

  const before: typeof rows = [];
  const foldedAfter: { row: (typeof rows)[number]; i: number }[] = [];
  const notFolded: typeof rows = [];
  for (const row of rows) {
    const i = rowByKey.get(row.matchKey);
    if (i === undefined) notFolded.push(row);
    else if (asOfAtOrBefore(eventKey, [index!.m[i]![1], i], cut)) before.push(row);
    else foldedAfter.push({ row, i });
  }
  foldedAfter.sort((a, b) => a.i - b.i);
  const remaining = [...foldedAfter.map((entry) => entry.row), ...notFolded];

  const eventType = eventArtifact.eventType ?? fallbackEventType(params.tier);
  const upcoming: UpcomingMatch[] = remaining.map((row) => ({
    matchKey: row.matchKey,
    eventKey,
    compLevel: "qm",
    setNumber: row.setNumber,
    matchNumber: row.matchNumber,
    redTeams: [...row.redTeams],
    blueTeams: [...row.blueTeams],
    redSurrogates: [],
    blueSurrogates: [],
    eventType,
    week: params.week,
  }));

  if (upcoming.length === 0) return { rows: upcoming, baselines: finalRankingBaselines(eventArtifact) };

  const appearances = new Map<string, number>();
  const counted = new Map<string, number>();
  const sums = new Map<string, number>();
  const accumulate = (teamKeys: readonly string[], actualRp: number | null | undefined): void => {
    for (const teamKey of teamKeys) {
      appearances.set(teamKey, (appearances.get(teamKey) ?? 0) + 1);
      if (typeof actualRp === "number") {
        sums.set(teamKey, (sums.get(teamKey) ?? 0) + actualRp);
        counted.set(teamKey, (counted.get(teamKey) ?? 0) + 1);
      }
    }
  };
  for (const row of before) {
    const played = raw.get(row.matchKey);
    if (played === undefined || !("actualWinner" in played)) continue;
    accumulate(row.redTeams, played.actualRedRp);
    accumulate(row.blueTeams, played.actualBlueRp);
  }

  const teamKeys = new Set<string>(eventArtifact.teams.map((team) => team.teamKey));
  for (const match of upcoming) for (const teamKey of [...match.redTeams, ...match.blueTeams]) teamKeys.add(teamKey);
  const baselines: SimTeamBaseline[] = [...teamKeys].map((teamKey) =>
    (appearances.get(teamKey) ?? 0) === 0
      ? { teamKey, earnedRpSum: 0, matchesPlayed: 0 }
      : { teamKey, earnedRpSum: sums.get(teamKey) ?? 0, matchesPlayed: counted.get(teamKey) ?? 0 }
  );
  return { rows: upcoming, baselines };
}

export interface PlanAsOfEventParams {
  readonly eventKey: string;
  readonly tier: DistrictTier;
  readonly week: number | null;
  readonly districtArtifact: DistrictArtifact;
  /** The event artifact, when the event has started today and it was fetched. */
  readonly eventArtifact: EventArtifact | undefined;
  /** The event's INDEX: `null` when known unpublished (or never folded), `undefined` when not fetched (an event unstarted today). */
  readonly index: AsOfIndex | null | undefined;
  readonly cut: AsOfCut;
  readonly timeline: DistrictTimeline;
  readonly positionIndex: number;
}

export type AsOfEventPlanResult = { readonly ok: true; readonly plan: AsOfEventPlan } | { readonly ok: false; readonly reason: string };

/** One event's mode, roster and rows at the cut. See this module's header. */
export function planAsOfEvent(params: PlanAsOfEventParams): AsOfEventPlanResult {
  const { eventKey, tier, eventArtifact, index, cut } = params;
  // A STARTED event (any played row today) must have its as-of objects: with
  // none, nothing it played can be rebuilt, and the stop shows it unavailable
  // rather than the stored odds.
  if (eventArtifact !== undefined && eventArtifact.matches.length > 0 && (index === null || index === undefined)) {
    return { ok: false, reason: `${eventKey} has played matches and no published INDEX` };
  }
  const foldedByCut = index !== null && index !== undefined && index.m.length > 0 && asOfAtOrBefore(eventKey, [index.m[0]![1], 0], cut);
  const firstMatch = firstMatchPositionIndex(params.timeline, eventKey);
  const atScheduleStop = firstMatch > 0 && params.positionIndex === firstMatch - 1;

  if (eventArtifact !== undefined && (foldedByCut || atScheduleStop)) {
    const split = asOfQualSplit({ eventKey, tier, eventArtifact, index: index ?? null, cut, week: params.week });
    return { ok: true, plan: { mode: "real", eventKey, tier, roster: split.baselines.map((baseline) => baseline.teamKey), rows: split.rows, baselines: split.baselines } };
  }

  // GENERATED: the roster is the event artifact's own team list for an event
  // started today, else the district artifact's registrations.
  const fromArtifact = eventArtifact?.teams.map((team) => team.teamKey) ?? [];
  const roster = fromArtifact.length > 0 ? [...fromArtifact].sort() : districtRegistrations(params.districtArtifact, eventKey, tier);
  const eventType = eventArtifact?.eventType ?? fallbackEventType(tier);
  return {
    ok: true,
    plan: {
      mode: "generated",
      eventKey,
      tier,
      roster,
      bake: {
        districtKey: params.districtArtifact.districtKey,
        eventType,
        week: params.week,
        // The real schedule is not known at this stop (that is what makes the
        // event GENERATED), so the publisher's no schedule branch applies.
        matchesPerTeam: asOfDefaultMatchesPerTeam(eventType),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// The loader
// ---------------------------------------------------------------------------

/** One event's as-of state at the stop: the plan, plus every tuple and the league its pricer is built from. */
export interface AsOfEventState {
  readonly plan: AsOfEventPlan;
  readonly season: number;
  readonly vars: readonly string[];
  readonly league: AsOfLeagueTuple;
  /** Every roster team's tuple, plus the demo pseudo team when the roster holds a demo key. Sorted by key. */
  readonly teams: readonly (readonly [string, AsOfTeamTuple])[];
}

export type AsOfEventOutcome = { readonly status: "ready"; readonly state: AsOfEventState } | { readonly status: "unavailable"; readonly reason: string };

export type AsOfRewindResult =
  | { readonly status: "ready"; readonly cutId: string; readonly events: ReadonlyMap<string, AsOfEventOutcome> }
  /** No exact instant exists for the stop: every candidate event is unavailable. */
  | { readonly status: "unavailable"; readonly reason: string };

export interface AsOfFetchers {
  index(eventKey: string): Promise<AsOfIndex | null>;
  log(eventKey: string): Promise<AsOfLog | null>;
  season(): Promise<AsOfSeason | null>;
  start(): Promise<AsOfStart | null>;
}

export interface AsOfRewindInput {
  readonly districtArtifact: DistrictArtifact;
  readonly timeline: DistrictTimeline;
  readonly positionIndex: number;
  /** Every fetched event artifact: the events started today. Each one's INDEX is fetched up front. */
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  /** The stage at the stop, per event. */
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  /** The events this tab may simulate, with their tier and week. Only those with an open category at the stop are planned. */
  readonly candidates: readonly { readonly eventKey: string; readonly tier: DistrictTier; readonly week: number | null }[];
}

/** An upper bound on fetch rounds: each round fetches every object the previous resolve named, and a walk crosses a handful of events. */
const MAX_RESOLVE_ROUNDS = 32;

/** The events with at least one open category at the stop, in key order. */
export function asOfCandidateEvents(input: Pick<AsOfRewindInput, "candidates" | "stageByEvent">): AsOfRewindInput["candidates"] {
  return input.candidates
    .filter((candidate) => {
      const stage = input.stageByEvent.get(candidate.eventKey);
      return stage !== undefined && DISTRICT_CATEGORIES.some((category) => !stage[category]);
    })
    .slice()
    .sort((a, b) => (a.eventKey < b.eventKey ? -1 : a.eventKey > b.eventKey ? 1 : 0));
}

/**
 * Fetches what the stop needs and resolves every planned event's roster:
 * the season object and every fetched event's INDEX first, then whatever
 * `resolveAsOf` names (other events' INDEX, logs of events in progress at the
 * cut, the season start object only when a team needs it), until nothing is
 * missing. Per event failure is isolated: one event whose walk cannot finish is
 * unavailable and the others still resolve.
 */
export async function loadAsOfRewind(input: AsOfRewindInput, fetchers: AsOfFetchers): Promise<AsOfRewindResult> {
  const indexes = new Map<string, AsOfIndex | null>();
  const logs = new Map<string, AsOfLog | null>();
  let start: AsOfStart | null | undefined;

  const fetchSet = [...input.eventArtifacts.keys()].sort();
  const [season, fetched] = await Promise.all([fetchers.season(), Promise.all(fetchSet.map((eventKey) => fetchers.index(eventKey)))]);
  fetchSet.forEach((eventKey, n) => indexes.set(eventKey, fetched[n]!));
  if (season === null) return { status: "unavailable", reason: "the season object is not published" };

  let stop = resolveStopCut(input.timeline, input.positionIndex, indexes);
  for (let round = 0; stop.status === "pending" && round < MAX_RESOLVE_ROUNDS; round++) {
    const missing = stop.missingIndexes;
    const loaded = await Promise.all(missing.map((eventKey) => fetchers.index(eventKey)));
    missing.forEach((eventKey, n) => indexes.set(eventKey, loaded[n]!));
    stop = resolveStopCut(input.timeline, input.positionIndex, indexes);
  }
  if (stop.status !== "ok") return { status: "unavailable", reason: stop.status === "pending" ? "the stop's INDEX did not load" : stop.reason };
  const cut = stop.cut;

  const outcomes = new Map<string, AsOfEventOutcome>();
  const pending = new Map<string, AsOfEventPlan>();
  for (const candidate of asOfCandidateEvents(input)) {
    const planned = planAsOfEvent({
      eventKey: candidate.eventKey,
      tier: candidate.tier,
      week: input.eventArtifacts.get(candidate.eventKey)?.week ?? candidate.week,
      districtArtifact: input.districtArtifact,
      eventArtifact: input.eventArtifacts.get(candidate.eventKey),
      index: indexes.get(candidate.eventKey),
      cut,
      timeline: input.timeline,
      positionIndex: input.positionIndex,
    });
    if (!planned.ok) outcomes.set(candidate.eventKey, { status: "unavailable", reason: planned.reason });
    else pending.set(candidate.eventKey, planned.plan);
  }

  for (let round = 0; pending.size > 0 && round < MAX_RESOLVE_ROUNDS; round++) {
    const missingIndexes = new Set<string>();
    const missingLogs = new Set<string>();
    let missingStart = false;
    for (const [eventKey, plan] of pending) {
      try {
        const result = resolveAsOf({
          cut,
          teams: plan.roster.map((teamKey) => ({ teamKey, knownEventKeys: fetchSet })),
          season,
          indexes,
          logs,
          start,
        });
        if (result.missingIndexes.length > 0 || result.missingLogs.length > 0 || result.missingStart || result.league === undefined) {
          for (const key of result.missingIndexes) missingIndexes.add(key);
          for (const key of result.missingLogs) missingLogs.add(key);
          if (result.missingStart) missingStart = true;
          if (result.missingIndexes.length === 0 && result.missingLogs.length === 0 && !result.missingStart) {
            // Nothing left to fetch and still no league: a Worker created
            // season object carries no `L0`, so the season start cannot be priced.
            outcomes.set(eventKey, { status: "unavailable", reason: "no league row at the cut" });
            pending.delete(eventKey);
          }
          continue;
        }
        const teams = [...result.states].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        outcomes.set(eventKey, { status: "ready", state: { plan, season: season.season, vars: season.vars, league: result.league, teams } });
        pending.delete(eventKey);
      } catch (error) {
        if (!(error instanceof AsOfResolveError)) throw error;
        outcomes.set(eventKey, { status: "unavailable", reason: error.message });
        pending.delete(eventKey);
      }
    }
    if (pending.size === 0) break;
    const indexKeys = [...missingIndexes].filter((key) => !indexes.has(key));
    const logKeys = [...missingLogs].filter((key) => !logs.has(key));
    const [loadedIndexes, loadedLogs, loadedStart] = await Promise.all([
      Promise.all(indexKeys.map((key) => fetchers.index(key))),
      Promise.all(logKeys.map((key) => fetchers.log(key))),
      missingStart && start === undefined ? fetchers.start() : Promise.resolve(start),
    ]);
    indexKeys.forEach((key, n) => indexes.set(key, loadedIndexes[n]!));
    logKeys.forEach((key, n) => logs.set(key, loadedLogs[n]!));
    start = loadedStart;
  }
  for (const eventKey of pending.keys()) outcomes.set(eventKey, { status: "unavailable", reason: "the as-of walk did not finish" });

  return { status: "ready", cutId: stop.id, events: outcomes };
}
