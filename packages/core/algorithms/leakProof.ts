/**
 * Walk-forward replay driver (EVAL-01). This is the phase's signature
 * guarantee: `WalkForwardSimulator` (packages/harness/replay.ts) owns the
 * only reference to the chronological match list, and every algorithm call
 * site goes through `toLeakProofUpcoming`, whose Proxy guards outcome-bearing
 * properties on three surfaces — `get` and `getOwnPropertyDescriptor` both
 * throw for a direct read/probe of any outcome key, while `ownKeys` instead
 * OMITS outcome keys from enumeration (`Object.keys`, `for...in`, spread,
 * `JSON.stringify`), since a whole-object operation has no per-key failure
 * shape to throw into — a runtime fact, not a type-level convention that a
 * cast could bypass (RESEARCH.md Pattern 1, ARCHITECTURE.md Pattern 1).
 * The `ownKeys` omission is invariant-legal only while every `MatchResult`
 * stays an extensible plain object literal with configurable properties
 * (built in packages/corpus/db.ts); freezing/sealing one instead turns
 * this guarantee into a loud engine `TypeError`, never silent leakage.
 *
 * Moved here from packages/harness/replay.ts (04-01-PLAN.md Task 3, Design
 * question 1): `replay.ts` imports `packages/corpus/db.ts`, which imports
 * `better-sqlite3`, `node:fs`, `node:path` and `node:url` — dragging the
 * whole SQLite corpus layer into a Cloudflare Worker bundle were the Worker
 * to import `replay.ts` directly. This module's only imports are the two
 * types below, so it stays importable unchanged by the Phase 4 Worker
 * (mechanically enforced by `packages/core/isomorphic.test.ts`).
 * `packages/harness/replay.ts` re-exports both symbols so every existing
 * import path keeps working unchanged.
 */
import type { MatchResult, UpcomingMatch } from "./types.js";

/**
 * Properties that exist on `MatchResult` but not `UpcomingMatch` — the
 * exact set an algorithm's `predict()` must never observe.
 */
export const OUTCOME_KEYS = new Set<string>([
  "winner",
  "redScore",
  "blueScore",
  "redRpEarned",
  "blueRpEarned",
  "redDqs",
  "blueDqs",
  "hasScoreBreakdown",
  "scoreBreakdownRaw",
]);

/**
 * Shared throw helper (D-A/T-Q2x6-01) — the `get` and `getOwnPropertyDescriptor`
 * traps both call this so the two surfaces can never drift onto two different
 * message strings.
 */
export function denyOutcomeKey(target: MatchResult, prop: string): never {
  throw new Error(
    `Outcome leakage: attempted to read "${prop}" on match ${target.matchKey} before predict() completed`
  );
}

export function toLeakProofUpcoming(result: MatchResult): UpcomingMatch {
  return new Proxy(result, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && OUTCOME_KEYS.has(prop)) {
        denyOutcomeKey(target, prop);
      }
      return Reflect.get(target, prop, receiver);
    },
    // A direct descriptor probe has no innocent reading — it should fail as
    // loudly as a direct property read does (D-A).
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === "string" && OUTCOME_KEYS.has(prop)) {
        denyOutcomeKey(target, prop);
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    // Unlike `get`/`getOwnPropertyDescriptor`, `ownKeys` has no per-key call
    // shape — it returns a list or throws for the WHOLE object. Throwing
    // here would blow up every benign whole-object operation (`console.log`,
    // `util.inspect`, spread, `JSON.stringify`) since every `MatchResult`
    // carries all 7 outcome keys, so filtering is the only workable choice
    // (D-A). Omitting configurable own keys of an extensible target is
    // invariant-legal (D-B) — `MatchResult` objects are plain object
    // literals built in packages/corpus/db.ts and are never frozen/sealed.
    ownKeys(target) {
      return Reflect.ownKeys(target).filter((key) => !(typeof key === "string" && OUTCOME_KEYS.has(key)));
    },
  }) as UpcomingMatch;
}
