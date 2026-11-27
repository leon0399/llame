# Proposal

## Why

The Session details Jobs section names every background job by its `job://`
locator, and it lists running and settled jobs together. The owner cannot tell
jobs apart, and cannot see what a settled job ran or printed. The model has the
reverse gap: after compaction it cannot map a job that the owner names, such as
"the job that waits for reviews", to a locator, because the `job://` listing,
the record, and the notice hold no name. Tracked in
[#1954](https://github.com/leon0399/llame/issues/1954).

## What Changes

- A background job records the intent (`i`) of the `bash` call that started it,
  and the command text. The intent stays display-only, as `tool-calling`
  requires: it never reaches admission, the Machine, or job identity.
- `GET /api/v1/chats/:chatId/jobs` returns the intent and the command of each
  job.
- A new owner route, `GET /api/v1/chats/:chatId/jobs/:jobId/output`, returns
  the stored output of a settled job from its existing artifact, each stream
  cut to its last 64 KiB, with its stored size.
- The `job://` listing, the job record, and the settlement notice hold the
  intent. The record also holds the command.
- The Jobs section lists only live jobs, by intent. A Finished control opens a
  panel on the outer edge of Session details with the settled jobs, newest
  first; each one opens to its command, output, and outcome.

Non-goals: live output of a running job, a resizable panel, and intents for
jobs that started before this change.

## Capabilities

### New Capabilities

### Modified Capabilities

- `background-jobs`: the job record, the listing, the notice, the owner API, and
  the Session details Jobs section.

## Impact

- Database: two nullable `chat_jobs` columns, `intent` and `command`; no
  backfill.
- API: two new fields on `ChatJobResponse`, one new route with a `oneOf`
  response on `status`; regenerated OpenAPI and web client.
- Model context: the `bash` description, the `job://` listing and record, and
  the job notice name the intent.
- Web: Session details Jobs section and a Finished jobs panel.

Process note: at Leo's choice, this change and its implementation ship in one
PR, #1944, rather than a proposal layer first. Sync and archive follow in a
finalize PR.
