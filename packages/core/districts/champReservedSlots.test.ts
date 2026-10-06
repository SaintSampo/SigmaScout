/**
 * `champReservedSlots.ts`'s counting rule. Pure and synthetic: this module
 * reads no artifact and no history, the ceilings arrive as an argument.
 */
import { describe, expect, it } from "vitest";
import { MAX_WINNING_ALLIANCE_SIZE, dcmpNeverHappening, pendingAwardSlots, reservedChampSlots } from "./champReservedSlots.js";
import type { DistrictEventStateFacts } from "./reservedSlots.js";

const FNC: Readonly<Record<0 | 9 | 10, number>> = { 0: 1, 9: 2, 10: 2 };

const live = (over: Partial<ChampArgs> = {}) => reservedChampSlots({ elimFinal: false, awardFinal: false, awardCeilings: FNC, neverHappening: false, ...over });
type ChampArgs = Parameters<typeof reservedChampSlots>[0];

describe("reservedChampSlots", () => {
  it("holds back the winning alliance AND every judged consuming award while both are open", () => {
    expect(live()).toBe(MAX_WINNING_ALLIANCE_SIZE + 5);
  });

  it("drops the winner reservation once the playoffs are final, keeping the awards", () => {
    // FNC 2026 at the "playoffs done, awards open" stop: 7890 read Locked with
    // 10 threats against 11 slots. Five held back makes that 6, and no team at
    // that margin reads Locked.
    expect(live({ elimFinal: true })).toBe(5);
  });

  it("reserves nothing once the awards are final, playoffs flag or not", () => {
    expect(live({ elimFinal: true, awardFinal: true })).toBe(0);
    // 2020: Chairman's posted, no match played. Awards final means over.
    expect(live({ elimFinal: false, awardFinal: true })).toBe(0);
  });

  it("reserves nothing for a championship that is never happening", () => {
    expect(live({ neverHappening: true })).toBe(0);
  });

  it("sums the three judged types and ignores a negative ceiling", () => {
    expect(pendingAwardSlots({ 0: 1, 9: 1, 10: 0 })).toBe(2);
    expect(pendingAwardSlots({ 0: 5, 9: 2, 10: 2 })).toBe(9);
    expect(pendingAwardSlots({ 0: 1, 9: -3, 10: 1 })).toBe(2);
  });
});

describe("dcmpNeverHappening", () => {
  const blank: DistrictEventStateFacts = { qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: false, playoffsDone: false, awardsPosted: false };

  it("is true for a past season with no observed state at all (2020isr)", () => {
    expect(dcmpNeverHappening({ dcmpStates: [], artifactYear: 2020, nowYear: 2026 })).toBe(true);
    expect(dcmpNeverHappening({ dcmpStates: [undefined, undefined], artifactYear: 2020, nowYear: 2026 })).toBe(true);
  });

  it("is true for a past season whose blocks never started and never scheduled", () => {
    expect(dcmpNeverHappening({ dcmpStates: [blank, undefined], artifactYear: 2020, nowYear: 2026 })).toBe(true);
  });

  it("is false the moment any block shows a schedule or a start, awards included", () => {
    expect(dcmpNeverHappening({ dcmpStates: [{ ...blank, qualMatchesTotal: 90 }], artifactYear: 2020, nowYear: 2026 })).toBe(false);
    expect(dcmpNeverHappening({ dcmpStates: [{ ...blank, awardsPosted: true }], artifactYear: 2020, nowYear: 2026 })).toBe(false);
    expect(dcmpNeverHappening({ dcmpStates: [undefined, { ...blank, qualMatchesPlayed: 1 }], artifactYear: 2020, nowYear: 2026 })).toBe(false);
  });

  it("never fires for the current season, even with nothing observed — the registration window", () => {
    expect(dcmpNeverHappening({ dcmpStates: [], artifactYear: 2026, nowYear: 2026 })).toBe(false);
    expect(dcmpNeverHappening({ dcmpStates: [], artifactYear: 2027, nowYear: 2026 })).toBe(false);
  });
});
