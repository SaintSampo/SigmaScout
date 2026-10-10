/**
 * The Champ Locks tab's pure row model.
 *
 * Synthetic fixtures parsed through the REAL `DistrictArtifactSchema`, plus one
 * pass over `data/fixtures/phase10/district-2026pnw.json` — the same finished
 * district sketch 022 was drawn against.
 *
 * THE FIXTURE CARRIES NO `state` BLOCKS. Every test that needs a finished
 * position supplies an explicit all-final `stageByEvent` for all nine event
 * keys; `deriveStageFromState(undefined)` reports every category OPEN, by
 * design, and that is what the fixture reads as at "now".
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  DistrictArtifactSchema,
  EventArtifactSchema,
  type DistrictArtifact,
  type DistrictEventState,
} from "../../../../../packages/harness/pageArtifacts.js";
import { simulateDistrictEvent } from "../../../../../packages/core/districts/ledgerSimulation.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import { pointQuantile } from "../../../../../packages/core/districts/pointSummary.js";
import {
  DISTRICT_CATEGORIES,
  buildDistrictEventSimulationInput,
  buildDistrictLedgerRows,
  districtCellId,
  distributionsFromResult,
  pointMassDistribution,
  type DistrictCellKind,
  type DistrictEventDistributions,
  type DistrictEventStage,
  type DistrictPointDistribution,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import {
  CHAMP_LEDGER_ROWS,
  buildChampLedgerRows,
  earnedAtPositionOf,
  champCellId,
  champCellNamesOutcomes,
  champContributions,
  champDcmpStageSource,
  champFieldMembership,
  champFieldProofAtNow,
  champTeamHiddenAtDcmp,
  dcmpEventKeyFor,
  dcmpStartedForTeam,
  fieldFixingDcmpKeys,
  mixFieldMembership,
  type ChampLedgerCell,
  type ChampLedgerSource,
  type ChampLedgerTeam,
} from "./champLedgerRows.js";

/**
 * A PASS THROUGH SPY on the one function `buildChampLedgerRows` calls once per
 * tier (quick task 261009-vp9). It runs the real builder and changes no
 * result: it only lets one test read what each tier pass was handed.
 */
vi.mock("./districtLedgerRows.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./districtLedgerRows.js")>();
  return { ...original, buildDistrictLedgerRows: vi.fn(original.buildDistrictLedgerRows) };
});

type DistrictTeam = DistrictArtifact["teams"][number];
type EventPoints = DistrictTeam["eventPoints"][number];

const SEASON = 2026;

/**
 * The repo-relative fixture path, found by walking UP from the working
 * directory rather than off `import.meta.url` — under jsdom that URL is an
 * `http://` one and `readFileSync` refuses it. Walking up also survives being
 * run from the repo root (167 files) or from `apps/web` (77), which is a real
 * difference on this repo.
 */
function repoFile(relative: string): string {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not find ${relative} above ${process.cwd()}`);
    dir = parent;
  }
}

const FIXTURE: DistrictArtifact = DistrictArtifactSchema.parse(
  JSON.parse(readFileSync(repoFile("data/fixtures/phase10/district-2026pnw.json"), "utf8"))
);

const ALL_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };
const ALL_OPEN: DistrictStageFinality = { qual: false, alliance: false, elim: false, award: false };

/** Every event key in the fixture, across BOTH tiers — the champ tab's own event list. */
function allFixtureEventKeys(artifact: DistrictArtifact): string[] {
  const keys = new Set<string>();
  for (const team of artifact.teams) {
    for (const row of team.eventPoints) keys.add(row.eventKey);
    for (const row of team.remainingEvents) keys.add(row.eventKey);
  }
  return [...keys].sort();
}

function allFinalStages(artifact: DistrictArtifact): ReadonlyMap<string, DistrictStageFinality> {
  return new Map(allFixtureEventKeys(artifact).map((key) => [key, ALL_FINAL] as const));
}

// ---------------------------------------------------------------------------
// Synthetic artifact helpers — the same shapes `districtLedgerRows.test.ts`
// builds, so both suites describe one published artifact shape.
// ---------------------------------------------------------------------------

function state(overrides: Partial<DistrictEventState> = {}): DistrictEventState {
  return { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true, ...overrides };
}

function eventPoints(overrides: Partial<EventPoints> & { eventKey: string }): EventPoints {
  return {
    eventName: `Event ${overrides.eventKey}`,
    week: 1,
    tier: "district",
    qual: 10,
    alliance: 6,
    elim: 7,
    award: 0,
    total: 23,
    state: state(),
    ...overrides,
  };
}

function team(overrides: Partial<DistrictTeam> & { teamKey: string }): DistrictTeam {
  return {
    teamNumber: Number(overrides.teamKey.replace("frc", "")),
    nickname: `Nickname ${overrides.teamKey}`,
    rank: 1,
    pointTotal: 23,
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

function artifactOf(teams: DistrictTeam[], overrides: Partial<DistrictArtifact> = {}): DistrictArtifact {
  return DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    districtKey: "2026pnw",
    year: SEASON,
    abbreviation: "pnw",
    displayName: "Pacific Northwest",
    dcmpSlots: 50,
    cmpSlots: 12,
    teams,
    insights: {
      teamCount: teams.length,
      eventCount: 8,
      dcmpCutLinePoints: 40,
      cmpCutLinePoints: 80,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
    ...overrides,
  });
}

/** A uniform distribution over `0..points`, as one event's per-category draw. */
function uniform(points: number, draws = 100): DistrictPointDistribution {
  const counts = new Float64Array(points + 1);
  const share = draws / (points + 1);
  for (let i = 0; i <= points; i++) counts[i] = share;
  return { counts, denominator: draws };
}

/** One event's distributions for one team, over whichever cells are supplied. */
function distributionsFor(
  eventKey: string,
  byTeam: Record<string, Partial<Record<DistrictCellKind, DistrictPointDistribution>>>
): DistrictEventDistributions {
  const map = new Map<string, Readonly<Record<DistrictCellKind, DistrictPointDistribution | undefined>>>();
  for (const [teamKey, cells] of Object.entries(byTeam)) {
    map.set(teamKey, {
      qual: cells.qual,
      alliance: cells.alliance,
      elim: cells.elim,
      award: cells.award,
      eventTotal: cells.eventTotal,
      grandTotal: undefined,
    });
  }
  return { eventKey: eventKey, byTeam: map };
}

function cellOf(cells: readonly ChampLedgerCell[], category: (typeof DISTRICT_CATEGORIES)[number]): ChampLedgerCell {
  return cells[DISTRICT_CATEGORIES.indexOf(category)]!;
}

function probabilityAt(distribution: DistrictPointDistribution, points: number): number {
  return (distribution.counts[points] ?? 0) / distribution.denominator;
}

// ---------------------------------------------------------------------------

describe("champCellId", () => {
  it("names the row and the cell, disjoint from the district tab's eventKey:cell ids", () => {
    expect(champCellId("district", "qual")).toBe("district-row:qual");
    expect(champCellId("dcmp", "elim")).toBe("dcmp-row:elim");
    expect(champCellId("district", "eventTotal")).toBe("district-row:eventTotal");
    expect(champCellId("dcmp", "eventTotal")).toBe("dcmp-row:eventTotal");
    // A district-tab id can never collide: an event key is never "district-row".
    for (const cell of ["qual", "alliance", "elim", "award", "eventTotal"] as const) {
      expect(champCellId("district", cell)).not.toBe(districtCellId("2026wabon", cell));
      expect(champCellId("dcmp", cell)).not.toBe(districtCellId("2026pncmp", cell));
    }
  });
});

describe("dcmpEventKeyFor", () => {
  it("finds the fixture's single dcmp-tier event key", () => {
    expect(dcmpEventKeyFor(FIXTURE)).toBe("2026pncmp");
  });

  it("is undefined for a district publishing no dcmp-tier event", () => {
    const artifact = artifactOf([team({ teamKey: "frc1", eventPoints: [eventPoints({ eventKey: "2026wabon" })] })]);
    expect(dcmpEventKeyFor(artifact)).toBeUndefined();
  });
});

describe("champFieldMembership", () => {
  it("is open for every team before the DCMP starts, even one already listed in the field", () => {
    const inField = FIXTURE.teams.find((t) => t.eventPoints.some((row) => row.tier === "dcmp"))!;
    const outOfField = FIXTURE.teams.find((t) => !t.eventPoints.some((row) => row.tier === "dcmp"))!;
    expect(champFieldMembership(inField, false)).toBe("open");
    expect(champFieldMembership(outOfField, false)).toBe("open");
  });

  it("splits the fixture 51 in and 75 out once the DCMP has started, and reads open for all 126 before", () => {
    const started = FIXTURE.teams.map((t) => champFieldMembership(t, true));
    expect(started.filter((m) => m === "in")).toHaveLength(51);
    expect(started.filter((m) => m === "out")).toHaveLength(75);
    const before = FIXTURE.teams.map((t) => champFieldMembership(t, false));
    expect(before).toHaveLength(126);
    expect(before.every((m) => m === "open")).toBe(true);
  });
});

describe("mixFieldMembership", () => {
  const total = pointMassDistribution(40);

  it("returns the total unchanged at a chance of one", () => {
    expect(mixFieldMembership(total, 1)).toBe(total);
    expect(mixFieldMembership(total, 1.5)).toBe(total);
  });

  it("returns a point mass at zero at a chance of zero", () => {
    const mixed = mixFieldMembership(total, 0);
    expect(probabilityAt(mixed, 0)).toBe(1);
    expect(mixed.counts.length).toBe(1);
  });

  it("puts exactly half the mass at zero at a chance of one half", () => {
    const mixed = mixFieldMembership(total, 0.5);
    expect(probabilityAt(mixed, 0)).toBeCloseTo(0.5, 12);
    expect(probabilityAt(mixed, 40)).toBeCloseTo(0.5, 12);
  });

  it("normalises a multi-draw histogram onto a denominator of one", () => {
    const mixed = mixFieldMembership(uniform(3, 400), 0.5);
    let sum = 0;
    for (let i = 0; i < mixed.counts.length; i++) sum += mixed.counts[i]!;
    expect(sum / mixed.denominator).toBeCloseTo(1, 12);
    // Half the mass at zero plus the quarter the uniform already held there.
    expect(probabilityAt(mixed, 0)).toBeCloseTo(0.5 + 0.125, 12);
  });
});

describe("buildChampLedgerRows — the District points row", () => {
  const twoEvents = () =>
    team({
      teamKey: "frc1",
      pointTotal: 46,
      eventPoints: [
        eventPoints({ eventKey: "2026wabon", week: 0, qual: 10, alliance: 6, elim: 7, award: 0, total: 23 }),
        eventPoints({ eventKey: "2026wasam", week: 2, qual: 12, alliance: 4, elim: 0, award: 5, total: 21 }),
      ],
    });

  it("is grey only when the category is final at EVERY district-tier event the team has", () => {
    const artifact = artifactOf([twoEvents()]);
    const bothFinal = buildChampLedgerRows({
      artifact,
      distributions: new Map(),
      stageByEvent: new Map([
        ["2026wabon", ALL_FINAL],
        ["2026wasam", ALL_FINAL],
      ]),
    });
    const qual = cellOf(bothFinal.teams[0]!.districtRow.cells, "qual");
    expect(qual.kind).toBe("final");
    if (qual.kind === "final") expect(qual.earned).toBe(22);

    const oneOpen = buildChampLedgerRows({
      artifact,
      distributions: new Map([["2026wasam", distributionsFor("2026wasam", { frc1: { qual: uniform(4) } })]]),
      stageByEvent: new Map([
        ["2026wabon", ALL_FINAL],
        ["2026wasam", { ...ALL_FINAL, qual: false }],
      ]),
    });
    expect(cellOf(oneOpen.teams[0]!.districtRow.cells, "qual").kind).toBe("open");
  });

  it("convolves the earned event with the open one, so the support starts at the earned value", () => {
    const artifact = artifactOf([twoEvents()]);
    const built = buildChampLedgerRows({
      artifact,
      distributions: new Map([["2026wasam", distributionsFor("2026wasam", { frc1: { qual: uniform(4) } })]]),
      stageByEvent: new Map([
        ["2026wabon", ALL_FINAL],
        ["2026wasam", { ...ALL_FINAL, qual: false }],
      ]),
    });
    const qual = cellOf(built.teams[0]!.districtRow.cells, "qual");
    expect(qual.kind).toBe("open");
    if (qual.kind !== "open") return;
    // 10 earned at Bonney Lake, 0..4 uniform at Sammamish.
    for (let k = 0; k <= 4; k++) expect(probabilityAt(qual.distribution, 10 + k)).toBeCloseTo(0.2, 12);
    expect(probabilityAt(qual.distribution, 9)).toBe(0);
    expect(probabilityAt(qual.distribution, 15)).toBe(0);
    // The ceiling is the per-event maximum times the team's event count, never a literal.
    expect(qual.ceiling).toBe(maxEventPoints(SEASON, "district").qual * 2);
  });

  it("names every district-tier event as a source, in week order", () => {
    const built = buildChampLedgerRows({
      artifact: artifactOf([twoEvents()]),
      distributions: new Map(),
      stageByEvent: new Map([
        ["2026wabon", ALL_FINAL],
        ["2026wasam", ALL_FINAL],
      ]),
    });
    expect(built.teams[0]!.districtRow.sources.map((s) => s.eventKey)).toEqual(["2026wabon", "2026wasam"]);
    expect(built.teams[0]!.districtRow.sources.map((s) => s.week)).toEqual([0, 2]);
  });

  it("makes the aggregate unavailable when any one event's cell is unavailable", () => {
    const built = buildChampLedgerRows({
      artifact: artifactOf([twoEvents()]),
      distributions: new Map(),
      stageByEvent: new Map([
        ["2026wabon", ALL_FINAL],
        ["2026wasam", { ...ALL_FINAL, elim: false }],
      ]),
    });
    expect(cellOf(built.teams[0]!.districtRow.cells, "elim").kind).toBe("unavailable");
    expect(built.teams[0]!.districtRow.subtotal.kind).toBe("unavailable");
  });
});

describe("buildChampLedgerRows — the fixture at an all-final position", () => {
  const built = buildChampLedgerRows({
    artifact: FIXTURE,
    distributions: new Map(),
    stageByEvent: allFinalStages(FIXTURE),
    dcmpStarted: true,
  });
  const byTeam = new Map(built.teams.map((t) => [t.teamKey, t] as const));
  const sourceByKey = new Map(FIXTURE.teams.map((t) => [t.teamKey, t] as const));

  it("builds two rows for all 126 teams, in the fixed order", () => {
    expect(built.teams).toHaveLength(126);
    for (const entry of built.teams) {
      expect(entry.rows.map((row) => row.kind)).toEqual([...CHAMP_LEDGER_ROWS]);
    }
  });

  it("splits the field 51 in and 75 out, with the em-dash cell for every team outside it", () => {
    const outs = built.teams.filter((t) => t.membership === "out");
    expect(built.teams.filter((t) => t.membership === "in")).toHaveLength(51);
    expect(outs).toHaveLength(75);
    for (const entry of outs) {
      expect(entry.dcmpRow.cells.every((cell) => cell.kind === "notInField")).toBe(true);
      expect(entry.dcmpRow.subtotal.kind).toBe("notInField");
    }
  });

  it("sums each row's four categories to that row's own subtotal", () => {
    for (const entry of built.teams) {
      for (const row of entry.rows) {
        if (row.subtotal.kind !== "final") continue;
        let sum = 0;
        for (const cell of row.cells) if (cell.kind === "final") sum += cell.earned;
        expect(sum).toBe(row.subtotal.earned);
      }
    }
  });

  it("reproduces every team's published pointTotal as the grand total, rookie bonus included", () => {
    for (const entry of built.teams) {
      const source = sourceByKey.get(entry.teamKey)!;
      expect(entry.grandTotal.kind).toBe("final");
      if (entry.grandTotal.kind !== "final") continue;
      expect(entry.grandTotal.earned).toBe(source.pointTotal);
      expect(entry.projection).toBe(source.pointTotal);
      expect(entry.hasOpenCategory).toBe(false);
    }
  });

  it("sorts descending by projection and numbers the positions from one", () => {
    expect(built.teams.map((t) => t.position)).toEqual(built.teams.map((_unused, i) => i + 1));
    for (let i = 1; i < built.teams.length; i++) {
      expect(built.teams[i - 1]!.projection).toBeGreaterThanOrEqual(built.teams[i]!.projection);
    }
  });

  it("discloses no missing field chance, because the field is settled", () => {
    expect(built.gaps.teamsWithoutFieldChance).toEqual([]);
  });

  it("lists two contribution rows whose earned values add to the grand total less the rookie bonus", () => {
    const entry = byTeam.get(built.teams[0]!.teamKey)!;
    const contributions = champContributions(entry);
    expect(contributions.map((c) => c.row)).toEqual([...CHAMP_LEDGER_ROWS]);
    const source = sourceByKey.get(entry.teamKey)!;
    const summed = contributions.reduce((acc, c) => acc + (c.earned ?? 0), 0);
    expect(summed + source.rookieBonus + source.adjustments).toBe(source.pointTotal);
  });
});

describe("champTeamHiddenAtDcmp — the table omits a team with no dcmp-tier row once the DCMP is selected (261007-mxf)", () => {
  const built = buildChampLedgerRows({
    artifact: FIXTURE,
    distributions: new Map(),
    stageByEvent: allFinalStages(FIXTURE),
    dcmpStarted: true,
  });

  it("hides exactly the membership out teams on the all-final fixture, and nobody while the DCMP is not selected", () => {
    const hidden = built.teams.filter((entry) => champTeamHiddenAtDcmp(entry, true)).map((entry) => entry.teamKey);
    const out = built.teams.filter((entry) => entry.membership === "out").map((entry) => entry.teamKey);
    expect(hidden).toEqual(out);
    expect(hidden).toHaveLength(75);
    expect(built.teams.filter((entry) => champTeamHiddenAtDcmp(entry, false))).toHaveLength(0);
  });

  it("is true only when the DCMP is selected AND the team's DCMP row has no source", () => {
    const withSource = built.teams.find((entry) => entry.membership === "in")!;
    const withoutSource = built.teams.find((entry) => entry.membership === "out")!;
    expect(withSource.dcmpRow.sources.length).toBeGreaterThan(0);
    expect(withoutSource.dcmpRow.sources).toHaveLength(0);
    expect(champTeamHiddenAtDcmp(withSource, true)).toBe(false);
    expect(champTeamHiddenAtDcmp(withSource, false)).toBe(false);
    expect(champTeamHiddenAtDcmp(withoutSource, true)).toBe(true);
    expect(champTeamHiddenAtDcmp(withoutSource, false)).toBe(false);
  });

  it("never hides a judging only registrant: a dcmp-tier row with no qualification schedule reads in", () => {
    const judgingOnly = artifactOf([
      team({
        teamKey: "frc7",
        pointTotal: 23,
        eventPoints: [eventPoints({ eventKey: "2026wabon", week: 0 })],
        remainingEvents: [{ eventKey: "2026pncmp", eventName: "PNW DCMP", week: 5, tier: "dcmp", maxPoints: 249, state: state({ qualMatchesPlayed: 0, qualMatchesTotal: 0, alliancesPicked: false, playoffsDone: false, awardsPosted: false }) }],
      }),
      team({ teamKey: "frc8", pointTotal: 23, eventPoints: [eventPoints({ eventKey: "2026wabon", week: 0 })] }),
    ]);
    const rows = buildChampLedgerRows({ artifact: judgingOnly, distributions: new Map(), dcmpStarted: true });
    const byKey = new Map(rows.teams.map((entry) => [entry.teamKey, entry] as const));
    expect(byKey.get("frc7")!.membership).toBe("in");
    expect(champTeamHiddenAtDcmp(byKey.get("frc7")!, true)).toBe(false);
    expect(byKey.get("frc8")!.membership).toBe("out");
    expect(champTeamHiddenAtDcmp(byKey.get("frc8")!, true)).toBe(true);
  });
});

describe("buildChampLedgerRows — the fixture before the DCMP starts", () => {
  it("reads every team as open and discloses every team with no supplied field chance", () => {
    const built = buildChampLedgerRows({
      artifact: FIXTURE,
      distributions: new Map(),
      stageByEvent: new Map(allFixtureEventKeys(FIXTURE).map((key) => [key, key === "2026pncmp" ? ALL_OPEN : ALL_FINAL] as const)),
    });
    expect(built.teams.every((t) => t.membership === "open")).toBe(true);
    expect(built.gaps.teamsWithoutFieldChance).toHaveLength(126);
  });
});

describe("buildChampLedgerRows — the variant-A mixture", () => {
  /** A bubble team: a finished district season and an open DCMP it may or may not reach. */
  function bubble(chance: number | undefined): ChampLedgerTeam {
    const subject = team({
      teamKey: "frc1",
      pointTotal: 60,
      eventPoints: [
        eventPoints({ eventKey: "2026wabon", week: 0, qual: 30, alliance: 10, elim: 20, award: 0, total: 60 }),
        eventPoints({ eventKey: "2026pncmp", week: 5, tier: "dcmp", qual: 0, alliance: 0, elim: 0, award: 0, total: 0 }),
      ],
    });
    const built = buildChampLedgerRows({
      artifact: artifactOf([subject]),
      distributions: new Map([
        [
          "2026pncmp",
          distributionsFor("2026pncmp", {
            frc1: { qual: uniform(20), alliance: uniform(10), elim: uniform(20), award: uniform(10), eventTotal: uniform(60) },
          }),
        ],
      ]),
      stageByEvent: new Map([
        ["2026wabon", ALL_FINAL],
        ["2026pncmp", ALL_OPEN],
      ]),
      dcmpStarted: false,
      ...(chance === undefined ? {} : { fieldChanceByTeam: new Map([["frc1", chance]]) }),
    });
    return built.teams[0]!;
  }

  it("prints the DCMP cells unconditionally — variant A folds the chance into the grand total alone", () => {
    const half = bubble(0.5);
    const certain = bubble(1);
    for (const category of DISTRICT_CATEGORIES) {
      const a = cellOf(half.dcmpRow.cells, category);
      const b = cellOf(certain.dcmpRow.cells, category);
      expect(a.kind).toBe("open");
      if (a.kind !== "open" || b.kind !== "open") continue;
      expect(Array.from(a.distribution.counts)).toEqual(Array.from(b.distribution.counts));
    }
  });

  it("puts the mixture's median between the district-only and the fully folded grand totals", () => {
    const none = bubble(0);
    const half = bubble(0.5);
    const all = bubble(1);
    expect(none.projection).toBeLessThan(half.projection);
    expect(half.projection).toBeLessThan(all.projection);
    // At a chance of zero the grand total is exactly the district points.
    expect(none.projection).toBeCloseTo(60, 6);
  });

  it("carries the field chance on the DCMP contribution row and nowhere else", () => {
    const contributions = champContributions(bubble(0.62));
    expect(contributions[0]!.fieldChance).toBeUndefined();
    expect(contributions[1]!.fieldChance).toBeCloseTo(0.62, 12);
    expect(contributions[1]!.open).toBeDefined();
  });

  it("treats an absent chance as one and DISCLOSES it, never as a silent zero", () => {
    const missing = bubble(undefined);
    const all = bubble(1);
    expect(missing.projection).toBe(all.projection);
    expect(missing.fieldChance).toBeUndefined();
  });

  it("agrees with a hand-rolled mixture of the two certain grand totals", () => {
    const all = bubble(1);
    const half = bubble(0.5);
    expect(all.grandTotal.kind).toBe("open");
    expect(half.grandTotal.kind).toBe("open");
    if (all.grandTotal.kind !== "open" || half.grandTotal.kind !== "open") return;
    const folded = all.grandTotal.distribution;
    const counts = new Float64Array(folded.counts.length);
    for (let i = 0; i < folded.counts.length; i++) counts[i] = 0.5 * (folded.counts[i]! / folded.denominator);
    counts[60]! += 0.5;
    expect(pointQuantile(counts, 0.5, 1)).toBeCloseTo(half.projection, 9);
  });
});

/**
 * THE PRE-REGISTRATION WINDOW, which is most of a district season.
 *
 * `scripts/publishDistricts.ts` builds `remainingEvents` from TBA
 * registrations and a team registers for its District Championship only after
 * it has qualified, so until then NO team carries a dcmp-tier row, the tab has
 * no event key to fetch and no sidecar to read, and the DCMP cannot be priced
 * for anybody. This module's first answer was to refuse the grand total in that
 * case, which would have blanked every grand total in the district for the
 * whole season; it now prints the district-only figure and LABELS it.
 */
describe("buildChampLedgerRows — a district publishing no DCMP", () => {
  function builtWithNoDcmp() {
    return buildChampLedgerRows({
      artifact: artifactOf([team({ teamKey: "frc1", pointTotal: 23, eventPoints: [eventPoints({ eventKey: "2026wabon" })] })]),
      distributions: new Map(),
      stageByEvent: new Map([["2026wabon", ALL_FINAL]]),
    });
  }

  it("reads the whole DCMP row as NOT YET PRICED, which is a different statement from unavailable", () => {
    const built = builtWithNoDcmp();
    const entry = built.teams[0]!;
    expect(built.dcmpEventKey).toBeUndefined();
    expect(entry.dcmpRow.cells.every((cell) => cell.kind === "notYetPriced")).toBe(true);
    expect(entry.dcmpRow.subtotal.kind).toBe("notYetPriced");
    // `unavailable` still means "a prediction was attempted and refused", and
    // nothing here attempted one.
    expect(entry.dcmpRow.cells.some((cell) => cell.kind === "unavailable")).toBe(false);
  });

  it("prints the DISTRICT-ONLY grand total, labelled, rather than refusing one", () => {
    const built = builtWithNoDcmp();
    const entry = built.teams[0]!;
    expect(entry.grandTotal.kind).toBe("final");
    if (entry.grandTotal.kind !== "final") return;
    // The district row's own earned subtotal, nothing added and nothing missing.
    expect(entry.grandTotal.earned).toBe(23);
    expect(entry.projection).toBe(23);
    expect(entry.grandTotalIsDistrictOnly).toBe(true);
    // DISCLOSED as district-only, and NOT as a refusal: the chance run reads
    // the second list to decide whether it may run at all, and a team in the
    // first would be dropped from the ranking instead.
    expect(built.gaps.teamsWithDistrictOnlyGrandTotal).toEqual(["frc1"]);
    expect(built.gaps.teamsWithUnavailableGrandTotal).toEqual([]);
  });

  it("names the DCMP contribution as not yet priced rather than as settled", () => {
    const contributions = champContributions(builtWithNoDcmp().teams[0]!);
    const dcmp = contributions.find((entry) => entry.row === "dcmp")!;
    expect(dcmp.notYetPriced).toBe(true);
    expect(dcmp.earned).toBeUndefined();
    expect(dcmp.open).toBeUndefined();
    expect(contributions.find((entry) => entry.row === "district")!.notYetPriced).toBe(false);
  });
});

/**
 * FIELD MEMBERSHIP AT "NOW" VERSUS REWOUND (2026-09-26).
 *
 * A dcmp-tier row on the artifact is a REGISTRATION, and TBA lists one only
 * after the invitation — so at the live position it is a qualification and the
 * team is in the field. At a rewound position the same row is future knowledge
 * and the question is open again, which is the whole point of the slider.
 */
describe("champFieldMembership — the three positions the field can be read at", () => {
  const registered = team({
    teamKey: "frc1",
    eventPoints: [eventPoints({ eventKey: "2026wabon" })],
    remainingEvents: [{ eventKey: "2026pncmp", eventName: "PNW District Championship", week: 6, tier: "dcmp", maxPoints: 249, state: undefined }],
  });
  const unregistered = team({ teamKey: "frc2", eventPoints: [eventPoints({ eventKey: "2026wabon" })] });

  it("reads a LIVE registered team as IN the field", () => {
    expect(champFieldMembership(registered, false, true)).toBe("in");
  });

  it("reads a LIVE unregistered team as OPEN, never as out — registrations arrive in batches", () => {
    expect(champFieldMembership(unregistered, false, true)).toBe("open");
  });

  it("reads a REWOUND registered team as OPEN, because the registration is future knowledge there", () => {
    expect(champFieldMembership(registered, false, false)).toBe("open");
  });

  it("still reads the started DCMP as a settled fact, both ways round", () => {
    expect(champFieldMembership(registered, true, true)).toBe("in");
    expect(champFieldMembership(registered, true, false)).toBe("in");
    expect(champFieldMembership(unregistered, true, true)).toBe("out");
  });
});

// ---------------------------------------------------------------------------
// Quick task 260927-6bf: the walk-forward DCMP estimate
// ---------------------------------------------------------------------------

describe("buildChampLedgerRows — a rewound position before the DCMP, with estimates", () => {
  // Both teams REGISTERED for the DCMP (a dcmp tier row), with a priced DCMP
  // event: at a rewound position that registration is future knowledge.
  const artifact = artifactOf([
    team({
      teamKey: "frc1",
      pointTotal: 60,
      eventPoints: [eventPoints({ eventKey: "2026wabon", week: 0, total: 60, qual: 30, alliance: 10, elim: 20, award: 0 })],
      remainingEvents: [{ eventKey: "2026pncmp", eventName: "PNW DCMP", week: 5, tier: "dcmp", maxPoints: 249, state: state({ qualMatchesPlayed: 0, alliancesPicked: false, playoffsDone: false, awardsPosted: false }) }],
    }),
    team({
      teamKey: "frc2",
      pointTotal: 40,
      eventPoints: [eventPoints({ eventKey: "2026wabon", week: 0, total: 40, qual: 20, alliance: 10, elim: 10, award: 0 })],
      remainingEvents: [{ eventKey: "2026pncmp", eventName: "PNW DCMP", week: 5, tier: "dcmp", maxPoints: 249, state: state({ qualMatchesPlayed: 0, alliancesPicked: false, playoffsDone: false, awardsPosted: false }) }],
    }),
  ]);
  const stageByEvent = new Map<string, DistrictStageFinality>([
    ["2026wabon", ALL_FINAL],
    ["2026pncmp", ALL_OPEN],
  ]);
  // The REAL roster's pricing: a leak if it ever reaches a rewound row.
  const realRoster = new Map([
    ["2026pncmp", distributionsFor("2026pncmp", { frc1: { qual: uniform(60), alliance: uniform(40), elim: uniform(90), award: uniform(30), eventTotal: uniform(200) }, frc2: { qual: uniform(60), alliance: uniform(40), elim: uniform(90), award: uniform(30), eventTotal: uniform(200) } })],
  ]);
  const estimate = { distribution: { counts: Float64Array.from([0, 0, 0, 0, 0, 1, 1]), denominator: 2 }, winChance: 0.25 };
  const dcmpEstimateByTeam = new Map([
    ["frc1", estimate],
    ["frc2", estimate],
  ]);
  const rows = buildChampLedgerRows({
    artifact,
    distributions: realRoster,
    stageByEvent,
    fieldChanceByTeam: new Map([
      ["frc1", 1],
      ["frc2", 0.5],
    ]),
    dcmpStarted: false,
    atLivePosition: false,
    dcmpEstimateByTeam,
  });
  const byKey = new Map(rows.teams.map((entry) => [entry.teamKey, entry] as const));

  it("prices every non out team from the estimate, never from the real roster", () => {
    for (const entry of rows.teams) {
      expect(entry.membership).toBe("open");
      expect(entry.dcmpRow.estimated).toBe(true);
      for (const cell of entry.dcmpRow.cells) expect(cell.kind).toBe("notYetPriced");
      expect(entry.dcmpRow.subtotal.kind).toBe("open");
      if (entry.dcmpRow.subtotal.kind === "open") expect(entry.dcmpRow.subtotal.distribution).toBe(estimate.distribution);
    }
  });

  it("keeps the dcmp pass's own sources, so the status floors and ceilings are untouched", () => {
    expect(byKey.get("frc1")!.dcmpRow.sources.map((source) => source.eventKey)).toEqual(["2026pncmp"]);
  });

  it("counts the open DCMP subtotal: a chance 1 team whose district is final still has an open category", () => {
    const top = byKey.get("frc1")!;
    expect(top.districtRow.subtotal.kind).toBe("final");
    expect(top.hasOpenCategory).toBe(true);
    expect(top.grandTotal.kind).toBe("open");
  });

  it("adds nobody to the district only list", () => {
    expect(rows.gaps.teamsWithDistrictOnlyGrandTotal).toEqual([]);
    expect(rows.teams.every((entry) => !entry.grandTotalIsDistrictOnly)).toBe(true);
  });

  it("exposes the split parts the champ run draws: the district part and the DCMP part with its chances", () => {
    const top = byKey.get("frc1")!;
    expect(probabilityAt(top.districtPart!, 60)).toBe(1);
    expect(top.dcmpPart).toEqual({ distribution: estimate.distribution, fieldChance: 1, winChance: 0.25 });
    expect(byKey.get("frc2")!.dcmpPart!.fieldChance).toBe(0.5);
  });

  it("without an estimate map keeps the shipped rule: the priced championship row is read", () => {
    const shipped = buildChampLedgerRows({ artifact, distributions: realRoster, stageByEvent, dcmpStarted: false, atLivePosition: false });
    for (const entry of shipped.teams) {
      expect(entry.dcmpRow.estimated).toBe(false);
      expect(entry.dcmpRow.cells.every((cell) => cell.kind === "open")).toBe(true);
    }
  });

  it("at the live position reads a registered team's own event row, with its winner mass as the win chance", () => {
    const live = buildChampLedgerRows({ artifact, distributions: realRoster, dcmpStarted: false, atLivePosition: true, dcmpEstimateByTeam });
    const top = live.teams.find((entry) => entry.teamKey === "frc1")!;
    expect(top.membership).toBe("in");
    expect(top.dcmpRow.estimated).toBe(false);
    const winner = maxEventPoints(SEASON, "dcmp").elim;
    expect(top.dcmpPart!.winChance).toBeCloseTo(1 / 91, 12);
    expect(winner).toBe(90);
  });

  it("estimates an unregistered open team at the live position", () => {
    const openArtifact = artifactOf([
      team({ teamKey: "frc3", pointTotal: 30, eventPoints: [eventPoints({ eventKey: "2026wabon", week: 0, total: 30 })] }),
    ]);
    const live = buildChampLedgerRows({
      artifact: openArtifact,
      distributions: new Map(),
      dcmpStarted: false,
      atLivePosition: true,
      fieldChanceByTeam: new Map([["frc3", 0.4]]),
      dcmpEstimateByTeam: new Map([["frc3", estimate]]),
    });
    expect(live.teams[0]!.dcmpRow.estimated).toBe(true);
    expect(live.gaps.teamsWithDistrictOnlyGrandTotal).toEqual([]);
  });
});

describe("buildChampLedgerRows — a rewound position before the DCMP, with the simulated DCMP (261007-mxf)", () => {
  // Three teams REGISTERED for the DCMP, with a priced DCMP event and an
  // estimate both supplied: neither may reach a row while the simulated DCMP is.
  const dcmpRemaining = { eventKey: "2026pncmp", eventName: "PNW DCMP", week: 5, tier: "dcmp" as const, maxPoints: 249, state: state({ qualMatchesPlayed: 0, alliancesPicked: false, playoffsDone: false, awardsPosted: false }) };
  const artifact = artifactOf([
    team({ teamKey: "frc1", pointTotal: 60, eventPoints: [eventPoints({ eventKey: "2026wabon", week: 0, total: 60, qual: 30, alliance: 10, elim: 20, award: 0 })], remainingEvents: [dcmpRemaining] }),
    team({ teamKey: "frc2", pointTotal: 40, eventPoints: [eventPoints({ eventKey: "2026wabon", week: 0, total: 40, qual: 20, alliance: 10, elim: 10, award: 0 })], remainingEvents: [dcmpRemaining] }),
    team({ teamKey: "frc3", pointTotal: 10, eventPoints: [eventPoints({ eventKey: "2026wabon", week: 0, total: 10, qual: 5, alliance: 0, elim: 5, award: 0 })], remainingEvents: [dcmpRemaining] }),
  ]);
  const stageByEvent = new Map<string, DistrictStageFinality>([
    ["2026wabon", ALL_FINAL],
    ["2026pncmp", ALL_OPEN],
  ]);
  const realRoster = new Map([
    ["2026pncmp", distributionsFor("2026pncmp", { frc1: { qual: uniform(60), alliance: uniform(40), elim: uniform(90), award: uniform(30), eventTotal: uniform(200) } })],
  ]);
  const estimate = { distribution: { counts: Float64Array.from([0, 0, 0, 0, 0, 1, 1]), denominator: 2 }, winChance: 0.25 };
  const dcmpEstimateByTeam = new Map(["frc1", "frc2", "frc3"].map((teamKey) => [teamKey, estimate] as const));
  // The BAKE: its own record for frc1, distinct objects from the real roster's.
  const baked = distributionsFor("2026pncmp", { frc1: { qual: uniform(30), alliance: uniform(20), elim: uniform(90), award: uniform(15), eventTotal: uniform(150) } });
  const lockedOut = new Set(["frc3"]);
  const readyField = { status: "ready" as const, roster: ["frc1"], outOfRange: new Set(["frc2"]), lockedOut };
  const readyBake = { status: "ready" as const, distributions: baked };
  const dcmpCeilings = maxEventPoints(SEASON, "dcmp");
  const dcmpEventTotalCeiling = dcmpCeilings.qual + dcmpCeilings.alliance + dcmpCeilings.elim + dcmpCeilings.award;

  const build = (simulatedDcmp: Parameters<typeof buildChampLedgerRows>[0]["simulatedDcmp"]) => {
    const rows = buildChampLedgerRows({
      artifact,
      distributions: realRoster,
      stageByEvent,
      fieldChanceByTeam: new Map([
        ["frc1", 0.75],
        ["frc2", 0.2],
        ["frc3", 0],
      ]),
      dcmpStarted: false,
      atLivePosition: false,
      dcmpEstimateByTeam,
      ...(simulatedDcmp === undefined ? {} : { simulatedDcmp }),
    });
    return { rows, byKey: new Map(rows.teams.map((entry) => [entry.teamKey, entry] as const)) };
  };

  const { rows, byKey } = build({ field: readyField, bake: readyBake });

  it("gives a team in the simulated field four open cells and an open Subtotal from the bake, never the estimate or the real roster", () => {
    const top = byKey.get("frc1")!;
    const record = baked.byTeam.get("frc1")!;
    expect(top.dcmpRow.estimated).toBe(false);
    DISTRICT_CATEGORIES.forEach((category, index) => {
      const cell = top.dcmpRow.cells[index]!;
      expect(cell.id).toBe(champCellId("dcmp", category));
      expect(cell.kind).toBe("open");
      if (cell.kind !== "open") return;
      expect(cell.distribution).toBe(record[category]);
      expect(cell.ceiling).toBe(dcmpCeilings[category]);
    });
    const subtotal = top.dcmpRow.subtotal;
    expect(subtotal.kind).toBe("open");
    if (subtotal.kind === "open") {
      expect(subtotal.distribution).toBe(record.eventTotal);
      expect(subtotal.ceiling).toBe(dcmpEventTotalCeiling);
    }
    expect(top.dcmpRow.sources.map((source) => source.eventKey)).toEqual(["2026pncmp"]);
    expect(top.grandTotalIsDistrictOnly).toBe(false);
    expect(top.grandTotal.kind).toBe("open");
  });

  it("carries the team's supplied field chance and the Playoffs mass at the winner value into the DCMP part", () => {
    const top = byKey.get("frc1")!;
    expect(top.dcmpPart).toEqual({ distribution: baked.byTeam.get("frc1")!.eventTotal, fieldChance: 0.75, winChance: probabilityAt(uniform(90), dcmpCeilings.elim) });
    expect(top.dcmpPart!.winChance).toBeCloseTo(1 / 91, 12);
  });

  it("reads an Out of range team out of range in all five cells, with a labelled district only total that never joins the gap", () => {
    const outside = byKey.get("frc2")!;
    for (const cell of [...outside.dcmpRow.cells, outside.dcmpRow.subtotal]) expect(cell.kind).toBe("outOfRange");
    expect(outside.dcmpRow.estimated).toBe(false);
    expect(outside.dcmpPart).toBeUndefined();
    expect(outside.grandTotalIsDistrictOnly).toBe(true);
    expect(outside.grandTotal).toMatchObject({ kind: "final", earned: 40 });
    expect(probabilityAt(outside.districtPart!, 40)).toBe(1);
    expect(outside.hasOpenCategory).toBe(false);
  });

  it("reads a Locked out team as the em dash in all five cells, with the same labelled district only total", () => {
    const out = byKey.get("frc3")!;
    for (const cell of [...out.dcmpRow.cells, out.dcmpRow.subtotal]) expect(cell.kind).toBe("notInField");
    expect(out.dcmpPart).toBeUndefined();
    expect(out.grandTotalIsDistrictOnly).toBe(true);
    expect(out.grandTotal).toMatchObject({ kind: "final", earned: 10 });
  });

  it("names nobody in the district only gap, so the champ run still runs", () => {
    expect(rows.gaps.teamsWithDistrictOnlyGrandTotal).toEqual([]);
  });

  it("reads pending cells and a pending grand total while the field or the bake is pending, the Locked out em dash at once", () => {
    for (const pricing of [
      { field: { status: "pending" as const, lockedOut }, bake: { status: "pending" as const } },
      { field: readyField, bake: { status: "pending" as const } },
    ]) {
      const { byKey: pending } = build(pricing);
      for (const teamKey of pricing.field.status === "pending" ? ["frc1", "frc2"] : ["frc1"]) {
        const entry = pending.get(teamKey)!;
        for (const cell of [...entry.dcmpRow.cells, entry.dcmpRow.subtotal]) expect(cell).toMatchObject({ kind: "unavailable", pending: true });
        expect(entry.grandTotal).toMatchObject({ kind: "unavailable", pending: true });
        expect(entry.dcmpRow.estimated).toBe(false);
      }
      for (const cell of [...pending.get("frc3")!.dcmpRow.cells, pending.get("frc3")!.dcmpRow.subtotal]) expect(cell.kind).toBe("notInField");
    }
  });

  it("reads plain not available for a refused field, a failed bake and a roster team the bake has no record for", () => {
    const missingRecord = { field: { ...readyField, roster: ["frc1", "frc2"], outOfRange: new Set<string>() }, bake: readyBake };
    const cases = [
      { pricing: { field: { status: "refused" as const, lockedOut }, bake: readyBake }, teams: ["frc1", "frc2"] },
      { pricing: { field: readyField, bake: { status: "unavailable" as const } }, teams: ["frc1"] },
      { pricing: missingRecord, teams: ["frc2"] },
    ];
    for (const { pricing, teams } of cases) {
      const { byKey: refused } = build(pricing);
      for (const teamKey of teams) {
        const entry = refused.get(teamKey)!;
        for (const cell of [...entry.dcmpRow.cells, entry.dcmpRow.subtotal]) {
          expect(cell.kind).toBe("unavailable");
          expect(cell.kind === "unavailable" && cell.pending).toBeFalsy();
        }
        expect(entry.grandTotal.kind).toBe("unavailable");
        expect(entry.grandTotal.kind === "unavailable" && entry.grandTotal.pending).toBeFalsy();
        expect(entry.dcmpRow.estimated).toBe(false);
      }
    }
  });

  it("reads a record missing a distribution as not available rather than a partial row", () => {
    const partial = distributionsFor("2026pncmp", { frc1: { qual: uniform(30), alliance: uniform(20), elim: uniform(90), eventTotal: uniform(150) } });
    const { byKey: built } = build({ field: readyField, bake: { status: "ready", distributions: partial } });
    for (const cell of [...built.get("frc1")!.dcmpRow.cells, built.get("frc1")!.dcmpRow.subtotal]) expect(cell.kind).toBe("unavailable");
  });

  it("never reads the estimate for a team whose field is not a fact while the simulated DCMP is supplied", () => {
    for (const entry of rows.teams) expect(entry.dcmpRow.estimated).toBe(false);
  });

  it("without the option keeps the shipped estimate reading byte for byte", () => {
    const shipped = buildChampLedgerRows({
      artifact,
      distributions: realRoster,
      stageByEvent,
      fieldChanceByTeam: new Map([
        ["frc1", 0.75],
        ["frc2", 0.2],
        ["frc3", 0],
      ]),
      dcmpStarted: false,
      atLivePosition: false,
      dcmpEstimateByTeam,
    });
    expect(build(undefined).rows).toEqual(shipped);
    for (const entry of shipped.teams) expect(entry.dcmpRow.estimated).toBe(true);
  });
});

describe("ChampLedgerTeam.earnedAtPosition — the rewound header (finding 4)", () => {
  // One team that played a district event (qual 20, alliance 10, elim 10,
  // award 5) and then the DCMP (qual 30, alliance 15, elim 0, award 0), with a
  // rookie bonus of 8 and an adjustment of 2: pointTotal 100.
  const artifact = artifactOf([
    team({
      teamKey: "frc1",
      pointTotal: 100,
      rookieBonus: 8,
      adjustments: 2,
      eventPoints: [
        eventPoints({ eventKey: "2026wabon", week: 0, qual: 20, alliance: 10, elim: 10, award: 5, total: 45 }),
        eventPoints({ eventKey: "2026pncmp", week: 5, tier: "dcmp", qual: 30, alliance: 15, elim: 0, award: 0, total: 45 }),
      ],
    }),
  ]);
  const at = (stageByEvent: ReadonlyMap<string, DistrictStageFinality> | undefined) =>
    buildChampLedgerRows({ artifact, distributions: new Map(), ...(stageByEvent === undefined ? {} : { stageByEvent }), fieldChanceByTeam: new Map([["frc1", 1]]) })
      .teams[0]!;

  it("equals pointTotal at now, exactly as the header printed before", () => {
    expect(at(undefined).earnedAtPosition).toBe(100);
    expect(earnedAtPositionOf(artifact.teams[0]!, undefined)).toBe(100);
  });

  it("excludes the DCMP points a team earned later, at a rewound position before the DCMP", () => {
    const beforeDcmp = new Map<string, DistrictStageFinality>([
      ["2026wabon", ALL_FINAL],
      ["2026pncmp", ALL_OPEN],
    ]);
    expect(at(beforeDcmp).earnedAtPosition).toBe(55);
    expect(at(beforeDcmp).earnedAllTierTotal).toBe(100);
  });

  it("is the rookie bonus plus the adjustments at season start", () => {
    const seasonStart = new Map<string, DistrictStageFinality>([
      ["2026wabon", ALL_OPEN],
      ["2026pncmp", ALL_OPEN],
    ]);
    expect(at(seasonStart).earnedAtPosition).toBe(10);
  });

  it("subtracts only the categories still open: mid playoffs keeps qual and alliance", () => {
    const midPlayoffs = new Map<string, DistrictStageFinality>([
      ["2026wabon", { qual: true, alliance: true, elim: false, award: false }],
      ["2026pncmp", ALL_OPEN],
    ]);
    expect(at(midPlayoffs).earnedAtPosition).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// A registered DCMP no show, priced from awards alone (quick task 260927-vmb)
// ---------------------------------------------------------------------------

describe("buildChampLedgerRows — a registered DCMP no show is priced from awards alone", () => {
  const DCMP = "2026pncmp";
  const NO_SHOW = "frc2635";
  const ROSTER = Array.from({ length: 24 }, (_unused, i) => `frc${String(1001 + i)}`);
  const RP_PMF = [0.2, 0.3, 0.3, 0.2];
  const dcmpState = state({ qualMatchesPlayed: 6, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false });

  const districtTeam = (teamKey: string, points: number): DistrictTeam =>
    team({
      teamKey,
      pointTotal: points,
      eventPoints: [eventPoints({ eventKey: "2026wabon", week: 1, qual: points, alliance: 0, elim: 0, award: 0, total: points })],
      remainingEvents: [{ eventKey: DCMP, eventName: "PNW DCMP", week: 6, tier: "dcmp", maxPoints: 249, state: dcmpState }],
    });

  const artifact = artifactOf([...ROSTER.map((teamKey, i) => districtTeam(teamKey, 40 - i)), districtTeam(NO_SHOW, 30)]);

  const row = (m: number, played: boolean) => {
    const red = [ROSTER[(m * 6) % 24]!, ROSTER[(m * 6 + 1) % 24]!, ROSTER[(m * 6 + 2) % 24]!];
    const blue = [ROSTER[(m * 6 + 3) % 24]!, ROSTER[(m * 6 + 4) % 24]!, ROSTER[(m * 6 + 5) % 24]!];
    const base = {
      matchKey: `${DCMP}_qm${String(m + 1)}`,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: m + 1,
      sortTime: 1_760_000_000 + m * 600,
      redTeams: red,
      blueTeams: blue,
      predictedWinner: "red",
      pRedWin: 0.55,
      predictedRedScore: 90,
      predictedBlueScore: 85,
      redRpPmf: RP_PMF,
      blueRpPmf: RP_PMF,
    };
    return played
      ? { ...base, actualWinner: "red", actualRedScore: 95, actualBlueScore: 80, actualRedRp: 3, actualBlueRp: 1 }
      : base;
  };
  const eventArtifact = EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "7.0.0+rolling",
    eventKey: DCMP,
    season: SEASON,
    matches: Array.from({ length: 6 }, (_unused, m) => row(m, true)),
    upcoming: Array.from({ length: 6 }, (_unused, m) => row(m + 6, false)),
    teams: ROSTER.map((teamKey, i) => ({
      teamKey,
      teamNumber: Number(teamKey.replace("frc", "")),
      rank: i + 1,
      record: { wins: 3, losses: 3, ties: 0 },
      rp: 2 + (24 - i) / 24,
      metrics: { total: { value: 60 + (24 - i) }, sigma: { value: 8 } },
    })),
  });

  const built = buildDistrictEventSimulationInput({
    eventKey: DCMP,
    season: SEASON,
    eventArtifact,
    districtArtifact: artifact,
    stage: ALL_OPEN,
    startMatchKey: `${DCMP}_qm7`,
    tier: "dcmp",
  });
  if (!built.ok) throw new Error("fixture: the DCMP input did not build");
  const draws = 400;
  const result = simulateDistrictEvent(built.input, draws, 7);
  const rows = buildChampLedgerRows({
    artifact,
    distributions: new Map([[DCMP, distributionsFromResult(result)]]),
    dcmpStarted: true,
    atLivePosition: true,
    // A walk forward estimate the no show must NOT read: its own event row is priced.
    dcmpEstimateByTeam: new Map([[NO_SHOW, { distribution: { counts: Float64Array.from([0, 0, 1]), denominator: 1 }, winChance: 0.5 }]]),
  });
  const noShow = rows.teams.find((entry) => entry.teamKey === NO_SHOW)!;

  it("puts exactly the registered team missing from the schedule in the award only list", () => {
    expect(built.input.awardOnlyTeams).toEqual([NO_SHOW]);
    expect(built.input.awardProfiles.has(NO_SHOW)).toBe(true);
  });

  it("reads the event's own row: three grey zeros and an open Awards cell equal to the run's award draw", () => {
    expect(noShow.membership).toBe("in");
    expect(noShow.dcmpRow.estimated).toBe(false);
    for (const category of ["qual", "alliance", "elim"] as const) {
      const cell = cellOf(noShow.dcmpRow.cells, category);
      expect(cell.kind, category).toBe("final");
      if (cell.kind === "final") expect(cell.earned, category).toBe(0);
    }
    const award = cellOf(noShow.dcmpRow.cells, "award");
    expect(award.kind).toBe("open");
    if (award.kind !== "open") return;
    expect(Array.from(award.distribution.counts)).toEqual([...result.awardPoints.get(NO_SHOW)!]);
    expect(award.distribution.denominator).toBe(draws);
  });

  it("gives an open Subtotal whose mass equals the award mass at every point value, and carries it into dcmpPart with win chance 0", () => {
    const subtotal = noShow.dcmpRow.subtotal;
    expect(subtotal.kind).toBe("open");
    if (subtotal.kind !== "open") return;
    const award = result.awardPoints.get(NO_SHOW)!;
    const length = Math.max(subtotal.distribution.counts.length, award.length);
    for (let points = 0; points < length; points++) {
      expect(probabilityAt(subtotal.distribution, points), `points ${String(points)}`).toBeCloseTo((award[points] ?? 0) / draws, 12);
    }
    expect(noShow.dcmpPart).toBeDefined();
    expect(noShow.dcmpPart!.distribution).toBe(subtotal.distribution);
    expect(noShow.dcmpPart!.winChance).toBe(0);
    expect(noShow.grandTotal.kind).not.toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
// LOADING CELLS READ PENDING (todo locks-loading-cells-read-not-available,
// quick task 261007-4qr): the champ fold and grand total carry the district
// passes' pending flag through, and only through pending parts.
// ---------------------------------------------------------------------------

describe("buildChampLedgerRows — distributionsPending (261007-4qr)", () => {
  const openState = state({ qualMatchesPlayed: 10, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
  const isPending = (cell: ChampLedgerCell): boolean => cell.kind === "unavailable" && "pending" in cell && cell.pending === true;
  const isPlain = (cell: ChampLedgerCell): boolean => cell.kind === "unavailable" && !("pending" in cell);

  function openTeam(eventKeys: readonly string[], overrides: Partial<DistrictTeam> = {}) {
    return team({ teamKey: "frc1", pointTotal: 0, eventPoints: eventKeys.map((eventKey) => eventPoints({ eventKey, state: openState })), ...overrides });
  }

  it("folds a district subtotal from pending parts only into a pending subtotal, and the grand total it lacks is pending", () => {
    const built = buildChampLedgerRows({
      artifact: artifactOf([openTeam(["2026walive", "2026wapend"])]),
      distributions: new Map(),
      distributionsPending: true,
    });
    const entry = built.teams[0]!;
    expect(entry.districtRow.cells.every(isPending)).toBe(true);
    expect(isPending(entry.districtRow.subtotal)).toBe(true);
    expect(isPending(entry.grandTotal)).toBe(true);
  });

  it("makes the fold and the grand total plain unavailable when one part was refused", () => {
    const built = buildChampLedgerRows({
      artifact: artifactOf([openTeam(["2026walive", "2026warefused"])]),
      distributions: new Map(),
      distributionsPending: true,
      unavailableEvents: [{ eventKey: "2026warefused", name: "UnratedTeamError" }],
    });
    const entry = built.teams[0]!;
    expect(entry.districtRow.cells.every(isPlain)).toBe(true);
    expect(isPlain(entry.districtRow.subtotal)).toBe(true);
    expect(isPlain(entry.grandTotal)).toBe(true);
  });

  it("leaves an all-final fold and an open fold unchanged while pending", () => {
    const artifact = artifactOf([
      team({
        teamKey: "frc1",
        pointTotal: 46,
        eventPoints: [
          eventPoints({ eventKey: "2026wabon", week: 0, qual: 10, alliance: 6, elim: 7, award: 0, total: 23 }),
          eventPoints({ eventKey: "2026wasam", week: 2, qual: 12, alliance: 4, elim: 0, award: 5, total: 21 }),
        ],
      }),
    ]);
    const finalStages = new Map([
      ["2026wabon", ALL_FINAL],
      ["2026wasam", ALL_FINAL],
    ]);
    const allFinal = { artifact, distributions: new Map(), stageByEvent: finalStages };
    expect(buildChampLedgerRows({ ...allFinal, distributionsPending: true })).toEqual(buildChampLedgerRows(allFinal));

    const oneOpen = {
      artifact,
      // Nothing is missing at this position (the event total is in hand too), so the flag has nothing to mark.
      distributions: new Map([["2026wasam", distributionsFor("2026wasam", { frc1: { qual: uniform(4), eventTotal: uniform(30) } })]]),
      stageByEvent: new Map([
        ["2026wabon", ALL_FINAL],
        ["2026wasam", { qual: false, alliance: true, elim: true, award: true }],
      ]),
    };
    const pendingOpen = buildChampLedgerRows({ ...oneOpen, distributionsPending: true });
    expect(cellOf(pendingOpen.teams[0]!.districtRow.cells, "qual").kind).toBe("open");
    expect(pendingOpen).toEqual(buildChampLedgerRows(oneOpen));
  });

  it("keeps the catch path plain unavailable while pending", () => {
    const built = buildChampLedgerRows({
      artifact: artifactOf([team({ teamKey: "frc1", pointTotal: 20, adjustments: -5, eventPoints: [eventPoints({ eventKey: "2026wabon", total: 20 })] })]),
      distributions: new Map(),
      stageByEvent: new Map([["2026wabon", ALL_FINAL]]),
      distributionsPending: true,
    });
    expect(isPlain(built.teams[0]!.grandTotal)).toBe(true);
    expect(built.gaps.teamsWithUnavailableGrandTotal).toEqual(["frc1"]);
  });

  it("with the flag absent, deep equals the flag set to false on the district-2026pnw fixture", () => {
    for (const stageByEvent of [allFinalStages(FIXTURE), new Map(allFixtureEventKeys(FIXTURE).map((key) => [key, key === "2026pncmp" ? ALL_OPEN : ALL_FINAL] as const))]) {
      const today = buildChampLedgerRows({ artifact: FIXTURE, distributions: new Map(), stageByEvent });
      expect(buildChampLedgerRows({ artifact: FIXTURE, distributions: new Map(), stageByEvent, distributionsPending: false })).toEqual(today);
      expect(JSON.stringify(today.teams)).not.toContain('"pending"');
    }
  });
});

describe("buildChampLedgerRows — every dcmp pass row is a DCMP source (261009-kt3, D3)", () => {
  const PARENT = "2026pncmp";
  const DIVISION = "2026pncmp1";
  const TEAM = "frc2046";
  const withFinalsRow: DistrictArtifact = DistrictArtifactSchema.parse({
    ...FIXTURE,
    teams: FIXTURE.teams.map((team) => {
      const relabel = <T extends { eventKey: string }>(row: T): T => (row.eventKey === PARENT ? { ...row, eventKey: DIVISION } : row);
      const eventPoints = team.eventPoints.map(relabel);
      if (team.teamKey !== TEAM) return { ...team, eventPoints, remainingEvents: team.remainingEvents.map(relabel) };
      const divisionRow = eventPoints.find((row) => row.eventKey === DIVISION)!;
      return { ...team, eventPoints: [...eventPoints, { ...divisionRow, eventKey: PARENT, qual: 0, alliance: 0, elim: 30, award: 30, total: 60 }] };
    }),
  });
  const withoutFinalsRow: DistrictArtifact = DistrictArtifactSchema.parse({
    ...withFinalsRow,
    teams: withFinalsRow.teams.map((team) => (team.teamKey === TEAM ? { ...team, eventPoints: team.eventPoints.filter((row) => row.eventKey !== PARENT) } : team)),
  });
  const allFinal = (artifact: DistrictArtifact) => new Map(allFixtureEventKeys(artifact).map((key) => [key, ALL_FINAL] as const));

  it("lists the division row then the finals row, in artifact order, and the DCMP row's cells are the division plus the finals (261009-tx8, B2)", () => {
    const rows = buildChampLedgerRows({ artifact: withFinalsRow, distributions: new Map(), stageByEvent: allFinal(withFinalsRow), dcmpStarted: true });
    const team = rows.teams.find((entry) => entry.teamKey === TEAM)!;
    expect(team.dcmpRow.sources.map((source) => source.eventKey)).toEqual([DIVISION, PARENT]);
    const baseline = buildChampLedgerRows({ artifact: withoutFinalsRow, distributions: new Map(), stageByEvent: allFinal(withoutFinalsRow), dcmpStarted: true });
    const baseTeam = baseline.teams.find((entry) => entry.teamKey === TEAM)!;
    // The fixture's finals row is 0, 0, 30, 30: Playoffs and Awards gain 30,
    // Qualification and Alliance selection are the division's own.
    const earnedOfCell = (cell: ChampLedgerCell): number => {
      if (cell.kind !== "final") throw new Error(`expected a final cell, got ${cell.kind}`);
      return cell.earned;
    };
    expect(cellOf(team.dcmpRow.cells, "qual")).toEqual(cellOf(baseTeam.dcmpRow.cells, "qual"));
    expect(cellOf(team.dcmpRow.cells, "alliance")).toEqual(cellOf(baseTeam.dcmpRow.cells, "alliance"));
    expect(earnedOfCell(cellOf(team.dcmpRow.cells, "elim"))).toBe(earnedOfCell(cellOf(baseTeam.dcmpRow.cells, "elim")) + 30);
    expect(earnedOfCell(cellOf(team.dcmpRow.cells, "award"))).toBe(earnedOfCell(cellOf(baseTeam.dcmpRow.cells, "award")) + 30);
    expect(team.dcmpRow.sources[0]).toEqual(baseTeam.dcmpRow.sources[0]);
  });

  describe("a team with no championship row leaves the field once every division has started (261009-pgq, D1)", () => {
    const rowless = withFinalsRow.teams.find((team) => team.eventPoints.every((row) => row.tier !== "dcmp") && team.remainingEvents.every((row) => row.tier !== "dcmp"))!;
    const inDivision = withFinalsRow.teams.find((team) => team.teamKey !== TEAM && team.eventPoints.some((row) => row.eventKey === DIVISION))!;
    const membershipAt = (teamKey: string, startedDcmpEventKeys: ReadonlySet<string>) =>
      buildChampLedgerRows({ artifact: withFinalsRow, distributions: new Map(), stageByEvent: allFinal(withFinalsRow), startedDcmpEventKeys }).teams.find((entry) => entry.teamKey === teamKey)!.membership;

    it("reads out with the division started and the finals key not, and open with nothing started", () => {
      expect(fieldFixingDcmpKeys([PARENT, DIVISION])).toEqual([DIVISION]);
      expect(membershipAt(rowless.teamKey, new Set([DIVISION]))).toBe("out");
      expect(membershipAt(rowless.teamKey, new Set())).toBe("open");
    });

    it("leaves a team with its own division row reading its own key", () => {
      expect(membershipAt(inDivision.teamKey, new Set([DIVISION]))).toBe("in");
      expect(membershipAt(inDivision.teamKey, new Set([PARENT]))).toBe("open");
    });
  });
});

describe("buildChampLedgerRows — a divisioned championship's DCMP row is the division plus the finals once earned (261009-tx8, B2)", () => {
  const PARENT = "2026pncmp";
  const DIVISION = "2026pncmp1";
  const TEAM = "frc2046";
  const DIVISION_ONLY_TEAM = FIXTURE.teams.find((team) => team.teamKey !== TEAM && team.eventPoints.some((row) => row.eventKey === PARENT))!.teamKey;
  type RowValues = { qual: number; alliance: number; elim: number; award: number; total: number };
  /** frc27 at 2026 FIM: its division row and its finals row, as the artifact publishes them. */
  const DIVISION_VALUES: RowValues = { qual: 66, alliance: 48, elim: 90, award: 0, total: 204 };
  const FINALS_VALUES: RowValues = { qual: 0, alliance: 0, elim: 60, award: 30, total: 90 };
  const FINALS_FIRST = "AAA Finals";
  const FINALS_LAST = "ZZZ Finals";

  /**
   * The pnw fixture with its championship relabelled as a division, and TEAM
   * given the frc27 values. `finalsName` decides which of TEAM's two dcmp rows
   * the pass sorts first (same week, so the event name breaks the tie), which
   * is the FIM order when it sorts before the division's name.
   */
  function divisioned(options: { finalsName?: string; finals?: RowValues | null; division?: boolean } = {}): DistrictArtifact {
    const { finalsName = FINALS_LAST, finals = FINALS_VALUES, division = true } = options;
    return DistrictArtifactSchema.parse({
      ...FIXTURE,
      teams: FIXTURE.teams.map((team) => {
        const relabel = <T extends { eventKey: string }>(row: T): T => (row.eventKey === PARENT ? { ...row, eventKey: DIVISION } : row);
        const eventPoints = team.eventPoints.map(relabel);
        if (team.teamKey !== TEAM) return { ...team, eventPoints, remainingEvents: team.remainingEvents.map(relabel) };
        const divisionRow = eventPoints.find((row) => row.eventKey === DIVISION)!;
        const others = eventPoints.filter((row) => row.eventKey !== DIVISION);
        return {
          ...team,
          eventPoints: [
            ...others,
            ...(division ? [{ ...divisionRow, ...DIVISION_VALUES }] : []),
            ...(finals === null ? [] : [{ ...divisionRow, eventKey: PARENT, eventName: finalsName, ...finals }]),
          ],
        };
      }),
    });
  }
  const stagesOf = (artifact: DistrictArtifact, overrides: Record<string, DistrictStageFinality> = {}) =>
    new Map(allFixtureEventKeys(artifact).map((key) => [key, overrides[key] ?? ALL_FINAL] as const));
  const teamIn = (artifact: DistrictArtifact, options: { stages?: Record<string, DistrictStageFinality>; distributions?: ReadonlyMap<string, DistrictEventDistributions> } = {}) =>
    buildChampLedgerRows({
      artifact,
      distributions: options.distributions ?? new Map(),
      stageByEvent: stagesOf(artifact, options.stages),
      dcmpStarted: true,
    }).teams.find((entry) => entry.teamKey === TEAM)!;
  const finalAt = (cell: ChampLedgerCell): number => {
    if (cell.kind !== "final") throw new Error(`expected a final cell, got ${cell.kind}`);
    return cell.earned;
  };
  const dcmpValues = (entry: ChampLedgerTeam): number[] => [...entry.dcmpRow.cells.map(finalAt), finalAt(entry.dcmpRow.subtotal)];

  it.each([
    ["before the division's (the FIM order)", FINALS_FIRST, [PARENT, DIVISION]],
    ["after the division's", FINALS_LAST, [DIVISION, PARENT]],
  ] as const)("reads 66, 48, 150, 30 and 294 with the finals row's name sorting %s", (_label, finalsName, sourceOrder) => {
    const entry = teamIn(divisioned({ finalsName }));
    // `sources` is every dcmp pass row in pass order, as it was (261009-kt3 D3).
    expect(entry.dcmpRow.sources.map((source) => source.eventKey)).toEqual(sourceOrder);
    expect(dcmpValues(entry)).toEqual([66, 48, 150, 30, 294]);
    const shift = Math.max(0, Math.round(FIXTURE.teams.find((team) => team.teamKey === TEAM)!.rookieBonus));
    expect(entry.grandTotal).toEqual({ id: "grand", cell: "grandTotal", kind: "final", earned: finalAt(entry.districtRow.subtotal) + 294 + shift });
    expect(entry.hasOpenCategory).toBe(false);
    // The Playoffs cell is final, so a posted winner is a fact and not a chance.
    expect(entry.dcmpPart?.winChance).toBe(0);
    expect(JSON.stringify(entry)).not.toContain("shiftedByFinals");
  });

  describe("a settled Playoffs value that is not exact (quick task 261010-66y, D6 and reading R16)", () => {
    const OPEN_PLAYOFFS: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
    /** One event priced for TEAM (its open Awards and its event total), with TEAM's alliance decided at `placement` there. */
    const decidedAt = (eventKey: string, placement: number): ReadonlyMap<string, DistrictEventDistributions> =>
      new Map([
        [
          eventKey,
          { ...distributionsFor(eventKey, { [TEAM]: { award: uniform(5), eventTotal: uniform(100) } }), playoffMilestoneByTeam: new Map([[TEAM, { kind: "decided" as const, placement }]]) },
        ],
      ]);

    it("the DCMP row's Playoffs cell carries upTo for a decided placement above zero, and keeps it when finals points are added", () => {
      // The division's Playoffs are open and TEAM's alliance is decided third (39 at a 2026 championship).
      const divisionOnly = teamIn(divisioned({ finals: null }), { stages: { [DIVISION]: OPEN_PLAYOFFS }, distributions: decidedAt(DIVISION, 3) });
      expect(cellOf(divisionOnly.dcmpRow.cells, "elim")).toEqual({ id: champCellId("dcmp", "elim"), cell: "elim", kind: "final", earned: 39, upTo: true });
      // With a finals row whose 60 is earned at the position, the cell is the sum and still reads "up to".
      const withFinals = teamIn(divisioned({ finalsName: FINALS_FIRST }), { stages: { [DIVISION]: OPEN_PLAYOFFS }, distributions: decidedAt(DIVISION, 3) });
      expect(cellOf(withFinals.dcmpRow.cells, "elim")).toEqual({ id: champCellId("dcmp", "elim"), cell: "elim", kind: "final", earned: 39 + 60, upTo: true });
    });

    it("a decided placement that pays nothing, and an exact value, carry no upTo key", () => {
      const fifth = teamIn(divisioned({ finals: null }), { stages: { [DIVISION]: OPEN_PLAYOFFS }, distributions: decidedAt(DIVISION, 5) });
      expect(cellOf(fifth.dcmpRow.cells, "elim")).toEqual({ id: champCellId("dcmp", "elim"), cell: "elim", kind: "final", earned: 0 });
      expect("upTo" in cellOf(fifth.dcmpRow.cells, "elim")).toBe(false);
      // Everything final: the artifact's own numbers, and no cell anywhere carries the key.
      expect(JSON.stringify(teamIn(divisioned()))).not.toContain("upTo");
    });

    it("the District points row's Playoffs cell that sums a final part and a part with upTo is final at the sum with upTo", () => {
      const source = FIXTURE.teams.find((team) => team.teamKey === TEAM)!;
      const districtRows = source.eventPoints.filter((row) => row.tier === "district");
      expect(districtRows.length).toBeGreaterThanOrEqual(2);
      const reopened = districtRows[0]!;
      const others = districtRows.slice(1).reduce((sum, row) => sum + row.elim, 0);
      // One district event's Playoffs are open with TEAM decided fourth there (7 at a 2026 district event); the others are final.
      const entry = teamIn(divisioned(), { stages: { [reopened.eventKey]: OPEN_PLAYOFFS }, distributions: decidedAt(reopened.eventKey, 4) });
      expect(cellOf(entry.districtRow.cells, "elim")).toEqual({ id: champCellId("district", "elim"), cell: "elim", kind: "final", earned: others + 7, upTo: true });
      // Every other category of that row folds final parts alone, and carries no key.
      for (const category of ["qual", "alliance"] as const) expect("upTo" in cellOf(entry.districtRow.cells, category)).toBe(false);
      // The Subtotal and the grand total sit above an open Awards category, so neither is a final cell.
      expect(entry.districtRow.subtotal.kind).not.toBe("final");
      expect(entry.grandTotal.kind).not.toBe("final");
      // A fold with no such part carries no key.
      expect("upTo" in cellOf(teamIn(divisioned()).districtRow.cells, "elim")).toBe(false);
    });
  });

  it("reads a team whose only dcmp row is the finals exactly as that one row", () => {
    const entry = teamIn(divisioned({ division: false }));
    expect(entry.dcmpRow.sources.map((source) => source.eventKey)).toEqual([PARENT]);
    expect(dcmpValues(entry)).toEqual([0, 0, 60, 30, 90]);
  });

  it("reads a team with only a division row exactly as that one row", () => {
    const entry = teamIn(divisioned({ finals: null }));
    expect(entry.dcmpRow.sources.map((source) => source.eventKey)).toEqual([DIVISION]);
    expect(dcmpValues(entry)).toEqual([66, 48, 90, 0, 204]);
    // And a team the fixture gave no finals row is untouched by TEAM's.
    const withFinals = buildChampLedgerRows({ artifact: divisioned(), distributions: new Map(), stageByEvent: stagesOf(divisioned()), dcmpStarted: true });
    const without = buildChampLedgerRows({ artifact: divisioned({ finals: null }), distributions: new Map(), stageByEvent: stagesOf(divisioned({ finals: null })), dcmpStarted: true });
    const pick = (rows: typeof withFinals) => rows.teams.find((entry) => entry.teamKey === DIVISION_ONLY_TEAM)!.dcmpRow;
    expect(pick(withFinals)).toEqual(pick(without));
  });

  it.each([
    ["first", FINALS_FIRST],
    ["last", FINALS_LAST],
  ] as const)("adds nothing for a finals category that is not final at the position (finals row sorted %s)", (_label, finalsName) => {
    const artifact = divisioned({ finalsName });
    const entry = teamIn(artifact, { stages: { [PARENT]: { qual: true, alliance: true, elim: true, award: false } } });
    // Awards is the division's own; Playoffs is the sum; the Subtotal is the
    // division total plus the one finals value that is earned.
    expect(entry.dcmpRow.cells.map(finalAt)).toEqual([66, 48, 150, 0]);
    expect(finalAt(entry.dcmpRow.subtotal)).toBe(204 + 60);
    // The finals can still pay, so nothing downstream settles early.
    expect(entry.hasOpenCategory).toBe(true);
    expect(entry.grandTotal.kind).toBe("open");
  });

  describe("an open division cell and a finals value already earned", () => {
    const divisionDistributions = {
      qual: uniform(10),
      alliance: uniform(8),
      elim: uniform(90),
      award: uniform(5),
      eventTotal: uniform(100),
    };
    const distributions = new Map([[DIVISION, distributionsFor(DIVISION, { [TEAM]: divisionDistributions })]]);
    const stages = { [DIVISION]: ALL_OPEN };
    const shifted = teamIn(divisioned({ finalsName: FINALS_FIRST }), { stages, distributions });
    const divisionOnly = teamIn(divisioned({ finals: null }), { stages, distributions });

    /** `after` is `before` moved up by `by` points, each read as a share of its own denominator. */
    function expectMovedUp(after: DistrictPointDistribution, before: DistrictPointDistribution, by: number): void {
      const length = Math.max(after.counts.length, before.counts.length + by);
      for (let points = 0; points < length; points++) {
        const expected = points < by ? 0 : probabilityAt(before, points - by);
        expect(probabilityAt(after, points), `at ${String(points)} points`).toBeCloseTo(expected, 12);
      }
    }

    it.each([
      ["elim", 60],
      ["award", 30],
    ] as const)("shifts the open %s cell up by the finals value into a plain open cell flagged shiftedByFinals", (category, by) => {
      const cell = cellOf(shifted.dcmpRow.cells, category);
      const own = cellOf(divisionOnly.dcmpRow.cells, category);
      if (cell.kind !== "open" || own.kind !== "open") throw new Error("expected two open cells");
      expect(cell.shiftedByFinals).toBe(true);
      expect(cell.id).toBe(champCellId("dcmp", category));
      expectMovedUp(cell.distribution, own.distribution, by);
      // No mass is left at zero, so the form rule gives the median form.
      expect(cell.summary.form).toBe("median");
      expect(cell.ceiling).toBe(maxEventPoints(SEASON, "dcmp")[category] + by);
      expect("playoffMilestone" in cell).toBe(false);
      expect("selection" in cell).toBe(false);
      expect("notPicked" in cell).toBe(false);
    });

    it("carries a division cell the finals add 0 to untouched, flags included", () => {
      for (const category of ["qual", "alliance"] as const) {
        expect(cellOf(shifted.dcmpRow.cells, category)).toEqual(cellOf(divisionOnly.dcmpRow.cells, category));
        expect(JSON.stringify(cellOf(shifted.dcmpRow.cells, category))).not.toContain("shiftedByFinals");
      }
    });

    it("moves the open Subtotal up by the sum of the added values, so the cells add up to it", () => {
      const subtotal = shifted.dcmpRow.subtotal;
      const own = divisionOnly.dcmpRow.subtotal;
      if (subtotal.kind !== "open" || own.kind !== "open") throw new Error("expected two open subtotals");
      expectMovedUp(subtotal.distribution, own.distribution, 90);
      expect(shifted.hasOpenCategory).toBe(true);
    });

    it("reads the win chance off the DIVISION row's own Playoffs cell, before any addition", () => {
      const winner = maxEventPoints(SEASON, "dcmp").elim;
      expect(shifted.dcmpPart?.winChance).toBeCloseTo(probabilityAt(divisionDistributions.elim, winner), 12);
      expect(shifted.dcmpPart?.winChance).toBe(divisionOnly.dcmpPart?.winChance);
      expect(shifted.dcmpPart!.winChance).toBeGreaterThan(0);
    });

    it("names outcomes for a plain DCMP cell, and for neither a shifted cell nor the District points row", () => {
      const plain = cellOf(shifted.dcmpRow.cells, "qual");
      const flagged = cellOf(shifted.dcmpRow.cells, "elim");
      expect(champCellNamesOutcomes("dcmp", plain)).toBe(true);
      expect(champCellNamesOutcomes("dcmp", cellOf(divisionOnly.dcmpRow.cells, "elim"))).toBe(true);
      expect(champCellNamesOutcomes("dcmp", flagged)).toBe(false);
      expect(champCellNamesOutcomes("district", plain)).toBe(false);
      expect(champCellNamesOutcomes(undefined, plain)).toBe(false);
    });
  });

  describe("champDcmpStageSource: the small stage line follows the event still being played (R10)", () => {
    const stage = (finished: boolean): DistrictEventStage => ({
      final: finished ? ALL_FINAL : { qual: true, alliance: true, elim: false, award: false },
      stateKnown: true,
      started: true,
      finished,
    });
    const source = (eventKey: string, finished: boolean): ChampLedgerSource => ({ eventKey, eventName: eventKey, week: 6, stage: stage(finished) });
    const FINALS_KEY = "2026micmp";
    const DIVISION_KEY = "2026micmp3";

    it.each([
      ["division then finals", false],
      ["finals then division (the FIM order)", true],
    ] as const)("answers the same five cases with the sources listed %s", (_label, finalsFirst) => {
      const list = (divisionDone: boolean, finalsDone: boolean): ChampLedgerSource[] => {
        const pair = [source(DIVISION_KEY, divisionDone), source(FINALS_KEY, finalsDone)];
        return finalsFirst ? pair.reverse() : pair;
      };
      // The division is still open: the division, whatever the finals read.
      expect(champDcmpStageSource(list(false, false))?.eventKey).toBe(DIVISION_KEY);
      expect(champDcmpStageSource(list(false, true))?.eventKey).toBe(DIVISION_KEY);
      // The division is done and the finals are not: the finals.
      expect(champDcmpStageSource(list(true, false))?.eventKey).toBe(FINALS_KEY);
      // Both done: the division, whose stage word is then the final word.
      expect(champDcmpStageSource(list(true, true))?.eventKey).toBe(DIVISION_KEY);
      // One source: that source, open or done. None: nothing.
      for (const done of [false, true]) {
        expect(champDcmpStageSource([source(DIVISION_KEY, done)])?.eventKey).toBe(DIVISION_KEY);
        expect(champDcmpStageSource([source(FINALS_KEY, done)])?.eventKey).toBe(FINALS_KEY);
      }
      expect(champDcmpStageSource([])).toBeUndefined();
    });

    it("does not reorder the list it was given", () => {
      const sources = [source(FINALS_KEY, false), source(DIVISION_KEY, false)];
      champDcmpStageSource(sources);
      expect(sources.map((entry) => entry.eventKey)).toEqual([FINALS_KEY, DIVISION_KEY]);
    });
  });

  // LOCAL ARTIFACT GATED. `data/local-publish` is gitignored, so this runs only
  // on a machine that has published locally; the path is resolved from this
  // test file, never from the working directory.
  const FIM_PATH = (() => {
    try {
      return resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../data/local-publish/districts/v1__district__2026fim.json");
    } catch {
      return undefined;
    }
  })();
  describe.skipIf(FIM_PATH === undefined || !existsSync(FIM_PATH))("the published 2026 FIM artifact at Now", () => {
    it("gives frc27 66, 48, 150, 30 and 294, and the finals only team frc11387 0, 0, 0, 24 and 24", () => {
      const artifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(FIM_PATH!, "utf8")));
      const rows = buildChampLedgerRows({ artifact, distributions: new Map() });
      const valuesOf = (teamKey: string): number[] => dcmpValues(rows.teams.find((entry) => entry.teamKey === teamKey)!);
      expect(valuesOf("frc27")).toEqual([66, 48, 150, 30, 294]);
      expect(valuesOf("frc11387")).toEqual([0, 0, 0, 24, 24]);
      console.log(`[261009-tx8 2026fim] frc27 ${valuesOf("frc27").join(", ")}; frc11387 ${valuesOf("frc11387").join(", ")}`);
    });
  });
});

describe("fieldFixingDcmpKeys and dcmpStartedForTeam — the field is fixed once every division has started (261009-pgq, D1)", () => {
  const FIM = ["2026micmp", "2026micmp1", "2026micmp2", "2026micmp3", "2026micmp4"];
  const NE = ["2026necmp", "2026necmp1", "2026necmp2"];
  const CA = ["2026cancmp", "2026cascmp"];
  const rowless = team({ teamKey: "frc1" });

  it("drops a divisioned championship's finals key and keeps every other key", () => {
    expect(fieldFixingDcmpKeys(FIM)).toEqual(["2026micmp1", "2026micmp2", "2026micmp3", "2026micmp4"]);
    expect(fieldFixingDcmpKeys(NE)).toEqual(["2026necmp1", "2026necmp2"]);
    expect(fieldFixingDcmpKeys(["2026nccmp"])).toEqual(["2026nccmp"]);
    expect(fieldFixingDcmpKeys(CA)).toEqual(CA);
    expect(fieldFixingDcmpKeys(["2026necmp1", "2026necmp2"])).toEqual(["2026necmp1", "2026necmp2"]);
    expect(fieldFixingDcmpKeys([])).toEqual([]);
  });

  it("a team with no dcmp source is settled once every division has started, whether the finals have or not", () => {
    expect(dcmpStartedForTeam(rowless, new Set(["2026necmp1", "2026necmp2"]), NE)).toBe(true);
    expect(dcmpStartedForTeam(rowless, new Set(["2026necmp", "2026necmp1", "2026necmp2"]), NE)).toBe(true);
    expect(dcmpStartedForTeam(rowless, new Set(["2026necmp1"]), NE)).toBe(false);
    expect(dcmpStartedForTeam(rowless, new Set(["2026necmp"]), NE)).toBe(false);
    expect(dcmpStartedForTeam(rowless, new Set(), NE)).toBe(false);
    expect(dcmpStartedForTeam(rowless, new Set(FIM.slice(1)), FIM)).toBe(true);
    expect(dcmpStartedForTeam(rowless, new Set(FIM.slice(1, 4)), FIM)).toBe(false);
  });

  it("a single championship and the two California championships are unchanged", () => {
    expect(dcmpStartedForTeam(rowless, new Set(["2026nccmp"]), ["2026nccmp"])).toBe(true);
    expect(dcmpStartedForTeam(rowless, new Set(), ["2026nccmp"])).toBe(false);
    expect(dcmpStartedForTeam(rowless, new Set(["2026cancmp"]), CA)).toBe(false);
    expect(dcmpStartedForTeam(rowless, new Set(CA), CA)).toBe(true);
    expect(dcmpStartedForTeam(rowless, new Set(["2026nccmp"]), [])).toBe(false);
  });

  it("a team with its own dcmp source still reads its own first key only", () => {
    const own = team({ teamKey: "frc2", eventPoints: [eventPoints({ eventKey: "2026necmp1", tier: "dcmp" })] });
    expect(dcmpStartedForTeam(own, new Set(["2026necmp1"]), NE)).toBe(true);
    expect(dcmpStartedForTeam(own, new Set(["2026necmp", "2026necmp2"]), NE)).toBe(false);
  });
});

describe("buildChampLedgerRows forwards the field's stage to both tier passes (quick task 261009-vp9)", () => {
  const DCMP = "2026pncmp";
  /** The NUMBER at the stop: qualification in, Alliance selection not final. */
  const NUMBER: DistrictStageFinality = { qual: true, alliance: false, elim: false, award: false };
  /** The FIELD at the stop: selection is over. */
  const FIELD: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
  const started = state({ alliancesPicked: true, playoffsDone: false, awardsPosted: false });

  const artifact = artifactOf([
    team({
      teamKey: "frc1",
      eventPoints: [eventPoints({ eventKey: "2026wabon" })],
      remainingEvents: [{ eventKey: DCMP, eventName: "PNW DCMP", week: 6, tier: "dcmp", maxPoints: 249, state: started }],
    }),
  ]);
  const numberByEvent = new Map<string, DistrictStageFinality>([
    ["2026wabon", ALL_FINAL],
    [DCMP, NUMBER],
  ]);
  const fieldByEvent = new Map<string, DistrictStageFinality>([
    ["2026wabon", ALL_FINAL],
    [DCMP, FIELD],
  ]);

  it("hands fieldStageByEvent to the district pass and to the dcmp pass, beside stageByEvent, and hands neither pass the key where none is supplied", () => {
    const spy = vi.mocked(buildDistrictLedgerRows);
    spy.mockClear();
    buildChampLedgerRows({ artifact, distributions: new Map(), stageByEvent: numberByEvent, fieldStageByEvent: fieldByEvent });
    expect(spy.mock.calls.map(([options]) => options.tier)).toEqual(["district", "dcmp"]);
    for (const [options] of spy.mock.calls) {
      expect(options.fieldStageByEvent).toBe(fieldByEvent);
      expect(options.stageByEvent).toBe(numberByEvent);
    }

    spy.mockClear();
    buildChampLedgerRows({ artifact, distributions: new Map(), stageByEvent: numberByEvent });
    expect(spy.mock.calls).toHaveLength(2);
    for (const [options] of spy.mock.calls) expect("fieldStageByEvent" in options).toBe(false);
  });

  it("the DCMP row's Playoffs cell carries the not picked note from the FIELD, while its Alliance selection cell stays open on the number", () => {
    const slot = { draws: 0, minPoints: undefined, maxPoints: undefined, allianceNumber: undefined, possibleMinPoints: 0, possibleMaxPoints: 48 };
    const distributions = new Map<string, DistrictEventDistributions>([
      [
        DCMP,
        {
          ...distributionsFor(DCMP, { frc1: { alliance: uniform(48, 1000), elim: uniform(90, 1000), award: uniform(45, 1000), eventTotal: uniform(249, 1000) } }),
          selectionRoutesByTeam: new Map([["frc1", { bySlot: [slot, slot, slot, slot], notSelectedDraws: 1000 }]]),
          rankingFixed: true,
        },
      ],
    ]);
    const built = (fieldStageByEvent?: ReadonlyMap<string, DistrictStageFinality>) =>
      buildChampLedgerRows({ artifact, distributions, stageByEvent: numberByEvent, atLivePosition: true, ...(fieldStageByEvent === undefined ? {} : { fieldStageByEvent }) }).teams[0]!;

    const withField = built(fieldByEvent);
    expect(cellOf(withField.dcmpRow.cells, "alliance").kind).toBe("open");
    const elim = cellOf(withField.dcmpRow.cells, "elim");
    expect(elim.kind).toBe("open");
    expect("notPicked" in elim && elim.notPicked).toBe(true);

    // With no field map the note follows the stage map, as before: selection is not final there.
    expect("notPicked" in cellOf(built().dcmpRow.cells, "elim")).toBe(false);
  });
});

describe("buildChampLedgerRows: a team with no championship row reads out only once the field is proven (quick task 261010-66y, D1)", () => {
  const D1 = "2026necmp1";
  const D2 = "2026necmp2";
  const NOW_YEAR = 2026;
  const inProgress = state({ qualMatchesPlayed: 30, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
  const dcmpRowAt = (eventKey: string) => eventPoints({ eventKey, tier: "dcmp", week: 5, qual: 30, alliance: 0, elim: 0, award: 0, total: 30, state: inProgress });
  const districtRow = eventPoints({ eventKey: "2026wabon", week: 0, total: 40, qual: 20, alliance: 10, elim: 10, award: 0 });
  const estimate = { distribution: { counts: Float64Array.from([0, 0, 0, 0, 0, 1, 1]), denominator: 2 }, winChance: 0.25 };

  /** frc1 and frc2 play division 1. frc3 and frc4 play division 2. frc5 attends neither. */
  function artifactWith(postedDivisions: readonly string[]): DistrictArtifact {
    const at = (teamKey: string, division: string) =>
      team({ teamKey, pointTotal: postedDivisions.includes(division) ? 70 : 40, eventPoints: postedDivisions.includes(division) ? [districtRow, dcmpRowAt(division)] : [districtRow] });
    return artifactOf([at("frc1", D1), at("frc2", D1), at("frc3", D2), at("frc4", D2), team({ teamKey: "frc5", pointTotal: 40, eventPoints: [districtRow] })], { dcmpSlots: 4 });
  }
  const ONE_POSTED = artifactWith([D1]);
  const BOTH_POSTED = artifactWith([D1, D2]);
  const chances = new Map([["frc3", 0.6], ["frc4", 0.5], ["frc5", 0.1]]);
  const estimates = new Map(["frc1", "frc2", "frc3", "frc4", "frc5"].map((teamKey) => [teamKey, estimate] as const));
  const byKey = (rows: ReturnType<typeof buildChampLedgerRows>) => new Map(rows.teams.map((entry) => [entry.teamKey, entry] as const));

  it("premise: one division posted of two reads unproven after a start, both posted reads proven by capacity", () => {
    expect(champFieldProofAtNow(ONE_POSTED, new Set([D1]), NOW_YEAR)).toMatchObject({ proven: false, unprovenAfterStart: true, postedTeams: 2, fieldFixingKeys: [D1] });
    expect(champFieldProofAtNow(BOTH_POSTED, new Set([D1, D2]), NOW_YEAR)).toMatchObject({ proven: true, completeBy: "capacity", unprovenAfterStart: false, postedTeams: 4 });
    // Before any field fixing key has started nothing is claimed about the field.
    expect(champFieldProofAtNow(ONE_POSTED, new Set(), NOW_YEAR)).toMatchObject({ proven: false, unprovenAfterStart: false });
  });

  it("live, one division posted and started: a team with no row reads open with its field chance and the estimate row, and fieldProven is false", () => {
    const rows = buildChampLedgerRows({ artifact: ONE_POSTED, distributions: new Map(), atLivePosition: true, nowYear: NOW_YEAR, fieldChanceByTeam: chances, dcmpEstimateByTeam: estimates });
    expect(rows.fieldProven).toBe(false);
    const teams = byKey(rows);
    for (const teamKey of ["frc3", "frc4", "frc5"]) {
      const entry = teams.get(teamKey)!;
      expect({ teamKey, membership: entry.membership, fieldChance: entry.fieldChance, estimated: entry.dcmpRow.estimated }).toEqual({ teamKey, membership: "open", fieldChance: chances.get(teamKey), estimated: true });
      expect(entry.dcmpRow.cells.every((cell) => cell.kind === "notYetPriced")).toBe(true);
      expect(entry.dcmpRow.subtotal.kind).toBe("open");
    }
    // A team with its own row is in the field, as before.
    for (const teamKey of ["frc1", "frc2"]) expect(teams.get(teamKey)!.membership).toBe("in");
    expect(rows.gaps.teamsWithoutFieldChance).toEqual([]);
  });

  it("live, both divisions posted and started with the field proven: the team with no row reads out, and fieldProven is true", () => {
    const rows = buildChampLedgerRows({ artifact: BOTH_POSTED, distributions: new Map(), atLivePosition: true, nowYear: NOW_YEAR, fieldChanceByTeam: chances, dcmpEstimateByTeam: estimates });
    expect(rows.fieldProven).toBe(true);
    const teams = byKey(rows);
    expect(teams.get("frc5")!.membership).toBe("out");
    expect(teams.get("frc5")!.dcmpRow.cells.every((cell) => cell.kind === "notInField")).toBe(true);
    for (const teamKey of ["frc1", "frc2", "frc3", "frc4"]) expect(teams.get(teamKey)!.membership).toBe("in");
  });

  it("at a rewound position both artifacts read as they always did: the started keys alone decide, and fieldProven is true", () => {
    for (const [artifact, started] of [[ONE_POSTED, [D1]], [BOTH_POSTED, [D1, D2]]] as const) {
      const rewound = buildChampLedgerRows({ artifact, distributions: new Map(), atLivePosition: false, startedDcmpEventKeys: new Set(started), nowYear: NOW_YEAR, fieldChanceByTeam: chances });
      expect(rewound.fieldProven).toBe(true);
      // The rule a rewound position has always read: out once every field fixing key on the artifact has started.
      expect(byKey(rewound).get("frc5")!.membership).toBe("out");
      // And the proven flag supplied as true changes nothing there.
      const supplied = buildChampLedgerRows({ artifact, distributions: new Map(), atLivePosition: false, startedDcmpEventKeys: new Set(started), nowYear: NOW_YEAR, fieldChanceByTeam: chances, fieldProven: true });
      expect(supplied).toEqual(rewound);
    }
    expect(byKey(buildChampLedgerRows({ artifact: ONE_POSTED, distributions: new Map(), atLivePosition: false, startedDcmpEventKeys: new Set([D1]), nowYear: NOW_YEAR })).get("frc3")!.membership).toBe("out");
  });

  describe("fieldRowOpen: a team with no row at a field fixing key, while the field is still open (quick task 261010-66y, reading R23)", () => {
    const FINALS = "2026necmp";
    /** BOTH_POSTED with frc5 given an award at the finals alone: its only championship row is at the finals key. */
    const WITH_FINALS_ONLY = artifactOf(
      BOTH_POSTED.teams.map((entry) =>
        entry.teamKey === "frc5"
          ? { ...entry, pointTotal: entry.pointTotal + 30, eventPoints: [...entry.eventPoints, eventPoints({ eventKey: FINALS, tier: "dcmp", week: 5, qual: 0, alliance: 0, elim: 0, award: 30, total: 30 })] }
          : entry
      ),
      { dcmpSlots: 4 }
    );
    const openAt = (artifact: DistrictArtifact, started: readonly string[], options: { live?: boolean; fieldProven?: boolean } = {}) =>
      new Map(
        buildChampLedgerRows({
          artifact,
          distributions: new Map(),
          atLivePosition: options.live === true,
          startedDcmpEventKeys: new Set(started),
          nowYear: NOW_YEAR,
          fieldChanceByTeam: chances,
          ...(options.fieldProven === undefined ? {} : { fieldProven: options.fieldProven }),
        }).teams.map((entry) => [entry.teamKey, entry.fieldRowOpen] as const)
      );

    it("premise: the finals key is not field fixing, and frc5's one championship row is there", () => {
      expect(fieldFixingDcmpKeys([D1, D2, FINALS])).toEqual([D1, D2]);
      expect(WITH_FINALS_ONLY.teams.find((entry) => entry.teamKey === "frc5")!.eventPoints.filter((row) => row.tier === "dcmp").map((row) => row.eventKey)).toEqual([FINALS]);
    });

    it("is false for every team with a row at a field fixing key, whatever has started", () => {
      for (const artifact of [BOTH_POSTED, WITH_FINALS_ONLY]) {
        for (const started of [[], [D1], [D1, D2], [D1, D2, FINALS]]) {
          const open = openAt(artifact, started);
          for (const teamKey of ["frc1", "frc2", "frc3", "frc4"]) expect({ started, teamKey, open: open.get(teamKey) }).toEqual({ started, teamKey, open: false });
        }
      }
    });

    it("is true for a team with no row at a field fixing key while not every field fixing key has started, and false once they all have", () => {
      // frc5 has no championship row at all on BOTH_POSTED, and only a finals row on WITH_FINALS_ONLY: the same answer.
      for (const artifact of [BOTH_POSTED, WITH_FINALS_ONLY]) {
        expect(openAt(artifact, []).get("frc5")).toBe(true);
        expect(openAt(artifact, [D1]).get("frc5")).toBe(true);
        expect(openAt(artifact, [D2]).get("frc5")).toBe(true);
        expect(openAt(artifact, [D1, D2]).get("frc5")).toBe(false);
        // The finals' own start is not asked for, and adds nothing.
        expect(openAt(artifact, [FINALS]).get("frc5")).toBe(true);
        expect(openAt(artifact, [D1, D2, FINALS]).get("frc5")).toBe(false);
      }
      // One division on the rows: the teams of the other division are on no row, and read by the same rule.
      expect(openAt(ONE_POSTED, []).get("frc3")).toBe(true);
      expect(openAt(ONE_POSTED, [D1]).get("frc3")).toBe(false);
    });

    it("at the live position it stays true while the field is not proven, though every key the artifact knows has started", () => {
      // One division posted and started, the other on no row: the field reads unproven, so a team on no row is still open.
      expect(openAt(ONE_POSTED, [D1], { live: true }).get("frc3")).toBe(true);
      expect(openAt(ONE_POSTED, [D1], { live: true }).get("frc5")).toBe(true);
      expect(openAt(ONE_POSTED, [D1], { live: true }).get("frc1")).toBe(false);
      // Both posted and started: proven by capacity, so it is false, as at a rewound position.
      expect(openAt(BOTH_POSTED, [D1, D2], { live: true }).get("frc5")).toBe(false);
      expect(openAt(WITH_FINALS_ONLY, [D1, D2], { live: true }).get("frc5")).toBe(false);
      // A supplied flag is used as given.
      expect(openAt(BOTH_POSTED, [D1, D2], { live: true, fieldProven: false }).get("frc5")).toBe(true);
      expect(openAt(BOTH_POSTED, [D1], { live: true, fieldProven: true }).get("frc5")).toBe(true);
    });

    it("for a team with no championship row it is exactly membership not reading out, and membership itself is untouched", () => {
      for (const artifact of [ONE_POSTED, BOTH_POSTED]) {
        for (const started of [[], [D1], [D1, D2]]) {
          for (const live of [false, true]) {
            const rows = buildChampLedgerRows({ artifact, distributions: new Map(), atLivePosition: live, startedDcmpEventKeys: new Set(started), nowYear: NOW_YEAR, fieldChanceByTeam: chances });
            for (const entry of rows.teams) {
              const source = artifact.teams.find((candidate) => candidate.teamKey === entry.teamKey)!;
              // The membership rule is the one it was: the team's own first championship row, or the field's.
              expect(entry.membership, `${entry.teamKey} ${JSON.stringify(started)} ${String(live)}`).toBe(champFieldMembership(source, dcmpStartedForTeam(source, new Set(started), [...new Set(artifact.teams.flatMap((candidate) => candidate.eventPoints.filter((row) => row.tier === "dcmp").map((row) => row.eventKey)))].sort(), rows.fieldProven), live));
              if (source.eventPoints.every((row) => row.tier !== "dcmp")) expect(entry.fieldRowOpen, `${entry.teamKey} ${JSON.stringify(started)} ${String(live)}`).toBe(entry.membership !== "out");
            }
          }
        }
      }
      // The finals only team keeps the membership its finals row gives it, whatever fieldRowOpen says.
      const finalsOnly = buildChampLedgerRows({ artifact: WITH_FINALS_ONLY, distributions: new Map(), atLivePosition: false, startedDcmpEventKeys: new Set([D1, D2, FINALS]), nowYear: NOW_YEAR }).teams.find((entry) => entry.teamKey === "frc5")!;
      expect({ membership: finalsOnly.membership, fieldRowOpen: finalsOnly.fieldRowOpen, sources: finalsOnly.dcmpRow.sources.map((source) => source.eventKey) }).toEqual({ membership: "in", fieldRowOpen: false, sources: [FINALS] });
    });
  });

  it("before any field fixing key has started fieldProven is true and the rows are the rows a proven field gives", () => {
    const notStarted = state({ qualMatchesPlayed: 0, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
    const artifact = artifactOf(
      ONE_POSTED.teams.map((entry) => ({ ...entry, eventPoints: entry.eventPoints.map((row) => (row.tier === "dcmp" ? { ...row, state: notStarted } : row)) })),
      { dcmpSlots: 4 }
    );
    const rows = buildChampLedgerRows({ artifact, distributions: new Map(), atLivePosition: true, nowYear: NOW_YEAR, fieldChanceByTeam: chances });
    expect(rows.fieldProven).toBe(true);
    expect(rows).toEqual(buildChampLedgerRows({ artifact, distributions: new Map(), atLivePosition: true, nowYear: NOW_YEAR, fieldChanceByTeam: chances, fieldProven: true }));
    expect(byKey(rows).get("frc5")!.membership).toBe("open");
  });

  it("uses a supplied fieldProven as given", () => {
    const held = buildChampLedgerRows({ artifact: BOTH_POSTED, distributions: new Map(), atLivePosition: true, nowYear: NOW_YEAR, fieldChanceByTeam: chances, fieldProven: false });
    expect(held.fieldProven).toBe(false);
    expect(byKey(held).get("frc5")!.membership).toBe("open");
    const released = buildChampLedgerRows({ artifact: ONE_POSTED, distributions: new Map(), atLivePosition: true, nowYear: NOW_YEAR, fieldChanceByTeam: chances, fieldProven: true });
    expect(released.fieldProven).toBe(true);
    expect(byKey(released).get("frc5")!.membership).toBe("out");
  });

  it("dcmpStartedForTeam: a team with no row is not settled while the field is not proven, and a team with its own row never asks", () => {
    const rowless = team({ teamKey: "frc9" });
    expect(dcmpStartedForTeam(rowless, new Set([D1]), [D1])).toBe(true);
    expect(dcmpStartedForTeam(rowless, new Set([D1]), [D1], true)).toBe(true);
    expect(dcmpStartedForTeam(rowless, new Set([D1]), [D1], false)).toBe(false);
    const own = team({ teamKey: "frc8", eventPoints: [dcmpRowAt(D1)] });
    expect(dcmpStartedForTeam(own, new Set([D1]), [D1], false)).toBe(true);
    expect(dcmpStartedForTeam(own, new Set(), [D1], false)).toBe(false);
  });

  it("the season over line reads the year it is handed: the 2020 shape is proven in 2026 and not in 2020", () => {
    const awardsOnly = state({ qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: false, playoffsDone: false, awardsPosted: true });
    const artifact = artifactOf(
      [
        team({ teamKey: "frc1", eventPoints: [eventPoints({ eventKey: "2020pncmp", tier: "dcmp", qual: 0, alliance: 0, elim: 0, award: 30, total: 30, state: awardsOnly })] }),
        team({ teamKey: "frc2", eventPoints: [eventPoints({ eventKey: "2020wasno", state: state() })] }),
      ],
      { year: 2020, districtKey: "2020pnw", dcmpSlots: 64 }
    );
    expect(champFieldProofAtNow(artifact, new Set(["2020pncmp"]), 2026)).toMatchObject({ proven: true, completeBy: "seasonOver" });
    expect(champFieldProofAtNow(artifact, new Set(["2020pncmp"]), 2020)).toMatchObject({ proven: false, unprovenAfterStart: true });
  });
});

