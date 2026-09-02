---
quick_id: 260902-sbx
slug: search-box-double-border
date: 2026-09-02
status: complete
tasks_completed: 1
source: user report during session of 2026-09-02
---

# Summary — the search box stops drawing two concentric rounded rectangles

## Commits

| SHA | What a user would have seen |
|---|---|
| `88175354` | Before: the ribbon search and the home-hero search each drew a smaller, differently-rounded box inset inside the outer control — 4px of visible gap in the ribbon, 14px in the hero — and tabbing to either showed no focus indicator at all. After: one clean bordered box in both places, correctly sized and vertically centred, with a visible focus treatment on Tab. |

## The cause, and why the fix lives where it does

`CommandInput` (`ui/command.tsx`) wraps a shadcn `InputGroup`
(`ui/input-group.tsx`) that unconditionally carries its own border, background
and fixed `h-8`. `SearchBox`'s per-tone classes put a second border, background
and radius on the outer `Command` root. Two visible surfaces, nested.

Neither primitive was edited — both are shared, and `InputGroup`'s border is
correct in a plain form context. This is a composition problem at the `SearchBox`
seam, so the fix is a `INPUT_GROUP_SEAM_FIX` constant applied there, to **both**
`tone="ribbon"` and `tone="page"`.

## When it regressed, and why its own fix missed

`d4ccc32e` (2026-09-01, "larger ribbon") added `h-9` to the ribbon tone. Before
it the outer had no explicit height, shrink-wrapped the inner, and the two
borders coincided — the doubling existed structurally but was invisible.

That commit also *attempted* the fix, with `[&>div]:h-full`. The child combinator
selects the intermediate `div.p-1.pb-0` (`command-input-wrapper`), two levels
above `InputGroup`, so it never reached its target and the bug survived. The
replacement uses a descendant selector on the primitive's own stable attribute,
`[&_[data-slot=input-group]]`, confirmed against the live DOM before being
trusted.

## Decisions worth recording

- **Overrides carry `!`.** `InputGroup`'s `h-8!`/`rounded-lg!` are Tailwind
  `!important` utilities baked on by `command.tsx`; a same-specificity plain
  class cannot beat them at any source order. (The same trap already silently
  defeats `Command`'s own `rounded-md` tone override against its base
  `rounded-xl!` — measured 12px radius, not 6px.)
- **The inner padding was collapsed, not compensated.** `command-input-wrapper`'s
  `p-1 pb-0` was a second vertical inset stacked on `Command`'s own `p-1`.
  Collapsing it leaves one source of inset, so `h-full` plus `items-center`
  centres the input with no extra arithmetic.
- **The hero got an explicit `h-11` (44px).** Its prior 46px was never a chosen
  value — it was emergent from the doubled padding this fix removes. Once
  collapsed, `h-full` against an auto-height root had nothing definite to resolve
  against and the control visibly shrank.

## Focus indicator — an accessibility gap found while verifying

`input-group.tsx`'s only focus ring keys off `data-slot="input-group-control"`,
but `CommandInput`'s actual `<input>` carries `data-slot="command-input"`. That
selector never matched in this composition, so **the search box had no focus
indicator at all** — not two rings, zero. A replacement keyed off the real slot
name was added to the `Command` root, reusing the `border-ring`/`ring-3`/
`ring-ring/50` tokens `ui/select.tsx` already uses sitewide.

## Verification

Full `apps/web` suite green (77 files / 1181 tests) and `tsc --noEmit` clean.

Independently re-measured by the orchestrator against the running dev server,
not taken from the executor's report:

- **Exactly one visible border** per instance — computed border-width > 0 with a
  non-transparent colour on the `Command` root only (`h36` ribbon, `h44` hero);
  `input-group`'s border-colour is now `rgba(0, 0, 0, 0)`.
- Heights nest cleanly: 36 → 34 → 34 → 32 (ribbon), 44 → 42 → 42 (hero). The 2px
  steps are the outer's own 1px border per side.
- Real keyboard `Tab` (hop 6) reaches `command-input`, and the `Command` root's
  border resolves to `rgb(46, 125, 50)` — a present, visible focus indicator.
  **Caveat, stated rather than glossed:** the `ring-3` box-shadow half of that
  treatment did not register in the orchestrator's computed-style read
  (`box-shadow` came back as none). The border-colour indicator is confirmed
  present and the screenshot shows a clear focused state, so the user-facing
  requirement is met — but the ring half is unconfirmed and worth a look if the
  focus treatment ever seems weaker than its siblings.
