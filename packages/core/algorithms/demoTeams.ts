/**
 * Off-season Demo Team exclusion. TBA publishes 30 synthetic team keys,
 * `frc9970`-`frc9999`, every one named `Off-Season Demo Team {n}` — not
 * real teams, but real robots: a practice bot, a borrowed machine, or an
 * unregistered entry that genuinely occupied an alliance slot and
 * genuinely contributed to that alliance's observed score. That
 * distinction is why this module exports two different predicates rather
 * than one blunt "is this team real" filter:
 *
 *   - `isFullyDemoAlliance`: every slot on the alliance is a demo team — a
 *     forfeit/no-show playoff bucket, or an offseason bracket bye. A real
 *     alliance "beating" three placeholders is not evidence of anything,
 *     so callers drop the whole match from rating updates when either
 *     alliance is fully demo — see `update()` call sites in
 *     `opr.ts`/`epa.ts`/`spr.ts`.
 *   - `remapDemoTeams`: a demo robot filling one slot beside two real
 *     robots. The match is real evidence about those two real teammates,
 *     and the demo robot's own contribution to the observed score is real
 *     — deleting its column while keeping the alliance's full observed
 *     score would force the remaining real teammates to silently absorb
 *     its share, systematically inflating every real team that ever
 *     shared an alliance with one. Instead, every demo key is remapped to
 *     one shared pseudo-entity column before it reaches any algorithm's
 *     design matrix / per-team state — this keeps the alliance arithmetic
 *     balanced while refusing to pretend 30 distinct fictional teams have
 *     30 distinct learnable skills. `DEMO_PSEUDO_TEAM_KEY` is never
 *     published: `publish.ts` filters `isDemoTeamKey` out of every team
 *     list before any page is built, and the pseudo key itself is never a
 *     corpus-sourced key — it only exists inside an algorithm's own
 *     internal state.
 *
 * A single alliance can carry two demo teammates beside one real teammate,
 * not a rare edge case. `remapDemoTeams` deliberately does not deduplicate
 * in that case — the returned array keeps the pseudo key's slot count
 * intact (e.g. `[real1, pseudo, pseudo]`). Each algorithm's existing
 * per-team iteration then treats this exactly like two independent
 * teammates that happen to share one identity: OPR's design-matrix column
 * accumulates to 2, and EPA's per-teammate loop divides the observed share
 * by the true slot count and applies its own per-team update twice to the
 * same shared state entry. Deduplicating to a single pseudo slot instead
 * would shrink the apparent alliance size and reproduce the exact
 * "fewer columns, same total score" inflation bug this module exists to
 * avoid. The one accepted imprecision is that the pseudo entity's own
 * learned rating becomes an average across a varying number of
 * simultaneous occurrences — irrelevant, since that identity is never
 * published or queried.
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
 * internal state. Deliberately not of the form `frc\d+` so nothing
 * downstream that pattern-matches a real team key could mistake it for
 * one. Never published — see this file's header.
 */
export const DEMO_PSEUDO_TEAM_KEY = "demo-pseudo-unregistered";

/**
 * A roster key TBA emits that names no team registration at all: no
 * number (`frc`), a zero number (`frc0`), or a character no team key can
 * hold (`frc58 /`). FRC team numbers start at 1, and a letter suffix
 * (`frc1678B`, a team's second robot) is a real key, so neither shape is
 * caught here. The played occurrences are all at offseason events after
 * their season's last official match; the rest are unplayed placeholders.
 *
 * `DEMO_PSEUDO_TEAM_KEY` is excluded explicitly: it is this module's own
 * internal identity, not something TBA sent.
 */
export function isPlaceholderTeamKey(teamKey: string): boolean {
  if (teamKey === DEMO_PSEUDO_TEAM_KEY || !teamKey.startsWith("frc")) return false;
  const rest = teamKey.slice(3);
  return /^0*$/.test(rest) || /[^0-9A-Za-z]/.test(rest);
}

/**
 * True for the 30 keys in `DEMO_TEAM_KEYS` and for every
 * `isPlaceholderTeamKey` key. A placeholder is handled exactly like a demo
 * robot everywhere this predicate is read: a fully-placeholder alliance is
 * a non-contest, a placeholder beside real teammates is an unidentified
 * robot remapped to the shared pseudo entity, and neither ever gets a
 * published page or a state row.
 */
export function isDemoTeamKey(teamKey: string): boolean {
  return DEMO_TEAM_KEYS.has(teamKey) || isPlaceholderTeamKey(teamKey);
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
