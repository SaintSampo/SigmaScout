/**
 * Home-page podium coverage (CR-01, review 260902-post-phase08-ungoverned-ui).
 *
 * `pooledAccuracyPodium` throws by design on a malformed artifact. That throw
 * used to escape into a React render on the site's front door, so a
 * well-formed HTTP 200 whose `combined` slice was absent for one algorithm
 * replaced the whole home page with a router error surface. `index.tsx`'s own
 * header comment promised the opposite ("simply hides on error"); these tests
 * pin that promise.
 *
 * The queries are seeded straight into the `QueryClient` cache rather than
 * fetched through a mocked `global.fetch`, so `useQueries` reports data on the
 * FIRST render — the failure this file guards is a synchronous render-time
 * throw, and seeding is what makes it show up synchronously in `render()`
 * instead of inside a later async act() where it could be swallowed.
 * `staleTime: Infinity` keeps the seeded entries from triggering a background
 * refetch against a `fetch` this suite never mocks.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PUBLISHED_ALGORITHM_IDS } from "../../../../packages/harness/publishedAlgorithms.js";
import { PODIUM_SEASONS } from "../lib/homePodium.js";
import { HOME_PODIUM_TESTID, Podium } from "./index.js";
import compare2024 from "./__fixtures__/compare-2024.json";
import compare2025 from "./__fixtures__/compare-2025.json";
import compare2026 from "./__fixtures__/compare-2026.json";

type Artifact = { slices: { algorithmId: string; compLevelView: string }[] };

const FIXTURES_BY_YEAR: Record<number, unknown> = {
  2024: compare2024,
  2025: compare2025,
  2026: compare2026,
};

/** Renders `Podium` over a cache pre-seeded with one artifact per `PODIUM_SEASONS` year, each passed through `transform`. */
function renderPodium(transform: (artifact: Artifact, year: number) => Artifact = (a) => a) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const year of PODIUM_SEASONS) {
    const fixture = FIXTURES_BY_YEAR[year];
    if (fixture === undefined) throw new Error(`no committed compare fixture for podium season ${year}`);
    const artifact = structuredClone(fixture) as Artifact;
    queryClient.setQueryData(["compare", year], transform(artifact, year));
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Podium />
    </QueryClientProvider>,
  );
}

describe("home page podium", () => {
  afterEach(cleanup);

  it("renders one step per published algorithm from the committed compare fixtures", () => {
    renderPodium();
    expect(screen.getByTestId(HOME_PODIUM_TESTID)).toBeDefined();
    for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
      expect(screen.getByTestId(`podium-${algorithmId}`)).toBeDefined();
    }
  });

  it("hides the podium instead of taking down the front door when a 200 artifact is missing one algorithm's combined slice", () => {
    const dropped = PUBLISHED_ALGORITHM_IDS[0];
    expect(() =>
      renderPodium((artifact, year) => {
        if (year !== PODIUM_SEASONS[1]) return artifact;
        // Exactly the drift a republish can introduce: a well-formed,
        // schema-valid artifact that simply has no combined slice for one
        // algorithm. `pooledAccuracyPodium` throws on this by design.
        return { ...artifact, slices: artifact.slices.filter((s) => !(s.algorithmId === dropped && s.compLevelView === "combined")) };
      }),
    ).not.toThrow();
    expect(screen.queryByTestId(HOME_PODIUM_TESTID)).toBeNull();
    expect(screen.queryByTestId(`podium-${dropped}`)).toBeNull();
  });

  it("hides the podium when an algorithm pools to zero scored matches, the helper's other throw", () => {
    expect(() =>
      renderPodium((artifact) => ({
        ...artifact,
        slices: artifact.slices.map((s) => ({ ...s, scoredCount: 0 })),
      })),
    ).not.toThrow();
    expect(screen.queryByTestId(HOME_PODIUM_TESTID)).toBeNull();
  });
});
