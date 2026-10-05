/**
 * The per event state the live tick remembers between invocations (quick task
 * 261004-uyc): one JSON blob kept in `event_cursor` under the reserved key
 * `liveIngestCursorKey(eventKey)` (`packages/harness/stateBaseline.ts`), in the
 * row's `last_folded_match_key` column. A tick that answered 304 for every poll
 * holds no match list, so without this blob it could not know the event's phase.
 *
 * THIS PLAN WRITES `phase` ONLY. The two ETags, the two seen flags and the two
 * changed-at times are the shape the endpoint polling rule (`eventPhase.ts`'s
 * `endpointsToPoll`) already reads, and plan 02 (official rankings and
 * alliances) is what fills them. They are not dead fields: the rule consumes
 * them today against their defaults, and the defaults say "never seen".
 *
 * Parsing NEVER throws. A missing row, a malformed blob and a blob of the wrong
 * type all become the default state, and a single wrong typed field falls back to
 * that field's default, because a state blob a later version wrote must not take
 * down the tick that reads it. Serialising uses a FIXED key order, so an
 * unchanged state is byte identical and a "did it change" comparison on the text
 * is exact.
 */
import { EVENT_PHASES, type EventPhase } from "./eventPhase.js";

export interface LiveIngestState {
  readonly phase: EventPhase;
  readonly rankingsEtag: string | null;
  readonly alliancesEtag: string | null;
  readonly rankingsSeen: boolean;
  readonly alliancesSeen: boolean;
  readonly rankingsChangedAt: string | null;
  readonly alliancesChangedAt: string | null;
}

export const DEFAULT_LIVE_INGEST_STATE: LiveIngestState = {
  phase: "no-schedule",
  rankingsEtag: null,
  alliancesEtag: null,
  rankingsSeen: false,
  alliancesSeen: false,
  rankingsChangedAt: null,
  alliancesChangedAt: null,
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseLiveIngestState(text: string | null | undefined): LiveIngestState {
  if (typeof text !== "string" || text.length === 0) return DEFAULT_LIVE_INGEST_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return DEFAULT_LIVE_INGEST_STATE;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return DEFAULT_LIVE_INGEST_STATE;
  const record = parsed as Record<string, unknown>;
  const phase = EVENT_PHASES.find((candidate) => candidate === record.phase) ?? DEFAULT_LIVE_INGEST_STATE.phase;
  return {
    phase,
    rankingsEtag: stringOrNull(record.rankingsEtag),
    alliancesEtag: stringOrNull(record.alliancesEtag),
    rankingsSeen: boolOr(record.rankingsSeen, false),
    alliancesSeen: boolOr(record.alliancesSeen, false),
    rankingsChangedAt: stringOrNull(record.rankingsChangedAt),
    alliancesChangedAt: stringOrNull(record.alliancesChangedAt),
  };
}

export function serializeLiveIngestState(state: LiveIngestState): string {
  return JSON.stringify({
    phase: state.phase,
    rankingsEtag: state.rankingsEtag,
    alliancesEtag: state.alliancesEtag,
    rankingsSeen: state.rankingsSeen,
    alliancesSeen: state.alliancesSeen,
    rankingsChangedAt: state.rankingsChangedAt,
    alliancesChangedAt: state.alliancesChangedAt,
  });
}
