import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { findReviewFiles, lintReviewFile, type ReviewLintProblem } from "./reviewFrontmatterLint.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const PHASES_DIR = join(REPO_ROOT, ".planning", "phases");
const SCRIPT_PATH = join(__dirname, "reviewFrontmatterLint.ts");
const TSX_CLI_PATH = join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

const FRESH_UNRESOLVED = `---
phase: fixture-phase
findings:
  critical: 0
  warning: 2
  info: 0
  total: 2
status: issues_found
---

# Fixture Review

## Warnings

### WR-01: something

Some finding text, unresolved.

### WR-02: something else

Some other finding text, unresolved.
`;

const RESOLUTION_SUBSECTIONS_WITH_NO_FRONTMATTER_KEY = `---
phase: fixture-phase
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
status: issues_found
---

### WR-01: something

Some finding text.

#### Resolution (2026-08-20)

Resolved via commit abc1234.
`;

const CONSISTENT_RESOLVED = `---
phase: fixture-phase
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
resolution:
  resolved: 2
  open: 1
  open_ids: [IN-01]
  resolved_at: 2026-08-20
  note: fixture note
status: issues_found
---

### WR-01: something

Some finding text.

#### Resolution (2026-08-20)

Resolved via commit abc1234.

### WR-02: something else

Some other finding text.

#### Resolution (2026-08-20)

Resolved via commit def5678.

### IN-01: remains open by design

Info-level finding text, intentionally left open.
`;

function withResolutionBlock(resolvedCount: number, openCount: number, openIds: string, findingsTotal: number, status = "issues_found"): string {
  return `---
phase: fixture-phase
findings:
  critical: 0
  warning: 2
  info: 1
  total: ${findingsTotal}
resolution:
  resolved: ${resolvedCount}
  open: ${openCount}
  open_ids: [${openIds}]
  resolved_at: 2026-08-20
  note: fixture note
status: ${status}
---

### WR-01: something

Some finding text.

#### Resolution (2026-08-20)

Resolved via commit abc1234.

### WR-02: something else

Some other finding text.

#### Resolution (2026-08-20)

Resolved via commit def5678.

### IN-01: remains open by design

Info-level finding text, intentionally left open.
`;
}

const NO_FRONTMATTER_AT_ALL = `# Just a markdown file

No frontmatter delimiters anywhere in this file.
`;

describe("lintReviewFile (D-16)", () => {
  it("reports no problem for a fresh, unresolved review (no resolution: key, no body resolution subsections)", () => {
    expect(lintReviewFile("fixture.md", FRESH_UNRESOLVED)).toEqual([]);
  });

  it("reports a problem naming the file and the body count when frontmatter has no resolution: key but the body has resolution subsections", () => {
    const problems = lintReviewFile("fixture.md", RESOLUTION_SUBSECTIONS_WITH_NO_FRONTMATTER_KEY);
    expect(problems.length).toBe(1);
    expect(problems[0]!.file).toBe("fixture.md");
    expect(problems[0]!.message).toContain("fixture.md");
    expect(problems[0]!.message).toContain("1");
    expect(problems[0]!.message).toMatch(/no "resolution:" key/);
  });

  it("reports no problem when resolution.resolved equals the body count, resolved+open equals findings.total, and open_ids length equals open", () => {
    expect(lintReviewFile("fixture.md", CONSISTENT_RESOLVED)).toEqual([]);
  });

  it("reports a problem naming both numbers when resolution.resolved disagrees with the body's resolution subsection count", () => {
    // resolution.resolved=3 but only 2 "#### Resolution" subsections exist in the body.
    const fixture = withResolutionBlock(3, 0, "", 3);
    const problems = lintReviewFile("fixture.md", fixture);
    const mismatch = problems.find((p) => p.message.includes("disagrees with"));
    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toContain("resolution.resolved=3");
    expect(mismatch!.message).toContain("2");
  });

  it("reports a problem naming all three numbers when resolved+open does not equal findings.total", () => {
    // resolved=2 (matches body count), open=2 (sum=4), findings.total=3 -> mismatch.
    const fixture = withResolutionBlock(2, 2, "IN-01, IN-02", 3);
    const problems = lintReviewFile("fixture.md", fixture);
    const mismatch = problems.find((p) => p.message.includes("does not equal findings.total"));
    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toContain("resolution.resolved (2)");
    expect(mismatch!.message).toContain("resolution.open (2)");
    expect(mismatch!.message).toContain("findings.total (3)");
  });

  it("reports a problem naming both numbers when open_ids length does not equal resolution.open", () => {
    // resolved=2 (matches body), open=1, open_ids=[] (length 0) -> mismatch. resolved+open=3=total.
    const fixture = withResolutionBlock(2, 1, "", 3);
    const problems = lintReviewFile("fixture.md", fixture);
    const mismatch = problems.find((p) => p.message.includes("open_ids has"));
    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toContain("open_ids has 0 id(s)");
    expect(mismatch!.message).toContain("resolution.open=1");
  });

  it("reports a problem when resolution.open is zero while status still reads the issues-found value", () => {
    // All three findings resolved (resolved=3, open=0), but the fixture body only has 2
    // "#### Resolution" subsections (WR-01/WR-02) and IN-01 is left unresolved in the body text —
    // to isolate the status-contradiction check alone, use a 2-finding fixture where the body
    // count genuinely agrees.
    const fixture = `---
phase: fixture-phase
findings:
  critical: 0
  warning: 2
  info: 0
  total: 2
resolution:
  resolved: 2
  open: 0
  open_ids: []
  resolved_at: 2026-08-20
  note: fixture note
status: issues_found
---

### WR-01: something

#### Resolution (2026-08-20)

Resolved via commit abc1234.

### WR-02: something else

#### Resolution (2026-08-20)

Resolved via commit def5678.
`;
    const problems = lintReviewFile("fixture.md", fixture);
    expect(problems.length).toBe(1);
    expect(problems[0]!.message).toMatch(/status still reads "issues_found"/);
  });

  it("reports a problem naming the file (not throwing) for a file with no frontmatter delimiters at all", () => {
    expect(() => lintReviewFile("fixture.md", NO_FRONTMATTER_AT_ALL)).not.toThrow();
    const problems = lintReviewFile("fixture.md", NO_FRONTMATTER_AT_ALL);
    expect(problems.length).toBe(1);
    expect(problems[0]!.file).toBe("fixture.md");
    expect(problems[0]!.message).toContain("fixture.md");
    expect(problems[0]!.message).toMatch(/no frontmatter delimiters/);
  });

  it("runs over every real review file under .planning/phases/ and reports zero problems (Task 2's regression proof)", () => {
    const files = findReviewFiles(PHASES_DIR);
    expect(files.length).toBeGreaterThan(0);
    const allProblems: ReviewLintProblem[] = [];
    for (const file of files) {
      const contents = readFileSync(file, "utf-8");
      allProblems.push(...lintReviewFile(file, contents));
    }
    expect(allProblems).toEqual([]);
  });
});

describe("reviewFrontmatterLint.ts script form", () => {
  it("exits non-zero and prints each problem on its own line when a review file is malformed; exits zero and prints a count when clean", () => {
    const tmpBase = mkdtempSync(join(tmpdir(), "review-lint-"));
    try {
      const phaseDir = join(tmpBase, "99-fixture-phase");
      mkdirSync(phaseDir, { recursive: true });
      const reviewFile = join(phaseDir, "99-REVIEW.md");

      // Dirty state: resolution.resolved disagrees with the body's subsection count.
      writeFileSync(reviewFile, withResolutionBlock(3, 0, "", 3), "utf-8");

      let dirtyExitCode: number | null | undefined;
      let dirtyOutput = "";
      try {
        dirtyOutput = execFileSync(process.execPath, [TSX_CLI_PATH, SCRIPT_PATH, tmpBase], {
          encoding: "utf-8",
        });
      } catch (err) {
        const execErr = err as { status?: number | null; stdout?: string };
        dirtyExitCode = execErr.status ?? null;
        dirtyOutput = execErr.stdout ?? "";
      }
      expect(dirtyExitCode).not.toBe(0);
      expect(dirtyExitCode).not.toBeUndefined();
      const dirtyLines = dirtyOutput.split(/\r?\n/).filter((l) => l.length > 0);
      expect(dirtyLines.length).toBeGreaterThanOrEqual(2); // at least one problem line + the summary line

      // Clean state: a fully consistent resolution block.
      writeFileSync(reviewFile, CONSISTENT_RESOLVED, "utf-8");
      const cleanOutput = execFileSync(process.execPath, [TSX_CLI_PATH, SCRIPT_PATH, tmpBase], {
        encoding: "utf-8",
      });
      expect(cleanOutput).toContain("0 problems");
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
