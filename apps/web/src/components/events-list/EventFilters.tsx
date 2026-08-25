import { useMemo, useState } from "react";
import { useIsMobile } from "@/lib/breakpoints";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useFilterSheetStore } from "@/stores/filterSheet";
import { filterOptions, type EventFilterOptionLists, type EventFilters as EventFiltersModel, type EventRow } from "./filterModel";

/**
 * The desktop inline control row and the phone filter sheet, both writing to
 * the URL (05-07-PLAN.md Task 3). Filter and sort state never lives HERE —
 * this component reports changes up via callbacks; the caller (`events.tsx`)
 * owns reading/writing the URL through `EventsSearchSchema`. The one piece
 * of state this file DOES own locally is the mobile sheet's in-progress
 * draft — deliberately not the URL and not the Zustand store (D-15's "Apply
 * filters" button means selections inside the sheet are staged, not applied
 * immediately, unlike the desktop row).
 */

const ALL_VALUE = "__all__";

function countActive(filters: EventFiltersModel): number {
  return Object.values(filters).filter((value) => value !== undefined).length;
}

export interface EventFiltersProps {
  events: readonly EventRow[];
  filters: EventFiltersModel;
  onFiltersChange: (filters: EventFiltersModel) => void;
  onClearFilters: () => void;
}

function WeekSelect({ weeks, value, onChange }: { weeks: readonly number[]; value: number | undefined; onChange: (value: number | undefined) => void }) {
  const disabled = weeks.length === 0;
  return (
    <Select value={value === undefined ? ALL_VALUE : String(value)} onValueChange={(next) => onChange(next === ALL_VALUE ? undefined : Number(next))} disabled={disabled}>
      <SelectTrigger aria-label="Week" disabled={disabled} className="w-full sm:w-[8rem]">
        <SelectValue placeholder="Week" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>All weeks</SelectItem>
        {weeks.map((week) => (
          <SelectItem key={week} value={String(week)}>
            {`Week ${week}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StringDimensionSelect({ label, values, value, onChange }: { label: string; values: readonly string[]; value: string | undefined; onChange: (value: string | undefined) => void }) {
  const disabled = values.length === 0;
  return (
    <Select value={value ?? ALL_VALUE} onValueChange={(next) => onChange(next === ALL_VALUE ? undefined : next)} disabled={disabled}>
      <SelectTrigger aria-label={label} disabled={disabled} className="w-full max-w-[10rem] sm:w-auto">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>{`All ${label.toLowerCase()}`}</SelectItem>
        {values.map((item) => (
          <SelectItem key={item} value={item} className="max-w-[12rem] truncate" title={item}>
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DimensionControls({
  options,
  filters,
  onDimensionChange,
}: {
  options: EventFilterOptionLists;
  filters: EventFiltersModel;
  onDimensionChange: (patch: Partial<EventFiltersModel>) => void;
}) {
  return (
    <>
      <WeekSelect weeks={options.weeks} value={filters.week} onChange={(week) => onDimensionChange({ week })} />
      <StringDimensionSelect label="Country" values={options.countries} value={filters.country} onChange={(country) => onDimensionChange({ country })} />
      <StringDimensionSelect label="State" values={options.states} value={filters.state} onChange={(state) => onDimensionChange({ state })} />
      <StringDimensionSelect label="District" values={options.districts} value={filters.district} onChange={(district) => onDimensionChange({ district })} />
    </>
  );
}

/** Long country/district names truncate at a fixed max-width, the full text on the native title affordance. */
function ActiveFilterChips({ filters }: { filters: EventFiltersModel }) {
  const chips: Array<{ key: string; label: string }> = [];
  if (filters.week !== undefined) chips.push({ key: "week", label: `Week ${filters.week}` });
  if (filters.country !== undefined) chips.push({ key: "country", label: filters.country });
  if (filters.state !== undefined) chips.push({ key: "state", label: filters.state });
  if (filters.district !== undefined) chips.push({ key: "district", label: filters.district });

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

function DesktopFilterRow({ options, filters, onFiltersChange, onClearFilters }: { options: EventFilterOptionLists; filters: EventFiltersModel; onFiltersChange: (filters: EventFiltersModel) => void; onClearFilters: () => void }) {
  const activeCount = countActive(filters);

  function handleDimensionChange(patch: Partial<EventFiltersModel>) {
    onFiltersChange({ ...filters, ...patch });
  }

  return (
    <div data-testid="desktop-filter-row" className="flex flex-col gap-[var(--spacing-sm)]">
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

function MobileFilterSheet({ options, filters, onFiltersChange, onClearFilters }: { options: EventFilterOptionLists; filters: EventFiltersModel; onFiltersChange: (filters: EventFiltersModel) => void; onClearFilters: () => void }) {
  const isOpen = useFilterSheetStore((state) => state.isOpen);
  const open = useFilterSheetStore((state) => state.open);
  const close = useFilterSheetStore((state) => state.close);
  const [draft, setDraft] = useState<EventFiltersModel>(filters);
  const activeCount = countActive(filters);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      // Reset the draft to the currently COMMITTED filters every time the
      // sheet opens, so a prior unapplied edit never leaks into a later
      // session.
      setDraft(filters);
      open();
    } else {
      close();
    }
  }

  function handleDimensionChange(patch: Partial<EventFiltersModel>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function handleApply() {
    onFiltersChange(draft);
    close();
  }

  function handleClear() {
    setDraft({});
    onClearFilters();
    close();
  }

  const triggerLabel = activeCount > 0 ? `Open filters, ${activeCount} active` : "Open filters";

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <div data-testid="mobile-filter-trigger-wrap" className="flex flex-col gap-[var(--spacing-sm)]">
        <SheetTrigger asChild>
          <Button type="button" variant="outline" aria-label={triggerLabel} className="tap-target w-fit gap-[var(--spacing-xs)]">
            Filters
            {activeCount > 0 && <Badge variant="default">{activeCount}</Badge>}
          </Button>
        </SheetTrigger>
        <ActiveFilterChips filters={filters} />
      </div>
      <SheetContent
        side="bottom"
        /*
         * `dvh`, not `vh`: on a phone `vh` is measured against the viewport
         * with the URL bar collapsed, so an 80vh sheet can extend past the
         * visible area while the bar is showing — which is how "Clear filters"
         * ended up below the fold at plan 05-08 sign-off. `pb-[env(safe-area-inset-bottom)]`
         * keeps the footer clear of the home indicator on a notched device.
         */
        className="flex max-h-[85dvh] w-full max-w-full flex-col overflow-x-hidden pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-[var(--spacing-sm)] overflow-y-auto px-[var(--spacing-md)]">
          <DimensionControls options={options} filters={draft} onDimensionChange={handleDimensionChange} />
          {countActive(draft) > 0 && (
            <Button type="button" variant="link" onClick={handleClear} className="w-fit p-0">
              Clear filters
            </Button>
          )}
        </div>
        <SheetFooter>
          <Button type="button" onClick={handleApply}>
            Apply filters
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function EventFilters({ events, filters, onFiltersChange, onClearFilters }: EventFiltersProps) {
  const isMobile = useIsMobile();
  const options = useMemo(() => filterOptions(events), [events]);

  if (isMobile) {
    return <MobileFilterSheet options={options} filters={filters} onFiltersChange={onFiltersChange} onClearFilters={onClearFilters} />;
  }

  return <DesktopFilterRow options={options} filters={filters} onFiltersChange={onFiltersChange} onClearFilters={onClearFilters} />;
}
