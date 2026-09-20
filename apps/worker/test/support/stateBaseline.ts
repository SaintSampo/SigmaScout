/**
 * Test-only helper: seeds one state-baseline marker row per algorithm id into
 * a hand-rolled `FakeD1Database`'s `event_cursor` map, at a given generation —
 * so a fake behaves, by default, like a Worker whose D1 already agrees with
 * the deployed algorithms manifest (the common case every pre-existing
 * `apps/worker/test/scheduled*.test.ts` fixture exercises). Without this, EVERY
 * test that drives `runTick` through a fresh `FakeD1Database()` would need its
 * own explicit marker-seeding call, since quick task 260920-q75 made an absent
 * marker suspend folding rather than default to "healthy".
 *
 * See `packages/harness/stateBaseline.ts` for the shared key contract this
 * mirrors on the test side.
 */
import { stateBaselineEventKey } from "../../../../packages/harness/stateBaseline.js";

/** Structurally identical to every test file's own `FakeEventCursorRow` interface — passed in as a `Map` rather than imported as a type, so no test file needs to export its private interface just to call this helper. */
export interface FakeEventCursorRowShape {
  event_key: string;
  tba_etag: string | null;
  last_folded_match_key: string | null;
  last_polled_at: string | null;
  last_advanced_at: string | null;
}

/** Seeds `cursorMap` with one baseline marker per `algorithmIds` entry, at `generation`. Mutates `cursorMap` in place; call it before any test-specific cursor rows are set, so an explicit per-test cursor at a different key never collides. */
export function seedStateBaselineMarkers(cursorMap: Map<string, FakeEventCursorRowShape>, algorithmIds: readonly string[], generation: string): void {
  for (const id of algorithmIds) {
    const eventKey = stateBaselineEventKey(id);
    cursorMap.set(eventKey, {
      event_key: eventKey,
      tba_etag: null,
      last_folded_match_key: generation,
      last_polled_at: null,
      last_advanced_at: null,
    });
  }
}
