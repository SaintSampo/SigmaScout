/**
 * THE DISTRICT RUN'S REQUEST ASSEMBLY (quick task 261005-5g0, moved out of
 * `useDistrictLedgerData.ts` unchanged): the Live assembly, a rewound stop's
 * as-of assembly and the run signature both key on. Pure, no React, so the web
 * truncation test (`scripts/asOfRewindWeb.test.ts`) runs it in node.
 */
import { buildQualRows } from "../../lib/simulationInputs.js";
import {
  DISTRICT_CATEGORIES,
  awardProfileOrZero,
  buildDistrictEventSimulationInput,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import type { DistrictAsOfBlock, DistrictSimulationEventRequest } from "../../workers/districtSimulationProtocol.js";
import type { AsOfRewindResult } from "./asOfRewind.js";
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

export interface AssembleLiveDistrictEventsParams {
  readonly artifact: DistrictArtifact;
  readonly activeKeys: readonly string[];
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  readonly startMatchKeyByEvent?: ReadonlyMap<string, string | null>;
  readonly tierByEvent?: ReadonlyMap<string, DistrictTier>;
}

/**
 * THE SHIPPED ASSEMBLY, moved out of the hook's `useMemo` verbatim so the Live
 * request list is pinned by a test against a frozen copy of the code it came
 * from (quick task 261005-5g0): Live must stay byte for byte what it was.
 */
export function assembleLiveDistrictEvents(params: AssembleLiveDistrictEventsParams): AssembledDistrictEvents {
  const { artifact, activeKeys, eventArtifacts, stageByEvent, startMatchKeyByEvent, tierByEvent } = params;
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
      // `startMatchKeyByEvent` is supplied exactly when the caller is rewound —
      // see `UseDistrictLedgerDataOptions` — so its absence IS "now", and the
      // rewind rail's own playoff step is all-or-nothing by construction.
      conditionOnPlayedElims: startMatchKeyByEvent === undefined,
      tier: tierByEvent?.get(eventKey) ?? "district",
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

export interface AssembleAsOfDistrictEventsParams {
  readonly artifact: DistrictArtifact;
  readonly result: AsOfRewindResult;
  readonly algorithmVersion: string;
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
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
        const eventArtifact = eventArtifacts.get(eventKey);
        if (eventArtifact === undefined) continue;
        const built = buildDistrictEventSimulationInput({
          eventKey,
          season: artifact.year,
          eventArtifact,
          districtArtifact: artifact,
          stage,
          startMatchKey: null,
          conditionOnPlayedElims: false,
          tier,
          asOfBaselines: plan.baselines,
        });
        if (!built.ok) continue;
        if (built.fieldSizeFellBack) eventsWithFallbackFieldSize.push(eventKey);
        if (built.allianceListIsPartial) eventsWithPartialAllianceList.push(eventKey);
        real.push({ eventKey, input: built.input, asOf: { ...common, mode: "real", rows: plan.rows } });
        continue;
      }
      if (plan.roster.length === 0) {
        asOfUnavailable.push({ eventKey, name: AS_OF_UNAVAILABLE_NAME });
        continue;
      }
      const awardProfiles = new Map(plan.roster.map((teamKey) => [teamKey, awardProfileOrZero(districtTeamByKey.get(teamKey))] as const));
      const input: DistrictLedgerEventInput = {
        eventKey,
        season: artifact.year,
        tier,
        // The REGISTERED roster size, as the publisher's bake passes it.
        fieldSize: plan.roster.length,
        allianceCount: AS_OF_BAKE_ALLIANCE_COUNT,
        remainingMatches: [],
        baselines: plan.roster.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 })),
        ratings: new Map(),
        awardProfiles,
      };
      generated.push({
        eventKey,
        input,
        asOf: { ...common, mode: "generated", bake: { ...plan.bake, algorithmId: DISTRICT_LEDGER_ALGORITHM_ID, algorithmVersion: params.algorithmVersion } },
      });
    }
  }
  const events = [...real, ...generated];
  return {
    events,
    signature: districtRunSignature(events),
    eventsWithExcludedMatches: [],
    eventsWithFallbackFieldSize,
    eventsWithPartialAllianceList,
    eventsWithUnresolvedElimMatches: [],
    asOfUnavailable,
  };
}

