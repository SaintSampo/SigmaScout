---
quick_id: 260917-hul
status: complete
date: 2026-09-17
commits: [d1caef9f]
serves_todo: pages-deploy-can-poison-asset-cache
---

# 260917-hul: A post-deploy check that sees the site the way a browser does

## Outcome

`scripts/checkDeployedAssets.ts` (`pnpm check:deployed-assets`) reads the deployed HTML, extracts
every same-origin `/assets/*` reference, and requests each **twice** — once bare, once browser-shaped
(`Origin`, `Sec-Fetch-Dest`/`Mode`/`Site`, a kind-appropriate `Accept`). It fails when either variant
is served `text/html`, when either is not 200, when the two disagree on media type, or when they
carry different strong ETags. Every message dumps `cf-cache-status` and `Age` for both variants,
because two different ages on one URL is what proved there were two cached objects during the
outage.

This is the check that would have caught the 2026-09-17 outage in seconds. The manual one-liner is
in the runbook; the script is the repeatable form.

## Design points worth keeping

- **GET, not HEAD**, with the body cancelled: a browser issues GET, and seeing what a browser sees is
  the point.
- **No cache-busting query**: the poisoned object *is* the thing under test. `?x=1` made it vanish
  during the incident.
- **Zero assets is a FAILURE**, not a vacuous pass — that is the shape of a check that has silently
  stopped checking.
- **The purge remedy prints only for cache-shaped failures.** A 404 or a dead host does not get it;
  a purge would not fix those. (A defect in the first draft, caught by running it against an
  unreachable host.)
- **No `.env`, no auth, read-only.** Stated in the header as a constraint to keep.
- Header comment records that the edge's real variant key is **undocumented**, rather than restating
  the "CORS variant" theory as fact.

## Verification

- 21 tests, no network, fetch injected; the fake edge serves one thing bare and another to an
  `Origin`-bearing request, exactly the real behaviour.
- Covers: healthy, poisoned, both-variants-HTML, 404, unreachable, throwing asset, content-type
  disagreement, strong-ETag disagreement, weak/absent ETags ignored, no-assets, exactly-two-requests
  with `Origin` on the second only, no `?` appended, trailing-slash base, and the three CLI paths.
- **One mutation initially survived and improved the tests**: disabling the HTML rule still passed,
  because the assertion matched the error text (which dumps both content-types and so contains
  `text/html` anyway) rather than the rule. Strengthened, plus a both-variants-HTML case that no
  variant-comparison rule can catch. Three mutations all bite now.
- Suite: 246 files, 5,457 passed, 1 skipped (baseline 5,436). Three typechecks clean.

## Live run (orchestrator)

First run against the restored site **PASSED**: 3 assets, each identical bare and with `Origin`.

It also produced direct evidence for the incident: `/assets/schemas-AVUJaT2V.js` came back
`Age=11654` bare and `Age=37547` with `Origin` — same ETag, same type, **two separately cached
objects on one URL**. Recorded in the todo: that split is the precondition the outage needed, and a
check that requests each asset once cannot see it.

## Where it is documented

`docs/worker-operations.md`, after the site-hosting section — the project's single operations
runbook, which already owns the Pages project, the custom domains and the CORS policy. It runs as
the last step of a web deploy, **before** the live Playwright suite: it takes seconds and names the
remedy, where a mass e2e failure only says something is wrong.
