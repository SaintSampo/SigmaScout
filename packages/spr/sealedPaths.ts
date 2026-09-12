/**
 * What "sealed" means for a BPR holdout run.
 *
 * `holdout.ts`'s refusal used to cover the PARAMETER FILE only. A reader
 * naturally takes the seal to mean "the model that produced this number is
 * pinned in git", and it did not: quick task 260908-vqr (F-15) found that
 * `model.ts` changed TWICE after the sealed holdout evaluation ran, entirely
 * unchecked, so the printed 78.05% could not be attributed to any specific
 * revision of the code without manual forensics.
 *
 * The seal therefore covers the five code paths that can change a prediction,
 * plus whichever parameter files a run names. `assertSealed` returns a blob sha
 * for each so the run's own output is self-documenting: a reader can check the
 * header line by line against the repository rather than trusting a claim.
 *
 * 260912-ivg Stage 1 Task 2: this list was repointed from `packages/bpr/` to
 * `packages/spr/` (and the ported module from `packages/core/algorithms/bpr.ts`
 * to `.../spr.ts`) by a pure `git mv` — every path's blob sha is byte-identical
 * across the move commit (verified, not asserted). The measured numbers this
 * seal attests to (the sealed 2016-2022 design, the 2023-2026 holdout) are
 * therefore still attributable to the exact same content; only its address
 * changed. `assertSealed` resolves these strings against the CURRENT tree at
 * run time, so leaving them pointing at the old, now-nonexistent `packages/bpr/`
 * paths would have DISABLED the seal (every holdout/pcm run refusing to start
 * on a path error), not preserved it.
 */

/**
 * Every file that can change what BPR predicts. `data.ts` is included because
 * the POPULATION is part of the measurement (260908-vqr F-12), and the shipped
 * port is included because a published number attributed to BPR may have come
 * from either module.
 */
export const SEALED_CODE_PATHS: readonly string[] = [
  "packages/spr/model.ts",
  "packages/spr/evaluate.ts",
  "packages/spr/data.ts",
  "packages/spr/cli.ts",
  "packages/core/algorithms/spr.ts",
];

/**
 * Injected so the refusal logic is unit-testable without dirtying the real
 * working tree. Must THROW on a failed command rather than returning a status.
 */
export type CommandRunner = (file: string, args: readonly string[]) => string;

export interface SealedPath {
  readonly path: string;
  /** `git rev-parse HEAD:<path>` — the content hash of the sealed revision. */
  readonly blob: string;
}

export interface SealResult {
  readonly head: string;
  readonly paths: readonly SealedPath[];
}

/**
 * Refuses unless EVERY path is committed with a clean working tree, and
 * returns the HEAD sha plus each path's blob sha.
 */
export function assertSealed(paths: readonly string[], run: CommandRunner): SealResult {
  let head: string;
  try {
    head = run("git", ["rev-parse", "--short", "HEAD"]).trim();
  } catch {
    throw new Error("holdout: not a git repository - refusing to run");
  }

  const sealed: SealedPath[] = [];
  for (const path of paths) {
    let status: string;
    try {
      status = run("git", ["status", "--porcelain", "--", path]).trim();
    } catch {
      throw new Error(`holdout: could not read git status for ${path} - refusing to run`);
    }
    if (status !== "") {
      throw new Error(
        `holdout: ${path} has uncommitted changes (${status}).\n` +
          "Commit it first - the seal must predate the evaluation, and it covers\n" +
          "the MODEL as well as the parameters (260908-vqr F-15).",
      );
    }

    let blob: string;
    try {
      blob = run("git", ["rev-parse", `HEAD:${path}`]).trim();
    } catch {
      throw new Error(`holdout: ${path} is not tracked at HEAD - commit it first`);
    }
    sealed.push({ path, blob });
  }

  return { head, paths: sealed };
}
