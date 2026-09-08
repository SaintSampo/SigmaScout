/**
 * GBR corpus access, and the seal's teeth. Deliberately independent of
 * `packages/harness` (the import firewall — see the plan's header) so this
 * model's design stays uncontaminated by anything fitted against the
 * 2023-2026 window other algorithms have already seen.
 *
 * `loadSeason` is the ONLY way this package reads matches, and `isEligible`/
 * `eventClassOf` are the ONLY predicates the package uses for eligibility and
 * event classification (P-4, P-5) — every other file imports these rather
 * than reimplementing them, so the training distribution and the evaluation
 * distribution cannot drift apart.
 */
import { pathToFileURL } from "node:url";
import { openCorpusReadOnly, selectMatchesChronological } from "../corpus/db.js";
import type { CompLevel } from "../core/algorithms/types.js";
import { CORPUS_PATH, HOLDOUT_YEARS } from "./cli.js";

export interface GbrMatch {
  matchKey: string;
  eventKey: string;
  /** From the query argument, not from the row (P-3) — see note below. */
  year: number;
  compLevel: CompLevel;
  setNumber: number;
  matchNumber: number;
  redTeams: readonly string[];
  blueTeams: readonly string[];
  redSurrogates: readonly string[];
  blueSurrogates: readonly string[];
  winner: "red" | "blue" | "tie";
  redScore: number;
  blueScore: number;
  scoreBreakdownRaw: string | null;
  eventType: number;
}

export interface LoadSeasonOptions {
  /**
   * The ONLY way to read a `HOLDOUT_YEARS` season. `holdout.ts` is the only
   * file in this package permitted to pass this — see THE SEAL in the
   * plan's header for the full contract. `evaluate.ts` and `tune.ts` must
   * never reference this option's name in executable source (seal.test.ts
   * scans for exactly that).
   */
  breakSeal?: boolean;
}

/**
 * P-3: the brief lists `sortTime` in the row shape, but
 * `selectMatchesChronological` (which this loader is required to use)
 * consumes `sort_time` to produce the total chronological order and returns
 * `MatchResult`, which carries no timestamp. The RETURNED ARRAY ORDER IS the
 * chronological order — carrying a redundant timestamp alongside an
 * already-ordered array would be two representations of one fact (D-21/
 * D-10's convention), so `GbrMatch` has no `sortTime` field at all.
 *
 * The seal check runs BEFORE the database is opened (hazard: a sealed year
 * must not even cause a read), and P-5's eligibility rule needs every match
 * in the stream — offseason included — so `excludeOffseason` is never
 * passed to `selectMatchesChronological`.
 */
export function loadSeason(year: number, opts: LoadSeasonOptions = {}): GbrMatch[] {
  if (HOLDOUT_YEARS.includes(year) && opts.breakSeal !== true) {
    throw new Error(
      `loadSeason: ${year} is a sealed GBR holdout year (cli.ts HOLDOUT_YEARS). ` +
        `Only packages/gbr/holdout.ts may pass { breakSeal: true } to read it, ` +
        `and only after its own --break-seal and frozen-params.json checks pass.`,
    );
  }

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const rows = selectMatchesChronological(db, { year });
    return rows.map((r) => ({
      matchKey: r.matchKey,
      eventKey: r.eventKey,
      year,
      compLevel: r.compLevel,
      setNumber: r.setNumber,
      matchNumber: r.matchNumber,
      redTeams: r.redTeams,
      blueTeams: r.blueTeams,
      redSurrogates: r.redSurrogates,
      blueSurrogates: r.blueSurrogates,
      winner: r.winner,
      redScore: r.redScore,
      blueScore: r.blueScore,
      scoreBreakdownRaw: r.scoreBreakdownRaw,
      eventType: r.eventType,
    }));
  } finally {
    db.close();
  }
}

/**
 * P-5, stated once and used everywhere in the package: a match is eligible
 * iff `winner` is `"red"` or `"blue"` (not a tie) and neither alliance
 * carries a surrogate. Every match in the stream updates state; only
 * eligible matches become training rows or get scored.
 */
export function isEligible(m: GbrMatch): boolean {
  return (
    (m.winner === "red" || m.winner === "blue") &&
    m.redSurrogates.length === 0 &&
    m.blueSurrogates.length === 0
  );
}

export type EventClass = "regional" | "district" | "champs" | "offseason";

/**
 * P-4: exhaustive over every `event_type` observed in the corpus
 * (0/1/2/3/4/5/6/99/100 — nine values). `default` throws naming the
 * unmapped value rather than falling back silently — `componentMapForSeason`'s
 * discipline (`breakdown/index.ts`).
 */
export function eventClassOf(eventType: number): EventClass {
  switch (eventType) {
    case 0:
      return "regional";
    case 1:
      return "district";
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
      return "champs";
    case 99:
    case 100:
      return "offseason";
    default:
      throw new Error(`eventClassOf: unmapped event_type ${eventType}`);
  }
}

/**
 * `npx tsx packages/gbr/data.ts --smoke <year>` — Task 1's end-to-end sanity
 * check (see the plan's Task 1 Verify section). Prints the loaded row count,
 * proves the seal throws for 2026, then streams the requested year through
 * the feature engine and prints the first 5 feature vectors by name. Kept
 * inline here (rather than a separate script) per the plan's suggestion.
 */
async function smoke(year: number): Promise<void> {
  const rows = loadSeason(year);
  console.log(`${year}: ${rows.length} rows`);

  let sealThrew = false;
  try {
    loadSeason(2026);
  } catch (err) {
    sealThrew = true;
    console.log(`loadSeason(2026) threw as expected: ${(err as Error).message}`);
  }
  if (!sealThrew) {
    throw new Error("SMOKE FAILURE: loadSeason(2026) did not throw");
  }

  const { initSeasonState, extractFeatures, updateStates, FEATURE_NAMES } = await import("./features.js");
  const state = initSeasonState(year);
  const n = Math.min(5, rows.length);
  for (let i = 0; i < n; i += 1) {
    const match = rows[i]!;
    const vec = extractFeatures(state, match);
    console.log(`--- match ${i} (${match.matchKey}) ---`);
    for (let j = 0; j < FEATURE_NAMES.length; j += 1) {
      console.log(`  ${FEATURE_NAMES[j]} = ${vec[j]}`);
    }
    updateStates(state, match);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--smoke");
  if (idx === -1) {
    throw new Error("usage: data.ts --smoke <year>");
  }
  const yearArg = args[idx + 1];
  const year = Number(yearArg);
  if (!Number.isFinite(year)) {
    throw new Error(`data.ts --smoke: invalid year "${String(yearArg)}"`);
  }
  smoke(year).catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
