---
id: ui-polish-pass
created: 2026-08-24
source: phase 05 plan 05-08 real-device sign-off
resolves_phase:
priority: high
---

# UI polish pass — revisit the minimal palette

> **RESOLVED 2026-08-31 (decision page: claude.ai/code/artifact/895767df-8d4c-4d75-b31e-b4a2f54ca0a9).**
> User picked the tinted-chrome variant restated in GREEN, anchored on their own #4CAF50: shipped as
> a pure token swap — surface #E8F5E9 (Material green-50), border #C8E6C9 (green-100), accent
> #2E7D32 (green-800, WCAG-computed: 4.90:1 page / 4.56:1 surface / 5.13:1 white-on-it; the #4CAF50
> seed itself fails as ink at 2.66:1 and is not a token). Page ground stays neutral slate-50; tier,
> alliance and compare-algo vocabularies untouched; accent still means interactive/active only.
> Rank treatment: R1 — none (decided, not deferred). 390px first paint: F3 — first metric column
> leads below the breakpoint on Insights + TeamsTable (07-UI-REVIEW fix 3 discharged). Week/district
> chips shipped on the Events list. Q2 is thereby CLOSED — the palette question is decided.

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

## Progress note (2026-08-25, 06-09-PLAN.md Task 3)

**Question 1 (depth within the current system) partially addressed** — the team page's
surfaces, not yet every page in Phases 5-8:

- **Alternating row tints on the match table** — `.match-row-tint` (theme.css), reusing
  `--color-bg-page` inside an `.event-card` surface, per the chart-craft reference's own
  zebra-tint-reinforces-grouping finding.
- **Elevation on event section cards** — `.event-card` (bg-surface + border + radius) plus
  Tailwind's `shadow-sm`, so each event section reads as a distinct object.
- **Spacing rhythm between sections** — already correct as of plan 06-08
  (`EventSectionList.tsx`'s `gap-[var(--spacing-2xl)]`, the 48px major-break token); the card
  treatment above is what makes that existing gap actually *read* as separation.
- **Chips for a bounded categorical value** — the match table's Confidence column now wraps
  the predicted winner ("Red"/"Blue" — exactly two values) in an `.alliance-chip`, reusing the
  same `--alliance-*` tokens the plotted marks already use, rather than a bare string.
- **A slightly stronger surface distinction** — the ribbon itself gained `shadow-sm`
  (Ribbon.tsx), separating it visually from the page content below.

Before/after screenshots (desktop 1440px, phone 390px), real data (frc118/2024):
`.planning/phases/06-team-pages/screenshots/{before,after}-{desktop,phone}.png`.

**Not addressed here — "rank treatment for leading teams" and "subtle chips for week/district"**
from question 1's own list are Teams-table/Events-list surfaces, out of this plan's declared
file scope (`EventSection.tsx`, `MatchTable.tsx`, `Ribbon.tsx`, `theme.css` only) — left open
for whichever future plan next touches those surfaces.

**Question 2 (the base palette itself) remains explicitly deferred and unaddressed.** No
`--color-*`, `--accent`, `--alliance-*` or `--tier-*` value was added, removed or changed —
verified mechanically by this plan's own additive-only diff gate. The 60/30/10 split, the
accent hex, and every domain-vocabulary colour (alliance, tier) are exactly what they were
before this plan. That question still touches every component in Phases 5-8 and still wants
designing, not improvising.
