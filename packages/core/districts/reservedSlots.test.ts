/**
 * `reservedSlots.ts`'s counting rule. Pure and synthetic: this module reads no
 * artifact and no corpus, so every case here is four booleans and a number.
 *
 * THE CASE THAT MATTERS MOST is the last describe. The cancelled carve out is
 * the only way a slot is NOT held back for an open award, so an over-eager
 * version of it would quietly restore the exact defect the reservation exists
 * to fix — a `Locked` promise revoked the next day. Both directions are pinned
 * here: the 2020 shape (no matches ever played, award posted anyway) must NOT
 * be called cancelled, and the registered-never-played shape must be.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_CATEGORIES_OPEN,
  districtEventCategoryFinality,
  districtEventStateFinished,
  districtEventStateStarted,
  reservedImpactSlots,
  type DistrictEventStateFacts,
  type ReservedSlotEvent,
} from "./reservedSlots.js";

const FINISHED: DistrictEventStateFacts = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
/** Played out, Impact not posted — the shape that produced all thirteen tenet-A violations. */
const PLAYOFFS_DONE_NO_AWARD: DistrictEventStateFacts = { ...FINISHED, awardsPosted: false };
/** Scheduled, not started. */
const AHEAD: DistrictEventStateFacts = { qualMatchesPlayed: 0, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false };
/** Registered, no schedule ever published, never played, never awarded. */
const NEVER_HAPPENED: DistrictEventStateFacts = { qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: false, playoffsDone: false, awardsPosted: false };
/** The 2020 cancellations, exactly as the published artifacts carry them: no matches at all, Chairman's award posted anyway. */
const CANCELLED_BUT_AWARDED: DistrictEventStateFacts = { qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: false, playoffsDone: false, awardsPosted: true };

function event(eventKey: string, stateAtNow: DistrictEventStateFacts | undefined, awardFinalAtPosition: boolean): ReservedSlotEvent {
  return { eventKey, stateAtNow, awardFinalAtPosition };
}

describe("the two state predicates", () => {
  it("counts an event as started on ANY of the four facts, awards included", () => {
    expect(districtEventStateStarted(AHEAD)).toBe(false);
    expect(districtEventStateStarted({ ...AHEAD, qualMatchesPlayed: 1 })).toBe(true);
    expect(districtEventStateStarted({ ...AHEAD, alliancesPicked: true })).toBe(true);
    expect(districtEventStateStarted({ ...AHEAD, playoffsDone: true })).toBe(true);
    expect(districtEventStateStarted(CANCELLED_BUT_AWARDED)).toBe(true);
  });

  it("leaves a null qualMatchesTotal unfinished rather than guessing the schedule was empty", () => {
    expect(districtEventStateFinished(FINISHED)).toBe(true);
    expect(districtEventStateFinished(PLAYOFFS_DONE_NO_AWARD)).toBe(false);
    expect(districtEventStateFinished(CANCELLED_BUT_AWARDED)).toBe(false);
  });
});

describe("districtEventCategoryFinality", () => {
  it("reads each category off its own state fact", () => {
    expect(districtEventCategoryFinality(FINISHED)).toEqual({ qual: true, alliance: true, elim: true, award: true });
    expect(districtEventCategoryFinality(PLAYOFFS_DONE_NO_AWARD)).toEqual({ qual: true, alliance: true, elim: true, award: false });
    expect(districtEventCategoryFinality(AHEAD)).toEqual({ qual: false, alliance: false, elim: false, award: false });
    expect(districtEventCategoryFinality(CANCELLED_BUT_AWARDED)).toEqual({ qual: false, alliance: false, elim: false, award: true });
  });

  it("leaves qualification OPEN for a partly played schedule and for a null total", () => {
    expect(districtEventCategoryFinality({ ...FINISHED, qualMatchesPlayed: 59 }).qual).toBe(false);
    expect(districtEventCategoryFinality({ ...FINISHED, qualMatchesTotal: null }).qual).toBe(false);
  });

  it("reports every category open for an ABSENT state block rather than guessing any of them final", () => {
    expect(districtEventCategoryFinality(undefined)).toEqual(ALL_CATEGORIES_OPEN);
    expect(ALL_CATEGORIES_OPEN).toEqual({ qual: false, alliance: false, elim: false, award: false });
  });

  it("is what districtEventStateFinished means, so the two can never drift", () => {
    for (const state of [FINISHED, PLAYOFFS_DONE_NO_AWARD, AHEAD, NEVER_HAPPENED, CANCELLED_BUT_AWARDED]) {
      const final = districtEventCategoryFinality(state);
      expect(districtEventStateFinished(state)).toBe(final.qual && final.alliance && final.elim && final.award);
    }
  });
});

describe("reservedImpactSlots", () => {
  it("reserves nothing when every event has posted its awards — every finished season in the corpus", () => {
    expect(reservedImpactSlots([event("a", FINISHED, true), event("b", FINISHED, true)])).toBe(0);
  });

  it("reserves one per event whose award is still open at the position", () => {
    expect(reservedImpactSlots([event("a", FINISHED, true), event("b", PLAYOFFS_DONE_NO_AWARD, false), event("c", AHEAD, false)])).toBe(2);
  });

  it("reserves nothing for an event whose award IS final at the position, whatever its state says", () => {
    // This is the no-double-count rule: an event whose award is final is
    // already consuming a slot through `locks.ts`'s awardQualified set.
    expect(reservedImpactSlots([event("a", PLAYOFFS_DONE_NO_AWARD, true)])).toBe(0);
  });

  it("reserves for an event the artifact carries NO state for while the season is still running — an unknown award is not a posted one", () => {
    expect(reservedImpactSlots([event("a", PLAYOFFS_DONE_NO_AWARD, false), event("b", undefined, false)])).toBe(2);
    // A whole artifact published before the state blocks existed carries no
    // state anywhere, so nothing is finished, so every event reserves. That is
    // the conservative fallback, not a live path: every artifact published
    // since phase 10 carries a state block on every row.
    expect(reservedImpactSlots([event("a", undefined, false), event("b", undefined, false)])).toBe(2);
  });

  it("returns zero for an empty event list rather than throwing", () => {
    expect(reservedImpactSlots([])).toBe(0);
  });
});

describe("the cancelled carve out", () => {
  it("reserves NOTHING for a registered, never played, never awarded event once every other event has finished", () => {
    expect(reservedImpactSlots([event("a", FINISHED, true), event("dead", NEVER_HAPPENED, false)])).toBe(0);
  });

  it("STILL RESERVES for that same event while any other event of the district is unfinished — a live season never calls anything cancelled", () => {
    expect(reservedImpactSlots([event("a", PLAYOFFS_DONE_NO_AWARD, false), event("dead", NEVER_HAPPENED, false)])).toBe(2);
    expect(reservedImpactSlots([event("a", AHEAD, false), event("dead", NEVER_HAPPENED, false)])).toBe(2);
  });

  it("never calls a 2020-shaped cancellation cancelled: no matches were ever played there, and the Chairman's award was posted anyway", () => {
    // At `now` the award is final, so nothing is reserved. At a rewound
    // position the slider reopens it, and the slot MUST be held back — those
    // twelve 2020 rows are twelve of the thirteen measured violations.
    expect(reservedImpactSlots([event("a", FINISHED, true), event("c2020", CANCELLED_BUT_AWARDED, true)])).toBe(0);
    expect(reservedImpactSlots([event("a", FINISHED, true), event("c2020", CANCELLED_BUT_AWARDED, false)])).toBe(1);
  });

  it("reserves for a SCHEDULED future event, which is not the same thing as one that will never happen", () => {
    expect(reservedImpactSlots([event("a", FINISHED, true), event("b", AHEAD, false)])).toBe(1);
  });

  it("calls an event with no state block at all cancelled once every other event has finished, on the same three clauses", () => {
    // No state is strictly less evidence than a null schedule, so it cannot
    // reserve where `NEVER_HAPPENED` does not. The season being over is what
    // makes the call, exactly as above.
    expect(reservedImpactSlots([event("a", FINISHED, true), event("dead", undefined, false)])).toBe(0);
  });

  it("treats a whole district of never-played events as one cancelled event each only when every OTHER one is finished, so two dead events still reserve", () => {
    // Neither is finished, so neither can clear the other's "every other event
    // finished" clause. Conservative on purpose: two events with no schedule
    // in a season still running are two awards still to come.
    expect(reservedImpactSlots([event("d1", NEVER_HAPPENED, false), event("d2", NEVER_HAPPENED, false)])).toBe(2);
  });
});
