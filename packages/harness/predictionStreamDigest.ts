/**
 * The winner prediction-stream digest every committed baseline and replay
 * gate compares against.
 *
 * Relocated verbatim by quick task 260913-it4 from the retired Sigma1 core's
 * promotion module (deleted by that task), whose own algorithm it no longer
 * serves. The published algorithms' committed digests
 * (`data/baselines/level1-digest-2026-09.json`, reproduced by
 * `level1Digest.test.ts`) are the proof the relocation is byte-exact.
 */

import { createHash } from "node:crypto";
import type { PredictionRecord } from "./replay.js";

/**
 * D-15/D-16's digest: one line per prediction, `JSON.stringify([matchKey,
 * pRedWin, redScore, blueScore])`, newline-joined, SHA-256 hashed to a
 * lowercase hex string. `JSON.stringify`'s own number formatting is the
 * shortest round-trippable form and is spec-determined — never rounded,
 * `toFixed`'d, or truncated, since this digest is the only thing standing
 * between a real reproduction and a plausible-looking one.
 */
export function computePredictionStreamDigest(records: readonly PredictionRecord[]): string {
  const lines = records.map((r) =>
    JSON.stringify([r.match.matchKey, r.prediction.pRedWin, r.prediction.redScore, r.prediction.blueScore])
  );
  const serialized = lines.join("\n");
  return createHash("sha256").update(serialized).digest("hex");
}
