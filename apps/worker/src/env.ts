/**
 * The Worker's whole typed binding surface (wrangler.toml's `DB`/`ARTIFACTS`/
 * `MANIFEST`, plus the `TBA_API_KEY` secret set with `wrangler secret put` —
 * never assigned a value in the tracked `wrangler.toml`). Every module that
 * touches a Cloudflare binding or the TBA key reads it off this ONE typed
 * `Env`, never an untyped `env.something` — a typo in a binding name fails
 * at compile time instead of as a runtime `undefined`.
 */
export interface Env {
  /** algorithm_state + event_cursor (apps/worker/migrations/0001_algorithm_state.sql), read/written only via stateStore.ts's batched helpers. */
  readonly DB: D1Database;
  /** Published page artifacts, written offline by `pnpm publish:artifacts` and read back here. */
  readonly ARTIFACTS: R2Bucket;
  /** The small, hot live-windows manifest pointer only — see wrangler.toml's own comment for why per-tick bookkeeping does NOT live here. */
  readonly MANIFEST: KVNamespace;
  /** Set via `wrangler secret put TBA_API_KEY` — NEVER assigned a value in wrangler.toml, which is tracked in git. */
  readonly TBA_API_KEY: string;
  /**
   * A plain `[vars]` value (never a secret) — the real TBA base URL by
   * default, tracked in `wrangler.toml`. The replay rig overrides it at
   * DEPLOY TIME only, via `wrangler deploy --var
   * TBA_BASE_URL:<fixture-worker-url>`, never by editing the tracked file —
   * see `docs/worker-operations.md`'s "Replay rig" section for the exact
   * procedure. Threaded into `packages/ingest/tbaClient.ts`'s
   * `TbaClientContext.baseUrl` by `tbaPoll.ts`'s `createTbaContext`; nothing
   * else about the TBA client (spacing, ETag handling, the request counter)
   * changes when this is overridden.
   */
  readonly TBA_BASE_URL: string;
  /**
   * The comma-separated subset of the published algorithm ids that folds
   * LIVE, per tick — NOT the published set, which is unaffected by this
   * value. A plain `[vars]` value (never a secret), tracked in
   * `wrangler.toml`, following `TBA_BASE_URL`'s own precedent in the same
   * block.
   *
   * Declared OPTIONAL, not required, for two reasons: the existing test envs
   * construct `Env` through an `as Env` cast, and — more importantly — a
   * deploy-time `wrangler deploy --var` override (the replay rig's own
   * mechanism) may or may not carry the other tracked vars through. An
   * optional type makes the unset branch (`scheduled.ts`'s
   * `parseLiveAlgorithmIds`, which defaults to `DEFAULT_LIVE_ALGORITHM_IDS`
   * and emits a `live-tier-defaulted` warn line) a real, reachable,
   * type-checked path instead of dead code the compiler believes cannot
   * happen.
   */
  readonly LIVE_ALGORITHM_IDS?: string;
}
