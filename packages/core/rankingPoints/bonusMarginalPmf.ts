/**
 * The ranking-point pmf built from PER-BONUS MARGINAL probabilities and a win
 * probability, with no threshold-variable moments at all.
 *
 * `analyticPmf.ts` builds SPR's RP odds from a fitted distribution over each
 * threshold variable (moments, a marginal family, a tier threshold). EPA's RP
 * odds come from Statbotics' method instead (quick task 260929-mat): every team
 * carries one rating per bonus, the alliance sums them and `unit_sigmoid` turns
 * the sum into a probability. What reaches this module is therefore one number
 * per bonus per alliance, and this module only has to compose those numbers into
 * the same published shapes `analyticRpPmf` returns, so the rank simulation and
 * the web read EPA's odds exactly as they read SPR's.
 *
 * Composition rules:
 *   - A bonus is an independent Bernoulli `[1 - p, p]` (Statbotics treats each
 *     `rp_x` independently).
 *   - EXCEPT a `nestedSameVariable` group (2026 energized and supercharged), whose
 *     joint is an interval probability: sorted by the resolved tier threshold,
 *     clamped monotone non-increasing (`q_hard = min(q_hard, q_easy)`) and
 *     enumerated as the telescoping count pmf `[1 - q0, q0 - q1, ..., q_last]`,
 *     so "the harder bonus without the easier one" never carries mass. The
 *     published per-bonus marginals are the CLAMPED values.
 *   - The outcome is binary, `[pRedWin, 0, 1 - pRedWin]`: EPA models no tie,
 *     matching Statbotics' binary `win_prob`. Bonus RP is independent of the
 *     outcome.
 *
 * Pure and Worker-importable: no Node-only API, no binding. SPR never calls it,
 * and `analyticPmf.ts` is not edited by it; only its shared shapes are reused.
 */
import type { CompLevel } from "../algorithms/types.js";
import { convolvePmf, type AnalyticRpPmfResult, type RpOutcomeDistribution } from "./analyticPmf.js";
import {
  eventTierFor,
  isBonusRpCompLevel,
  resolveRpThreshold,
  type BonusPredicate,
  type RpRuleModule,
} from "./constants.js";

/** Input to `bonusMarginalRpPmf`. Both probability arrays are in `ruleModule.bonusNames` order. */
export interface BonusMarginalRpPmfInput {
  readonly redBonusProbabilities: readonly number[];
  readonly blueBonusProbabilities: readonly number[];
  /** The algorithm's own published win probability; the tie share is 0. */
  readonly pRedWin: number;
  readonly ruleModule: RpRuleModule;
  readonly eventType: number;
  readonly compLevel: CompLevel;
}

type NestedPredicate = Extract<BonusPredicate, { kind: "nestedSameVariable" }>;

function assertNormalized(pmf: readonly number[], season: number, label: string): void {
  let sum = 0;
  for (const p of pmf) {
    if (!Number.isFinite(p) || p < 0 || p > 1 + 1e-12) {
      throw new Error(`bonusMarginalRpPmf: season ${season} ${label} pmf has a non-finite or out-of-[0,1] entry (${p}) — refusing to publish`);
    }
    sum += p;
  }
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`bonusMarginalRpPmf: season ${season} ${label} pmf sums to ${sum}, expected 1 within 1e-9`);
  }
}

interface AllianceBonus {
  readonly pmf: number[];
  readonly bonusProbabilities: number[];
}

/** One alliance's bonus-only pmf from its per-bonus marginals, with nested groups enumerated by interval. */
function allianceBonus(probabilities: readonly number[], ruleModule: RpRuleModule, eventType: number, label: string): AllianceBonus {
  const season = ruleModule.season;
  const names = ruleModule.bonusNames;
  if (probabilities.length !== names.length) {
    throw new Error(
      `bonusMarginalRpPmf: season ${season} ${label} has ${probabilities.length} bonus probabilities, expected ${names.length} (bonusNames.length)`
    );
  }
  const byName = new Map<string, number>();
  names.forEach((name, index) => {
    const p = probabilities[index]!;
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new Error(`bonusMarginalRpPmf: season ${season} ${label} bonus "${name}" probability ${p} is non-finite or outside [0, 1]`);
    }
    byName.set(name, p);
  });

  const tier = eventTierFor(eventType);
  const published = new Map<string, number>();
  let pmf: number[] = [1];

  // Nested predicates grouped by threshold variable; every other bonus is independent.
  const nestedByVariable = new Map<string, NestedPredicate[]>();
  for (const predicate of ruleModule.bonusPredicates) {
    if (predicate.kind === "nestedSameVariable") {
      const list = nestedByVariable.get(predicate.variable);
      if (list === undefined) nestedByVariable.set(predicate.variable, [predicate]);
      else list.push(predicate);
    } else {
      const p = byName.get(predicate.name);
      if (p === undefined) {
        throw new Error(`bonusMarginalRpPmf: season ${season} bonus "${predicate.name}" has no probability`);
      }
      published.set(predicate.name, p);
      pmf = convolvePmf(pmf, [1 - p, p]);
    }
  }

  for (const [variable, group] of nestedByVariable) {
    const direction = group[0]!.direction;
    for (const member of group) {
      if (member.direction !== direction) {
        throw new Error(
          `bonusMarginalRpPmf: season ${season} nestedSameVariable group over "${variable}" mixes directions ("${direction}" vs "${member.direction}") — no exact joint form exists for this shape`
        );
      }
      for (const sibling of member.nestedWith) {
        const siblingPredicate = ruleModule.bonusPredicates.find((p) => p.name === sibling);
        if (siblingPredicate !== undefined && (siblingPredicate.kind !== "nestedSameVariable" || siblingPredicate.variable !== variable)) {
          throw new Error(
            `bonusMarginalRpPmf: season ${season} nestedSameVariable group over "${variable}" spans multiple variables (sibling "${sibling}") — no exact joint form exists for this shape`
          );
        }
      }
    }
    if (direction !== "gte") {
      throw new Error(
        `bonusMarginalRpPmf: season ${season} nestedSameVariable group over "${variable}" uses direction "lte", which this module has no implementation for — handle it or throw, never silently assume "gte"`
      );
    }
    const sorted = group
      .map((member) => ({ member, threshold: resolveRpThreshold(member.threshold, tier) }))
      .sort((a, b) => a.threshold - b.threshold);
    const qs: number[] = [];
    for (const { member } of sorted) {
      const raw = byName.get(member.name)!;
      // Clamped monotone non-increasing: a harder threshold can never be likelier.
      qs.push(qs.length === 0 ? raw : Math.min(raw, qs[qs.length - 1]!));
    }
    const n = qs.length;
    const groupPmf = new Array<number>(n + 1).fill(0);
    groupPmf[0] = 1 - qs[0]!;
    for (let k = 1; k < n; k++) groupPmf[k] = qs[k - 1]! - qs[k]!;
    groupPmf[n] = qs[n - 1]!;
    sorted.forEach(({ member }, index) => published.set(member.name, qs[index]!));
    pmf = convolvePmf(pmf, groupPmf);
  }

  assertNormalized(pmf, season, `${label} bonus-only`);
  if (pmf.length !== names.length + 1) {
    throw new Error(
      `bonusMarginalRpPmf: season ${season} ${label} bonus-only pmf has length ${pmf.length}, expected ${names.length + 1} (bonusNames.length + 1)`
    );
  }
  return { pmf, bonusProbabilities: names.map((name) => published.get(name)!) };
}

/** Outcome-RP pmf of length `winRp + 1`: loss at index 0, tie at `tieRp`, win at `winRp`, accumulated with `+=`. */
function outcomePmf(winProb: number, tieProb: number, loseProb: number, winRp: number, tieRp: number): number[] {
  const pmf = new Array<number>(winRp + 1).fill(0);
  pmf[winRp]! += winProb;
  pmf[tieRp]! += tieProb;
  pmf[0]! += loseProb;
  return pmf;
}

/**
 * One match's RP pmfs for both alliances from per-bonus marginals and a win
 * probability. A non-qualification `compLevel` short-circuits to `P(RP=0)=1`,
 * mirroring `analyticRpPmf`. The result carries no `marginals` or
 * `marginalResolution` fields: no distribution is fitted here.
 */
export function bonusMarginalRpPmf(input: BonusMarginalRpPmfInput): AnalyticRpPmfResult {
  const { ruleModule, eventType, compLevel, pRedWin } = input;
  if (!isBonusRpCompLevel(compLevel)) {
    return { redPmf: [1], bluePmf: [1] };
  }
  if (!Number.isFinite(pRedWin) || pRedWin < 0 || pRedWin > 1) {
    throw new Error(`bonusMarginalRpPmf: season ${ruleModule.season} pRedWin ${pRedWin} is non-finite or outside [0, 1]`);
  }

  const red = allianceBonus(input.redBonusProbabilities, ruleModule, eventType, "red");
  const blue = allianceBonus(input.blueBonusProbabilities, ruleModule, eventType, "blue");

  const outcome: RpOutcomeDistribution = {
    pRedWin,
    pTie: 0,
    pBlueWin: 1 - pRedWin,
    winRp: ruleModule.winRp,
    tieRp: ruleModule.tieRp,
  };
  const redPmf = convolvePmf(outcomePmf(outcome.pRedWin, outcome.pTie, outcome.pBlueWin, outcome.winRp, outcome.tieRp), red.pmf);
  const bluePmf = convolvePmf(outcomePmf(outcome.pBlueWin, outcome.pTie, outcome.pRedWin, outcome.winRp, outcome.tieRp), blue.pmf);

  assertNormalized(redPmf, ruleModule.season, "red");
  assertNormalized(bluePmf, ruleModule.season, "blue");
  const expectedLength = ruleModule.maxRp + 1;
  if (redPmf.length !== expectedLength || bluePmf.length !== expectedLength) {
    throw new Error(
      `bonusMarginalRpPmf: season ${ruleModule.season} pmf length mismatch — expected ${expectedLength} (maxRp + 1), got red=${redPmf.length} blue=${bluePmf.length}`
    );
  }

  return {
    redPmf,
    bluePmf,
    ...(red.bonusProbabilities.length > 0 ? { redBonusProbabilities: red.bonusProbabilities } : {}),
    ...(blue.bonusProbabilities.length > 0 ? { blueBonusProbabilities: blue.bonusProbabilities } : {}),
    redBonusPmf: red.pmf,
    blueBonusPmf: blue.pmf,
    outcome,
  };
}
