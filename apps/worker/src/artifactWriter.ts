/**
 * The online half of the R2 artifact writer (`packages/harness/r2Client.ts`
 * is its offline counterpart — a future editor of either should check the
 * other). This module's correctness condition is that it produces
 * byte-identical output to the offline half given the same input: same key
 * scheme (`artifactKey`, `packages/harness/pageArtifacts.ts`), same schema
 * validation before any write, same cache-control/content-type metadata,
 * same secret-scrub refusal before any write ever reaches R2. There is no longer
 * any schema difference between the two halves: both validate the event page
 * with `EventArtifactSchema`. Between 260915-isq and 260923-3w7 the live half
 * used a second schema whose `upcoming` rows could be schedule-only, because the
 * tick wrote rows with no prediction for the browser to price from a `state`
 * block; the tick prices them itself again and there is one shape.
 *
 * `writeArtifactObject` validates-then-persists, in that order, and never
 * the reverse — a malformed object never reaches R2. Every subrequest-spending
 * call (the actual `put`/`get`) records itself on the tick's
 * `SubrequestCounter` first, which is telemetry only: quick task 260923-3w4
 * deleted the deferral this used to gate, along with
 * `WriteArtifactResult.deferred` and `ArtifactReadBudgetExhaustedError`, because
 * the 50-subrequest free-plan cap they existed for is now 10,000. The counting
 * still happens BEFORE the call, so `used` is an exact witness of whether the
 * `put`/`get` itself was reached — `scheduled.ts`'s
 * `writeArtifactWithBootstrapRetry` reads it for exactly that.
 */
import {
  artifactKey,
  CompareArtifactSchema,
  districtDetailKey,
  DistrictArtifactSchema,
  EventsArtifactSchema,
  EventArtifactSchema,
  TeamsArtifactWireSchema,
  TeamSeasonArtifactSchema,
  type ArtifactKeyParams,
  type PageKind,
} from "../../../packages/harness/pageArtifacts.js";
import type { SubrequestCounter } from "./subrequestCounter.js";
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
  event: EventArtifactSchema,
  compare: CompareArtifactSchema,
};

/**
 * Thrown when a serialized artifact would contain the configured TBA secret —
 * refuses the write entirely.
 *
 * `page` is a `PageKind`, never a bare `string`: every writer in this module
 * addresses a published page kind, and widening to `string` would let a caller
 * invent a label. It was briefly `PageKind | "live-sidecar"` (quick task
 * 260917-jr4) for the ephemeral sidecar's own writer; 260918-16t deleted that
 * writer, and the union was NARROWED BACK with it rather than left behind as a
 * vestigial escape hatch that would quietly re-admit a non-page label.
 */
export class ArtifactSecretLeakError extends Error {
  constructor(page: PageKind) {
    super(`writeArtifactObject: refusing to write "${page}" artifact — serialized output contains a secret value`);
    this.name = "ArtifactSecretLeakError";
  }
}

/**
 * Validates `artifact` against `page`'s schema (throws on failure, issuing
 * ZERO puts), refuses to write a body containing `env.TBA_API_KEY`, and
 * otherwise records one subrequest and issues exactly one R2 `put` at
 * `artifactKey(page, params)` with `ARTIFACT_CACHE_CONTROL`'s
 * cache-control/content-type metadata.
 *
 * IT NO LONGER RETURNS ANYTHING. Until quick task 260923-3w4 it returned
 * `{ deferred: boolean }`, `true` meaning the subrequest budget could not
 * accommodate the put so the write was skipped for a later tick. That path only
 * existed under the free plan's 50-subrequest cap, which is 10,000 on Workers
 * Paid; `runGlobalRebuild` was the only caller that read the flag, and it
 * treated a deferral as "the rebuild did not run". A write now either happens or
 * throws.
 */
export async function writeArtifactObject(env: Env, counter: SubrequestCounter, page: PageKind, params: ArtifactKeyParams, artifact: unknown): Promise<void> {
  const schema = SCHEMA_BY_PAGE[page];
  const validated = schema.parse(artifact);
  const serialized = JSON.stringify(validated);

  if (env.TBA_API_KEY && serialized.includes(env.TBA_API_KEY)) {
    throw new ArtifactSecretLeakError(page);
  }

  counter.spend(1);
  const key = artifactKey(params);
  await env.ARTIFACTS.put(key, serialized, {
    httpMetadata: { contentType: ARTIFACT_CONTENT_TYPE, cacheControl: ARTIFACT_CACHE_CONTROL },
  });
}

/**
 * The district half of the same secret refusal, thrown by
 * `writeDistrictArtifactObject` with zero puts issued.
 *
 * A SEPARATE CLASS ON PURPOSE. `ArtifactSecretLeakError`'s `page` parameter is
 * typed `PageKind` and its own doc comment above records that the union was
 * NARROWED BACK to that after a brief widening, precisely so no caller can
 * invent a non-page label. A district key is not a `PageKind` (see
 * `writeDistrictArtifactObject` for why it stays outside), so it gets its own
 * error rather than re-opening that union.
 */
export class DistrictArtifactSecretLeakError extends Error {
  constructor(districtKey: string) {
    super(`writeDistrictArtifactObject: refusing to write district "${districtKey}" artifact — serialized output contains a secret value`);
    this.name = "DistrictArtifactSecretLeakError";
  }
}

/**
 * `writeArtifactObject`'s body, for `v1/district/{districtKey}.json`:
 * `DistrictArtifactSchema.parse` FIRST (throws, issuing ZERO puts), then
 * `JSON.stringify`, then the `env.TBA_API_KEY` substring refusal, then one
 * counted subrequest, then exactly one `put` carrying this module's own
 * `ARTIFACT_CONTENT_TYPE`/`ARTIFACT_CACHE_CONTROL` metadata. It lives beside
 * `writeArtifactObject` so both halves of that refusal are in one file and a
 * future editor of either sees the other (threat T-10-05-01, transferred from
 * 10-03's T-10-03-03).
 *
 * WHY IT BYPASSES `SCHEMA_BY_PAGE` rather than adding a `"district"` page
 * kind: district keys are outside `PageKind` by design
 * (`packages/harness/pageArtifacts.ts`'s `districtsIndexKey`/`districtDetailKey`
 * doc comment), and `PageKind` is the exhaustive union `SCHEMA_BY_PAGE` here
 * and `publish.ts`'s per-season byte budget both rely on staying closed.
 * Widening it would buy nothing and cost every exhaustive switch. This writer
 * takes `DistrictArtifactSchema` directly instead.
 *
 * WHY IT RETURNS BYTES AND ASSERTS NO CEILING: `DISTRICT_DETAIL_MAX_BYTES`
 * lives in `packages/harness/publishBudget.ts`, which imports `node:path` —
 * importing it here would pull a Node built-in into the Worker's bundle graph,
 * the exact accident `wrangler.toml`'s `nodejs_compat` comment records from
 * plan 04-05. The ceiling is asserted at publish time (10-06) instead; the
 * byte count exists so the tick's `district-refreshed` log line makes growth
 * visible without a tail.
 */
export async function writeDistrictArtifactObject(env: Env, counter: SubrequestCounter, districtKey: string, artifact: unknown): Promise<number> {
  const validated = DistrictArtifactSchema.parse(artifact);
  const serialized = JSON.stringify(validated);

  if (env.TBA_API_KEY && serialized.includes(env.TBA_API_KEY)) {
    throw new DistrictArtifactSecretLeakError(districtKey);
  }

  counter.spend(1);
  await env.ARTIFACTS.put(districtDetailKey(districtKey), serialized, {
    httpMetadata: { contentType: ARTIFACT_CONTENT_TYPE, cacheControl: ARTIFACT_CACHE_CONTROL },
  });
  return serialized.length;
}

/**
 * Mirrors `writeArtifactObject` for the read side: `undefined` for a missing
 * key (a normal outcome — a first-ever write for an event/team, never an
 * error) rather than throwing. It used to also throw
 * `ArtifactReadBudgetExhaustedError` when the subrequest budget could not
 * afford the read; quick task 260923-3w4 deleted that error with the budget, so
 * `undefined` now means exactly one thing — the key is not in R2.
 */
export async function readArtifactObject(env: Env, counter: SubrequestCounter, key: string): Promise<string | undefined> {
  counter.spend(1);
  const object = await env.ARTIFACTS.get(key);
  if (object === null) return undefined;
  return object.text();
}
