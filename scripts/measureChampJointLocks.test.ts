/**
 * The FNC 2026 pins for the Champ Locks joint worst case lock proof (quick
 * task 261009-2tr, CONTEXT D5), through the sweep's own `dcmpStops` and
 * `statusesAtStop`, so the pinned sets are exactly what the tab computes.
 *
 * Gated on the local district artifact
 * (`data/local-publish/districts/v1__district__2026fnc.json`, gitignored): it
 * skips with a message when absent, never a silent pass. No corpus is needed:
 * the 2026nccmp alliances and played playoff rows are written out below, from
 * `data/corpus.sqlite` as the plan recorded them.
 *
 * The values are the planner's independent reproduction of CONTEXT D2 with its
 * readings. If the implementation ever differs, check the inputs first (floors
 * at Round 5, C 6, K 14, one award per team, placement values 75, 39 and 21,
 * alive alliances 1 and 2) and never change the proof to meet a pin.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "../packages/harness/pageArtifacts.js";
import { jointLockBound } from "../packages/core/districts/champJointLock.js";
import type { BracketSourceEvent } from "../apps/web/src/components/districts/districtLedgerRows.js";
import { dcmpStops, statusesAtStop } from "./measureChampJointLocks.js";

const FNC_PATH = "data/local-publish/districts/v1__district__2026fnc.json";
const FNC_AVAILABLE = existsSync(FNC_PATH);

/** 2026nccmp's alliances in TBA pick order; a fourth pick is a backup robot. */
const FNC_ALLIANCES: readonly { allianceNumber: number; picks: string[] }[] = [
  { allianceNumber: 1, picks: ["frc9496", "frc9032", "frc8205", "frc6004"] },
  { allianceNumber: 2, picks: ["frc4795", "frc4561", "frc7763", "frc6639"] },
  { allianceNumber: 3, picks: ["frc6500", "frc3506", "frc5160"] },
  { allianceNumber: 4, picks: ["frc2724", "frc1533", "frc6894"] },
  { allianceNumber: 5, picks: ["frc4828", "frc8738", "frc3229", "frc11179"] },
  { allianceNumber: 6, picks: ["frc7890", "frc8429", "frc8727"] },
  { allianceNumber: 7, picks: ["frc4829", "frc2059", "frc4534"] },
  { allianceNumber: 8, picks: ["frc4935", "frc6502", "frc7918"] },
];

/** (match key suffix, red alliance, blue alliance, winner). */
const FNC_ROWS: readonly (readonly [string, number, number, "red" | "blue"])[] = [
  ["sf1m1", 1, 8, "red"],
  ["sf2m1", 4, 5, "red"],
  ["sf3m1", 2, 7, "red"],
  ["sf4m1", 3, 6, "blue"],
  ["sf5m1", 8, 5, "blue"],
  ["sf6m1", 7, 3, "blue"],
  ["sf7m1", 1, 4, "blue"],
  ["sf8m1", 2, 6, "red"],
  ["sf9m1", 1, 3, "red"],
  ["sf10m1", 6, 5, "red"],
  ["sf11m1", 4, 2, "blue"],
  ["sf12m1", 6, 1, "blue"],
  ["sf13m1", 4, 1, "blue"],
  ["f1m1", 2, 1, "red"],
  ["f1m2", 2, 1, "red"],
];

function fncBracket(): BracketSourceEvent {
  const firstThree = (allianceNumber: number): string[] => FNC_ALLIANCES[allianceNumber - 1]!.picks.slice(0, 3);
  return {
    alliances: FNC_ALLIANCES,
    matches: FNC_ROWS.map(([suffix, red, blue, winner]) => {
      const parsed = /^(sf|f)(\d+)m(\d+)$/.exec(suffix)!;
      return {
        matchKey: `2026nccmp_${suffix}`,
        compLevel: parsed[1]!,
        setNumber: Number(parsed[2]),
        matchNumber: Number(parsed[3]),
        redTeams: firstThree(red),
        blueTeams: firstThree(blue),
        actualWinner: winner,
      };
    }),
  };
}

describe("measureChampJointLocks: the FNC 2026 pins (D5)", () => {
  if (!FNC_AVAILABLE) {
    it.skip(`skipped: ${FNC_PATH} is absent (gitignored local publish output)`, () => {});
    return;
  }
  const artifact: DistrictArtifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(FNC_PATH, "utf8")));
  const bracket = fncBracket();
  const stops = dcmpStops(artifact, bracket);
  const stopNamed = (label: string) => {
    const stop = stops.find((entry) => entry.label === label);
    if (stop === undefined) throw new Error(`no ${label} stop`);
    return stop;
  };
  const finalStatus = new Map(artifact.teams.map((team) => [team.teamKey, team.champLock.status] as const));

  it("builds every stop of D4", () => {
    expect(stops.map((stop) => stop.label)).toEqual([
      "Alliances final",
      "Round 1",
      "Round 2",
      "Round 3",
      "Round 4",
      "Round 5",
      "Playoffs final, awards open",
      "Now",
    ]);
  });

  it("Round 5: 15 points slots, and the joint proof locks exactly frc2724, frc9496, frc9032, frc4795 and frc3506", () => {
    const model = statusesAtStop(artifact, stopNamed("Round 5"), bracket, true);
    expect(model.pointsSlots).toBe(15);
    expect(model.jointProof?.applied).toBe(true);
    if (model.jointProof?.applied !== true || model.jointProof.shape === "multiple") return;
    const input = model.jointProof.input;
    expect(input.placementPoints).toEqual([75, 39, 21]);
    expect(input.consumingAwards).toBe(6);
    expect(input.judgedAwards).toBe(14);
    expect(input.aliveAlliances).toEqual([1, 2]);
    expect([...model.jointProof.locked].sort()).toEqual(["frc2724", "frc3506", "frc4795", "frc9032", "frc9496"]);
    const jointByLockedBy = [...model.byTeam.values()].filter((result) => result.lockedBy?.includes("joint") === true).map((result) => result.teamKey).sort();
    expect(jointByLockedBy).toEqual(["frc2724", "frc3506", "frc4795", "frc9032", "frc9496"]);
    const bounds = Object.fromEntries(
      ["frc2724", "frc9496", "frc9032", "frc4795", "frc3506", "frc4561", "frc8429", "frc1533", "frc7890", "frc6500"].map((teamKey) => [teamKey, jointLockBound(input, teamKey)])
    );
    expect(bounds).toEqual({
      frc2724: 12,
      frc9496: 12,
      frc9032: 12,
      frc4795: 14,
      frc3506: 14,
      frc4561: 16,
      frc8429: 17,
      frc1533: 18,
      frc7890: 18,
      frc6500: 18,
    });
  });

  it("Playoffs final with awards open: 11 points slots, joint locks exactly frc9496, frc9032, frc2724 and frc3506, and not frc7890", () => {
    const model = statusesAtStop(artifact, stopNamed("Playoffs final, awards open"), bracket, true);
    expect(model.pointsSlots).toBe(11);
    expect(model.jointProof?.applied).toBe(true);
    if (model.jointProof?.applied !== true || model.jointProof.shape === "multiple") return;
    const input = model.jointProof.input;
    expect([...model.jointProof.locked].sort()).toEqual(["frc2724", "frc3506", "frc9032", "frc9496"]);
    for (const teamKey of ["frc9496", "frc9032", "frc2724", "frc3506"]) {
      expect(model.byTeam.get(teamKey)!.lockedBy?.endsWith("joint"), teamKey).toBe(true);
    }
    expect({
      frc9496: jointLockBound(input, "frc9496"),
      frc9032: jointLockBound(input, "frc9032"),
      frc2724: jointLockBound(input, "frc2724"),
      frc3506: jointLockBound(input, "frc3506"),
    }).toEqual({ frc9496: 7, frc9032: 7, frc2724: 8, frc3506: 10 });
    for (const teamKey of ["frc8429", "frc1533", "frc7890", "frc6500"]) {
      expect(model.jointProof.locked.has(teamKey), teamKey).toBe(false);
      expect(jointLockBound(input, teamKey), teamKey).toBe(13);
    }
  });

  it("at every stop, every joint locked team qualified at Now, frc6500 is never joint locked, and nothing is a violation", () => {
    expect(finalStatus.get("frc6500")).toBe("eliminated");
    for (const stop of stops) {
      const model = statusesAtStop(artifact, stop, bracket, true);
      const locked = model.jointProof?.applied === true ? [...model.jointProof.locked] : [];
      for (const teamKey of locked) expect(["locked", "lockedAward"], `${stop.label} ${teamKey}`).toContain(finalStatus.get(teamKey));
      expect(locked, stop.label).not.toContain("frc6500");
      for (const result of model.byTeam.values()) {
        if (result.status !== "locked" || result.byAward) continue;
        expect(["locked", "lockedAward"], `${stop.label} ${result.teamKey}`).toContain(finalStatus.get(result.teamKey));
      }
    }
  });
});
