import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Drift guard for the ribbon-sigma favicon (quick task 260904-6k1).
 *
 * All three files below are resolved relative to THIS module (not the
 * process cwd) with `fileURLToPath` + `import.meta.url`, since a bare
 * `vitest run` at the repo root picks up a different file set than
 * `vitest run` invoked from `apps/web` -- cwd-relative paths are exactly how
 * a test starts passing in one invocation and failing in the other
 * (STATE.md: "Test scope trap").
 *
 * The self-containment assertions below each guard against a specific
 * silent-degradation mode: a favicon document cannot fetch an external
 * resource, so a script element, an embedded @font-face, an xlink:href, or
 * an http(s) href would not error -- it would just quietly fail to resolve
 * on someone else's machine while looking fine on the machine that has the
 * resource cached or reachable.
 */

const testDir = dirname(fileURLToPath(import.meta.url));
const faviconPath = resolve(testDir, "../public/favicon.svg");
const indexHtmlPath = resolve(testDir, "../index.html");
const themeCssPath = resolve(testDir, "./styles/theme.css");
const publicDir = resolve(testDir, "../public");

const faviconSvg = readFileSync(faviconPath, "utf-8");
const indexHtml = readFileSync(indexHtmlPath, "utf-8");
const themeCss = readFileSync(themeCssPath, "utf-8");

function extractToken(css: string, tokenName: string): string {
  const match = css.match(new RegExp(`--${tokenName}:\\s*([^;]+);`));
  const captured = match?.[1];
  if (captured === undefined) {
    throw new Error(`expected to find --${tokenName} in theme.css`);
  }
  return captured.trim();
}

describe("favicon color drift guard", () => {
  it("favicon contains theme.css's --ribbon-bg value", () => {
    const ribbonBg = extractToken(themeCss, "ribbon-bg");
    expect(faviconSvg.toLowerCase()).toContain(ribbonBg.toLowerCase());
  });

  it("favicon contains theme.css's --ribbon-accent value", () => {
    const ribbonAccent = extractToken(themeCss, "ribbon-accent");
    expect(faviconSvg.toLowerCase()).toContain(ribbonAccent.toLowerCase());
  });
});

describe("favicon wiring", () => {
  it("index.html declares an icon link whose href resolves to an existing public/ file", () => {
    const match = indexHtml.match(/<link\s+rel="icon"[^>]*href="([^"]+)"/);
    const href = match?.[1];
    if (href === undefined) {
      throw new Error("expected an icon <link> in index.html");
    }
    expect(href.startsWith("/")).toBe(true);
    const filePath = resolve(publicDir, href.slice(1));
    expect(existsSync(filePath), `expected ${filePath} to exist under apps/web/public/`).toBe(true);
  });
});

describe("favicon self-containment", () => {
  it("contains no script element", () => {
    expect(faviconSvg).not.toMatch(/<script/i);
  });

  it("contains no embedded font declaration", () => {
    expect(faviconSvg).not.toMatch(/@font-face/i);
  });

  it("contains no xlink:href reference", () => {
    expect(faviconSvg).not.toMatch(/xlink:href/i);
  });

  it("contains no http(s) href", () => {
    expect(faviconSvg).not.toMatch(/href="http/i);
  });

  it("contains no text-rendering element (would depend on an installed font)", () => {
    expect(faviconSvg).not.toMatch(/<text[\s>]/i);
  });

  it("parses as well-formed XML", () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(faviconSvg, "image/svg+xml");
    const parserError = doc.querySelector("parsererror");
    expect(parserError, `SVG failed to parse: ${parserError?.textContent ?? ""}`).toBeNull();
  });
});
