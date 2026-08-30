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
// Ledger row 9 — the alliance-uncertainty identity, checked numerically
// against real published data with a DERIVED tolerance.
//
// TOLERANCE DERIVATION (checked against `packages/harness/rounding.ts`'s
// `ROUNDING_RULE`, not assumed): each team's `metrics.total.spread` is
// rounded to `ROUNDING_RULE.metric` = 2 decimals at the publish boundary —
// this is the DOMINANT error term. Error propagation through
// `sigma_alliance = sqrt(sum of s_i^2)` gives
// `d(sigma_alliance)/d(s_i) = s_i / sigma_alliance`, which is bounded in
// magnitude by 1 for each of the three terms; combining the three
// independent +/-0.005 roundings in quadrature bounds the total input
// contribution at `sqrt(3) * 0.005 ~= 0.0087`. The match's own
// `redScoreVarianceOwn`/`blueScoreVarianceOwn` is rounded to
// `ROUNDING_RULE.variance` = 4 decimals — NOT 2, correcting the plan's own
// assumption that both quantities share one rounding rule — so its
// contribution through `d(sigma_match)/d(variance) = 1 / (2 * sigma_match)`
// is `0.00005 / (2 * sigma_match)`, on the order of 1e-5 and negligible next
// to the spread term. An absolute tolerance of 0.02 bounds both with
// generous margin over pure rounding noise.
// ---------------------------------------------------------------------------

const IDENTITY_TOLERANCE = 0.02;
const IDENTITY_CANDIDATE_EVENTS = ["2024new", "2023cur", "2024casf", "2025flta"] as const;
const ELIM_COMP_LEVELS = new Set(["ef", "qf", "sf", "f"]);

interface IdentityPair {
  eventKey: string;
  allianceNumber: number;
  matchKey: string;
  side: "red" | "blue";
  sigmaAlliance: number;
  sigmaMatch: number;
  diff: number;
}

test.describe("ledger row 9 — the alliance-uncertainty identity over real published data", () => {
  test("sigma_alliance (sum-of-squares over the first 3 picks' published spreads) is compared against sigma_match (sqrt of that side's own-score variance) for every elimination match an alliance's first-3-picks trio plays, across four candidate events", async ({
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

      for (const alliance of artifact.alliances ?? []) {
        const firstThree = alliance.picks.slice(0, 3);
        if (firstThree.length < 3) continue;
        const spreads = firstThree.map((key) => spreadByTeam.get(key));
        if (spreads.some((s) => s === undefined)) continue;
        const sigmaAlliance = Math.sqrt((spreads as number[]).reduce((sum, s) => sum + s * s, 0));
        const pickSet = new Set(firstThree);

        for (const match of artifact.matches) {
          if (!ELIM_COMP_LEVELS.has(match.compLevel)) continue;
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
            sigmaAlliance,
            sigmaMatch,
            diff: Math.abs(sigmaAlliance - sigmaMatch),
          });
        }
      }
    }

    expect(pairs.length, `zero pairs found across every candidate event tried (${eventsChecked.join(", ")}) — the identity was never actually tested`).toBeGreaterThan(0);

    const failures = pairs.filter((p) => p.diff > IDENTITY_TOLERANCE);
    if (failures.length > 0) {
      const detail = failures
        .map((f) => `${f.eventKey} alliance ${f.allianceNumber} (${f.matchKey}, ${f.side}): sigma_alliance=${f.sigmaAlliance.toFixed(4)} sigma_match=${f.sigmaMatch.toFixed(4)} diff=${f.diff.toFixed(4)}`)
        .join("\n");
      // PROHIBITION (this plan's own, and T-07-20-04): never widen this
      // tolerance and never drop a candidate event to make this assertion
      // pass. A failure here is the finding — see 07-20-SUMMARY.md for the
      // full per-alliance accounting and the routed explanation.
      throw new Error(`${failures.length}/${pairs.length} pairs exceed the ${IDENTITY_TOLERANCE} tolerance:\n${detail}`);
    }
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
