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
 *
 * QUICK TASK 261012-mw2 (a team still in the bracket is credited the playoff
 * points it has secured) moved two pins, to the values the run showed and
 * never fitted. FNC Round 5: the locked set gains frc4561 (the team Jacob
 * asked about, a finalist with 60 secured), five teams become six, and the
 * bounds of the four finalists' robots pinned here read 11 (frc9496 and
 * frc9032 were 12, frc4795 14, frc4561 16). California Round 5: 15 Locked
 * become 17, frc7415 and frc3128 join. No team left a set and no other pin
 * of this file moved.
 *
 * THE FNC ROWS NOW CARRY WHO WAS ON THE FIELD. The credit is read from each
 * winning side's three robots, so a row that fields an alliance's first
 * three picks where a backup played would credit a robot for a win it sat
 * out. `FNC_FIELDED` names the seven sides a backup played on, from the
 * corpus, and a corpus gated test below holds every row written here equal
 * to the corpus row.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "../packages/harness/pageArtifacts.js";
import { jointLockBound } from "../packages/core/districts/champJointLock.js";
import type { BracketSourceEvent } from "../apps/web/src/components/districts/districtLedgerRows.js";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { bracketFromCorpus, bracketsFromCorpus, championshipStops, CORPUS_PATH, dcmpStops, statusesAtChampionshipStop, statusesAtStop, sweepJoint } from "./measureChampJointLocks.js";

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

/**
 * THE SIDES A BACKUP PLAYED ON (quick task 261012-mw2), by match key suffix and alliance number, from the corpus.
 * Every other side fielded its alliance's first three picks. frc6004 played for alliance 1 from sf7 to the first
 * Finals match and frc8205 came back for the second; frc6639 played alliance 2's sf11 in frc7763's place (TBA paid
 * frc7763 72 of the champion's 90 for it, and frc6639 21); frc11179 played alliance 5's sf5 in frc3229's place.
 */
const FNC_FIELDED: Readonly<Record<string, Readonly<Record<number, readonly string[]>>>> = {
  sf5m1: { 5: ["frc8738", "frc11179", "frc4828"] },
  sf7m1: { 1: ["frc9032", "frc6004", "frc9496"] },
  sf9m1: { 1: ["frc9032", "frc6004", "frc9496"] },
  sf11m1: { 2: ["frc6639", "frc4795", "frc4561"] },
  sf12m1: { 1: ["frc9032", "frc6004", "frc9496"] },
  sf13m1: { 1: ["frc9032", "frc6004", "frc9496"] },
  f1m1: { 1: ["frc9032", "frc6004", "frc9496"] },
};

function fncBracket(): BracketSourceEvent {
  const firstThree = (allianceNumber: number): string[] => FNC_ALLIANCES[allianceNumber - 1]!.picks.slice(0, 3);
  const fielded = (suffix: string, allianceNumber: number): string[] => [...(FNC_FIELDED[suffix]?.[allianceNumber] ?? firstThree(allianceNumber))];
  return {
    alliances: FNC_ALLIANCES,
    matches: FNC_ROWS.map(([suffix, red, blue, winner]) => {
      const parsed = /^(sf|f)(\d+)m(\d+)$/.exec(suffix)!;
      return {
        matchKey: `2026nccmp_${suffix}`,
        compLevel: parsed[1]!,
        setNumber: Number(parsed[2]),
        matchNumber: Number(parsed[3]),
        redTeams: fielded(suffix, red),
        blueTeams: fielded(suffix, blue),
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

  // QUICK TASK 261012-mw2: frc4561 joins. It is a finalist on alliance 2 and has secured 60, so its floor reads 292
  // where it read 232, and 11 rivals at most can finish ahead of it where 16 could. Before this task the set was
  // frc2724, frc3506, frc4795, frc9032 and frc9496, and the bounds of frc9496, frc9032, frc4795 and frc4561 read
  // 12, 12, 14 and 16. The six bounds below them did not move.
  it("Round 5: 15 points slots, and the joint proof locks exactly frc2724, frc3506, frc4561, frc4795, frc9032 and frc9496", () => {
    const model = statusesAtStop(artifact, stopNamed("Round 5"), bracket, true);
    expect(model.pointsSlots).toBe(15);
    expect(model.jointProof?.applied).toBe(true);
    if (model.jointProof?.applied !== true || model.jointProof.shape === "multiple") return;
    const input = model.jointProof.input;
    expect(input.placementPoints).toEqual([75, 39, 21]);
    expect(input.consumingAwards).toBe(6);
    expect(input.judgedAwards).toBe(14);
    expect(input.aliveAlliances).toEqual([1, 2]);
    expect([...model.jointProof.locked].sort()).toEqual(["frc2724", "frc3506", "frc4561", "frc4795", "frc9032", "frc9496"]);
    const jointByLockedBy = [...model.byTeam.values()].filter((result) => result.lockedBy?.includes("joint") === true).map((result) => result.teamKey).sort();
    expect(jointByLockedBy).toEqual(["frc2724", "frc3506", "frc4561", "frc4795", "frc9032", "frc9496"]);
    // The team Jacob asked about, 2026-10-12: Locked, by the ceiling test and by the joint proof.
    expect({ status: model.byTeam.get("frc4561")?.status, lockedBy: model.byTeam.get("frc4561")?.lockedBy, floor: model.floorByTeam?.get("frc4561") }).toEqual({ status: "locked", lockedBy: "ceiling+joint", floor: 292 });
    const bounds = Object.fromEntries(
      ["frc2724", "frc9496", "frc9032", "frc4795", "frc3506", "frc4561", "frc8429", "frc1533", "frc7890", "frc6500"].map((teamKey) => [teamKey, jointLockBound(input, teamKey)])
    );
    expect(bounds).toEqual({
      frc2724: 12,
      frc9496: 11,
      frc9032: 11,
      frc4795: 11,
      frc3506: 14,
      frc4561: 11,
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

  it("the sweep's stop records carry the secured minimums in floors and the headers checked, and the artifact as published breaks nothing (quick task 261012-mw2)", () => {
    const sweep = sweepJoint(artifact, bracket);
    expect(sweep.violations).toEqual([]);
    // Pinned as the run showed. A secured minimum is counted where the Playoffs are open at the stop and no exact
    // settled value stands there: nobody has one before Round 2 (sf1 to sf6 pay nothing), and none is counted once
    // the Playoffs read final. Every one of the 90 teams has its earned figure checked against its floor at every stop.
    expect(sweep.stops.map((stop) => ({ label: stop.label, securedInFloors: stop.securedInFloors, headerChecked: stop.headerChecked }))).toEqual([
      { label: "Alliances final", securedInFloors: 0, headerChecked: 90 },
      { label: "Round 1", securedInFloors: 0, headerChecked: 90 },
      { label: "Round 2", securedInFloors: 6, headerChecked: 90 },
      { label: "Round 3", securedInFloors: 13, headerChecked: 90 },
      { label: "Round 4", securedInFloors: 11, headerChecked: 90 },
      { label: "Round 5", securedInFloors: 8, headerChecked: 90 },
      { label: "Playoffs final, awards open", securedInFloors: 0, headerChecked: 90 },
      { label: "Now", securedInFloors: 0, headerChecked: 90 },
    ]);
  });

  it("creditAbovePaid bites: with frc4561 paid 30 on a copy of the artifact, the sweep reports its secured minimum above the payment at six stops (quick task 261012-mw2)", () => {
    // THE COPY IS BUILT HERE, IN MEMORY: frc4561's playoff points at the championship lowered from TBA's 90 to 30,
    // below what the rows secure it from Round 2 on. Alliance 2 held 13 table points after sf8 (39 at the
    // championship weight), 20 after sf11 (60), and won the Finals (90). frc4561 was on the field for every win.
    const dcmpKey = "2026nccmp";
    const lowered: DistrictArtifact = {
      ...artifact,
      teams: artifact.teams.map((team) =>
        team.teamKey !== "frc4561" ? team : { ...team, eventPoints: team.eventPoints.map((row) => (row.eventKey !== dcmpKey ? row : { ...row, elim: 30, total: row.total - row.elim + 30 })) }
      ),
    };
    expect(artifact.teams.find((team) => team.teamKey === "frc4561")!.eventPoints.find((row) => row.eventKey === dcmpKey)!.elim).toBe(90);
    const reported = sweepJoint(lowered, bracket).violations.filter((violation) => violation.kind === "creditAbovePaid");
    expect(reported.map((violation) => ({ stop: violation.stop, teamKey: violation.teamKey, detail: violation.detail }))).toEqual([
      { stop: "Round 2", teamKey: "frc4561", detail: "secured 39 at 2026nccmp, paid 30" },
      { stop: "Round 3", teamKey: "frc4561", detail: "secured 39 at 2026nccmp, paid 30" },
      { stop: "Round 4", teamKey: "frc4561", detail: "secured 60 at 2026nccmp, paid 30" },
      { stop: "Round 5", teamKey: "frc4561", detail: "secured 60 at 2026nccmp, paid 30" },
      { stop: "Playoffs final, awards open", teamKey: "frc4561", detail: "secured 90 at 2026nccmp, paid 30" },
      { stop: "Now", teamKey: "frc4561", detail: "secured 90 at 2026nccmp, paid 30" },
    ]);
    // And nothing of the kind over the artifact as published (the test above holds every kind at none).
    expect(sweepJoint(artifact, bracket).violations.filter((violation) => violation.kind === "creditAbovePaid")).toEqual([]);
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

/**
 * Quick task 261009-kt3: the divisioned and two championship pins, as the
 * implementation executes them (never fitted). Gated on the local district
 * artifacts AND `data/corpus.sqlite`, which carries the division and finals
 * brackets; skips with a message when either is absent.
 *
 * As 261009-kt3 executed them, against the planner's prototype: FIM 2026 at
 * Divisions final locked 50, not 60 (the finals seats open to any rival cost
 * 6, and 4 teams with no championship row kept the tab's hypothetical DCMP
 * ceiling while the finals had not started); NE 2026 at Divisions final locked
 * 12, not 17 (the same hypothetical ceiling on eight teams with no row); every
 * other set equalled the prototype's.
 *
 * QUICK TASK 261009-pgq replaced the four FIM and NE sets with the sets as
 * executed after its two changes, never fitted: a team with no championship
 * row leaves the field once every division has started (D1), and the judged
 * budget is what each division can still give (D3 as revised: the whole 14
 * while a division's Awards are open, 14 minus the teams already carrying
 * award points there once they read final). Every 2026 FIM and NE division
 * posted 12, so K is 8 at both FIM pinned stops and 4 at both NE ones (it was
 * 56 and 28). FIM Divisions final 50 to 63, FIM Finals decided 63 to 64, NE
 * Divisions final 12 to 18, NE Finals decided 15 to 16. No team left a set, S'
 * did not move, and every member is `locked` or `lockedAward` at Now. The two
 * CA pins did not move. A near miss list keeps only the teams its set still
 * does not hold; the loop below also asserts that no team that missed
 * qualification is in ANY pinned set.
 *
 * QUICK TASK 261009-tx9 replaced the four FIM and NE sets again with the sets
 * as executed, never fitted, after the divisioned proof was brought in line
 * with the backup robot rule: an alliance has one backup for the whole
 * championship, a backup is an unselected team of the alliance's own
 * division, and a team already on an alliance is never a backup. FIM
 * Divisions final 63 to 65 (frc494 and frc1188 join, each at bound 82 against
 * S' 83). FIM Finals decided 64 to 64, NE Divisions final 18 to 18 and NE
 * Finals decided 16 to 16: those three sets did not move. No team left a set,
 * S' did not move, and every member is `locked` or `lockedAward` at Now. The
 * two CA pins and the FNC pins did not move. The FIM Divisions final near
 * misses are now frc5675 (bound 83) and frc3707 (bound 84).
 *
 * QUICK TASK 261010-d7r replaced three of the four FIM and NE sets with the
 * sets as executed, never fitted, after its rule D1: a rival that already
 * holds a posted award at a division whose Awards read final takes no further
 * judged award (`champJointLock.ts`). Every one of these stops reads the
 * divisions' Awards final, so the rule applies at each. FIM Divisions final
 * 65 to 66 (frc5675 joins; it was the near miss at bound 83 against S' 83).
 * NE Divisions final 18 to 20 and NE Finals decided 16 to 18 (frc2713 and
 * frc4909 join both; they were the two near misses of both). FIM Finals
 * decided 64 to 64 did not move. No team left a set, S' did not move, and
 * every member is `locked` or `lockedAward` at Now. The two CA pins and the
 * FNC pins did not move. The one FIM Divisions final near miss left is
 * frc3707; the NE sets have none left.
 */
const KT3_PATHS = ["fim", "ne", "ca"].map((district) => `data/local-publish/districts/v1__district__2026${district}.json`);
const KT3_AVAILABLE = KT3_PATHS.every((path) => existsSync(path)) && existsSync(CORPUS_PATH);

describe("measureChampJointLocks: the FIM, NE and CA 2026 pins (261009-kt3, D7)", () => {
  if (!KT3_AVAILABLE) {
    it.skip(`skipped: the 2026 fim, ne or ca district artifact or ${CORPUS_PATH} is absent (gitignored local data)`, () => {});
    return;
  }
  const db = openCorpusReadOnly(CORPUS_PATH);
  const loaded = new Map<string, { artifact: DistrictArtifact; brackets: ReadonlyMap<string, BracketSourceEvent> }>();
  let fncCorpusBracket: BracketSourceEvent | undefined;
  try {
    fncCorpusBracket = bracketFromCorpus(db, new Map(), 2026, "2026nccmp");
    for (const district of ["fim", "ne", "ca"]) {
      const artifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(`data/local-publish/districts/v1__district__2026${district}.json`, "utf8")));
      const found = bracketsFromCorpus(db, new Map(), artifact);
      if ("missing" in found) throw new Error(`no corpus bracket for ${found.missing}`);
      loaded.set(district, { artifact, brackets: found.brackets });
    }
  } finally {
    db.close();
  }

  it("the 2026nccmp rows written out for the FNC pins are the corpus rows: the lists, each side's three robots and the winner, match for match (quick task 261012-mw2)", () => {
    if (fncCorpusBracket === undefined) throw new Error("no corpus bracket for 2026nccmp");
    const shape = (bracket: BracketSourceEvent) => ({
      alliances: (bracket.alliances ?? []).map((alliance) => ({ allianceNumber: alliance.allianceNumber, picks: [...alliance.picks] })),
      rows: bracket.matches
        .filter((match) => match.compLevel !== "qm")
        .map((match) => ({ matchKey: match.matchKey, red: [...match.redTeams].sort(), blue: [...match.blueTeams].sort(), winner: match.actualWinner }))
        .sort((a, b) => a.matchKey.localeCompare(b.matchKey)),
    });
    expect(shape(fncBracket())).toEqual(shape(fncCorpusBracket));
    expect(shape(fncBracket()).rows).toHaveLength(15);
  });

  const pins: readonly { district: string; stop: string; slots: number; shape: string; locked: string; nearMisses: string }[] = [
    {
      district: "fim",
      stop: "Divisions final, finals not started",
      slots: 83,
      shape: "divisioned",
      locked:
        "frc1023 frc10633 frc1188 frc1189 frc1498 frc1701 frc1918 frc201 frc2054 frc2075 frc2137 frc2337 frc2586 frc2611 frc2619 frc27 frc2767 frc2851 frc2960 frc33 frc3414 frc3536 frc3538 frc3539 frc3620 frc3641 frc3656 frc3668 frc4237 frc4362 frc4391 frc4398 frc469 frc494 frc4967 frc5066 frc5086 frc5114 frc5166 frc5193 frc5216 frc5460 frc548 frc5534 frc5660 frc5675 frc5712 frc5907 frc6002 frc6090 frc6121 frc6152 frc6615 frc67 frc68 frc7160 frc7166 frc7197 frc7220 frc7769 frc8280 frc8517 frc8608 frc9245 frc9757 frc9771",
      nearMisses: "frc3707",
    },
    {
      district: "fim",
      stop: "Finals decided, awards open",
      slots: 80,
      shape: "divisioned",
      locked:
        "frc1023 frc10633 frc1188 frc1189 frc1498 frc1701 frc1918 frc201 frc2054 frc2075 frc2137 frc2337 frc2586 frc2611 frc2619 frc2767 frc2851 frc2960 frc33 frc3414 frc3536 frc3538 frc3539 frc3620 frc3641 frc3656 frc3707 frc4237 frc4362 frc4391 frc4398 frc469 frc494 frc4967 frc5066 frc5086 frc5114 frc5166 frc5193 frc5216 frc5460 frc548 frc5534 frc5660 frc5675 frc5712 frc5907 frc6002 frc6090 frc6121 frc6152 frc6615 frc67 frc68 frc7160 frc7166 frc7197 frc7220 frc8280 frc8517 frc8608 frc9245 frc9757 frc9771",
      nearMisses: "frc5462 frc70",
    },
    {
      district: "ne",
      stop: "Divisions final, finals not started",
      slots: 32,
      shape: "divisioned",
      locked: "frc125 frc133 frc176 frc1768 frc190 frc1922 frc195 frc2067 frc238 frc2713 frc2877 frc3467 frc4909 frc5000 frc5687 frc5813 frc6328 frc6329 frc7407 frc88",
      nearMisses: "",
    },
    {
      district: "ne",
      stop: "Finals decided, awards open",
      slots: 28,
      shape: "divisioned",
      locked: "frc125 frc133 frc176 frc190 frc1922 frc195 frc2067 frc238 frc2713 frc2877 frc3467 frc4909 frc5000 frc5813 frc6328 frc6329 frc7407 frc88",
      nearMisses: "",
    },
    {
      district: "ca",
      stop: "Round 5",
      slots: 46,
      shape: "multiple",
      // QUICK TASK 261012-mw2: 15 Locked become 17. frc7415 and frc3128 join, each still in its championship's
      // bracket with playoff points secured; both were on the near miss list, which keeps the six it still names.
      locked: "frc1323 frc1538 frc1678 frc254 frc294 frc3128 frc3256 frc3476 frc4414 frc581 frc5940 frc6036 frc7415 frc9408 frc9470 frc972 frc973",
      nearMisses: "frc6995 frc971 frc599 frc687 frc8 frc604",
    },
    {
      district: "ca",
      stop: "Playoffs final, awards open",
      slots: 39,
      shape: "multiple",
      locked: "frc1538 frc1678 frc294 frc3128 frc3256 frc581 frc5940 frc599 frc6036 frc604 frc687 frc6995 frc7415 frc8 frc9408 frc9470 frc971 frc972 frc973",
      nearMisses: "frc2102 frc4698",
    },
  ];

  for (const pin of pins) {
    it(`${pin.district} 2026 at ${pin.stop}: S' ${String(pin.slots)}, ${pin.shape}, the joint proof locks exactly the pinned set, every one qualified at Now`, () => {
      const { artifact, brackets } = loaded.get(pin.district)!;
      const stop = championshipStops(artifact, brackets).find((entry) => entry.label === pin.stop);
      if (stop === undefined) throw new Error(`no ${pin.stop} stop`);
      const model = statusesAtChampionshipStop(artifact, stop, brackets, true);
      expect(model.pointsSlots).toBe(pin.slots);
      if (model.jointProof?.applied !== true) throw new Error(`not applied: ${JSON.stringify(model.jointProof)}`);
      expect(model.jointProof.shape).toBe(pin.shape);
      const locked = [...model.jointProof.locked].sort();
      expect(locked).toEqual(pin.locked.split(" ").sort());
      const finalStatus = new Map(artifact.teams.map((team) => [team.teamKey, team.champLock.status] as const));
      for (const teamKey of locked) expect(["locked", "lockedAward"], teamKey).toContain(finalStatus.get(teamKey));
      // Nobody who missed qualification is in the set (quick task 261009-pgq): read off the artifact's own verdict at Now.
      const missed = artifact.teams.filter((team) => team.champLock.status !== "locked" && team.champLock.status !== "lockedAward").map((team) => team.teamKey);
      expect(missed.length).toBeGreaterThan(0);
      expect(locked.filter((teamKey) => missed.includes(teamKey))).toEqual([]);
      for (const teamKey of pin.nearMisses.split(" ").filter((entry) => entry !== "")) expect(locked, teamKey).not.toContain(teamKey);
    });
  }

  it("D3: at FIM 2026 Divisions final, every team with a finals row has its finals points out of its floor (frc27 at 445 minus 90)", () => {
    const { artifact, brackets } = loaded.get("fim")!;
    const stop = championshipStops(artifact, brackets).find((entry) => entry.label === "Divisions final, finals not started")!;
    const model = statusesAtChampionshipStop(artifact, stop, brackets, false);
    let finalsTeams = 0;
    for (const team of artifact.teams) {
      const row = team.eventPoints.find((entry) => entry.eventKey === "2026micmp");
      if (row === undefined) continue;
      finalsTeams += 1;
      expect(model.floorByTeam!.get(team.teamKey)!, team.teamKey).toBeLessThanOrEqual(team.pointTotal - row.total);
    }
    expect(finalsTeams).toBe(16);
    expect(model.floorByTeam!.get("frc27")).toBe(355);
  });
});
