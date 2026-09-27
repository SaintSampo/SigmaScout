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
  type DistrictArtifact,
  type DistrictEventState,
} from "../../../../../packages/harness/pageArtifacts.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import { pointQuantile } from "../../../../../packages/core/districts/pointSummary.js";
import {
  DISTRICT_CATEGORIES,
  districtCellId,
  pointMassDistribution,
  type DistrictCellKind,
  type DistrictEventDistributions,
  type DistrictPointDistribution,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import {
  CHAMP_LEDGER_ROWS,
  buildChampLedgerRows,
  champCellId,
  champContributions,
  champFieldMembership,
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
