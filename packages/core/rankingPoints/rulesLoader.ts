/**
 * One season's RP rules, loaded on demand. The browser must never import
 * `rules.ts`, whose `RP_RULE_MODULES` pulls in all ten seasons at once.
 *
 * Each thunk is a LITERAL dynamic import of one season file, so a bundler
 * emits one chunk per season. Node callers keep using `RP_RULE_MODULES`;
 * `rulesLoader.test.ts` pins that both resolve to the very same object and
 * that the two season lists stay equal.
 *
 * Never import `rules.ts` here, not even type-only.
 */
import type { RpRuleModule } from "./constants.js";

const LOADERS: Readonly<Record<number, () => Promise<RpRuleModule>>> = {
  2016: () => import("./2016.js").then((m) => m.rp2016),
  2017: () => import("./2017.js").then((m) => m.rp2017),
  2018: () => import("./2018.js").then((m) => m.rp2018),
  2019: () => import("./2019.js").then((m) => m.rp2019),
  2020: () => import("./2020.js").then((m) => m.rp2020),
  2022: () => import("./2022.js").then((m) => m.rp2022),
  2023: () => import("./2023.js").then((m) => m.rp2023),
  2024: () => import("./2024.js").then((m) => m.rp2024),
  2025: () => import("./2025.js").then((m) => m.rp2025),
  2026: () => import("./2026.js").then((m) => m.rp2026),
};

/** Every season `loadRpRuleModule` can load, sorted. */
export const RP_LOADABLE_SEASONS = Object.keys(LOADERS)
  .map(Number)
  .sort((a, b) => a - b) as readonly number[];

/**
 * The season's RP rule module, or `undefined` for a season without one (the
 * Worker's indexed-lookup convention: such a season still prices bands).
 */
export async function loadRpRuleModule(season: number): Promise<RpRuleModule | undefined> {
  const load = Object.hasOwn(LOADERS, season) ? LOADERS[season] : undefined;
  return load === undefined ? undefined : load();
}
