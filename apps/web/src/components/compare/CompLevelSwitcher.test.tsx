import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  CompLevelSwitcher,
  COMP_LEVEL_VIEW_OPTIONS,
  COMP_LEVEL_SWITCHER_TESTID,
  DEFAULT_COMP_LEVEL_VIEW,
  compLevelSegmentTestId,
} from "./CompLevelSwitcher.js";

afterEach(() => {
  cleanup();
});

describe("COMP_LEVEL_VIEW_OPTIONS", () => {
  it("is ordered Combined, Qualification, Elimination and carries the Copywriting Contract's exact labels", () => {
    expect(COMP_LEVEL_VIEW_OPTIONS.map((o) => o.view)).toEqual(["combined", "qualification", "elimination"]);
    expect(COMP_LEVEL_VIEW_OPTIONS.map((o) => o.label)).toEqual(["Combined", "Qualification", "Elimination"]);
  });

  it("DEFAULT_COMP_LEVEL_VIEW is combined", () => {
    expect(DEFAULT_COMP_LEVEL_VIEW).toBe("combined");
  });
});

describe("CompLevelSwitcher — structure", () => {
  it("renders three segments in the fixed Combined/Qualification/Elimination order", () => {
    render(<CompLevelSwitcher value="combined" onValueChange={() => {}} />);
    const group = screen.getByTestId(COMP_LEVEL_SWITCHER_TESTID);
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Combined", "Qualification", "Elimination"]);
  });

  it("the container carries a group role and an accessible name", () => {
    render(<CompLevelSwitcher value="combined" onValueChange={() => {}} />);
    const group = screen.getByRole("group");
    expect(group.getAttribute("aria-label")).toBeTruthy();
  });

  it("every segment carries the .tap-target class", () => {
    render(<CompLevelSwitcher value="combined" onValueChange={() => {}} />);
    for (const option of COMP_LEVEL_VIEW_OPTIONS) {
      const segment = screen.getByTestId(compLevelSegmentTestId(option.view));
      expect(segment.className).toMatch(/tap-target/);
    }
  });
});

describe("CompLevelSwitcher — pressed state and active variant", () => {
  it("marks exactly the segment matching `value` as pressed, and the other two as not pressed", () => {
    render(<CompLevelSwitcher value="qualification" onValueChange={() => {}} />);
    expect(screen.getByTestId(compLevelSegmentTestId("combined")).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId(compLevelSegmentTestId("qualification")).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId(compLevelSegmentTestId("elimination")).getAttribute("aria-pressed")).toBe("false");
  });

  it("only the pressed segment carries the accent-filled default button variant; the other two carry ghost", () => {
    render(<CompLevelSwitcher value="elimination" onValueChange={() => {}} />);
    expect(screen.getByTestId(compLevelSegmentTestId("elimination")).getAttribute("data-variant")).toBe("default");
    expect(screen.getByTestId(compLevelSegmentTestId("combined")).getAttribute("data-variant")).toBe("ghost");
    expect(screen.getByTestId(compLevelSegmentTestId("qualification")).getAttribute("data-variant")).toBe("ghost");
  });
});

describe("CompLevelSwitcher — interaction", () => {
  it("clicking an unpressed segment calls onValueChange exactly once with that segment's view id", () => {
    const onValueChange = vi.fn();
    render(<CompLevelSwitcher value="combined" onValueChange={onValueChange} />);
    fireEvent.click(screen.getByTestId(compLevelSegmentTestId("elimination")));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("elimination");
  });

  it("clicking the already-pressed segment does not change which segment is pressed", () => {
    const onValueChange = vi.fn();
    render(<CompLevelSwitcher value="combined" onValueChange={onValueChange} />);
    fireEvent.click(screen.getByTestId(compLevelSegmentTestId("combined")));
    expect(screen.getByTestId(compLevelSegmentTestId("combined")).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId(compLevelSegmentTestId("qualification")).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId(compLevelSegmentTestId("elimination")).getAttribute("aria-pressed")).toBe("false");
  });

  it("is FULLY CONTROLLED: with `value` pinned and a no-op handler, clicking a different segment leaves the pressed segment unchanged — proof no second selection state lives inside the switcher", () => {
    render(<CompLevelSwitcher value="combined" onValueChange={() => {}} />);
    fireEvent.click(screen.getByTestId(compLevelSegmentTestId("elimination")));
    // A stateful implementation would now show "elimination" pressed. A
    // controlled one, with `value` still pinned to "combined" by the parent
    // (the no-op handler never updates it), must still show "combined"
    // pressed — this is a behavioural check, not a source grep, because a
    // source grep for a state hook would be defeated by a comment and would
    // not prove the hook was not used.
    expect(screen.getByTestId(compLevelSegmentTestId("combined")).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId(compLevelSegmentTestId("elimination")).getAttribute("aria-pressed")).toBe("false");
  });
});
