import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithRouter } from "@/test/routerHarness";
import { MatchTable, matchLabel } from "./MatchTable.js";
import type { TeamSeasonMatch } from "./matchAxis.js";

const DOMAIN = { min: 100, max: 400 };

// theme.css scrollbar guard's documented fallback (jsdom applies no CSS —
// `theme.scrollbar.test.ts`): assert the shipped CSS TEXT, not a runtime
// measurement. `findRuleBody` is reimplemented here rather than imported
// because the scrollbar test's copy is not exported.
const THEME_CSS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../styles/theme.css");

function readThemeCss(): string {
  return readFileSync(THEME_CSS_PATH, "utf-8");
}

/** Extracts the declaration block body for the first rule whose selector
 * (after stripping comments) matches `selectorPattern` exactly. */
function findRuleBody(css: string, selectorPattern: RegExp): string | null {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRegex.exec(withoutComments)) !== null) {
    const selector = (match[1] ?? "").trim();
    if (selectorPattern.test(selector)) {
      return match[2] ?? "";
    }
  }
  return null;
}

/** Extracts a single custom-property declaration's value (e.g.
 * `--alliance-red-ground: color-mix(...);` -> `color-mix(...)`), searching
 * the whole file text (these declarations live inside the shared `:root`
 * block alongside many others, so a rule-body match on `:root` alone would
 * be too broad to assert against). */
function findDeclarationValue(css: string, propertyName: string): string | null {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const match = withoutComments.match(new RegExp(`--${propertyName}:\\s*([^;]+);`));
  return match ? (match[1] ?? "").trim() : null;
}

describe("theme.css alliance ground tint tokens & rule block (sketch 010-C, quick 260906-80e)", () => {
  it("declares four color-mix-derived ground tokens from the existing alliance tokens, no rgba()/hex literal", () => {
    const css = readThemeCss();
    const redGround = findDeclarationValue(css, "alliance-red-ground");
    const blueGround = findDeclarationValue(css, "alliance-blue-ground");
    const redGroundOwn = findDeclarationValue(css, "alliance-red-ground-own");
    const blueGroundOwn = findDeclarationValue(css, "alliance-blue-ground-own");

    expect(redGround, "expected --alliance-red-ground to exist").not.toBeNull();
    expect(blueGround, "expected --alliance-blue-ground to exist").not.toBeNull();
    expect(redGroundOwn, "expected --alliance-red-ground-own to exist").not.toBeNull();
    expect(blueGroundOwn, "expected --alliance-blue-ground-own to exist").not.toBeNull();

    expect(redGround).toBe("color-mix(in srgb, var(--alliance-red) 10%, transparent)");
    expect(blueGround).toBe("color-mix(in srgb, var(--alliance-blue) 10%, transparent)");
    expect(redGroundOwn).toBe("color-mix(in srgb, var(--alliance-red) 20%, transparent)");
    expect(blueGroundOwn).toBe("color-mix(in srgb, var(--alliance-blue) 20%, transparent)");

    for (const value of [redGround, blueGround, redGroundOwn, blueGroundOwn]) {
      expect(value).not.toMatch(/rgba\(/);
      expect(value).not.toMatch(/#/);
    }
  });

  it("declares .match-alliance-nums with inline-flex and a 10px gap", () => {
    const css = readThemeCss();
    const body = findRuleBody(css, /^\.match-alliance-nums$/);
    expect(body, "expected a bare `.match-alliance-nums { ... }` rule").not.toBeNull();
    expect(body).toMatch(/display:\s*inline-flex\s*;/);
    expect(body).toMatch(/gap:\s*10px\s*;/);
  });

  it("declares .match-alliance-nums--even as a fixed-width line whose leftover space is distributed", () => {
    // 2026-09-08 fix: event-page alliance lines were ragged because a text-node
    // space made each line as wide as its own digits happened to be. Fixing the
    // width and distributing the remainder is what makes red and blue agree.
    const css = readThemeCss();
    const body = findRuleBody(css, /^\.match-alliance-nums--even$/);
    expect(body, "expected a `.match-alliance-nums--even { ... }` rule").not.toBeNull();
    expect(body).toMatch(/width:\s*17ch\s*;/);
    expect(body).toMatch(/justify-content:\s*space-between\s*;/);
  });

  it("declares .match-alliance-nums--mine as a horizontal-only 999px pill (no vertical rhythm change)", () => {
    const css = readThemeCss();
    const body = findRuleBody(css, /^\.match-alliance-nums--mine$/);
    expect(body, "expected a `.match-alliance-nums--mine { ... }` rule").not.toBeNull();
    expect(body).toMatch(/padding:\s*0\s+5px\s*;/);
    expect(body).toMatch(/margin-left:\s*-5px\s*;/);
    expect(body).toMatch(/border-radius:\s*999px\s*;/);
    expect(body).not.toMatch(/var\(--radius\)/);

    for (const forbidden of [
      /padding-top/,
      /padding-bottom/,
      /padding-block/,
      /margin-top/,
      /margin-bottom/,
      /margin-block/,
      /line-height/,
    ]) {
      expect(body).not.toMatch(forbidden);
    }
  });

  it("sides .match-alliance-nums--red/--blue to the matching plain ground token", () => {
    const css = readThemeCss();
    const redBody = findRuleBody(css, /^\.match-alliance-nums--red$/);
    const blueBody = findRuleBody(css, /^\.match-alliance-nums--blue$/);
    expect(redBody, "expected `.match-alliance-nums--red { ... }`").not.toBeNull();
    expect(blueBody, "expected `.match-alliance-nums--blue { ... }`").not.toBeNull();
    expect(redBody).toMatch(/background-color:\s*var\(--alliance-red-ground\)\s*;/);
    expect(blueBody).toMatch(/background-color:\s*var\(--alliance-blue-ground\)\s*;/);
  });

  it("sides the own-number descendant selectors to the matching -own ground token", () => {
    const css = readThemeCss();
    const redOwnBody = findRuleBody(css, /^\.match-alliance-nums--red\s+\.match-alliance-num--own$/);
    const blueOwnBody = findRuleBody(css, /^\.match-alliance-nums--blue\s+\.match-alliance-num--own$/);
    expect(redOwnBody, "expected `.match-alliance-nums--red .match-alliance-num--own { ... }`").not.toBeNull();
    expect(blueOwnBody, "expected `.match-alliance-nums--blue .match-alliance-num--own { ... }`").not.toBeNull();
    expect(redOwnBody).toMatch(/background-color:\s*var\(--alliance-red-ground-own\)\s*;/);
    expect(blueOwnBody).toMatch(/background-color:\s*var\(--alliance-blue-ground-own\)\s*;/);
  });
});

function makeMatch(overrides: Partial<TeamSeasonMatch> = {}): TeamSeasonMatch {
  return {
    matchKey: "2024casj_qm1",
    season: 2024,
    eventKey: "2024casj",
    compLevel: "qm",
    algorithmId: "bpr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    predictedWinner: "red",
    pRedWin: 0.63,
    predictedRedScore: 250,
    predictedBlueScore: 220,
    redTeams: ["frc118", "frc254", "frc971"],
    blueTeams: ["frc604", "frc1678", "frc2056"],
    // Quick task 260908-5wd: the band is read from the SigmaScout-layer field,
    // published for every algorithm. `*ScoreVarianceOwn` is kept in the fixture
    // and deliberately NOT read — reading it is what made the band VPR-only.
    redScoreVarianceOwn: 100,
    blueScoreVarianceOwn: 64,
    redSwingBandVariance: 100,
    blueSwingBandVariance: 64,
    redRpPmf: [0.2, 0.5, 0.3],
    blueRpPmf: [0.5, 0.4, 0.1],
    ...overrides,
  } as TeamSeasonMatch;
}

describe("matchLabel", () => {
  it("labels a qualification match from its published match number", () => {
    expect(matchLabel({ compLevel: "qm", setNumber: 1, matchNumber: 12, matchKey: "2024casj_qm12" })).toBe("Qual 12");
  });

  it("labels a semifinal with a set number", () => {
    expect(matchLabel({ compLevel: "sf", setNumber: 2, matchNumber: 1, matchKey: "2024casj_sf2m1" })).toBe("Semifinal 2-1");
  });

  it("labels a final", () => {
    expect(matchLabel({ compLevel: "f", setNumber: 1, matchNumber: 1, matchKey: "2024casj_f1m1" })).toBe("Final 1-1");
  });

  it("falls back to the matchKey's own suffix when setNumber/matchNumber are absent", () => {
    expect(matchLabel({ compLevel: "qm", setNumber: undefined, matchNumber: undefined, matchKey: "2024casj_qm7" })).toBe("qm7");
  });
});

describe("MatchTable", () => {
  it("links every roster number on both alliances to that team's page, carrying year and algorithm", () => {
    // 2026-09-08 fix: team-page roster numbers were plain text, so the one
    // place a reader most wants to jump from was a dead end.
    renderWithRouter(
      <MatchTable
        matches={[makeMatch({ matchKey: "m1", redTeams: ["frc118", "frc1690", "frc10935"], blueTeams: ["frc254", "frc33", "frc111"] })]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
        algorithm="bpr"
      />,
    );
    for (const number of ["118", "1690", "10935", "254", "33", "111"]) {
      const link = screen.getByRole("link", { name: number });
      expect(link.getAttribute("href")).toBe(`/team/${number}?year=2024&algorithm=bpr&tab=overview`);
    }
  });

  it("renders six alliance marks for a played VPR row (band+tick+dot per alliance), dots carrying alliance colour classes with no loser-ink token", () => {
    renderWithRouter(
      <MatchTable
        matches={[makeMatch({ matchKey: "m1", actualWinner: "red", actualRedScore: 260, actualBlueScore: 200, actualRedRp: 2, actualBlueRp: 0 })]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
        algorithm="bpr"
      />,
    );
    expect(screen.getByTestId("alliance-mark-m1-red-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-red-tick")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-red-dot")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-blue-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-blue-tick")).toBeDefined();
    const blueDot = screen.getByTestId("alliance-mark-m1-blue-dot");
    expect(blueDot).toBeDefined();

    const redDot = screen.getByTestId("alliance-mark-m1-red-dot");
    expect(redDot.className).toContain("bg-white");
    expect(redDot.style.border).toContain("var(--alliance-red)");
    expect(blueDot.style.border).toContain("var(--alliance-blue)");
    expect(redDot.className).not.toContain("loser-ink");
    expect(blueDot.className).not.toContain("loser-ink");
  });

  /**
   * WR-02 (260902-post-phase08-ungoverned-ui/REVIEW.md): a played match
   * whose rosters contain NEITHER the page's `teamKey` — the published
   * letter-suffixed shape `teamKey.ts` documents as real (a team's second
   * robot, e.g. `frc5199B` when the page renders the parent `frc5199`) —
   * must render an EMPTY Result cell, never a fabricated "Loss". Paired with
   * a positive case in the same describe so the gate cannot pass by
   * rendering nothing ever.
   */
  describe("Result chip roster-participation gate (WR-02)", () => {
    it("renders an empty Result cell for a played match whose rosters exclude the page's team (letter-suffixed B-team roster)", () => {
      renderWithRouter(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              actualWinner: "red",
              actualRedScore: 260,
              actualBlueScore: 200,
              redTeams: ["frc118", "frc254", "frc971"],
              blueTeams: ["frc604", "frc1678", "frc5199B"],
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc5199"
          season={2024}
        algorithm="bpr"
        />,
      );
      const resultCell = screen.getByTestId("result-m1");
      expect(resultCell.textContent).toBe("");
      expect(resultCell.querySelector(".result-chip")).toBeNull();
    });

    it("still renders a Win chip when the page's team is genuinely on the winning roster (companion positive case)", () => {
      renderWithRouter(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              actualWinner: "red",
              actualRedScore: 260,
              actualBlueScore: 200,
              redTeams: ["frc118", "frc254", "frc971"],
              blueTeams: ["frc604", "frc1678", "frc2056"],
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2024}
        algorithm="bpr"
        />,
      );
      const resultCell = screen.getByTestId("result-m1");
      expect(within(resultCell).getByText("Win")).toBeDefined();
    });
  });

  it("greys the losing number in the Actual column and leaves the winning number ungreyed", () => {
    renderWithRouter(
      <MatchTable
        matches={[makeMatch({ matchKey: "m1", actualWinner: "red", actualRedScore: 260, actualBlueScore: 200 })]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
        algorithm="bpr"
      />,
    );
    const winner = screen.getByTestId("actual-m1-red");
    const loser = screen.getByTestId("actual-m1-blue");
    expect(winner.className).not.toContain("loser-ink");
    expect(loser.className).toContain("loser-ink");
  });

  it("renders a scheduled row with four marks, zero dots, a weekday/time string in Actual, and an em-dash in Call", () => {
    // 2026-01-03 is a Saturday.
    const sortTime = Math.floor(new Date("2026-01-03T18:30:00Z").getTime() / 1000);
    renderWithRouter(<MatchTable matches={[makeMatch({ matchKey: "m1", sortTime })]} domain={DOMAIN} teamKey="frc118"
        season={2024}
        algorithm="bpr"
      />);

    expect(screen.getByTestId("alliance-mark-m1-red-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-red-tick")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-blue-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-blue-tick")).toBeDefined();
    expect(screen.queryByTestId("alliance-mark-m1-red-dot")).toBeNull();
    expect(screen.queryByTestId("alliance-mark-m1-blue-dot")).toBeNull();

    const actual = screen.getByTestId("actual-m1");
    // WR-06 (260902-post-phase08-ungoverned-ui/REVIEW.md): the rendered time
    // must carry a trailing zone label so a scout reading another timezone's
    // schedule can see the time is THEIRS, not the venue's. The zone token
    // itself is environment-dependent (e.g. "PST", "GMT-8", "UTC"), so the
    // regex requires SOME trailing token rather than a fixed one — this is
    // the widened assertion that would break if the label were dropped.
    expect(actual.textContent).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2} (AM|PM) \S+$/);

    const call = screen.getByTestId("call-m1");
    expect(call.textContent).toBe("—");
  });

  it("renders ticks but zero band elements, and a bare whole-number predicted score, for an OPR row (no own-variance, no pmf)", () => {
    renderWithRouter(
      <MatchTable
        matches={[
          makeMatch({
            matchKey: "m1",
            algorithmId: "opr",
            redScoreVarianceOwn: undefined,
            blueScoreVarianceOwn: undefined,
            redSwingBandVariance: undefined,
            blueSwingBandVariance: undefined,
            redRpPmf: undefined,
            blueRpPmf: undefined,
          }),
        ]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
        algorithm="bpr"
      />,
    );
    expect(screen.getByTestId("alliance-mark-m1-red-tick")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-m1-blue-tick")).toBeDefined();
    expect(screen.queryByTestId("alliance-mark-m1-red-band")).toBeNull();
    expect(screen.queryByTestId("alliance-mark-m1-blue-band")).toBeNull();

    // The predicted-RP column was removed entirely: bonus RP is now the
    // per-bonus dots, and win/tie RP is already carried by the Confidence
    // chip and the Call column.
    expect(screen.queryByTestId("predicted-rp-m1")).toBeNull();

    // The predicted SCORE that replaced it carries neither a ± nor a decimal
    // — its uncertainty is the interval band in the plot column.
    const predictedScore = screen.getByTestId("predicted-score-m1");
    expect(predictedScore.textContent).not.toContain("±");
    expect(predictedScore.textContent).not.toContain(".");
  });

  it("positions red's marks above blue's in every row, regardless of which alliance this team is on", () => {
    renderWithRouter(
      <MatchTable
        matches={[
          makeMatch({ matchKey: "m1", redTeams: ["frc118"], blueTeams: ["frc254"] }),
          makeMatch({ matchKey: "m2", redTeams: ["frc254"], blueTeams: ["frc118"] }),
        ]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
        algorithm="bpr"
      />,
    );
    for (const matchKey of ["m1", "m2"]) {
      const redTop = parseFloat(screen.getByTestId(`alliance-mark-${matchKey}-red-tick`).style.top);
      const blueTop = parseFloat(screen.getByTestId(`alliance-mark-${matchKey}-blue-tick`).style.top);
      expect(redTop).toBeLessThan(blueTop);
    }
  });

  /**
   * Sketch 010 variant C, selected 2026-09-06 (quick task 260906-80e):
   * replaces the roster-line `font-semibold` with an alliance ground tint —
   * the team's own alliance line wrapped in a pill, its own number a deeper
   * tint on top. Figure stays neutral throughout.
   */
  describe("alliance ground tint (sketch 010-C, quick 260906-80e)", () => {
    it("marks the red-alliance team's own line as a red pill, its own number as --own, and leaves the opposing line unmarked", () => {
      renderWithRouter(
        <MatchTable
          matches={[makeMatch({ matchKey: "m1", redTeams: ["frc118", "frc254", "frc971"], blueTeams: ["frc604", "frc1678", "frc2056"] })]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2024}
        algorithm="bpr"
        />,
      );
      const row = screen.getByTestId("match-row-m1");
      const ownSpan = within(row).getByText("118");
      const ownWrapper = ownSpan.closest(".match-alliance-nums");
      expect(ownWrapper, "expected the own number's ancestor wrapper to carry .match-alliance-nums").not.toBeNull();
      expect(ownWrapper!.className).toContain("match-alliance-nums--mine");
      expect(ownWrapper!.className).toContain("match-alliance-nums--red");
      expect(ownWrapper!.className).not.toContain("match-alliance-nums--blue");
      expect(ownSpan.className).toContain("match-alliance-num--own");

      const teammateSpan = within(row).getByText("254");
      expect(teammateSpan.className).not.toContain("match-alliance-num--own");
      expect(teammateSpan.closest(".match-alliance-nums")).toBe(ownWrapper);

      const opponentSpan = within(row).getByText("604");
      const opponentWrapper = opponentSpan.closest(".match-alliance-nums");
      expect(opponentWrapper!.className).not.toContain("match-alliance-nums--mine");
      expect(opponentWrapper!.className).not.toContain("match-alliance-nums--red");
      expect(opponentWrapper!.className).not.toContain("match-alliance-nums--blue");
    });

    it("carries no bold weight and no alliance-coloured text on any roster number", () => {
      renderWithRouter(
        <MatchTable
          matches={[makeMatch({ matchKey: "m1", redTeams: ["frc118", "frc254", "frc971"], blueTeams: ["frc604", "frc1678", "frc2056"] })]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2024}
        algorithm="bpr"
        />,
      );
      const row = screen.getByTestId("match-row-m1");
      const wrappers = row.querySelectorAll(".match-alliance-nums");
      expect(wrappers.length).toBeGreaterThan(0);
      for (const wrapper of Array.from(wrappers)) {
        expect(wrapper.className).not.toContain("font-semibold");
        expect(wrapper.className).not.toContain("font-bold");
        expect(wrapper.className).not.toMatch(/text-\[var\(--alliance/);
        for (const numberSpan of Array.from(wrapper.querySelectorAll(".match-alliance-num"))) {
          expect(numberSpan.className).not.toContain("font-semibold");
          expect(numberSpan.className).not.toContain("font-bold");
          expect(numberSpan.className).not.toMatch(/text-\[var\(--alliance/);
        }
      }
    });

    it("separates the roster numbers by layout gap, not a literal space character", () => {
      renderWithRouter(
        <MatchTable
          matches={[makeMatch({ matchKey: "m1", redTeams: ["frc118", "frc254", "frc971"], blueTeams: ["frc604", "frc1678", "frc2056"] })]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2024}
        algorithm="bpr"
        />,
      );
      const row = screen.getByTestId("match-row-m1");
      const ownWrapper = within(row).getByText("118").closest(".match-alliance-nums");
      expect(ownWrapper!.textContent).toBe("118254971");
    });

    it("marks the blue-alliance team's own line as a blue pill and leaves the red line unmarked", () => {
      renderWithRouter(
        <MatchTable
          matches={[makeMatch({ matchKey: "m1", redTeams: ["frc118", "frc254", "frc971"], blueTeams: ["frc604", "frc1678", "frc2056"] })]}
          domain={DOMAIN}
          teamKey="frc604"
          season={2024}
        algorithm="bpr"
        />,
      );
      const row = screen.getByTestId("match-row-m1");
      const ownSpan = within(row).getByText("604");
      const ownWrapper = ownSpan.closest(".match-alliance-nums");
      expect(ownWrapper!.className).toContain("match-alliance-nums--mine");
      expect(ownWrapper!.className).toContain("match-alliance-nums--blue");
      expect(ownSpan.className).toContain("match-alliance-num--own");

      const redWrapper = within(row).getByText("118").closest(".match-alliance-nums");
      expect(redWrapper!.className).not.toContain("match-alliance-nums--mine");
    });

    it("marks neither roster --mine nor any number --own for the WR-02 letter-suffixed-second-robot case", () => {
      renderWithRouter(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              redTeams: ["frc118", "frc254", "frc971"],
              blueTeams: ["frc604", "frc1678", "frc5199B"],
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc5199"
          season={2024}
        algorithm="bpr"
        />,
      );
      const row = screen.getByTestId("match-row-m1");
      const wrappers = row.querySelectorAll(".match-alliance-nums");
      expect(wrappers.length).toBeGreaterThan(0);
      for (const wrapper of Array.from(wrappers)) {
        expect(wrapper.className).not.toContain("match-alliance-nums--mine");
      }
      expect(row.querySelectorAll(".match-alliance-num--own").length).toBe(0);
    });
  });

  it("renders the axis header exactly once, with at least two labelled ticks, and never labels the lowest tick 0 for a 180-floor fixture", () => {
    renderWithRouter(<MatchTable matches={[makeMatch({ matchKey: "m1" })]} domain={{ min: 180, max: 300 }} teamKey="frc118"
        season={2024}
        algorithm="bpr"
      />);
    const axes = screen.getAllByTestId("axis-ticks");
    expect(axes).toHaveLength(1);
    const ticks = screen.getAllByTestId("axis-tick");
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]?.textContent).not.toBe("0");
  });

  it("still renders the full labelled axis for a single-match event", () => {
    renderWithRouter(<MatchTable matches={[makeMatch({ matchKey: "m1" })]} domain={DOMAIN} teamKey="frc118"
        season={2024}
        algorithm="bpr"
      />);
    expect(screen.getAllByTestId("axis-tick").length).toBeGreaterThanOrEqual(2);
  });

  it("renders alternating row tints — adjacent rows carry differing background classes (06-09-PLAN.md Task 3 polish pass)", () => {
    renderWithRouter(
      <MatchTable
        matches={[makeMatch({ matchKey: "m1" }), makeMatch({ matchKey: "m2" }), makeMatch({ matchKey: "m3" })]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
        algorithm="bpr"
      />,
    );
    const row1 = screen.getByTestId("match-row-m1");
    const row2 = screen.getByTestId("match-row-m2");
    const row3 = screen.getByTestId("match-row-m3");
    expect(row1.className).not.toContain("match-row-tint");
    expect(row2.className).toContain("match-row-tint");
    expect(row3.className).not.toContain("match-row-tint");
    expect(row1.className).not.toBe(row2.className);
  });

  /**
   * G-9 (07-UAT.md): the untinted row must carry its OWN explicit
   * `match-row-untinted` class rather than being left transparent — this
   * table happens to render correctly today only because `EventSection.tsx`
   * wraps it in `.event-card`, which quietly supplied the untinted colour by
   * inheritance. Asserting the explicit class here (rather than only "the
   * two rows differ") is what would have caught `EventMatchTable.tsx`
   * sharing this exact CSS class without that ancestor.
   */
  it("the untinted row carries its own explicit match-row-untinted class, not a bare transparent background", () => {
    renderWithRouter(
      <MatchTable
        matches={[makeMatch({ matchKey: "m1" }), makeMatch({ matchKey: "m2" })]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
        algorithm="bpr"
      />,
    );
    const row1 = screen.getByTestId("match-row-m1");
    const row2 = screen.getByTestId("match-row-m2");
    expect(row1.className).toContain("match-row-untinted");
    expect(row2.className).toContain("match-row-tint");

    const stickyCell1 = within(row1).getByText(matchLabel(makeMatch({ matchKey: "m1" }))).closest("td")!;
    const stickyCell2 = within(row2).getByText(matchLabel(makeMatch({ matchKey: "m2" }))).closest("td")!;
    expect(stickyCell1.className).toContain("match-row-untinted");
    expect(stickyCell2.className).toContain("match-row-tint");
  });

  it("renders the predicted-winner confidence chip in the alliance's own colour tokens, no bare string alone", () => {
    renderWithRouter(<MatchTable matches={[makeMatch({ matchKey: "m1", predictedWinner: "blue" })]} domain={DOMAIN} teamKey="frc118"
        season={2024}
        algorithm="bpr"
      />);
    const confidence = screen.getByTestId("confidence-m1");
    const chip = within(confidence).getByText("Blue");
    expect(chip.className).toContain("alliance-chip--blue");
  });

  it("renders matches in the exact order passed, never re-sorted", () => {
    renderWithRouter(
      <MatchTable
        matches={[makeMatch({ matchKey: "z-last" }), makeMatch({ matchKey: "a-first" })]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
        algorithm="bpr"
      />,
    );
    const rows = screen.getAllByTestId(/^match-row-/);
    expect(rows[0]?.getAttribute("data-testid")).toBe("match-row-z-last");
    expect(rows[1]?.getAttribute("data-testid")).toBe("match-row-a-first");
  });

  /**
   * Plan 06.1-06, Task 2 (F-06-1): real dot states on every eligible match
   * row. Closes success criterion 1 — no dot remains `unknown` for a played
   * qualification match with published per-bonus data.
   */
  describe("real bonus-RP dot states (plan 06.1-06, F-06-1)", () => {
    function collectDotStates(groupTestId: string): (string | null)[] {
      const group = screen.getByTestId(groupTestId);
      return Array.from(group.querySelectorAll("[data-testid^='bonus-dot-']")).map((dot) => dot.getAttribute("data-state"));
    }

    it("resolves every predicted and every actual dot to earned or missed — none unknown — for a two-bonus season (2024)", () => {
      renderWithRouter(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              actualWinner: "red",
              actualRedScore: 260,
              actualBlueScore: 200,
              redBonusRp: [0.7, 0.2],
              blueBonusRp: [0.1, 0.9],
              actualRedBonusRp: [true, false],
              actualBlueBonusRp: [false, true],
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2024}
        algorithm="bpr"
        />,
      );

      const predictedRed = collectDotStates("bonus-rp-predicted-m1-red");
      const predictedBlue = collectDotStates("bonus-rp-predicted-m1-blue");
      const actualRed = collectDotStates("bonus-rp-actual-m1-red");
      const actualBlue = collectDotStates("bonus-rp-actual-m1-blue");

      expect(predictedRed).toHaveLength(2);
      expect(predictedBlue).toHaveLength(2);
      expect(actualRed).toHaveLength(2);
      expect(actualBlue).toHaveLength(2);

      const allStates = [...predictedRed, ...predictedBlue, ...actualRed, ...actualBlue];
      expect(allStates.every((state) => state === "earned" || state === "missed")).toBe(true);
      expect(allStates).not.toContain("unknown");
    });

    it("resolves every predicted and every actual dot to earned or missed — none unknown — for a three-bonus season (2025)", () => {
      renderWithRouter(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              season: 2025,
              actualWinner: "red",
              actualRedScore: 260,
              actualBlueScore: 200,
              redBonusRp: [0.7, 0.2, 0.55],
              blueBonusRp: [0.1, 0.9, 0.4],
              actualRedBonusRp: [true, false, true],
              actualBlueBonusRp: [false, true, false],
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2025}
        algorithm="bpr"
        />,
      );

      const predictedRed = collectDotStates("bonus-rp-predicted-m1-red");
      const predictedBlue = collectDotStates("bonus-rp-predicted-m1-blue");
      const actualRed = collectDotStates("bonus-rp-actual-m1-red");
      const actualBlue = collectDotStates("bonus-rp-actual-m1-blue");

      expect(predictedRed).toHaveLength(3);
      expect(predictedBlue).toHaveLength(3);
      expect(actualRed).toHaveLength(3);
      expect(actualBlue).toHaveLength(3);

      const allStates = [...predictedRed, ...predictedBlue, ...actualRed, ...actualBlue];
      expect(allStates.every((state) => state === "earned" || state === "missed")).toBe(true);
      expect(allStates).not.toContain("unknown");
    });

    it("renders every actual dot unknown when actual bonus arrays are null, while predicted dots still resolve", () => {
      renderWithRouter(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              actualWinner: "red",
              actualRedScore: 260,
              actualBlueScore: 200,
              redBonusRp: [0.7, 0.2],
              blueBonusRp: [0.1, 0.9],
              actualRedBonusRp: null,
              actualBlueBonusRp: null,
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2024}
        algorithm="bpr"
        />,
      );

      const predictedRed = collectDotStates("bonus-rp-predicted-m1-red");
      const predictedBlue = collectDotStates("bonus-rp-predicted-m1-blue");
      const actualRed = collectDotStates("bonus-rp-actual-m1-red");
      const actualBlue = collectDotStates("bonus-rp-actual-m1-blue");

      expect(predictedRed).not.toContain("unknown");
      expect(predictedBlue).not.toContain("unknown");
      expect(actualRed.every((state) => state === "unknown")).toBe(true);
      expect(actualBlue.every((state) => state === "unknown")).toBe(true);
    });

    it("renders every dot unknown when a match carries none of the four bonus fields (pre-phase behaviour preserved)", () => {
      renderWithRouter(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              actualWinner: "red",
              actualRedScore: 260,
              actualBlueScore: 200,
              redBonusRp: undefined,
              blueBonusRp: undefined,
              actualRedBonusRp: undefined,
              actualBlueBonusRp: undefined,
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2024}
        algorithm="bpr"
        />,
      );

      const predictedRed = collectDotStates("bonus-rp-predicted-m1-red");
      const predictedBlue = collectDotStates("bonus-rp-predicted-m1-blue");
      const actualRed = collectDotStates("bonus-rp-actual-m1-red");
      const actualBlue = collectDotStates("bonus-rp-actual-m1-blue");

      expect(predictedRed.every((state) => state === "unknown")).toBe(true);
      expect(predictedBlue.every((state) => state === "unknown")).toBe(true);
      expect(actualRed.every((state) => state === "unknown")).toBe(true);
      expect(actualBlue.every((state) => state === "unknown")).toBe(true);
    });

    it("reads each alliance's own data only — red and blue never cross-read, given deliberately different arrays", () => {
      renderWithRouter(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              actualWinner: "red",
              actualRedScore: 260,
              actualBlueScore: 200,
              redBonusRp: [0.9, 0.9],
              blueBonusRp: [0.1, 0.1],
              actualRedBonusRp: [true, true],
              actualBlueBonusRp: [false, false],
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2024}
        algorithm="bpr"
        />,
      );

      expect(collectDotStates("bonus-rp-predicted-m1-red")).toEqual(["earned", "earned"]);
      expect(collectDotStates("bonus-rp-predicted-m1-blue")).toEqual(["missed", "missed"]);
      expect(collectDotStates("bonus-rp-actual-m1-red")).toEqual(["earned", "earned"]);
      expect(collectDotStates("bonus-rp-actual-m1-blue")).toEqual(["missed", "missed"]);
    });

    /**
     * G-06.1-26 (plan 06.1-08, Task 2): a played playoff match must render
     * every bonus dot `unknown` — never `earned`/`missed` — EVEN WHEN the
     * artifact handed to the component still carries populated actual
     * per-bonus arrays on that row (exactly the shape the 54,671
     * already-published 2022-2026 artifacts carry, per PD-16/PD-18). This is
     * the client-side defence-in-depth guard: it must hold with no
     * republish.
     */
    it("greys every dot to unknown for a played sf row whose artifact still carries populated actual per-bonus arrays (G-06.1-26, 2024 two-bonus season)", () => {
      renderWithRouter(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              compLevel: "sf",
              actualWinner: "red",
              actualRedScore: 260,
              actualBlueScore: 200,
              redBonusRp: [0.7, 0.2],
              blueBonusRp: [0.1, 0.9],
              actualRedBonusRp: [true, false],
              actualBlueBonusRp: [false, true],
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2024}
        algorithm="bpr"
        />,
      );

      const predictedRed = collectDotStates("bonus-rp-predicted-m1-red");
      const predictedBlue = collectDotStates("bonus-rp-predicted-m1-blue");
      const actualRed = collectDotStates("bonus-rp-actual-m1-red");
      const actualBlue = collectDotStates("bonus-rp-actual-m1-blue");

      const allStates = [...predictedRed, ...predictedBlue, ...actualRed, ...actualBlue];
      expect(allStates.every((state) => state === "unknown")).toBe(true);
      expect(allStates).not.toContain("earned");
      expect(allStates).not.toContain("missed");
    });

    it("greys every dot to unknown for a played f row whose artifact still carries populated actual per-bonus arrays (G-06.1-26, 2026 three-bonus season)", () => {
      renderWithRouter(
        <MatchTable
          matches={[
            makeMatch({
              matchKey: "m1",
              season: 2026,
              compLevel: "f",
              actualWinner: "red",
              actualRedScore: 260,
              actualBlueScore: 200,
              redBonusRp: [0.7, 0.2, 0.55],
              blueBonusRp: [0.1, 0.9, 0.4],
              actualRedBonusRp: [true, false, true],
              actualBlueBonusRp: [false, true, false],
            }),
          ]}
          domain={DOMAIN}
          teamKey="frc118"
          season={2026}
        algorithm="bpr"
        />,
      );

      const predictedRed = collectDotStates("bonus-rp-predicted-m1-red");
      const predictedBlue = collectDotStates("bonus-rp-predicted-m1-blue");
      const actualRed = collectDotStates("bonus-rp-actual-m1-red");
      const actualBlue = collectDotStates("bonus-rp-actual-m1-blue");

      const allStates = [...predictedRed, ...predictedBlue, ...actualRed, ...actualBlue];
      expect(allStates.every((state) => state === "unknown")).toBe(true);
      expect(allStates).not.toContain("earned");
      expect(allStates).not.toContain("missed");
    });
  });
});

describe("Match-column label links to /match/{matchKey} (260909-tiq-PLAN.md Task 3)", () => {
  it("a played row's Match label is a link whose href contains the match key, carrying the year and algorithm", () => {
    renderWithRouter(
      <MatchTable
        matches={[makeMatch({ matchKey: "2024casj_qm1", setNumber: 1, matchNumber: 1, actualWinner: "red", actualRedScore: 260, actualBlueScore: 200 })]}
        domain={DOMAIN}
        teamKey="frc118"
        season={2024}
        algorithm="bpr"
      />,
    );
    const row = screen.getByTestId("match-row-2024casj_qm1");
    const link = within(row).getByText("Qual 1").closest("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toContain("2024casj_qm1");
    expect(link?.getAttribute("href")).toContain("year=2024");
    expect(link?.getAttribute("href")).toContain("algorithm=bpr");
  });

  it("an unplayed row's Match label links exactly as a played row's does — a match page exists for both", () => {
    renderWithRouter(
      <MatchTable matches={[makeMatch({ matchKey: "2024casj_qm2", setNumber: 1, matchNumber: 2 })]} domain={DOMAIN} teamKey="frc118" season={2024} algorithm="bpr" />,
    );
    const row = screen.getByTestId("match-row-2024casj_qm2");
    const link = within(row).getByText("Qual 2").closest("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toContain("2024casj_qm2");
  });

  it("the match link does NOT join the .match-alliance-num class family, and the roster-number links beside it still resolve to team pages", () => {
    renderWithRouter(
      <MatchTable matches={[makeMatch({ matchKey: "2024casj_qm1", setNumber: 1, matchNumber: 1 })]} domain={DOMAIN} teamKey="frc118" season={2024} algorithm="bpr" />,
    );
    const row = screen.getByTestId("match-row-2024casj_qm1");
    const matchLink = within(row).getByText("Qual 1").closest("a");
    expect(matchLink?.className).not.toMatch(/match-alliance-num/);
    const rosterLink = within(row).getByText("118").closest("a");
    expect(rosterLink?.getAttribute("href")).toContain("/team/118");
  });
});
