/**
 * The artifact to eligibility input conversion (quick task 261014-i8i).
 * Synthetic, parsed through the real `DistrictArtifactSchema`.
 */
import { describe, expect, it } from "vitest";
import { ZERO_AWARD_PROFILE, type DistrictAwardProfile } from "../core/districts/ledgerSimulation.js";
import { dcmpEligibilityTeamsFromArtifact, districtEventWeeksFromArtifact } from "./districtDcmpAwardInputs.js";
import { DistrictArtifactSchema, type DistrictArtifact } from "./pageArtifacts.js";

type DistrictTeam = DistrictArtifact["teams"][number];
type EventPoints = DistrictTeam["eventPoints"][number];

const STATE = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
const OPEN = { qualMatchesPlayed: 0, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false };

function played(eventKey: string, tier: "district" | "dcmp" = "district"): EventPoints {
  return { eventKey, eventName: `Event ${eventKey}`, week: 1, tier, qual: 10, alliance: 6, elim: 7, award: 0, total: 23, state: STATE };
}

function team(overrides: Partial<DistrictTeam> & { teamKey: string }): DistrictTeam {
  return {
    teamNumber: Number(overrides.teamKey.replace("frc", "")),
    nickname: `Nickname ${overrides.teamKey}`,
    rank: 1,
    pointTotal: 60,
    rookieBonus: 0,
    adjustments: 0,
    eventPoints: [],
    remainingEvents: [],
    maxRemainingDistrict: 0,
    maxRemainingChamp: 0,
    qualifyingAwards: [],
    districtLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 20, allocationNote: null },
    champLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 40, allocationNote: null },
    ...overrides,
  };
}

function artifactOf(teams: DistrictTeam[]): DistrictArtifact {
  return DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    districtKey: "2026pnw",
    year: 2026,
    abbreviation: "pnw",
    displayName: "Pacific Northwest",
    dcmpSlots: 50,
    cmpSlots: 12,
    teams,
    insights: {
      teamCount: teams.length,
      eventCount: 2,
      dcmpCutLinePoints: 40,
      cmpCutLinePoints: 80,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
  });
}

describe("dcmpEligibilityTeamsFromArtifact", () => {
  const artifact = artifactOf([
    team({
      teamKey: "frc1",
      awardProfile: { bucket: "threeOrMore", rookie: false },
      eventPoints: [played("2026wabon"), played("2026pncmp", "dcmp")],
      remainingEvents: [
        // A district event both played and remaining appears once.
        { eventKey: "2026wabon", eventName: "Bon", week: 1, tier: "district", maxPoints: 0, state: STATE },
        { eventKey: "2026wasno", eventName: "Sno", week: 2, tier: "district", maxPoints: 83, state: OPEN },
        // A DCMP tier remaining entry must not appear.
        { eventKey: "2026pncmp2", eventName: "Cmp 2", week: 6, tier: "dcmp", maxPoints: 249, state: OPEN },
      ],
      qualifyingAwards: [
        { eventKey: "2026wabon", awardType: 0, label: "Impact", awardOnly: false },
        { eventKey: "2026pncmp", awardType: 9, label: "EI", awardOnly: false },
      ],
    }),
    team({ teamKey: "frc2", awardProfile: { bucket: "none", rookie: true }, eventPoints: [played("2026wabon")] }),
  ]);

  const profileOf = (entry: DistrictTeam): DistrictAwardProfile =>
    entry.awardProfile === undefined ? ZERO_AWARD_PROFILE : { bucket: "none", rookieState: entry.awardProfile.rookie ? "rookie" : "veteran" };

  it("converts teams in artifact order, keeping every held award and only district tier events", () => {
    expect(dcmpEligibilityTeamsFromArtifact(artifact, profileOf)).toEqual([
      {
        teamKey: "frc1",
        rookie: false,
        heldAwards: [
          { eventKey: "2026wabon", awardType: 0 },
          { eventKey: "2026pncmp", awardType: 9 },
        ],
        districtEventKeys: ["2026wabon", "2026wasno"],
      },
      { teamKey: "frc2", rookie: true, heldAwards: [], districtEventKeys: ["2026wabon"] },
    ]);
  });
});

describe("districtEventWeeksFromArtifact (quick task 261014-qje, Q-05)", () => {
  const artifact = artifactOf([
    team({
      teamKey: "frc1",
      eventPoints: [played("2026wabon"), { ...played("2026pncmp", "dcmp"), week: 5 }],
      remainingEvents: [
        { eventKey: "2026wasno", eventName: "Sno", week: 2, tier: "district", maxPoints: 83, state: OPEN },
        { eventKey: "2026wanul", eventName: "Null week", week: null, tier: "district", maxPoints: 83, state: OPEN },
      ],
    }),
    // A later team's different week for an event already met never overrides the first row.
    team({ teamKey: "frc2", eventPoints: [{ ...played("2026wabon"), week: 4 }] }),
  ]);

  it("maps every played and remaining event to its week, both tiers, null kept as null, the first row met winning", () => {
    expect(districtEventWeeksFromArtifact(artifact)).toEqual(
      new Map<string, number | null>([
        ["2026wabon", 1],
        ["2026pncmp", 5],
        ["2026wasno", 2],
        ["2026wanul", null],
      ])
    );
  });
});
