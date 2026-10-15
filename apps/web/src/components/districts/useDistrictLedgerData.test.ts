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
import { attachRequestFacts, champLiveFetchKeys, districtRunSignature, divisionedDcmpBracketFacts, securedElimForRequest } from "./useDistrictLedgerData.js";
import { assembleAsOfDistrictEvents, assembleLiveDistrictEvents, assembleSimulatedDcmpBake } from "./districtRunAssembly.js";
import type { AsOfRewindResult } from "./asOfRewind.js";
import type { BracketSourceEvent, DistrictEventDistributions, DistrictStageFinality } from "./districtLedgerRows.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildDistrictEventSimulationInput, buildDistrictLedgerRows, dcmpBracketFactsFor, dcmpBracketMilestonesByTeam, securedElimByTeamFor } from "./districtLedgerRows.js";
import { buildChampLedgerRows } from "./champLedgerRows.js";
import { computeChampLedgerStatuses } from "./champLedgerStatus.js";
import type { PlayedBracketMatch } from "../../../../../packages/core/districts/bracket.js";
import { isDistrictSimulationRequest, type DistrictSimulationEventRequest } from "../../workers/districtSimulationProtocol.js";
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
    // The district tier alone asks for the per run record, for the joint
    // advancement draw (quick task 261014-qv2); the dcmp tier never does.
    const { recordEventTotalByRun, ...districtRest } = district;
    expect(recordEventTotalByRun).toBe(true);
    expect("recordEventTotalByRun" in dcmp).toBe(false);
    expect({ ...dcmp, tier: "district" }).toEqual(districtRest);
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

// ---------------------------------------------------------------------------
// What the lock math reads of an event does not wait for the run (quick task
// 261012-mw2): `attachRequestFacts` and `securedElimForRequest`.
// ---------------------------------------------------------------------------

describe("what the lock math reads of an event is laid on per run request, run landed or not (quick task 261012-mw2)", () => {
  // EVERY EXPECTED CREDIT BELOW IS WORKED BY HAND from TBA's pay rule as
  // `packages/core/districts/securedPlayoffPoints.ts` states it for 2024 on:
  // an alliance's table points (sf7 and sf8 pay 13, sf1 to sf6 pay 0) times
  // the semifinal wins the robot was on the field for, over the semifinal wins
  // of its alliance, rounded up, and then times the tier weight (1 at a
  // district event, 3 at a championship).
  const SEASON = 2026;
  const EVENT = "2026wasec";
  const picksOf = (allianceNumber: number): string[] => [`frc${String(allianceNumber)}01`, `frc${String(allianceNumber)}02`, `frc${String(allianceNumber)}03`];
  const ALLIANCES = Array.from({ length: 8 }, (_unused, i) => ({ allianceNumber: i + 1, picks: picksOf(i + 1) }));
  type SourceMatch = BracketSourceEvent["matches"][number];
  /** One played semifinal set between two alliances, in TBA's coordinates. */
  function setRow(eventKey: string, alliances: readonly { allianceNumber: number; picks: readonly string[] }[], setNumber: number, red: number, blue: number, winner: number): SourceMatch {
    const of = (allianceNumber: number): string[] => [...alliances.find((alliance) => alliance.allianceNumber === allianceNumber)!.picks].slice(0, 3);
    return { matchKey: `${eventKey}_sf${String(setNumber)}m1`, compLevel: "sf", setNumber, matchNumber: 1, redTeams: of(red), blueTeams: of(blue), actualWinner: winner === red ? "red" : "blue" };
  }
  // Round 1: 1 beats 8, 4 beats 5, 2 beats 7, 3 beats 6. The lower half of Round 2: 5 beats 8 and 6 beats 7. Then
  // sf7, alliance 1 beats alliance 4, and sf8, alliance 2 beats alliance 3.
  const SETS: readonly (readonly [number, number, number, number])[] = [
    [1, 1, 8, 1],
    [2, 4, 5, 4],
    [3, 2, 7, 2],
    [4, 3, 6, 3],
    [5, 8, 5, 5],
    [6, 7, 6, 6],
    [7, 1, 4, 1],
    [8, 2, 3, 2],
  ];
  const rowsThrough = (lastSet: number, eventKey = EVENT, alliances: readonly { allianceNumber: number; picks: readonly string[] }[] = ALLIANCES): SourceMatch[] =>
    SETS.filter(([setNumber]) => setNumber <= lastSet).map(([setNumber, red, blue, winner]) => setRow(eventKey, alliances, setNumber, red, blue, winner));
  const playedThrough = (lastSet: number): PlayedBracketMatch[] =>
    SETS.filter(([setNumber]) => setNumber <= lastSet).map(([setNumber, , , winner]) => ({ compLevel: "sf", setNumber, matchNumber: 1, winningAllianceNumber: winner }));
  const artifactOf = (matches: readonly SourceMatch[], alliances: readonly { allianceNumber: number; picks: readonly string[] }[] = ALLIANCES): EventArtifact =>
    ({ alliances, matches }) as unknown as EventArtifact;
  const keysOf = (matches: readonly SourceMatch[]): Set<string> => new Set(matches.map((match) => match.matchKey));
  const asObject = (map: ReadonlyMap<string, number> | undefined): Record<string, number> | undefined =>
    map === undefined ? undefined : Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)));
  /** One run request for the hand built event: its tier, the published alliances and the played rows it was conditioned on. */
  const requestOf = (eventKey: string, tier: "district" | "dcmp", played: readonly PlayedBracketMatch[] | undefined, alliances: readonly { allianceNumber: number; picks: string[] }[] | undefined = ALLIANCES) =>
    requestFor({ eventKey, tier, ...(alliances === undefined ? {} : { knownAlliances: alliances }), ...(played === undefined ? {} : { playedElimMatches: played }) });
  const PLAYOFFS_OPEN: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
  const ALL_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };
  /** Alliance 1 after sf7: 0 for sf1 and 13 for sf7 over two wins, every robot on the field for both. 13 x 2 / 2. */
  const ALLIANCE_ONE = { frc101: 13, frc102: 13, frc103: 13 };
  /** Alliance 2 after sf8, the same way. */
  const ALLIANCE_TWO = { frc201: 13, frc202: 13, frc203: 13 };

  describe("securedElimForRequest, the rewound reading", () => {
    it("equals securedElimByTeamFor for the same rows, at a cut and with every row, and a row after the cut adds nothing", () => {
      const eventArtifact = artifactOf(rowsThrough(8));
      // The stop after sf7: the artifact holds sf8 too, and the request does not. Alliance 2's win is not read.
      const atSeven = securedElimForRequest({ eventArtifact, season: SEASON, tier: "district", playedElimMatches: playedThrough(7), unresolvedMatchCount: 0 });
      expect(asObject(atSeven)).toEqual(ALLIANCE_ONE);
      expect(atSeven).toEqual(securedElimByTeamFor(eventArtifact, SEASON, "district", keysOf(rowsThrough(7))));
      // Every row: the reading with no cut at all.
      const atEight = securedElimForRequest({ eventArtifact, season: SEASON, tier: "district", playedElimMatches: playedThrough(8), unresolvedMatchCount: 0 });
      expect(asObject(atEight)).toEqual({ ...ALLIANCE_ONE, ...ALLIANCE_TWO });
      expect(atEight).toEqual(securedElimByTeamFor(eventArtifact, SEASON, "district"));
      // The championship tier: the rounding comes before the weight, 13 x 3.
      expect(asObject(securedElimForRequest({ eventArtifact, season: SEASON, tier: "dcmp", playedElimMatches: playedThrough(7), unresolvedMatchCount: 0 }))).toEqual({ frc101: 39, frc102: 39, frc103: 39 });
    });

    it("returns undefined, crediting nobody, wherever the request cannot be read whole", () => {
      const eventArtifact = artifactOf(rowsThrough(8));
      const base = { eventArtifact, season: SEASON, tier: "district" as const, playedElimMatches: playedThrough(7), unresolvedMatchCount: 0 };
      // The control: this request is credited.
      expect(securedElimForRequest(base)?.size).toBe(3);
      // The event artifact is not loaded.
      expect(securedElimForRequest({ ...base, eventArtifact: undefined })).toBeUndefined();
      // The request carries no played row: the playoffs are not under way at the stop, or their points are final there.
      expect(securedElimForRequest({ ...base, playedElimMatches: undefined })).toBeUndefined();
      expect(securedElimForRequest({ ...base, playedElimMatches: [] })).toBeUndefined();
      // The event has a playoff row the tab could not place on two alliances.
      expect(securedElimForRequest({ ...base, unresolvedMatchCount: 1 })).toBeUndefined();
      // A played row of the request is not on the artifact: sf8 is in the request and the artifact stops at sf7.
      expect(securedElimForRequest({ ...base, eventArtifact: artifactOf(rowsThrough(7)), playedElimMatches: playedThrough(8) })).toBeUndefined();
      // Nothing is credited: Round 1 and the lower half of Round 2 pay nothing.
      expect(securedElimForRequest({ ...base, playedElimMatches: playedThrough(4) })).toBeUndefined();
      expect(securedElimForRequest({ ...base, playedElimMatches: playedThrough(6) })).toBeUndefined();
    });
  });

  describe("attachRequestFacts", () => {
    const common = { season: SEASON, unresolvedEventKeys: new Set<string>() };
    const stageOpen = new Map([[EVENT, PLAYOFFS_OPEN]]);

    it("a landed run's entry keeps its team records and its own milestones, the same objects, and gains the secured minimums and nothing else", () => {
      const byTeam: DistrictEventDistributions["byTeam"] = new Map([["frc101", { qual: undefined, alliance: undefined, elim: undefined, award: undefined, eventTotal: undefined, grandTotal: undefined }]]);
      // The run's own milestones, marked so they cannot be mistaken for the ones read off the request.
      const ownMilestones: NonNullable<DistrictEventDistributions["playoffMilestoneByTeam"]> = new Map([["frc101", { kind: "finals" }]]);
      const landed: DistrictEventDistributions = { eventKey: EVENT, byTeam, playoffMilestoneByTeam: ownMilestones };
      const map = new Map([[EVENT, landed]]);
      attachRequestFacts(map, { ...common, requests: requestOf(EVENT, "district", playedThrough(7)), eventArtifacts: new Map([[EVENT, artifactOf(rowsThrough(7))]]), stageByEvent: stageOpen, live: false });
      const after = map.get(EVENT)!;
      expect(after.byTeam).toBe(byTeam);
      expect(after.playoffMilestoneByTeam).toBe(ownMilestones);
      expect(asObject(after.securedElimByTeam)).toEqual(ALLIANCE_ONE);
      // A district tier request builds no championship facts.
      expect(Object.keys(after).sort()).toEqual(["byTeam", "eventKey", "playoffMilestoneByTeam", "securedElimByTeam"]);
      expect(map.size).toBe(1);
    });

    it("a landed run's entry at a championship also gains the bracket facts, built with the arguments a landed run's entry was always given", () => {
      const landed: DistrictEventDistributions = { eventKey: EVENT, byTeam: new Map(), playoffMilestoneByTeam: new Map([["frc101", { kind: "finals" }]]) };
      const map = new Map([[EVENT, landed]]);
      attachRequestFacts(map, { ...common, requests: requestOf(EVENT, "dcmp", playedThrough(7)), eventArtifacts: new Map([[EVENT, artifactOf(rowsThrough(7))]]), stageByEvent: stageOpen, live: false });
      const after = map.get(EVENT)!;
      expect(Object.keys(after).sort()).toEqual(["byTeam", "dcmpBracket", "eventKey", "playoffMilestoneByTeam", "securedElimByTeam"]);
      expect(after.dcmpBracket).toEqual(
        dcmpBracketFactsFor({ eventKey: EVENT, season: SEASON, tier: "dcmp", stage: PLAYOFFS_OPEN, alliances: ALLIANCES, playedMatches: playedThrough(7), unresolvedMatchCount: 0, fieldBackups: undefined })
      );
      expect(after.dcmpBracket).toBeDefined();
      expect(asObject(after.securedElimByTeam)).toEqual({ frc101: 39, frc102: 39, frc103: 39 });
      // An unresolved playoff row refuses the facts and the credit alike, and the entry is the one it was.
      const refused = new Map([[EVENT, landed]]);
      attachRequestFacts(refused, { ...common, unresolvedEventKeys: new Set([EVENT]), requests: requestOf(EVENT, "dcmp", playedThrough(7)), eventArtifacts: new Map([[EVENT, artifactOf(rowsThrough(7))]]), stageByEvent: stageOpen, live: false });
      expect(refused.get(EVENT)).toBe(landed);
    });

    it("with no entry for the key, adds an entry with no team record carrying the milestones read off the request, the facts at a championship, and the secured minimums", () => {
      for (const tier of ["district", "dcmp"] as const) {
        const map = new Map<string, DistrictEventDistributions>();
        attachRequestFacts(map, { ...common, requests: requestOf(EVENT, tier, playedThrough(7)), eventArtifacts: new Map([[EVENT, artifactOf(rowsThrough(7))]]), stageByEvent: stageOpen, live: false });
        const added = map.get(EVENT)!;
        expect(added.eventKey).toBe(EVENT);
        expect(added.byTeam.size).toBe(0);
        expect(added.playoffMilestoneByTeam).toEqual(dcmpBracketMilestonesByTeam(ALLIANCES, playedThrough(7)));
        expect(added.playoffMilestoneByTeam!.size).toBe(24);
        expect(added.dcmpBracket === undefined).toBe(tier === "district");
        expect(asObject(added.securedElimByTeam)).toEqual(tier === "district" ? ALLIANCE_ONE : { frc101: 39, frc102: 39, frc103: 39 });
      }
      // A request with no published alliances and no played row has nothing to lay on: no entry is made up.
      const nothing = new Map<string, DistrictEventDistributions>();
      attachRequestFacts(nothing, { ...common, requests: requestFor({ eventKey: EVENT, tier: "district" }), eventArtifacts: new Map(), stageByEvent: stageOpen, live: false });
      expect(nothing.size).toBe(0);
    });

    it("the statuses of a championship with the run landed and with no entry are the same, team by team, and the joint proof is applied in both", () => {
      // The committed 2026 PNW fixture's championship, read at a stop after Round 2 with its alliances rebuilt from
      // its own alliance selection points (as `champLedgerStatus.test.ts` rebuilds them).
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
      const DCMP = "2026pncmp";
      const picks = new Map<number, string[]>();
      for (const team of FIXTURE.teams) {
        const row = team.eventPoints.find((entry) => entry.eventKey === DCMP);
        if (row === undefined || row.alliance <= 0) continue;
        const base = row.alliance / 3;
        const allianceNumber = base >= 9 ? 17 - base : base;
        const list = picks.get(allianceNumber) ?? [];
        if (base >= 9) list.unshift(team.teamKey);
        else list.push(team.teamKey);
        picks.set(allianceNumber, list);
      }
      const alliances = [...picks.entries()].sort((a, b) => a[0] - b[0]).map(([allianceNumber, list]) => ({ allianceNumber, picks: list }));
      expect(alliances.map((alliance) => alliance.picks.length)).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);

      const eventKeys = new Set<string>();
      for (const team of FIXTURE.teams) for (const row of team.eventPoints) eventKeys.add(row.eventKey);
      const stageByEvent = new Map([...eventKeys].map((key) => [key, key === DCMP ? PLAYOFFS_OPEN : ALL_FINAL] as const));
      const params = {
        ...common,
        requests: requestOf(DCMP, "dcmp", playedThrough(8), alliances),
        eventArtifacts: new Map([[DCMP, artifactOf(rowsThrough(8, DCMP, alliances), alliances)]]),
        stageByEvent,
        live: false,
      };
      // THE RUN LANDED: the run's own entry, with its milestones. (Its team records do not enter a status.)
      const landedMap = new Map<string, DistrictEventDistributions>([[DCMP, { eventKey: DCMP, byTeam: new Map(), playoffMilestoneByTeam: dcmpBracketMilestonesByTeam(alliances, playedThrough(8)) }]]);
      attachRequestFacts(landedMap, params);
      // A NEW RUN IN FLIGHT: no entry at all.
      const inFlightMap = new Map<string, DistrictEventDistributions>();
      attachRequestFacts(inFlightMap, params);

      const statusesOf = (distributions: ReadonlyMap<string, DistrictEventDistributions>) => {
        const rows = buildChampLedgerRows({ artifact: FIXTURE, distributions, stageByEvent, dcmpStarted: true });
        return computeChampLedgerStatuses({ artifact: FIXTURE, teams: rows.teams, nowYear: SEASON, distributions });
      };
      const view = (model: ReturnType<typeof statusesOf>) => [...model.byTeam.values()].map((result) => [result.teamKey, result.status, result.lockedBy ?? null] as const).sort(([a], [b]) => a.localeCompare(b));
      const landed = statusesOf(landedMap);
      const inFlight = statusesOf(inFlightMap);
      expect(landed.jointProof?.applied).toBe(true);
      expect(inFlight.jointProof?.applied).toBe(true);
      expect(view(inFlight)).toEqual(view(landed));
      expect(inFlight.floorByTeam).toEqual(landed.floorByTeam);
      // It bites: teams are Locked by the joint proof alone here, and with the map a run in flight left before this
      // task (nothing for the key) the proof does not run and not one of them is Locked.
      const jointAlone = view(landed).filter(([, status, lockedBy]) => status === "locked" && lockedBy === "joint").map(([teamKey]) => teamKey);
      expect(jointAlone.length).toBeGreaterThan(0);
      const before = statusesOf(new Map());
      expect(before.jointProof?.applied).toBe(false);
      for (const teamKey of jointAlone) expect(before.byTeam.get(teamKey)?.status, teamKey).not.toBe("locked");
      // The credit is in both maps: alliance 1 and alliance 2 hold 13 x 3 after sf7 and sf8.
      expect(asObject(inFlightMap.get(DCMP)!.securedElimByTeam)).toEqual(asObject(landedMap.get(DCMP)!.securedElimByTeam));
      expect(Object.values(asObject(inFlightMap.get(DCMP)!.securedElimByTeam)!)).toEqual([39, 39, 39, 39, 39, 39]);
    });

    it("rows built from an entry with no team record price no cell: every cell that had no number without the entry still has none", () => {
      // One district event under way for its 24 listed robots, nothing posted for it yet.
      const teams = ALLIANCES.flatMap((alliance) => alliance.picks).map((teamKey, index) => ({
        teamKey,
        teamNumber: Number(teamKey.replace("frc", "")),
        nickname: teamKey,
        rank: index + 1,
        pointTotal: 0,
        rookieBonus: 0,
        adjustments: 0,
        eventPoints: [],
        remainingEvents: [{ eventKey: EVENT, eventName: "Hand Built", week: 1, tier: "district" as const, maxPoints: 83, state: { qualMatchesPlayed: 12, qualMatchesTotal: 12, alliancesPicked: true, playoffsDone: false, awardsPosted: false } }],
        maxRemainingDistrict: 83,
        maxRemainingChamp: 83,
        qualifyingAwards: [],
        awardProfile: { bucket: "none" as const, rookie: false },
        districtLock: { status: "contending" as const, pointsToLock: 5, threatCount: 1, cutLinePoints: 20, allocationNote: null },
        champLock: { status: "contending" as const, pointsToLock: 5, threatCount: 1, cutLinePoints: 40, allocationNote: null },
      }));
      const artifact: DistrictArtifact = DistrictArtifactSchema.parse({
        schemaVersion: 1,
        generation: "gen-1",
        computedAt: "2026-09-25T00:00:00.000Z",
        districtKey: "2026pnw",
        year: SEASON,
        abbreviation: "pnw",
        displayName: "Pacific Northwest",
        dcmpSlots: 12,
        cmpSlots: 4,
        teams,
        insights: { teamCount: teams.length, eventCount: 1, dcmpCutLinePoints: 0, cmpCutLinePoints: 0, districtLockedCount: 0, districtEliminatedCount: 0, champLockedCount: 0, champEliminatedCount: 0 },
      });
      const map = new Map<string, DistrictEventDistributions>();
      attachRequestFacts(map, { ...common, requests: requestOf(EVENT, "district", playedThrough(7)), eventArtifacts: new Map([[EVENT, artifactOf(rowsThrough(7))]]), stageByEvent: stageOpen, live: false });
      const stageByEvent = new Map([[EVENT, PLAYOFFS_OPEN]]);
      const bare = buildDistrictLedgerRows({ artifact, distributions: new Map(), stageByEvent });
      const attached = buildDistrictLedgerRows({ artifact, distributions: map, stageByEvent });
      let cells = 0;
      let settledByTheBracket = 0;
      for (const team of attached.teams) {
        const before = bare.teams.find((entry) => entry.teamKey === team.teamKey)!;
        const row = team.rows.find((entry) => entry.eventKey === EVENT)!;
        const rowBefore = before.rows.find((entry) => entry.eventKey === EVENT)!;
        row.cells.forEach((cell, index) => {
          cells += 1;
          const cellBefore = rowBefore.cells[index]!;
          // No run has landed: no cell is an open cell with a distribution, with the entry or without it.
          expect(cell.kind).not.toBe("open");
          if (cell.cell === "elim" && cell.kind === "final") {
            // The one thing the entry adds to a cell: a knocked out alliance's Playoffs are settled grey, a fact of
            // the bracket the request carries, where a run in flight left them without a number before.
            settledByTheBracket += 1;
            expect(row.settledElim).toBeDefined();
            return;
          }
          expect(cell).toEqual(cellBefore);
        });
        expect(row.eventTotal.kind).toBe(rowBefore.eventTotal.kind);
        expect(team.grandTotal.kind).toBe(before.grandTotal.kind);
      }
      expect(cells).toBe(24 * 4);
      // After sf7 the bracket has decided alliances 7 and 8, which lost twice: six robots.
      expect(settledByTheBracket).toBe(6);
      // And the rows carry the credit for the lock math, with no cell to print it on yet.
      const credited = attached.teams.filter((team) => team.rows[0]!.securedElim !== undefined).map((team) => [team.teamKey, team.rows[0]!.securedElim] as const);
      expect(Object.fromEntries(credited.sort(([a], [b]) => a.localeCompare(b)))).toEqual(ALLIANCE_ONE);
    });

    it("at the live position reads the secured minimums off every loaded event artifact, request or not, an event that reads final included, and never an event with an unresolved playoff row", () => {
      const UNDER_WAY = "2026waone";
      const FINISHED = "2026watwo";
      const UNRESOLVED = "2026wathr";
      const eventArtifacts = new Map([
        // Under way, with a request conditioned on the rows through sf7. The artifact already holds sf8.
        [UNDER_WAY, artifactOf(rowsThrough(8, UNDER_WAY))],
        // Every category reads final at Now and there is no request for it at all.
        [FINISHED, artifactOf(rowsThrough(8, FINISHED))],
        // A playoff row the tab could not place on two alliances.
        [UNRESOLVED, artifactOf(rowsThrough(8, UNRESOLVED))],
      ]);
      const stageByEvent = new Map([
        [UNDER_WAY, PLAYOFFS_OPEN],
        [FINISHED, ALL_FINAL],
        [UNRESOLVED, PLAYOFFS_OPEN],
      ]);
      const tierByEvent = new Map([
        [UNDER_WAY, "district" as const],
        [FINISHED, "dcmp" as const],
        [UNRESOLVED, "district" as const],
      ]);
      const requests = requestOf(UNDER_WAY, "district", playedThrough(7));
      const live = new Map<string, DistrictEventDistributions>();
      attachRequestFacts(live, { season: SEASON, requests, eventArtifacts, stageByEvent, unresolvedEventKeys: new Set([UNRESOLVED]), live: true, tierByEvent });
      // Now sees every row: sf8 too, which the request was not conditioned on.
      expect(asObject(live.get(UNDER_WAY)!.securedElimByTeam)).toEqual({ ...ALLIANCE_ONE, ...ALLIANCE_TWO });
      expect(live.get(UNDER_WAY)!.securedElimByTeam).toEqual(securedElimByTeamFor(eventArtifacts.get(UNDER_WAY)!, SEASON, "district"));
      expect(live.get(UNDER_WAY)!.playoffMilestoneByTeam).toEqual(dcmpBracketMilestonesByTeam(ALLIANCES, playedThrough(7)));
      // No request, every category final: still credited, at the tier it is named at, on an entry with no team record.
      expect(asObject(live.get(FINISHED)!.securedElimByTeam)).toEqual({ frc101: 39, frc102: 39, frc103: 39, frc201: 39, frc202: 39, frc203: 39 });
      expect(live.get(FINISHED)!.byTeam.size).toBe(0);
      expect(Object.keys(live.get(FINISHED)!).sort()).toEqual(["byTeam", "eventKey", "securedElimByTeam"]);
      // An unresolved playoff row: nothing.
      expect(live.has(UNRESOLVED)).toBe(false);

      // AT A REWOUND STOP the same call reads the request only: the rows at or before its cut, and no event without one.
      const rewound = new Map<string, DistrictEventDistributions>();
      attachRequestFacts(rewound, { season: SEASON, requests, eventArtifacts, stageByEvent, unresolvedEventKeys: new Set([UNRESOLVED]), live: false, tierByEvent });
      expect(asObject(rewound.get(UNDER_WAY)!.securedElimByTeam)).toEqual(ALLIANCE_ONE);
      expect(rewound.has(FINISHED)).toBe(false);
      expect(rewound.has(UNRESOLVED)).toBe(false);
    });

    it("NO TIER ENTRY, NO CREDIT: at the live position an event artifact the tier map does not name is credited nothing, never the district tier by default (CONTEXT D7)", () => {
      const NAMED = "2026waone";
      const UNNAMED = "2026watwo";
      const eventArtifacts = new Map([
        [NAMED, artifactOf(rowsThrough(8, NAMED))],
        [UNNAMED, artifactOf(rowsThrough(8, UNNAMED))],
      ]);
      const base = { season: SEASON, requests: [], eventArtifacts, stageByEvent: new Map<string, DistrictStageFinality>(), unresolvedEventKeys: new Set<string>(), live: true };
      // The control: both would be credited by the pay rule at the district tier.
      for (const key of [NAMED, UNNAMED]) expect(securedElimByTeamFor(eventArtifacts.get(key)!, SEASON, "district").size).toBe(6);

      const oneNamed = new Map<string, DistrictEventDistributions>();
      attachRequestFacts(oneNamed, { ...base, tierByEvent: new Map([[NAMED, "district" as const]]) });
      expect(asObject(oneNamed.get(NAMED)!.securedElimByTeam)).toEqual({ ...ALLIANCE_ONE, ...ALLIANCE_TWO });
      expect(oneNamed.has(UNNAMED)).toBe(false);

      // No tier map at all, and an empty one: nobody is credited and no entry is made up.
      for (const tierByEvent of [undefined, new Map<string, "district" | "dcmp">()]) {
        const none = new Map<string, DistrictEventDistributions>();
        attachRequestFacts(none, { ...base, ...(tierByEvent === undefined ? {} : { tierByEvent }) });
        expect(none.size).toBe(0);
      }

      // An event with a REQUEST and no tier entry keeps its milestones, which need no tier, and is still credited nothing.
      const withRequest = new Map<string, DistrictEventDistributions>();
      attachRequestFacts(withRequest, { ...base, requests: requestOf(UNNAMED, "district", playedThrough(7)), stageByEvent: new Map([[UNNAMED, PLAYOFFS_OPEN]]) });
      expect(withRequest.get(UNNAMED)!.playoffMilestoneByTeam!.size).toBe(24);
      expect(withRequest.get(UNNAMED)!.securedElimByTeam).toBeUndefined();
      // And a landed entry there is left exactly as it is.
      const landed: DistrictEventDistributions = { eventKey: UNNAMED, byTeam: new Map(), playoffMilestoneByTeam: new Map() };
      const kept = new Map([[UNNAMED, landed]]);
      attachRequestFacts(kept, { ...base });
      expect(kept.get(UNNAMED)).toBe(landed);
    });
  });
});

describe("every DCMP tier request carries a DCMP award slate (quick task 261014-i8i)", () => {
  const DIST = "2026wadist";
  const DCMP = "2026pncmp";
  const roster = Array.from({ length: 24 }, (_unused, i) => `frc${String(500 + i)}`);
  /** frc500 won Impact and frc501 Engineering Inspiration at the district event; frc510 won nothing anywhere. */
  const IMPACT_WINNER = "frc500";
  const EI_WINNER = "frc501";
  const INELIGIBLE = "frc510";
  const pmf = [0.25, 0.25, 0.25, 0.25];

  const eventArtifact: EventArtifact = EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "7.0.0+rolling",
    eventKey: DCMP,
    season: 2026,
    matches: Array.from({ length: 4 }, (_unused, i) => ({
      matchKey: `${DCMP}_qm${String(i + 1)}`,
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
    upcoming: [],
    teams: roster.map((teamKey, i) => ({
      teamKey,
      teamNumber: 500 + i,
      rank: i + 1,
      record: { wins: 2, losses: 2, ties: 0 },
      rp: 2,
      metrics: { total: { value: 90 - i }, sigma: { value: 8 } },
    })),
  });

  const POSTED = { qualMatchesPlayed: 40, qualMatchesTotal: 40, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
  const districtArtifact: DistrictArtifact = DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    districtKey: "2026pnw",
    year: 2026,
    abbreviation: "pnw",
    displayName: "Pacific Northwest",
    dcmpSlots: 24,
    cmpSlots: 4,
    teams: roster.map((teamKey, i) => ({
      teamKey,
      teamNumber: 500 + i,
      nickname: `Nickname ${teamKey}`,
      rank: i + 1,
      pointTotal: 40,
      rookieBonus: 0,
      adjustments: 0,
      eventPoints: [{ eventKey: DIST, eventName: "District Event", week: 2, tier: "district", qual: 20, alliance: 10, elim: 10, award: 0, total: 40, state: POSTED }],
      remainingEvents: [{ eventKey: DCMP, eventName: "Championship", week: 5, tier: "dcmp", maxPoints: 249 }],
      maxRemainingDistrict: 0,
      maxRemainingChamp: 249,
      qualifyingAwards:
        teamKey === IMPACT_WINNER
          ? [{ eventKey: DIST, awardType: 0, label: "Impact", awardOnly: false }]
          : teamKey === EI_WINNER
            ? [{ eventKey: DIST, awardType: 9, label: "Engineering Inspiration", awardOnly: false }]
            : [],
      districtLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 20, allocationNote: null },
      champLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 40, allocationNote: null },
      awardProfile: { bucket: "none", rookie: false },
    })),
    insights: { teamCount: roster.length, eventCount: 2, dcmpCutLinePoints: 40, cmpCutLinePoints: 80, districtLockedCount: 0, districtEliminatedCount: 0, champLockedCount: 0, champEliminatedCount: 0 },
  });

  const ALL_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };
  const QUAL_DONE: DistrictStageFinality = { qual: true, alliance: false, elim: false, award: false };
  const stageByEvent = new Map<string, DistrictStageFinality>([
    [DIST, ALL_FINAL],
    [DCMP, QUAL_DONE],
  ]);
  const tierByEvent = new Map<string, "district" | "dcmp">([
    [DIST, "district"],
    [DCMP, "dcmp"],
  ]);
  const eventArtifacts = new Map<string, EventArtifact>([[DCMP, eventArtifact]]);

  /** Holds the slate to the fixture's facts: the two winners in, the ineligible team out. */
  function expectFixtureSlate(input: DistrictLedgerEventInput, role: string): void {
    const slate = input.dcmpAwardSlate;
    expect(slate).toBeDefined();
    expect(slate!.role).toBe(role);
    const byTeam = new Map(slate!.eligibility.map((entry) => [entry.teamKey, entry] as const));
    expect(byTeam.get(IMPACT_WINNER)).toEqual({ teamKey: IMPACT_WINNER, impact: 1, engineeringInspiration: 0, rookieAllStar: 0 });
    expect(byTeam.get(EI_WINNER)).toEqual({ teamKey: EI_WINNER, impact: 0, engineeringInspiration: 1, rookieAllStar: 0 });
    expect(byTeam.has(INELIGIBLE)).toBe(false);
    expect(slate!.eligibility).toHaveLength(2);
  }

  it("the Live assembly's DCMP request carries one, and its signature folds it", () => {
    const assembled = assembleLiveDistrictEvents({ artifact: districtArtifact, activeKeys: [DCMP], eventArtifacts, stageByEvent, tierByEvent });
    expect(assembled.events).toHaveLength(1);
    expectFixtureSlate(assembled.events[0]!.input, "single");
    expect(assembled.signature).toContain("|dcmpSlate=single:");
  });

  it("a district tier request from the same assembly carries none", () => {
    const assembled = assembleLiveDistrictEvents({ artifact: districtArtifact, activeKeys: [DCMP], eventArtifacts, stageByEvent });
    expect(assembled.events).toHaveLength(1);
    expect("dcmpAwardSlate" in assembled.events[0]!.input).toBe(false);
    expect(assembled.signature).not.toContain("dcmpSlate=");
  });

  const planned = (plan: Record<string, unknown>): AsOfRewindResult =>
    ({
      status: "ready",
      cutId: "cut-1",
      events: new Map([[DCMP, { status: "ready", state: { plan, season: 2026, vars: [], league: [], teams: roster.map((teamKey) => [teamKey, []]) } }]]),
    }) as unknown as AsOfRewindResult;
  const realPlan = planned({
    mode: "real",
    eventKey: DCMP,
    tier: "dcmp",
    roster,
    rows: [],
    baselines: roster.map((teamKey) => ({ teamKey, earnedRpSum: 8, matchesPlayed: 4 })),
    playedPlayoffMatchKeys: [],
  });
  const generatedPlan = planned({
    mode: "generated",
    eventKey: DCMP,
    tier: "dcmp",
    roster,
    bake: { districtKey: "2026pnw", eventType: 2, week: 5, matchesPerTeam: 12 },
  });

  it("a rewound stop's REAL and GENERATED DCMP requests each carry one, read at the stop's own stage", () => {
    for (const result of [realPlan, generatedPlan]) {
      const assembled = assembleAsOfDistrictEvents({ artifact: districtArtifact, result, algorithmVersion: "7.0.0+rolling", eventArtifacts, stageByEvent, tierByEvent, candidateKeys: [DCMP] });
      expect(assembled.asOfUnavailable).toEqual([]);
      expect(assembled.events).toHaveLength(1);
      expectFixtureSlate(assembled.events[0]!.input, "single");
    }
    // At a stop where the district event's awards are still open, nobody HOLDS an award: every team that entered there carries a pending chance.
    const open = new Map<string, DistrictStageFinality>([
      [DIST, QUAL_DONE],
      [DCMP, QUAL_DONE],
    ]);
    const rewound = assembleAsOfDistrictEvents({ artifact: districtArtifact, result: realPlan, algorithmVersion: "7.0.0+rolling", eventArtifacts, stageByEvent: open, tierByEvent, candidateKeys: [DCMP] });
    const slate = rewound.events[0]!.input.dcmpAwardSlate!;
    expect(slate.eligibility).toHaveLength(roster.length);
    for (const entry of slate.eligibility) expect(entry.impact, entry.teamKey).toBeCloseTo(1 / roster.length, 12);
    // ... and the stage change moves the signature, so the event re-runs.
    const atFinal = assembleAsOfDistrictEvents({ artifact: districtArtifact, result: realPlan, algorithmVersion: "7.0.0+rolling", eventArtifacts, stageByEvent, tierByEvent, candidateKeys: [DCMP] });
    expect(rewound.signature).not.toBe(atFinal.signature);
  });

  it("the simulated DCMP bake carries a whole championship slate read at the stop", () => {
    const assembled = assembleSimulatedDcmpBake({ artifact: districtArtifact, result: generatedPlan, algorithmVersion: "7.0.0+rolling", eventKey: DCMP, roster, stageByEvent });
    if (assembled.status !== "ready") throw new Error(`expected a ready bake, got ${assembled.status}`);
    expectFixtureSlate(assembled.request.input, "wholeChampionship");
    expect(assembled.signature).toContain("|dcmpSlate=wholeChampionship:");
  });

  it("the Worker protocol accepts a slate as plain data and refuses a malformed one", () => {
    const assembled = assembleLiveDistrictEvents({ artifact: districtArtifact, activeKeys: [DCMP], eventArtifacts, stageByEvent, tierByEvent });
    const message = (events: readonly DistrictSimulationEventRequest[]) => ({ type: "run", events, draws: 10, seed: 1 });
    expect(isDistrictSimulationRequest(structuredClone(message(assembled.events)))).toBe(true);
    const event = assembled.events[0]!;
    const slate = event.input.dcmpAwardSlate!;
    const broken = [
      { ...slate, role: "district" },
      { ...slate, expected: { ...slate.expected, judged: -1 } },
      { ...slate, eligibility: [{ teamKey: "", impact: 1, engineeringInspiration: 0, rookieAllStar: 0 }] },
      { ...slate, eligibility: "everyone" },
    ];
    for (const bad of broken) expect(isDistrictSimulationRequest(message([{ ...event, input: { ...event.input, dcmpAwardSlate: bad as never } }]))).toBe(false);
  });
});
