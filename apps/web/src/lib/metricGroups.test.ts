import { describe, expect, it } from "vitest";
import { COMPONENT_GROUP_METRIC_KEYS } from "../../../../packages/core/algorithms/breakdown/index.js";
import { epa, type EpaState } from "../../../../packages/core/algorithms/epa.js";
import { emptyExpandingStats } from "../../../../packages/core/scoring/expandingStats.js";
import { groupMetricKey, METRIC_GROUPS, withDerivedGroupMetrics } from "./metricGroups.js";

/**
 * The grouping itself is tested in core
 * (`packages/core/algorithms/breakdown/groups.test.ts`): season coverage,
 * no double-assignment, and no collision between a group metric key and a
 * component name. This file only checks the display adapter.
 */
describe("metricGroups display adapter", () => {
  it("exposes exactly the three phase groups, in auto/teleop/endgame order", () => {
    expect(METRIC_GROUPS.map((g) => g.id)).toEqual(["auto", "teleop", "endgame"]);
    expect(METRIC_GROUPS.map((g) => g.label)).toEqual(["Auto", "Teleop", "Endgame"]);
  });

  it("names the same published metric keys core emits — never a local copy", () => {
    for (const group of METRIC_GROUPS) {
      expect(group.metricKey).toBe(COMPONENT_GROUP_METRIC_KEYS[group.id]);
      expect(groupMetricKey(group.id)).toBe(COMPONENT_GROUP_METRIC_KEYS[group.id]);
    }
  });

  it("computes nothing — a group's value, spread and percentile all come from the artifact", () => {
    // Guards the regression this module was rewritten to remove: any local
    // summing would have to accept a `metrics` argument.
    for (const group of METRIC_GROUPS) {
      expect(Object.keys(group).sort()).toEqual(["id", "label", "metricKey"]);
    }
    expect(groupMetricKey.length).toBe(1);
  });
});

/**
 * `withDerivedGroupMetrics` (2026-09-04, quick task 260904-5zg). Originally
 * fixed EPA's teams artifact never publishing group metrics at all — every
 * surface reading `phaseAuto`/`phaseTeleop`/`phaseEndgame` rendered blank
 * for EPA. As of 260904-7id, the pipeline now publishes EPA's groups too
 * (with a season-wide percentile/tier), so this derivation's role narrowed:
 * it is the STALE-ARTIFACT FALLBACK — a browser holding a cached
 * pre-260904-7id EPA artifact has published components but no published
 * group entry yet, and needs an honest, value-only number rather than
 * nothing. It still applies unconditionally to any input whose `metrics`
 * carries components but no published group entry, regardless of which
 * algorithm produced them, and it still never fabricates a spread,
 * percentile or tier — see this module's own header comment for the full
 * honesty argument.
 */
describe("withDerivedGroupMetrics — stale-artifact fallback (a metrics record with components present but no published group entry)", () => {
  it("sums the present component values exactly — plain arithmetic, no rounding or rescaling", () => {
    const metrics = { autoTower: { value: 3 }, hubAuto: { value: 5 } };
    const result = withDerivedGroupMetrics(metrics, 2026);
    expect(result.phaseAuto).toEqual({ value: 8 });
  });

  it("a derived entry carries a value ONLY — no spread, no percentile, no tier (never invented, since the client has no season-wide pool to rank against)", () => {
    const metrics = { autoTower: { value: 3 }, hubAuto: { value: 5 } };
    const result = withDerivedGroupMetrics(metrics, 2026);
    const entry = result.phaseAuto as { value: number; spread?: number; percentile?: number; tier?: string };
    expect(entry.spread).toBeUndefined();
    expect(entry.percentile).toBeUndefined();
    expect(entry.tier).toBeUndefined();
    expect(Object.keys(entry)).toEqual(["value"]);
  });

  it("a published group entry (VPR's own, or EPA's as of 260904-7id) survives byte-identical — derivation never overwrites publication", () => {
    const publishedPhaseAuto = { value: 42, spread: 2.1, percentile: 88, tier: "epic" as const };
    const metrics = { autoTower: { value: 3 }, hubAuto: { value: 5 }, phaseAuto: publishedPhaseAuto };
    const result = withDerivedGroupMetrics(metrics, 2026);
    expect(result.phaseAuto).toBe(publishedPhaseAuto);

    // EPA case: a published (not derived) value-only group entry, exactly
    // the shape `epa.ts`'s `teamMetrics()` now emits, still wins by
    // reference over what this function would have derived from the same
    // components.
    const publishedEpaPhaseAuto = { value: 8 };
    const epaMetrics = { autoTower: { value: 3 }, hubAuto: { value: 5 }, phaseAuto: publishedEpaPhaseAuto };
    const epaResult = withDerivedGroupMetrics(epaMetrics, 2026);
    expect(epaResult.phaseAuto).toBe(publishedEpaPhaseAuto);
  });

  it("a group whose components are all absent from the input yields NO entry — never a fabricated {value: 0}", () => {
    // Only a teleop component present — nothing in `auto`'s own component set.
    const metrics = { hubTransition: { value: 10 } };
    const result = withDerivedGroupMetrics(metrics, 2026);
    expect(result.phaseAuto).toBeUndefined();
    expect("phaseAuto" in result).toBe(false);
  });

  it("UNGROUPED_COMPONENTS (adjust, foulsCommitted) contribute to no group sum — the three groups sum to strictly less than total", () => {
    const metrics = {
      autoTower: { value: 10 },
      hubAuto: { value: 5 },
      hubTransition: { value: 8 },
      hubShift1: { value: 2 },
      hubShift2: { value: 2 },
      hubShift3: { value: 2 },
      hubShift4: { value: 2 },
      endGameTower: { value: 6 },
      hubEndgame: { value: 4 },
      adjust: { value: 1 },
      foulsCommitted: { value: 20 },
      total: { value: 62 },
    };
    const result = withDerivedGroupMetrics(metrics, 2026);
    const groupSum =
      (result.phaseAuto as { value: number }).value +
      (result.phaseTeleop as { value: number }).value +
      (result.phaseEndgame as { value: number }).value;
    expect(groupSum).toBeLessThan((result.total as { value: number }).value);
  });

  it("a season with no registered grouping returns the input unchanged rather than throwing", () => {
    const metrics = { total: { value: 10 } };
    expect(() => withDerivedGroupMetrics(metrics, 2021)).not.toThrow();
    expect(withDerivedGroupMetrics(metrics, 2021)).toBe(metrics);
  });
});

/**
 * D-3 (quick task 260904-7id): the property that makes "identical by
 * construction" a checkable claim rather than an assertion of intent. For
 * ONE component record, this computes `withDerivedGroupMetrics`'s value on
 * one side and `epa.teamMetrics`'s PUBLISHED value on the other — both
 * derived from `packages/core`, never two hand-typed numbers — and asserts
 * they are exactly equal. Both read the SAME single grouping source
 * (`componentGroupsForSeason`/`componentsInGroup` in
 * `packages/core/algorithms/breakdown/groups.ts`), which is what makes this
 * true by construction rather than by two lists kept in step.
 */
describe("metricGroups <-> epa.teamMetrics parity (D-3, 260904-7id)", () => {
  it("withDerivedGroupMetrics's phaseAuto value equals epa.teamMetrics's published phaseAuto value, for the same season and component set", () => {
    const components = { autoTower: 3, hubAuto: 5, hubTransition: 10, endGameTower: 2 };
    const state: EpaState = {
      season: 2026,
      teamComponents: new Map([["frc1", components]]),
      teamMatchCounts: new Map([["frc1", 1]]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: { lastSeason: new Map(), yearBefore: new Map() },
      breakdownParseFailureCount: 0,
    };
    const published = epa.teamMetrics(state)["frc1"]!;

    // The client-side input is the SAME component values, shaped as the
    // value-only metrics record `withDerivedGroupMetrics` reads.
    const clientMetrics = Object.fromEntries(Object.entries(components).map(([name, value]) => [name, { value }]));
    const derived = withDerivedGroupMetrics(clientMetrics, 2026);

    expect(published["phaseAuto"]).toBeDefined();
    expect((derived.phaseAuto as { value: number }).value).toBeCloseTo(published["phaseAuto"]!.value, 10);
  });
});
