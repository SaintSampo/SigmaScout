/**
 * A RUN IN FLIGHT TAKES NO LOCKED BACK (quick task 261012-mw2, the
 * orchestrator's decision 3), held at HOOK LEVEL: the real
 * `useDistrictLedgerData` is rendered, and only the run hook is replaced, by a
 * state this test moves.
 *
 * WHAT WAS WRONG. A Live run's progress carries no entry
 * (`useDistrictSimulationRun.ts` says so on its running state), so from the
 * moment a new run started until it landed the hook's map held nothing for
 * the event: no bracket milestones, and at a championship no bracket facts.
 * The Locked verdicts read both. A team they held read In range for the
 * seconds of every live re run and then Locked again. Jacob's rule
 * (2026-10-08): "it is mission critical that no team is told they are locked
 * at any stop, and then later they are not locked."
 *
 * THE READING. The local 2026orore event file, cut to its first two playoff
 * rounds, read at the LIVE position, so the hook's own Live assembly builds
 * the request. The run lands (the core simulation on the request the hook
 * itself assembled), and the Locked set is read from the District Locks
 * status code on rows built from the hook's own `distributions`. Then a new
 * run is in flight for the same request, and the set is read again.
 * BEFORE the fix: 29 Locked on points with the run landed and 27 with a run
 * in flight, frc1983 and frc8896 taken back, and no entry for the event.
 * AFTER it: 29 and 29, and the entry in flight carries the milestones and
 * the secured playoff minimums the landed entry carries, and no team record.
 *
 * NO TIER ENTRY, NO CREDIT (CONTEXT D7). At the live position the secured
 * minimums are read only for an event the caller names a tier for. The
 * second test hands the hook no tier for the event: the milestones are still
 * laid on per request, nobody is taken back, and nothing is credited.
 *
 * LOCAL DATA GATED. The eight `event-2026*.json` files beside the committed
 * district file are gitignored. Where the one this file reads is absent the
 * group skips with a message, and with `REQUIRE_LOCAL_DATA=1` it FAILS
 * instead, so a gate run can never pass by skipping.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const run = vi.hoisted(() => ({ state: { status: "idle" } as unknown, lastRequest: undefined as unknown }));
vi.mock("./useDistrictSimulationRun.js", () => ({
  useDistrictSimulationRun: (request: unknown) => {
    run.lastRequest = request;
    return run.state;
  },
}));
vi.mock("../ribbon/AlgorithmSelect.js", () => ({ useAlgorithmVersion: () => "flight-test" }));

import { useDistrictLedgerData, type UseDistrictLedgerDataOptions } from "./useDistrictLedgerData.js";
import { buildDistrictLedgerRows, tierEvents, type DistrictEventDistributions, type DistrictStageFinality } from "./districtLedgerRows.js";
import { computeDistrictLedgerStatuses } from "./districtLedgerStatus.js";
import { DistrictArtifactSchema, EventArtifactSchema, type DistrictArtifact, type EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { simulateDistrictEvent } from "../../../../../packages/core/districts/ledgerSimulation.js";
import { bracketRoundOfSet, bracketSetIdFor } from "../../../../../packages/core/districts/bracket.js";
import type { DistrictTier } from "../../../../../packages/core/districts/pointModel.js";

afterEach(() => {
  cleanup();
  run.state = { status: "idle" };
  run.lastRequest = undefined;
});

/** The repo relative path, found by walking up from the working directory (see `champLedgerRows.test.ts`). */
function repoPath(relative: string): string | undefined {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const EVENT_KEY = "2026orore";
const DISTRICT_FILE = "data/fixtures/phase10/district-2026pnw.json";
const EVENT_FILE = `data/fixtures/phase10/event-${EVENT_KEY}.json`;
const MISSING = [DISTRICT_FILE, EVENT_FILE].filter((file) => repoPath(file) === undefined);
const PLAYOFFS_OPEN: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
const ALL_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };
const DRAWS = 200;
const SEED = 20261012;

interface FlightReading {
  readonly landed: readonly string[];
  readonly inFlight: readonly string[];
  readonly lost: readonly string[];
  readonly landedEntry: DistrictEventDistributions | undefined;
  readonly inFlightEntry: DistrictEventDistributions | undefined;
}

/** The hook rendered at the live position over 2026orore after Round 2: the Locked set with the run landed, then with a new run in flight. */
function flightReading(tierByEvent: ReadonlyMap<string, DistrictTier> | undefined): FlightReading {
  // No sidecar is fetched: the district file's baked list is emptied.
  const district: DistrictArtifact = { ...DistrictArtifactSchema.parse(JSON.parse(readFileSync(repoPath(DISTRICT_FILE)!, "utf8"))), bakedEvents: [] };
  const whole = EventArtifactSchema.parse(JSON.parse(readFileSync(repoPath(EVENT_FILE)!, "utf8")));
  const roundOf = (setNumber: number): number => bracketRoundOfSet(bracketSetIdFor("sf", setNumber) ?? "") ?? Infinity;
  const event: EventArtifact = { ...whole, matches: whole.matches.filter((match) => match.compLevel === "qm" || (match.compLevel === "sf" && roundOf(match.setNumber) <= 2)) };
  const stageByEvent = new Map<string, DistrictStageFinality>();
  for (const team of district.teams) {
    for (const entry of tierEvents(team, "district")) if (!stageByEvent.has(entry.eventKey)) stageByEvent.set(entry.eventKey, entry.eventKey === EVENT_KEY ? PLAYOFFS_OPEN : ALL_FINAL);
  }

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
  const options: UseDistrictLedgerDataOptions = {
    artifact: district,
    activeEventKeys: [EVENT_KEY],
    eventArtifacts: new Map([[EVENT_KEY, event]]),
    stageByEvent,
    ...(tierByEvent === undefined ? {} : { tierByEvent }),
  };
  const hook = renderHook(() => useDistrictLedgerData(options), { wrapper });

  // The request the hook's own Live assembly built.
  const request = run.lastRequest as { events: { eventKey: string; input: Parameters<typeof simulateDistrictEvent>[0] }[]; signature: string };
  expect(request.events.map((entry) => entry.eventKey)).toEqual([EVENT_KEY]);

  const lockedNow = (): string[] => {
    const rows = buildDistrictLedgerRows({ artifact: district, distributions: hook.result.current.distributions, stageByEvent, tier: "district" });
    const statuses = computeDistrictLedgerStatuses({ artifact: district, teams: rows.teams });
    return [...statuses.byTeam.values()]
      .filter((result) => result.status === "locked" && !result.byAward)
      .map((result) => result.teamKey)
      .sort();
  };

  // THE RUN LANDS.
  act(() => {
    run.state = {
      status: "complete",
      events: [{ status: "ok", eventKey: EVENT_KEY, result: simulateDistrictEvent(request.events[0]!.input, DRAWS, SEED) }],
      draws: DRAWS,
      signature: request.signature,
    };
    hook.rerender();
  });
  const landed = lockedNow();
  const landedEntry = hook.result.current.distributions.get(EVENT_KEY);

  // A NEW LIVE RUN IS IN FLIGHT for the same request: a Live run's progress carries no entry.
  act(() => {
    run.state = { status: "running", completedEvents: 0, totalEvents: 1 };
    hook.rerender();
  });
  const inFlight = lockedNow();
  const inFlightEntry = hook.result.current.distributions.get(EVENT_KEY);

  const lost = landed.filter((teamKey) => !inFlight.includes(teamKey));
  console.log(
    `[261012-mw2 a run in flight] tier entry ${tierByEvent === undefined ? "none" : "district"} | Locked on points with the run landed ${String(landed.length)} | with a new run in flight ${String(inFlight.length)} | taken back ${JSON.stringify(lost)} | the landed entry: team records ${String(landedEntry?.byTeam.size)}, milestones ${String(landedEntry?.playoffMilestoneByTeam?.size)}, secured ${String(landedEntry?.securedElimByTeam?.size)} | the entry in flight: ${inFlightEntry === undefined ? "none" : `team records ${String(inFlightEntry.byTeam.size)}, milestones ${String(inFlightEntry.playoffMilestoneByTeam?.size)}, secured ${String(inFlightEntry.securedElimByTeam?.size)}`}`
  );
  return { landed, inFlight, lost, landedEntry, inFlightEntry };
}

describe("a run in flight at the hook (quick task 261012-mw2)", () => {
  if (MISSING.length > 0) {
    const what = `the local fixture files are absent: ${MISSING.join(", ")}`;
    if (process.env.REQUIRE_LOCAL_DATA === "1") {
      it(`REQUIRE_LOCAL_DATA=1 and the local data is absent: ${what}`, () => {
        throw new Error(`REQUIRE_LOCAL_DATA=1, but this local data gated group cannot run: ${what}`);
      });
    } else {
      it.skip(`skipped: ${what}`, () => {});
    }
    return;
  }

  it("no team Locked with the run landed is lost with a new run in flight, and the entry in flight carries the milestones and the secured minimums of the landed entry", () => {
    const reading = flightReading(new Map([[EVENT_KEY, "district"]]));

    // THE REQUIREMENT: nobody is taken back between a landed run and the next.
    expect(reading.lost).toEqual([]);
    expect(reading.inFlight).toEqual(reading.landed);
    expect(reading.landed).toHaveLength(29);

    // The landed entry is the run's result: every team record and its own milestones.
    expect(reading.landedEntry!.byTeam.size).toBeGreaterThan(0);
    expect(reading.landedEntry!.playoffMilestoneByTeam!.size).toBe(26);
    // The entry in flight: no team record (it reads as no entry for every cell), the same milestones, and the
    // same secured minimums.
    expect(reading.inFlightEntry).toBeDefined();
    expect(reading.inFlightEntry!.byTeam.size).toBe(0);
    expect([...reading.inFlightEntry!.playoffMilestoneByTeam!].sort()).toEqual([...reading.landedEntry!.playoffMilestoneByTeam!].sort());
    expect(reading.inFlightEntry!.securedElimByTeam!.size).toBe(7);
    expect([...reading.inFlightEntry!.securedElimByTeam!].sort()).toEqual([...reading.landedEntry!.securedElimByTeam!].sort());
    // Every secured minimum is above zero, and after Round 2 of a district event it is the 13 of a sf7 or sf8 win
    // or a robot's rounded up share of it.
    for (const [, points] of reading.inFlightEntry!.securedElimByTeam!) {
      expect(points).toBeGreaterThan(0);
      expect(points).toBeLessThanOrEqual(13);
    }
  }, 120_000);

  it("with no tier entry for the event nothing is credited at the live position, and still nobody is taken back (CONTEXT D7)", () => {
    const reading = flightReading(undefined);
    expect(reading.lost).toEqual([]);
    expect(reading.inFlight).toEqual(reading.landed);
    // The milestones are a fact of the request and need no tier: laid on, run landed or not.
    expect(reading.inFlightEntry).toBeDefined();
    expect(reading.inFlightEntry!.byTeam.size).toBe(0);
    expect(reading.inFlightEntry!.playoffMilestoneByTeam!.size).toBe(26);
    // No tier entry, no credit: not a district tier credit by default.
    expect(reading.landedEntry!.securedElimByTeam).toBeUndefined();
    expect(reading.inFlightEntry!.securedElimByTeam).toBeUndefined();
  }, 120_000);
});
