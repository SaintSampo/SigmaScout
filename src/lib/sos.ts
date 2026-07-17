// Strength of schedule for an event's qualification matches.
//
// FRC is 3v3, so a hard schedule means strong OPPONENTS *and/or* weak PARTNERS.
// We capture both with a model-native measure: for each of a team's quals,
// replace the team itself with a league-average robot and ask how often that
// average robot's alliance (its actual partners + the neutral robot) would beat
// its actual opponents. Average over the schedule → "avg-team win rate". A low
// value means even an average team would struggle with this draw = hard schedule.
// We also report the raw average opponent and partner strength for context.

import type { EventData, TeamKey } from "../core/types";
import { probAGreaterThanB } from "../core/stats";

export interface SosRow {
  team: TeamKey;
  name?: string;
  /** Avg opponent strength per robot, RELATIVE to the event-average team
   *  (positive = faced tougher-than-typical opponents for this event). */
  oppRel: number;
  /** Avg partner strength per robot, relative to the event-average team
   *  (negative = weaker-than-typical partners). */
  partnerRel: number;
  /** Win probability the event-average robot would have on this schedule (0–1). */
  avgTeamWinRate: number;
  matches: number;
}

export function strengthOfSchedule(data: EventData): SosRow[] {
  const comps = data.componentIds;
  const byTeam = new Map(data.teams.map((t) => [t.team, t]));

  // League-average (neutral) robot: mean of each component across event teams.
  const neutralMean: Record<string, number> = {};
  const neutralVar: Record<string, number> = {};
  for (const c of comps) {
    let sm = 0;
    let sv = 0;
    for (const t of data.teams) {
      sm += t.components[c].mean;
      sv += t.components[c].variance;
    }
    const n = data.teams.length || 1;
    neutralMean[c] = sm / n;
    neutralVar[c] = sv / n;
  }

  const overall = (t: TeamKey) =>
    comps.reduce((s, c) => s + (byTeam.get(t)?.components[c].mean ?? 0), 0);

  const acc = new Map<
    TeamKey,
    { opp: number; partner: number; win: number; n: number }
  >();
  const bump = (team: TeamKey, opp: number, partner: number, win: number) => {
    const a = acc.get(team) ?? { opp: 0, partner: 0, win: 0, n: 0 };
    a.opp += opp;
    a.partner += partner;
    a.win += win;
    a.n += 1;
    acc.set(team, a);
  };

  for (const m of data.qualMatches) {
    if (m.red.length !== 3 || m.blue.length !== 3) continue;
    for (const [mine, opp] of [
      [m.red, m.blue],
      [m.blue, m.red],
    ] as [TeamKey[], TeamKey[]][]) {
      for (const team of mine) {
        const partners = mine.filter((t) => t !== team);
        // Neutral-robot alliance (neutral + partners) vs the real opponents.
        let allyMean = 0;
        let allyVar = 0;
        let oppMean = 0;
        let oppVar = 0;
        for (const c of comps) {
          const r = data.residualVariance[c] ?? 0;
          let am = neutralMean[c];
          let av = neutralVar[c] + r;
          for (const p of partners) {
            const cc = byTeam.get(p)?.components[c];
            if (cc) {
              am += cc.mean;
              av += cc.variance;
            }
          }
          let om = 0;
          let ov = r;
          for (const o of opp) {
            const cc = byTeam.get(o)?.components[c];
            if (cc) {
              om += cc.mean;
              ov += cc.variance;
            }
          }
          allyMean += am;
          allyVar += av;
          oppMean += om;
          oppVar += ov;
        }
        const win = probAGreaterThanB(allyMean, allyVar, oppMean, oppVar);
        bump(team, opp.reduce((s, t) => s + overall(t), 0), partners.reduce((s, t) => s + overall(t), 0), win);
      }
    }
  }

  // Event-average team rating — the baseline everything is measured against, so
  // a stronger event doesn't just make everyone's numbers bigger.
  const eventAvg =
    data.teams.reduce((s, t) => s + comps.reduce((ss, c) => ss + t.components[c].mean, 0), 0) /
    (data.teams.length || 1);

  const rows: SosRow[] = [...acc].map(([team, a]) => ({
    team,
    name: byTeam.get(team)?.name,
    oppRel: a.opp / a.n / 3 - eventAvg, // avg opponent per robot vs event average
    partnerRel: a.partner / a.n / 2 - eventAvg, // avg partner per robot vs event average
    avgTeamWinRate: a.win / a.n,
    matches: a.n,
  }));
  // Hardest schedule first (lowest avg-team win rate).
  rows.sort((x, y) => x.avgTeamWinRate - y.avgTeamWinRate);
  return rows;
}
