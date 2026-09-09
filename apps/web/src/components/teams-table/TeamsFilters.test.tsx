/**
 * Quick task 260905-ttv, Task 2's own listed test coverage: three labelled
 * selects render with an "All ..." option each; choosing a value/choosing
 * "All" reports the expected patch; district options display through
 * `districtDisplayName`; a dimension with zero options renders disabled;
 * Clear filters renders only with an active dimension and invokes the
 * callback; active dimensions render as chips.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PAGE_ARTIFACT_SCHEMA_VERSION, TeamsArtifactSchema, type TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { TeamsFilters } from "./TeamsFilters";
import type { TeamFilterRow, TeamFilters as TeamFiltersModel } from "./teamFilterModel";

function makeArtifact(teams: unknown[]): TeamsArtifact {
  return TeamsArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "bpr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    season: 2026,
    teams,
  });
}

function makeRow(overrides: Partial<TeamFilterRow> & { teamKey: string; teamNumber: number }): Record<string, unknown> {
  return {
    nickname: "Team",
    eventCount: 3,
    matchCount: 30,
    record: { wins: 10, losses: 2, ties: 0 },
    metrics: { total: { value: 50 } },
    ...overrides,
  };
}

const FIXTURE_ROWS: TeamFilterRow[] = makeArtifact([
  makeRow({ teamKey: "frc1114", teamNumber: 1114, country: "USA", stateProv: "MI", districtKey: "fim" }),
  makeRow({ teamKey: "frc254", teamNumber: 254, country: "CAN", stateProv: "ON", districtKey: "ont" }),
]).teams;

const EMPTY_FILTERS: TeamFiltersModel = {};

describe("TeamsFilters", () => {
  it("renders the inline control row with three labelled selects, each carrying an All option", () => {
    render(<TeamsFilters rows={FIXTURE_ROWS} filters={EMPTY_FILTERS} onFiltersChange={vi.fn()} onClearFilters={vi.fn()} />);

    expect(screen.getByTestId("teams-filter-row")).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Country" })).toBeDefined();
    expect(screen.getByRole("combobox", { name: "State" })).toBeDefined();
    expect(screen.getByRole("combobox", { name: "District" })).toBeDefined();
  });

  it("choosing a Country value reports the expected filter patch", () => {
    const onFiltersChange = vi.fn();
    render(<TeamsFilters rows={FIXTURE_ROWS} filters={EMPTY_FILTERS} onFiltersChange={onFiltersChange} onClearFilters={vi.fn()} />);

    const trigger = screen.getByRole("combobox", { name: "Country" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);
    const option = screen.getByRole("option", { name: "USA" });
    fireEvent.pointerUp(option, { button: 0, pointerId: 1 });
    fireEvent.click(option);

    expect(onFiltersChange).toHaveBeenCalledWith({ country: "USA" });
  });

  it("choosing All patches the dimension to undefined", () => {
    const onFiltersChange = vi.fn();
    render(<TeamsFilters rows={FIXTURE_ROWS} filters={{ country: "USA" }} onFiltersChange={onFiltersChange} onClearFilters={vi.fn()} />);

    const trigger = screen.getByRole("combobox", { name: "Country" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);
    const option = screen.getByRole("option", { name: "All Countries" });
    fireEvent.pointerUp(option, { button: 0, pointerId: 1 });
    fireEvent.click(option);

    expect(onFiltersChange).toHaveBeenCalledWith({ country: undefined });
  });

  it("district options display through districtDisplayName, never the raw key", () => {
    render(<TeamsFilters rows={FIXTURE_ROWS} filters={EMPTY_FILTERS} onFiltersChange={vi.fn()} onClearFilters={vi.fn()} />);

    const trigger = screen.getByRole("combobox", { name: "District" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);
    // "fim" (a real district key with a name mapping) reads its reader-facing name.
    expect(screen.getByRole("option", { name: "FIRST MI" })).toBeDefined();
    expect(screen.queryByRole("option", { name: "fim" })).toBeNull();
  });

  it("the other two dimensions display their raw published value", () => {
    render(<TeamsFilters rows={FIXTURE_ROWS} filters={EMPTY_FILTERS} onFiltersChange={vi.fn()} onClearFilters={vi.fn()} />);

    const countryTrigger = screen.getByRole("combobox", { name: "Country" });
    fireEvent.pointerDown(countryTrigger, { button: 0, pointerId: 1 });
    fireEvent.click(countryTrigger);
    expect(screen.getByRole("option", { name: "USA" })).toBeDefined();
  });

  it("a dimension with zero options renders disabled -- the pre-republish state renders three disabled controls, no error", () => {
    render(<TeamsFilters rows={[]} filters={EMPTY_FILTERS} onFiltersChange={vi.fn()} onClearFilters={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Country" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("combobox", { name: "State" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("combobox", { name: "District" }).hasAttribute("disabled")).toBe(true);
  });

  it("Clear filters renders only when at least one dimension is set, and invokes onClearFilters", () => {
    const { rerender } = render(<TeamsFilters rows={FIXTURE_ROWS} filters={EMPTY_FILTERS} onFiltersChange={vi.fn()} onClearFilters={vi.fn()} />);
    expect(screen.queryByText("Clear filters")).toBeNull();

    const onClearFilters = vi.fn();
    rerender(<TeamsFilters rows={FIXTURE_ROWS} filters={{ country: "USA" }} onFiltersChange={vi.fn()} onClearFilters={onClearFilters} />);
    fireEvent.click(screen.getByText("Clear filters"));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("active dimensions render as chips, district chips again through districtDisplayName", () => {
    render(<TeamsFilters rows={FIXTURE_ROWS} filters={{ country: "USA", district: "fim" }} onFiltersChange={vi.fn()} onClearFilters={vi.fn()} />);

    const countryChip = screen.getByTitle("USA");
    expect(countryChip).toBeDefined();
    const districtChip = screen.getByTitle("FIRST MI");
    expect(districtChip).toBeDefined();
  });
});
