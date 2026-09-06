import { useMemo } from "react";
import { districtDisplayName } from "@/lib/districtNames";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { teamFilterOptions, type TeamFilterOptionLists, type TeamFilterRow, type TeamFilters as TeamFiltersModel } from "./teamFilterModel";

/**
 * Quick task 260905-ttv: the Country/State/District control row for the
 * Teams page. Filter state never lives here — this component reports
 * changes up via callbacks; the caller (`routes/teams.tsx`) owns
 * reading/writing the URL through `TeamsSearchSchema`, mirroring
 * `EventFilters.tsx`'s own discipline exactly.
 *
 * ONE wrapping control row for both viewports, deliberately no mobile sheet
 * — a difference from `EventFilters.tsx` worth naming rather than leaving as
 * an apparent oversight. The Events page's sheet exists because of D-15's
 * staged "Apply filters" decision over FOUR dimensions (week plus three
 * region filters); this page has three dimensions and no staged-apply
 * decision, and three controls sized as the Events row already sizes them
 * (`w-full max-w-[10rem] sm:w-auto`) wrap cleanly at phone width inside a
 * `flex flex-wrap` row. If a fourth dimension is ever added here, revisit.
 *
 * `StringDimensionSelect`/`ActiveFilterChips` are copied from
 * `events-list/EventFilters.tsx` across the module boundary
 * `teamFilterModel.ts`'s own header comment already names (the
 * `SeasonHeader.tsx`/`formatRecord` precedent) — not imported, since
 * `teams-table/` does not depend on `events-list/`.
 */

const ALL_VALUE = "__all__";

function countActive(filters: TeamFiltersModel): number {
  return Object.values(filters).filter((value) => value !== undefined).length;
}

/** Copied from `events-list/EventFilters.tsx`'s identically-named function — see this file's header comment for why it is copied rather than imported. */
function StringDimensionSelect({
  label,
  allLabel,
  values,
  value,
  onChange,
  display,
}: {
  label: string;
  allLabel: string;
  values: readonly string[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  display?: (value: string) => string;
}) {
  const disabled = values.length === 0;
  return (
    <Select value={value ?? ALL_VALUE} onValueChange={(next) => onChange(next === ALL_VALUE ? undefined : next)} disabled={disabled}>
      <SelectTrigger aria-label={label} disabled={disabled} className="w-full max-w-[10rem] sm:w-auto">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>{allLabel}</SelectItem>
        {values.map((item) => (
          <SelectItem key={item} value={item} className="max-w-[12rem] truncate" title={display ? display(item) : item}>
            {display ? display(item) : item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Copied from `events-list/EventFilters.tsx`'s identically-named function, dropping the week dimension. Long country/district names truncate at a fixed max-width, the full text on the native title affordance. */
function ActiveFilterChips({ filters }: { filters: TeamFiltersModel }) {
  const chips: Array<{ key: string; label: string }> = [];
  if (filters.country !== undefined) chips.push({ key: "country", label: filters.country });
  if (filters.state !== undefined) chips.push({ key: "state", label: filters.state });
  if (filters.district !== undefined) chips.push({ key: "district", label: districtDisplayName(filters.district) });

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-[var(--spacing-xs)]">
      {chips.map((chip) => (
        <Badge key={chip.key} variant="secondary" className="max-w-[10rem] truncate" title={chip.label}>
          {chip.label}
        </Badge>
      ))}
    </div>
  );
}

function DimensionControls({
  options,
  filters,
  onDimensionChange,
}: {
  options: TeamFilterOptionLists;
  filters: TeamFiltersModel;
  onDimensionChange: (patch: Partial<TeamFiltersModel>) => void;
}) {
  return (
    <>
      <StringDimensionSelect label="Country" allLabel="All Countries" values={options.countries} value={filters.country} onChange={(country) => onDimensionChange({ country })} />
      <StringDimensionSelect label="State" allLabel="All States" values={options.states} value={filters.state} onChange={(state) => onDimensionChange({ state })} />
      <StringDimensionSelect label="District" allLabel="All Districts" values={options.districts} value={filters.district} onChange={(district) => onDimensionChange({ district })} display={districtDisplayName} />
    </>
  );
}

export interface TeamsFiltersProps {
  rows: readonly TeamFilterRow[];
  filters: TeamFiltersModel;
  onFiltersChange: (filters: TeamFiltersModel) => void;
  onClearFilters: () => void;
}

export function TeamsFilters({ rows, filters, onFiltersChange, onClearFilters }: TeamsFiltersProps) {
  const options = useMemo(() => teamFilterOptions(rows), [rows]);
  const activeCount = countActive(filters);

  function handleDimensionChange(patch: Partial<TeamFiltersModel>) {
    onFiltersChange({ ...filters, ...patch });
  }

  return (
    <div data-testid="teams-filter-row" className="flex flex-col gap-[var(--spacing-sm)]">
      <div className="flex flex-wrap items-center gap-[var(--spacing-sm)]">
        <DimensionControls options={options} filters={filters} onDimensionChange={handleDimensionChange} />
        {activeCount > 0 && (
          <Button type="button" variant="link" onClick={onClearFilters} className="p-0">
            Clear filters
          </Button>
        )}
      </div>
      <ActiveFilterChips filters={filters} />
    </div>
  );
}
