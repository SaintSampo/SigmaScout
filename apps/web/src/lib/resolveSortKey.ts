/**
 * The single sort-key resolver both the algorithm-change and year-change
 * paths call. Takes the key SET, not an algorithm id or a season — the
 * function cannot know or care which axis moved, so there is exactly one
 * implementation for both triggers rather than two that could drift.
 *
 * Direction is deliberately not this function's business — both callers
 * preserve the existing sort direction themselves and only the key falls
 * back here.
 */
import { TOTAL_KEY } from "./metricKeys.js";

export function resolveSortKey(currentSort: string | undefined, validKeys: readonly string[]): string {
  if (currentSort !== undefined && validKeys.includes(currentSort)) {
    return currentSort;
  }
  return TOTAL_KEY;
}
