/**
 * `MatchVideoCell` coverage (quick task 260906-7eu Task 2, TDD RED): the four
 * component bullets in the plan's `<behavior>` block.
 */
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { MatchVideoCell } from "./MatchVideoCell.js";

afterEach(() => {
  cleanup();
});

describe("MatchVideoCell — a video key that parses", () => {
  it("renders exactly one control with an accessible name naming the match, and zero iframe elements before any interaction", () => {
    const { container } = render(<MatchVideoCell matchKey="2024casj_qm12" matchLabel="Qual 12" videoKey="dQw4w9WgXcQ" />);

    // getByRole with a `name` filter throws if no element's ACCESSIBLE NAME
    // (not merely its text content) matches — this is the accessible-name
    // assertion itself, with no jest-dom matcher dependency (this workspace
    // deliberately carries none — see StateViews.test.tsx's own note).
    const button = screen.getByRole("button", { name: /Qual 12/ });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(button).toBeTruthy();
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });
});

describe("MatchVideoCell — a video key that does not parse", () => {
  it("renders no control and no iframe", () => {
    const { container } = render(<MatchVideoCell matchKey="2024casj_qm12" matchLabel="Qual 12" videoKey="not-a-valid-id!" />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
  });
});

describe("MatchVideoCell — no video key at all", () => {
  it("renders no control, no iframe, and no text content", () => {
    const { container } = render(<MatchVideoCell matchKey="2024casj_qm12" matchLabel="Qual 12" />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
    expect(container.textContent).toBe("");
  });
});

describe("MatchVideoCell — after activation", () => {
  it("mounts exactly one iframe whose src contains the parsed id, inside an element with a dialog role, whose accessible name includes the match label", () => {
    render(<MatchVideoCell matchKey="2024casj_qm12" matchLabel="Qual 12" videoKey="dQw4w9WgXcQ" />);

    fireEvent.click(screen.getByRole("button"));

    // Same accessible-name assertion pattern as the trigger button's own
    // test above — `getByRole` with a `name` filter throws if no dialog's
    // accessible name matches.
    const dialog = screen.getByRole("dialog", { name: /Qual 12/ });

    const iframes = document.querySelectorAll("iframe");
    expect(iframes).toHaveLength(1);
    expect(iframes[0]?.getAttribute("src")).toContain("dQw4w9WgXcQ");
    expect(dialog.contains(iframes[0]!)).toBe(true);
  });
});
