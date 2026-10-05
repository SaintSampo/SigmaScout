/**
 * Where an event is in its day, derived from the match list the tick already
 * holds, plus the rule for which TBA endpoints are worth polling in each phase
 * (quick task 261004-uyc). Pure: no I/O, no clock read (the caller hands `nowMs`
 * in), no `env`.
 *
 * THE SEVEN PHASES, in day order:
 *   no-schedule          TBA lists no match for the event at all.
 *   schedule-posted      a qualification schedule exists and nothing is played.
 *   quals-in-progress    some, not all, qualification matches are played.
 *   quals-complete       every qualification match is played; alliances are not
 *                        known yet (alliance selection is under way).
 *   alliances-posted     alliances are known: a playoff row names both alliances,
 *                        or the alliances endpoint already answered with some.
 *   playoffs-in-progress a playoff match has been played and the event is not over.
 *   complete             every playoff row is played and one colour has won the
 *                        finals series (two wins in the same finals set).
 *
 * A PHASE CAN MOVE BACKWARD, and the derivation allows it on purpose: TBA creates
 * the next playoff row after a result, so a `complete` event can regain an
 * unplayed row (a tied finals replay) and derive `playoffs-in-progress` again.
 * Nothing here is monotone, and nothing downstream may assume it is.
 *
 * `finalsDecided` is sharper than `districtEventState.ts`'s `playoffsDone` on
 * purpose, and stays local: a finals series is not over after match one, and a
 * phase of `complete` that fired early would stop the rankings poll while the
 * last matches still change standings. That module is not edited.
 */
import { isPlayed } from "../../../packages/ingest/normalize.js";
import type { TbaMatch } from "../../../packages/ingest/schemas.js";
import type { LiveIngestState } from "./liveIngestState.js";

export const EVENT_PHASES = ["no-schedule", "schedule-posted", "quals-in-progress", "quals-complete", "alliances-posted", "playoffs-in-progress", "complete"] as const;
export type EventPhase = (typeof EVENT_PHASES)[number];

/** The counts a phase is derived from. Everything `deriveEventPhase` needs and nothing it does not. */
export interface LivePhaseFacts {
  readonly qualTotal: number;
  readonly qualPlayed: number;
  readonly playoffTotal: number;
  readonly playoffPlayed: number;
  /** Playoff rows whose two sides BOTH name teams. A placeholder row TBA created with an empty side is not an alliance selection. */
  readonly playoffWithBothAlliances: number;
  /** One colour holds two or more wins within a single finals set. */
  readonly finalsDecided: boolean;
}

export function deriveLivePhaseFacts(matches: readonly TbaMatch[]): LivePhaseFacts {
  let qualTotal = 0;
  let qualPlayed = 0;
  let playoffTotal = 0;
  let playoffPlayed = 0;
  let playoffWithBothAlliances = 0;
  // finals set number -> wins per colour
  const finalsWins = new Map<number, { red: number; blue: number }>();

  for (const match of matches) {
    if (match.comp_level === "qm") {
      qualTotal++;
      if (isPlayed(match)) qualPlayed++;
      continue;
    }
    playoffTotal++;
    if (isPlayed(match)) playoffPlayed++;
    if (match.alliances.red.team_keys.length > 0 && match.alliances.blue.team_keys.length > 0) playoffWithBothAlliances++;
    if (match.comp_level === "f" && (match.winning_alliance === "red" || match.winning_alliance === "blue")) {
      const wins = finalsWins.get(match.set_number) ?? { red: 0, blue: 0 };
      wins[match.winning_alliance]++;
      finalsWins.set(match.set_number, wins);
    }
  }

  let finalsDecided = false;
  for (const wins of finalsWins.values()) if (wins.red >= 2 || wins.blue >= 2) finalsDecided = true;

  return { qualTotal, qualPlayed, playoffTotal, playoffPlayed, playoffWithBothAlliances, finalsDecided };
}

/** `alliancesKnown` is whether the alliances endpoint has answered with any alliance (the remembered `alliancesSeen`). */
export function deriveEventPhase(facts: LivePhaseFacts, alliancesKnown: boolean): EventPhase {
  if (facts.qualTotal === 0 && facts.playoffTotal === 0) return "no-schedule";

  if (facts.playoffPlayed > 0) {
    return facts.finalsDecided && facts.playoffPlayed === facts.playoffTotal ? "complete" : "playoffs-in-progress";
  }

  if (facts.qualTotal > 0 && facts.qualPlayed < facts.qualTotal) {
    return facts.qualPlayed === 0 ? "schedule-posted" : "quals-in-progress";
  }

  // Qualifications are all played, or there are none (a playoff only event).
  if (facts.playoffWithBothAlliances > 0 || alliancesKnown) return "alliances-posted";
  return facts.qualTotal > 0 ? "quals-complete" : "schedule-posted";
}

/** How long after an official endpoint last changed it is still worth asking about. */
export const OFFICIAL_DATA_SETTLE_MS = 30 * 60 * 1000;

export interface EndpointsToPoll {
  readonly rankings: boolean;
  readonly alliances: boolean;
}

/** An endpoint is worth another poll while it has never been seen, or changed within the settle window. */
function stillSettling(seen: boolean, changedAt: string | null, nowMs: number): boolean {
  if (!seen) return true;
  if (changedAt === null) return false;
  const changedMs = Date.parse(changedAt);
  return !Number.isNaN(changedMs) && nowMs - changedMs < OFFICIAL_DATA_SETTLE_MS;
}

/** Which of TBA's two official endpoints the tick should poll for an event in `phase`. */
export function endpointsToPoll(phase: EventPhase, state: LiveIngestState, nowMs: number): EndpointsToPoll {
  switch (phase) {
    case "no-schedule":
    case "schedule-posted":
      return { rankings: false, alliances: false };
    case "quals-in-progress":
      return { rankings: true, alliances: false };
    case "quals-complete":
    case "alliances-posted":
      return { rankings: true, alliances: true };
    case "playoffs-in-progress":
      return { rankings: stillSettling(state.rankingsSeen, state.rankingsChangedAt, nowMs), alliances: true };
    case "complete":
      return {
        rankings: stillSettling(state.rankingsSeen, state.rankingsChangedAt, nowMs),
        alliances: stillSettling(state.alliancesSeen, state.alliancesChangedAt, nowMs),
      };
  }
}
