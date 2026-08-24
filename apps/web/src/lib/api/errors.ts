/**
 * Named error classes for the client fetch boundary — matching this repo's
 * no-bare-error convention (`apps/worker/src/liveWindows.ts`'s
 * `ManifestReadError`/`ManifestValidationError`, `packages/harness/pageArtifacts.ts`'s
 * `MissingVersionSeparatorError`: every thrown error in this repo is a named
 * `class X extends Error` with `this.name` set in the constructor, never a
 * bare `throw new Error(...)`).
 *
 * Both carry `resource` and `year` because the UI-SPEC's error copy is
 * "Couldn't load {resource} for {year}." and the component reads those
 * fields off the caught error to render it (05-UI-SPEC.md Copywriting
 * Contract).
 */
export class ArtifactFetchError extends Error {
  readonly resource: string;
  readonly year: number;
  readonly status: number;

  constructor(resource: string, year: number, status: number) {
    super(`fetchArtifact: "${resource}" for ${year} failed with HTTP ${status}`);
    this.name = "ArtifactFetchError";
    this.resource = resource;
    this.year = year;
    this.status = status;
  }
}

export class ArtifactValidationError extends Error {
  readonly resource: string;
  readonly year: number;

  constructor(resource: string, year: number, cause: unknown) {
    super(`fetchArtifact: "${resource}" for ${year} failed schema validation: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ArtifactValidationError";
    this.resource = resource;
    this.year = year;
  }
}
