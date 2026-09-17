import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { HIGHLIGHT_NOTE, METHODOLOGY_NOTE_TESTID, MethodologyNote } from "./MethodologyNote.js";

afterEach(() => {
  cleanup();
});

describe("MethodologyNote — rendering", () => {
  it("renders exactly one paragraph: the highlight note", () => {
    render(<MethodologyNote />);
    const note = screen.getByTestId(METHODOLOGY_NOTE_TESTID);
    const paragraphs = note.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toBe(HIGHLIGHT_NOTE);
  });

  it("is always visible: no button, no disclosure toggle; the paragraph carries the muted body treatment", () => {
    render(<MethodologyNote />);
    const note = screen.getByTestId(METHODOLOGY_NOTE_TESTID);
    expect(within(note).queryAllByRole("button")).toHaveLength(0);
    expect(note.querySelector("details")).toBeNull();
    const paragraph = note.querySelector("p");
    expect(paragraph?.className).toMatch(/text-role-body/);
    expect(paragraph?.className).toMatch(/text-\[var\(--color-text-muted\)\]/);
  });

  it("explains the highlight in plain words and names no threshold it cannot point at", () => {
    expect(HIGHLIGHT_NOTE).toContain("highlighted");
    expect(HIGHLIGHT_NOTE).toContain("too close to call");
    expect(HIGHLIGHT_NOTE.toLowerCase()).not.toMatch(/threshold|below|above/);
  });

  it("renders no significance-claiming vocabulary, case-insensitively", () => {
    const text = HIGHLIGHT_NOTE.toLowerCase();
    expect(text).not.toMatch(/statistically significant/);
    expect(text).not.toMatch(/significance level/);
    expect(text).not.toMatch(/p-value/);
    expect(text).not.toMatch(/mcnemar/);
  });

  it("renders no reference to the retired tune/holdout categories, and no cold-start paragraph", () => {
    const text = HIGHLIGHT_NOTE.toLowerCase();
    expect(text).not.toMatch(/\btune\b/);
    expect(text).not.toMatch(/\bholdout\b/);
    expect(text).not.toMatch(/first.ever|first match|nothing to predict/);
  });

  it("carries no hyphen minus, en dash or em dash", () => {
    expect(HIGHLIGHT_NOTE).not.toMatch(/[-–—]/);
  });
});
