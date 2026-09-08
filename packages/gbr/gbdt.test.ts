/**
 * `gbdt.ts`'s suite. The bin/raw agreement case is the one that matters most
 * — it is the ONLY detector for a threshold off-by-one, a defect that trains
 * one model and ships a different one with every other test here green (see
 * `gbdt.ts`'s file header for the binning contract this case exists to
 * prove).
 */
import { describe, expect, it } from "vitest";
import {
  applyBinner,
  buildBinner,
  fitForest,
  mulberry32,
  predictForest,
  predictOneTreeBinned,
  serializeForest,
  type GbdtParams,
  type SerializedForest,
  type TreeNode,
} from "./gbdt.js";

/** 4 features: x0/x1 drive a noisy XOR label, x2/x3 are pure noise. */
function buildXorDataset(n: number, seed: number): { X: Float64Array; y: Float64Array; nFeatures: number } {
  const rng = mulberry32(seed);
  const nFeatures = 4;
  const X = new Float64Array(n * nFeatures);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const x0 = rng() * 4 - 2;
    const x1 = rng() * 4 - 2;
    const x2 = rng() * 4 - 2;
    const x3 = rng() * 4 - 2;
    X[i * nFeatures + 0] = x0;
    X[i * nFeatures + 1] = x1;
    X[i * nFeatures + 2] = x2;
    X[i * nFeatures + 3] = x3;
    const xorLabel = (x0 > 0) !== (x1 > 0) ? 1 : 0;
    y[i] = rng() < 0.05 ? 1 - xorLabel : xorLabel;
  }
  return { X, y, nFeatures };
}

function rowOf(X: Float64Array, nFeatures: number, r: number): Float64Array {
  return X.subarray(r * nFeatures, (r + 1) * nFeatures);
}

function trainAccuracy(model: SerializedForest, X: Float64Array, y: Float64Array, n: number, nFeatures: number): number {
  let correct = 0;
  for (let r = 0; r < n; r += 1) {
    const p = 1 / (1 + Math.exp(-predictForest(model, rowOf(X, nFeatures, r))));
    const pred = p > 0.5 ? 1 : 0;
    if (pred === y[r]) correct += 1;
  }
  return correct / n;
}

const BASE: Omit<GbdtParams, "maxDepth" | "nTrees"> = {
  learningRate: 0.1,
  minChildWeight: 1,
  lambda: 1,
  subsample: 1,
  colsampleByTree: 1,
  seed: 7,
};

describe("GBDT — learns interactions (XOR)", () => {
  it("depth 3 exceeds 0.90 train accuracy in <30s; depth 1 (stumps) falls below 0.60", () => {
    const { X, y, nFeatures } = buildXorDataset(4000, 42);
    const binner = buildBinner(X, 4000, nFeatures);
    const binned = applyBinner(binner, X, 4000);

    const start = Date.now();
    const modelDepth3 = fitForest({ ...BASE, maxDepth: 3, nTrees: 100 }, binner, binned, 4000, nFeatures, y, "logistic");
    const elapsedMs = Date.now() - start;
    const accDepth3 = trainAccuracy(modelDepth3, X, y, 4000, nFeatures);

    const modelDepth1 = fitForest({ ...BASE, maxDepth: 1, nTrees: 100 }, binner, binned, 4000, nFeatures, y, "logistic");
    const accDepth1 = trainAccuracy(modelDepth1, X, y, 4000, nFeatures);

    // eslint-disable-next-line no-console -- reported per the plan's Task 2 Verify section
    console.log(
      `[gbdt.test] XOR: depth3 acc=${accDepth3.toFixed(4)} (fit ${elapsedMs}ms), depth1 acc=${accDepth1.toFixed(4)}`,
    );

    // The second half proves the tree is splitting on the INTERACTION rather
    // than memorizing — a single-sided accuracy assertion would also pass
    // for a model that learned nothing.
    expect(accDepth3).toBeGreaterThan(0.9);
    expect(accDepth1).toBeLessThan(0.6);
    expect(elapsedMs).toBeLessThan(30000);
  });
});

describe("GBDT — determinism", () => {
  it("the same seed produces byte-identical serialized forests and exactly equal predictions", () => {
    const { X, y, nFeatures } = buildXorDataset(500, 11);
    const binner = buildBinner(X, 500, nFeatures);
    const binned = applyBinner(binner, X, 500);
    const params: GbdtParams = { ...BASE, maxDepth: 3, nTrees: 20, seed: 99 };

    const m1 = fitForest(params, binner, binned, 500, nFeatures, y, "logistic");
    const m2 = fitForest(params, binner, binned, 500, nFeatures, y, "logistic");

    expect(JSON.stringify(serializeForest(m1))).toBe(JSON.stringify(serializeForest(m2)));
    for (let r = 0; r < 500; r += 1) {
      const row = rowOf(X, nFeatures, r);
      expect(predictForest(m1, row)).toBe(predictForest(m2, row));
    }
  });
});

describe("GBDT — serialization round-trip", () => {
  it("JSON.parse(JSON.stringify(model)) predicts bit-identical values", () => {
    const { X, y, nFeatures } = buildXorDataset(500, 21);
    const binner = buildBinner(X, 500, nFeatures);
    const binned = applyBinner(binner, X, 500);
    const model = fitForest({ ...BASE, maxDepth: 3, nTrees: 20 }, binner, binned, 500, nFeatures, y, "logistic");
    const roundTripped = JSON.parse(JSON.stringify(serializeForest(model))) as SerializedForest;

    for (let r = 0; r < 500; r += 1) {
      const row = rowOf(X, nFeatures, r);
      expect(predictForest(roundTripped, row)).toBe(predictForest(model, row));
    }
  });
});

describe("GBDT — bin/raw agreement", () => {
  it("predicting via the binned matrix (the ACTUAL training-time split decision) and via predictForest on raw values agree exactly on every training row", () => {
    const { X, y, nFeatures } = buildXorDataset(4000, 33);
    const binner = buildBinner(X, 4000, nFeatures);
    const binned = applyBinner(binner, X, 4000);

    // `debugTrees` carries each tree's internal `splitBin` — the bin index
    // ACTUALLY used to route rows during training — independently of
    // whatever raw `threshold` ends up serialized. Comparing against that,
    // rather than re-deriving a bin from the serialized threshold itself,
    // is what makes this test capable of catching a threshold off-by-one:
    // re-deriving would make both sides trivially agree regardless of the
    // bug (see git history for the version of this test that made that
    // mistake and was demonstrated to NOT catch the bug it claimed to).
    const debugTrees: TreeNode[][] = [];
    const model = fitForest({ ...BASE, maxDepth: 3, nTrees: 50 }, binner, binned, 4000, nFeatures, y, "logistic", debugTrees);

    const predictViaInternalBins = (row: number): number => {
      let out = model.baseScore;
      for (const nodes of debugTrees) {
        out += predictOneTreeBinned(nodes, binned, row, nFeatures);
      }
      return out;
    };

    for (let r = 0; r < 4000; r += 1) {
      const viaRaw = predictForest(model, rowOf(X, nFeatures, r));
      const viaBinned = predictViaInternalBins(r);
      expect(viaBinned).toBe(viaRaw);
    }
  });
});
