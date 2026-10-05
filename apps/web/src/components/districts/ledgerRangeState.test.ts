/**
 * The ONE range state both Locks tabs read (quick task 261004-uw4), pinned
 * purely: every arm of `districtRangeState`, the headline inside its own range
 * over the REAL `advancementChances` draws, and the chips and the cutoff view
 * over a real district status model.
 *
 * THE REPRODUCTION is the defect this task closes, in forty teams: the old
 * headline was the midpoint of two MEDIAN projections, the range beside it was
 * the 10th to 90th percentile of the per run line, and the two are different
 * quantities. Every assertion there is an INEQUALITY between values computed
 * in the test, never a recalled number.
 *
 * The champ tab's own suites (`champLedgerChances.test.ts`,
 * `champLedgerStatus.test.ts`, `ChampLocksLedger.test.tsx`) pass unedited over
 * the same functions through their champ names, which is the proof the Champ
 * Locks tab did not move.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { advancementChances } from "../../../../../packages/core/districts/advancementChance.js";
import { mulberry32 } from "../../../../../packages/core/algorithms/simulation/rankSimulation.js";
import { DistrictArtifactSchema, type DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { DEFAULT_SIMULATION_SEED, SIMULATION_DRAWS } from "../../workers/districtSimulationProtocol.js";
import { buildDistrictLedgerRows, type DistrictStageFinality } from "./districtLedgerRows.js";
import { computeDistrictLedgerStatuses, type DistrictLedgerStatusModel, type DistrictLedgerStatusResult } from "./districtLedgerStatus.js";
import type { DistrictLedgerShownModel, DistrictLedgerShownResult } from "./districtFieldOverlay.js";
import {
  applyLedgerRangeState,
  districtRangeState,
  ledgerCutoffView,
  rangeStateFromRun,
  type DistrictRangeStateInputs,
  type LedgerDisplayStatusModel,
  type LedgerRangeLineRunInput,
  type LedgerRangeState,
} from "./ledgerRangeState.js";
import { predictedCutoff, simulatedLine, type CutoffRankingTeam, type LedgerCutoffView } from "./predictedCutoff.js";

function repoFile(relative: string): string {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not find ${relative} above ${process.cwd()}`);
    dir = parent;
  }
}

const FIXTURE: DistrictArtifact = DistrictArtifactSchema.parse(
  JSON.parse(readFileSync(repoFile("data/fixtures/phase10/district-2026pnw.json"), "utf8"))
);

/** What `applyLedgerRangeState` returns for the district tier's own status model. */
type DistrictDisplay = LedgerDisplayStatusModel<DistrictLedgerStatusModel, DistrictLedgerStatusResult>;

const ALL_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };
const ALL_OPEN: DistrictStageFinality = { qual: false, alliance: false, elim: false, award: false };

/** Ten runs with a line at each of 55 to 64: a line every arm below can read. */
const RUNS = Float64Array.from([55, 56, 57, 58, 59, 60, 61, 62, 63, 64]);

/** A chance run that landed for the current inputs, left no team out and kept a line. */
const LANDED: LedgerRangeLineRunInput = { built: true, status: "complete", current: true, excludedTeams: [], cutoffByRun: RUNS, draws: RUNS.length };

/** The open race with everything landed: the one input set that reaches the simulated arm. */
const OPEN_RACE: DistrictRangeStateInputs = { boundaryKind: "predicted", perEventRunSignature: "sig", run: LANDED };

describe("districtRangeState", () => {
  it("is settled wherever the boundary rule did not PREDICT, whatever else is in flight or failed", () => {
    for (const boundaryKind of ["final", "absent", "capacityUnknown"] as const) {
      expect(districtRangeState({ ...OPEN_RACE, boundaryKind })).toEqual({ kind: "settled" });
      // Nothing upstream can turn a settled position into a pending or refused one.
      expect(districtRangeState({ boundaryKind, perEventRunSignature: null, perEventRunFailed: true, run: { built: false, status: "error" } })).toEqual({
        kind: "settled",
      });
      expect(districtRangeState({ boundaryKind, perEventRunSignature: null, run: { built: true, status: "running" } })).toEqual({ kind: "settled" });
    }
  });

  it("walks pending, pending, pending, pending, simulated as the two runs land", () => {
    const walk: DistrictRangeStateInputs[] = [
      // The per event run is still in flight.
      { ...OPEN_RACE, perEventRunSignature: null },
      // The chance run is built and its effect has not started it.
      { ...OPEN_RACE, run: { built: true, status: "idle" } },
      { ...OPEN_RACE, run: { built: true, status: "running" } },
      // A result for a STALE signature is still pending.
      { ...OPEN_RACE, run: { ...LANDED, current: false } },
      OPEN_RACE,
    ];
    expect(walk.map((inputs) => districtRangeState(inputs).kind)).toEqual(["pending", "pending", "pending", "pending", "simulated"]);
  });

  it("D-01: prints the line estimator's own median and range, from ONE call, the figure inside its range", () => {
    const state = districtRangeState(OPEN_RACE);
    const line = simulatedLine(RUNS, RUNS.length)!;
    expect(state).toEqual({ kind: "simulated", points: line.points, likely: line.likely });
    if (state.kind !== "simulated") return;
    expect(Math.round(state.likely.p10)).toBeLessThanOrEqual(state.points);
    expect(state.points).toBeLessThanOrEqual(Math.round(state.likely.p90));
  });

  it("D-03: a failed per event run, a failed chance run, a run that could not be built and a run with no line are each a NAMED refusal", () => {
    // The per event run failed: terminal even while its signature is null.
    expect(districtRangeState({ ...OPEN_RACE, perEventRunSignature: null, perEventRunFailed: true })).toEqual({ kind: "noCall", reason: "workerError" });
    expect(districtRangeState({ ...OPEN_RACE, run: { built: true, status: "error" } })).toEqual({ kind: "noCall", reason: "workerError" });
    // With a predicted boundary and a landed per event run, the builder can
    // refuse only through its exclusion bounds.
    expect(districtRangeState({ ...OPEN_RACE, run: { built: false, status: "idle" } })).toEqual({ kind: "noCall", reason: "teamsExcluded" });
    expect(districtRangeState({ ...OPEN_RACE, run: { built: true, status: "complete", current: true, excludedTeams: [], draws: 10 } })).toEqual({
      kind: "noCall",
      reason: "noLine",
    });
  });

  it("THE EXCLUDED TEAM FALLBACK: a run that landed but left a team out leaves the tab's shipped boundary rule standing", () => {
    // The simulated line there is taken over a smaller field, so it is not the
    // district's line; and silencing every team's chance for one unpriceable
    // team is the regression quick task 260925-uf8 closed. `settled` is the
    // arm that changes no chip and prints the boundary view.
    const excluded = { ...OPEN_RACE, run: { ...LANDED, excludedTeams: ["frc901"] } };
    expect(districtRangeState(excluded)).toEqual({ kind: "settled" });
    // While that same run is still in flight nothing is printed yet.
    expect(districtRangeState({ ...OPEN_RACE, run: { built: true, status: "running", excludedTeams: ["frc901"] } })).toEqual({ kind: "pending" });
    expect(districtRangeState({ ...OPEN_RACE, run: { ...LANDED, excludedTeams: ["frc901"], current: false } })).toEqual({ kind: "pending" });
    // A failure still wins over the fallback.
    expect(districtRangeState({ ...OPEN_RACE, run: { built: true, status: "error", excludedTeams: ["frc901"] } })).toEqual({
      kind: "noCall",
      reason: "workerError",
    });
    // The shared reading the champ tab keeps is the refusal, unchanged.
    expect(rangeStateFromRun({ ...LANDED, excludedTeams: ["frc901"] })).toEqual({ kind: "noCall", reason: "teamsExcluded" });
  });
});

describe("THE REPRODUCTION: forty teams, ten slots, every total uniform over 40 through 80", () => {
  const counts = Array.from({ length: 81 }, (_unused, points) => (points >= 40 ? 1 : 0));
  const teamKeys = Array.from({ length: 40 }, (_unused, i) => `frc${String(100 + i)}`);
  const result = advancementChances(
    { teams: teamKeys.map((teamKey) => ({ teamKey, counts, denominator: 41 })), slots: 10, awardQualified: [], prequalified: [], reservedSlots: 0 },
    SIMULATION_DRAWS,
    DEFAULT_SIMULATION_SEED
  );
  const ranking: CutoffRankingTeam[] = teamKeys.map((teamKey) => ({ teamKey, projection: 60, hasOpenCategory: true }));
  const boundary = predictedCutoff({ teams: ranking, capacity: 10, qualifiers: { awardQualified: new Set(), prequalified: new Set() }, reservedSlots: 0 });
  const state = districtRangeState({
    boundaryKind: boundary.kind,
    perEventRunSignature: "",
    run: { built: true, status: "complete", current: true, excludedTeams: [], ...(result.cutoffByRun === undefined ? {} : { cutoffByRun: result.cutoffByRun }), draws: result.draws },
  });

  it("the OLD headline, the midpoint of the medians, sat BELOW its own printed range", () => {
    expect(boundary.kind).toBe("predicted");
    expect(state.kind).toBe("simulated");
    if (boundary.kind !== "predicted" || state.kind !== "simulated") return;
    expect(boundary.points).toBeLessThan(Math.round(state.likely.p10));
  });

  it("the NEW headline sits inside the range printed beside it", () => {
    expect(state.kind).toBe("simulated");
    if (state.kind !== "simulated") return;
    expect(Math.round(state.likely.p10)).toBeLessThanOrEqual(state.points);
    expect(state.points).toBeLessThanOrEqual(Math.round(state.likely.p90));
  });
});

/**
 * A DISTRICT status model with a race still open: the real 2026 PNW fixture
 * with its latest week of district events reopened, through the real row
 * builder and the real status module.
 */
describe("applyLedgerRangeState and ledgerCutoffView on a district status model", () => {
  const districtEvents = new Map<string, number>();
  const allEventKeys = new Set<string>();
  for (const team of FIXTURE.teams) {
    for (const row of team.eventPoints) {
      allEventKeys.add(row.eventKey);
      if (row.tier === "district") districtEvents.set(row.eventKey, row.week ?? 0);
    }
    for (const row of team.remainingEvents) allEventKeys.add(row.eventKey);
  }
  const lastWeek = Math.max(...districtEvents.values());
  const stageByEvent = new Map(
    [...allEventKeys].map((eventKey) => [eventKey, districtEvents.get(eventKey) === lastWeek ? ALL_OPEN : ALL_FINAL] as const)
  );
  const rows = buildDistrictLedgerRows({ artifact: FIXTURE, distributions: new Map(), stageByEvent });
  const STATUS = computeDistrictLedgerStatuses({ artifact: FIXTURE, teams: rows.teams });
  const contendingKeys = [...STATUS.byTeam.values()]
    .filter((result) => result.status === "inRange" || result.status === "outOfRange")
    .map((result) => result.teamKey);
  const contending = new Set(contendingKeys);
  const projectionOf = new Map(rows.teams.map((team) => [team.teamKey, team.projection] as const));
  const LIKELY = { p10: 40, p90: 70 };

  const settledView = (): LedgerCutoffView => ({
    cutoff: predictedCutoff({
      teams: rows.teams,
      capacity: FIXTURE.dcmpSlots,
      qualifiers: { awardQualified: new Set(STATUS.awardQualified), prequalified: new Set(STATUS.prequalified) },
      reservedSlots: STATUS.reservedSlots,
    }),
    likely: undefined,
    districtOnly: false,
  });
  const viewFor = (state: LedgerRangeState, display: DistrictDisplay) =>
    ledgerCutoffView({
      state,
      teams: rows.teams,
      displayStatus: (teamKey) => display.byTeam.get(teamKey)?.status,
      settledView,
      showLikelyRange: true,
      tier: "district",
    });

  /** D-04: every non contending team's result VERBATIM, and every model level field untouched. */
  function expectVerdictsUntouched(display: DistrictDisplay): void {
    for (const [teamKey, result] of STATUS.byTeam) {
      if (contending.has(teamKey)) continue;
      expect(display.byTeam.get(teamKey)).toBe(result);
    }
    expect(display.verdictCensus).toEqual(STATUS.verdictCensus);
    expect(display.projectionCutLine).toBe(STATUS.projectionCutLine);
    expect(display.awardQualified).toEqual(STATUS.awardQualified);
    expect(display.prequalified).toEqual(STATUS.prequalified);
    expect(display.reservedSlots).toBe(STATUS.reservedSlots);
    expect(display.pooledRemainingPoints).toBe(STATUS.pooledRemainingPoints);
    for (const key of ["prequalified", "locked", "lockedOut"] as const) expect(display.counts[key]).toBe(STATUS.counts[key]);
  }

  it("has contending teams to call, so the tests below are not vacuous", () => {
    expect(contendingKeys.length).toBeGreaterThan(5);
  });

  it("settled: every result is the same object, the counts are equal and the view is the supplied one", () => {
    const display = applyLedgerRangeState(STATUS, rows.teams, { kind: "settled" });
    for (const [teamKey, result] of STATUS.byTeam) expect(display.byTeam.get(teamKey)).toBe(result);
    expect(display.counts).toEqual(STATUS.counts);
    expect(display.withheld).toBeUndefined();
    expect(display.noCallReason).toBeUndefined();
    const view = viewFor({ kind: "settled" }, display);
    expect(view.cutoff).toEqual(settledView().cutoff);
    expect(view.likely).toBeUndefined();
    expect(view.tier).toBe("district");
  });

  it("pending: every contending call is withheld, no verdict moves, and the view has no figure", () => {
    const display = applyLedgerRangeState(STATUS, rows.teams, { kind: "pending" });
    expectVerdictsUntouched(display);
    for (const teamKey of contendingKeys) {
      expect(display.byTeam.get(teamKey)!.rangeCall).toBe("pending");
      expect(display.byTeam.get(teamKey)!.status).toBe("capacityUnknown");
    }
    expect(display.withheld).toBe("pending");
    expect(display.counts.inRange).toBe(0);
    expect(display.counts.outOfRange).toBe(0);
    const view = viewFor({ kind: "pending" }, display);
    expect(view.cutoff).toEqual({ kind: "pending" });
    expect(view.likely).toBeUndefined();
  });

  it("noCall: the same withholding, with the reason carried to the chip and the view", () => {
    const state: LedgerRangeState = { kind: "noCall", reason: "workerError" };
    const display = applyLedgerRangeState(STATUS, rows.teams, state);
    expectVerdictsUntouched(display);
    for (const teamKey of contendingKeys) {
      expect(display.byTeam.get(teamKey)!.rangeCall).toBe("noCall");
      expect(display.byTeam.get(teamKey)!.status).toBe("capacityUnknown");
    }
    expect(display.withheld).toBe("noCall");
    expect(display.noCallReason).toBe("workerError");
    expect(display.counts.inRange).toBe(0);
    expect(display.counts.outOfRange).toBe(0);
    const view = viewFor(state, display);
    expect(view.cutoff).toEqual({ kind: "unavailable", reason: "workerError" });
    expect(view.likely).toBeUndefined();
  });

  it("D-02, swept: at every line each In range median is at or above it, each Out of range median is below it, and the view brackets it", () => {
    const projections = contendingKeys.map((teamKey) => projectionOf.get(teamKey)!);
    const low = Math.min(...projections) - 5;
    const high = Math.max(...projections) + 5;
    const random = mulberry32(261004);
    for (let step = 0; step < 200; step++) {
      const points = Math.round(low + random() * (high - low));
      const state: LedgerRangeState = { kind: "simulated", points, likely: LIKELY };
      const display = applyLedgerRangeState(STATUS, rows.teams, state);
      expectVerdictsUntouched(display);
      expect(display.withheld).toBeUndefined();
      for (const teamKey of contendingKeys) {
        const result = display.byTeam.get(teamKey)!;
        const projection = projectionOf.get(teamKey)!;
        expect(result.rangeCall).toBeUndefined();
        if (result.status === "inRange") expect(projection).toBeGreaterThanOrEqual(points);
        else {
          expect(result.status).toBe("outOfRange");
          expect(projection).toBeLessThan(points);
        }
      }
      expect(display.counts.inRange + display.counts.outOfRange).toBe(contendingKeys.length);

      const view = viewFor(state, display);
      expect(view.tier).toBe("district");
      expect(view.likely).toEqual(LIKELY);
      expect(view.cutoff.kind).toBe("predicted");
      if (view.cutoff.kind !== "predicted") return;
      expect(view.cutoff.source).toBe("simulated");
      expect(view.cutoff.points).toBe(points);
      expect(view.cutoff.boundary.above).toBeGreaterThanOrEqual(points);
      expect(view.cutoff.boundary.below).toBeLessThanOrEqual(points);
    }
  });

  it("omits the tier entirely when none is supplied, and the range when the caller withholds it", () => {
    const state: LedgerRangeState = { kind: "simulated", points: 50, likely: LIKELY };
    const display = applyLedgerRangeState(STATUS, rows.teams, state);
    const view = ledgerCutoffView({
      state,
      teams: rows.teams,
      displayStatus: (teamKey) => display.byTeam.get(teamKey)?.status,
      settledView,
      showLikelyRange: false,
    });
    expect("tier" in view).toBe(false);
    expect(view.likely).toBeUndefined();
  });
});

/**
 * P1 (quick task 261005-04t, D-06). The Live field overlay's SHOWN model is
 * what the District tab hands this function, so a Declined result, the sixth
 * count and the `fieldOverlay` flag all have to come out the far side of every
 * arm. The model is built by hand over the same open race as above, so the
 * simulated, pending and refused arms still have contending teams to work on
 * while the Declined team sits beside them.
 */
describe("P1: a Declined result passes through every arm of the range state (261005-04t)", () => {
  const districtEvents = new Map<string, number>();
  for (const team of FIXTURE.teams) {
    for (const row of team.eventPoints) if (row.tier === "district") districtEvents.set(row.eventKey, row.week ?? 0);
  }
  const lastWeek = Math.max(...districtEvents.values());
  const stageByEvent = new Map([...districtEvents].map(([eventKey, week]) => [eventKey, week === lastWeek ? ALL_OPEN : ALL_FINAL] as const));
  const rows = buildDistrictLedgerRows({ artifact: FIXTURE, distributions: new Map(), stageByEvent });
  const RAW = computeDistrictLedgerStatuses({ artifact: FIXTURE, teams: rows.teams });
  const declinedKey = [...RAW.byTeam.values()].find((result) => result.status === "locked")!.teamKey;
  const declined: DistrictLedgerShownResult = { ...RAW.byTeam.get(declinedKey)!, status: "declined", byAward: false };
  const SHOWN: DistrictLedgerShownModel = {
    ...RAW,
    byTeam: new Map<string, DistrictLedgerShownResult>([...RAW.byTeam].map(([teamKey, result]) => [teamKey, teamKey === declinedKey ? declined : result])),
    counts: { ...RAW.counts, locked: RAW.counts.locked - 1, declined: 1 },
    fieldOverlay: true,
  };
  const ARMS: readonly LedgerRangeState[] = [
    { kind: "settled" },
    { kind: "simulated", points: 50, likely: { p10: 40, p90: 70 } },
    { kind: "pending" },
    { kind: "noCall", reason: "workerError" },
  ];

  it("has contending teams beside the Declined one, so the three working arms are not vacuous", () => {
    expect([...SHOWN.byTeam.values()].filter((result) => result.status === "inRange" || result.status === "outOfRange").length).toBeGreaterThan(5);
  });

  it("keeps the Declined result as the same object, counts.declined at 1 and fieldOverlay, in all four arms", () => {
    for (const state of ARMS) {
      const display = applyLedgerRangeState(SHOWN, rows.teams, state);
      expect({ arm: state.kind, same: display.byTeam.get(declinedKey) === declined }).toEqual({ arm: state.kind, same: true });
      expect(display.byTeam.get(declinedKey)?.status).toBe("declined");
      expect(display.counts.declined).toBe(1);
      expect(display.counts.locked).toBe(RAW.counts.locked - 1);
      expect(display.fieldOverlay).toBe(true);
    }
  });
});
