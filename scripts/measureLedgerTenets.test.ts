/**
 * Two describes: the first pure and synthetic, running everywhere including CI;
 * the second corpus-guarded with `existsSync` plus an explicit `it.skip`.
 *
 * THE SINGLE MOST IMPORTANT ASSERTION IN THE PURE HALF is the CORRUPTED
 * fixture. A tenet checker that cannot be made to fail is indistinguishable
 * from a checker that always prints zero, and "zero violations" is exactly the
 * output a silently broken sweep produces — an empty position list, a status
 * map that never resolves a team, a comparison against a set built from the
 * wrong field. So the good fixture proves the sweep really does display
 * `Locked` and `Locked out`, and the corrupted one — the same artifact with two
 * final verdicts deliberately flipped — proves each tenet fails when it should.
 *
 * THE SECOND MOST IMPORTANT is the AWARD fixture. Scoring a `lockedAward`
 * finish as "failed to qualify on points" would have reported 7,094 violations
 * against the real corpus instead of 13, burying the one real defect under
 * seven thousand teams that went to the district championship on an Impact
 * award. That definition choice is pinned here as its own case rather than
 * left to the script's prose.
 *
 * The corpus half asserted ZERO tenet-B violations and pinned tenet A at its
 * measured 13, itemised. Quick task 260925-ms7 then held one points slot back
 * for every district-tier event whose Impact award is still to come, and BOTH
 * NUMBERS ARE NOW ZERO. The thirteen triples are kept as
 * `FIXED_TENET_A_VIOLATION_ROWS` and read back as an assertion — each of the
 * exact positions that used to fail is swept again and must come back clean,
 * so a regression cannot hide behind a headline count.
 *
 * ZERO VIOLATIONS IS ALSO WHAT A SILENTLY BROKEN SWEEP PRINTS, which is why
 * the reserved-slot totals are pinned as floors beside them: a reservation
 * that stopped firing, or a sweep that stopped visiting positions, fails on
 * those rather than passing quietly.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_ARTIFACT_SCHEMA_VERSION, type DistrictArtifact } from "../packages/harness/pageArtifacts.js";
import type { LockStatus } from "../packages/core/districts/locks.js";
import {
  LOCAL_DISTRICT_DIR,
  censusOf,
  loadDistrictArtifacts,
  outcomeForLockedOutShown,
  outcomeForLockedShown,
  sweepDistrict,
} from "./measureLedgerTenets.js";

// ---------------------------------------------------------------------------
// The measured answer, 2026-09-25, over data/local-publish/districts
// ---------------------------------------------------------------------------

export const MEASURED_SEASONS = 109;
export const MEASURED_INDEX_FILES = 10;
export const MEASURED_SKIPPED_NO_CAPACITY = 0;
export const MEASURED_POSITIONS = 4022;
export const MEASURED_TEAM_POSITIONS = 921_658;
/** 138,702 before 260925-ms7 held a slot back; 8,197 of those displays moved off `Locked`. */
export const MEASURED_LOCKED_SHOWN = 130_505;
/** Unchanged by the reservation, which is the point: it reaches the `Locked` test alone. */
export const MEASURED_LOCKED_OUT_SHOWN = 190_854;
export const MEASURED_LOCKED_AWARD_CHIP_SHOWN = 24_192;
export const MEASURED_TENET_A_VIOLATIONS = 0;
export const MEASURED_TENET_B_VIOLATIONS = 0;
/** Slots held back across the whole sweep, and the positions that held at least one. Pinned as floors so a reservation that silently stopped firing fails here. */
export const MEASURED_RESERVED_SLOTS_TOTAL = 26_604;
export const MEASURED_POSITIONS_WITH_RESERVED_SLOTS = 3_804;

/**
 * The thirteen tenet-A violations 260925-ma5 measured, kept as the RECORD of
 * what was fixed rather than as an expectation. Every one of them sat on a
 * `playoffs` step, where an event's playoffs were decided and its Impact award
 * was not yet posted; 260925-ms7 holds a slot back at exactly those positions
 * and the corpus test below asserts there are now none at all.
 */
export const FIXED_TENET_A_VIOLATION_ROWS: readonly string[] = [
  "2020fnc/frc4795/2020ncash:playoffs",
  "2020pch/frc5219/2020gaalb:playoffs",
  "2020pch/frc5632/2020gaalb:playoffs",
  "2020pch/frc7514/2020gaalb:playoffs",
  "2020pnw/frc1432/2020wabel:playoffs",
  "2020pnw/frc1510/2020wabel:playoffs",
  "2020pnw/frc1432/2020wayak:playoffs",
  "2020pnw/frc1510/2020wayak:playoffs",
  "2020pnw/frc1432/2020orsal:playoffs",
  "2020pnw/frc1510/2020orsal:playoffs",
  "2020pnw/frc1432/2020waahs:playoffs",
  "2020pnw/frc1510/2020waahs:playoffs",
  "2025fnc/frc3229/2025ncpem:playoffs",
];

// ---------------------------------------------------------------------------
// The synthetic district
// ---------------------------------------------------------------------------

const FINISHED_EVENT_STATE = {
  qualMatchesPlayed: 60,
  qualMatchesTotal: 60,
  alliancesPicked: true,
  playoffsDone: true,
  awardsPosted: true,
} as const;

const NO_LOCK = {
  status: "contending",
  pointsToLock: null,
  threatCount: 0,
  cutLinePoints: null,
  allocationNote: null,
} as const;

/**
 * One district, one finished event, three teams, ONE dcmp slot.
 *
 * The numbers are chosen so that the `playoffs` step — where qualification,
 * alliance selection and playoffs are all decided but the award category is
 * still open — is the first position at which the pure points math can say
 * anything at all, so the fixture exercises `Locked` and `Locked out` together
 * rather than only one of them.
 */
function syntheticDistrict(finalStatuses: Readonly<Record<string, LockStatus>>): DistrictArtifact {
  const team = (teamKey: string, rank: number, qual: number, alliance: number, elim: number): DistrictArtifact["teams"][number] => {
    const total = qual + alliance + elim;
    return {
      teamKey,
      teamNumber: Number(teamKey.slice(3)),
      nickname: `Team ${teamKey.slice(3)}`,
      rank,
      pointTotal: total,
      rookieBonus: 0,
      adjustments: 0,
      eventPoints: [
        {
          eventKey: "9999zz1",
          eventName: "ZZ District Test Event",
          week: 1,
          tier: "district",
          qual,
          alliance,
          elim,
          award: 0,
          total,
          state: { ...FINISHED_EVENT_STATE },
        },
      ],
      remainingEvents: [],
      maxRemainingDistrict: 0,
      maxRemainingChamp: 0,
      qualifyingAwards: [],
      districtLock: { ...NO_LOCK, status: finalStatuses[teamKey] ?? "contending" },
      champLock: { ...NO_LOCK },
    };
  };

  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "test",
    computedAt: "2026-09-25T00:00:00.000Z",
    districtKey: "9999zz",
    year: 2026,
    abbreviation: "zz",
    displayName: "ZZ Test District",
    dcmpSlots: 1,
    cmpSlots: 1,
    teams: [team("frc1", 1, 20, 16, 30), team("frc2", 2, 10, 0, 0), team("frc3", 3, 5, 0, 0)],
    insights: {
      teamCount: 3,
      eventCount: 1,
      dcmpCutLinePoints: null,
      cmpCutLinePoints: null,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
  };
}

/** The honest finish: frc1 took the single slot on points, the other two did not. */
const HONEST_FINISH = { frc1: "locked", frc2: "eliminated", frc3: "eliminated" } as const;

describe("measureLedgerTenets — pure", () => {
  it("scores a Locked display against every final verdict, and treats lockedAward as indeterminate rather than as a failure", () => {
    expect(outcomeForLockedShown("locked")).toBe("kept");
    expect(outcomeForLockedShown("lockedAward")).toBe("award-qualified-at-now");
    expect(outcomeForLockedShown("eliminated")).toBe("violation");
    expect(outcomeForLockedShown("contending")).toBe("violation");
  });

  it("scores a Locked out display, separating a genuine reversal from a tie the model never resolved", () => {
    expect(outcomeForLockedOutShown("eliminated")).toBe("kept");
    expect(outcomeForLockedOutShown("locked")).toBe("violation");
    expect(outcomeForLockedOutShown("lockedAward")).toBe("award-qualified-at-now");
    expect(outcomeForLockedOutShown("contending")).toBe("unresolved-tie-at-now");
  });

  it("sweeps the synthetic district's six stage positions and really does display both promises", () => {
    const sweep = sweepDistrict(syntheticDistrict(HONEST_FINISH));
    // season start, quals done, alliance selection, playoffs, awards, now.
    expect(sweep.positions).toBe(6);
    expect(sweep.teamPositions).toBe(18);
    // frc1 reads Locked at the awards and now positions; frc2 and frc3 read
    // Locked out at the playoffs, awards and now positions. Nothing appears
    // before the playoffs step, because an open elim category leaves every
    // ceiling above every floor.
    //
    // AT THE PLAYOFFS STEP frc1 IS NOT LOCKED, and that is 260925-ms7 working:
    // the event's award is still open there, so the district's single DCMP
    // slot is held back for it and no points slot is left to guarantee. The
    // elimination side reads the unreserved count, so frc2 and frc3 are still
    // Locked out at that same step.
    expect(sweep.lockedPointsShown).toBe(2);
    expect(sweep.lockedOutShown).toBe(6);
    expect(sweep.inRangeShown + sweep.outOfRangeShown).toBe(10);
    // The reservation really did fire, on exactly the positions where the
    // event's awards are not yet posted: season start, quals done, alliance
    // selection and playoffs.
    expect(sweep.positionsWithReservedSlots).toBe(4);
    expect(sweep.reservedSlotsTotal).toBe(4);
  });

  it("finds no violation when the final verdicts match what was displayed", () => {
    const sweep = sweepDistrict(syntheticDistrict(HONEST_FINISH));
    expect(sweep.violations).toEqual([]);
    expect(sweep.lockedKept).toBe(2);
    expect(sweep.lockedOutKept).toBe(6);
  });

  it("FAILS BOTH TENETS on a deliberately corrupted final verdict, proving the checker can fail", () => {
    // frc1 was shown Locked and is now recorded as eliminated -> tenet A.
    // frc2 was shown Locked out and is now recorded as locked  -> tenet B.
    const sweep = sweepDistrict(syntheticDistrict({ frc1: "eliminated", frc2: "locked", frc3: "eliminated" }));
    expect(sweep.lockedViolations).toBe(2);
    expect(sweep.lockedOutViolations).toBe(3);
    expect(sweep.violations).toHaveLength(5);

    const tenetA = sweep.violations.filter((v) => v.tenet === "A-locked-must-qualify-on-points");
    expect(tenetA.map((v) => v.teamKey)).toEqual(["frc1", "frc1"]);
    // The playoffs step is absent because the held-back slot means nothing is
    // displayed as Locked there at all.
    expect(tenetA.map((v) => v.positionKind)).toEqual(["awards", "now"]);
    expect(tenetA[0]?.finalStatus).toBe("eliminated");

    const tenetB = sweep.violations.filter((v) => v.tenet === "B-locked-out-must-not-qualify-on-points");
    expect(tenetB.map((v) => v.teamKey)).toEqual(["frc2", "frc2", "frc2"]);
    expect(tenetB[0]?.finalStatus).toBe("locked");

    // frc3 finished eliminated, exactly as it was displayed, so it contributes
    // nothing — a corrupted verdict must not smear across untouched teams.
    expect(sweep.violations.some((v) => v.teamKey === "frc3")).toBe(false);
  });

  it("reports a lockedAward finish as indeterminate, never as a broken Locked promise", () => {
    const sweep = sweepDistrict(syntheticDistrict({ frc1: "lockedAward", frc2: "eliminated", frc3: "eliminated" }));
    expect(sweep.lockedAwardQualifiedAtNow).toBe(2);
    expect(sweep.lockedViolations).toBe(0);
    expect(sweep.violations).toEqual([]);
  });

  it("reports a contending finish under a Locked out display as an unresolved tie, not as a tenet B failure", () => {
    const sweep = sweepDistrict(syntheticDistrict({ frc1: "locked", frc2: "contending", frc3: "eliminated" }));
    expect(sweep.lockedOutUnresolvedTieAtNow).toBe(3);
    expect(sweep.lockedOutViolations).toBe(0);
    expect(sweep.violations).toEqual([]);
  });

  it("loads district DETAIL files, skips a null-capacity season by name, and never parses the per-year index as a district", () => {
    const dir = mkdtempSync(join(tmpdir(), "ma5-"));
    try {
      writeFileSync(join(dir, "v1__district__9999zz.json"), JSON.stringify(syntheticDistrict(HONEST_FINISH)));
      writeFileSync(
        join(dir, "v1__district__9999yy.json"),
        JSON.stringify({ ...syntheticDistrict(HONEST_FINISH), districtKey: "9999yy", dcmpSlots: null })
      );
      // The two underscores after `district` are the whole trap: this file
      // carries a `districts` array and NO `teams`, so parsing it as a detail
      // would throw rather than quietly mis-sweep.
      writeFileSync(
        join(dir, "v1__districts__9999.json"),
        JSON.stringify({ schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION, generation: "test", computedAt: "x", year: 9999, districts: [] })
      );

      const loaded = loadDistrictArtifacts(dir);
      expect(loaded.artifacts.map((a) => a.districtKey)).toEqual(["9999zz"]);
      expect(loaded.skippedNoCapacity).toEqual(["9999yy"]);
      expect(loaded.indexFilesSeen).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("aggregates a census across seasons", () => {
    const census = censusOf([sweepDistrict(syntheticDistrict(HONEST_FINISH)), sweepDistrict(syntheticDistrict(HONEST_FINISH))]);
    expect(census.seasons).toBe(2);
    expect(census.positions).toBe(12);
    expect(census.teamPositions).toBe(36);
    expect(census.lockedViolations).toBe(0);
    expect(census.lockedOutViolations).toBe(0);
    expect(census.violationPositionKinds).toEqual([]);
  });
});

const CORPUS_PRESENT = existsSync(LOCAL_DISTRICT_DIR);

if (!CORPUS_PRESENT) {
  describe("measureLedgerTenets — corpus", () => {
    it.skip(`skipped: ${LOCAL_DISTRICT_DIR} is not present`, () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe("measureLedgerTenets — corpus", () => {
    const loaded = loadDistrictArtifacts(LOCAL_DISTRICT_DIR);
    const sweeps = loaded.artifacts.map(sweepDistrict);
    const census = censusOf(sweeps);

    it("sweeps every published district season, skipping none for an unpublished capacity", () => {
      expect(census.seasons).toBe(MEASURED_SEASONS);
      expect(loaded.skippedNoCapacity).toHaveLength(MEASURED_SKIPPED_NO_CAPACITY);
      expect(loaded.indexFilesSeen).toBe(MEASURED_INDEX_FILES);
    });

    it("pins the swept counts as floors — a sweep that quietly stopped visiting positions fails here", () => {
      expect(census.positions).toBeGreaterThanOrEqual(MEASURED_POSITIONS);
      expect(census.teamPositions).toBeGreaterThanOrEqual(MEASURED_TEAM_POSITIONS);
      expect(census.lockedPointsShown).toBeGreaterThanOrEqual(MEASURED_LOCKED_SHOWN);
      expect(census.lockedOutShown).toBeGreaterThanOrEqual(MEASURED_LOCKED_OUT_SHOWN);
      expect(census.lockedAwardShown).toBeGreaterThanOrEqual(MEASURED_LOCKED_AWARD_CHIP_SHOWN);
      // No team can reach a status the tab cannot draw at this tier.
      expect(census.prequalifiedShown).toBe(0);
      expect(census.capacityUnknownShown).toBe(0);
    });

    it("TENET B holds everywhere: no team displayed Locked out ever qualified on points", () => {
      expect(census.lockedOutViolations).toBe(MEASURED_TENET_B_VIOLATIONS);
      expect(sweeps.flatMap((s) => s.violations).filter((v) => v.tenet === "B-locked-out-must-not-qualify-on-points")).toEqual([]);
    });

    it("TENET A holds everywhere: no team displayed Locked on points ever failed to qualify on points", () => {
      const tenetA = sweeps.flatMap((s) => s.violations).filter((v) => v.tenet === "A-locked-must-qualify-on-points");
      expect(census.lockedViolations).toBe(MEASURED_TENET_A_VIOLATIONS);
      expect(tenetA).toEqual([]);
    });

    it("carries no violation of either tenet at any position of any season", () => {
      expect(census.violationPositionKinds).toEqual([]);
      expect(sweeps.flatMap((s) => s.violations)).toEqual([]);
    });

    it("holds slots back, so the zeros above are earned rather than free", () => {
      // A reservation that silently stopped firing would also report zero
      // violations, and would be indistinguishable from the fix working. These
      // two floors are what tells them apart.
      expect(census.reservedSlotsTotal).toBeGreaterThanOrEqual(MEASURED_RESERVED_SLOTS_TOTAL);
      expect(census.positionsWithReservedSlots).toBeGreaterThanOrEqual(MEASURED_POSITIONS_WITH_RESERVED_SLOTS);
    });

    it("names the thirteen positions that used to fail and finds every one of them clean", () => {
      // The record read back as an assertion: each of 260925-ma5's thirteen
      // (district, team, position) triples is swept again here and must carry
      // no violation. Pinned by name so a regression cannot hide behind a
      // headline count.
      const violationRows = new Set(sweeps.flatMap((s) => s.violations).map((v) => `${v.districtKey}/${v.teamKey}/${v.positionId}`));
      for (const row of FIXED_TENET_A_VIOLATION_ROWS) expect(violationRows.has(row), `${row} is failing again`).toBe(false);
    });

    it("a lockedAward finish under a Locked display is counted separately and never inflates the violation count", () => {
      expect(census.lockedAwardQualifiedAtNow).toBeGreaterThan(0);
      expect(census.lockedKept + census.lockedAwardQualifiedAtNow + census.lockedViolations).toBe(census.lockedPointsShown);
      expect(
        census.lockedOutKept + census.lockedOutAwardQualifiedAtNow + census.lockedOutUnresolvedTieAtNow + census.lockedOutViolations
      ).toBe(census.lockedOutShown);
    });
  });
}
