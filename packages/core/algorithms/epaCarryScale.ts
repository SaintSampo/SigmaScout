/**
 * The season-boundary SCALE ANCHOR: the pure arithmetic that converts a carried
 * EPA rating out of the OUTGOING season's point units and into the INCOMING
 * season's.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS AT ALL
 * ---------------------------------------------------------------------------
 *
 * `carryover.ts`'s `epaCarryover` derives ONE `{mean, sd}` pair from the
 * outgoing season's per-team point totals and uses it for BOTH directions of
 * the normalized<->points conversion. That keeps its own round trip
 * self-consistent, which is why it is left exactly as it is — but it means a
 * team crosses a boundary still expressed in LAST season's points. The
 * project's own verbatim reading of Statbotics' `init.py`
 * (`02-CONTEXT.md` D-16, `02-RESEARCH.md`) specifies conversion into the NEW
 * season's units, so that was a port defect against our own recorded reference.
 *
 * The correction is applied LAZILY, per team, on first sight in the new season,
 * by `epa.ts` — see `epa.carrySeason`/`predict`/`update`. This module owns only
 * the arithmetic, and owns it ONCE: `scripts/measureEpaDeviations.ts` measured
 * the fix with these exact functions and now IMPORTS them from here rather than
 * keeping a second copy. Two copies of a scale conversion drifting apart is the
 * failure `REBUILD_SPEC.md`'s log records and `carryover.ts`'s own
 * `populationMeanSd` comment already names.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 * ---------------------------------------------------------------------------
 *
 * It is NOT parity with Statbotics. Statbotics runs offline and simply KNOWS a
 * season's scale before it converts anything. A walk-forward replay cannot: at
 * the instant a boundary is crossed the incoming season has been observed zero
 * times. So the incoming scale is ESTIMATED from the incoming season's own
 * folded alliance scores, and only once at least `EPA_CARRY_RESCALE_MIN_OBS` of
 * them exist. A team first seen before that threshold FORFEITS its rescale
 * permanently (see `epa.ts`'s `update`). That forfeit is the measured, reported
 * cost of being walk-forward-legal, and it is why this is described as the
 * closest walk-forward-legal APPROXIMATION rather than as a match.
 */

/**
 * Strength, in observations, of the prior-season seed `epa.carrySeason` leaves
 * in `allianceScoreStats` at a season boundary (`reseedFromPrior`).
 *
 * Quick task 260910-4x0: this used to be unbounded. `carrySeason` handed the
 * whole accumulator across the boundary — observation count included — so the
 * win-probability denominator pooled every alliance score the replay had ever
 * seen. Across 2016-2024 that is 282,192 observations against a season's own
 * ~44,000, and FRC's point scale is not remotely stationary across seasons
 * (2018 alliances averaged 292 points, 2019 averaged 55). 2024 read a pooled
 * SD of 106.4 where its own was 27.2 — a ~3.9x too-flat logistic, measured at
 * 0.2204 Brier against 0.1764 for the same replay scored with a per-season
 * scale.
 *
 * 50 is about one event's worth of alliance scores: enough that a season's
 * opening matches inherit a sane scale instead of falling back to
 * `EPA_FALLBACK_SCORE_SD` (25 suits 2024's 27.2 but not 2026's 144.6), and
 * small enough that the season's own data has taken over well inside week 1.
 * Deliberately NOT zero (a hard reset) and deliberately NOT unbounded (the
 * defect this replaces).
 *
 * MOVED HERE from `epa.ts` by quick task 260911-3kc, and still re-exported from
 * `epa.ts` so every existing import path is unchanged. It lives here because
 * `cleanSeasonMean` below UNWINDS exactly this seed: the two numbers are one
 * fact and a reader who changes one must see the other. The direction is
 * load-bearing — `epa.ts` imports from this module, never the reverse, so there
 * is no import cycle of the kind `carryover.ts`'s header warns about.
 */
export const EPA_SCORE_SD_SEED_COUNT = 50;

/**
 * How many of a new season's OWN alliance scores must have been folded before
 * a carried rating is rescaled off them.
 *
 * Below this the season mean is an estimate from a handful of events that could
 * easily be a single unusually high- or low-scoring regional, and multiplying
 * every component of a carried team by a noisy ratio is worse than not
 * rescaling at all. A team first seen inside this window is materialized at
 * `ratio = 1` and its rescale is FORFEIT — the honest, reported cost of being
 * walk-forward-legal, and the single thing that separates this from the offline
 * rescale Statbotics can simply do.
 *
 * 250 alliance scores is about 125 matches — roughly two or three events'
 * qualification rounds, and several times the `EPA_SCORE_SD_SEED_COUNT` (50)
 * seed this module unwinds.
 *
 * MEASURED, NOT ASSUMED, AND NOT INDEPENDENTLY CONFIRMED (quick task
 * 260911-3kc). The value was selected from a three-value candidate set
 * `{100, 250, 500}` by a rule written down, printed and serialized BEFORE the
 * corpus was opened: PRIMARY = pooled onset Brier measured against the
 * incumbent `100` arm with a 95% interval excluding zero; GUARD 1 = reject if
 * pooled-season winner accuracy is definitively worse; GUARD 2 = reject if
 * pooled-season Brier is definitively worse; TIE-BREAK = take the smaller
 * threshold; DEFAULT = keep `100` if nothing clears the bar.
 *
 * BOTH challengers passed, so `250` won on the tie-break: pooled onset Brier
 * -0.00203 [-0.00339, -0.00068] against the `100` incumbent, accuracy
 * indistinguishable, pooled-season Brier -0.00007 [-0.00013, -0.00001].
 *
 * STATE THE HONEST LIMIT WHEREVER THIS NUMBER IS QUOTED: that margin over the
 * plain `100` fix was selected on THE SAME NINE SEASONS it was measured on,
 * with no held-out confirmation. The carryover FIX itself is independently
 * evidenced (pooled +0.01059 accuracy, -0.00521 Brier against un-fixed EPA);
 * the extra 150 observations of deferral are not. Full candidates, rule,
 * selected value and the clause that produced it:
 * `data/diagnostics/epa-deviation-ablation.json`'s `notes.thresholdSelection`.
 */
export const EPA_CARRY_RESCALE_MIN_OBS = 250;

/**
 * Recovers the arithmetic mean of the alliance scores a season has actually
 * folded, by unwinding the prior-season seed `carrySeason` left in the
 * accumulator.
 *
 * After `reseedFromPrior(stats, EPA_SCORE_SD_SEED_COUNT)` the accumulator holds
 * exactly `seedCount` pseudo-observations at `seedMean`; every later fold is the
 * new season's own. So
 *
 *     cleanMean = (mean * count - seedMean * seedCount) / (count - seedCount)
 *
 * Returns `null` — never a number — whenever the answer is not yet legible:
 * fewer than `minRealObs` real folds, no seed to unwind (`count <= seedCount`,
 * which happens when `reseedFromPrior` declined below 2 observations), or a
 * non-finite input. A `null` is a signal the caller must handle; a `NaN` is one
 * it would formats away.
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
 * The per-team rescale factor: how many of THIS season's points one of LAST
 * season's points is worth.
 *
 * Returns `{ ratio: 1, deferred: true }` for every case where the ratio cannot
 * be trusted — a not-yet-measurable clean mean, a zero or non-finite seed mean
 * (dividing by it would be infinite), or a non-positive clean mean (which cannot
 * be a point scale and whose ratio would flip the sign of every carried
 * rating). `deferred` is counted and reported; it is never silently folded into
 * "we rescaled".
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
 * component (EPA pins `adjust` at exactly 0, D-5) stays at zero for free —
 * `0 * ratio === 0` — which is the correct behaviour and is pinned by a test so
 * a future "improvement" cannot seed it.
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
 * Applies `ratio` to every team in `teams` that is still `pending`, returning a
 * NEW map and the list of teams actually touched.
 *
 * Never mutates its input, never rescales a team outside `pending` (that team
 * has already been corrected, and a second pass would square the ratio), and
 * leaves every untouched entry as the SAME object reference, so a caller can
 * tell by identity that nothing was rebuilt behind its back.
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
