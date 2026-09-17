import { cn } from "@/lib/utils";
import { bonusDotLabel, bonusDotTier, bonusRpForSeason, type BonusDotState, type BonusRpState } from "@/lib/bonusRp";

export interface BonusRpDotsProps {
  season: number;
  side: "red" | "blue";
  /** Actual dots only: one state per bonus, in the season's BONUS_NAMES order; missing entries render `unknown`. */
  states?: readonly BonusRpState[];
  /**
   * Predicted dots only: one probability per bonus, positionally aligned to
   * the season's bonus list. A finite probability draws one of three tiers
   * (`bonusDotTier`, cut at one third and two thirds); an absent or
   * non-finite entry, or a shorter array, leaves that dot `unknown`.
   */
  probabilities?: readonly number[];
  /** "predicted" or "actual": selects which prop drives the dots, the testid, and the accessible label. */
  kind: "predicted" | "actual";
  matchKey: string;
  /**
   * Whether bonus RP can exist for this match's `compLevel`: pass
   * `isBonusRpCompLevel(match.compLevel)`. When `false`, every dot renders
   * `unknown` whatever `states` or `probabilities` carry, guarding against
   * published artifacts that carry per-bonus arrays on playoff rows. Required
   * so a forgotten call site fails typecheck instead of shipping a false
   * earned/missed claim.
   */
  applicable: boolean;
}

/**
 * One dot per bonus ranking point that season, above one alliance's score,
 * each carrying the bonus's initial. An actual dot draws the alliance's 30%
 * ground when earned and shrinks to a small letterless pip when not earned.
 * A predicted dot draws one of three categorical tiers (`bonusDotTier`) —
 * an alliance-coloured outline under one third, a diagonal hatch of the 30%
 * tint between one third and two thirds, the SAME 30% ground an earned dot
 * draws above two thirds — rather than a continuous fill, so the read stays
 * unmistakable at 14px. Every non-unknown dot's letter is one dark ink,
 * never an alliance-tinted one. `unknown` draws dashed and muted for either
 * kind (see `BonusRpState`), and every dot is `unknown` when `applicable` is
 * `false` because bonus RP is qualification-only.
 */
export function BonusRpDots({ season, side, states, probabilities, kind, matchKey, applicable }: BonusRpDotsProps) {
  const bonuses = bonusRpForSeason(season);
  if (bonuses.length === 0) return null;

  return (
    <span data-testid={`bonus-rp-${kind}-${matchKey}-${side}`} className="flex items-center gap-[2px]" role="group" aria-label={`${kind === "predicted" ? "Predicted" : "Actual"} bonus ranking points, ${side} alliance`}>
      {bonuses.map((bonus, index) => {
        const probability = kind === "predicted" ? probabilities?.[index] : undefined;
        const tier = applicable && kind === "predicted" ? bonusDotTier(probability) : undefined;
        const state: BonusDotState = !applicable ? "unknown" : kind === "predicted" ? (tier === undefined ? "unknown" : "predicted") : (states?.[index] ?? "unknown");
        const label = applicable
          ? bonusDotLabel(bonus.label, state, kind, tier === undefined ? undefined : probability)
          : `${bonus.label}: not awarded outside qualification matches`;

        return (
          <span
            key={bonus.key}
            data-testid={`bonus-dot-${bonus.key}`}
            data-state={state}
            data-tier={tier}
            title={label}
            aria-label={label}
            className={cn("bonus-dot", `bonus-dot--${side}`, state === "predicted" ? ["bonus-dot--predicted", `bonus-dot--tier-${tier}`] : `bonus-dot--${state}`)}
          >
            {bonus.letter}
          </span>
        );
      })}
    </span>
  );
}
