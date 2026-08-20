/**
 * Review-frontmatter drift linter (D-16, 03.1-05-PLAN.md).
 *
 * WHAT THIS CHECKS (one mechanical invariant, deliberately narrow):
 * ===================================================================
 * A `*-REVIEW.md` file's frontmatter `resolution:` block must agree with its own body:
 *   - `resolution.resolved` must equal the number of "#### Resolution" subsections in the body.
 *   - `resolution.resolved + resolution.open` must equal `findings.total`.
 *   - `resolution.open_ids`'s length must equal `resolution.open`.
 *   - If `resolution.open` is 0, `status` must not still read `issues_found` — a status
 *     contradicting its own resolution counts is exactly the drift this linter exists to catch.
 * A file with no `resolution:` key at all is valid (a fresh, unresolved review) UNLESS its body
 * already contains resolution subsections with no frontmatter block recording them.
 *
 * WHAT THIS DOES NOT CHECK — read this before assuming broader coverage:
 * ===================================================================
 * This is NOT a full cross-artifact consistency checker. It was deliberately scoped to this one
 * invariant rather than built as a general review-to-resolutions / verification-to-UAT /
 * STATE-blockers-to-security checker, for two recorded reasons (03.1-CONTEXT.md D-16):
 *   1. A full checker would have caught all four drift cases the 2026-08-19 milestone audit found
 *      (this review-frontmatter drift, a stale VERIFICATION.md human-verification item, and a
 *      stale STATE.md blocker claim), but doing so means parsing prose out of STATE.md — a
 *      meaningful tooling build that risks becoming its own phase rather than a narrow guard.
 *   2. Relying on existing GSD tooling was also rejected: `gsd-tools audit-open` was run during
 *      this phase's discussion and reported all artifact types clear while two REVIEW.md files
 *      carried an `issues_found` status with no resolution recorded — it does not detect this
 *      class of drift at all.
 * This linter therefore says nothing about whether a VERIFICATION.md's human-verification section
 * is stale, whether STATE.md's Blockers/Concerns list is stale, or whether a review's *content*
 * (as opposed to its resolution bookkeeping) is accurate. A future reader should not mistake a
 * clean run of this linter for a guarantee that all planning artifacts agree with HEAD.
 *
 * PARSING APPROACH:
 * ===================================================================
 * The frontmatter blocks this linter reads are simple, flat-and-one-level-nested YAML. Per
 * CLAUDE.md's stance against adding a dependency preemptively, this file hand-rolls a small
 * line-oriented parser for exactly the keys it needs (`findings.total`, `resolution.resolved`,
 * `resolution.open`, `resolution.open_ids`, top-level `status`) rather than pulling in a YAML
 * library. It is not a general YAML parser and does not attempt to be one.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ReviewLintProblem {
  /** The path of the review file the problem was found in. */
  file: string;
  /** Human-readable message naming the file and the specific numbers that disagree. */
  message: string;
}

interface ParsedFrontmatter {
  findingsTotal: number | undefined;
  resolutionPresent: boolean;
  resolvedCount: number | undefined;
  openCount: number | undefined;
  openIds: string[] | undefined;
  status: string | undefined;
}

// Matches "#### Resolution" at the start of a line, tolerating a trailing parenthetical date,
// e.g. "#### Resolution (2026-08-14)" — the exact heading form 02-REVIEW.md establishes.
const RESOLUTION_SUBSECTION_HEADING = /^####\s+Resolution(?:\s*\([^)]*\))?\s*$/;

/**
 * Splits `contents` into its frontmatter block (the lines between the first two "---" delimiter
 * lines) and the body (everything after the closing delimiter). Returns null if the file has no
 * frontmatter delimiters at all, so callers can report a problem rather than throwing.
 */
function splitFrontmatter(contents: string): { frontmatterLines: string[]; body: string } | null {
  const lines = contents.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) return null;

  const frontmatterLines = lines.slice(1, closingIndex);
  const body = lines.slice(closingIndex + 1).join("\n");
  return { frontmatterLines, body };
}

/**
 * Hand-rolled parse of exactly the keys this linter needs from a flat/one-level-nested
 * frontmatter block: the `total` under `findings:`, and the `resolved`/`open`/`open_ids` under
 * `resolution:` (an absent `resolution:` key is tracked separately from one whose counts are 0),
 * plus the top-level `status`.
 */
function parseFrontmatter(frontmatterLines: string[]): ParsedFrontmatter {
  let currentTopKey: string | null = null;
  let findingsTotal: number | undefined;
  let resolutionPresent = false;
  let resolvedCount: number | undefined;
  let openCount: number | undefined;
  let openIds: string[] | undefined;
  let status: string | undefined;

  for (const raw of frontmatterLines) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();

    if (indent === 0) {
      const topMatch = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(trimmed);
      if (!topMatch) {
        currentTopKey = null;
        continue;
      }
      const key = topMatch[1]!;
      const rest = topMatch[2] ?? "";
      if (key === "findings") {
        currentTopKey = "findings";
      } else if (key === "resolution") {
        currentTopKey = "resolution";
        resolutionPresent = true;
      } else if (key === "status") {
        status = rest.trim();
        currentTopKey = null;
      } else {
        currentTopKey = null;
      }
      continue;
    }

    // Nested (indented) line under whichever top-level key we're currently inside.
    if (currentTopKey === "findings") {
      const totalMatch = /^total:\s*(\d+)/.exec(trimmed);
      if (totalMatch) findingsTotal = Number(totalMatch[1]);
    } else if (currentTopKey === "resolution") {
      const resolvedMatch = /^resolved:\s*(\d+)/.exec(trimmed);
      if (resolvedMatch) {
        resolvedCount = Number(resolvedMatch[1]);
        continue;
      }
      const openMatch = /^open:\s*(\d+)/.exec(trimmed);
      if (openMatch) {
        openCount = Number(openMatch[1]);
        continue;
      }
      const openIdsMatch = /^open_ids:\s*\[(.*)\]/.exec(trimmed);
      if (openIdsMatch) {
        const inner = (openIdsMatch[1] ?? "").trim();
        openIds = inner.length === 0 ? [] : inner.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
        continue;
      }
      // resolved_at / note are not needed for the mechanical check and are intentionally ignored.
    }
  }

  return { findingsTotal, resolutionPresent, resolvedCount, openCount, openIds, status };
}

/**
 * Checks one review file's frontmatter resolution counts against its body's resolution
 * subsections and its own findings total and status. Returns one entry per violation rather than
 * throwing, so a single run reports every problem across every file at once.
 */
export function lintReviewFile(path: string, contents: string): ReviewLintProblem[] {
  const split = splitFrontmatter(contents);
  if (split === null) {
    return [
      {
        file: path,
        message: `${path}: no frontmatter delimiters found — expected two "---" lines bounding a frontmatter block`,
      },
    ];
  }

  const { frontmatterLines, body } = split;
  const fm = parseFrontmatter(frontmatterLines);

  const bodyResolutionCount = body
    .split(/\r?\n/)
    .filter((line) => RESOLUTION_SUBSECTION_HEADING.test(line)).length;

  const problems: ReviewLintProblem[] = [];

  if (!fm.resolutionPresent) {
    if (bodyResolutionCount > 0) {
      problems.push({
        file: path,
        message: `${path}: body has ${bodyResolutionCount} "#### Resolution" subsection(s) but frontmatter has no "resolution:" key recording them`,
      });
    }
    return problems;
  }

  const resolved = fm.resolvedCount ?? 0;
  const open = fm.openCount ?? 0;
  const findingsTotal = fm.findingsTotal ?? 0;
  const openIdsLen = fm.openIds?.length ?? 0;

  if (resolved !== bodyResolutionCount) {
    problems.push({
      file: path,
      message: `${path}: frontmatter resolution.resolved=${resolved} disagrees with ${bodyResolutionCount} "#### Resolution" subsection(s) found in the body`,
    });
  }

  if (resolved + open !== findingsTotal) {
    problems.push({
      file: path,
      message: `${path}: resolution.resolved (${resolved}) + resolution.open (${open}) = ${resolved + open}, which does not equal findings.total (${findingsTotal})`,
    });
  }

  if (openIdsLen !== open) {
    problems.push({
      file: path,
      message: `${path}: resolution.open_ids has ${openIdsLen} id(s) but resolution.open=${open}`,
    });
  }

  if (open === 0 && fm.status === "issues_found") {
    problems.push({
      file: path,
      message: `${path}: resolution.open=0 (every finding resolved) but status still reads "issues_found" — contradicts its own resolution counts`,
    });
  }

  return problems;
}

/**
 * Finds every `[0-9]*-REVIEW.md` file one directory level under `phasesDir` — the real
 * repository shape is `.planning/phases/<phase-dir>/[0-9]*-REVIEW.md`.
 */
export function findReviewFiles(phasesDir: string): string[] {
  const results: string[] = [];
  let phaseDirEntries: string[];
  try {
    phaseDirEntries = readdirSync(phasesDir);
  } catch {
    return results;
  }

  for (const entry of phaseDirEntries) {
    const full = join(phasesDir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    let files: string[];
    try {
      files = readdirSync(full);
    } catch {
      continue;
    }
    for (const f of files) {
      if (/^[0-9].*-REVIEW\.md$/.test(f)) {
        results.push(join(full, f));
      }
    }
  }

  return results;
}

/**
 * Script entry point: runs the check over every real review file and reports the result.
 * `phasesDirOverride` lets a test point this at a temporary directory instead of the real
 * `.planning/phases/` — the default (positional CLI arg omitted) is the real project directory.
 */
function runScript(phasesDirOverride?: string): void {
  let phasesDir: string;
  if (phasesDirOverride) {
    phasesDir = phasesDirOverride;
  } else {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(scriptDir, "..");
    phasesDir = join(repoRoot, ".planning", "phases");
  }

  const files = findReviewFiles(phasesDir);
  let problemCount = 0;

  for (const file of files) {
    const contents = readFileSync(file, "utf-8");
    const problems = lintReviewFile(file, contents);
    for (const problem of problems) {
      console.log(problem.message);
      problemCount++;
    }
  }

  if (problemCount === 0) {
    console.log(`reviewFrontmatterLint: ${files.length} review file(s) checked, 0 problems`);
    process.exit(0);
  } else {
    console.log(`reviewFrontmatterLint: ${files.length} review file(s) checked, ${problemCount} problem(s)`);
    process.exit(1);
  }
}

// Only run as a script when this module is executed directly (`tsx scripts/reviewFrontmatterLint.ts`),
// not when imported by the test file.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  runScript(process.argv[2]);
}
