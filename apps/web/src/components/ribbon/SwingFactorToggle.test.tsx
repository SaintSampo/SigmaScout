import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useDisplaySettingsStore } from "@/stores/displaySettings";
import { SwingFactorToggle } from "./SwingFactorToggle.js";

function resetStore() {
  useDisplaySettingsStore.setState({ showSwingFactor: true });
  window.localStorage.removeItem("sigmascout-display-settings");
}

describe("SwingFactorToggle (quick task 260908-5wd)", () => {
  afterEach(() => {
    cleanup();
    resetStore();
  });

  it("is reachable by an accessible name naming Swing Factor explicitly", () => {
    resetStore();
    render(<SwingFactorToggle />);

    expect(screen.getByRole("button", { name: /swing factor/i })).toBeDefined();
  });

  it("reports aria-pressed=true when showSwingFactor is on (the default)", () => {
    resetStore();
    render(<SwingFactorToggle />);

    expect(screen.getByRole("button", { name: /swing factor/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking toggles the store's showSwingFactor and updates aria-pressed", () => {
    resetStore();
    render(<SwingFactorToggle />);

    const button = screen.getByRole("button", { name: /swing factor/i });
    fireEvent.click(button);

    expect(useDisplaySettingsStore.getState().showSwingFactor).toBe(false);
    expect(screen.getByRole("button", { name: /swing factor/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("renders the ± glyph as its visible content", () => {
    resetStore();
    render(<SwingFactorToggle />);

    expect(screen.getByRole("button", { name: /swing factor/i }).textContent).toBe("±");
  });

  it("does not wear the .tap-target class — a 44px minimum here regressed the ribbon's row height on 2026-09-04", () => {
    resetStore();
    render(<SwingFactorToggle />);

    expect(screen.getByRole("button", { name: /swing factor/i }).className).not.toContain("tap-target");
  });
});
