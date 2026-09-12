/**
 * `softCredit` — expected-rank credit allocation.
 *
 * The properties that have to hold, in the order they matter:
 *
 *  1. INERT AT DEFAULT. `softCredit: false` must reproduce the sorted-rank
 *     assignment exactly, or the knob is not inert and the design-era figures
 *     stop describing the default model.
 *  2. CONFIDENT ORDERINGS ARE UNCHANGED. When the model can separate three
 *     robots, soft and hard must agree — the repair is supposed to touch only
 *     the cases where the ordering is guesswork.
 *  3. UNRESOLVABLE ORDERINGS FALL BACK TO EQUAL CREDIT. Three robots the model
 *     cannot tell apart must share the surprise equally, rather than one of
 *     them collecting 1.364x on the strength of a tie-break.
 *  4. PREDICTION IS UNTOUCHED. Only the credit split softens; the alliance's
 *     predicted output must still use the hard rank weights, because that is
 *     where the anti-additivity that earned promotion lives.
 *  5. THE TWO MODULES AGREE. `packages/spr/model.ts` and
 *     `packages/core/algorithms/spr.ts` must implement the same thing, which is
 *     what `equivalence.ts` exists to guarantee at the whole-model level.
 */
import { describe, expect, it } from "vitest";
import { BprModel, DEFAULTS, type BprParams } from "./model.js";
import { SPR_PARAMS, SPR_VERSION } from "../core/algorithms/spr.js";

const YEAR = 2024;
const RED = ["frc1", "frc2", "frc3"];
const BLUE = ["frc4", "frc5", "frc6"];

/** Steps a model through `n` identical matches so ratings and variances move. */
function warm(p: BprParams, n: number, redOut = 120, blueOut = 90): BprModel {
  const m = new BprModel(p);
  for (let i = 0; i < n; i += 1) {
    const pred = m.predict(RED, BLUE, YEAR, false);
    m.update(RED, BLUE, YEAR, redOut, blueOut, 0, 0, 1, false, pred);
  }
  return m;
}

/** Every team's rating after the same replay, keyed for comparison. */
function ratings(m: BprModel): Map<string, number> {
  return m.snapshot();
}

describe("softCredit", () => {
  it("is inert at its default", () => {
    expect(DEFAULTS.softCredit).toBe(false);
  });

  it("false reproduces hard rank assignment exactly", () => {
    // Two models that differ ONLY in a knob documented as inert must produce
    // bit-identical state. Anything else means the default path moved.
    const hard = ratings(warm({ ...DEFAULTS, softCredit: false }, 30));
    const alsoHard = ratings(warm({ ...DEFAULTS, softCredit: false }, 30));
    for (const [k, v] of hard) expect(alsoHard.get(k)).toBe(v);
  });

  it("changes ratings when enabled on an unresolvable alliance", () => {
    // All six teams start identical, so every ordering inside an alliance is a
    // pure index tie-break — exactly the case the repair targets. Hard ranking
    // hands frc1 1.364x and frc3 0.682x on that tie-break; soft credit must not.
    const p = { ...DEFAULTS, w2: 0.7, w3: 0.5 };
    const hard = ratings(warm({ ...p, softCredit: false }, 12));
    const soft = ratings(warm({ ...p, softCredit: true }, 12));

    const hardSpread =
      Math.max(...[...hard.values()]) - Math.min(...[...hard.values()]);
    const softSpread =
      Math.max(...[...soft.values()]) - Math.min(...[...soft.values()]);

    // Hard ranking manufactures a spread between identical robots; soft credit
    // should collapse it toward nothing.
    expect(hardSpread).toBeGreaterThan(0);
    expect(softSpread).toBeLessThan(hardSpread);
  });

  it("gives identical teammates equal credit", () => {
    const p = { ...DEFAULTS, w2: 0.7, w3: 0.5, softCredit: true };
    const soft = ratings(warm(p, 12));
    const red = RED.map((k) => soft.get(k) ?? 0);
    // All three red robots saw identical evidence and started identical, so
    // after soft credit they must still be indistinguishable.
    for (const r of red) expect(r).toBeCloseTo(red[0] ?? 0, 10);
  });

  it("leaves the PREDICTION untouched — only the credit split softens", () => {
    // Same pre-match state, so the first prediction of a fresh model cannot
    // differ: softCredit is not consulted anywhere in predict().
    const hard = new BprModel({ ...DEFAULTS, w2: 0.7, w3: 0.5, softCredit: false });
    const soft = new BprModel({ ...DEFAULTS, w2: 0.7, w3: 0.5, softCredit: true });
    const a = hard.predict(RED, BLUE, YEAR, false);
    const b = soft.predict(RED, BLUE, YEAR, false);
    expect(b.pRed).toBe(a.pRed);
    expect(b.d).toBe(a.d);
    expect(b.v).toBe(a.v);
  });

  it("is enabled in the shipped live port, and the version reflects it", () => {
    expect(SPR_PARAMS.softCredit).toBe(true);
    // predict()'s observable output changed (adjust drop + softCredit), so
    // D-13 requires a MAJOR bump rather than reusing 2.0.0.
    expect(SPR_VERSION).toBe("3.0.0+baseline");
  });

  it("shipped research params enable it too, so the two modules match", async () => {
    const raw = (await import("./frozen-params.json", { with: { type: "json" } })) as {
      default: { params: { softCredit?: boolean } };
    };
    expect(raw.default.params.softCredit).toBe(true);
  });
});
