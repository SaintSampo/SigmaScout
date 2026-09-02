/**
 * The alliance-uncertainty identity, tested at the SAME walk-forward instant
 * (todo `publish-as-of-match-team-metrics`, resolved 2026-08-31 with **no new
 * published field**).
 *
 * 07-20's original e2e check compared an alliance's combined uncertainty
 * built from the AS-OF-EVENT per-team `metrics.total.spread` against the
 * match's own AS-OF-THAT-MATCH `redScoreVarianceOwn`/`blueScoreVarianceOwn`
 * — two quantities measured at DIFFERENT points in the walk-forward, which
 * is why 99/99 pairs exceeded tolerance with a first-half/second-half gap
 * signature (mean 1.130 → 0.373). The identity was never falsifiable from
 * those bytes.
 *
 * It IS falsifiable from currently-published bytes, because the team-season
 * artifact's `metricHistory` rows carry each metric AFTER each match
 * (`MetricHistoryRowSchema.metrics`' own doc comment), and a team's state
 * changes only when that team plays: its state immediately BEFORE match M is
 * exactly its metricHistory row for its own PREVIOUS match. No as-of-match
 * sibling field is needed — deliberately not published, since the event
 * artifact sits 2.17% under its 350,000-byte ceiling post-08-05 and this
 * join costs nothing.
 *
 * The identity itself is the one plan 07-06 pinned against `predict()`'s own
 * output (D-01/D-02): published per-team `total.spread` is `√(P_i + R_i)`,
 * and `redScoreVarianceOwn = Σ P_i + covarianceTotal` where the covariance
 * total carries each team's own component-covariance block — so
 * `Σ spread_i² == scoreVarianceOwn` up to publish-boundary rounding
 * (`ROUNDING_RULE.metric` = 2 decimals on spread, `ROUNDING_RULE.variance`
 * = 4 on the variance) and the per-team `minConsistencyVarianceRel` floor
 * (D-T1, `SIGMA1_CODE_VERSION` 4.0.0: that floor is now a dimensionless
 * FRACTION of the season's alliance-score variance, resolved per call by
 * `sigma1/scale.ts` — so the absolute floor this identity is stated up to
 * differs season by season rather than being one fixed points^2 number).
 *
 * Scope: every played PLAYOFF match (`qf`/`sf`/`f`) at the four events the
 * todo names — playoff rows because those are the matches an event's
 * alliances play, and because every picked team has qual history, so a
 * previous metricHistory row always exists.
 *
 * Credential-free by construction, exactly like `mockRankDistribution.ts`:
 * imports `DEFAULT_ARTIFACT_ORIGIN`/`fetchArtifactFresh`/
 * `resolvePublishedVersions` from `scripts/verifySubsetPublish.ts`, never
 * reads any environment variable, never touches `.env` or `r2Client.ts`.
 *
 * Run: `npx tsx scripts/verifyAllianceUncertaintyIdentity.ts`
 * Exit 0 when the identity holds within the derived tolerance at every
 * compared pair; exit 1 with a per-pair table of breaches otherwise.
 */
import { DEFAULT_ARTIFACT_ORIGIN, fetchArtifactFresh, resolvePublishedVersions } from "./verifySubsetPublish.js";
import { artifactKey, EventArtifactSchema, TeamSeasonArtifactSchema, type EventArtifact } from "../packages/harness/pageArtifacts.js";
import { ROUNDING_RULE } from "../packages/harness/rounding.js";

const ALGORITHM_ID = "vpr";
/** The todo's own four measured events (07-20's original sample). */
const TARGET_EVENT_KEYS = ["2024new", "2023cur", "2024casf", "2025flta"] as const;
const PLAYOFF_COMP_LEVELS = new Set(["qf", "sf", "f"]);
const TOTAL_METRIC_KEY = "total";

/**
 * Rounding-derived tolerance in VARIANCE units, per alliance:
 * each published spread s is rounded to `ROUNDING_RULE.metric` decimals
 * (half-step h = 0.005), so s² carries up to `2·s·h + h²` of rounding error;
 * summed over 3 teams with the LARGEST spread observed in the pair, plus the
 * variance field's own half-step. Derived per-pair from the actual spreads
 * rather than assumed constant.
 */
function toleranceForSpreads(spreads: readonly number[]): number {
  const hMetric = 0.5 * 10 ** -ROUNDING_RULE.metric;
  const hVariance = 0.5 * 10 ** -ROUNDING_RULE.variance;
  const spreadTerm = spreads.reduce((sum, s) => sum + 2 * s * hMetric + hMetric * hMetric, 0);
  return spreadTerm + hVariance;
}

interface PairResult {
  readonly eventKey: string;
  readonly matchKey: string;
  readonly side: "red" | "blue";
  readonly derivedVariance: number;
  readonly publishedVariance: number;
  readonly absGap: number;
  readonly tolerance: number;
  readonly withinTolerance: boolean;
}

function yearOf(eventKey: string): number {
  return Number.parseInt(eventKey.slice(0, 4), 10);
}

async function fetchJson<T>(origin: string, key: string, runId: string, parse: (raw: unknown) => T): Promise<T> {
  const res = await fetchArtifactFresh(origin, key, runId);
  if (res.status !== 200 || res.body === undefined) {
    throw new Error(`GET ${origin}/${key} -> HTTP ${res.status}`);
  }
  return parse(JSON.parse(res.body));
}

async function main(): Promise<void> {
  const origin = DEFAULT_ARTIFACT_ORIGIN;
  const runId = `identity-${Date.now()}`;
  const versions = await resolvePublishedVersions(origin);
  const version = versions.get(ALGORITHM_ID);
  if (version === undefined) throw new Error(`algorithms manifest has no entry for "${ALGORITHM_ID}"`);

  const pairs: PairResult[] = [];
  let skippedNoVariance = 0;
  let skippedNoHistory = 0;

  for (const eventKey of TARGET_EVENT_KEYS) {
    const year = yearOf(eventKey);
    const event: EventArtifact = await fetchJson(
      origin,
      artifactKey({ page: "event", eventKey, algorithmId: ALGORITHM_ID, version }),
      runId,
      (raw) => EventArtifactSchema.parse(raw)
    );

    // One team-season artifact fetch per distinct playoff team, cached.
    const historyByTeam = new Map<string, { matchIndex: number; matchKey: string; spread: number | undefined }[]>();
    const playoffMatches = event.matches.filter((m) => PLAYOFF_COMP_LEVELS.has(m.compLevel));

    const playoffTeams = new Set<string>();
    for (const m of playoffMatches) for (const t of [...m.redTeams, ...m.blueTeams]) playoffTeams.add(t);

    for (const teamKey of playoffTeams) {
      const team = await fetchJson(
        origin,
        artifactKey({ page: "team", teamKey, year, algorithmId: ALGORITHM_ID, version }),
        runId,
        (raw) => TeamSeasonArtifactSchema.parse(raw)
      );
      const rows = team.metricHistory
        .filter((row) => row.algorithmId === ALGORITHM_ID)
        .map((row) => ({ matchIndex: row.matchIndex, matchKey: row.matchKey, spread: row.metrics[TOTAL_METRIC_KEY]?.spread }))
        .sort((a, b) => a.matchIndex - b.matchIndex);
      historyByTeam.set(teamKey, rows);
    }

    for (const match of playoffMatches) {
      for (const side of ["red", "blue"] as const) {
        const published = side === "red" ? match.redScoreVarianceOwn : match.blueScoreVarianceOwn;
        if (published === undefined) {
          skippedNoVariance++;
          continue;
        }
        const teams = side === "red" ? match.redTeams : match.blueTeams;
        const preMatchSpreads: number[] = [];
        let missing = false;
        for (const teamKey of teams) {
          const rows = historyByTeam.get(teamKey) ?? [];
          const own = rows.findIndex((r) => r.matchKey === match.matchKey);
          // Pre-match state = the row BEFORE this team's own row for M.
          const prev = own > 0 ? rows[own - 1] : undefined;
          if (prev?.spread === undefined) {
            missing = true;
            break;
          }
          preMatchSpreads.push(prev.spread);
        }
        if (missing || preMatchSpreads.length !== teams.length) {
          skippedNoHistory++;
          continue;
        }
        const derived = preMatchSpreads.reduce((sum, s) => sum + s * s, 0);
        const tolerance = toleranceForSpreads(preMatchSpreads);
        const absGap = Math.abs(derived - published);
        pairs.push({
          eventKey,
          matchKey: match.matchKey,
          side,
          derivedVariance: derived,
          publishedVariance: published,
          absGap,
          tolerance,
          withinTolerance: absGap <= tolerance,
        });
      }
    }
  }

  const breaches = pairs.filter((p) => !p.withinTolerance);
  const maxGap = pairs.reduce((max, p) => Math.max(max, p.absGap), 0);
  const meanGap = pairs.length > 0 ? pairs.reduce((sum, p) => sum + p.absGap, 0) / pairs.length : 0;

  console.log(`alliance-uncertainty identity — ${pairs.length} compared pairs across ${TARGET_EVENT_KEYS.length} events`);
  console.log(`  skipped: ${skippedNoVariance} (no published varianceOwn), ${skippedNoHistory} (no usable pre-match history row)`);
  console.log(`  mean |gap|: ${meanGap.toFixed(6)} variance units; max |gap|: ${maxGap.toFixed(6)}`);
  console.log(`  breaches beyond rounding-derived tolerance: ${breaches.length}/${pairs.length}`);
  for (const b of breaches.slice(0, 20)) {
    console.log(
      `  BREACH ${b.eventKey} ${b.matchKey} ${b.side}: derived ${b.derivedVariance.toFixed(4)} vs published ${b.publishedVariance.toFixed(4)} (|gap| ${b.absGap.toFixed(4)} > tol ${b.tolerance.toFixed(4)})`
    );
  }
  if (pairs.length === 0) {
    console.error("No pairs compared — nothing proven. Treating as failure.");
    process.exitCode = 1;
    return;
  }
  process.exitCode = breaches.length === 0 ? 0 : 1;
}

await main();
