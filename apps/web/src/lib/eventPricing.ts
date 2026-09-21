/**
 * BROWSER PRICING of upcoming SPR matches: the one place pricing is decided
 * (260915-m4j, step 3 of the browser-pricing direction).
 *
 * WHERE IT RUNS: inside `eventQueryOptions`'s `queryFn`, right after the
 * schema parse (`api/event.ts`). The queryFn runs once per fetch per cache
 * entry, off the render path, and its result is shared by every observer of
 * the same key (the event page, the match page and every team page).
 * - A `select` cannot work: it is synchronous, so it cannot await the lazy
 *   pricer chunk, and it runs separately in every observer.
 * - A derived second query would add a second pending state and paint
 *   unpriced rows for a frame before the priced ones.
 * - A render-path hook would be repeated by every consumer.
 * A module-level memo stops a 60 s poll that returns the same generation from
 * re-pricing.
 *
 * WHAT IT RETURNS: the artifact with `state` REMOVED, so no consumer can
 * re-implement pricing, plus `upcomingTeamRows` (the team-page rows built
 * from the same records). Plain objects only, no Map or class, so TanStack's
 * structural sharing keeps references stable when a poll returns identical
 * prices.
 *
 * FAILURE IS NEVER FATAL: a malformed block, a version mismatch, a missing
 * `eventType` or a failed chunk load logs one JSON `console.warn` and returns
 * the artifact unpriced. The block schema's own contract says a consumer
 * falls back to the published fields; a schedule-only row then renders
 * "No prediction".
 *
 * BUNDLE: static imports here are types only. The pricer, the RP code and the
 * rule modules are reached only through the dynamic import below
 * (`eventPricing.bundleGuard.test.ts`).
 */
import type { EventUpcomingMatch, LiveEventArtifact, TeamSeasonMatch } from "../../../../packages/harness/pageArtifacts.js";
import { withDerivedLiveStandings, type LiveStandingsInput, type LiveStandingsMarker } from "./liveStandings.js";

/** The event query's data: the parsed artifact without its `state` block, with browser-priced upcoming rows where a block allowed it. */
export type EventPageArtifact = Omit<LiveEventArtifact, "state"> & {
  /** The team-season row for each upcoming match the browser priced, by match key. Absent when nothing was priced. */
  readonly upcomingTeamRows?: Readonly<Record<string, TeamSeasonMatch>>;
  /** Browser-derived live standings marker (260921-q2s) — see `liveStandings.ts`. Never published; absent on every artifact this derivation did not touch. */
  readonly standings?: LiveStandingsMarker;
};

export type EventPageUpcomingRow = LiveEventArtifact["upcoming"][number];

/** A fully priced upcoming row. Narrowed by `typeof pRedWin === "number"`, never by truthiness: a probability can be 0. */
export function isPricedUpcomingRow(row: EventPageUpcomingRow): row is EventUpcomingMatch {
  return typeof (row as { pRedWin?: unknown }).pRedWin === "number";
}

export type EventPricingModule = typeof import("./eventPricing.lazy.js");

export interface ResolveEventArtifactDeps {
  /** Loads the lazy pricer chunk. Injected by tests; defaults to the real dynamic import. */
  readonly loadPricer?: () => Promise<EventPricingModule>;
}

interface PricedUpcoming {
  readonly upcoming: EventPageArtifact["upcoming"];
  readonly upcomingTeamRows: Readonly<Record<string, TeamSeasonMatch>>;
}

const MEMO_CAPACITY = 16;
/** Insertion-ordered, so the first key is the oldest. Holds the in-flight promise; a failure deletes its entry. */
const memo = new Map<string, Promise<PricedUpcoming | undefined>>();

/** Test hook: forget every memoized pricing. */
export function clearEventPricingMemo(): void {
  memo.clear();
}

function memoKey(parsed: LiveEventArtifact): string {
  return JSON.stringify([
    parsed.eventKey,
    parsed.algorithmId,
    parsed.algorithmVersion,
    parsed.generation,
    parsed.computedAt,
    parsed.upcoming.map((row) => [row.matchKey, row.redTeams, row.blueTeams]),
  ]);
}

function defaultLoadPricer(): Promise<EventPricingModule> {
  return import("./eventPricing.lazy.js");
}

function warnUnpriced(eventKey: string, error: string): void {
  console.warn(JSON.stringify({ event: "event-upcoming-pricing-failed", eventKey, error }));
}

/**
 * Applies `withDerivedLiveStandings` once, right after `state` is stripped,
 * so every one of `resolveEventArtifact`'s three return paths carries the
 * same derived teams (T-q2s-01, this file's threat register). Never throws:
 * a derivation error logs one JSON `console.warn` and returns the artifact
 * unchanged, matching this module's own failure-is-never-fatal doctrine —
 * a browser-side derivation must never fail a fetch or blank an event page.
 */
function withStandingsSafely<T extends LiveStandingsInput>(parsed: LiveEventArtifact, withoutState: T): T {
  try {
    return withDerivedLiveStandings(withoutState);
  } catch (err) {
    console.warn(JSON.stringify({ event: "event-live-standings-failed", eventKey: parsed.eventKey, error: err instanceof Error ? err.name : typeof err }));
    return withoutState;
  }
}

/** Why a block-less or otherwise unpriceable artifact is not priced, or `undefined` when it can be. */
function skipReason(parsed: LiveEventArtifact): string | undefined {
  if (parsed.upcoming.length === 0) return "no-upcoming";
  if (parsed.state === undefined) return "no-state-block";
  if (parsed.algorithmId !== "spr") return "not-spr";
  if (parsed.eventType === undefined) return "no-event-type";
  return undefined;
}

async function priceOnce(parsed: LiveEventArtifact, loadPricer: () => Promise<EventPricingModule>): Promise<PricedUpcoming | undefined> {
  const started = performance.now();
  try {
    const pricer = await loadPricer();
    const priced = await pricer.priceArtifactUpcoming(parsed);
    console.log(
      JSON.stringify({
        event: "event-upcoming-priced",
        eventKey: parsed.eventKey,
        rows: Object.keys(priced.upcomingTeamRows).length,
        durationMs: Math.round((performance.now() - started) * 10) / 10,
      })
    );
    return priced;
  } catch (err) {
    warnUnpriced(parsed.eventKey, err instanceof Error ? err.name : typeof err);
    return undefined;
  }
}

/**
 * The parsed artifact, `state` removed, with its upcoming rows priced from
 * the block when one is usable. Never throws.
 *
 * Prices only when `state` is defined, the algorithm is SPR, `eventType` is
 * known and `upcoming` is non-empty. Otherwise the published rows are
 * returned as they are; a one-line warning is logged only when that leaves a
 * schedule-only row or discards a present block, so a finished event or an
 * OPR page stays quiet.
 */
export async function resolveEventArtifact(parsed: LiveEventArtifact, deps: ResolveEventArtifactDeps = {}): Promise<EventPageArtifact> {
  const { state: _state, ...withoutState } = parsed;
  void _state;
  // Applied ONCE, ahead of the three return paths below, so every one of
  // them carries the same derived teams (260921-q2s).
  const base = withStandingsSafely(parsed, withoutState);

  const reason = skipReason(parsed);
  if (reason !== undefined) {
    const leavesUnpricedRow = parsed.upcoming.some((row) => !isPricedUpcomingRow(row));
    if (reason !== "no-upcoming" && (leavesUnpricedRow || parsed.state !== undefined)) warnUnpriced(parsed.eventKey, reason);
    return base;
  }

  const key = memoKey(parsed);
  let entry = memo.get(key);
  if (entry === undefined) {
    const created = priceOnce(parsed, deps.loadPricer ?? defaultLoadPricer);
    entry = created;
    memo.set(key, created);
    while (memo.size > MEMO_CAPACITY) memo.delete(memo.keys().next().value!);
    // A fallback is not memoized, so a failed chunk load retries on the next fetch.
    void created.then((result) => {
      if (result === undefined && memo.get(key) === created) memo.delete(key);
    });
  }

  const priced = await entry;
  if (priced === undefined) return base;
  return { ...base, upcoming: priced.upcoming, upcomingTeamRows: priced.upcomingTeamRows };
}
