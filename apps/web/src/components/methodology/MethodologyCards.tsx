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
 * The `/methodology` hub's card grid (quick task 260905-phf Task 1; widened
 * to a third card by quick task 260905-tor, and to a fourth — the Swing
 * Factor page — by quick task 260909-3fj).
 *
 * Explicit `<Link>` elements — one per card — rather than a `.map()` over
 * `METHODOLOGY_CARDS` — same reasoning `Ribbon.tsx`'s `NavLinks` already
 * documents: each `Link`'s `to` prop needs its own precise literal route
 * path for TanStack Router's typed `search` prop to type-check at all, and
 * mapping over the descriptor union loses that per-route overload
 * resolution. `METHODOLOGY_CARDS` stays the single source of titles, blurbs
 * and order regardless.
 *
 * BECAUSE the destructure below is POSITIONAL, `METHODOLOGY_CARDS`' order is
 * load bearing: swapping two entries there without swapping the names here
 * would render the wrong blurb under the wrong title with every existing test
 * still green. `methodologyCardData.test.ts` pins that order by equality.
 *
 * Whole-card links wearing `.event-card` (this app's shared card treatment,
 * `CalibrationSection.tsx`'s `.event-card ... shadow-sm` pattern) with a
 * border/shadow-only hover — no green fill, per the sketch-findings skill's
 * green-is-ink-not-paint rule. Grid is a ladder now that there are four
 * cards: one column on mobile, two from `sm`, four in one row from `lg`.
 * Deliberately NOT `md:grid-cols-4` — four cards across a ~768px tablet
 * leaves each blurb about 24 characters wide, so the two-up step carries the
 * middle of the range.
 */
export function MethodologyCards() {
  const [epaVsStatboticsCard, compareCard, swingCard, acknowledgmentsCard] = METHODOLOGY_CARDS;
  if (
    epaVsStatboticsCard === undefined ||
    compareCard === undefined ||
    swingCard === undefined ||
    acknowledgmentsCard === undefined
  ) {
    return null;
  }

  return (
    <div className="grid gap-[var(--spacing-md)] sm:grid-cols-2 lg:grid-cols-4">
      <Link
        to={epaVsStatboticsCard.to}
        search={preserveSearch}
        data-testid={epaVsStatboticsCard.testId}
        className="event-card flex flex-col gap-[var(--spacing-xs)] p-[var(--spacing-md)] shadow-sm transition-shadow hover:shadow-md hover:border-[var(--color-text-muted)]"
      >
        <span className="text-role-heading text-[var(--color-text-primary)]">{epaVsStatboticsCard.title}</span>
        <span className="text-role-body text-[var(--color-text-muted)]">{epaVsStatboticsCard.blurb}</span>
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
      <Link
        to={swingCard.to}
        search={preserveSearch}
        data-testid={swingCard.testId}
        className="event-card flex flex-col gap-[var(--spacing-xs)] p-[var(--spacing-md)] shadow-sm transition-shadow hover:shadow-md hover:border-[var(--color-text-muted)]"
      >
        <span className="text-role-heading text-[var(--color-text-primary)]">{swingCard.title}</span>
        <span className="text-role-body text-[var(--color-text-muted)]">{swingCard.blurb}</span>
      </Link>
      <Link
        to={acknowledgmentsCard.to}
        search={preserveSearch}
        data-testid={acknowledgmentsCard.testId}
        className="event-card flex flex-col gap-[var(--spacing-xs)] p-[var(--spacing-md)] shadow-sm transition-shadow hover:shadow-md hover:border-[var(--color-text-muted)]"
      >
        <span className="text-role-heading text-[var(--color-text-primary)]">{acknowledgmentsCard.title}</span>
        <span className="text-role-body text-[var(--color-text-muted)]">{acknowledgmentsCard.blurb}</span>
      </Link>
    </div>
  );
}
