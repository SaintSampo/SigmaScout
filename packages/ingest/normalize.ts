/**
 * Convert a validated TBA event/match into a corpus row (D-05, DATA-02).
 *
 * - `score_breakdown` is stored verbatim as text; only totals, winner, and
 *   RP awards are normalized here (D-05). A missing breakdown stays
 *   `null`/`hasScoreBreakdown: false` — never coerced to a zero-valued
 *   breakdown (RESEARCH.md Anti-Patterns, Pitfall 4).
 * - `redRpEarned`/`blueRpEarned` read `score_breakdown.{color}.rp`
 *   directly, falling back to the legacy `tba_rpEarned` name — per
 *   docs/data/tba-field-recon.md, `rp` is present for every 2022-2026
 *   season sampled, so no season-specific derivation is needed here.
 * - `sortTime` follows RESEARCH.md Pattern 3's fallback chain:
 *   actual_time, then predicted_time, then time, then a deterministic
 *   composite of event start date + comp-level play order + match number.
 * - The `replayed` flag (Pitfall 1 — TBA exposes no such field) is computed
 *   by `detectReplay` below, a pure diff over score-bearing fields. It is
 *   invoked by `packages/corpus/db.ts`'s `upsertMatch`, the only place that
 *   can see the previously-stored row — wiring it there (not leaving it to
 *   each call site) means a caller cannot bypass the check by upserting
 *   directly.
 * - The `winnerImputed` flag (D-01, 01-REVIEW WR-06): a played, non-tied
 *   match whose TBA `winning_alliance` is empty (or some other non-red/blue
 *   value) is treated as a reporting gap rather than as a statement about
 *   the match — the winner is derived from the score comparison instead of
 *   being left `null`, which would otherwise silently drop the match from
 *   `selectMatchesChronological`'s `WHERE m.winner IS NOT NULL` clause. A
 *   TBA-reported `winning_alliance` is never overwritten or re-derived. The
 *   measured population of this case is 0 corpus-wide as of 2026-08-19, so
 *   this is a forward-looking guard rather than a repair.
 */
import type { CompLevel } from "../core/algorithms/types.js";
import type { TbaEvent, TbaMatch } from "./schemas.js";

export interface CorpusEvent {
  eventKey: string;
  year: number;
  eventType: number;
  isOffseason: boolean;
  startDate: string;
}

export interface CorpusMatch {
  matchKey: string;
  eventKey: string;
  compLevel: CompLevel;
  matchNumber: number;
  setNumber: number;
  sortTime: number;
  redTeams: string[];
  blueTeams: string[];
  redSurrogates: string[];
  blueSurrogates: string[];
  redDqs: string[];
  blueDqs: string[];
  winner: "red" | "blue" | "tie" | null;
  winnerImputed: boolean;
  redScore: number | null;
  blueScore: number | null;
  redRpEarned: number | null;
  blueRpEarned: number | null;
  hasScoreBreakdown: boolean;
  scoreBreakdownRaw: string | null;
}

const OFFSEASON_EVENT_TYPE = 99;
const COMP_LEVEL_PLAY_ORDER: Record<CompLevel, number> = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };

export function normalizeEvent(event: TbaEvent): CorpusEvent {
  return {
    eventKey: event.key,
    year: event.year,
    eventType: event.event_type,
    isOffseason: event.event_type === OFFSEASON_EVENT_TYPE,
    startDate: event.start_date,
  };
}

function matchSortTime(match: TbaMatch, eventStartDate: string): number {
  const t = match.actual_time ?? match.predicted_time ?? match.time;
  if (t != null) return t * 1000;
  const playOrder = COMP_LEVEL_PLAY_ORDER[match.comp_level];
  return Date.parse(eventStartDate) + playOrder * 1_000_000 + match.match_number * 1_000;
}

function isPlayed(match: TbaMatch): boolean {
  const { red, blue } = match.alliances;
  return red.score != null && red.score >= 0 && blue.score != null && blue.score >= 0;
}

function extractRp(breakdown: unknown, color: "red" | "blue"): number | null {
  if (typeof breakdown !== "object" || breakdown === null) return null;
  const colorBreakdown = (breakdown as Record<string, unknown>)[color];
  if (typeof colorBreakdown !== "object" || colorBreakdown === null) return null;
  const fields = colorBreakdown as Record<string, unknown>;
  const rp = fields["rp"] ?? fields["tba_rpEarned"];
  return typeof rp === "number" ? rp : null;
}

export function normalizeMatch(match: TbaMatch, eventStartDate: string): CorpusMatch {
  const played = isPlayed(match);
  const redScore = played ? match.alliances.red.score : null;
  const blueScore = played ? match.alliances.blue.score : null;

  let winner: "red" | "blue" | "tie" | null = null;
  let winnerImputed = false;
  if (played) {
    if (match.winning_alliance === "red" || match.winning_alliance === "blue") {
      winner = match.winning_alliance;
    } else if (redScore === blueScore) {
      winner = "tie";
    } else {
      // TBA's `winning_alliance` is empty (or some other non-red/blue
      // value) on a played, non-tied match. D-01/01-REVIEW WR-06: derive
      // the winner from the score comparison rather than leaving it null.
      winner = redScore! > blueScore! ? "red" : "blue";
      winnerImputed = true;
    }
  }

  const hasScoreBreakdown = match.score_breakdown != null;
  const redRpEarned = hasScoreBreakdown ? extractRp(match.score_breakdown, "red") : null;
  const blueRpEarned = hasScoreBreakdown ? extractRp(match.score_breakdown, "blue") : null;

  return {
    matchKey: match.key,
    eventKey: match.event_key,
    compLevel: match.comp_level,
    matchNumber: match.match_number,
    setNumber: match.set_number,
    sortTime: matchSortTime(match, eventStartDate),
    redTeams: match.alliances.red.team_keys,
    blueTeams: match.alliances.blue.team_keys,
    redSurrogates: match.alliances.red.surrogate_team_keys,
    blueSurrogates: match.alliances.blue.surrogate_team_keys,
    redDqs: match.alliances.red.dq_team_keys,
    blueDqs: match.alliances.blue.dq_team_keys,
    winner,
    winnerImputed,
    redScore,
    blueScore,
    redRpEarned,
    blueRpEarned,
    hasScoreBreakdown,
    scoreBreakdownRaw: hasScoreBreakdown ? JSON.stringify(match.score_breakdown) : null,
  };
}

/** The score-bearing fields of a previously-stored match row — the shape `detectReplay` diffs against. */
export interface ExistingMatchScoreFields {
  winner: "red" | "blue" | "tie" | null;
  redScore: number | null;
  blueScore: number | null;
  scoreBreakdownRaw: string | null;
  replayed: boolean;
  replayDetectedAt: string | null;
}

/** The score-bearing fields of an incoming (about to be upserted) match. */
export interface IncomingMatchScoreFields {
  winner: "red" | "blue" | "tie" | null;
  redScore: number | null;
  blueScore: number | null;
  scoreBreakdownRaw: string | null;
}

export interface ReplayDetectionResult {
  replayed: boolean;
  replayDetectedAt: string | null;
}

/**
 * TBA exposes no "this match was replayed" field (RESEARCH.md Pitfall 1),
 * so D-08's flag is synthesized here by diffing an incoming upsert against
 * the row already stored for that match key.
 *
 * A replay is detected only when the *previously stored* row was already
 * complete (had a winner) AND the incoming winner/scores/raw breakdown
 * differ from it. First-time scoring of a previously-incomplete match is
 * never a replay. Once detected, the flag and its timestamp are sticky: a
 * later unrelated upsert that doesn't itself change anything leaves both
 * unchanged rather than clearing them.
 */
export function detectReplay(
  existing: ExistingMatchScoreFields | undefined,
  incoming: IncomingMatchScoreFields,
  now: string
): ReplayDetectionResult {
  if (existing === undefined) {
    return { replayed: false, replayDetectedAt: null };
  }

  const wasComplete = existing.winner !== null;
  const scoreBearingFieldsChanged =
    existing.winner !== incoming.winner ||
    existing.redScore !== incoming.redScore ||
    existing.blueScore !== incoming.blueScore ||
    existing.scoreBreakdownRaw !== incoming.scoreBreakdownRaw;

  const isNewReplay = wasComplete && incoming.winner !== null && scoreBearingFieldsChanged;
  if (isNewReplay) {
    return { replayed: true, replayDetectedAt: now };
  }

  // Sticky: this upsert didn't itself trigger a new replay, so carry
  // forward whatever was already recorded (false/null if none ever was).
  return { replayed: existing.replayed, replayDetectedAt: existing.replayDetectedAt };
}
