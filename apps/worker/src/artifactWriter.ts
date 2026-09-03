/**
 * The online half of the R2 artifact writer (`packages/harness/r2Client.ts`
 * is its offline counterpart — a future editor of either should check the
 * other). This module's correctness condition is that it produces
 * byte-identical output to the offline half given the same input: same key
 * scheme (`artifactKey`, `packages/harness/pageArtifacts.ts`), same schema
 * validation before any write, same cache-control/content-type metadata,
 * same secret-scrub refusal (`packages/harness/artifact.ts`'s `writeArtifact`
 * discipline, mirrored here).
 *
 * `writeArtifactObject` validates-then-persists, in that order, and never
 * the reverse — a malformed object never reaches R2 (T-04-22). Every
 * subrequest-consuming call (the actual `put`/`get`) clears `budget.
 * tryConsume` first; a refusal returns/throws a DEFERRED result, never an
 * attempt-then-throw against the platform's real cap.
 */
import {
  artifactKey,
  CompareArtifactSchema,
  EventArtifactSchema,
  EventsArtifactSchema,
  TeamsArtifactWireSchema,
  TeamSeasonArtifactSchema,
  type ArtifactKeyParams,
  type PageKind,
} from "../../../packages/harness/pageArtifacts.js";
import type { SubrequestBudget } from "./subrequestBudget.js";
import type { Env } from "./env.js";

/** D-26: a 60-second max-age set as object metadata AT WRITE TIME — there is no purge call and no pointer to invalidate on the cron path, matching the offline publisher's own `r2Client.ts` cache policy exactly. */
export const ARTIFACT_CACHE_CONTROL = "public, max-age=60";
export const ARTIFACT_CONTENT_TYPE = "application/json";

/**
 * 260902-pbe: `teams` validates against `TeamsArtifactWireSchema`, NOT the
 * decoding `TeamsArtifactSchema` used everywhere this Worker READS a teams
 * artifact (`scheduled.ts`'s `runGlobalRebuild`). `writeArtifactObject`
 * below `JSON.stringify`s exactly what this map's `.parse()` call returns —
 * decoding here would silently turn every write back into the object-form
 * shape this task exists to shrink, undoing the entire wire saving on the
 * one path (the live Worker's incremental rebuild) that writes a teams
 * artifact between now and the later full republish.
 */
const SCHEMA_BY_PAGE: Record<PageKind, { parse(input: unknown): unknown }> = {
  teams: TeamsArtifactWireSchema,
  team: TeamSeasonArtifactSchema,
  events: EventsArtifactSchema,
  event: EventArtifactSchema,
  compare: CompareArtifactSchema,
};

/** Thrown when a serialized artifact would contain the configured TBA secret — refuses the write entirely, mirroring `packages/harness/artifact.ts`'s `writeArtifact` scrub guard. */
export class ArtifactSecretLeakError extends Error {
  constructor(page: PageKind) {
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
  /** `true` when the budget could not accommodate this put — the write was NOT attempted, and the caller should treat this event/team as still-pending for the next tick (D-15). Never thrown for this case; deferral is a normal outcome. */
  readonly deferred: boolean;
}

/**
 * Validates `artifact` against `page`'s schema (throws on failure, issuing
 * ZERO puts), refuses to write a body containing `env.TBA_API_KEY`, asks
 * `budget.tryConsume(1)` and returns `{ deferred: true }` without writing if
 * the budget cannot accommodate it, and otherwise issues exactly one R2
 * `put` at `artifactKey(page, params)` with D-26's cache-control/content-type
 * metadata.
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
