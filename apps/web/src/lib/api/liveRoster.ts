/**
 * The robot page's DISCOVERY fetchers (quick task 260921-5qw): the live-windows
 * manifest and one event's live roster. Together they let a robot page find an
 * event its own published season file has never heard of, which is every event
 * the Worker promoted to live folding without an offline publish. See
 * `packages/harness/liveRoster.ts` for why that gap exists.
 *
 * BOTH FAIL SOFT, and that is a decision, not an omission. Discovery is an
 * ADDITION to a page that is already complete without it: a robot page with no
 * discovery renders exactly what it rendered before this task. So a network
 * failure, a non-ok status or a body that does not parse resolves to "nothing
 * discovered" (`[]` / `null`) instead of throwing into a page error. A 404 on a
 * roster is the ORDINARY answer, the event has simply not been promoted.
 *
 * Neither calls `markArtifactParsed()`: that mark is the parse-to-paint split
 * for the page's own artifact, and these resolve after it has painted.
 */
import { LiveWindowsManifestSchema, type LiveWindowEntry } from "../../../../../packages/harness/manifestSchemas.js";
import { LiveRosterSchema, liveRosterKey, type LiveRoster } from "../../../../../packages/harness/liveRoster.js";
import { artifactUrl } from "../artifactOrigin.js";

/** Must match `apps/worker/src/liveWindows.ts`'s key and `packages/harness/publish.ts`'s own manifest upload key exactly. */
export const LIVE_WINDOWS_MANIFEST_KEY = "v1/manifest/live-windows.json";

/** The manifest and the rosters are both written with `max-age=60`; refetching faster buys nothing. */
const DISCOVERY_STALE_MS = 60_000;

export async function fetchLiveWindows(): Promise<readonly LiveWindowEntry[]> {
  try {
    const res = await fetch(artifactUrl(LIVE_WINDOWS_MANIFEST_KEY));
    if (!res.ok) return [];
    const parsed = LiveWindowsManifestSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.windows : [];
  } catch {
    return [];
  }
}

export async function fetchLiveRoster(eventKey: string): Promise<LiveRoster | null> {
  try {
    const res = await fetch(artifactUrl(liveRosterKey(eventKey)));
    if (!res.ok) return null;
    const parsed = LiveRosterSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function liveWindowsQueryOptions() {
  return { queryKey: ["live-windows"] as const, queryFn: fetchLiveWindows, staleTime: DISCOVERY_STALE_MS };
}

export function liveRosterQueryOptions(eventKey: string) {
  return { queryKey: ["live-roster", eventKey] as const, queryFn: () => fetchLiveRoster(eventKey), staleTime: DISCOVERY_STALE_MS };
}
