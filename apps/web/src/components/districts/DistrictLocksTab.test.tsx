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
  return { status: "contending", pointsToLock: 10, threatCount: 2, cutLinePoints: 100, allocationNote: null, ...overrides };
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
    qualifyingAwards: [],
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

  it("renders a lockedAward row wearing the blue chip, with its qualifying award named in the Sent by column", async () => {
    const t = team({
      teamKey: "frc7",
      teamNumber: 7,
      rank: 7,
      remainingEvents: [{ eventKey: "2026nccmp", eventName: "NC Regional", week: 3, tier: "district", maxPoints: 83 }],
      qualifyingAwards: [{ eventKey: "2026nccmp", awardType: 0, label: "FIRST Impact Award", awardOnly: false }],
      districtLock: verdict({ status: "lockedAward", pointsToLock: 0, threatCount: 0 }),
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} which="district" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    const statusCell = await screen.findByTestId("district-district-lock-status");
    expect(statusCell.textContent).toBe("Locked (Award)");
    expect(statusCell.querySelector(".lock-status-chip--locked-award")).not.toBeNull();
    expect(screen.getByTestId("district-district-lock-awards").textContent).toBe("FIRST Impact Award");
  });

  it("annotates a district-tier award-only invite (Engineering Inspiration/Rookie All Star) in the Sent by column", async () => {
    const t = team({
      teamKey: "frc8",
      teamNumber: 8,
      rank: 8,
      remainingEvents: [{ eventKey: "2026nccmp", eventName: "NC Regional", week: 3, tier: "district", maxPoints: 83 }],
      qualifyingAwards: [{ eventKey: "2026nccmp", awardType: 9, label: "Engineering Inspiration", awardOnly: true }],
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} which="district" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-district-lock-awards")).textContent).toBe("Engineering Inspiration (award-only invite)");
  });

  it("never annotates award-only on the Champ Locks tab — no DCMP-tier award is award-only", async () => {
    const t = team({
      teamKey: "frc9",
      teamNumber: 9,
      rank: 9,
      eventPoints: [{ eventKey: "2026ncdcmp", eventName: "NC District Championship", week: 6, tier: "dcmp", qual: 0, alliance: 0, elim: 0, award: 10, total: 10 }],
      qualifyingAwards: [{ eventKey: "2026ncdcmp", awardType: 9, label: "Engineering Inspiration", awardOnly: false }],
      champLock: verdict({ status: "lockedAward", pointsToLock: 0 }),
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} which="champ" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-champ-lock-awards")).textContent).toBe("Engineering Inspiration");
  });

  it("renders a prequalified row wearing the purple chip", async () => {
    const t = team({
      teamKey: "frc10",
      teamNumber: 10,
      rank: 10,
      champLock: verdict({ status: "prequalified", pointsToLock: 0 }),
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} which="champ" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    const statusCell = await screen.findByTestId("district-champ-lock-status");
    expect(statusCell.textContent).toBe("Prequalified");
    expect(statusCell.querySelector(".lock-status-chip--prequalified")).not.toBeNull();
  });

  it("renders an eliminated row wearing the red chip", async () => {
    const t = team({
      teamKey: "frc11",
      teamNumber: 11,
      rank: 11,
      districtLock: verdict({ status: "eliminated", pointsToLock: null }),
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} which="district" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    const statusCell = await screen.findByTestId("district-district-lock-status");
    expect(statusCell.querySelector(".lock-status-chip--eliminated")).not.toBeNull();
  });

  it("a locked row wears the green chip", async () => {
    const t = team({
      teamKey: "frc12",
      teamNumber: 12,
      rank: 12,
      districtLock: verdict({ status: "locked", pointsToLock: 0 }),
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} which="district" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    const statusCell = await screen.findByTestId("district-district-lock-status");
    expect(statusCell.querySelector(".lock-status-chip--locked")).not.toBeNull();
  });

  it("contending and unknown stay plain text — no chip class on either", async () => {
    const contendingTeam = team({ teamKey: "frc13", teamNumber: 13, rank: 13, districtLock: verdict({ status: "contending" }) });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([contendingTeam])} which="district" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    const statusCell = await screen.findByTestId("district-district-lock-status");
    expect(statusCell.querySelector(".lock-status-chip")).toBeNull();
  });

  it("special-cased allocationNote (2025fsc) overrides the points-still-needed cell, even for an unknown-status verdict", async () => {
    const t = team({
      teamKey: "frc14",
      teamNumber: 14,
      rank: 14,
      champLock: verdict({ status: "unknown", pointsToLock: null, allocationNote: "special allocation — not modeled" }),
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} which="champ" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-champ-lock-status")).textContent).toBe("Capacity not published");
    expect(screen.getByTestId("district-champ-lock-points-to-lock").textContent).toBe("special allocation — not modeled");
  });

  it("the District Locks header shows the schedule strip with played vs upcoming events and the district-wide points pool", async () => {
    const t1 = team({
      teamKey: "frc15",
      teamNumber: 15,
      rank: 15,
      eventPoints: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", qual: 40, alliance: 20, elim: 0, award: 0, total: 60 }],
      remainingEvents: [{ eventKey: "eventB", eventName: "Event B", week: 5, tier: "district", maxPoints: 83 }],
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t1])} which="district" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    const strip = await screen.findByTestId("district-locks-schedule-strip");
    const events = strip.querySelectorAll('[data-testid="district-locks-schedule-event"]');
    expect(events).toHaveLength(2);
    expect(events[0]?.getAttribute("data-played")).toBe("true");
    expect(events[0]?.textContent).toContain("Played");
    expect(events[1]?.getAttribute("data-played")).toBe("false");
    expect(events[1]?.textContent).toContain("Upcoming");
    expect(screen.getByTestId("district-locks-distributed").textContent).toBe("60");
  });

  it("the Champ Locks header shows 'Remaining district points: X / Y pre-DCMP'", async () => {
    const t1 = team({
      teamKey: "frc16",
      teamNumber: 16,
      rank: 16,
      remainingEvents: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", maxPoints: 83 }],
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t1])} which="champ" algorithm="vpr" season={2026} />
      </TestHarness>,
    );
    const stat = await screen.findByTestId("champ-locks-remaining-district-points");
    expect(stat.textContent).toBe("0 / 83 pre-DCMP");
  });
});
