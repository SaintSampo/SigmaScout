/**
 * The staged LIVE walk of a District Championship whose rows arrive one event
 * at a time, through the shared merge and the Champ Locks tab's own code
 * (quick task 261010-66y).
 *
 * THE RULE, Jacob's: "it is mission critical that no team is told they are
 * locked at any stop, and then later they are not locked. but also once a
 * team is locked, we should know it as soon as we can."
 *
 * THE GAP this file holds closed. A district artifact carries no event list:
 * it learns a championship key only from team rows. So when TBA posts one
 * division, or one of two championships, before the others, every key the
 * artifact knows has started while most of the field is on no row. Before
 * this task every team of the unposted events read OUT of the field, lost its
 * whole championship ceiling, and a team of the posted event read Locked
 * until the other rows landed. A team with no row now reads out only once the
 * field is PROVEN (`packages/core/districts/dcmpFieldProof.ts`).
 *
 * WHAT IS WALKED. A source artifact (a finished season, or a synthetic one)
 * is rewound to before its championship: every dcmp row, its points and its
 * dcmp awards are removed. Then, as the live Worker would write it:
 *
 *   - no dcmp row;
 *   - per field fixing key, "rows posted" (the rows arrive with NO state
 *     block, because the Worker drops the state of an event the artifact it
 *     read carried no row for) and then "state written";
 *   - qualification done everywhere;
 *   - alliances picked, no alliance points;
 *   - alliance points land;
 *   - playoffs done, no playoff points;
 *   - playoff points land;
 *   - the source artifact itself.
 *
 * A rows tick goes through `applyDistrictRankings` and a state tick through
 * `applyDistrictEventState`, the two entry points the live Worker calls. The
 * state of an event is handed only once the artifact already carries a row
 * for it. After each tick the Champ Locks tab is read at Now with
 * `buildChampLedgerRows` and `computeChampLedgerStatuses`, the rows' own
 * `fieldProven` handed on as the tab hands it, and the District Locks tab
 * with `computeDistrictLedgerStatuses` and its Live field overlay
 * (`applyChampionshipFieldOverlay`).
 *
 * THE SECOND WALK: THE POINTS ARRIVE ONLY AS EACH EVENT ENDS. When TBA posts
 * district points during an event is not verified, so the other case is
 * walked too. Some of the field fixing keys start wholly final, as published
 * (none of them, or the first one, two and so on), and the others are on no
 * row. Then each further key's rows post with every point they end on and
 * no state block, then its state is written with its playoffs done and its
 * awards flag not yet true, and last comes the source artifact. This is the
 * walk in which teams read Locked while most of the field is on no row, so
 * it is the one that shows whether a team with no row carries enough.
 *
 * THE GROUPS OF THIS FILE:
 *   1. a synthetic championship in four divisions, built from the committed
 *      2026 PNW fixture. Always on.
 *   2. the Now census: every local district artifact reads at Now what it
 *      read before this task.
 *   3. the subset test: with any proper subset of an artifact's field fixing
 *      keys on its rows, the field reads NOT proven.
 *   4. the real walks of 2026 FIM, NE, ONT, TX and CA.
 *   5. the same five with the points arriving only as each event ends: the
 *      states with part of the field wholly final and the rest on no row,
 *      and the walk on from each of them.
 *   6. the PUBLISHED verdicts (`champLock` and `maxRemainingChamp` on the
 *      artifact itself) walked through the finals: two synthetic
 *      championships, always on, and 2026 FIM, NE, ONT, TX, CA and PNW from
 *      both starts (no dcmp row first, and every attending team registered
 *      first).
 *   7. the convention the finals reading rests on: a points paying award at a
 *      finals event is a consuming award, and a team whose only championship
 *      row is the finals row earned nothing else there.
 *   8. a backup robot seen on the field joins its alliance in the joint
 *      proof's facts: the real 2026pncmp bracket with a listed backup
 *      stripped from its alliance's picks.
 *   9. CLOSED by quick task 261010-d7r: over the 16 divisioned championships
 *      of 2023 to 2026, every Locked the joint proof gives while the
 *      divisions' Awards are open is held once they read final. Quick task
 *      261010-66y measured eleven teams lost there and refused to run the
 *      proof before the finals key is on the artifact because of it; the
 *      eleven are read again and each is Locked at both readings. The edges
 *      in between are held in `scripts/champJointMonotone.test.ts`.
 *  10. the live walks of 2026 FIM, NE, ONT and TX with the field's bracket
 *      facts handed at every tick from "alliances picked" on, the finals key
 *      on no row until the finals rows post. (The proof still reads
 *      `unsupportedShape` until then.)
 *  11. the finals read the same way with and without a finals row: over the
 *      16 divisioned championships and nine stops each, every team's floor
 *      and ceiling, the teams shown Locked and `lockedBy`, with the finals
 *      key's rows removed from the artifact against present.
 *  12. the teams that attend below the district line are dominated: at every
 *      tick of the real 2026 walks where the field is unproven, the unseen
 *      attendees' totals against the totals of the teams on no row that
 *      carry a hypothetical championship, on the tab and in the published
 *      verdicts.
 * Groups 2 to 5, the real walks of group 6 and groups 7 to 12 read gitignored
 * local data.
 *
 * THE BRACKET FACTS (group 10). The tab's joint proof reads each division's
 * published alliances and played playoff rows. In the walk they come from
 * the corpus bracket of each key, built with the same two functions the tab
 * uses (`playedBracketMatchesFor`, `dcmpBracketFactsFor`) at the stage the
 * artifact's own state gives the key at that tick. Between "alliance points
 * land" and "playoffs done" five ticks read the artifact unchanged with the
 * played rows of Rounds 1 to 1, 1 to 2 and so on. After the playoff points
 * land comes THE WINDOW: the divisions' award points land and every
 * division's state reads finished while the finals key is still on no row.
 *
 * THE FINALS TICKS (group 6). After the playoff points land the finals rows
 * post with their Playoffs points and no state, then the finals' state is
 * written with its playoffs done, then the finals' award points land while
 * the awards flag is not yet true. The Champ Locks tab's own series is
 * asserted through those ticks too: no Locked is taken back. Before the last
 * step of this quick task its ceiling test read the finals differently for a
 * team with a finals row and a team without one (a finals row carried the
 * championship's Awards ceiling), and at the tick the finals' award points
 * land it took 3 Locked back at 2026 FIM and 4 at ONT with no bracket facts
 * in hand, and 2 at FIM and 1 at TX with them.
 *
 * IT PROVES SOMETHING. The same walk runs with the rule switched off inside
 * this file (the core proof answering as the code read the field before this
 * task, through a module mock, everything else left on) and must then take a
 * Locked back. The second walk also runs with the finals part of a rowless
 * team's hypothetical championship switched off
 * (`hypotheticalFinalsCeiling`), and the published walks with a
 * championship's stateless first rows read as hindsight again
 * (`statelessChampionshipRowReadsOpen`). The switched off totals are PINNED
 * AS THE RUN SHOWS: they are a measurement of the old reading, not a
 * requirement.
 *
 * A GROUP THAT READS GITIGNORED LOCAL DATA skips, with a message naming what
 * is absent, where the data is not there. With `REQUIRE_LOCAL_DATA=1` in the
 * environment the same group FAILS instead, so a verify step cannot pass on a
 * machine that silently ran nothing.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDistrictEventState, applyDistrictRankings, recomputeDistrictVerdicts } from "../packages/harness/districtRankingsMerge.js";
import { DistrictArtifactSchema, type DistrictArtifact, type DistrictEventState } from "../packages/harness/pageArtifacts.js";
import { maxEventPoints } from "../packages/core/districts/pointModel.js";
import { fieldFixingDcmpKeys } from "../packages/core/districts/dcmpFieldProof.js";
import { finalsChampionMaximum } from "../packages/core/districts/categoryCorroboration.js";
import { championshipShape } from "../packages/core/districts/finalsBracket.js";
import {
  buildDistrictLedgerRows,
  dcmpBracketFactsFor,
  dcmpBracketMilestonesByTeam,
  deriveStageFromState,
  playedBracketMatchesFor,
  tierEvents,
  type BracketSourceEvent,
  type DistrictEventDistributions,
  type DistrictStageFinality,
} from "../apps/web/src/components/districts/districtLedgerRows.js";
import { bracketRoundOfSet, bracketSetIdFor } from "../packages/core/districts/bracket.js";
import { districtStageAtPosition } from "../apps/web/src/components/districts/districtTimeline.js";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { computeDistrictLedgerStatuses } from "../apps/web/src/components/districts/districtLedgerStatus.js";
import { applyChampionshipFieldOverlay } from "../apps/web/src/components/districts/districtFieldOverlay.js";
import { buildChampLedgerRows, champFieldProofAtNow, dcmpEventKeysFor } from "../apps/web/src/components/districts/champLedgerRows.js";
import { computeChampLedgerStatuses, jointProofBound } from "../apps/web/src/components/districts/champLedgerStatus.js";
import { CORPUS_PATH, LOCAL_DISTRICT_DIR, bracketFromCorpus, bracketsFromCorpus, championshipStops, dcmpStops, statusesAtChampionshipStop } from "./measureChampJointLocks.js";

/**
 * THE SWITCHES. The merge, the row builders and the status code all run as
 * shipped; only the core rule named is answered differently.
 *
 * While `fieldRuleOff` is set the core proof answers as the code read the
 * field before this task: proven as soon as every field fixing key the
 * artifact knows has started, and never "unproven after a start".
 *
 * While `finalsAllowanceOff` is set a team with no championship row carries
 * one whole hypothetical championship and no finals on top, while the field
 * is not proven.
 *
 * While `statelessRowsOff` is set the published verdict pass reads a
 * championship row with no state block as a hindsight row on every path, as
 * it did before this task.
 */
const ruleSwitch = vi.hoisted(() => ({ fieldRuleOff: false, finalsAllowanceOff: false, statelessRowsOff: false }));

vi.mock("../packages/core/districts/dcmpFieldProof.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../packages/core/districts/dcmpFieldProof.js")>();
  return {
    ...original,
    dcmpFieldProof: (...args: Parameters<typeof original.dcmpFieldProof>) => {
      const real = original.dcmpFieldProof(...args);
      if (!ruleSwitch.fieldRuleOff) return real;
      return { ...real, proven: real.started, completeBy: real.started ? ("capacity" as const) : null, unprovenAfterStart: false };
    },
    hypotheticalFinalsCeiling: (...args: Parameters<typeof original.hypotheticalFinalsCeiling>) => (ruleSwitch.finalsAllowanceOff ? 0 : original.hypotheticalFinalsCeiling(...args)),
    statelessChampionshipRowReadsOpen: (...args: Parameters<typeof original.statelessChampionshipRowReadsOpen>) => (ruleSwitch.statelessRowsOff ? false : original.statelessChampionshipRowReadsOpen(...args)),
  };
});

afterEach(() => {
  ruleSwitch.fieldRuleOff = false;
  ruleSwitch.finalsAllowanceOff = false;
  ruleSwitch.statelessRowsOff = false;
});

/** Runs `body` with a championship's stateless first rows read as hindsight again, and switches the rule back on whatever happens. */
function withStatelessRowsOff<T>(body: () => T): T {
  ruleSwitch.statelessRowsOff = true;
  try {
    return body();
  } finally {
    ruleSwitch.statelessRowsOff = false;
  }
}

/** Runs `body` with the field rule switched off, and switches it back on whatever happens. */
function withFieldRuleOff<T>(body: () => T): T {
  ruleSwitch.fieldRuleOff = true;
  try {
    return body();
  } finally {
    ruleSwitch.fieldRuleOff = false;
  }
}

/** Runs `body` with the finals part of the hypothetical championship switched off, and switches it back on whatever happens. */
function withFinalsAllowanceOff<T>(body: () => T): T {
  ruleSwitch.finalsAllowanceOff = true;
  try {
    return body();
  } finally {
    ruleSwitch.finalsAllowanceOff = false;
  }
}

/**
 * A local data gated group whose data is absent: one skipped test naming what
 * is missing, or with `REQUIRE_LOCAL_DATA=1` one FAILING test.
 */
function localDataAbsent(what: string): void {
  if (process.env.REQUIRE_LOCAL_DATA === "1") {
    it(`REQUIRE_LOCAL_DATA=1 and the local data is absent: ${what}`, () => {
      throw new Error(`REQUIRE_LOCAL_DATA=1, but this local data gated group cannot run: ${what}`);
    });
    return;
  }
  it.skip(`skipped: ${what}`, () => {});
}

type Team = DistrictArtifact["teams"][number];
type Row = Team["eventPoints"][number];

const NOW_YEAR = 2026;
const STAMP = { generation: "champ-field-walk", computedAt: "2026-04-18T00:00:00.000Z" } as const;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = join(REPO_ROOT, "data", "fixtures", "phase10");
const fixtureFile: DistrictArtifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(join(FIXTURE_DIR, "district-2026pnw.json"), "utf8")));

const QUAL_TOTAL = 60;
const FINISHED_STATE: DistrictEventState = { qualMatchesPlayed: QUAL_TOTAL, qualMatchesTotal: QUAL_TOTAL, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
const NO_DISTRIBUTIONS: ReadonlyMap<string, DistrictEventDistributions> = new Map();

/** The fixture with a finished state block on every row, at the verdict pass's fixed point. */
const baseline: DistrictArtifact = recomputeDistrictVerdicts(
  DistrictArtifactSchema.parse({ ...fixtureFile, teams: fixtureFile.teams.map((team) => ({ ...team, eventPoints: team.eventPoints.map((row) => ({ ...row, state: { ...FINISHED_STATE } })) })) }),
  { nowYear: NOW_YEAR }
);

/** A tab status of `locked` covers Locked on points and Locked by an award. */
const champTabHeld = (status: string): boolean => status === "locked" || status === "prequalified";

// ---------------------------------------------------------------------------
// What one tick left behind
// ---------------------------------------------------------------------------

interface WalkStep {
  readonly label: string;
  /** The Champ Locks status of every team, from the tab's own status code at Now. */
  readonly champTab: ReadonlyMap<string, string>;
  /** The teams the Champ Locks tab reads Locked by an award (the winning alliance or a judged award). */
  readonly champByAward: ReadonlySet<string>;
  /** Every team's place in the field as the tab's row model reads it at Now. */
  readonly membership: ReadonlyMap<string, string>;
  /** The one flag the tab hands every reader of the field. */
  readonly fieldProven: boolean;
  /** The core proof's own `proven` at Now. */
  readonly proven: boolean;
  /** The champ tier reservation the Champ Locks status code computed. */
  readonly champReserved: number;
  /** How many dcmp keys the artifact knows at this tick. */
  readonly dcmpKeys: number;
  /** What the District Locks tab SHOWS for every team at Live: the raw status, or the field overlay's where it applies. */
  readonly districtTab: ReadonlyMap<string, string>;
  /** Whether the District Locks tab's Live field overlay applied at this tick. */
  readonly overlayActive: boolean;
  /** The PUBLISHED `champLock.status` of every team, on the artifact itself. */
  readonly published: ReadonlyMap<string, string>;
  /** The PUBLISHED `maxRemainingChamp` of every team. */
  readonly publishedCeiling: ReadonlyMap<string, number>;
  /** The teams the PUBLISHED district verdict reads eliminated: below the district cut line. */
  readonly publishedDistrictEliminated: ReadonlySet<string>;
  /** The joint proof at this tick: `applied(shape)`, or the reason it did not run. */
  readonly joint: string;
  /** How many teams the joint proof locked at this tick. */
  readonly jointLocked: number;
  /** The events in progress at this tick by the state's own word (started and not finished), both tiers. */
  readonly inProgressKeys: readonly string[];
  /** Every team's point total on the artifact at this tick. */
  readonly pointTotal: ReadonlyMap<string, number>;
  /** Every team's open ceiling on the Champ Locks tab at this tick: its ceiling minus its floor. */
  readonly tabOpenCeiling: ReadonlyMap<string, number>;
  /** Per team with a posted championship row at this tick: the dcmp keys of its `eventPoints` rows. */
  readonly dcmpPointsKeys: ReadonlyMap<string, readonly string[]>;
  /** Per team with a championship registration at this tick: the dcmp keys of its `remainingEvents` rows. */
  readonly dcmpRegisteredKeys: ReadonlyMap<string, readonly string[]>;
}

/** What a tick hands the Champ Locks status code beside the artifact. */
interface SnapshotReading {
  /** The field's bracket facts and milestones, per dcmp key. Absent, the joint proof is handed nothing, as in the walks without a bracket. */
  readonly distributions?: ReadonlyMap<string, DistrictEventDistributions>;
}

interface Walk {
  readonly steps: readonly WalkStep[];
  /** The teams that end with a row at a field fixing key: the field. */
  readonly fieldTeams: ReadonlySet<string>;
  readonly fieldFixingKeys: readonly string[];
}

/** The dcmp keys the state says have started, as the tab reads them at Now. */
function startedDcmpKeys(artifact: DistrictArtifact): Set<string> {
  const started = new Set<string>();
  for (const team of artifact.teams) for (const entry of tierEvents(team, "dcmp")) if (deriveStageFromState(entry.state).started) started.add(entry.eventKey);
  return new Set(dcmpEventKeysFor(artifact).filter((key) => started.has(key)));
}

/** Reads the Champ Locks tab at Now, as `scripts/measureChampTenets.ts` reads it, with the rows' own field flag handed on. */
function snapshot(label: string, artifact: DistrictArtifact, reading: SnapshotReading = {}): WalkStep {
  const districtRows = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS, tier: "district" });
  const districtStatuses = computeDistrictLedgerStatuses({ artifact, teams: districtRows.teams });
  const districtLockedOut = new Set<string>();
  for (const [teamKey, result] of districtStatuses.byTeam) if (result.status === "lockedOut") districtLockedOut.add(teamKey);

  // The District Locks tab at Live: the raw statuses under the field overlay.
  const districtShown = applyChampionshipFieldOverlay(districtStatuses, artifact, { atLive: true, nowYear: NOW_YEAR });

  const started = startedDcmpKeys(artifact);
  const champRows = buildChampLedgerRows({ artifact, distributions: reading.distributions ?? NO_DISTRIBUTIONS, startedDcmpEventKeys: started, atLivePosition: true, nowYear: NOW_YEAR });
  const champStatuses = computeChampLedgerStatuses({
    artifact,
    teams: champRows.teams,
    districtLockedOut,
    nowYear: NOW_YEAR,
    fieldProven: champRows.fieldProven,
    ...(reading.distributions === undefined ? {} : { distributions: reading.distributions }),
  });
  const jointProof = champStatuses.jointProof;

  // The tab's in progress list, both tiers, from the state alone (`ChampLocksLedger.tsx`).
  const inProgress = new Set<string>();
  for (const tier of ["district", "dcmp"] as const) {
    for (const team of artifact.teams) {
      for (const entry of tierEvents(team, tier)) {
        const stage = deriveStageFromState(entry.state);
        if (stage.started && !stage.finished) inProgress.add(entry.eventKey);
      }
    }
  }

  return {
    label,
    champTab: new Map([...champStatuses.byTeam].map(([teamKey, result]) => [teamKey, result.status] as const)),
    champByAward: new Set([...champStatuses.byTeam].filter(([, result]) => result.byAward).map(([teamKey]) => teamKey)),
    membership: new Map(champRows.teams.map((team) => [team.teamKey, team.membership] as const)),
    fieldProven: champRows.fieldProven,
    proven: champFieldProofAtNow(artifact, started, NOW_YEAR).proven,
    champReserved: champStatuses.reservedSlots,
    dcmpKeys: dcmpEventKeysFor(artifact).length,
    districtTab: new Map([...districtShown.byTeam].map(([teamKey, result]) => [teamKey, result.status] as const)),
    overlayActive: districtShown.fieldOverlay,
    published: new Map(artifact.teams.map((team) => [team.teamKey, team.champLock.status] as const)),
    publishedCeiling: new Map(artifact.teams.map((team) => [team.teamKey, team.maxRemainingChamp] as const)),
    publishedDistrictEliminated: new Set(artifact.teams.filter((team) => team.districtLock.status === "eliminated").map((team) => team.teamKey)),
    joint: jointProof === undefined ? "absent" : jointProof.applied ? `applied(${jointProof.shape})` : jointProof.reason,
    jointLocked: jointProof?.applied === true ? jointProof.locked.size : 0,
    inProgressKeys: [...inProgress].sort(),
    pointTotal: new Map(artifact.teams.map((team) => [team.teamKey, team.pointTotal] as const)),
    tabOpenCeiling: new Map([...(champStatuses.floorByTeam ?? [])].map(([teamKey, floor]) => [teamKey, (champStatuses.ceilingByTeam?.get(teamKey) ?? floor) - floor] as const)),
    dcmpPointsKeys: new Map(
      artifact.teams.flatMap((team) => {
        const keys = team.eventPoints.filter((row) => row.tier === "dcmp").map((row) => row.eventKey);
        return keys.length === 0 ? [] : [[team.teamKey, keys] as const];
      })
    ),
    dcmpRegisteredKeys: new Map(
      artifact.teams.flatMap((team) => {
        const keys = team.remainingEvents.filter((row) => row.tier === "dcmp").map((row) => row.eventKey);
        return keys.length === 0 ? [] : [[team.teamKey, keys] as const];
      })
    ),
  };
}

type PlayoffRow = BracketSourceEvent["matches"][number];
/** The eight alliance bracket round a played row belongs to (1 to 5, the final beyond them). */
const playoffRoundOf = (match: PlayoffRow): number => {
  const setId = bracketSetIdFor(match.compLevel, match.setNumber);
  return setId === undefined ? Infinity : (bracketRoundOfSet(setId) ?? Infinity);
};

/**
 * THE FIELD'S BRACKET FACTS AT A TICK, per dcmp key, as the tab would hold
 * them: each field fixing key's published alliances, its played rows of
 * Rounds 1 to `rounds` (every played row at `Infinity`), the milestones they
 * decide, and the facts the joint proof reads, built at the stage the
 * artifact's own state gives the key now. With `withFinals` the finals key's
 * facts too, from every played finals row.
 */
function fieldDistributions(
  artifact: DistrictArtifact,
  brackets: ReadonlyMap<string, BracketSourceEvent>,
  fieldFixingKeys: readonly string[],
  finalsKeys: readonly string[],
  rounds: number,
  withFinals: boolean
): Map<string, DistrictEventDistributions> {
  const stateByKey = new Map<string, DistrictEventState | undefined>();
  for (const team of artifact.teams) for (const entry of tierEvents(team, "dcmp")) if (stateByKey.get(entry.eventKey) === undefined) stateByKey.set(entry.eventKey, entry.state);
  /** The FIELD's reading: the state alone. A key on no row has no stage at all. */
  const fieldStage = (key: string) => (stateByKey.has(key) ? deriveStageFromState(stateByKey.get(key)).final : undefined);
  const role = fieldFixingKeys.length > 1 && finalsKeys.length > 0 ? ("division" as const) : ("championship" as const);
  const out = new Map<string, DistrictEventDistributions>();
  for (const key of fieldFixingKeys) {
    const bracket = brackets.get(key);
    if (bracket === undefined) throw new Error(`no corpus bracket for ${key}`);
    const alliances = (bracket.alliances ?? []).map((alliance) => ({ allianceNumber: alliance.allianceNumber, picks: [...alliance.picks] }));
    const playedKeys = new Set(bracket.matches.filter((match) => match.actualWinner !== undefined && playoffRoundOf(match) <= rounds).map((match) => match.matchKey));
    const played = playedBracketMatchesFor(bracket, playedKeys);
    const dcmpBracket = dcmpBracketFactsFor({
      eventKey: key,
      season: artifact.year,
      tier: "dcmp",
      stage: fieldStage(key),
      alliances,
      playedMatches: played.matches,
      unresolvedMatchCount: played.unresolvedMatchKeys.length,
      fieldBackups: played.fieldBackups,
      role,
    });
    out.set(key, { eventKey: key, byTeam: new Map(), playoffMilestoneByTeam: dcmpBracketMilestonesByTeam(alliances, played.matches), ...(dcmpBracket === undefined ? {} : { dcmpBracket }) });
  }
  if (withFinals) {
    for (const key of finalsKeys) {
      const bracket = brackets.get(key);
      if (bracket === undefined) throw new Error(`no corpus bracket for ${key}`);
      const alliances = (bracket.alliances ?? []).map((alliance) => ({ allianceNumber: alliance.allianceNumber, picks: [...alliance.picks] }));
      const played = playedBracketMatchesFor(bracket);
      const dcmpBracket = dcmpBracketFactsFor({
        eventKey: key,
        season: artifact.year,
        tier: "dcmp",
        stage: fieldStage(key),
        alliances,
        playedMatches: played.matches,
        unresolvedMatchCount: played.unresolvedMatchKeys.length,
        fieldBackups: played.fieldBackups,
        role: "finals",
        expectedAllianceCount: fieldFixingKeys.length,
      });
      out.set(key, { eventKey: key, byTeam: new Map(), ...(dcmpBracket === undefined ? {} : { dcmpBracket }) });
    }
  }
  return out;
}

/** Every team that held a place at one step and did not at a later one, with both statuses and both steps named. */
function takeBacks(steps: readonly WalkStep[], series: (step: WalkStep) => ReadonlyMap<string, string>, held: (status: string) => boolean): string[] {
  const lost: string[] = [];
  for (const teamKey of series(steps[0]!).keys()) {
    let heldAt = -1;
    for (let index = 0; index < steps.length; index++) {
      const status = series(steps[index]!).get(teamKey) ?? "absent";
      if (held(status)) {
        if (heldAt === -1) heldAt = index;
      } else if (heldAt !== -1) {
        lost.push(`${teamKey} ${series(steps[heldAt]!).get(teamKey)!} at "${steps[heldAt]!.label}", ${status} at "${steps[index]!.label}"`);
        break;
      }
    }
  }
  return lost;
}

/** Every team of the field that the row model reads `out` at some tick, with the first such tick. */
function fieldTeamsReadOut(walk: Walk): string[] {
  const out: string[] = [];
  for (const teamKey of [...walk.fieldTeams].sort()) {
    const step = walk.steps.find((entry) => entry.membership.get(teamKey) === "out");
    if (step !== undefined) out.push(`${teamKey} out at "${step.label}"`);
  }
  return out;
}

/** Every team the row model reads `out` at one tick and `in` at a later one. */
function outThenIn(walk: Walk): string[] {
  const found: string[] = [];
  for (const teamKey of walk.steps[0]!.membership.keys()) {
    let wasOut = false;
    for (const step of walk.steps) {
      const membership = step.membership.get(teamKey);
      if (membership === "out") wasOut = true;
      else if (wasOut && membership === "in") {
        found.push(teamKey);
        break;
      }
    }
  }
  return found.sort();
}

/**
 * THE DISTRICT LOCKS TAB: every team of the field that the tab shows Locked at
 * one tick and Declined or Locked out at a later one, with both ticks named.
 * A team of the field earned or was given its place and is playing, so
 * either reading after Locked is a Locked taken back.
 */
function districtLockedThenLost(walk: Walk): string[] {
  const lost: string[] = [];
  for (const teamKey of [...walk.fieldTeams].sort()) {
    let lockedAt = -1;
    for (let index = 0; index < walk.steps.length; index++) {
      const status = walk.steps[index]!.districtTab.get(teamKey) ?? "absent";
      if (status === "locked") {
        if (lockedAt === -1) lockedAt = index;
      } else if (lockedAt !== -1 && (status === "declined" || status === "lockedOut")) {
        lost.push(`${teamKey} locked at "${walk.steps[lockedAt]!.label}", ${status} at "${walk.steps[index]!.label}"`);
        break;
      }
    }
  }
  return lost;
}

/** How many teams of the field the District Locks tab shows Locked, then Declined, then Locked again. */
function districtLockedDeclinedLocked(walk: Walk): number {
  let count = 0;
  for (const teamKey of walk.fieldTeams) {
    let phase = 0;
    for (const step of walk.steps) {
      const status = step.districtTab.get(teamKey);
      if (phase === 0 && status === "locked") phase = 1;
      else if (phase === 1 && status === "declined") phase = 2;
      else if (phase === 2 && status === "locked") {
        count += 1;
        break;
      }
    }
  }
  return count;
}

/** The labels of the ticks at which any team reads Declined while the core proof does not read proven. */
function declinedWhileUnproven(steps: readonly WalkStep[]): string[] {
  return steps.filter((step) => !step.proven && [...step.districtTab.values()].includes("declined")).map((step) => step.label);
}

/** A published champ verdict that holds a place. */
const publishedHeld = (status: string): boolean => status === "locked" || status === "lockedAward" || status === "prequalified";

/**
 * Every team whose published `maxRemainingChamp` DROPS at one tick and RISES
 * at a later one, with the rise named. A ceiling that only ever falls is the
 * season being played; one that falls and comes back is a ceiling the pass
 * took away too early.
 */
function publishedCeilingDropsThenRises(steps: readonly WalkStep[]): string[] {
  const found: string[] = [];
  for (const teamKey of steps[0]!.publishedCeiling.keys()) {
    let dropped = false;
    let previous = steps[0]!.publishedCeiling.get(teamKey)!;
    for (let index = 1; index < steps.length; index++) {
      const value = steps[index]!.publishedCeiling.get(teamKey) ?? previous;
      if (value < previous) dropped = true;
      else if (dropped && value > previous) {
        found.push(`${teamKey} ${String(previous)} to ${String(value)} at "${steps[index]!.label}"`);
        break;
      }
      previous = value;
    }
  }
  return found;
}

/** One published ceiling that rose at the tick after one at which the field read unproven after a start. */
interface UnprovenCeilingRise {
  readonly teamKey: string;
  readonly line: string;
  /** Whether the published district verdict read the team eliminated (below the district cut line) at the tick before. */
  readonly belowTheDistrictLine: boolean;
}

/**
 * Every team whose published `maxRemainingChamp` RISES at the tick after one
 * at which the field read unproven after a start. While the field is
 * unproven a team with no row carries what it will carry the moment its
 * rows land, so nothing should rise out of such a tick: not when a division's
 * rows land, not when its state does, not when the field proves.
 *
 * ONE STATED LIMIT REMAINS, and each rise says whether it is that one. A
 * team the district tier reads eliminated carries no hypothetical
 * championship, here and on the Champ Locks tab alike, and a few such teams
 * attend all the same (a place given up and handed down). Their ceiling goes
 * from nothing to a whole championship when their row lands.
 */
function publishedCeilingRisesWhileUnproven(steps: readonly WalkStep[]): UnprovenCeilingRise[] {
  const rises: UnprovenCeilingRise[] = [];
  for (let index = 1; index < steps.length; index++) {
    const before = steps[index - 1]!;
    if (before.fieldProven) continue;
    for (const [teamKey, value] of steps[index]!.publishedCeiling) {
      const previous = before.publishedCeiling.get(teamKey) ?? value;
      if (value > previous) {
        rises.push({ teamKey, line: `${teamKey} ${String(previous)} to ${String(value)} at "${steps[index]!.label}"`, belowTheDistrictLine: before.publishedDistrictEliminated.has(teamKey) });
      }
    }
  }
  return rises;
}

/** The rises that are NOT the stated limit: a team that could still attend, whose ceiling rose all the same. */
const unexplainedCeilingRises = (steps: readonly WalkStep[]): string[] => publishedCeilingRisesWhileUnproven(steps).filter((rise) => !rise.belowTheDistrictLine).map((rise) => rise.line);
/** How many teams below the district line attended all the same and gained their ceiling only when their row landed. */
const belowTheLineAttendees = (steps: readonly WalkStep[]): number => new Set(publishedCeilingRisesWhileUnproven(steps).filter((rise) => rise.belowTheDistrictLine).map((rise) => rise.teamKey)).size;

/** The labels of the ticks at which the Champ Locks reservation is above the tick before it. */
function reservationRises(steps: readonly WalkStep[]): string[] {
  const rises: string[] = [];
  for (let index = 1; index < steps.length; index++) {
    if (steps[index]!.champReserved > steps[index - 1]!.champReserved) rises.push(`${steps[index]!.label}: ${String(steps[index - 1]!.champReserved)} to ${String(steps[index]!.champReserved)}`);
  }
  return rises;
}

/** The labels of the ticks at which the core proof read proven after an earlier tick read it and a tick between did not: the D11 property. */
function provenTakenBack(steps: readonly WalkStep[]): string[] {
  const lost: string[] = [];
  let wasProven = false;
  for (const step of steps) {
    if (wasProven && !step.proven) lost.push(step.label);
    wasProven = wasProven || step.proven;
  }
  return lost;
}

// ---------------------------------------------------------------------------
// The walker: one source artifact rewound to before its championship
// ---------------------------------------------------------------------------

type PointsStage = "qual" | "alliance" | "elim" | "all";
type StatePhase = "started" | "qualDone" | "picked" | "done";

interface FieldWalkOptions {
  /**
   * The other start: every attending team carries a registration (a
   * `remainingEvents` row with no state) at its own field fixing key before
   * anything is played, as after an offline district publish that ran once
   * registrations were open. An event's state can then be written before its
   * rows post, and it is: one "started on the field" tick per key.
   */
  readonly registeredFirst?: boolean;
  /** Walk on through the finals: their rows with no state, their state, their award points. */
  readonly finalsTicks?: boolean;
  /**
   * Each dcmp key's corpus bracket. With it the tab is handed the field's
   * bracket facts at every tick from "alliances picked" on, five round ticks
   * are read between "alliance points land" and "playoffs done", and the
   * window ticks are walked (the divisions' award points land, then every
   * division's state reads finished, the finals key still on no row).
   */
  readonly brackets?: ReadonlyMap<string, BracketSourceEvent>;
}

const shortKey = (eventKey: string): string => eventKey.slice(4);

/**
 * Walks `source` from "no dcmp row" (or from every attending team
 * registered) to the source artifact itself, one field fixing key at a time,
 * through the two merge entry points.
 */
function walkChampionshipField(source: DistrictArtifact, options: FieldWalkOptions = {}): Walk {
  const dcmpKeys = dcmpEventKeysFor(source);
  const fieldFixingKeys = fieldFixingDcmpKeys(dcmpKeys);
  const finalsKeys = dcmpKeys.filter((key) => !fieldFixingKeys.includes(key));
  const dcmpMaxima = maxEventPoints(source.year, "dcmp");
  const dcmpEventMaxTotal = dcmpMaxima.qual + dcmpMaxima.alliance + dcmpMaxima.elim + dcmpMaxima.award;
  const finalRow = new Map<string, Map<string, Row>>(dcmpKeys.map((key) => [key, new Map<string, Row>()] as const));
  for (const team of source.teams) for (const row of team.eventPoints) if (row.tier === "dcmp") finalRow.get(row.eventKey)!.set(team.teamKey, row);
  const fieldTeams = new Set<string>();
  for (const key of fieldFixingKeys) for (const teamKey of finalRow.get(key)!.keys()) fieldTeams.add(teamKey);
  const dcmpTotal = (team: Team): number => team.eventPoints.filter((row) => row.tier === "dcmp").reduce((sum, row) => sum + row.total, 0);

  // Before the first tick: no dcmp row anywhere. Every championship row, its
  // points and the awards given there leave the artifact, and the verdict
  // pass is told a championship is still ahead, as the offline publisher's
  // calendar would tell it.
  let artifact: DistrictArtifact = recomputeDistrictVerdicts(
    DistrictArtifactSchema.parse({
      ...source,
      teams: source.teams.map((team) => {
        const own = team.eventPoints.find((row) => fieldFixingKeys.includes(row.eventKey));
        const stripped = team.remainingEvents.filter((row) => row.tier !== "dcmp");
        return {
          ...team,
          pointTotal: team.pointTotal - dcmpTotal(team),
          eventPoints: team.eventPoints.filter((row) => row.tier !== "dcmp"),
          remainingEvents:
            options.registeredFirst === true && own !== undefined
              ? [...stripped, { eventKey: own.eventKey, eventName: own.eventName, week: own.week, tier: "dcmp" as const, maxPoints: dcmpEventMaxTotal }]
              : stripped,
          qualifyingAwards: team.qualifyingAwards.filter((award) => !dcmpKeys.includes(award.eventKey)),
        };
      }),
    }),
    { nowYear: NOW_YEAR, dcmpStillAhead: true }
  );

  // What TBA has posted so far, per key, and the state the match feed shows.
  const posted = new Map<string, PointsStage>();
  const states = new Map<string, DistrictEventState>();
  const pointsAt = (row: Row, stage: PointsStage) => ({
    qual: row.qual,
    alliance: stage === "qual" ? 0 : row.alliance,
    elim: stage === "elim" || stage === "all" ? row.elim : 0,
    award: stage === "all" ? row.award : 0,
  });

  /** A TBA shaped rankings payload: every district tier row as published, and the championship rows posted so far at the points they carry so far. */
  const payload = () =>
    source.teams.map((team) => {
      const others = team.eventPoints
        .filter((row) => row.tier !== "dcmp")
        .map((row) => ({ event_key: row.eventKey, district_cmp: false, qual_points: row.qual, alliance_points: row.alliance, elim_points: row.elim, award_points: row.award, total: row.total }));
      let total = team.pointTotal - dcmpTotal(team);
      const championship: { event_key: string; district_cmp: boolean; qual_points: number; alliance_points: number; elim_points: number; award_points: number; total: number }[] = [];
      for (const [key, stage] of posted) {
        const row = finalRow.get(key)!.get(team.teamKey);
        if (row === undefined) continue;
        const points = pointsAt(row, stage);
        const sum = points.qual + points.alliance + points.elim + points.award;
        // TBA writes a finals row only for a team it pays there, so a finals
        // row with nothing to show yet has not been posted yet.
        if (sum === 0 && finalsKeys.includes(key)) continue;
        total += sum;
        championship.push({ event_key: key, district_cmp: true, qual_points: points.qual, alliance_points: points.alliance, elim_points: points.elim, award_points: points.award, total: sum });
      }
      return { team_key: team.teamKey, rank: team.rank, point_total: total, rookie_bonus: team.rookieBonus, adjustments: team.adjustments, event_points: [...others, ...championship] };
    });

  const stateFor = (key: string, phase: StatePhase): DistrictEventState => {
    const total = [...finalRow.get(key)!.values()][0]?.state?.qualMatchesTotal ?? QUAL_TOTAL;
    return {
      qualMatchesPlayed: phase === "started" ? Math.max(1, total - 10) : total,
      qualMatchesTotal: total,
      alliancesPicked: phase === "picked" || phase === "done",
      playoffsDone: phase === "done",
      awardsPosted: false,
    };
  };
  const carries = (key: string): boolean => artifact.teams.some((team) => team.eventPoints.some((row) => row.eventKey === key) || team.remainingEvents.some((row) => row.eventKey === key));
  /** As the Worker does: the state of an event is handed only once the artifact already carries a row for it. */
  const statesInHand = (): Map<string, DistrictEventState> => new Map([...states].filter(([key]) => carries(key)));

  const steps: WalkStep[] = [];
  /** The bracket facts a tick hands the tab: the played rows of Rounds 1 to `rounds`, and the finals' own. Absent, none. */
  interface FactsAt {
    readonly rounds: number;
    readonly withFinals: boolean;
  }
  const brackets = options.brackets;
  const facts = (rounds: number, withFinals = false): FactsAt | undefined => (brackets === undefined ? undefined : { rounds, withFinals });
  const record = (label: string, at?: FactsAt): void => {
    const reading: SnapshotReading = brackets === undefined || at === undefined ? {} : { distributions: fieldDistributions(artifact, brackets, fieldFixingKeys, finalsKeys, at.rounds, at.withFinals) };
    steps.push(snapshot(label, artifact, reading));
  };
  const rowsTick = (label: string, at?: FactsAt): void => {
    artifact = applyDistrictRankings({ artifact, rankings: payload(), ...STAMP, eventState: statesInHand() });
    record(label, at);
  };
  const stateTick = (label: string, at?: FactsAt): void => {
    const inHand = statesInHand();
    if (inHand.size > 0) artifact = applyDistrictEventState({ artifact, eventState: inHand, ...STAMP });
    record(label, at);
  };

  record(options.registeredFirst === true ? "every attending team registered" : "no dcmp row");
  for (const key of fieldFixingKeys) {
    states.set(key, stateFor(key, "started"));
    // With a registration on the artifact the Worker has a row to write the state on before any points post.
    if (options.registeredFirst === true) stateTick(`${shortKey(key)} started on the field, state only`);
    posted.set(key, "qual");
    rowsTick(`${shortKey(key)} rows posted`);
    stateTick(`${shortKey(key)} state written`);
  }
  for (const key of fieldFixingKeys) states.set(key, stateFor(key, "qualDone"));
  stateTick("qualification done everywhere");
  for (const key of fieldFixingKeys) states.set(key, stateFor(key, "picked"));
  stateTick("alliances picked, no alliance points", facts(0));
  for (const key of fieldFixingKeys) posted.set(key, "alliance");
  rowsTick("alliance points land", facts(0));
  // With the brackets in hand: the playoffs are played on the field while the
  // artifact stands still, one round at a time.
  if (brackets !== undefined) for (let round = 1; round <= 5; round++) record(`after Round ${String(round)}`, facts(round));
  for (const key of fieldFixingKeys) states.set(key, stateFor(key, "done"));
  stateTick("playoffs done, no playoff points", facts(Infinity));
  for (const key of fieldFixingKeys) posted.set(key, "elim");
  rowsTick("playoff points land", facts(Infinity));
  if (brackets !== undefined) {
    // THE WINDOW between the divisions and the finals: the divisions' award
    // points land, then every division's state reads finished. Nothing of the
    // championship is in progress, and the finals key is still on no row.
    for (const key of fieldFixingKeys) posted.set(key, "all");
    rowsTick("division award points land, finals on no row", facts(Infinity));
    for (const key of fieldFixingKeys) states.set(key, { ...stateFor(key, "done"), awardsPosted: true });
    stateTick("every division finished, finals on no row", facts(Infinity));
  }
  if (options.finalsTicks === true && finalsKeys.length > 0) {
    // The finals rows post with their Playoffs points: first with no state
    // block (the Worker has nowhere to put it), then the state, then the
    // finals' award points while the awards flag is not yet true. The finals'
    // own bracket facts are in hand once the finals have a state.
    for (const key of finalsKeys) posted.set(key, "elim");
    rowsTick("finals rows posted, no state", facts(Infinity));
    for (const key of finalsKeys) states.set(key, { qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: true, playoffsDone: true, awardsPosted: false });
    stateTick("finals state written", facts(Infinity, true));
    for (const key of finalsKeys) posted.set(key, "all");
    rowsTick("finals award points land", facts(Infinity, true));
  }
  artifact = source;
  record("the source artifact");

  return { steps, fieldTeams, fieldFixingKeys };
}

/**
 * THE SECOND WALK: the points arrive only as each event ends. The first
 * `finalAtStart` field fixing keys start wholly final, exactly as `source`
 * publishes them (rows, state and the awards given there). Every other dcmp
 * key is on no row. Each further field fixing key then posts its rows with
 * every point they end on and no state block, and has its state written
 * with its playoffs done and its awards flag not yet true. The last entry is
 * the source artifact itself.
 */
function walkPointsAtEventEnd(source: DistrictArtifact, finalAtStart: number): Walk {
  const dcmpKeys = dcmpEventKeysFor(source);
  const fieldFixingKeys = fieldFixingDcmpKeys(dcmpKeys);
  const kept = fieldFixingKeys.slice(0, finalAtStart);
  const later = fieldFixingKeys.slice(finalAtStart);
  const hiddenAtStart = new Set(dcmpKeys.filter((key) => !kept.includes(key)));
  const fieldTeams = new Set<string>();
  for (const team of source.teams) if (team.eventPoints.some((row) => fieldFixingKeys.includes(row.eventKey))) fieldTeams.add(team.teamKey);
  const totalAt = (team: Team, keys: ReadonlySet<string>): number => team.eventPoints.filter((row) => keys.has(row.eventKey)).reduce((sum, row) => sum + row.total, 0);

  let artifact: DistrictArtifact = recomputeDistrictVerdicts(
    DistrictArtifactSchema.parse({
      ...source,
      teams: source.teams.map((team) => ({
        ...team,
        pointTotal: team.pointTotal - totalAt(team, hiddenAtStart),
        eventPoints: team.eventPoints.filter((row) => !hiddenAtStart.has(row.eventKey)),
        remainingEvents: team.remainingEvents.filter((row) => !hiddenAtStart.has(row.eventKey)),
        qualifyingAwards: team.qualifyingAwards.filter((award) => !hiddenAtStart.has(award.eventKey)),
      })),
    }),
    { nowYear: NOW_YEAR, dcmpStillAhead: true }
  );

  const steps: WalkStep[] = [];
  const startLabel = finalAtStart === 0 ? "no dcmp row" : `${kept.map(shortKey).join(", ")} wholly final, the others on no row`;
  steps.push(snapshot(startLabel, artifact));
  const hidden = new Set(hiddenAtStart);
  for (const key of later) {
    hidden.delete(key);
    // The key's rows post with every point they end on. No state is handed:
    // the artifact the Worker read carried no row for this event.
    const rankings = source.teams.map((team) => ({
      team_key: team.teamKey,
      rank: team.rank,
      point_total: team.pointTotal - totalAt(team, hidden),
      rookie_bonus: team.rookieBonus,
      adjustments: team.adjustments,
      event_points: team.eventPoints
        .filter((row) => !hidden.has(row.eventKey))
        .map((row) => ({ event_key: row.eventKey, district_cmp: row.tier === "dcmp", qual_points: row.qual, alliance_points: row.alliance, elim_points: row.elim, award_points: row.award, total: row.total })),
    }));
    artifact = applyDistrictRankings({ artifact, rankings, ...STAMP });
    steps.push(snapshot(`${shortKey(key)} rows posted with every point, no state`, artifact));
    const published = source.teams.flatMap((team) => team.eventPoints).find((row) => row.eventKey === key)!.state;
    const total = published?.qualMatchesTotal ?? QUAL_TOTAL;
    const state: DistrictEventState = { qualMatchesPlayed: total, qualMatchesTotal: total, alliancesPicked: true, playoffsDone: true, awardsPosted: false };
    artifact = applyDistrictEventState({ artifact, eventState: new Map([[key, state]]), ...STAMP });
    steps.push(snapshot(`${shortKey(key)} state written, awards flag not yet true`, artifact));
  }
  steps.push(snapshot("the source artifact", source));
  return { steps, fieldTeams, fieldFixingKeys };
}

/** One line per tick of a walk, for the printed tables. */
function tickTable(walk: Walk): string[] {
  return walk.steps.map(
    (step) => `  ${step.label.padEnd(58)} fieldProven=${String(step.fieldProven).padEnd(5)} reserved=${String(step.champReserved).padStart(2)} held=${String([...step.champTab.values()].filter(champTabHeld).length)}`
  );
}

// ---------------------------------------------------------------------------
// GROUP 1. A synthetic championship in four divisions
// ---------------------------------------------------------------------------

const SYNTHETIC_STEM = "2026pncmp";
/** The award points of a consuming judged award at a 2026 championship. */
const SYNTHETIC_FINALS_AWARD = 30;

interface SyntheticDivisioned {
  /** How many divisions the championship is played in. */
  readonly divisions: number;
  /** How many teams each division holds. */
  readonly divisionSize: number;
  /** How many teams the district has in all: the field first, the rest on no championship row. */
  readonly teamCount: number;
  readonly cmpSlots: number;
  /**
   * Whether the championship has a finals event (the parent key). Division
   * one's winning alliance is the champion and is paid the finals champion
   * value there, division two's the finalist value, and the first team
   * outside the field is given a consuming award at the finals without
   * having played in a division.
   */
  readonly withFinals?: boolean;
}

/**
 * A championship in divisions over the fixture's first teams. Team `index`
 * below the field size plays division `index % divisions`, so every division
 * holds a spread of strengths, and the district points fall steeply enough
 * that the strongest teams do lock before the walk ends; the others carry
 * one finished district row
 * and no championship row. In each division the three strongest are the
 * winning alliance. Identity fields and award profiles are the fixture's
 * own. Only the numbers are synthetic. No award is given.
 */
function syntheticDivisioned(shape: SyntheticDivisioned): DistrictArtifact {
  const districtRow = baseline.teams.flatMap((team) => team.eventPoints).find((row) => row.tier === "district")!;
  const dcmpRow = baseline.teams.flatMap((team) => team.eventPoints).find((row) => row.tier === "dcmp")!;
  const fieldSize = shape.divisions * shape.divisionSize;
  const finalsChampion = finalsChampionMaximum(NOW_YEAR, shape.divisions);
  const finalsFinalist = Math.floor(finalsChampion / 2);
  const teams = baseline.teams.slice(0, shape.teamCount).map((team, index) => {
    const inField = index < fieldSize;
    const district = inField ? 150 - 8 * index : 20 - (index - fieldSize);
    const base = { ...team, rank: index + 1, rookieBonus: 0, adjustments: 0, remainingEvents: [], qualifyingAwards: [] };
    const districtPoints = { ...districtRow, qual: district, alliance: 0, elim: 0, award: 0, total: district, state: { ...FINISHED_STATE } };
    const finalsRow = (elim: number, award: number) => ({ ...dcmpRow, eventKey: SYNTHETIC_STEM, eventName: `${dcmpRow.eventName} Finals`, qual: 0, alliance: 0, elim, award, total: elim + award, state: { ...FINISHED_STATE } });
    if (!inField) {
      // The first team outside the field: a consuming award at the finals, and nothing else there.
      if (shape.withFinals === true && index === fieldSize) {
        return {
          ...base,
          pointTotal: district + SYNTHETIC_FINALS_AWARD,
          eventPoints: [districtPoints, finalsRow(0, SYNTHETIC_FINALS_AWARD)],
          qualifyingAwards: [{ eventKey: SYNTHETIC_STEM, awardType: 9, label: "Engineering Inspiration", awardOnly: false }],
        };
      }
      return { ...base, pointTotal: district, eventPoints: [districtPoints] };
    }
    const division = index % shape.divisions;
    const place = Math.floor(index / shape.divisions);
    const qual = 60 - 6 * place;
    const alliance = place < 3 ? 48 - 8 * place : 0;
    const elim = place < 3 ? 90 : 0;
    const total = qual + alliance + elim;
    const divisionPoints = { ...dcmpRow, eventKey: `${SYNTHETIC_STEM}${String(division + 1)}`, eventName: `${dcmpRow.eventName} Division ${String(division + 1)}`, qual, alliance, elim, award: 0, total, state: { ...FINISHED_STATE } };
    // The finals: division one's winners are the champions, division two's the finalists.
    const finalsElim = shape.withFinals === true && place < 3 ? (division === 0 ? finalsChampion : division === 1 ? finalsFinalist : 0) : 0;
    // The Impact award goes to the strongest team, at the finals.
    const finalsAward = shape.withFinals === true && index === 0 ? SYNTHETIC_FINALS_AWARD : 0;
    return {
      ...base,
      pointTotal: district + total + finalsElim + finalsAward,
      eventPoints: finalsElim + finalsAward > 0 ? [districtPoints, divisionPoints, finalsRow(finalsElim, finalsAward)] : [districtPoints, divisionPoints],
      qualifyingAwards: [
        ...(finalsElim === finalsChampion && finalsChampion > 0 ? [{ eventKey: SYNTHETIC_STEM, awardType: 1, label: "Winner", awardOnly: false }] : []),
        ...(finalsAward > 0 ? [{ eventKey: SYNTHETIC_STEM, awardType: 0, label: "Impact", awardOnly: false }] : []),
      ],
    };
  });
  return recomputeDistrictVerdicts(DistrictArtifactSchema.parse({ ...baseline, dcmpSlots: fieldSize, cmpSlots: shape.cmpSlots, teams }), { nowYear: NOW_YEAR });
}

/** The premise's numbers: 16 teams in four divisions of four, 30 teams in the district, 21 Championship slots. */
const FOUR_DIVISIONS: SyntheticDivisioned = { divisions: 4, divisionSize: 4, teamCount: 30, cmpSlots: 21 };
const S4 = syntheticDivisioned(FOUR_DIVISIONS);
const S4_KEYS = [1, 2, 3, 4].map((n) => `${SYNTHETIC_STEM}${String(n)}`);

describe("the staged live walk: a synthetic championship in four divisions, one division posted at a time (quick task 261010-66y)", () => {
  it("premise: four field fixing keys on one stem and no parent row, 16 teams in divisions of 4, 16 championship places, 21 Championship slots, and the other teams on no championship row", () => {
    expect(dcmpEventKeysFor(S4)).toEqual(S4_KEYS);
    expect(fieldFixingDcmpKeys(dcmpEventKeysFor(S4))).toEqual(S4_KEYS);
    expect(championshipShape(dcmpEventKeysFor(S4)).kind).toBe("unsupported");
    expect(S4.teams).toHaveLength(30);
    expect(S4.dcmpSlots).toBe(16);
    expect(S4.cmpSlots).toBe(21);
    for (const key of S4_KEYS) expect(S4.teams.filter((team) => team.eventPoints.some((row) => row.eventKey === key))).toHaveLength(4);
    const rowless = S4.teams.filter((team) => team.eventPoints.every((row) => row.tier !== "dcmp") && team.remainingEvents.every((row) => row.tier !== "dcmp"));
    expect(rowless).toHaveLength(14);
  });

  it("rules on: no Locked is taken back, no team of the field ever reads out, and the field reads unproven from the first state written until the last division's", () => {
    const walk = walkChampionshipField(S4);
    expect(walk.steps.map((step) => step.label)).toEqual([
      "no dcmp row",
      "pncmp1 rows posted",
      "pncmp1 state written",
      "pncmp2 rows posted",
      "pncmp2 state written",
      "pncmp3 rows posted",
      "pncmp3 state written",
      "pncmp4 rows posted",
      "pncmp4 state written",
      "qualification done everywhere",
      "alliances picked, no alliance points",
      "alliance points land",
      "playoffs done, no playoff points",
      "playoff points land",
      "the source artifact",
    ]);
    expect(walk.fieldTeams.size).toBe(16);
    expect(takeBacks(walk.steps, (step) => step.champTab, champTabHeld)).toEqual([]);
    expect(fieldTeamsReadOut(walk)).toEqual([]);
    expect(outThenIn(walk)).toEqual([]);
    // The District Locks tab: its overlay applies exactly while the field is proven, and no team of the field loses a Locked.
    expect(districtLockedThenLost(walk)).toEqual([]);
    expect(declinedWhileUnproven(walk.steps)).toEqual([]);
    expect(walk.steps.map((step) => step.overlayActive)).toEqual(walk.steps.map((step) => step.proven));

    // The one flag: true while nothing has started, false from the first
    // division's state until the last division's, true from then on.
    const firstState = walk.steps.findIndex((step) => step.label === "pncmp1 state written");
    const lastState = walk.steps.findIndex((step) => step.label === "pncmp4 state written");
    expect(walk.steps.map((step) => step.fieldProven)).toEqual(walk.steps.map((_, index) => index < firstState || index >= lastState));

    // The walk is not vacuous: places are held by its end, and some are held before it.
    const heldAt = (label: string): number => [...walk.steps.find((step) => step.label === label)!.champTab.values()].filter(champTabHeld).length;
    expect(heldAt("the source artifact")).toBeGreaterThan(0);
    expect(heldAt("playoff points land")).toBeGreaterThan(0);
    console.log(
      ["[261010-66y group 1] rules on, synthetic four divisions:", ...walk.steps.map((step) => `  ${step.label.padEnd(38)} fieldProven=${String(step.fieldProven).padEnd(5)} reserved=${String(step.champReserved).padStart(2)} held=${String([...step.champTab.values()].filter(champTabHeld).length)}`)].join("\n")
    );
  });

  it("D11: the core proof never goes from proven to not proven while rows are only added, and the reservation never rises once the first division has started", () => {
    const walk = walkChampionshipField(S4);
    expect(provenTakenBack(walk.steps)).toEqual([]);
    expect(walk.steps.some((step) => step.proven)).toBe(true);
    const fromFirstState = walk.steps.slice(walk.steps.findIndex((step) => step.label === "pncmp1 state written"));
    for (let index = 1; index < fromFirstState.length; index++) {
      expect({ label: fromFirstState[index]!.label, rises: fromFirstState[index]!.champReserved > fromFirstState[index - 1]!.champReserved }).toEqual({ label: fromFirstState[index]!.label, rises: false });
    }
  });

  it("rule off: the same walk takes Locked back and reads teams of the field out, pinned as the run shows", () => {
    const walk = withFieldRuleOff(() => walkChampionshipField(S4));
    const lost = takeBacks(walk.steps, (step) => step.champTab, champTabHeld);
    const readOut = fieldTeamsReadOut(walk);
    console.log(`[261010-66y group 1] rule off, synthetic four divisions: Locked taken back ${String(lost.length)}, teams of the field read out ${String(readOut.length)}`);
    for (const line of lost) console.log(`  ${line}`);
    expect(lost.length).toBeGreaterThan(0);
    expect(readOut.length).toBeGreaterThan(0);
    // PINNED AS THE RUN SHOWS, with the premise's sizes unchanged: nine teams
    // read Locked once the first division's state is written (three of
    // them in divisions that are on no row yet, and so read out of the
    // field with no ceiling), and every one loses it when the second
    // division's rows post. The twelve teams of the other three divisions
    // all read out of the field at that first state.
    expect({ lockedTakenBack: lost.length, fieldTeamsReadOut: readOut.length }).toEqual({ lockedTakenBack: 9, fieldTeamsReadOut: 12 });
    expect(new Set(lost.map((line) => /at "([^"]*)"$/.exec(line)![1]))).toEqual(new Set(["pncmp2 rows posted"]));
    // The District Locks tab with the rule off, pinned as the run shows:
    // teams of the field shown Locked and then Declined, and of them the
    // ones shown Locked again later.
    expect({ districtLockedThenLost: districtLockedThenLost(walk).length, lockedDeclinedLocked: districtLockedDeclinedLocked(walk) }).toEqual({ districtLockedThenLost: 12, lockedDeclinedLocked: 12 });
  });

  /** The second walk from every start: no division final, then the first one, two and three. */
  const STARTS = [0, 1, 2, 3] as const;

  it("the points arriving only as each division ends, rules on: no Locked is taken back from any start, no team of the field reads out, and the proof never goes back", () => {
    const table: string[] = [];
    for (const finalAtStart of STARTS) {
      const walk = walkPointsAtEventEnd(S4, finalAtStart);
      expect(walk.steps).toHaveLength(2 + 2 * (4 - finalAtStart));
      expect({ finalAtStart, lost: takeBacks(walk.steps, (step) => step.champTab, champTabHeld) }).toEqual({ finalAtStart, lost: [] });
      expect({ finalAtStart, out: fieldTeamsReadOut(walk) }).toEqual({ finalAtStart, out: [] });
      expect({ finalAtStart, proofLost: provenTakenBack(walk.steps) }).toEqual({ finalAtStart, proofLost: [] });
      table.push(`  start: ${String(finalAtStart)} of 4 divisions final`, ...tickTable(walk));
    }
    console.log(["[261010-66y group 1] the points arriving only as each division ends, rules on, synthetic four divisions:", ...table].join("\n"));
  });

  it("the points arriving only as each division ends, each rule off in turn, pinned as the run shows", () => {
    const measure = (run: (finalAtStart: number) => Walk) => STARTS.map((finalAtStart) => takeBacks(run(finalAtStart).steps, (step) => step.champTab, champTabHeld).length);
    const fieldOff = measure((finalAtStart) => withFieldRuleOff(() => walkPointsAtEventEnd(S4, finalAtStart)));
    const allowanceOff = measure((finalAtStart) => withFinalsAllowanceOff(() => walkPointsAtEventEnd(S4, finalAtStart)));
    console.log(`[261010-66y group 1] the points arriving only as each division ends, synthetic four divisions, Locked taken back from 0, 1, 2 and 3 final divisions: field rule off ${fieldOff.join(", ")}; finals part of the hypothetical championship off ${allowanceOff.join(", ")}`);
    // PINNED AS THE RUN SHOWS. With the field rule off every start takes
    // Locked back. With only the finals part of the hypothetical
    // championship off this synthetic takes NONE back, said plainly: while
    // its field is unproven the championships held back (44, 33, 22 and 11
    // places) leave at most ten of its 21 Championship slots, so nobody reads Locked in
    // that window and there is nothing to take back. The walk that does show
    // it is the real 2026 FIM one in the local data group below, and the
    // ceiling itself is held by a unit test
    // (`champLedgerStatus.test.ts`: a team's ceiling cannot rise when its
    // division's rows land).
    expect({ fieldOff, allowanceOff }).toEqual({ fieldOff: [12, 11, 9, 6], allowanceOff: [0, 0, 0, 0] });
  });
});

// ---------------------------------------------------------------------------
// The local district artifacts (gitignored)
// ---------------------------------------------------------------------------

const LOCAL_DISTRICT_ABSOLUTE = join(REPO_ROOT, LOCAL_DISTRICT_DIR);
/** The district DETAIL files alone: `v1__districts__2026.json` is the per year index and carries no teams. */
const DISTRICT_DETAIL_FILE = /^v1__district__\d{4}[a-z0-9]+\.json$/;
const LOCAL_DISTRICT_FILES = existsSync(LOCAL_DISTRICT_ABSOLUTE) ? readdirSync(LOCAL_DISTRICT_ABSOLUTE).filter((name) => DISTRICT_DETAIL_FILE.test(name)).sort() : [];
const NO_LOCAL_DISTRICTS = `no district artifact under ${LOCAL_DISTRICT_DIR} (gitignored local data)`;

const localArtifactCache = new Map<string, DistrictArtifact>();
function localArtifact(fileName: string): DistrictArtifact {
  let artifact = localArtifactCache.get(fileName);
  if (artifact === undefined) {
    artifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(join(LOCAL_DISTRICT_ABSOLUTE, fileName), "utf8")));
    localArtifactCache.set(fileName, artifact);
  }
  return artifact;
}

/** The real proof at Now, as the tab computes it, at the given calendar year. */
const proofAtNow = (artifact: DistrictArtifact, nowYear: number) => champFieldProofAtNow(artifact, startedDcmpKeys(artifact), nowYear);

// ---------------------------------------------------------------------------
// GROUP 2. The Now census
// ---------------------------------------------------------------------------

describe("the Now census: no finished season reads unproven after a start (quick task 261010-66y, D7 and D8)", () => {
  if (LOCAL_DISTRICT_FILES.length === 0) {
    localDataAbsent(NO_LOCAL_DISTRICTS);
    return;
  }

  it("every local district artifact reads proven or has no championship key, and none reads unproven after a start, in 2026", () => {
    const completeBy = { capacity: [] as string[], finals: [] as string[], seasonOver: [] as string[] };
    const noDcmpKey: string[] = [];
    const unprovenAfterStart: string[] = [];
    const notProven: string[] = [];
    let closestPass = Number.POSITIVE_INFINITY;
    for (const fileName of LOCAL_DISTRICT_FILES) {
      const artifact = localArtifact(fileName);
      const proof = proofAtNow(artifact, NOW_YEAR);
      if (proof.unprovenAfterStart) unprovenAfterStart.push(artifact.districtKey);
      if (proof.dcmpEventKeys.length === 0) noDcmpKey.push(artifact.districtKey);
      else if (!proof.proven) notProven.push(artifact.districtKey);
      if (proof.completeBy !== null) completeBy[proof.completeBy].push(artifact.districtKey);
      if (proof.completeBy === "capacity") closestPass = Math.min(closestPass, proof.postedTeams - (artifact.dcmpSlots! - proof.tolerance));
    }
    // DERIVED, never typed in: the seasons that need the season over line are
    // the ones with a championship key whose season is 2020.
    const seasons2020 = LOCAL_DISTRICT_FILES.map(localArtifact).filter((artifact) => artifact.year === 2020 && dcmpEventKeysFor(artifact).length > 0).map((artifact) => artifact.districtKey);
    console.log(
      `[261010-66y group 2] artifacts ${String(LOCAL_DISTRICT_FILES.length)} | proven by capacity ${String(completeBy.capacity.length)}, by a finals row ${String(completeBy.finals.length)}, by the season over line ${String(completeBy.seasonOver.length)} (${completeBy.seasonOver.join(", ")}) | no championship key: ${noDcmpKey.join(", ")} | unproven after a start ${String(unprovenAfterStart.length)} | closest capacity pass: ${String(closestPass)} teams above the count asked for`
    );
    expect(unprovenAfterStart).toEqual([]);
    expect(notProven).toEqual([]);
    expect(completeBy.seasonOver).toEqual(seasons2020);
    expect(completeBy.finals).toEqual([]);
    expect(noDcmpKey).toEqual(["2020isr"]);
    // The counts, as the run shows.
    expect({ artifacts: LOCAL_DISTRICT_FILES.length, capacity: completeBy.capacity.length, seasonOver: completeBy.seasonOver.length, noDcmpKey: noDcmpKey.length }).toEqual({ artifacts: 109, capacity: 98, seasonOver: 10, noDcmpKey: 1 });
  });
});

// ---------------------------------------------------------------------------
// GROUP 3. The subset test
// ---------------------------------------------------------------------------

/** Every non empty proper subset of `items`. */
function properSubsets<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < (1 << items.length) - 1; mask++) out.push(items.filter((_, index) => ((mask >> index) & 1) === 1));
  return out;
}

/** The artifact with every row and every award at the given keys removed, as it would be before TBA posted them. */
function withoutKeys(artifact: DistrictArtifact, drop: ReadonlySet<string>): DistrictArtifact {
  return {
    ...artifact,
    teams: artifact.teams.map((team) => ({
      ...team,
      eventPoints: team.eventPoints.filter((row) => !drop.has(row.eventKey)),
      remainingEvents: team.remainingEvents.filter((row) => !drop.has(row.eventKey)),
      qualifyingAwards: team.qualifyingAwards.filter((award) => !drop.has(award.eventKey)),
    })),
  };
}

describe("the subset test: part of the field on the rows never reads proven (quick task 261010-66y, D7)", () => {
  if (LOCAL_DISTRICT_FILES.length === 0) {
    localDataAbsent(NO_LOCAL_DISTRICTS);
    return;
  }

  it("for every artifact with two or more field fixing keys, every proper subset reads NOT proven and every key together reads proven, in the artifact's own year", () => {
    const several = LOCAL_DISTRICT_FILES.map(localArtifact).filter((artifact) => fieldFixingDcmpKeys(dcmpEventKeysFor(artifact)).length >= 2);
    let subsets = 0;
    let provenByTheSeasonOverLineAlone = 0;
    let closestMiss = Number.POSITIVE_INFINITY;
    const provenSubsets: string[] = [];
    const wholeNotProven: string[] = [];
    for (const artifact of several) {
      const dcmpKeys = dcmpEventKeysFor(artifact);
      const fieldFixing = fieldFixingDcmpKeys(dcmpKeys);
      const finalsKeys = dcmpKeys.filter((key) => !fieldFixing.includes(key));
      if (!proofAtNow(artifact, artifact.year).proven) wholeNotProven.push(artifact.districtKey);
      for (const subset of properSubsets(fieldFixing)) {
        subsets += 1;
        const staged = withoutKeys(artifact, new Set([...fieldFixing.filter((key) => !subset.includes(key)), ...finalsKeys]));
        const proof = proofAtNow(staged, artifact.year);
        if (proof.proven) provenSubsets.push(`${artifact.districtKey} keep ${subset.join(",")} by ${String(proof.completeBy)}`);
        if (artifact.dcmpSlots !== null) closestMiss = Math.min(closestMiss, artifact.dcmpSlots - proof.tolerance - proof.postedTeams);
        // The year one above the artifact's: the season over line alone.
        if (proofAtNow(staged, artifact.year + 1).completeBy === "seasonOver") provenByTheSeasonOverLineAlone += 1;
      }
    }
    console.log(
      `[261010-66y group 3] artifacts with two or more field fixing keys ${String(several.length)} | proper subsets ${String(subsets)} | read proven ${String(provenSubsets.length)} | closest miss: ${String(closestMiss)} teams below the count asked for | subsets the season over line alone would call proven, one year on: ${String(provenByTheSeasonOverLineAlone)}`
    );
    expect(provenSubsets).toEqual([]);
    expect(wholeNotProven).toEqual([]);
    // The counts, as the run shows. The last is why the season over line
    // counts only once the season is over: read in the artifact's own
    // season it would call every one of these subsets proven.
    expect({ artifacts: several.length, subsets, provenByTheSeasonOverLineAlone }).toEqual({ artifacts: 25, subsets: 146, provenByTheSeasonOverLineAlone: 146 });
    expect(closestMiss).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// GROUPS 4 and 5. The real 2026 championships
// ---------------------------------------------------------------------------

/** FIM in four divisions, NE, ONT and TX in two, and the two championships of California. */
const WALKED_DISTRICTS = ["2026fim", "2026ne", "2026ont", "2026fit", "2026ca"] as const;
type WalkedDistrict = (typeof WALKED_DISTRICTS)[number];
const MISSING_WALKED = WALKED_DISTRICTS.filter((districtKey) => !LOCAL_DISTRICT_FILES.includes(`v1__district__${districtKey}.json`));
const WALK_TIMEOUT_MS = 600_000;

const walkedSourceCache = new Map<string, DistrictArtifact>();
/** The published artifact at the verdict pass's fixed point, as the walks' source and end. */
function walkedSource(districtKey: WalkedDistrict): DistrictArtifact {
  let source = walkedSourceCache.get(districtKey);
  if (source === undefined) {
    source = recomputeDistrictVerdicts(localArtifact(`v1__district__${districtKey}.json`), { nowYear: NOW_YEAR });
    walkedSourceCache.set(districtKey, source);
  }
  return source;
}

/** DERIVED: the teams whose only championship row is at a finals key (an award given at the finals to a team that played in no division). */
function finalsOnlyTeams(source: DistrictArtifact): string[] {
  const fieldFixing = new Set(fieldFixingDcmpKeys(dcmpEventKeysFor(source)));
  return source.teams
    .filter((team) => {
      const dcmpRows = team.eventPoints.filter((row) => row.tier === "dcmp");
      return dcmpRows.length > 0 && dcmpRows.every((row) => !fieldFixing.has(row.eventKey));
    })
    .map((team) => team.teamKey)
    .sort();
}

type RuleMode = "on" | "fieldRuleOff" | "finalsAllowanceOff";
function inMode<T>(mode: RuleMode, body: () => T): T {
  return mode === "on" ? body() : mode === "fieldRuleOff" ? withFieldRuleOff(body) : withFinalsAllowanceOff(body);
}

const realWalkCache = new Map<string, Walk>();
/** The first walk of a real district: its points lagging its matches by ticks. */
function realWalk(districtKey: WalkedDistrict, mode: RuleMode): Walk {
  const cacheKey = `lag ${districtKey} ${mode}`;
  let walk = realWalkCache.get(cacheKey);
  if (walk === undefined) {
    walk = inMode(mode, () => walkChampionshipField(walkedSource(districtKey)));
    realWalkCache.set(cacheKey, walk);
  }
  return walk;
}
/** The second walk of a real district: its points arriving only as each event ends, from a start with `finalAtStart` keys wholly final. */
function realEventEndWalk(districtKey: WalkedDistrict, finalAtStart: number, mode: RuleMode): Walk {
  const cacheKey = `end ${districtKey} ${String(finalAtStart)} ${mode}`;
  let walk = realWalkCache.get(cacheKey);
  if (walk === undefined) {
    walk = inMode(mode, () => walkPointsAtEventEnd(walkedSource(districtKey), finalAtStart));
    realWalkCache.set(cacheKey, walk);
  }
  return walk;
}

const lockedTakenBack = (walk: Walk): string[] => takeBacks(walk.steps, (step) => step.champTab, champTabHeld);

describe("the staged live walk: the real 2026 FIM, NE, ONT, TX and CA championships, one event posted at a time (quick task 261010-66y, D7)", () => {
  if (MISSING_WALKED.length > 0) {
    localDataAbsent(`${MISSING_WALKED.join(", ")} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }

  it(
    "rules on: no Locked is taken back, no team that ends with a field fixing row ever reads out, and the proof never goes back",
    () => {
      const table: string[] = [];
      for (const districtKey of WALKED_DISTRICTS) {
        const walk = realWalk(districtKey, "on");
        expect({ districtKey, lost: lockedTakenBack(walk) }).toEqual({ districtKey, lost: [] });
        expect({ districtKey, out: fieldTeamsReadOut(walk) }).toEqual({ districtKey, out: [] });
        expect({ districtKey, proofLost: provenTakenBack(walk.steps) }).toEqual({ districtKey, proofLost: [] });
        // The one flag is false exactly from the first key's state until the last key's.
        const firstState = walk.steps.findIndex((step) => step.label === `${shortKey(walk.fieldFixingKeys[0]!)} state written`);
        const lastState = walk.steps.findIndex((step) => step.label === `${shortKey(walk.fieldFixingKeys.at(-1)!)} state written`);
        expect({ districtKey, fieldProven: walk.steps.map((step) => step.fieldProven) }).toEqual({ districtKey, fieldProven: walk.steps.map((_, index) => index < firstState || index >= lastState) });
        expect({ districtKey, rises: reservationRises(walk.steps.slice(firstState)) }).toEqual({ districtKey, rises: [] });
        // The District Locks tab: no team of the field reads Declined or Locked out after reading Locked.
        expect({ districtKey, districtLost: districtLockedThenLost(walk) }).toEqual({ districtKey, districtLost: [] });
        expect({ districtKey, declinedWhileUnproven: declinedWhileUnproven(walk.steps) }).toEqual({ districtKey, declinedWhileUnproven: [] });
        table.push(`  ${districtKey}: ${String(walk.fieldTeams.size)} teams in the field at ${String(walk.fieldFixingKeys.length)} field fixing keys`, ...tickTable(walk));
      }
      console.log(["[261010-66y group 4] rules on, the real walks:", ...table].join("\n"));
    },
    WALK_TIMEOUT_MS
  );

  it(
    "rules on: the only teams that read out and later in are the teams whose only championship row is at a finals key, and each ends Locked by an award",
    () => {
      const counts: Record<string, number> = {};
      for (const districtKey of WALKED_DISTRICTS) {
        const source = walkedSource(districtKey);
        const walk = realWalk(districtKey, "on");
        const finalsOnly = finalsOnlyTeams(source);
        expect({ districtKey, outThenIn: outThenIn(walk) }).toEqual({ districtKey, outThenIn: finalsOnly });
        const end = walk.steps.at(-1)!;
        for (const teamKey of finalsOnly) {
          expect({ districtKey, teamKey, status: end.champTab.get(teamKey), byAward: end.champByAward.has(teamKey) }).toEqual({ districtKey, teamKey, status: "locked", byAward: true });
        }
        counts[districtKey] = finalsOnly.length;
      }
      console.log(`[261010-66y group 4] teams whose only championship row is at a finals key: ${JSON.stringify(counts)}`);
      // The counts, as the run shows.
      expect(counts).toEqual({ "2026fim": 1, "2026ne": 2, "2026ont": 0, "2026fit": 0, "2026ca": 0 });
    },
    WALK_TIMEOUT_MS
  );

  it(
    "rules on, the District Locks tab: the teams that end Declined read Declined at exactly the ticks the field is proven, and at no other",
    () => {
      const counts: Record<string, number> = {};
      for (const districtKey of WALKED_DISTRICTS) {
        const walk = realWalk(districtKey, "on");
        const end = walk.steps.at(-1)!;
        expect({ districtKey, overlayAtTheEnd: end.overlayActive }).toEqual({ districtKey, overlayAtTheEnd: true });
        // DERIVED from the end state: the teams that earned a place and are not in the field.
        const endDeclined = [...end.districtTab].filter(([, status]) => status === "declined").map(([teamKey]) => teamKey).sort();
        for (const step of walk.steps) {
          const declined = [...step.districtTab].filter(([, status]) => status === "declined").map(([teamKey]) => teamKey).sort();
          expect({ districtKey, label: step.label, overlay: step.overlayActive, declined }).toEqual({ districtKey, label: step.label, overlay: step.proven, declined: step.proven ? endDeclined : [] });
        }
        counts[districtKey] = endDeclined.length;
      }
      console.log(`[261010-66y group 4] the District Locks tab, teams that end Declined: ${JSON.stringify(counts)}`);
      // The counts, as the run shows.
      expect(counts).toEqual({ "2026fim": 0, "2026ne": 8, "2026ont": 9, "2026fit": 5, "2026ca": 4 });
    },
    WALK_TIMEOUT_MS
  );

  it(
    "field rule off, the District Locks tab: teams of the field shown Locked and then Declined or Locked out, pinned as the run shows",
    () => {
      const measured: Record<string, { lockedThenLost: number; lockedDeclinedLocked: number }> = {};
      for (const districtKey of WALKED_DISTRICTS) {
        const walk = realWalk(districtKey, "fieldRuleOff");
        measured[districtKey] = { lockedThenLost: districtLockedThenLost(walk).length, lockedDeclinedLocked: districtLockedDeclinedLocked(walk) };
      }
      console.log(`[261010-66y group 4] field rule off, the District Locks tab: ${JSON.stringify(measured)}`);
      // PINNED AS THE RUN SHOWS. With the rule off the overlay applied as
      // soon as every key the artifact knew had started, and every team of
      // an event TBA had not posted yet, having earned its place, read
      // Declined (or Locked out, for a team that got in from below the
      // line after reading Locked on a tie) until its rows landed.
      expect(measured).toEqual({
        "2026fim": { lockedThenLost: 119, lockedDeclinedLocked: 119 },
        "2026ne": { lockedThenLost: 50, lockedDeclinedLocked: 46 },
        "2026ont": { lockedThenLost: 49, lockedDeclinedLocked: 44 },
        "2026fit": { lockedThenLost: 41, lockedDeclinedLocked: 40 },
        "2026ca": { lockedThenLost: 55, lockedDeclinedLocked: 55 },
      });
    },
    WALK_TIMEOUT_MS
  );

  it(
    "field rule off: the same walks, pinned as the run shows",
    () => {
      const measured: Record<string, { lockedTakenBack: number; fieldTeamsReadOut: number }> = {};
      for (const districtKey of WALKED_DISTRICTS) {
        const walk = realWalk(districtKey, "fieldRuleOff");
        measured[districtKey] = { lockedTakenBack: lockedTakenBack(walk).length, fieldTeamsReadOut: fieldTeamsReadOut(walk).length };
      }
      console.log(`[261010-66y group 4] field rule off, the real walks: ${JSON.stringify(measured)}`);
      // PINNED AS THE RUN SHOWS, and said plainly: with the field rule off
      // this walk takes a Locked back at 2026 FIM only. At NE, ONT, TX and CA
      // the same code reads 50, 49, 45 and 60 teams of the field out of it
      // and takes no Locked back, because in this walk nobody reads Locked
      // while the points lag only by ticks. The walk that does take Locked
      // back at all five is the next group's.
      expect(measured).toEqual({
        "2026fim": { lockedTakenBack: 41, fieldTeamsReadOut: 121 },
        "2026ne": { lockedTakenBack: 0, fieldTeamsReadOut: 50 },
        "2026ont": { lockedTakenBack: 0, fieldTeamsReadOut: 49 },
        "2026fit": { lockedTakenBack: 0, fieldTeamsReadOut: 45 },
        "2026ca": { lockedTakenBack: 0, fieldTeamsReadOut: 60 },
      });
    },
    WALK_TIMEOUT_MS
  );
});

describe("the points arriving only as each event ends: the real 2026 FIM, NE, ONT, TX and CA championships (quick task 261010-66y, D7)", () => {
  if (MISSING_WALKED.length > 0) {
    localDataAbsent(`${MISSING_WALKED.join(", ")} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }

  /** Every start of the second walk: none of the field fixing keys final, then the first one, two and so on, never all. */
  const startsOf = (districtKey: WalkedDistrict): number[] => fieldFixingDcmpKeys(dcmpEventKeysFor(walkedSource(districtKey))).map((_, index) => index);
  /** The teams shown Locked at a walk's first entry that do not hold a place at its last. */
  const lockedThenNotHeldAtTheEnd = (walk: Walk): string[] => {
    const end = walk.steps.at(-1)!.champTab;
    return [...walk.steps[0]!.champTab].filter(([teamKey, status]) => status === "locked" && !champTabHeld(end.get(teamKey) ?? "absent")).map(([teamKey]) => teamKey);
  };
  type Measured = Record<string, { lockedAtStart: number[]; notHeldAtTheEnd: number[]; lockedTakenBack: number[] }>;
  const measure = (mode: RuleMode): Measured => {
    const measured: Measured = {};
    for (const districtKey of WALKED_DISTRICTS) {
      const walks = startsOf(districtKey).map((finalAtStart) => realEventEndWalk(districtKey, finalAtStart, mode));
      measured[districtKey] = {
        lockedAtStart: walks.map((walk) => [...walk.steps[0]!.champTab.values()].filter((status) => status === "locked").length),
        notHeldAtTheEnd: walks.map((walk) => lockedThenNotHeldAtTheEnd(walk).length),
        lockedTakenBack: walks.map((walk) => lockedTakenBack(walk).length),
      };
    }
    return measured;
  };

  it(
    "rules on: from every start no team shown Locked is unheld at the end, no Locked is taken back on the way, no team of the field reads out, and the proof never goes back",
    () => {
      const table: string[] = [];
      for (const districtKey of WALKED_DISTRICTS) {
        for (const finalAtStart of startsOf(districtKey)) {
          const walk = realEventEndWalk(districtKey, finalAtStart, "on");
          expect({ districtKey, finalAtStart, notHeld: lockedThenNotHeldAtTheEnd(walk) }).toEqual({ districtKey, finalAtStart, notHeld: [] });
          expect({ districtKey, finalAtStart, lost: lockedTakenBack(walk) }).toEqual({ districtKey, finalAtStart, lost: [] });
          expect({ districtKey, finalAtStart, out: fieldTeamsReadOut(walk) }).toEqual({ districtKey, finalAtStart, out: [] });
          expect({ districtKey, finalAtStart, proofLost: provenTakenBack(walk.steps) }).toEqual({ districtKey, finalAtStart, proofLost: [] });
          expect({ districtKey, finalAtStart, districtLost: districtLockedThenLost(walk) }).toEqual({ districtKey, finalAtStart, districtLost: [] });
          expect({ districtKey, finalAtStart, declinedWhileUnproven: declinedWhileUnproven(walk.steps) }).toEqual({ districtKey, finalAtStart, declinedWhileUnproven: [] });
          // From the first tick at which the field reads unproven, the places held back never rise.
          const firstUnproven = walk.steps.findIndex((step) => !step.fieldProven);
          expect({ districtKey, finalAtStart, rises: reservationRises(firstUnproven < 0 ? [] : walk.steps.slice(firstUnproven)) }).toEqual({ districtKey, finalAtStart, rises: [] });
          table.push(`  ${districtKey}, start: ${String(finalAtStart)} of ${String(walk.fieldFixingKeys.length)} field fixing keys final`, ...tickTable(walk));
        }
      }
      console.log(["[261010-66y group 5] rules on, the points arriving only as each event ends:", ...table].join("\n"));
      console.log(`[261010-66y group 5] rules on, per start (0, 1, 2, ... keys final): ${JSON.stringify(measure("on"))}`);
    },
    WALK_TIMEOUT_MS
  );

  it(
    "field rule off: teams shown Locked that the end does not hold, and Locked taken back on the way, pinned as the run shows",
    () => {
      const measured = measure("fieldRuleOff");
      console.log(`[261010-66y group 5] field rule off, per start (0, 1, 2, ... keys final): ${JSON.stringify(measured)}`);
      // PINNED AS THE RUN SHOWS, one number per start (no key final, then
      // one, two and three). With the field rule off every district shows
      // teams Locked that the end does not hold, and takes Locked back on
      // the way from every start.
      expect(measured).toEqual({
        "2026fim": { lockedAtStart: [0, 70, 50, 22], notHeldAtTheEnd: [0, 17, 6, 0], lockedTakenBack: [68, 81, 48, 11] },
        "2026ne": { lockedAtStart: [0, 20], notHeldAtTheEnd: [0, 5], lockedTakenBack: [14, 20] },
        "2026ont": { lockedAtStart: [0, 11], notHeldAtTheEnd: [0, 2], lockedTakenBack: [6, 11] },
        "2026fit": { lockedAtStart: [0, 17], notHeldAtTheEnd: [0, 5], lockedTakenBack: [10, 17] },
        "2026ca": { lockedAtStart: [0, 46], notHeldAtTheEnd: [0, 14], lockedTakenBack: [17, 39] },
      });
    },
    WALK_TIMEOUT_MS
  );

  it(
    "the finals part of a rowless team's hypothetical championship off: Locked taken back on the way, pinned as the run shows",
    () => {
      const measured = measure("finalsAllowanceOff");
      console.log(`[261010-66y group 5] the finals part of the hypothetical championship off, per start (0, 1, 2, ... keys final): ${JSON.stringify(measured)}`);
      // PINNED AS THE RUN SHOWS. Without the finals part a team's ceiling
      // rose by the whole Playoffs ceiling when its division's rows landed,
      // and 2026 FIM took Locked back from three of its four starts. No
      // team shown Locked was unheld at the end: the Locked came back. The
      // two division districts and California take none back, said
      // plainly: in the two division districts nobody reads Locked while
      // the field is unproven, and California's championships have no
      // finals.
      expect(measured).toEqual({
        "2026fim": { lockedAtStart: [0, 2, 4, 6], notHeldAtTheEnd: [0, 0, 0, 0], lockedTakenBack: [3, 3, 2, 0] },
        "2026ne": { lockedAtStart: [0, 0], notHeldAtTheEnd: [0, 0], lockedTakenBack: [0, 0] },
        "2026ont": { lockedAtStart: [0, 0], notHeldAtTheEnd: [0, 0], lockedTakenBack: [0, 0] },
        "2026fit": { lockedAtStart: [0, 0], notHeldAtTheEnd: [0, 0], lockedTakenBack: [0, 0] },
        "2026ca": { lockedAtStart: [0, 7], notHeldAtTheEnd: [0, 0], lockedTakenBack: [0, 0] },
      });
    },
    WALK_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// GROUP 6. The published verdicts, through the finals
// ---------------------------------------------------------------------------

/** The four division synthetic of group 1 with a finals event: the same sizes, 16 teams in four divisions of four, 30 in the district, 21 Championship slots. */
const S4_FINALS = syntheticDivisioned({ ...FOUR_DIVISIONS, withFinals: true });

/**
 * A single championship over the fixture's first thirty teams, every one of
 * them in its field: 30 championship places, 21 Championship slots. Index 0
 * to 2 win it, 3 to 5 are the finalists, and Impact, Engineering Inspiration
 * and Rookie All Star go to index 6, 20 and 25. Only the numbers are
 * synthetic.
 */
function syntheticSingle(): DistrictArtifact {
  const districtRow = baseline.teams.flatMap((team) => team.eventPoints).find((row) => row.tier === "district")!;
  const dcmpRow = baseline.teams.flatMap((team) => team.eventPoints).find((row) => row.tier === "dcmp")!;
  const awardTypeOf = (index: number): number | undefined => (index === 6 ? 0 : index === 20 ? 9 : index === 25 ? 10 : undefined);
  const teams = baseline.teams.slice(0, 30).map((team, index) => {
    const district = 150 - 4 * index;
    const qual = 60 - index;
    const alliance = index < 24 ? 48 - 2 * index : 0;
    const elim = index < 3 ? 90 : index < 6 ? 60 : 0;
    const awardType = awardTypeOf(index);
    const award = awardType === undefined ? 0 : SYNTHETIC_FINALS_AWARD;
    const total = qual + alliance + elim + award;
    return {
      ...team,
      rank: index + 1,
      pointTotal: district + total,
      rookieBonus: 0,
      adjustments: 0,
      eventPoints: [
        { ...districtRow, qual: district, alliance: 0, elim: 0, award: 0, total: district, state: { ...FINISHED_STATE } },
        { ...dcmpRow, eventKey: SYNTHETIC_STEM, qual, alliance, elim, award, total, state: { ...FINISHED_STATE } },
      ],
      remainingEvents: [],
      qualifyingAwards: [
        ...(elim === 90 ? [{ eventKey: SYNTHETIC_STEM, awardType: 1, label: "Winner", awardOnly: false }] : []),
        ...(awardType === undefined ? [] : [{ eventKey: SYNTHETIC_STEM, awardType, label: "a judged consuming award", awardOnly: false }]),
      ],
    };
  });
  return recomputeDistrictVerdicts(DistrictArtifactSchema.parse({ ...baseline, dcmpSlots: 30, cmpSlots: 21, teams }), { nowYear: NOW_YEAR });
}
const S1_SINGLE = syntheticSingle();

const publishedTakenBack = (walk: Walk): string[] => takeBacks(walk.steps, (step) => step.published, publishedHeld);
/** One line per tick of a walk's published series. */
function publishedTable(walk: Walk): string[] {
  return walk.steps.map((step) => {
    const ceilings = [...step.publishedCeiling.values()];
    return `  ${step.label.padEnd(44)} published held=${String([...step.published.values()].filter(publishedHeld).length).padStart(3)} teams with a champ ceiling=${String(ceilings.filter((value) => value > 0).length).padStart(3)} largest=${String(Math.max(0, ...ceilings)).padStart(3)} | tab held=${String([...step.champTab.values()].filter(champTabHeld).length)}`;
  });
}

describe("the published verdicts walked through the finals: two synthetic championships (quick task 261010-66y, D5)", () => {
  const SYNTHETICS = [
    { name: "single", source: S1_SINGLE },
    { name: "four divisions and a finals", source: S4_FINALS },
  ] as const;
  const STARTS = [false, true] as const;

  it("premise: one championship of thirty teams at one key, and one in four divisions with a finals row for eight of its teams and one team given an award at the finals alone", () => {
    expect(dcmpEventKeysFor(S1_SINGLE)).toEqual([SYNTHETIC_STEM]);
    expect(S1_SINGLE.teams.filter((team) => team.eventPoints.some((row) => row.tier === "dcmp"))).toHaveLength(30);
    expect({ dcmpSlots: S1_SINGLE.dcmpSlots, cmpSlots: S1_SINGLE.cmpSlots }).toEqual({ dcmpSlots: 30, cmpSlots: 21 });
    expect(dcmpEventKeysFor(S4_FINALS)).toEqual([SYNTHETIC_STEM, ...S4_KEYS]);
    expect(championshipShape(dcmpEventKeysFor(S4_FINALS)).kind).toBe("divisioned");
    const finalsRows = S4_FINALS.teams.flatMap((team) => team.eventPoints.filter((row) => row.eventKey === SYNTHETIC_STEM).map((row) => ({ teamKey: team.teamKey, row })));
    // Three champions and three finalists, the champion among them holding Impact, and one team at the finals alone.
    expect(finalsRows).toHaveLength(7);
    expect(finalsRows.filter(({ row }) => row.elim === 60)).toHaveLength(3);
    expect(finalsRows.filter(({ row }) => row.elim === 30)).toHaveLength(3);
    expect(finalsOnlyTeams(S4_FINALS)).toHaveLength(1);
    expect({ dcmpSlots: S4_FINALS.dcmpSlots, cmpSlots: S4_FINALS.cmpSlots, teams: S4_FINALS.teams.length }).toEqual({ dcmpSlots: 16, cmpSlots: 21, teams: 30 });
  });

  it("rules on, both starts: no published champLock is taken back, and no team's maxRemainingChamp drops and then rises", () => {
    const table: string[] = [];
    for (const { name, source } of SYNTHETICS) {
      for (const registeredFirst of STARTS) {
        const walk = walkChampionshipField(source, { registeredFirst, finalsTicks: true });
        const start = registeredFirst ? "every attending team registered first" : "no dcmp row first";
        expect({ name, start, lost: publishedTakenBack(walk) }).toEqual({ name, start, lost: [] });
        expect({ name, start, ceilings: publishedCeilingDropsThenRises(walk.steps) }).toEqual({ name, start, ceilings: [] });
        table.push(`  ${name}, ${start}`, ...publishedTable(walk));
      }
    }
    console.log(["[261010-66y group 6] rules on, the published series, synthetic:", ...table].join("\n"));
    // The walk is not vacuous: places are held in the published verdicts before the end.
    const single = walkChampionshipField(S1_SINGLE, { finalsTicks: true });
    expect([...single.steps.at(-2)!.published.values()].filter(publishedHeld).length).toBeGreaterThan(0);
  });

  it("the first rows rule off: a championship's first rows read as hindsight, pinned as the run shows", () => {
    const measured: Record<string, { publishedTakenBack: number; ceilingsDropThenRise: number }> = {};
    for (const { name, source } of SYNTHETICS) {
      for (const registeredFirst of STARTS) {
        const walk = withStatelessRowsOff(() => walkChampionshipField(source, { registeredFirst, finalsTicks: true }));
        measured[`${name}, ${registeredFirst ? "registered first" : "no dcmp row first"}`] = { publishedTakenBack: publishedTakenBack(walk).length, ceilingsDropThenRise: publishedCeilingDropsThenRises(walk.steps).length };
      }
    }
    console.log(`[261010-66y group 6] the first rows rule off, synthetic: ${JSON.stringify(measured)}`);
    // PINNED AS THE RUN SHOWS. With no dcmp row first, the single
    // championship's thirty teams all lose their championship ceiling on the
    // tick their rows arrive and get it back on the next, and ten of them
    // read locked in between. The four division one drops and restores the
    // ceilings of its sixteen and takes no lock back, said plainly: nobody
    // is locked that early there. With every attending team registered first
    // the state is written on the registration before the rows post, so no
    // row is ever stateless and the rule has nothing to do.
    expect(measured).toEqual({
      "single, no dcmp row first": { publishedTakenBack: 10, ceilingsDropThenRise: 30 },
      "single, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
      "four divisions and a finals, no dcmp row first": { publishedTakenBack: 0, ceilingsDropThenRise: 16 },
      "four divisions and a finals, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
    });
  });
});

/** The five of group 4 and the single championship of 2026 PNW. */
const PUBLISHED_WALKED = [...WALKED_DISTRICTS, "2026pnw"] as const;
const MISSING_PUBLISHED_WALKED = PUBLISHED_WALKED.filter((districtKey) => !LOCAL_DISTRICT_FILES.includes(`v1__district__${districtKey}.json`));

describe("the published verdicts walked through the finals: the real 2026 FIM, NE, ONT, TX, CA and PNW championships, both starts (quick task 261010-66y, D5)", () => {
  if (MISSING_PUBLISHED_WALKED.length > 0) {
    localDataAbsent(`${MISSING_PUBLISHED_WALKED.join(", ")} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }
  const sourceOf = (districtKey: string): DistrictArtifact => recomputeDistrictVerdicts(localArtifact(`v1__district__${districtKey}.json`), { nowYear: NOW_YEAR });
  const STARTS = [false, true] as const;
  const startName = (registeredFirst: boolean): string => (registeredFirst ? "registered first" : "no dcmp row first");

  it(
    "rules on: on all twelve walks no published champLock is taken back and no team's maxRemainingChamp drops and then rises",
    () => {
      const table: string[] = [];
      const belowTheLine: Record<string, number> = {};
      const tabRecorded: Record<string, Record<string, number>> = {};
      let walks = 0;
      for (const districtKey of PUBLISHED_WALKED) {
        for (const registeredFirst of STARTS) {
          const walk = walkChampionshipField(sourceOf(districtKey), { registeredFirst, finalsTicks: true });
          walks += 1;
          expect({ districtKey, start: startName(registeredFirst), lost: publishedTakenBack(walk) }).toEqual({ districtKey, start: startName(registeredFirst), lost: [] });
          expect({ districtKey, start: startName(registeredFirst), ceilings: publishedCeilingDropsThenRises(walk.steps) }).toEqual({ districtKey, start: startName(registeredFirst), ceilings: [] });
          // The proof never goes back on these walks either.
          expect({ districtKey, start: startName(registeredFirst), proofLost: provenTakenBack(walk.steps) }).toEqual({ districtKey, start: startName(registeredFirst), proofLost: [] });
          expect({ districtKey, start: startName(registeredFirst), rises: unexplainedCeilingRises(walk.steps) }).toEqual({ districtKey, start: startName(registeredFirst), rises: [] });
          belowTheLine[`${districtKey}, ${startName(registeredFirst)}`] = belowTheLineAttendees(walk.steps);
          // Per tick at which a Locked was lost: how many.
          const lostAt: Record<string, number> = {};
          for (const line of lockedTakenBack(walk)) {
            const label = /at "([^"]*)"$/.exec(line)![1]!;
            lostAt[label] = (lostAt[label] ?? 0) + 1;
          }
          tabRecorded[`${districtKey}, ${startName(registeredFirst)}`] = lostAt;
          table.push(`  ${districtKey}, ${startName(registeredFirst)}`, ...publishedTable(walk));
        }
      }
      expect(walks).toBe(12);
      console.log(["[261010-66y group 6] rules on, the published series, the real walks:", ...table].join("\n"));
      console.log(`[261010-66y group 6] the stated limit, teams below the district line whose ceiling rose when their row landed while the field was unproven: ${JSON.stringify(belowTheLine)}`);
      // THE CHAMP LOCKS TAB'S OWN SERIES THROUGH THE FINALS TICKS, with no
      // bracket facts handed: no Locked is taken back on any of the twelve
      // walks. Before the last step of this quick task the ceiling test read
      // the finals differently for a team with a finals row and a team
      // without one, and this read {"finals award points land": 3} at 2026
      // FIM and {"finals rows posted, no state": 1, "finals award points
      // land": 3} at ONT, from both starts.
      console.log(`[261010-66y group 6] Champ Locks tab Locked taken back through the finals ticks, no bracket facts: ${JSON.stringify(tabRecorded)}`);
      for (const [walkName, lostAt] of Object.entries(tabRecorded)) expect({ walkName, lostAt }).toEqual({ walkName, lostAt: {} });
      // THE STATED LIMIT, MEASURED and pinned as the run shows: a team below
      // the district cut line carries no hypothetical championship in the
      // published verdicts, registered at the championship or not, and a
      // few attend all the same. The registered first start counts every
      // one of them (8, 9, 4, 4 and 1), because the field reads unproven
      // from the first event's state on; with no dcmp row first the teams of
      // the first event to post land before anything has started. No lock is
      // taken back by them on any of the twelve walks, asserted above.
      expect(belowTheLine).toEqual({
        "2026fim, no dcmp row first": 0,
        "2026fim, registered first": 0,
        "2026ne, no dcmp row first": 4,
        "2026ne, registered first": 8,
        "2026ont, no dcmp row first": 4,
        "2026ont, registered first": 9,
        "2026fit, no dcmp row first": 3,
        "2026fit, registered first": 4,
        "2026ca, no dcmp row first": 3,
        "2026ca, registered first": 4,
        "2026pnw, no dcmp row first": 0,
        "2026pnw, registered first": 1,
      });
    },
    WALK_TIMEOUT_MS
  );

  it(
    "the first rows rule off: published locks taken back and ceilings that drop and then rise, pinned as the run shows",
    () => {
      const measured: Record<string, { publishedTakenBack: number; ceilingsDropThenRise: number }> = {};
      for (const districtKey of PUBLISHED_WALKED) {
        for (const registeredFirst of STARTS) {
          const walk = withStatelessRowsOff(() => walkChampionshipField(sourceOf(districtKey), { registeredFirst, finalsTicks: true }));
          measured[`${districtKey}, ${startName(registeredFirst)}`] = { publishedTakenBack: publishedTakenBack(walk).length, ceilingsDropThenRise: publishedCeilingDropsThenRises(walk.steps).length };
        }
      }
      console.log(`[261010-66y group 6] the first rows rule off, the real walks: ${JSON.stringify(measured)}`);
      // PINNED AS THE RUN SHOWS. With no dcmp row first every team of the
      // field loses its championship ceiling for the tick its rows arrive
      // (161, 92, 90, 86, 117 and 50 teams), and at 2026 PNW ten published
      // locks are taken back. With every attending team registered first no
      // row is ever stateless.
      expect(measured).toEqual({
        "2026fim, no dcmp row first": { publishedTakenBack: 0, ceilingsDropThenRise: 161 },
        "2026fim, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
        "2026ne, no dcmp row first": { publishedTakenBack: 0, ceilingsDropThenRise: 92 },
        "2026ne, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
        "2026ont, no dcmp row first": { publishedTakenBack: 0, ceilingsDropThenRise: 90 },
        "2026ont, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
        "2026fit, no dcmp row first": { publishedTakenBack: 0, ceilingsDropThenRise: 86 },
        "2026fit, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
        "2026ca, no dcmp row first": { publishedTakenBack: 0, ceilingsDropThenRise: 117 },
        "2026ca, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
        "2026pnw, no dcmp row first": { publishedTakenBack: 10, ceilingsDropThenRise: 50 },
        "2026pnw, registered first": { publishedTakenBack: 0, ceilingsDropThenRise: 0 },
      });
    },
    WALK_TIMEOUT_MS
  );

  it(
    "the points arriving only as each event ends, rules on: from every start no published champLock is taken back and no ceiling rises when a division's rows land",
    () => {
      const table: string[] = [];
      for (const districtKey of WALKED_DISTRICTS) {
        const fieldFixing = fieldFixingDcmpKeys(dcmpEventKeysFor(walkedSource(districtKey)));
        for (let finalAtStart = 0; finalAtStart < fieldFixing.length; finalAtStart++) {
          const walk = realEventEndWalk(districtKey, finalAtStart, "on");
          expect({ districtKey, finalAtStart, lost: publishedTakenBack(walk) }).toEqual({ districtKey, finalAtStart, lost: [] });
          expect({ districtKey, finalAtStart, ceilings: publishedCeilingDropsThenRises(walk.steps) }).toEqual({ districtKey, finalAtStart, ceilings: [] });
          expect({ districtKey, finalAtStart, rises: unexplainedCeilingRises(walk.steps) }).toEqual({ districtKey, finalAtStart, rises: [] });
          table.push(`  ${districtKey}, start: ${String(finalAtStart)} of ${String(fieldFixing.length)} field fixing keys final`, ...publishedTable(walk));
        }
      }
      console.log(["[261010-66y group 6] rules on, the published series, the points arriving only as each event ends:", ...table].join("\n"));
    },
    WALK_TIMEOUT_MS
  );

  it(
    "the points arriving only as each event ends, the finals part of the hypothetical championship off: published ceilings that rise when a division's rows land, pinned as the run shows",
    () => {
      const measured: Record<string, { publishedTakenBack: number[]; ceilingRisesWhileUnproven: number[] }> = {};
      for (const districtKey of WALKED_DISTRICTS) {
        const fieldFixing = fieldFixingDcmpKeys(dcmpEventKeysFor(walkedSource(districtKey)));
        const walks = fieldFixing.map((_, finalAtStart) => realEventEndWalk(districtKey, finalAtStart, "finalsAllowanceOff"));
        measured[districtKey] = { publishedTakenBack: walks.map((walk) => publishedTakenBack(walk).length), ceilingRisesWhileUnproven: walks.map((walk) => unexplainedCeilingRises(walk.steps).length) };
      }
      console.log(`[261010-66y group 6] the finals part of the hypothetical championship off, the published series, per start (0, 1, 2, ... keys final): ${JSON.stringify(measured)}`);
      // PINNED AS THE RUN SHOWS. Without the finals part every team of a
      // division still to post carried one whole championship, and gained
      // the whole Playoffs ceiling on top when its rows landed: 121, 121,
      // 81 and 40 published ceilings rose at 2026 FIM, and the published
      // champLock was taken back 3, 3 and 2 times. California's
      // championships have no finals, so nothing rose there.
      expect(measured).toEqual({
        "2026fim": { publishedTakenBack: [3, 3, 2, 0], ceilingRisesWhileUnproven: [121, 121, 81, 40] },
        "2026ne": { publishedTakenBack: [0, 0], ceilingRisesWhileUnproven: [46, 46] },
        "2026ont": { publishedTakenBack: [0, 0], ceilingRisesWhileUnproven: [45, 45] },
        "2026fit": { publishedTakenBack: [0, 0], ceilingRisesWhileUnproven: [42, 42] },
        "2026ca": { publishedTakenBack: [0, 0], ceilingRisesWhileUnproven: [0, 0] },
      });
    },
    WALK_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// GROUP 7. The convention the finals reading rests on
// ---------------------------------------------------------------------------

/** Impact, Engineering Inspiration and Rookie All Star: the judged awards that take a Championship slot at a District Championship. */
const CONSUMING_JUDGED_AWARD_TYPES: ReadonlySet<number> = new Set([0, 9, 10]);

describe("the convention the finals reading rests on, over every local district artifact (quick task 261010-66y)", () => {
  if (LOCAL_DISTRICT_FILES.length === 0) {
    localDataAbsent(NO_LOCAL_DISTRICTS);
    return;
  }

  it("every row at a finals key that carries award points belongs to a team with a consuming award recorded there, and a team whose only championship row is the finals row earned nothing else there", () => {
    let finalsRows = 0;
    let withAwardPoints = 0;
    let finalsOnlyRows = 0;
    const withoutConsumingAward: string[] = [];
    const finalsOnlyWithOtherPoints: string[] = [];
    const finalsOnlyTeamKeys = new Set<string>();
    for (const fileName of LOCAL_DISTRICT_FILES) {
      const artifact = localArtifact(fileName);
      const dcmpKeys = dcmpEventKeysFor(artifact);
      const fieldFixing = new Set(fieldFixingDcmpKeys(dcmpKeys));
      // A finals key is a dcmp key another dcmp key of the artifact extends by one digit.
      const finalsKeys = new Set(dcmpKeys.filter((key) => !fieldFixing.has(key)));
      for (const team of artifact.teams) {
        const hasDivisionRow = team.eventPoints.some((row) => fieldFixing.has(row.eventKey));
        for (const row of team.eventPoints) {
          if (!finalsKeys.has(row.eventKey)) continue;
          finalsRows += 1;
          if (row.award > 0) {
            withAwardPoints += 1;
            const consuming = team.qualifyingAwards.some((award) => award.eventKey === row.eventKey && CONSUMING_JUDGED_AWARD_TYPES.has(award.awardType));
            if (!consuming) withoutConsumingAward.push(`${artifact.districtKey} ${team.teamKey} ${row.eventKey} award ${String(row.award)}`);
          }
          if (!hasDivisionRow) {
            finalsOnlyRows += 1;
            finalsOnlyTeamKeys.add(`${artifact.districtKey} ${team.teamKey}`);
            if (row.qual + row.alliance + row.elim !== 0) finalsOnlyWithOtherPoints.push(`${artifact.districtKey} ${team.teamKey} ${row.eventKey} ${String(row.qual)}, ${String(row.alliance)}, ${String(row.elim)}`);
          }
        }
      }
    }
    console.log(
      `[261010-66y group 7] rows at a finals key ${String(finalsRows)} | with award points ${String(withAwardPoints)} | of them with no consuming award recorded there ${String(withoutConsumingAward.length)} | finals rows of a team with no division row ${String(finalsOnlyRows)} (${String(finalsOnlyTeamKeys.size)} teams) | of them with qualification, alliance selection or playoff points ${String(finalsOnlyWithOtherPoints.length)}`
    );
    // WHAT BREAKS IF THIS FAILS: the finals' Awards add no points ceiling for
    // anyone in the published verdicts (`openAtPlayedRows`) and, from this
    // quick task's last step, on the Champ Locks tab; a row at a finals key of
    // a team with no division row adds no ceiling at all; and the joint worst
    // case proof gives the finals no judged award budget. All of it rests on a
    // points paying award at a finals event being a consuming award, which
    // takes a Championship slot whatever its winner's points and which the
    // reservation holds a place for. A season that shows an ordinary judged
    // award with points at a finals event, or a team paid Playoffs points at
    // the finals without a division row, needs those readings looked at again.
    expect(withoutConsumingAward).toEqual([]);
    expect(finalsOnlyWithOtherPoints).toEqual([]);
    // The counts, as the run shows.
    expect({ finalsRows, withAwardPoints, finalsOnlyRows, finalsOnlyTeams: finalsOnlyTeamKeys.size }).toEqual({ finalsRows: 265, withAwardPoints: 153, finalsOnlyRows: 20, finalsOnlyTeams: 20 });
  });
});

// ---------------------------------------------------------------------------
// GROUP 8. A backup robot seen on the field joins its alliance (CONTEXT D4)
// ---------------------------------------------------------------------------

const CORPUS_ABSOLUTE = join(REPO_ROOT, CORPUS_PATH);
const PNCMP = "2026pncmp";
const PNW_FILE = "v1__district__2026pnw.json";
/** Alliance 2's listed fourth at the real 2026pncmp: a backup TBA listed after the fact. */
const STRIPPED_BACKUP = { teamKey: "frc7034", allianceNumber: 2 } as const;

describe("a backup seen on the field joins its alliance: the real 2026pncmp bracket with frc7034 stripped from alliance 2's picks (quick task 261010-66y, D4)", () => {
  if (!existsSync(CORPUS_ABSOLUTE)) {
    localDataAbsent(`${CORPUS_PATH} absent (gitignored local data)`);
    return;
  }
  if (!LOCAL_DISTRICT_FILES.includes(PNW_FILE)) {
    localDataAbsent(`${PNW_FILE} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }

  const listed: BracketSourceEvent = (() => {
    const db = openCorpusReadOnly(CORPUS_ABSOLUTE);
    try {
      const found = bracketFromCorpus(db, new Map(), NOW_YEAR, PNCMP);
      if (found === undefined) throw new Error(`the corpus carries no alliances for ${PNCMP}`);
      return found;
    } finally {
      db.close();
    }
  })();
  /** The same bracket as TBA would show it before listing the backup: the played rows unchanged, the pick gone. */
  const stripped: BracketSourceEvent = {
    alliances: (listed.alliances ?? []).map((alliance) =>
      alliance.allianceNumber === STRIPPED_BACKUP.allianceNumber ? { ...alliance, picks: alliance.picks.filter((pick) => pick !== STRIPPED_BACKUP.teamKey) } : alliance
    ),
    matches: listed.matches,
  };
  const artifact = localArtifact(PNW_FILE);
  const stops = dcmpStops(artifact, listed);
  const firstPlayedRow = listed.matches.find(
    (match) => match.actualWinner !== undefined && (match.redTeams.includes(STRIPPED_BACKUP.teamKey) || match.blueTeams.includes(STRIPPED_BACKUP.teamKey))
  );

  /** The facts at a stop, built as the sweep builds them: the stop's own stage and the played rows at or before it. */
  function factsAt(bracket: BracketSourceEvent, stop: (typeof stops)[number]) {
    const { timeline, nowStageByEvent } = stop.context;
    const atNow = stop.index >= timeline.nowIndex;
    const stage = atNow ? nowStageByEvent.get(PNCMP) : districtStageAtPosition(timeline, stop.index, nowStageByEvent).get(PNCMP);
    const played = playedBracketMatchesFor(bracket, stop.playedKeys);
    const facts = dcmpBracketFactsFor({
      eventKey: PNCMP,
      season: artifact.year,
      tier: "dcmp",
      stage,
      alliances: (bracket.alliances ?? []).map((alliance) => ({ allianceNumber: alliance.allianceNumber, picks: [...alliance.picks] })),
      playedMatches: played.matches,
      unresolvedMatchCount: played.unresolvedMatchKeys.length,
      fieldBackups: played.fieldBackups,
    });
    return { played, facts };
  }

  it("premise: frc7034 is alliance 2's listed fourth, it played, and its first played row is derived from the corpus", () => {
    const alliance = (listed.alliances ?? []).find((entry) => entry.allianceNumber === STRIPPED_BACKUP.allianceNumber)!;
    expect(alliance.picks).toHaveLength(4);
    expect(alliance.picks[3]).toBe(STRIPPED_BACKUP.teamKey);
    expect((stripped.alliances ?? []).find((entry) => entry.allianceNumber === STRIPPED_BACKUP.allianceNumber)!.picks).toEqual(alliance.picks.slice(0, 3));
    // Measured 2026-10-10 by the planner (fact 10); derived here, pinned as the run shows.
    expect(firstPlayedRow?.matchKey).toBe("2026pncmp_sf10m1");
    expect(stops.length).toBeGreaterThan(3);
    // Every played row is at or before the last stop, and the listed bracket shows no backup at all.
    expect("fieldBackups" in playedBracketMatchesFor(listed)).toBe(false);
    expect(playedBracketMatchesFor(stripped).fieldBackups).toEqual([STRIPPED_BACKUP]);
    expect(playedBracketMatchesFor(stripped).matches).toEqual(playedBracketMatchesFor(listed).matches);
    expect(playedBracketMatchesFor(stripped).unresolvedMatchKeys).toEqual([]);
  });

  it("from its first played row on the facts built from the stripped picks and the played rows equal the facts built from the listed picks, and before it they do not carry the backup", () => {
    const firstKey = firstPlayedRow!.matchKey;
    const lines: string[] = [];
    let before = 0;
    let after = 0;
    // The last stop, Now, reads Awards final, where a single championship's facts are refused on both sides.
    for (const stop of stops) {
      const fromListed = factsAt(listed, stop);
      const fromStripped = factsAt(stripped, stop);
      const seen = stop.playedKeys.has(firstKey);
      const carries = (fromStripped.facts?.alliances ?? []).some((alliance) => alliance.picks.includes(STRIPPED_BACKUP.teamKey));
      lines.push(`${stop.label.padEnd(30)} played rows ${String(stop.playedKeys.size).padStart(2)} | its first row played ${String(seen).padEnd(5)} | facts ${fromListed.facts === undefined ? "refused" : "built  "} | stripped facts carry it ${String(carries)}`);
      expect(fromStripped.facts === undefined, stop.label).toBe(fromListed.facts === undefined);
      if (seen) {
        if (fromListed.facts !== undefined) after += 1;
        expect(fromStripped.played.fieldBackups, stop.label).toEqual([STRIPPED_BACKUP]);
        expect(fromStripped.facts, stop.label).toEqual(fromListed.facts);
      } else {
        if (fromListed.facts !== undefined) before += 1;
        expect("fieldBackups" in fromStripped.played, stop.label).toBe(false);
        expect(carries, stop.label).toBe(false);
        if (fromListed.facts !== undefined) {
          // The listed facts name it and the stripped ones do not: nothing after the stop's cut was read.
          expect(fromListed.facts.alliances.some((alliance) => alliance.picks.includes(STRIPPED_BACKUP.teamKey)), stop.label).toBe(true);
          expect(fromStripped.facts!.playedMatches, stop.label).toEqual(fromListed.facts.playedMatches);
        }
      }
    }
    console.log(`[261010-66y group 8] 2026pncmp, frc7034 stripped from alliance 2's picks\n${lines.join("\n")}`);
    // The comparison is not vacuous: facts were built on both sides of its first played row. Pinned as the run shows.
    expect({ stops: stops.length, factsBuiltBeforeItsFirstRow: before, factsBuiltFromItsFirstRowOn: after }).toEqual({ stops: 8, factsBuiltBeforeItsFirstRow: 3, factsBuiltFromItsFirstRowOn: 4 });
  });
});

// ---------------------------------------------------------------------------
// GROUP 9. A division's Awards turning final no longer raises a bound (closed by quick task 261010-d7r)
// ---------------------------------------------------------------------------

interface DivisionedChampionship {
  readonly artifact: DistrictArtifact;
  readonly finalsKey: string;
  readonly divisionKeys: readonly string[];
  readonly brackets: Map<string, BracketSourceEvent>;
}

let divisionedChampionshipsCache: DivisionedChampionship[] | undefined;
/** Every divisioned championship of 2023 to 2026 with a published Championship capacity and a corpus bracket at every key: the joint sweep's own set. */
function divisionedChampionships(): DivisionedChampionship[] {
  if (divisionedChampionshipsCache !== undefined) return divisionedChampionshipsCache;
  const out: DivisionedChampionship[] = [];
  const db = openCorpusReadOnly(CORPUS_ABSOLUTE);
  try {
    const alliancesBySeason = new Map();
    for (const fileName of LOCAL_DISTRICT_FILES) {
      const artifact = localArtifact(fileName);
      if (artifact.year < 2023 || artifact.cmpSlots === null) continue;
      const shape = championshipShape(dcmpEventKeysFor(artifact));
      if (shape.kind !== "divisioned") continue;
      const found = bracketsFromCorpus(db, alliancesBySeason, artifact);
      if ("missing" in found) throw new Error(`the corpus carries no bracket for ${found.missing}`);
      out.push({ artifact, finalsKey: shape.finalsKey, divisionKeys: shape.divisionKeys, brackets: found.brackets });
    }
  } finally {
    db.close();
  }
  divisionedChampionshipsCache = out;
  return out;
}

const DIVISION_PLAYOFFS_FINAL_AWARDS_OPEN: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: false };
const DIVISIONS_FINAL_STOP = "Divisions final, finals not started";

/**
 * THE ELEVEN of quick task 261010-66y: the teams the joint proof Locked with
 * the divisions' Awards open and did not hold once they read final, with the
 * bounds measured then (2026-10-10, before quick task 261010-d7r) against the
 * points slots. Kept as the record of the defect; the test below reads each
 * of them again and holds every one Locked at both readings.
 */
const THE_ELEVEN_BEFORE_D7R: readonly { districtKey: string; teamKey: string; open: number; final: number; slots: number }[] = [
  { districtKey: "2023fit", teamKey: "frc9105", open: 29, final: 30, slots: 30 },
  { districtKey: "2023ont", teamKey: "frc4069", open: 22, final: 25, slots: 23 },
  { districtKey: "2024ont", teamKey: "frc5406", open: 21, final: 23, slots: 23 },
  { districtKey: "2024ont", teamKey: "frc7712", open: 22, final: 24, slots: 23 },
  { districtKey: "2025fit", teamKey: "frc418", open: 27, final: 28, slots: 28 },
  { districtKey: "2025ont", teamKey: "frc4039", open: 21, final: 24, slots: 22 },
  { districtKey: "2026fim", teamKey: "frc5675", open: 81, final: 83, slots: 83 },
  { districtKey: "2026fit", teamKey: "frc624", open: 27, final: 28, slots: 28 },
  { districtKey: "2026fit", teamKey: "frc9140", open: 27, final: 29, slots: 28 },
  { districtKey: "2026ne", teamKey: "frc2713", open: 31, final: 33, slots: 32 },
  { districtKey: "2026ne", teamKey: "frc4909", open: 31, final: 33, slots: 32 },
];

describe("CLOSED by quick task 261010-d7r: every Locked the joint proof gives while the divisions' Awards are open is held once they read final (the measured limit of quick task 261010-66y, eleven teams, is none)", () => {
  if (!existsSync(CORPUS_ABSOLUTE)) {
    localDataAbsent(`${CORPUS_PATH} absent (gitignored local data)`);
    return;
  }
  if (LOCAL_DISTRICT_FILES.length === 0) {
    localDataAbsent(NO_LOCAL_DISTRICTS);
    return;
  }

  it(
    "over the 16 divisioned championships, every division's Playoffs final and the finals not started: no team Locked with the divisions' Awards open is not Locked with them final, and the eleven teams of before are Locked at both",
    () => {
      // WHAT THIS READS. Two readings of the same championship, both with the finals key on the rows:
      //   A. every division's Playoffs final and its Awards OPEN, the finals not started. Not a stop of the sweep.
      //   B. the sweep's own "Divisions final, finals not started": the divisions' Awards final too.
      // B knows strictly more than A, so a team Locked at A and not at B is a Locked taken back.
      //
      // WHAT IT WAS. At A no division award point is in any floor and the proof gives each rival at most one judged
      // award out of the division's whole ceiling of 14. At B the posted award points are in the floors and the proof
      // holds the rest of that ceiling for awards that may yet be listed. Until quick task 261010-d7r it could hand
      // one of those to a rival that already held a posted one, whose maximum was then one judged award higher than
      // at A. Measured then: 406 shown Locked at A, 436 at B, and the eleven teams of `THE_ELEVEN_BEFORE_D7R` Locked
      // at A and not at B. Quick task 261010-66y refused its reading D3 (the proof running during the division
      // playoffs at a live championship) because of it.
      //
      // WHAT IT IS. The teams carrying award points at a division whose Awards read final are named to the proof
      // (`awardedRivals`) and take no further judged award. So `lost` is none, and this is a requirement now: a
      // team in `lost` is a Locked taken back.
      const championships = divisionedChampionships();
      const lost: string[] = [];
      let lockedWithAwardsOpen = 0;
      let lockedWithAwardsFinal = 0;
      const judgedBudgets = new Set<string>();
      const theEleven: string[] = [];
      for (const { artifact, divisionKeys, brackets } of championships) {
        const final = championshipStops(artifact, brackets).find((stop) => stop.label === DIVISIONS_FINAL_STOP);
        if (final === undefined) throw new Error(`${artifact.districtKey} has no "${DIVISIONS_FINAL_STOP}" stop`);
        const stageByKey = new Map(final.stageByKey);
        for (const key of divisionKeys) stageByKey.set(key, DIVISION_PLAYOFFS_FINAL_AWARDS_OPEN);
        const open = { ...final, label: "Divisions' Playoffs final, their Awards open, finals not started", stageByKey };
        const atOpen = statusesAtChampionshipStop(artifact, open, brackets, true);
        const atFinal = statusesAtChampionshipStop(artifact, final, brackets, true);
        expect({ districtKey: artifact.districtKey, open: atOpen.jointProof?.applied, final: atFinal.jointProof?.applied }).toEqual({ districtKey: artifact.districtKey, open: true, final: true });
        if (atOpen.jointProof?.applied !== true || atFinal.jointProof?.applied !== true || atOpen.jointProof.shape === "multiple" || atFinal.jointProof.shape === "multiple") continue;
        judgedBudgets.add(`${String(divisionKeys.length)} divisions: ${String(atOpen.jointProof.input.judgedAwards)} open`);
        // The budget with the Awards open is the whole ceiling, 14 a division; with them final it is what is left of it.
        expect(atOpen.jointProof.input.judgedAwards).toBe(14 * divisionKeys.length);
        expect(atFinal.jointProof.input.judgedAwards).toBeLessThan(atOpen.jointProof.input.judgedAwards);
        // THE RULE'S INPUT: nobody is awarded while the Awards are open; once they read final the awarded teams are
        // exactly the teams carrying award points at a division key, and the budget is the ceiling minus them.
        const awarded = artifact.teams.filter((team) => team.eventPoints.some((row) => divisionKeys.includes(row.eventKey) && row.award > 0)).map((team) => team.teamKey).sort();
        expect("awardedRivals" in atOpen.jointProof.input).toBe(false);
        expect(atFinal.jointProof.input.awardedRivals).toEqual(awarded);
        expect(atFinal.jointProof.input.judgedAwards).toBe(14 * divisionKeys.length - awarded.length);
        const shownLocked = (model: typeof atOpen): Set<string> => new Set([...model.byTeam.values()].filter((result) => result.status === "locked").map((result) => result.teamKey));
        const lockedOpen = shownLocked(atOpen);
        const lockedFinal = shownLocked(atFinal);
        lockedWithAwardsOpen += lockedOpen.size;
        lockedWithAwardsFinal += lockedFinal.size;
        for (const teamKey of [...lockedOpen].sort()) {
          if (lockedFinal.has(teamKey)) continue;
          lost.push(
            `${artifact.districtKey} ${teamKey}: ${String(atOpen.byTeam.get(teamKey)?.lockedBy)} with the Awards open, ${String(atFinal.byTeam.get(teamKey)?.status)} with them final, bound ${String(jointProofBound(atOpen.jointProof, teamKey))} then ${String(jointProofBound(atFinal.jointProof, teamKey))} against ${String(atOpen.pointsSlots)} points slots`
          );
        }
        for (const entry of THE_ELEVEN_BEFORE_D7R.filter((candidate) => candidate.districtKey === artifact.districtKey)) {
          theEleven.push(
            `${entry.districtKey} ${entry.teamKey}: ${String(atOpen.byTeam.get(entry.teamKey)?.status)} by ${String(atOpen.byTeam.get(entry.teamKey)?.lockedBy)} with the Awards open, ${String(atFinal.byTeam.get(entry.teamKey)?.status)} by ${String(atFinal.byTeam.get(entry.teamKey)?.lockedBy)} with them final, bound ${String(jointProofBound(atOpen.jointProof, entry.teamKey))} then ${String(jointProofBound(atFinal.jointProof, entry.teamKey))} against ${String(atOpen.pointsSlots)} then ${String(atFinal.pointsSlots)} points slots (before: ${String(entry.open)} then ${String(entry.final)} against ${String(entry.slots)})`
          );
        }
      }
      console.log(
        `[261010-d7r group 9] divisioned championships ${String(championships.length)} | shown Locked with the divisions' Awards open ${String(lockedWithAwardsOpen)}, with them final ${String(lockedWithAwardsFinal)} | Locked with them open and not with them final ${String(lost.length)}\n${lost.map((line) => `  ${line}`).join("\n")}\nthe eleven of before:\n${theEleven.map((line) => `  ${line}`).join("\n")}`
      );
      expect([...judgedBudgets].sort()).toEqual(["2 divisions: 28 open", "4 divisions: 56 open"]);
      // THE REQUIREMENT: none.
      expect(lost).toEqual([]);
      // Pinned as the run shows. With the Awards open the count is what it was (406: the rule changes nothing while
      // nobody is awarded); with them final it was 436.
      expect({ championships: championships.length, lockedWithAwardsOpen, lockedWithAwardsFinal }).toEqual({ championships: 16, lockedWithAwardsOpen: 406, lockedWithAwardsFinal: 451 });
      // The eleven, read again: each Locked by the joint proof at both readings. Pinned as the run shows.
      expect(theEleven).toEqual([
        "2023fit frc9105: locked by joint with the Awards open, locked by joint with them final, bound 29 then 29 against 30 then 30 points slots (before: 29 then 30 against 30)",
        "2023ont frc4069: locked by joint with the Awards open, locked by joint with them final, bound 22 then 22 against 23 then 23 points slots (before: 22 then 25 against 23)",
        "2024ont frc5406: locked by joint with the Awards open, locked by joint with them final, bound 21 then 21 against 23 then 23 points slots (before: 21 then 23 against 23)",
        "2024ont frc7712: locked by joint with the Awards open, locked by joint with them final, bound 22 then 22 against 23 then 23 points slots (before: 22 then 24 against 23)",
        "2025fit frc418: locked by joint with the Awards open, locked by joint with them final, bound 27 then 27 against 28 then 28 points slots (before: 27 then 28 against 28)",
        "2025ont frc4039: locked by joint with the Awards open, locked by joint with them final, bound 21 then 21 against 22 then 22 points slots (before: 21 then 24 against 22)",
        "2026fim frc5675: locked by joint with the Awards open, locked by joint with them final, bound 81 then 81 against 83 then 83 points slots (before: 81 then 83 against 83)",
        "2026fit frc624: locked by joint with the Awards open, locked by joint with them final, bound 27 then 27 against 28 then 28 points slots (before: 27 then 28 against 28)",
        "2026fit frc9140: locked by joint with the Awards open, locked by joint with them final, bound 27 then 27 against 28 then 28 points slots (before: 27 then 29 against 28)",
        "2026ne frc2713: locked by joint with the Awards open, locked by joint with them final, bound 31 then 31 against 32 then 32 points slots (before: 31 then 33 against 32)",
        "2026ne frc4909: locked by joint with the Awards open, locked by joint with them final, bound 31 then 31 against 32 then 32 points slots (before: 31 then 33 against 32)",
      ]);
    },
    WALK_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// GROUP 10. The live walks with the field's bracket facts
// ---------------------------------------------------------------------------

/** The four divisioned championships of 2026. */
const FACTS_WALKED = ["2026fim", "2026ne", "2026ont", "2026fit"] as const;
type FactsWalked = (typeof FACTS_WALKED)[number];
const MISSING_FACTS_WALKED = FACTS_WALKED.filter((districtKey) => !LOCAL_DISTRICT_FILES.includes(`v1__district__${districtKey}.json`));

const factsWalkCache = new Map<string, Walk>();
/** The first walk of a divisioned district with its corpus brackets handed to the tab, through the window and the finals ticks. */
function factsWalk(districtKey: FactsWalked): Walk {
  let walk = factsWalkCache.get(districtKey);
  if (walk === undefined) {
    const source = walkedSource(districtKey);
    const championship = divisionedChampionships().find((entry) => entry.artifact.districtKey === source.districtKey);
    if (championship === undefined) throw new Error(`${districtKey} is not among the divisioned championships`);
    walk = walkChampionshipField(source, { finalsTicks: true, brackets: championship.brackets });
    factsWalkCache.set(districtKey, walk);
  }
  return walk;
}

const shownLockedCount = (step: WalkStep): number => [...step.champTab.values()].filter((status) => status === "locked").length;
function factsTable(walk: Walk): string[] {
  return walk.steps.map(
    (step) => `  ${step.label.padEnd(46)} joint=${step.joint.padEnd(20)} joint locked ${String(step.jointLocked).padStart(3)} | shown Locked ${String(shownLockedCount(step)).padStart(3)} | reserved ${String(step.champReserved).padStart(2)} | in progress ${String(step.inProgressKeys.length)}`
  );
}
const ALLIANCES_PICKED_TICK = "alliances picked, no alliance points";
const WINDOW_TICK = "every division finished, finals on no row";
const FINALS_ROWS_TICK = "finals rows posted, no state";
const FINALS_STATE_TICK = "finals state written";
const FINALS_AWARDS_TICK = "finals award points land";

describe("the live walks with the field's bracket facts: 2026 FIM, NE, ONT and TX, the finals key on no row until the finals rows post (quick task 261010-66y, reading R15, with D3 refused)", () => {
  if (!existsSync(CORPUS_ABSOLUTE)) {
    localDataAbsent(`${CORPUS_PATH} absent (gitignored local data)`);
    return;
  }
  if (MISSING_FACTS_WALKED.length > 0) {
    localDataAbsent(`${MISSING_FACTS_WALKED.join(", ")} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }

  it(
    "the proof reads unsupportedShape while the finals key is on no row and is applied from the finals rows on; no Locked is taken back through the finals' state being written",
    () => {
      const table: string[] = [];
      const shown: Record<string, number[]> = {};
      const atTheFinalsAwards: Record<string, string[]> = {};
      for (const districtKey of FACTS_WALKED) {
        const walk = factsWalk(districtKey);
        table.push(districtKey, ...factsTable(walk));
        const labels = walk.steps.map((step) => step.label);
        const picked = labels.indexOf(ALLIANCES_PICKED_TICK);
        const finalsRowsAt = labels.indexOf(FINALS_ROWS_TICK);
        const finalsAwardsAt = labels.indexOf(FINALS_AWARDS_TICK);
        expect(picked).toBeGreaterThan(0);
        expect(finalsRowsAt).toBeGreaterThan(picked);
        expect(finalsAwardsAt).toBe(finalsRowsAt + 2);
        expect({ districtKey, out: fieldTeamsReadOut(walk) }).toEqual({ districtKey, out: [] });
        // The finals key is on no row until the finals rows post: division keys without their finals event are
        // not a shape the proof runs on (D3 refused, `finalsBracket.ts`).
        for (const step of walk.steps.slice(picked, finalsRowsAt)) {
          expect({ districtKey, tick: step.label, dcmpKeys: step.dcmpKeys, joint: step.joint }).toEqual({ districtKey, tick: step.label, dcmpKeys: walk.fieldFixingKeys.length, joint: "unsupportedShape" });
        }
        // Once it is on a row the proof runs, at the tick the finals rows post with no state included.
        for (const step of walk.steps.slice(finalsRowsAt, finalsAwardsAt + 1)) expect({ districtKey, tick: step.label, joint: step.joint }).toEqual({ districtKey, tick: step.label, joint: "applied(divisioned)" });
        // NO LOCKED IS TAKEN BACK at any tick, the tick the finals' award points land included. Before the last
        // step of this quick task that tick took 2 back at 2026 FIM (frc5843, frc9572) and 1 at TX (frc624): a
        // team that gained a finals row there gained the championship's whole Awards ceiling with it.
        expect({ districtKey, lost: lockedTakenBack(walk) }).toEqual({ districtKey, lost: [] });
        atTheFinalsAwards[districtKey] = lockedTakenBack(walk);
        shown[districtKey] = walk.steps.slice(picked, finalsAwardsAt + 1).map(shownLockedCount);
        shown[`${districtKey} end`] = [shownLockedCount(walk.steps.at(-1)!)];
      }
      console.log(`[261010-66y group 10] the live walks with the bracket facts\n${table.join("\n")}`);
      expect(Object.fromEntries(Object.entries(atTheFinalsAwards).map(([districtKey, lost]) => [districtKey, lost.length]))).toEqual({ "2026fim": 0, "2026ne": 0, "2026ont": 0, "2026fit": 0 });
      // Teams shown Locked per tick, from "alliances picked" to "finals award points land", then at the end. Pinned
      // as the run shows. The fourteen ticks: alliances picked, alliance points land, after Rounds 1 to 5, playoffs
      // done, playoff points land, division award points land, every division finished, finals rows posted,
      // finals state written, finals award points land.
      //
      // THE LAST TWO TICKS MOVED with the last step of this quick task (the finals' Awards add no points ceiling
      // for anyone), upward only: at "finals state written" NE read 19 and reads 21; at "finals award points land"
      // FIM read 69 and reads 71, NE 19 and 21, TX 16 and 17. Every earlier tick, and ONT, is what it was.
      //
      // THE TICK THE FINALS ROWS POST MOVED with quick task 261010-d7r (its rule D1), upward only: FIM read 65 and
      // reads 66, NE 18 and 20, TX 15 and 17. At that tick every division's Awards read final and the proof runs
      // for the first time, so the teams carrying a posted division award are named to it and take no second
      // judged award. The counts gained are those of the joint sweep's "Divisions final, finals not started" stop,
      // where the teams gained are of the eleven of group 9 (frc5675 at FIM, frc2713 and frc4909 at NE, frc624 and
      // frc9140 at TX). Every other tick, and ONT, is what it was.
      expect(shown).toEqual({
        "2026fim": [0, 0, 0, 0, 0, 0, 0, 0, 13, 13, 29, 66, 71, 71],
        "2026fim end": [83],
        "2026ne": [0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 12, 20, 21, 21],
        "2026ne end": [32],
        "2026ont": [0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 10, 11, 12, 12],
        "2026ont end": [21],
        "2026fit": [0, 0, 0, 0, 0, 0, 0, 0, 6, 6, 11, 17, 17, 17],
        "2026fit end": [28],
      });
    },
    WALK_TIMEOUT_MS
  );

  it(
    "THE WINDOW AND THE FINALS ROWS: nothing of the championship reads in progress there, and with the brackets still in hand the proof runs at the tick the finals rows post",
    () => {
      const held: Record<string, { jointLocked: number; shownLocked: number }> = {};
      for (const districtKey of FACTS_WALKED) {
        const walk = factsWalk(districtKey);
        const ofTheChampionship = (step: WalkStep): string[] => step.inProgressKeys.filter((key) => dcmpEventKeysFor(walkedSource(districtKey)).includes(key));
        const windowAt = walk.steps.findIndex((step) => step.label === WINDOW_TICK);
        const finalsRowsAt = walk.steps.findIndex((step) => step.label === FINALS_ROWS_TICK);
        const finalsStateAt = walk.steps.findIndex((step) => step.label === FINALS_STATE_TICK);
        expect(windowAt).toBeGreaterThan(0);
        expect(finalsRowsAt).toBe(windowAt + 1);
        // At the tick before the window the divisions still read in progress.
        expect(ofTheChampionship(walk.steps[windowAt - 1]!)).toEqual([...walk.fieldFixingKeys].sort());
        // THE WINDOW: every division finished, the finals key on no row. Nothing of the championship is in progress.
        expect({ districtKey, inProgress: ofTheChampionship(walk.steps[windowAt]!) }).toEqual({ districtKey, inProgress: [] });
        // THE FINALS ROWS POST WITH NO STATE: the finals key is on a row now and has not started, and still nothing
        // of the championship is in progress. The fetch set of before this task held none of its keys here, so the
        // tab had no bracket to hand the proof. `champLiveFetchKeys` now keeps every started key until the finals
        // event has finished; that rule is pinned on exactly this state in `useDistrictLedgerData.test.ts` (the
        // hook module cannot be imported outside the web project). With the brackets in hand the proof runs:
        const finalsRows = walk.steps[finalsRowsAt]!;
        expect({ districtKey, inProgress: ofTheChampionship(finalsRows) }).toEqual({ districtKey, inProgress: [] });
        expect(finalsRows.dcmpKeys).toBe(walk.fieldFixingKeys.length + 1);
        expect(finalsRows.joint).toBe("applied(divisioned)");
        // And once the finals' state is written the finals event itself reads in progress.
        expect(ofTheChampionship(walk.steps[finalsStateAt]!)).toEqual([dcmpEventKeysFor(walkedSource(districtKey)).find((key) => !walk.fieldFixingKeys.includes(key))!]);
        held[districtKey] = { jointLocked: finalsRows.jointLocked, shownLocked: shownLockedCount(finalsRows) };
      }
      // What the proof holds at the tick the finals rows post. Pinned as the run shows. Quick task 261010-d7r (its
      // rule D1) moved three of the four, upward: FIM 65 to 66, NE 18 to 20, TX 15 to 17. ONT did not move.
      expect(held).toEqual({
        "2026fim": { jointLocked: 66, shownLocked: 66 },
        "2026ne": { jointLocked: 20, shownLocked: 20 },
        "2026ont": { jointLocked: 11, shownLocked: 11 },
        "2026fit": { jointLocked: 17, shownLocked: 17 },
      });
    },
    WALK_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// GROUP 11. The finals read the same way with and without a finals row
// ---------------------------------------------------------------------------

/** The artifact with every row at its finals key removed: the rows, the registrations, the awards recorded there, and each removed row's total out of the team's point total. */
function withoutFinalsKeyRows(artifact: DistrictArtifact, finalsKey: string): DistrictArtifact {
  return DistrictArtifactSchema.parse({
    ...artifact,
    teams: artifact.teams.map((team) => ({
      ...team,
      pointTotal: team.pointTotal - team.eventPoints.filter((row) => row.eventKey === finalsKey).reduce((sum, row) => sum + row.total, 0),
      eventPoints: team.eventPoints.filter((row) => row.eventKey !== finalsKey),
      remainingEvents: team.remainingEvents.filter((row) => row.eventKey !== finalsKey),
      qualifyingAwards: team.qualifyingAwards.filter((award) => award.eventKey !== finalsKey),
    })),
  });
}

const EVERY_CATEGORY_OPEN: DistrictStageFinality = { qual: false, alliance: false, elim: false, award: false };
/** The stops of a divisioned championship before its finals have a played row, as the joint sweep labels them. */
const beforeTheFinalsHaveARow = (label: string): boolean => label === "Alliances final" || label.startsWith("Round ") || label === DIVISIONS_FINAL_STOP;

describe("the finals read the same way with and without a finals row: the 16 divisioned championships, nine stops each (quick task 261010-66y, P12 reading (A))", () => {
  if (!existsSync(CORPUS_ABSOLUTE)) {
    localDataAbsent(`${CORPUS_PATH} absent (gitignored local data)`);
    return;
  }
  if (LOCAL_DISTRICT_FILES.length === 0) {
    localDataAbsent(NO_LOCAL_DISTRICTS);
    return;
  }

  it(
    "with the finals key's rows removed every team's floor and ceiling, the teams shown Locked and lockedBy are what they are with them present, at all 144 stops",
    () => {
      // WHAT IS COMPARED. Each championship at nine stops before its finals have a played row: nothing started;
      // every division in qualification; then the joint sweep's own stops (Alliances final, Rounds 1 to 5,
      // Divisions final with the finals not started). At each, the tab's statuses on the artifact as published
      // against the artifact with every row at the finals key removed. A team that ENDS with a finals row has not
      // earned it at any of these stops, so the two must read the same: a difference is the tab reading the
      // future off who ends with a finals row.
      //
      // THE BRACKET FACTS ARE WITHHELD ON BOTH SIDES. Division keys without their finals key are not a shape
      // the joint proof runs on (D3 of this quick task, refused), so with the rows removed the proof could not
      // run, and the comparison would then measure the proof and not the ceiling test. Each key's milestones are
      // handed on both sides, as the sweep's own recipe hands them.
      const championships = divisionedChampionships();
      let stops = 0;
      let ceilingStops = 0;
      let ceilingTeamStops = 0;
      let ceilingTeamStopsOfTheField = 0;
      const finalsOnlyDiffering = new Set<string>();
      const differences: string[] = [];
      for (const { artifact, finalsKey, divisionKeys, brackets } of championships) {
        const removed = withoutFinalsKeyRows(artifact, finalsKey);
        const keys = dcmpEventKeysFor(artifact);
        const fieldTeams = new Set(artifact.teams.filter((team) => team.eventPoints.some((row) => divisionKeys.includes(row.eventKey))).map((team) => team.teamKey));
        const early = [
          { label: "Nothing started", atNow: false, stageByKey: new Map(keys.map((key) => [key, EVERY_CATEGORY_OPEN] as const)), playedKeysByKey: new Map<string, ReadonlySet<string>>(), startedKeys: new Set<string>() },
          { label: "Divisions in qualification", atNow: false, stageByKey: new Map(keys.map((key) => [key, EVERY_CATEGORY_OPEN] as const)), playedKeysByKey: new Map<string, ReadonlySet<string>>(), startedKeys: new Set<string>(divisionKeys) },
        ];
        for (const stop of [...early, ...championshipStops(artifact, brackets).filter((entry) => beforeTheFinalsHaveARow(entry.label))]) {
          stops += 1;
          const where = `${artifact.districtKey} "${stop.label}"`;
          const present = statusesAtChampionshipStop(artifact, stop, brackets, false);
          const absent = statusesAtChampionshipStop(removed, stop, brackets, false);
          let ceilingDiffersHere = 0;
          for (const [teamKey, floor] of present.floorByTeam ?? []) {
            if (absent.floorByTeam?.get(teamKey) !== floor) differences.push(`${where}: ${teamKey} floor ${String(floor)} with the finals rows, ${String(absent.floorByTeam?.get(teamKey))} without`);
            const withRows = present.ceilingByTeam?.get(teamKey);
            const withoutRows = absent.ceilingByTeam?.get(teamKey);
            if (withRows !== withoutRows) {
              ceilingDiffersHere += 1;
              if (fieldTeams.has(teamKey)) ceilingTeamStopsOfTheField += 1;
              else finalsOnlyDiffering.add(`${artifact.districtKey} ${teamKey}`);
              if (differences.length < 12) differences.push(`${where}: ${teamKey} ceiling ${String(withRows)} with the finals rows, ${String(withoutRows)} without (${fieldTeams.has(teamKey) ? "a team of the field" : "no division row"})`);
            }
          }
          if (ceilingDiffersHere > 0) ceilingStops += 1;
          ceilingTeamStops += ceilingDiffersHere;
          const shown = (model: typeof present): string => [...model.byTeam.values()].filter((result) => result.status === "locked").map((result) => `${result.teamKey}:${String(result.lockedBy)}`).sort().join(",");
          if (shown(present) !== shown(absent)) differences.push(`${where}: the teams shown Locked, or their lockedBy, differ`);
        }
      }
      console.log(
        `[261010-66y group 11] divisioned championships ${String(championships.length)} | stops ${String(stops)} | a ceiling differs at ${String(ceilingStops)} stops (${String(ceilingTeamStops)} team stops, ${String(ceilingTeamStopsOfTheField)} of them teams of the field, ${String(finalsOnlyDiffering.size)} teams with no division row) | differences listed ${String(differences.length)}\n${differences.slice(0, 12).map((line) => `  ${line}`).join("\n")}`
      );
      // Not vacuous, and pinned as the run shows.
      expect({ championships: championships.length, stops }).toEqual({ championships: 16, stops: 144 });
      // THE EQUALITY. Before this step: a ceiling differed at all 144 stops, 1,593 team stops, 1,476 of them teams of the field.
      expect({ ceilingStops, ceilingTeamStops }).toEqual({ ceilingStops: 0, ceilingTeamStops: 0 });
      expect(differences).toEqual([]);
    },
    WALK_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// GROUP 12. The teams that attend below the district line are dominated (D12)
// ---------------------------------------------------------------------------

/** One side's reading of a tick: who is an unseen attendee, and who on no row carries a hypothetical championship. */
interface DominanceSide {
  readonly side: "tab" | "published";
  /** Whether a team is on a row at a field fixing key at the tick, as this side counts a row. */
  readonly onARow: (step: WalkStep, teamKey: string, fieldFixing: ReadonlySet<string>) => boolean;
  /** What the team's open ceiling is on this side at the tick. */
  readonly openCeiling: (step: WalkStep, teamKey: string) => number;
}

interface DominanceFailure {
  readonly where: string;
  readonly unseen: number;
  readonly carrying: number;
  /** The most unseen attendees at or above some total that the carrying teams at or above it do not cover. */
  readonly uncovered: number;
  /** How many teams the field ends with beyond the published championship capacity. */
  readonly beyondCapacity: number;
}

/**
 * THE DOMINANCE CHECK OF ONE WALK ON ONE SIDE. At every tick where the field
 * is unproven after a start: U is the teams that END with a field fixing row
 * and are on no row at the tick; H is the teams on no row that carry at least
 * one whole hypothetical championship at the tick. U is dominated by H when,
 * for every total t, at least as many of H are at or above t as of U. That is
 * the rank by rank comparison of the two sorted lists, and it says the teams
 * that may still pass a given floor are never undercounted.
 */
function dominanceFailures(name: string, walk: Walk, source: DistrictArtifact, reading: DominanceSide): DominanceFailure[] {
  const maxima = maxEventPoints(source.year, "dcmp");
  const oneChampionship = maxima.qual + maxima.alliance + maxima.elim + maxima.award;
  const failures: DominanceFailure[] = [];
  const fieldFixing: ReadonlySet<string> = new Set(walk.fieldFixingKeys);
  for (const step of walk.steps) {
    // The one state the readers act on: some field fixing key has started and the field is not proven.
    if (step.fieldProven) continue;
    const unseen: number[] = [];
    const carrying: number[] = [];
    for (const [teamKey, total] of step.pointTotal) {
      if (reading.onARow(step, teamKey, fieldFixing)) continue;
      if (walk.fieldTeams.has(teamKey)) unseen.push(total);
      if (reading.openCeiling(step, teamKey) >= oneChampionship) carrying.push(total);
    }
    unseen.sort((a, b) => b - a);
    carrying.sort((a, b) => b - a);
    let uncovered = 0;
    for (let rank = 0; rank < unseen.length; rank++) {
      // How many of each list sit at or above the total of the unseen attendee at this rank.
      const total = unseen[rank]!;
      const carryingAtOrAbove = carrying.filter((value) => value >= total).length;
      uncovered = Math.max(uncovered, rank + 1 - carryingAtOrAbove);
    }
    if (uncovered > 0) {
      failures.push({ where: `${name}, ${reading.side}, "${step.label}"`, unseen: unseen.length, carrying: carrying.length, uncovered, beyondCapacity: Math.max(0, walk.fieldTeams.size - (source.dcmpSlots ?? walk.fieldTeams.size)) });
    }
  }
  return failures;
}

describe("the teams that attend below the district line are dominated: the real 2026 walks, the tab and the published verdicts (quick task 261010-66y, D12)", () => {
  if (MISSING_PUBLISHED_WALKED.length > 0) {
    localDataAbsent(`${MISSING_PUBLISHED_WALKED.join(", ")} absent under ${LOCAL_DISTRICT_DIR} (gitignored local data)`);
    return;
  }

  const fieldFixingOf = (walk: Walk): ReadonlySet<string> => new Set(walk.fieldFixingKeys);
  /** THE TAB counts a registration as a row: a registered team is in the field there. */
  const TAB: DominanceSide = {
    side: "tab",
    onARow: (step, teamKey, fieldFixing) => [...(step.dcmpPointsKeys.get(teamKey) ?? []), ...(step.dcmpRegisteredKeys.get(teamKey) ?? [])].some((key) => fieldFixing.has(key)),
    openCeiling: (step, teamKey) => step.tabOpenCeiling.get(teamKey) ?? 0,
  };
  /** THE PUBLISHED PASS gives the hypothetical championship to a team with no POINTS row at a championship: a registration is not one. */
  const PUBLISHED: DominanceSide = {
    side: "published",
    onARow: (step, teamKey, fieldFixing) => (step.dcmpPointsKeys.get(teamKey) ?? []).some((key) => fieldFixing.has(key)),
    openCeiling: (step, teamKey) => step.publishedCeiling.get(teamKey) ?? 0,
  };

  it(
    "at every tick where the field is unproven the unseen attendees are dominated, rank by rank, by the teams on no row that carry a hypothetical championship; every tick where they are not is listed with its reason",
    () => {
      // THE ARGUMENT THIS HOLDS (the core header, limit 2). A team the district tier reads eliminated carries no
      // hypothetical championship, and a few such teams attend all the same, in a place a team that earned one
      // did not take up. For each of them there is then a team that earned a place and is NOT attending, which
      // carries the hypothetical championship at a district total at least as high. So among the teams on no row,
      // the ones carrying a hypothetical dominate the ones that will turn out to attend, and the count of teams
      // that can still pass any floor is not understated. It does not cover a field ABOVE its published
      // capacity: an attendee beyond the capacity took nobody's place, so nobody stands in for it.
      const failures: DominanceFailure[] = [];
      let walks = 0;
      let ticks = 0;
      const unseenBelowTheLine: Record<string, number> = {};
      const run = (name: string, walk: Walk, source: DistrictArtifact): void => {
        walks += 1;
        expect(fieldFixingOf(walk).size).toBeGreaterThan(0);
        for (const reading of [TAB, PUBLISHED]) failures.push(...dominanceFailures(name, walk, source, reading));
        // Not vacuous: count the unproven ticks, and the most unseen attendees carrying nothing in the published pass at one tick.
        const maxima = maxEventPoints(source.year, "dcmp");
        const oneChampionship = maxima.qual + maxima.alliance + maxima.elim + maxima.award;
        let most = 0;
        for (const step of walk.steps) {
          if (step.fieldProven) continue;
          ticks += 1;
          let here = 0;
          for (const teamKey of walk.fieldTeams) if (!PUBLISHED.onARow(step, teamKey, fieldFixingOf(walk)) && PUBLISHED.openCeiling(step, teamKey) < oneChampionship) here += 1;
          most = Math.max(most, here);
        }
        unseenBelowTheLine[name] = most;
      };
      for (const districtKey of PUBLISHED_WALKED) {
        const source = recomputeDistrictVerdicts(localArtifact(`v1__district__${districtKey}.json`), { nowYear: NOW_YEAR });
        for (const registeredFirst of [false, true]) {
          run(`${districtKey}, ${registeredFirst ? "registered first" : "no dcmp row first"}`, walkChampionshipField(source, { registeredFirst, finalsTicks: true }), source);
        }
      }
      for (const districtKey of WALKED_DISTRICTS) {
        const source = walkedSource(districtKey);
        const fieldFixing = fieldFixingDcmpKeys(dcmpEventKeysFor(source));
        for (let finalAtStart = 0; finalAtStart < fieldFixing.length; finalAtStart++) run(`${districtKey}, the points at each event's end, ${String(finalAtStart)} final at the start`, realEventEndWalk(districtKey, finalAtStart, "on"), source);
      }
      const reasonOf = (failure: DominanceFailure): string => (failure.beyondCapacity > 0 && failure.uncovered <= failure.beyondCapacity ? "a field above its published capacity" : "OTHER");
      console.log(
        `[261010-66y group 12] walks ${String(walks)} | unproven ticks ${String(ticks)} | ticks where the unseen attendees are not dominated ${String(failures.length)}\n${failures
          .map((failure) => `  ${failure.where}: unseen attendees ${String(failure.unseen)}, carrying a hypothetical ${String(failure.carrying)}, not covered ${String(failure.uncovered)}, the field ends ${String(failure.beyondCapacity)} above capacity: ${reasonOf(failure)}`)
          .join("\n")}`
      );
      console.log(`[261010-66y group 12] the most unseen attendees carrying no hypothetical championship in the published verdicts at one unproven tick, per walk: ${JSON.stringify(unseenBelowTheLine)}`);
      // Not vacuous, and pinned as the run shows: 12 walks of the first kind (six districts, both starts, through
      // the finals ticks) and 12 of the second (five districts, every start), 75 unproven ticks in all.
      expect({ walks, ticks }).toEqual({ walks: 24, ticks: 75 });
      // ANY FAILURE FOR A REASON OTHER THAN A FIELD ABOVE ITS PUBLISHED CAPACITY IS A STOP.
      expect(failures.filter((failure) => reasonOf(failure) === "OTHER")).toEqual([]);
      // THE MEASURED EXCEPTION, as the run shows: one team at one tick. 2026 PNW fields 51 teams against a
      // published capacity of 50, so its one attendee below the district line took nobody's place, and no team
      // that earned a place stands in for it. It shows in the published verdicts alone, on the start with every
      // attending team registered, at the one tick the championship has started and no row is posted. On the tab
      // a registered team is in the field, so it is on a row there.
      expect(failures.map((failure) => `${failure.where}: not covered ${String(failure.uncovered)}`)).toEqual(['2026pnw, registered first, published, "pncmp started on the field, state only": not covered 1']);
      expect(failures.map((failure) => failure.beyondCapacity)).toEqual([1]);
      // THE TEAMS THE ARGUMENT IS ABOUT, per walk: the most unseen attendees carrying no hypothetical championship
      // in the published verdicts at one unproven tick. Pinned as the run shows.
      expect(unseenBelowTheLine).toEqual({
        "2026fim, no dcmp row first": 0,
        "2026fim, registered first": 0,
        "2026ne, no dcmp row first": 4,
        "2026ne, registered first": 8,
        "2026ont, no dcmp row first": 4,
        "2026ont, registered first": 9,
        "2026fit, no dcmp row first": 3,
        "2026fit, registered first": 4,
        "2026ca, no dcmp row first": 3,
        "2026ca, registered first": 4,
        "2026pnw, no dcmp row first": 0,
        "2026pnw, registered first": 1,
        "2026fim, the points at each event's end, 0 final at the start": 0,
        "2026fim, the points at each event's end, 1 final at the start": 0,
        "2026fim, the points at each event's end, 2 final at the start": 0,
        "2026fim, the points at each event's end, 3 final at the start": 0,
        "2026ne, the points at each event's end, 0 final at the start": 4,
        "2026ne, the points at each event's end, 1 final at the start": 4,
        "2026ont, the points at each event's end, 0 final at the start": 4,
        "2026ont, the points at each event's end, 1 final at the start": 4,
        "2026fit, the points at each event's end, 0 final at the start": 3,
        "2026fit, the points at each event's end, 1 final at the start": 3,
        "2026ca, the points at each event's end, 0 final at the start": 3,
        "2026ca, the points at each event's end, 1 final at the start": 3,
      });
    },
    WALK_TIMEOUT_MS
  );
});

