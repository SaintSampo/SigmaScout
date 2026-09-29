import { describe, expect, it } from "vitest";
import { CANCELLED_EVENT_GRACE_MS, EVENT_SPAN_ALLOWANCE_MS, isCancelledEvent } from "./cancelledEvent.js";

const NOW = Date.parse("2026-09-29T00:00:00.000Z");

describe("isCancelledEvent (quick task 260929-mcf)", () => {
  it("pins the two literals", () => {
    expect(EVENT_SPAN_ALLOWANCE_MS).toBe(345600000);
    expect(CANCELLED_EVENT_GRACE_MS).toBe(259200000);
  });

  it("a 2020 cancellation with zero played matches is cancelled", () => {
    expect(isCancelledEvent({ startDate: "2020-03-19", playedMatchCount: 0 }, NOW)).toBe(true);
  });

  it("an upcoming zero-match event is not cancelled", () => {
    expect(isCancelledEvent({ startDate: "2026-10-03", playedMatchCount: 0 }, NOW)).toBe(false);
  });

  it("an in-progress zero-match event is not cancelled", () => {
    expect(isCancelledEvent({ startDate: "2026-09-27", playedMatchCount: 0 }, NOW)).toBe(false);
  });

  it("flips exactly at start_date + 7 days", () => {
    const facts = { startDate: "2026-09-22", playedMatchCount: 0 };
    expect(isCancelledEvent(facts, Date.parse("2026-09-28T23:59:59.999Z"))).toBe(false);
    expect(isCancelledEvent(facts, Date.parse("2026-09-29T00:00:00.000Z"))).toBe(true);
  });

  it("a played event is never cancelled", () => {
    expect(isCancelledEvent({ startDate: "2019-03-01", playedMatchCount: 1 }, NOW)).toBe(false);
  });

  it("degrades toward showing on an unparseable start date or a NaN now", () => {
    expect(isCancelledEvent({ startDate: "", playedMatchCount: 0 }, NOW)).toBe(false);
    expect(isCancelledEvent({ startDate: "not-a-date", playedMatchCount: 0 }, NOW)).toBe(false);
    expect(isCancelledEvent({ startDate: "2020-03-19", playedMatchCount: 0 }, Number.NaN)).toBe(false);
  });
});
