/**
 * Coverage for `districtMetricsJoin.tsx` (quick task 260905-lic revision
 * R3) — the shared teamKey -> metrics map both `DistrictInsightsTab.tsx` and
 * `DistrictBreakdownTab.tsx` read through, and the tier/em-dash cell
 * contract that keeps their rendering identical for the same fact.
 */
import { describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach } from "vitest";
import { TeamsArtifactSchema, type TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { buildDistrictMetricsMap, DistrictMetricCell } from "./districtMetricsJoin.js";

/** Builds a valid teams artifact through `TeamsArtifactSchema.parse` — the real schema, proving each fixture matches the published wire shape. */
function makeTeamsArtifact(teams: Record<string, unknown>[]): TeamsArtifact {
  return TeamsArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-05T00:00:00.000Z",
    algorithmId: "vpr",
    algorithmVersion: "2.0.0+tuned-2026-09",
    season: 2026,
    teams,
  });
}

afterEach(() => {
  cleanup();
});

describe("buildDistrictMetricsMap", () => {
  it("returns an empty map when the teams artifact is undefined (query still pending/disabled)", () => {
    const map = buildDistrictMetricsMap(undefined, 2026);
    expect(map.size).toBe(0);
  });

  it("maps a published row by teamKey, carrying its tier through unchanged", () => {
    const artifact = makeTeamsArtifact([
      {
        teamKey: "frc4561",
        teamNumber: 4561,
        nickname: "The Fighting Pi",
        eventCount: 1,
        matchCount: 10,
        record: { wins: 5, losses: 5, ties: 0 },
        metrics: { total: { value: 48.33, spread: 2.32, tier: "epic" } },
      },
    ]);
    const map = buildDistrictMetricsMap(artifact, 2026);
    expect(map.get("frc4561")?.total).toEqual({ value: 48.33, spread: 2.32, tier: "epic" });
    expect(map.get("frc9999")).toBeUndefined();
  });
});

describe("DistrictMetricCell", () => {
  it("renders a plain em-dash when the team was never found in the teams artifact", () => {
    const { container } = render(<DistrictMetricCell entry={undefined} found={false} />);
    expect(container.textContent).toBe("—");
  });

  it("renders blank (never an em-dash) when the team is found but this specific metric key is absent", () => {
    const { container } = render(<DistrictMetricCell entry={undefined} found={true} />);
    expect(container.textContent).toBe("");
  });

  it("boxes ANY present metric with at least the common tier — 'entry?.tier ?? \"common\"', matching teams-table/columns.tsx's own coalesce", () => {
    const { container } = render(<DistrictMetricCell entry={{ value: 10 }} found={true} />);
    expect(container.querySelector(".metric-tier--common")).not.toBeNull();
  });

  it("boxes a tiered metric with its own published tier, never falling back to common", () => {
    const { container } = render(<DistrictMetricCell entry={{ value: 48.33, spread: 2.32, tier: "epic" }} found={true} />);
    expect(container.querySelector(".metric-tier--epic")).not.toBeNull();
    expect(container.textContent).toContain("48.33");
  });
});
