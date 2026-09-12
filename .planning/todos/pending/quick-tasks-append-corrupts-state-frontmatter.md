---
id: quick-tasks-append-corrupts-state-frontmatter
created: 2026-09-12
source: observed twice on 2026-09-12, once destructively
priority: high
---

# `quick-tasks-append` rewrites STATE.md's frontmatter with stale values, and once split the file in two

The helper that appends a row to STATE.md's Quick Tasks table **also rewrites the frontmatter**, and
it stamps a stale `current_phase`. Observed twice in one day, with escalating damage.

## Incident 1 — the file was split into two state blocks (destructive)

Commit `88cac8f5`, a concurrent session's append, left STATE.md with **two** frontmatter blocks: a
stale one claiming `current_phase: 08` prepended *above* the sealed one, and the real block stranded
in the body. The project's index contradicted itself about which phase was current, **and the stale
copy won, being first**. The same run left its quick-task row orphaned at line 18, outside the table
it belongs to, where nothing would ever render it.

Repaired in `e12705c6`.

## Incident 2 — the phase pointer reset again (non-destructive but silent)

A later append, immediately after `4bdad2fa`, reset `current_phase` from the correct `09` back to
`08` with no duplicate block this time. Caught only because the repair from incident 1 was fresh
enough to make it worth re-checking. **Nothing in the append output says the frontmatter was
touched.**

## Why this matters more than it looks

`STATE.md` is one of the two files the project has designated as its index — the 2026-09-12 triage
adopted "no index files" precisely because summary documents rot, and kept `ROADMAP.md` +
`STATE.md` as the exception. An index that a routine helper silently falsifies is worse than no
index, because it is read first and trusted.

The failure is also invisible at the point of use: the helper returns `{"ok": true}` and says
nothing about the frontmatter.

## Where to look

`quick-tasks-append` in `gsd-tools` (invoked as
`node <gsd-core>/bin/gsd-tools.cjs quick-tasks-append --task ... --slug ... --id ...`). Two
questions:

1. **Where does it source `current_phase`?** `08` is not arbitrary — it is the last phase that was
   current before Phase 9 sealed, so it is reading something that did not update, or recomputing
   from a rule that breaks once every ROADMAP phase is `[x]`.
2. **Why does it write frontmatter at all?** Appending a table row does not need to. The narrowest
   fix is to make it touch only the table and the two timestamp fields.

Also note it emits `—` in the Directory column even when a task directory exists, so the link has
been filled by hand on every recent row.

## Workaround until fixed

After **every** `quick-tasks-append`, verify before committing:

```
grep -c "^---$" .planning/STATE.md      # must be exactly 2
grep -n "^current_phase:" .planning/STATE.md
```

Two delimiters and the right phase. If there are four, the file has been split and the body copy is
the good one.
