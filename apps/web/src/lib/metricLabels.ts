/**
 * Human display labels for published metric keys (2026-09-01 redesign):
 * the site never again shows a raw artifact key like `hubShift2` as a
 * column header. One shared function so the Teams table, the Breakdown tab
 * and any future surface can never disagree about what a key is called.
 *
 * Derivation, not a hand map: the component key sets differ per season
 * (`componentMapForSeason`), so a hand-typed label map would silently rot
 * the first time a season adds a key. camelCase and letter→digit
 * boundaries become spaces, then Title Case — "hubShift2" → "Hub Shift 2",
 * "foulsCommitted" → "Fouls Committed", "autoCoral" → "Auto Coral".
 */
import { METRIC_GROUPS } from "./metricGroups.js";
import { TOTAL_KEY } from "./metricKeys.js";

const GROUP_LABEL_BY_KEY: ReadonlyMap<string, string> = new Map(METRIC_GROUPS.map((group) => [group.metricKey, group.label]));

export function metricDisplayLabel(key: string): string {
  if (key === TOTAL_KEY) return "Total";
  const groupLabel = GROUP_LABEL_BY_KEY.get(key);
  if (groupLabel !== undefined) return groupLabel;
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2");
  return spaced
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
