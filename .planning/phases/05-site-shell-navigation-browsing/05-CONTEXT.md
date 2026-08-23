# Phase 5: Site Shell — Navigation & Browsing - Context

**Gathered:** 2026-08-23
**Status:** Ready for planning

<domain>
## Phase Boundary

The first browser-facing phase. Delivers the site shell — a persistent top ribbon,
global year and algorithm selectors, a search box — plus the two browsing pages:
Teams (all teams for a year, ranked by the selected algorithm) and Events (all
events for a year, filterable). Everything renders from Phase 4's precomputed
artifacts; nothing is recomputed in the browser.

**Requirements:** NAV-01 … NAV-06, TEAM-01, EVNT-01

**In scope:** ribbon navigation, year/algorithm dropdowns, search, deep-linkable
URLs, the Teams table, the Events list with week/country/state/district filtering,
mobile and desktop layouts.

**Out of scope:** team detail pages (Phase 6), event detail pages (Phase 7),
the Compare page and rank simulation (Phase 8). The ribbon links to Compare, but
the page itself is Phase 8's.

**Starting state — greenfield.** No frontend exists. `apps/worker` is the only app;
React, Vite, Tailwind, TanStack Router and TanStack Query are not installed
anywhere. This phase creates `apps/web` from nothing.
</domain>

<decisions>
## Implementation Decisions

### The Teams table

- **D-01:** The Teams page renders **all ~3,750 teams in one continuous virtualized
  scroll**, ranked, sortable — not paged, not truncated to a top-N. Only the visible
  rows exist in the DOM. Matches the FRC convention (Statbotics and TBA both present
  one big sortable table rather than paging), and avoids the "where is my team"
  hunting that pagination forces. — **Reversibility:** reversible — a rendering
  choice local to one component.

- **D-02:** The browser makes **one fetch for the whole `teams/{year}` artifact**,
  exactly as Phase 4's D-01 intends. Sorting, filtering and searching are then local
  with no further requests. Measured artifact size: **1,361,992 B median, 2,721,887 B
  max** (~250–400 KB on the wire after compression). — **Reversibility:** reversible
  — the split escape hatch below remains available without republishing anything
  already shipped.

- **D-03:** **The slim search-index split stays deferred.** Phase 4's D-01 rejected
  splitting lists into a search index but explicitly flagged it for "revisit in Phase 5
  if the search box proves slow on the full table." That condition is not yet
  evidenced. Build the single-fetch version, **measure real first-paint and
  first-keystroke latency on a phone**, and introduce a published index artifact only
  if measurement shows it is needed. A new artifact kind means changing Phase 4's
  publisher and a full republish — do not pay that on speculation. — **Reversibility:**
  reversible — additive if later needed.

- **D-04:** On mobile the table keeps **every column, reached by horizontal scroll** —
  TEAM-01's number, name, rank, metric(s), record and win rate all remain present.
  Chosen over tap-to-expand rows and per-team cards because it is what TBA and
  Statbotics both do, so it matches what an FRC user expects on a phone.
  **Known implementation risk for research to solve, not discover:** a horizontal
  scroll region nested inside a virtualized vertical scroll makes the two touch
  gestures compete, and most virtualization libraries assume a single scroll axis.
  This needs a deliberate solution (e.g. a virtualizer that supports a fixed header
  plus horizontal overflow, or freezing the rank/team columns), not a default.
  — **Reversibility:** reversible.

### Visual direction

- **D-05:** **Statbotics' information architecture, SigmaScout's own visual language.**
  Page structure, groupings and column choices stay familiar enough that an FRC person
  relearns nothing; palette, typography and density are distinct so the site does not
  read as a clone. Rejected: near-drop-in visual mimicry (strongest "we are the faster
  one" argument, but derivative and hard to build an identity out of later); rejected:
  an entirely original IA organised around uncertainty (highest ceiling, no learning
  transfer, most work). — **Reversibility:** costly — this sets the visual contract
  every component in Phases 5–8 inherits.

- **D-06:** **Light theme only for now; dark deferred to a later phase.**
  **Engineering requirement attached to this decision:** all colors are defined as CSS
  custom properties (design tokens) from the first component, never as literals. This
  costs nothing now and makes the eventual dark pass a token swap rather than a sweep
  through every component built in Phases 5–8. Shipping light-only is the product
  decision; hardcoding light values is not. — **Reversibility:** reversible if the
  token discipline holds; costly if it does not.

- **D-07:** **Sigma-family uncertainty is always visible in tables, at secondary
  weight** — `88.2 ±3.1` with the band in lighter/smaller type. Honest by default and
  it is the project's stated differentiator, so it belongs on the first page people
  see, but it never competes with the value for attention. Rejected: bare values in
  tables with the band only on detail pages (hides the differentiator on the landing
  view); rejected: purely visual encoding such as bars or opacity (glanceable but
  needs a legend to be interpretable). — **Reversibility:** reversible.

### Search

- **D-08:** **Instant dropdown of top matches as the user types**, keyboard-navigable,
  Enter jumps to the top hit. Results span both teams and events. Matches the TBA and
  Statbotics convention and is the fastest path to the dominant use case, "find my
  team." — **Reversibility:** reversible.

- **D-09:** **Matching is number-prefix plus name-substring.** `1114` matches 1114,
  11140, 11141; `simb` matches Simbotics anywhere in the name; `silicon` matches
  Silicon Valley Regional. Rejected: fuzzy matching (friendlier for typos, but needs a
  matching library and produces ranking that surprises); rejected: exact-only (fast,
  but `simb` finding nothing reads as broken). — **Reversibility:** reversible.

- **D-10:** **Lazy-fetch the missing artifact on first search use.** NAV-03 requires
  search to reach teams *and* events from anywhere, but only one list is resident on
  any given page. On first focus or keystroke, fetch whichever is absent — the events
  artifact is small (~58 KB). Measure whether that first-keystroke delay is actually
  perceptible; only if it is does D-03's published index become justified. Same
  discipline as D-03: build the version that needs no Phase 4 change, then measure.
  — **Reversibility:** reversible.

### Switching year and algorithm

- **D-11:** **A year change preserves filters, sort and column state, and shows an
  honest empty state when the new year has no matches** — naming why, with a one-click
  clear. The user set those filters deliberately; silently discarding them is worse
  than an explained empty result, and comparing the same filtered slice across seasons
  is a plausible scouting workflow. — **Reversibility:** reversible.

- **D-12:** **Year change on an event page maps to the same event code in the target
  year if it exists, otherwise lands on that year's Events list** with a brief note.
  Event keys are year-scoped (`2026onwat` vs `2019onwat`), so "this event, different
  year" is the obvious intent and should be honoured when the event actually ran.
  Rejected: always returning to the Events list (simple, discards intent); rejected:
  disabling the year dropdown on event pages (honest, but a global control that
  silently disappears is its own confusion). — **Reversibility:** reversible.

- **D-13:** **An algorithm change holds position exactly** — same page, same scroll
  offset, same filters, same sort field where that field exists under the new
  algorithm — and only the values change. This makes A/B comparing two algorithms on
  one view effortless, which is close to the project's whole purpose. Note the edge
  the planner must handle: algorithms expose different metrics, so a sort on a column
  the new algorithm does not publish has to fall back to rank order rather than error.
  — **Reversibility:** reversible.

### Defaulted by the builder (override at planning time if wrong)

- **D-14:** **The URL carries year, algorithm, current view, sort field/direction, and
  active filters** — so a filtered, sorted table is shareable, not just the page.
  NAV-05 requires year, algorithm and view; sort and filters are added because a URL
  that restores "the page" but not "what I was looking at" fails the spirit of the
  requirement. TanStack Router's typed search params are the mechanism (already the
  stack choice, chosen in `.claude/CLAUDE.md` for exactly this reason).
  — **Reversibility:** costly — shared links outlive the code that made them.

- **D-15:** **Events filtering on mobile uses a collapsible filter sheet** rather than
  four inline dropdowns, with the active filter count visible on the trigger so the
  user can see state without opening it. Four filter dimensions (week, country, state,
  district) do not fit a phone-width row. — **Reversibility:** reversible.

- **D-16:** **First load shows a skeleton table**, not a spinner and not a blank page —
  header, ribbon and column headers render immediately from the shell while the
  artifact downloads. NAV-06 makes load speed the top priority, and perceived speed is
  part of that. — **Reversibility:** reversible.

### Added at planning time (2026-08-23)

- **D-17:** **The site is hosted at `https://www.sigmascout.org`** (Cloudflare Pages
  custom domain on the existing zone). `sigmascout.org` stays exactly as Phase 4
  shipped it — an R2 custom domain serving artifacts with no compute in the path
  (Phase 4 D-25 is untouched, nothing republishes). An R2 custom domain claims a whole
  hostname rather than a path prefix, so the site and the data cannot share the apex
  without a proxy Worker on every artifact read, which NAV-06 rules out.
  — **Reversibility:** reversible (DNS + one CORS origin string).

- **D-18:** **The R2 bucket carries an explicit CORS policy with `AllowedOrigins`
  scoped to `https://www.sigmascout.org`** — never a wildcard. R2 sends no CORS headers
  by default, so without this every artifact fetch fails on first deploy; this must be
  configured and confirmed **before the first real `fetch()` call is written**. The data
  is public, so the risk of a wildcard is low, but narrow-scoping is free and stops the
  bucket serving arbitrary third-party sites. Preview deploys on `*.pages.dev` need
  their origin added too, or must be tested against a local artifact fixture.
  — **Reversibility:** reversible.
  — *Resolves RESEARCH.md Open Question 1 / Pitfall 1.*
</decisions>

<constraints>
## Constraints Carried In

- **NAV-06 is the governing constraint:** pages render from precomputed artifacts,
  fast load is the top priority, and **no season statistics are recomputed in the
  browser**. Sorting and filtering already-published rows is presentation, not
  recomputation, and is allowed. Deriving a metric the artifact does not carry is not.
- **Phase 4 D-01 (costly to reverse):** one file per page the site renders. Phases 5–8
  fetch these paths; changing the layout means republishing every artifact.
- **Phase 4 D-02 (one-way):** algorithm version rides in the path, one file per
  `(page, year, algorithm@version)`. The algorithm dropdown keys on these paths.
- **Phase 4 D-25:** the browser reads artifacts from `https://sigmascout.org` — an R2
  custom domain with no compute in the path. Page traffic never touches the Worker.
- **Phase 4 D-26:** artifacts are served with `Cache-Control: public, max-age=60` and
  an ETag; conditional re-requests return 304. Client caching should cooperate with
  this rather than defeat it.
- **Stack is fixed** (`.claude/CLAUDE.md`): React 19 + Vite + Tailwind v4, TanStack
  Router for typed search params, TanStack Query for fetching, Zustand only for the
  small non-URL remainder, Recharts when charts arrive in Phase 6. Everything
  URL-shareable belongs in router search params, not a store.
- **Live tier is sigma1-only.** `opr` and `epa` are fully published but refresh at the
  manual re-baseline rather than on the cron. The algorithm dropdown must not imply all
  three are equally live; if freshness is surfaced in the UI, it is per-algorithm.
</constraints>

<deferred>
## Deferred Ideas

- **A published slim search index** (`v1/search/{year}.json` or similar) — deferred
  under D-03/D-10 until measurement shows the single-fetch path is too slow. Requires
  a new artifact kind in Phase 4 and a full republish.
- **Dark theme** — deferred under D-06. The token discipline is what keeps it cheap.
- **Surfacing per-algorithm freshness in the UI** (e.g. "sigma1 updated 40s ago,
  opr as of last re-baseline") — real information, but it is a new capability rather
  than part of browsing, and it needs a design of its own.
</deferred>

<open_questions>
## Open Questions for Research

1. **Virtualization with horizontal overflow (D-04).** Which approach actually works
   on touch for a virtualized vertical list that also scrolls horizontally — and does
   the chosen virtualizer support a sticky header and/or frozen leading columns?
   This is the one decision in this phase with a real chance of not working as drawn.
2. **Measured first paint for a 1.4–2.7 MB artifact** on a mid-range phone over
   typical venue wifi — the number that decides whether D-03's index split is needed.
   Establish how it will be measured before building, so the threshold is not
   argued after the fact.
3. **Sort stability across algorithm switches (D-13)** — enumerate which metric
   columns each published algorithm actually exposes, so the fallback-to-rank rule
   has a concrete table behind it rather than a runtime guess.
</open_questions>
