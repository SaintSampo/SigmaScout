/**
 * TBA's OWN rankings and alliances, merged into a live event artifact (quick task
 * 261004-uyc), and the predicate that says an artifact's standings are TBA's.
 *
 * WHY THIS IS A SMALL MIRROR AND NOT SHARED CODE. `rank`, `record` and `rp` are
 * built for the offline publisher by `eventTeamRankingFields` in
 * `packages/harness/publish.ts`, a Node module that reaches `better-sqlite3`, so
 * the Worker cannot import it. The alliances mapper in `buildEventArtifact` is
 * mirrored the same way, by `applyOfficialAlliances`. Extracting the rule into a Worker safe module the
 * publisher also imports is the right end state; it was not done here because
 * that file is under concurrent edit by another session. What holds the two
 * copies together instead is `officialStandings.test.ts`, which builds an artifact
 * through the exported `buildEventArtifact` from the same rankings and asserts
 * the rank, record and rp of every row are identical. `artifactMerge.ts` already
 * keeps a copy of `findRpOutcomeRp` on the same terms.
 *
 * THE MARKER RULE. A counted standing carries `standings: { source:
 * "tick-counted" }` (`liveStandings.ts`); TBA's own never does. So an artifact
 * that holds ranks and no marker holds TBA's ranks, and `hasOfficialStandings`
 * is exactly that statement. `applyOfficialRankings` drops the marker, and
 * `mergeEventArtifact` refuses to count over an artifact for which
 * `hasOfficialStandings` is true, so a later fold never replaces TBA's order with
 * a counted one.
 *
 * Pure: no I/O and no clock. Worker safe: types and the rounding rule only.
 */
import type { EventArtifact } from "../../../packages/harness/pageArtifacts.js";
import { ROUNDING_RULE, roundTo } from "../../../packages/harness/rounding.js";
import { parseAllianceRecord, type NormalizedEventAlliance } from "../../../packages/ingest/alliances.js";
import type { NormalizedEventRanking } from "../../../packages/ingest/rankings.js";

/**
 * `artifact` with TBA's rank, record and Ranking Score on every team row TBA
 * ranks, and none on a row it does not (a count an earlier tick wrote included).
 * `rank` is always written; `record` is TBA's own three integers; `rp` is the
 * Ranking Score rounded at `ROUNDING_RULE.rankingPoints` and omitted when TBA
 * reported none (a real `0` survives). A team TBA ranks with no `teams` row is
 * NOT appended: it has no identity or metrics here, and the roster pass owns
 * appending. Row order, every other key and every metrics entry are untouched,
 * and the `standings` marker is dropped because these standings are not counted.
 */
export function applyOfficialRankings(artifact: EventArtifact, rankings: readonly NormalizedEventRanking[]): EventArtifact {
  const byTeamKey = new Map(rankings.map((ranking) => [ranking.teamKey, ranking]));
  const { standings: _countedMarker, ...withoutMarker } = artifact;
  const teams = artifact.teams.map((row) => {
    const { rank: _rank, record: _record, rp: _rp, ...unranked } = row;
    const ranking = byTeamKey.get(row.teamKey);
    if (ranking === undefined) return unranked;
    return {
      ...unranked,
      rank: ranking.rank,
      record: { wins: ranking.recordWins, losses: ranking.recordLosses, ties: ranking.recordTies },
      ...(ranking.rankingScore !== null ? { rp: roundTo(ranking.rankingScore, ROUNDING_RULE.rankingPoints) } : {}),
    };
  });
  return { ...withoutMarker, teams };
}

/** True when the artifact exists, carries no `standings` marker, and at least one team row has a `rank`: TBA's own standings, never to be counted over. */
export function hasOfficialStandings(existing: EventArtifact | undefined): boolean {
  if (existing === undefined) return false;
  if (existing.standings !== undefined) return false;
  return existing.teams.some((row) => row.rank !== undefined);
}

/**
 * `artifact` with TBA's playoff alliance selection on its `alliances` key, one
 * entry per normalized alliance, by the offline publisher's rule: `allianceNumber`
 * as TBA's seed order, `name` only when non empty (an absent key, never `""` or a
 * made up label), `picks` copied in TBA's order and never truncated (a fourth
 * entry is the reserve robot), `record` only when TBA's status carries a well
 * formed one (`parseAllianceRecord`, never a fabricated zero record).
 *
 * An empty list writes an EMPTY `alliances` array: the key's presence, not its
 * length, says the selection was consulted, and `[]` is a real "no selection"
 * answer. Every other key is untouched.
 */
export function applyOfficialAlliances(artifact: EventArtifact, alliances: readonly NormalizedEventAlliance[]): EventArtifact {
  return {
    ...artifact,
    alliances: alliances.map((alliance) => {
      const record = alliance.statusRaw === null ? null : parseAllianceRecord(alliance.statusRaw);
      return {
        allianceNumber: alliance.allianceNumber,
        ...(alliance.name !== null && alliance.name.length > 0 ? { name: alliance.name } : {}),
        picks: [...alliance.picks],
        ...(record !== null ? { record } : {}),
      };
    }),
  };
}
