import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventSection, endOfEventMetrics } from "./EventSection.js";
import type { TeamSeasonEvent, TeamSeasonMatch } from "./matchAxis.js";
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";

const DOMAIN = { min: 0, max: 500 };

function makeMatch(overrides: Partial<TeamSeasonMatch> = {}): TeamSeasonMatch {
  return {
    matchKey: "2024casj_qm1",
    season: 2024,
    eventKey: "2024casj",
    compLevel: "qm",
    algorithmId: "sigma1",
    algorithmVersion: "2.0.0+tuned-2026-08",
    predictedWinner: "red",
    pRedWin: 0.6,
    predictedRedScore: 250,
    predictedBlueScore: 220,
    redComponents: {},
    blueComponents: {},
    redTeams: ["frc118"],
    blueTeams: ["frc254"],
    ...overrides,
  } as TeamSeasonMatch;
}

function makeEvent(overrides: Partial<TeamSeasonEvent> = {}): TeamSeasonEvent {
  return {
    eventKey: "2024casj",
    eventName: "Sacramento Regional",
    startDate: "2024-03-01",
    matches: [makeMatch()],
    ...overrides,
  } as TeamSeasonEvent;
}

function makeHistoryRow(overrides: Partial<MetricHistoryRow> = {}): MetricHistoryRow {
  return {
    matchKey: "2024casj_qm1",
    season: 2024,
    eventKey: "2024casj",
    algorithmId: "sigma1",
    teamKey: "frc118",
    matchIndex: 0,
    metrics: { total: { value: 88.2 } },
    ...overrides,
  } as MetricHistoryRow;
}

describe("endOfEventMetrics", () => {
  it("returns the LAST metricHistory row matching the event, not the first", () => {
    const rows = [
      makeHistoryRow({ matchIndex: 0, metrics: { total: { value: 50 } } }),
      makeHistoryRow({ matchIndex: 1, metrics: { total: { value: 61.4 } } }),
      makeHistoryRow({ eventKey: "2024txkat", matchIndex: 2, metrics: { total: { value: 999 } } }),
    ];
    const row = endOfEventMetrics(rows, "2024casj");
    expect(row?.metrics.total?.value).toBe(61.4);
  });

  it("returns undefined when no row matches the event", () => {
    expect(endOfEventMetrics([makeHistoryRow({ eventKey: "2024txkat" })], "2024casj")).toBeUndefined();
  });
});

describe("EventSection", () => {
  it("shows the end-of-event snapshot (61.40), never the season-final value (88.20)", () => {
    render(
      <EventSection
        event={makeEvent()}
        domain={DOMAIN}
        teamKey="frc118"
        algorithmId="sigma1"
        season={2024}
        metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4 } } })]}
      />,
    );
    const snapshot = screen.getByTestId("event-snapshot-2024casj");
    expect(snapshot.textContent).toContain("61.40");
    expect(snapshot.textContent).not.toContain("88.20");
  });

  it("renders no snapshot element when no metricHistory row matches this event", () => {
    render(
      <EventSection
        event={makeEvent()}
        domain={DOMAIN}
        teamKey="frc118"
        algorithmId="sigma1"
        season={2024}
        metricHistory={[makeHistoryRow({ eventKey: "2024txkat" })]}
      />,
    );
    expect(screen.queryByTestId("event-snapshot-2024casj")).toBeNull();
  });

  it("shows the Upcoming badge when every match lacks a result, and removes it once one has a result", () => {
    const { rerender } = render(
      <EventSection
        event={makeEvent({ matches: [makeMatch({ matchKey: "m1" }), makeMatch({ matchKey: "m2" })] })}
        domain={DOMAIN}
        teamKey="frc118"
        algorithmId="sigma1"
        season={2024}
        metricHistory={[]}
      />,
    );
    expect(screen.getByText("Upcoming")).toBeDefined();

    rerender(
      <EventSection
        event={makeEvent({
          matches: [
            makeMatch({ matchKey: "m1", actualWinner: "red", actualRedScore: 260, actualBlueScore: 200 }),
            makeMatch({ matchKey: "m2" }),
          ],
        })}
        domain={DOMAIN}
        teamKey="frc118"
        algorithmId="sigma1"
        season={2024}
        metricHistory={[]}
      />,
    );
    expect(screen.queryByText("Upcoming")).toBeNull();
  });

  it("carries the full event name in a title attribute for a 70-character name", () => {
    const longName = "A".repeat(70);
    render(
      <EventSection event={makeEvent({ eventName: longName })} domain={DOMAIN} teamKey="frc118" algorithmId="sigma1" season={2024} metricHistory={[]} />,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.getAttribute("title")).toBe(longName);
    expect(heading.textContent).toBe(longName);
  });

  it("carries an elevation class and a surface class distinct from the page background (06-09-PLAN.md Task 3 polish pass)", () => {
    render(<EventSection event={makeEvent()} domain={DOMAIN} teamKey="frc118" algorithmId="sigma1" season={2024} metricHistory={[]} />);
    const section = screen.getByTestId("event-section-2024casj");
    expect(section.className).toContain("shadow-sm");
    expect(section.className).toContain("event-card");
    expect(section.className).not.toContain("bg-[var(--color-bg-page)]");
  });

  it("renders 'Rank 5 of 32' when the event fixture carries rank and totalTeams (TEAM-04/F-06-3, plan 06.1-01)", () => {
    render(
      <EventSection
        event={makeEvent({ rank: 5, totalTeams: 32 })}
        domain={DOMAIN}
        teamKey="frc118"
        algorithmId="sigma1"
        season={2024}
        metricHistory={[]}
      />,
    );
    const standing = screen.getByTestId("event-standing-2024casj");
    expect(standing.textContent).toBe("Rank 5 of 32");
  });

  it("gives two sections distinct scroller test ids", () => {
    render(
      <>
        <EventSection event={makeEvent({ eventKey: "2024casj" })} domain={DOMAIN} teamKey="frc118" algorithmId="sigma1" season={2024} metricHistory={[]} />
        <EventSection
          event={makeEvent({ eventKey: "2024txkat", eventName: "FIT District Katy Event" })}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="sigma1"
          season={2024}
          metricHistory={[]}
        />
      </>,
    );
    const first = screen.getByTestId("match-table-scroll-2024casj");
    const second = screen.getByTestId("match-table-scroll-2024txkat");
    expect(first).not.toBe(second);
  });
});
