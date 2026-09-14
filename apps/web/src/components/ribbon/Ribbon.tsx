import { Link } from "@tanstack/react-router";
import { useIsMobile } from "@/lib/breakpoints";
import { RootSearchSchema } from "@/lib/searchParams";
import { YearSelect } from "./YearSelect.js";
import { AlgorithmSelect } from "./AlgorithmSelect.js";
import { SearchBox } from "../search/SearchBox.js";

/**
 * The persistent top ribbon: wordmark, nav links in a FIXED order, both
 * global dropdowns, and the search box (`SearchBox` itself decides, via the
 * shared `useIsMobile()` breakpoint, whether to render as the inline desktop
 * search box or the 44x44 icon trigger that opens a phone dialog; this
 * component just places it in the same reserved slot on both branches
 * below).
 *
 * No fetch of its own — this component is static chrome and must never be
 * gated on a query. `YearSelect` has no fetch either; `AlgorithmSelect`
 * fetches the algorithms manifest internally, but renders its full
 * build-time option list on the very first paint regardless. `SearchBox`
 * itself is also never gated on a fetch resolving before it renders — its
 * two artifact queries stay `enabled: false` until its lazy-fetch trigger
 * fires.
 */
const NAV_LINKS = [
  { to: "/teams", label: "Teams" },
  { to: "/events", label: "Events" },
  { to: "/districts", label: "Locks" },
  { to: "/methodology", label: "Methodology" },
] as const;

/**
 * The active-link indicator: on the dark green bar the active link is WHITE
 * with a light green (`--ribbon-accent`) underline; inactive links are
 * translucent white. The page-level `--color-accent` never appears in this
 * component — the ribbon has its own token vocabulary (theme.css
 * `--ribbon-*` block).
 */
const ACTIVE_LINK_CLASS =
  "text-role-ribbon-nav whitespace-nowrap border-b-2 border-[var(--ribbon-accent)] pb-[6px] text-[var(--ribbon-ink)] transition-colors";
const INACTIVE_LINK_CLASS =
  "text-role-ribbon-nav whitespace-nowrap border-b-2 border-transparent pb-[6px] text-[var(--ribbon-ink-muted)] transition-colors hover:text-[var(--ribbon-ink)]";

/**
 * The site-wide params — exactly `RootSearchSchema`'s keys (year, algorithm),
 * read from the schema so a new global can never be silently dropped here.
 */
const GLOBAL_SEARCH_KEYS = Object.keys(RootSearchSchema.shape);

/**
 * Carries ONLY the site-wide params across a nav click. Page-owned params
 * stay on their page: carrying every param forward would leak the Locks
 * page's `?district=` into the Teams page's same-named district filter, and
 * the Teams filters into Events. Values are still read from `prev`, never
 * replaced with literals, so the selected year and algorithm survive every
 * navigation.
 *
 * `Link`'s typed `search` updater expects the TARGET route's fully-required
 * search shape back, and no single TanStack Router type means "any target
 * route in the tree" — hence the narrow local cast (same reasoning as
 * `YearSelect.tsx`'s `CrossRouteNavigate`).
 */
function preserveSearch(prev: Record<string, unknown>): never {
  const next: Record<string, unknown> = {};
  for (const key of GLOBAL_SEARCH_KEYS) {
    if (prev[key] !== undefined) next[key] = prev[key];
  }
  return next as never;
}

function NavLinks({ gapClass = "gap-[var(--spacing-md)]" }: { gapClass?: string } = {}) {
  // Four explicit `<Link>` elements, not a `.map()` over `NAV_LINKS` — each
  // element's `to` prop needs its own precise literal route path for
  // TanStack Router's typed `search` prop to type-check at all; mapping
  // over the union loses that per-route overload resolution. `NAV_LINKS`
  // still names the ONE canonical Teams/Events/Locks/Methodology order
  // both branches below render.
  //
  // `gap-[var(--spacing-md)]` (16px) on desktop; the mobile branch passes
  // 12px, because its second row must also hold the GitHub and search
  // icons (see that row's budget comment).
  return (
    <nav aria-label="Primary" className={`flex items-center ${gapClass}`}>
      <Link to="/teams" search={preserveSearch} className={INACTIVE_LINK_CLASS} activeProps={{ className: ACTIVE_LINK_CLASS }}>
        {NAV_LINKS[0].label}
      </Link>
      <Link to="/events" search={preserveSearch} className={INACTIVE_LINK_CLASS} activeProps={{ className: ACTIVE_LINK_CLASS }}>
        {NAV_LINKS[1].label}
      </Link>
      <Link to="/districts" search={preserveSearch} className={INACTIVE_LINK_CLASS} activeProps={{ className: ACTIVE_LINK_CLASS }}>
        {NAV_LINKS[2].label}
      </Link>
      <Link to="/methodology" search={preserveSearch} className={INACTIVE_LINK_CLASS} activeProps={{ className: ACTIVE_LINK_CLASS }}>
        {NAV_LINKS[3].label}
      </Link>
    </nav>
  );
}

/**
 * External link to the project's GitHub repo. Icon-only (the GitHub mark,
 * drawn inline with `currentColor`), wearing the same muted-ink-to-ink hover
 * treatment as an inactive nav link — it is chrome, not navigation, so it
 * never carries the active underline. Sized to the icon alone (no
 * `.tap-target`): a 44px minimum here would grow the ribbon's row height.
 * It sits immediately LEFT of the search control on both branches so the
 * search bar keeps its far-right position.
 */
function GitHubLink() {
  return (
    <a
      href="https://github.com/SaintSampo/SigmaScout"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="SigmaScout on GitHub"
      className="flex shrink-0 items-center justify-center text-[var(--ribbon-ink-muted)] transition-colors hover:text-[var(--ribbon-ink)]"
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
  // `useIsMobile` and Tailwind's `md:` prefix both resolve to the SAME
  // `MOBILE_BREAKPOINT_PX` (breakpoints.ts), so this component and any CSS
  // elsewhere can never disagree about which side of the line they are on.
  const isMobile = useIsMobile();

  // The wordmark is the way home. The Σ wears the ribbon's light-green
  // accent — the one place the site's raw green seed color gets used
  // near-raw, because it passes contrast on the dark bar (it never does on
  // white). The grey "Beta" tag sits right after the wordmark, as a sibling
  // `span` OUTSIDE the `Link` on purpose — the home link's accessible text
  // must stay exactly the wordmark (Ribbon.test.tsx pins it to
  // "ΣigmaScout"), so the tag cannot live inside it.
  const wordmark = (
    <div className="flex shrink-0 items-baseline gap-[var(--spacing-sm)]">
      <Link to="/" search={preserveSearch} className="text-role-display shrink-0 truncate text-[var(--ribbon-ink)]">
        <span className="text-[var(--ribbon-accent)]">Σ</span>igmaScout
      </Link>
      <span className="text-role-label text-[var(--ribbon-ink-muted)]">Beta</span>
    </div>
  );

  if (isMobile) {
    return (
      // `overflow-x-hidden` alone forces `overflow-y`'s USED value to `auto`
      // per the CSS Overflow spec, turning this header into a Y-axis scroll
      // container that clips SearchBox's absolutely-positioned results list
      // instead of letting it overlay the page below. `overflow-x-clip`
      // clips the X axis WITHOUT forcing a scroll container on Y, so the
      // dropdown escapes normally, while still blocking horizontal overflow.
      //
      // Phone gutter is `--spacing-md` (16px), not the desktop's 24px: at
      // 24px the first row (wordmark + both selects, 364px measured) only
      // fit at 412px and truncated the algorithm select on 390-402px
      // iPhones.
      <header className="shadow-sm w-full max-w-full overflow-x-clip bg-[var(--ribbon-bg)] px-[var(--spacing-md)] py-[var(--spacing-md)]">
        <div className="flex min-w-0 items-center justify-between gap-[var(--spacing-md)]">
          {wordmark}
          <GlobalSelects />
        </div>
        {/* The compact second row: the SAME NavLinks element the desktop
            branch below renders — the link order never differs between the
            two branches, only the surrounding layout reflows. `SearchBox`
            renders as the 44x44 icon trigger here. */}
        {/* Row budget: the icon group is `shrink-0`, so it can never be
            pushed out of the header's clip edge; the search trigger's 44px
            tap target overhangs the gutter by 14px, so its 16px glyph lines
            up with the select above; the GitHub icon drops below 400px,
            where keeping it would cut "Methodology" off; below 375px the
            link gap tightens to 8px, which still fits a 360px phone —
            anything narrower scrolls the nav sideways instead of clipping
            it. */}
        <div className="mt-[var(--spacing-sm)] flex min-w-0 items-center justify-between gap-[var(--spacing-sm)]">
          <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <NavLinks gapClass="gap-[12px] max-[374px]:gap-[var(--spacing-sm)]" />
          </div>
          <div className="flex shrink-0 items-center">
            <div className="flex max-[399px]:hidden">
              <GitHubLink />
            </div>
            <div className="-mr-[14px] flex">
              <SearchBox tone="ribbon" />
            </div>
          </div>
        </div>
      </header>
    );
  }

  return (
    // Same overflow-x-clip fix as the mobile branch above.
    <header className="shadow-sm w-full max-w-full overflow-x-clip bg-[var(--ribbon-bg)] px-[var(--spacing-lg)] py-[var(--spacing-md)]">
      <div className="flex min-w-0 items-center justify-between gap-[var(--spacing-lg)]">
        {wordmark}
        <NavLinks />
        <GlobalSelects />
        {/* Grouped so `justify-between` can't spread the GitHub icon toward
            the ribbon's center — it must hug the search box, matching the
            mobile branch's grouping above. */}
        <div className="flex items-center gap-[var(--spacing-md)]">
          <GitHubLink />
          <SearchBox tone="ribbon" />
        </div>
      </div>
    </header>
  );
}
