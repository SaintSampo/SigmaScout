/**
 * Regression guard for 260902-sbr-filter-dropdown-scrollbar-artifact.
 *
 * The strongest available check would be: render the Events page in jsdom,
 * open the Week dropdown, and assert `body`'s computed `padding-right` (or,
 * per the measured mechanism, `margin-right`) is `0px` while it is open —
 * that is the actual user-visible invariant. That check was NOT possible
 * here: vitest's default `test.css` setting (unset, so `false`) treats CSS
 * imports as a no-op in jsdom — `theme.css`'s rules are never injected into
 * the test DOM at all, so `getComputedStyle` on any element in a jsdom test
 * reflects the UA stylesheet only, never this file's rules. There is
 * nothing this suite could open a dropdown against.
 *
 * This is the documented fallback: assert the shipped `theme.css` TEXT
 * carries the fixed rule shape, not a runtime measurement. It fails against
 * the pre-fix file (which declared `scrollbar-gutter: stable` and no
 * override for react-remove-scroll-bar's injected margin) and passes
 * against the fixed one.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME_CSS_PATH = resolve(HERE, "theme.css");

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

describe("theme.css scrollbar rules (260902-sbr)", () => {
  it("html carries `overflow-y: scroll`, not `scrollbar-gutter`", () => {
    const css = readThemeCss();
    const htmlRuleBody = findRuleBody(css, /^html$/);
    expect(htmlRuleBody, "expected a bare `html { ... }` rule in theme.css").not.toBeNull();
    expect(htmlRuleBody).toMatch(/overflow-y:\s*scroll\s*;/);

    // The old `scrollbar-gutter: stable` mechanism let a `body { overflow:
    // hidden }` scroll lock propagate to the viewport and remove the page
    // scrollbar while the gutter kept reserving its space — the reported
    // white strip. `overflow-y: scroll` replaces it outright: asserting its
    // absence here is what stops a future edit from silently reintroducing
    // the propagation bug under the guise of "simplifying" back to the
    // gutter-only rule.
    expect(htmlRuleBody).not.toMatch(/scrollbar-gutter/);
  });

  it("neutralises react-remove-scroll-bar's injected margin-right on body[data-scroll-locked]", () => {
    const css = readThemeCss();
    // Matches, in order: real-file text carries `html body[data-scroll-locked]`
    // (any amount of whitespace between tokens).
    const overrideRuleBody = findRuleBody(css, /^html\s+body\[data-scroll-locked\]$/);
    expect(
      overrideRuleBody,
      "expected a `html body[data-scroll-locked] { ... }` override rule in theme.css",
    ).not.toBeNull();
    expect(overrideRuleBody).toMatch(/margin-right:\s*0\s*!important\s*;/);
  });

  it("does not rely on --removed-body-scroll-bar-size, which react-remove-scroll-bar never reads back", () => {
    // Measured directly against the installed react-remove-scroll-bar@2.3.8:
    // its injected stylesheet WRITES `--removed-body-scroll-bar-size` on
    // `body[data-scroll-locked]` but never reads it back with `var(...)` —
    // the actual `margin-right` value it applies is a literal number baked
    // in at mount time. Pinning that custom property would silently do
    // nothing. (The comment naming the property above this file's fixture
    // is fine — this only forbids actually CONSUMING it, i.e. no live
    // declaration reads `var(--removed-body-scroll-bar-size...)`.)
    const css = readThemeCss();
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/var\(\s*--removed-body-scroll-bar-size/);
  });
});
