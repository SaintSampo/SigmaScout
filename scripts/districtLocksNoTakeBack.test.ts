/**
 * The District Locks tab does not take a lock back: the 2026cthar frc2067 pin
 * (quick task 261009-uhb, CONTEXT D2).
 *
 * THE RULE, Jacob's, 2026-10-08: "it is mission critical that no team is told
 * they are locked at any stop, and then later they are not locked."
 *
 * THE CAUSE this pin holds closed. Quick task 261008-26o settles a knocked out
 * alliance's exact playoff points into its teams' floors while the event's
 * Playoffs category is still open, and the pooled remaining points lock went
 * on counting that event's whole playoff pool as not yet handed out. The same
 * points sat in rivals' floors and in the pool, so a team Locked by the pooled
 * argument alone at Alliances final read In range at a later round. Since
 * quick task 261009-uhb the pool nets those points out
 * (`packages/core/districts/pooledLockInputs.ts`).
 *
 * BEFORE (measured at 62c21b5d, never asserted here): at 2026cthar frc2067
 * read Locked from Alliances final to Round 3, In range at Round 4 and Round
 * 5, and Locked again at Playoffs final. The pool read 4,323 at Round 4 and
 * Round 5 in BOTH runs, the settled rule lost frc2067 at both stops, and the
 * event carried four violations (tenet C and tenet D at each stop).
 *
 * GATED on BOTH gitignored local sources, the 2026ne district artifact
 * (`data/local-publish/districts/v1__district__2026ne.json`) and
 * `data/corpus.sqlite`: the group skips with a message naming what is absent,
 * never a silent pass.
 *
 * IT CALLS THE SWEEP'S OWN EXPORTS (`scripts/measureLedgerSettledTenets.ts`)
 * and restates none of them, so the pinned stops are exactly the stops the
 * sweep visits and the statuses are the tab's own status code.
 *
 * IF THE IMPLEMENTATION EVER DIFFERS, check the inputs first (the local
 * artifact's generation, the corpus bracket, one position index for every
 * round stop). No lock rule is changed to meet a pin.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "../packages/harness/pageArtifacts.js";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import type { BracketSourceEvent } from "../apps/web/src/components/districts/districtLedgerRows.js";
import { bracketFromCorpus, CORPUS_PATH } from "./measureChampJointLocks.js";
import { districtTierFinalVerdicts } from "./measureLedgerTenets.js";
import {
  bracketSkipReason,
  settledDistrictContext,
  settledStops,
  statusesAtSettledStop,
  sweepSettledEvent,
} from "./measureLedgerSettledTenets.js";

const NE_PATH = "data/local-publish/districts/v1__district__2026ne.json";
const PIN_EVENT = "2026cthar";
const PIN_TEAM = "frc2067";

const STOP_LABELS = ["Alliances final", "Round 1", "Round 2", "Round 3", "Round 4", "Round 5", "Playoffs final, awards open"] as const;

const NE_AVAILABLE = existsSync(NE_PATH);
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);
const GATE_MESSAGE = `skipped: ${[NE_AVAILABLE ? undefined : NE_PATH, CORPUS_AVAILABLE ? undefined : CORPUS_PATH].filter((path) => path !== undefined).join(" and ")} absent (gitignored local data)`;

/** The local 2026ne artifact and 2026cthar's bracket from the corpus. Call only behind the gate. */
function loadPin(): { artifact: DistrictArtifact; bracket: BracketSourceEvent } {
  const artifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(NE_PATH, "utf8")));
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const bracket = bracketFromCorpus(db, new Map(), artifact.year, PIN_EVENT);
    if (bracket === undefined) throw new Error(`the corpus carries no alliances for ${PIN_EVENT}`);
    return { artifact, bracket };
  } finally {
    db.close();
  }
}

describe("District Locks takes no lock back: 2026cthar frc2067 (261009-uhb)", () => {
  if (!NE_AVAILABLE || !CORPUS_AVAILABLE) {
    it.skip(GATE_MESSAGE, () => {});
    return;
  }
  const { artifact, bracket } = loadPin();
  const context = settledDistrictContext(artifact);
  const stops = settledStops(context.timeline, PIN_EVENT, bracket);
  const sweep = sweepSettledEvent(artifact, context, PIN_EVENT, bracket, districtTierFinalVerdicts(artifact));

  it("is sweepable and builds the seven stops from Alliances final to Playoffs final", () => {
    expect(bracketSkipReason(bracket)).toBeUndefined();
    expect(context.eventKeys).toContain(PIN_EVENT);
    expect(stops.map((stop) => stop.label)).toEqual([...STOP_LABELS]);
    expect(sweep.stops.map((record) => record.label)).toEqual([...STOP_LABELS]);
  });

  it("reads frc2067 Locked on points at every one of the seven stops, by the pooled argument alone at the first six", () => {
    const results = stops.map((stop) => {
      const result = statusesAtSettledStop(artifact, context, PIN_EVENT, stop, bracket, true).statuses.byTeam.get(PIN_TEAM);
      if (result === undefined) throw new Error(`${PIN_TEAM} has no status at ${stop.label}`);
      return result;
    });
    expect(results).toHaveLength(7);
    expect(results.map((result) => result.status)).toEqual(Array.from({ length: 7 }, () => "locked"));
    expect(results.map((result) => result.byAward)).toEqual(Array.from({ length: 7 }, () => false));
    expect(results.slice(0, 6).map((result) => result.lockedBy)).toEqual(Array.from({ length: 6 }, () => "pooled"));
  });

  it("takes exactly the settled playoff points off the pool at every stop: 21 at Round 4, 60 at Round 5, nothing elsewhere", () => {
    expect(sweep.stops.map((record) => record.blunt.pooledRemainingPoints - record.settled.pooledRemainingPoints)).toEqual(
      sweep.stops.map((record) => record.settledPoints)
    );
    expect(sweep.stops.map((record) => record.settledPoints)).toEqual([0, 0, 0, 0, 21, 60, 0]);
    // Every settled value over a finished event is TBA's own number, so every
    // one of them is in a floor and every one of them is netted.
    expect(sweep.stops.map((record) => record.settledExact)).toEqual(sweep.stops.map((record) => record.settledRows));
  });

  it("loses nobody to the settled rule at any stop, and gains only frc1699 at Round 5", () => {
    expect(sweep.stops.map((record) => record.blunt.lockedOnPoints)).toEqual([6, 6, 6, 6, 6, 6, 9]);
    expect(sweep.stops.map((record) => record.settled.lockedOnPoints)).toEqual([6, 6, 6, 6, 6, 7, 9]);
    expect(sweep.stops.map((record) => record.lost)).toEqual(Array.from({ length: 7 }, () => []));
    expect(sweep.stops.map((record) => record.gained)).toEqual([[], [], [], [], [], ["frc1699"], []]);
  });

  it("carries no tenet violation and no take back under either rule", () => {
    expect(sweep.violations).toEqual([]);
    expect(sweep.takeBackBlunt).toBe(0);
  });
});
