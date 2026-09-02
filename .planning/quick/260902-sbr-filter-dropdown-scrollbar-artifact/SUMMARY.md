---
quick_id: 260902-sbr
slug: filter-dropdown-scrollbar-artifact
date: 2026-09-02
status: complete
tasks_completed: 1
source: user report during session of 2026-09-02
---

# Summary — filter dropdowns no longer leave a white scrollbar-width strip

## Commits

| SHA | What a user would have seen |
|---|---|
| `03837d90` | Opening any Events-page filter no longer makes the page scrollbar vanish and leave a white (or, on real hardware, double-white) vertical strip where it had been. |

## What was actually wrong, and what the plan got right vs. guessed at

The PLAN.md's mechanism for **cause 1 (disappears)** and **cause 2 (goes white)** was
measured and correct, and Part A is implemented exactly as written: `html { overflow-y:
scroll }` replaces `html { scrollbar-gutter: stable }`. CSS's viewport-propagation rule
only promotes an element's `overflow` to the viewport's when the root element's own
`overflow` is `visible` — which `scrollbar-gutter: stable` alone left it as. Radix's
scroll lock (`body { overflow: hidden }` while a dropdown is open) was riding that
propagation to remove the page scrollbar outright, while the gutter kept reserving the
now-empty 15px it had reserved for it. Giving `html` its own explicit `overflow-y`
makes the scrollbar `html`'s, not the viewport's, so the body's lock no longer
propagates and the bar stays drawn (inert, but visible) while a dropdown is open.

**Part B's guessed mechanism was wrong** — this is the "if the mechanism differs, fix
what is actually there" branch the plan called for, and it did differ. The plan
guessed the compensation was `padding-right` driven by the `--removed-body-scroll-bar-size`
custom property. Reading `react-remove-scroll-bar@2.3.8`'s actual source
(`node_modules/.pnpm/react-remove-scroll-bar@2.3_.../dist/es2015/component.js`) and
confirming it live against the running dev server (Playwright probe, dropdown open)
showed the real applied rule is:

```css
body[data-scroll-locked] {
  margin-right: <gap>px !important;
  /* ...other properties, all 0 here because Radix Select uses react-remove-scroll's
     default gapMode ("margin"), never "padding" — confirmed by grepping the installed
     @radix-ui/react-select source, which calls RemoveScroll with no gapMode prop */
}
body[data-scroll-locked] {
  --removed-body-scroll-bar-size: <gap>px;  /* written but never read back */
}
```

`--removed-body-scroll-bar-size` is **write-only** from the library's own code — nothing
in its injected stylesheet consumes it with `var(...)`; the actual `margin-right` value
is a literal number baked in at mount time from `getGapWidth()`. Pinning that custom
property to `0px` would have silently done nothing. The real, documented seam is the
`data-scroll-locked` attribute the library sets on `body` for exactly this purpose;
hooking the same selector with one extra specificity level neutralises whatever value
it computed:

```css
html body[data-scroll-locked] {
  margin-right: 0 !important;
}
```

Verified this specificity approach actually wins regardless of injection order (their
stylesheet is inserted dynamically, after theme.css, so equal-specificity `!important`
rules would otherwise favor theirs by source order): a standalone Playwright page with
their exact rule shape (`body[data-scroll-locked] { margin-right: 17px !important; }`)
injected via `<script>` *after* our override rule confirmed `getComputedStyle(body).marginRight`
resolves to `0px`.

## Symptom 3 ("gets wider") could not be reproduced here

Per the plan's own note and this session's critical context: headless Chromium renders
overlay scrollbars, so `window.innerWidth - document.documentElement.clientWidth` measures
`0` in every state tried, including with
`--disable-features=OverlayScrollbar,FluentOverlayScrollbar,FluentScrollbar`. Both the
live re-probe after the fix and the specificity test above therefore exercised the
mechanism with `gap = 0` — real, but not the failure-magnitude case. **The user is
verifying symptom 3 on real hardware with a classic scrollbar; that is the acceptance
test this summary cannot substitute for.** What this session *did* verify directly:
which CSS property carries the compensation, that it is genuinely computed as `!important`
at a specificity our fix can beat regardless of DOM insertion order, and that the same
override rule applies unconditionally (it does not branch on `gap`'s value, so it holds
whether `gap` is `0` or nonzero).

## Regression guard: what could and could not be written

The plan asked for, in order of preference: (1) render the Events page in jsdom, open
the dropdown, assert `body`'s computed `padding-right`/`margin-right` is `0px`; (2) if
jsdom can't exercise the real measurement path, fall back to asserting the `theme.css`
rule text.

**(1) was not possible, for a reason beyond "no layout": vitest's `test.css` option is
unset (defaults to `false`), so CSS imports are no-ops in this project's jsdom tests —
`theme.css`'s rules are never injected into the test DOM at all.** `getComputedStyle` on
any jsdom element in this suite reflects only jsdom's built-in UA stylesheet; there was
no live cascade to open a dropdown against in the first place, independent of whether
`react-remove-scroll` can measure a real scrollbar under jsdom.

Wrote (2): `apps/web/src/styles/theme.scrollbar.test.ts` parses `theme.css`'s raw text
(same pattern as the existing `comparePalette.test.ts` file-reading guard) and asserts:

- `html { ... }` contains `overflow-y: scroll;` and no `scrollbar-gutter` declaration.
- `html body[data-scroll-locked] { ... }` exists and contains `margin-right: 0 !important;`.
- No live declaration reads `var(--removed-body-scroll-bar-size...)` — pinned as an
  explicit non-goal so a future edit doesn't "fix" this back toward the guessed
  mechanism that doesn't work.

Confirmed this guard actually discriminates: stashed the `theme.css` change, reran the
suite — the first two assertions failed against the pre-fix file exactly as expected
(`expected null not to be null` for the override rule; `scrollbar-gutter: stable`
present where `overflow-y: scroll` was expected) — then restored the fix and reran
green. This is a CSS-text assertion, not a rendered-behavior assertion; it protects the
rule shape, not the live cascade outcome symptom 3 depends on.

## The 2026-09-01 regression (tall tab vs. short tab) — not returned

Re-verified against `/event/2026week0` (a real event with both tabs enabled): the
Qualifications tab's `document.documentElement.scrollHeight` (1488px) exceeds the
900px viewport (would draw a real scrollbar on non-overlay platforms); the Alliances
tab's does not (900px, exactly the viewport). `document.documentElement.clientWidth`
stayed `1440` in both tabs before and after — the gutter reservation from
`overflow-y: scroll` holds unconditionally regardless of whether the tab's content
actually needs to scroll, so nothing shifts switching between them.

## Verification run

- `cd apps/web && npx vitest run` — 77 files, 1181 tests, all passed (`npx vitest run`
  used directly, never `timeout <n> pnpm ...`, per project memory).
- `cd apps/web && npx tsc --noEmit -p tsconfig.json` — clean, after fixing two
  `noUncheckedIndexedAccess`-driven strictness errors in the new test file's regex
  match handling.
- Live re-probe against `http://localhost:5280/events?year=2026` (Playwright,
  1440x900 viewport) with the Week dropdown open: `documentElement`'s computed
  `overflow-y` is `scroll`; `body`'s computed `margin-right`/`padding-right` are `0px`
  (consistent with `gap = 0` under headless overlay scrollbars, not a measurement of
  the real-hardware case).

## Known Stubs

None — this is a CSS-only fix with no new UI surface.
