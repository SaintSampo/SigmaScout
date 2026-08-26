import { describe, expect, it } from "vitest";
import { componentMapForSeason } from "./index.js";
import {
  COMPONENT_GROUP_IDS,
  COMPONENT_GROUP_METRIC_KEYS,
  componentGroupsForSeason,
  componentsInGroup,
  UNGROUPED_COMPONENTS,
} from "./groups.js";

const SEASONS = [2022, 2023, 2024, 2025, 2026];

describe("component groups cover every season exactly once", () => {
  for (const season of SEASONS) {
    it(`${season}: every component is grouped exactly once, or explicitly ungrouped`, () => {
      const declared = componentMapForSeason(season).components;
      const assigned = COMPONENT_GROUP_IDS.flatMap((id) => componentsInGroup(season, id));

      expect(new Set(assigned).size, "a component may not appear in two groups").toBe(assigned.length);

      for (const key of assigned) {
        expect(declared, `${key} is not a ${season} component`).toContain(key);
      }

      // Nothing may be silently dropped. This is what forces a newly
      // registered season's grouping to be decided rather than defaulted.
      const accounted = new Set([...assigned, ...UNGROUPED_COMPONENTS]);
      for (const key of declared) {
        expect(accounted.has(key), `${season} component "${key}" is neither grouped nor explicitly ungrouped`).toBe(true);
      }
    });
  }

  it("registers a grouping for every season the corpus declares", () => {
    for (const season of SEASONS) {
      expect(componentGroupsForSeason(season), `${season} has no grouping`).toBeDefined();
    }
  });
});

describe("group metric keys are collision-free", () => {
  /**
   * The reason these keys are prefixed at all. 2022's endgame component is
   * named exactly `endgame`; an unprefixed "endgame" group key would land on
   * the same property of the same metrics record and silently overwrite a
   * real published component.
   */
  it("no group metric key equals any component name in any season", () => {
    const groupKeys = Object.values(COMPONENT_GROUP_METRIC_KEYS);
    for (const season of SEASONS) {
      for (const component of componentMapForSeason(season).components) {
        expect(groupKeys, `${season} component "${component}" collides with a group metric key`).not.toContain(component);
      }
    }
  });

  it("2022 specifically declares a bare `endgame` component — the collision this guards against is real, not hypothetical", () => {
    expect(componentMapForSeason(2022).components).toContain("endgame");
    expect(COMPONENT_GROUP_METRIC_KEYS.endgame).not.toBe("endgame");
  });

  it("every group id has a distinct metric key", () => {
    const keys = Object.values(COMPONENT_GROUP_METRIC_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(COMPONENT_GROUP_IDS.length);
  });
});
