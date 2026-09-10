/**
 * D-04 census (quick task 260909-t5q, Task 3): read-only measurement of how
 * many matches Task 1's corpus-global cold-start predicate flags, broken out
 * per season and by whether the event is offseason. Answers "what would a
 * republish change" WITHOUT running one — no write, no R2 call, no network
 * access anywhere in this script.
 *
 * Follows `scripts/measureRewindGap.ts`'s established pattern for a
 * corpus-reading measurement script: a constant corpus path, and an
 * existence precondition that throws by name rather than surfacing a
 * cryptic mid-run SQLite error.
 *
 * Kept out of the shipped tree, under this quick task's own directory — the
 * precedent every prior one-off measurement script in this repo follows.
 * Run with `npx tsx .planning/quick/260909-t5q-unify-cold-start-handling-predict-a-tie-/scripts/coldStartCensus.ts`.
 */
import { existsSync } from "node:fs";
import { openCorpusReadOnly, selectMatchesChronological, type Corpus } from "../../../../packages/corpus/db.js";
import { buildColdStartIndex } from "../../../../packages/core/scoring/coldStart.js";

const CORPUS_PATH = "data/corpus.sqlite";

function assertPreconditions(): void {
  if (!existsSync(CORPUS_PATH)) {
    throw new Error(
      `coldStartCensus: precondition failed — ${CORPUS_PATH} does not exist. Run the ingest pipeline first; this script does not substitute a fixture or estimate the numbers.`
    );
  }
}

interface EventMeta {
  readonly year: number;
  readonly isOffseason: boolean;
}

/** `event_key -> {year, isOffseason}` for every event in the corpus, read straight off the `events` table rather than parsed from the event key string — the same discipline `HarnessPredictionInput.eventKey`'s own doc comment argues for. */
function readEventMetaByKey(db: Corpus): Map<string, EventMeta> {
  const rows = db.prepare(`SELECT event_key, year, is_offseason FROM events`).all() as {
    event_key: string;
    year: number;
    is_offseason: number;
  }[];
  const byKey = new Map<string, EventMeta>();
  for (const row of rows) {
    byKey.set(row.event_key, { year: row.year, isOffseason: row.is_offseason === 1 });
  }
  return byKey;
}

interface SeasonRow {
  readonly season: number;
  readonly coldStartTotal: number;
  readonly coldStartOfficial: number;
  readonly coldStartOffseason: number;
  readonly playedTotal: number;
  readonly playedOfficial: number;
  readonly officialSharePct: number;
}

function main(): void {
  assertPreconditions();
  const db = openCorpusReadOnly(CORPUS_PATH);
  let seasonRows: SeasonRow[];
  let totalColdStart: number;
  let totalOfficialColdStart: number;
  try {
    const eventMetaByKey = readEventMetaByKey(db);

    // Corpus-global, no year filter, no offseason exclusion (D-01) — the
    // exact stream `packages/harness/corpusColdStart.ts`'s `corpusColdStartIndex`
    // builds in production. `selectMatchesChronological`'s own `winner IS NOT
    // NULL` clause already restricts this to played matches.
    const wholeCorpusStream = selectMatchesChronological(db, {});
    const coldStartIndex = buildColdStartIndex(wholeCorpusStream);

    const bySeasonTotal = new Map<number, number>();
    const bySeasonOfficial = new Map<number, number>();
    const bySeasonOffseason = new Map<number, number>();
    const playedBySeasonTotal = new Map<number, number>();
    const playedBySeasonOfficial = new Map<number, number>();

    for (const match of wholeCorpusStream) {
      const meta = eventMetaByKey.get(match.eventKey);
      if (meta === undefined) {
        throw new Error(`coldStartCensus: match ${match.matchKey} references event ${match.eventKey}, which has no row in the events table`);
      }
      const { year, isOffseason } = meta;
      playedBySeasonTotal.set(year, (playedBySeasonTotal.get(year) ?? 0) + 1);
      if (!isOffseason) playedBySeasonOfficial.set(year, (playedBySeasonOfficial.get(year) ?? 0) + 1);

      if (!coldStartIndex.has(match.matchKey)) continue;
      bySeasonTotal.set(year, (bySeasonTotal.get(year) ?? 0) + 1);
      if (isOffseason) {
        bySeasonOffseason.set(year, (bySeasonOffseason.get(year) ?? 0) + 1);
      } else {
        bySeasonOfficial.set(year, (bySeasonOfficial.get(year) ?? 0) + 1);
      }
    }

    const seasons = [...playedBySeasonTotal.keys()].sort((a, b) => a - b);
    seasonRows = seasons.map((season) => {
      const coldStartTotal = bySeasonTotal.get(season) ?? 0;
      const coldStartOfficial = bySeasonOfficial.get(season) ?? 0;
      const coldStartOffseason = bySeasonOffseason.get(season) ?? 0;
      const playedTotal = playedBySeasonTotal.get(season) ?? 0;
      const playedOfficial = playedBySeasonOfficial.get(season) ?? 0;
      const officialSharePct = playedOfficial === 0 ? 0 : (coldStartOfficial / playedOfficial) * 100;
      return { season, coldStartTotal, coldStartOfficial, coldStartOffseason, playedTotal, playedOfficial, officialSharePct };
    });

    totalColdStart = coldStartIndex.size;
    totalOfficialColdStart = seasonRows.reduce((sum, r) => sum + r.coldStartOfficial, 0);
  } finally {
    db.close();
  }

  console.log("=".repeat(78));
  console.log("Cold-start census (quick task 260909-t5q, D-04) — read-only, no republish");
  console.log("=".repeat(78));
  console.log(`Total cold-start matches across the whole corpus (all event types): ${totalColdStart}`);
  console.log(`Total cold-start matches in OFFICIAL (non-offseason) events only:    ${totalOfficialColdStart}`);
  console.log("");
  console.log(
    "season | coldStart total | coldStart official | coldStart offseason | played official | official share %"
  );
  console.log("-".repeat(100));
  for (const row of seasonRows) {
    console.log(
      `${String(row.season).padEnd(6)} | ${String(row.coldStartTotal).padEnd(16)} | ${String(row.coldStartOfficial).padEnd(19)} | ${String(
        row.coldStartOffseason
      ).padEnd(20)} | ${String(row.playedOfficial).padEnd(16)} | ${row.officialSharePct.toFixed(2)}%`
    );
  }
  console.log("");

  const row2016 = seasonRows.find((r) => r.season === 2016);
  const row2017 = seasonRows.find((r) => r.season === 2017);
  console.log("BPR cross-check (packages/core/algorithms/bpr.ts header: 274 dead-even cold-start matches in 2016, 1 in 2017):");
  console.log(`  2016 official-events-only cold-start count: ${row2016?.coldStartOfficial ?? "(no 2016 data in this corpus)"}`);
  console.log(`  2017 official-events-only cold-start count: ${row2017?.coldStartOfficial ?? "(no 2017 data in this corpus)"}`);
}

main();
