/**
 * D-15/T-03-17: one-shot, committed slice extraction. Reads the slice RECORDED
 * in the committed level-1 digest baseline
 * (`data/baselines/level1-digest-2026-09.json`: `sliceSeason` and
 * `sliceEventKeys`), pulls those events' played matches from the local corpus
 * in the season's own chronological order — never a fresh query for "the
 * first N events," since the corpus may have grown since the baseline was
 * measured — and writes `packages/harness/fixtures/digest-slice.json`:
 * `{ sliceSeason, sliceEventKeys, extractedAt, corpusIdentity, matches }`,
 * where each match is exactly the `MatchResult` shape the walk-forward replay
 * needs, `scoreBreakdownRaw` included verbatim. Nothing here is rounded,
 * reordered, or normalized — the fixture must replay to the IDENTICAL
 * prediction stream the corpus produces, and any transformation in this
 * script is a place that guarantee could silently break.
 *
 * This is a TEST FIXTURE, deliberately COMMITTED so `level1Digest.test.ts`
 * and `sigmaScoutLayer.matchBand.test.ts` can replay the slice in CI, where
 * `data/corpus.sqlite` does not exist. It is regenerated only when the
 * recorded slice changes.
 *
 * Until quick task 260913-it4 this script read the slice from the retired
 * Sigma1 core's promoted version file (deleted by that task). That file
 * recorded the IDENTICAL slice (2022, `["2022alhu","2022azfl","2022azva"]`,
 * 265 matches), checked before deletion, so the committed fixture did not
 * need regenerating.
 *
 * Measured [pre-rename] (real run against the original 3-event/265-match
 * slice): `digest-slice.json` is 644.4 KB.
 *
 * Standalone-script shape: `parseArgs`, `async function main()`, an
 * entry-point guard so importing this module never has the side effect of
 * running a real corpus pass.
 *
 * Usage: `pnpm tsx packages/harness/fixtures/extract-digest-slice.ts [--baseline <path>]`
 * (defaults to `data/baselines/level1-digest-2026-09.json`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { MatchResult } from "../../core/algorithms/types.js";
import { openCorpusReadOnly, selectMatchesChronological } from "../../corpus/db.js";

const CORPUS_PATH = "data/corpus.sqlite";
const DEFAULT_BASELINE_PATH = join("data", "baselines", "level1-digest-2026-09.json");
const OUTPUT_PATH = join("packages", "harness", "fixtures", "digest-slice.json");

/** The committed fixture's on-disk shape. */
export interface DigestSliceFixture {
  sliceSeason: number;
  sliceEventKeys: string[];
  extractedAt: string;
  corpusIdentity: string;
  matches: MatchResult[];
}

/** The slice fields this script reads from the committed digest baseline. */
interface RecordedSlice {
  sliceSeason: number;
  sliceEventKeys: string[];
}

function readRecordedSlice(baselinePath: string): RecordedSlice {
  const raw = JSON.parse(readFileSync(baselinePath, "utf8")) as Partial<RecordedSlice>;
  if (
    typeof raw.sliceSeason !== "number" ||
    !Array.isArray(raw.sliceEventKeys) ||
    raw.sliceEventKeys.some((key) => typeof key !== "string")
  ) {
    throw new Error(`extract-digest-slice: ${baselinePath} does not record a sliceSeason and sliceEventKeys`);
  }
  return { sliceSeason: raw.sliceSeason, sliceEventKeys: raw.sliceEventKeys };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { baseline: { type: "string" } } });
  const baselinePath = values.baseline ?? DEFAULT_BASELINE_PATH;
  const slice = readRecordedSlice(baselinePath);

  const db = openCorpusReadOnly(CORPUS_PATH);
  let matches: MatchResult[];
  try {
    matches = selectMatchesChronological(db, {
      year: slice.sliceSeason,
      excludeOffseason: true,
    }).filter((match) => slice.sliceEventKeys.includes(match.eventKey));
  } finally {
    db.close();
  }

  // The match-count guard compares against the COMMITTED fixture, so a drifted
  // corpus cannot silently overwrite a fixture that still reproduces the
  // committed digests.
  if (existsSync(OUTPUT_PATH)) {
    const committed = JSON.parse(readFileSync(OUTPUT_PATH, "utf8")) as DigestSliceFixture;
    if (matches.length !== committed.matches.length) {
      throw new Error(
        `extract-digest-slice: corpus now returns ${matches.length} matches for ${baselinePath}'s recorded slice ` +
          `(sliceEventKeys=${JSON.stringify(slice.sliceEventKeys)}), but the committed fixture holds ` +
          `${committed.matches.length} — the corpus has drifted since extraction (a replay, a re-ingest, or ` +
          `corruption). Investigate before extracting a fixture that could no longer reproduce the committed digest.`
      );
    }
  }

  const fixture: DigestSliceFixture = {
    sliceSeason: slice.sliceSeason,
    sliceEventKeys: [...slice.sliceEventKeys],
    extractedAt: new Date().toISOString(),
    corpusIdentity: CORPUS_PATH,
    matches,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const serialized = JSON.stringify(fixture, null, 2);
  writeFileSync(OUTPUT_PATH, serialized, "utf8");
  const kb = Buffer.byteLength(serialized, "utf8") / 1024;
  console.log(`Wrote ${OUTPUT_PATH}: ${matches.length} matches across ${slice.sliceEventKeys.length} events, ${kb.toFixed(1)} KB`);
}

// Guard: only auto-run `main()` when this file is the process entry point —
// importing this module (e.g. from a test) must never have the side effect
// of running a real corpus read or writing the fixture.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("extract-digest-slice failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
