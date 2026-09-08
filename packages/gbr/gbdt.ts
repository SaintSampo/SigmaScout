/**
 * Hand-rolled histogram gradient-boosted trees. Zero dependencies — typed
 * arrays and arithmetic only, no `ml-matrix`, no new package — because this
 * file must stay pure enough to port into a Cloudflare Worker later: no Node
 * built-ins anywhere in the prediction path (`predictForest` and everything
 * it calls).
 *
 * The binning contract, stated once and load-bearing everywhere else in this
 * file: `binOf(f, x)` is the count of thresholds strictly less than `x`, so
 * `bin <= b` is EXACTLY equivalent to `x <= thresholds[b]`. That equivalence
 * is what lets training walk the cheap binned matrix while `predictForest`
 * walks raw feature values and gets the identical routing decision at every
 * node — `gbdt.test.ts`'s bin/raw agreement case is the only thing that
 * would catch a threshold off-by-one here, a defect that trains one model
 * and ships a different one with every other test green.
 */

// --- seeded RNG --------------------------------------------------------------

/** mulberry32: small, fast, deterministic — used for both subsample/colsample draws inside `fitForest` and for `tune.ts`'s hyperparameter search. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- binning -------------------------------------------------------------

export interface Binner {
  nFeatures: number;
  /** Ascending, per-feature thresholds computed over the TRAINING set only. `thresholds[f].length <= maxBins - 1`. */
  thresholds: Float64Array[];
}

/**
 * `binOf(x) = count of thresholds strictly less than x`. Binary search for
 * the first threshold `>= x`; that index IS the count of thresholds `< x`.
 * `bin <= b <=> x <= thresholds[b]` follows directly (see this file's
 * header) — never change this without re-deriving that equivalence.
 */
export function binOf(thresholds: Float64Array, x: number): number {
  let lo = 0;
  let hi = thresholds.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const t = thresholds[mid]!;
    if (t < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Per-feature ascending thresholds, computed over the training set only. A
 * feature with `<= maxBins` distinct values gets midpoints between
 * consecutive distinct values (exact, no approximation); otherwise it gets
 * `maxBins - 1` quantile cut points. A constant feature gets zero
 * thresholds — one bin, and it can never be split.
 */
export function buildBinner(X: Float64Array, nRows: number, nFeatures: number, maxBins = 256): Binner {
  const thresholds: Float64Array[] = [];
  for (let f = 0; f < nFeatures; f += 1) {
    const col = new Float64Array(nRows);
    for (let r = 0; r < nRows; r += 1) col[r] = X[r * nFeatures + f]!;
    col.sort();

    const distinct: number[] = [];
    for (let i = 0; i < col.length; i += 1) {
      const v = col[i]!;
      if (i === 0 || v !== distinct[distinct.length - 1]) distinct.push(v);
    }

    let t: number[];
    if (distinct.length <= maxBins) {
      t = [];
      for (let i = 0; i + 1 < distinct.length; i += 1) {
        t.push((distinct[i]! + distinct[i + 1]!) / 2);
      }
    } else {
      const k = maxBins - 1;
      const cuts = new Set<number>();
      for (let i = 1; i <= k; i += 1) {
        const q = i / (k + 1);
        const idx = Math.min(col.length - 1, Math.max(0, Math.floor(q * col.length)));
        cuts.add(col[idx]!);
      }
      t = [...cuts].sort((a, b) => a - b);
    }
    thresholds.push(Float64Array.from(t));
  }
  return { nFeatures, thresholds };
}

/** Row-major `Uint8Array` of length `nRows * nFeatures` (~5.6 MB at 141k x 25). */
export function applyBinner(binner: Binner, X: Float64Array, nRows: number): Uint8Array {
  const { nFeatures } = binner;
  const binned = new Uint8Array(nRows * nFeatures);
  for (let r = 0; r < nRows; r += 1) {
    const base = r * nFeatures;
    for (let f = 0; f < nFeatures; f += 1) {
      binned[base + f] = binOf(binner.thresholds[f]!, X[base + f]!);
    }
  }
  return binned;
}

// --- boosting --------------------------------------------------------------

export type Objective = "logistic" | "squared";

export interface GbdtParams {
  nTrees: number;
  maxDepth: number;
  learningRate: number;
  minChildWeight: number;
  lambda: number;
  /** Rows, redrawn per tree. */
  subsample: number;
  /** Features, drawn once per tree. */
  colsampleByTree: number;
  seed: number;
  /** Prints wall-clock per fit to stderr — Task 3 needs this number to size a real tuning run. */
  verbose?: boolean;
}

export interface SerializedTree {
  /** `-1` for a leaf. */
  feature: number[];
  /** The RAW value `t_b`, not the bin index. */
  threshold: number[];
  left: number[];
  right: number[];
  /** Already multiplied by `learningRate` — `predictForest` needs no parameters at all. */
  value: number[];
}

export interface SerializedForest {
  nFeatures: number;
  baseScore: number;
  trees: SerializedTree[];
}

/** Already plain JSON — this is the identity function, named to match the plan's API shape and `gbdt.test.ts`'s determinism/round-trip assertions. */
export function serializeForest(model: SerializedForest): SerializedForest {
  return model;
}

/**
 * Pure, `O(depth)` per tree, allocates nothing. Walks `x[feature] <=
 * threshold ? left : right` and sums leaf values onto `baseScore`. No Node
 * built-ins — this is the function that must port unchanged into a Worker.
 */
export function predictForest(model: SerializedForest, x: ArrayLike<number>): number {
  let out = model.baseScore;
  // `f` is a feature index recorded at training time against `model.nFeatures`
  // — the caller's contract is `x.length === model.nFeatures` (P-6: provably
  // in range from that contract, so `!` rather than a silent `?? 0` fallback
  // that would misroute a prediction with no error).
  for (const tree of model.trees) {
    let idx = 0;
    while (tree.feature[idx] !== -1) {
      const f = tree.feature[idx]!;
      const t = tree.threshold[idx]!;
      idx = x[f]! <= t ? tree.left[idx]! : tree.right[idx]!;
    }
    out += tree.value[idx]!;
  }
  return out;
}

/**
 * Internal-only node shape: carries BOTH the bin index actually used to
 * route rows during training (`splitBin`) and the raw threshold later
 * serialized (`threshold`) — never both exposed via `SerializedTree`, which
 * carries `threshold` only. Exported (diagnostic-only, not part of the
 * fitted-model API) so `gbdt.test.ts`'s bin/raw agreement case can compare
 * the ACTUAL training-time routing decision against what the serialized
 * raw value implies, rather than re-deriving one from the other (which
 * would make the test trivially self-consistent and blind to exactly the
 * off-by-one it exists to catch).
 */
export interface TreeNode {
  feature: number;
  /** The bin index the training-time walk compares against. Never serialized. */
  splitBin: number;
  threshold: number;
  left: number;
  right: number;
  value: number;
}

interface Hist {
  g: Float64Array;
  h: Float64Array;
  c: Int32Array;
}

function buildHistogramsForRows(
  rows: readonly number[],
  features: readonly number[],
  binned: Uint8Array,
  nFeatures: number,
  nBins: readonly number[],
  g: Float64Array,
  h: Float64Array,
): Map<number, Hist> {
  const hists = new Map<number, Hist>();
  for (const f of features) {
    hists.set(f, { g: new Float64Array(nBins[f]!), h: new Float64Array(nBins[f]!), c: new Int32Array(nBins[f]!) });
  }
  for (const r of rows) {
    const base = r * nFeatures;
    for (const f of features) {
      const b = binned[base + f]!;
      const hist = hists.get(f)!;
      hist.g[b]! += g[r]!;
      hist.h[b]! += h[r]!;
      hist.c[b]! += 1;
    }
  }
  return hists;
}

/** Histogram subtraction: derives the LARGER child from `parent - smaller`, so the caller never has to scan the larger side's rows at all. */
function subtractHistograms(
  parent: Map<number, Hist>,
  child: Map<number, Hist>,
  features: readonly number[],
  nBins: readonly number[],
): Map<number, Hist> {
  const out = new Map<number, Hist>();
  for (const f of features) {
    const p = parent.get(f)!;
    const c = child.get(f)!;
    const nb = nBins[f]!;
    const gArr = new Float64Array(nb);
    const hArr = new Float64Array(nb);
    const cArr = new Int32Array(nb);
    for (let b = 0; b < nb; b += 1) {
      gArr[b] = p.g[b]! - c.g[b]!;
      hArr[b] = p.h[b]! - c.h[b]!;
      cArr[b] = p.c[b]! - c.c[b]!;
    }
    out.set(f, { g: gArr, h: hArr, c: cArr });
  }
  return out;
}

/** Exported alongside `TreeNode` for the same diagnostic reason — see that type's doc comment. */
export function predictOneTreeBinned(nodes: readonly TreeNode[], binned: Uint8Array, row: number, nFeatures: number): number {
  let idx = 0;
  // Every index used with `!` below is provably in range: `idx` starts at 0
  // (always a valid node, see growTree's pre-order allocation) and is only
  // ever reassigned to `node.left`/`node.right`, both of which growTree only
  // ever sets to an index it has itself allocated in `nodes` (P-6).
  while (nodes[idx]!.feature !== -1) {
    const node = nodes[idx]!;
    const b = binned[row * nFeatures + node.feature]!;
    idx = b <= node.splitBin ? node.left : node.right;
  }
  return nodes[idx]!.value;
}

function toSerializedTree(nodes: readonly TreeNode[]): SerializedTree {
  const n = nodes.length;
  const feature = new Array<number>(n);
  const threshold = new Array<number>(n);
  const left = new Array<number>(n);
  const right = new Array<number>(n);
  const value = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const node = nodes[i]!;
    feature[i] = node.feature;
    threshold[i] = node.threshold;
    left[i] = node.left;
    right[i] = node.right;
    value[i] = node.value;
  }
  return { feature, threshold, left, right, value };
}

function sampleIndices(all: readonly number[], frac: number, rng: () => number): number[] {
  if (frac >= 1) return all.slice();
  const out: number[] = [];
  for (const i of all) {
    if (rng() < frac) out.push(i);
  }
  if (out.length === 0) out.push(all[0]!);
  return out;
}

/**
 * Depth-wise growth to `maxDepth`, one tree. Root is ALWAYS node index 0 —
 * `nodes` is populated via pre-order allocation (a placeholder is reserved
 * at `nodeIdx` before recursing into children), so `predictOneTreeBinned`
 * and `predictForest` can both assume the walk starts at index 0.
 */
function growTree(
  binned: Uint8Array,
  nFeatures: number,
  binner: Binner,
  g: Float64Array,
  h: Float64Array,
  params: GbdtParams,
  rowSample: readonly number[],
  featureSample: readonly number[],
): TreeNode[] {
  // P-6: `f` ranges over 0..nFeatures-1 and `binner.thresholds` always has
  // exactly `nFeatures` entries (built by `buildBinner` above) — provably in
  // range, so `!` here rather than `?? 0` (a silent 0 would be
  // indistinguishable from a genuine 1-bin constant feature).
  const nBins: number[] = [];
  for (let f = 0; f < nFeatures; f += 1) nBins.push(binner.thresholds[f]!.length + 1);

  const nodes: TreeNode[] = [];

  function build(rows: readonly number[], hist: Map<number, Hist>, depth: number): number {
    const nodeIdx = nodes.length;
    nodes.push({ feature: -1, splitBin: -1, threshold: 0, left: -1, right: -1, value: 0 });

    let gSum = 0;
    let hSum = 0;
    for (const r of rows) {
      gSum += g[r]!;
      hSum += h[r]!;
    }

    const makeLeaf = (): number => {
      const raw = -gSum / (hSum + params.lambda);
      nodes[nodeIdx] = { feature: -1, splitBin: -1, threshold: 0, left: -1, right: -1, value: raw * params.learningRate };
      return nodeIdx;
    };

    if (depth >= params.maxDepth || rows.length < 2) return makeLeaf();

    let bestGain = 0;
    let bestFeature = -1;
    let bestBin = -1;
    for (const f of featureSample) {
      const nb = nBins[f]!;
      if (nb <= 1) continue; // constant feature — zero thresholds, one bin, can never be split
      const hf = hist.get(f)!;
      let leftG = 0;
      let leftH = 0;
      let leftC = 0;
      for (let b = 0; b < nb - 1; b += 1) {
        leftG += hf.g[b]!;
        leftH += hf.h[b]!;
        leftC += hf.c[b]!;
        const rightG = gSum - leftG;
        const rightH = hSum - leftH;
        const rightC = rows.length - leftC;
        if (leftC === 0 || rightC === 0) continue;
        if (leftH < params.minChildWeight || rightH < params.minChildWeight) continue;
        const gain =
          0.5 *
          ((leftG * leftG) / (leftH + params.lambda) +
            (rightG * rightG) / (rightH + params.lambda) -
            (gSum * gSum) / (hSum + params.lambda));
        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = f;
          bestBin = b;
        }
      }
    }

    if (bestFeature === -1) return makeLeaf();

    const leftRows: number[] = [];
    const rightRows: number[] = [];
    for (const r of rows) {
      const b = binned[r * nFeatures + bestFeature]!;
      if (b <= bestBin) leftRows.push(r);
      else rightRows.push(r);
    }

    let leftHist: Map<number, Hist>;
    let rightHist: Map<number, Hist>;
    if (leftRows.length <= rightRows.length) {
      leftHist = buildHistogramsForRows(leftRows, featureSample, binned, nFeatures, nBins, g, h);
      rightHist = subtractHistograms(hist, leftHist, featureSample, nBins);
    } else {
      rightHist = buildHistogramsForRows(rightRows, featureSample, binned, nFeatures, nBins, g, h);
      leftHist = subtractHistograms(hist, rightHist, featureSample, nBins);
    }

    const threshold = binner.thresholds[bestFeature]![bestBin]!;
    const leftIdx = build(leftRows, leftHist, depth + 1);
    const rightIdx = build(rightRows, rightHist, depth + 1);
    nodes[nodeIdx] = { feature: bestFeature, splitBin: bestBin, threshold, left: leftIdx, right: rightIdx, value: 0 };
    return nodeIdx;
  }

  const rootHist = buildHistogramsForRows(rowSample, featureSample, binned, nFeatures, nBins, g, h);
  build(rowSample, rootHist, 0);
  return nodes;
}

/**
 * Fits `params.nTrees` trees against the binned design matrix. Early
 * stopping is deliberately OFF — `nTrees` is fixed; rolling-origin selection
 * (Task 3) handles capacity, not this function.
 */
export function fitForest(
  params: GbdtParams,
  binner: Binner,
  binned: Uint8Array,
  nRows: number,
  nFeatures: number,
  y: Float64Array,
  objective: Objective,
  /**
   * Diagnostic-only (see `TreeNode`'s doc comment): when supplied, each
   * tree's internal node array (carrying `splitBin`) is pushed onto this
   * array in fit order, alongside the returned `SerializedForest`'s
   * `trees` in the same order — `gbdt.test.ts`'s bin/raw agreement case is
   * the only consumer. Never read by `evaluate.ts`/`tune.ts`/`holdout.ts`.
   */
  debugTrees?: TreeNode[][],
): SerializedForest {
  const start = Date.now();

  let ySum = 0;
  for (let i = 0; i < nRows; i += 1) ySum += y[i]!;
  const yBar = nRows > 0 ? ySum / nRows : 0;
  const baseScore =
    objective === "logistic" ? Math.log(Math.min(1 - 1e-6, Math.max(1e-6, yBar)) / (1 - Math.min(1 - 1e-6, Math.max(1e-6, yBar)))) : yBar;

  const F = new Float64Array(nRows).fill(baseScore);
  const g = new Float64Array(nRows);
  const h = new Float64Array(nRows);
  const trees: SerializedTree[] = [];

  const allRows: number[] = new Array(nRows);
  for (let i = 0; i < nRows; i += 1) allRows[i] = i;
  const allFeatures: number[] = new Array(nFeatures);
  for (let f = 0; f < nFeatures; f += 1) allFeatures[f] = f;

  for (let t = 0; t < params.nTrees; t += 1) {
    for (let i = 0; i < nRows; i += 1) {
      if (objective === "logistic") {
        const p = 1 / (1 + Math.exp(-F[i]!));
        g[i] = p - y[i]!;
        h[i] = p * (1 - p);
      } else {
        g[i] = F[i]! - y[i]!;
        h[i] = 1;
      }
    }

    // Both draws for this tree share one RNG seeded ONLY from (seed,
    // treeIndex) — a tree's draw does not depend on how many heads ran
    // before it (win/margin/total fitting the same seed+t independently
    // must draw identically).
    const rng = mulberry32(params.seed + t);
    const rowSample = sampleIndices(allRows, params.subsample, rng);
    const featureSample = sampleIndices(allFeatures, params.colsampleByTree, rng);

    const nodes = growTree(binned, nFeatures, binner, g, h, params, rowSample, featureSample);
    for (let r = 0; r < nRows; r += 1) {
      F[r]! += predictOneTreeBinned(nodes, binned, r, nFeatures);
    }
    trees.push(toSerializedTree(nodes));
    if (debugTrees !== undefined) debugTrees.push(nodes);
  }

  const model: SerializedForest = { nFeatures, baseScore, trees };
  if (params.verbose === true) {
    process.stderr.write(
      `[gbdt] fit ${params.nTrees} trees x ${nRows} rows x ${nFeatures} features (${objective}) in ${Date.now() - start}ms\n`,
    );
  }
  return model;
}
