/**
 * Task 4 (260902-ixg): the `line`-variant tab strip jumps ~3px on the first
 * hover — measured live on the event page: the strip's `y` sits at 235 on
 * load, settles to 232 the moment a hover forces a style recalc, and stays
 * there. Root cause, measured (not guessed): `TabsTrigger`'s base class sets
 * `h-[calc(100%-1px)]` against `TabsList`'s own fixed `h-8` (32px), while
 * `.tap-target`'s `min-height: 44px` (applied per-trigger on the event page)
 * forces every trigger to 44px anyway — a percentage height computed against
 * a container 12px shorter than the box actually renders at. `TabsList`
 * itself only measures this circular relationship correctly once its OWN
 * height stops being pinned to `h-8` for the `line` variant too.
 *
 * jsdom performs no layout, so this file cannot assert real pixel heights —
 * that verification is done by live measurement against the running dev
 * server (see the quick task's SUMMARY.md). What this file CAN and does pin,
 * at the source level, is that the `line` variant carries an auto-height
 * override on both the trigger and the list, ending the percentage-height
 * dependency the bug traces to.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

function renderLineTabs() {
  render(
    <Tabs defaultValue="a">
      <TabsList variant="line">
        <TabsTrigger value="a" className="tap-target">
          A
        </TabsTrigger>
        <TabsTrigger value="b" className="tap-target">
          B
        </TabsTrigger>
      </TabsList>
    </Tabs>,
  );
}

describe("TabsTrigger — line variant carries no percentage-height dependency on TabsList (Task 4, 260902-ixg)", () => {
  it("does NOT carry the base `h-[calc(100%-1px)]` class value un-overridden for the line variant", () => {
    renderLineTabs();
    const trigger = screen.getAllByRole("tab")[0]!;
    // The base class is still present in the string (it targets the
    // `default` variant, scoped via a data-attribute selector at the CSS
    // level) -- what must ALSO be present is a line-variant override that
    // wins over it. Asserting only "the override class exists" pins the
    // fix without depending on cascade/specificity mechanics jsdom can't
    // evaluate anyway.
    expect(trigger.className).toMatch(/group-data-\[variant=line\]\/tabs-list:h-auto/);
  });
});

describe("TabsList — line variant is not pinned to a fixed h-8, so it can grow to match a tall trigger (Task 4, 260902-ixg)", () => {
  it("carries a line-scoped auto-height override alongside the shared h-8", () => {
    renderLineTabs();
    const list = screen.getByRole("tablist");
    expect(list.className).toMatch(/data-\[variant=line\]:h-auto/);
  });

  it("also zeroes its own vertical padding for the line variant, so listH equals triggerH exactly rather than triggerH plus the list's own padding", () => {
    renderLineTabs();
    const list = screen.getByRole("tablist");
    expect(list.className).toMatch(/data-\[variant=line\]:py-0/);
  });
});

describe("TabsTrigger — transition is narrowed off layout properties (Task 4, 260902-ixg)", () => {
  it("does not carry transition-all on the line-variant trigger", () => {
    renderLineTabs();
    const trigger = screen.getAllByRole("tab")[0]!;
    expect(trigger.className).not.toMatch(/(^|\s)transition-all(\s|$)/);
  });
});
