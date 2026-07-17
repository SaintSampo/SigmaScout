// Per-season ranking-point rules. We hand-code only the base win/tie/loss RP and
// the NAMES of the bonus-achievement boolean fields in TBA's score_breakdown
// (found by inspection, like the score decomposers). We deliberately do NOT
// hand-code any thresholds — the logistic RP model learns those from data, which
// also captures the DCMP/championship threshold changes automatically.

export interface RpSeasonConfig {
  win: number;
  tie: number;
  loss: number;
  /** Each bonus RP: display name + the boolean field that records it. */
  bonuses: { name: string; field: string }[];
}

export const RP_CONFIG: Record<number, RpSeasonConfig> = {
  // 2026 verified from data: win=3, loss=0; three +1 bonuses earned win-or-lose.
  2026: {
    win: 3,
    tie: 1,
    loss: 0,
    bonuses: [
      { name: "Energized", field: "energizedAchieved" },
      { name: "Supercharged", field: "superchargedAchieved" },
      { name: "Traversal", field: "traversalAchieved" },
    ],
  },
};

export function rpConfigFor(season: number): RpSeasonConfig {
  const c = RP_CONFIG[season];
  if (!c) throw new Error(`No RP config for season ${season} yet.`);
  return c;
}
