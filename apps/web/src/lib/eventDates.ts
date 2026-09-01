/**
 * Human event-date formatting (2026-09-01 redesign): the artifact's ISO
 * `startDate` ("2026-03-04") renders as "Mar 4" — the page is already
 * scoped to a year, so the year is never repeated per row.
 *
 * Parsed and formatted in UTC on both sides so the calendar date can never
 * shift across the viewer's timezone (a bare ISO date parses as UTC
 * midnight; formatting it in a negative-offset zone would render the
 * previous day).
 */
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function formatEventDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return SHORT_DATE.format(parsed);
}
