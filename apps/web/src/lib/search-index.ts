/**
 * D-09's matching predicate over teams and events, plus the capped result
 * assembly the search dropdown renders (05-08-PLAN.md Task 1). Pure TypeScript
 * — no React import, no dependency beyond the published artifact row types
 * (`packages/harness/pageArtifacts.ts`'s `TeamsArtifact`/`EventsArtifact`).
 *
 * SECURITY (T-05-01, 05-RESEARCH.md Pitfall 3): the query string is
 * arbitrary user-typed text evaluated on EVERY KEYSTROKE on the browser's
 * own main thread. D-09's rule ("number-prefix plus name-substring") needs
 * no pattern compilation at all — `String.prototype.startsWith()` and
 * `.includes()` are both correct for this rule AND immune to catastrophic
 * backtracking by construction, because no pattern object is EVER built from
 * the query. Do NOT "simplify" this back to a pattern object constructed
 * from the raw query text with a case-insensitive flag — that turns every
 * keystroke into a live compiled pattern evaluated against arbitrary user
 * input, which is exactly the denial-of-service shape this module exists to
 * avoid.
 *
 * CASE-INSENSITIVITY: both sides are lowercased with the string's own
 * `.toLowerCase()` before comparison — never a case-insensitive pattern
 * flag, never a locale-aware string-comparison method, never a Unicode
 * normalization pass. Comparison is therefore by the string's own UTF-16
 * code units with no locale-aware collation and no normalization form
 * applied, so matching behaviour cannot vary by browser or by the visitor's
 * OS locale.
 */
import type { EventsArtifact, TeamsArtifact } from "../../../../packages/harness/pageArtifacts.js";

/** The row shape `matchTeams` reads: `TeamsArtifact["teams"][number]` — `teamKey`/`teamNumber`/`nickname` only, though the full published row satisfies this structurally. */
export type SearchTeamRow = TeamsArtifact["teams"][number];

/** The row shape `matchEvents` reads: `EventsArtifact["events"][number]` — `eventKey`/`name`/`startDate`/`week` only, though the full published row satisfies this structurally. */
export type SearchEventRow = EventsArtifact["events"][number];

export interface TeamMatch {
  kind: "team";
  teamKey: string;
  teamNumber: number;
  nickname: string;
}

export interface EventMatch {
  kind: "event";
  eventKey: string;
  name: string;
  /** `null` when the event's week cannot be derived (offseason/preseason) — the dropdown renders no week chip for this case, never a blank slot or the literal text "null". */
  week: number | null;
}

/** The eight-item hard cap on the COMBINED (teams + events) result set — declared once, applied once in `buildSearchResults`. The cap is the whole overflow rule: no internal scroll, no "N more" affordance. */
export const SEARCH_RESULT_CAP = 8;

/** Trim and lowercase once per call; an empty or whitespace-only query normalizes to `""`, which both `matchTeams`/`matchEvents` treat as "match nothing" rather than "match everything." */
function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Ascending team-number comparator for stable, deterministic display order. */
function compareTeamMatches(a: TeamMatch, b: TeamMatch): number {
  return a.teamNumber - b.teamNumber;
}

/** Ascending start-date-then-event-key comparator. Plain `<`/`>` string comparison — never a locale-aware comparison method (this module's own case-insensitivity rule extends to sorting: no locale-aware collation anywhere in this file). */
function compareEventMatches(a: { startDate: string; eventKey: string }, b: { startDate: string; eventKey: string }): number {
  if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
  if (a.eventKey !== b.eventKey) return a.eventKey < b.eventKey ? -1 : 1;
  return 0;
}

/**
 * D-09's team-matching rule: `query` matches a team when it is a PREFIX of
 * the team's number (as decimal text — `"111"` matches `1114` but not
 * `2111`, since prefix is not substring) OR a SUBSTRING of the team's
 * lowercased nickname, anywhere in the name (`"simb"` matches "Simbotics").
 * A team with an empty nickname (`""`) is still matched by number and never
 * throws — `"".includes(q)` is simply `false` for any non-empty `q`.
 *
 * Returns matches sorted by ascending team number — the one deterministic
 * order this function and `buildSearchResults` agree on.
 */
export function matchTeams(teams: readonly SearchTeamRow[], query: string): TeamMatch[] {
  const q = normalizeQuery(query);
  if (q === "") return [];

  const matches: TeamMatch[] = [];
  for (const team of teams) {
    const numberText = String(team.teamNumber);
    const nameLower = team.nickname.toLowerCase();
    if (numberText.startsWith(q) || nameLower.includes(q)) {
      matches.push({ kind: "team", teamKey: team.teamKey, teamNumber: team.teamNumber, nickname: team.nickname });
    }
  }
  return matches.sort(compareTeamMatches);
}

/**
 * D-09's event-matching rule: `query` matches an event when it is a
 * SUBSTRING of the lowercased event name OR the lowercased event key
 * (`"silicon"` matches "Silicon Valley Regional"; `"2024"` matches by key or
 * name, the same rule applied to both fields).
 *
 * Returns matches sorted by ascending start date, then ascending event key.
 */
export function matchEvents(events: readonly SearchEventRow[], query: string): EventMatch[] {
  const q = normalizeQuery(query);
  if (q === "") return [];

  const matches: (EventMatch & { startDate: string })[] = [];
  for (const event of events) {
    const nameLower = event.name.toLowerCase();
    const keyLower = event.eventKey.toLowerCase();
    if (nameLower.includes(q) || keyLower.includes(q)) {
      matches.push({ kind: "event", eventKey: event.eventKey, name: event.name, week: event.week, startDate: event.startDate });
    }
  }
  matches.sort(compareEventMatches);
  return matches.map(({ kind, eventKey, name, week }) => ({ kind, eventKey, name, week }));
}

/** Whether the lazily-fetched (D-10) events artifact is resolved, still loading, or failed to load — made explicit in the model so `SearchBox` can render the contract's three different event-section copies without inferring state from `undefined`. */
export type EventsSectionStatus = "loaded" | "loading" | "failed";

export interface BuildSearchResultsParams {
  teams: readonly SearchTeamRow[];
  events: readonly SearchEventRow[];
  query: string;
  eventsStatus: EventsSectionStatus;
}

export interface SearchResults {
  teams: TeamMatch[];
  events: EventMatch[];
  eventsStatus: EventsSectionStatus;
}

/**
 * Assembles the two match groups and applies the shared `SEARCH_RESULT_CAP`
 * across BOTH groups combined — teams first (D-08: "find my team" is this
 * project's dominant search use case), then whatever cap remains goes to
 * events. Order WITHIN each group is untouched by the cap (still ascending
 * team number / ascending start-date-then-key); only the combined COUNT is
 * bounded.
 *
 * `events`/`matchEvents` is only ever consulted when `eventsStatus` is
 * `"loaded"` — while events are `"loading"` or `"failed"`, the events group
 * is always empty and the caller renders the copy `eventsStatus` names,
 * never a guessed or inferred state. Team results are computed and returned
 * regardless of `eventsStatus`, so they are never blocked by the events
 * artifact's lazy fetch (D-10).
 */
export function buildSearchResults({ teams, events, query, eventsStatus }: BuildSearchResultsParams): SearchResults {
  const teamMatches = matchTeams(teams, query);
  const eventMatches = eventsStatus === "loaded" ? matchEvents(events, query) : [];

  const cappedTeams = teamMatches.slice(0, SEARCH_RESULT_CAP);
  const remaining = SEARCH_RESULT_CAP - cappedTeams.length;
  const cappedEvents = remaining > 0 ? eventMatches.slice(0, remaining) : [];

  return { teams: cappedTeams, events: cappedEvents, eventsStatus };
}
