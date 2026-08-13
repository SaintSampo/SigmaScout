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
 * - The `replayed` flag (Pitfall 1 — TBA exposes no such field) is NOT set
 *   here; it is derived by `packages/corpus/db.ts`'s diff-on-upsert, which
 *   is the only place that can see the previously-stored row.
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
  if (played) {
    if (match.winning_alliance === "red" || match.winning_alliance === "blue") {
      winner = match.winning_alliance;
    } else if (redScore === blueScore) {
      winner = "tie";
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
    redScore,
    blueScore,
    redRpEarned,
    blueRpEarned,
    hasScoreBreakdown,
    scoreBreakdownRaw: hasScoreBreakdown ? JSON.stringify(match.score_breakdown) : null,
  };
}
