/**
 * Shared test helpers (260913-nvn Task 3a) — collapses byte-identical
 * duplicates that had drifted into five/four separate copies across the
 * suite. No JSX here and no import of `routerHarness.tsx`, which builds a
 * router at import time; this module stays a plain, router-free utility file
 * so a test that needs no router (e.g. a `QueryClient`-only test) does not
 * pay for one.
 */
import { QueryClient } from "@tanstack/react-query";
import {
  EventArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  TeamsArtifactSchema,
  type EventArtifact,
  type TeamsArtifact,
} from "../../../../packages/harness/pageArtifacts.js";

/**
 * Mocks `window.matchMedia` to report a match for every query (the
 * narrow-viewport branch every caller of this helper tests), and returns a
 * restore function the caller must call in cleanup/afterEach. Byte-identical
 * copy of the five pre-260913-nvn duplicates in AlliancesTab.test.tsx,
 * BreakdownTab.test.tsx, InsightsTab.test.tsx, RankDistributionTable.test.tsx
 * and TeamsTable.test.tsx.
 */
export function mockNarrowViewport(): () => void {
  const original = window.matchMedia;
  window.matchMedia = (query: string) =>
    ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  return () => {
    window.matchMedia = original;
  };
}

/**
 * A `QueryClient` with retries disabled, for a component test that renders
 * behind a `QueryClientProvider` and does not want a failed fetch to retry
 * before an assertion runs. Byte-identical copy of the four pre-260913-nvn
 * duplicates in AlgorithmSelect.test.tsx, Ribbon.test.tsx, YearSelect.test.tsx
 * and SearchBox.test.tsx.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

type EventArtifactTeam = EventArtifact["teams"][number];

/**
 * Builds a valid `EventArtifact` through `EventArtifactSchema.parse` — the
 * real schema, proving the fixture matches the published shape. Fixed at
 * `spr` / `2.0.0+tuned-2026-08` / `2024casf` / season 2024 with empty
 * `matches`/`upcoming`, matching the pre-260913-nvn duplicate this collapses
 * (BreakdownTab.test.tsx and InsightsTab.test.tsx).
 */
export function makeEventArtifact(
  teams: EventArtifactTeam[],
  overrides: Partial<EventArtifact> = {},
): EventArtifact {
  return EventArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-27T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    eventKey: "2024casf",
    season: 2024,
    matches: [],
    upcoming: [],
    teams,
    ...overrides,
  });
}

/**
 * Builds a valid `TeamsArtifact` through `TeamsArtifactSchema.parse`. Fixed
 * at `spr` / `2.0.0+tuned-2026-08` / season 2026, matching the
 * pre-260913-nvn duplicate this collapses (TeamsFilters.test.tsx and
 * teamFilterModel.test.ts). Takes `teams: unknown[]` (not a typed row array)
 * because both callers build hand-shaped fixture rows that only need to
 * survive the schema's own parse, not satisfy a narrower TypeScript type.
 */
export function makeTeamsArtifact(teams: unknown[]): TeamsArtifact {
  return TeamsArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    season: 2026,
    teams,
  });
}
