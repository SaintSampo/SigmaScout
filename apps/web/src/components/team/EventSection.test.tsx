import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderWithRouter } from "@/test/routerHarness";
import { EventSection, endOfEventMetrics } from "./EventSection.js";
import { MetricValue } from "@/components/MetricValue";
import { totalColumnHeader } from "@/components/TotalSigmaValue";
import { tierForPercentile } from "../../lib/tiers.js";
import type { TeamSeasonEvent, TeamSeasonMatch } from "./matchAxis.js";
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";
import { SIGMA_METRIC_KEY } from "../../../../../packages/harness/sigmaScore.js";

const DOMAIN = { min: 0, max: 500 };

function makeMatch(overrides: Partial<TeamSeasonMatch> = {}): TeamSeasonMatch {
  return {
    matchKey: "2024casj_qm1",
    season: 2024,
    eventKey: "2024casj",
    compLevel: "qm",
    algorithmId: "spr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    predictedWinner: "red",
    pRedWin: 0.6,
    predictedRedScore: 250,
    predictedBlueScore: 220,
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
    algorithmId: "spr",
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
    renderWithRouter(
      <EventSection
        event={makeEvent()}
        domain={DOMAIN}
        teamKey="frc118"
        algorithmId="spr"
        season={2024}
        metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4 } } })]}
      />,
    );
    const snapshot = screen.getByTestId("event-snapshot-2024casj");
    expect(snapshot.textContent).toContain("61.40");
    expect(snapshot.textContent).not.toContain("88.20");
  });

  it("puts Total on its own first line and Auto, Teleop and Endgame together on the line below", () => {
    renderWithRouter(
      <EventSection
        event={makeEvent()}
        domain={DOMAIN}
        teamKey="frc118"
        algorithmId="spr"
        season={2024}
        metricHistory={[
          makeHistoryRow({
            metrics: { total: { value: 61.4 }, phaseAuto: { value: 12 }, phaseTeleop: { value: 30 }, phaseEndgame: { value: 19.4 } },
          }),
        ]}
      />,
    );
    const [totalLine, phaseLine] = Array.from(screen.getByTestId("event-snapshot-2024casj").children);
    expect(totalLine?.textContent).toBe("Total61.40");
    expect(Array.from(phaseLine?.children ?? []).map((pair) => pair.firstElementChild?.textContent)).toEqual(["Auto", "Teleop", "Endgame"]);
    expect(phaseLine?.className).toContain("flex-nowrap");
  });

  it("renders no snapshot element when no metricHistory row matches this event", () => {
    renderWithRouter(
      <EventSection
        event={makeEvent()}
        domain={DOMAIN}
        teamKey="frc118"
        algorithmId="spr"
        season={2024}
        metricHistory={[makeHistoryRow({ eventKey: "2024txkat" })]}
      />,
    );
    expect(screen.queryByTestId("event-snapshot-2024casj")).toBeNull();
  });

  it("shows the Upcoming badge when every match lacks a result, and removes it once one has a result", () => {
    const { rerender } = renderWithRouter(
      <EventSection
        event={makeEvent({ matches: [makeMatch({ matchKey: "m1" }), makeMatch({ matchKey: "m2" })] })}
        domain={DOMAIN}
        teamKey="frc118"
        algorithmId="spr"
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
        algorithmId="spr"
        season={2024}
        metricHistory={[]}
      />,
    );
    expect(screen.queryByText("Upcoming")).toBeNull();
  });

  it("carries the full event name in a title attribute for a 70-character name", () => {
    const longName = "A".repeat(70);
    renderWithRouter(
      <EventSection event={makeEvent({ eventName: longName })} domain={DOMAIN} teamKey="frc118" algorithmId="spr" season={2024} metricHistory={[]} />,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    // 2026-09-01: the name became a Link into the event page; the title
    // affordance rides the anchor now, the heading still carries the text.
    expect(heading.querySelector("a")?.getAttribute("title")).toBe(longName);
    expect(heading.textContent).toBe(longName);
  });

  it("carries an elevation class and a surface class distinct from the page background", () => {
    renderWithRouter(<EventSection event={makeEvent()} domain={DOMAIN} teamKey="frc118" algorithmId="spr" season={2024} metricHistory={[]} />);
    const section = screen.getByTestId("event-section-2024casj");
    expect(section.className).toContain("shadow-sm");
    expect(section.className).toContain("event-card");
    expect(section.className).not.toContain("bg-[var(--color-bg-page)]");
  });

  it("renders 'Rank 5 of 32' when the event fixture carries rank and totalTeams", () => {
    renderWithRouter(
      <EventSection
        event={makeEvent({ rank: 5, totalTeams: 32 })}
        domain={DOMAIN}
        teamKey="frc118"
        algorithmId="spr"
        season={2024}
        metricHistory={[]}
      />,
    );
    const standing = screen.getByTestId("event-standing-2024casj");
    expect(standing.textContent).toBe("Rank 5 of 32");
  });

  it("renders no standing element when the event fixture carries neither rank nor totalTeams", () => {
    renderWithRouter(
      <EventSection event={makeEvent()} domain={DOMAIN} teamKey="frc118" algorithmId="spr" season={2024} metricHistory={[]} />,
    );
    expect(screen.queryByTestId("event-standing-2024casj")).toBeNull();
  });

  it("renders no standing element when only rank is present (a half-present pair never renders a partial standing)", () => {
    renderWithRouter(
      <EventSection
        event={makeEvent({ rank: 5, totalTeams: undefined })}
        domain={DOMAIN}
        teamKey="frc118"
        algorithmId="spr"
        season={2024}
        metricHistory={[]}
      />,
    );
    expect(screen.queryByTestId("event-standing-2024casj")).toBeNull();
  });

  it("renders no standing element when only totalTeams is present — the mirror half-present case", () => {
    renderWithRouter(
      <EventSection
        event={makeEvent({ rank: undefined, totalTeams: 32 })}
        domain={DOMAIN}
        teamKey="frc118"
        algorithmId="spr"
        season={2024}
        metricHistory={[]}
      />,
    );
    expect(screen.queryByTestId("event-standing-2024casj")).toBeNull();
  });

  it("places the standing element inside the same paragraph as startDate, which still renders unchanged", () => {
    renderWithRouter(
      <EventSection
        event={makeEvent({ rank: 5, totalTeams: 32, startDate: "2024-03-01" })}
        domain={DOMAIN}
        teamKey="frc118"
        algorithmId="spr"
        season={2024}
        metricHistory={[]}
      />,
    );
    const standing = screen.getByTestId("event-standing-2024casj");
    const paragraph = standing.closest("p");
    expect(paragraph).not.toBeNull();
    expect(paragraph!.textContent).toContain("2024-03-01");
    expect(paragraph!.textContent).toContain("Rank 5 of 32");
  });

  /**
   * Plan 06.1-06, Task 3 (D-06.1-A/F-06-3): rarity tiers on the per-event
   * metric line, sourced from each history row's own published percentile,
   * with a visible on-page statement of what those tiers are ranked
   * against.
   */
  describe("per-event metric tiers and basis caption", () => {
    it("renders a tier box carrying the epic modifier class for a snapshot metric with a percentile in the Epic band", () => {
      renderWithRouter(
        <EventSection
          event={makeEvent()}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4, percentile: 80 } } })]}
        />,
      );
      const snapshot = screen.getByTestId("event-snapshot-2024casj");
      expect(snapshot.querySelector(".metric-tier--epic")).not.toBeNull();
    });

    it("renders the common tier ring for a snapshot metric with a percentile in the Common band (sketch 008 winner C)", () => {
      renderWithRouter(
        <EventSection
          event={makeEvent()}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4, percentile: 20 } } })]}
        />,
      );
      const snapshot = screen.getByTestId("event-snapshot-2024casj");
      expect(snapshot.querySelector(".metric-tier--common")).not.toBeNull();
    });

    it("renders a (Common, ringed) value for a snapshot metric at exactly percentile 0 — the boundary is tiered by band, never dropped as falsy (sketch 008 winner C)", () => {
      renderWithRouter(
        <EventSection
          event={makeEvent()}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4, percentile: 0 } } })]}
        />,
      );
      const snapshot = screen.getByTestId("event-snapshot-2024casj");
      expect(snapshot.querySelector(".metric-tier--common")).not.toBeNull();
      expect(snapshot.textContent).toContain("61.40");
    });

    it("renders identically to the pre-change output — no tier box class — for a snapshot metric with no percentile", () => {
      renderWithRouter(
        <EventSection
          event={makeEvent()}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4 } } })]}
        />,
      );
      const snapshot = screen.getByTestId("event-snapshot-2024casj");
      expect(snapshot.querySelector(".metric-tier")).toBeNull();
      expect(snapshot.textContent).toContain("61.40");
    });

    // RESTORED by quick task 260923-3x0, with a new source. 260920-qzf wrote
    // these three against `tierCuts` read off the live EVENT artifact; 260923-3w7
    // deleted them with the fetch that supplied it. The block is now published on
    // the TEAM-SEASON artifact, so `EventSectionList` passes `artifact.tierCuts`
    // and the robot page needs no second fetch to tier a live-folded row.

    it("a snapshot metric with a value and no percentile renders its tier from tierCuts", () => {
      renderWithRouter(
        <EventSection
          event={makeEvent()}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4 } } })]}
          tierCuts={{ total: { cuts: [31.17, 52.4, 88.05] } }}
        />,
      );
      const snapshot = screen.getByTestId("event-snapshot-2024casj");
      // 61.4 >= cuts[1] (52.4) and < cuts[2] (88.05) -> epic.
      expect(snapshot.querySelector(".metric-tier--epic")).not.toBeNull();
    });

    it("the same percentile-less metric renders no tier box at all when no cuts are supplied — a pre-republish artifact carries none, and that is a normal state", () => {
      renderWithRouter(
        <EventSection
          event={makeEvent()}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4 } } })]}
        />,
      );
      const snapshot = screen.getByTestId("event-snapshot-2024casj");
      expect(snapshot.querySelector(".metric-tier")).toBeNull();
    });

    it("a metric that DOES carry a percentile renders identically whether or not tierCuts are supplied (published percentile always wins)", () => {
      const withCuts = renderWithRouter(
        <EventSection
          event={makeEvent()}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4, percentile: 80 } } })]}
          // Deliberately disagreeing cuts: if the resolver preferred cuts
          // this would render legendary instead of epic.
          tierCuts={{ total: { cuts: [1, 2, 3] } }}
        />,
      );
      const withCutsHtml = screen.getByTestId("event-snapshot-2024casj").innerHTML;
      withCuts.unmount();

      renderWithRouter(
        <EventSection
          event={makeEvent()}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4, percentile: 80 } } })]}
        />,
      );
      const withoutCutsHtml = screen.getByTestId("event-snapshot-2024casj").innerHTML;

      expect(withCutsHtml).toBe(withoutCutsHtml);
    });

    it("cuts tier the PHASE tiles too, not only Total — each against its own metric name", () => {
      renderWithRouter(
        <EventSection
          event={makeEvent()}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4 }, phaseAuto: { value: 9 } } })]}
          // phaseAuto 9 clears its own legendary cut (8); total 61.4 sits in epic.
          // Distinct bands, so one tile cannot be mistaken for the other's box.
          tierCuts={{ total: { cuts: [31.17, 52.4, 88.05] }, phaseAuto: { cuts: [3, 5, 8] } }}
        />,
      );
      const snapshot = screen.getByTestId("event-snapshot-2024casj");
      expect(snapshot.querySelector(".metric-tier--epic")).not.toBeNull();
      expect(snapshot.querySelector(".metric-tier--legendary")).not.toBeNull();
    });

    it("a cut for a metric name the snapshot does not carry tiers nothing, and a value with no cut for ITS name stays untiered — never a guess from another metric's cuts", () => {
      renderWithRouter(
        <EventSection
          event={makeEvent()}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4 } } })]}
          tierCuts={{ someOtherMetric: { cuts: [1, 2, 3] } }}
        />,
      );
      const snapshot = screen.getByTestId("event-snapshot-2024casj");
      expect(snapshot.querySelector(".metric-tier")).toBeNull();
      expect(snapshot.textContent).toContain("61.40");
    });

    it("renders no per-event tier-basis caption even when a rendered tile carries a percentile", () => {
      renderWithRouter(
        <EventSection
          event={makeEvent()}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4, percentile: 80 } } })]}
        />,
      );
      expect(screen.queryByTestId("event-tier-basis-2024casj")).toBeNull();
    });

    it("renders no basis caption when no rendered tile carries a percentile", () => {
      renderWithRouter(
        <EventSection
          event={makeEvent()}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4 } } })]}
        />,
      );
      expect(screen.queryByTestId("event-tier-basis-2024casj")).toBeNull();
    });

    it("tiers a per-event metric from the history row's OWN percentile — this component receives no season-final metric record at all, so it structurally cannot substitute one", () => {
      renderWithRouter(
        <EventSection
          event={makeEvent()}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[makeHistoryRow({ metrics: { total: { value: 61.4, percentile: 97 } } })]}
        />,
      );
      const snapshot = screen.getByTestId("event-snapshot-2024casj");
      expect(snapshot.querySelector(".metric-tier--legendary")).not.toBeNull();
    });
  });

  it("gives two sections distinct scroller test ids", () => {
    renderWithRouter(
      <>
        <EventSection event={makeEvent({ eventKey: "2024casj" })} domain={DOMAIN} teamKey="frc118" algorithmId="spr" season={2024} metricHistory={[]} />
        <EventSection
          event={makeEvent({ eventKey: "2024txkat", eventName: "FIT District Katy Event" })}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[]}
        />
      </>,
    );
    const first = screen.getByTestId("match-table-scroll-2024casj");
    const second = screen.getByTestId("match-table-scroll-2024txkat");
    expect(first).not.toBe(second);
  });

  /**
   * Quick task 260917-2f4: "for SPR, Sigma should be stored and displayed
   * anywhere Total is". The end-of-event Total tile reads its Sigma from the
   * SAME `metricHistory` row `endOfEventMetrics` resolved the Total from, so
   * both halves share one as-of instant — never the season-final Sigma on
   * `seasonStats`, which this component is not even given.
   *
   * Gated on DATA PRESENCE, never on algorithm id.
   */
  describe("Total ± Sigma pill", () => {
    function renderSnapshot(metrics: MetricHistoryRow["metrics"]) {
      return renderWithRouter(
        <EventSection
          event={makeEvent()}
          domain={DOMAIN}
          teamKey="frc118"
          algorithmId="spr"
          season={2024}
          metricHistory={[makeHistoryRow({ metrics })]}
        />,
      );
    }

    /** The Total tile — the snapshot's first line (`Auto`/`Teleop`/`Endgame` share the second). */
    function totalLine(): HTMLElement {
      return screen.getByTestId("event-snapshot-2024casj").children[0] as HTMLElement;
    }

    it("an end-of-event row carrying a sigma entry renders the tile as ONE joined pill with both halves", () => {
      renderSnapshot({ total: { value: 61.4, percentile: 97 }, [SIGMA_METRIC_KEY]: { value: 7.25 } });
      const pill = totalLine().querySelector('[data-testid="total-sigma-pill"]');
      expect(pill).not.toBeNull();
      expect(pill!.querySelector(".metric-pill__total")!.textContent).toBe("61.40");
      expect(pill!.querySelector(".metric-pill__sigma")!.textContent).toBe("±7.25");
    });

    it("the Sigma half is the row's own sigma, never the Total's spread (spread must never reach the screen)", () => {
      renderSnapshot({ total: { value: 61.4, spread: 3.1 }, [SIGMA_METRIC_KEY]: { value: 7.25 } });
      const line = totalLine();
      expect(line.textContent).toContain("±7.25");
      expect(line.textContent).not.toContain("3.10");
    });

    it("a sigma entry with no percentile renders its half UNTIERED — no tier class, and not the neutral treatment either", () => {
      renderSnapshot({ total: { value: 61.4, percentile: 97 }, [SIGMA_METRIC_KEY]: { value: 7.25 } });
      const sigmaHalf = totalLine().querySelector(".metric-pill__sigma")!;
      expect(sigmaHalf.className).not.toMatch(/metric-tier--/);
      expect(sigmaHalf.className).not.toContain("metric-pill__sigma--neutral");
    });

    it("the Total half keeps this history row's OWN percentile tier", () => {
      renderSnapshot({ total: { value: 61.4, percentile: 97 }, [SIGMA_METRIC_KEY]: { value: 7.25 } });
      expect(totalLine().querySelector(".metric-pill__total")!.className).toContain("metric-tier--legendary");
    });

    it("the tile's label names Sigma only when the row carries one", () => {
      const withSigma = renderSnapshot({ total: { value: 61.4 }, [SIGMA_METRIC_KEY]: { value: 7.25 } });
      expect(totalLine().firstElementChild!.textContent).toBe(totalColumnHeader("spr"));
      expect(totalColumnHeader("spr")).toBe("Total ± Sigma");
      withSigma.unmount();

      renderSnapshot({ total: { value: 61.4 } });
      expect(totalLine().firstElementChild!.textContent).toBe("Total");
    });

    it("a row with NO sigma entry renders the Total value byte-identically to plain MetricValue", () => {
      const reference = render(<MetricValue metric={{ value: 61.4 }} tier={tierForPercentile(97)} />);
      const referenceHtml = reference.container.innerHTML;
      reference.unmount();

      renderSnapshot({ total: { value: 61.4, percentile: 97 } });
      const line = totalLine();
      expect(line.querySelector('[data-testid="total-sigma-pill"]')).toBeNull();
      expect(line.lastElementChild!.outerHTML).toBe(referenceHtml);
    });

    it("the Auto/Teleop/Endgame tiles are unchanged by a present sigma — no pill, no ±, and no Sigma tile of their own", () => {
      renderSnapshot({
        total: { value: 61.4 },
        phaseAuto: { value: 12 },
        phaseTeleop: { value: 30 },
        phaseEndgame: { value: 19.4 },
        [SIGMA_METRIC_KEY]: { value: 7.25 },
      });
      const phaseLine = screen.getByTestId("event-snapshot-2024casj").children[1] as HTMLElement;
      expect(Array.from(phaseLine.children).map((pair) => pair.firstElementChild?.textContent)).toEqual(["Auto", "Teleop", "Endgame"]);
      expect(phaseLine.querySelector('[data-testid="total-sigma-pill"]')).toBeNull();
      expect(phaseLine.textContent).not.toContain("±");
      expect(phaseLine.textContent).not.toContain("7.25");
    });
  });
});
