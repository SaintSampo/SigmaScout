import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { eventQueryOptions } from "../../lib/api/event.js";
import { districtPreSimQueryOptions } from "../../lib/api/districtLedger.js";
import { useAlgorithmVersion } from "../ribbon/AlgorithmSelect.js";
import {
  DISTRICT_CATEGORIES,
  allDistrictTierEventKeys,
  distributionsFromPreSim,
  dcmpBracketFactsAtPosition,
  dcmpBracketFactsFor,
  dcmpBracketMilestonesByTeam,
  distributionsFromResult,
  securedElimByTeamFor,
  type DcmpBracketFacts,
  type FieldBackup,
  type DistrictEventDistributions,
  type DistrictLedgerGaps,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import { dcmpEventKeysFor } from "./champLedgerRows.js";
import { championshipShape } from "../../../../../packages/core/districts/finalsBracket.js";
import { useDistrictSimulationRun, type DistrictSimulationRunState } from "./useDistrictSimulationRun.js";
import type { DistrictSimulationEventEntry } from "../../workers/districtSimulationProtocol.js";
import type { AsOfRewindView } from "./useAsOfRewind.js";
import type { DistrictTier } from "../../../../../packages/core/districts/pointModel.js";
import type { DistrictArtifact, EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The tab's LAZY loading, in TWO hooks so the dependency runs one way only.
 *
 * `useDistrictEventArtifacts` fetches event artifacts for a key list the caller
 * derives from the district artifact's own `state` blocks — it needs no
 * timeline and no stage. The caller then builds the interleaved timeline FROM
 * those artifacts, resolves the slider position against it, and hands the
 * resulting per-event stage back into `useDistrictLedgerData`, which fetches
 * the baked sidecars and runs the Worker. Splitting the two is what keeps the
 * whole chain acyclic: artifacts -> timeline -> stage -> simulation.
 *
 * SC-5 LIVES IN THAT KEY LIST. The tab's FIRST paint at the "now" position over
 * a finished or unstarted district fetches NO event artifact and posts NO
 * Worker message at all; the unstarted case still paints its blue cells, from
 * 10-06's baked pmfs. Under a Rewind the FETCH set widens to every started
 * district-tier event, because the interleaved timeline is built from those
 * artifacts' schedules and a slider that could not see a finished event's
 * matches could not rewind into it. The SIMULATION set stays narrower still:
 * an event whose four categories are all final at the position is skipped.
 *
 * THE ALGORITHM IS PINNED TO `spr`, never taken from `?algorithm=`. The
 * district ledger deliberately stays on SPR's ranking-point distributions. SPR
 * and EPA both publish a `redRpPmf`/`blueRpPmf` pair (EPA since 14.0.0, quick
 * task 260929-mat), but OPR publishes none, so following `?algorithm=` would
 * leave the joint run with nothing to consume on OPR. The DISTRICT artifact itself remains algorithm-free, so
 * `lib/api/districts.ts`'s own header note about not adding a version gate by
 * symmetry still holds and must not be undone.
 *
 * A REWOUND STOP IS AN AS-OF FORECAST (quick task 261005-5g0). With `asOf`
 * supplied (`useAsOfRewind`), every simulated event is assembled from the
 * model as it stood at the stop (`assembleAsOfDistrictEvents`): a REAL event's
 * remaining rows and every draft rating are priced in the as-of Worker, a
 * GENERATED event is baked there, and no sidecar, stored per row prediction or
 * `teams[].metrics` is read. Without it (Live) the shipped assembly runs,
 * `assembleLiveDistrictEvents`, byte for byte.
 *
 * A SIDECAR IS FETCHED ONLY FOR A KEY THE ARTIFACT LISTS. 10-03's
 * `bakedEvents` is the exact set published in this generation, so a 404 is
 * never used as control flow.
 *
 * WHAT THE LOCK MATH READS DOES NOT WAIT FOR THE RUN (quick task 261012-mw2).
 * The Locked verdicts read three things of an event beside the district
 * artifact's own rows, and each is a fact of the run REQUEST, not a result of
 * the simulation:
 *
 *   - the BRACKET MILESTONES, which settle a knocked out team's Playoffs:
 *     they are read off the request's alliances and its played playoff rows.
 *   - a championship's BRACKET FACTS for the joint lock proof: the same
 *     alliances and rows, through `dcmpBracketFactsFor` and its gates.
 *   - the SECURED PLAYOFF MINIMUMS: the decisive playoff rows at or before
 *     the position, through `securedElimByTeamFor`.
 *
 * WHAT HAPPENED BEFORE. The first two rode on a LANDED run's entry, and a
 * Live run's progress carries no entry. So from the moment a new run started
 * until it landed, the map held nothing for the event, and every Locked that
 * rested on a settled playoff value or on the joint proof was shown, taken
 * back for the seconds of the run, and shown again, on every live refresh.
 * Measured before the fix. At hook level (the real hook rendered, 2026orore
 * at the live position after Round 2): 29 teams Locked on points with the run
 * landed and 27 with a new run in flight, frc1983 and frc8896 taken back
 * (`useDistrictLedgerData.flight.test.tsx`, which failed with exactly those
 * two). Over history, the planner's reading of the same two states: on the
 * 31 single event championships of 2023 to 2026, 420 Locked team stops were
 * not Locked with a run in flight (every one of the 338 from Alliances final
 * to Round 5, and 82 of the 161 at Playoffs final with awards open), 414 of
 * them held by the joint proof alone; on the local 2026 PNW fixture's
 * district events, 73 of 1,153. Jacob's rule, 2026-10-08: "it is mission critical
 * that no team is told they are locked at any stop, and then later they are
 * not locked."
 *
 * NOW all three are laid onto the map per request by `attachRequestFacts`,
 * run landed or not, so the statuses with a new run in flight are the
 * statuses with the run landed (the same test reads 29 and 29). A landed
 * run's entry keeps everything it has and gains only what it lacks.
 *
 * NOTHING HERE IS OLDER THAN THE REQUEST, so it cannot overstate. The facts
 * are read off the request the map is being built for and off the event
 * artifacts in hand, never held over from an earlier run or an earlier
 * request. They are the same alliances and the same played rows the run
 * itself is conditioned on.
 *
 * THE CREDIT'S TWO READINGS. REWOUND, the request's own played rows, found on
 * the event artifact by level, set and match number, so a stop never sees a
 * row after its cut (`securedElimForRequest`). AT THE LIVE POSITION, every
 * row of every LOADED event artifact whose tier the caller names, request or
 * not: an event whose Playoffs read final has no played row on its request,
 * and the lock math still reads the larger of TBA's number and the secured
 * minimum there. The two readings agree wherever both apply (the planner
 * read 67 of 67 stops of the local fixture). The live reading stops where
 * the played rows do: an event that has left the Live fetch set (a district
 * event or a single event championship once its awards flag is true) has no
 * played row in the browser, and its floor is TBA's number alone. Keeping it
 * fetched is not done here. An event artifact with no tier entry is credited
 * nothing, never the district tier by default, and an event with a playoff
 * row the tab could not place on two alliances is credited nothing.
 *
 * WHAT DID NOT CHANGE. The Live assembly, the as of assembly, the request
 * list, the gap lists and the run signature (`districtRunAssembly.ts`) are
 * untouched, so no run is fired that was not fired before and the frozen
 * copy parity tests still hold. A landed run's own result is read as it was.
 */

// The request assembly and the run signature live in the pure
// `districtRunAssembly.ts` (quick task 261005-5g0), re-exported here so every
// existing import keeps working and a node script can import them with no React.
export {
  AS_OF_UNAVAILABLE_NAME,
  DISTRICT_LEDGER_ALGORITHM_ID,
  assembleAsOfDistrictEvents,
  assembleLiveDistrictEvents,
  districtRunSignature,
  type AssembleAsOfDistrictEventsParams,
  type AssembleLiveDistrictEventsParams,
  type AssembledDistrictEvents,
} from "./districtRunAssembly.js";
import {
  AS_OF_UNAVAILABLE_NAME,
  DISTRICT_LEDGER_ALGORITHM_ID,
  assembleAsOfDistrictEvents,
  assembleLiveDistrictEvents,
  type AssembledDistrictEvents,
} from "./districtRunAssembly.js";

export interface DistrictEventArtifacts {
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  readonly missingEventArtifacts: readonly string[];
  readonly isLoading: boolean;
}

export function useDistrictEventArtifacts(activeEventKeys: readonly string[]): DistrictEventArtifacts {
  const version = useAlgorithmVersion(DISTRICT_LEDGER_ALGORITHM_ID);
  const keys = useMemo(() => [...activeEventKeys].sort(), [activeEventKeys]);

  // `useQueries` preserves input order — the same documented behaviour
  // `routes/index.tsx` already depends on.
  const queries = useQueries({
    queries: keys.map((eventKey) => ({
      ...eventQueryOptions({ eventKey, algorithmId: DISTRICT_LEDGER_ALGORITHM_ID, version: version ?? "" }),
      enabled: version !== undefined,
    })),
  });

  const eventArtifacts = useMemo(() => {
    const map = new Map<string, EventArtifact>();
    keys.forEach((eventKey, index) => {
      const data = queries[index]?.data;
      if (data !== undefined) map.set(eventKey, data);
    });
    return map;
  }, [keys, queries]);

  return {
    eventArtifacts,
    missingEventArtifacts: keys.filter((eventKey) => !eventArtifacts.has(eventKey)),
    isLoading: queries.some((query) => query.isPending),
  };
}

export interface UseDistrictLedgerDataOptions {
  readonly artifact: DistrictArtifact;
  /** The district-tier events whose artifacts were fetched — the same list `useDistrictEventArtifacts` was given. */
  readonly activeEventKeys: readonly string[];
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  /**
   * Per-event category finality at the current position: WHAT HAS HAPPENED ON
   * THE FIELD (the state's own reading). It selects the open events, and the
   * run assembly and the bracket facts are built from it.
   */
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  /**
   * Per event, WHICH OF TBA'S NUMBERS ARE FINAL at the current position
   * (quick task 261009-vp9, the number reading). Passed through both
   * assemblies to the input builder, where it gates only the playoff and
   * award points the run takes as known. Absent, the run reads
   * `stageByEvent` for those too, which is the shipped behaviour.
   */
  readonly pointsFinalByEvent?: ReadonlyMap<string, DistrictStageFinality>;
  /**
   * Per-event override for the first qualification row still to be played at
   * this position — `null` means qualification is FINISHED there, expressed as
   * zero remaining matches. Absent falls back to the event artifact's own first
   * unplayed row, which is the "now" answer. No tab passes it since quick task
   * 261005-5g0 (a rewound stop uses `asOf`); only the parity tests still do.
   */
  readonly startMatchKeyByEvent?: ReadonlyMap<string, string | null>;
  /**
   * Which event keys a BAKED sidecar may be fetched for. Defaults to
   * `allDistrictTierEventKeys(artifact)`, which is byte for byte the shipped
   * behaviour.
   *
   * The Champ Locks tab passes the district-tier keys PLUS the dcmp event key,
   * so an unstarted District Championship's baked sidecar is fetched rather
   * than silently skipped. `scripts/publishDistricts.ts` already bakes dcmp-tier
   * candidates (`tier: districtTierForEventType(event.eventType)`), so the
   * sidecar exists and `bakedEvents` already lists it — no publisher change
   * (quick task 260925-xab).
   */
  readonly allowedEventKeys?: readonly string[];
  /**
   * `eventKey -> the point tier it is simulated at`. Absent, or absent for one
   * key, reads as `"district"` — the shipped behaviour.
   *
   * The DCMP is therefore priced at the 3x ceilings by the SAME code path as
   * any district event, in the same Worker, in the same run, under one
   * signature. A second run for one event would be a second place for the
   * position, the algorithm version and the refusals to drift. The one
   * deliberate exception is the Champ Locks DCMP bake at a rewound stop
   * (`useSimulatedDcmpBake`, quick task 261007-mxf): its roster is a function
   * of THIS run's output (the district line cuts In range), so folding it in
   * would move this run's signature once the roster landed and re-run every
   * district event. It reads the same as-of load and the same bake
   * parameters, so the drift this rule guards against has no room.
   */
  readonly tierByEvent?: ReadonlyMap<string, DistrictTier>;
  /**
   * A REWOUND STOP'S AS-OF STATE (quick task 261005-5g0), from
   * `useAsOfRewind`. Absent at Live, which therefore takes the shipped path
   * byte for byte: the same sidecar fetches, the same requests, the same run.
   * Present, every simulated event is assembled from it and nothing else (no
   * sidecar, no stored per row prediction, no `teams[].metrics`), and an event
   * it marks unavailable is unavailable.
   */
  readonly asOf?: AsOfRewindView;
  /** Rewound only: events the caller will not read at this stop, so they cost no Worker time (`assembleAsOfDistrictEvents`). Ignored at Live. */
  readonly skipEventKeys?: ReadonlySet<string>;
  /**
   * Whether a divisioned championship's finals key may be on no row yet
   * (quick task 261010-d7r, D2): read by `divisionedDcmpBracketFacts` for
   * the shape alone. The Champ Locks tab passes true only at the live
   * position while the field is proven by capacity. Absent reads false.
   */
  readonly finalsMayBeAbsent?: boolean;
}

export interface DistrictLedgerData {
  readonly distributions: ReadonlyMap<string, DistrictEventDistributions>;
  readonly runState: DistrictSimulationRunState;
  readonly unavailableEvents: readonly { readonly eventKey: string; readonly name: string }[];
  readonly gaps: Partial<DistrictLedgerGaps>;
  readonly isLoading: boolean;
  /**
   * TRUE while the per event run for the CURRENT inputs has not landed: events
   * are assembled and the run state is idle (the effect has not started it
   * yet), running, or complete for a stale signature. A failed run is not
   * pending. Both tabs read it so an unstarted run is never mistaken for
   * "nothing to run": the champ tab since quick task 260927-6bf, and the
   * district tab since 261004-uw4, when its cutoff became the simulated line.
   */
  readonly runPending: boolean;
}

/** What `divisionedDcmpBracketFacts` reads for one run request: its alliances and played rows. */
export interface DcmpFactsRequest {
  readonly knownAlliances?: DistrictSimulationEventEntryInput["knownAlliances"];
  readonly playedElimMatches?: DistrictSimulationEventEntryInput["playedElimMatches"];
  readonly unresolvedMatchCount: number;
  /** The backups the request's played rows show on the field that no pick list names (quick task 261010-66y, R13). */
  readonly fieldBackups?: readonly FieldBackup[] | undefined;
}
type DistrictSimulationEventEntryInput = AssembledDistrictEvents["events"][number]["input"];

/**
 * EACH LISTED PICK'S SECURED PLAYOFF MINIMUM FOR ONE RUN REQUEST (quick task
 * 261012-mw2), or `undefined` where nothing may be credited. This is the
 * REWOUND reading: a rewound stop may see only the rows at or before its cut,
 * and those are the request's own played playoff rows (`playedElimMatches`,
 * the decisive rows the run was conditioned on). Each is found on the event
 * artifact by its level, set and match number. The rule and every refusal are
 * `securedElimByTeamFor`'s.
 *
 * NOTHING IS CREDITED where the event artifact is not loaded, where the
 * request carries no played row (the playoffs are not under way at the stop,
 * or their points are final there), where a played row of the request is not
 * on the artifact, or where the event has a playoff row the tab could not
 * place on two alliances (`unresolvedMatchCount`): a win missing from the
 * count could overstate a robot's share.
 */
export function securedElimForRequest(params: {
  readonly eventArtifact: EventArtifact | undefined;
  readonly season: number;
  readonly tier: DistrictTier;
  readonly playedElimMatches: DistrictSimulationEventEntryInput["playedElimMatches"];
  readonly unresolvedMatchCount: number;
}): ReadonlyMap<string, number> | undefined {
  const { eventArtifact, playedElimMatches } = params;
  if (eventArtifact === undefined || playedElimMatches === undefined || playedElimMatches.length === 0) return undefined;
  if (params.unresolvedMatchCount !== 0) return undefined;
  const rowId = (compLevel: string, setNumber: number, matchNumber: number): string => `${compLevel}|${String(setNumber)}|${String(matchNumber)}`;
  const keyByRow = new Map<string, string>();
  for (const match of eventArtifact.matches) {
    if (match.compLevel !== "qm") keyByRow.set(rowId(match.compLevel, match.setNumber, match.matchNumber), match.matchKey);
  }
  const keys = new Set<string>();
  for (const played of playedElimMatches) {
    const matchKey = keyByRow.get(rowId(played.compLevel, played.setNumber, played.matchNumber));
    if (matchKey === undefined) return undefined;
    keys.add(matchKey);
  }
  const secured = securedElimByTeamFor(eventArtifact, params.season, params.tier, keys);
  return secured.size === 0 ? undefined : secured;
}

/**
 * WHAT THE LOCK MATH READS OF AN EVENT DOES NOT WAIT FOR THE RUN (quick task
 * 261012-mw2). The Locked verdicts read three things of an event beside the
 * district artifact's own rows, and every one of them is a fact of the
 * request (its alliances and its played playoff rows), not a result of the
 * simulation:
 *
 *   - the BRACKET MILESTONES, which settle a knocked out team's playoffs
 *     (`playoffMilestoneByTeam`). A landed run reports them; they are the
 *     same map `dcmpBracketMilestonesByTeam` reads off the request.
 *   - a championship's BRACKET FACTS for the joint lock proof (`dcmpBracket`),
 *     through `dcmpBracketFactsFor` and its gates, exactly as a landed run's
 *     entry has always carried them.
 *   - the SECURED PLAYOFF MINIMUMS (`securedElimByTeam`).
 *
 * Until this task the first two rode on a LANDED run's entry only. A new Live
 * run starts with no entry, so for the seconds each run takes the map held
 * nothing for the event: settled playoff values and the joint proof were
 * gone, and teams they held read In range and then Locked again. Jacob's
 * rule: "it is mission critical that no team is told they are locked at any
 * stop, and then later they are not locked."
 *
 * So all three are laid onto the map per REQUEST. Where the map holds the
 * key's entry, that entry keeps everything it has (a landed run's own
 * milestones included) and gains what it lacks. Where it holds none (the run
 * has not landed, or could not price the event) an entry with no team record
 * is added, which reads as no entry for every cell. A landed run's entry is
 * therefore exactly what it was, and the entry of a run in flight carries
 * the same three facts, so the statuses do not change when the run lands.
 *
 * NOTHING HERE IS OLDER THAN THE REQUEST. The facts are read off the request
 * the map is being built for, never held over from an earlier one, so they
 * cannot disagree with the rows and cannot overstate.
 *
 * THE SECURED MINIMUMS AT THE LIVE POSITION (`live`) are read for every
 * LOADED event artifact, request or not, off all of its rows: Now sees every
 * row, and an event whose Playoffs already read final has no played row on
 * its request and may have no request at all, while the lock math still
 * reads the larger of TBA's number and the secured minimum there. An event
 * with an unresolved playoff row is credited nothing. At a rewound stop the
 * reading is the request's (`securedElimForRequest`), which sees only the
 * rows at or before the cut.
 *
 * NO TIER ENTRY, NO CREDIT (CONTEXT D7 of this quick task). The pay rule is
 * weighted by the event's tier, so at the live position an event artifact is
 * credited only where `tierByEvent` NAMES its tier. A loaded artifact the
 * map has no entry for is credited nothing; it is never read at the district
 * tier by default. Both tabs name the tier of every event they read from the
 * district artifact's own rows (`ChampLocksLedger.tsx` for both tiers,
 * `DistrictLedger.tsx` for the district tier), so the only artifact left
 * without an entry is one the district artifact carries on no row, such as a
 * divisioned championship's finals key before its rows post, which is
 * credited nothing anyway. A rewound stop reads the tier of its own request.
 *
 * WHERE THE LIVE READING STOPS. It needs the event's played rows, so it
 * reaches exactly the events whose artifact the tab has loaded: an event
 * that has started and has not finished, and on the Champ Locks tab every
 * started key of a divisioned championship until every one of its events
 * has finished. An event that has left the Live fetch set (a district event
 * or a single event championship once its awards flag is true) has no
 * played row in the browser, and its floor is TBA's number alone.
 */
export function attachRequestFacts(
  map: Map<string, DistrictEventDistributions>,
  params: {
    readonly requests: readonly { readonly eventKey: string; readonly input: DistrictSimulationEventEntryInput }[];
    readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
    readonly season: number;
    readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
    readonly unresolvedEventKeys: ReadonlySet<string>;
    readonly fieldBackupsByEvent?: ReadonlyMap<string, readonly FieldBackup[]> | undefined;
    /** True at the live position, false at a rewound stop. */
    readonly live: boolean;
    /** The tier each loaded event artifact is credited at, at the live position. No entry, no credit. */
    readonly tierByEvent?: ReadonlyMap<string, DistrictTier> | undefined;
  }
): void {
  for (const request of params.requests) {
    const { eventKey, input } = request;
    const existing = map.get(eventKey);
    const unresolvedMatchCount = params.unresolvedEventKeys.has(eventKey) ? 1 : 0;
    const playoffMilestoneByTeam =
      existing?.playoffMilestoneByTeam !== undefined || input.knownAlliances === undefined
        ? undefined
        : dcmpBracketMilestonesByTeam(input.knownAlliances, input.playedElimMatches ?? []);
    const dcmpBracket =
      input.tier !== "dcmp"
        ? undefined
        : dcmpBracketFactsFor({
            eventKey,
            season: params.season,
            tier: input.tier,
            stage: params.stageByEvent.get(eventKey),
            alliances: input.knownAlliances,
            playedMatches: input.playedElimMatches ?? [],
            unresolvedMatchCount,
            // A backup seen on the field and listed nowhere joins its alliance in the facts (quick task 261010-66y, R13).
            fieldBackups: params.fieldBackupsByEvent?.get(eventKey),
          });
    const securedElimByTeam = params.live
      ? undefined
      : securedElimForRequest({ eventArtifact: params.eventArtifacts.get(eventKey), season: params.season, tier: input.tier, playedElimMatches: input.playedElimMatches, unresolvedMatchCount });
    if (playoffMilestoneByTeam === undefined && dcmpBracket === undefined && securedElimByTeam === undefined) continue;
    map.set(eventKey, {
      ...(existing ?? { eventKey, byTeam: new Map() }),
      ...(playoffMilestoneByTeam === undefined ? {} : { playoffMilestoneByTeam }),
      ...(dcmpBracket === undefined ? {} : { dcmpBracket }),
      ...(securedElimByTeam === undefined ? {} : { securedElimByTeam }),
    });
  }
  if (!params.live) return;
  for (const [eventKey, eventArtifact] of params.eventArtifacts) {
    if (params.unresolvedEventKeys.has(eventKey)) continue;
    // NO TIER ENTRY, NO CREDIT: never a district tier credit by default.
    const tier = params.tierByEvent?.get(eventKey);
    if (tier === undefined) continue;
    const securedElimByTeam = securedElimByTeamFor(eventArtifact, params.season, tier);
    if (securedElimByTeam.size === 0) continue;
    map.set(eventKey, { ...(map.get(eventKey) ?? { eventKey, byTeam: new Map() }), securedElimByTeam });
  }
}

/**
 * THE BRACKET FACTS OF A DIVISIONED CHAMPIONSHIP (quick task 261009-kt3,
 * reading R12): one entry per DIVISION key and the FINALS key with a loaded
 * event artifact, run request or not, through `dcmpBracketFactsAtPosition`
 * (role `division`, or `finals` with as many alliances as divisions). Empty for
 * every other shape: a single championship and two championships keep the
 * run request path byte for byte.
 *
 * `finalsMayBeAbsent` (quick task 261010-d7r, D2) is `championshipShape`'s
 * own flag, passed straight on: with it, a live championship whose 2 or 4
 * division keys are on the rows and whose finals key is on none still gets
 * its DIVISION facts, so the joint proof can run during the division
 * playoffs. No finals entry is built there: no event artifact is fetched for
 * a key the district artifact does not carry.
 */
export function divisionedDcmpBracketFacts(params: {
  readonly artifact: DistrictArtifact;
  readonly eventArtifacts: ReadonlyMap<string, EventArtifact>;
  readonly stageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  readonly requestByKey: ReadonlyMap<string, DcmpFactsRequest>;
  readonly finalsMayBeAbsent?: boolean;
}): Map<string, DcmpBracketFacts> {
  const out = new Map<string, DcmpBracketFacts>();
  const shape = championshipShape(dcmpEventKeysFor(params.artifact), params.finalsMayBeAbsent === true);
  if (shape.kind !== "divisioned") return out;
  const roles: readonly [string, "division" | "finals"][] = [
    ...shape.divisionKeys.map((key) => [key, "division"] as [string, "division"]),
    [shape.finalsKey, "finals"],
  ];
  for (const [eventKey, role] of roles) {
    const eventArtifact = params.eventArtifacts.get(eventKey);
    if (eventArtifact === undefined) continue;
    const request = params.requestByKey.get(eventKey);
    const facts = dcmpBracketFactsAtPosition({
      eventKey,
      season: params.artifact.year,
      role,
      ...(role === "finals" ? { expectedAllianceCount: shape.divisionKeys.length } : {}),
      stage: params.stageByEvent.get(eventKey),
      eventArtifact,
      ...(request === undefined ? {} : { request }),
    });
    if (facts !== undefined) out.set(eventKey, facts);
  }
  return out;
}

/**
 * The Champ Locks tab's fetch set at the LIVE position (quick task 261009-kt3,
 * widened by 261010-66y, reading R15, and again by 261010-d7r): the in
 * progress events, plus every STARTED dcmp tier key of a divisioned
 * championship UNTIL EVERY ONE OF ITS EVENTS HAS FINISHED, each division and
 * the finals. Any other shape returns the in progress keys unchanged. An
 * event with no open category costs no simulation however it got into the
 * fetch set.
 *
 * WHY UNTIL EVERY EVENT HAS FINISHED, and not only while one of the
 * championship's events is in progress. The joint proof reads every
 * division's bracket, and it holds locks the ceiling test alone would drop
 * in three places where the brackets used to be let go:
 *
 *   - THE WINDOW between the divisions and the finals: every division reads
 *     finished and the finals have not started. The proof alone holds 196
 *     team stops over the 16 divisioned championships of 2023 to 2026 at the
 *     "Divisions final, finals not started" stop (2026 FIM: 36 of 65). With
 *     the first rule the brackets were dropped there and so were those locks,
 *     to come back once the finals started.
 *   - THE TICK THE FINALS ROWS FIRST POST, before the finals' own state is
 *     written: the finals key is on the rows and has not started.
 *   - THE FINALS FINISHED WHILE A DIVISION HAS NOT (quick task 261010-d7r,
 *     finding F-B). An event reads in progress until its awards flag turns
 *     true, and the flags turn true one event at a time in no fixed order.
 *     Since that task the proof keeps running past the finals' Awards while
 *     a division's flag is still to come, and it reads every division's
 *     bracket there. The rule of quick task 261010-66y let every bracket go
 *     the moment the finals event finished, which would have refused the
 *     proof (`noBracketFacts`) exactly where it now has to hold.
 *
 * So, for a divisioned shape: while any key of the championship has not
 * finished (it is not started, or it is in progress, or with
 * `finalsMayBeAbsent` the finals key is on no row at all), every started key
 * of the championship is in the fetch set. A key HAS FINISHED when it is
 * started and not in progress. Once every key has, every key's Awards are
 * final, the proof no longer runs, and only the in progress keys are
 * returned.
 *
 * The shape is read off the keys on the rows. `finalsMayBeAbsent` is
 * `championshipShape`'s own flag (quick task 261010-d7r, D2), for the live
 * championship whose finals key is on no row yet: with it the division keys
 * alone are a divisioned shape, so the brackets are in hand through the
 * division playoffs and the window, where the joint proof now runs. The tab
 * passes true only while the field is proven by capacity. Without it
 * division keys whose finals key is on no row are not a divisioned shape,
 * and this rule starts once the finals key is on a row.
 */
export function champLiveFetchKeys(inProgressKeys: readonly string[], startedKeys: readonly string[], dcmpEventKeys: readonly string[], finalsMayBeAbsent = false): string[] {
  const keys = new Set(inProgressKeys);
  const shape = championshipShape(dcmpEventKeys, finalsMayBeAbsent);
  if (shape.kind === "divisioned") {
    const championshipKeys = [...shape.divisionKeys, shape.finalsKey];
    const everyKeyFinished = championshipKeys.every((key) => startedKeys.includes(key) && !keys.has(key));
    if (!everyKeyFinished) for (const key of championshipKeys) if (startedKeys.includes(key)) keys.add(key);
  }
  return [...keys].sort();
}

/** Every event entry the run has produced so far: the terminal set, or an as-of run's partial set for the current signature. */
function landedEntries(runState: DistrictSimulationRunState, signature: string): readonly DistrictSimulationEventEntry[] {
  if (runState.status === "complete") return runState.events;
  if (runState.status === "running" && runState.events !== undefined && runState.signature === signature) return runState.events;
  return [];
}

export function useDistrictLedgerData(options: UseDistrictLedgerDataOptions): DistrictLedgerData {
  const { artifact, activeEventKeys, eventArtifacts, stageByEvent, pointsFinalByEvent, startMatchKeyByEvent, allowedEventKeys, tierByEvent, asOf } = options;
  const finalsMayBeAbsent = options.finalsMayBeAbsent === true;
  const activeKeys = useMemo(() => [...activeEventKeys].sort(), [activeEventKeys]);
  const rewound = asOf !== undefined;

  const bakedKeys = useMemo(() => {
    // A REWOUND STOP NEVER READS A SIDECAR: it is priced at the publish
    // clock, after the stop. A GENERATED event is baked in the Worker instead.
    if (rewound) return [];
    const listed = artifact.bakedEvents;
    if (listed === undefined || listed.length === 0) return [];
    const allowed = new Set(allowedEventKeys ?? allDistrictTierEventKeys(artifact));
    const active = new Set(activeKeys);
    return listed.filter((eventKey) => allowed.has(eventKey) && !active.has(eventKey)).sort();
  }, [rewound, artifact, activeKeys, allowedEventKeys]);

  const preSimQueries = useQueries({
    queries: bakedKeys.map((eventKey) => districtPreSimQueryOptions({ districtKey: artifact.districtKey, eventKey })),
  });

  const skipEventKeys = options.skipEventKeys;
  const assembled = useMemo((): AssembledDistrictEvents => {
    if (asOf === undefined) return assembleLiveDistrictEvents({ artifact, activeKeys, eventArtifacts, stageByEvent, pointsFinalByEvent, startMatchKeyByEvent, tierByEvent });
    if (asOf.status === "ready") {
      return assembleAsOfDistrictEvents({
        artifact,
        result: asOf.result,
        algorithmVersion: asOf.algorithmVersion,
        eventArtifacts,
        stageByEvent,
        pointsFinalByEvent,
        tierByEvent,
        skipEventKeys,
        candidateKeys: openEventKeys(allowedEventKeys ?? allDistrictTierEventKeys(artifact), stageByEvent),
      });
    }
    const asOfUnavailable =
      asOf.status === "failed"
        ? openEventKeys(allowedEventKeys ?? allDistrictTierEventKeys(artifact), stageByEvent)
            .filter((eventKey) => skipEventKeys?.has(eventKey) !== true)
            .map((eventKey) => ({ eventKey, name: AS_OF_UNAVAILABLE_NAME }))
        : [];
    return {
      events: [],
      signature: "",
      eventsWithExcludedMatches: [],
      eventsWithFallbackFieldSize: [],
      eventsWithPartialAllianceList: [],
      eventsWithUnresolvedElimMatches: [],
      asOfUnavailable,
    };
  }, [asOf, activeKeys, eventArtifacts, stageByEvent, pointsFinalByEvent, startMatchKeyByEvent, artifact, tierByEvent, skipEventKeys, allowedEventKeys]);

  const runState = useDistrictSimulationRun(
    useMemo(() => ({ events: assembled.events, signature: assembled.signature }), [assembled])
  );

  const entries = useMemo(() => landedEntries(runState, assembled.signature), [runState, assembled.signature]);

  const distributions = useMemo(() => {
    const map = new Map<string, DistrictEventDistributions>();
    bakedKeys.forEach((eventKey, index) => {
      const data = preSimQueries[index]?.data;
      if (data === undefined || data === null) return;
      map.set(eventKey, distributionsFromPreSim(data));
    });
    const unresolved = new Set(assembled.eventsWithUnresolvedElimMatches);
    for (const entry of entries) {
      if (entry.status === "ok") map.set(entry.eventKey, distributionsFromResult(entry.result));
      else if (entry.status === "baked") map.set(entry.eventKey, distributionsFromPreSim(entry));
    }
    // WHAT THE LOCK MATH READS OF AN EVENT, per run REQUEST and not per landed
    // run (quick task 261012-mw2): the bracket milestones, the DCMP's bracket
    // facts for the joint lock proof (quick task 261009-2tr: read off the run's
    // OWN request, the published alliances and the played playoff rows it was
    // handed, never off the Monte Carlo result, and only where `dcmpBracketFactsFor`'s
    // gates all pass) and the secured playoff minimums. See `attachRequestFacts`.
    attachRequestFacts(map, {
      requests: assembled.events,
      eventArtifacts,
      season: artifact.year,
      stageByEvent,
      unresolvedEventKeys: unresolved,
      fieldBackupsByEvent: assembled.fieldBackupsByEvent,
      live: !rewound,
      tierByEvent,
    });
    // A DIVISIONED CHAMPIONSHIP'S FACTS (quick task 261009-kt3): every division
    // and the finals, attached to the key's entry, or to a minimal entry with
    // no team record (which reads exactly as no entry for every cell).
    const divisioned = divisionedDcmpBracketFacts({
      artifact,
      eventArtifacts,
      stageByEvent,
      requestByKey: new Map(
        assembled.events.map((request) => [
          request.eventKey,
          {
            ...(request.input.knownAlliances === undefined ? {} : { knownAlliances: request.input.knownAlliances }),
            ...(request.input.playedElimMatches === undefined ? {} : { playedElimMatches: request.input.playedElimMatches }),
            unresolvedMatchCount: unresolved.has(request.eventKey) ? 1 : 0,
            fieldBackups: assembled.fieldBackupsByEvent?.get(request.eventKey),
          },
        ] as const)
      ),
    });
    for (const [eventKey, dcmpBracket] of divisioned) {
      const existing = map.get(eventKey);
      map.set(eventKey, existing === undefined ? { eventKey, byTeam: new Map(), dcmpBracket } : { ...existing, dcmpBracket });
    }
    return map;
  }, [bakedKeys, preSimQueries, entries, assembled, stageByEvent, artifact, eventArtifacts, finalsMayBeAbsent, rewound, tierByEvent]);

  const unavailableEvents = useMemo(() => {
    const fromRun = runState.status !== "complete" ? [] : runState.events.flatMap((entry) => (entry.status === "unavailable" ? [{ eventKey: entry.eventKey, name: entry.name }] : []));
    return assembled.asOfUnavailable.length === 0 ? fromRun : [...assembled.asOfUnavailable, ...fromRun];
  }, [runState, assembled.asOfUnavailable]);

  const eventsWithExcludedMatches = useMemo(() => {
    const asOfExcluded = entries.flatMap((entry) => (entry.status === "ok" && entry.excludedMatchKeys !== undefined ? [entry.eventKey] : []));
    return asOfExcluded.length === 0 ? assembled.eventsWithExcludedMatches : [...assembled.eventsWithExcludedMatches, ...asOfExcluded];
  }, [entries, assembled.eventsWithExcludedMatches]);

  return {
    distributions,
    runState,
    unavailableEvents,
    gaps: {
      eventsWithExcludedMatches,
      eventsWithFallbackFieldSize: assembled.eventsWithFallbackFieldSize,
      eventsWithPartialAllianceList: assembled.eventsWithPartialAllianceList,
      eventsWithUnresolvedElimMatches: assembled.eventsWithUnresolvedElimMatches,
    },
    isLoading: preSimQueries.some((query) => query.isPending),
    runPending:
      // The as-of objects for a rewound stop are still loading: nothing can be
      // assembled yet, and that is not "nothing to run".
      asOf?.status === "loading" ||
      (assembled.events.length > 0 &&
        runState.status !== "error" &&
        !(runState.status === "complete" && runState.signature === assembled.signature)),
  };
}

/** The events with an open category at the stop, sorted. */
function openEventKeys(keys: readonly string[], stageByEvent: ReadonlyMap<string, DistrictStageFinality>): string[] {
  return keys
    .filter((eventKey) => {
      const stage = stageByEvent.get(eventKey);
      return stage !== undefined && DISTRICT_CATEGORIES.some((category) => !stage[category]);
    })
    .sort();
}
