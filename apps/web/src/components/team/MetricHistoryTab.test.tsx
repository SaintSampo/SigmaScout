import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MetricHistoryTab } from "./MetricHistoryTab.js";
import type { MetricHistoryChartProps } from "./MetricHistoryChart.js";
import { METRIC_HISTORY_LEGEND_HEIGHT_PX } from "./metricHistorySeries.js";
import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";

function artifact(overrides: Partial<TeamSeasonArtifact> = {}): TeamSeasonArtifact {
  return {
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    teamKey: "frc1114",
    teamNumber: 1114,
    nickname: "Simbotics",
    season: 2024,
    seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: {} },
    events: [{ eventKey: "2024casj", eventName: "Sacramento Regional", startDate: "2024-03-01", matches: [] }],
    metricHistory: [],
    ...overrides,
  } as TeamSeasonArtifact;
}

describe("MetricHistoryTab", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a skeleton and no text while the dynamic import is pending", async () => {
    const loadChart = vi.fn(() => new Promise<{ default: ComponentType<MetricHistoryChartProps> }>(() => {}));

    render(<MetricHistoryTab artifact={artifact()} algorithmId="spr" season={2024} loadChart={loadChart} />);

    const skeleton = await screen.findByTestId("metric-history-chart-skeleton");
    expect(skeleton).toBeDefined();
    expect(skeleton.textContent).toBe("");
  });

  it("renders 'Chart failed to load' with Retry on a rejecting import, and Retry re-attempts the import without any data fetch", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const loadChart = vi.fn(() => Promise.reject(new Error("chunk load failed")));

    render(<MetricHistoryTab artifact={artifact()} algorithmId="spr" season={2024} loadChart={loadChart} />);

    await waitFor(() => expect(screen.getByText("Chart failed to load")).toBeDefined());
    expect(loadChart).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(loadChart).toHaveBeenCalledTimes(2));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders the resolved chart component once the dynamic import succeeds", async () => {
    function FakeChart() {
      return <div data-testid="fake-chart">chart</div>;
    }
    const loadChart = vi.fn(() => Promise.resolve({ default: FakeChart }));

    render(<MetricHistoryTab artifact={artifact()} algorithmId="spr" season={2024} loadChart={loadChart} />);

    await waitFor(() => expect(screen.getByTestId("fake-chart")).toBeDefined());
  });

  describe("skeleton legend spacer (quick task 260913-m45)", () => {
    it("reserves a text-free METRIC_HISTORY_LEGEND_HEIGHT_PX spacer while pending, for an spr artifact whose rows draw a sigma band", async () => {
      const loadChart = vi.fn(() => new Promise<{ default: ComponentType<MetricHistoryChartProps> }>(() => {}));
      const sprArtifact = artifact({
        algorithmId: "spr",
        metricHistory: [
          { matchKey: "m1", season: 2024, eventKey: "2024casj", algorithmId: "spr", teamKey: "frc1114", matchIndex: 0, metrics: { total: { value: 100 }, sigma: { value: 8 } } },
        ],
      });

      render(<MetricHistoryTab artifact={sprArtifact} algorithmId="spr" season={2024} loadChart={loadChart} />);

      const skeleton = await screen.findByTestId("metric-history-chart-skeleton");
      const spacer = skeleton.querySelector('[data-testid="metric-history-legend-skeleton-spacer"]');
      expect(spacer).not.toBeNull();
      expect((spacer as HTMLElement).style.height).toBe(`${METRIC_HISTORY_LEGEND_HEIGHT_PX}px`);
      expect(spacer?.textContent).toBe("");
      expect(skeleton.textContent).toBe("");
    });

    it("has no spacer for an opr artifact (no sigma band ever draws)", async () => {
      const loadChart = vi.fn(() => new Promise<{ default: ComponentType<MetricHistoryChartProps> }>(() => {}));
      const oprArtifact = artifact({
        algorithmId: "opr",
        metricHistory: [{ matchKey: "m1", season: 2024, eventKey: "2024casj", algorithmId: "opr", teamKey: "frc1114", matchIndex: 0, metrics: { total: { value: 100 } } }],
      });

      render(<MetricHistoryTab artifact={oprArtifact} algorithmId="opr" season={2024} loadChart={loadChart} />);

      const skeleton = await screen.findByTestId("metric-history-chart-skeleton");
      expect(skeleton.querySelector('[data-testid="metric-history-legend-skeleton-spacer"]')).toBeNull();
      expect(skeleton.textContent).toBe("");
    });

    it("has no spacer for spr rows carrying no sigma entry (pre-republish)", async () => {
      const loadChart = vi.fn(() => new Promise<{ default: ComponentType<MetricHistoryChartProps> }>(() => {}));
      const sprArtifact = artifact({
        algorithmId: "spr",
        metricHistory: [{ matchKey: "m1", season: 2024, eventKey: "2024casj", algorithmId: "spr", teamKey: "frc1114", matchIndex: 0, metrics: { total: { value: 100 } } }],
      });

      render(<MetricHistoryTab artifact={sprArtifact} algorithmId="spr" season={2024} loadChart={loadChart} />);

      const skeleton = await screen.findByTestId("metric-history-chart-skeleton");
      expect(skeleton.querySelector('[data-testid="metric-history-legend-skeleton-spacer"]')).toBeNull();
    });
  });
});
