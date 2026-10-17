/**
 * The late score breakdown backfill's pure parts (quick task 261017-doy): which
 * published rows have a gap, what a raw match can now supply, and how a row is
 * patched: a null is filled, a number is never overwritten, and a row the
 * facts cannot improve is the same object it was.
 */
import { describe, expect, it } from "vitest";
import { tbaMatchListSchema, type TbaMatch } from "../../../packages/ingest/schemas.js";
import { lateBreakdownFactsFor, patchRowsWithLateBreakdowns, rowHasBreakdownGap, type BreakdownPatchableRow } from "../src/lateBreakdownBackfill.js";

const EVENT_KEY = "2026ncfay";
const EVENT_START_ISO = "2026-10-17T12:00:00.000Z";
const SEASON = 2026;
/** An offseason event: RP-eligible in `isRpEligibleEventType`, so bonus flags publish. */
const OFFSEASON = 99;

/** A 2026 breakdown side in the shape `packages/core/rankingPoints/2026.ts` parses. */
function side(rp: number, fuel: number, tower: number) {
  return {
    rp,
    autoTowerPoints: tower,
    endGameTowerPoints: 0,
    hubScore: { totalCount: fuel, cycles: [] },
    energizedAchieved: false,
    superchargedAchieved: false,
    traversalAchieved: false,
  };
}

function raw(key: string, matchNumber: number, options: { played?: boolean; breakdown?: unknown; compLevel?: "qm" | "f" } = {}): TbaMatch {
  const played = options.played ?? true;
  return tbaMatchListSchema.parse([
    {
      key,
      event_key: EVENT_KEY,
      comp_level: options.compLevel ?? "qm",
      set_number: 1,
      match_number: matchNumber,
      time: 1_792_246_000 + matchNumber * 600,
      predicted_time: null,
      actual_time: null,
      winning_alliance: played ? "red" : "",
      alliances: {
        red: { team_keys: ["frc4561", "frc4795", "frc3229"], surrogate_team_keys: [], dq_team_keys: [], score: played ? 259 : null },
        blue: { team_keys: ["frc11179", "frc587", "frc3893"], surrogate_team_keys: [], dq_team_keys: [], score: played ? 81 : null },
      },
      score_breakdown: options.breakdown === undefined ? { red: side(4, 300, 20), blue: side(0, 10, 0) } : options.breakdown,
    },
  ])[0]!;
}

interface Row extends BreakdownPatchableRow {
  readonly predictedRedScore: number;
}

function row(matchKey: string, overrides: Partial<Row> = {}): Row {
  return {
    matchKey,
    compLevel: "qm",
    redTeams: ["frc4561", "frc4795", "frc3229"],
    blueTeams: ["frc11179", "frc587", "frc3893"],
    predictedRedScore: 100,
    actualWinner: "red",
    actualRedRp: null,
    actualBlueRp: null,
    actualRedBonusRp: null,
    actualBlueBonusRp: null,
    ...overrides,
  };
}

describe("rowHasBreakdownGap", () => {
  it("an unplayed row never has a gap, a played row with null ranking points does", () => {
    expect(rowHasBreakdownGap(row("2026ncfay_qm1", { actualWinner: undefined, actualRedRp: undefined, actualBlueRp: undefined }))).toBe(false);
    expect(rowHasBreakdownGap(row("2026ncfay_qm1"))).toBe(true);
    expect(rowHasBreakdownGap(row("2026ncfay_qm1", { actualRedRp: 4, actualBlueRp: null }))).toBe(true);
  });

  it("a fully published qualification row has none; a playoff row needs ranking points but no bonus arrays", () => {
    expect(rowHasBreakdownGap(row("2026ncfay_qm1", { actualRedRp: 4, actualBlueRp: 0, actualRedBonusRp: [true, false, false], actualBlueBonusRp: [false, false, false] }))).toBe(false);
    expect(rowHasBreakdownGap(row("2026ncfay_qm1", { actualRedRp: 4, actualBlueRp: 0 }))).toBe(true);
    expect(rowHasBreakdownGap(row("2026ncfay_f1m1", { compLevel: "f", actualRedRp: 0, actualBlueRp: 0 }))).toBe(false);
  });
});

describe("lateBreakdownFactsFor", () => {
  it("supplies ranking points and bonus flags for a played match with a breakdown, and nothing for one without", () => {
    const matches = [raw("2026ncfay_qm1", 1), raw("2026ncfay_qm2", 2, { breakdown: null }), raw("2026ncfay_qm3", 3, { played: false })];
    const facts = lateBreakdownFactsFor(matches, ["2026ncfay_qm1", "2026ncfay_qm2", "2026ncfay_qm3", "2026ncfay_qm99"], SEASON, OFFSEASON, EVENT_START_ISO);
    expect([...facts.keys()]).toEqual(["2026ncfay_qm1"]);
    const qm1 = facts.get("2026ncfay_qm1")!;
    expect(qm1.actualRedRp).toBe(4);
    expect(qm1.actualBlueRp).toBe(0);
    expect(qm1.actualBonusFlags).not.toBeNull();
    expect(qm1.actualBonusFlags).not.toBeUndefined();
    expect(qm1.actualBonusFlags!.red).toHaveLength(3);
    expect(qm1.actualBonusFlags!.blue).toHaveLength(3);
  });

  it("a breakdown without an integer rp field still gives no ranking points, never a coerced zero", () => {
    const matches = [raw("2026ncfay_qm1", 1, { breakdown: { red: { ...side(4, 300, 20), rp: 32.5 }, blue: side(0, 10, 0) } })];
    const facts = lateBreakdownFactsFor(matches, ["2026ncfay_qm1"], SEASON, OFFSEASON, EVENT_START_ISO);
    expect(facts.get("2026ncfay_qm1")!.actualRedRp).toBeNull();
    expect(facts.get("2026ncfay_qm1")!.actualBlueRp).toBe(0);
  });

  it("the failed-detail sentinel event type withholds the bonus flags and nothing else", () => {
    const facts = lateBreakdownFactsFor([raw("2026ncfay_qm1", 1)], ["2026ncfay_qm1"], SEASON, -1, EVENT_START_ISO);
    expect(facts.get("2026ncfay_qm1")!.actualRedRp).toBe(4);
    expect(facts.get("2026ncfay_qm1")!.actualBonusFlags).toBeNull();
  });
});

describe("patchRowsWithLateBreakdowns", () => {
  const facts = lateBreakdownFactsFor([raw("2026ncfay_qm1", 1), raw("2026ncfay_qm2", 2)], ["2026ncfay_qm1", "2026ncfay_qm2"], SEASON, OFFSEASON, EVENT_START_ISO);

  it("fills null ranking points and bonus arrays on a played row, keeps every other field, and returns a new array with a new row object", () => {
    const rows = [row("2026ncfay_qm1"), row("2026ncfay_qm2", { actualRedRp: 3, actualBlueRp: 0, actualRedBonusRp: [false, false, false], actualBlueBonusRp: [false, false, false] })];
    const patched = patchRowsWithLateBreakdowns(rows, facts);
    expect(patched.patchedKeys).toEqual(["2026ncfay_qm1"]);
    expect(patched.rows).not.toBe(rows);
    expect(patched.rows[0]).not.toBe(rows[0]);
    expect(patched.rows[0]).toMatchObject({ matchKey: "2026ncfay_qm1", predictedRedScore: 100, actualWinner: "red", actualRedRp: 4, actualBlueRp: 0 });
    expect(patched.rows[0]!.actualRedBonusRp).toEqual(facts.get("2026ncfay_qm1")!.actualBonusFlags!.red);
    expect(patched.rows[0]!.actualRedBonusRp).not.toBe(facts.get("2026ncfay_qm1")!.actualBonusFlags!.red);
    // The already complete row is the same object.
    expect(patched.rows[1]).toBe(rows[1]);
  });

  it("never overwrites a published number, even one that disagrees with the breakdown", () => {
    const rows = [row("2026ncfay_qm1", { actualRedRp: 2, actualBlueRp: null, actualRedBonusRp: [true, true, true], actualBlueBonusRp: null })];
    const patched = patchRowsWithLateBreakdowns(rows, facts);
    expect(patched.patchedKeys).toEqual(["2026ncfay_qm1"]);
    expect(patched.rows[0]).toMatchObject({ actualRedRp: 2, actualBlueRp: 0, actualRedBonusRp: [true, true, true] });
    expect(patched.rows[0]!.actualBlueBonusRp).toEqual(facts.get("2026ncfay_qm1")!.actualBonusFlags!.blue);
  });

  it("returns the same array when no row can be improved: no facts, an unplayed row, or a null fact", () => {
    const rows = [row("2026ncfay_qm7"), row("2026ncfay_qm8", { actualWinner: undefined })];
    expect(patchRowsWithLateBreakdowns(rows, facts).rows).toBe(rows);
    const nullFacts = new Map([["2026ncfay_qm7", { actualRedRp: null, actualBlueRp: null, actualBonusFlags: null }]]);
    expect(patchRowsWithLateBreakdowns(rows, nullFacts).rows).toBe(rows);
  });

  it("writes no bonus array on a playoff row", () => {
    const playoffFacts = lateBreakdownFactsFor([raw("2026ncfay_f1m1", 1, { compLevel: "f" })], ["2026ncfay_f1m1"], SEASON, OFFSEASON, EVENT_START_ISO);
    const rows = [row("2026ncfay_f1m1", { compLevel: "f", actualRedBonusRp: undefined, actualBlueBonusRp: undefined })];
    const patched = patchRowsWithLateBreakdowns(rows, playoffFacts);
    expect(patched.patchedKeys).toEqual(["2026ncfay_f1m1"]);
    expect(patched.rows[0]).toMatchObject({ actualRedRp: 4, actualBlueRp: 0 });
    expect(patched.rows[0]!.actualRedBonusRp).toBeUndefined();
    expect(patched.rows[0]!.actualBlueBonusRp).toBeUndefined();
  });
});
