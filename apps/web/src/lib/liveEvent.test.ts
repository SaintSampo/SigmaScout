import { describe, expect, it } from "vitest";
import { STATE_BLOCK_STALE_AFTER_MS } from "../../../../packages/harness/eventSchedule.js";
import { formatScheduledTime } from "../components/team/MatchTable.js";
import { EVENT_POLL_INTERVAL_MS, eventArtifactScheduleIsCurrent, shouldPollEventArtifact, sortTimeToEpochMs, teamEventNeedsLivePricing } from "./liveEvent.js";

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
    expect(shouldPollEventArtifact(artifact([NOW - STATE_BLOCK_STALE_AFTER_MS]), NOW)).toBe(true);
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

describe("teamEventNeedsLivePricing", () => {
  const unplayed = (sortTime?: number) => ({ ...(sortTime !== undefined ? { sortTime } : {}) });
  const played = (sortTime?: number) => ({ actualWinner: "red" as const, ...(sortTime !== undefined ? { sortTime } : {}) });

  it("true with an unplayed row", () => {
    expect(teamEventNeedsLivePricing({ startDate: "2026-09-13", matches: [played(NOW - DAY), unplayed(NOW + 3_600_000)] })).toBe(true);
  });

  it("false when every row is played", () => {
    expect(teamEventNeedsLivePricing({ startDate: "2026-09-13", matches: [played(NOW - DAY), played(NOW - 3_600_000)] })).toBe(false);
  });

  /**
   * THE INVERTED CASE, and the point of inverting it (quick task 260917-jr4).
   * This used to assert `false`: a long-finished event whose leftover matches
   * were never played was not fetched, because the schedule-currency conjunct
   * had expired. That was safe only while the live Worker rewrote the team
   * artifact. It no longer writes one at all, so under the old rule a FINISHED
   * event's matches would render as UNPLAYED from the moment the 7-day window
   * closed until the next offline republish.
   *
   * The cost of the inversion is one extra CDN-cached fetch per robot page for
   * a genuinely abandoned event, forever. `shouldPollEventArtifact` (asserted
   * above, deliberately unchanged) still refuses to POLL such an event every
   * 60 seconds, which is the expensive half.
   */
  it("TRUE for a long-finished event with never-played leftover matches — the currency conjunct was removed on purpose", () => {
    expect(teamEventNeedsLivePricing({ startDate: "2016-03-10", matches: [played(Date.parse("2016-03-12T15:00:00Z")), unplayed(Date.parse("2016-03-12T16:00:00Z"))] })).toBe(true);
  });

  it("does not consult startDate or the clock at all — only whether an unplayed published row exists", () => {
    expect(teamEventNeedsLivePricing({ startDate: "2026-09-16", matches: [unplayed()] })).toBe(true);
    expect(teamEventNeedsLivePricing({ startDate: "2025-03-01", matches: [unplayed()] })).toBe(true);
    expect(teamEventNeedsLivePricing({ startDate: "2025-03-01", matches: [played()] })).toBe(false);
    // Non-vacuity for "the clock is not consulted": `shouldPollEventArtifact`
    // on the SAME shape still is, so this is a targeted removal rather than a
    // repo-wide loss of the currency test.
    expect(shouldPollEventArtifact({ matches: [played()], upcoming: [unplayed()], startDate: "2025-03-01" }, NOW)).toBe(false);
  });
});
