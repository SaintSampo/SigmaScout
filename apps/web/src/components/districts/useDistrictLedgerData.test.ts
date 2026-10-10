/**
 * `districtRunSignature`'s unit tests.
 *
 * WHY THIS FILE EXISTS AT ALL. The signature is what
 * `useDistrictSimulationRun` keys its effect on, so it is the single thing
 * deciding whether a live district's distributions refresh or go stale. The
 * staleness it used to permit is invisible to a render test — nothing throws,
 * nothing blanks, the old numbers simply keep printing — so it is pinned here
 * by direct assertion on the string instead.
 *
 * Every case below is the shape of a real 60 second refetch during a live
 * event: an award posted, an alliance roster corrected, a score correction
 * that leaves the row count alone, the alliance count moving.
 */
import { describe, expect, it } from "vitest";
import { champLiveFetchKeys, districtRunSignature, divisionedDcmpBracketFacts } from "./useDistrictLedgerData.js";
import { assembleAsOfDistrictEvents, assembleLiveDistrictEvents } from "./districtRunAssembly.js";
import type { AsOfRewindResult } from "./asOfRewind.js";
import type { DistrictStageFinality } from "./districtLedgerRows.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildDistrictEventSimulationInput } from "./districtLedgerRows.js";
import type { DistrictSimulationEventRequest } from "../../workers/districtSimulationProtocol.js";
import type { AllianceMemberRating } from "../../../../../packages/core/algorithms/simulation/allianceWinProbability.js";
import type {
  DistrictAwardProfile,
  DistrictLedgerEventInput,
} from "../../../../../packages/core/districts/ledgerSimulation.js";
import {
  DistrictArtifactSchema,
  EventArtifactSchema,
  type DistrictArtifact,
  type EventArtifact,
} from "../../../../../packages/harness/pageArtifacts.js";

function baselines(): DistrictLedgerEventInput["baselines"] {
  return [
    { teamKey: "frc1", earnedRpSum: 12, matchesPlayed: 4 },
    { teamKey: "frc2", earnedRpSum: 9, matchesPlayed: 4 },
  ];
}

function requestFor(overrides: Partial<DistrictLedgerEventInput> = {}): readonly DistrictSimulationEventRequest[] {
  const input: DistrictLedgerEventInput = {
    eventKey: "2026wabon",
    season: 2026,
    tier: "district",
    fieldSize: 2,
    allianceCount: 8,
    remainingMatches: [],
    baselines: baselines(),
    ratings: new Map<string, AllianceMemberRating>(),
    awardProfiles: new Map<string, DistrictAwardProfile>(),
    ...overrides,
  };
  return [{ eventKey: input.eventKey, input }];
}

describe("districtRunSignature", () => {
  it("is stable: the same values produce the same string", () => {
    expect(districtRunSignature(requestFor())).toBe(districtRunSignature(requestFor()));
  });

  it("MOVES when a known award VALUE changes, not merely when the map appears", () => {
    const before = districtRunSignature(requestFor({ knownAwardPoints: new Map([["frc1", 5]]) }));
    const after = districtRunSignature(requestFor({ knownAwardPoints: new Map([["frc1", 10]]) }));
    expect(after).not.toBe(before);
  });

  it("MOVES when a known elim VALUE changes", () => {
    const before = districtRunSignature(requestFor({ knownElimPoints: new Map([["frc1", 0]]) }));
    const after = districtRunSignature(requestFor({ knownElimPoints: new Map([["frc1", 30]]) }));
    expect(after).not.toBe(before);
  });

  it("MOVES when a team is added to a known map that was already present", () => {
    const before = districtRunSignature(requestFor({ knownAwardPoints: new Map([["frc1", 5]]) }));
    const after = districtRunSignature(
      requestFor({
        knownAwardPoints: new Map([
          ["frc1", 5],
          ["frc2", 5],
        ]),
      })
    );
    expect(after).not.toBe(before);
  });

  it("MOVES when an alliance ROSTER changes with the alliance count unchanged", () => {
    const before = districtRunSignature(requestFor({ knownAlliances: [{ allianceNumber: 1, picks: ["frc1", "frc2"] }] }));
    const after = districtRunSignature(requestFor({ knownAlliances: [{ allianceNumber: 1, picks: ["frc1", "frc3"] }] }));
    expect(after).not.toBe(before);
  });

  it("MOVES when allianceCount changes, which the old signature did not carry at all", () => {
    const before = districtRunSignature(requestFor({ allianceCount: 8 }));
    const after = districtRunSignature(requestFor({ allianceCount: 4 }));
    expect(after).not.toBe(before);
  });

  it("MOVES on a score correction that revises a baseline without changing the row count", () => {
    const corrected = baselines().map((baseline) =>
      baseline.teamKey === "frc1" ? { ...baseline, earnedRpSum: 14 } : baseline
    );
    const before = districtRunSignature(requestFor());
    const after = districtRunSignature(requestFor({ baselines: corrected }));
    expect(after).not.toBe(before);
    // Same row count on both sides, which is exactly what the old
    // `baselines.length` term could not see.
    expect(corrected.length).toBe(baselines().length);
  });

  it("distinguishes an ABSENT known map from a present-but-empty one", () => {
    const absent = districtRunSignature(requestFor());
    const empty = districtRunSignature(requestFor({ knownAwardPoints: new Map<string, number>() }));
    expect(empty).not.toBe(absent);
  });

  it("does not move on map INSERTION ORDER alone, so an unchanged refetch does not re-fire the run", () => {
    const one = districtRunSignature(
      requestFor({
        knownAwardPoints: new Map([
          ["frc1", 5],
          ["frc2", 10],
        ]),
      })
    );
    const other = districtRunSignature(
      requestFor({
        knownAwardPoints: new Map([
          ["frc2", 10],
          ["frc1", 5],
        ]),
      })
    );
    expect(other).toBe(one);
  });

  it("separates events, so two events cannot fold into one another's terms", () => {
    const a = requestFor()[0]!;
    const b = requestFor({ eventKey: "2026wasam" })[0]!;
    const signature = districtRunSignature([a, b]);
    expect(signature).toContain("2026wabon");
    expect(signature).toContain("2026wasam");
    expect(signature.split(";").length).toBe(2);
  });
});

/**
 * THE DEFAULT PATH IS BYTE FOR BYTE TODAY'S (quick task 260925-xab).
 *
 * `buildDistrictEventSimulationInput` gained an optional `tier`, and
 * `useDistrictLedgerData` gained the two options that feed it. The whole
 * premise of the change is that a caller supplying neither reads exactly what
 * it read before, so the District Locks tab's run cannot move. That
 * is pinned here on the ASSEMBLED input and on the signature the run is keyed
 * on, rather than only on the two tabs' rendered output.
 */
describe("the tier option on the assembled per-event input", () => {
  const roster = Array.from({ length: 6 }, (_unused, i) => `frc${String(100 + i)}`);
  const pmf = [0.25, 0.25, 0.25, 0.25];

  const eventArtifact: EventArtifact = EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "7.0.0+rolling",
    eventKey: "2026pncmp",
    season: 2026,
    matches: Array.from({ length: 4 }, (_unused, i) => ({
      matchKey: `2026pncmp_qm${String(i + 1)}`,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: i + 1,
      sortTime: 1_760_000_000 + i * 600,
      redTeams: roster.slice(0, 3),
      blueTeams: roster.slice(3, 6),
      predictedWinner: "red",
      pRedWin: 0.5,
      predictedRedScore: 50,
      predictedBlueScore: 50,
      actualWinner: "red",
      actualRedScore: 60,
      actualBlueScore: 50,
      actualRedRp: 3,
      actualBlueRp: 1,
      redRpPmf: pmf,
      blueRpPmf: pmf,
    })),
    upcoming: [],
    teams: roster.map((teamKey, i) => ({
      teamKey,
      teamNumber: 100 + i,
      rank: i + 1,
      record: { wins: 2, losses: 2, ties: 0 },
      rp: 2,
      metrics: { total: { value: 60 - i }, sigma: { value: 8 } },
    })),
  });

  const districtArtifact: DistrictArtifact = DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    districtKey: "2026pnw",
    year: 2026,
    abbreviation: "pnw",
    displayName: "Pacific Northwest",
    dcmpSlots: 50,
    cmpSlots: 21,
    teams: roster.map((teamKey, i) => ({
      teamKey,
      teamNumber: 100 + i,
      nickname: `Nickname ${teamKey}`,
      rank: i + 1,
      pointTotal: 24,
      rookieBonus: 0,
      adjustments: 0,
      eventPoints: [
        {
          eventKey: "2026pncmp",
          eventName: "PNW District Championship",
          week: 5,
          tier: "dcmp",
          qual: 12,
          alliance: 6,
          elim: 6,
          award: 0,
          total: 24,
        },
      ],
      remainingEvents: [],
      maxRemainingDistrict: 0,
      maxRemainingChamp: 0,
      qualifyingAwards: [],
      districtLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 20, allocationNote: null },
      champLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 40, allocationNote: null },
      awardProfile: { bucket: "none", rookie: false },
    })),
    insights: {
      teamCount: roster.length,
      eventCount: 1,
      dcmpCutLinePoints: 40,
      cmpCutLinePoints: 80,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
  });

  function inputAt(tier?: "district" | "dcmp"): DistrictLedgerEventInput {
    const built = buildDistrictEventSimulationInput({
      eventKey: "2026pncmp",
      season: 2026,
      eventArtifact,
      districtArtifact,
      stage: { qual: true, alliance: false, elim: false, award: false },
      startMatchKey: null,
      ...(tier === undefined ? {} : { tier }),
    });
    if (!built.ok) throw new Error("expected an input");
    return built.input;
  }

  it("defaults to the district tier and produces the same signature as supplying it explicitly", () => {
    const implicit = inputAt();
    const explicit = inputAt("district");
    expect(implicit.tier).toBe("district");
    expect(districtRunSignature([{ eventKey: implicit.eventKey, input: implicit }])).toBe(
      districtRunSignature([{ eventKey: explicit.eventKey, input: explicit }])
    );
  });

  it("carries the dcmp tier through to the simulation input when the champ tab supplies it", () => {
    expect(inputAt("dcmp").tier).toBe("dcmp");
  });

  it("changes nothing else about the input when the tier changes", () => {
    const district = inputAt("district");
    const dcmp = inputAt("dcmp");
    expect({ ...dcmp, tier: "district" }).toEqual(district);
  });
});

describe("pointsFinalByEvent: both assemblies hand the run which of TBA's numbers are final (quick task 261009-vp9)", () => {
  const EVENT = "2026waplay";
  const roster = Array.from({ length: 24 }, (_unused, i) => `frc${String(400 + i)}`);
  const pmf = [0.25, 0.25, 0.25, 0.25];
  const alliances = Array.from({ length: 8 }, (_unused, n) => ({ allianceNumber: n + 1, picks: roster.slice(n * 3, n * 3 + 3) }));
  const picksOf = (allianceNumber: number): string[] => alliances[allianceNumber - 1]!.picks;

  const eventArtifact: EventArtifact = EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "7.0.0+rolling",
    eventKey: EVENT,
    season: 2026,
    matches: [
      ...Array.from({ length: 4 }, (_unused, i) => ({
        matchKey: `${EVENT}_qm${String(i + 1)}`,
        compLevel: "qm",
        setNumber: 1,
        matchNumber: i + 1,
        sortTime: 1_760_000_000 + i * 600,
        redTeams: roster.slice(i * 6, i * 6 + 3),
        blueTeams: roster.slice(i * 6 + 3, i * 6 + 6),
        predictedWinner: "red",
        pRedWin: 0.5,
        predictedRedScore: 50,
        predictedBlueScore: 50,
        actualWinner: "red",
        actualRedScore: 60,
        actualBlueScore: 50,
        actualRedRp: 3,
        actualBlueRp: 1,
        redRpPmf: pmf,
        blueRpPmf: pmf,
      })),
      // Two played semifinal sets: alliance 1 beat 8, and alliance 5 beat 4.
      ...[
        { setNumber: 1, red: 1, blue: 8, winner: "red" },
        { setNumber: 2, red: 4, blue: 5, winner: "blue" },
      ].map((row) => ({
        matchKey: `${EVENT}_sf${String(row.setNumber)}m1`,
        compLevel: "sf",
        setNumber: row.setNumber,
        matchNumber: 1,
        sortTime: 1_770_000_000 + row.setNumber * 600,
        redTeams: picksOf(row.red),
        blueTeams: picksOf(row.blue),
        predictedWinner: "red",
        pRedWin: 0.5,
        predictedRedScore: 100,
        predictedBlueScore: 100,
        actualWinner: row.winner,
        actualRedScore: row.winner === "red" ? 110 : 90,
        actualBlueScore: row.winner === "red" ? 90 : 110,
        actualRedRp: 0,
        actualBlueRp: 0,
      })),
    ],
    upcoming: [],
    teams: roster.map((teamKey, i) => ({
      teamKey,
      teamNumber: 400 + i,
      rank: i + 1,
      record: { wins: 2, losses: 2, ties: 0 },
      rp: 2,
      metrics: { total: { value: 90 - i }, sigma: { value: 8 } },
    })),
    alliances,
  });

  /** Every team has a row at the event whose playoff points are a STALE 3: the rankings have not caught up. */
  const districtArtifact: DistrictArtifact = DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    districtKey: "2026pnw",
    year: 2026,
    abbreviation: "pnw",
    displayName: "Pacific Northwest",
    dcmpSlots: 12,
    cmpSlots: 4,
    teams: roster.map((teamKey, i) => ({
      teamKey,
      teamNumber: 400 + i,
      nickname: `Nickname ${teamKey}`,
      rank: i + 1,
      pointTotal: 21,
      rookieBonus: 0,
      adjustments: 0,
      eventPoints: [{ eventKey: EVENT, eventName: "Playoff Event", week: 2, tier: "district", qual: 12, alliance: 6, elim: 3, award: 0, total: 21 }],
      remainingEvents: [],
      maxRemainingDistrict: 0,
      maxRemainingChamp: 0,
      qualifyingAwards: [],
      districtLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 20, allocationNote: null },
      champLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 40, allocationNote: null },
      awardProfile: { bucket: "none", rookie: false },
    })),
    insights: { teamCount: roster.length, eventCount: 1, dcmpCutLinePoints: 40, cmpCutLinePoints: 80, districtLockedCount: 0, districtEliminatedCount: 0, champLockedCount: 0, champEliminatedCount: 0 },
  });

  /** The field: the playoffs are done. */
  const FIELD_DONE: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: false };
  /** The number: the playoff points are not in. */
  const NUMBER_OPEN: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
  const eventArtifacts = new Map<string, EventArtifact>([[EVENT, eventArtifact]]);
  const stageByEvent = new Map<string, DistrictStageFinality>([[EVENT, FIELD_DONE]]);
  const TWO_SETS = [
    { compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 },
    { compLevel: "sf", setNumber: 2, matchNumber: 1, winningAllianceNumber: 5 },
  ];

  describe("assembleLiveDistrictEvents", () => {
    const live = (pointsFinalByEvent?: ReadonlyMap<string, DistrictStageFinality>) =>
      assembleLiveDistrictEvents({ artifact: districtArtifact, activeKeys: [EVENT], eventArtifacts, stageByEvent, ...(pointsFinalByEvent === undefined ? {} : { pointsFinalByEvent }) });

    it("with no pointsFinalByEvent builds the request it built before: the field's stage decides everything", () => {
      const assembled = live();
      expect(assembled.events).toHaveLength(1);
      const input = assembled.events[0]!.input;
      expect(input.knownElimPoints?.get(roster[0]!)).toBe(3);
      expect(input.playedElimMatches).toBeUndefined();
      // An entry equal to the field's stage is the same request, and a map with no entry for the event is too.
      expect(live(new Map([[EVENT, FIELD_DONE]]))).toEqual(assembled);
      expect(live(new Map())).toEqual(assembled);
    });

    it("with the playoff number open for an event the field calls done: no knownElimPoints, its played rows, the known alliances, and a different run signature", () => {
      const assembled = live(new Map([[EVENT, NUMBER_OPEN]]));
      expect(assembled.events).toHaveLength(1);
      const input = assembled.events[0]!.input;
      expect(input.knownElimPoints).toBeUndefined();
      expect(input.playedElimMatches).toEqual(TWO_SETS);
      expect(input.knownAlliances).toHaveLength(8);
      expect(assembled.signature).not.toBe(live().signature);
    });
  });

  describe("the field backups travel beside the requests (quick task 261010-66y, R13)", () => {
    const BACKUP = "frc999";
    /** The same event with alliance 1's third robot replaced on the field, in its one played set, by a team no pick list names. */
    const withBackup: EventArtifact = EventArtifactSchema.parse({
      ...eventArtifact,
      matches: eventArtifact.matches.map((match) => (match.matchKey === `${EVENT}_sf1m1` ? { ...match, redTeams: [...picksOf(1).slice(0, 2), BACKUP] } : match)),
    });
    const number = new Map([[EVENT, NUMBER_OPEN]]);

    it("the Live assembly carries them per event, outside the request and outside the signature", () => {
      const listed = assembleLiveDistrictEvents({ artifact: districtArtifact, activeKeys: [EVENT], eventArtifacts, stageByEvent, pointsFinalByEvent: number });
      const seen = assembleLiveDistrictEvents({ artifact: districtArtifact, activeKeys: [EVENT], eventArtifacts: new Map([[EVENT, withBackup]]), stageByEvent, pointsFinalByEvent: number });
      // With no backup anywhere the assembly carries no map at all: it is the object it always was.
      expect("fieldBackupsByEvent" in listed).toBe(false);
      expect([...seen.fieldBackupsByEvent!]).toEqual([[EVENT, [{ teamKey: BACKUP, allianceNumber: 1 }]]]);
      expect(seen.events).toEqual(listed.events);
      expect(seen.signature).toBe(listed.signature);
      // Where the builder reads no played row (the playoff number is final) there is nothing to carry.
      expect("fieldBackupsByEvent" in assembleLiveDistrictEvents({ artifact: districtArtifact, activeKeys: [EVENT], eventArtifacts: new Map([[EVENT, withBackup]]), stageByEvent })).toBe(false);
    });
  });

  describe("assembleAsOfDistrictEvents", () => {
    /** A rewound stop that readied the one event as REAL, with both played sets at or before its cut. */
    const result = {
      status: "ready",
      cutId: "cut-1",
      events: new Map([
        [
          EVENT,
          {
            status: "ready",
            state: {
              plan: {
                mode: "real",
                eventKey: EVENT,
                tier: "district",
                roster,
                rows: [],
                baselines: roster.map((teamKey) => ({ teamKey, earnedRpSum: 8, matchesPlayed: 4 })),
                playedPlayoffMatchKeys: [`${EVENT}_sf1m1`, `${EVENT}_sf2m1`],
              },
              season: 2026,
              vars: [],
              league: [],
              teams: [],
            },
          },
        ],
      ]),
    } as unknown as AsOfRewindResult;
    const asOf = (pointsFinalByEvent?: ReadonlyMap<string, DistrictStageFinality>) =>
      assembleAsOfDistrictEvents({
        artifact: districtArtifact,
        result,
        algorithmVersion: "7.0.0+rolling",
        eventArtifacts,
        stageByEvent,
        candidateKeys: [EVENT],
        ...(pointsFinalByEvent === undefined ? {} : { pointsFinalByEvent }),
      });

    it("with no pointsFinalByEvent builds the request it built before", () => {
      const assembled = asOf();
      expect(assembled.asOfUnavailable).toEqual([]);
      expect(assembled.events).toHaveLength(1);
      expect(assembled.events[0]!.input.knownElimPoints?.get(roster[0]!)).toBe(3);
      expect(assembled.events[0]!.input.playedElimMatches).toBeUndefined();
      expect(asOf(new Map([[EVENT, FIELD_DONE]]))).toEqual(assembled);
    });

    it("with the playoff number open: no knownElimPoints, the stop's own played rows, and a different run signature", () => {
      const assembled = asOf(new Map([[EVENT, NUMBER_OPEN]]));
      expect(assembled.events).toHaveLength(1);
      expect(assembled.events[0]!.input.knownElimPoints).toBeUndefined();
      expect(assembled.events[0]!.input.playedElimMatches).toEqual(TWO_SETS);
      expect(assembled.signature).not.toBe(asOf().signature);
    });

    it("carries the field backups of the stop's own played rows, outside the request and the signature (quick task 261010-66y, R13)", () => {
      const BACKUP = "frc999";
      const withBackup: EventArtifact = EventArtifactSchema.parse({
        ...eventArtifact,
        matches: eventArtifact.matches.map((match) => (match.matchKey === `${EVENT}_sf2m1` ? { ...match, blueTeams: [...picksOf(5).slice(0, 2), BACKUP] } : match)),
      });
      const number = new Map([[EVENT, NUMBER_OPEN]]);
      const listed = asOf(number);
      const seen = assembleAsOfDistrictEvents({
        artifact: districtArtifact,
        result,
        algorithmVersion: "7.0.0+rolling",
        eventArtifacts: new Map([[EVENT, withBackup]]),
        stageByEvent,
        candidateKeys: [EVENT],
        pointsFinalByEvent: number,
      });
      expect("fieldBackupsByEvent" in listed).toBe(false);
      expect([...seen.fieldBackupsByEvent!]).toEqual([[EVENT, [{ teamKey: BACKUP, allianceNumber: 5 }]]]);
      expect(seen.events).toEqual(listed.events);
      expect(seen.signature).toBe(listed.signature);
    });
  });
});

describe("districtRunSignature — the award only list (quick task 260927-vmb)", () => {
  it("keeps exactly nine pipe separated segments for a request without an award only list", () => {
    expect(districtRunSignature(requestFor()).split("|")).toHaveLength(9);
  });

  it("MOVES when only the award only list changes", () => {
    const before = districtRunSignature(requestFor({ awardOnlyTeams: ["frc9"] }));
    const after = districtRunSignature(requestFor({ awardOnlyTeams: ["frc9", "frc10"] }));
    expect(after).not.toBe(before);
    expect(before).not.toBe(districtRunSignature(requestFor()));
  });
});

describe("the divisioned championship's facts and Live fetch set (quick task 261009-kt3)", () => {
  function repoFile(relative: string): string {
    let dir = resolve(process.cwd());
    for (;;) {
      const candidate = join(dir, relative);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) throw new Error(`could not find ${relative}`);
      dir = parent;
    }
  }
  const FIXTURE: DistrictArtifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(repoFile("data/fixtures/phase10/district-2026pnw.json"), "utf8")));
  const PARENT = "2026pncmp";
  /** Even teams in division 1, odd in division 2, and the first DCMP team keeps a finals row at the parent. */
  const firstDcmpTeam = FIXTURE.teams.find((team) => team.eventPoints.some((row) => row.eventKey === PARENT))!.teamKey;
  const DIVISIONED: DistrictArtifact = DistrictArtifactSchema.parse({
    ...FIXTURE,
    teams: FIXTURE.teams.map((team, index) => {
      const division = index % 2 === 0 ? "2026pncmp1" : "2026pncmp2";
      const relabel = <T extends { eventKey: string }>(row: T): T => (row.eventKey === PARENT ? { ...row, eventKey: division } : row);
      const eventPoints = team.eventPoints.map(relabel);
      const finals = team.teamKey === firstDcmpTeam ? [{ ...eventPoints.find((row) => row.eventKey === division)!, eventKey: PARENT, qual: 0, alliance: 0, elim: 0, award: 0, total: 0 }] : [];
      return { ...team, eventPoints: [...eventPoints, ...finals], remainingEvents: team.remainingEvents.map(relabel) };
    }),
  });
  const eight = Array.from({ length: 8 }, (_, index) => ({ allianceNumber: index + 1, picks: [`d${index}x`, `d${index}y`, `d${index}z`] }));
  const eventArtifact = (alliances: typeof eight) => ({ alliances, matches: [] }) as unknown as EventArtifact;
  const open = { qual: true, alliance: true, elim: false, award: false };

  it("builds division and finals facts at a divisioned championship, and nothing at a single one", () => {
    const eventArtifacts = new Map<string, EventArtifact>([
      ["2026pncmp1", eventArtifact(eight)],
      ["2026pncmp2", eventArtifact(eight)],
      [PARENT, eventArtifact(eight.slice(0, 2))],
    ]);
    const stageByEvent = new Map([
      ["2026pncmp1", { ...open, award: true }],
      ["2026pncmp2", open],
      [PARENT, open],
    ]);
    const facts = divisionedDcmpBracketFacts({ artifact: DIVISIONED, eventArtifacts, stageByEvent, requestByKey: new Map() });
    expect([...facts.keys()].sort()).toEqual([PARENT, "2026pncmp1", "2026pncmp2"]);
    expect(facts.get(PARENT)!.alliances).toHaveLength(2);
    expect(divisionedDcmpBracketFacts({ artifact: FIXTURE, eventArtifacts: new Map([[PARENT, eventArtifact(eight)]]), stageByEvent: new Map([[PARENT, open]]), requestByKey: new Map() }).size).toBe(0);
  });

  it("hands a division's request field backups to its facts, where the backup joins its alliance (quick task 261010-66y, R13)", () => {
    const eventArtifacts = new Map<string, EventArtifact>([
      ["2026pncmp1", eventArtifact(eight)],
      ["2026pncmp2", eventArtifact(eight)],
    ]);
    const stageByEvent = new Map([
      ["2026pncmp1", open],
      ["2026pncmp2", open],
    ]);
    const requestByKey = new Map([["2026pncmp1", { knownAlliances: eight, playedElimMatches: [], unresolvedMatchCount: 0, fieldBackups: [{ teamKey: "seen", allianceNumber: 3 }] }]]);
    const facts = divisionedDcmpBracketFacts({ artifact: DIVISIONED, eventArtifacts, stageByEvent, requestByKey });
    expect(facts.get("2026pncmp1")!.alliances[2]!.picks).toEqual(["d2x", "d2y", "d2z", "seen"]);
    expect(facts.get("2026pncmp2")!.alliances[2]!.picks).toEqual(["d2x", "d2y", "d2z"]);
    // Two backups on one alliance refuse that division's facts and leave the other's alone.
    const refused = divisionedDcmpBracketFacts({
      artifact: DIVISIONED,
      eventArtifacts,
      stageByEvent,
      requestByKey: new Map([["2026pncmp1", { knownAlliances: eight, playedElimMatches: [], unresolvedMatchCount: 0, fieldBackups: [{ teamKey: "seen", allianceNumber: 3 }, { teamKey: "seen2", allianceNumber: 3 }] }]]),
    });
    expect([...refused.keys()]).toEqual(["2026pncmp2"]);
  });

  it("keeps every started key of a divisioned championship fetched through the window and the finals (quick task 261010-66y, R15; the pins are unchanged by quick task 261010-d7r, which keeps them until EVERY event has finished)", () => {
    const keys = ["2026micmp", "2026micmp1", "2026micmp2", "2026micmp3", "2026micmp4"];
    const divisions = keys.slice(1);
    // THE WINDOW: every division started and finished, none in progress, the finals key on the rows and not started.
    expect(champLiveFetchKeys([], divisions, keys)).toEqual(divisions);
    expect(champLiveFetchKeys(["2026wabon"], [...divisions, "2026wabon"], keys)).toEqual([...divisions, "2026wabon"].sort());
    // Part of the way there: two divisions finished, two still to start.
    expect(champLiveFetchKeys([], divisions.slice(0, 2), keys)).toEqual(divisions.slice(0, 2));
    // The finals in progress: every started key, as before.
    expect(champLiveFetchKeys(["2026micmp"], keys, keys)).toEqual(keys);
    // Every event of the championship finished (each started and none in progress): only the other in progress keys.
    expect(champLiveFetchKeys([], keys, keys)).toEqual([]);
    expect(champLiveFetchKeys(["2026wabon"], [...keys, "2026wabon"], keys)).toEqual(["2026wabon"]);
    // Before the championship: nothing started, nothing added.
    expect(champLiveFetchKeys(["2026wabon"], ["2026wabon"], keys)).toEqual(["2026wabon"]);
    // Division keys whose finals key is on no row are not a divisioned shape: the in progress keys alone.
    expect(champLiveFetchKeys([], divisions, divisions)).toEqual([]);
    expect(champLiveFetchKeys(["2026micmp1"], divisions, divisions)).toEqual(["2026micmp1"]);
    // Two championships and a single one are untouched, finished or not.
    expect(champLiveFetchKeys([], ["2026cancmp", "2026cascmp"], ["2026cancmp", "2026cascmp"])).toEqual([]);
    expect(champLiveFetchKeys([], ["2026pncmp"], ["2026pncmp"])).toEqual([]);
  });

  it("with finalsMayBeAbsent, division keys whose finals key is on no row keep every started key fetched until the finals key is on a row and every event has finished (quick task 261010-d7r, D2)", () => {
    const keys = ["2026micmp", "2026micmp1", "2026micmp2", "2026micmp3", "2026micmp4"];
    const divisions = keys.slice(1);
    // THE WINDOW with the finals key on no row: every division started and finished, none in progress. Only with
    // the flag is the shape divisioned at all, and the finals key (on no row, so not started) has not finished.
    expect(champLiveFetchKeys([], divisions, divisions, true)).toEqual(divisions);
    expect(champLiveFetchKeys([], divisions, divisions)).toEqual([]);
    expect(champLiveFetchKeys([], divisions, divisions, false)).toEqual([]);
    // During the division playoffs: two divisions in progress, two finished. Every started key.
    expect(champLiveFetchKeys(["2026micmp1", "2026micmp3"], divisions, divisions, true)).toEqual(divisions);
    // Other events in progress ride along, and a division that has not started is not fetched.
    expect(champLiveFetchKeys(["2026wabon"], [...divisions, "2026wabon"], divisions, true)).toEqual([...divisions, "2026wabon"].sort());
    expect(champLiveFetchKeys(["2026micmp1"], divisions.slice(0, 2), divisions, true)).toEqual(divisions.slice(0, 2));
    // Before the championship: nothing started, nothing added.
    expect(champLiveFetchKeys(["2026wabon"], ["2026wabon"], divisions, true)).toEqual(["2026wabon"]);
    // A two division championship, the same.
    const two = ["2026necmp1", "2026necmp2"];
    expect(champLiveFetchKeys([], two, two, true)).toEqual(two);
    expect(champLiveFetchKeys([], two, two)).toEqual([]);
    // One or three division keys without the parent are not a divisioned shape even with the flag.
    expect(champLiveFetchKeys([], divisions.slice(0, 3), divisions.slice(0, 3), true)).toEqual([]);
    expect(champLiveFetchKeys([], divisions.slice(0, 1), divisions.slice(0, 1), true)).toEqual([]);
    // THE FLAG CHANGES NOTHING where the finals key is on the rows, or at another shape: the rule of quick task
    // 261010-d7r's finding F-B (every event finished) is the one rule on both sides.
    const cases: readonly (readonly [readonly string[], readonly string[], readonly string[]])[] = [
      [[], divisions, keys],
      [[], divisions.slice(0, 2), keys],
      [["2026micmp"], keys, keys],
      [["2026micmp3"], keys, keys],
      [[], keys, keys],
      [["2026wabon"], [...keys, "2026wabon"], keys],
      [["2026wabon"], ["2026wabon"], keys],
      [["2026cancmp"], ["2026cancmp", "2026cascmp"], ["2026cancmp", "2026cascmp"]],
      [[], ["2026cancmp", "2026cascmp"], ["2026cancmp", "2026cascmp"]],
      [["2026pncmp"], ["2026pncmp"], ["2026pncmp"]],
      [[], ["2026pncmp"], ["2026pncmp"]],
    ];
    for (const [inProgress, started, dcmpKeys] of cases) {
      expect(champLiveFetchKeys(inProgress, started, dcmpKeys, true), `${inProgress.join(",")} | ${started.join(",")} | ${dcmpKeys.join(",")}`).toEqual(champLiveFetchKeys(inProgress, started, dcmpKeys));
    }
  });

  it("builds the division facts of a divisioned championship whose finals key is on no row only with finalsMayBeAbsent, and no finals entry (quick task 261010-d7r, D2)", () => {
    const NO_PARENT: DistrictArtifact = DistrictArtifactSchema.parse({
      ...DIVISIONED,
      teams: DIVISIONED.teams.map((team) => ({ ...team, eventPoints: team.eventPoints.filter((row) => row.eventKey !== PARENT), remainingEvents: team.remainingEvents.filter((row) => row.eventKey !== PARENT) })),
    });
    const eventArtifacts = new Map<string, EventArtifact>([
      ["2026pncmp1", eventArtifact(eight)],
      ["2026pncmp2", eventArtifact(eight)],
    ]);
    const stageByEvent = new Map([
      ["2026pncmp1", open],
      ["2026pncmp2", open],
    ]);
    expect(divisionedDcmpBracketFacts({ artifact: NO_PARENT, eventArtifacts, stageByEvent, requestByKey: new Map() }).size).toBe(0);
    expect(divisionedDcmpBracketFacts({ artifact: NO_PARENT, eventArtifacts, stageByEvent, requestByKey: new Map(), finalsMayBeAbsent: false }).size).toBe(0);
    const facts = divisionedDcmpBracketFacts({ artifact: NO_PARENT, eventArtifacts, stageByEvent, requestByKey: new Map(), finalsMayBeAbsent: true });
    expect([...facts.keys()].sort()).toEqual(["2026pncmp1", "2026pncmp2"]);
    // The facts are the ones built with the parent on the rows: the flag reads the shape and nothing else.
    const withParent = divisionedDcmpBracketFacts({ artifact: DIVISIONED, eventArtifacts, stageByEvent, requestByKey: new Map() });
    expect(facts.get("2026pncmp1")).toEqual(withParent.get("2026pncmp1"));
    expect(facts.get("2026pncmp2")).toEqual(withParent.get("2026pncmp2"));
    // With the parent on the rows the flag changes nothing.
    expect(divisionedDcmpBracketFacts({ artifact: DIVISIONED, eventArtifacts, stageByEvent, requestByKey: new Map(), finalsMayBeAbsent: true })).toEqual(withParent);
    // A single championship builds nothing with it either.
    expect(divisionedDcmpBracketFacts({ artifact: FIXTURE, eventArtifacts: new Map([[PARENT, eventArtifact(eight)]]), stageByEvent: new Map([[PARENT, open]]), requestByKey: new Map(), finalsMayBeAbsent: true }).size).toBe(0);
  });

  it("keeps a divisioned championship's started keys fetched at Live while any of them is in progress, and changes nothing otherwise", () => {
    const keys = ["2026micmp", "2026micmp1", "2026micmp2", "2026micmp3", "2026micmp4"];
    expect(champLiveFetchKeys(["2026micmp", "2026wabon"], [...keys, "2026wabon"], keys)).toEqual([...keys, "2026wabon"].sort());
    expect(champLiveFetchKeys(["2026wabon"], [...keys, "2026wabon"], keys)).toEqual(["2026wabon"]);
    expect(champLiveFetchKeys(["2026micmp1"], ["2026micmp1", "2026micmp2"], keys)).toEqual(["2026micmp1", "2026micmp2"]);
    expect(champLiveFetchKeys(["2026cancmp"], ["2026cancmp", "2026cascmp"], ["2026cancmp", "2026cascmp"])).toEqual(["2026cancmp"]);
    expect(champLiveFetchKeys(["2026pncmp"], ["2026pncmp"], ["2026pncmp"])).toEqual(["2026pncmp"]);
  });

  it("keeps every started key of a divisioned championship fetched until EVERY one of its events has finished, the finals finished before a division included (quick task 261010-d7r, finding F-B)", () => {
    const keys = ["2026micmp", "2026micmp1", "2026micmp2", "2026micmp3", "2026micmp4"];
    // THE FINALS FINISHED WHILE A DIVISION HAS NOT: the finals' awards flag turned true before division 3's, so the
    // finals read finished (started, not in progress) and division 3 reads in progress. The joint proof still runs
    // there and reads EVERY division's bracket, so every started key stays fetched. The rule of quick task
    // 261010-66y returned division 3 alone here.
    expect(champLiveFetchKeys(["2026micmp3"], keys, keys)).toEqual(keys);
    expect(champLiveFetchKeys(["2026micmp1", "2026micmp3"], keys, keys)).toEqual(keys);
    expect(champLiveFetchKeys(["2026micmp3", "2026wabon"], [...keys, "2026wabon"], keys)).toEqual([...keys, "2026wabon"].sort());
    // Every event of the championship finished: only the other in progress keys. The proof no longer runs.
    expect(champLiveFetchKeys([], keys, keys)).toEqual([]);
    expect(champLiveFetchKeys(["2026wabon"], [...keys, "2026wabon"], keys)).toEqual(["2026wabon"]);
    // A two division championship, the same: the finals finished, division 2 not.
    const two = ["2026necmp", "2026necmp1", "2026necmp2"];
    expect(champLiveFetchKeys(["2026necmp2"], two, two)).toEqual(two);
    expect(champLiveFetchKeys([], two, two)).toEqual([]);
    // Two championships and a single one are untouched: one finished and the other in progress returns the one in progress.
    expect(champLiveFetchKeys(["2026cascmp"], ["2026cancmp", "2026cascmp"], ["2026cancmp", "2026cascmp"])).toEqual(["2026cascmp"]);
  });
});
