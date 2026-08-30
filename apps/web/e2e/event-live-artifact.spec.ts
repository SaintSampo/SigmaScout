/**
 * 07-20-PLAN.md Task 2 — ledger rows 4, 9, 10, and the behavioral half of
 * row 8. Runs on the `desktop` project only (`playwright.config.ts`): none
 * of these claims is viewport-dependent. Artifacts are fetched through
 * Playwright's `request` fixture (an anonymous public GET against our own
 * R2 origin, `https://data.sigmascout.org` — no CORS is involved on that
 * path), with the `vpr` algorithm version resolved ONCE from
 * `v1/manifest/algorithms.json` and never hardcoded, so 07-16/07-17/07-18's
 * rename or any future version bump cannot silently turn these cases into
 * 404-assertions.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import type { EventArtifact } from "../../../packages/harness/pageArtifacts.js";

const ORIGIN = "https://data.sigmascout.org";

async function resolveVprVersion(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${ORIGIN}/v1/manifest/algorithms.json`);
  expect(response.ok(), `manifest fetch failed: ${response.status()}`).toBe(true);
  const manifest = (await response.json()) as { algorithms: { id: string; version: string }[] };
  const vpr = manifest.algorithms.find((a) => a.id === "vpr");
  if (vpr === undefined) throw new Error("manifest carries no vpr entry — 07-16/07-17/07-18 have not all landed");
  return vpr.version;
}

async function fetchEventArtifact(request: APIRequestContext, eventKey: string, version: string): Promise<EventArtifact> {
  const url = `${ORIGIN}/v1/event/${eventKey}/vpr@${version}.json`;
  const response = await request.get(url);
  expect(response.ok(), `${url} did not resolve 200 (got ${response.status()})`).toBe(true);
  return (await response.json()) as EventArtifact;
}

// ---------------------------------------------------------------------------
// Ledger row 4 — D-08 fallback exercised against a REAL published
// no-ranking artifact, with a real ranked-artifact control.
// ---------------------------------------------------------------------------

test.describe("ledger row 4 — D-08 fallback ordering, real artifact + control", () => {
  test("2025isios (offseason, reachable only via 07-09's --include-offseason + 07-17's republish): no team carries a rank, and the Insights tab renders the fallback banner", async ({
    page,
    request,
  }) => {
    const version = await resolveVprVersion(request);
    const artifact = await fetchEventArtifact(request, "2025isios", version);
    expect(artifact.teams.length).toBeGreaterThan(0);
    // Absence via the property's own absence/undefined, never a falsy check —
    // a published rank of 0 could not be mistaken for absence this way.
    const anyRanked = artifact.teams.some((team) => team.rank !== undefined);
    expect(anyRanked, "2025isios unexpectedly carries a rank on at least one team — the D-08 fallback fixture no longer exhibits the shape under test").toBe(false);

    await page.goto("/event/2025isios?tab=insights&algorithm=vpr", { waitUntil: "networkidle" });
    const banner = page.getByTestId("insights-fallback-banner");
    await expect(banner).toBeVisible();
    const text = await banner.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  // The control: without this case, a build that ALWAYS renders the fallback
  // banner (a bug that would make the positive case above pass regardless of
  // whether D-08's discriminant logic actually works) would go undetected.
  test("2024new: every one of its 75 teams carries a rank, and the Insights tab renders NO fallback banner", async ({ page, request }) => {
    const version = await resolveVprVersion(request);
    const artifact = await fetchEventArtifact(request, "2024new", version);
    expect(artifact.teams.length).toBe(75);
    const allRanked = artifact.teams.every((team) => team.rank !== undefined);
    expect(allRanked, "2024new no longer publishes a rank on every team — the D-08 control fixture no longer exhibits the shape under test").toBe(true);

    await page.goto("/event/2024new?tab=insights&algorithm=vpr", { waitUntil: "networkidle" });
    await expect(page.getByTestId("insights-row").first()).toBeVisible();
    await expect(page.getByTestId("insights-fallback-banner")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Ledger row 10 — the two-pick alliance contract against a REAL published
// artifact, with a populated-Pick-3 control.
// ---------------------------------------------------------------------------

test.describe("ledger row 10 — the two-pick alliance contract, real artifact + control", () => {
  test("2024vabrb (Blue Ridge Brawl, offseason): exactly 5 alliances of exactly 2 picks each; the rendered table shows the em-dash absent-value treatment for Pick 3 and Backup", async ({
    page,
    request,
  }) => {
    const version = await resolveVprVersion(request);
    const artifact = await fetchEventArtifact(request, "2024vabrb", version);
    const alliances = artifact.alliances ?? [];
    expect(alliances.length).toBe(5);
    for (const alliance of alliances) {
      expect(alliance.picks.length, `alliance ${alliance.allianceNumber} does not carry exactly 2 picks`).toBe(2);
    }

    await page.goto("/event/2024vabrb?tab=alliances&algorithm=vpr", { waitUntil: "networkidle" });
    const trigger = page.getByRole("tab", { name: "Alliances" });
    await expect(trigger).toBeEnabled();

    const rows = page.getByTestId("alliances-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(5);

    for (let i = 0; i < 5; i++) {
      const pick3 = rows.nth(i).getByTestId("alliances-cell-pick2");
      const backup = rows.nth(i).getByTestId("alliances-cell-pickBackup");
      expect((await pick3.innerText()).trim()).toBe("—");
      expect((await backup.innerText()).trim()).toBe("—");
    }
  });

  // The control: without an event where Pick 3 CAN be populated, the em-dash
  // assertion above could pass even if the app rendered "—" unconditionally
  // for every alliance regardless of the underlying data.
  test("2024new: 8 alliances, each with a populated Pick 3", async ({ page, request }) => {
    const version = await resolveVprVersion(request);
    const artifact = await fetchEventArtifact(request, "2024new", version);
    const alliances = artifact.alliances ?? [];
    expect(alliances.length).toBe(8);
    for (const alliance of alliances) {
      expect(alliance.picks.length, `alliance ${alliance.allianceNumber} does not carry a 3rd pick`).toBeGreaterThanOrEqual(3);
    }

    await page.goto("/event/2024new?tab=alliances&algorithm=vpr", { waitUntil: "networkidle" });
    const rows = page.getByTestId("alliances-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(8);

    for (let i = 0; i < 8; i++) {
      const pick3 = rows.nth(i).getByTestId("alliances-cell-pick2");
      expect((await pick3.innerText()).trim()).not.toBe("—");
    }
  });

  // [Flagged planner assumption 5, discovered live] 07-20-PLAN.md's third,
  // strictly-additive D-17 case assumed `2024cmptx` (Einstein) publishes an
  // EMPTY alliances array, per RESEARCH.md's live probe finding. Direct
  // measurement this session found `2024cmptx` instead publishes 8 real
  // alliances of 4 picks each — RESEARCH.md's probe finding is now stale
  // (the corpus/publish pipeline has moved since it was recorded). Per the
  // plan's own contingency ("if the array turns out populated, drop that one
  // case and record why, rather than hunting for a substitute event — E7's
  // dismissed rows are not this plan's to re-open"), that additive case is
  // dropped rather than authored against a substitute event. See
  // 07-20-SUMMARY.md for the full accounting.
});

// ---------------------------------------------------------------------------
// Ledger row 9 — the alliance-uncertainty identity, CORRECTED after live
// review found the original design unfalsifiable.
//
// [Rule 1 correction, found live and confirmed independently after this
// task's own required run] The original version of this test compared
// `sigma_alliance` (from `metrics.total.spread`, which `publish.ts`'s own
// D-10 comment documents as AS-OF-EVENT — state after the event's LAST
// chronological match) against `sigma_match` (a specific match's
// `redScoreVarianceOwn`/`blueScoreVarianceOwn`, the walk-forward
// AS-OF-THAT-MATCH prediction). These are two DIFFERENT points in the
// walk-forward, not the same instant, so exact agreement was never a
// provable claim from the published bytes: it measured FALSE on real data
// (99/99 pairs across four candidate events exceeded a derived tolerance, by
// 0.03 to 2.04 sigma units — see WINDOWS.md ledger #17 for the full
// accounting). A direct check (280 alliance-pairs, `2024new`) confirmed the
// mechanism: the mean gap is 1.130 in the first half of the event and 0.373
// in the second — variance shrinking roughly 3x as more matches are
// observed is exactly the signature of an as-of-event-end quantity compared
// against an earlier, more-uncertain as-of-match one. (The tolerance
// derivation itself was independently found to be wrong in the SAFE
// direction — variance rounds to `ROUNDING_RULE.variance` = 4 decimals, not
// the 2 this test originally assumed — so that correction only strengthened
// the finding; it never explained the gap away.)
//
// What THIS test asserts instead is the relationship that IS provable from
// published bytes: `sigma_match` (walk-forward, computed before the match
// was played) should exceed `sigma_alliance` (as-of-event-end) by MORE for
// an alliance's EARLIER elimination matches than for its LATER ones, since
// the model's uncertainty narrows monotonically as more of the event's
// matches are observed. Pairs are bucketed by whether their match's
// `sortTime` falls before or after that event's own median elimination-match
// `sortTime`, and the mean signed gap (`sigma_match - sigma_alliance`) is
// asserted to be smaller in the second half than in the first.
//
// The TRUE identity (same-instant per-team spread vs. that instant's
// alliance variance) remains genuinely untestable until the pipeline
// publishes each team's metrics AS-OF-EACH-MATCH rather than only
// as-of-event — tracked as an actionable follow-up in
// `.planning/todos/pending/publish-as-of-match-team-metrics.md`, not left as
// a silent gap.
// ---------------------------------------------------------------------------

const IDENTITY_CANDIDATE_EVENTS = ["2024new", "2023cur", "2024casf", "2025flta"] as const;
const ELIM_COMP_LEVELS = new Set(["ef", "qf", "sf", "f"]);

interface IdentityPair {
  eventKey: string;
  allianceNumber: number;
  matchKey: string;
  side: "red" | "blue";
  sortTime: number;
  sigmaAlliance: number;
  sigmaMatch: number;
  gap: number; // signed: sigmaMatch - sigmaAlliance
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

test.describe("ledger row 9 (corrected) — the alliance-uncertainty gap narrows monotonically across an event, over real published data", () => {
  test("the mean gap (sigma_match - sigma_alliance) is smaller in the second half of an event's elimination matches than in the first half, pooled across four candidate events", async ({
    request,
  }) => {
    const version = await resolveVprVersion(request);
    const pairs: IdentityPair[] = [];
    const eventsChecked: string[] = [];

    for (const eventKey of IDENTITY_CANDIDATE_EVENTS) {
      eventsChecked.push(eventKey);
      const artifact = await fetchEventArtifact(request, eventKey, version);
      const spreadByTeam = new Map<string, number>();
      for (const team of artifact.teams) {
        const spread = team.metrics.total?.spread;
        if (spread !== undefined) spreadByTeam.set(team.teamKey, spread);
      }

      const elimMatches = artifact.matches.filter((m) => ELIM_COMP_LEVELS.has(m.compLevel) && m.sortTime !== undefined);
      if (elimMatches.length === 0) continue;

      for (const alliance of artifact.alliances ?? []) {
        const firstThree = alliance.picks.slice(0, 3);
        if (firstThree.length < 3) continue;
        const spreads = firstThree.map((key) => spreadByTeam.get(key));
        if (spreads.some((s) => s === undefined)) continue;
        const sigmaAlliance = Math.sqrt((spreads as number[]).reduce((sum, s) => sum + s * s, 0));
        const pickSet = new Set(firstThree);

        for (const match of elimMatches) {
          const redSet = new Set(match.redTeams);
          const blueSet = new Set(match.blueTeams);
          let side: "red" | "blue" | undefined;
          if (redSet.size === pickSet.size && [...pickSet].every((p) => redSet.has(p))) side = "red";
          else if (blueSet.size === pickSet.size && [...pickSet].every((p) => blueSet.has(p))) side = "blue";
          if (side === undefined) continue;

          const varianceOwn = side === "red" ? match.redScoreVarianceOwn : match.blueScoreVarianceOwn;
          if (varianceOwn === undefined) continue;
          const sigmaMatch = Math.sqrt(varianceOwn);
          pairs.push({
            eventKey,
            allianceNumber: alliance.allianceNumber,
            matchKey: match.matchKey,
            side,
            sortTime: match.sortTime!,
            sigmaAlliance,
            sigmaMatch,
            gap: sigmaMatch - sigmaAlliance,
          });
        }
      }
    }

    expect(pairs.length, `zero pairs found across every candidate event tried (${eventsChecked.join(", ")}) — the relationship was never actually tested`).toBeGreaterThan(0);

    // Each event's own median elimination-match sortTime is the cutoff for
    // ITS pairs — computed per event so one event's timeline can never
    // distort another's bucketing.
    const cutoffByEvent = new Map<string, number>();
    for (const eventKey of eventsChecked) {
      const eventPairs = pairs.filter((p) => p.eventKey === eventKey);
      if (eventPairs.length === 0) continue;
      cutoffByEvent.set(eventKey, median(eventPairs.map((p) => p.sortTime)));
    }

    const firstHalf = pairs.filter((p) => p.sortTime < (cutoffByEvent.get(p.eventKey) ?? Infinity));
    const secondHalf = pairs.filter((p) => p.sortTime >= (cutoffByEvent.get(p.eventKey) ?? -Infinity));

    expect(firstHalf.length, "no pairs fell in the first half of any event — the narrowing comparison needs both halves populated").toBeGreaterThan(0);
    expect(secondHalf.length, "no pairs fell in the second half of any event — the narrowing comparison needs both halves populated").toBeGreaterThan(0);

    const meanFirstHalf = mean(firstHalf.map((p) => p.gap));
    const meanSecondHalf = mean(secondHalf.map((p) => p.gap));

    expect(
      meanSecondHalf,
      `expected the mean gap to narrow across the event (first half ${meanFirstHalf.toFixed(4)}, second half ${meanSecondHalf.toFixed(4)}, over ${firstHalf.length}/${secondHalf.length} pairs) — it did not`,
    ).toBeLessThan(meanFirstHalf);
  });
});

// ---------------------------------------------------------------------------
// Ledger row 8, behavioral half — documents the shipped 2022 elimination
// order as FACT, without endorsing it as a product decision.
// ---------------------------------------------------------------------------

test.describe("ledger row 8 (behavioral half) — the shipped 2022ilpe elimination order", () => {
  /**
   * [Rule 1 correction, found live running this task's own required
   * verification] 07-20-PLAN.md's action text and Task 3 checkpoint both
   * describe the shipped order at `2022ilpe` as the SERIES-MAJOR sequence
   * 07-13 originally measured against the bracket-chain-only comparator.
   * Direct measurement this session — both by re-implementing
   * `eventMatchAxis.ts`'s actual shipped `compareEventMatchRows` against the
   * real fetched artifact, and by reading the LIVE rendered DOM order at
   * `/event/2022ilpe?tab=elims` — shows the CURRENT shipped order is
   * WALL-CLOCK (chronological by `sortTime`), not series-major.
   * `eventMatchAxis.ts` (git history: one commit, `cfdb83bf`, 07-12's own
   * original tracer task) has carried a sortTime-presence-first comparator
   * since it was first authored, and its own header comment states this
   * closes exactly the finding 07-13 raised. Every one of `2022ilpe`'s 18
   * elimination rows carries a `sortTime`, so the presence-based branch never
   * falls through to the bracket-chain tie-break, and the match set sorts
   * purely chronologically. This test therefore documents the ACTUAL,
   * currently-deployed sequence (wall-clock) rather than the plan's
   * inherited, now-stale series-major expectation — asserting the sequence
   * the plan describes would be asserting a claim the live site does not
   * make, which is exactly the false-evidence failure mode this plan exists
   * to prevent. See 07-20-SUMMARY.md for the full correction and its
   * implication for Task 3's checkpoint item 3.
   */
  const ACTUAL_SHIPPED_ORDER = [
    "Quarterfinal 1-1",
    "Quarterfinal 2-1",
    "Quarterfinal 3-1",
    "Quarterfinal 4-1",
    "Quarterfinal 1-2",
    "Quarterfinal 2-2",
    "Quarterfinal 3-2",
    "Quarterfinal 4-2",
    "Quarterfinal 3-3",
    "Semifinal 1-1",
    "Quarterfinal 2-3",
    "Quarterfinal 4-3",
    "Semifinal 2-1",
    "Semifinal 1-2",
    "Semifinal 2-2",
    "Final 1-1",
    "Semifinal 2-3",
    "Final 1-2",
  ] as const;

  test("2022ilpe: the rendered rows' round labels form exactly this 18-element sequence (documents what ships; does not endorse it)", async ({ page }) => {
    await page.goto("/event/2022ilpe?tab=elims&algorithm=vpr", { waitUntil: "networkidle" });
    const rows = page.locator('[data-testid^="match-row-"]');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(ACTUAL_SHIPPED_ORDER.length);

    const labels: string[] = [];
    for (let i = 0; i < ACTUAL_SHIPPED_ORDER.length; i++) {
      const label = await rows.nth(i).locator("span").first().innerText();
      labels.push(label);
    }
    expect(labels).toEqual([...ACTUAL_SHIPPED_ORDER]);
  });
});
