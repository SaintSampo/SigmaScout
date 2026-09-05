/**
 * `DistrictLocksTab`'s team-number cells are real router `Link`s (mirroring
 * `BreakdownTab.test.tsx`'s pattern for the same reason), so every render
 * needs a router context whose tree carries a `to="/team/$teamNumber"`
 * route — the same self-contained-tree `TestHarness` technique. TanStack
 * Router resolves its first match asynchronously, so every assertion below
 * follows `BreakdownTab.test.tsx`'s own `findBy*`/`await waitFor(...)`
 * convention rather than querying synchronously right after `render()`.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema, TeamSearchSchema } from "@/lib/searchParams";
import { DistrictArtifactSchema, type DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { DistrictLocksTab } from "./DistrictLocksTab.js";

type DistrictTeam = DistrictArtifact["teams"][number];
type LockVerdict = DistrictTeam["districtLock"];

const ChildrenContext = createContext<ReactNode>(null);

function RouteBody() {
  return <>{useContext(ChildrenContext)}</>;
}

function TestHarness({ children }: { children: ReactNode }) {
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
    const districtsRoute = createRoute({ path: "/districts", getParentRoute: () => rootRoute, component: RouteBody });
    const teamRoute = createRoute({ path: "/team/$teamNumber", getParentRoute: () => rootRoute, validateSearch: TeamSearchSchema, component: () => null });
    const routeTree = rootRoute.addChildren([districtsRoute, teamRoute]);
    return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/districts?algorithm=vpr"] }) });
  });
  return (
    <ChildrenContext.Provider value={children}>
      <RouterProvider router={router} />
    </ChildrenContext.Provider>
  );
}

function verdict(overrides: Partial<LockVerdict> = {}): LockVerdict {
  return { status: "contending", pointsToLock: 10, threatCount: 2, cutLinePoints: 100, ...overrides };
}

function team(overrides: Partial<DistrictTeam> = {}): DistrictTeam {
  return {
    teamKey: "frc1",
    teamNumber: 1,
    nickname: "Team One",
    rank: 1,
    pointTotal: 100,
    rookieBonus: 0,
    adjustments: 0,
    eventPoints: [],
    remainingEvents: [],
    maxRemainingDistrict: 20,
    maxRemainingChamp: 20,
    districtLock: verdict(),
    champLock: verdict(),
    ...overrides,
  };
}

/** Builds a valid artifact through `DistrictArtifactSchema.parse` — the real schema, proving each fixture matches the published shape. */
function makeArtifact(teams: DistrictTeam[], overrides: Partial<DistrictArtifact> = {}): DistrictArtifact {
  return DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-05T00:00:00.000Z",
    districtKey: "2026fnc",
    year: 2026,
    abbreviation: "fnc",
    displayName: "FIRST North Carolina",
    dcmpSlots: 54,
    cmpSlots: 19,
    teams,
    insights: {
      teamCount: teams.length,
      eventCount: 3,
      dcmpCutLinePoints: 150,
      cmpCutLinePoints: 300,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
    ...overrides,
  });
}

describe("DistrictLocksTab", () => {
  it("renders a locked row with 0 points still needed", async () => {
    const t = team({ teamKey: "frc1", teamNumber: 1, rank: 1, districtLock: verdict({ status: "locked", pointsToLock: 0, threatCount: 0 }) });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} which="district" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-district-lock-status")).textContent).toBe("Locked");
    expect(screen.getByTestId("district-district-lock-points-to-lock").textContent).toBe("0");
  });

  it("renders a contending row with a real points-needed number", async () => {
    const t = team({ teamKey: "frc2", teamNumber: 2, rank: 2, districtLock: verdict({ status: "contending", pointsToLock: 15, threatCount: 3 }) });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} which="district" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-district-lock-status")).textContent).toBe("Contending");
    expect(screen.getByTestId("district-district-lock-points-to-lock").textContent).toBe("15 more points");
  });

  it("renders an eliminated row", async () => {
    const t = team({ teamKey: "frc3", teamNumber: 3, rank: 3, districtLock: verdict({ status: "eliminated", pointsToLock: null, threatCount: 54 }) });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} which="district" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-district-lock-status")).textContent).toBe("Eliminated");
  });

  it("renders an unattainable row (pointsToLock null but not locked/eliminated) as 'Not attainable this season', never a number", async () => {
    const t = team({
      teamKey: "frc4",
      teamNumber: 4,
      rank: 4,
      maxRemainingDistrict: 5,
      districtLock: verdict({ status: "contending", pointsToLock: null, threatCount: 1 }),
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} which="district" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-district-lock-status")).textContent).toBe("Contending");
    expect(screen.getByTestId("district-district-lock-points-to-lock").textContent).toBe("Not attainable this season");
  });

  it("renders the unknown-capacity row as an honest 'Capacity not published' — never a guessed number", async () => {
    const t = team({ teamKey: "frc5", teamNumber: 5, rank: 5, districtLock: verdict({ status: "unknown", pointsToLock: null, threatCount: 0 }) });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t], { dcmpSlots: null })} which="district" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-district-lock-status")).textContent).toBe("Capacity not published");
    expect(screen.getByTestId("district-district-lock-points-to-lock").textContent).toBe("—");
  });

  it("shows the champ-lock verdict (not the district-lock one) when which='champ'", async () => {
    const t = team({
      teamKey: "frc6",
      teamNumber: 6,
      rank: 6,
      districtLock: verdict({ status: "locked", pointsToLock: 0 }),
      champLock: verdict({ status: "eliminated", pointsToLock: null }),
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} which="champ" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-champ-lock-status")).textContent).toBe("Eliminated");
  });

  it("shows the conservatism caveat, plainly worded", async () => {
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([team()])} which="district" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    expect(await screen.findByText(/declines, waitlist movement and wildcard slots/)).toBeDefined();
  });

  it("shows the capacity and cut line in the header", async () => {
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([team()])} which="district" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    expect(await screen.findByText("54")).toBeDefined();
    expect(screen.getByText("150")).toBeDefined();
  });
});
