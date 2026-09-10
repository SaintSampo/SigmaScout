/**
 * The single home for the match-key convention (260909-tiq-PLAN.md Task 1) —
 * the match-page analog of `apps/web/src/lib/eventKey.ts`. This is the ONLY
 * module in `apps/web` that knows the `{eventKey}_{suffix}` shape (e.g.
 * `"2024casf_qm1"`); every other module that needs to validate a match key or
 * recover its event key goes through this file, never a repeated inline
 * split/regex.
 *
 * A match key is `{eventKey}_{suffix}`, split at the FIRST underscore — an
 * event key matches `EVENT_KEY_PATTERN` (`^\d{4}[a-z0-9]+$`) and therefore
 * contains no underscore of its own, so the first underscore is always the
 * eventKey/suffix boundary. The prefix is validated by delegating to
 * `isValidEventKey` — never a second copy of the event-key regex, matching
 * this repo's single-source-of-truth convention for key shapes.
 *
 * This module DELIBERATELY does NOT validate the suffix's internal shape and
 * does NOT parse `compLevel`/`setNumber`/`matchNumber` out of it, for two
 * reasons:
 *
 * 1. The published match row already carries those three fields, and
 *    `team/MatchTable.tsx`'s `matchLabel()` already renders them from the row
 *    — deriving a display string from an opaque key instead would be the
 *    `eventName: eventKey` class of mistake (06-RESEARCH.md Pitfall 1).
 * 2. The authoritative "is this a real match" check is whether the event
 *    artifact contains a row with this key, which the route performs anyway
 *    by looking the key up in the merged match rows. A suffix regex here
 *    would only add a way to reject a real key shape nobody enumerated.
 */
import { isValidEventKey } from "./eventKey.js";

/**
 * Named error class (this repo's no-bare-error convention,
 * `apps/web/src/lib/api/errors.ts`'s doc comment) for a match key that does
 * not match the `{eventKey}_{suffix}` shape.
 */
export class InvalidMatchKeyError extends Error {
  constructor(matchKey: string) {
    super(`eventKeyFromMatchKey: "${matchKey}" does not match the expected "{eventKey}_{suffix}" shape`);
    this.name = "InvalidMatchKeyError";
  }
}

/**
 * Splits `matchKey` at its first underscore and returns `{ eventKeyPart,
 * suffixPart }`, or `undefined` when there is no underscore, the prefix
 * before it is not a valid event key, or the suffix after it is empty.
 * Module-private: both exported functions below delegate to this single
 * split so the two can never disagree about what counts as a valid key.
 */
function splitMatchKey(matchKey: string): { eventKeyPart: string; suffixPart: string } | undefined {
  const separatorIndex = matchKey.indexOf("_");
  if (separatorIndex === -1) return undefined;

  const eventKeyPart = matchKey.slice(0, separatorIndex);
  const suffixPart = matchKey.slice(separatorIndex + 1);
  if (suffixPart.length === 0) return undefined;
  if (!isValidEventKey(eventKeyPart)) return undefined;

  return { eventKeyPart, suffixPart };
}

/** `true` when `matchKey` splits into a valid event-key prefix and a non-empty suffix. */
export function isValidMatchKey(matchKey: string): boolean {
  return splitMatchKey(matchKey) !== undefined;
}

/**
 * The match key's own event-key prefix — e.g. `"2024casf_qm1"` ->
 * `"2024casf"`. Throws `InvalidMatchKeyError` for a key `isValidMatchKey`
 * rejects, rather than returning a nonsense substring.
 */
export function eventKeyFromMatchKey(matchKey: string): string {
  const split = splitMatchKey(matchKey);
  if (split === undefined) {
    throw new InvalidMatchKeyError(matchKey);
  }
  return split.eventKeyPart;
}
