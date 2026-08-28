/**
 * Credential-free, re-runnable verifier for 07-10's real-data subset publish
 * (PD-08), extended by plan 07-17 (PD-03) for the D-18 full republish under
 * the renamed `vpr` algorithm id. Reads published artifacts from the SAME
 * public origin the browser reads (`apps/web/src/lib/artifactOrigin.ts`,
 * Phase 4 D-25) — never the R2 bucket directly, never
 * `packages/harness/r2Client.ts`'s `getObject` / `deleteObject` — and
 * resolves each algorithm's published version from the public algorithms
 * manifest rather than hardcoding or hand-typing one (PD-02). Parses every
 * artifact through the publisher's own `EventArtifactSchema` /
 * `TeamSeasonArtifactSchema` and asserts thirteen classes of expectation
 * against two committed expectation tables — `PUBLISHED_SUBSET` (event-level,
 * checks 1-10) and `PUBLISHED_TEAM_SUBSET` (team-level, checks 11-13) — whose
 * numbers are direct corpus measurements and never adjusted to match an
 * observed result (this plan's first prohibition; PD-03).
 *
 * 07-17's own fifteen `PUBLISHED_SUBSET` entries are kept EXACTLY as 07-10
 * left them (`PRE_RENAME_EVENT_SUBSET` below) — the old-key control: every
 * one of these seventeen entries (fifteen `sigma1` + the two non-`sigma1`
 * `2024casf` arms) must stay green after 07-17's full republish, proving
 * nothing was deleted or clobbered. `RENAMED_EVENT_SUBSET` derives a renamed
 * duplicate of every one of those seventeen PROGRAMMATICALLY (a `.map()`,
 * never hand-retyped) so the expectation numbers can never silently drift
 * between the control and the renamed-run assertion — for the fifteen
 * `sigma1` entries the duplicate's `algorithmId` becomes `vpr`; the two
 * `opr`/`epa` arms are duplicated unchanged (opr/epa are overwritten in
 * place by the same run, never renamed), so the table reads as "every
 * algorithm this run touches, once for old-key control, once for the
 * renamed-run assertion" rather than silently omitting two of seventeen
 * (PD-03).
 *
 * This script needs NO credential of any kind: it never reads an
 * environment variable, never constructs a signed request, and never
 * imports from `packages/harness/r2Client.ts` (PD-01). Staleness under
 * `public, max-age=60` is closed by construction, not by waiting: every
 * fetch carries a per-run cache-busting query parameter and
 * `cache: "no-store"`, and the caller is expected to additionally compare
 * the returned `generation` against a pre-publish baseline for any
 * previously-existing key — a matching value means a stale read.
 *
 * `TeamMetric.percentile` is `.min(0).max(100).optional()` in
 * `packages/harness/pageArtifacts.ts` and deliberately never `.nullable()` —
 * a literal `percentile: null` in a real body is therefore already refused
 * by `EventArtifactSchema.safeParse`/`TeamSeasonArtifactSchema.safeParse`
 * before this file's own checks ever run, surfacing as a parse failure
 * rather than as a silent pass.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  artifactKey,
  EventArtifactSchema,
  TeamSeasonArtifactSchema,
  type EventArtifact,
  type TeamSeasonArtifact,
} from "../packages/harness/pageArtifacts.js";

/** D-04/D-05 (plan 07-16): the renamed published algorithm id — every `sigma1` control entry's renamed duplicate carries this id instead. */
const RENAMED_ALGORITHM_ID = "vpr";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * `apps/web/src/lib/artifactOrigin.ts` is the single authority for this
 * value in the client — `https://data.sigmascout.org` (Phase 4 D-25). This
 * script cannot import that file: it reads `import.meta.env`, a Vite
 * construct with no Node equivalent. The value is therefore duplicated here,
 * deliberately, rather than hidden (PD-01).
 */
export const DEFAULT_ARTIFACT_ORIGIN = "https://data.sigmascout.org";

export const ALGORITHMS_MANIFEST_KEY = "v1/manifest/algorithms.json";

// ---------------------------------------------------------------------------
// The committed expectation table (PD-03)
// ---------------------------------------------------------------------------

export interface SubsetEntry {
  readonly eventKey: string;
  readonly algorithmId: string;
  /** The one-line reason this event is in the subset, lifted from 07-10-PLAN.md's <subset_selection>. */
  readonly note: string;
  readonly expectMatches: number;
  readonly expectUpcoming: number;
  readonly expectTeams: number;
  /** Exact count of team entries expected to carry `rank` — zero for the four no-ranking events. */
  readonly expectRankedTeams: number;
  readonly expectAlliances: "populated" | "empty";
  readonly expectVariance: "present" | "absent";
  /** Optional exact alliance count, when the entry's shape is pinned beyond populated/empty. */
  readonly expectAllianceCount?: number;
  /** Optional exact per-alliance picks length, asserted on every alliance when present. */
  readonly expectEveryAlliancePicks?: number;
  /** Optional assertion that at least one alliance carries no `name` key. */
  readonly expectSomeAllianceWithoutName?: boolean;
}

/**
 * 07-10's committed table, kept BYTE-IDENTICAL to how that plan left it — the
 * old-key control (PD-03). Every number came from a direct corpus
 * measurement recorded in 07-10-PLAN.md's <subset_selection> table; none may
 * be adjusted to match an observed result, including `2025isios`'s
 * `expectAlliances: "populated"` below, which 07-10 itself found publishes
 * `alliances: []` in real production (WINDOWS.md ledger #13, left open by
 * this plan for the same reason: this plan's own first prohibition forbids
 * touching a committed expectation to match an observation).
 */
export const PRE_RENAME_EVENT_SUBSET: readonly SubsetEntry[] = [
  {
    eventKey: "2024casf",
    algorithmId: "sigma1",
    note:
      'TRACER. The one key whose pre-enrichment state is measured field by field; the only event where ' +
      '"the enrichment landed" is a before/after claim rather than an absolute one. Also 07-12\'s ordinary ' +
      "full case and an ordinary regional for 07-15's precondition.",
    expectMatches: 87,
    expectUpcoming: 0,
    expectTeams: 43,
    expectRankedTeams: 43,
    expectAlliances: "populated",
    expectVariance: "present",
  },
  {
    eventKey: "2022ilpe",
    algorithmId: "sigma1",
    note:
      "07-13's played+upcoming elimination INTERLEAVE case (qf2m3 between played qf2m2 and qf3m1) — the real " +
      "case a played-then-upcoming concatenation fails while passing a contiguous fixture. Second ordinary " +
      "regional for 07-15.",
    expectMatches: 85,
    expectUpcoming: 3,
    expectTeams: 38,
    expectRankedTeams: 38,
    expectAlliances: "populated",
    expectVariance: "present",
  },
  {
    eventKey: "2022mirr",
    algorithmId: "sigma1",
    note:
      "07-13/07-20's pure all-unplayed elimination slate: zero played elimination rows against 60 upcoming ef " +
      "rows across 20 sets. Offseason, reachable only once an offseason publish reaches it — this plan is that " +
      "publish.",
    expectMatches: 38,
    expectUpcoming: 60,
    expectTeams: 15,
    expectRankedTeams: 15,
    expectAlliances: "populated",
    expectVariance: "present",
  },
  {
    eventKey: "2023cur",
    algorithmId: "sigma1",
    note: "07-20's widest roster (78 ranked teams, tied max) and 130 qualification rows — the E3 roster and E5 density target.",
    expectMatches: 145,
    expectUpcoming: 0,
    expectTeams: 78,
    expectRankedTeams: 78,
    expectAlliances: "populated",
    expectVariance: "present",
  },
  {
    eventKey: "2023cnsh",
    algorithmId: "sigma1",
    note: "D-08 / RESEARCH Pitfall 1's own named event, one of the exact three D-08's fallback was measured and written around. Offseason, zero ranking rows.",
    expectMatches: 62,
    expectUpcoming: 0,
    expectTeams: 29,
    expectRankedTeams: 0,
    expectAlliances: "populated",
    expectVariance: "present",
  },
  {
    eventKey: "2023nhgrs",
    algorithmId: "sigma1",
    note:
      "07-12's adjacency measurement event: 52 played + 26 upcoming qualification rows (zero duplicate " +
      "matchNumber across the two arrays), a second-season D-13 quals-merge case.",
    expectMatches: 67,
    expectUpcoming: 26,
    expectTeams: 39,
    expectRankedTeams: 39,
    expectAlliances: "populated",
    expectVariance: "present",
  },
  {
    eventKey: "2024new",
    algorithmId: "sigma1",
    note:
      "07-20's E4 target and the payload gate: the corpus's current maximum-bytes event object (285,437 " +
      "pre-plan) and the widest column set in the app. D-08 CONTROL — every team carries a rank.",
    expectMatches: 140,
    expectUpcoming: 0,
    expectTeams: 75,
    expectRankedTeams: 75,
    expectAlliances: "populated",
    expectVariance: "present",
  },
  {
    eventKey: "2024vabrb",
    algorithmId: "sigma1",
    note:
      "07-14's explicit routed recommendation, three-in-one: offseason, zero ranking rows (D-08's banner), and " +
      "five alliances of exactly two picks (D-16's incomplete-sum rule on every row).",
    expectMatches: 26,
    expectUpcoming: 0,
    expectTeams: 13,
    expectRankedTeams: 0,
    expectAlliances: "populated",
    expectVariance: "present",
    expectAllianceCount: 5,
    expectEveryAlliancePicks: 2,
  },
  {
    eventKey: "2024wvrox",
    algorithmId: "sigma1",
    note:
      "07-20/07-14: the true corpus quals maximum (135 qualification rows) and RESEARCH.md Question 2's " +
      "live-observed absent alliance name case — an alliance carrying declines/picks/status but no name key.",
    expectMatches: 154,
    expectUpcoming: 0,
    expectTeams: 30,
    expectRankedTeams: 30,
    expectAlliances: "populated",
    expectVariance: "present",
    expectSomeAllianceWithoutName: true,
  },
  {
    eventKey: "2025flta",
    algorithmId: "sigma1",
    note:
      "07-12/07-20: 63 played + 21 upcoming = the 84-row merged quals slate 07-12's width target and 07-20's " +
      "E5 merge case. Third ordinary regional for 07-15.",
    expectMatches: 78,
    expectUpcoming: 21,
    expectTeams: 42,
    expectRankedTeams: 42,
    expectAlliances: "populated",
    expectVariance: "present",
  },
  {
    eventKey: "2025isios",
    algorithmId: "sigma1",
    note:
      "D-08 / Pitfall 1's headline event (68 matches, zero ranking rows) and 07-20's named D-08 positive case. " +
      "Only subset event with upcoming qualification rows AND zero elimination matches of any kind.",
    expectMatches: 43,
    expectUpcoming: 25,
    expectTeams: 45,
    expectRankedTeams: 0,
    expectAlliances: "populated",
    expectVariance: "present",
  },
  {
    eventKey: "2025bc",
    algorithmId: "sigma1",
    note:
      "D-17: RESEARCH.md Question 2 live-observed an EMPTY alliances array here — a valid 200 with [], on an " +
      "event that ran 83 qualification matches and published 62 rankings.",
    expectMatches: 113,
    expectUpcoming: 0,
    expectTeams: 62,
    expectRankedTeams: 62,
    expectAlliances: "empty",
    expectVariance: "present",
  },
  {
    eventKey: "2025cmptx",
    algorithmId: "sigma1",
    note:
      "07-11's own named expected no-ranking candidate — Einstein is playoff-only, so zero ranking rows is a " +
      "format fact, not an offseason fact. Also zero qualification rows in both arrays (UI-SPEC E5 empty) and " +
      "a 4-pick alliance shape for D-16's excluded-fourth-pick rule.",
    expectMatches: 16,
    expectUpcoming: 0,
    expectTeams: 26,
    expectRankedTeams: 0,
    expectAlliances: "populated",
    expectVariance: "present",
  },
  {
    eventKey: "2026vache",
    algorithmId: "sigma1",
    note:
      "07-20's E1 target. Published name is 124 characters — the longest event name in five seasons of corpus " +
      "data — the header truncation + title backstop needs a real published artifact carrying it.",
    expectMatches: 75,
    expectUpcoming: 0,
    expectTeams: 30,
    expectRankedTeams: 30,
    expectAlliances: "populated",
    expectVariance: "present",
  },
  {
    eventKey: "2026wvrox",
    algorithmId: "sigma1",
    note:
      "D-17, second season: the other live-observed empty-alliances event, so the [] case is proven in two " +
      "seasons. Also 5 upcoming qualification rows against 120 played — the D-13 quals merge in a third " +
      "season and a different ratio.",
    expectMatches: 120,
    expectUpcoming: 5,
    expectTeams: 30,
    expectRankedTeams: 30,
    expectAlliances: "empty",
    expectVariance: "present",
  },
  {
    eventKey: "2024casf",
    algorithmId: "opr",
    note:
      "UI-SPEC E4 partial and E5 partial on real data. metricKeysFor('opr', 2024) is the Total key alone, so an " +
      "OPR-selected Breakdown tab is a legitimately 2-column table; OPR sets no alliance-level own variance, so " +
      "every Quals/Elims row publishes NEITHER variance field. The negative half that gives the sigma1 " +
      "assertion its meaning.",
    expectMatches: 87,
    expectUpcoming: 0,
    expectTeams: 43,
    expectRankedTeams: 43,
    expectAlliances: "populated",
    expectVariance: "absent",
  },
  {
    eventKey: "2024casf",
    algorithmId: "epa",
    note:
      "The same no-variance state at a different column set — the third arm that lets 07-01/07-11/07-12 flip " +
      "?algorithm= on ONE real event page and see three real, differently-shaped artifacts.",
    expectMatches: 87,
    expectUpcoming: 0,
    expectTeams: 43,
    expectRankedTeams: 43,
    expectAlliances: "populated",
    expectVariance: "absent",
  },
];

/**
 * PD-03: a renamed duplicate of every one of `PRE_RENAME_EVENT_SUBSET`'s
 * seventeen entries, derived PROGRAMMATICALLY (never hand-retyped) so the
 * expectation numbers are, by construction, identical — a disagreement
 * between an event's single-event artifact and its seasons-pass artifact
 * would show up as a real check failure here, never as a copy-paste drift in
 * this table. The fifteen `sigma1` entries become `vpr` (D-04/D-05); the two
 * `opr`/`epa` arms at `2024casf` are duplicated with their `algorithmId`
 * UNCHANGED, since opr/epa are overwritten in place by 07-17's run rather
 * than renamed — their "renamed-run duplicate" therefore targets the exact
 * same key as the control entry, which is deliberate (PD-03's own text names
 * this arrangement): the SAME key checked twice, once before the run
 * (`PRE_RENAME_EVENT_SUBSET`, run early to establish the RED baseline) and
 * once after (this table, run again after Task 3's real publish), is exactly
 * how an `opr`/`epa` overwrite-in-place gets its own before/after proof
 * without a second, redundant table.
 */
export const RENAMED_EVENT_SUBSET: readonly SubsetEntry[] = PRE_RENAME_EVENT_SUBSET.map((entry) => ({
  ...entry,
  algorithmId: entry.algorithmId === "sigma1" ? RENAMED_ALGORITHM_ID : entry.algorithmId,
  note: `[renamed-run duplicate, PD-03] ${entry.note}`,
}));

/**
 * The one genuinely new entry (Task 1 step 4): `2024auwarp`, event type 99
 * (offseason), `start_date` 2024-08-23 — the third of D-08's three named
 * events and the one 07-10 deliberately excluded. Corpus-measured (read-only,
 * `data/corpus.sqlite`, this plan's own baseline capture): 47 `qm` + 13 `sf`
 * + 2 `f` played rows (62 total) and zero scheduled, a 25-team roster, zero
 * `event_rankings` rows (offseason, D-08's fallback banner fires), and zero
 * `event_alliances` rows. This is the first artifact this event will ever
 * have had under any algorithm id.
 */
const NEW_2024AUWARP_ENTRY: SubsetEntry = {
  eventKey: "2024auwarp",
  algorithmId: RENAMED_ALGORITHM_ID,
  note:
    "D-08's third named event, deliberately excluded by 07-10 — the first artifact it will ever have had. " +
    "Offseason, zero ranking rows, zero alliances. Corpus-measured: 47 qm + 13 sf + 2 f played, 0 scheduled, " +
    "25-team roster.",
  expectMatches: 62,
  expectUpcoming: 0,
  expectTeams: 25,
  expectRankedTeams: 0,
  expectAlliances: "empty",
  expectVariance: "present",
};

/**
 * The full event-level expectation table this plan's verifier runs against:
 * the seventeen 07-10 control entries, their seventeen renamed-run
 * duplicates, and the one genuinely new `2024auwarp` entry — 35 total.
 */
export const PUBLISHED_SUBSET: readonly SubsetEntry[] = [...PRE_RENAME_EVENT_SUBSET, ...RENAMED_EVENT_SUBSET, NEW_2024AUWARP_ENTRY];

// ---------------------------------------------------------------------------
// PUBLISHED_TEAM_SUBSET — the team-artifact subset (checks 11-13)
// ---------------------------------------------------------------------------

export interface TeamSubsetEntry {
  readonly teamKey: string;
  readonly year: number;
  readonly algorithmId: string;
  /** The one-line reason this team-season is in the subset. */
  readonly note: string;
  /** Exact count of `ef`/`qf`/`sf`/`f` match rows expected across this team-season's `events[].matches[]`, measured directly from the corpus. */
  readonly expectPlayoffRows: number;
}

/**
 * One team-season per season (2022-2026) chosen for having playoff matches,
 * plus the two teams Task 4's `spread` comparison needs — a low-match team
 * and a veteran, both selected to have played ZERO offseason/preseason
 * matches that season so the comparison isolates D-01/D-02's redefinition
 * from the offseason-inclusion methodology change (PD-08). `frc4206`
 * (2024) serves BOTH roles at once (25 playoff rows, 83 total matches, the
 * corpus-measured 2024 maximum among zero-offseason teams) rather than
 * duplicating a second 2024 entry. One control entry
 * (`frc4206`/2024/`sigma1`) is included so Task 1 step 6 can point check 11
 * at a REAL pre-rename object with real playoff rows before trusting the
 * check against the renamed artifacts. All counts measured read-only against
 * `data/corpus.sqlite` at this plan's Task 1 baseline capture.
 */
export const PUBLISHED_TEAM_SUBSET: readonly TeamSubsetEntry[] = [
  {
    teamKey: "frc4206",
    year: 2024,
    algorithmId: "sigma1",
    note:
      "CONTROL (Task 1 step 6 only): the pre-rename team artifact this check must FAIL against before it is " +
      "trusted — 83 total matches, 25 playoff rows, zero offseason/preseason involvement in 2024.",
    expectPlayoffRows: 25,
  },
  {
    teamKey: "frc59",
    year: 2022,
    algorithmId: RENAMED_ALGORITHM_ID,
    note: "2022's playoff-row entry — 53 total matches, 12 playoff rows, zero offseason/preseason involvement.",
    expectPlayoffRows: 12,
  },
  {
    teamKey: "frc7072",
    year: 2023,
    algorithmId: RENAMED_ALGORITHM_ID,
    note: "2023's playoff-row entry — 35 total matches, 5 playoff rows, zero offseason/preseason involvement.",
    expectPlayoffRows: 5,
  },
  {
    teamKey: "frc4206",
    year: 2024,
    algorithmId: RENAMED_ALGORITHM_ID,
    note:
      "2024's playoff-row entry AND the veteran half of PD-08's spread comparison — 83 total matches (the " +
      "corpus-measured 2024 maximum among zero-offseason teams), 25 playoff rows.",
    expectPlayoffRows: 25,
  },
  {
    teamKey: "frc9969",
    year: 2024,
    algorithmId: RENAMED_ALGORITHM_ID,
    note:
      "The low-match half of PD-08's spread comparison — 3 total matches in 2024, zero playoff rows, zero " +
      "offseason/preseason involvement. Under D-01/D-02's redefinition this team's spread ratio (spread/value " +
      "or the raw spread magnitude relative to a same-metric veteran) is expected to read WIDER than " +
      "frc4206's, since the model has seen it in far fewer matches.",
    expectPlayoffRows: 0,
  },
  {
    teamKey: "frc7111",
    year: 2025,
    algorithmId: RENAMED_ALGORITHM_ID,
    note: "2025's playoff-row entry — 27 total matches, 7 playoff rows, zero offseason/preseason involvement.",
    expectPlayoffRows: 7,
  },
  {
    teamKey: "frc2638",
    year: 2026,
    algorithmId: RENAMED_ALGORITHM_ID,
    note: "2026's playoff-row entry — 40 total matches, 11 playoff rows, zero offseason/preseason involvement.",
    expectPlayoffRows: 11,
  },
];

// ---------------------------------------------------------------------------
// Fetch + manifest resolution
// ---------------------------------------------------------------------------

interface AlgorithmsManifestEntry {
  readonly id: string;
  readonly version: string;
}

interface AlgorithmsManifestBody {
  readonly algorithms: readonly AlgorithmsManifestEntry[];
}

/**
 * Fetches and parses `v1/manifest/algorithms.json` from `origin`, returning
 * a map from algorithm id to its currently-published version. Any entry in
 * `overrides` (from `--version <id>=<ver>`) replaces the manifest's own
 * value for that id, applied last.
 */
export async function resolvePublishedVersions(
  origin: string,
  overrides: ReadonlyMap<string, string> = new Map()
): Promise<Map<string, string>> {
  const url = `${origin}/${ALGORITHMS_MANIFEST_KEY}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`resolvePublishedVersions: GET ${url} -> HTTP ${res.status}`);
  }
  const body = (await res.json()) as AlgorithmsManifestBody;
  if (!Array.isArray(body.algorithms)) {
    throw new Error(`resolvePublishedVersions: manifest at ${url} does not carry an "algorithms" array`);
  }
  const versions = new Map<string, string>();
  for (const algo of body.algorithms) {
    if (typeof algo.id !== "string" || typeof algo.version !== "string") {
      throw new Error(`resolvePublishedVersions: manifest entry missing string "id"/"version": ${JSON.stringify(algo)}`);
    }
    versions.set(algo.id, algo.version);
  }
  for (const [id, version] of overrides) {
    versions.set(id, version);
  }
  return versions;
}

export interface FreshFetchResult {
  readonly status: number;
  readonly bytes: number;
  readonly body: string | undefined;
}

/**
 * Fetches `key` from `origin`, appending a per-run cache-busting query
 * parameter and sending `cache: "no-store"` — both required so a CDN body
 * cached under `public, max-age=60` cannot masquerade as a fresh read
 * (PD-01, threat T-07-10-02).
 */
export async function fetchArtifactFresh(origin: string, key: string, runId: string): Promise<FreshFetchResult> {
  const url = `${origin}/${key}?cb=${runId}`;
  const res = await fetch(url, { cache: "no-store" });
  const bodyText = res.ok ? await res.text() : undefined;
  return {
    status: res.status,
    bytes: bodyText !== undefined ? Buffer.byteLength(bodyText, "utf8") : 0,
    body: bodyText,
  };
}

// ---------------------------------------------------------------------------
// verifyEntry — checks 3 through 10
// ---------------------------------------------------------------------------

export interface SubsetEntryObserved {
  matches?: number;
  upcoming?: number;
  teams?: number;
  rankedTeams?: number;
  recordCount?: number;
  rpCount?: number;
  percentileCount?: number;
  percentileMin?: number;
  percentileMax?: number;
  varianceRowCount?: number;
  sortTimePlayedCount?: number;
  sortTimeUpcomingCount?: number;
  allianceCount?: number;
  alliancePickHistogram?: Record<number, number>;
  allianceWithoutNameCount?: number;
  allianceWithNameCount?: number;
  metricsKeyCount?: number;
  name?: string;
  nameLength?: number;
  location?: string | null;
  week?: number | null;
}

export interface SubsetEntryResult {
  readonly entry: SubsetEntry;
  readonly key: string;
  readonly version: string;
  readonly status: number;
  readonly bytes: number;
  readonly generation?: string;
  readonly observed: SubsetEntryObserved;
  readonly failures: readonly string[];
}

/**
 * Runs checks 3 through 10 against an already-fetched, already-schema-parsed
 * artifact. Observed values are always populated, including on a pass — a
 * verifier that prints only "ok" cannot show that an expectation was
 * non-vacuous.
 */
export function verifyEntry(
  entry: SubsetEntry,
  version: string,
  artifact: EventArtifact
): { observed: SubsetEntryObserved; failures: string[] } {
  const failures: string[] = [];
  const observed: SubsetEntryObserved = {};

  // Check 3 — provenance.
  if (artifact.algorithmId !== entry.algorithmId) {
    failures.push(`provenance: algorithmId expected "${entry.algorithmId}", observed "${artifact.algorithmId}"`);
  }
  if (artifact.algorithmVersion !== version) {
    failures.push(`provenance: algorithmVersion expected "${version}" (resolved key version), observed "${artifact.algorithmVersion}"`);
  }
  if (artifact.eventKey !== entry.eventKey) {
    failures.push(`provenance: eventKey expected "${entry.eventKey}", observed "${artifact.eventKey}"`);
  }

  // Check 4 — identity (D-18 item 8).
  observed.name = artifact.name;
  observed.nameLength = artifact.name?.length;
  observed.location = "location" in artifact ? (artifact.location ?? null) : undefined;
  observed.week = "week" in artifact ? (artifact.week ?? null) : undefined;
  if (artifact.name === undefined || artifact.name.length === 0) {
    failures.push('identity: "name" absent or empty');
  }
  if (artifact.startDate === undefined || artifact.startDate.length === 0) {
    failures.push('identity: "startDate" absent or empty');
  }
  if (!("location" in artifact)) {
    failures.push('identity: "location" key absent');
  }
  if (!("week" in artifact)) {
    failures.push('identity: "week" key absent');
  }

  // Check 5 — array shape.
  observed.matches = artifact.matches.length;
  observed.upcoming = artifact.upcoming.length;
  observed.teams = artifact.teams.length;
  if (artifact.matches.length !== entry.expectMatches) {
    failures.push(`array shape: matches.length expected ${entry.expectMatches}, observed ${artifact.matches.length}`);
  }
  if (artifact.upcoming.length !== entry.expectUpcoming) {
    failures.push(`array shape: upcoming.length expected ${entry.expectUpcoming}, observed ${artifact.upcoming.length}`);
  }
  if (artifact.teams.length !== entry.expectTeams) {
    failures.push(`array shape: teams.length expected ${entry.expectTeams}, observed ${artifact.teams.length}`);
  }

  // Check 6 — rank / record / rp (D-18 item 6).
  const rankedTeams = artifact.teams.filter((t) => t.rank !== undefined);
  observed.rankedTeams = rankedTeams.length;
  if (rankedTeams.length !== entry.expectRankedTeams) {
    failures.push(`rank: ranked team count expected ${entry.expectRankedTeams}, observed ${rankedTeams.length}`);
  }
  const recordCount = artifact.teams.filter((t) => t.record !== undefined).length;
  const rpCount = artifact.teams.filter((t) => t.rp !== undefined).length;
  observed.recordCount = recordCount;
  observed.rpCount = rpCount;
  if (entry.expectRankedTeams > 0) {
    if (recordCount === 0) failures.push('record: expected at least one team with "record", observed 0');
    if (rpCount === 0) failures.push('rp: expected at least one team with "rp", observed 0');
  } else {
    if (recordCount !== 0) failures.push(`record: expected ZERO teams with "record" on a no-ranking event, observed ${recordCount}`);
    if (rpCount !== 0) failures.push(`rp: expected ZERO teams with "rp" on a no-ranking event, observed ${rpCount}`);
  }

  // Check 7 — percentile (D-10, 07-09).
  let percentileCount = 0;
  let percentileMin: number | undefined;
  let percentileMax: number | undefined;
  for (const team of artifact.teams) {
    for (const metric of Object.values(team.metrics)) {
      if (metric.percentile === undefined) continue;
      percentileCount++;
      if (percentileMin === undefined || metric.percentile < percentileMin) percentileMin = metric.percentile;
      if (percentileMax === undefined || metric.percentile > percentileMax) percentileMax = metric.percentile;
      if (metric.percentile < 0 || metric.percentile > 100) {
        failures.push(`percentile: observed value ${metric.percentile} outside [0, 100] for team ${team.teamKey}`);
      }
    }
  }
  observed.percentileCount = percentileCount;
  observed.percentileMin = percentileMin;
  observed.percentileMax = percentileMax;
  if (percentileCount === 0) {
    failures.push('percentile: expected at least one metric carrying "percentile", observed 0');
  }

  // Check 8 — per-alliance own variance (D-18 item 3).
  const playedRowsWithBothVariance = artifact.matches.filter(
    (m) => m.redScoreVarianceOwn !== undefined && m.blueScoreVarianceOwn !== undefined
  ).length;
  const anyRowsWithEitherVariance = [...artifact.matches, ...artifact.upcoming].filter(
    (m) => m.redScoreVarianceOwn !== undefined || m.blueScoreVarianceOwn !== undefined
  ).length;
  observed.varianceRowCount = entry.expectVariance === "present" ? playedRowsWithBothVariance : anyRowsWithEitherVariance;
  if (entry.expectVariance === "present") {
    if (playedRowsWithBothVariance === 0) {
      failures.push('variance: expected at least one played row carrying both redScoreVarianceOwn and blueScoreVarianceOwn, observed 0');
    }
  } else {
    if (anyRowsWithEitherVariance !== 0) {
      failures.push(`variance: expected ZERO rows carrying either variance field, observed ${anyRowsWithEitherVariance}`);
    }
  }

  // Check 9 — sortTime.
  const allRows = [...artifact.matches, ...artifact.upcoming];
  const nonIntegerSortTimes = allRows.filter((m) => m.sortTime !== undefined && !Number.isInteger(m.sortTime));
  if (nonIntegerSortTimes.length > 0) {
    failures.push(`sortTime: ${nonIntegerSortTimes.length} row(s) carry a non-integer sortTime`);
  }
  const playedSortTimeCount = artifact.matches.filter((m) => m.sortTime !== undefined).length;
  const upcomingSortTimeCount = artifact.upcoming.filter((m) => m.sortTime !== undefined).length;
  observed.sortTimePlayedCount = playedSortTimeCount;
  observed.sortTimeUpcomingCount = upcomingSortTimeCount;
  if (artifact.matches.length > 0 && playedSortTimeCount === 0) {
    failures.push('sortTime: matches.length > 0 but no played row carries sortTime');
  }
  if (artifact.upcoming.length > 0 && upcomingSortTimeCount === 0) {
    failures.push('sortTime: upcoming.length > 0 but no upcoming row carries sortTime');
  }

  // Check 10 — alliances (D-18 item 7, D-15/D-16/D-17).
  if (!("alliances" in artifact) || artifact.alliances === undefined) {
    failures.push('alliances: "alliances" key absent');
  } else {
    const alliances = artifact.alliances;
    observed.allianceCount = alliances.length;
    if (entry.expectAlliances === "empty") {
      if (alliances.length !== 0) {
        failures.push(`alliances: expected length 0, observed ${alliances.length}`);
      }
    } else {
      if (alliances.length === 0) {
        failures.push('alliances: expected a non-empty array, observed 0');
      } else {
        const numbers = alliances.map((a) => a.allianceNumber).sort((a, b) => a - b);
        const contiguous = numbers.every((n, i) => n === i + 1);
        if (!contiguous) {
          failures.push(`alliances: allianceNumber values are not contiguous 1..n, observed [${numbers.join(",")}]`);
        }
      }
      if (entry.expectAllianceCount !== undefined && alliances.length !== entry.expectAllianceCount) {
        failures.push(`alliances: expected exactly ${entry.expectAllianceCount} alliances, observed ${alliances.length}`);
      }
      if (entry.expectEveryAlliancePicks !== undefined) {
        const histogram: Record<number, number> = {};
        for (const a of alliances) histogram[a.picks.length] = (histogram[a.picks.length] ?? 0) + 1;
        observed.alliancePickHistogram = histogram;
        const badCount = alliances.filter((a) => a.picks.length !== entry.expectEveryAlliancePicks).length;
        if (badCount > 0) {
          failures.push(`alliances: expected every alliance to carry exactly ${entry.expectEveryAlliancePicks} picks, ${badCount} did not`);
        }
      }
      if (entry.expectSomeAllianceWithoutName === true) {
        const withoutName = alliances.filter((a) => a.name === undefined).length;
        observed.allianceWithoutNameCount = withoutName;
        observed.allianceWithNameCount = alliances.length - withoutName;
        if (withoutName === 0) {
          failures.push('alliances: expected at least one alliance without a "name" key, observed 0');
        }
      }
    }
  }

  observed.metricsKeyCount = artifact.teams[0] !== undefined ? Object.keys(artifact.teams[0].metrics).length : 0;

  return { observed, failures };
}

// ---------------------------------------------------------------------------
// Orchestration: resolve, fetch, parse, verify — checks 1 and 2
// ---------------------------------------------------------------------------

async function verifyOneEntry(
  origin: string,
  versions: ReadonlyMap<string, string>,
  entry: SubsetEntry,
  runId: string
): Promise<SubsetEntryResult> {
  // Check 1 — the manifest resolves.
  const version = versions.get(entry.algorithmId);
  if (version === undefined) {
    return {
      entry,
      key: "(unresolved)",
      version: "(unresolved)",
      status: 0,
      bytes: 0,
      observed: {},
      failures: [`manifest: no published version found for algorithm "${entry.algorithmId}"`],
    };
  }
  const key = artifactKey({ page: "event", eventKey: entry.eventKey, algorithmId: entry.algorithmId, version });

  // Check 2 — the artifact fetch is fresh and parsed.
  const fetched = await fetchArtifactFresh(origin, key, runId);
  if (fetched.status !== 200 || fetched.body === undefined) {
    return {
      entry,
      key,
      version,
      status: fetched.status,
      bytes: fetched.bytes,
      observed: {},
      failures: [`fetch: GET ${origin}/${key} -> HTTP ${fetched.status}`],
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(fetched.body);
  } catch (err) {
    return {
      entry,
      key,
      version,
      status: fetched.status,
      bytes: fetched.bytes,
      observed: {},
      failures: [`parse: response body is not valid JSON — ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const parsed = EventArtifactSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return {
      entry,
      key,
      version,
      status: fetched.status,
      bytes: fetched.bytes,
      observed: {},
      failures: [`parse: EventArtifactSchema.safeParse failed — ${issues.join("; ")}`],
    };
  }

  const artifact = parsed.data;
  const { observed, failures } = verifyEntry(entry, version, artifact);
  return {
    entry,
    key,
    version,
    status: fetched.status,
    bytes: fetched.bytes,
    generation: artifact.generation,
    observed,
    failures,
  };
}

// ---------------------------------------------------------------------------
// verifyTeamEntry — checks 11 through 13 (plan 07-17, PD-03)
// ---------------------------------------------------------------------------

const PLAYOFF_COMP_LEVELS = new Set(["ef", "qf", "sf", "f"]);
/** D-18.4: these four own properties must never appear on a playoff-comp-level match row — see `packages/harness/pageArtifacts.ts`'s `TeamSeasonMatchSchema` doc comments for the full per-bonus contract these fields carry on a QUALIFICATION row. */
const BONUS_RP_OWN_PROPERTIES = ["redBonusRp", "blueBonusRp", "actualRedBonusRp", "actualBlueBonusRp"] as const;

export interface TeamMetricCensusRow {
  readonly name: string;
  readonly value: number;
  readonly spread: number | undefined;
  readonly percentile: number | undefined;
}

export interface TeamEntryObserved {
  playoffRowCount?: number;
  stalePropertiesFound?: readonly string[];
  generation?: string;
  metricCensus?: readonly TeamMetricCensusRow[];
}

export interface TeamSubsetEntryResult {
  readonly entry: TeamSubsetEntry;
  readonly key: string;
  readonly version: string;
  readonly status: number;
  readonly bytes: number;
  readonly generation?: string;
  readonly observed: TeamEntryObserved;
  readonly failures: readonly string[];
}

/**
 * Runs checks 11 through 13 against an already-fetched, already-schema-parsed
 * team-season artifact. `raw` is the SAME body's plain `JSON.parse` result
 * (not the Zod-parsed `artifact`) — check 11's `hasOwnProperty` assertion is
 * made against it deliberately, per this plan's own instruction, so the
 * check reflects exactly what bytes were published rather than anything a
 * schema's own optional-field handling could normalize away.
 */
export function verifyTeamEntry(
  entry: TeamSubsetEntry,
  artifact: TeamSeasonArtifact,
  raw: unknown
): { observed: TeamEntryObserved; failures: string[] } {
  const failures: string[] = [];
  const observed: TeamEntryObserved = {};

  // Check 11 — playoff bonus-RP absence (D-18.4), over the RAW JSON.
  let playoffRowCount = 0;
  const stalePropertiesFound = new Set<string>();
  const rawEvents = Array.isArray((raw as { events?: unknown }).events) ? ((raw as { events: unknown[] }).events) : [];
  for (const rawEvent of rawEvents) {
    const rawMatches = Array.isArray((rawEvent as { matches?: unknown }).matches) ? ((rawEvent as { matches: unknown[] }).matches) : [];
    for (const rawMatch of rawMatches) {
      const row = rawMatch as Record<string, unknown>;
      if (typeof row.compLevel === "string" && PLAYOFF_COMP_LEVELS.has(row.compLevel)) {
        playoffRowCount++;
        for (const propertyName of BONUS_RP_OWN_PROPERTIES) {
          if (Object.prototype.hasOwnProperty.call(row, propertyName)) {
            stalePropertiesFound.add(propertyName);
          }
        }
      }
    }
  }
  observed.playoffRowCount = playoffRowCount;
  observed.stalePropertiesFound = [...stalePropertiesFound];
  if (playoffRowCount !== entry.expectPlayoffRows) {
    failures.push(`playoffRows: expected ${entry.expectPlayoffRows}, observed ${playoffRowCount}`);
  }
  if (playoffRowCount === 0) {
    failures.push("bonusRpAbsence: zero playoff rows observed — the absence assertion below is vacuous against this artifact");
  } else if (stalePropertiesFound.size > 0) {
    failures.push(
      `bonusRpAbsence: ${playoffRowCount} playoff row(s) checked, ${stalePropertiesFound.size} carry a stale own property: ${[...stalePropertiesFound].join(", ")}`
    );
  }

  // Check 12 — generation uniformity (reported by the caller across every fetched entry in the run; recorded here per-entry).
  observed.generation = artifact.generation;

  // Check 13 — the metric census (raw material for Task 4's old-vs-new spread comparison).
  const metricCensus: TeamMetricCensusRow[] = Object.entries(artifact.seasonStats.metrics).map(([name, metric]) => ({
    name,
    value: metric.value,
    spread: metric.spread,
    percentile: metric.percentile,
  }));
  observed.metricCensus = metricCensus;
  for (const row of metricCensus) {
    if (row.percentile !== undefined && (row.percentile < 0 || row.percentile > 100)) {
      failures.push(`metricCensus: metric "${row.name}" percentile ${row.percentile} outside [0, 100]`);
    }
  }

  return { observed, failures };
}

async function verifyOneTeamEntry(
  origin: string,
  versions: ReadonlyMap<string, string>,
  entry: TeamSubsetEntry,
  runId: string
): Promise<TeamSubsetEntryResult> {
  const version = versions.get(entry.algorithmId);
  if (version === undefined) {
    return {
      entry,
      key: "(unresolved)",
      version: "(unresolved)",
      status: 0,
      bytes: 0,
      observed: {},
      failures: [`manifest: no published version found for algorithm "${entry.algorithmId}"`],
    };
  }
  const key = artifactKey({ page: "team", teamKey: entry.teamKey, year: entry.year, algorithmId: entry.algorithmId, version });

  const fetched = await fetchArtifactFresh(origin, key, runId);
  if (fetched.status !== 200 || fetched.body === undefined) {
    return {
      entry,
      key,
      version,
      status: fetched.status,
      bytes: fetched.bytes,
      observed: {},
      failures: [`fetch: GET ${origin}/${key} -> HTTP ${fetched.status}`],
    };
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(fetched.body);
  } catch (err) {
    return {
      entry,
      key,
      version,
      status: fetched.status,
      bytes: fetched.bytes,
      observed: {},
      failures: [`parse: response body is not valid JSON — ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const parsed = TeamSeasonArtifactSchema.safeParse(rawJson);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return {
      entry,
      key,
      version,
      status: fetched.status,
      bytes: fetched.bytes,
      observed: {},
      failures: [`parse: TeamSeasonArtifactSchema.safeParse failed — ${issues.join("; ")}`],
    };
  }

  const { observed, failures } = verifyTeamEntry(entry, parsed.data, rawJson);
  return {
    entry,
    key,
    version,
    status: fetched.status,
    bytes: fetched.bytes,
    generation: parsed.data.generation,
    observed,
    failures,
  };
}

function formatTeamResultLine(result: TeamSubsetEntryResult): string {
  const o = result.observed;
  const census = (o.metricCensus ?? []).map((r) => `${r.name}=${r.value}${r.spread !== undefined ? `±${r.spread}` : ""}${r.percentile !== undefined ? `[p${r.percentile}]` : ""}`).join(" ");
  return (
    `${result.entry.teamKey}/${result.entry.year}/${result.entry.algorithmId} [${result.key}] status=${result.status} ` +
    `bytes=${result.bytes} generation=${result.generation ?? "-"} playoffRows=${o.playoffRowCount ?? "-"} ` +
    `staleProperties=${(o.stalePropertiesFound ?? []).join(",") || "-"} metrics: ${census || "-"}`
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  readonly origin: string;
  readonly only: readonly string[];
  readonly algorithm: string | undefined;
  readonly versionOverrides: ReadonlyMap<string, string>;
  readonly baseline: boolean;
  readonly json: boolean;
  /** Run PUBLISHED_TEAM_SUBSET (checks 11-13) instead of PUBLISHED_SUBSET (checks 1-10). */
  readonly teamOnly: boolean;
  /** For each team entry, ALSO fetch the same team-season under this other algorithm id and print a side-by-side metric/spread-ratio table. Print-only — no assertion. Requires --team-only. */
  readonly compareLegacy: string | undefined;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      origin: { type: "string" },
      only: { type: "string", multiple: true },
      algorithm: { type: "string" },
      version: { type: "string", multiple: true },
      baseline: { type: "boolean" },
      json: { type: "boolean" },
      "team-only": { type: "boolean" },
      "compare-legacy": { type: "string" },
    },
  });
  const versionOverrides = new Map<string, string>();
  for (const raw of values.version ?? []) {
    const eq = raw.indexOf("=");
    if (eq === -1) throw new Error(`--version expects "<id>=<version>", got "${raw}"`);
    versionOverrides.set(raw.slice(0, eq), raw.slice(eq + 1));
  }
  if (values["compare-legacy"] !== undefined && values["team-only"] !== true) {
    throw new Error("--compare-legacy requires --team-only");
  }
  return {
    origin: values.origin ?? DEFAULT_ARTIFACT_ORIGIN,
    only: values.only ?? [],
    algorithm: values.algorithm,
    versionOverrides,
    baseline: values.baseline === true,
    json: values.json === true,
    teamOnly: values["team-only"] === true,
    compareLegacy: values["compare-legacy"],
  };
}

function filterSubset(options: CliOptions): readonly SubsetEntry[] {
  return PUBLISHED_SUBSET.filter((entry) => {
    if (options.only.length > 0 && !options.only.includes(entry.eventKey)) return false;
    if (options.algorithm !== undefined && entry.algorithmId !== options.algorithm) return false;
    return true;
  });
}

function filterTeamSubset(options: CliOptions): readonly TeamSubsetEntry[] {
  return PUBLISHED_TEAM_SUBSET.filter((entry) => {
    if (options.only.length > 0 && !options.only.includes(entry.teamKey)) return false;
    if (options.algorithm !== undefined && entry.algorithmId !== options.algorithm) return false;
    return true;
  });
}

/**
 * Print-only, no assertion (PD-08's published corroboration, Task 4): for
 * one team entry ALREADY verified under its own (renamed) algorithm id,
 * fetches the SAME team-season under `legacyAlgorithmId` and prints both
 * metric tables side by side with the per-metric spread ratio
 * (renamed/legacy) — the direct read that lets a low-match team's WIDER
 * `spread` ratio (relative to a veteran's) be seen against real published
 * bytes, isolating D-01/D-02's `√(P+R)` redefinition from the
 * offseason-inclusion methodology change.
 */
async function printLegacyComparison(
  origin: string,
  versions: ReadonlyMap<string, string>,
  entry: TeamSubsetEntry,
  renamedCensus: readonly TeamMetricCensusRow[],
  legacyAlgorithmId: string,
  runId: string
): Promise<void> {
  const legacyVersion = versions.get(legacyAlgorithmId);
  if (legacyVersion === undefined) {
    console.log(`  --compare-legacy ${legacyAlgorithmId}: no published version found for "${legacyAlgorithmId}"`);
    return;
  }
  const legacyKey = artifactKey({ page: "team", teamKey: entry.teamKey, year: entry.year, algorithmId: legacyAlgorithmId, version: legacyVersion });
  const fetched = await fetchArtifactFresh(origin, legacyKey, runId);
  if (fetched.status !== 200 || fetched.body === undefined) {
    console.log(`  --compare-legacy ${legacyAlgorithmId}: GET ${origin}/${legacyKey} -> HTTP ${fetched.status}`);
    return;
  }
  const parsed = TeamSeasonArtifactSchema.safeParse(JSON.parse(fetched.body));
  if (!parsed.success) {
    console.log(`  --compare-legacy ${legacyAlgorithmId}: parse failed`);
    return;
  }
  const legacyMetrics = parsed.data.seasonStats.metrics;
  console.log(`  --compare-legacy ${legacyAlgorithmId} [${legacyKey}] generation=${parsed.data.generation}`);
  const metricNames = new Set([...renamedCensus.map((r) => r.name), ...Object.keys(legacyMetrics)]);
  for (const name of [...metricNames].sort()) {
    const renamedRow = renamedCensus.find((r) => r.name === name);
    const legacyMetric = legacyMetrics[name];
    const renamedSpread = renamedRow?.spread;
    const legacySpread = legacyMetric?.spread;
    const ratio = renamedSpread !== undefined && legacySpread !== undefined && legacySpread !== 0 ? renamedSpread / legacySpread : undefined;
    console.log(
      `    ${name}: renamed=${renamedRow?.value ?? "-"}±${renamedSpread ?? "-"} legacy=${legacyMetric?.value ?? "-"}±${legacySpread ?? "-"} ratio=${ratio ?? "-"}`
    );
  }
}

function formatResultLine(result: SubsetEntryResult): string {
  const o = result.observed;
  return (
    `${result.entry.eventKey}/${result.entry.algorithmId} [${result.key}] status=${result.status} bytes=${result.bytes} ` +
    `generation=${result.generation ?? "-"} matches=${o.matches ?? "-"} upcoming=${o.upcoming ?? "-"} teams=${o.teams ?? "-"} ` +
    `ranked=${o.rankedTeams ?? "-"} record=${o.recordCount ?? "-"} rp=${o.rpCount ?? "-"} ` +
    `percentile=${o.percentileCount ?? "-"}[${o.percentileMin ?? "-"}..${o.percentileMax ?? "-"}] ` +
    `varianceRows=${o.varianceRowCount ?? "-"} sortTime(played/upcoming)=${o.sortTimePlayedCount ?? "-"}/${o.sortTimeUpcomingCount ?? "-"} ` +
    `alliances=${o.allianceCount ?? "-"} metricsKeys=${o.metricsKeyCount ?? "-"} name=${JSON.stringify(o.name ?? null)} ` +
    `(len ${o.nameLength ?? "-"}) location=${JSON.stringify(o.location ?? null)} week=${JSON.stringify(o.week ?? null)}`
  );
}

/** Check 12 — generation uniformity. Reported at the end of a run, informational only (never a per-entry failure): more than one distinct generation among entries this SAME publish run was supposed to have produced is the observable signature of a resumed or interrupted pass. */
function reportGenerationUniformity(label: string, generations: readonly (string | undefined)[]): void {
  const distinct = new Set(generations.filter((g): g is string => g !== undefined));
  if (distinct.size <= 1) {
    console.log(`\ngeneration uniformity (${label}): ${distinct.size} distinct value(s) — ${[...distinct].join(", ") || "(none fetched)"}`);
  } else {
    console.log(
      `\ngeneration uniformity (${label}): FINDING — ${distinct.size} distinct values across entries expected from one pass: [${[...distinct].join(", ")}] — the observable signature of a resumed or interrupted publish run.`
    );
  }
}

async function runTeamMode(options: CliOptions): Promise<void> {
  const entries = filterTeamSubset(options);
  if (entries.length === 0) {
    console.error("verify:subset --team-only: no PUBLISHED_TEAM_SUBSET entries matched --only/--algorithm filters");
    process.exit(1);
  }
  const versions = await resolvePublishedVersions(options.origin, options.versionOverrides);
  const runId = randomUUID();

  const results: TeamSubsetEntryResult[] = [];
  for (const entry of entries) {
    const result = await verifyOneTeamEntry(options.origin, versions, entry, runId);
    results.push(result);
    if (!options.json) {
      console.log(formatTeamResultLine(result));
      for (const failure of result.failures) {
        console.log(`  FAIL ${result.entry.teamKey}/${result.entry.year}/${result.entry.algorithmId}: ${failure}`);
      }
      if (options.compareLegacy !== undefined && result.observed.metricCensus !== undefined) {
        await printLegacyComparison(options.origin, versions, entry, result.observed.metricCensus, options.compareLegacy, runId);
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const failingEntries = results.filter((r) => r.failures.length > 0).length;
    const totalFailures = results.reduce((n, r) => n + r.failures.length, 0);
    console.log(`\n${entries.length} team entr${entries.length === 1 ? "y" : "ies"} checked, ${failingEntries} failing, ${totalFailures} total failure(s).`);
    // The control entry (algorithmId "sigma1") is deliberately excluded from
    // the "one pass" generation-uniformity scope — it comes from an older
    // publish run by design (07-10), not this run.
    reportGenerationUniformity(
      "team subset, non-control",
      results.filter((r) => r.entry.algorithmId !== "sigma1").map((r) => r.generation)
    );
  }

  if (results.some((r) => r.failures.length > 0)) {
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.teamOnly) {
    await runTeamMode(options);
    return;
  }

  const entries = filterSubset(options);
  if (entries.length === 0) {
    console.error("verify:subset: no PUBLISHED_SUBSET entries matched --only/--algorithm filters");
    process.exit(1);
  }

  const versions = await resolvePublishedVersions(options.origin, options.versionOverrides);
  const runId = randomUUID();

  if (options.baseline) {
    const rows: Array<{ eventKey: string; algorithmId: string; key: string; status: number; bytes: number; generation: string | undefined }> = [];
    for (const entry of entries) {
      const version = versions.get(entry.algorithmId) ?? "(unresolved)";
      const key = artifactKey({ page: "event", eventKey: entry.eventKey, algorithmId: entry.algorithmId, version });
      const fetched = await fetchArtifactFresh(options.origin, key, runId);
      let generation: string | undefined;
      if (fetched.status === 200 && fetched.body !== undefined) {
        try {
          generation = (JSON.parse(fetched.body) as { generation?: string }).generation;
        } catch {
          generation = undefined;
        }
      }
      rows.push({ eventKey: entry.eventKey, algorithmId: entry.algorithmId, key, status: fetched.status, bytes: fetched.bytes, generation });
      if (!options.json) {
        console.log(
          `${entry.eventKey}/${entry.algorithmId}: status=${fetched.status} bytes=${fetched.bytes} generation=${generation ?? "-"} key=${key}`
        );
      }
    }
    if (options.json) console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const results: SubsetEntryResult[] = [];
  for (const entry of entries) {
    results.push(await verifyOneEntry(options.origin, versions, entry, runId));
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      console.log(formatResultLine(result));
      for (const failure of result.failures) {
        console.log(`  FAIL ${result.entry.eventKey}/${result.entry.algorithmId}: ${failure}`);
      }
    }
    const failingEntries = results.filter((r) => r.failures.length > 0).length;
    const totalFailures = results.reduce((n, r) => n + r.failures.length, 0);
    console.log(`\n${entries.length} entr${entries.length === 1 ? "y" : "ies"} checked, ${failingEntries} failing, ${totalFailures} total failure(s).`);
    // Check 12: the "one pass" scope is every entry NOT in the `sigma1`
    // old-key control (PRE_RENAME_EVENT_SUBSET's own sigma1 rows) — those
    // are deliberately from an OLDER run (07-10's) and mixing them in would
    // manufacture a false finding every time.
    reportGenerationUniformity(
      "event subset, non-control",
      results.filter((r) => r.entry.algorithmId !== "sigma1").map((r) => r.generation)
    );
  }

  if (results.some((r) => r.failures.length > 0)) {
    process.exit(1);
  }
}

// Guard: only auto-run `main()` when this file is the process entry point.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("verify:subset failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
