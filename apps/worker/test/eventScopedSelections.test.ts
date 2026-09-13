/**
 * D-09/D-V3: `selectionsFor` MUST return an event selection for every algorithm
 * that keeps event-scoped state, and MUST NOT for any algorithm that does not.
 *
 * Both halves are load-bearing and both fail silently, which is why this file
 * exists rather than relying on the integration suite:
 *
 *   - A MISSING selection for an algorithm that HAS event state (OPR today;
 *     Sigma1 between quick tasks 260902-varopr and 260903-750) destroys data.
 *     The tick deserializes with an EMPTY accumulator, `update()` rebuilds it
 *     from the one or two matches that tick happened to see, and
 *     `selectChangedRows` writes the result back — so an event's whole
 *     accumulated history is overwritten one tick at a time. The rows stay
 *     well-formed and the tick reports success.
 *   - A SPURIOUS selection for an algorithm that has NO event state (EPA,
 *     SPR) spends a subrequest per tick fetching a row that is never written,
 *     against a free-plan budget of 50 per invocation. That one also reports
 *     success forever.
 *
 * The retired Sigma1 core (deleted by quick task 260913-it4) moved from the
 * first category to the second at D-Y3 (quick task 260903-750). The tests below
 * assert the CURRENT membership in both directions.
 */
import { describe, expect, it } from "vitest";
import { EVENT_SCOPED_ALGORITHM_IDS, selectionsFor } from "../src/scheduled.js";

const EVENT_KEY = "2026casj";
const TEAMS = ["frc254", "frc1678", "frc604"];

describe("selectionsFor — event-scoped state must be loaded, and only where it exists (D-09/D-Y3)", () => {
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

  it("SPR, which has no event-scoped state, selects team rows only", () => {
    expect(selectionsFor("spr", EVENT_KEY, TEAMS)).toEqual([{ scopeKind: "team", scopeKeys: TEAMS }]);
    expect(EVENT_SCOPED_ALGORITHM_IDS.has("spr")).toBe(false);
  });

  it("the event-scoped set is exactly OPR", () => {
    expect([...EVENT_SCOPED_ALGORITHM_IDS]).toEqual(["opr"]);
  });

  it("every algorithm always selects the touched teams, event-scoped or not", () => {
    for (const id of ["opr", "epa", "spr"]) {
      const teamSelection = selectionsFor(id, EVENT_KEY, TEAMS).find((s) => s.scopeKind === "team");
      expect(teamSelection, id).toBeDefined();
      expect(teamSelection!.scopeKeys, id).toEqual(TEAMS);
    }
  });
});
