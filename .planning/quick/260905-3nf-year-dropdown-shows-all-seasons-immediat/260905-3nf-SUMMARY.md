---
quick_id: 260905-3nf
status: complete
date: 2026-09-05
commit: f504fd5d
---

# Summary: Year dropdown shows all seasons immediately

## What changed

`apps/web/src/components/ui/select.tsx`: `SelectContent`'s default `position` flipped
from Radix's `"item-aligned"` to `"popper"` (upstream shadcn's own default), with a
comment recording why. One edit fixes all six Select dropdowns consistently — year,
algorithm, both event filters, calibration season — not just the reported year one.

## Why

Item-aligned mode reopens the list with the *selected* item aligned over the trigger.
The ribbon sits at the top of the viewport, so after picking 2019 (bottom of the
descending season list) there is no room above — 2026 through 2020 were clipped behind
a scroll-up button. Popper mode always renders the full list below the trigger.

## Verification

- Browser (vite dev + Playwright, `/teams?year=2019&algorithm=vpr`): opened the Year
  dropdown with 2019 selected — all seven seasons (2026–2019) visible inside the content
  box, no scroll, list rendered below the trigger. The popper viewport's
  `--radix-select-trigger-height` class was checked empirically and does not clamp the
  open list.
- `npx vitest run` over ribbon, EventFilters, and CalibrationSection suites: 56/56 pass.

## Notes

Executed inline by the orchestrator (two-line UI fix; the visual verification needed the
main context's browser tooling — the subagent sandbox cannot reach a localhost dev
server). Commit staged by explicit path only: a retune/republish agent shares this
checkout.
