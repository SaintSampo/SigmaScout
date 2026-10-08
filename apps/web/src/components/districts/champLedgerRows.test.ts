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
import { describe, expect, it } from "vitest";
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
  districtCellId,
  distributionsFromResult,
  pointMassDistribution,
  type DistrictCellKind,
  type DistrictEventDistributions,
  type DistrictPointDistribution,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import {
  CHAMP_LEDGER_ROWS,
  buildChampLedgerRows,
  earnedAtPositionOf,
  champCellId,
  champContributions,
  champFieldMembership,
  champTeamHiddenAtDcmp,
  dcmpEventKeyFor,
  mixFieldMembership,
  type ChampLedgerCell,
  type ChampLedgerTeam,
} from "./champLedgerRows.js";

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
