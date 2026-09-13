---
id: quick-tasks-append-corrupts-state-frontmatter
created: 2026-09-12
source: observed twice on 2026-09-12, once destructively
priority: high
resolved_date: 2026-09-13
resolved_by: local patch to ~/.claude/gsd-core/bin/gsd-tools.cjs (routeQuickTasksAppend), STATE.md body fix, CLAUDE.md ban lifted
---

## Resolution (2026-09-13)

**Every incident now has a reproduced mechanism, and all of them are fixed or refused.**

| incident | cause | reproduced on |
|---|---|---|
| 2: `current_phase` 09 reset to 08 | the helper wrote through `readModifyWriteStateMd`, which re-derives the whole frontmatter from the body on every write. The body still said `Phase: 08` after Phase 9 sealed | a scratch copy of HEAD: one append flipped `current_phase: 09` to `08` |
| 1: two frontmatter blocks, stale one first | two steps. The hand script broke line 1 (see the attribution section below). A later helper run could not strip a frontmatter that no longer started at line 1, so `syncStateFrontmatter` prepended a fresh block derived from `Phase: 08` | the `88cac8f5` blob: one helper run left 3 `---` lines, `current_phase: 08` on line 5 and the stranded `09` on line 22 |
| 3, 4: row over the opening `---` | hand-written script (attribution section below) | already reproduced 2026-09-12 |

**The fix** is a local patch to `routeQuickTasksAppend` in the installed `gsd-tools.cjs`. The file
carries a `LOCAL PATCH (SigmaScout, 2026-09-13)` comment, and GSD's update backs up modified files
for `/gsd-update --reapply`.

- **No frontmatter re-derivation.** The helper takes the same STATE.md lock, but it writes the
  file byte-exact: the new row, plus `last_updated` and `last_activity` edited in place. It writes
  through tmp+rename, not `platformWriteSync`, whose markdown normaliser can add blank lines
  elsewhere in the file.
- **Refuses already-corrupt files.** If line 1 is not `---`, the closing `---` is missing, or
  `gsd_state_version` appears other than once, it exits 1 and writes nothing.
- **Checks the append before writing.** It confirms exactly one line was added, that the line is
  the row, and that it sits below the Quick Tasks heading. After writing, it reads the file back.
- **Flags.** Unknown flags (`--id`, `--description`), flags with no value, and stray positionals
  exit 1. `--dry-run` is honored. `--dir <quick dir>` fills the Directory link after checking the
  directory exists. `--commit <rev>` stamps a verified commit instead of whatever HEAD is. A `|` in
  the description is refused, because the table parser does not honor `\|`.
- **Numbering** (pitfall 4, duplicate ids) was already fixed by the earlier max+1 patch in
  `markdown-table.cjs`. That patch is still present.

**Verified** on scratch copies. The clean HEAD file changed only in the row and `last_updated`
(`current_phase` stayed 09). A CRLF copy stayed pure CRLF (599/599). The `88cac8f5` blob and the
two-block file were refused with identical bytes and no lock or tmp file left. The old `--id` form,
a pipe, a bad `--commit`, a bad `--dir` and a valueless flag all exit 1 with no change. fast.md's
exact `--task "$TASK"` call and the legacy positional form both still append. A `--dry-run`
against the real checkout wrote nothing.

**Data fix.** STATE.md's body now says `Phase: 09` and `Current focus: Phase 09`. Other gsd-tools
state commands still re-derive frontmatter from the body, and with the stale line they would have
reset `current_phase` too. After the fix, re-deriving from this body gives the stored
`current_phase`. One stale body line is left on purpose: Session Continuity's `Stopped at:` still
describes 260911-j2w. `readModifyWriteStateMd`'s preservation step already keeps the frontmatter
value when that line is unchanged, and the line belongs to the session-handoff workflows.

**Not fixed, still live elsewhere:** the table parser still splits on raw `|`. If a pipe ever gets
into a row by hand, every append fails loud until it is reworded.

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

## Incident 3 — it ate the opening `---` (destructive again, same day)

A third append, hours later, **overwrote line 1** — the frontmatter's opening delimiter — with its
own quick-task row. The file was left with one `---` instead of two, so the entire frontmatter block
was no longer frontmatter at all: it parsed as body text, and row 136 sat orphaned above it.

That is incident 1's failure mode with a different landing spot: the helper writes its row at the
top of the file instead of into the table, and whatever was on line 1 loses.

**Three occurrences in one day, two of them destructive.** The pattern is stable enough to name:
*the append writes to the head of the file, not the tail of the table, whenever something about its
anchor lookup fails.* Finding why that lookup fails is the fix; the frontmatter rewrite is a
second, separate bug on top of it.

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


## Incident 4 — row at line 2, opening `---` gone (2026-09-12, found by 260912-ivg)

Quick task 260912-l8t's row landed at **line 2**, replacing the opening delimiter, outside the table.
Repaired in `1d624515` (delimiter restored, row re-homed as 137). The helper is now **banned** in
`.claude/CLAUDE.md` until this todo closes. Note the write path is already lock-protected
(`readModifyWriteStateMd`) and `appendQuickTaskRow`'s own table-local logic looks sound, so the
likeliest suspect is the splice of the section body back into the whole file — worth checking
`collectSection`'s offsets against this file's mixed LF/CRLF line endings first.

## Attribution correction — incidents 1, 3 and 4 were NOT `quick-tasks-append` (2026-09-12, session that ran 5n8/7bp/i13/l8t)

**The "row written over line 1" failure in incidents 1, 3 and 4 came from a hand-written append
script in the award-prediction session, not from `gsd-tools quick-tasks-append`.** That session
stopped using the helper after its first run and appended every later row with an inline `node -e`
script. Those are exactly the three commits that went bad:

| incident | commit | what the blob shows |
|---|---|---|
| 1 | `88cac8f5` (260912-7bp) | line 1 blank, own row on line 2, opening `---` gone |
| 3 | `17b6c2b0` (260912-i13) | line 1 blank, row 136 on line 2, opening `---` gone |
| 4 | `a103ec69` (260912-l8t) | line 1 blank, row 137 on line 2, opening `---` gone |

**The mechanism, reproduced against the clean parent blob `21a15b5a`:** the script anchored on the
previous row with a template-literal regex whose source was `^\\| ${n} \\|.*$` (flag `m`). The `\|` escapes were lost to shell
quoting, so the pattern became `^| 136 |.*$` — an **alternation** whose branches match at the head
of the file. Reproduced: the match lands at **char index 0**. `s.replace(re, m => m + "\n" + row)`
therefore wrote the row at the top, over the `---`. The script's `if (!re.test(s)) exit` guard could
not catch it — a broken alternation always matches, so the guard passed *because* the regex was
broken.

**The LF/CRLF lead in incident 4 is a red herring for these.** Measured with `node` (Git Bash
`grep $'\r$'` and `cat -A` disagree with each other on this machine and should not be trusted for
this): the working copy, `HEAD`, and every blob above are **pure LF**, 0 CRLF.

**What this does and does not settle.**
- It settles incidents 3 and 4, and the row-placement part of incident 1.
- It does **not** establish incident 1's duplicated-frontmatter / stale `current_phase: 08` detail,
  or incident 2's phase-pointer reset. Those may be the helper.
- **The helper does have a real, separate bug**, observed first-hand in the same session: its first
  run mis-parsed named flags and wrote `| 132 | --id | 2026-09-12 | f8311707 | — |`, and it overwrote
  `last_activity_desc` with a *different, concurrent* session's task description. So the ban is not
  wrong — but "the helper writes its row at the head of the file" is not yet shown to be one of its
  bugs.

**The practical lesson for the CLAUDE.md recipe:** "append with a small script" is what caused three
of the four corruptions, so the script is not the safeguard — **the four checks are**. Checking that
both `---` delimiters are present would have caught every one of these before commit. Anchor on
lines with plain string comparison (`line.startsWith("| " + n + " |")`), never a regex containing
`|`.
