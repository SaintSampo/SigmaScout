/**
 * D-05's failing test half of the payload budget: parses the machine-
 * readable `json budget` block Task 2 wrote into `docs/publish-budget.md`
 * and asserts the committed budget is well-formed, internally consistent,
 * holds an absolute ceiling on the two D-05-named at-risk artifacts (the
 * year-wide teams table and the 292-match team page), and that a fresh
 * re-measurement of a small real slice stays inside it. `docs/publish-
 * budget.md` is this suite's ONLY input — no other file's numbers feed it.
 *
 * A missing or corrupted machine-readable block is a loud, named failure
 * (`PublishBudgetParseError`), never a silent skip — that is what makes the
 * non-vacuity guard below meaningful (`baselineFingerprint.test.ts`'s
 * "committed baseline fingerprints" suite is the precedent this mirrors:
 * assert a minimum population so the suite cannot go green on an empty
 * budget). Re-measurement re-runs the SAME `packages/harness/publish.ts`
 * assembly functions (`buildEventArtifact`/`buildTeamSeasonArtifact`)
 * rather than re-implementing a size calculation, matching `digest.test.ts`'s
 * closest analog: a real produced artifact measured against a committed
 * expectation, failing loudly on drift.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly, selectMatchesChronological } from "../corpus/db.js";
import { opr } from "../core/algorithms/opr.js";
import { buildEventArtifact, buildTeamSeasonArtifact } from "./publish.js";
import { WalkForwardSimulator, type PredictionRecord } from "./replay.js";

// ---------------------------------------------------------------------------
// The parser — this file's single source for docs/publish-budget.md
// ---------------------------------------------------------------------------

const BUDGET_DOC_PATH = join("docs", "publish-budget.md");
const BUDGET_BLOCK_PATTERN = /```json budget\r?\n([\s\S]*?)\r?\n```/;

export class PublishBudgetParseError extends Error {
  constructor(reason: string) {
    super(`payloadBudget: could not read the machine-readable "json budget" block from ${BUDGET_DOC_PATH} — ${reason}`);
    this.name = "PublishBudgetParseError";
  }
}

interface PublishBudgetPageEntry {
  count: number;
  medianBytes: number;
  p95Bytes: number;
  maxBytes: number;
  budgetMaxBytes: number;
  largestKey: string;
}

interface PublishBudget {
  measuredAt: string;
  run: string;
  pages: Record<string, PublishBudgetPageEntry>;
}

/** Extracted so `describe("parser robustness")` below can drive it directly against a fixture with no real file on disk — a missing/corrupt block must fail loudly, demonstrated as a unit test over this function, never by editing the real committed doc. */
export function parsePublishBudget(markdown: string): PublishBudget {
  const match = BUDGET_BLOCK_PATTERN.exec(markdown);
  if (!match) {
    throw new PublishBudgetParseError(`no fenced \`\`\`json budget block found`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]!);
  } catch (err) {
    throw new PublishBudgetParseError(`the block did not parse as JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parsed as PublishBudget;
}

function readCommittedPublishBudget(): PublishBudget {
  if (!existsSync(BUDGET_DOC_PATH)) {
    throw new PublishBudgetParseError(`${BUDGET_DOC_PATH} does not exist`);
  }
  return parsePublishBudget(readFileSync(BUDGET_DOC_PATH, "utf8"));
}

const PAGE_KINDS = ["teams", "team", "events", "event", "compare"] as const;

/**
 * D-05's two named at-risk artifacts get an absolute ceiling written into
 * THIS TEST, not just the committed `budgetMaxBytes` — the assertion that
 * fires when a future change makes the teams table or the 292-match team
 * page structurally bigger, rather than merely noisier.
 *
 * Both bounds come from the real full 2022-2026 publish run recorded in
 * `docs/publish-budget.md` (`pnpm publish:seasons`, completed
 * 2026-08-25T19:10:49Z — plan 06-06's authorized republish carrying D-01..D-05's
 * team-artifact fields — 54,671 page objects across 5 seasons × 3 algorithms):
 *   - teams: measured max 2,721,887 bytes (`v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json`, [pre-rename]
 *     the committed `budgetMaxBytes` is 3,500,000) — this bound (5,000,000) sits well above
 *     that committed ceiling, so raising `budgetMaxBytes` for ordinary season-to-season growth
 *     does not also require touching this test. Unchanged by plan 06-06's run — Phase 6's new
 *     fields land only on the per-team artifact, not this one (06-RESEARCH.md Open Question 2).
 *   - team: measured max 304,862 bytes (`v1/team/frc118/2024/sigma1@2.0.0+tuned-2026-08.json`, [pre-rename]
 *     the committed `budgetMaxBytes` is 375,000) — this bound (600,000) gives the same clear
 *     headroom above the committed ceiling. Moved from a pre-Phase-6 287,264-byte baseline
 *     (+17,598 bytes, +6.13%) by D-01..D-05's own-variance/actual-RP/percentile/robotImageUrl/
 *     activeYears additions; still 70,138 bytes (18.70%) under the committed budget.
 */
const TEAMS_PAGE_ABSOLUTE_MAX_BYTES = 5_000_000;
const TEAM_PAGE_ABSOLUTE_MAX_BYTES = 600_000;

// ---------------------------------------------------------------------------
// Parser robustness — never a silent skip on a missing/corrupt budget block
// ---------------------------------------------------------------------------

describe("parser robustness (never a silent skip on a missing/corrupt budget block)", () => {
  it("throws a named PublishBudgetParseError when no json budget block is present", () => {
    expect(() => parsePublishBudget("# Some doc\n\nNo machine-readable block here.\n")).toThrow(PublishBudgetParseError);
  });

  it("throws a named PublishBudgetParseError when the block is not valid JSON", () => {
    expect(() => parsePublishBudget("```json budget\n{ not valid json\n```\n")).toThrow(PublishBudgetParseError);
  });

  it("parses a well-formed fixture block", () => {
    const fixture = '```json budget\n{"measuredAt":"2026-01-01T00:00:00.000Z","run":"test","pages":{}}\n```\n';
    expect(() => parsePublishBudget(fixture)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The committed budget doc itself
// ---------------------------------------------------------------------------

describe("published payload budget (D-05)", () => {
  // Reading the committed budget happens once, at describe-time, so a
  // missing/corrupt docs/publish-budget.md fails every test below loudly
  // (via the throw inside readCommittedPublishBudget) rather than skipping
  // the suite silently.
  const budget = readCommittedPublishBudget();

  it("carries every page kind with finite positive stats and a v1/-prefixed largestKey (non-vacuity guard)", () => {
    for (const kind of PAGE_KINDS) {
      const entry = budget.pages[kind];
      expect(entry, `missing budget entry for page kind "${kind}"`).toBeDefined();
      expect(Number.isFinite(entry!.count) && entry!.count > 0, `${kind}.count`).toBe(true);
      expect(Number.isFinite(entry!.medianBytes) && entry!.medianBytes > 0, `${kind}.medianBytes`).toBe(true);
      expect(Number.isFinite(entry!.p95Bytes) && entry!.p95Bytes > 0, `${kind}.p95Bytes`).toBe(true);
      expect(Number.isFinite(entry!.maxBytes) && entry!.maxBytes > 0, `${kind}.maxBytes`).toBe(true);
      expect(Number.isFinite(entry!.budgetMaxBytes) && entry!.budgetMaxBytes > 0, `${kind}.budgetMaxBytes`).toBe(true);
      expect(entry!.largestKey.startsWith("v1/"), `${kind}.largestKey should start with "v1/", got "${entry!.largestKey}"`).toBe(true);
    }
  });

  it("is internally consistent: medianBytes <= p95Bytes <= maxBytes <= budgetMaxBytes for every page kind", () => {
    for (const kind of PAGE_KINDS) {
      const entry = budget.pages[kind]!;
      expect(entry.medianBytes, `${kind}: medianBytes (${entry.medianBytes}) should be <= p95Bytes (${entry.p95Bytes})`).toBeLessThanOrEqual(
        entry.p95Bytes
      );
      expect(entry.p95Bytes, `${kind}: p95Bytes (${entry.p95Bytes}) should be <= maxBytes (${entry.maxBytes})`).toBeLessThanOrEqual(
        entry.maxBytes
      );
      expect(entry.maxBytes, `${kind}: maxBytes (${entry.maxBytes}) should be <= budgetMaxBytes (${entry.budgetMaxBytes})`).toBeLessThanOrEqual(
        entry.budgetMaxBytes
      );
    }
  });

  it("carries a measuredAt timestamp and a run string naming the exact command executed", () => {
    expect(budget.measuredAt.length).toBeGreaterThan(0);
    expect(budget.run.length).toBeGreaterThan(0);
  });

  it("teams page (the year-wide table, D-05's first at-risk artifact) stays under its absolute upper bound", () => {
    const entry = budget.pages.teams!;
    expect(
      entry.maxBytes,
      `teams page maxBytes (${entry.maxBytes}) exceeded the absolute ceiling (${TEAMS_PAGE_ABSOLUTE_MAX_BYTES}) — the teams table grew structurally bigger, not just noisier; shrink it or deliberately raise this bound alongside a re-measured budget`
    ).toBeLessThan(TEAMS_PAGE_ABSOLUTE_MAX_BYTES);
  });

  it("team page (the 292-match outlier, D-05's second at-risk artifact) stays under its absolute upper bound", () => {
    const entry = budget.pages.team!;
    expect(
      entry.maxBytes,
      `team page maxBytes (${entry.maxBytes}) exceeded the absolute ceiling (${TEAM_PAGE_ABSOLUTE_MAX_BYTES}) — the team page grew structurally bigger, not just noisier; shrink it or deliberately raise this bound alongside a re-measured budget`
    ).toBeLessThan(TEAM_PAGE_ABSOLUTE_MAX_BYTES);
  });
});

// ---------------------------------------------------------------------------
// Fresh re-measurement against a small real slice — the actual regression guard
// ---------------------------------------------------------------------------

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);
/** A real, stable event confirmed present in the full 2022-2026 corpus (plan 04-01/04-04's own real publish runs both used it) — small enough (a single regional's worth of matches) to stay well under the 60-second feedback ceiling. */
const SAMPLE_EVENT_KEY = "2026azfg";

(CORPUS_AVAILABLE ? describe : describe.skip)(
  "fresh re-measurement of a small real slice matches the committed budget (requires data/corpus.sqlite — skipped: not present in this environment)",
  () => {
    const budget = readCommittedPublishBudget();

    it(`builds one real event's artifact (${SAMPLE_EVENT_KEY}, opr) through publish.ts's own assembly path and stays within the event page's budgetMaxBytes`, () => {
      const db = openCorpusReadOnly(CORPUS_PATH);
      try {
        const matches = selectMatchesChronological(db, { eventKey: SAMPLE_EVENT_KEY });
        expect(matches.length, `expected real matches for ${SAMPLE_EVENT_KEY} in the corpus`).toBeGreaterThan(0);
        const teams = Array.from(new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams])));

        const simulator = new WalkForwardSimulator(matches);
        const records = simulator.runAll([opr], teams);
        const predictions: PredictionRecord[] = records.map((r) => ({ match: r.match, prediction: r.prediction }));

        const artifact = buildEventArtifact({
          eventKey: SAMPLE_EVENT_KEY,
          season: 2026,
          algorithmId: opr.id,
          algorithmVersion: opr.version,
          predictions,
          generation: "payload-budget-test",
          computedAt: "2026-01-01T00:00:00.000Z",
        });
        const bytes = Buffer.byteLength(JSON.stringify(artifact), "utf8");
        const eventBudget = budget.pages.event!;
        expect(
          bytes,
          `fresh event artifact (${bytes} bytes) exceeded the committed event page budgetMaxBytes (${eventBudget.budgetMaxBytes})`
        ).toBeLessThanOrEqual(eventBudget.budgetMaxBytes);
      } finally {
        db.close();
      }
    });

    it(`builds one real team's season artifact (from ${SAMPLE_EVENT_KEY}'s roster, opr) and stays within the team page's budgetMaxBytes`, () => {
      const db = openCorpusReadOnly(CORPUS_PATH);
      try {
        const matches = selectMatchesChronological(db, { eventKey: SAMPLE_EVENT_KEY });
        expect(matches.length).toBeGreaterThan(0);
        const teams = Array.from(new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
        const sampleTeam = teams[0]!;

        const simulator = new WalkForwardSimulator(matches);
        const records = simulator.runAll([opr], teams);
        const teamMatches: PredictionRecord[] = records
          .filter((r) => [...r.match.redTeams, ...r.match.blueTeams].includes(sampleTeam))
          .map((r) => ({ match: r.match, prediction: r.prediction }));

        const artifact = buildTeamSeasonArtifact({
          teamKey: sampleTeam,
          teamNumber: Number.parseInt(sampleTeam.replace(/^frc/, ""), 10) || 0,
          nickname: "",
          season: 2026,
          algorithmId: opr.id,
          algorithmVersion: opr.version,
          seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {} },
          events: [{ eventKey: SAMPLE_EVENT_KEY, eventName: SAMPLE_EVENT_KEY, startDate: "2026-01-01", matches: teamMatches }],
          metricHistory: [],
          generation: "payload-budget-test",
          computedAt: "2026-01-01T00:00:00.000Z",
        });
        const bytes = Buffer.byteLength(JSON.stringify(artifact), "utf8");
        const teamBudget = budget.pages.team!;
        expect(
          bytes,
          `fresh team-season artifact (${bytes} bytes) exceeded the committed team page budgetMaxBytes (${teamBudget.budgetMaxBytes}) — note this is a ONE-EVENT slice, so it is expected to be well under budget, not close to it; a value approaching the full-season budget here would itself be suspicious`
        ).toBeLessThanOrEqual(teamBudget.budgetMaxBytes);
      } finally {
        db.close();
      }
    });
  }
);
