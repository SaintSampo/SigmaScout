import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The Simulation tab's shared hand-written `EventArtifact` fixture builders
 * — originally authored inline in `SimulationTab.test.tsx` (08-09), moved
 * here verbatim by 08-15-PLAN.md Task 3 so `SimulationTab.failure.test.tsx`
 * can import the SAME builders rather than authoring a second,
 * independently-drifting fixture (that plan's own action text forbids
 * exactly that). This is a plain source module, never a `.test.ts` file —
 * importing a `.test.tsx` file from another test file would re-execute its
 * module-scope `describe(...)` registrations and `vi.stubGlobal(...)` calls
 * as part of the IMPORTING file's own run, which is precisely the drift this
 * extraction avoids.
 *
 * Every fixture here is a HAND-WRITTEN `EventArtifact`-shaped object literal
 * — the adversarial shapes both suites need (qm rows with no pmfs, pmfs on
 * one array only, a pmf on a playoff row only) exist in no single real
 * artifact. `packages/harness/pageArtifacts.ts` is read-only here — this
 * module never imports its schema, only its inferred `EventArtifact` type.
 */

const BASE_PREAMBLE = {
  schemaVersion: 1,
  generation: "gen-1",
  computedAt: "2026-08-31T00:00:00.000Z",
  algorithmId: "vpr",
  algorithmVersion: "2.1.0+tuned-2026-08",
};

export function baseArtifact(overrides: Partial<EventArtifact> = {}): EventArtifact {
  return {
    ...BASE_PREAMBLE,
    eventKey: "2024test",
    season: 2024,
    matches: [],
    upcoming: [],
    teams: [],
    ...overrides,
  } as EventArtifact;
}

export function playedQualRow(overrides: Record<string, unknown> = {}) {
  return {
    matchKey: "2024test_qm1",
    compLevel: "qm" as const,
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc1"],
    blueTeams: ["frc2"],
    predictedWinner: "red" as const,
    pRedWin: 0.6,
    predictedRedScore: 100,
    predictedBlueScore: 90,
    actualWinner: "red" as const,
    actualRedScore: 105,
    actualBlueScore: 88,
    ...overrides,
  };
}

export function upcomingQualRow(overrides: Record<string, unknown> = {}) {
  return {
    matchKey: "2024test_qm2",
    compLevel: "qm" as const,
    setNumber: 1,
    matchNumber: 2,
    redTeams: ["frc1"],
    blueTeams: ["frc2"],
    predictedWinner: "red" as const,
    pRedWin: 0.6,
    predictedRedScore: 100,
    predictedBlueScore: 90,
    ...overrides,
  };
}

export const BOTH_PMFS = { redRpPmf: [0.2, 0.3, 0.5], blueRpPmf: [0.4, 0.3, 0.3] };
