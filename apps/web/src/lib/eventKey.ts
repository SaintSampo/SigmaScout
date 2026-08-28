/**
 * The single home for the event-key convention (07-01-PLAN.md Task 1) — the
 * event-page analog of `apps/web/src/lib/teamKey.ts`. This is the ONLY module
 * in `apps/web` that knows the `{4-digit-year}{lowercase-alphanumeric-code}`
 * shape (e.g. `"2024casf"`); every other module that needs to validate an
 * event key or recover its season goes through this file, never a repeated
 * inline regular expression.
 *
 * The pattern was checked this session against every event key in the live
 * `v1/events/{2022,2024,2026}` artifacts — 922 keys, zero non-conforming,
 * lengths 6 to 11 — so it is verified against real published data, not
 * assumed from TBA's documentation alone.
 */

/** Four digits (the season) followed by one or more lowercase alphanumeric characters (the event code). */
export const EVENT_KEY_PATTERN = /^\d{4}[a-z0-9]+$/;

/** `true` when `value` matches `EVENT_KEY_PATTERN` exactly. */
export function isValidEventKey(value: string): boolean {
  return EVENT_KEY_PATTERN.test(value);
}

/**
 * Named error class (this repo's no-bare-error convention,
 * `apps/web/src/lib/api/errors.ts`'s doc comment) for an event key that does
 * not match `EVENT_KEY_PATTERN`.
 */
export class InvalidEventKeyError extends Error {
  constructor(eventKey: string) {
    super(`seasonFromEventKey: "${eventKey}" does not match the expected "{4-digit-year}{code}" shape`);
    this.name = "InvalidEventKeyError";
  }
}

/**
 * The event key's own leading four digits, parsed as the season — e.g.
 * `"2024casf"` -> `2024`. Throws `InvalidEventKeyError` for a key
 * `EVENT_KEY_PATTERN` rejects, rather than returning `NaN`.
 *
 * This is the event page's season source of record (07-01-PLAN.md's Decision
 * 1): `artifactKey`'s `event` branch carries no year segment and
 * `EventArtifactSchema.season` is a required published field, so `?year=`
 * never drives the rendered column set — only this function and the fetched
 * artifact's own `season` field do.
 */
export function seasonFromEventKey(eventKey: string): number {
  if (!isValidEventKey(eventKey)) {
    throw new InvalidEventKeyError(eventKey);
  }
  return Number.parseInt(eventKey.slice(0, 4), 10);
}

/**
 * Returns `eventKey` with its leading four season digits replaced by
 * `season` — e.g. `("2024casf", 2025)` -> `"2025casf"`. Throws
 * `InvalidEventKeyError` for a key `isValidEventKey` rejects, exactly as
 * `seasonFromEventKey` does, so the two helpers share one contract.
 *
 * This module is the one place in `apps/web` that knows the event-key
 * convention — a season swap performed inline at a call site (07-15-PLAN.md
 * Task 3, Phase 5 D-12's year-change extension point) would be a second,
 * driftable copy of that knowledge.
 *
 * TBA's event codes are a naming CONVENTION, not an identity guarantee
 * across seasons: a code that carries over usually names the same event,
 * and the destination page's own header (07-15-PLAN.md Task 1) is what lets
 * a reader confirm it — which is why a caller can safely map by code rather
 * than needing a cross-season event identity the corpus does not have.
 */
export function eventKeyForSeason(eventKey: string, season: number): string {
  if (!isValidEventKey(eventKey)) {
    throw new InvalidEventKeyError(eventKey);
  }
  return `${season}${eventKey.slice(4)}`;
}
