/**
 * The single definition of the artifact read origin (Phase 4 D-25: the
 * browser reads published artifacts from `https://data.sigmascout.org`, an R2
 * custom domain with no compute in the path — page traffic never touches the
 * Worker). This is the ONLY place a host string for the artifact origin
 * appears anywhere in `apps/web` — every fetcher builds its request URL
 * through `artifactUrl()`, never a literal host string of its own.
 *
 * Overridable via `VITE_ARTIFACT_ORIGIN` so a local fixture server can stand
 * in during development/preview testing (see docs/worker-operations.md's
 * "Site hosting and R2 CORS" section on why `*.pages.dev` preview origins
 * are not CORS-allow-listed) without editing this file.
 */
export const ARTIFACT_ORIGIN: string = import.meta.env.VITE_ARTIFACT_ORIGIN ?? "https://data.sigmascout.org";

/** Joins the artifact origin and a `v1/...` key (from `artifactKey()`) into a full request URL. */
export function artifactUrl(key: string): string {
  return `${ARTIFACT_ORIGIN}/${key}`;
}
