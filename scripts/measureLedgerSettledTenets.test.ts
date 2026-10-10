/**
 * Tests for the District Locks settled playoffs sweep (quick task 261009-txb,
 * CONTEXT D2).
 *
 * Three groups need no local data: the stop builder on an invented timeline
 * and bracket, the skip reasons, and the no take back helper (tenet D).
 *
 * Two groups are gated on BOTH gitignored local sources, the 2026pnw district
 * artifact (`data/local-publish/districts/v1__district__2026pnw.json`) and
 * `data/corpus.sqlite`: they skip with a message when either is absent, never
 * a silent pass. The committed fixture (`data/fixtures/phase10`) carries no
 * state blocks, so no rewound stop of it shows a Locked display to pin.
 *
 * THE PIN is 2026waahs at Round 3: no tied row, and the 12 rows the settled
 * rule settles there all pay 0, so the pinned sets do not move when the pooled
 * pool learns to net out settled playoff points (quick task 261009-uhb) or
 * when tied playoff sets route (quick task 261009-tx8). The values are the
 * planner's prototype of the tab's own functions at 9e979118. If the
 * implementation ever differs, check the inputs first (one position index for
 * every round stop, played keys by round, the one event distributions map)
 * and never change a rule to meet a pin.
 *
 * NOT HERE YET: a test that calls `main` on the real data. The four season run
 * exits 1 until quick task 261009-uhb lands; this plan's Task 2 adds that test.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "../packages/harness/pageArtifacts.js";
import type { LockStatus } from "../packages/core/districts/locks.js";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import type { BracketSourceEvent } from "../apps/web/src/components/districts/districtLedgerRows.js";
import { buildDistrictTimeline } from "../apps/web/src/components/districts/districtTimeline.js";
import { bracketFromCorpus, CORPUS_PATH } from "./measureChampJointLocks.js";
import { districtTierFinalVerdicts } from "./measureLedgerTenets.js";
import {
  bracketSkipReason,
  settledDistrictContext,
  settledStops,
  statusesAtSettledStop,
  sweepSettledEvent,
  takeBackRows,
} from "./measureLedgerSettledTenets.js";

const PNW_PATH = "data/local-publish/districts/v1__district__2026pnw.json";
const PIN_EVENT = "2026waahs";

type BracketRow = BracketSourceEvent["matches"][number];

/** Eight invented alliances, or fewer: alliance n holds frc{n}01, frc{n}02 and frc{n}03. */
function inventedAlliances(count = 8): { allianceNumber: number; picks: string[] }[] {
  return Array.from({ length: count }, (_, i) => ({
    allianceNumber: i + 1,
    picks: [1, 2, 3].map((slot) => `frc${String(i + 1)}0${String(slot)}`),
  }));
}

/** One invented playoff row: red alliance against blue alliance, red winning unless told otherwise. */
function inventedRow(eventKey: string, compLevel: "sf" | "f", setNumber: number, red: number, blue: number, actualWinner: BracketRow["actualWinner"] = "red"): BracketRow {
  const side = (allianceNumber: number): string[] => [1, 2, 3].map((slot) => `frc${String(allianceNumber)}0${String(slot)}`);
  return {
    matchKey: `${eventKey}_${compLevel}${String(setNumber)}m1`,
    compLevel,
    setNumber,
    matchNumber: 1,
    redTeams: side(red),
    blueTeams: side(blue),
    ...(actualWinner === undefined ? {} : { actualWinner }),
  };
}

/** One invented playoff row that has not been played: no winner. */
function unplayedRow(eventKey: string, setNumber: number, red: number, blue: number): BracketRow {
  const { actualWinner: _dropped, ...rest } = inventedRow(eventKey, "sf", setNumber, red, blue);
  return rest;
}

/** Rounds 1 to 3 of a well formed bracket, the better seed winning every set: [set, red (the winner), blue]. */
const ROUNDS_ONE_TO_THREE: readonly (readonly [number, number, number])[] = [
  [1, 1, 8],
  [2, 4, 5],
  [3, 2, 7],
  [4, 3, 6],
  [5, 5, 8],
  [6, 6, 7],
  [7, 1, 4],
  [8, 2, 3],
  [9, 4, 6],
  [10, 3, 5],
];

describe("measureLedgerSettledTenets: the stop builder (synthetic)", () => {
  const FIRST = "2026aaaa";
  const SECOND = "2026bbbb";
  const timeline = buildDistrictTimeline({
    events: [
      { eventKey: FIRST, eventName: "First invented event", week: 0 },
      { eventKey: SECOND, eventName: "Second invented event", week: 1 },
    ],
    eventArtifacts: new Map(),
  });
  const bracket: BracketSourceEvent = {
    alliances: inventedAlliances(),
    matches: [
      ...ROUNDS_ONE_TO_THREE.map(([setNumber, red, blue]) => inventedRow(SECOND, "sf", setNumber, red, blue)),
      inventedRow(SECOND, "f", 1, 1, 2),
    ],
  };
  const stops = settledStops(timeline, SECOND, bracket);
  const indexOfStep = (kind: string): number => timeline.positions.findIndex((position) => position.step?.kind === kind && position.step.eventKey === SECOND);

  it("names a stop per played round, in order, and none for a round with no played row", () => {
    expect(stops.map((stop) => stop.label)).toEqual(["Alliances final", "Round 1", "Round 2", "Round 3", "Playoffs final, awards open"]);
  });

  it("puts every round stop at the event's Alliance selection position and the last stop at its Playoffs position", () => {
    const allianceIndex = indexOfStep("alliance");
    const playoffsIndex = indexOfStep("playoffs");
    expect(allianceIndex).toBeGreaterThan(0);
    expect(playoffsIndex).toBeGreaterThan(allianceIndex);
    expect(stops.map((stop) => stop.index)).toEqual([allianceIndex, allianceIndex, allianceIndex, allianceIndex, playoffsIndex]);
  });

  it("gives each stop the played rows of the rounds up to it, and the final row to the last stop alone", () => {
    expect(stops.map((stop) => stop.playedKeys.size)).toEqual([0, 4, 8, 10, 11]);
    const finalKey = `${SECOND}_f1m1`;
    expect(stops.slice(0, 4).some((stop) => stop.playedKeys.has(finalKey))).toBe(false);
    expect(stops[4]!.playedKeys.has(finalKey)).toBe(true);
    expect([...stops[1]!.playedKeys].sort()).toEqual([1, 2, 3, 4].map((setNumber) => `${SECOND}_sf${String(setNumber)}m1`).sort());
  });

  it("skips a row that carries no winner", () => {
    const unplayed: BracketSourceEvent = {
      alliances: inventedAlliances(),
      matches: [
        ...ROUNDS_ONE_TO_THREE.slice(0, 4).map(([setNumber, red, blue]) => inventedRow(SECOND, "sf", setNumber, red, blue)),
        unplayedRow(SECOND, 5, 5, 8),
      ],
    };
    const built = settledStops(timeline, SECOND, unplayed);
    expect(built.map((stop) => stop.label)).toEqual(["Alliances final", "Round 1", "Playoffs final, awards open"]);
    expect(built.map((stop) => stop.playedKeys.size)).toEqual([0, 4, 4]);
  });

  it("returns no stop for an event the timeline does not carry", () => {
    expect(settledStops(timeline, "2026zzzz", bracket)).toEqual([]);
  });
});

describe("measureLedgerSettledTenets: the skip reasons (synthetic)", () => {
  const EVENT = "2026bbbb";
  const roundOne = ROUNDS_ONE_TO_THREE.slice(0, 4).map(([setNumber, red, blue]) => inventedRow(EVENT, "sf", setNumber, red, blue));

  it("no bracket at all: no alliances in the corpus", () => {
    expect(bracketSkipReason(undefined)).toBe("no alliances in the corpus");
  });

  it("seven alliances: not an eight alliance bracket", () => {
    expect(bracketSkipReason({ alliances: inventedAlliances(7), matches: roundOne })).toMatch(/^not an eight alliance bracket/);
  });

  it("eight alliances and no played sf or f row: no played playoff rows in the corpus", () => {
    expect(bracketSkipReason({ alliances: inventedAlliances(), matches: [] })).toBe("no played playoff rows in the corpus");
    expect(bracketSkipReason({ alliances: inventedAlliances(), matches: [unplayedRow(EVENT, 1, 1, 8)] })).toBe("no played playoff rows in the corpus");
  });

  it("an sf1 row won by alliance 3: bracket does not route", () => {
    // sf1 is alliance 1 against alliance 8, so a row whose winning side is alliance 3 is mis mapped.
    expect(bracketSkipReason({ alliances: inventedAlliances(), matches: [inventedRow(EVENT, "sf", 1, 3, 8)] })).toMatch(/^bracket does not route/);
  });

  it("a well formed Round 1 is sweepable", () => {
    expect(bracketSkipReason({ alliances: inventedAlliances(), matches: roundOne })).toBeUndefined();
  });
});

describe("measureLedgerSettledTenets: no take back, tenet D (synthetic)", () => {
  it("gives one row per team and later stop at which an earlier lock is not shown", () => {
    const rows = takeBackRows([
      { label: "first", locked: new Set(["a"]) },
      { label: "second", locked: new Set(["a", "b"]) },
      { label: "third", locked: new Set(["b"]) },
      { label: "fourth", locked: new Set(["a", "b"]) },
      { label: "fifth", locked: new Set<string>() },
    ]);
    expect(rows).toEqual([
      { teamKey: "a", stop: "third", firstLockedStop: "first" },
      { teamKey: "a", stop: "fifth", firstLockedStop: "first" },
      { teamKey: "b", stop: "fifth", firstLockedStop: "second" },
    ]);
  });

  it("gives no row for a team Locked at every stop or at none", () => {
    const rows = takeBackRows([
      { label: "first", locked: new Set(["always"]) },
      { label: "second", locked: new Set(["always"]) },
      { label: "third", locked: new Set(["always"]) },
    ]);
    expect(rows).toEqual([]);
    expect(takeBackRows([])).toEqual([]);
  });

  it("gives no row for a team first Locked at the last stop", () => {
    expect(
      takeBackRows([
        { label: "first", locked: new Set<string>() },
        { label: "second", locked: new Set(["late"]) },
      ])
    ).toEqual([]);
  });
});

const PNW_AVAILABLE = existsSync(PNW_PATH);
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);
const GATE_MESSAGE = `skipped: ${[PNW_AVAILABLE ? undefined : PNW_PATH, CORPUS_AVAILABLE ? undefined : CORPUS_PATH].filter((path) => path !== undefined).join(" and ")} absent (gitignored local data)`;

/** The local 2026pnw artifact and 2026waahs's bracket from the corpus. Call only behind the gate. */
function loadPin(): { artifact: DistrictArtifact; bracket: BracketSourceEvent } {
  const artifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(PNW_PATH, "utf8")));
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const bracket = bracketFromCorpus(db, new Map(), artifact.year, PIN_EVENT);
    if (bracket === undefined) throw new Error(`the corpus carries no alliances for ${PIN_EVENT}`);
    return { artifact, bracket };
  } finally {
    db.close();
  }
}

describe("measureLedgerSettledTenets: the 2026waahs pin (D2)", () => {
  if (!PNW_AVAILABLE || !CORPUS_AVAILABLE) {
    it.skip(GATE_MESSAGE, () => {});
    return;
  }
  const { artifact, bracket } = loadPin();
  const context = settledDistrictContext(artifact);
  const stops = settledStops(context.timeline, PIN_EVENT, bracket);
  const stopNamed = (label: string) => {
    const stop = stops.find((entry) => entry.label === label);
    if (stop === undefined) throw new Error(`no ${label} stop`);
    return stop;
  };
  const sweep = sweepSettledEvent(artifact, context, PIN_EVENT, bracket, districtTierFinalVerdicts(artifact));
  const recordNamed = (label: string) => {
    const record = sweep.stops.find((entry) => entry.label === label);
    if (record === undefined) throw new Error(`no ${label} record`);
    return record;
  };

  it("is sweepable and builds the seven stops of D1", () => {
    expect(bracketSkipReason(bracket)).toBeUndefined();
    expect(context.eventKeys).toContain(PIN_EVENT);
    expect(stops.map((stop) => stop.label)).toEqual([
      "Alliances final",
      "Round 1",
      "Round 2",
      "Round 3",
      "Round 4",
      "Round 5",
      "Playoffs final, awards open",
    ]);
    expect(sweep.stops.map((record) => record.label)).toEqual(stops.map((stop) => stop.label));
  });

  it("Round 3: Locked on points 29 blunt and 31 settled, gaining exactly frc1983 and frc2926 and losing nobody", () => {
    const record = recordNamed("Round 3");
    expect(record.blunt.lockedOnPoints).toBe(29);
    expect(record.settled.lockedOnPoints).toBe(31);
    expect(record.gained).toEqual(["frc1983", "frc2926"]);
    expect(record.lost).toEqual([]);
  });

  it("Round 3: Locked out 51 blunt and 56 settled, gaining exactly five teams and losing nobody", () => {
    const record = recordNamed("Round 3");
    expect(record.blunt.lockedOut).toBe(51);
    expect(record.settled.lockedOut).toBe(56);
    expect(record.lockedOutGained).toEqual(["frc2906", "frc2929", "frc4173", "frc4682", "frc949"]);
    expect(record.lockedOutLost).toEqual([]);
  });

  it("Round 3: the settled run settles 12 rows, all exact, summing 0 points, and the blunt run none", () => {
    const record = recordNamed("Round 3");
    expect(record.settledRows).toBe(12);
    expect(record.settledExact).toBe(12);
    expect(record.settledPoints).toBe(0);
    const blunt = statusesAtSettledStop(artifact, context, PIN_EVENT, stopNamed("Round 3"), bracket, false);
    expect(blunt.teams.flatMap((team) => team.rows).filter((row) => row.settledElim !== undefined)).toEqual([]);
    const settled = statusesAtSettledStop(artifact, context, PIN_EVENT, stopNamed("Round 3"), bracket, true);
    const settledRows = settled.teams.flatMap((team) => team.rows).filter((row) => row.settledElim !== undefined);
    expect(settledRows).toHaveLength(12);
    expect(new Set(settledRows.map((row) => row.eventKey))).toEqual(new Set([PIN_EVENT]));
  });

  it("Alliances final (29 and 51) and Playoffs final, awards open (37 and 71): the two runs are identical", () => {
    for (const [label, lockedOnPoints, lockedOut] of [
      ["Alliances final", 29, 51],
      ["Playoffs final, awards open", 37, 71],
    ] as const) {
      const record = recordNamed(label);
      expect(record.blunt.lockedOnPoints, label).toBe(lockedOnPoints);
      expect(record.settled.lockedOnPoints, label).toBe(lockedOnPoints);
      expect(record.blunt.lockedOut, label).toBe(lockedOut);
      expect(record.settled.lockedOut, label).toBe(lockedOut);
      expect(record.gained, label).toEqual([]);
      expect(record.lost, label).toEqual([]);
      expect(record.lockedOutGained, label).toEqual([]);
      expect(record.lockedOutLost, label).toEqual([]);
      expect(record.settledRows, label).toBe(0);
      const blunt = statusesAtSettledStop(artifact, context, PIN_EVENT, stopNamed(label), bracket, false);
      const settled = statusesAtSettledStop(artifact, context, PIN_EVENT, stopNamed(label), bracket, true);
      expect([...settled.statuses.byTeam], label).toEqual([...blunt.statuses.byTeam]);
    }
  });

  it("holds every tenet at 2026waahs against the district tier final standing, and the blunt rule takes nothing back", () => {
    expect(sweep.violations).toEqual([]);
    expect(sweep.takeBackBlunt).toBe(0);
  });
});

describe("measureLedgerSettledTenets: the checker can fail (D2)", () => {
  if (!PNW_AVAILABLE || !CORPUS_AVAILABLE) {
    it.skip(GATE_MESSAGE, () => {});
    return;
  }
  const { artifact, bracket } = loadPin();
  const context = settledDistrictContext(artifact);

  it("a yardstick that reads frc1983 eliminated turns its Locked displays into tenet A violations, at Round 3 in the settled run alone", () => {
    const corrupted = new Map<string, LockStatus>(districtTierFinalVerdicts(artifact));
    expect(corrupted.get("frc1983")).toBe("locked");
    corrupted.set("frc1983", "eliminated");
    const sweep = sweepSettledEvent(artifact, context, PIN_EVENT, bracket, corrupted);
    expect(sweep.violations.length).toBeGreaterThan(0);
    for (const violation of sweep.violations) {
      expect(violation.tenet).toBe("A");
      expect(violation.teamKey).toBe("frc1983");
      expect(violation.finalStatus).toBe("eliminated");
      expect(violation.eventKey).toBe(PIN_EVENT);
      expect(violation.districtKey).toBe(artifact.districtKey);
    }
    const atRoundThree = sweep.violations.filter((violation) => violation.stop === "Round 3");
    expect(atRoundThree.filter((violation) => violation.run === "settled")).toHaveLength(1);
    expect(atRoundThree.filter((violation) => violation.run === "blunt")).toHaveLength(0);
  });
});
