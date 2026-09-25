/**
 * `DistrictLocksTab` is the CHAMP LOCKS tab, and since 2026-09-25 (quick task
 * 260925-ots) that tier only — the `which="district"` arm lost its last
 * production call site when phase 10 replaced the District Locks tab with the
 * Road to District Champs ledger. The six cases that asserted district-tier
 * behaviour specifically (the schedule strip, the district-wide points pool,
 * the per-team pre-DCMP ceiling twice, the district header card's shape, and
 * the "(award-only invite)" annotation, which no DCMP-tier award ever carries)
 * are deleted with that arm. Every other case is unchanged in what it asserts
 * and now drives the champ arm, so the chip classes, the four
 * `formatPointsToLock` branches, the awards cell and the column toggle keep
 * their coverage.
 *
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
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/districts?algorithm=spr"] }) });
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
    const t = team({ teamKey: "frc1", teamNumber: 1, rank: 1, champLock: verdict({ status: "locked", pointsToLock: 0, threatCount: 0 }) });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-champ-lock-status")).textContent).toBe("Locked");
    expect(screen.getByTestId("district-champ-lock-points-to-lock").textContent).toBe("0");
  });

  it("renders a contending row with a real points-needed number", async () => {
    const t = team({ teamKey: "frc2", teamNumber: 2, rank: 2, champLock: verdict({ status: "contending", pointsToLock: 15, threatCount: 3 }) });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-champ-lock-status")).textContent).toBe("Contending");
    expect(screen.getByTestId("district-champ-lock-points-to-lock").textContent).toBe("15 more points");
  });

  it("renders an eliminated row", async () => {
    const t = team({ teamKey: "frc3", teamNumber: 3, rank: 3, champLock: verdict({ status: "eliminated", pointsToLock: null, threatCount: 54 }) });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-champ-lock-status")).textContent).toBe("Out of range");
  });

  it("renders an unattainable row (pointsToLock null but not locked/eliminated) as 'Not attainable this season', never a number", async () => {
    const t = team({
      teamKey: "frc4",
      teamNumber: 4,
      rank: 4,
      maxRemainingDistrict: 5,
      champLock: verdict({ status: "contending", pointsToLock: null, threatCount: 1 }),
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-champ-lock-status")).textContent).toBe("Contending");
    expect(screen.getByTestId("district-champ-lock-points-to-lock").textContent).toBe("Not attainable this season");
  });

  it("renders the unknown-capacity row as an honest 'Capacity not published' — never a guessed number", async () => {
    const t = team({ teamKey: "frc5", teamNumber: 5, rank: 5, champLock: verdict({ status: "unknown", pointsToLock: null, threatCount: 0 }) });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t], { cmpSlots: null })} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-champ-lock-status")).textContent).toBe("Capacity not published");
    expect(screen.getByTestId("district-champ-lock-points-to-lock").textContent).toBe("—");
  });

  it("reads the CHAMP verdict, never the district one — the district arm is gone, and this pins that the remaining arm reads the right field", async () => {
    const t = team({
      teamKey: "frc6",
      teamNumber: 6,
      rank: 6,
      districtLock: verdict({ status: "locked", pointsToLock: 0 }),
      champLock: verdict({ status: "eliminated", pointsToLock: null }),
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-champ-lock-status")).textContent).toBe("Out of range");
  });

  it("shows the conservatism caveat, plainly worded", async () => {
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([team()])} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    expect(await screen.findByText(/declines, waitlist movement and wildcard slots/)).toBeDefined();
  });

  it("shows the champ capacity and lock line in the header, with units", async () => {
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([team()])} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    // `cmpSlots` and `insights.cmpCutLinePoints` from `makeArtifact`, not the
    // dcmp pair the deleted district arm read.
    expect(await screen.findByText("19 Teams")).toBeDefined();
    expect(screen.getByText("Lock Line")).toBeDefined();
    expect(screen.getByText("300 Points")).toBeDefined();
  });

  it("renders a lockedAward row wearing the blue chip, with its qualifying award named in the Sent by column", async () => {
    const t = team({
      teamKey: "frc7",
      teamNumber: 7,
      rank: 7,
      remainingEvents: [{ eventKey: "2026nccmp", eventName: "NC District Championship", week: 6, tier: "dcmp", maxPoints: 249 }],
      qualifyingAwards: [{ eventKey: "2026nccmp", awardType: 0, label: "FIRST Impact Award", awardOnly: false }],
      champLock: verdict({ status: "lockedAward", pointsToLock: 0, threatCount: 0 }),
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    const statusCell = await screen.findByTestId("district-champ-lock-status");
    expect(statusCell.textContent).toBe("Locked (Award)");
    expect(statusCell.querySelector(".lock-status-chip--locked-award")).not.toBeNull();
    expect(screen.getByTestId("district-champ-lock-awards").textContent).toBe("FIRST Impact Award");
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
        <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
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
        <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
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
      champLock: verdict({ status: "eliminated", pointsToLock: null }),
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    const statusCell = await screen.findByTestId("district-champ-lock-status");
    expect(statusCell.querySelector(".lock-status-chip--eliminated")).not.toBeNull();
  });

  it("a locked row wears the green chip", async () => {
    const t = team({
      teamKey: "frc12",
      teamNumber: 12,
      rank: 12,
      champLock: verdict({ status: "locked", pointsToLock: 0 }),
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    const statusCell = await screen.findByTestId("district-champ-lock-status");
    expect(statusCell.querySelector(".lock-status-chip--locked")).not.toBeNull();
  });

  it("contending and unknown stay plain text — no chip class on either", async () => {
    const contendingTeam = team({ teamKey: "frc13", teamNumber: 13, rank: 13, champLock: verdict({ status: "contending" }) });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([contendingTeam])} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    const statusCell = await screen.findByTestId("district-champ-lock-status");
    expect(statusCell.querySelector(".lock-status-chip")).toBeNull();
  });

  it("special-cased allocationNote (2025fsc) overrides the points-still-needed cell, even for an unknown-status verdict", async () => {
    const t = team({
      teamKey: "frc14",
      teamNumber: 14,
      rank: 14,
      champLock: verdict({ status: "unknown", pointsToLock: null, allocationNote: "special allocation, not modeled" }),
    });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    expect((await screen.findByTestId("district-champ-lock-status")).textContent).toBe("Capacity not published");
    expect(screen.getByTestId("district-champ-lock-points-to-lock").textContent).toBe("special allocation, not modeled");
  });

  it("the Champ Locks header shows 'Remaining district points: X / Y per team' with X the roster max of maxRemainingChamp and Y the per-team season ceiling (2 events + DCMP at 3x = 415)", async () => {
    const t1 = team({ teamKey: "frc16", teamNumber: 16, rank: 16, maxRemainingChamp: 332 });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t1])} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    const stat = await screen.findByTestId("champ-locks-remaining-district-points");
    expect(stat.textContent).toBe("332 / 415 per team");
  });

  it("the Champ Locks header reads '0 / 415 per team' once every team is done (matches the user-approved preview)", async () => {
    const t1 = team({ teamKey: "frc21", teamNumber: 21, rank: 21, maxRemainingChamp: 0 });
    render(
      <TestHarness>
        <DistrictLocksTab artifact={makeArtifact([t1])} algorithm="spr" season={2026} />
      </TestHarness>,
    );
    const stat = await screen.findByTestId("champ-locks-remaining-district-points");
    expect(stat.textContent).toBe("0 / 415 per team");
  });

  describe("one merged header card", () => {
    it("the Champ Locks tab renders exactly one non-table header card, with capacity/Lock Line/remaining-district-points in one stat row and no schedule strip", async () => {
      const t = team({ teamKey: "frc41", teamNumber: 41, rank: 1, maxRemainingChamp: 100 });
      render(
        <TestHarness>
          <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
        </TestHarness>,
      );
      const root = await screen.findByTestId("district-champ-locks-tab");
      const nonTableCards = [...root.querySelectorAll(".data-card")].filter((card) => card.querySelector("table") === null);
      expect(nonTableCards).toHaveLength(1);
      const headerCard = nonTableCards[0] as HTMLElement;
      expect(headerCard.getAttribute("data-testid")).toBe("champ-locks-header-stats");

      const statRow = headerCard.querySelector('[data-testid="champ-locks-header-stat-row"]') as HTMLElement;
      expect(statRow).not.toBeNull();
      expect(within(statRow).getByText("FIRST Championship capacity")).toBeDefined();
      expect(within(statRow).getByText("Lock Line")).toBeDefined();
      expect(statRow.querySelector('[data-testid="champ-locks-remaining-district-points"]')).not.toBeNull();

      expect(headerCard.querySelector('[data-testid="district-locks-schedule-strip"]')).toBeNull();
    });
  });

  describe("revision R3: per-event column toggle", () => {
    it("is collapsed by default — no Rookie Bonus, Adjustments or event columns visible", async () => {
      const t = team({
        teamKey: "frc30",
        teamNumber: 30,
        rank: 1,
        rookieBonus: 20,
        adjustments: -5,
        eventPoints: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", qual: 40, alliance: 20, elim: 0, award: 0, total: 60 }],
      });
      render(
        <TestHarness>
          <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
        </TestHarness>,
      );
      await screen.findByTestId("district-champ-lock-status");
      expect(screen.queryByText("Rookie Bonus")).toBeNull();
      expect(screen.queryByText("Event A")).toBeNull();
      expect(screen.queryByTestId("district-champ-lock-rookie-bonus")).toBeNull();
    });

    it("clicking the toggle reveals Rookie Bonus, Adjustments, and one 4-column band per played event, in chronological (week) order", async () => {
      const t = team({
        teamKey: "frc31",
        teamNumber: 31,
        rank: 1,
        rookieBonus: 20,
        adjustments: -5,
        eventPoints: [
          { eventKey: "eventB", eventName: "Event B", week: 5, tier: "district", qual: 22, alliance: 16, elim: 30, award: 0, total: 68 },
          { eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", qual: 40, alliance: 20, elim: 0, award: 10, total: 70 },
        ],
      });
      render(
        <TestHarness>
          <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
        </TestHarness>,
      );
      await screen.findByTestId("district-champ-lock-status");
      const toggle = screen.getByTestId("district-champ-locks-column-toggle");
      fireEvent.click(toggle);

      expect(screen.getByText("Rookie Bonus")).toBeDefined();
      expect(screen.getByTestId("district-champ-lock-rookie-bonus").textContent).toBe("20");
      expect(screen.getByTestId("district-champ-lock-adjustments").textContent).toBe("-5");

      // Chronological order — Event A (week 1) before Event B (week 5),
      // regardless of the team's own `eventPoints` array order.
      const bandCells = screen.getAllByText(/^Event [AB]$/);
      expect(bandCells.map((cell) => cell.textContent)).toEqual(["Event A", "Event B"]);

      expect(screen.getByTestId("district-champ-lock-event-eventA-qual").textContent).toBe("40");
      expect(screen.getByTestId("district-champ-lock-event-eventA-alliance").textContent).toBe("20");
      expect(screen.getByTestId("district-champ-lock-event-eventA-elim").textContent).toBe("0");
      expect(screen.getByTestId("district-champ-lock-event-eventA-award").textContent).toBe("10");
      expect(screen.getByTestId("district-champ-lock-event-eventB-qual").textContent).toBe("22");
    });

    it("a team that did not play a given event renders an em-dash across that event's four columns, never a fabricated zero", async () => {
      const played = team({
        teamKey: "frc32",
        teamNumber: 32,
        rank: 1,
        eventPoints: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", qual: 40, alliance: 20, elim: 0, award: 0, total: 60 }],
      });
      const absent = team({ teamKey: "frc33", teamNumber: 33, rank: 2, eventPoints: [] });
      render(
        <TestHarness>
          <DistrictLocksTab artifact={makeArtifact([played, absent])} algorithm="spr" season={2026} />
        </TestHarness>,
      );
      await screen.findAllByTestId("district-champ-lock-status");
      fireEvent.click(screen.getByTestId("district-champ-locks-column-toggle"));

      // Rows render in rank order (played=rank 1, absent=rank 2), so the
      // second `eventA` qual cell belongs to the team that never played it.
      const qualCells = screen.getAllByTestId("district-champ-lock-event-eventA-qual");
      expect(qualCells[0]?.textContent).toBe("40");
      expect(qualCells[1]?.textContent).toBe("—");
    });

    it("shows the same expanded columns on the Champ Locks tab, independently toggled", async () => {
      const t = team({
        teamKey: "frc34",
        teamNumber: 34,
        rank: 1,
        rookieBonus: 5,
        adjustments: 0,
        eventPoints: [{ eventKey: "eventC", eventName: "Event C", week: 2, tier: "dcmp", qual: 10, alliance: 5, elim: 15, award: 0, total: 30 }],
      });
      render(
        <TestHarness>
          <DistrictLocksTab artifact={makeArtifact([t])} algorithm="spr" season={2026} />
        </TestHarness>,
      );
      await screen.findByTestId("district-champ-lock-status");
      fireEvent.click(screen.getByTestId("district-champ-locks-column-toggle"));
      expect(screen.getByTestId("district-champ-lock-event-eventC-elim").textContent).toBe("15");
    });
  });
});
