/**
 * The shared answer a tick test's TBA `fetch` stub gives to the two official data
 * endpoints the live event pass polls (quick task 261004-uyc):
 * `/event/{key}/rankings` and `/event/{key}/alliances`.
 *
 * Every tick test file builds its own stub, and each stub answers an unknown URL
 * with a 404 or a throw, which `tbaFetch` turns into a failed poll. Once the pass
 * asks for rankings and alliances, every fold tick in those files would log a
 * failure row and a warn line that has nothing to do with what the test is about.
 * Calling this FIRST in a stub keeps those ticks quiet: a 200 whose body is a bare
 * `null` (TBA's real answer for an event with no ranking structure) and no ETag,
 * so the pass parses it, finds nothing to write and stores nothing.
 *
 * A test that exercises the new behaviour builds its own records instead.
 */

/** The response shape the existing stubs return, structurally. */
export interface OfficialDataStubResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

/** The quiet answer for a rankings or alliances URL, or `undefined` for any other URL. */
export function officialDataStubResponse(url: string): OfficialDataStubResponse | undefined {
  if (!/\/event\/[^/]+\/(rankings|alliances)$/.test(url)) return undefined;
  return { status: 200, ok: true, headers: { get: () => null }, json: async () => null };
}
