---
id: ui-polish-pass
created: 2026-08-24
source: phase 05 plan 05-08 real-device sign-off
resolves_phase:
priority: high
---

# UI polish pass — revisit the minimal palette

## What the user said

At Phase 5's real-device sign-off, reviewing the live site on a phone:

> "Really I would expect a more polished UI. the current UI is both too minimal
> and rough around the edges. There should be a little bit of color."

The "rough edges" were real layout defects and were fixed in 05-08
(`d8a508e1`, `917dbe8d`). **"Too minimal" was not a defect** — it is
`05-UI-SPEC.md`'s palette working exactly as specified. This todo is about that.

## What is currently locked

`05-UI-SPEC.md` Color, and D-05/D-06 in `05-CONTEXT.md`:

| Role | Value | Usage |
|---|---|---|
| Dominant 60% | `#F8FAFC` slate-50 | page + table row background |
| Secondary 30% | `#F1F5F9` slate-100 | ribbon, sheet, cards, optional row tint |
| Accent 10% | `#4F46E5` indigo-600 | **reserved** — see below |

Accent is restricted to: active nav underline, primary CTA, focus rings, active
sort arrow, search keyboard-highlight, filter-count badge. The spec states:
*"Never used for: body text, table row backgrounds, or any static/decorative
surface — accent means 'this is interactive and/or currently active,' nothing
else."*

Rationale on record (D-05): read as a serious data tool, visually distinct from
TBA's and Statbotics' blue-dominant navigation. That reasoning is still sound —
this is a disagreement about degree, not a mistake to revert blindly.

## Two separable questions

1. **Depth within the current system** — permitted today and unexplored:
   alternating row tints (already allowed in the 30% band), elevation on
   surfaces, spacing rhythm, rank treatment for leading teams, subtle chips for
   week/district. No palette change, no accent-rule violation.
2. **The palette itself** — whether 60/30/10 near-monochrome is right for this
   audience at all. Changing it touches every component built in Phases 5-8, so
   it wants designing, not improvising.

## How to approach it

The user chose "close Phase 5, do a UI pass next" over improvising at a closing
gate. Start with **throwaway mockups of the Teams page at several polish
levels** so there is something concrete to react to before anything is locked —
the user explicitly wanted options to look at rather than a guess at "more
color". `/gsd-sketch` is the fit.

D-06's token discipline held throughout Phase 5 (every colour is a
`--color-*` custom property, no hex literals in components), so a palette change
is a token swap rather than a component sweep. That was the whole point of
attaching the engineering requirement to the product decision, and it means this
is cheaper now than it looks.

## Related

- `.planning/phases/05-site-shell-navigation-browsing/05-UI-SPEC.md` — the contract
- D-05, D-06 in that phase's `05-CONTEXT.md`
- Dark theme is separately deferred (D-06) and is a token swap, not "more colour"
