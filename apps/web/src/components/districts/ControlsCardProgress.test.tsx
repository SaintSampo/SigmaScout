/**
 * The controls card's run progress bar (quick task 261007-481): every progress
 * value it can draw, the exact plain class strings (the project rule that no
 * class here passes through `cn()` or sits beside a Tailwind colour utility,
 * made executable), and the CSS contract the `.locks-progress*` classes bind to.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ControlsCard } from "./LedgerParts.js";
import type { LedgerRunProgress } from "./ledgerRunProgress.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME_CSS_PATH = resolve(HERE, "..", "..", "styles", "theme.css");

function renderCard(progress: LedgerRunProgress | undefined) {
  render(
    <ControlsCard query="" onQueryChange={() => undefined} cutoff={{ cutoff: { kind: "pending" }, likely: undefined, districtOnly: false }} progress={progress}>
      <span>picker</span>
    </ControlsCard>
  );
}

describe("ControlsCard — the run progress bar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders no progressbar when progress is undefined", () => {
    renderCard(undefined);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByTestId("district-ledger-run-progress")).toBeNull();
  });

  it("draws a determinate bar with its range, spoken value and fill width, as the card's last row", () => {
    renderCard({ kind: "determinate", completed: 1, total: 4 });
    const bar = screen.getByRole("progressbar", { name: "Simulation progress" });
    expect(screen.getByTestId("district-ledger-run-progress")).toBe(bar);
    expect(bar.getAttribute("data-progress")).toBe("determinate");
    expect(bar.className).toBe("locks-progress");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("4");
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuetext")).toBe("1 of 4 events simulated");
    expect(bar.hasAttribute("aria-busy")).toBe(false);
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.className).toBe("locks-progress-fill");
    expect(fill.style.width).toBe("25%");
    expect(screen.getByTestId("district-ledger-controls").lastElementChild).toBe(bar);
  });

  it("draws an empty determinate bar with the singular spoken value for one event", () => {
    renderCard({ kind: "determinate", completed: 0, total: 1 });
    const bar = screen.getByRole("progressbar", { name: "Simulation progress" });
    expect(bar.getAttribute("aria-valuetext")).toBe("0 of 1 event simulated");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("0%");
  });

  it("draws an indeterminate bar that is busy and carries no value", () => {
    renderCard({ kind: "indeterminate" });
    const bar = screen.getByRole("progressbar", { name: "Simulation progress" });
    expect(bar.getAttribute("data-progress")).toBe("indeterminate");
    expect(bar.getAttribute("aria-busy")).toBe("true");
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
    expect(bar.hasAttribute("aria-valuemin")).toBe(false);
    expect(bar.hasAttribute("aria-valuemax")).toBe(false);
    expect(bar.hasAttribute("aria-valuetext")).toBe(false);
    expect(bar.className).toBe("locks-progress locks-progress--indeterminate");
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.className).toBe("locks-progress-fill");
    expect(fill.hasAttribute("style")).toBe(false);
    expect(screen.getByTestId("district-ledger-controls").lastElementChild).toBe(bar);
  });
});

describe("the run progress bar's CSS contract", () => {
  // CRLF normalised: core.autocrlf is true on this machine.
  const css = readFileSync(THEME_CSS_PATH, "utf8").replace(/\r\n/g, "\n");
  const start = css.lastIndexOf("/*", css.indexOf("The Locks milestone picker (sketch 024 variant Q)"));
  const end = css.indexOf("end of the Locks milestone picker block");
  const block = css.slice(start, end);

  it("lives inside the picker block, on theme tokens", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain("--locks-progress-track: var(--color-border)");
    expect(block).toContain("--locks-progress-fill: var(--color-accent)");
    expect(block).toContain("@keyframes locks-progress-sweep");
  });

  it("draws a 4px track", () => {
    const rule = block.slice(block.indexOf(".locks-progress {"));
    expect(block).toContain(".locks-progress {");
    expect(rule.slice(0, rule.indexOf("}"))).toContain("height: 4px");
  });

  it("stills the bar under reduced motion and swaps the sweep for a static soft bar", () => {
    const reduced = block.slice(block.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain("@media (prefers-reduced-motion: reduce)");
    expect(reduced).toContain(".locks-progress");
    expect(reduced).toContain("var(--locks-picker-accent-soft)");
  });
});
