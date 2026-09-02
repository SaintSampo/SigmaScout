/**
 * NAV-03's search box (05-08-PLAN.md Task 2): an instant, keyboard-navigable
 * dropdown of top team/event matches (D-08), built on the tested matching
 * module (`lib/search-index.ts`) and D-10's lazy-fetch of whichever artifact
 * the current route does not already hold.
 *
 * One component, two renderings — `useIsMobile()` (the shared breakpoint,
 * `lib/breakpoints.ts`) decides which:
 *  - Desktop: an inline `Command` box IS the search box (05-UI-SPEC.md's
 *    "Desktop: single row — ...search box").
 *  - Phone: the 44x44 icon trigger `Ribbon.tsx` used to render directly (now
 *    owned here) opens a `CommandDialog` containing the same input+results.
 *
 * `shouldFilter={false}` on every `Command`/`CommandDialog` below: cmdk's own
 * fuzzy filter/sort is turned off entirely, because D-09's matching rule is
 * decided once, by the TESTED `buildSearchResults`, not by cmdk's bundled
 * `command-score` library. cmdk still owns arrow-key/Enter selection over
 * whatever `CommandItem`s are actually mounted, which is exactly the
 * keyboard navigation D-08 asks for, with no hand-rolled highlighted-index
 * state in this file.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useIsMobile } from "@/lib/breakpoints";
import { useAlgorithmVersion } from "@/components/ribbon/AlgorithmSelect";
import { teamsQueryOptions } from "@/lib/api/teams";
import { isRealTeamKey } from "@/lib/teamKey";
import { eventsQueryOptions } from "@/lib/api/events";
import { buildSearchResults, type EventMatch, type TeamMatch } from "@/lib/search-index";
import { markSearchKeystroke, markSearchResultsRendered, measureSearchKeystrokeToRender } from "@/lib/perfMarks";
import { DEFAULT_EVENT_TAB, type YearChangeableSearch } from "@/lib/searchParams";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

/**
 * Same documented escape hatch as `Ribbon.tsx`'s `preserveSearch` and
 * `AlgorithmSelect.tsx`'s `CrossRouteNavigate`: this component is mounted
 * once at the root layout (inside `Ribbon`), so it is visible on every
 * route, and TanStack Router's typed `navigate()` has no single type that
 * means "any route in the tree, carrying forward whatever the CURRENT
 * route's search happens to hold." This one's TARGET route genuinely varies
 * (a team match navigates to `/team/{number}`, an event match to
 * `/event/{eventKey}`, 07-15-PLAN.md Task 2), which is exactly why a plain
 * `<Link>` cannot express it and an imperative, narrowly-typed `navigate()`
 * cast is used instead. At RUNTIME every search updater below only ever
 * reads/writes known fields, so an unrecognized field silently passing
 * through the spread is stripped by the TARGET route's own `validateSearch`
 * (T-05-02) — never a crash, never a stray param reaching a component.
 * `params` is a union of the two destinations' own path params — the team
 * number (D-15's plain team number, not the internal `frc{n}` key) or the
 * event key.
 */
type SearchNavigate = (opts: {
  to: "/team/$teamNumber" | "/event/$eventKey";
  params: { teamNumber: string } | { eventKey: string };
  search: (prev: Record<string, unknown>) => Record<string, unknown>;
}) => Promise<void>;

/**
 * Kept short deliberately. The box is `w-64` (256px) and the previous
 * placeholder — "Search teams or events (e.g. 1114 or Simbotics)" — is 46
 * characters, so it was always clipped mid-example ("...(e.g. 11"), which
 * reads as a broken input rather than as a hint. Widening the box instead
 * was the wrong trade: the ribbon also carries the wordmark, nav, the year
 * select and the now-wider algorithm select.
 */
const SEARCH_PLACEHOLDER = "Search teams or events";

/** The highlighted-row token (05-UI-SPEC.md's "Accent reserved for" list: "highlighted row background, at 10% opacity tint, not solid fill") — applied as a Tailwind arbitrary-value opacity modifier over the CSS custom property, never a literal hex value. */
const HIGHLIGHT_CLASS = "data-selected:bg-[var(--color-accent)]/10 data-selected:text-[var(--color-text-primary)]";

/**
 * The composition-seam fix for 260902-sbx ("the search box draws two
 * concentric rounded rectangles"). `CommandInput` (`ui/command.tsx`, a
 * shared shadcn primitive, NOT edited here) wraps a shadcn `InputGroup`
 * (`ui/input-group.tsx`, also not edited — its own border is correct in a
 * plain form context) that carries its OWN border, background and fixed
 * `h-8` — a second, smaller, differently-radiused box nested inside
 * whichever `Command` root this file styles per `tone`. This is a
 * composition problem at THIS seam, so the fix lives here: keep ONE visible
 * surface (the outer `Command` root — it already owns the tone-specific
 * border/bg tokens and the results dropdown's anchoring) and neutralise the
 * inner `InputGroup` into an invisible full-height layout box.
 *
 * Targets `InputGroup` by its own stable `data-slot="input-group"` attribute
 * via a DESCENDANT selector (`[&_[data-slot=input-group]]`) — never `[&>div]`,
 * which is what the 2026-09-01 "larger ribbon" commit tried: `>` selects the
 * intermediate `div.p-1.pb-0` (`command-input-wrapper`), two levels above
 * `InputGroup`, not `InputGroup` itself, which is why that fix silently did
 * nothing. Verified against the live DOM (not just the source) before
 * trusting this one.
 *
 * - `h-full!` fills the root's own content box exactly, replacing
 *   `InputGroup`'s fixed `h-8` (32px) — measured live: 4px short of the
 *   ribbon's `h-9` (36px), 14px short of the hero's prior auto height
 *   (46px).
 * - `border-transparent!` / `bg-transparent!` drop its border/background.
 *   `InputGroup`'s own `h-8!`/`rounded-lg!`/`bg-input/30` are Tailwind
 *   `!important` utilities baked onto the SAME element by `ui/command.tsx`;
 *   a same-specificity plain class can never beat `!important` regardless of
 *   source order (confirmed live: the un-important `rounded-md` tone class
 *   on `Command` itself never beats `Command`'s own `rounded-xl!` either —
 *   same mechanism), so these carry `!` too and win on the higher
 *   specificity of the descendant-attribute selector.
 * - `command-input-wrapper`'s own `p-1 pb-0` (also two levels up from
 *   `InputGroup`) is COLLAPSED to `py-0!` rather than compensated for: it
 *   was a second, redundant layer of vertical inset stacked on `Command`'s
 *   OWN `p-1`. Collapsing it (instead of adding matching padding elsewhere
 *   to re-center) leaves `Command`'s `p-1`/`py-0` as the ONLY source of
 *   vertical inset, so `InputGroup`'s `h-full` fills exactly what remains
 *   and `InputGroup`'s own `items-center` centres the input with no extra
 *   compensation math needed.
 *
 * Separately (found while verifying the live DOM, not in the plan's
 * original cause list): the ONLY focus-visible ring this composition could
 * ever draw — `ui/input-group.tsx`'s
 * `has-[[data-slot=input-group-control]:focus-visible]` — never actually
 * fires here. `CommandInput` gives its `<input>` `data-slot="command-input"`,
 * not `"input-group-control"`, so that selector never matches; confirmed
 * live by focusing the input and reading `box-shadow` back as all-zero-alpha
 * before this fix. Tabbing to this control currently shows NO focus
 * indicator at all — a pre-existing accessibility gap, not a "one ring vs
 * two" problem. Since `InputGroup` is being neutralised into an invisible
 * layout box regardless, the replacement ring is added on the `Command`
 * root instead, keyed off the REAL slot name
 * (`has-[[data-slot=command-input]:focus-visible]`), reusing the exact
 * `border-ring`/`ring-3`/`ring-ring/50` tokens `ui/select.tsx`'s
 * `SelectTrigger` already uses sitewide for the same purpose — one visible
 * ring, on the one visible box, replacing zero.
 */
const INPUT_GROUP_SEAM_FIX =
  "[&_[data-slot=input-group]]:h-full! [&_[data-slot=input-group]]:border-transparent! [&_[data-slot=input-group]]:bg-transparent! " +
  // `command-input-wrapper` also needs its OWN `h-full`, not just `py-0`:
  // it's a plain block div, and `height: 100%` only resolves against a
  // parent with a DEFINITE height — `Command`'s own `h-9`/`h-11` is
  // definite, but that doesn't make `command-input-wrapper` (an
  // intermediate block ancestor) definite by itself. Without this,
  // `input-group`'s `h-full` falls back to `auto` and the whole chain
  // collapses to `command-input-wrapper`'s intrinsic content height
  // (measured live: 30px, driven by `InputGroupAddon`'s own `py-1.5` around
  // the search icon) instead of filling `Command`'s box — confirmed by
  // measuring the live DOM after the first pass of this fix, before adding
  // this line.
  "[&_[data-slot=command-input-wrapper]]:h-full! [&_[data-slot=command-input-wrapper]]:py-0! " +
  "has-[[data-slot=command-input]:focus-visible]:border-ring has-[[data-slot=command-input]:focus-visible]:ring-3 has-[[data-slot=command-input]:focus-visible]:ring-ring/50";

function TeamResultItem({ team, onSelect }: { team: TeamMatch; onSelect: () => void }) {
  return (
    <CommandItem value={`team-${team.teamKey}`} onSelect={onSelect} className={HIGHLIGHT_CLASS}>
      <span className="numeric-cell shrink-0 text-role-body">{team.teamNumber}</span>
      <span className="truncate" title={team.nickname}>
        {team.nickname}
      </span>
    </CommandItem>
  );
}

function EventResultItem({ event, onSelect }: { event: EventMatch; onSelect: () => void }) {
  return (
    <CommandItem value={`event-${event.eventKey}`} onSelect={onSelect} className={HIGHLIGHT_CLASS}>
      <span className="min-w-0 flex-1 truncate" title={event.name}>
        {event.name}
      </span>
      {/* D-09/UI-SPEC "Search + results dropdown" partial row: a null week
          renders WITHOUT a week chip — never a blank slot, never the literal
          text "null". */}
      {event.week !== null && (
        <Badge variant="secondary" className="shrink-0">
          Week {event.week}
        </Badge>
      )}
    </CommandItem>
  );
}

interface ResultsListProps {
  query: string;
  teams: TeamMatch[];
  events: EventMatch[];
  eventsStatus: "loaded" | "loading" | "failed";
  onSelectTeam: (team: TeamMatch) => void;
  onSelectEvent: (event: EventMatch) => void;
}

/**
 * The Copywriting Contract's three event-section copies, rendered as PLAIN
 * text nodes rather than `CommandItem`s — they are status messages, not
 * selectable rows, so they never enter cmdk's keyboard-navigation order and
 * never steal the highlight away from a real team/event match.
 */
function ResultsList({ query, teams, events, eventsStatus, onSelectTeam, onSelectEvent }: ResultsListProps) {
  const hasTeams = teams.length > 0;
  const hasEvents = events.length > 0;
  const noMatchesAtAll = eventsStatus === "loaded" && !hasTeams && !hasEvents;

  if (noMatchesAtAll) {
    return <CommandEmpty>{`No teams or events found for "${query}"`}</CommandEmpty>;
  }

  // The Events section renders whenever it has SOMETHING to say — real
  // matches, or one of the two degraded-state copies — and is entirely
  // absent when loaded-and-empty, matching "no matches" reading naturally
  // rather than showing an empty heading with nothing under it.
  const showEventsSection = eventsStatus !== "loaded" || hasEvents;

  return (
    <>
      {hasTeams && (
        <CommandGroup heading="Teams">
          {teams.map((team) => (
            <TeamResultItem key={team.teamKey} team={team} onSelect={() => onSelectTeam(team)} />
          ))}
        </CommandGroup>
      )}
      {showEventsSection && (
        <CommandGroup heading="Events">
          {eventsStatus === "loading" && <div className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] text-role-body text-[var(--color-text-muted)]">Loading events…</div>}
          {eventsStatus === "failed" && (
            <div className="px-[var(--spacing-sm)] py-[var(--spacing-xs)] text-role-body text-[var(--color-text-muted)]">Team results only (couldn't load events)</div>
          )}
          {eventsStatus === "loaded" && events.map((event) => <EventResultItem key={event.eventKey} event={event} onSelect={() => onSelectEvent(event)} />)}
        </CommandGroup>
      )}
    </>
  );
}

/**
 * `tone` (2026-09-01 Pine redesign): the SAME component renders inside the
 * dark green ribbon AND on the light home-page hero. "ribbon" paints the
 * closed control with the `--ribbon-*` translucent-on-dark vocabulary;
 * "page" (the default) keeps the light bordered box. The RESULTS dropdown
 * is a light popover in both tones — only the closed control differs.
 */
export interface SearchBoxProps {
  tone?: "ribbon" | "page";
  /** Width class for the desktop wrapper (default `w-64`, the ribbon's slot). The home hero passes `w-full` to fill its centered container. */
  className?: string;
}

export function SearchBox({ tone = "page", className }: SearchBoxProps = {}) {
  const isMobile = useIsMobile();
  const search = useSearch({ strict: false }) as YearChangeableSearch & { year: number; algorithm: PublishedAlgorithmId };
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate() as unknown as SearchNavigate;
  const version = useAlgorithmVersion(search.algorithm);

  const isTeamsPage = pathname.startsWith("/teams");
  const isEventsPage = pathname.startsWith("/events");

  const [query, setQuery] = useState("");
  const [interacted, setInteracted] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // D-10's lazy fetch: whichever artifact this route already holds is
  // enabled unconditionally (TanStack Query dedupes against the route's own
  // identical query key, so this is never a SECOND network request); the
  // other artifact stays disabled until the FIRST focus or keystroke.
  const teamsEnabled = version !== undefined && (isTeamsPage || interacted);
  const eventsEnabled = version !== undefined && (isEventsPage || interacted);

  const teamsQuery = useQuery({
    ...teamsQueryOptions({ year: search.year, algorithmId: search.algorithm, version: version ?? "" }),
    enabled: teamsEnabled,
  });
  const eventsQuery = useQuery({
    ...eventsQueryOptions({ year: search.year, algorithmId: search.algorithm, version: version ?? "" }),
    enabled: eventsEnabled,
  });

  const eventsStatus: "loaded" | "loading" | "failed" = !eventsEnabled ? "loading" : eventsQuery.isPending ? "loading" : eventsQuery.isError ? "failed" : "loaded";

  const results = useMemo(
    () =>
      buildSearchResults({
        // Same real-team rule the Teams table applies (2026-09-01,
        // `lib/teamKey.ts`): a nameless offseason B-team must not be
        // offered as a search result for its parent's number.
        teams: (teamsQuery.data?.teams ?? []).filter((team) => isRealTeamKey(team.teamKey)),
        events: eventsQuery.data?.events ?? [],
        query,
        eventsStatus,
      }),
    [teamsQuery.data, eventsQuery.data, query, eventsStatus],
  );

  // Task 3's deferred keystroke-latency gate (05-VALIDATION.md: < 100ms):
  // `handleValueChange` marks the START on every keystroke; this effect,
  // keyed on the RENDERED results, marks the end once the new dropdown
  // content has committed, then logs a structured line a live-browser
  // measurement script can read (mirrors `routes/teams.tsx`'s identical
  // `teams-parse-to-paint` pattern).
  useEffect(() => {
    if (query.trim() === "") return;
    markSearchResultsRendered();
    const durationMs = measureSearchKeystrokeToRender();
    if (durationMs !== undefined) {
      console.log(JSON.stringify({ event: "search-keystroke-to-render", durationMs }));
    }
  }, [results, query]);

  function markStartAndSetQuery(value: string) {
    markSearchKeystroke();
    setInteracted(true);
    setQuery(value);
  }

  function handleFocus() {
    setInteracted(true);
  }

  function closeAndReset() {
    setQuery("");
    setDialogOpen(false);
  }

  function handleSelectTeam(team: TeamMatch) {
    // The real per-team destination (06-CONTEXT.md D-15/D-16), replacing
    // Phase 5's provisional Teams-page landing. The route takes the plain team
    // number, not the internal `frc{number}` corpus key (`team.teamKey`) —
    // that split is D-15's whole point, so the number is what crosses this
    // boundary. year/algorithm carry forward exactly as handleSelectEvent's
    // own updater does.
    void navigate({
      to: "/team/$teamNumber",
      params: { teamNumber: String(team.teamNumber) },
      search: (prev) => ({ ...prev, year: search.year, algorithm: search.algorithm }),
    });
    closeAndReset();
  }

  function handleSelectEvent(event: EventMatch) {
    // The real per-event destination (07-15-PLAN.md Task 2), replacing
    // Phase 5's provisional Events-page landing. year/algorithm carry forward
    // exactly as handleSelectTeam's own updater does; `tab` comes from the
    // imported `DEFAULT_EVENT_TAB` constant, never a hardcoded id, so
    // 07-18's one-constant flip moves this entry point with no edit here.
    // `week` is dropped entirely: it existed only to filter the old
    // Events-list landing, and the event route's own `validateSearch` would
    // strip it anyway.
    void navigate({
      to: "/event/$eventKey",
      params: { eventKey: event.eventKey },
      search: (prev) => ({ ...prev, year: search.year, algorithm: search.algorithm, tab: DEFAULT_EVENT_TAB }),
    });
    closeAndReset();
  }

  const hasQuery = query.trim() !== "";

  if (isMobile) {
    return (
      <>
        <button type="button" aria-label="Open search" className="tap-target flex items-center justify-center rounded-md" onClick={() => setDialogOpen(true)}>
          <SearchIcon aria-hidden="true" className={tone === "ribbon" ? "size-4 text-[var(--ribbon-ink)]" : "size-4 text-[var(--color-text-primary)]"} />
        </button>
        <CommandDialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setQuery("");
          }}
          title="Search"
          description={SEARCH_PLACEHOLDER}
        >
          {/* `CommandDialog` here is a plain Dialog+DialogContent shell (this
              repo's `ui/command.tsx`) — it does NOT itself provide cmdk's
              filtering/selection context, so a real `Command` root is
              nested inside it, matching the desktop branch's own composition
              below rather than assuming one is implicit. */}
          <Command shouldFilter={false}>
            <CommandInput placeholder={SEARCH_PLACEHOLDER} value={query} onValueChange={markStartAndSetQuery} onFocus={handleFocus} />
            {hasQuery && (
              <CommandList className="max-h-none overflow-visible">
                <ResultsList query={query} teams={results.teams} events={results.events} eventsStatus={results.eventsStatus} onSelectTeam={handleSelectTeam} onSelectEvent={handleSelectEvent} />
              </CommandList>
            )}
          </Command>
        </CommandDialog>
      </>
    );
  }

  const closedControlClass =
    tone === "ribbon"
      ? // `h-9` (36px, the 2026-09-01 "larger ribbon" decision — kept, not the
        // bug) and `py-0` collapse `Command`'s own base `p-1`'s vertical
        // component to 0, leaving `INPUT_GROUP_SEAM_FIX`'s `h-full` on
        // `InputGroup` the only thing to fill.
        `h-9 py-0 overflow-visible rounded-md border border-[var(--ribbon-control-border)] bg-[var(--ribbon-control-bg)] text-[var(--ribbon-ink)] [&_input]:h-full [&_input]:text-[15px] [&_input]:text-[var(--ribbon-ink)] [&_input]:placeholder:text-[var(--ribbon-ink-muted)] ${INPUT_GROUP_SEAM_FIX}`
      : // `h-11` (44px): the home hero's outer previously had NO explicit
        // height and shrink-wrapped to a 46px auto height that was purely an
        // emergent side effect of `InputGroup`'s forced `h-8` (32px) plus the
        // doubled `p-1`/`p-1 pb-0` vertical insets this fix removes — not a
        // value chosen anywhere in the source. Once those insets collapse,
        // `h-full` on a still-auto-height root has no definite height to
        // resolve against and falls back to shrinking around the bare input
        // text, which would visibly shrink the hero control. `h-11` (the
        // closest Tailwind step to that emergent 46px) makes the box model
        // deterministic — and satisfies the verification's literal
        // outer-height-equals-input-group-height check — instead of leaving
        // the hero's size as an accident of removed padding.
        `h-11 py-0 overflow-visible rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] ${INPUT_GROUP_SEAM_FIX}`;

  return (
    <div className={`relative ${className ?? "w-64"}`}>
      <Command shouldFilter={false} className={closedControlClass}>
        <CommandInput placeholder={SEARCH_PLACEHOLDER} value={query} onValueChange={markStartAndSetQuery} onFocus={handleFocus} />
        {hasQuery && (
          // `text-[var(--color-text-primary)]` re-anchors the dropdown's ink:
          // in ribbon tone the wrapper above sets white text, and this list
          // is a LIGHT popover in both tones.
          <CommandList className="absolute top-full right-0 left-0 z-20 mt-[var(--spacing-xs)] max-h-none overflow-visible rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-md">
            <ResultsList query={query} teams={results.teams} events={results.events} eventsStatus={results.eventsStatus} onSelectTeam={handleSelectTeam} onSelectEvent={handleSelectEvent} />
          </CommandList>
        )}
      </Command>
    </div>
  );
}
