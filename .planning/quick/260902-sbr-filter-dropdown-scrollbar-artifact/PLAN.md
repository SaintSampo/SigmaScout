---
quick_id: 260902-sbr
slug: filter-dropdown-scrollbar-artifact
date: 2026-09-02
type: execute
mode: quick
worktree: false
autonomous: false
source: user report during session of 2026-09-02
files_modified:
  - apps/web/src/styles/theme.css
---

# Opening a filter dropdown leaves a white, double-width strip where the scrollbar was

## The report

Clicking any filter on the Events page makes the page scrollbar "disappear and
go white and get wider".

## Measured mechanism

Probed live at `http://localhost:5280/events?year=2026` (dropdown closed, then
`button[aria-label="Week"]` clicked):

| | closed | open |
|---|---|---|
| `body` computed `overflow` | `visible` | **`hidden`** |
| `body` inline style | `null` | `pointer-events: none;` |
| `body` width in a 1440px viewport | 1425 | 1425 |
| `html` `scrollbar-gutter` | `stable` | `stable` |

Two causes produce the three reported symptoms:

1. **Disappears** — Radix's scroll lock sets `body { overflow: hidden }` on
   open. `html`'s own overflow is `visible`, so under CSS's viewport-propagation
   rule the body's `overflow` becomes the *viewport's*, and the page scrollbar is
   removed outright.
2. **Goes white** — `html { scrollbar-gutter: stable }`
   (`theme.css:293-301`) keeps reserving the 15px gutter after the scrollbar it
   reserved for is gone. Measured: body stays 1425px inside a 1440px viewport in
   BOTH states. That reserved-but-empty 15px strip is the white bar.
3. **Gets wider** — on a platform with classic (non-overlay) scrollbars,
   `react-remove-scroll` (which Radix Select uses) measures the scrollbar width
   and adds a compensating `padding-right` to `body`. The gutter had *already*
   accounted for that width, so the two stack: ~15px of gutter plus ~15px of
   padding ≈ a 30px strip.

**Symptom 3 is inference, not observation.** Headless Chromium renders overlay
scrollbars — measured `window.innerWidth - documentElement.clientWidth === 0` in
both states, and with `--disable-features=OverlayScrollbar,FluentOverlayScrollbar,FluentScrollbar`
too — so `react-remove-scroll` measured a 0px scrollbar and added 0px of padding
here. Causes 1 and 2 are directly measured; cause 3 follows from
`react-remove-scroll`'s documented behaviour on a real scrollbar. **The user is
verifying on real hardware — that is the acceptance test.**

## The fix

### Part A — the scrollbar must stop being removable

Replace `html { scrollbar-gutter: stable }` with `html { overflow-y: scroll }`.

Viewport propagation only happens when the root element's own overflow is
`visible`. Giving `html` an explicit `overflow-y` makes the page scrollbar
`html`'s, so `body { overflow: hidden }` no longer propagates and cannot remove
it. The scrollbar stays drawn (and inert) while the dropdown is open.

**This preserves the reason `scrollbar-gutter: stable` was added** (2026-09-01,
user report: switching between a tall tab and a short one shifted centred
layouts sideways by the scrollbar's width — see the comment at `theme.css:292`).
`overflow-y: scroll` reserves the same space unconditionally and additionally
keeps the bar *drawn*, which the gutter alone does not. Rewrite that comment to
record both requirements and why one rule now serves both — do not delete the
2026-09-01 history.

### Part B — stop the compensation double-counting

With Part A the scrollbar is permanent, so **any** scrollbar-width compensation
`react-remove-scroll` adds is wrong by construction. Neutralise it at its own
documented seam rather than with a brittle selector: it computes its padding
from the `--removed-body-scroll-bar-size` custom property, so pinning that to
`0px` removes the compensation without `!important` or attribute guessing.

First **verify what is actually applied** — inspect `body`'s inline style and
computed `padding-right` with the dropdown open, and look for
`--removed-body-scroll-bar-size` and any injected stylesheet rule. If the
mechanism differs from the above, fix what is actually there and say so in the
SUMMARY. Do not implement Part B blind.

## Regression guard

Add a real guard, not a snapshot of the CSS text. The strongest available check:
render the Events page in jsdom, open the Week dropdown, and assert `body`'s
computed `padding-right` is `0px` while the dropdown is open — that is the
user-visible invariant, and it fails against the unfixed code if Radix adds
padding under test. If jsdom does not exercise `react-remove-scroll`'s
measurement path (likely — it has no layout), fall back to asserting the
`theme.css` rule set: `html` carries `overflow-y: scroll` and no
`scrollbar-gutter` declaration. State plainly in the SUMMARY which of the two you
were able to write and why.

## Verification

1. `cd apps/web && npx vitest run` — full suite green. Never `timeout <n> pnpm ...`
   (swallows output, exits 0 — project memory).
2. `cd apps/web && npx tsc --noEmit -p tsconfig.json`.
3. Re-probe the running server at `http://localhost:5280/events?year=2026`:
   with the Week dropdown open, `body` computed `padding-right` is `0px`, and
   `documentElement`'s computed `overflow-y` is `scroll`.
4. Confirm the 2026-09-01 regression has NOT returned: on an event page, switch
   between a tall tab (Qualifications) and a short one (Alliances) and assert the
   centred content's left edge does not move.

## Commit

One commit.
