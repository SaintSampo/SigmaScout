/**
 * Offline tests for the replay-parity instrument (260917-mwu). The CLI's
 * corpus/publisher half is not exercised here — the instrument's own run is
 * what measures that; every pure function under it is.
 *
 * Three groups carry weight:
 *
 * 1. THE STATIC SAFETY SCAN, copied from `priceFrozenEventRow.test.ts`: the
 *    instruments must import no R2 client, no signing SDK, must never `fetch`
 *    and must never read an environment variable. Asserted against the source
 *    rather than trusted to care, with a positive control so a regex that
 *    stopped matching would fail instead of passing vacuously.
 * 2. THE COMPARATOR'S KEY-PRESENCE STRICTNESS. An absent key and an explicit
 *    `null` are different published claims throughout this codebase; a
 *    comparator that conflated them would report a false pass on exactly the
 *    fields (`actualRedBonusRp`, `coldStart`, `redRpPmf`) where absence is the
 *    interesting answer.
 * 3. THE PASSENGER-CHAIN DEEP COPY. `sigmaBeliefs()` and `rpVariableBeliefs()`
 *    are read mid-stream to build a PRE-EVENT block; if either handed back a
 *    live reference into the accumulator, the block would silently carry
 *    end-of-season values and arm R would look far better than it is. The
 *    accumulators do copy today — these tests PIN that rather than assume it.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SigmaScoreAccumulator } from "../packages/harness/sigmaScore.js";
import { SigmaScoutLayer } from "../packages/harness/sigmaScoutLayer.js";
import { RP_RULE_MODULES } from "../packages/core/rankingPoints/rules.js";
import { ROUNDING_RULE } from "../packages/harness/rounding.js";
import type { MatchResult, Prediction } from "../packages/core/algorithms/types.js";
import {
  attributeField,
  compareAll,
  decimalsForField,
  deepStrictEqual,
  EVENT_ROW_FIELDS,
  fieldsEqual,
  maxAbsDiff,
  minHeadroomOf,
  parseEventsArg,
  roundMetricsRecord,
  truthRowsFor,
  wireForm,
  type ArmRows,
} from "./measureReplayParity.js";
import { MirrorFold, MIRROR_FOLD_MARKER } from "./replayParityMirror.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The source with block and line comments removed. The "must NOT contain"
 * assertions run against THIS, not the raw text: a file that documents in prose
 * that it never passes `--write-budget` would otherwise fail the assertion that
 * it never passes `--write-budget`, which would teach the next author to delete
 * the documentation rather than keep the guarantee.
 */
function codeOf(source: string): string {
  // `[^:]` before `//` so a `https://` inside a string is not mistaken for a
  // line comment and used to blank the rest of a real line.
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const IMPORT_RE = /(?:^|\n)[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g;

/**
 * Every instrument file this task adds. Task 3's two files are appended to this
 * list when they land, so the scan never silently skips a file it should cover —
 * `existsSync` is deliberately NOT used to make an absent file pass.
 */
const INSTRUMENT_FILES = ["measureReplayParity.ts", "replayParityMirror.ts"];
/** The files that must bundle for a browser page: no Node built-in, no corpus, no publisher. */
const BROWSER_SAFE_FILES = ["replayParityMirror.ts"];

describe("the instruments cannot reach the network, a bucket, or a secret", () => {
  for (const file of INSTRUMENT_FILES) {
    it(`${file} imports no R2 client, no S3 or signing SDK, and never fetches or reads an environment variable`, () => {
      const source = readFileSync(resolve(HERE, file), "utf8");
      const specifiers = [...source.matchAll(IMPORT_RE)].map((m) => m[1]!);
      expect(specifiers.length).toBeGreaterThan(2);
      expect(specifiers.filter((s) => /r2Client|@aws-sdk|aws4fetch|aws-sdk|signature|sigv4|wrangler/i.test(s))).toEqual([]);
      // Positive control: the same regex still catches a synthetic forbidden import.
      const control = [...`import { putObject } from "../packages/harness/r2Client.js";`.matchAll(IMPORT_RE)].map((m) => m[1]!);
      expect(control.filter((s) => /r2Client/.test(s))).toHaveLength(1);
      // No environment read at all — so these need no `.env` and no secret can
      // reach a log line. `process.argv`/`process.stdout` are fine.
      expect(source).not.toMatch(/process\.env/);
      // The documented USAGE lines must never teach anyone to hand an
      // instrument a secrets file. The header's prose rule is deliberately not
      // what this matches.
      expect(source).not.toMatch(/tsx[^\n]*--env-file/);
    });
  }

  it("measureReplayParity never fetches, and always runs the publisher as an inert dry run", () => {
    const source = readFileSync(resolve(HERE, "measureReplayParity.ts"), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).toMatch(/dryRun:\s*true/);
    expect(source).toMatch(/skipState:\s*true/);
    // The corpus is opened read-only and never written.
    expect(source).toMatch(/openCorpusReadOnly/);
    const code = codeOf(source);
    expect(code).not.toMatch(/\b(insert|update|delete|drop)\s+(into|from|table)\b/i);
    // The generation marker could not be mistaken for a real 36-char UUID.
    expect(source).toMatch(/NOT-A-GENERATION/);
    // `--write-budget` is never passed, and no publish option that would write
    // the budget doc or the seed SQL is ever set. Checked against the CODE, so
    // the header may go on documenting the guarantee in prose.
    expect(code).not.toMatch(/write-?budget/i);
    expect(code).not.toMatch(/dryRun:\s*false/);
    expect(code).not.toMatch(/skipState:\s*false/);
    // Positive controls for the comment stripper, so a stripper that blanked
    // the whole file would fail here instead of making every check above vacuous.
    expect(code).toMatch(/dryRun:\s*true/);
    expect(codeOf("/* --write-budget */ const a = 1;")).not.toMatch(/write-?budget/i);
    expect(codeOf('const flag = "--write-budget";')).toMatch(/write-?budget/i);
  });

  it("the browser-side modules import nothing Node-bound, so the bundle is real rather than stubbed", () => {
    for (const file of BROWSER_SAFE_FILES) {
      const specifiers = [...readFileSync(resolve(HERE, file), "utf8").matchAll(IMPORT_RE)].map((m) => m[1]!);
      expect(specifiers.filter((s) => /node:|packages\/corpus|better-sqlite3|harness\/publish|harness\/replay/.test(s))).toEqual([]);
    }
  });
});

describe("the comparator treats an absent key and an explicit null as different published claims", () => {
  it("fails when one side omits a key the other sets to null", () => {
    expect(fieldsEqual({ actualRedBonusRp: null }, {}, "actualRedBonusRp")).toBe(false);
    expect(fieldsEqual({}, { actualRedBonusRp: null }, "actualRedBonusRp")).toBe(false);
  });

  it("passes when both sides omit the key", () => {
    expect(fieldsEqual({}, {}, "coldStart")).toBe(true);
  });

  it("fails when one side omits `coldStart` and the other sets it true", () => {
    expect(fieldsEqual({ coldStart: true }, {}, "coldStart")).toBe(false);
  });

  it("compares arrays elementwise with no tolerance", () => {
    expect(fieldsEqual({ redRpPmf: [0.1, 0.9] }, { redRpPmf: [0.1, 0.9] }, "redRpPmf")).toBe(true);
    expect(fieldsEqual({ redRpPmf: [0.1, 0.9] }, { redRpPmf: [0.1, 0.90001] }, "redRpPmf")).toBe(false);
    expect(fieldsEqual({ redRpPmf: [0.1, 0.9] }, { redRpPmf: [0.1, 0.9, 0] }, "redRpPmf")).toBe(false);
  });

  it("distinguishes -0 from 0 and treats NaN as equal to itself, so a sign flip is never absorbed", () => {
    expect(deepStrictEqual(0, -0)).toBe(false);
    expect(deepStrictEqual(Number.NaN, Number.NaN)).toBe(true);
  });

  it("compares nested objects by key set, so an extra key fails", () => {
    expect(deepStrictEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepStrictEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });
});

describe("the wire form is what the published bytes carry", () => {
  it("drops an undefined-valued key exactly as JSON.stringify does, and keeps an explicit null", () => {
    const wire = wireForm({ a: 1, b: undefined, c: null });
    expect(Object.prototype.hasOwnProperty.call(wire, "b")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(wire, "c")).toBe(true);
    expect(wire.c).toBeNull();
  });
});

describe("magnitude and rounding reporting", () => {
  it("reports the largest elementwise difference for arrays and plain numbers", () => {
    expect(maxAbsDiff(1, 1.25)).toBeCloseTo(0.25, 12);
    expect(maxAbsDiff([1, 2, 3], [1, 2.5, 3])).toBeCloseTo(0.5, 12);
    expect(maxAbsDiff("red", "blue")).toBeUndefined();
  });

  it("quotes each field's rounding rule from ROUNDING_RULE, never from a literal", () => {
    expect(decimalsForField("pRedWin")).toBe(ROUNDING_RULE.probability);
    expect(decimalsForField("predictedRedScore")).toBe(ROUNDING_RULE.score);
    expect(decimalsForField("redRpPmf")).toBe(ROUNDING_RULE.pmf);
    expect(decimalsForField("redMatchBandVariance")).toBe(ROUNDING_RULE.variance);
    expect(decimalsForField("variance")).toBe(ROUNDING_RULE.variance);
    expect(decimalsForField("value")).toBe(ROUNDING_RULE.metric);
    expect(decimalsForField("predictedWinner")).toBeUndefined();
  });
});

describe("the attribution taxonomy is closed and pre-registered", () => {
  it("calls a passthrough or stamp difference a BUG, never a model finding", () => {
    for (const field of ["actualRedScore", "actualWinner", "actualRedRp", "coldStart", "season", "algorithmVersion"]) {
      expect(attributeField(field, true)).toBe("BUG");
      expect(attributeField(field, false)).toBe("BUG");
    }
  });

  it("calls a difference WIRE only when arm R' repairs it, and INTERLEAVE when it does not", () => {
    expect(attributeField("pRedWin", false)).toBe("WIRE");
    expect(attributeField("pRedWin", true)).toBe("INTERLEAVE");
  });

  it("covers every compared event-row field with some attribution", () => {
    for (const field of EVENT_ROW_FIELDS) {
      expect(["WIRE", "INTERLEAVE", "POPULATION", "ENGINE", "BUG"]).toContain(attributeField(field, true));
    }
  });
});

describe("the passenger chain is deep-copied at the capture instant", () => {
  const RED = ["frc254", "frc1678", "frc971"];
  const BLUE = ["frc2481", "frc1323", "frc604"];

  function match(matchKey: string, redScore: number, blueScore: number): MatchResult {
    return {
      matchKey,
      eventKey: "2026casj",
      season: 2026,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: Number(matchKey.replace(/\D/g, "")),
      redTeams: RED,
      blueTeams: BLUE,
      redSurrogates: [],
      blueSurrogates: [],
      redDqs: [],
      blueDqs: [],
      redScore,
      blueScore,
      winner: redScore > blueScore ? "red" : blueScore > redScore ? "blue" : "tie",
      redRpEarned: null,
      blueRpEarned: null,
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
      eventType: 0,
      week: 1,
    } as unknown as MatchResult;
  }

  const prediction = (redScore: number, blueScore: number): Prediction =>
    ({ winner: "red", pRedWin: 0.5, redScore, blueScore }) as unknown as Prediction;

  it("a Sigma belief map captured mid-stream does not move when the layer keeps folding", () => {
    const layer = new SigmaScoutLayer(RP_RULE_MODULES[2026], "spr");
    layer.foldPlayed(match("2026casj_qm1", 100, 50), prediction(80, 60));
    const captured = layer.sigmaBeliefs();
    const snapshot = JSON.stringify([...captured].sort());
    // Keep folding — very different scores, so any live reference would move.
    for (let i = 2; i <= 12; i++) layer.foldPlayed(match(`2026casj_qm${i}`, 10, 300), prediction(150, 20));
    expect(JSON.stringify([...captured].sort())).toBe(snapshot);
    expect(JSON.stringify([...layer.sigmaBeliefs()].sort())).not.toBe(snapshot);
  });

  it("an RP belief map and the mean-shift state captured mid-stream do not move either", () => {
    const layer = new SigmaScoutLayer(RP_RULE_MODULES[2026], "spr");
    layer.foldPlayed(match("2026casj_qm1", 100, 50), prediction(80, 60));
    const rp = JSON.stringify([...layer.rpVariableBeliefs()].sort());
    const shift = JSON.stringify(layer.rpMeanShiftState());
    const population = JSON.stringify(layer.sigmaPopulation());
    const capturedRp = layer.rpVariableBeliefs();
    const capturedShift = layer.rpMeanShiftState();
    const capturedPopulation = layer.sigmaPopulation();
    for (let i = 2; i <= 12; i++) layer.foldPlayed(match(`2026casj_qm${i}`, 10, 300), prediction(150, 20));
    expect(JSON.stringify([...capturedRp].sort())).toBe(rp);
    expect(JSON.stringify(capturedShift)).toBe(shift);
    expect(JSON.stringify(capturedPopulation)).toBe(population);
  });

  it("mutating a captured Sigma belief cannot reach the accumulator", () => {
    const accumulator = new SigmaScoreAccumulator();
    accumulator.observeTalent("frc254", 40);
    accumulator.foldAlliance(RED, 100, 80);
    const captured = accumulator.beliefsByTeam();
    const belief = captured.get("frc254")!;
    const before = accumulator.sigmaFor("frc254");
    belief.mean = 9999;
    belief.sumSquares = 9999;
    expect(accumulator.sigmaFor("frc254")).toBe(before);
  });
});

describe("the mirror is the class arm M gates, and it carries its bundle marker", () => {
  it("exposes the marker string the cross-engine bundle asserts", () => {
    expect(MIRROR_FOLD_MARKER).toContain("260917-mwu");
    expect(readFileSync(resolve(HERE, "replayParityMirror.ts"), "utf8")).toContain(MIRROR_FOLD_MARKER);
  });

  it("mirrors the real layer's constructor gating: a non-Sigma algorithm produces no band", () => {
    const mirror = new MirrorFold(RP_RULE_MODULES[2026], "opr");
    expect(mirror.sigmaFor("frc254")).toBeUndefined();
    const layer = new SigmaScoutLayer(RP_RULE_MODULES[2026], "opr");
    expect(layer.sigmaFor("frc254")).toBeUndefined();
  });

  it("re-implements no math: its source contains no transcendental call of its own", () => {
    const source = readFileSync(resolve(HERE, "replayParityMirror.ts"), "utf8");
    expect(source).not.toMatch(/Math\.(exp|log|log1p|sqrt|pow)\s*\(/);
  });
});

describe("row rounding matches the publisher's own record rounding", () => {
  it("rounds value and spread at ROUNDING_RULE.metric and emits no percentile", () => {
    const rounded = roundMetricsRecord({ total: { value: 1.23456, spread: 7.89123 }, sigma: { value: 3.14159 } }) as Record<
      string,
      Record<string, unknown>
    >;
    expect(rounded.total).toEqual({ value: 1.23, spread: 7.89 });
    expect(rounded.sigma).toEqual({ value: 3.14 });
    expect(Object.prototype.hasOwnProperty.call(rounded.sigma!, "percentile")).toBe(false);
  });

  it("omits spread when the source metric has none, rather than emitting undefined", () => {
    const rounded = roundMetricsRecord({ total: { value: 2 } }) as Record<string, Record<string, unknown>>;
    expect(Object.prototype.hasOwnProperty.call(rounded.total!, "spread")).toBe(false);
  });
});

describe("truth extraction and CLI parsing", () => {
  it("keeps only played team rows for the target event and ignores upcoming ones", () => {
    const teamBody = JSON.stringify({
      events: [
        {
          eventKey: "2026nyro",
          matches: [
            { matchKey: "2026nyro_qm1", actualWinner: "red" },
            { matchKey: "2026nyro_qm2" },
          ],
        },
        { eventKey: "2026casj", matches: [{ matchKey: "2026casj_qm1", actualWinner: "blue" }] },
      ],
      metricHistory: [
        { matchKey: "2026nyro_qm1", eventKey: "2026nyro", metrics: { total: { value: 1 } } },
        { matchKey: "2026casj_qm1", eventKey: "2026casj", metrics: { total: { value: 2 } } },
      ],
    });
    const truth = truthRowsFor({ events: new Map(), teams: new Map([["frc254", teamBody]]) }, "2026nyro");
    expect([...truth.team.keys()]).toEqual(["frc254|2026nyro_qm1"]);
    expect([...truth.history.keys()]).toEqual(["frc254|2026nyro_qm1"]);
  });

  it("defaults to the tracer event and splits a comma list", () => {
    expect(parseEventsArg(undefined)).toEqual(["2026nyro"]);
    expect(parseEventsArg("2026arc, 2026nyro ,2026auwarp")).toEqual(["2026arc", "2026nyro", "2026auwarp"]);
  });

  it("reports a field as differing when the arm produced no row at all, never as equal by absence", () => {
    const truth = {
      event: new Map([["m1", { pRedWin: 0.5 } as Record<string, unknown>]]),
      team: new Map<string, Record<string, unknown>>(),
      history: new Map<string, Record<string, unknown>>(),
    };
    const empty: ArmRows = {
      eventRows: new Map(),
      teamRows: new Map(),
      historyMetrics: new Map(),
      rawPredictions: new Map(),
      rawHistoryMetrics: new Map(),
      unroundedEventRows: new Map(),
      unroundedTeamRows: new Map(),
      unroundedHistory: new Map(),
    };
    const results = compareAll(truth, empty);
    const pRedWin = results.find((r) => r.surface === "event" && r.field === "pRedWin")!;
    expect(pRedWin.identical).toBe(false);
    expect(pRedWin.differingRows).toBe(1);
    expect(pRedWin.comparedRows).toBe(1);
  });

  it("marks a field the published rows never carry as VACUOUS, so an untested field cannot read as a pass", () => {
    // An RP-ineligible event publishes no `redRpPmf` at all. Both sides omit the
    // key, so it compares equal — and that equality means nothing. This is the
    // exact case `2026auwarp` (event_type 99) produces for the whole RP half.
    const row = { pRedWin: 0.5 } as Record<string, unknown>;
    const truth = {
      event: new Map([["m1", row]]),
      team: new Map<string, Record<string, unknown>>(),
      history: new Map<string, Record<string, unknown>>(),
    };
    const arm: ArmRows = {
      eventRows: new Map([["m1", { ...row }]]),
      teamRows: new Map(),
      historyMetrics: new Map(),
      rawPredictions: new Map(),
      rawHistoryMetrics: new Map(),
      unroundedEventRows: new Map(),
      unroundedTeamRows: new Map(),
      unroundedHistory: new Map(),
    };
    const results = compareAll(truth, arm);
    const rpPmf = results.find((r) => r.surface === "event" && r.field === "redRpPmf")!;
    expect(rpPmf.identical).toBe(true);
    expect(rpPmf.vacuous).toBe(true);
    expect(rpPmf.presentRows).toBe(0);
    // The field that IS published is tested, and says so.
    const present = results.find((r) => r.surface === "event" && r.field === "pRedWin")!;
    expect(present.vacuous).toBe(false);
    expect(present.presentRows).toBe(1);
  });

  it("reports the rounding headroom of a pmf array, not just of a scalar", () => {
    // 0.123455 sits half a unit from the 5-decimal boundary: headroom ~0.
    expect(minHeadroomOf([0.5, 0.123455], ROUNDING_RULE.pmf)).toBeLessThan(1e-6);
    // 0.5 is exactly on a representable 4-decimal value: maximum headroom.
    expect(minHeadroomOf(0.5, ROUNDING_RULE.probability)).toBeCloseTo(0.5, 9);
    expect(minHeadroomOf("red", ROUNDING_RULE.metric)).toBeUndefined();
  });
});
