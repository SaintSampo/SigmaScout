---
quick_id: 260902-sbx
slug: search-box-double-border
date: 2026-09-02
type: execute
mode: quick
worktree: false
autonomous: false
source: user report during session of 2026-09-02
files_modified:
  - apps/web/src/components/search/SearchBox.tsx
---

# The search box draws two concentric rounded rectangles

## The report

"The search bar is messed up now in the ribbon" — screenshot shows an outer
rounded rect with a second, smaller, differently-rounded rect inset inside it.

## Measured cause

The DOM chain under the ribbon search input is three deep:

```
CommandRoot   h-9 (36px) · rounded-xl! (12px) · border · bg rgba(255,255,255,.1)   <- tone styling
  div.p-1.pb-0                                                                     <- 4px inset
    div[data-slot=input-group]  h-8 (32px) · rounded-lg (8px) · border-input · bg  <- shadcn primitive
      input
```

`InputGroup` (`apps/web/src/components/ui/input-group.tsx:17`) unconditionally
carries `h-8 rounded-lg border border-input` plus a background. `SearchBox`'s
`tone` classes (`SearchBox.tsx:314-315`) put a *second* border, background and
radius on the `CommandRoot`. Two visible surfaces.

Measured on the live page:

| instance | outer | inner | gap |
|---|---|---|---|
| ribbon (`tone="ribbon"`) | 36px tall, 12px radius | 32px tall, 8px radius | 4px |
| home hero (`tone="page"`) | 46px tall, 12px radius | 32px tall, 8px radius | **14px** |

**Both tones are affected** — this is not ribbon-only, and the hero is the worse
of the two. Fix both.

## When it regressed

`d4ccc32e` (2026-09-01, "feat(sim,ribbon): … larger ribbon") added `h-9` to the
ribbon tone's class string. Before it, the outer had no explicit height, so it
shrink-wrapped the inner and the two borders sat on top of each other — the
doubling existed structurally but was invisible. Giving the outer its own height
separated them. The hero's larger height does the same thing.

The existing `[&>div]:h-full` in that same commit was the attempted fix and
**does not work**: `>` selects the intermediate `div.p-1.pb-0`, not the
`InputGroup` two levels down. Do not simply repeat it.

## The fix

**One visible control surface, on the outer element.** The tone classes already
style the `CommandRoot` deliberately (ribbon-specific tokens, focus behaviour,
the results dropdown's anchoring) — that is the surface to keep. Neutralise the
inner primitive instead:

- Target the primitive by its own stable attribute — `[&_[data-slot=input-group]]`,
  a descendant selector — **not** `[&>div]`, which is what failed.
- On it: remove the border, make the background transparent, and let it fill the
  outer's height so the input is vertically centred in the real control.
- Collapse the `p-1 pb-0` inset for both tones, or compensate for it, so the
  input's text baseline sits where the outer box's centre is. State which you
  chose and why in the returned summary.
- Apply to **both** `tone === "ribbon"` and `tone === "page"`.

**Do not** edit `apps/web/src/components/ui/input-group.tsx`. It is a shared
shadcn primitive with other consumers; its own border is correct in a plain form
context. This is a composition problem at the SearchBox seam, so fix it there.

**Do not** remove the outer's height. `h-9` is the 2026-09-01 "larger ribbon"
decision and the hero's height is deliberate; the mismatch is the bug, not the
height.

## Preserve

- Focus-visible ring behaviour must still work and must appear on **one** box,
  not two. Check keyboard focus explicitly.
- The results dropdown must still anchor and open correctly in both tones, and
  the mobile dialog rendering (`useIsMobile()` branch) must be unaffected.
- The ribbon's `--ribbon-ink` / `--ribbon-ink-muted` placeholder and text colours
  must survive.

## Verification

1. `cd apps/web && npx vitest run` — full suite green. Never `timeout <n> pnpm ...`
   (swallows output, exits 0 — project memory).
2. `cd apps/web && npx tsc --noEmit -p tsconfig.json`.
3. Probe the running dev server at `http://localhost:5280` (already running — do
   not start another). For BOTH the ribbon search and the home hero search,
   assert exactly **one** element in the input's ancestor chain has a visible
   border (non-zero border-width AND a non-transparent border-colour), and that
   the input group's rendered height equals the outer control's height.
4. Screenshot both at `deviceScaleFactor: 2` and confirm a single clean box.
5. Tab to the search box and confirm one focus ring, not two.

## Commit

One commit.
