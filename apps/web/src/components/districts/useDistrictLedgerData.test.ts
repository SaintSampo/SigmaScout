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
import type { DistrictSimulationEventRequest } from "../../workers/districtSimulationProtocol.js";
import type { AllianceMemberRating } from "../../../../../packages/core/algorithms/simulation/allianceWinProbability.js";
import type {
  DistrictAwardProfile,
  DistrictLedgerEventInput,
} from "../../../../../packages/core/districts/ledgerSimulation.js";

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
