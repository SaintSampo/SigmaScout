/**
 * The season-level per-event loop's one tolerance: an event TBA lists but
 * whose endpoint answers HTTP 404 is skipped and named, and the season goes on.
 *
 * TBA can list an event in `/events/{year}` yet 404 its `/event/{key}/matches`
 * (2026cascc, 2026-09-28), and one such event used to abort the whole
 * season's ingest and every `pnpm rebaseline` behind it. The rankings,
 * alliances and awards passes already skip a per-event 404 the same way. Any
 * other failure (a 5xx, a schema error, a network error) still throws, and a
 * single explicitly requested event (`--event`) never comes through here, so
 * it still fails loudly.
 */

/** True for `tbaFetch`'s thrown non-OK error when the status was 404. */
export function isTbaNotFound(err: unknown): boolean {
  return err instanceof Error && /-> HTTP 404$/.test(err.message);
}

/**
 * Runs `ingestOne` for each event key in order, skipping (and logging) an
 * event whose request 404s. Returns the skipped keys, in order.
 */
export async function ingestEventsSkippingNotFound(
  eventKeys: readonly string[],
  ingestOne: (eventKey: string) => Promise<void>,
  log: (line: string) => void = console.log
): Promise<string[]> {
  const skipped: string[] = [];
  for (const eventKey of eventKeys) {
    try {
      await ingestOne(eventKey);
    } catch (err) {
      if (!isTbaNotFound(err)) throw err;
      log(`  ${eventKey}: ${(err as Error).message}, skipping`);
      skipped.push(eventKey);
    }
  }
  return skipped;
}
