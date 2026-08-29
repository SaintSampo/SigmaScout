/**
 * Off-season Demo Team exclusion (`.planning/todos/pending/exclude-offseason-demo-teams.md`,
 * developer-directed 2026-08-29). TBA publishes 30 synthetic team keys,
 * `frc9970`-`frc9999`, every one named `Off-Season Demo Team {n}` — not real
 * teams, but real ROBOTS: a practice bot, a borrowed machine, or an
 * unregistered entry that genuinely occupied an alliance slot and genuinely
 * contributed to that alliance's observed score. That distinction is why
 * this module exports two different predicates rather than one blunt
 * "is this team real" filter:
 *
 *   - `isFullyDemoAlliance` (case 1, 428 alliances): every slot on the
 *     alliance is a demo team — a forfeit/no-show playoff bucket, or an
 *     offseason bracket bye. A real alliance "beating" three placeholders is
 *     not evidence of anything, so callers drop the WHOLE MATCH from rating
 *     updates when either alliance is fully demo (never just the demo side's
 *     own row) — see `update()` call sites in `opr.ts`/`epa.ts`/
 *     `sigma1/index.ts`.
 *   - `remapDemoTeams` (case 2, 7,684 mixed alliances): a demo robot filling
 *     ONE slot beside two real robots. The match IS real evidence about
 *     those two real teammates, and the demo robot's own contribution to the
 *     observed score is real — deleting its column while keeping the
 *     alliance's full observed score would force the remaining real
 *     teammates to silently absorb its share, systematically INFLATING
 *     every real team that ever shared an alliance with one (the mixed-case
 *     bug this module exists to avoid; see `ratingEligibleTeams` in
 *     `opr.ts`, the surrogate precedent that inflates in exactly this way
 *     and is NOT reused for demo teams for that reason). Instead, every demo
 *     key is remapped to ONE shared pseudo-entity column before it reaches
 *     any algorithm's design matrix / per-team state — this keeps the
 *     alliance arithmetic balanced (the real teammates' share is computed
 *     exactly as if a normal third teammate occupied that slot) while
 *     refusing to pretend 30 distinct fictional teams have 30 distinct
 *     learnable skills. `DEMO_PSEUDO_TEAM_KEY` is NEVER published — no team
 *     page, no teams-list row, no search hit, no ranking (`publish.ts`
 *     filters `isDemoTeamKey` out of every team list before any page is
 *     built; the pseudo key itself never reaches `teamsThisSeason` because
 *     it is never a corpus-sourced key — it only exists inside an
 *     algorithm's OWN internal state).
 *
 * A single alliance can carry TWO demo teammates beside one real teammate
 * (measured directly against `data/corpus.sqlite`: 715 red + 725 blue
 * alliance-rows carry exactly 2 of 3 slots as demo teams — not a rare edge
 * case). `remapDemoTeams` deliberately does NOT deduplicate in that case —
 * the returned array keeps the pseudo key's slot count intact (e.g.
 * `[real1, pseudo, pseudo]`, length 3, matching the original 3-slot
 * alliance). Each algorithm's existing per-team iteration then treats this
 * exactly like two independent teammates that happen to share one identity:
 * OPR's design-matrix column accumulates to 2 (`solveEventOpr` increments
 * rather than overwrites, fixed alongside this module), and EPA's/Sigma1's
 * per-teammate loops divide the observed share by the TRUE slot count
 * (`teams.length`, unchanged by the remap) and apply their own per-team
 * update twice to the same shared state entry. Deduplicating the array to a
 * single pseudo slot instead would shrink the apparent alliance size and
 * reproduce the exact "fewer columns, same total score" inflation bug this
 * module exists to avoid — so it is deliberately NOT done. The one accepted
 * imprecision is that the pseudo entity's OWN learned rating becomes an
 * average across a varying number of simultaneous occurrences — irrelevant,
 * since that identity is never published or queried.
 */

/** Inclusive numeric bounds of TBA's "Off-Season Demo Team" block. */
const DEMO_TEAM_NUMBER_MIN = 9970;
const DEMO_TEAM_NUMBER_MAX = 9999;

/** Every demo team key, `frc9970`-`frc9999` (30 keys), for iteration/testing. */
export const DEMO_TEAM_KEYS: ReadonlySet<string> = new Set(
  Array.from(
    { length: DEMO_TEAM_NUMBER_MAX - DEMO_TEAM_NUMBER_MIN + 1 },
    (_, i) => `frc${DEMO_TEAM_NUMBER_MIN + i}`
  )
);

/**
 * The shared identity every demo key collapses to inside an algorithm's
 * internal state. Deliberately NOT of the form `frc\d+` — nothing downstream
 * that pattern-matches a real team key (there is no such strict validator in
 * this codebase today, but this is future-proofing stated explicitly) could
 * mistake it for a real team. Never published — see this file's header.
 */
export const DEMO_PSEUDO_TEAM_KEY = "demo-pseudo-unregistered";

/** True for exactly the 30 keys in `DEMO_TEAM_KEYS`. */
export function isDemoTeamKey(teamKey: string): boolean {
  return DEMO_TEAM_KEYS.has(teamKey);
}

/**
 * Maps every demo key in `teams` to `DEMO_PSEUDO_TEAM_KEY`, leaving every
 * other key untouched, preserving array length and order (see this file's
 * header for why duplicate pseudo entries are kept, not deduplicated).
 * A no-op for an array with no demo teams — every real-team-only match
 * (the overwhelming majority of the corpus) allocates no new identity.
 */
export function remapDemoTeams(teams: readonly string[]): string[] {
  return teams.map((team) => (isDemoTeamKey(team) ? DEMO_PSEUDO_TEAM_KEY : team));
}

/**
 * Case 1: true only when EVERY listed team is a demo team — an alliance with
 * no real robots on it at all. An empty array returns `false` (vacuous
 * truth deliberately avoided): callers use this to decide whether a MATCH
 * carries real information, and a genuinely empty alliance is a data
 * anomaly, not a "fully demo" alliance.
 */
export function isFullyDemoAlliance(teams: readonly string[]): boolean {
  return teams.length > 0 && teams.every(isDemoTeamKey);
}
