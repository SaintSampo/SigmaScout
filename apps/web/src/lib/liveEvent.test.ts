import { describe, expect, it } from "vitest";
import { SCHEDULE_STALE_AFTER_MS } from "../../../../packages/harness/eventSchedule.js";
import { formatScheduledTime } from "../components/team/MatchTable.js";
import {
  EVENT_POLL_INTERVAL_MS,
  districtEventStateFinished,
  districtEventStateStarted,
  eventArtifactScheduleIsCurrent,
  shouldPollDistrictArtifact,
  shouldPollEventArtifact,
  shouldPollTeamArtifact,
  sortTimeToEpochMs,
} from "./liveEvent.js";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function artifact(upcomingSortTimes: (number | undefined)[], playedSortTimes: (number | undefined)[] = [], startDate?: string) {
  const row = (sortTime: number | undefined) => (sortTime === undefined ? {} : { sortTime });
  return { matches: playedSortTimes.map(row), upcoming: upcomingSortTimes.map(row), ...(startDate !== undefined ? { startDate } : {}) };
}

describe("sortTimeToEpochMs", () => {
  it("passes epoch ms through and scales epoch seconds, split at 1e11", () => {
    expect(sortTimeToEpochMs(NOW)).toBe(NOW);
    expect(sortTimeToEpochMs(NOW / 1000)).toBe(NOW);
  });

  it("formatScheduledTime renders the same instant for the seconds and the milliseconds form", () => {
    expect(formatScheduledTime(NOW / 1000)).toBe(formatScheduledTime(NOW));
  });
});

describe("shouldPollEventArtifact", () => {
  it("polls at 60 s, the origin's max-age", () => {
    expect(EVENT_POLL_INTERVAL_MS).toBe(60_000);
  });

  it("true for upcoming matches whose latest sortTime is within 7 days of now", () => {
    expect(shouldPollEventArtifact(artifact([NOW + 3_600_000]), NOW)).toBe(true);
    expect(shouldPollEventArtifact(artifact([NOW - 2 * DAY]), NOW)).toBe(true);
    expect(shouldPollEventArtifact(artifact([NOW - SCHEDULE_STALE_AFTER_MS]), NOW)).toBe(true);
  });

  it("false for an empty upcoming, even with a current schedule", () => {
    expect(shouldPollEventArtifact(artifact([], [NOW - 3_600_000]), NOW)).toBe(false);
  });

  it("false when the latest sortTime is 8 days before now", () => {
    expect(shouldPollEventArtifact(artifact([NOW - 8 * DAY], [NOW - 9 * DAY]), NOW)).toBe(false);
  });

  it("false for undefined data", () => {
    expect(shouldPollEventArtifact(undefined, NOW)).toBe(false);
  });

  it("normalizes seconds-unit sortTimes before the check", () => {
    // In seconds, NOW / 1000 is a tiny number; read raw as ms it would be 1970 and never current.
    expect(shouldPollEventArtifact(artifact([NOW / 1000]), NOW)).toBe(true);
    expect(shouldPollEventArtifact(artifact([(NOW - 8 * DAY) / 1000]), NOW)).toBe(false);
  });

  it("the latest time counts across played and upcoming rows, and startDate stands in when no row has a time", () => {
    expect(eventArtifactScheduleIsCurrent(artifact([NOW - 8 * DAY], [NOW - 1 * DAY]), NOW)).toBe(true);
    expect(shouldPollEventArtifact(artifact([undefined], [], "2026-09-14"), NOW)).toBe(true);
    expect(shouldPollEventArtifact(artifact([undefined], [], "2026-08-01"), NOW)).toBe(false);
  });
});

describe("shouldPollTeamArtifact", () => {
  const unplayed = (sortTime?: number) => ({ ...(sortTime !== undefined ? { sortTime } : {}) });
  const played = (sortTime?: number) => ({ actualWinner: "red" as const, ...(sortTime !== undefined ? { sortTime } : {}) });

  /**
   * REPLACES `teamEventNeedsLivePricing` (quick task 260923-3w7), which asked a
   * different question for a page that no longer exists in that form: "should
   * this robot page FETCH that event's artifact?", so it could rebuild its live
   * rows from one. The tick writes the team artifact again, so the page reads
   * one file and the only remaining question is how often to re-read it.
   *
   * The schedule-currency conjunct 260917-jr4 deliberately removed is back,
   * and the case it was removed for cannot recur: currency gates POLLING here,
   * never a fetch, and the published team artifact carries every result whether
   * or not this returns true.
   */
  it("true with an unplayed row at an event whose schedule is current", () => {
    expect(shouldPollTeamArtifact({ events: [{ startDate: "2026-09-13", matches: [played(NOW - DAY), unplayed(NOW + 3_600_000)] }] }, NOW)).toBe(true);
  });

  it("false when every row is played", () => {
    expect(shouldPollTeamArtifact({ events: [{ startDate: "2026-09-13", matches: [played(NOW - DAY), played(NOW - 3_600_000)] }] }, NOW)).toBe(false);
  });

  it("false for a long-finished event with never-played leftover matches — polling a dead event every 60 s is what the currency test exists to stop", () => {
    expect(
      shouldPollTeamArtifact(
        { events: [{ startDate: "2016-03-10", matches: [played(Date.parse("2016-03-12T15:00:00Z")), unplayed(Date.parse("2016-03-12T16:00:00Z"))] }] },
        NOW
      )
    ).toBe(false);
  });

  it("any one current event with an unplayed row is enough, and a stale sibling event never suppresses it", () => {
    const stale = { startDate: "2016-03-10", matches: [unplayed(Date.parse("2016-03-12T16:00:00Z"))] };
    const current = { startDate: "2026-09-13", matches: [unplayed(NOW + 3_600_000)] };
    expect(shouldPollTeamArtifact({ events: [stale] }, NOW)).toBe(false);
    expect(shouldPollTeamArtifact({ events: [stale, current] }, NOW)).toBe(true);
  });

  it("falls back to startDate when no row carries a time, and refuses an undefined artifact", () => {
    expect(shouldPollTeamArtifact({ events: [{ startDate: "2026-09-14", matches: [unplayed()] }] }, NOW)).toBe(true);
    expect(shouldPollTeamArtifact({ events: [{ startDate: "2026-08-01", matches: [unplayed()] }] }, NOW)).toBe(false);
    expect(shouldPollTeamArtifact(undefined, NOW)).toBe(false);
  });
});

describe("the district artifact's own poll gate (phase 10)", () => {
  const finished = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
  const midQuals = { qualMatchesPlayed: 20, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false };
  const unstarted = { qualMatchesPlayed: 0, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false };
  const noSchedule = { qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: false, playoffsDone: false, awardsPosted: false };

  function district(rows: { tier: "district" | "dcmp"; state?: typeof finished }[]) {
    return { teams: [{ eventPoints: rows, remainingEvents: [] }] };
  }

  it("reads started from any one of the four facts", () => {
    expect(districtEventStateStarted(unstarted)).toBe(false);
    expect(districtEventStateStarted(midQuals)).toBe(true);
    expect(districtEventStateStarted({ ...unstarted, alliancesPicked: true })).toBe(true);
    expect(districtEventStateStarted({ ...unstarted, playoffsDone: true })).toBe(true);
    expect(districtEventStateStarted({ ...unstarted, awardsPosted: true })).toBe(true);
  });

  it("never calls an event finished while its schedule length is unpublished", () => {
    expect(districtEventStateFinished(finished)).toBe(true);
    expect(districtEventStateFinished({ ...noSchedule, alliancesPicked: true, playoffsDone: true, awardsPosted: true })).toBe(false);
  });

  it("polls only while a member DISTRICT-tier event is started and not finished", () => {
    expect(shouldPollDistrictArtifact(undefined)).toBe(false);
    expect(shouldPollDistrictArtifact(district([{ tier: "district", state: finished }]))).toBe(false);
    expect(shouldPollDistrictArtifact(district([{ tier: "district", state: unstarted }]))).toBe(false);
    expect(shouldPollDistrictArtifact(district([{ tier: "district", state: midQuals }]))).toBe(true);
  });

  it("ignores a dcmp-tier row and a row carrying no state block at all", () => {
    expect(shouldPollDistrictArtifact(district([{ tier: "dcmp", state: midQuals }]))).toBe(false);
    expect(shouldPollDistrictArtifact(district([{ tier: "district" }]))).toBe(false);
  });
});
