/**
 * `#rpFieldsFor`'s ALLIANCE BAND GUARD: no RP fields at all when either
 * alliance's band variance is undefined, since an alliance with unknown score
 * variance has no honest pmf.
 *
 * Do not delete as redundant: if the band variance ever looks unused, an
 * "unused parameter" cleanup would drop the guard and silently change what cold
 * rosters publish. That cold-start behaviour must change only deliberately.
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

describe("#rpFieldsFor's alliance band guard", () => {
  it("produces NO RP fields when the alliances have no band yet — a cold roster gets no pmf rather than a guessed one", () => {
    // A layer that has folded nothing leaves both alliance bands undefined here.
    const layer = new SigmaScoutLayer(RP_RULE_MODULES[2026], "spr");
    const enriched = layer.enrichUpcoming(upcomingMatch(), { winner: "red", redScore: 100, blueScore: 90, pRedWin: 0.6 });

    expect(enriched.prediction.redRpPmf).toBeUndefined();
    expect(enriched.prediction.blueRpPmf).toBeUndefined();
    expect(enriched.prediction.redBonusRp).toBeUndefined();
    expect(enriched.prediction.blueBonusRp).toBeUndefined();
    // The decomposition fields share the gate: absent keys, never empty arrays,
    // so "could not price" never reads as "priced as nothing".
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
