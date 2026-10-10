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
 * `fieldProven` handed on as the tab hands it.
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
 *
 * IT PROVES SOMETHING. The same walk runs with the rule switched off inside
 * this file (the core proof answering as the code read the field before this
 * task, through a module mock, everything else left on) and must then take a
 * Locked back. The second walk also runs with the finals part of a rowless
 * team's hypothetical championship switched off
 * (`hypotheticalFinalsCeiling`). The switched off totals are PINNED AS THE
 * RUN SHOWS: they are a measurement of the old reading, not a requirement.
 *
 * A GROUP THAT READS GITIGNORED LOCAL DATA skips, with a message naming what
 * is absent, where the data is not there. With `REQUIRE_LOCAL_DATA=1` in the
 * environment the same group FAILS instead, so a verify step cannot pass on a
 * machine that silently ran nothing.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDistrictEventState, applyDistrictRankings, recomputeDistrictVerdicts } from "../packages/harness/districtRankingsMerge.js";
import { DistrictArtifactSchema, type DistrictArtifact, type DistrictEventState } from "../packages/harness/pageArtifacts.js";
import { fieldFixingDcmpKeys } from "../packages/core/districts/dcmpFieldProof.js";
import { championshipShape } from "../packages/core/districts/finalsBracket.js";
import { buildDistrictLedgerRows, deriveStageFromState, tierEvents, type DistrictEventDistributions } from "../apps/web/src/components/districts/districtLedgerRows.js";
import { computeDistrictLedgerStatuses } from "../apps/web/src/components/districts/districtLedgerStatus.js";
import { buildChampLedgerRows, champFieldProofAtNow, dcmpEventKeysFor } from "../apps/web/src/components/districts/champLedgerRows.js";
import { computeChampLedgerStatuses } from "../apps/web/src/components/districts/champLedgerStatus.js";

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
 */
const ruleSwitch = vi.hoisted(() => ({ fieldRuleOff: false, finalsAllowanceOff: false }));

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
  };
});

afterEach(() => {
  ruleSwitch.fieldRuleOff = false;
  ruleSwitch.finalsAllowanceOff = false;
});

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
function snapshot(label: string, artifact: DistrictArtifact): WalkStep {
  const districtRows = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS, tier: "district" });
  const districtStatuses = computeDistrictLedgerStatuses({ artifact, teams: districtRows.teams });
  const districtLockedOut = new Set<string>();
  for (const [teamKey, result] of districtStatuses.byTeam) if (result.status === "lockedOut") districtLockedOut.add(teamKey);

  const started = startedDcmpKeys(artifact);
  const champRows = buildChampLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS, startedDcmpEventKeys: started, atLivePosition: true, nowYear: NOW_YEAR });
  const champStatuses = computeChampLedgerStatuses({ artifact, teams: champRows.teams, districtLockedOut, nowYear: NOW_YEAR, fieldProven: champRows.fieldProven });

  return {
    label,
    champTab: new Map([...champStatuses.byTeam].map(([teamKey, result]) => [teamKey, result.status] as const)),
    membership: new Map(champRows.teams.map((team) => [team.teamKey, team.membership] as const)),
    fieldProven: champRows.fieldProven,
    proven: champFieldProofAtNow(artifact, started, NOW_YEAR).proven,
    champReserved: champStatuses.reservedSlots,
    dcmpKeys: dcmpEventKeysFor(artifact).length,
  };
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

type PointsStage = "qual" | "alliance" | "elim";
type StatePhase = "started" | "qualDone" | "picked" | "done";

const shortKey = (eventKey: string): string => eventKey.slice(4);

/**
 * Walks `source` from "no dcmp row" to the source artifact itself, one field
 * fixing key at a time, through the two merge entry points.
 */
function walkChampionshipField(source: DistrictArtifact): Walk {
  const dcmpKeys = dcmpEventKeysFor(source);
  const fieldFixingKeys = fieldFixingDcmpKeys(dcmpKeys);
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
      teams: source.teams.map((team) => ({
        ...team,
        pointTotal: team.pointTotal - dcmpTotal(team),
        eventPoints: team.eventPoints.filter((row) => row.tier !== "dcmp"),
        remainingEvents: team.remainingEvents.filter((row) => row.tier !== "dcmp"),
        qualifyingAwards: team.qualifyingAwards.filter((award) => !dcmpKeys.includes(award.eventKey)),
      })),
    }),
    { nowYear: NOW_YEAR, dcmpStillAhead: true }
  );

  // What TBA has posted so far, per key, and the state the match feed shows.
  const posted = new Map<string, PointsStage>();
  const states = new Map<string, DistrictEventState>();
  const pointsAt = (row: Row, stage: PointsStage) => ({ qual: row.qual, alliance: stage === "qual" ? 0 : row.alliance, elim: stage === "elim" ? row.elim : 0, award: 0 });

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
  const record = (label: string): void => {
    steps.push(snapshot(label, artifact));
  };
  const rowsTick = (label: string): void => {
    artifact = applyDistrictRankings({ artifact, rankings: payload(), ...STAMP, eventState: statesInHand() });
    record(label);
  };
  const stateTick = (label: string): void => {
    const inHand = statesInHand();
    if (inHand.size > 0) artifact = applyDistrictEventState({ artifact, eventState: inHand, ...STAMP });
    record(label);
  };

  record("no dcmp row");
  for (const key of fieldFixingKeys) {
    states.set(key, stateFor(key, "started"));
    posted.set(key, "qual");
    rowsTick(`${shortKey(key)} rows posted`);
    stateTick(`${shortKey(key)} state written`);
  }
  for (const key of fieldFixingKeys) states.set(key, stateFor(key, "qualDone"));
  stateTick("qualification done everywhere");
  for (const key of fieldFixingKeys) states.set(key, stateFor(key, "picked"));
  stateTick("alliances picked, no alliance points");
  for (const key of fieldFixingKeys) posted.set(key, "alliance");
  rowsTick("alliance points land");
  for (const key of fieldFixingKeys) states.set(key, stateFor(key, "done"));
  stateTick("playoffs done, no playoff points");
  for (const key of fieldFixingKeys) posted.set(key, "elim");
  rowsTick("playoff points land");
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

interface SyntheticDivisioned {
  /** How many divisions the championship is played in. */
  readonly divisions: number;
  /** How many teams each division holds. */
  readonly divisionSize: number;
  /** How many teams the district has in all: the field first, the rest on no championship row. */
  readonly teamCount: number;
  readonly cmpSlots: number;
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
  const teams = baseline.teams.slice(0, shape.teamCount).map((team, index) => {
    const inField = index < fieldSize;
    const district = inField ? 150 - 8 * index : 20 - (index - fieldSize);
    const base = { ...team, rank: index + 1, rookieBonus: 0, adjustments: 0, remainingEvents: [], qualifyingAwards: [] };
    const districtPoints = { ...districtRow, qual: district, alliance: 0, elim: 0, award: 0, total: district, state: { ...FINISHED_STATE } };
    if (!inField) return { ...base, pointTotal: district, eventPoints: [districtPoints] };
    const division = index % shape.divisions;
    const place = Math.floor(index / shape.divisions);
    const qual = 60 - 6 * place;
    const alliance = place < 3 ? 48 - 8 * place : 0;
    const elim = place < 3 ? 90 : 0;
    const total = qual + alliance + elim;
    return {
      ...base,
      pointTotal: district + total,
      eventPoints: [
        districtPoints,
        { ...dcmpRow, eventKey: `${SYNTHETIC_STEM}${String(division + 1)}`, eventName: `${dcmpRow.eventName} Division ${String(division + 1)}`, qual, alliance, elim, award: 0, total, state: { ...FINISHED_STATE } },
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
    // its field is unproven the championships held back (44, 33 and 22
    // places) exceed its 21 Championship slots, so nobody reads Locked in
    // that window and there is nothing to take back. The walk that does show
    // it is the real 2026 FIM one in the local data group below, and the
    // ceiling itself is held by a unit test
    // (`champLedgerStatus.test.ts`: a team's ceiling cannot rise when its
    // division's rows land).
    expect({ fieldOff, allowanceOff }).toEqual({ fieldOff: [12, 11, 9, 6], allowanceOff: [0, 0, 0, 0] });
  });
});
