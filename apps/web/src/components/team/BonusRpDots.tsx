import { cn } from "@/lib/utils";
import { bonusDotLabel, bonusRpForSeason, type BonusRpState } from "@/lib/bonusRp";

export interface BonusRpDotsProps {
  season: number;
  side: "red" | "blue";
  /**
   * One state per bonus, in the season's own BONUS_NAMES order. A shorter
   * (or omitted) list leaves the remaining dots `unknown` — the current
   * production case, since no per-bonus data is published yet.
   */
  states?: readonly BonusRpState[];
  /**
   * One predicted probability per bonus, positionally aligned to the same
   * season bonus list `states` is aligned to (plan 06.1-06, PD-12). Only
   * consulted by `bonusDotLabel` to carry the real number into a predicted
   * dot's tooltip/accessible label — never used to derive `states` itself
   * (the caller derives `states` via `bonusStatesFromProbabilities`, which
   * this same array also feeds). Omitted entirely for an `actual` dot group.
   */
  probabilities?: readonly number[];
  /** "predicted" or "actual" — only used to disambiguate the testid and the accessible label. */
  kind: "predicted" | "actual";
  matchKey: string;
}

/**
 * The per-bonus RP dots drawn above one alliance's score (06 follow-up).
 *
 * One dot per bonus ranking point THAT SEASON — two for 2022–2024, three for
 * 2025–2026 — each carrying the bonus's initial. Win/tie RP is deliberately
 * absent: the Confidence chip and the Call column already carry it.
 *
 * Solid means earned (actual) or predicted to be earned; hollow means not.
 * A third state, `unknown`, is drawn dashed and muted — see `bonusRp.ts`'s
 * `BonusRpState` for why that is not the same thing as hollow, and why every
 * dot is currently in it.
 */
export function BonusRpDots({ season, side, states, probabilities, kind, matchKey }: BonusRpDotsProps) {
  const bonuses = bonusRpForSeason(season);
  if (bonuses.length === 0) return null;

  return (
    <span data-testid={`bonus-rp-${kind}-${matchKey}-${side}`} className="flex items-center gap-[2px]" role="group" aria-label={`${kind === "predicted" ? "Predicted" : "Actual"} bonus ranking points, ${side} alliance`}>
      {bonuses.map((bonus, index) => {
        const state: BonusRpState = states?.[index] ?? "unknown";
        const label = bonusDotLabel(bonus.label, state, kind, probabilities?.[index]);
        return (
          <span
            key={bonus.key}
            data-testid={`bonus-dot-${bonus.key}`}
            data-state={state}
            title={label}
            aria-label={label}
            className={cn("bonus-dot", `bonus-dot--${side}`, `bonus-dot--${state}`)}
          >
            {bonus.letter}
          </span>
        );
      })}
    </span>
  );
}
