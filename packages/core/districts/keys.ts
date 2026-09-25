/**
 * THE TWO TBA KEY SHAPES, declared once for the whole repo.
 *
 * WHY THIS MODULE EXISTS (phase 10 review, WR-03 and WR-10). Both shapes were
 * being restated per consumer, and one of the restatements was doing a job it
 * did not describe: `apps/worker/src/districtRefresh.ts` declared a DISTRICT
 * pattern and then used it as the ONLY validation applied to an EVENT key
 * before that key became a TBA URL path segment (`/event/{key}/awards`) and a
 * D1 cursor row key. The two shapes coincide today, so nothing was wrong at
 * runtime — and that is exactly the hazard: narrowing the district pattern (a
 * district code is 2 to 4 characters, an event code is not) would have switched
 * the whole awards poll off silently, with no test failing.
 *
 * The district shape was also
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
 *
 * Its sibling is `EVENT_KEY_PATTERN` below. The two are equal literals today.
 */
export const DISTRICT_KEY_PATTERN = /^\d{4}[a-z0-9]+$/;

/**
 * TBA's year-prefixed EVENT key: four digits (the season) then one or more
 * lowercase letters or digits — `2026wabon`, `2024casf`, `2026pncmp`.
 *
 * Verified against real published data rather than against TBA's documentation
 * alone: `apps/web/src/lib/eventKey.ts`'s own header records a check of every
 * event key in the live `v1/events/{2022,2024,2026}` artifacts — 922 keys, zero
 * non conforming, lengths 6 to 11.
 *
 * Its sibling is `DISTRICT_KEY_PATTERN` above. THE TWO ARE EQUAL LITERALS TODAY
 * AND ARE STILL TWO PATTERNS, which is the whole of WR-03: they describe
 * different vocabularies that happen to share a syntax, and a future narrowing
 * of one must be a decision about that one. `keys.test.ts` pins both, names the
 * coincidence rather than hiding it, and asserts they are separately declared.
 */
export const EVENT_KEY_PATTERN = /^\d{4}[a-z0-9]+$/;
