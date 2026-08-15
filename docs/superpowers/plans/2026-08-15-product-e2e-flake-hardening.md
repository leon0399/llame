# Product E2E Flake Hardening Implementation Plan

**Goal:** Make Product E2E assertions measure product behavior instead of Next
development compilation or an actively rerendering stream.

**Architecture:** Playwright continues to own the full stack, retries remain
diagnostic, and `failOnFlakyTests` remains enabled. The web boundary changes
from `next dev` to an E2E-owned production build plus `next start`, so route
compilation completes before Playwright admits the server. The MCP browser
acceptance waits for the run's existing Send-button settlement signal before
interacting with streamed result UI.

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

- [x] Run root Oxlint, focused formatting/Markdown, workflow validation, and
      the web build with an explicit foreground memory cap.
- [x] Obtain independent architecture and code-quality review; repair factual
      or P0/P1 defects.
- [x] Push the final #402 head and require first-attempt green Product E2E plus
      the full existing CI matrix; do not merge.
