import { describe, expect, it } from "vitest";
import {
  assertWithinPageBudget,
  computeSizeStats,
  PAGE_BUDGET_MAX_BYTES,
  parsePublishBudget,
  PublishBudgetExceededError,
  PublishBudgetParseError,
  renderPublishBudgetBlock,
  replacePublishBudgetBlock,
  type PageKindSizeStats,
} from "./publishBudget.js";
import type { PageKind } from "./pageArtifacts.js";

function stats(maxBytes: number, largestKey: string): PageKindSizeStats {
  return { count: 3, medianBytes: Math.floor(maxBytes / 2), p95Bytes: maxBytes - 1, maxBytes, largestKey };
}

const FULL_PAGES: Record<PageKind, PageKindSizeStats> = {
  compare: stats(14_000, "v1/compare/2026.json"),
  event: stats(250_000, "v1/event/2026mrcmp/spr@3.0.0+baseline.json"),
  events: stats(84_000, "v1/events/2025/epa@10.0.0+baseline.json"),
  team: stats(256_000, "v1/team/frc3538/2024/spr@3.0.0+baseline.json"),
  teams: stats(1_500_000, "v1/teams/2026/epa@10.0.0+baseline.json"),
};

describe("assertWithinPageBudget", () => {
  it("passes exactly at the ceiling and throws a named error above it, naming kind, key, bytes and ceiling", () => {
    const ceilings = { ...PAGE_BUDGET_MAX_BYTES, team: 100 };
    expect(() => assertWithinPageBudget("team", "v1/team/frc1/2026/spr@3.0.0+baseline.json", 100, ceilings)).not.toThrow();
    let caught: unknown;
    try {
      assertWithinPageBudget("team", "v1/team/frc1/2026/spr@3.0.0+baseline.json", 101, ceilings);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PublishBudgetExceededError);
    const message = (caught as Error).message;
    expect(message).toContain("team");
    expect(message).toContain("v1/team/frc1/2026/spr@3.0.0+baseline.json");
    expect(message).toContain("101");
    expect(message).toContain("100");
  });

  it("the constant is frozen", () => {
    expect(Object.isFrozen(PAGE_BUDGET_MAX_BYTES)).toBe(true);
  });
});

describe("renderPublishBudgetBlock / parsePublishBudget / replacePublishBudgetBlock", () => {
  it("render -> parse round-trips a summary's pages into the block shape payloadBudget.test.ts reads, ceilings from the constant", () => {
    const block = renderPublishBudgetBlock({ measuredAt: "2026-09-13T20:00:00.000Z", run: "publish.ts --seasons 2026", pages: FULL_PAGES });
    const parsed = parsePublishBudget(`# Doc\n\n${block}\n`);
    expect(parsed.measuredAt).toBe("2026-09-13T20:00:00.000Z");
    expect(parsed.run).toBe("publish.ts --seasons 2026");
    expect(Object.keys(parsed)).toEqual(["measuredAt", "run", "pages"]);
    expect(Object.keys(parsed.pages)).toEqual(["teams", "team", "events", "event", "compare"]);
    for (const [kind, entry] of Object.entries(parsed.pages)) {
      expect(Object.keys(entry)).toEqual(["count", "medianBytes", "p95Bytes", "maxBytes", "budgetMaxBytes", "largestKey"]);
      const source = FULL_PAGES[kind as PageKind];
      expect(entry).toEqual({ ...source, budgetMaxBytes: PAGE_BUDGET_MAX_BYTES[kind as PageKind] });
    }
    expect(block.startsWith("```json budget\n{\n  \"measuredAt\"")).toBe(true);
    expect(block.endsWith("\n}\n```")).toBe(true);
  });

  it("renders from computeSizeStats output directly", () => {
    const records = (["teams", "team", "events", "event", "compare"] as const).map((pageKind, i) => ({ pageKind, key: `v1/${pageKind}/${i}.json`, bytes: 10 + i }));
    expect(() => renderPublishBudgetBlock({ measuredAt: "m", run: "r", pages: computeSizeStats(records) })).not.toThrow();
  });

  it("throws when the summary is missing any of the five page kinds", () => {
    for (const missing of Object.keys(FULL_PAGES) as PageKind[]) {
      const pages: Partial<Record<PageKind, PageKindSizeStats>> = { ...FULL_PAGES };
      delete pages[missing];
      expect(() => renderPublishBudgetBlock({ measuredAt: "m", run: "r", pages }), missing).toThrow(missing);
    }
  });

  it("replacing the block leaves every byte outside the fence unchanged, LF and CRLF alike", () => {
    const block = renderPublishBudgetBlock({ measuredAt: "new", run: "new run", pages: FULL_PAGES });
    for (const eol of ["\n", "\r\n"]) {
      const before = `# Publish budget${eol}${eol}Some prose | with a table${eol}${eol}`;
      const after = `${eol}${eol}## Trailing section${eol}Text with $& and $1 in it.${eol}`;
      const oldBlock = ["```json budget", '{"measuredAt":"old","run":"old","pages":{}}', "```"].join(eol);
      const replaced = replacePublishBudgetBlock(before + oldBlock + after, block);
      expect(replaced).toBe(before + block + after);
      expect(parsePublishBudget(replaced).measuredAt).toBe("new");
    }
  });

  it("a document with no block makes replace throw the named parse error", () => {
    expect(() => replacePublishBudgetBlock("# Doc\n\nNo block.\n", "```json budget\n{}\n```")).toThrow(PublishBudgetParseError);
  });
});
