# Design

## Context

- The bash executor already redacts: `executeManagedBash` accepts
  `protectedValues`, and `sanitize.ts` replaces each with `[REDACTED]` before
  cutting at the output bound. `apps/api/src/tools/bash.ts` never passes the
  option.
- MCP already derives protected values per server: `config-loader.ts` collects
  every `{env:…}`/`{path:…}` substitution of a stdio entry, remote clients add
  their header values, and `@workspace/runtime-safety`'s
  `normalizeProtectedValues` dedupes, drops empties, and sorts longest first.
- Every language-model client is built by one factory,
  `apps/api/src/models/model-client-factory.ts` `createModelClient`.
  Failures leave a client through three channels: the stream's `onError`
  callback, the stream result's rejected promises (`text`, `consumeStream`),
  and a rejected `generateObject`.
- Title generation logs `error.message` and `error.stack` itself
  (`apps/api/src/titles/title.service.ts`).

## Goals / Non-Goals

**Goals:**

- One credential set, derived once, consumed by bash and by every model
  client.
- Redaction at one boundary per consumer, so a new wire or a new call site
  inherits it.

**Non-Goals:**

- New configuration, a redaction registry, or per-tool opt-in.

## Decisions

### D1. Membership by field, not by interpolation

See proposal.md, Decisions for approval. The set is built in
`loadInstanceConfig` from the already-resolved provider, web-search, adapter,
and MCP entries, and carried on the loaded configuration as a frozen,
normalized array that is never part of any serialized projection. Building it
from resolved entries, not by re-scanning raw text, keeps one source of truth
for what each field resolved to.

- Alternative: every interpolation. Rejected: redacting `knowledge.root` or a
  port corrupts paths and numbers in ordinary output.
- Alternative: only interpolated credentials, not literal ones. Rejected: a
  literally written key is still the key.

### D2. Bash passes the set as the executor's existing option

`bash.ts` passes `protectedValues` to `admitManagedBash`. No executor change:
its tests already cover replacement before the bound and at code-point
boundaries.

### D3. Model failures are redacted by wrapping the factory's client

`createModelClient` wraps the client it builds so the three failure channels
redact each error's message, and `cause` chain messages, before they leave.
The wrapper creates a new `Error` carrying the redacted message and the
original class name rather than mutating the SDK's object, so a stack trace
logged later also passes through redaction. Title generation logs through the
same redacted error. Per-wire sanitizers stay as they are and run first; this
layer only removes credentials.

- Alternative: redact in `RunExecutionService` where the failure is recorded.
  Rejected: it misses title generation, compaction, hosted web search, and any
  caller with no error handler, which are the paths #1098 names.

## Risks / Trade-offs

- [A short credential matches unrelated text] → Exact substring replacement
  of a short operator value can redact ordinary output. Credentials are long
  in practice; the risk is accepted and the operator doc says why.
- [Encoded forms leak] → A base64 or URL-encoded credential is not matched.
  Accepted and documented; the stronger control is not letting bash read the
  file (permission policy, future Sandbox).
- [An SDK error class check downstream] → Replacing the error object could
  break an `instanceof` check on SDK classes. D3 keeps the class name, and
  the implementation layer must check every consumer that branches on the
  error class (abort detection, retry classification) and preserve it.
