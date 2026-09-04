/**
 * The home page podium's pooled-accuracy model (2026-09-01, user decision:
 * "add the comparison as just accuracy, as a podium — factor 2024–2026
 * accuracy together").
 *
 * Pooling is the exact reconstruction the Compare artifacts support:
 * `winnerAccuracy * scoredCount` is the correct-call COUNT for a slice, so
 * summing those across seasons and dividing by the summed `scoredCount` is
 * the pooled accuracy of the whole 2024–2026 population — a weighted mean,
 * never a mean-of-means (which would over-weight small seasons). Only the
 * `combined` compLevelView slices participate, matching the accuracy the
 * Compare page headlines.
 *
 * Every number the podium renders is derived HERE from fetched artifacts at
 * run time — no hand-typed percentage anywhere (the same D-10 discipline the
 * Compare page's parity proof enforces).
 *
 * WR-03 (260902-post-phase08-ungoverned-ui/REVIEW.md): the slice lookup is
 * SEASON-asserted, not just algorithm+compLevelView, so a mis-keyed or
 * multi-season artifact list cannot silently pool the same season twice (or
 * pool a season the caller never asked for). This could NOT be written the
 * way the review's own text proposed (`s.season === artifact.season`) —
 * verified at plan time, `CompareArtifact` (`CompareArtifactSchema` =
 * `PagePreambleSchema` + `algorithms` + `slices`) carries no top-level
 * `season` field at all; `season` lives on each SLICE, one level down. The
 * artifact therefore cannot assert its own season — only the CALLER, who
 * fetched it for a specific year, knows which one to assert. That is why the
 * assert lives in the signature (a list of season/artifact pairs) rather
 * than inside this function reading `artifact.season` off input that does
 * not have it.
 */
import type { CompareArtifact } from "../../../../packages/harness/pageArtifacts.js";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../packages/harness/publishedAlgorithms.js";

/** The seasons the podium pools — the user's own choice of window. 2022–2023 exist on the Compare page; the front door leads with the three most recent seasons. */
export const PODIUM_SEASONS: readonly number[] = [2024, 2025, 2026];

export interface PodiumEntry {
  readonly algorithmId: PublishedAlgorithmId;
  /** Pooled 2024–2026 combined-view winner accuracy, 0..1. */
  readonly accuracy: number;
  /** Total scored matches backing the pooled figure. */
  readonly scoredCount: number;
}

/** One artifact paired with the season the caller fetched it for — the pairing WR-03's season assert needs, since the artifact cannot name its own season. */
export interface SeasonedCompareArtifact {
  readonly season: number;
  readonly artifact: CompareArtifact;
}

/**
 * Pools each algorithm's combined-view accuracy across the given
 * season/artifact pairs and returns entries sorted best-first (the podium
 * order). Throws — naming the season — if any pair is missing an algorithm's
 * combined slice FOR THE SEASON IT WAS FETCHED FOR, or if a slice's own
 * `season` does not match the caller's claimed season for that artifact. A
 * malformed input must fail loudly, not render a silently wrong podium.
 */
export function pooledAccuracyPodium(seasonedArtifacts: readonly SeasonedCompareArtifact[]): PodiumEntry[] {
  const entries = PUBLISHED_ALGORITHM_IDS.map((algorithmId) => {
    let correct = 0;
    let scored = 0;
    for (const { season, artifact } of seasonedArtifacts) {
      const slice = artifact.slices.find((s) => s.algorithmId === algorithmId && s.compLevelView === "combined" && s.season === season);
      if (slice === undefined) throw new Error(`pooledAccuracyPodium: no combined ${season} slice for ${algorithmId}`);
      if (slice.winnerAccuracy === null) continue;
      correct += slice.winnerAccuracy * slice.scoredCount;
      scored += slice.scoredCount;
    }
    if (scored === 0) throw new Error(`pooledAccuracyPodium: zero scored matches for ${algorithmId}`);
    return { algorithmId, accuracy: correct / scored, scoredCount: scored };
  });
  return entries.sort((a, b) => b.accuracy - a.accuracy);
}
