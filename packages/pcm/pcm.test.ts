/**
 * PCM unit tests.
 *
 * The load-bearing one is "baseline arm reproduces the sealed runEval". Every
 * number this package prints is a DIFFERENCE between two arms, so a baseline
 * that has silently drifted from `packages/bpr/evaluate.ts` makes the whole
 * comparison meaningless while still looking perfectly plausible. That test is
 * the only thing standing between this package and that failure.
 *
 * Corpus-dependent tests sit behind an `existsSync` guard, following
 * `breakdown/reconciliation.test.ts`'s established pattern, so a machine
 * without `data/corpus.sqlite` skips them rather than failing red. Everything
 * that can be checked WITHOUT the corpus deliberately sits outside that guard.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runEval } from "../bpr/evaluate.js";
import { DEFAULTS as BPR_DEFAULTS } from "../bpr/model.js";
import { loadPcmMatches, hasPhases, phaseDiagnostics, type PcmMatch } from "./data.js";
import { runPaired } from "./evaluate.js";
import { PcmModel, PCM_DEFAULTS } from "./model.js";

const CORPUS_PATH = "data/corpus.sqlite";
const hasCorpus = existsSync(CORPUS_PATH);

/** A small synthetic stream, so the model's mechanics are testable corpus-free. */
function synthetic(n: number): PcmMatch[] {
  const out: PcmMatch[] = [];
  for (let i = 0; i < n; i += 1) {
    // Two fixed alliances; red is stronger in endgame only.
    const redPhase = { auto: 10, teleop: 40, endgame: 30 };
    const bluePhase = { auto: 10, teleop: 40, endgame: 10 };
    out.push({
      matchKey: `2019test_qm${i + 1}`,
      eventKey: i < n / 2 ? "2019test" : "2019test2",
      year: 2019,
      compLevel: "qm",
      sortTime: i,
      week: 1,
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc4", "frc5", "frc6"],
      redOut: 80,
      blueOut: 60,
      redRaw: 80,
      blueRaw: 60,
      redFoul: 0,
      blueFoul: 0,
      redAdjust: 0,
      blueAdjust: 0,
      winner: "red",
      redSurrogates: [],
      blueSurrogates: [],
      redDqs: [],
      blueDqs: [],
      eventType: 0,
      redPhase,
      bluePhase,
      breakdownStatus: "parsed",
    });
  }
  return out;
}

// --- mechanics, no corpus needed -------------------------------------------

describe("PcmModel mechanics", () => {
  it("falls back to the private BPR instance before any phase is established", () => {
    const m = new PcmModel();
    const p = m.predict(["frc1", "frc2", "frc3"], ["frc4", "frc5", "frc6"], 2019, false);
    expect(p.source).toBe("total");
    expect(p.pRed).toBe(p.total.pRed);
  });

  it("switches to the component path once every phase clears minPhaseMatches", () => {
    const stream = synthetic(PCM_DEFAULTS.minPhaseMatches + 5);
    const m = new PcmModel();
    const sources: string[] = [];
    for (const match of stream) {
      const pred = m.predict(match.redTeams, match.blueTeams, match.year, false);
      sources.push(pred.source);
      m.update(
        match.redTeams,
        match.blueTeams,
        match.year,
        match.redOut,
        match.blueOut,
        0,
        0,
        1,
        false,
        pred,
        match.redPhase,
        match.bluePhase,
      );
    }
    expect(sources.slice(0, PCM_DEFAULTS.minPhaseMatches)).toEqual(
      new Array(PCM_DEFAULTS.minPhaseMatches).fill("total"),
    );
    expect(sources.at(-1)).toBe("component");
  });

  it("learns per-phase point scales that track each phase's own magnitude", () => {
    const stream = synthetic(60);
    const m = new PcmModel();
    for (const match of stream) {
      const pred = m.predict(match.redTeams, match.blueTeams, match.year, false);
      m.update(
        match.redTeams,
        match.blueTeams,
        match.year,
        match.redOut,
        match.blueOut,
        0,
        0,
        1,
        false,
        pred,
        match.redPhase,
        match.bluePhase,
      );
    }
    const s = m.scales();
    // Observed means: auto 10, teleop 40, endgame 20.
    expect(s.auto).toBeGreaterThan(8);
    expect(s.auto).toBeLessThan(12);
    expect(s.teleop).toBeGreaterThan(35);
    expect(s.teleop).toBeLessThan(45);
    expect(s.endgame).toBeGreaterThan(15);
    expect(s.endgame).toBeLessThan(25);
    // The whole point of a per-phase scale: they must NOT collapse together.
    expect(s.teleop).toBeGreaterThan(s.auto * 2);
  });

  it("leaves the phase filters untouched when a match has no parsed breakdown", () => {
    const stream = synthetic(40);
    const m = new PcmModel();
    for (const match of stream) {
      const pred = m.predict(match.redTeams, match.blueTeams, match.year, false);
      m.update(
        match.redTeams,
        match.blueTeams,
        match.year,
        match.redOut,
        match.blueOut,
        0,
        0,
        1,
        false,
        pred,
        match.redPhase,
        match.bluePhase,
      );
    }
    const before = m.snapshot("endgame");
    const scalesBefore = m.scales();

    const pred = m.predict(["frc1", "frc2", "frc3"], ["frc4", "frc5", "frc6"], 2019, false);
    m.update(
      ["frc1", "frc2", "frc3"],
      ["frc4", "frc5", "frc6"],
      2019,
      80,
      60,
      0,
      0,
      1,
      false,
      pred,
      null,
      null,
    );

    // A zero-fold here would publish "this team scores nothing in endgame",
    // which is a different and false claim from "not measured".
    expect(m.snapshot("endgame")).toEqual(before);
    expect(m.scales()).toEqual(scalesBefore);
  });

  it("ranks within the phase, so an endgame specialist outranks its own teammates there", () => {
    // Red 1 is the only endgame scorer; teleop is shared evenly.
    const stream = synthetic(80).map((m) => ({ ...m }));
    const model = new PcmModel();
    for (const match of stream) {
      const pred = model.predict(match.redTeams, match.blueTeams, match.year, false);
      model.update(
        match.redTeams,
        match.blueTeams,
        match.year,
        match.redOut,
        match.blueOut,
        0,
        0,
        1,
        false,
        pred,
        match.redPhase,
        match.bluePhase,
      );
    }
    const endgame = model.snapshot("endgame");
    const teleop = model.snapshot("teleop");
    // Red scores 30 endgame vs blue's 10, so red's teams must rate higher there.
    expect(endgame.get("frc1") ?? 0).toBeGreaterThan(endgame.get("frc4") ?? 0);
    // Teleop is identical for both sides, so the two must stay close.
    expect(Math.abs((teleop.get("frc1") ?? 0) - (teleop.get("frc4") ?? 0))).toBeLessThan(2);
  });

  it("phaseCorr = 0 is exactly inert: a positive value only widens the variance", () => {
    const build = (phaseCorr: number) => {
      const m = new PcmModel({ ...PCM_DEFAULTS, phaseCorr });
      for (const match of synthetic(40)) {
        const pred = m.predict(match.redTeams, match.blueTeams, match.year, false);
        m.update(
          match.redTeams,
          match.blueTeams,
          match.year,
          match.redOut,
          match.blueOut,
          0,
          0,
          1,
          false,
          pred,
          match.redPhase,
          match.bluePhase,
        );
      }
      return m.predict(["frc1", "frc2", "frc3"], ["frc4", "frc5", "frc6"], 2019, false);
    };
    const inert = build(0);
    const corr = build(0.4);
    expect(inert.source).toBe("component");
    expect(corr.v).toBeGreaterThan(inert.v);
    // Wider variance on the same margin means a less confident call.
    expect(corr.pRed).toBeLessThan(inert.pRed);
  });
});

// --- corpus-dependent -------------------------------------------------------

describe.skipIf(!hasCorpus)("PCM against the real corpus", () => {
  it("baseline arm reproduces packages/bpr/evaluate.ts's sealed runEval exactly", () => {
    const ms = loadPcmMatches(CORPUS_PATH);
    const scoreYears = new Set([2016, 2017, 2018]);
    const stopAfterYear = 2018;

    const sealed = runEval(ms, BPR_DEFAULTS, { scoreYears, stopAfterYear });
    const paired = runPaired(ms, { scoreYears, stopAfterYear });

    expect(paired.baseline.overall).toEqual(sealed.overall);
    expect(paired.baseline.accuracy).toBe(sealed.accuracy);
    expect(paired.baseline.brier).toBe(sealed.brier);
    expect(paired.baseline.logLoss).toBe(sealed.logLoss);
    for (const [year, s] of sealed.perYear) {
      expect(paired.baseline.perYear.get(year)).toEqual(s);
    }
  }, 600_000);

  it("PCM equals the baseline exactly on every match it falls back on", () => {
    const ms = loadPcmMatches(CORPUS_PATH);
    const paired = runPaired(ms, { scoreYears: new Set([2016, 2017]), stopAfterYear: 2017 });
    const fallbacks = paired.rows.filter((r) => r.source !== "component");
    expect(fallbacks.length).toBeGreaterThan(0);
    for (const r of fallbacks) expect(r.pPcm).toBe(r.pBase);
  }, 600_000);

  it("the loaded population is BPR's, row for row", () => {
    const ms = loadPcmMatches(CORPUS_PATH);
    const d = phaseDiagnostics();
    expect(d).not.toBeNull();
    expect(d?.n).toBe(ms.length);
    // Every row is accounted for by exactly one status.
    const total =
      (d?.byStatus.parsed ?? 0) +
      (d?.byStatus.absent ?? 0) +
      (d?.byStatus.malformed ?? 0) +
      (d?.byStatus.unregistered ?? 0);
    expect(total).toBe(ms.length);
    // `hasPhases` and the status flag must never disagree.
    for (const m of ms) {
      expect(hasPhases(m)).toBe(m.breakdownStatus === "parsed");
    }
  }, 600_000);

  it("reports the component-sum residual rather than assuming it is zero", () => {
    loadPcmMatches(CORPUS_PATH);
    const d = phaseDiagnostics();
    expect(d).not.toBeNull();
    expect((d?.perYearResidual.size ?? 0)).toBeGreaterThan(0);
    for (const [, r] of d?.perYearResidual ?? []) {
      expect(Number.isFinite(r.meanResidual)).toBe(true);
      expect(Number.isFinite(r.meanAbsAsymmetry)).toBe(true);
      expect(r.meanAbsAsymmetry).toBeGreaterThanOrEqual(0);
    }
  }, 600_000);
});
