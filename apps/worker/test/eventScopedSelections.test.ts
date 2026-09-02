/**
 * D-V3 (quick task 260902-varopr): `selectionsFor` MUST return an event
 * selection for every algorithm that keeps event-scoped state.
 *
 * This is the highest-consequence edit in that task and its failure mode is
 * silent. Without the event row loaded, a live tick deserializes with an EMPTY
 * `Sigma1State.perEventVariance`; `update()` then rebuilds that accumulator
 * from the one or two matches the tick happens to see, and `selectChangedRows`
 * writes the result back — so an event's whole accumulated history is
 * overwritten by a single tick's worth of data, one tick at a time, while
 * every published `±` simultaneously vanishes or collapses. The rows stay
 * well-formed, the tick reports success, and nothing else in the pipeline
 * notices. Hence a dedicated test rather than reliance on the integration
 * suite.
 */
import { describe, expect, it } from "vitest";
import { EVENT_SCOPED_ALGORITHM_IDS, selectionsFor } from "../src/scheduled.js";

const EVENT_KEY = "2026casj";
const TEAMS = ["frc254", "frc1678", "frc604"];

describe("selectionsFor — event-scoped state must be loaded (D-V3)", () => {
  it("VPR gets an event selection for the event being folded", () => {
    // The regression this test exists for: before quick task 260902-varopr the
    // event branch was reachable ONLY for `algorithmId === "opr"`.
    const selections = selectionsFor("vpr", EVENT_KEY, TEAMS);
    const eventSelection = selections.find((s) => s.scopeKind === "event");
    expect(eventSelection, "vpr must load its perEventVariance accumulator").toBeDefined();
    expect(eventSelection!.scopeKeys).toEqual([EVENT_KEY]);
  });

  it("OPR's existing behaviour is unchanged: event row plus team rows, in that order", () => {
    expect(selectionsFor("opr", EVENT_KEY, TEAMS)).toEqual([
      { scopeKind: "event", scopeKeys: [EVENT_KEY] },
      { scopeKind: "team", scopeKeys: TEAMS },
    ]);
  });

  it("EPA, which has no event-scoped state, still selects team rows only", () => {
    // The event selection is not blanket-applied: an algorithm with no event
    // rows must not name a scope kind it never writes.
    expect(selectionsFor("epa", EVENT_KEY, TEAMS)).toEqual([{ scopeKind: "team", scopeKeys: TEAMS }]);
    expect(EVENT_SCOPED_ALGORITHM_IDS.has("epa")).toBe(false);
  });

  it("every algorithm always selects the touched teams, event-scoped or not", () => {
    for (const id of ["opr", "epa", "vpr"]) {
      const teamSelection = selectionsFor(id, EVENT_KEY, TEAMS).find((s) => s.scopeKind === "team");
      expect(teamSelection, id).toBeDefined();
      expect(teamSelection!.scopeKeys, id).toEqual(TEAMS);
    }
  });

  it("adding the event selection costs NO extra subrequest — readScopedState binds every selection into ONE statement", () => {
    // Confirmed against `stateStore.ts`'s `readScopedState`, not assumed: it
    // builds a single `SELECT ... WHERE algorithm_id = ? AND ((scope_kind = ?
    // AND scope_key IN (...)) OR ... OR scope_kind = 'league')` and issues one
    // `.all()`. OPR has passed two selections since plan 04-08, which is
    // strong evidence but not proof; the shape assertion below is the proof
    // that VPR's selection list is the SAME shape OPR's already is, so it
    // cannot cost more than OPR's does.
    const oprShape = selectionsFor("opr", EVENT_KEY, TEAMS).map((s) => s.scopeKind);
    const vprShape = selectionsFor("vpr", EVENT_KEY, TEAMS).map((s) => s.scopeKind);
    expect(vprShape).toEqual(oprShape);
  });
});
