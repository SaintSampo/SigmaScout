/**
 * The failing test half of the payload budget: parses the machine-readable
 * `json budget` block written into `docs/publish-budget.md` and asserts the
 * committed budget is well-formed, internally consistent, holds an
 * absolute ceiling on the at-risk artifacts (the year-wide teams table and
 * the largest team page), and that a fresh re-measurement of a small real
 * slice stays inside it. `docs/publish-budget.md` is this suite's ONLY
 * input — no other file's numbers feed it.
 *
 * A missing or corrupted machine-readable block is a loud, named failure
 * (`PublishBudgetParseError`), never a silent skip — that is what makes the
 * non-vacuity guard below meaningful: assert a minimum population so the
 * suite cannot go green on an empty budget. Re-measurement re-runs the SAME
 * `packages/harness/publish.ts` assembly functions
 * (`buildEventArtifact`/`buildTeamSeasonArtifact`) rather than
 * re-implementing a size calculation: a real produced artifact measured
 * against a committed expectation, failing loudly on drift.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly, selectMatchesChronological } from "../corpus/db.js";
import { opr } from "../core/algorithms/opr.js";
import { buildEventArtifact, buildTeamSeasonArtifact } from "./publish.js";
import {
  PAGE_BUDGET_MAX_BYTES,
  parsePublishBudget,
  PUBLISH_BUDGET_DOC_PATH,
  PublishBudgetParseError,
  type PublishBudget,
} from "./publishBudget.js";
import { WalkForwardSimulator, type PredictionRecord } from "./replay.js";

// ---------------------------------------------------------------------------
// The committed doc — parsed through publishBudget.ts, the one home for the
// block's parser and the ceilings it must mirror
// ---------------------------------------------------------------------------

function readCommittedPublishBudget(): PublishBudget {
  if (!existsSync(PUBLISH_BUDGET_DOC_PATH)) {
    throw new PublishBudgetParseError(`${PUBLISH_BUDGET_DOC_PATH} does not exist`);
  }
  return parsePublishBudget(readFileSync(PUBLISH_BUDGET_DOC_PATH, "utf8"));
}

const PAGE_KINDS = ["teams", "team", "events", "event", "compare"] as const;

/**
 * The two named at-risk artifacts get an absolute ceiling written into
 * THIS TEST, not just the committed `budgetMaxBytes` — the assertion that
 * fires when a future change makes the teams table or the largest team
 * page structurally bigger, rather than merely noisier.
 *
 * Both bounds sit well above the committed `budgetMaxBytes` measured from a
 * real full-corpus publish run, so raising `budgetMaxBytes` for ordinary
 * season-to-season growth does not also require touching this test.
 */
const TEAMS_PAGE_ABSOLUTE_MAX_BYTES = 5_000_000;
const TEAM_PAGE_ABSOLUTE_MAX_BYTES = 600_000;

/**
 * The `event` page kind's own absolute ceiling, added because the "is
 * internally consistent" test above cannot fire for `event` while a
 * `teams` breach elsewhere is open — that single `it(...)` iterates
 * `PAGE_KINDS` in order (`teams, team, events, event, compare`) inside ONE
 * test body, so the `teams` iteration's thrown assertion aborts the loop
 * before `event` is ever reached. Unlike
 * `TEAMS_PAGE_ABSOLUTE_MAX_BYTES`/`TEAM_PAGE_ABSOLUTE_MAX_BYTES` above, this
 * bound intentionally EQUALS the committed `pages.event.budgetMaxBytes`
 * (350,000) rather than sitting above it — headroom above it here would
 * defeat the point of a dedicated, reachable gate. This is deliberately
 * its own `it(...)`, not folded into the internal-consistency block, so it
 * can be run and observed in isolation via a name filter
 * (`-t EVENT_PAGE_ABSOLUTE_MAX_BYTES`).
 */
const EVENT_PAGE_ABSOLUTE_MAX_BYTES = 350_000;

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

describe("published payload budget", () => {
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

  it("every page kind's committed budgetMaxBytes equals PAGE_BUDGET_MAX_BYTES — the constant is the one home for ceilings; the doc mirrors it", () => {
    for (const kind of PAGE_KINDS) {
      expect(
        budget.pages[kind]?.budgetMaxBytes,
        `${kind}: docs/publish-budget.md's budgetMaxBytes must equal PAGE_BUDGET_MAX_BYTES.${kind} (${PAGE_BUDGET_MAX_BYTES[kind]}) — edit the constant, then let \`pnpm publish:seasons\` (--write-budget) rewrite the block, or update the block by hand to match`
      ).toBe(PAGE_BUDGET_MAX_BYTES[kind]);
    }
  });

  it("carries a measuredAt timestamp and a run string naming the exact command executed", () => {
    expect(budget.measuredAt.length).toBeGreaterThan(0);
    expect(budget.run.length).toBeGreaterThan(0);
  });

  it("teams page (the year-wide table, the first at-risk artifact) stays under its absolute upper bound", () => {
    const entry = budget.pages.teams!;
    expect(
      entry.maxBytes,
      `teams page maxBytes (${entry.maxBytes}) exceeded the absolute ceiling (${TEAMS_PAGE_ABSOLUTE_MAX_BYTES}) — the teams table grew structurally bigger, not just noisier; shrink it or deliberately raise this bound alongside a re-measured budget`
    ).toBeLessThan(TEAMS_PAGE_ABSOLUTE_MAX_BYTES);
  });

  it("team page (the 292-match outlier, the second at-risk artifact) stays under its absolute upper bound", () => {
    const entry = budget.pages.team!;
    expect(
      entry.maxBytes,
      `team page maxBytes (${entry.maxBytes}) exceeded the absolute ceiling (${TEAM_PAGE_ABSOLUTE_MAX_BYTES}) — the team page grew structurally bigger, not just noisier; shrink it or deliberately raise this bound alongside a re-measured budget`
    ).toBeLessThan(TEAM_PAGE_ABSOLUTE_MAX_BYTES);
  });

  it("event page (the republish target) stays at or under EVENT_PAGE_ABSOLUTE_MAX_BYTES, reachable in isolation regardless of ledger #11's state", () => {
    const entry = budget.pages.event!;
    expect(
      entry.maxBytes,
      `event page maxBytes (${entry.maxBytes}) exceeded EVENT_PAGE_ABSOLUTE_MAX_BYTES (${EVENT_PAGE_ABSOLUTE_MAX_BYTES}, largestKey=${entry.largestKey}) — the republish breached the 350,000-byte event ceiling; this is a stop-and-report condition, never something to absorb by raising the ceiling or trimming a field`
    ).toBeLessThanOrEqual(EVENT_PAGE_ABSOLUTE_MAX_BYTES);
  });
});

// ---------------------------------------------------------------------------
// Fresh re-measurement against a small real slice — the actual regression guard
// ---------------------------------------------------------------------------

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);
/** A real, stable event confirmed present in the full 2022-2026 corpus — small enough (a single regional's worth of matches) to stay well under the 60-second feedback ceiling. */
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
          seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {}, metricsBasis: "last-official-match" },
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
