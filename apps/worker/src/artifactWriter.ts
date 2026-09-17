/**
 * The online half of the R2 artifact writer (`packages/harness/r2Client.ts`
 * is its offline counterpart — a future editor of either should check the
 * other). This module's correctness condition is that it produces
 * byte-identical output to the offline half given the same input: same key
 * scheme (`artifactKey`, `packages/harness/pageArtifacts.ts`), same schema
 * validation before any write, same cache-control/content-type metadata,
 * same secret-scrub refusal before any write ever reaches R2. One deliberate
 * schema difference: the event page validates with `LiveEventArtifactSchema`,
 * whose `upcoming` rows may be schedule-only, because the live tick no longer
 * prices upcoming matches (260915-isq DD-1; the browser prices them from the
 * artifact's `state` block). The publisher keeps `EventArtifactSchema`.
 *
 * `writeArtifactObject` validates-then-persists, in that order, and never
 * the reverse — a malformed object never reaches R2. Every subrequest-
 * consuming call (the actual `put`/`get`) clears `budget.tryConsume` first;
 * a refusal returns/throws a DEFERRED result, never an attempt-then-throw
 * against the platform's real cap.
 */
import {
  artifactKey,
  CompareArtifactSchema,
  EventsArtifactSchema,
  LiveEventArtifactSchema,
  TeamsArtifactWireSchema,
  TeamSeasonArtifactSchema,
  type ArtifactKeyParams,
  type PageKind,
} from "../../../packages/harness/pageArtifacts.js";
import { LiveMetricSidecarSchema, liveMetricSidecarKey, type LiveMetricSidecar } from "../../../packages/harness/liveMetricSidecar.js";
import type { SubrequestBudget } from "./subrequestBudget.js";
import type { Env } from "./env.js";

/** A 60-second max-age set as object metadata at write time — there is no purge call and no pointer to invalidate on the cron path, matching the offline publisher's own `r2Client.ts` cache policy exactly. */
export const ARTIFACT_CACHE_CONTROL = "public, max-age=60";
export const ARTIFACT_CONTENT_TYPE = "application/json";

/**
 * `teams` validates against `TeamsArtifactWireSchema`, NOT the decoding
 * `TeamsArtifactSchema` used everywhere this Worker READS a teams artifact
 * (`scheduled.ts`'s `runGlobalRebuild`). `writeArtifactObject` below
 * `JSON.stringify`s exactly what this map's `.parse()` call returns —
 * decoding here would silently turn every write back into the object-form
 * shape the wire format exists to shrink, undoing the wire saving on the
 * live Worker's incremental rebuild path.
 */
const SCHEMA_BY_PAGE: Record<PageKind, { parse(input: unknown): unknown }> = {
  teams: TeamsArtifactWireSchema,
  team: TeamSeasonArtifactSchema,
  events: EventsArtifactSchema,
  event: LiveEventArtifactSchema,
  compare: CompareArtifactSchema,
};

/**
 * Thrown when a serialized artifact would contain the configured TBA secret —
 * refuses the write entirely.
 *
 * `page` widens to include `"live-sidecar"` (quick task 260917-jr4) so the
 * ephemeral sidecar's writer reuses this class VERBATIM rather than declaring
 * a second, subtly different leak error. It is a `PageKind | "live-sidecar"`
 * rather than a bare `string` on purpose: the sidecar is deliberately NOT a
 * `PageKind` (see `liveMetricSidecarKey`'s own doc comment), and widening to
 * `string` would let any caller invent a label.
 */
export class ArtifactSecretLeakError extends Error {
  constructor(page: PageKind | "live-sidecar") {
    super(`writeArtifactObject: refusing to write "${page}" artifact — serialized output contains a secret value`);
    this.name = "ArtifactSecretLeakError";
  }
}

/** Thrown by `readArtifactObject` when the budget cannot afford the read — distinct from a genuine miss (which returns `undefined`), so a caller never confuses "budget-starved" with "not published yet." */
export class ArtifactReadBudgetExhaustedError extends Error {
  constructor(key: string) {
    super(`readArtifactObject: subrequest budget exhausted before reading "${key}"`);
    this.name = "ArtifactReadBudgetExhaustedError";
  }
}

export interface WriteArtifactResult {
  /** `true` when the budget could not accommodate this put — the write was NOT attempted, and the caller should treat this event/team as still-pending for the next tick. Never thrown for this case; deferral is a normal outcome. */
  readonly deferred: boolean;
}

/**
 * Validates `artifact` against `page`'s schema (throws on failure, issuing
 * ZERO puts), refuses to write a body containing `env.TBA_API_KEY`, asks
 * `budget.tryConsume(1)` and returns `{ deferred: true }` without writing if
 * the budget cannot accommodate it, and otherwise issues exactly one R2
 * `put` at `artifactKey(page, params)` with `ARTIFACT_CACHE_CONTROL`'s
 * cache-control/content-type metadata.
 */
export async function writeArtifactObject(env: Env, budget: SubrequestBudget, page: PageKind, params: ArtifactKeyParams, artifact: unknown): Promise<WriteArtifactResult> {
  const schema = SCHEMA_BY_PAGE[page];
  const validated = schema.parse(artifact);
  const serialized = JSON.stringify(validated);

  if (env.TBA_API_KEY && serialized.includes(env.TBA_API_KEY)) {
    throw new ArtifactSecretLeakError(page);
  }

  if (!budget.tryConsume(1)) {
    return { deferred: true };
  }

  const key = artifactKey(params);
  await env.ARTIFACTS.put(key, serialized, {
    httpMetadata: { contentType: ARTIFACT_CONTENT_TYPE, cacheControl: ARTIFACT_CACHE_CONTROL },
  });
  return { deferred: false };
}

/**
 * Mirrors `writeArtifactObject` for the read side: `undefined` for a missing
 * key (a normal outcome — a first-ever write for an event/team, never an
 * error) rather than throwing. Throws `ArtifactReadBudgetExhaustedError` when
 * the budget cannot afford the read at all.
 */
export async function readArtifactObject(env: Env, budget: SubrequestBudget, key: string): Promise<string | undefined> {
  if (!budget.tryConsume(1)) {
    throw new ArtifactReadBudgetExhaustedError(key);
  }
  const object = await env.ARTIFACTS.get(key);
  if (object === null) return undefined;
  return object.text();
}

// ---------------------------------------------------------------------------
// The LIVE METRIC SIDECAR pair (quick task 260917-jr4).
//
// Same budget discipline and the SAME secret scrub as the page writer above —
// validate then persist, never the reverse — but validated against
// `LiveMetricSidecarSchema` and keyed via `liveMetricSidecarKey`.
//
// THEY ARE A SEPARATE PAIR ON PURPOSE. Adding a sixth entry to
// `SCHEMA_BY_PAGE` and widening `PageKind` would have been shorter and is
// exactly the thing that must not happen: keeping the sidecar out of that map
// is what structurally stops it ever being addressed, served or clobbered as
// a published page. `packages/harness/liveMetricSidecar.ts`'s own header
// states the full three-part argument.
// ---------------------------------------------------------------------------

/**
 * Validates `sidecar` against `LiveMetricSidecarSchema` (throws on failure,
 * issuing ZERO puts), refuses to write a body containing `env.TBA_API_KEY`,
 * asks `budget.tryConsume(1)` and returns `{ deferred: true }` without
 * writing if the budget cannot accommodate it, and otherwise issues exactly
 * one R2 `put` at `liveMetricSidecarKey(params)` with the same
 * cache-control/content-type metadata every artifact write uses.
 *
 * Returns the serialized byte length alongside `deferred` so the caller can
 * check the sidecar's byte ceiling without re-serializing the body a second
 * time against the tick's CPU budget. `bytes` is 0 for a deferred write.
 */
export async function writeLiveSidecarObject(
  env: Env,
  budget: SubrequestBudget,
  params: { eventKey: string; algorithmId: string; version: string },
  sidecar: unknown
): Promise<WriteArtifactResult & { readonly bytes: number }> {
  const validated = LiveMetricSidecarSchema.parse(sidecar);
  const serialized = JSON.stringify(validated);

  if (env.TBA_API_KEY && serialized.includes(env.TBA_API_KEY)) {
    throw new ArtifactSecretLeakError("live-sidecar");
  }

  if (!budget.tryConsume(1)) {
    return { deferred: true, bytes: 0 };
  }

  await env.ARTIFACTS.put(liveMetricSidecarKey(params), serialized, {
    httpMetadata: { contentType: ARTIFACT_CONTENT_TYPE, cacheControl: ARTIFACT_CACHE_CONTROL },
  });
  return { deferred: false, bytes: serialized.length };
}

/**
 * Mirrors `readArtifactObject`'s contract for the sidecar, with the parse
 * folded in: `undefined` for a genuine miss (the ordinary state for the FIRST
 * fold at an event, never an error) AND for an object whose shape the schema
 * rejects — in both cases the caller bootstraps a fresh sidecar, which is the
 * correct self-healing outcome for a corrupt one and matches the artifact read
 * path's own degrade-to-bootstrap contract.
 *
 * Throws `ArtifactReadBudgetExhaustedError` when the budget cannot afford the
 * read at all. THAT DISTINCTION IS LOAD-BEARING: a budget-starved read must
 * skip the sidecar write entirely for that tick, because bootstrapping over a
 * sidecar that is merely unreadable would discard every row it holds.
 */
export async function readLiveSidecarObject(
  env: Env,
  budget: SubrequestBudget,
  params: { eventKey: string; algorithmId: string; version: string }
): Promise<LiveMetricSidecar | undefined> {
  const text = await readArtifactObject(env, budget, liveMetricSidecarKey(params));
  if (text === undefined) return undefined;
  try {
    return LiveMetricSidecarSchema.parse(JSON.parse(text));
  } catch {
    return undefined; // unparseable or wrong-shaped -- degrade to a fresh bootstrap
  }
}
