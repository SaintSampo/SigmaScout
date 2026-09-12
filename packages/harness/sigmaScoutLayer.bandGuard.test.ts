/**
 * `#rpFieldsFor`'s ALLIANCE BAND GUARD, asserted behaviorally.
 *
 * The guard returns no RP fields at all when either alliance's band variance
 * is undefined — which happens exactly when a rostered team has too little
 * play to have a consistency figure yet. An alliance whose score variance is
 * unknown has no honest pmf, so it gets none.
 *
 * WHY THIS FILE EXISTS, AND WHY IT MUST NOT BE DELETED AS REDUNDANT.
 *
 * Plan 09-06 collapsed the RP layer back to a single model after the
 * pre-committed bar refused all three candidate changes. One of those
 * candidates (taking the win half from the published win probability) would,
 * if it had shipped, have left the alliance band variance with NO CONSUMER in
 * the RP layer at all — 09-05 proved that by sweeping the score variance
 * across three orders of magnitude for an identical pmf. A routine
 * "unused parameter" cleanup would then have deleted the guard along with the
 * arguments it guards, silently changing what the site publishes on cold
 * rosters.
 *
 * That candidate did NOT ship, so the band is genuinely read again. This test
 * is kept anyway, because the reasoning that made the guard load-bearing does
 * not depend on which arm shipped: the cold-start behaviour it protects
 * (F8/F9) is out of scope for the whole phase, and it must change only
 * deliberately, never as a side effect of tidying.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import type { UpcomingMatch } from "../core/algorithms/types.js";

function upcomingMatch(): UpcomingMatch {
  return {
    matchKey: "2026test_qm1",
    eventKey: "2026test",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 0,
    week: null,
  };
}

describe("#rpFieldsFor's alliance band guard (F8/F9 — out of scope, and deliberately untouched)", () => {
  it("produces NO RP fields when the alliances have no band yet — a cold roster gets no pmf rather than a guessed one", () => {
    // A layer that has folded nothing has no consistency figure for any team,
    // so both alliance bands are undefined.
    const layer = new SigmaScoutLayer(RP_RULE_MODULES[2026], "spr");
    const enriched = layer.enrichUpcoming(upcomingMatch(), { winner: "red", redScore: 100, blueScore: 90, pRedWin: 0.6 });

    expect(enriched.prediction.redRpPmf).toBeUndefined();
    expect(enriched.prediction.blueRpPmf).toBeUndefined();
    expect(enriched.prediction.redBonusRp).toBeUndefined();
    expect(enriched.prediction.blueBonusRp).toBeUndefined();
    // 09-07's decomposition fields are downstream of the same gate and must be
    // absent together with it — an absent key, never an empty array, so a
    // consumer cannot mistake "we could not price this" for "we priced it as
    // nothing".
    expect(enriched.prediction.matchOutcomePmf).toBeUndefined();
    expect(enriched.prediction.redBonusRpPmf).toBeUndefined();
    expect(enriched.prediction.blueBonusRpPmf).toBeUndefined();
  });

  it("the prediction is otherwise passed through untouched — the guard withholds RP, it does not blank the row", () => {
    const layer = new SigmaScoutLayer(RP_RULE_MODULES[2026], "spr");
    const enriched = layer.enrichUpcoming(upcomingMatch(), { winner: "red", redScore: 100, blueScore: 90, pRedWin: 0.6 });

    expect(enriched.prediction.redScore).toBe(100);
    expect(enriched.prediction.blueScore).toBe(90);
    expect(enriched.prediction.pRedWin).toBe(0.6);
  });

  it("still takes BOTH alliance bands — the guard is two-sided, so one warm alliance does not license pricing the other", () => {
    // Asserted on the source, because the failure this catches is a parameter
    // quietly dropped during a cleanup rather than a wrong number.
    const source = readFileSync(new URL("./sigmaScoutLayer.ts", import.meta.url), "utf8");
    expect(source).toContain("redBandVariance: number | undefined");
    expect(source).toContain("blueBandVariance: number | undefined");
    expect(source).toContain("if (redBandVariance === undefined || blueBandVariance === undefined) return {};");
  });
});
