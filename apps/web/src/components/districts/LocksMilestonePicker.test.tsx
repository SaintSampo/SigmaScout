/**
 * `LocksMilestonePicker` standalone: no router, only props and a spy for
 * `onAtChange`. The picker keeps no state of its own, so every assertion
 * either reads what a given `at` renders or reads what a control asks for.
 *
 * The last block is the CSS CONTRACT: it slices the picker's block out of
 * `theme.css` and pins the sketch 024 Q values most likely to drift, plus the
 * rule that the block writes no literal colour.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EventArtifactSchema, type EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { DistrictEventStateFacts } from "../../../../../packages/core/districts/reservedSlots.js";
import { DISTRICT_TIMELINE_NOW_ID, DISTRICT_TIMELINE_SEASON_START_ID, buildDistrictTimeline, resolveDistrictTimelinePosition } from "./districtTimeline.js";
import type { DistrictMilestoneEventInput } from "./districtMilestones.js";
import { LocksMilestonePicker } from "./LocksMilestonePicker.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME_CSS_PATH = resolve(HERE, "..", "..", "styles", "theme.css");

function state(overrides: Partial<DistrictEventStateFacts> = {}): DistrictEventStateFacts {
  return { qualMatchesPlayed: 12, qualMatchesTotal: 12, alliancesPicked: true, playoffsDone: true, awardsPosted: true, ...overrides };
}

const MID_QUALS = state({ qualMatchesPlayed: 6, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
const UNSTARTED = state({ qualMatchesPlayed: 0, alliancesPicked: false, playoffsDone: false, awardsPosted: false });

function input(eventKey: string, eventName: string, week: number | null, eventState: DistrictEventStateFacts | undefined, isDcmp = false): DistrictMilestoneEventInput {
  return { eventKey, eventName, week, isDcmp, state: eventState };
}

function eventArtifact(eventKey: string, count: number): EventArtifact {
  return EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "7.0.0+rolling",
    eventKey,
    season: 2026,
    matches: [],
    upcoming: Array.from({ length: count }, (_unused, i) => ({
      matchKey: `${eventKey}_qm${String(i + 1)}`,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: i + 1,
      sortTime: Date.parse("2026-03-06T17:00:00.000Z") + i * 60_000,
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc4", "frc5", "frc6"],
      predictedWinner: "red",
      pRedWin: 0.5,
      predictedRedScore: 50,
      predictedBlueScore: 50,
    })),
    teams: [],
  });
}

/** Alpha and Charlie finished, Bravo live in mid qualification, Delta not started, and a DCMP not started. */
const DISTRICT = [
  input("a", "Alpha", 0, state()),
  input("b", "Bravo", 1, MID_QUALS),
  input("c", "Charlie", 1, state()),
  input("d", "Delta", 2, UNSTARTED),
  input("cmp", "Big Championship", 5, UNSTARTED, true),
];

function renderPicker(options: { events?: readonly DistrictMilestoneEventInput[]; at?: string; artifacts?: [string, EventArtifact][] } = {}) {
  const events = options.events ?? DISTRICT;
  const timeline = buildDistrictTimeline({
    events: events.map(({ eventKey, eventName, week }) => ({ eventKey, eventName, week })),
    eventArtifacts: new Map(options.artifacts ?? []),
  });
  const onAtChange = vi.fn<(id: string) => void>();
  // One builder for render and rerender, so the two cannot drift apart.
  const element = (at: string | undefined) => (
    <LocksMilestonePicker timeline={timeline} events={events} at={at} positionIndex={resolveDistrictTimelinePosition(timeline, at)} onAtChange={onAtChange} />
  );
  const { rerender } = render(element(options.at));
  // Re-renders the SAME mounted picker at a new `at`, which is how the page
  // drives it; a fresh mount would hide any state that survives a re-render.
  const rerenderAt = (at: string | undefined) => rerender(element(at));
  return { onAtChange, timeline, rerenderAt };
}

const stops = () => [...screen.getByTestId("district-ledger-rewind").querySelectorAll<HTMLButtonElement>("[data-milestone]")];
const stop = (key: string) => screen.getByTestId("district-ledger-rewind").querySelector<HTMLButtonElement>(`[data-milestone="${key}"]`)!;
const select = () => screen.getByTestId("locks-picker-event") as HTMLSelectElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LocksMilestonePicker — the focused event's state", () => {
  it("marks a live event's position with the red now line and the live caption, and disables its unhappened stops", () => {
    renderPicker();
    expect(select().value).toBe("b");
    const now = screen.getByTestId("locks-picker-now");
    expect(now.hidden).toBe(false);
    // Written as `calc(3 * 100% / 13)`; jsdom may fold the constant arithmetic into one percentage.
    expect(["calc(3 * 100% / 13)", "calc(23.0769%)"]).toContain(now.style.left);
    expect(now.textContent).toBe("now");
    expect(screen.getByTestId("locks-picker-caption").textContent).toBe(
      "Bravo is live. Milestones past the red line have not happened yet; use Live for the current state."
    );
    expect(stops().map((button) => button.disabled)).toEqual([false, false, false, true, true, true, true, true, true, true, true, true, true]);
    for (const button of stops().slice(3)) expect(button.getAttribute("aria-label") ?? "").toMatch(/, not played yet$/);
    expect(stop("q1").getAttribute("aria-label")).toBe("Bravo quals ¼ done");
  });

  it("shows the not started caption, dashes every stop and disables the unstarted options when nothing has begun", () => {
    renderPicker({ events: [input("x", "Xray", 0, UNSTARTED), input("y", "Yankee", 1, undefined)] });
    expect(select().value).toBe("x");
    expect(screen.getByTestId("locks-picker-caption").textContent).toBe("Xray has not started. Its milestones open as they happen.");
    expect(stops()).toHaveLength(13);
    for (const button of stops()) expect(button.disabled).toBe(true);
    for (const option of select().querySelectorAll("option")) expect(option.disabled).toBe(true);
    expect(screen.getByTestId("locks-picker-now").hidden).toBe(true);
  });

  it("prints no caption for a finished event, and groups the menu by week with the DCMP last", () => {
    renderPicker({ at: "a:awards" });
    expect(select().value).toBe("a");
    expect(screen.getByTestId("locks-picker-caption").textContent).toBe("");
    const groups = [...select().querySelectorAll("optgroup")].map((group) => group.getAttribute("label"));
    expect(groups).toEqual(["Week 1 · done", "Week 2 · live", "Week 3 · not played yet", "DCMP · not played yet"]);
    const options = [...select().querySelectorAll("option")].map((option) => [option.textContent, option.disabled]);
    expect(options).toEqual([
      ["Alpha", false],
      ["Bravo (live)", false],
      ["Charlie", false],
      ["Delta", true],
      ["DCMP", true],
    ]);
  });
});

describe("LocksMilestonePicker — the arrows, the pills and the keys", () => {
  it("at a milestone the next arrow walks to the next stop and the Next text names it", () => {
    const { onAtChange } = renderPicker({ at: "a:m:a_qm6" });
    expect(stop("q2").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("locks-picker-next-text").textContent).toBe("Next: Alpha · Quals ¾ done");
    fireEvent.click(screen.getByTestId("locks-picker-next"));
    expect(onAtChange).toHaveBeenLastCalledWith("a:m:a_qm9");
    fireEvent.click(screen.getByTestId("locks-picker-prev"));
    expect(onAtChange).toHaveBeenLastCalledWith("a:m:a_qm3");
  });

  it("at Live the next arrow is disabled and the text reads This is live; at Start the prev arrow is disabled", () => {
    renderPicker();
    expect(screen.getByTestId("locks-picker-live").getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByTestId("locks-picker-next") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("locks-picker-next-text").textContent).toBe("This is live");
    cleanup();

    renderPicker({ at: DISTRICT_TIMELINE_SEASON_START_ID });
    expect(screen.getByTestId("locks-picker-season-start").getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByTestId("locks-picker-prev") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("locks-picker-next-text").textContent).toBe("Next: Alpha · Schedule released");
    // Alpha, week 0, is the first event in the walk, so the menu names it too.
    expect(select().value).toBe("a");
  });

  it("the pills ask for season start and now", () => {
    const { onAtChange } = renderPicker({ at: "a:awards" });
    fireEvent.click(screen.getByTestId("locks-picker-season-start"));
    expect(onAtChange).toHaveBeenLastCalledWith(DISTRICT_TIMELINE_SEASON_START_ID);
    fireEvent.click(screen.getByTestId("locks-picker-live"));
    expect(onAtChange).toHaveBeenLastCalledWith(DISTRICT_TIMELINE_NOW_ID);
  });

  it("walks with ArrowLeft, ArrowRight, Home and End on a stop, and ignores the same keys on the menu", () => {
    const { onAtChange } = renderPicker({ at: "a:m:a_qm6" });
    fireEvent.keyDown(stop("q2"), { key: "ArrowRight" });
    expect(onAtChange).toHaveBeenLastCalledWith("a:m:a_qm9");
    fireEvent.keyDown(stop("q2"), { key: "ArrowLeft" });
    expect(onAtChange).toHaveBeenLastCalledWith("a:m:a_qm3");
    fireEvent.keyDown(stop("q2"), { key: "Home" });
    expect(onAtChange).toHaveBeenLastCalledWith(DISTRICT_TIMELINE_SEASON_START_ID);
    fireEvent.keyDown(stop("q2"), { key: "End" });
    expect(onAtChange).toHaveBeenLastCalledWith(DISTRICT_TIMELINE_NOW_ID);
    expect(onAtChange).toHaveBeenCalledTimes(4);

    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) fireEvent.keyDown(select(), { key });
    expect(onAtChange).toHaveBeenCalledTimes(4);
  });

  it("clicking a stop asks for its own id", () => {
    const { onAtChange } = renderPicker({ at: "a:awards" });
    fireEvent.click(stop("alliance"));
    expect(onAtChange).toHaveBeenLastCalledWith("a:alliance");
  });
});

describe("LocksMilestonePicker — the event menu", () => {
  it("keeps the same stop when it has happened in the chosen event, else jumps to the chosen event's latest", () => {
    const { onAtChange } = renderPicker({ at: "a:m:a_qm9" });
    fireEvent.change(select(), { target: { value: "c" } });
    expect(onAtChange).toHaveBeenLastCalledWith("c:m:c_qm9");
    // Bravo has played 6 of 12, so its quals three quarters stop has not happened.
    fireEvent.change(select(), { target: { value: "b" } });
    expect(onAtChange).toHaveBeenLastCalledWith("b:m:b_qm6");
  });

  it("follows the selection on one mounted picker: a stop, Season start, Live, then the stop again (261007-3ik)", () => {
    const { rerenderAt } = renderPicker({ at: "c:awards" });
    expect(select().value).toBe("c");
    rerenderAt(DISTRICT_TIMELINE_SEASON_START_ID);
    expect(select().value).toBe("a");
    expect(screen.getByTestId("locks-picker-season-start").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("locks-picker-next-text").textContent).toBe("Next: Alpha · Schedule released");
    rerenderAt(undefined);
    expect(select().value).toBe("b");
    rerenderAt("c:awards");
    expect(select().value).toBe("c");
  });

  it("keeps a position's event in the menu with no stop pressed", () => {
    renderPicker({ at: "a:m:a_qm7", artifacts: [["a", eventArtifact("a", 12)]] });
    expect(select().value).toBe("a");
    expect(stops().some((button) => button.getAttribute("aria-pressed") === "true")).toBe(false);
    expect(stops().map((button) => button.classList.contains("locks-picker-stop--done"))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("LocksMilestonePicker — the thirteen column stepper (261007-3g2)", () => {
  it("labels five groups over thirteen stops, the Playoffs group spanning Round 1 to Round 5 and the Finals", () => {
    renderPicker();
    const groups = [...screen.getByTestId("district-ledger-rewind").querySelectorAll<HTMLElement>(".locks-picker-groups > span")];
    expect(groups.map((group) => [group.textContent, group.style.gridColumn])).toEqual([
      ["Schedule", "1 / 2"],
      ["Qualification", "2 / 6"],
      ["Alliances", "6 / 7"],
      ["Playoffs", "7 / 13"],
      ["Awards", "13 / 14"],
    ]);
    expect(stops()).toHaveLength(13);
    expect(stops().map((button) => button.getAttribute("data-milestone"))).toEqual([
      "schedule",
      "q1",
      "q2",
      "q3",
      "qualsDone",
      "alliance",
      "round1",
      "round2",
      "round3",
      "round4",
      "round5",
      "playoffs",
      "awards",
    ]);
    expect(stops().map((button) => button.textContent)).toEqual(["Out", "¼", "½", "¾", "Done", "Done", "R1", "R2", "R3", "R4", "R5", "Finals", "Done"]);
    // Quals done, Alliances done and Finals carry a narrow word for phone width
    // (measured at 375px); the accessible name keeps the long one.
    const shorts = stops().map((button) => button.querySelector(".locks-picker-stop-label")!.getAttribute("data-short"));
    expect(shorts).toEqual([null, null, null, null, "Q", "A", null, null, null, null, null, "F", null]);
    expect(stop("playoffs").getAttribute("aria-label")).toBe("Bravo finals done, not played yet");
  });

  it("sets the stop count as --locks-picker-stops and divides the fill by the count less one", () => {
    renderPicker({ at: "a:alliance" });
    const stepper = screen.getByTestId("district-ledger-rewind").querySelector<HTMLElement>(".locks-picker-stepper")!;
    expect(stepper.style.getPropertyValue("--locks-picker-stops")).toBe("13");
    const fill = screen.getByTestId("district-ledger-rewind").querySelector<HTMLElement>(".locks-picker-line-fill")!;
    expect(fill.style.width).toBe(`${String((5 / 12) * 100)}%`);
    cleanup();
    renderPicker({ at: "a:awards" });
    expect(screen.getByTestId("district-ledger-rewind").querySelector<HTMLElement>(".locks-picker-line-fill")!.style.width).toBe("100%");
  });

  it("presses Round 2 at ?at=a:round:2 and reads ?at=a:round:6 as Live", () => {
    const { rerenderAt } = renderPicker({ at: "a:round:2" });
    expect(select().value).toBe("a");
    expect(stop("round2").getAttribute("aria-pressed")).toBe("true");
    expect(stop("round2").getAttribute("aria-label")).toBe("Alpha round 2 done");
    expect(screen.getByTestId("locks-picker-next-text").textContent).toBe("Next: Alpha · Round 3 done");
    rerenderAt("a:round:6");
    expect(screen.getByTestId("locks-picker-live").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("LocksMilestonePicker — no rewind note (261005-5g0)", () => {
  // A rewound view is an as-of forecast since quick task 261005-5g0, so the
  // note that said its predictions knew later results is gone at every stop.
  for (const at of ["a:awards", DISTRICT_TIMELINE_SEASON_START_ID, undefined]) {
    it(`prints no rewind note at ${at ?? "Live"}, and the arrows row stays last`, () => {
      renderPicker(at === undefined ? {} : { at });
      expect(screen.queryByTestId("locks-picker-rewind-note")).toBeNull();
      expect(screen.getByTestId("district-ledger-rewind").lastElementChild?.classList.contains("locks-picker-row--nav")).toBe(true);
    });
  }
});

describe("the picker's CSS contract (sketch 024 Q, columns from the stop count)", () => {
  // `core.autocrlf` is true on this machine, so a checkout can carry CRLF.
  const css = readFileSync(THEME_CSS_PATH, "utf8").replace(/\r\n/g, "\n");
  // From the header comment's own opening, so stripping comments below removes it whole.
  const start = css.lastIndexOf("/*", css.indexOf("The Locks milestone picker (sketch 024 variant Q)"));
  const end = css.indexOf("end of the Locks milestone picker block");
  const block = css.slice(start, end);

  it("finds the block between its two markers", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("carries the stop count geometry and the sketch's own sizes", () => {
    expect(block).toContain("repeat(var(--locks-picker-stops), minmax(0, 1fr))");
    expect(block).toContain("calc(100% / (2 * var(--locks-picker-stops)))");
    expect(block).not.toContain("repeat(8,");
    expect(block).toMatch(/\.locks-picker-stop-label\[data-short\] \{[^}]*font-size: 0;/);
    expect(block).toMatch(/\.locks-picker-stop-label\[data-short\]::after \{[^}]*content: attr\(data-short\);[^}]*font-size: 11px;/);
    expect(block).toContain("border: 5px solid");
    expect(block).toContain("0 0 0 4px var(--locks-picker-accent-soft)");
    expect(block).toMatch(/\[aria-pressed="true"\] \.locks-picker-dot \{[^}]*width: 20px;[^}]*height: 20px;/);
    expect(block).toMatch(/\.locks-picker-now::after \{[^}]*height: 30px;/);
    expect(block).toMatch(/\.locks-picker-ibtn \{[^}]*width: 36px;[^}]*height: 36px;/);
    expect(block).toMatch(/\.locks-picker-select \{[^}]*min-height: 38px;/);
    expect(block).toMatch(/\.locks-picker-pill \{[^}]*min-height: 34px;/);
    expect(block).toContain("@keyframes locks-picker-pulse");
    expect(block).toContain("prefers-reduced-motion");
    expect(block).toContain("max-width: 520px");
  });

  it("writes no hex, rgb or hsl literal", () => {
    const code = block.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});
