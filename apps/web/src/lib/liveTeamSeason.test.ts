/**
 * The robot page's live derivation (quick task 260917-jr4, Task 2).
 *
 * The second half of the parity claim — a DERIVED metric-history row equals
 * the offline publisher's row for the same match, minus a stated exception
 * list — lives in `apps/worker/test/liveTeamSeason.parity.test.ts`, NOT here.
 * Measured 2026-09-17: the web vitest project cannot load
 * `packages/harness/publish.ts` at all, because jsdom's `import.meta.url` is
 * an `http:` URL and `packages/corpus/db.ts` calls `fileURLToPath` on it at
 * module top level ("The URL must be of scheme file"). The worker project is
 * a node environment and already proves the runtime-`import()` pattern in
 * `scheduled.rowParity.test.ts`, so the parity half went there and imports
 * THIS module's pure derivation.
 *
 * What this file covers instead: the derivation's own behaviour, and — the
 * point of the whole design — that the EXISTING, UNFORKED consumers
 * (`buildMetricSeries`, `detectEventBands`, `preMatchMetrics`,
 * `officialSnapshotRow`, `endOfEventMetrics`) become correct when fed its
 * output.
 */
import { describe, expect, it } from "vitest";
import { deriveMetricsBasis, deriveSeasonRecord, extendMetricHistory } from "./liveTeamSeason.js";
import { officialSnapshotRow } from "./officialSnapshot.js";
import { preMatchMetrics } from "./preMatchMetrics.js";
import { buildMetricSeries, detectEventBands } from "../components/team/metricHistorySeries.js";
import { endOfEventMetrics } from "../components/team/EventSection.js";
import { mergeEventLiveBlock } from "../../../../packages/harness/liveEventRows.js";
import type { LiveEventArtifactLike } from "./liveTeamSeason.js";
import { SIGMA_METRIC_KEY } from "../../../../packages/harness/sigmaScore.js";
import type { MetricHistoryRow } from "../../../../packages/harness/metricHistorySchema.js";

const TEAM = "frc1114";
const SEASON = 2026;
const ALGORITHM = "spr";
const EVENT_A = "2026casj";
const EVENT_B = "2026cafr";
const KEYS = ["total", SIGMA_METRIC_KEY];

/**
 * One live event's fetched ARTIFACT, with its `live` block built by the REAL
 * `mergeEventLiveBlock` rather than hand-written — a hand-built block could
 * encode values the shipped merge never would, and this file's whole claim is
 * about what the shipped pair does end to end.
 *
 * The three identity fields sit at the artifact's top level, which is where
 * `extendMetricHistory` now sources them from: the block itself carries none.
 */
function liveEventOf(eventKey: string, rows: readonly { matchKey: string; teams: readonly string[]; total: number; sigma: number }[]): LiveEventArtifactLike {
  const { block } = mergeEventLiveBlock({
    existing: undefined,
    metricKeys: KEYS,
    existingBodyBytes: 0,
    rows: rows.map((row) => ({
      matchKey: row.matchKey,
      teamKeys: row.teams,
      valuesByTeam: new Map(row.teams.map((teamKey) => [teamKey, teamKey === TEAM ? { total: row.total, [SIGMA_METRIC_KEY]: row.sigma } : { total: 0, [SIGMA_METRIC_KEY]: 0 }])),
    })),
  });
  return { season: SEASON, eventKey, algorithmId: ALGORITHM, live: block };
}

function publishedRow(matchKey: string, eventKey: string, matchIndex: number, total: number): MetricHistoryRow {
  return { matchKey, season: SEASON, eventKey, algorithmId: ALGORITHM, teamKey: TEAM, matchIndex, metrics: { total: { value: total }, [SIGMA_METRIC_KEY]: { value: 1 } } };
}

function artifactOf(params: { metricHistory: MetricHistoryRow[]; events: { eventKey: string; startDate: string; matches: { matchKey: string; actualWinner?: unknown }[] }[] }) {
  return { teamKey: TEAM, season: SEASON, algorithmId: ALGORITHM, metricHistory: params.metricHistory, events: params.events };
}

describe("extendMetricHistory", () => {
  it("returns the published array BY IDENTITY when no event is live", () => {
    const artifact = artifactOf({ metricHistory: [publishedRow("2026casj_qm1", EVENT_A, 0, 40)], events: [{ eventKey: EVENT_A, startDate: "2026-03-05", matches: [] }] });
    expect(extendMetricHistory({ artifact, eventArtifacts: new Map() })).toBe(artifact.metricHistory);
  });

  it("returns the published array by identity when the live event's live block has no row for this team", () => {
    const artifact = artifactOf({ metricHistory: [publishedRow("2026casj_qm1", EVENT_A, 0, 40)], events: [{ eventKey: EVENT_A, startDate: "2026-03-05", matches: [] }] });
    const eventArtifacts = new Map([[EVENT_A, liveEventOf(EVENT_A, [{ matchKey: "2026casj_qm9", teams: ["frc9999"], total: 5, sigma: 5 }])]]);
    expect(extendMetricHistory({ artifact, eventArtifacts })).toBe(artifact.metricHistory);
  });

  it("appends the live block's rows for this team after the published ones", () => {
    const artifact = artifactOf({ metricHistory: [publishedRow("2026casj_qm1", EVENT_A, 0, 40)], events: [{ eventKey: EVENT_A, startDate: "2026-03-05", matches: [] }] });
    const eventArtifacts = new Map([
      [
        EVENT_A,
        liveEventOf(EVENT_A, [
          { matchKey: "2026casj_qm2", teams: [TEAM, "frc2"], total: 44, sigma: 2 },
          { matchKey: "2026casj_qm3", teams: [TEAM, "frc3"], total: 47, sigma: 3 },
        ]),
      ],
    ]);
    const extended = extendMetricHistory({ artifact, eventArtifacts });
    expect(extended.map((row) => row.matchKey)).toEqual(["2026casj_qm1", "2026casj_qm2", "2026casj_qm3"]);
    expect(extended.map((row) => row.metrics.total?.value)).toEqual([40, 44, 47]);
  });

  it("DROPS a live row whose match key is already published — the dedup that is both the double-count guard and the staleness guard", () => {
    const artifact = artifactOf({
      metricHistory: [publishedRow("2026casj_qm1", EVENT_A, 0, 40), publishedRow("2026casj_qm2", EVENT_A, 1, 44)],
      events: [{ eventKey: EVENT_A, startDate: "2026-03-05", matches: [] }],
    });
    const eventArtifacts = new Map([
      [
        EVENT_A,
        liveEventOf(EVENT_A, [
          { matchKey: "2026casj_qm1", teams: [TEAM], total: 999, sigma: 9 },
          { matchKey: "2026casj_qm2", teams: [TEAM], total: 999, sigma: 9 },
          { matchKey: "2026casj_qm3", teams: [TEAM], total: 47, sigma: 3 },
        ]),
      ],
    ]);
    const extended = extendMetricHistory({ artifact, eventArtifacts });
    expect(extended.map((row) => row.matchKey)).toEqual(["2026casj_qm1", "2026casj_qm2", "2026casj_qm3"]);
    expect(new Set(extended.map((row) => row.matchKey)).size).toBe(extended.length);
    // The published values win: a stale live row is inert, not authoritative.
    expect(extended[0]!.metrics.total?.value).toBe(40);
    expect(extended[1]!.metrics.total?.value).toBe(44);
  });

  it("orders two live events' blocks by their startDate, then by fold order within each block", () => {
    const artifact = artifactOf({
      metricHistory: [],
      // Deliberately listed LATER-event-first, so a correct result cannot come
      // from simply preserving `artifact.events` order.
      events: [
        { eventKey: EVENT_B, startDate: "2026-03-19", matches: [] },
        { eventKey: EVENT_A, startDate: "2026-03-05", matches: [] },
      ],
    });
    const eventArtifacts = new Map([
      [EVENT_B, liveEventOf(EVENT_B, [{ matchKey: "2026cafr_qm1", teams: [TEAM], total: 60, sigma: 6 }, { matchKey: "2026cafr_qm2", teams: [TEAM], total: 62, sigma: 6 }])],
      [EVENT_A, liveEventOf(EVENT_A, [{ matchKey: "2026casj_qm1", teams: [TEAM], total: 40, sigma: 4 }, { matchKey: "2026casj_qm2", teams: [TEAM], total: 44, sigma: 4 }])],
    ]);
    expect(extendMetricHistory({ artifact, eventArtifacts }).map((row) => row.matchKey)).toEqual(["2026casj_qm1", "2026casj_qm2", "2026cafr_qm1", "2026cafr_qm2"]);
  });

  it("breaks a startDate tie by the published artifact.events order", () => {
    const artifact = artifactOf({
      metricHistory: [],
      events: [
        { eventKey: EVENT_B, startDate: "2026-03-05", matches: [] },
        { eventKey: EVENT_A, startDate: "2026-03-05", matches: [] },
      ],
    });
    const eventArtifacts = new Map([
      [EVENT_A, liveEventOf(EVENT_A, [{ matchKey: "2026casj_qm1", teams: [TEAM], total: 40, sigma: 4 }])],
      [EVENT_B, liveEventOf(EVENT_B, [{ matchKey: "2026cafr_qm1", teams: [TEAM], total: 60, sigma: 6 }])],
    ]);
    expect(extendMetricHistory({ artifact, eventArtifacts }).map((row) => row.matchKey)).toEqual(["2026cafr_qm1", "2026casj_qm1"]);
  });

  it("gives every DERIVED row its zero-based array position as matchIndex — no season-wide index is invented", () => {
    const artifact = artifactOf({
      metricHistory: [publishedRow("2026casj_qm1", EVENT_A, 137, 40)],
      events: [{ eventKey: EVENT_A, startDate: "2026-03-05", matches: [] }],
    });
    const eventArtifacts = new Map([[EVENT_A, liveEventOf(EVENT_A, [{ matchKey: "2026casj_qm2", teams: [TEAM], total: 44, sigma: 2 }, { matchKey: "2026casj_qm3", teams: [TEAM], total: 47, sigma: 3 }])]]);
    const extended = extendMetricHistory({ artifact, eventArtifacts });
    expect(extended.map((row) => row.matchIndex)).toEqual([137, 1, 2]);
  });

  it("never mutates the published array", () => {
    const published = [publishedRow("2026casj_qm1", EVENT_A, 0, 40)];
    const artifact = artifactOf({ metricHistory: published, events: [{ eventKey: EVENT_A, startDate: "2026-03-05", matches: [] }] });
    const eventArtifacts = new Map([[EVENT_A, liveEventOf(EVENT_A, [{ matchKey: "2026casj_qm2", teams: [TEAM], total: 44, sigma: 2 }])]]);
    extendMetricHistory({ artifact, eventArtifacts });
    expect(published).toHaveLength(1);
  });
});

describe("the UNCHANGED consumers become correct when fed the extended array", () => {
  const artifact = artifactOf({
    metricHistory: [publishedRow("2026casj_qm1", EVENT_A, 0, 40)],
    events: [{ eventKey: EVENT_A, startDate: "2026-03-05", matches: [] }],
  });
  const eventArtifacts = new Map([
    [
      EVENT_A,
      liveEventOf(EVENT_A, [
        { matchKey: "2026casj_qm2", teams: [TEAM], total: 44, sigma: 2 },
        { matchKey: "2026casj_qm3", teams: [TEAM], total: 47, sigma: 3 },
      ]),
    ],
  ]);
  const extended = extendMetricHistory({ artifact, eventArtifacts });

  it("buildMetricSeries plots the live-block matches with the block's own sigma values", () => {
    const points = buildMetricSeries(extended, "total");
    expect(points.map((p) => p.x)).toEqual([1, 2, 3]);
    expect(points.map((p) => p.value)).toEqual([40, 44, 47]);
    expect(points.map((p) => p.sigma)).toEqual([1, 2, 3]);
  });

  it("detectEventBands opens one band spanning the published AND the derived points", () => {
    const bands = detectEventBands(buildMetricSeries(extended, "total"));
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ eventKey: EVENT_A, startX: 1, endX: 3 });
  });

  it("preMatchMetrics returns the row PRECEDING a live-block-sourced match", () => {
    expect(preMatchMetrics(extended, "2026casj_qm3", { played: true })?.asOfMatchKey).toBe("2026casj_qm2");
    expect(preMatchMetrics(extended, "2026casj_qm2", { played: true })?.asOfMatchKey).toBe("2026casj_qm1");
  });

  it("preMatchMetrics still returns ABSENCE for a played row at index 0 — the extension invents no pre-match state", () => {
    expect(preMatchMetrics(extended, "2026casj_qm1", { played: true })).toBeUndefined();
  });

  it("endOfEventMetrics resolves the LAST derived row, not the last published one", () => {
    expect(endOfEventMetrics(extended, EVENT_A)?.matchKey).toBe("2026casj_qm3");
    expect(endOfEventMetrics(artifact.metricHistory, EVENT_A)?.matchKey).toBe("2026casj_qm1");
  });

  it("officialSnapshotRow resolves the last derived row at an official event", () => {
    const eventRows = [{ eventKey: EVENT_A, eventType: 0, isOffseason: false }] as unknown as Parameters<typeof officialSnapshotRow>[1];
    expect(officialSnapshotRow(extended, eventRows)?.matchKey).toBe("2026casj_qm3");
  });
});

describe("deriveSeasonRecord", () => {
  const OFFICIAL = new Map([[EVENT_A, { eventType: 0 }]]);

  function published(matches: { matchKey: string; actualWinner?: unknown }[]) {
    return { teamKey: TEAM, seasonStats: { record: { wins: 2, losses: 1, ties: 0 } }, events: [{ eventKey: EVENT_A, startDate: "2026-03-05", matches }] };
  }

  function overlaid(matches: { matchKey: string; redTeams?: string[]; blueTeams?: string[]; actualWinner?: unknown }[]) {
    return [{ eventKey: EVENT_A, matches }];
  }

  it("counts a match ONCE when its published row is unplayed and its overlaid row is played", () => {
    const record = deriveSeasonRecord({
      artifact: published([{ matchKey: "2026casj_qm5" }]),
      overlaidEvents: overlaid([{ matchKey: "2026casj_qm5", redTeams: [TEAM], blueTeams: ["frc2"], actualWinner: "red" }]),
      eventArtifactsByKey: OFFICIAL,
    });
    expect(record).toEqual({ wins: 3, losses: 1, ties: 0 });
  });

  it("counts a match ZERO times when its PUBLISHED row is already played — the double-count guard", () => {
    // THE HAZARD THIS PINS: the overlaid list is a UNION, not a delta. It
    // contains the publisher's own matches re-sourced from the event artifact,
    // and `seasonStats.record` already counted them. Keying the guard on the
    // overlaid row rather than the published one would read 4-1-0 here.
    const record = deriveSeasonRecord({
      artifact: published([{ matchKey: "2026casj_qm5", actualWinner: "red" }]),
      overlaidEvents: overlaid([{ matchKey: "2026casj_qm5", redTeams: [TEAM], blueTeams: ["frc2"], actualWinner: "red" }]),
      eventArtifactsByKey: OFFICIAL,
    });
    expect(record).toEqual({ wins: 2, losses: 1, ties: 0 });
  });

  it("counts a loss and a tie on the right side of the alliance", () => {
    const record = deriveSeasonRecord({
      artifact: published([{ matchKey: "2026casj_qm5" }, { matchKey: "2026casj_qm6" }]),
      overlaidEvents: overlaid([
        { matchKey: "2026casj_qm5", redTeams: ["frc2"], blueTeams: [TEAM], actualWinner: "red" },
        { matchKey: "2026casj_qm6", redTeams: [TEAM], blueTeams: ["frc2"], actualWinner: "tie" },
      ]),
      eventArtifactsByKey: OFFICIAL,
    });
    expect(record).toEqual({ wins: 2, losses: 2, ties: 1 });
  });

  it("counts NOTHING for an offseason (99) or preseason (100) event — the officialness scoping mergeTeamSeasonArtifact applies", () => {
    for (const eventType of [99, 100]) {
      const record = deriveSeasonRecord({
        artifact: published([{ matchKey: "2026casj_qm5" }]),
        overlaidEvents: overlaid([{ matchKey: "2026casj_qm5", redTeams: [TEAM], blueTeams: ["frc2"], actualWinner: "red" }]),
        eventArtifactsByKey: new Map([[EVENT_A, { eventType }]]),
      });
      expect(record, `eventType ${eventType}`).toEqual({ wins: 2, losses: 1, ties: 0 });
    }
  });

  it("counts an event whose type is UNKNOWN, matching the tick's own -1 sentinel behaviour", () => {
    const record = deriveSeasonRecord({
      artifact: published([{ matchKey: "2026casj_qm5" }]),
      overlaidEvents: overlaid([{ matchKey: "2026casj_qm5", redTeams: [TEAM], blueTeams: ["frc2"], actualWinner: "red" }]),
      eventArtifactsByKey: new Map([[EVENT_A, undefined]]),
    });
    expect(record).toEqual({ wins: 3, losses: 1, ties: 0 });
  });

  it("ignores a match the team is not on either alliance of", () => {
    const record = deriveSeasonRecord({
      artifact: published([{ matchKey: "2026casj_qm5" }]),
      overlaidEvents: overlaid([{ matchKey: "2026casj_qm5", redTeams: ["frc2"], blueTeams: ["frc3"], actualWinner: "red" }]),
      eventArtifactsByKey: OFFICIAL,
    });
    expect(record).toEqual({ wins: 2, losses: 1, ties: 0 });
  });

  it("returns the published record untouched when no event is overlaid at all", () => {
    expect(deriveSeasonRecord({ artifact: published([{ matchKey: "2026casj_qm5" }]), overlaidEvents: [], eventArtifactsByKey: new Map() })).toEqual({ wins: 2, losses: 1, ties: 0 });
  });
});

describe("deriveMetricsBasis", () => {
  it("returns the published basis unchanged when no live event contributed rows", () => {
    expect(deriveMetricsBasis({ published: "last-official-match", liveEventKeys: [], eventArtifactsByKey: new Map() })).toBe("last-official-match");
    expect(deriveMetricsBasis({ published: undefined, liveEventKeys: [], eventArtifactsByKey: new Map() })).toBeUndefined();
  });

  it("is last-official-match when every contributing event is official", () => {
    expect(deriveMetricsBasis({ published: "season-final", liveEventKeys: [EVENT_A], eventArtifactsByKey: new Map([[EVENT_A, { eventType: 0 }]]) })).toBe("last-official-match");
  });

  it("is season-final when ANY contributing event is offseason — a published last-official-match label is not carried over offseason play", () => {
    expect(deriveMetricsBasis({ published: "last-official-match", liveEventKeys: [EVENT_A, EVENT_B], eventArtifactsByKey: new Map([[EVENT_A, { eventType: 0 }], [EVENT_B, { eventType: 99 }]]) })).toBe("season-final");
  });
});
