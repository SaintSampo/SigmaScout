/**
 * Converts a carried EPA rating from the outgoing season's point units to the
 * incoming season's. `carryover.ts`'s `epaCarryover` keeps one {mean, sd} for
 * both directions of its own round trip, so a team still crosses a boundary
 * expressed in last season's points; this module's arithmetic corrects that,
 * applied lazily per team on first sight by `epa.ts` (`carrySeason`/`predict`/
 * `update`).
 *
 * A walk-forward replay cannot know the incoming season's scale in advance —
 * it is estimated from the incoming season's own folded alliance scores once
 * `EPA_CARRY_RESCALE_MIN_OBS` of them exist. A team first seen before that
 * threshold forfeits its rescale permanently; that forfeit is the honest cost
 * of walk-forward legality, not parity with Statbotics' offline conversion.
 */

/**
 * Observations of prior-season seed `epa.carrySeason` leaves in
 * `allianceScoreStats` at a season boundary (`reseedFromPrior`). About one
 * event's worth: enough that a season's opening matches inherit a sane scale
 * rather than falling back to `EPA_FALLBACK_SCORE_SD`, small enough that the
 * season's own data takes over well inside week 1. FRC's point scale is not
 * stationary across seasons, so an unbounded pooled scale reads far too flat.
 *
 * Re-exported from `epa.ts` for import compatibility; lives here because
 * `cleanSeasonMean` below unwinds exactly this seed. `epa.ts` imports from
 * this module, never the reverse.
 */
export const EPA_SCORE_SD_SEED_COUNT = 50;

/**
 * Minimum of a new season's own alliance scores folded before a carried
 * rating is rescaled off them; below this a team is materialized at
 * `ratio = 1` (forfeit) rather than rescaled by a noisy ratio from a handful
 * of events. About 125 matches, several times the `EPA_SCORE_SD_SEED_COUNT`
 * seed this module unwinds.
 *
 * Selected by a pre-registered ablation over candidates {100, 250, 500}
 * (pooled onset Brier vs the 100 incumbent, guarded on accuracy and
 * season-level Brier); selected on the same seasons it was measured on, with
 * no held-out confirmation. Full method and result:
 * `data/diagnostics/epa-deviation-ablation.json`'s `notes.thresholdSelection`.
 */
export const EPA_CARRY_RESCALE_MIN_OBS = 250;

/**
 * Recovers the mean of alliance scores a season has actually folded, by
 * unwinding the prior-season seed `reseedFromPrior` left in the accumulator:
 * `cleanMean = (mean * count - seedMean * seedCount) / (count - seedCount)`.
 *
 * Returns `null` — never `NaN` — when there are fewer than `minRealObs` real
 * folds, no seed to unwind (`count <= seedCount`), or a non-finite input.
 */
export function cleanSeasonMean(
  stats: { readonly count: number; readonly mean: number },
  seedMean: number,
  seedCount: number = EPA_SCORE_SD_SEED_COUNT,
  minRealObs: number = EPA_CARRY_RESCALE_MIN_OBS
): number | null {
  if (!Number.isFinite(seedMean) || !Number.isFinite(stats.mean) || !Number.isFinite(stats.count)) return null;
  const realCount = stats.count - seedCount;
  if (realCount < minRealObs || realCount <= 0) return null;
  const mean = (stats.mean * stats.count - seedMean * seedCount) / realCount;
  return Number.isFinite(mean) ? mean : null;
}

/**
 * Per-team rescale factor: how many of this season's points one of last
 * season's points is worth. Returns `{ ratio: 1, deferred: true }` whenever
 * the ratio cannot be trusted — an unmeasurable clean mean, or a non-finite
 * or non-positive seed/clean mean. `deferred` is counted and reported, never
 * silently folded into "rescaled".
 *
 * The numerator (`epa.ts`'s frozen week-1 mean vs `cleanSeasonMean`'s live
 * unwind) is chosen by the caller; this function stays blind to which one it
 * got.
 */
export function carryRescaleRatio(
  cleanSeasonMeanValue: number | null,
  seedMean: number
): { ratio: number; deferred: boolean } {
  if (cleanSeasonMeanValue === null) return { ratio: 1, deferred: true };
  if (!Number.isFinite(seedMean) || seedMean <= 0) return { ratio: 1, deferred: true };
  if (!Number.isFinite(cleanSeasonMeanValue) || cleanSeasonMeanValue <= 0) return { ratio: 1, deferred: true };
  const ratio = cleanSeasonMeanValue / seedMean;
  if (!Number.isFinite(ratio) || ratio <= 0) return { ratio: 1, deferred: true };
  return { ratio, deferred: false };
}

/**
 * Multiplies every component of one team's record by `ratio`. A pinned-zero
 * component (EPA's `adjust`) stays zero, which is correct and pinned by a
 * test.
 */
export function rescaleComponents(
  components: Readonly<Record<string, number>>,
  ratio: number
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(components)) out[name] = value * ratio;
  return out;
}

/**
 * Applies `ratio` to every team in `teams` that is still `pending`, returning
 * a new map and the list of teams touched. Never mutates its input, never
 * rescales a team twice, and leaves untouched entries as the same object
 * reference.
 */
export function materializePendingTeams(
  teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>,
  teams: readonly string[],
  pending: ReadonlySet<string>,
  ratio: number
): { teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>; touched: string[] } {
  const touched: string[] = [];
  for (const team of teams) {
    if (!pending.has(team)) continue;
    if (!teamComponents.has(team)) continue;
    touched.push(team);
  }
  if (touched.length === 0) return { teamComponents, touched };
  const next = new Map(teamComponents);
  for (const team of touched) next.set(team, rescaleComponents(next.get(team)!, ratio));
  return { teamComponents: next, touched };
}
