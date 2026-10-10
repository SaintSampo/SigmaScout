/**
 * THE DISTRICT RUN'S REQUEST ASSEMBLY (quick task 261005-5g0, moved out of
 * `useDistrictLedgerData.ts` unchanged): the Live assembly, a rewound stop's
 * as-of assembly and the run signature both key on. Pure, no React, so the web
 * truncation test (`scripts/asOfRewindWeb.test.ts`) runs it in node.
 *
 * THE CHAMP LOCKS DCMP BAKE IS A SECOND REQUEST (quick task 261007-mxf).
 * `assembleSimulatedDcmpBake` builds ONE generated championship over the
 * Locked plus In range field at a rewound stop, posted through its own
 * `useDistrictSimulationRun` instance. Its roster is a function of the main
 * run's OUTPUT (per event run, district chance run, district line), so folding
 * it into the main request would move that request's signature the moment the
 * roster landed and re-run every district event, and would make the district
 * run's own pending state wait on its downstream. The main run keeps skipping
 * the unstarted championship; only a roster or stop change re-bakes.
 */
import { buildQualRows } from "../../lib/simulationInputs.js";
import {
  DISTRICT_CATEGORIES,
  awardProfileOrZero,
  buildDistrictEventSimulationInput,
  distributionsFromPreSim,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import {
  MAX_DISTRICT_SIMULATION_ROSTER,
  type DistrictAsOfBlock,
  type DistrictSimulationEventEntry,
  type DistrictSimulationEventRequest,
} from "../../workers/districtSimulationProtocol.js";
import type { AsOfBakeParams, AsOfRewindResult } from "./asOfRewind.js";
import type { SimulatedDcmpBake } from "./champLedgerRows.js";
import type { DistrictLedgerEventInput } from "../../../../../packages/core/districts/ledgerSimulation.js";
import type { DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import type { DistrictArtifact, EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/** The published algorithm the joint run reads its ranking-point pmfs from. */
export const DISTRICT_LEDGER_ALGORITHM_ID = "spr";

/** The "now" start key: the first genuinely unplayed qualification row, or `null` when every row is played. */
function defaultStartKey(artifact: EventArtifact): string | null {
  const rows = buildQualRows(artifact);
  return rows.find((row) => !row.played)?.matchKey ?? null;
}

/** An absent optional member, distinguishable from a present-but-empty one. */
const SIGNATURE_ABSENT = "-";

/** One known-points map folded to its SORTED `key=value` pairs — the VALUES, never their presence. */
function foldKnownPoints(known: ReadonlyMap<string, number> | undefined): string {
  if (known === undefined) return SIGNATURE_ABSENT;
  return [...known]
    .map(([teamKey, value]) => `${teamKey}=${String(value)}`)
    .sort()
    .join(",");
}

/** One supplied alliance set folded to its rosters, sorted by alliance number. */
function foldKnownAlliances(alliances: DistrictLedgerEventInput["knownAlliances"]): string {
  if (alliances === undefined) return SIGNATURE_ABSENT;
  return [...alliances]
    .map((alliance) => `${String(alliance.allianceNumber)}:${alliance.picks.join("+")}`)
    .sort()
    .join(",");
}

/** The ranking inputs folded per team, so a score correction that leaves the row COUNT unchanged still moves the signature. */
function foldBaselines(baselines: DistrictLedgerEventInput["baselines"]): string {
  return baselines.map((baseline) => `${baseline.teamKey}=${String(baseline.earnedRpSum)}/${String(baseline.matchesPlayed)}`).join(",");
}

/**
 * The played elimination rows folded to their VALUES, sorted.
 *
 * WHY IT IS IN THE SIGNATURE AT ALL. An elimination match being played changes
 * nothing else in this input: the baselines are qualification-only, the rosters
 * are unchanged and the four stage booleans do not move until the whole bracket
 * is done. So a signature blind to these rows would leave the Playoffs cell
 * printing the chance of reaching the top four for an alliance that had already
 * won the semifinal, for as long as the tab stayed open — which is exactly the
 * staleness this function exists to prevent, one stage later.
 */
function foldPlayedElims(matches: DistrictLedgerEventInput["playedElimMatches"]): string {
  if (matches === undefined) return SIGNATURE_ABSENT;
  return [...matches]
    .map((match) => `${match.compLevel}${String(match.setNumber)}m${String(match.matchNumber)}=${String(match.winningAllianceNumber)}`)
    .sort()
    .join(",");
}

/**
 * The string `useDistrictSimulationRun` keys its effect on: everything a run's
 * OUTPUT depends on, folded to its VALUES.
 *
 * WHY VALUES AND NOT PRESENCE. The district artifact refetches on a 60 second
 * floor while any member event is live (`lib/api/districts.ts`'s
 * `refetchInterval`), and the live window is the whole point of this tab. A
 * signature built from `knownElimPoints !== undefined` cannot see an award
 * being posted, an alliance roster being corrected, a score correction that
 * revises the baselines without changing the row count, or `allianceCount`
 * moving at all — every one of which changes the distributions the cells
 * print. The run would not re-fire and the tab would go quietly stale in
 * exactly the minutes it exists for.
 *
 * DETERMINISTIC AND EXACT, not hashed. Each map is folded to its sorted
 * `key=value` pairs so two equal inputs always produce one string, and no
 * collision can silently suppress a re-run. It is recomputed inside the same
 * `useMemo` that already walks every roster, so it costs one more pass over
 * data already in hand.
 *
 * Exported for its own test: the staleness this closes is invisible to a
 * render test and only a direct assertion on this string can pin it.
 *
 * A registration arriving mid event changes the award only list and must re
 * run the event, so that list is folded as a TENTH segment, and only when the
 * input carries one: every signature without it is byte for byte unchanged
 * (quick task 260927-vmb).
 */
export function districtRunSignature(events: readonly DistrictSimulationEventRequest[]): string {
  return events
    .map((event) => {
      const input = event.input;
      return [
        event.eventKey,
        String(input.remainingMatches.length),
        String(input.allianceCount),
        String(input.fieldSize),
        foldBaselines(input.baselines),
        foldKnownAlliances(input.knownAlliances),
        foldKnownPoints(input.knownElimPoints),
        foldKnownPoints(input.knownAwardPoints),
        foldPlayedElims(input.playedElimMatches),
        ...(input.awardOnlyTeams === undefined ? [] : [`awardOnly=${input.awardOnlyTeams.join(",")}`]),
        // A REWOUND STOP (quick task 261005-5g0): the cut, the mode and what
        // the Worker prices or bakes, so a stop change always re-runs. Only an
        // as-of request carries it, so every Live signature is unchanged.
        ...(event.asOf === undefined ? [] : [foldAsOf(event.asOf)]),
      ].join("|");
    })
    .join(";");
}

/** An as-of block folded to the values a run's output depends on beyond the cut's own state: the cut, the mode, the rows or the bake parameters. */
function foldAsOf(block: DistrictAsOfBlock): string {
  const tail =
    block.mode === "real"
      ? (block.rows ?? []).map((row) => row.matchKey).join(",")
      : block.bake === undefined
        ? SIGNATURE_ABSENT
        : `${block.bake.algorithmVersion}/${String(block.bake.eventType)}/${String(block.bake.matchesPerTeam)}/${String(block.bake.week)}`;
  return `asOf=${block.cutId}:${block.mode}:${tail}`;
}

/** What one assembly hands the run and the gap lists. */
export interface AssembledDistrictEvents {
  readonly events: DistrictSimulationEventRequest[];
  readonly signature: string;
  readonly eventsWithExcludedMatches: string[];
  readonly eventsWithFallbackFieldSize: string[];
  readonly eventsWithPartialAllianceList: string[];
  readonly eventsWithUnresolvedElimMatches: string[];
  /** Events a rewound stop could not rebuild (as-of objects unpublished or unreadable), shown unavailable. Always empty at Live. */
  readonly asOfUnavailable: { readonly eventKey: string; readonly name: string }[];
}

/** The builder's `pointsFinal` for one event, or nothing where the caller supplied none for it. */
function pointsFinalFor(pointsFinalByEvent: ReadonlyMap<string, DistrictStageFinality> | undefined, eventKey: string): { pointsFinal?: DistrictStageFinality } {
  const pointsFinal = pointsFinalByEvent?.get(eventKey);
  return pointsFinal === undefined ? {} : { pointsFinal };
}

export interface AssembleLiveDistrictEventsParams {
  readonly artifact: DistrictArtifact;
  readonly activeKeys: readonly string[];
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  /** What has happened on the FIELD at the position, per event (the state's own reading). */
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  /**
   * Which of TBA's NUMBERS are final at the position, per event (quick task
   * 261009-vp9). Handed to the input builder as `pointsFinal`. Absent, or
   * absent for one event, the builder reads the field's stage, as shipped.
   */
  readonly pointsFinalByEvent?: ReadonlyMap<string, DistrictStageFinality>;
  readonly startMatchKeyByEvent?: ReadonlyMap<string, string | null>;
  readonly tierByEvent?: ReadonlyMap<string, DistrictTier>;
}

/**
 * THE SHIPPED ASSEMBLY, moved out of the hook's `useMemo` verbatim so the Live
 * request list is pinned by a test against a frozen copy of the code it came
 * from (quick task 261005-5g0): Live must stay byte for byte what it was.
 */
export function assembleLiveDistrictEvents(params: AssembleLiveDistrictEventsParams): AssembledDistrictEvents {
  const { artifact, activeKeys, eventArtifacts, stageByEvent, pointsFinalByEvent, startMatchKeyByEvent, tierByEvent } = params;
  const events: DistrictSimulationEventRequest[] = [];
  const eventsWithExcludedMatches: string[] = [];
  const eventsWithFallbackFieldSize: string[] = [];
  const eventsWithPartialAllianceList: string[] = [];
  const eventsWithUnresolvedElimMatches: string[] = [];
  for (const eventKey of activeKeys) {
    const eventArtifact = eventArtifacts.get(eventKey);
    if (eventArtifact === undefined) continue;
    const stage = stageByEvent.get(eventKey);
    if (stage === undefined) continue;
    // An event with NO open category at this position costs no simulation,
    // however it got into the fetch set.
    if (DISTRICT_CATEGORIES.every((category) => stage[category])) continue;
    const startMatchKey = startMatchKeyByEvent?.has(eventKey)
      ? (startMatchKeyByEvent.get(eventKey) ?? null)
      : defaultStartKey(eventArtifact);
    const built = buildDistrictEventSimulationInput({
      eventKey,
      season: artifact.year,
      eventArtifact,
      districtArtifact: artifact,
      stage,
      startMatchKey,
      // ONLY THE LIVE POSITION may condition the bracket on played matches.
      // No tab supplies `startMatchKeyByEvent` any more (a rewound stop takes
      // `assembleAsOfDistrictEvents` since quick task 261005-5g0), so in the
      // app it is always absent here and this is always "now". A caller that
      // passes it (the frozen-copy parity tests) asks for the retired stored
      // odds rewind, whose playoff step is all-or-nothing by construction.
      conditionOnPlayedElims: startMatchKeyByEvent === undefined,
      tier: tierByEvent?.get(eventKey) ?? "district",
      // The number reading, beside the field's `stage` (quick task
      // 261009-vp9). Absent keeps this the frozen copy's own call.
      ...pointsFinalFor(pointsFinalByEvent, eventKey),
    });
    if (!built.ok) continue;
    if (built.excludedMatchCount > 0) eventsWithExcludedMatches.push(eventKey);
    if (built.fieldSizeFellBack) eventsWithFallbackFieldSize.push(eventKey);
    if (built.allianceListIsPartial) eventsWithPartialAllianceList.push(eventKey);
    if (built.unresolvedElimMatchKeys.length > 0) eventsWithUnresolvedElimMatches.push(eventKey);
    events.push({ eventKey, input: built.input });
  }
  return {
    events,
    signature: districtRunSignature(events),
    eventsWithExcludedMatches,
    eventsWithFallbackFieldSize,
    eventsWithPartialAllianceList,
    eventsWithUnresolvedElimMatches,
    asOfUnavailable: [],
  };
}

/** The `name` an event the rewound stop could not rebuild carries in `unavailableEvents`. */
export const AS_OF_UNAVAILABLE_NAME = "AsOfStateUnavailable";

/** The bracket a GENERATED event is baked at: `scripts/publishDistricts.ts` passes eight for every bake. */
const AS_OF_BAKE_ALLIANCE_COUNT = 8;

/** The as-of block members every event at one stop shares: the cut and the state the pricer is built from. */
type AsOfCommon = Pick<DistrictAsOfBlock, "cutId" | "season" | "vars" | "league" | "teams">;

/**
 * ONE GENERATED request: the publisher's bake shape (zero RP baselines, the
 * roster's size as the field, eight alliances) with the stop's as-of block.
 * Shared by `assembleAsOfDistrictEvents` and `assembleSimulatedDcmpBake`, so
 * the Champ Locks DCMP bake is built exactly as any unstarted event is.
 *
 * `undefined` for an empty roster, and for one longer than
 * `MAX_DISTRICT_SIMULATION_ROSTER`: the Worker refuses a request carrying such
 * an event as MALFORMED, which would cost every event in the request, not just
 * this one (quick task 261007-mxf). The caller reads it unavailable instead.
 */
function generatedRequest(params: {
  readonly artifact: DistrictArtifact;
  readonly districtTeamByKey: ReadonlyMap<string, DistrictArtifact["teams"][number]>;
  readonly eventKey: string;
  readonly tier: DistrictTier;
  readonly roster: readonly string[];
  readonly common: AsOfCommon;
  readonly bake: AsOfBakeParams;
  readonly algorithmVersion: string;
}): DistrictSimulationEventRequest | undefined {
  const { artifact, districtTeamByKey, eventKey, tier, roster } = params;
  if (roster.length === 0 || roster.length > MAX_DISTRICT_SIMULATION_ROSTER) return undefined;
  const awardProfiles = new Map(roster.map((teamKey) => [teamKey, awardProfileOrZero(districtTeamByKey.get(teamKey))] as const));
  const input: DistrictLedgerEventInput = {
    eventKey,
    season: artifact.year,
    tier,
    // The REGISTERED roster size, as the publisher's bake passes it.
    fieldSize: roster.length,
    allianceCount: AS_OF_BAKE_ALLIANCE_COUNT,
    remainingMatches: [],
    baselines: roster.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 })),
    ratings: new Map(),
    awardProfiles,
  };
  return {
    eventKey,
    input,
    asOf: { ...params.common, mode: "generated", bake: { ...params.bake, algorithmId: DISTRICT_LEDGER_ALGORITHM_ID, algorithmVersion: params.algorithmVersion } },
  };
}

export interface AssembleAsOfDistrictEventsParams {
  readonly artifact: DistrictArtifact;
  readonly result: AsOfRewindResult;
  readonly algorithmVersion: string;
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  /** What has happened on the FIELD at the stop, per event. */
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  /** Which of TBA's NUMBERS are final at the stop, per event (quick task 261009-vp9). See `AssembleLiveDistrictEventsParams`. */
  readonly pointsFinalByEvent?: ReadonlyMap<string, DistrictStageFinality>;
  readonly tierByEvent?: ReadonlyMap<string, DistrictTier>;
  /** Events the caller has no use for at this stop (the Champ Locks tab's DCMP before its field is a fact). */
  readonly skipEventKeys?: ReadonlySet<string>;
  /** The events the stop would simulate, so an unavailable stop can name each one. */
  readonly candidateKeys: readonly string[];
}

/**
 * A REWOUND STOP'S REQUESTS (quick task 261005-5g0): one per event the as-of
 * plan readied, REAL events first and GENERATED after (the slow ones), each
 * group in key order, so the fast events land first.
 */
export function assembleAsOfDistrictEvents(params: AssembleAsOfDistrictEventsParams): AssembledDistrictEvents {
  const { artifact, result, eventArtifacts, stageByEvent, tierByEvent, skipEventKeys } = params;
  const real: DistrictSimulationEventRequest[] = [];
  const generated: DistrictSimulationEventRequest[] = [];
  const eventsWithFallbackFieldSize: string[] = [];
  const eventsWithPartialAllianceList: string[] = [];
  const eventsWithUnresolvedElimMatches: string[] = [];
  const asOfUnavailable: { eventKey: string; name: string }[] = [];
  const districtTeamByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));

  if (result.status === "unavailable") {
    for (const eventKey of params.candidateKeys) if (skipEventKeys?.has(eventKey) !== true) asOfUnavailable.push({ eventKey, name: AS_OF_UNAVAILABLE_NAME });
  } else {
    for (const [eventKey, outcome] of [...result.events].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (skipEventKeys?.has(eventKey) === true) continue;
      if (outcome.status === "unavailable") {
        asOfUnavailable.push({ eventKey, name: AS_OF_UNAVAILABLE_NAME });
        continue;
      }
      const { plan } = outcome.state;
      const stage = stageByEvent.get(eventKey);
      if (stage === undefined) continue;
      const tier = tierByEvent?.get(eventKey) ?? "district";
      const common = {
        cutId: result.cutId,
        season: outcome.state.season,
        vars: outcome.state.vars,
        league: outcome.state.league,
        teams: outcome.state.teams,
      };
      if (plan.mode === "real") {
        // A REAL event the stop cannot build (no artifact, or the input
        // builder refuses it) reads UNAVAILABLE, as a GENERATED event with no
        // roster does: dropping it would leave its open cells with neither a
        // distribution nor a marker.
        const eventArtifact = eventArtifacts.get(eventKey);
        if (eventArtifact === undefined) {
          asOfUnavailable.push({ eventKey, name: AS_OF_UNAVAILABLE_NAME });
          continue;
        }
        const built = buildDistrictEventSimulationInput({
          eventKey,
          season: artifact.year,
          eventArtifact,
          districtArtifact: artifact,
          stage,
          startMatchKey: null,
          conditionOnPlayedElims: false,
          // The played playoff rows at or before the cut (quick task
          // 261007-3g2): a round stop routes these as real results and
          // simulates the rest of the bracket.
          asOfPlayedElimMatchKeys: plan.playedPlayoffMatchKeys,
          tier,
          asOfBaselines: plan.baselines,
          ...pointsFinalFor(params.pointsFinalByEvent, eventKey),
        });
        if (!built.ok) {
          asOfUnavailable.push({ eventKey, name: AS_OF_UNAVAILABLE_NAME });
          continue;
        }
        if (built.fieldSizeFellBack) eventsWithFallbackFieldSize.push(eventKey);
        if (built.allianceListIsPartial) eventsWithPartialAllianceList.push(eventKey);
        if (built.unresolvedElimMatchKeys.length > 0) eventsWithUnresolvedElimMatches.push(eventKey);
        real.push({ eventKey, input: built.input, asOf: { ...common, mode: "real", rows: plan.rows } });
        continue;
      }
      const built = generatedRequest({
        artifact,
        districtTeamByKey,
        eventKey,
        tier,
        roster: plan.roster,
        common,
        bake: plan.bake,
        algorithmVersion: params.algorithmVersion,
      });
      if (built === undefined) {
        asOfUnavailable.push({ eventKey, name: AS_OF_UNAVAILABLE_NAME });
        continue;
      }
      generated.push(built);
    }
  }
  const events = [...real, ...generated];
  return {
    events,
    signature: districtRunSignature(events),
    eventsWithExcludedMatches: [],
    eventsWithFallbackFieldSize,
    eventsWithPartialAllianceList,
    eventsWithUnresolvedElimMatches,
    asOfUnavailable,
  };
}


export interface AssembleSimulatedDcmpBakeParams {
  readonly artifact: DistrictArtifact;
  readonly result: AsOfRewindResult;
  readonly algorithmVersion: string;
  /** The unstarted championship, planned GENERATED over every district team (the candidate's roster override). */
  readonly eventKey: string;
  /** The simulated field: the Locked, Prequalified and In range teams at the stop, sorted. */
  readonly roster: readonly string[];
}

export type AssembledSimulatedDcmpBake =
  | { readonly status: "ready"; readonly request: DistrictSimulationEventRequest; readonly signature: string }
  | { readonly status: "unavailable"; readonly reason: string };

/**
 * THE CHAMP LOCKS DCMP BAKE'S ONE REQUEST (quick task 261007-mxf): the
 * championship's GENERATED plan from the stop's own as-of load, rebaked over
 * the simulated field. The as-of block's teams are the plan's tuples filtered
 * to the roster, so every team in the field must have been resolved at the
 * cut; one that was not reads the whole bake unavailable rather than a team
 * priced from nothing. The signature folds the roster (the baselines) and the
 * cut, so only a field or stop change re-bakes.
 */
export function assembleSimulatedDcmpBake(params: AssembleSimulatedDcmpBakeParams): AssembledSimulatedDcmpBake {
  const { artifact, result, eventKey, roster } = params;
  if (result.status === "unavailable") return { status: "unavailable", reason: result.reason };
  const outcome = result.events.get(eventKey);
  if (outcome === undefined) return { status: "unavailable", reason: `${eventKey} was not planned at this stop` };
  if (outcome.status === "unavailable") return { status: "unavailable", reason: outcome.reason };
  const { plan } = outcome.state;
  if (plan.mode !== "generated") return { status: "unavailable", reason: `${eventKey} is not a generated plan at this stop` };
  if (roster.length === 0) return { status: "unavailable", reason: "the simulated field is empty" };
  if (roster.length > MAX_DISTRICT_SIMULATION_ROSTER) return { status: "unavailable", reason: `the simulated field holds ${String(roster.length)} teams, above the Worker's bound` };
  const tupleByTeam = new Map(outcome.state.teams);
  const missing = roster.find((teamKey) => !tupleByTeam.has(teamKey));
  if (missing !== undefined) return { status: "unavailable", reason: `${missing} has no as-of state at this stop` };
  const fieldKeys = new Set(roster);
  const request = generatedRequest({
    artifact,
    districtTeamByKey: new Map(artifact.teams.map((team) => [team.teamKey, team] as const)),
    eventKey,
    tier: plan.tier,
    roster,
    common: {
      cutId: result.cutId,
      season: outcome.state.season,
      vars: outcome.state.vars,
      league: outcome.state.league,
      teams: outcome.state.teams.filter(([teamKey]) => fieldKeys.has(teamKey)),
    },
    bake: plan.bake,
    algorithmVersion: params.algorithmVersion,
  });
  if (request === undefined) return { status: "unavailable", reason: "the simulated field cannot be baked" };
  return { status: "ready", request, signature: districtRunSignature([request]) };
}

/**
 * `useAsOfRewind`'s view and `useDistrictSimulationRun`'s state, STRUCTURALLY
 * and only as far as the view reads them: importing either hook module's
 * types would pull React and the DOM `Worker` into the node typecheck that
 * `scripts/asOfRewindWeb.test.ts` runs this module under.
 */
export interface SimulatedDcmpBakeViewParams {
  readonly asOf: { readonly status: "loading" | "ready" | "failed" } | undefined;
  /** `undefined` while the field is not settled or the load is not ready. */
  readonly assembled: AssembledSimulatedDcmpBake | undefined;
  readonly runState:
    | { readonly status: "idle" | "running" | "error" }
    | { readonly status: "complete"; readonly signature: string; readonly events: readonly DistrictSimulationEventEntry[] };
}

/**
 * The DCMP bake as the rows read it: pending until the load, the assembly and
 * a run of THIS signature are all in hand; unavailable for a failed load, an
 * unavailable assembly, a run error or an unavailable entry; ready with the
 * baked event decoded exactly as a published sidecar is.
 */
export function simulatedDcmpBakeView(params: SimulatedDcmpBakeViewParams): SimulatedDcmpBake {
  const { asOf, assembled, runState } = params;
  if (asOf === undefined || asOf.status === "loading") return { status: "pending" };
  if (asOf.status === "failed") return { status: "unavailable" };
  if (assembled === undefined) return { status: "pending" };
  if (assembled.status === "unavailable") return { status: "unavailable" };
  if (runState.status === "error") return { status: "unavailable" };
  if (runState.status !== "complete" || runState.signature !== assembled.signature) return { status: "pending" };
  const entry = runState.events.find((event) => event.eventKey === assembled.request.eventKey);
  if (entry === undefined || entry.status !== "baked") return { status: "unavailable" };
  return { status: "ready", distributions: distributionsFromPreSim(entry) };
}
