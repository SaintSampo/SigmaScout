import { Link } from "@tanstack/react-router";
import { useIsMobile } from "@/lib/breakpoints";
import { YearSelect } from "./YearSelect.js";
import { AlgorithmSelect } from "./AlgorithmSelect.js";
import { SearchBox } from "../search/SearchBox.js";

/**
 * NAV-01's persistent top ribbon: wordmark, three nav links in a FIXED
 * order, both global dropdowns, and the search box (05-08-PLAN.md Task 2 —
 * `SearchBox` itself decides, via the shared `useIsMobile()` breakpoint,
 * whether to render as the inline desktop search box or the 44x44 icon
 * trigger that opens a phone dialog; this component just places it in the
 * same reserved slot on both branches below).
 *
 * No fetch of its own — this component is static chrome and must never be
 * gated on a query. `YearSelect` has no fetch either; `AlgorithmSelect`
 * fetches the algorithms manifest internally, but renders its full
 * build-time option list on the very first paint regardless (05-UI-SPEC.md
 * "Algorithm dropdown" empty row — it can never be empty). `SearchBox`
 * itself is also never gated on a fetch resolving before it renders — its
 * two artifact queries stay `enabled: false` until D-10's lazy-fetch trigger
 * fires.
 */
const NAV_LINKS = [
  { to: "/teams", label: "Teams" },
  { to: "/events", label: "Events" },
  { to: "/compare", label: "Compare" },
] as const;

/**
 * The active-link indicator, restated for the Pine ribbon (2026-09-01
 * redesign): on the dark green bar the active link is WHITE with a light
 * green (`--ribbon-accent`) underline; inactive links are translucent
 * white. The page-level `--color-accent` never appears in this component —
 * the ribbon has its own token vocabulary (theme.css `--ribbon-*` block).
 */
const ACTIVE_LINK_CLASS =
  "text-role-ribbon-nav whitespace-nowrap border-b-2 border-[var(--ribbon-accent)] pb-[6px] text-[var(--ribbon-ink)] transition-colors";
const INACTIVE_LINK_CLASS =
  "text-role-ribbon-nav whitespace-nowrap border-b-2 border-transparent pb-[6px] text-[var(--ribbon-ink-muted)] transition-colors hover:text-[var(--ribbon-ink)]";

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
    <nav aria-label="Primary" className="flex items-center gap-[var(--spacing-lg)]">
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

/**
 * External link to the project's GitHub repo. Icon-only (the GitHub mark,
 * drawn inline with `currentColor`), wearing the same muted-ink-to-ink hover
 * treatment as an inactive nav link — it is chrome, not navigation, so it
 * never carries the active underline. `.tap-target` keeps the 44px minimum
 * on touch.
 */
function GitHubLink() {
  return (
    <a
      href="https://github.com/SaintSampo/SigmaScout"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="SigmaScout on GitHub"
      className="tap-target flex shrink-0 items-center justify-center text-[var(--ribbon-ink-muted)] transition-colors hover:text-[var(--ribbon-ink)]"
    >
      <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
    </a>
  );
}

function GlobalSelects() {
  return (
    <div className="flex min-w-0 shrink items-center gap-[var(--spacing-sm)]">
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

  // 2026-09-01 (user request): the wordmark is the way home. The Σ wears
  // the ribbon's light-green accent — the one place the user's #4CAF50 seed
  // family gets used near-raw, because it passes contrast on the dark bar
  // (it never does on white).
  const wordmark = (
    <Link to="/" search={preserveSearch} className="text-role-display shrink-0 truncate text-[var(--ribbon-ink)]">
      <span className="text-[var(--ribbon-accent)]">Σ</span>igmaScout
    </Link>
  );

  if (isMobile) {
    return (
      // G-12 (07-UAT.md): `overflow-x-hidden` alone forces `overflow-y`'s
      // USED value to `auto` per the CSS Overflow spec — this header
      // silently became a Y-axis scroll container, so SearchBox's
      // absolutely-positioned results list was clipped to (and scrolled
      // within) the header instead of overlaying the page below it.
      // `overflow-x-clip` clips the X axis WITHOUT forcing a scroll
      // container on Y, so the dropdown escapes normally. Still blocks
      // horizontal overflow exactly as `hidden` did — `no-page-pan.spec.ts`
      // (the property this token exists to guard) is unaffected.
      <header className="shadow-sm w-full max-w-full overflow-x-clip bg-[var(--ribbon-bg)] px-[var(--spacing-lg)] py-[var(--spacing-md)]">
        <div className="flex min-w-0 items-center justify-between gap-[var(--spacing-md)]">
          {wordmark}
          <GlobalSelects />
        </div>
        {/* The "compact second row" (05-UI-SPEC.md "Top ribbon" overflow row):
            the SAME NavLinks element the desktop branch below renders — the
            link order (Teams, Events, Compare) never differs between the two
            branches, only the surrounding layout reflows. `SearchBox`
            renders as the 44x44 icon trigger here (`useIsMobile()` inside it
            resolves the same way this component's own `isMobile` did). */}
        <div className="mt-[var(--spacing-sm)] flex min-w-0 items-center justify-between gap-[var(--spacing-md)]">
          <NavLinks />
          <div className="flex items-center gap-[var(--spacing-sm)]">
            <SearchBox tone="ribbon" />
            <GitHubLink />
          </div>
        </div>
      </header>
    );
  }

  return (
    // Same G-12 fix as the mobile branch above — `overflow-x-clip` in place
    // of `overflow-x-hidden` (never authored `overflow-y`, so the used value
    // was silently forced to `auto`).
    <header className="shadow-sm w-full max-w-full overflow-x-clip bg-[var(--ribbon-bg)] px-[var(--spacing-lg)] py-[var(--spacing-md)]">
      <div className="flex min-w-0 items-center justify-between gap-[var(--spacing-lg)]">
        {wordmark}
        <NavLinks />
        <GlobalSelects />
        <SearchBox tone="ribbon" />
        <GitHubLink />
      </div>
    </header>
  );
}
