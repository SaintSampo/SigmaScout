/**
 * THE METRIC-HISTORY HALF OF THE PARITY CLAIM (quick task 260917-jr4, D-07).
 *
 * A row the BROWSER derives from an event artifact's ephemeral `live` block
 * must equal the row the
 * OFFLINE PUBLISHER would write for the same match, minus a stated exception
 * list. Both halves of the claim exist and neither substitutes for the other:
 *
 *   - MATCH rows: `scheduled.rowParity.test.ts`, which compares the
 *     publisher's played row against the live/derived one, exception list
 *     `["coldStart"]`.
 *   - METRIC-HISTORY rows: this file.
 *
 * WHY THIS LIVES UNDER apps/worker/test AND NOT BESIDE THE MODULE IT TESTS.
 * The plan allowed either home and asked for the working one to be named.
 * Measured 2026-09-17: the `web` vitest project CANNOT load
 * `packages/harness/publish.ts` at all. Its environment is jsdom, so
 * `import.meta.url` is an `http:` URL, and `packages/corpus/db.ts` calls
 * `fileURLToPath` on it at module top level — "TypeError: The URL must be of
 * scheme file". The `node` project has no such problem and
 * `scheduled.rowParity.test.ts` already proves the runtime-`import()` pattern
 * here, so the test came to the publisher rather than the publisher to the
 * test. It imports `apps/web/src/lib/liveTeamSeason.ts`, which is pure (no
 * React, no DOM, no Node) precisely so this is possible.
 *
 * WHY THE PUBLISHER IS LOADED BY RUNTIME `import()` ONLY: a static or
 * type-only import of `packages/harness/publish.ts` adds it to the Worker's
 * tsc program, where `packages/harness/r2Client.ts` fails under
 * workers-types. A non-literal `import()` specifier keeps it out — the same
 * reasoning `scheduled.rowParity.test.ts` states.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extendMetricHistory } from "../../web/src/lib/liveTeamSeason.js";
import { mergeEventLiveBlock } from "../../../packages/harness/liveEventRows.js";
import { SIGMA_METRIC_KEY } from "../../../packages/harness/sigmaScore.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import type { MetricHistoryRow } from "../../../packages/harness/metricHistorySchema.js";
import type { TeamSeasonArtifact } from "../../../packages/harness/pageArtifacts.js";

interface OfflinePublisher {
  buildTeamSeasonArtifact(params: unknown): TeamSeasonArtifact;
}

// `.href`, not the `URL` object: this file typechecks under workers-types.
const publisher = (await import(fileURLToPath(new URL("../../../packages/harness/publish.ts", import.meta.url).href))) as OfflinePublisher;

const SEASON = 2026;
const EVENT_KEY = "2026casj";
const TEAM_KEY = "frc1114";
const STAMP = { generation: "gen-parity", computedAt: "2026-03-07T18:00:00.000Z" };
const MATCH_KEY = `${EVENT_KEY}_qm7`;

/**
 * The published fields a DERIVED metric-history row cannot carry, and why
 * each one is unreachable rather than merely omitted. Expressed as DATA and
 * consumed by the comparison below, never restated as prose in an assertion
 * message — the same treatment `LIVE_PLAYED_ROW_EXCEPTIONS` gets.
 */
const DERIVED_METRIC_ROW_EXCEPTIONS = [
  {
    field: "spread",
    why: "the algorithm's OWN confidence in its rating. `MetricValue` refuses to render it and `metricHistorySeries.ts` reads its band from the sigma entry precisely so it cannot regress onto it, so the live block spends no bytes carrying a field nothing may display.",
  },
  {
    field: "percentile",
    why: "a publish-time-only derived quantity ranked against a SEASON pool the Worker has no access to. The live tick computed none before this change either (`touchedEventTeamMetrics`'s own documented limitation), so this is a preserved absence, not a new one.",
  },
] as const;

/** The tick's own end-of-tick values, unrounded, as `algorithm.teamMetrics` would return them. */
const RAW_METRICS = { total: 47.123456, auto: 12.987654, [SIGMA_METRIC_KEY]: 3.14159 };

/** What the PUBLISHER would write for this match: the same raw values, plus the two fields only a publish run can know. */
function publisherRow(): MetricHistoryRow {
  const artifact = publisher.buildTeamSeasonArtifact({
    teamKey: TEAM_KEY,
    teamNumber: 1114,
    nickname: "Team 1114",
    season: SEASON,
    algorithmId: spr.id,
    algorithmVersion: spr.version,
    generation: STAMP.generation,
    computedAt: STAMP.computedAt,
    seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: { total: { value: 47.123456 } }, metricsBasis: "last-official-match" as const },
    events: [],
    metricHistory: [
      {
        matchKey: MATCH_KEY,
        season: SEASON,
        eventKey: EVENT_KEY,
        algorithmId: spr.id,
        teamKey: TEAM_KEY,
        // The publisher's own season-wide stream position. The derived row
        // carries array position instead; see the `matchIndex` case below.
        matchIndex: 412,
        metrics: {
          total: { value: RAW_METRICS.total, spread: 8.7654321, percentile: 93.5 },
          auto: { value: RAW_METRICS.auto, spread: 2.2222, percentile: 88.25 },
          [SIGMA_METRIC_KEY]: { value: RAW_METRICS[SIGMA_METRIC_KEY] },
        },
      },
    ],
  });
  return artifact.metricHistory[0]!;
}

/** What the BROWSER derives: the tick's raw values through the real live-block merge, then the real `extendMetricHistory`. */
function derivedRow(): MetricHistoryRow {
  const { block } = mergeEventLiveBlock({
    existing: undefined,
    // Sorted union, exactly as `buildTickLiveRows` computes it.
    metricKeys: [...Object.keys(RAW_METRICS)].sort(),
    rows: [{ matchKey: MATCH_KEY, teamKeys: [TEAM_KEY], valuesByTeam: new Map([[TEAM_KEY, RAW_METRICS]]) }],
    existingBodyBytes: 0,
  });

  const extended = extendMetricHistory({
    artifact: { teamKey: TEAM_KEY, season: SEASON, algorithmId: spr.id, metricHistory: [], events: [{ eventKey: EVENT_KEY, startDate: "2026-03-05", matches: [] }] },
    // The three identity fields now come off the EVENT ARTIFACT's own top
    // level, which is why the block carries none of them.
    eventArtifacts: new Map([[EVENT_KEY, { season: SEASON, eventKey: EVENT_KEY, algorithmId: spr.id, live: block }]]),
  });
  expect(extended, "the derivation produced no row at all — every assertion below would be vacuous").toHaveLength(1);
  return extended[0]!;
}

describe("a derived metric-history row equals the publisher's row, minus the named exceptions", () => {
  const offline = publisherRow();
  const derived = derivedRow();

  it("non-vacuity: the publisher's row really carries the fields this parity is about", () => {
    expect(Object.keys(offline.metrics).sort()).toEqual(["auto", SIGMA_METRIC_KEY, "total"].sort());
    for (const { field } of DERIVED_METRIC_ROW_EXCEPTIONS) {
      expect(offline.metrics.total, `publisher row must carry ${field} or its exclusion below proves nothing`).toHaveProperty(field);
    }
    expect(offline.matchIndex).toBe(412);
  });

  it("carries the identical top-level identity fields", () => {
    expect(derived.matchKey).toBe(offline.matchKey);
    expect(derived.season).toBe(offline.season);
    expect(derived.eventKey).toBe(offline.eventKey);
    expect(derived.algorithmId).toBe(offline.algorithmId);
    expect(derived.teamKey).toBe(offline.teamKey);
  });

  it("carries the identical metric KEY SET", () => {
    expect(Object.keys(derived.metrics).sort()).toEqual(Object.keys(offline.metrics).sort());
  });

  it("carries the identical metric VALUES, including the publisher's own rounding", () => {
    for (const key of Object.keys(offline.metrics)) {
      expect(derived.metrics[key]?.value, key).toBe(offline.metrics[key]?.value);
    }
    // Non-vacuity for "including rounding": the raw input really was
    // unrounded, so an unrounded derived value would differ here.
    expect(derived.metrics.total?.value).not.toBe(RAW_METRICS.total);
  });

  it.each(DERIVED_METRIC_ROW_EXCEPTIONS)("does NOT carry $field — $why", ({ field }) => {
    for (const key of Object.keys(derived.metrics)) {
      expect(derived.metrics[key], key).not.toHaveProperty(field);
    }
  });

  it("carries matchIndex as its ARRAY POSITION, not the publisher's season-wide index", () => {
    expect(derived.matchIndex).toBe(0);
    expect(derived.matchIndex).not.toBe(offline.matchIndex);
  });

  it("differs from the publisher's row in NOTHING ELSE: stripping the exception list and the index makes the two equal", () => {
    const strip = (row: MetricHistoryRow) => ({
      ...row,
      matchIndex: 0,
      metrics: Object.fromEntries(
        Object.entries(row.metrics).map(([key, metric]) => {
          const copy: Record<string, unknown> = { ...metric };
          for (const { field } of DERIVED_METRIC_ROW_EXCEPTIONS) delete copy[field];
          return [key, copy];
        })
      ),
    });
    expect(strip(derived)).toEqual(strip(offline));
  });
});
