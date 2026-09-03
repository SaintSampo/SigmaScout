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
 *   - A SPURIOUS selection for an algorithm that has NO event state (Sigma1
 *     since D-Y3) spends a subrequest per tick fetching a row that is never
 *     written, against a free-plan budget of 50 per invocation. That one also
 *     reports success forever.
 *
 * D-Y3 (quick task 260903-750) moved Sigma1 from the first category to the
 * second: its published `±` became one running number per team, which rides the
 * team rows the tick already loads, so `EVENT_SCOPED_ALGORITHM_IDS` dropped
 * "vpr". The tests below assert the CURRENT membership in both directions.
 */
import { describe, expect, it } from "vitest";
import { EVENT_SCOPED_ALGORITHM_IDS, selectionsFor } from "../src/scheduled.js";

const EVENT_KEY = "2026casj";
const TEAMS = ["frc254", "frc1678", "frc604"];

describe("selectionsFor — event-scoped state must be loaded, and only where it exists (D-09/D-Y3)", () => {
  it("VPR gets NO event selection — its swing state rides the team rows (D-Y3)", () => {
    // THE RULE REVERSED HERE at 7.0.0, so the assertion is written as an
    // explicit emptiness rather than by deleting the old check. Sigma1 kept
    // event-scoped state for exactly one version (the per-event variance
    // decomposition's normal equations, 260902-varopr); D-Y3 replaced it with a
    // per-team running number, and `stateSnapshot.ts` correspondingly emits no
    // `scopeKind: "event"` row for vpr at all. Selecting one anyway would fetch
    // nothing and spend a subrequest doing it, every tick, forever.
    const selections = selectionsFor("vpr", EVENT_KEY, TEAMS);
    expect(selections.find((s) => s.scopeKind === "event")).toBeUndefined();
    expect(EVENT_SCOPED_ALGORITHM_IDS.has("vpr")).toBe(false);
    // Non-vacuity: vpr still selects something, so "no event selection" is a
    // statement about the SCOPE KIND rather than about an empty list.
    expect(selections).toEqual([{ scopeKind: "team", scopeKeys: TEAMS }]);
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

  it("VPR's selection list is now EPA's shape, not OPR's — the swap is visible in the selection itself", () => {
    // This assertion used to run the other way: it pinned vpr's shape EQUAL to
    // opr's, as the proof that adding an event selection cost vpr no extra
    // subrequest (`stateStore.ts`'s `readScopedState` binds every selection
    // into one prepared statement, so naming two scope kinds costs what naming
    // one does). D-Y3 removed the selection outright, so the honest pin is now
    // the OTHER pairing — and asserting it against BOTH neighbours is what
    // makes it a statement rather than a tautology: vpr matches the
    // team-scoped-only algorithm and differs from the event-scoped one.
    const oprShape = selectionsFor("opr", EVENT_KEY, TEAMS).map((s) => s.scopeKind);
    const epaShape = selectionsFor("epa", EVENT_KEY, TEAMS).map((s) => s.scopeKind);
    const vprShape = selectionsFor("vpr", EVENT_KEY, TEAMS).map((s) => s.scopeKind);
    expect(vprShape).toEqual(epaShape);
    expect(vprShape).not.toEqual(oprShape);
  });
});
