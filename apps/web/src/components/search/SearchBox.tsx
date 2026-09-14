/**
 * An instant, keyboard-navigable dropdown of top team/event matches, built on
 * the tested matching module (`lib/search-index.ts`) and a lazy-fetch of
 * whichever artifact the current route does not already hold.
 *
 * One component, two renderings — `useIsMobile()` (the shared breakpoint,
 * `lib/breakpoints.ts`) decides which: desktop shows an inline `Command` box;
 * phone shows a 44x44 icon trigger that opens a `CommandDialog` with the same
 * input+results.
 *
 * `shouldFilter={false}` on every `Command`/`CommandDialog` below: cmdk's own
 * fuzzy filter/sort is turned off, because the matching rule is decided once
 * by the tested `buildSearchResults`, not by cmdk's bundled `command-score`
 * library. cmdk still owns arrow-key/Enter selection over whatever
 * `CommandItem`s are mounted.
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
 * Same escape hatch as `Ribbon.tsx`'s `preserveSearch`: this component is
 * mounted once at the root layout, visible on every route, and its target
 * route genuinely varies (a team match navigates to `/team/{number}`, an
 * event match to `/event/{eventKey}`) — no single typed `<Link>` can express
 * that, so an imperative, narrowly-typed `navigate()` cast is used instead.
 * An unrecognized search field passing through the spread is stripped by the
 * target route's own `validateSearch`, never a crash. `params` is a union of
 * the two destinations' own path params — the plain team number (not the
 * internal `frc{n}` key) or the event key.
 */
type SearchNavigate = (opts: {
  to: "/team/$teamNumber" | "/event/$eventKey";
  params: { teamNumber: string } | { eventKey: string };
  search: (prev: Record<string, unknown>) => Record<string, unknown>;
}) => Promise<void>;

/** Kept short deliberately: the box is `w-64` (256px), so a longer placeholder with an example clips mid-word. */
const SEARCH_PLACEHOLDER = "Search teams or events";

/**
 * The highlighted-row accent, applied as a Tailwind opacity modifier over the CSS custom property, never a literal hex value.
 *
 * `data-[selected=true]:`, never Tailwind v4's bare `data-selected:` — the bare form matches the attribute's PRESENCE, and cmdk writes `data-selected="false"` on every unselected row, so every result row would paint the highlight at once.
 */
const HIGHLIGHT_CLASS = "data-[selected=true]:bg-[var(--color-accent)]/10 data-[selected=true]:text-[var(--color-text-primary)]";

/**
 * `CommandInput` (`ui/command.tsx`) wraps a shadcn `InputGroup`
 * (`ui/input-group.tsx`) that carries its own border, background and fixed
 * `h-8` — a second, nested box inside whichever `Command` root this file
 * styles per `tone`. This neutralises `InputGroup` into an invisible
 * full-height layout box so the outer `Command` root is the one visible
 * surface.
 *
 * Targets `InputGroup` by its stable `data-slot="input-group"` attribute via
 * a descendant selector — `[&>div]` instead would hit the intermediate
 * `command-input-wrapper` div, two levels above `InputGroup`, not
 * `InputGroup` itself.
 *
 * `border-transparent!`/`bg-transparent!` need `!` because `InputGroup`'s own
 * `h-8!`/`rounded-lg!`/`bg-input/30` are Tailwind `!important` utilities on
 * the same element; a same-specificity plain class can never beat
 * `!important`. `command-input-wrapper`'s own `p-1 pb-0` is collapsed to
 * `py-0!` rather than compensated for, leaving `Command`'s own `p-1`/`py-0`
 * as the only source of vertical inset.
 *
 * The focus ring is added on the `Command` root rather than relying on
 * `InputGroup`'s own focus-visible selector, which targets a data-slot
 * `CommandInput` never sets; it reuses the `border-ring`/`ring-3`/`ring-ring/50`
 * tokens `ui/select.tsx`'s `SelectTrigger` uses for the same purpose.
 */
const INPUT_GROUP_SEAM_FIX =
  "[&_[data-slot=input-group]]:h-full! [&_[data-slot=input-group]]:border-transparent! [&_[data-slot=input-group]]:bg-transparent! " +
  // `command-input-wrapper` also needs its own `h-full`, not just `py-0`:
  // `height: 100%` only resolves against a parent with a definite height, and
  // this intermediate block div isn't one by itself.
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
      {/* A null week renders without a week chip — never a blank slot, never the literal text "null". */}
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

/** The three event-section copies render as plain text nodes rather than `CommandItem`s — status messages, not selectable rows, so they never enter cmdk's keyboard-navigation order. */
function ResultsList({ query, teams, events, eventsStatus, onSelectTeam, onSelectEvent }: ResultsListProps) {
  const hasTeams = teams.length > 0;
  const hasEvents = events.length > 0;
  const noMatchesAtAll = eventsStatus === "loaded" && !hasTeams && !hasEvents;

  if (noMatchesAtAll) {
    return <CommandEmpty>{`No teams or events found for "${query}"`}</CommandEmpty>;
  }

  // The Events section renders whenever it has something to say — real
  // matches or a degraded-state copy — and is absent when loaded-and-empty.
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
 * `tone`: the same component renders inside the dark green ribbon and on the
 * light home-page hero. "ribbon" paints the closed control with the
 * `--ribbon-*` translucent-on-dark vocabulary; "page" (the default) keeps the
 * light bordered box. The results dropdown is a light popover in both tones.
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

  // Lazy fetch: whichever artifact this route already holds is enabled
  // unconditionally (TanStack Query dedupes against the route's own identical
  // query key, so this is never a second network request); the other
  // artifact stays disabled until the first focus or keystroke.
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
        // Same real-team rule the Teams table applies (`lib/teamKey.ts`): a
        // nameless offseason B-team must not be offered as a search result.
        teams: (teamsQuery.data?.teams ?? []).filter((team) => isRealTeamKey(team.teamKey)),
        events: eventsQuery.data?.events ?? [],
        query,
        eventsStatus,
      }),
    [teamsQuery.data, eventsQuery.data, query, eventsStatus],
  );

  // Keystroke-latency gate: `markStartAndSetQuery` marks the start on every
  // keystroke; this effect, keyed on the rendered results, marks the end once
  // the new dropdown content has committed, then logs a structured line a
  // live-browser measurement script can read.
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
    // The route takes the plain team number, not the internal `frc{number}`
    // corpus key. year/algorithm carry forward.
    void navigate({
      to: "/team/$teamNumber",
      params: { teamNumber: String(team.teamNumber) },
      search: (prev) => ({ ...prev, year: search.year, algorithm: search.algorithm }),
    });
    closeAndReset();
  }

  function handleSelectEvent(event: EventMatch) {
    // year/algorithm carry forward; `tab` comes from the imported
    // `DEFAULT_EVENT_TAB` constant, never a hardcoded id. `week` is dropped:
    // the event route's own `validateSearch` would strip it anyway.
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
        {tone === "ribbon" ? (
          <button type="button" aria-label="Open search" className="tap-target flex items-center justify-center rounded-md" onClick={() => setDialogOpen(true)}>
            <SearchIcon aria-hidden="true" className="size-4 text-[var(--ribbon-ink)]" />
          </button>
        ) : (
          // On a phone this is a bar-shaped button opening the same dialog: an
          // inline input's dropdown would open under the on-screen keyboard.
          <button
            type="button"
            className={`flex h-11 items-center gap-[var(--spacing-sm)] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-[var(--spacing-md)] text-left text-sm text-[var(--color-text-muted)] ${className ?? "w-64"}`}
            onClick={() => setDialogOpen(true)}
          >
            <SearchIcon aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{SEARCH_PLACEHOLDER}</span>
          </button>
        )}
        <CommandDialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setQuery("");
          }}
          title="Search"
          description={SEARCH_PLACEHOLDER}
        >
          {/* `CommandDialog` is a plain Dialog+DialogContent shell — it does not itself provide cmdk's filtering/selection context, so a real `Command` root is nested inside it. */}
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
      ? // `h-9` and `py-0` collapse `Command`'s own base `p-1`'s vertical
        // component to 0, leaving `INPUT_GROUP_SEAM_FIX`'s `h-full` on
        // `InputGroup` the only thing to fill.
        `h-9 py-0 overflow-visible rounded-md border border-[var(--ribbon-control-border)] bg-[var(--ribbon-control-bg)] text-[var(--ribbon-ink)] [&_input]:h-full [&_input]:text-[15px] [&_input]:text-[var(--ribbon-ink)] [&_input]:placeholder:text-[var(--ribbon-ink-muted)] ${INPUT_GROUP_SEAM_FIX}`
      : // `h-11`: an explicit height is required because `h-full` on a
        // still-auto-height root has no definite height to resolve against
        // and would otherwise shrink around the bare input text.
        `h-11 py-0 overflow-visible rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] ${INPUT_GROUP_SEAM_FIX}`;

  return (
    <div className={`relative ${className ?? "w-64"}`}>
      <Command shouldFilter={false} className={closedControlClass}>
        <CommandInput placeholder={SEARCH_PLACEHOLDER} value={query} onValueChange={markStartAndSetQuery} onFocus={handleFocus} />
        {hasQuery && (
          // `text-[var(--color-text-primary)]` re-anchors the dropdown's ink:
          // in ribbon tone the wrapper above sets white text, and this list is
          // a light popover in both tones.
          <CommandList className="absolute top-full right-0 left-0 z-20 mt-[var(--spacing-xs)] max-h-none overflow-visible rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-md">
            <ResultsList query={query} teams={results.teams} events={results.events} eventsStatus={results.eventsStatus} onSelectTeam={handleSelectTeam} onSelectEvent={handleSelectEvent} />
          </CommandList>
        )}
      </Command>
    </div>
  );
}
