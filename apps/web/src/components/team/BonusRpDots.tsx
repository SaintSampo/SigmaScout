import { cn } from "@/lib/utils";
import { BONUS_DOT_INNER_PX, bonusDotFillPx, bonusDotLabel, bonusRpForSeason, type BonusDotState, type BonusRpState } from "@/lib/bonusRp";

export interface BonusRpDotsProps {
  season: number;
  side: "red" | "blue";
  /**
   * Actual dots only: one state per bonus, in the season's own BONUS_NAMES
   * order. A shorter (or omitted) list leaves the remaining dots `unknown`.
   * Ignored for a `predicted` group, which reads `probabilities` instead.
   */
  states?: readonly BonusRpState[];
  /**
   * Predicted dots only: one probability per bonus, positionally aligned to
   * the season's bonus list. A defined, finite probability fills its dot from
   * the bottom to the odds (F10, quick task 260914-01x, sketch 012 variant C),
   * and the exact percentage goes in the title and aria-label. An absent or
   * non-finite entry, or a shorter array, leaves that dot `unknown`. Omitted
   * for an `actual` group.
   */
  probabilities?: readonly number[];
  /** "predicted" or "actual": selects which prop drives the dots, the testid, and the accessible label. */
  kind: "predicted" | "actual";
  matchKey: string;
  /**
   * REQUIRED (G-06.1-26, plan 06.1-08, PD-18): whether bonus RP can exist at
   * all for this match's `compLevel` — the caller passes
   * `isBonusRpCompLevel(match.compLevel)` (`packages/core/rankingPoints/constants.ts`).
   * When `false`, every dot renders `unknown` REGARDLESS of `states` or
   * `probabilities` — this is the client-side defence-in-depth guard against
   * the ~54,671 already-published artifacts that still carry actual per-bonus
   * arrays on playoff rows (PD-16: no republish). Required, not optional, so a
   * future call site that forgets to pass it fails `pnpm typecheck` rather
   * than silently shipping a false earned/missed claim — the exact drift that
   * produced this gap on the pipeline's actual side in the first place.
   */
  applicable: boolean;
}

/**
 * The per-bonus RP dots drawn above one alliance's score (06 follow-up).
 *
 * One dot per bonus ranking point THAT SEASON — two for 2022–2024, three for
 * 2025–2026 — each carrying the bonus's initial. Win/tie RP is deliberately
 * absent: the Confidence chip and the Call column already carry it.
 *
 * An actual dot is solid when earned and hollow when not. A predicted dot has
 * no threshold: it fills from the bottom to its probability in whole pixels
 * (`bonusDotFillPx`), and never draws as empty or full. A third state,
 * `unknown`, is drawn dashed and muted for either kind — see `bonusRp.ts`'s
 * `BonusRpState` for why that is not the same thing as hollow. Every dot is
 * ALSO forced `unknown` when `applicable` is `false` (a playoff match — bonus
 * RP is a qualification-only mechanic), whatever the data carries.
 */
export function BonusRpDots({ season, side, states, probabilities, kind, matchKey, applicable }: BonusRpDotsProps) {
  const bonuses = bonusRpForSeason(season);
  if (bonuses.length === 0) return null;

  return (
    <span data-testid={`bonus-rp-${kind}-${matchKey}-${side}`} className="flex items-center gap-[2px]" role="group" aria-label={`${kind === "predicted" ? "Predicted" : "Actual"} bonus ranking points, ${side} alliance`}>
      {bonuses.map((bonus, index) => {
        const probability = kind === "predicted" ? probabilities?.[index] : undefined;
        const fillPx = applicable && kind === "predicted" ? bonusDotFillPx(probability, BONUS_DOT_INNER_PX) : undefined;
        const state: BonusDotState = !applicable ? "unknown" : kind === "predicted" ? (fillPx === undefined ? "unknown" : "predicted") : (states?.[index] ?? "unknown");
        const label = applicable
          ? bonusDotLabel(bonus.label, state, kind, fillPx === undefined ? undefined : probability)
          : `${bonus.label}: not awarded outside qualification matches`;

        if (state === "predicted" && fillPx !== undefined) {
          return (
            <span
              key={bonus.key}
              data-testid={`bonus-dot-${bonus.key}`}
              data-state={state}
              data-fill-px={fillPx}
              title={label}
              aria-label={label}
              className={cn("bonus-dot", `bonus-dot--${side}`, "bonus-dot--predicted")}
            >
              <span aria-hidden="true" className="bonus-dot__fill" style={{ height: `${fillPx}px` }} />
              <span className="bonus-dot__letter">{bonus.letter}</span>
            </span>
          );
        }

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
