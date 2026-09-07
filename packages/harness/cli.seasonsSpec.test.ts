/**
 * Quick task 260907-203: `cli.ts`'s `--seasons` parser accepted ONLY a single
 * contiguous `YYYY-YYYY` range, which cannot express the real corpus. The
 * corpus is 2016-2020 and 2022-2026 — 2021 is a PERMANENT exclusion (the
 * at-home season had no conventional 3v3 alliance matches, so there is
 * nothing to ingest or score), so `2016-2026` is not a harmless
 * over-specification: `isHeadlineEligible` (`score.ts`) counts DISTINCT
 * seasons in the DECLARED set strictly less than a given season, so an empty
 * 2021 sitting in that set buys every later season an undeserved prior and
 * silently corrupts headline eligibility.
 *
 * These cases pin the widened grammar as a MIRROR of `publish.ts`'s own
 * exported `parseSeasonsRange` (whose equivalent block lives in
 * `publish.test.ts`), deliberately including the two forms that already
 * worked — a single year and one contiguous range — because "the common case
 * is byte-identical to before" is the load-bearing half of this change. Every
 * other `--seasons` caller passes a plain range and must be unaffected.
 *
 * Importing `cli.ts` is side-effect-free: its `main()` runs only behind an
 * entry-point guard (see that file's tail), the same property
 * `cli.season-carry.test.ts` already relies on.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSeasonsRange } from "./cli.js";
import { parseSeasonsRange as parseSeasonsRangePublish } from "./publish.js";

/** The real corpus this quick task widened the parser to be able to name. 2021 is absent and stays absent. */
const TEN_SEASON_CORPUS = [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026];

describe("cli.ts parseSeasonsRange — gapped list form (quick task 260907-203)", () => {
  it("a contiguous range is unchanged — the pre-widening common case, byte-for-byte", () => {
    expect(parseSeasonsRange("2022-2026")).toEqual([2022, 2023, 2024, 2025, 2026]);
  });

  it("a single year now parses (the old parser rejected it — only publish.ts accepted this form)", () => {
    expect(parseSeasonsRange("2026")).toEqual([2026]);
  });

  it("the gapped list names the real ten-season corpus, and 2021 is NOT in it", () => {
    const parsed = parseSeasonsRange("2016-2020,2022-2026");
    expect(parsed).toEqual(TEN_SEASON_CORPUS);
    expect(parsed).not.toContain(2021);
  });

  it("the contiguous spelling of the same span would wrongly include 2021 — which is why the list form is required, not a convenience", () => {
    expect(parseSeasonsRange("2016-2026")).toContain(2021);
  });

  it("terms out of order, overlapping, and repeated collapse to one ascending, de-duplicated result", () => {
    expect(parseSeasonsRange("2026, 2016-2018, 2022-2026, 2019,2020, 2018,2022-2024")).toEqual(TEN_SEASON_CORPUS);
  });

  it("a malformed term throws and the message names the single-year form, the range form, and the list form", () => {
    expect(() => parseSeasonsRange("2016-2020,not-a-year,2022-2026")).toThrowError(
      /single year like "2026".*range like "2022-2026".*comma-separated list/
    );
  });

  it("a descending range still throws the existing >= start message", () => {
    expect(() => parseSeasonsRange("2026-2019")).toThrowError(/must be >= start/);
  });

  it("a descending range inside a LIST throws too — the check is per-term, not just on a bare spec", () => {
    expect(() => parseSeasonsRange("2016-2020,2026-2022")).toThrowError(/must be >= start/);
  });

  it("an empty spec throws", () => {
    expect(() => parseSeasonsRange("")).toThrowError(/must not be empty/);
  });

  it("a spec of nothing but separators and whitespace throws the same empty message", () => {
    expect(() => parseSeasonsRange(" , , ")).toThrowError(/must not be empty/);
  });

  it("a two-digit or five-digit year is not a year", () => {
    expect(() => parseSeasonsRange("16-20")).toThrowError(/single year like "2026"/);
    expect(() => parseSeasonsRange("20222-2026")).toThrowError(/single year like "2026"/);
  });
});

describe("cli.ts and publish.ts agree about --seasons (the anti-drift bar of 260907-203)", () => {
  const accepted = ["2026", "2022-2026", "2016-2020,2022-2026", "2026,2019,2022-2026,2020,2019", "2019, 2020 , 2022-2026"];

  it.each(accepted)("both parsers return the identical array for %j", (spec) => {
    expect(parseSeasonsRange(spec)).toEqual(parseSeasonsRangePublish(spec));
  });

  const rejected = ["", " , , ", "2026-2019", "2016-2020,not-a-year", "16-20"];

  it.each(rejected)("both parsers reject %j", (spec) => {
    expect(() => parseSeasonsRange(spec)).toThrow();
    expect(() => parseSeasonsRangePublish(spec)).toThrow();
  });
});

describe("package.json --seasons drift tripwire (cli-side mirror of publish.test.ts's own)", () => {
  it("publish:seasons' --seasons argument parses, through cli.ts's parser, to exactly the ten-season corpus", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    const script = pkg.scripts["publish:seasons"];
    expect(script, "publish:seasons script must exist in package.json").toBeDefined();

    const match = /--seasons\s+(\S+)/.exec(script!);
    expect(match, `--seasons argument not found in publish:seasons script: ${script}`).not.toBeNull();

    expect(parseSeasonsRange(match![1]!)).toEqual(TEN_SEASON_CORPUS);
  });
});
