## Why

[#212](https://github.com/leon0399/llame/issues/212) is the missing write step in
the research-to-Knowledge-to-recall loop. Ordinary file edits need a trusted Git
publication boundary before they can safely become durable Knowledge in a
retryable hosted Run or personal Node.

## What Changes

- D1: accept one single-file Markdown change from an authorized executor file
  view and publish one recoverable Git commit per Run through `publish`.
- D2: add explicit, non-destructive managed-publication enrollment for existing
  Knowledge Spaces; keep live-file reading available without enrollment.
- D3: persist publication intent and recover interrupted Git/filesystem/receipt
  transitions without duplicate commits, stale replacement, or false success.
- D4: admit only the named first-party draft and publication tools through the
  existing write gate after recovery support is installed. Remote MCP writes
  remain prohibited, and personal per-operation approval remains required.
- D5: prove the combined #39 research, write, new-Chat read, and episodic-recall
  scenario, including second-owner denials.

This explicitly revises #212's bespoke complete-file mutation interface into
ordinary `read`/`write`/`edit` in a file view followed by `publish`. It retains the
single-file, one-publication-per-Run release boundary. Managed publication is an
opt-in write policy: unrestricted simultaneous host-editor writes are outside
its no-lost-update guarantee. No existing Space is silently converted.

## Capabilities

### New Capabilities

- `knowledge-publication`: managed write enrollment, single-file Git publication,
  durable effect reconciliation, and visible results.

### Modified Capabilities

- `tool-calling`: explicit first-party write admission and restart behavior for
  Runs using the new tools; no generic classification-based write enablement.

## Impact

Depends on `add-executor-file-views` and the Knowledge/runtime extraction being
integrated from [#659](https://github.com/leon0399/llame/pull/659). Hosted journal
rows use enabled and forced RLS; the personal adapter uses the Node's private
single-owner store. Git must be available to publishing workers, but live readers
continue to work without Git. The shared publisher owns no Nest, CLI, or identity
provider implementation.

The publication agent owns `packages/knowledge-publication`, hosted publication
storage and tool admission, personal publication integration, and the combined
acceptance test. It consumes `packages/file-views`; changes to that contract go
back to its owning agent. Managed Sandbox execution and bulk publication are
separate work. Profile activation, namespace/import work under #547, shared
Knowledge, full federation, and episodic tool migration are excluded.
