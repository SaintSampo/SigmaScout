/**
 * The standing D-05 assertion, SOURCE half (plan 07-16 Task 3). Mirrors
 * `browserSafeSchemas.test.ts`'s shape: a filesystem/import-graph scan
 * asserting a structural property, not a behaviour.
 *
 * This is a THREE-WAY split, and this file is only ONE of the three parts —
 * naming all three here is what keeps this test from reading as either a
 * duplicate of a later plan's check or a claim that the rename is finished.
 * TWO of the three thirds have now landed:
 *
 *   - SOURCE (this file, plan 07-16): no identity-shaped occurrence of the
 *     retired id `sigma1` (or its four harness-only variants) survives
 *     anywhere in the tracked tree outside a short, individually-reasoned,
 *     length-asserted exclusion list. LANDED.
 *   - CLIENT (plan 07-18 Task 3, this commit): the client-package exclusion
 *     entry that used to sit in `IDENTITY_SWEEP_EXCLUSIONS` below is DELETED
 *     here — the deployed browser no longer reads the pre-rename R2 prefix
 *     (07-18 Tasks 1-2 moved it), so the gate now walks the client tree with
 *     the rest of the repository and finds nothing. LANDED.
 *   - LIVE (plan 07-19, still outstanding): zero `sigma1@` objects in R2 and
 *     zero `algorithm_id = 'sigma1'` rows in D1 — a fact about the deployed
 *     bucket and database, which no source-level test run on a checkout can
 *     prove. Roughly eighteen thousand objects and a live D1 row still carry
 *     the retired id at this commit, deliberately left in place so this
 *     cutover stays revertible; 07-19 deletes them and redeploys the Worker
 *     under the renamed live-fold tier. A fully green run of THIS file must
 *     never be read as the rename being finished — it proves the source and
 *     client thirds, not the live one.
 *
 * Walks the repository from its root with `readdirSync` (not `git
 * ls-files` — PD-06: dependency-free, deterministic, no coupling to a git
 * checkout or the host shell), skipping the directory names below and any
 * file that is not text (detected by content, not extension, so a binary
 * file dropped anywhere is still handled safely).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

/** Directory names skipped anywhere in the tree — generated/vendored/gitignored content, never source. */
const SKIPPED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "reports",
  "corpus",
  ".wrangler",
  "test-results",
  "playwright-report",
  "coverage",
]);

/**
 * Filenames skipped regardless of directory — the secrets-handling
 * convention in `.claude/CLAUDE.md` prohibits rendering `.env` contents into
 * any output stream, including a test failure message. A repo-root walk (as
 * opposed to `git ls-files`) would otherwise read this gitignored, untracked
 * file directly off disk. None of these files could legitimately carry an
 * algorithm-identity string, so skipping them costs the sweep nothing.
 */
function isSkippedFile(name: string): boolean {
  return name === ".env" || /^\.env\..*/.test(name);
}

/**
 * Path-prefix exclusions, seeded with eight entries at 07-16 Task 3 and
 * decremented to SEVEN here (plan 07-18 Task 3 deleted the client-package
 * exclusion entry) — the length is itself asserted below (T-07-16-06 /
 * prohibition 2), so a further entry added later is a deliberate, reviewed
 * diff, never a quiet way to make a red gate green.
 */
export const IDENTITY_SWEEP_EXCLUSIONS: readonly string[] = [
  ".planning/", // planning history — decisions, plans, summaries recorded under the id in force when they were written
  ".claude/", // Claude configuration and skill directories — conventions and frozen sketch sources
  "REBUILD_SPEC.md", // project history — the pre-v3 failure log this rebuild is grounded in
  "docs/models/", // measurement records — Brier scores, tuning results measured and reported under the pre-rename id
  "docs/first-paint-measurement.md", // measurement record
  "docs/publish-budget.md", // measurement record; 07-19 re-measures it against the D-18-enlarged schema
  "data/baselines/", // frozen run fingerprints — committed exactly as measured, never rewritten
];

/**
 * A SEPARATE, small, individually-reasoned list — deliberately NOT folded
 * into `IDENTITY_SWEEP_EXCLUSIONS` above, whose length-8 assertion is about
 * the three-tier classification (P/C/F) this plan's outline drew. These
 * five entries are not about tier classification at all; they are genuine
 * hits the re-grep found that fit none of the three tiers cleanly (Task 3's
 * own required accounting — see the SUMMARY's "hit that fit none of the
 * three tiers" table), each reasoned individually rather than folded into
 * the tier list to keep that list's own invariant meaningful:
 *
 *   - This file cites the retired ids literally to define what it scans
 *     for — a sensor is not required to sense itself.
 *   - `browserSafeSchemas.test.ts` cites `"sigma1"` only as an individual
 *     path-segment ARGUMENT to `node:path`'s `resolve()` (the implementation
 *     directory name PD-02 keeps) — a sweep-pattern limitation (the pattern
 *     cannot distinguish a quoted path segment from a quoted identity value
 *     without parsing call syntax), not an unrenamed identity.
 *   - `publishedAlgorithms.ts` is PD-01's own named dual-tier file: through
 *     07-16 and 07-17 its `PUBLISHED_ALGORITHM_IDS` value was deliberately
 *     unrenamed browser-facing content, but the file itself lives in the
 *     harness package, not the client package — the plan's outline
 *     enumerated the CLIENT exclusion by directory, and this was the one
 *     browser-facing value that did not live under that directory. 07-18
 *     Task 1 moved this value (the collapse), the same commit that deletes
 *     the client-package entry above.
 *   - `baselineFingerprint.test.ts` asserts against
 *     `data/baselines/opr-event-scoped-2026-08.json`'s own committed,
 *     frozen content (tier F) — the test must cite the frozen ids literally
 *     to verify them; the JSON fixture itself is already excluded via
 *     `data/baselines/` above, but the *.test.ts file that reads it lives
 *     outside that directory.
 *   - `scripts/verifySubsetPublish.ts` verifies CURRENTLY PUBLISHED reality
 *     against the live public origin (tier C in substance — it reads
 *     exactly what a browser would read today — but the script lives
 *     outside the client package). 07-17 extends its expectation table;
 *     07-19 is what the published reality itself moves to.
 *   - `publish.test.ts` proves T-07-16-01/Test 9's NEGATIVE assertion — that
 *     the retired id is now REJECTED by `resolvePublishAlgorithms` and that
 *     no emitted key contains the retired `sigma1@` segment. Asserting
 *     rejection of a string requires citing that exact string; a test
 *     proving an id is refused is proof the rename landed, not a leftover
 *     of it.
 *   - `apps/worker/test/liveAlgorithmTier.test.ts` (added by plan 07-18
 *     Task 1) proves the SAME shape of NEGATIVE assertion at the Worker
 *     tier: after the two-id-tier collapse, `parseLiveAlgorithmIds("sigma1")`
 *     must still throw `UnknownLiveAlgorithmIdError` rather than silently
 *     folding the retired id back in as a member. Citing the exact retired
 *     string is what makes the rejection proof meaningful, identical
 *     reasoning to the `publish.test.ts` entry above.
 */
export const STRUCTURAL_EXEMPTIONS: readonly string[] = [
  "packages/harness/algorithmIdentity.test.ts",
  "packages/harness/browserSafeSchemas.test.ts",
  "packages/harness/publishedAlgorithms.ts",
  "packages/harness/baselineFingerprint.test.ts",
  "scripts/verifySubsetPublish.ts",
  "packages/harness/publish.test.ts",
  "apps/worker/test/liveAlgorithmTier.test.ts",
];

/** The comment marker (PD-05) that exempts a measured-figure citation from the sweep — but ONLY on a comment line. A marker on any other kind of line is a violation, not an exemption (prohibition 2's mechanical form). */
export const PRE_RENAME_MARKER = "[pre-rename]";

/**
 * The cap on how many marker-exempted PATTERN MATCHES (not lines — one
 * line can carry more than one identity-shaped match) may legitimately
 * exist across the whole tree. Flagged assumption 4 set the original bound
 * at 12 from an eight-to-ten-citation estimate found before the full
 * re-grep ran. 07-16 Task 3's real re-grep found 13, all genuine measured
 * citations correctly marked (`docs/worker-operations.md`'s "Verified
 * 2026-08-23" section alone carries several, since a real historical
 * verification run's log output and CLI invocation are quoted verbatim in
 * multiple places).
 *
 * Raised again here, to 19, by plan 07-18 Task 3's own re-grep of the newly
 * un-excluded client tree — six new genuine citations, each a historical
 * attribution comment naming the pre-rename id (the three e2e specs' own
 * "confirmed live"/"published under" artifact-key citations, one comment in
 * `query-client.ts` attributing a config rename to plan 07-16, and two
 * comments in `searchParams.ts` explaining where `DEFAULT_ALGORITHM`'s
 * value moved from). Each is disclosed individually above at its own site;
 * raised in a visible diff with this reason — not by widening a file
 * exclusion, which prohibition 2 forbids.
 */
const MARKER_CAP = 19;

/** The retired published identity and its four harness-only siblings — the exact set this sweep looks for. */
const RETIRED_IDS = ["sigma1", "sigma1-defaults", "sigma1-seasonsd", "sigma1-normalcdf", "sigma1-adapt"] as const;

/** True when `line`'s first non-whitespace characters are a comment opener — the only condition under which `PRE_RENAME_MARKER` is honoured. */
function startsWithCommentOpener(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("--")
  );
}

/**
 * Identity-shaped occurrences ONLY, not every appearance of the token: the
 * id inside matching double/single/backtick quotes (exact — the quote
 * character immediately precedes and follows the id, so `"sigma1-adapt"`
 * cannot be mistaken for a hit on the `sigma1` pattern); the id immediately
 * followed by an at-sign (the artifact-key/version-file segment shape,
 * `sigma1@2.0.0...`); the id as the value of an `algorithm=` query
 * parameter; and the id as the right-hand side of an `algorithm_id`
 * SQL/JS comparison or assignment. Deliberately does NOT match a bare
 * occurrence inside a filesystem path segment (`.../sigma1/index.ts`) —
 * under PD-02 the implementation module keeps its directory name, and a
 * pattern that matched it would fail on every import line in the repository.
 */
function buildPatternsFor(id: string): RegExp[] {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`"${escaped}"`), // "sigma1"
    new RegExp(`'${escaped}'`), // 'sigma1'
    new RegExp("`" + escaped + "`"), // `sigma1`
    new RegExp(`${escaped}@`), // sigma1@2.0.0+tuned-2026-08.json
    new RegExp(`algorithm=${escaped}(?:[&"'\`]|$)`), // ?algorithm=sigma1
    new RegExp(`algorithm_id\\s*[=:]{1,2}\\s*['"\`]${escaped}['"\`]`), // algorithm_id = 'sigma1' / algorithm_id: "sigma1" / algorithm_id === "sigma1"
  ];
}

const PATTERNS_BY_ID: ReadonlyMap<string, RegExp[]> = new Map(RETIRED_IDS.map((id) => [id, buildPatternsFor(id)]));

interface Violation {
  file: string;
  line: number;
  text: string;
  matched: string;
}

interface SweepResult {
  violations: Violation[];
  markerExemptedCount: number;
}

function isExcluded(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (STRUCTURAL_EXEMPTIONS.includes(normalized)) return true;
  return IDENTITY_SWEEP_EXCLUSIONS.some((prefix) => normalized === prefix.replace(/\/$/, "") || normalized.startsWith(prefix));
}

/**
 * Content-based text detection: a NUL byte or the Unicode replacement
 * character is treated as binary and skipped, so a stray binary file
 * anywhere in the tree (a `.sqlite`, a `.woff2`, a `.png`) never crashes or
 * pollutes the scan — no extension allowlist to keep in sync. Built via
 * `String.fromCharCode` rather than an inline escape, so this source file
 * itself never carries a literal control byte.
 */
const NUL_CHAR = String.fromCharCode(0);
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

function looksBinary(content: string): boolean {
  return content.indexOf(NUL_CHAR) !== -1 || content.indexOf(REPLACEMENT_CHAR) !== -1;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIPPED_DIR_NAMES.has(entry)) continue;
    if (isSkippedFile(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (st.isFile()) {
      out.push(full);
    }
  }
}

function runSweep(): SweepResult {
  const files: string[] = [];
  walk(REPO_ROOT, files);

  const violations: Violation[] = [];
  let markerExemptedCount = 0;

  for (const absPath of files) {
    const relPath = absPath.slice(REPO_ROOT.length + 1);
    const excluded = isExcluded(relPath);

    let content: string;
    try {
      content = readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    if (looksBinary(content)) continue;

    const isMarkdown = relPath.toLowerCase().endsWith(".md");
    let inFencedCodeBlock = false;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      if (isMarkdown && line.trimStart().startsWith("```")) {
        inFencedCodeBlock = !inFencedCodeBlock;
      }

      // In a markdown file, PROSE is inherently commentary — the marker's
      // "only on a comment line" rule (which exists to stop it exempting an
      // executable assignment) is honoured by treating a FENCED CODE BLOCK
      // (a literal command a reader would run) as the non-exemptable
      // context instead, since markdown prose has no comment-opener syntax
      // of its own. Source files keep the original, stricter rule.
      const isCommentaryLine = isMarkdown ? !inFencedCodeBlock : startsWithCommentOpener(line);
      const hasMarker = line.includes(PRE_RENAME_MARKER) && isCommentaryLine;

      for (const id of RETIRED_IDS) {
        const patterns = PATTERNS_BY_ID.get(id)!;
        for (const pattern of patterns) {
          const match = pattern.exec(line);
          if (!match) continue;

          if (hasMarker) {
            markerExemptedCount += 1;
            continue;
          }
          if (excluded) continue;

          violations.push({ file: relPath.replace(/\\/g, "/"), line: i + 1, text: line.trim(), matched: match[0] });
        }
      }
    }
  }

  return { violations, markerExemptedCount };
}

describe("algorithmIdentity sweep — standing D-05 assertion, SOURCE half (plan 07-16 Task 3)", () => {
  it("finds zero identity-shaped occurrences of the retired id outside the exclusion list", () => {
    const { violations } = runSweep();
    if (violations.length > 0) {
      const detail = violations.map((v) => `${v.file}:${v.line}: "${v.matched}" in: ${v.text}`).join("\n");
      expect.fail(`Identity-shaped occurrence(s) of a retired algorithm id found outside IDENTITY_SWEEP_EXCLUSIONS:\n${detail}`);
    }
  });

  it("the marker-exempted line count is at most the cap — the escape hatch cannot be widened quietly", () => {
    const { markerExemptedCount } = runSweep();
    expect(markerExemptedCount).toBeLessThanOrEqual(MARKER_CAP);
  });

  it("IDENTITY_SWEEP_EXCLUSIONS has exactly the length it was seeded with — an added exclusion is a deliberate, reviewed edit", () => {
    // Decremented from 8 to 7 by plan 07-18 Task 3, which deleted the
    // client-package entry — the mechanism that lands the CLIENT third of
    // the standing D-05 assertion (see this file's own header comment).
    expect(IDENTITY_SWEEP_EXCLUSIONS).toHaveLength(7);
  });

  it("STRUCTURAL_EXEMPTIONS (a separate, smaller list from the tier exclusions) has exactly the length it was seeded with", () => {
    expect(STRUCTURAL_EXEMPTIONS).toHaveLength(7);
  });

  it("a marker on a NON-comment line does NOT exempt — the mechanical form of prohibition 2", () => {
    const nonCommentLine = 'const id = "sigma1"; // not actually a comment line [pre-rename] wrapper test';
    // The marker text appears on this line, but the line's first
    // non-whitespace characters are `const`, not a comment opener — so the
    // exemption must NOT apply, and the identity-shaped occurrence on it
    // must still be reported as a violation by the same logic runSweep uses.
    expect(startsWithCommentOpener(nonCommentLine)).toBe(false);
    expect(nonCommentLine.includes(PRE_RENAME_MARKER)).toBe(true);
    const idPattern = PATTERNS_BY_ID.get("sigma1")![0]!;
    expect(idPattern.test(nonCommentLine)).toBe(true);
    // Since startsWithCommentOpener is false, runSweep's `hasMarker` gate
    // evaluates false for this line, so the match falls through to the
    // ordinary violation path (or the exclusion check) exactly like an
    // unmarked line would.
  });

  it("sanity check: the walk is not vacuous — it visits a known source file", () => {
    const files: string[] = [];
    walk(REPO_ROOT, files);
    const relPaths = files.map((f) => f.slice(REPO_ROOT.length + 1).replace(/\\/g, "/"));
    expect(relPaths).toContain("packages/harness/algorithmIdentity.test.ts");
    expect(relPaths).toContain("packages/core/algorithms/sigma1/index.ts");
  });
});
