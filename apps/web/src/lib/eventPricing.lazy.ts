/**
 * THE LAZY PRICER CHUNK (260915-m4j). Loaded only by `eventPricing.ts`'s
 * dynamic import, never statically (`eventPricing.bundleGuard.test.ts`), so
 * the pricer, the RP moment, mean-shift and analytic pmf code and the
 * per-season rule modules download only for an event that has a block.
 *
 * Ratings stay precomputed: this evaluates the forecast from the artifact's
 * `state` block with the very functions the offline publisher uses
 * (`priceUpcomingFromState`, parity-tested against `buildEventArtifact`).
 *
 * LD-1, unseen teams follow the offline rule, which already lives inside
 * `priceUpcomingFromState` (no band for that alliance, no RP for the match).
 * Nothing here prices from a prior.
 */
import { priceUpcomingFromState, EventStateBlockError, type ScheduledMatchInput } from "../../../../packages/harness/eventStatePricing.js";
import { loadRpRuleModule } from "../../../../packages/core/rankingPoints/rulesLoader.js";
import { isDemoTeamKey } from "../../../../packages/core/algorithms/demoTeams.js";
import type { LiveEventArtifact, TeamSeasonMatch } from "../../../../packages/harness/pageArtifacts.js";
import { isPricedUpcomingRow, type EventPageArtifact } from "./eventPricing.js";

export interface PricedArtifactUpcoming {
  readonly upcoming: EventPageArtifact["upcoming"];
  readonly upcomingTeamRows: Readonly<Record<string, TeamSeasonMatch>>;
}

/**
 * Prices every upcoming row of `artifact` from its `state` block. Throws what
 * the pricer throws (`EventStateBlockError`, `RpRuleModuleSeasonMismatchError`);
 * the caller turns any throw into the unpriced fallback.
 *
 * DEMO FALLBACK. The pricer cannot price a demo robot's band or RP (its raw-key
 * beliefs never ride the block; see the parity test's KNOWN GAP), while the
 * offline publisher can. So a row whose roster holds a demo key AND that
 * already carries published prices keeps the published row, and gets no team
 * row. A Worker-maintained schedule-only demo row has no published fields to
 * fall back to, so it takes the pricer's output: win odds and scores, with no
 * band on the demo alliance and no RP.
 */
export async function priceArtifactUpcoming(artifact: LiveEventArtifact): Promise<PricedArtifactUpcoming> {
  const { state, eventType } = artifact;
  if (state === undefined) throw new EventStateBlockError("the artifact carries no state block");
  if (eventType === undefined) throw new EventStateBlockError("the artifact carries no eventType");

  const ruleModule = await loadRpRuleModule(artifact.season);
  // Schedule fields only: the pricer never sees a published prediction field.
  const scheduled: ScheduledMatchInput[] = artifact.upcoming.map((row) => ({
    matchKey: row.matchKey,
    compLevel: row.compLevel,
    setNumber: row.setNumber,
    matchNumber: row.matchNumber,
    ...(row.sortTime !== undefined ? { sortTime: row.sortTime } : {}),
    redTeams: row.redTeams,
    blueTeams: row.blueTeams,
  }));

  const priced = priceUpcomingFromState({ state, eventKey: artifact.eventKey, season: artifact.season, eventType, ruleModule, upcoming: scheduled });

  const upcoming: EventPageArtifact["upcoming"] = [];
  const upcomingTeamRows: Record<string, TeamSeasonMatch> = {};
  artifact.upcoming.forEach((row, i) => {
    const hasDemoRobot = row.redTeams.some(isDemoTeamKey) || row.blueTeams.some(isDemoTeamKey);
    if (hasDemoRobot && isPricedUpcomingRow(row)) {
      upcoming.push(row);
      return;
    }
    upcoming.push(priced.event[i]!);
    upcomingTeamRows[row.matchKey] = priced.team[i]!;
  });
  return { upcoming, upcomingTeamRows };
}
