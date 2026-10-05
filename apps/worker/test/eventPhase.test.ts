/**
 * The phase model and the endpoint polling rule (quick task 261004-uyc), driven by
 * TBA shaped match rows (the same raw shape `tbaMatchSchema` parses), never by
 * hand built facts, so the derivation is tested from the list down.
 */
import { describe, expect, it } from "vitest";
import { tbaMatchListSchema, type TbaMatch } from "../../../packages/ingest/schemas.js";
import { deriveEventPhase, deriveLivePhaseFacts, endpointsToPoll, EVENT_PHASES, OFFICIAL_DATA_SETTLE_MS } from "../src/eventPhase.js";
import { DEFAULT_LIVE_INGEST_STATE, type LiveIngestState } from "../src/liveIngestState.js";

type CompLevel = "qm" | "ef" | "qf" | "sf" | "f";

interface RowSpec {
  readonly level: CompLevel;
  readonly set?: number;
  readonly num: number;
  /** Red and blue scores when played; omitted for an unplayed row. */
  readonly score?: readonly [number, number];
  /** True for a bracket placeholder: one side has no teams yet. */
  readonly emptySide?: boolean;
}

function rows(specs: readonly RowSpec[]): TbaMatch[] {
  return tbaMatchListSchema.parse(
    specs.map((spec) => {
      const set = spec.set ?? 1;
      const winner = spec.score === undefined ? "" : spec.score[0] > spec.score[1] ? "red" : spec.score[1] > spec.score[0] ? "blue" : "";
      return {
        key: `2026vari_${spec.level}${spec.level === "qm" ? "" : `${set}m`}${spec.num}`,
        event_key: "2026vari",
        comp_level: spec.level,
        set_number: set,
        match_number: spec.num,
        time: null,
        predicted_time: null,
        actual_time: null,
        winning_alliance: winner,
        alliances: {
          red: { team_keys: ["frc1", "frc2", "frc3"], surrogate_team_keys: [], dq_team_keys: [], score: spec.score?.[0] ?? null },
          blue: { team_keys: spec.emptySide === true ? [] : ["frc4", "frc5", "frc6"], surrogate_team_keys: [], dq_team_keys: [], score: spec.score?.[1] ?? null },
        },
        score_breakdown: null,
      };
    })
  );
}

const qm = (num: number, played: boolean): RowSpec => (played ? { level: "qm", num, score: [10, 5] } : { level: "qm", num });

function phaseOf(specs: readonly RowSpec[], alliancesKnown = false) {
  return deriveEventPhase(deriveLivePhaseFacts(rows(specs)), alliancesKnown);
}

describe("deriveEventPhase", () => {
  it("lists the seven phases in day order", () => {
    expect([...EVENT_PHASES]).toEqual(["no-schedule", "schedule-posted", "quals-in-progress", "quals-complete", "alliances-posted", "playoffs-in-progress", "complete"]);
  });

  it("no matches at all is no-schedule", () => {
    expect(phaseOf([])).toBe("no-schedule");
  });

  it("qualification rows with none played is schedule-posted; some played is quals-in-progress", () => {
    expect(phaseOf([qm(1, false), qm(2, false)])).toBe("schedule-posted");
    expect(phaseOf([qm(1, true), qm(2, false)])).toBe("quals-in-progress");
  });

  it("every qualification row played, no playoff row with both alliances, alliancesKnown false is quals-complete", () => {
    expect(phaseOf([qm(1, true), qm(2, true)])).toBe("quals-complete");
  });

  it("every qualification row played and a playoff row carrying both alliances, or alliancesKnown true, is alliances-posted", () => {
    expect(phaseOf([qm(1, true), qm(2, true), { level: "sf", set: 1, num: 1 }])).toBe("alliances-posted");
    expect(phaseOf([qm(1, true), qm(2, true)], true)).toBe("alliances-posted");
  });

  it("a placeholder playoff row with an empty side does not make alliances-posted", () => {
    expect(phaseOf([qm(1, true), qm(2, true), { level: "sf", set: 1, num: 1, emptySide: true }])).toBe("quals-complete");
  });

  it("one playoff match played is playoffs-in-progress", () => {
    expect(phaseOf([qm(1, true), { level: "sf", set: 1, num: 1, score: [20, 10] }, { level: "sf", set: 2, num: 1 }])).toBe("playoffs-in-progress");
  });

  it("finals at one win each with both rows played is still playoffs-in-progress; two wins for one colour in the same finals set with every playoff row played is complete", () => {
    const earlier: RowSpec[] = [qm(1, true), { level: "sf", set: 1, num: 1, score: [20, 10] }];
    expect(phaseOf([...earlier, { level: "f", set: 1, num: 1, score: [30, 10] }, { level: "f", set: 1, num: 2, score: [10, 30] }])).toBe("playoffs-in-progress");
    expect(phaseOf([...earlier, { level: "f", set: 1, num: 1, score: [30, 10] }, { level: "f", set: 1, num: 2, score: [40, 10] }])).toBe("complete");
  });

  it("a finals series won two to zero is not complete while a playoff row is still unplayed", () => {
    const specs: RowSpec[] = [qm(1, true), { level: "sf", set: 1, num: 1 }, { level: "f", set: 1, num: 1, score: [30, 10] }, { level: "f", set: 1, num: 2, score: [40, 10] }];
    expect(phaseOf(specs)).toBe("playoffs-in-progress");
  });

  it("a playoff only event (no qualification rows) with unplayed filled rows is alliances-posted, and with one played row is playoffs-in-progress", () => {
    expect(phaseOf([{ level: "sf", set: 1, num: 1 }, { level: "sf", set: 2, num: 1 }])).toBe("alliances-posted");
    expect(phaseOf([{ level: "sf", set: 1, num: 1, score: [20, 10] }, { level: "sf", set: 2, num: 1 }])).toBe("playoffs-in-progress");
  });

  it("a playoff only event whose rows are all placeholders and whose alliances are unknown is schedule-posted", () => {
    expect(phaseOf([{ level: "sf", set: 1, num: 1, emptySide: true }])).toBe("schedule-posted");
  });

  it("complete followed by a new unplayed playoff row derives playoffs-in-progress again (a phase can move backward)", () => {
    const decided: RowSpec[] = [qm(1, true), { level: "f", set: 1, num: 1, score: [30, 10] }, { level: "f", set: 1, num: 2, score: [40, 10] }];
    expect(phaseOf(decided)).toBe("complete");
    expect(phaseOf([...decided, { level: "f", set: 1, num: 3 }])).toBe("playoffs-in-progress");
  });
});

describe("endpointsToPoll", () => {
  const NOW = Date.parse("2026-10-03T23:00:00.000Z");
  const recent = new Date(NOW - 60_000).toISOString();
  const old = new Date(NOW - OFFICIAL_DATA_SETTLE_MS - 60_000).toISOString();
  const state = (over: Partial<LiveIngestState>): LiveIngestState => ({ ...DEFAULT_LIVE_INGEST_STATE, ...over });

  it("no-schedule and schedule-posted poll neither endpoint", () => {
    expect(endpointsToPoll("no-schedule", state({}), NOW)).toEqual({ rankings: false, alliances: false });
    expect(endpointsToPoll("schedule-posted", state({}), NOW)).toEqual({ rankings: false, alliances: false });
  });

  it("quals-in-progress polls rankings only; quals-complete and alliances-posted poll both", () => {
    expect(endpointsToPoll("quals-in-progress", state({}), NOW)).toEqual({ rankings: true, alliances: false });
    expect(endpointsToPoll("quals-complete", state({}), NOW)).toEqual({ rankings: true, alliances: true });
    expect(endpointsToPoll("alliances-posted", state({}), NOW)).toEqual({ rankings: true, alliances: true });
  });

  it("playoffs-in-progress always polls alliances, and polls rankings only when never seen or changed within the settle window", () => {
    expect(endpointsToPoll("playoffs-in-progress", state({}), NOW)).toEqual({ rankings: true, alliances: true });
    expect(endpointsToPoll("playoffs-in-progress", state({ rankingsSeen: true, rankingsChangedAt: recent }), NOW)).toEqual({ rankings: true, alliances: true });
    expect(endpointsToPoll("playoffs-in-progress", state({ rankingsSeen: true, rankingsChangedAt: old }), NOW)).toEqual({ rankings: false, alliances: true });
    expect(endpointsToPoll("playoffs-in-progress", state({ alliancesSeen: true, rankingsSeen: true, rankingsChangedAt: old }), NOW).alliances).toBe(true);
  });

  it("complete polls each endpoint only when it was never seen or changed within the settle window", () => {
    expect(endpointsToPoll("complete", state({}), NOW)).toEqual({ rankings: true, alliances: true });
    expect(endpointsToPoll("complete", state({ rankingsSeen: true, rankingsChangedAt: old, alliancesSeen: true, alliancesChangedAt: old }), NOW)).toEqual({ rankings: false, alliances: false });
    expect(endpointsToPoll("complete", state({ rankingsSeen: true, rankingsChangedAt: recent, alliancesSeen: true, alliancesChangedAt: old }), NOW)).toEqual({ rankings: true, alliances: false });
    expect(endpointsToPoll("complete", state({ rankingsSeen: true, rankingsChangedAt: old, alliancesSeen: true, alliancesChangedAt: recent }), NOW)).toEqual({ rankings: false, alliances: true });
  });

  it("a seen endpoint with no change time recorded is treated as settled, not polled forever", () => {
    expect(endpointsToPoll("complete", state({ rankingsSeen: true, alliancesSeen: true }), NOW)).toEqual({ rankings: false, alliances: false });
  });
});
