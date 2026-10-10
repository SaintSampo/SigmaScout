/**
 * `dcmpFieldProof.ts`, line by line (quick task 261010-66y, D1, D7 and the
 * D11 addenda): started, posted, the three ways to be complete, the capacity
 * tolerance on the LARGEST posted key, the count asked for never rising
 * while rows are only added, and the championships held back while the field
 * is not proven. Every year is passed in.
 */
import { describe, expect, it } from "vitest";
import { dcmpFieldProof, fieldFixingDcmpKeys, hypotheticalFinalsCeiling, unseenChampionshipsHeld, type DcmpFieldProofInput, type DcmpFieldProofTeam } from "./dcmpFieldProof.js";

const NONE: ReadonlySet<string> = new Set();

/** `count` teams, each with one posted dcmp row at `eventKey`. */
function postedAt(eventKey: string, count: number): DcmpFieldProofTeam[] {
  return Array.from({ length: count }, () => ({ eventPoints: [{ eventKey, tier: "dcmp" as const }], remainingEvents: [] }));
}

/** `count` teams registered at `eventKey` with no posted row. */
function registeredAt(eventKey: string, count: number): DcmpFieldProofTeam[] {
  return Array.from({ length: count }, () => ({ eventPoints: [], remainingEvents: [{ eventKey, tier: "dcmp" as const }] }));
}

/** A district tier team with no championship row at all. */
const DISTRICT_ONLY: DcmpFieldProofTeam = { eventPoints: [{ eventKey: "2026wasno", tier: "district" }], remainingEvents: [] };

function proofOf(teams: readonly DcmpFieldProofTeam[], over: Partial<DcmpFieldProofInput> = {}) {
  const keys = new Set<string>();
  for (const team of teams) for (const row of [...team.eventPoints, ...team.remainingEvents]) if (row.tier === "dcmp") keys.add(row.eventKey);
  return dcmpFieldProof({ teams, dcmpSlots: 80, season: 2026, nowYear: 2026, startedKeys: keys, awardsFinalKeys: NONE, ...over });
}

describe("dcmpFieldProof, line (a): every field fixing key has started", () => {
  it("reads not proven while one field fixing key is not in the started set", () => {
    const teams = [...postedAt("2026necmp1", 40), ...postedAt("2026necmp2", 40)];
    const proof = proofOf(teams, { startedKeys: new Set(["2026necmp1"]) });
    expect(proof).toMatchObject({ proven: false, started: false, posted: true, completeBy: null, unprovenAfterStart: true });
    expect(proofOf(teams)).toMatchObject({ proven: true, started: true, completeBy: "capacity", unprovenAfterStart: false });
  });

  it("does not ask for the finals key's own start", () => {
    const teams = [...postedAt("2026necmp1", 40), ...postedAt("2026necmp2", 40), ...registeredAt("2026necmp", 3)];
    const proof = proofOf(teams, { startedKeys: new Set(["2026necmp1", "2026necmp2"]) });
    expect(proof.fieldFixingKeys).toEqual(["2026necmp1", "2026necmp2"]);
    expect(proof).toMatchObject({ proven: true, started: true, completeBy: "capacity" });
  });
});

describe("dcmpFieldProof, line (b): every field fixing key carries a posted row", () => {
  it("reads a field fixing key known only through registrations as not posted", () => {
    const teams = [...postedAt("2026necmp1", 80), ...registeredAt("2026necmp2", 40)];
    const proof = proofOf(teams);
    expect(proof).toMatchObject({ proven: false, started: true, posted: false, completeBy: null, unprovenAfterStart: true });
  });
});

describe("dcmpFieldProof, line (c): complete by capacity, on the largest posted key", () => {
  it("passes at exactly the capacity minus the tolerance and fails one team below", () => {
    // Two keys of 30 and 20 against 65 slots: the tolerance is half of 30.
    const at = [...postedAt("2026aacmp", 30), ...postedAt("2026bbcmp", 20)];
    expect(proofOf(at, { dcmpSlots: 65 })).toMatchObject({ proven: true, completeBy: "capacity", postedTeams: 50, largestPostedKeyTeams: 30, tolerance: 15 });
    expect(proofOf(at, { dcmpSlots: 66 })).toMatchObject({ proven: false, completeBy: null, postedTeams: 50, tolerance: 15 });
  });

  it("passes the under filled and over filled fields of the published seasons", () => {
    // 2022 NE: 78 of 80 in divisions of 39 and 39.
    expect(proofOf([...postedAt("2022necmp1", 39), ...postedAt("2022necmp2", 39)], { dcmpSlots: 80, season: 2022, nowYear: 2022 }).completeBy).toBe("capacity");
    // 2026 ONT: 99 of 100 in divisions of 50 and 49.
    expect(proofOf([...postedAt("2026oncmp1", 50), ...postedAt("2026oncmp2", 49)], { dcmpSlots: 100 }).completeBy).toBe("capacity");
    // 2026 ISR: 38 of 42 at one key.
    expect(proofOf(postedAt("2026iscmp", 38), { dcmpSlots: 42 }).completeBy).toBe("capacity");
    // 2022 ONT: 67 of 80 at one key.
    expect(proofOf(postedAt("2022oncmp", 67), { dcmpSlots: 80, season: 2022, nowYear: 2022 }).completeBy).toBe("capacity");
    // 2023 ISR: 45 of 40 at one key.
    expect(proofOf(postedAt("2023iscmp", 45), { dcmpSlots: 40, season: 2023, nowYear: 2023 }).completeBy).toBe("capacity");
  });

  it("does not pass with a whole event unseen", () => {
    // 2026 California with one of its two championships posted: 61 of 120.
    expect(proofOf(postedAt("2026cancmp", 61), { dcmpSlots: 120 })).toMatchObject({ proven: false, completeBy: null, unprovenAfterStart: true });
    // 2026 FIM with three of its four divisions posted: 121 of 160.
    const three = [...postedAt("2026micmp1", 40), ...postedAt("2026micmp2", 40), ...postedAt("2026micmp3", 41)];
    expect(proofOf(three, { dcmpSlots: 160 })).toMatchObject({ proven: false, completeBy: null, postedTeams: 121, tolerance: 20 });
  });

  it("never reads capacity where no capacity is published", () => {
    expect(proofOf(postedAt("2026iscmp", 500), { dcmpSlots: null })).toMatchObject({ proven: false, completeBy: null });
  });

  it("counts a team with posted rows at two field fixing keys once", () => {
    const both: DcmpFieldProofTeam = { eventPoints: [{ eventKey: "2026cancmp", tier: "dcmp" }, { eventKey: "2026cascmp", tier: "dcmp" }], remainingEvents: [] };
    const proof = proofOf([both, ...postedAt("2026cancmp", 9), ...postedAt("2026cascmp", 9), DISTRICT_ONLY], { dcmpSlots: 19 });
    expect(proof.postedTeams).toBe(19);
    expect(proof.largestPostedKeyTeams).toBe(10);
  });
});

describe("dcmpFieldProof, line (c): complete by a posted finals row", () => {
  const divisions = [...postedAt("2026micmp1", 40), ...postedAt("2026micmp2", 40)];

  it("reads complete by the finals where capacity fails and the finals key carries a posted row", () => {
    const proof = proofOf([...divisions, ...postedAt("2026micmp", 4)], { dcmpSlots: 160 });
    expect(proof).toMatchObject({ proven: true, completeBy: "finals" });
  });

  it("does not read a finals key known only through registrations", () => {
    const proof = proofOf([...divisions, ...registeredAt("2026micmp", 4)], { dcmpSlots: 160 });
    expect(proof).toMatchObject({ proven: false, completeBy: null });
  });

  it("a lone parent key with no digit suffixed sibling is not a finals key, so a finals only row never proves a field", () => {
    // The first row of a divisioned championship to reach the artifact is,
    // in this state, a finals only team's (an award given at the finals).
    const proof = proofOf(postedAt("2026micmp", 1), { dcmpSlots: 160 });
    expect(proof.fieldFixingKeys).toEqual(["2026micmp"]);
    expect(proof).toMatchObject({ proven: false, completeBy: null, started: true, posted: true, unprovenAfterStart: true });
  });
});

describe("dcmpFieldProof, line (c): complete because the season is over", () => {
  const teams = postedAt("2020pncmp", 2);

  it("reads the 2020 shape proven: two posted of 80, started, Awards final, a season that is over", () => {
    const proof = proofOf(teams, { dcmpSlots: 80, season: 2020, nowYear: 2026, awardsFinalKeys: new Set(["2020pncmp"]) });
    expect(proof).toMatchObject({ proven: true, completeBy: "seasonOver", unprovenAfterStart: false });
  });

  it("does not count in the season still being played", () => {
    const proof = proofOf(teams, { dcmpSlots: 80, season: 2020, nowYear: 2020, awardsFinalKeys: new Set(["2020pncmp"]) });
    expect(proof).toMatchObject({ proven: false, completeBy: null, unprovenAfterStart: true });
  });

  it("asks for Awards final at every field fixing key", () => {
    const two = [...postedAt("2020aacmp", 2), ...postedAt("2020bbcmp", 2)];
    expect(proofOf(two, { season: 2020, nowYear: 2026, awardsFinalKeys: new Set(["2020aacmp"]) }).proven).toBe(false);
    expect(proofOf(two, { season: 2020, nowYear: 2026, awardsFinalKeys: new Set(["2020aacmp", "2020bbcmp"]) }).completeBy).toBe("seasonOver");
  });
});

describe("dcmpFieldProof, the states with nothing to prove", () => {
  it("reads no dcmp key at all as not proven and not unproven after a start", () => {
    const proof = proofOf([DISTRICT_ONLY, DISTRICT_ONLY]);
    expect(proof).toEqual({
      proven: false,
      started: false,
      posted: false,
      completeBy: null,
      unprovenAfterStart: false,
      dcmpEventKeys: [],
      fieldFixingKeys: [],
      postedTeams: 0,
      largestPostedKeyTeams: 0,
      tolerance: 0,
    });
  });

  it("reads unproven after a start exactly when some field fixing key has started and the field is not proven", () => {
    const teams = [...postedAt("2026micmp1", 40), ...postedAt("2026micmp2", 40)];
    // Nothing started: not proven, and nothing is claimed about the field yet.
    expect(proofOf(teams, { dcmpSlots: 160, startedKeys: NONE })).toMatchObject({ proven: false, unprovenAfterStart: false });
    // One started: unproven after a start.
    expect(proofOf(teams, { dcmpSlots: 160, startedKeys: new Set(["2026micmp2"]) })).toMatchObject({ proven: false, unprovenAfterStart: true });
    // The finals key's start alone is not a field fixing key's.
    expect(proofOf([...teams, ...registeredAt("2026micmp", 2)], { dcmpSlots: 160, startedKeys: new Set(["2026micmp"]) })).toMatchObject({ proven: false, unprovenAfterStart: false });
    // Proven: not unproven.
    expect(proofOf(teams, { dcmpSlots: 80 })).toMatchObject({ proven: true, unprovenAfterStart: false });
  });

  it("keeps the field fixing rule it took over from the row model", () => {
    expect(fieldFixingDcmpKeys(["2026micmp", "2026micmp1", "2026micmp2"])).toEqual(["2026micmp1", "2026micmp2"]);
    expect(fieldFixingDcmpKeys(["2026cancmp", "2026cascmp"])).toEqual(["2026cancmp", "2026cascmp"]);
    expect(fieldFixingDcmpKeys(["2026pncmp"])).toEqual(["2026pncmp"]);
  });
});

describe("dcmpFieldProof, the count asked for never rises while rows are only added (D11)", () => {
  /** Every key on the rows has started: only rows change in these tests. */
  const provenOf = (teams: readonly DcmpFieldProofTeam[], dcmpSlots: number) => proofOf(teams, { dcmpSlots }).proven;

  it("a proven field stays proven when a later key carrying only a few rows is appended", () => {
    // 58 and 58 against 120: 116 posted, half of 58 forgiven, 91 asked.
    const proven = [...postedAt("2026aacmp", 58), ...postedAt("2026bbcmp", 58)];
    expect(provenOf(proven, 120)).toBe(true);
    for (const few of [1, 2, 3, 5]) {
      const proof = proofOf([...proven, ...postedAt("2026cccmp", few)], { dcmpSlots: 120 });
      // On the smallest key the tolerance would have fallen to 0 and the
      // field would have read unproven at 117 of 120.
      expect({ few, proven: proof.proven, tolerance: proof.tolerance }).toEqual({ few, proven: true, tolerance: 29 });
    }
  });

  it("a proven field stays proven when rows are appended to any key", () => {
    const base = [...postedAt("2026aacmp", 30), ...postedAt("2026bbcmp", 20)];
    expect(provenOf(base, 65)).toBe(true);
    for (const key of ["2026aacmp", "2026bbcmp"]) {
      for (const more of [1, 7, 40]) expect({ key, more, proven: provenOf([...base, ...postedAt(key, more)], 65) }).toEqual({ key, more, proven: true });
    }
  });

  it("holds over every order of adding rows to a small field: once proven, always proven", () => {
    // A deterministic walk over many fields: keys of differing sizes, rows
    // added one at a time in a scrambled order, every key started.
    let seed = 20261010;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 0x100000000;
    };
    let walks = 0;
    let provenWalks = 0;
    for (let trial = 0; trial < 400; trial++) {
      const keyCount = 1 + Math.floor(next() * 4);
      const sizes = Array.from({ length: keyCount }, () => 1 + Math.floor(next() * 12));
      const total = sizes.reduce((sum, size) => sum + size, 0);
      const dcmpSlots = Math.max(1, total - Math.floor(next() * 8) + Math.floor(next() * 4));
      const adds: string[] = sizes.flatMap((size, index) => Array.from({ length: size }, () => `2026k${String.fromCharCode(97 + index)}cmp`));
      for (let i = adds.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [adds[i], adds[j]] = [adds[j]!, adds[i]!];
      }
      const teams: DcmpFieldProofTeam[] = [];
      let wasProven = false;
      let asked = Infinity;
      for (const eventKey of adds) {
        teams.push({ eventPoints: [{ eventKey, tier: "dcmp" }], remainingEvents: [] });
        const proof = proofOf(teams, { dcmpSlots });
        // The count asked for never rises.
        expect(dcmpSlots - proof.tolerance).toBeLessThanOrEqual(asked);
        asked = dcmpSlots - proof.tolerance;
        if (wasProven) expect({ trial, rows: teams.length, proven: proof.proven }).toEqual({ trial, rows: teams.length, proven: true });
        wasProven = wasProven || proof.proven;
      }
      walks += 1;
      if (wasProven) provenWalks += 1;
    }
    expect(walks).toBe(400);
    // The walk is not vacuous: most fields do reach proven.
    expect(provenWalks).toBeGreaterThan(200);
  });
});

describe("hypotheticalFinalsCeiling: what a team with no row carries for a finals while the field is not proven", () => {
  it("is the whole dcmp Playoffs ceiling while the field is not proven and nothing once it is", () => {
    expect(hypotheticalFinalsCeiling(false, 90)).toBe(90);
    expect(hypotheticalFinalsCeiling(true, 90)).toBe(0);
  });
});

describe("unseenChampionshipsHeld: the championships held back while the field is not proven (D11)", () => {
  it("holds two for three championships of equal size with one posted", () => {
    expect(unseenChampionshipsHeld(postedAt("2026aacmp", 40), 120)).toBe(2);
  });

  it("falls as further championships become known, and holds none once the posted teams meet the capacity line", () => {
    const one = postedAt("2026aacmp", 40);
    const two = [...one, ...postedAt("2026bbcmp", 40)];
    const three = [...two, ...postedAt("2026cccmp", 40)];
    expect([one, two, three].map((teams) => unseenChampionshipsHeld(teams, 120))).toEqual([2, 1, 0]);
    // A registration makes a key known as well as a posting does.
    expect(unseenChampionshipsHeld([...one, ...registeredAt("2026bbcmp", 5)], 120)).toBe(1);
  });

  it("never holds fewer than one while the posted teams fall short of the capacity line", () => {
    // Two keys known where the capacity implies two events, and 81 posted
    // of the 90 asked for: something is still missing.
    const short = [...postedAt("2026aacmp", 61), ...postedAt("2026bbcmp", 20)];
    expect(unseenChampionshipsHeld(short, 120)).toBe(1);
    // The same two keys with the field at the capacity line: nothing is missing.
    expect(unseenChampionshipsHeld([...postedAt("2026aacmp", 61), ...postedAt("2026bbcmp", 29)], 120)).toBe(0);
  });

  it("the total held, known and unseen together, never rises when a second championship's rows land (2026 California's sizes)", () => {
    // One whole championship is held for each known championship (a stem) and one for each unseen one.
    const total = (teams: readonly DcmpFieldProofTeam[], knownChampionships: number): number => knownChampionships + unseenChampionshipsHeld(teams, 120);
    const north = postedAt("2026cancmp", 61);
    const both = [...north, ...postedAt("2026cascmp", 60)];
    expect(total(north, 1)).toBe(2);
    // With a floor of one here the total would read three for the one tick
    // the second championship's rows carry no state, and then two again.
    expect(total(both, 2)).toBe(2);
  });

  it("over holds for the unseen divisions of one known championship: 2026 FIM with one division posted holds three", () => {
    expect(unseenChampionshipsHeld(postedAt("2026micmp1", 40), 160)).toBe(3);
    const two = [...postedAt("2026micmp1", 40), ...postedAt("2026micmp2", 40)];
    const three = [...two, ...postedAt("2026micmp3", 40)];
    expect([two, three].map((teams) => unseenChampionshipsHeld(teams, 160))).toEqual([2, 1]);
    // All four posted meets the capacity line: none is held beyond the one
    // championship the four divisions are. The finals key is not a field
    // fixing key and is not counted as known.
    const four = [...three, ...postedAt("2026micmp4", 40), ...postedAt("2026micmp", 4)];
    expect(unseenChampionshipsHeld(four, 160)).toBe(0);
  });

  it("rounds a part event up", () => {
    // 100 slots against a largest key of 45: three events may exist.
    expect(unseenChampionshipsHeld(postedAt("2026aacmp", 45), 100)).toBe(2);
  });

  it("holds one where no capacity is published or no key is posted", () => {
    expect(unseenChampionshipsHeld(postedAt("2026aacmp", 40), null)).toBe(1);
    expect(unseenChampionshipsHeld(registeredAt("2026aacmp", 40), 120)).toBe(1);
    expect(unseenChampionshipsHeld([DISTRICT_ONLY], 120)).toBe(1);
  });
});
