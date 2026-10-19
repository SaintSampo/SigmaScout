# Handoff for quick task 261019-ooj (paused 2026-10-19 for a reboot)

The executor finished all three tasks and was stopped while running its final whole-repo test. It
did not deliver its summary text. Everything it built is committed on `main`, NOT pushed, NOT
deployed:

- d60e74c8 feat(worker): run a tick for one named event, for TBA webhooks
- 811c019d feat(worker): accept TBA webhooks at /tba-webhook and re-poll the named event at once
- 31324b8c fix(worker): stop fold claims at the deadline only when the caller set one
- a4a79979 docs(worker): runbook for TBA webhooks, push instead of poll

Verified before the pause: `npx vitest run apps/worker` on a4a79979 is green, 31 files, 658 tests
(630 after 261019-oim). The whole-repo run and the typechecks were NOT re-run by the orchestrator.

Remaining, in order:

1. Review the four commits (`git diff 4e4d6325..a4a79979`), especially the pre-claim deadline check
   in `processEvent`, `WEBHOOK_TICK_DEADLINE_MS`, and the fold lease interplay paragraph in
   `docs/worker-operations.md`.
2. Run `npx vitest run` (whole repo), `npx tsc --noEmit -p apps/worker/tsconfig.json`, root
   `npx tsc --noEmit`.
3. Write `261019-ooj-SUMMARY.md` from the diff, append the STATE.md row with
   `gsd-tools quick-tasks-append`, commit the docs.
4. Deploy from `apps/worker` with `npx wrangler deploy` on a clean tree; record the version in the
   summary; then push and check `gh run list`.
5. Jacob's manual steps, as the runbook states them: set `TBA_WEBHOOK_SECRET` with
   `wrangler secret put`, register `https://sigmascout-worker.jrw4561.workers.dev/tba-webhook` on
   the TBA account page with the same secret, read the `tba-webhook-verification` key from
   `wrangler tail` and enter it, then subscribe the account to all events this year (the firehose)
   on the myTBA Subscriptions tab.

Resume with `/gsd-quick resume push-instead-of-poll-a-worker-fetch-hand`.
