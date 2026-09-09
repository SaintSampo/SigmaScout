/**
 * Adversarial review 260908-vqr, angle B: does ANY BPR state depend on the
 * match currently being predicted?
 *
 * The existing test (packages/bpr/model.test.ts:55) flips one synthetic
 * match and compares PREDICTIONS only. That misses state that does not reach
 * pRedWin (the online point scale, the phase filters, scaleCount). This probe
 * closes the gap: it replays REAL corpus matches through the SHIPPED port
 * (packages/core/algorithms/bpr.ts), flips one match's score, and diffs the
 * ENTIRE serialized state after every step up to and including that match.
 *
 * Read-only.
 */
import Database from "better-sqlite3";
import { bpr } from "../../../../packages/core/algorithms/bpr.js";
import type { MatchResult, UpcomingMatch } from "../../../../packages/core/algorithms/types.js";

const db = new Database("data/corpus.sqlite", { readonly: true, fileMustExist: true });
const rows = db
  .prepare(
    `SELECT m.match_key, m.event_key, m.comp_level, m.match_number, m.set_number,
            m.red_teams, m.blue_teams, m.red_surrogates, m.blue_surrogates,
            m.red_dqs, m.blue_dqs, m.winner, m.red_score, m.blue_score,
            m.red_rp_earned, m.blue_rp_earned, m.has_score_breakdown,
            m.score_breakdown_raw, e.event_type, e.year
       FROM matches m JOIN events e ON e.event_key = m.event_key
      WHERE e.year = 2024 AND e.is_offseason = 0 AND m.winner IS NOT NULL
      ORDER BY m.sort_time ASC, m.event_key ASC,
        CASE m.comp_level WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2 WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5 END ASC,
        m.set_number ASC, m.match_number ASC
      LIMIT 4000`,
  )
  .all() as Array<Record<string, unknown>>;
db.close();

const toResult = (r: Record<string, unknown>): MatchResult => ({
  matchKey: r.match_key as string,
  eventKey: r.event_key as string,
  compLevel: r.comp_level as MatchResult["compLevel"],
  setNumber: r.set_number as number,
  matchNumber: r.match_number as number,
  redTeams: JSON.parse(r.red_teams as string) as string[],
  blueTeams: JSON.parse(r.blue_teams as string) as string[],
  redSurrogates: JSON.parse(r.red_surrogates as string) as string[],
  blueSurrogates: JSON.parse(r.blue_surrogates as string) as string[],
  redDqs: JSON.parse(r.red_dqs as string) as string[],
  blueDqs: JSON.parse(r.blue_dqs as string) as string[],
  winner: r.winner as "red" | "blue" | "tie",
  redScore: (r.red_score as number) ?? 0,
  blueScore: (r.blue_score as number) ?? 0,
  redRpEarned: r.red_rp_earned as number | null,
  blueRpEarned: r.blue_rp_earned as number | null,
  hasScoreBreakdown: r.has_score_breakdown === 1,
  scoreBreakdownRaw: r.score_breakdown_raw as string | null,
  eventType: r.event_type as number,
});

const toUpcoming = (m: MatchResult): UpcomingMatch => ({
  matchKey: m.matchKey,
  eventKey: m.eventKey,
  compLevel: m.compLevel,
  setNumber: m.setNumber,
  matchNumber: m.matchNumber,
  redTeams: m.redTeams,
  blueTeams: m.blueTeams,
  redSurrogates: m.redSurrogates,
  blueSurrogates: m.blueSurrogates,
  eventType: m.eventType,
});

const base = rows.map(toResult);
const FLIP = 2500;

/** Replays and records, per step, the prediction AND a full deterministic state digest. */
function replay(ms: MatchResult[]): { preds: number[]; states: string[] } {
  const teams = new Set<string>();
  for (const m of ms) for (const t of [...m.redTeams, ...m.blueTeams]) teams.add(t);
  let state = bpr.initState([...teams].sort());
  const preds: number[] = [];
  const states: string[] = [];
  for (const m of ms) {
    const p = bpr.predict(state, toUpcoming(m));
    preds.push(p.pRedWin);
    // Full state digest: every field, deterministically ordered.
    states.push(JSON.stringify(state, (_k, v) => (v instanceof Map ? [...v.entries()].sort() : v)));
    state = bpr.update(state, m);
  }
  return { preds, states };
}

const flipped = base.map((m, i) =>
  i === FLIP
    ? { ...m, redScore: 5, blueScore: 300, winner: "blue" as const, scoreBreakdownRaw: null }
    : m,
);

const A = replay(base);
const B = replay(flipped);

let firstPredDiff = -1;
let firstStateDiff = -1;
for (let i = 0; i < A.preds.length; i++) {
  if (firstPredDiff < 0 && A.preds[i] !== B.preds[i]) firstPredDiff = i;
  if (firstStateDiff < 0 && A.states[i] !== B.states[i]) firstStateDiff = i;
}

console.log(`replayed ${base.length} real 2024 matches through packages/core/algorithms/bpr.ts`);
console.log(`flipped match index ${FLIP} (${base[FLIP]!.matchKey}): red ${base[FLIP]!.redScore}-${base[FLIP]!.blueScore} -> 5-300`);
console.log(`first PREDICTION that differs: ${firstPredDiff}  (must be > ${FLIP})`);
console.log(`first FULL-STATE digest that differs: ${firstStateDiff}  (must be > ${FLIP})`);
console.log(
  firstPredDiff > FLIP && firstStateDiff > FLIP
    ? "PASS - no state at or before the flipped match depends on its result"
    : "FAIL - leakage detected",
);
