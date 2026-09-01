/**
 * Coverage for the D-18 item 8 identity header (07-15-PLAN.md Task 1).
 * Every fixture is built by calling `EventArtifactSchema.parse` on a
 * hand-written object — never a bare literal cast to the type — so the
 * schema guarantees PD-02 rests on are exercised by these tests themselves.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  EventArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  type EventArtifact,
} from "../../../../../packages/harness/pageArtifacts.js";
import { EventHeader, EventHeaderSkeleton, eventMetaLine, formatEventStartDate, tbaEventUrl } from "./EventHeader.js";

function baseArtifactInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "vpr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    eventKey: "2024casf",
    season: 2024,
    matches: [],
    upcoming: [],
    teams: [],
    ...overrides,
  };
}

function makeArtifact(overrides: Record<string, unknown> = {}): EventArtifact {
  return EventArtifactSchema.parse(baseArtifactInput(overrides));
}

describe("EventHeader — populated (E1 populated)", () => {
  afterEach(() => cleanup());

  it("Test 1: renders the name as the h1 and the metadata line in date, location, week order", () => {
    const artifact = makeArtifact({ name: "San Francisco Regional", startDate: "2024-03-07", location: "CA, USA", week: 1 });
    render(<EventHeader artifact={artifact} />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("San Francisco Regional");

    const meta = screen.getByTestId("event-header-meta");
    const dateIndex = meta.textContent?.indexOf(formatEventStartDate("2024-03-07")) ?? -1;
    const locationIndex = meta.textContent?.indexOf("CA, USA") ?? -1;
    const weekIndex = meta.textContent?.indexOf("Week 2") ?? -1; // stored 1 -> displayed 2 (TBA weeks are 0-indexed)
    expect(dateIndex).toBeGreaterThanOrEqual(0);
    expect(locationIndex).toBeGreaterThan(dateIndex);
    expect(weekIndex).toBeGreaterThan(locationIndex);
  });
});

describe("EventHeader — absent name falls back to the event key (E1 empty)", () => {
  afterEach(() => cleanup());

  it("Test 2: no name key renders the event key exactly, never a prettified variant", () => {
    const artifact = makeArtifact({ eventKey: "2024casf" });
    render(<EventHeader artifact={artifact} />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("2024casf");
  });
});

describe("EventHeader — the empty-string case is unreachable (E1 empty dismissal, PD-02)", () => {
  it("Test 3: EventArtifactSchema.parse throws for name: '' and separately for location: ''", () => {
    expect(() => EventArtifactSchema.parse(baseArtifactInput({ name: "" }))).toThrow();
    expect(() => EventArtifactSchema.parse(baseArtifactInput({ location: "" }))).toThrow();
  });
});

describe("EventHeader — week's three distinct outcomes (E1 partial)", () => {
  afterEach(() => cleanup());

  it("Test 4: stored week 3 renders 'Week 4' (0-indexed source); null omits the segment entirely, never 'Offseason' (champs divisions carry null); absent omits it too", () => {
    render(<EventHeader artifact={makeArtifact({ week: 3 })} />);
    let meta = screen.getByTestId("event-header-meta");
    expect(meta.textContent).toBe("Week 4");
    cleanup();

    // A null week beside a present location proves the omission leaves no
    // separator and no placeholder behind: the line IS the location alone.
    render(<EventHeader artifact={makeArtifact({ week: null, location: "CA, USA" })} />);
    meta = screen.getByTestId("event-header-meta");
    expect(meta.textContent).not.toContain("Offseason");
    expect(meta.textContent).not.toContain("Week");
    expect(meta.textContent).not.toContain("—");
    expect(meta.textContent).toBe("CA, USA");
    cleanup();

    render(<EventHeader artifact={makeArtifact()} />);
    meta = screen.getByTestId("event-header-meta");
    expect(meta.textContent).not.toContain("Week");
    expect(meta.textContent).not.toContain("Offseason");
    expect(meta.textContent).toBe("");
  });

  it("Test 5: week 0 survives — renders 'Week 1' (the 0-indexed source's first week), not Offseason", () => {
    expect(eventMetaLine({ week: 0 })).toContain("Week 1");
    expect(eventMetaLine({ week: 0 })).not.toContain("Offseason");

    render(<EventHeader artifact={makeArtifact({ week: 0 })} />);
    const meta = screen.getByTestId("event-header-meta");
    expect(meta.textContent).toContain("Week 1");
    expect(meta.textContent).not.toContain("Offseason");
  });
});

describe("EventHeader — location absence and null (E1 partial)", () => {
  afterEach(() => cleanup());

  it("Test 6: location null and absent location both omit the segment entirely, never the literal text null and never a placeholder", () => {
    // A present week alongside proves the null location contributes neither
    // text nor a separator: the whole line is the week segment alone.
    render(<EventHeader artifact={makeArtifact({ location: null, week: 3 })} />);
    let meta = screen.getByTestId("event-header-meta");
    expect(meta.textContent).toBe("Week 4");
    expect(meta.textContent).not.toContain("—");
    expect(meta.textContent?.toLowerCase()).not.toMatch(/\bnull\b/);
    cleanup();

    render(<EventHeader artifact={makeArtifact()} />);
    meta = screen.getByTestId("event-header-meta");
    expect(meta.textContent).toBe("");
    expect(meta.textContent?.toLowerCase()).not.toMatch(/\bnull\b/);
  });
});

describe("EventHeader — startDate absence (E1 partial)", () => {
  afterEach(() => cleanup());

  it("Test 7: no startDate key omits the date segment entirely, so the line starts with the next present fact and invents no date", () => {
    render(<EventHeader artifact={makeArtifact({ location: "CA, USA", week: 3 })} />);
    const meta = screen.getByTestId("event-header-meta");
    expect(meta.textContent).toBe("CA, USA · Week 4");
    expect(meta.textContent).not.toContain("—");
  });
});

describe("formatEventStartDate — timezone stability (PD-04)", () => {
  it("Test 8: pins UTC so the rendered day never reads as the 6th under a negative-offset TZ, and undefined returns the empty string", () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const formatted = formatEventStartDate("2024-03-07");
      expect(formatted).toContain("7");
      expect(formatted).not.toContain("6");
      expect(formatted).toMatch(/Mar/);
    } finally {
      process.env.TZ = originalTZ;
    }

    expect(formatEventStartDate(undefined)).toBe("");
  });
});

describe("eventMetaLine — the full cross-product (E1 partial, all absence rules)", () => {
  it("Test 9: every combination of present/absent startDate, present/null/absent location, and number/zero/null/absent week returns the exact join of PRESENT segments only", () => {
    // Spot-pins first, hardcoded rather than composed, so the join rule
    // itself (segments joined by " · ", absences omitted, no placeholder
    // segments) is pinned independently of the loop below.
    const date = formatEventStartDate("2024-03-07");
    expect(eventMetaLine({ startDate: "2024-03-07", location: "CA, USA", week: 3 })).toBe(`${date} · CA, USA · Week 4`);
    expect(eventMetaLine({ location: "CA, USA", week: 3 })).toBe("CA, USA · Week 4");
    expect(eventMetaLine({ startDate: "2024-03-07", location: null, week: null })).toBe(date);
    expect(eventMetaLine({ week: 0 })).toBe("Week 1");

    const startDates: (string | undefined)[] = [undefined, "2024-03-07"];
    const locations: (string | null | undefined)[] = [undefined, null, "CA, USA"];
    const weeks: (number | null | undefined)[] = [undefined, null, 0, 3];

    let assertedCombinations = 0;
    for (const startDate of startDates) {
      for (const location of locations) {
        for (const week of weeks) {
          const segments: string[] = [];
          if (startDate !== undefined) segments.push(formatEventStartDate(startDate));
          if (location !== undefined && location !== null) segments.push(location);
          if (week !== undefined && week !== null) segments.push(`Week ${week + 1}`);
          const expected = segments.join(" · ");

          const actual = eventMetaLine({ startDate, location, week });
          expect(actual).toBe(expected);
          expect(actual).not.toContain("—");
          assertedCombinations += 1;
        }
      }
    }
    expect(assertedCombinations).toBeGreaterThanOrEqual(24);
  });

  it("eventMetaLine({}) returns the empty string: no placeholder segments at all", () => {
    expect(eventMetaLine({})).toBe("");
  });
});

describe("EventHeader — the TBA link (Copywriting Contract Primary CTA, T-07-15-01/02)", () => {
  afterEach(() => cleanup());

  it("Test 10: the populated render exposes a working, correctly-attributed anchor; an invalid key yields no anchor at all", () => {
    const artifact = makeArtifact({ eventKey: "2024casf" });
    render(<EventHeader artifact={artifact} />);

    const link = screen.getByRole("link", { name: "View on TBA" });
    expect(link.getAttribute("href")).toBe("https://www.thebluealliance.com/event/2024casf");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");

    expect(tbaEventUrl("notanevent")).toBeUndefined();
    cleanup();

    render(<EventHeader artifact={makeArtifact({ eventKey: "2024casf" })} />);
    // sanity: the earlier assertions used a valid key; a render built from an
    // artifact whose eventKey the pattern rejects would produce zero links —
    // proven directly against the pure function above rather than by trying
    // to construct an artifact carrying an invalid key (the schema/route
    // already gate that upstream of this component, PD-01).
    expect(screen.queryAllByRole("link", { name: "View on TBA" })).toHaveLength(1);
  });
});

describe("EventHeader — long name overflow/long-text (E1 backstop)", () => {
  afterEach(() => cleanup());

  it("Test 11: a 124-character name renders whole in both the title attribute and the text content, with a truncation class present", () => {
    const longName =
      "FCH District Chesapeake VA Event presented by Newport News Ship Yard / Hampton Roads Community Foundation (Norfolk Southern)";
    expect(longName.length).toBe(124);

    const artifact = makeArtifact({ name: longName });
    render(<EventHeader artifact={artifact} />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.getAttribute("title")).toBe(longName);
    expect(heading.textContent).toBe(longName);
    expect(heading.className).toMatch(/truncate/);
  });
});

describe("EventHeaderSkeleton — pending state (E1 loading)", () => {
  afterEach(() => cleanup());

  it("Test 12: renders the skeleton testid and zero progressbar elements", () => {
    render(<EventHeaderSkeleton />);
    expect(screen.getByTestId("event-header-skeleton")).toBeDefined();
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  });
});
