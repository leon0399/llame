# Product E2E Flake Hardening Implementation Plan

**Goal:** Make Product E2E assertions measure product behavior instead of Next
development compilation or lifecycle races in streamed, navigated, or
background-tracked UI.

**Architecture:** Playwright continues to own the full stack, retries remain
diagnostic, and `failOnFlakyTests` remains enabled. The web boundary changes
from `next dev` to an E2E-owned production build plus `next start`, so route
compilation completes before Playwright admits the server. The MCP browser
acceptance waits for the run's existing Send-button settlement signal before
interacting with streamed result UI. The mounted `ChatPage`, not its eventual
URL, owns foreground-run visibility. Revoked-session coverage waits only for
the browser to initiate the protected navigation before the intentional 401
redirect owns the final page state.

**No-go:** Do not widen assertion/action timeouts, add retries, force clicks,
disable `failOnFlakyTests`, or add a bespoke readiness endpoint. Those choices
hide scheduling races instead of removing them.

## Red evidence

- PR #402 CI attempt 1: two auth tests recovered on retry after the first
  authenticated `/` requests spent 15.0-15.1 seconds in Next compilation,
  colliding with the 15-second assertion timeout. The unchanged #401 run spent
  11.0-11.2 seconds in the same compilation and narrowly passed.
- PR #402 failed-job rerun: auth passed, but the MCP acceptance recovered on
  retry after the link-safety modal's close button was unstable and then
  detached during streaming. The test waited for the run-settlement signal only
  after that interaction.
- PR #402 run 31903943823: the production-start head still recovered two tests
  on retry. Revoked-session coverage saw `net::ERR_ABORTED` because the expected
  401 hard redirect superseded the protected navigation while `page.goto`
  waited for `load`. A persisted-chat second send was covered for ten seconds
  by a false `Reply ready` toast because the poll derived foreground ownership
  from `/` before the draft adopted `/chat/:id`.
- PR #402 run 31904952065: the mounted-chat repair removed the stale toast and
  every chat case passed first attempt, but the revoked-session case proved
  that even `waitUntil: "commit"` can lose to the intentional 401 redirect.
  `page.goto` still owned a request whose correct outcome is supersession.
- PR #402 run 31905421872 at `eba9eefa`: the full matrix passed. Product E2E
  passed 21/21 on the first attempt in 1.8 minutes with no retry or flaky
  marker.

## Task 1: Remove dev compilation from the product-behavior clock

- [x] Change the Playwright web server to build `apps/web` and start it with
      `next start` under the E2E API environment.
- [x] Keep the database, API/worker, MCP fixture, and model fixture commands
      unchanged while rejecting stale service reuse on occupied E2E ports.
- [x] Update CI and contributor documentation so the declared topology matches
      the production server boundary.

## Task 2: Order streamed UI interactions behind settlement

- [x] Move the existing Send-button settlement assertion before the first
      link-safety modal interaction in the MCP browser acceptance.
- [x] Keep the modal's visible URL, close behavior, durable-history reload, and
      fixture call-count assertions unchanged.

## Task 3: Verify and publish

- [x] Run root Oxlint, focused formatting/Markdown, and workflow validation;
      attempt the web build with an explicit foreground memory cap and retain
      the remote build gate when the capped local build does not complete.
- [x] Obtain independent architecture and code-quality review of the original
      readiness repair; repair factual or P0/P1 defects.

## Task 4: Close the remaining navigation and foreground races

- [x] Register the mounted chat explicitly in `ActiveRunsProvider`; suppress a
      completion notification only while that chat is actually foreground and
      visible, including the `/` draft phase.
- [x] Remove the older compaction E2E's wait-for-toast workaround and cover both
      registration and cleanup with the provider's standard Vitest suite.
- [x] Initiate revoked-session navigation from the browser without awaiting the
      intentionally superseded protected request, then assert the login page as
      the authoritative final state.
- [x] Obtain independent architectural review; run focused web test, typecheck,
      lint, root lint, formatting, and Playwright collection; require the remote
      build gate because a capped local build did not complete.
- [x] Push the repaired #402 head and require first-attempt green Product E2E plus
      the full existing CI matrix; do not merge.
