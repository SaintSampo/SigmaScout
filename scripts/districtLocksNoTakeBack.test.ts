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
 *
 * QUICK TASK 261012-mw2 moved four lists here, to the values the run showed.
 * A team still in a playoff bracket now carries the playoff points it has
 * secured in its floor, and the pool is netted by what the floors hold, so:
 *
 *   - frc2067 is Locked at all seven stops as before (that assertion is not
 *     weakened), by the pooled argument alone at the first two and by BOTH
 *     tests from Round 2. It read `pooled` at the first six: the ceiling
 *     test now locks it too.
 *   - the pool falls by the settled points AND the secured points:
 *     0, 0, 78, 120, 159, 181, 0 where it fell by 0, 0, 0, 0, 21, 60, 0.
 *     The settled points are unchanged; the secured points are 78, 120, 138
 *     and 121 over 6, 12, 9 and 7 rows at Rounds 2 to 5.
 *   - the settled rule's Locked counts read 6, 6, 7, 7, 8, 8, 9 where they
 *     read 6, 6, 6, 6, 6, 7, 9: frc7407 is gained from Round 2 and frc1699
 *     from Round 4 (it was gained at Round 5 only).
 *
 * NONE OF IT IS A TAKE BACK. Every list that moved is a team Locked EARLIER
 * and then at every later stop: `lost` is empty at every stop, the sweep
 * carries no violation of any tenet, and the blunt rule takes nothing back.
 *
 * QUICK TASK 261013-lve moved four lists again, the other way, to the values
 * the run showed. The playoff pool is now the most TBA's pay rule can pay one
 * event, 216, proven (`packages/core/districts/pointPool.ts`), where it was
 * 213, one above the highest total ever handed out. A larger pool can only
 * take a pooled lock away, and here it takes two stops of one:
 *
 *   - frc2067 reads In range at Alliances final and at Round 1 and Locked at
 *     the five stops from Round 2 on, by both tests. Until then it read
 *     Locked at all seven, by the pooled argument alone at the first two. At
 *     those two stops five events of the district have their Playoffs open,
 *     so the district's pool reads 4,338 where it read 4,323, and what it
 *     takes to unseat frc2067 there is more than 4,323 and not more than
 *     4,338.
 *   - under the blunt rule frc2067 is Locked only once the playoffs are
 *     final: its Locked counts read 5, 5, 5, 5, 5, 5, 9 where they read
 *     6, 6, 6, 6, 6, 6, 9. Under the settled rule they read 5, 5, 7, 7, 8, 8, 9
 *     where they read 6, 6, 7, 7, 8, 8, 9, and frc2067 joins what the settled
 *     rule gains from Round 2.
 *   - what the pool loses to the floors at each stop is unchanged.
 *
 * THIS IS STILL NOT A TAKE BACK, and it is the safe direction: a Locked that
 * is shown LATER, and from the stop it is shown at, at every later stop. The
 * rule this file holds was never "Locked at Alliances final". It is that a
 * team once Locked stays Locked, and the second test now says so in those
 * words.
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

  it("reads frc2067 In range at the first two stops and Locked on points at every stop from Round 2, by both tests, with nothing taken back", () => {
    const results = stops.map((stop) => {
      const result = statusesAtSettledStop(artifact, context, PIN_EVENT, stop, bracket, true).statuses.byTeam.get(PIN_TEAM);
      if (result === undefined) throw new Error(`${PIN_TEAM} has no status at ${stop.label}`);
      return result;
    });
    expect(results).toHaveLength(7);
    // Quick task 261013-lve: Locked at all seven stops until then, by the pooled argument alone at the first two.
    // That lock rested on the last points of a playoff pool of 213, a measured maximum. At the proven 216 the
    // pooled argument does not reach frc2067 until its own bracket has put points in floors.
    expect(results.map((result) => result.status)).toEqual(["inRange", "inRange", "locked", "locked", "locked", "locked", "locked"]);
    expect(results.map((result) => result.byAward)).toEqual(Array.from({ length: 7 }, () => false));
    // Quick task 261012-mw2: `pooled` at the first six stops until then. From Round 2 the secured playoff points
    // in floors let the ceiling test lock it as well.
    expect(results.map((result) => result.lockedBy)).toEqual([null, null, "both", "both", "both", "both", "both"]);
    // THE RULE THIS FILE HOLDS, on the statuses themselves: once Locked, Locked at every later stop.
    const firstLocked = results.findIndex((result) => result.status === "locked");
    expect(firstLocked).toBe(2);
    expect(results.slice(firstLocked).every((result) => result.status === "locked")).toBe(true);
  });

  it("takes exactly the playoff points in floors off the pool at every stop: the settled points and the secured points, each once", () => {
    // The pool difference IS the settled points plus the secured points, at every stop.
    expect(sweep.stops.map((record) => record.blunt.pooledRemainingPoints - record.settled.pooledRemainingPoints)).toEqual(
      sweep.stops.map((record) => record.settledPoints + record.securedPoints)
    );
    expect(sweep.stops.map((record) => record.blunt.pooledRemainingPoints - record.settled.pooledRemainingPoints)).toEqual([0, 0, 78, 120, 159, 181, 0]);
    // The district's whole pool at each stop. 4,323 six times and then 4,110 until quick task 261013-lve: five events
    // have their Playoffs open at the first six stops and four at the last, and each now holds 216 where it held 213.
    expect(sweep.stops.map((record) => record.blunt.pooledRemainingPoints)).toEqual([4338, 4338, 4338, 4338, 4338, 4338, 4122]);
    // The settled points are what they were before quick task 261012-mw2.
    expect(sweep.stops.map((record) => record.settledPoints)).toEqual([0, 0, 0, 0, 21, 60, 0]);
    // The secured points of the teams still in the bracket, and the rows that hold them (quick task 261012-mw2).
    expect(sweep.stops.map((record) => record.securedPoints)).toEqual([0, 0, 78, 120, 138, 121, 0]);
    expect(sweep.stops.map((record) => record.securedRows)).toEqual([0, 0, 6, 12, 9, 7, 0]);
    // Every settled value over a finished event is TBA's own number, so every
    // one of them is in a floor and every one of them is netted.
    expect(sweep.stops.map((record) => record.settledExact)).toEqual(sweep.stops.map((record) => record.settledRows));
  });

  it("loses nobody to the settled rule at any stop, and gains frc2067 and frc7407 from Round 2 and frc1699 from Round 4", () => {
    // Quick task 261013-lve: 6, 6, 6, 6, 6, 6, 9 until then. The blunt rule held frc2067 by the pooled argument
    // alone at the first six stops, and at the proven pool it does not.
    expect(sweep.stops.map((record) => record.blunt.lockedOnPoints)).toEqual([5, 5, 5, 5, 5, 5, 9]);
    // Quick task 261012-mw2: 6, 6, 6, 6, 6, 7, 9 until then, gaining only frc1699 and only at Round 5.
    // Quick task 261013-lve: 6, 6, 7, 7, 8, 8, 9 until then (frc2067 at the first two stops).
    expect(sweep.stops.map((record) => record.settled.lockedOnPoints)).toEqual([5, 5, 7, 7, 8, 8, 9]);
    expect(sweep.stops.map((record) => record.lost)).toEqual(Array.from({ length: 7 }, () => []));
    // frc2067 is among the gained from Round 2 since quick task 261013-lve: the settled rule locks it by both tests
    // there, and the blunt rule no longer does.
    expect(sweep.stops.map((record) => record.gained)).toEqual([[], [], ["frc2067", "frc7407"], ["frc2067", "frc7407"], ["frc1699", "frc2067", "frc7407"], ["frc1699", "frc2067", "frc7407"], []]);
  });

  it("carries no tenet violation and no take back under either rule", () => {
    expect(sweep.violations).toEqual([]);
    expect(sweep.takeBackBlunt).toBe(0);
  });
});
