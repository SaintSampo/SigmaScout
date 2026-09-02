/**
 * D-15/T-03-17: one-shot, committed slice extraction. Reads a promoted
 * version's RECORDED `digest.sliceEventKeys`/`sliceSeason`, pulls those
 * events' played matches from the local corpus in the season's own
 * chronological order — the IDENTICAL slice-resolution shape `promote.ts`
 * and `digest.test.ts` already use (never a fresh query for "the first N
 * events," since the corpus may have grown since promotion) — and writes
 * `packages/harness/fixtures/digest-slice.json`: `{ sliceSeason,
 * sliceEventKeys, extractedAt, corpusIdentity, matches }`, where each match
 * is exactly the `MatchResult` shape the walk-forward replay needs,
 * `scoreBreakdownRaw` included verbatim. Nothing here is rounded, reordered,
 * or normalized — the fixture must replay to the IDENTICAL prediction
 * stream the corpus produces, and any transformation in this script is a
 * place that guarantee could silently break.
 *
 * This is a TEST FIXTURE, not a generated artifact in the sense the failure
 * log's repo-hygiene rule targets (`reports/`, `data/*` minus the
 * `algorithm-versions` exception, both regenerated on every run and
 * therefore gitignored) — this file is regenerated only when a promoted
 * version's recorded slice changes, and is deliberately COMMITTED so
 * `digest.test.ts` can replay D-15's reproducibility assertion in CI, where
 * `data/corpus.sqlite` (351MB) does not exist. `promote.ts` prints this
 * script's exact re-extraction command after every promotion (T-03-17), so
 * a promotion that changes the slice cannot silently leave a stale fixture
 * behind.
 *
 * Measured [pre-rename] (real run against the committed `sigma1@2.0.0+tuned-2026-08`
 * version's 3-event/265-match slice): `digest-slice.json` is
 * 644.4 KB — inside this script's own bounded target (roughly 100-300
 * matches / 2-3 events, low hundreds of KB) and well under
 * `digest.test.ts`'s 2 MB acceptance ceiling. The file measured is the same
 * file, renamed without a content change (plan 07-16, D-04/D-05) to
 * `vpr@2.0.0+tuned-2026-08.json` — this figure still describes it.
 *
 * Same standalone-script shape as `identifiability.ts`/`tune.ts`/
 * `promote.ts`: `parseArgs`, `async function main()`, an entry-point guard
 * so importing this module never has the side effect of running a real
 * corpus pass.
 *
 * Usage: `pnpm tsx packages/harness/fixtures/extract-digest-slice.ts [--version <path>]`
 * (defaults to the promoted `vpr@2.0.0+tuned-2026-08.json`, renamed by
 * plan 07-16, D-04/D-05, from its pre-rename filename).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { MatchResult } from "../../core/algorithms/types.js";
import { openCorpusReadOnly, selectMatchesChronological } from "../../corpus/db.js";
import { PromotedVersionSchema } from "../promote.js";
import { SIGMA1_CODE_VERSION } from "../../core/algorithms/sigma1/params.js";

const CORPUS_PATH = "data/corpus.sqlite";
// Re-pinned to the `4.0.0` re-promotion (D-T1/D-T2, quick task 260901-trz)
// alongside `cli.ts`'s `PROMOTED_VPR_VERSION_PATH` — see that constant's
// comment; previously pinned to `3.0.0` (D-Q2, quick task 260901-is2).
// Only this PATH moves, and that is a fact rather than a hope: the committed
// `digest-slice.json` fixture records raw MATCHES, and `digest.test.ts`
// matches fixture to version by `sliceSeason` + `sliceEventKeys`, never by
// version string. Neither D-Q2 nor D-T1/D-T2 changed the slice (2022,
// 2022alhu/2022azfl/2022azva, 265 matches), so the fixture does not need
// regenerating — and with the corpus present that test ALSO asserts corpus
// and fixture agree, so a stale fixture would fail loudly rather than
// silently.
const DEFAULT_VERSION_PATH = join("data", "algorithm-versions", `vpr@${SIGMA1_CODE_VERSION}+tuned-2026-08.json`);
const OUTPUT_PATH = join("packages", "harness", "fixtures", "digest-slice.json");

/** The committed fixture's on-disk shape — `digest.test.ts` reads this back and re-validates `sliceEventKeys`/`sliceSeason` still match whichever promoted version it is checking. */
export interface DigestSliceFixture {
  sliceSeason: number;
  sliceEventKeys: string[];
  extractedAt: string;
  corpusIdentity: string;
  matches: MatchResult[];
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { version: { type: "string" } } });
  const versionPath = values.version ?? DEFAULT_VERSION_PATH;

  const raw: unknown = JSON.parse(readFileSync(versionPath, "utf8"));
  const promoted = PromotedVersionSchema.parse(raw);

  const db = openCorpusReadOnly(CORPUS_PATH);
  let matches: MatchResult[];
  try {
    matches = selectMatchesChronological(db, {
      year: promoted.digest.sliceSeason,
      excludeOffseason: true,
    }).filter((match) => promoted.digest.sliceEventKeys.includes(match.eventKey));
  } finally {
    db.close();
  }

  if (matches.length !== promoted.digest.sliceMatchCount) {
    throw new Error(
      `extract-digest-slice: corpus now returns ${matches.length} matches for ${versionPath}'s recorded slice ` +
        `(sliceEventKeys=${JSON.stringify(promoted.digest.sliceEventKeys)}), but the committed digest recorded ` +
        `${promoted.digest.sliceMatchCount} — the corpus has drifted since promotion (a replay, a re-ingest, or ` +
        `corruption). Investigate before extracting a fixture that could no longer reproduce the committed digest.`
    );
  }

  const fixture: DigestSliceFixture = {
    sliceSeason: promoted.digest.sliceSeason,
    sliceEventKeys: [...promoted.digest.sliceEventKeys],
    extractedAt: new Date().toISOString(),
    corpusIdentity: CORPUS_PATH,
    matches,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const serialized = JSON.stringify(fixture, null, 2);
  writeFileSync(OUTPUT_PATH, serialized, "utf8");
  const kb = Buffer.byteLength(serialized, "utf8") / 1024;
  console.log(`Wrote ${OUTPUT_PATH}: ${matches.length} matches across ${promoted.digest.sliceEventKeys.length} events, ${kb.toFixed(1)} KB`);
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
