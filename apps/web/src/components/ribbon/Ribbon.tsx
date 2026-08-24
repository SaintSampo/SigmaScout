import { Link } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useIsMobile } from "@/lib/breakpoints";
import { YearSelect } from "./YearSelect.js";
import { AlgorithmSelect } from "./AlgorithmSelect.js";

/**
 * NAV-01's persistent top ribbon: wordmark, three nav links in a FIXED
 * order, both global dropdowns, and a slot for the search box (plan 05-08
 * fills it in — this task renders the 44x44 icon trigger with its
 * accessible label now so the layout is settled, per 05-UI-SPEC.md's
 * "Icon-only control labels" section).
 *
 * No fetch of its own — this component is static chrome and must never be
 * gated on a query. `YearSelect` has no fetch either; `AlgorithmSelect`
 * fetches the algorithms manifest internally, but renders its full
 * build-time option list on the very first paint regardless (05-UI-SPEC.md
 * "Algorithm dropdown" empty row — it can never be empty).
 */
const NAV_LINKS = [
  { to: "/teams", label: "Teams" },
  { to: "/events", label: "Events" },
  { to: "/compare", label: "Compare" },
] as const;

/**
 * The active-link accent indicator (05-UI-SPEC.md's "Accent reserved for"
 * list: "the active ribbon link's underline/indicator"). The accent token
 * appears NOWHERE else in this component.
 */
const ACTIVE_LINK_CLASS = "text-role-label text-[var(--color-accent)] border-b-2 border-[var(--color-accent)] pb-[2px]";
const INACTIVE_LINK_CLASS = "text-role-label border-b-2 border-transparent pb-[2px] text-[var(--color-text-primary)]";

/**
 * `Link`'s typed `search` updater expects the TARGET route's fully-required
 * search shape back, but a cross-route "prev" is typed as a Partial (some
 * fields belong only to certain routes) — there is no single TanStack
 * Router type that means "carry every current param forward unchanged, for
 * any target route in the tree." This narrow, local, identity-behavior cast
 * is the documented escape hatch (same reasoning as `YearSelect.tsx`'s
 * `CrossRouteNavigate`): at RUNTIME `prev` is returned completely
 * unmodified, so this plan's own prohibition ("Navigation between routes
 * must NOT replace the search params with an object literal") is upheld
 * regardless of what the type system can express here.
 */
function preserveSearch(prev: Record<string, unknown>): never {
  return prev as never;
}

function NavLinks() {
  // Three explicit `<Link>` elements, not a `.map()` over `NAV_LINKS` — each
  // element's `to` prop needs its own precise literal route path for
  // TanStack Router's typed `search` prop to type-check at all; mapping
  // over the union loses that per-route overload resolution. `NAV_LINKS`
  // still names the ONE canonical Teams/Events/Compare order both branches
  // below render.
  return (
    <nav aria-label="Primary" className="flex items-center gap-[var(--spacing-md)]">
      <Link to="/teams" search={preserveSearch} className={INACTIVE_LINK_CLASS} activeProps={{ className: ACTIVE_LINK_CLASS }}>
        {NAV_LINKS[0].label}
      </Link>
      <Link to="/events" search={preserveSearch} className={INACTIVE_LINK_CLASS} activeProps={{ className: ACTIVE_LINK_CLASS }}>
        {NAV_LINKS[1].label}
      </Link>
      <Link to="/compare" search={preserveSearch} className={INACTIVE_LINK_CLASS} activeProps={{ className: ACTIVE_LINK_CLASS }}>
        {NAV_LINKS[2].label}
      </Link>
    </nav>
  );
}

function SearchTrigger() {
  return (
    <button type="button" aria-label="Open search" className="tap-target flex items-center justify-center rounded-md">
      <SearchIcon aria-hidden="true" className="size-4 text-[var(--color-text-primary)]" />
    </button>
  );
}

function GlobalSelects() {
  return (
    <div className="flex items-center gap-[var(--spacing-sm)]">
      <YearSelect />
      <AlgorithmSelect />
    </div>
  );
}

export function Ribbon() {
  // Read from the shared breakpoint constant (05-05-PLAN.md Task 3's own
  // instruction: "Read the breakpoint from the shared constant rather than
  // declaring a media query inline") — `useIsMobile` and Tailwind's `md:`
  // prefix both resolve to the SAME `MOBILE_BREAKPOINT_PX` (breakpoints.ts),
  // so this component and any CSS elsewhere can never disagree about which
  // side of the line they are on.
  const isMobile = useIsMobile();

  const wordmark = <span className="text-role-display text-[var(--color-text-primary)]">SigmaScout</span>;

  if (isMobile) {
    return (
      <header className="bg-[var(--color-bg-surface)] px-[var(--spacing-lg)] py-[var(--spacing-md)]">
        <div className="flex items-center justify-between gap-[var(--spacing-md)]">
          {wordmark}
          <GlobalSelects />
        </div>
        {/* The "compact second row" (05-UI-SPEC.md "Top ribbon" overflow row):
            the SAME NavLinks/SearchTrigger elements the desktop branch below
            renders — the link order (Teams, Events, Compare) never differs
            between the two branches, only the surrounding layout reflows. */}
        <div className="mt-[var(--spacing-sm)] flex items-center justify-between gap-[var(--spacing-md)]">
          <NavLinks />
          <SearchTrigger />
        </div>
      </header>
    );
  }

  return (
    <header className="bg-[var(--color-bg-surface)] px-[var(--spacing-lg)] py-[var(--spacing-md)]">
      <div className="flex items-center justify-between gap-[var(--spacing-md)]">
        {wordmark}
        <NavLinks />
        <GlobalSelects />
        <SearchTrigger />
      </div>
    </header>
  );
}
