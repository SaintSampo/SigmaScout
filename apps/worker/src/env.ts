/**
 * The Worker's whole typed binding surface (wrangler.toml's `DB`/`ARTIFACTS`/
 * `MANIFEST`, plus the `TBA_API_KEY` secret set with `wrangler secret put` in
 * plan 04-07 — never assigned a value in the tracked `wrangler.toml`). Every
 * module that touches a Cloudflare binding or the TBA key reads it off this
 * ONE typed `Env`, never an untyped `env.something` — a typo in a binding
 * name fails at compile time instead of as a runtime `undefined`.
 */
export interface Env {
  /** D-12/D-13/D-09: algorithm_state + event_cursor (apps/worker/migrations/0001_algorithm_state.sql), read/written only via stateStore.ts's batched helpers. */
  readonly DB: D1Database;
  /** D-01/D-02/D-16: published page artifacts, written offline by `pnpm publish:artifacts` and read back here. */
  readonly ARTIFACTS: R2Bucket;
  /** D-18: the small, hot live-windows manifest pointer only — see wrangler.toml's own comment for why per-tick bookkeeping does NOT live here. */
  readonly MANIFEST: KVNamespace;
  /** Set via `wrangler secret put TBA_API_KEY` (plan 04-07) — NEVER assigned a value in wrangler.toml, which is tracked in git. */
  readonly TBA_API_KEY: string;
}
