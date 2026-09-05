import { Link } from "@tanstack/react-router";
import { METHODOLOGY_CARDS } from "./methodologyCardData.js";

/**
 * Cross-route search carry — the same documented escape hatch `Ribbon.tsx`'s
 * `preserveSearch` uses (see that function's doc comment) and `routes/index.tsx`'s
 * own local copy: the target routes' search params all carry safe defaults, so
 * returning the current params unchanged is identity behavior at runtime, even
 * though there is no single TanStack Router type that expresses "carry every
 * current param forward unchanged, for any target route in the tree."
 */
function preserveSearch(prev: Record<string, unknown>): never {
  return prev as never;
}

/**
 * The `/methodology` hub's card grid (quick task 260905-phf Task 1).
 *
 * Two explicit `<Link>` elements rather than a `.map()` over `METHODOLOGY_CARDS`
 * — same reasoning `Ribbon.tsx`'s `NavLinks` already documents: each `Link`'s
 * `to` prop needs its own precise literal route path for TanStack Router's
 * typed `search` prop to type-check at all, and mapping over the descriptor
 * union loses that per-route overload resolution. `METHODOLOGY_CARDS` stays
 * the single source of titles, blurbs and order regardless.
 *
 * Whole-card links wearing `.event-card` (this app's shared card treatment,
 * `CalibrationSection.tsx`'s `.event-card ... shadow-sm` pattern) with a
 * border/shadow-only hover — no green fill, per the sketch-findings skill's
 * green-is-ink-not-paint rule.
 */
export function MethodologyCards() {
  const [vprCard, compareCard] = METHODOLOGY_CARDS;
  if (vprCard === undefined || compareCard === undefined) return null;

  return (
    <div className="grid gap-[var(--spacing-md)] md:grid-cols-2">
      <Link
        to={vprCard.to}
        search={preserveSearch}
        data-testid={vprCard.testId}
        className="event-card flex flex-col gap-[var(--spacing-xs)] p-[var(--spacing-md)] shadow-sm transition-shadow hover:shadow-md hover:border-[var(--color-text-muted)]"
      >
        <span className="text-role-heading text-[var(--color-text-primary)]">{vprCard.title}</span>
        <span className="text-role-body text-[var(--color-text-muted)]">{vprCard.blurb}</span>
      </Link>
      <Link
        to={compareCard.to}
        search={preserveSearch}
        data-testid={compareCard.testId}
        className="event-card flex flex-col gap-[var(--spacing-xs)] p-[var(--spacing-md)] shadow-sm transition-shadow hover:shadow-md hover:border-[var(--color-text-muted)]"
      >
        <span className="text-role-heading text-[var(--color-text-primary)]">{compareCard.title}</span>
        <span className="text-role-body text-[var(--color-text-muted)]">{compareCard.blurb}</span>
      </Link>
    </div>
  );
}
