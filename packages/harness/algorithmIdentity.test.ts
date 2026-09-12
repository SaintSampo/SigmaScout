/**
 * The standing D-05 assertion, SOURCE half (plan 07-16 Task 3). Mirrors
 * `browserSafeSchemas.test.ts`'s shape: a filesystem/import-graph scan
 * asserting a structural property, not a behaviour.
 *
 * This is a THREE-WAY split, and this file is only ONE of the three parts —
 * naming all three here is what keeps this test from reading as either a
 * duplicate of a later plan's check or a claim that the rename is finished.
 * ALL THREE thirds have now landed:
 *
 *   - SOURCE (this file, plan 07-16): no identity-shaped occurrence of the
 *     retired id `sigma1` (or its four harness-only variants) survives
 *     anywhere in the tracked tree outside a short, individually-reasoned,
 *     length-asserted exclusion list. LANDED.
 *   - CLIENT (plan 07-18 Task 3): the client-package exclusion entry that
 *     used to sit in `IDENTITY_SWEEP_EXCLUSIONS` below was DELETED there —
 *     the deployed browser no longer reads the pre-rename R2 prefix (07-18
 *     Tasks 1-2 moved it), so the gate now walks the client tree with the
 *     rest of the repository and finds nothing. LANDED.
 *   - LIVE (plan 07-19 Task 3, 2026-08-29): zero `sigma1@` objects in R2 and
 *     zero `algorithm_id = 'sigma1'` rows in D1 — a fact about the deployed
 *     bucket and database, which no source-level test run on a checkout can
 *     prove and which this file therefore does not encode as a running
 *     assertion (PD-06). Observed rather than merely declared: the Worker
 *     was redeployed onto the renamed live-fold tier (version
 *     `638da16c-d538-4551-b3a0-a2757a77061f`, `env.LIVE_ALGORITHM_IDS`
 *     carrying `vpr`), the algorithms manifest was collapsed to three
 *     entries (`opr`, `epa`, `vpr`; generation unchanged,
 *     `47d020a4-1a16-4331-bd70-ce2f468bf2d1`), all 4,599 of the retired id's
 *     remote D1 rows (`league` 1 + `team` 4,598) were deleted by an exact-id
 *     `DELETE` with a before/after `GROUP BY` read-back confirming the three
 *     live ids' counts unchanged, and 19,261 enumerated R2 keys carrying the
 *     retired segment were issued a `deleteObject` call, with a before
 *     (48/60 present) / after (0/60 present) stratified census over the SAME
 *     sampled keys as the only evidence a deletion's own exit code cannot
 *     provide. The re-runnable form of this assertion lives in
 *     `scripts/verifySubsetPublish.ts`'s `expectAbsent` entries — a
 *     credentialed, network-bound check does not belong in a suite that runs
 *     on every commit (PD-06) — not in this file, whose exclusion list, its
 *     pinned length, and its marker cap are unchanged by this plan.
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
 * decremented to SEVEN by plan 07-18 Task 3 (which deleted the
 * client-package exclusion entry once the sigma1 -> vpr rename's browser
 * tier collapsed) — raised back to EIGHT here (quick task 260912-ivg Stage 1
 * Task 4), which reopens exactly that same shape for the SAME reason, one
 * rename later. The length is itself asserted below (T-07-16-06 /
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
  // 260912-ivg Stage 1 Task 4: the browser-READ tier. `apps/web/` still
  // legitimately names `bpr` throughout — PUBLISHED_ALGORITHM_IDS, every
  // compare-20NN.json fixture, searchParams.ts's DEFAULT_ALGORITHM,
  // metricKeys.ts, MethodologyNote.tsx, columns.tsx — because the `bpr@`
  // objects it names are the ONLY ones that exist in R2 today; the deployed
  // browser must keep requesting them until Stage 5's client flip. Stage 5
  // is what deletes this entry, exactly mirroring the client-package
  // exclusion plan 07-16 added and 07-18 removed for the sigma1 -> vpr
  // rename this reopens the same shape for.
  "apps/web/",
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
 *   - `scripts/deleteRetiredAlgorithmObjects.ts` and its
 *     `scripts/deleteRetiredAlgorithmObjects.test.ts` (added by plan 07-19
 *     Task 1, Rule 3 blocking fix — tripped this exact sweep the moment they
 *     were written) are the one-off tool whose entire purpose is operating
 *     ON the retired id: refusing it as a `--retired-id` value that is
 *     itself live, enumerating keys that carry it, and proving both guards
 *     fire against it in real CLI invocations and unit tests. Identical
 *     reasoning to this file's own top entry — a sensor is not required to
 *     sense itself, and a tool built to delete a retired id's objects must
 *     be permitted to name that id.
 *   - `packages/harness/sigmaScore.ts` (260912-ivg Stage 1 Task 4):
 *     `SIGMA_SCORE_ALGORITHM_IDS` was made a two-member set by Task 1 --
 *     `new Set(["bpr", "spr"])` -- so the Sigma Score column keeps rendering
 *     on BOTH the deployed (bpr) and about-to-publish (spr) tiers during the
 *     split. A predicate that must answer identically for either name during
 *     a transition is not an unrenamed identity; it is the BOTH-tier shape
 *     this rename's own tier table names. Stage 5 removes the retiring
 *     "bpr" member from that set in the same edit that collapses
 *     PUBLISHED_ALGORITHM_IDS onto `spr`.
 *   - `packages/harness/stateSnapshot.ts` (260912-ivg Stage 1 Task 4):
 *     serializeState/deserializeState's premier-algorithm branch was made
 *     dual-name by Task 1 -- `algorithmId === "spr" || algorithmId ===
 *     "bpr"` -- so a Worker deployed anywhere in the cutover window can
 *     still read D1 rows written under either id. Same BOTH-tier reasoning
 *     as sigmaScore.ts above; Stage 5 removes the "bpr" half of each
 *     dispatch branch.
 *   - `packages/harness/stateSnapshot.test.ts` (260912-ivg Stage 1 Task 4):
 *     its new dual-name-dispatch test proves serializeState/deserializeState
 *     really do treat "bpr" and "spr" identically, which requires literally
 *     calling both with the real pre-rename string -- proof of a dual-name
 *     dispatch requires citing both names, exactly the same reasoning
 *     publish.test.ts's/liveAlgorithmTier.test.ts's own entries above use.
 *   - `packages/harness/manifests.ts` (260912-ivg Stage 1 Task 4):
 *     buildAlgorithmsManifest's `modules` record carries a real `bpr: {
 *     ...spr, id: "bpr" }` override so the READ-tier algorithms.json manifest
 *     keeps reporting id "bpr" (matching what useAlgorithmVersion looks up by
 *     PUBLISHED_ALGORITHM_IDS) even though the underlying module now reports
 *     "spr" internally. This is a real, functionally required string, not a
 *     leftover -- Stage 5 deletes the override in the same edit that moves
 *     PUBLISHED_ALGORITHM_IDS's value.
 *   - `packages/harness/manifests.test.ts` (260912-ivg Stage 1 Task 4): its
 *     tests assert the override above actually produces a manifest entry
 *     with id "bpr" -- proving that requires citing "bpr" literally.
 *   - `packages/harness/level1Digest.test.ts` (260912-ivg Stage 1 Task 4):
 *     `data/baselines/level1-digest-2026-09.json` and the
 *     FROZEN_AT_09_01_STREAM_SHA256 pin are FROZEN records that recorded the
 *     algorithm id "bpr" at measurement time (tier F, like
 *     baselineFingerprint.test.ts above) -- this file's LEGACY_ALGORITHM_ID_ALIASES
 *     resolver must cite that frozen id literally to keep resolving it
 *     against the renamed live module, without rewriting the frozen record.
 *   - `scripts/measureRpCalibration.ts` (260912-ivg Stage 1 Task 4): reads
 *     `data/baselines/rp-calibration-2026-09b.json`'s own committed,
 *     frozen `algorithmId` field -- same reasoning as
 *     baselineFingerprint.test.ts above, applied to a different frozen file.
 */
export const STRUCTURAL_EXEMPTIONS: readonly string[] = [
  "packages/harness/algorithmIdentity.test.ts",
  "packages/harness/browserSafeSchemas.test.ts",
  "packages/harness/publishedAlgorithms.ts",
  "packages/harness/baselineFingerprint.test.ts",
  "scripts/verifySubsetPublish.ts",
  "packages/harness/publish.test.ts",
  "apps/worker/test/liveAlgorithmTier.test.ts",
  "scripts/deleteRetiredAlgorithmObjects.ts",
  "scripts/deleteRetiredAlgorithmObjects.test.ts",
  "packages/harness/sigmaScore.ts",
  "packages/harness/stateSnapshot.ts",
  "packages/harness/stateSnapshot.test.ts",
  "packages/harness/manifests.ts",
  "packages/harness/manifests.test.ts",
  "packages/harness/level1Digest.test.ts",
  "scripts/measureRpCalibration.ts",
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
 *
 * Raised again here by quick task 260912-ivg Stage 1 Task 4's own re-grep,
 * counted after attaching the marker to exactly the genuine measured-figure
 * citations Task 3 left in place: the two presim byte-count comments
 * (`pageArtifacts.ts`, `publish.ts`), the three presim byte-count table
 * rows/paragraph in `docs/simulation-architecture.md`, and the two
 * deployed-version-verification lines in `docs/worker-operations.md`.
 *
 * The number is 20, not the 26 first committed. That first count was taken
 * while `runSweep` still incremented this counter for EXCLUDED files, so six
 * of the 26 were markers sitting in `.planning/`, `docs/models/` and other
 * excluded paths — places with no violation for a marker to suppress, where a
 * marker is therefore inert. The counter now skips excluded files (see
 * `runSweep`), and 20 is the counted total over the files the sweep actually
 * scans. That distinction is the whole point: counting excluded files made
 * this cap a function of preserved planning prose, which is never rewritten
 * and grows with every task, so a summary that merely QUOTED the marker
 * alongside the retired id turned the gate red on documentation — which is
 * exactly how this was found.
 *
 * Counted, not a round number chosen with headroom — raised in a visible diff
 * with this reason, never by widening a file exclusion instead.
 */
const MARKER_CAP = 20;

/**
 * The retired published identity and its four harness-only siblings, plus
 * `bpr` — added by quick task 260912-ivg Stage 1 Task 4, the identifier
 * `packages/core/algorithms/bpr.ts` (now `spr.ts`) carried until this task's
 * Stage 1 renamed it to `spr`. Exported and pinned by an exact-contents
 * assertion below (not merely a length check) so a later edit that silently
 * drops a member fails a test rather than quietly narrowing what this sweep
 * covers.
 */
export const RETIRED_IDS = ["sigma1", "sigma1-defaults", "sigma1-seasonsd", "sigma1-normalcdf", "sigma1-adapt", "bpr"] as const;

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
            // An EXCLUDED file has no violation for a marker to suppress, so a
            // marker there is inert. Counting it made the cap a function of
            // preserved planning prose — `.planning/` is excluded, is never
            // rewritten, and grows with every task, so any summary that merely
            // QUOTED the marker alongside the retired id pushed this counter up
            // and turned the gate red on documentation. Fixed 260912-ivg Stage 1
            // Task 4 follow-up: the `excluded` check below used to sit AFTER this
            // increment, so `excluded` governed violations but not the cap.
            if (!excluded) markerExemptedCount += 1;
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
    // Raised back to 8 by quick task 260912-ivg Stage 1 Task 4, which
    // reopens the same client-package exclusion for the BPR -> SPR rename;
    // Stage 5 is what removes it again.
    expect(IDENTITY_SWEEP_EXCLUSIONS).toHaveLength(8);
  });

  it("STRUCTURAL_EXEMPTIONS (a separate, smaller list from the tier exclusions) has exactly the length it was seeded with", () => {
    // 7 -> 9 (plan 07-19 Task 1, Rule 3 blocking fix): the new
    // deleteRetiredAlgorithmObjects.ts tool and its test file both
    // legitimately cite the retired id — see this file's own header comment.
    // 9 -> 16 (quick task 260912-ivg Stage 1 Task 4): sigmaScore.ts and
    // stateSnapshot.ts (the two BOTH-tier files Task 1 made dual-name),
    // stateSnapshot.test.ts (the new dual-name-dispatch test proving it),
    // manifests.ts and manifests.test.ts (the real "bpr" override that keeps
    // the READ-tier algorithms.json manifest correct, and the test proving
    // it), level1Digest.test.ts and measureRpCalibration.ts (both cite a
    // FROZEN record's own "bpr"-recorded field, tier F).
    expect(STRUCTURAL_EXEMPTIONS).toHaveLength(16);
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
