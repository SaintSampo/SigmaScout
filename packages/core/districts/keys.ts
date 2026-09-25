/**
 * TBA KEY SHAPES, declared once for the whole repo.
 *
 * WHY THIS MODULE EXISTS (phase 10 review, WR-10). The district shape was
 * declared inside `apps/worker/src/districtRefresh.ts` and nowhere else, so the
 * Worker refused a malformed district key before it could become a TBA URL path
 * segment or an R2 object key while the browser validated NOTHING, letting an
 * arbitrary `?district=` reach an artifact URL path the Worker would have
 * refused. One declaration, imported by both, is what closes that asymmetry
 * permanently rather than for as long as two copies happen to agree.
 *
 * ONE declaration per shape, in a module both halves can import: `apps/worker`
 * already imports `packages/core/algorithms/*`, and `apps/web` already imports
 * `packages/core/districts/*`. This module is PURE — no `node:` built-in, no
 * corpus, no dependency of any kind — so it is safe inside the Workers bundle.
 */

/**
 * TBA's year-prefixed DISTRICT key: four digits (the season) then one or more
 * lowercase letters or digits — `2026pnw`, `2026fim`, `2025fsc`.
 *
 * A district key becomes BOTH a TBA URL path segment
 * (`/district/{key}/rankings`) and an R2 object key
 * (`v1/district/{key}.json`), and in the browser it also becomes a fetch URL
 * path segment through `districtDetailKey`/`districtPreSimKey`. It is
 * validated before it can become any of them — never encoded-and-hoped.
 */
export const DISTRICT_KEY_PATTERN = /^\d{4}[a-z0-9]+$/;
