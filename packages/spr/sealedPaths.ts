/**
 * What "sealed" means for an SPR holdout run: not just the parameter file,
 * but every code path that can change a prediction — a reader naturally
 * takes a seal to mean "the model that produced this number is pinned in
 * git", so the seal must actually cover the model, not only its inputs.
 *
 * The seal covers the five code paths below, plus whichever parameter
 * files a run names. `assertSealed` returns a blob sha for each so the
 * run's own output is self-documenting: a reader can check the header line
 * by line against the repository rather than trusting a claim.
 *
 * These paths resolve against the current tree at run time — a stale path
 * disables the seal (every holdout run refusing to start on a path error)
 * rather than preserving it, so a future rename must update this list in
 * the same commit.
 */

/**
 * Every file that can change what SPR predicts. `data.ts` is included
 * because the population is part of the measurement, and the shipped port
 * is included because a published number attributed to SPR may have come
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
          "the MODEL as well as the parameters.",
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
