/**
 * Named performance marks separating the Teams page's network cost (artifact
 * fetch + schema parse) from its render cost (rows committed to the DOM).
 *
 * `05-VALIDATION.md`'s "Measurement Gate (NAV-06)" fixes these two mark
 * names verbatim — `artifact-parsed` and `first-rows-rendered` — so the
 * recorded measurement procedure and this code can never drift apart. Every
 * helper is a no-op when the Performance API or the relevant entry is
 * unavailable, since these same modules run under jsdom in unit tests.
 *
 * Why the split matters (05-VALIDATION.md's own framing): a slow number that
 * turns out to be mostly network time favours D-03's search-index split; a
 * slow number that turns out to be mostly parse+render time favours a
 * virtualization fix instead. Those are different follow-up decisions, so
 * the number needs to say which one it is.
 */

const ARTIFACT_PARSED_MARK = "artifact-parsed";
const FIRST_ROWS_RENDERED_MARK = "first-rows-rendered";
const PARSE_TO_PAINT_MEASURE = "parse-to-paint";

function hasPerformanceMark(): boolean {
  return typeof performance !== "undefined" && typeof performance.mark === "function";
}

/** Marks the instant `TeamsArtifactSchema.parse()` resolves — call immediately after parsing succeeds, before returning. */
export function markArtifactParsed(): void {
  if (!hasPerformanceMark()) return;
  performance.mark(ARTIFACT_PARSED_MARK);
}

/** Marks the instant the Teams route's first populated (non-skeleton) render has committed. */
export function markFirstRowsRendered(): void {
  if (!hasPerformanceMark()) return;
  performance.mark(FIRST_ROWS_RENDERED_MARK);
}

/** Returns the duration (ms) between `artifact-parsed` and `first-rows-rendered`, or `undefined` when either mark is missing or the Performance API lacks `measure`/`getEntriesByName`. */
export function measureParseToPaint(): number | undefined {
  if (!hasPerformanceMark() || typeof performance.measure !== "function" || typeof performance.getEntriesByName !== "function") {
    return undefined;
  }
  const hasParsedMark = performance.getEntriesByName(ARTIFACT_PARSED_MARK, "mark").length > 0;
  const hasRenderedMark = performance.getEntriesByName(FIRST_ROWS_RENDERED_MARK, "mark").length > 0;
  if (!hasParsedMark || !hasRenderedMark) return undefined;

  try {
    performance.measure(PARSE_TO_PAINT_MEASURE, ARTIFACT_PARSED_MARK, FIRST_ROWS_RENDERED_MARK);
  } catch {
    return undefined;
  }

  const measures = performance.getEntriesByName(PARSE_TO_PAINT_MEASURE, "measure");
  return measures[measures.length - 1]?.duration;
}
