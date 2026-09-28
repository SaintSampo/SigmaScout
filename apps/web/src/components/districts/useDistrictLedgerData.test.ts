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
import { districtRunSignature } from "./useDistrictLedgerData.js";
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
