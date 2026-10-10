# Design

## Context

- The bash executor redacts a `protectedValues` list in `sanitize.ts` with its
  own sequential split/join, but only after `watch.ts` `appendBound` has
  already clipped each raw stream at the output bound while capturing, so a
  credential crossing the bound leaves its prefix. `apps/api/src/tools/bash.ts`
  passes no list.
- `@workspace/runtime-safety` `redactProtectedString` redacts with one
  leftmost-longest scan, and `normalizeProtectedValues` dedupes, drops empties,
  and sorts. MCP uses them; `bash-executor` already depends on the package.
- MCP protects per server: every whole resolved remote header value, and every
  stdio `command`/`args`/`env` substitution
  (`config-loader.ts` `resolveStdioServer`). Provider headers resolve through
  `resolveInterpolatedString`, which does not report substitutions.
- Every language-model client is built by `createModelClient`
  (`apps/api/src/models/model-client-factory.ts`). Failures leave a client
  through the stream's `onError`, the stream result's rejected promises
  (`text`, `consumeStream`), and a rejected `generateObject`. When a caller
  supplies no `onError`, the Responses and Messages clients pass none, and the
  AI SDK's default handler logs the raw error object.
- Consumers classify failures by identity and properties:
  `run-execution.service.ts` reads `instanceof ModelStreamIdleError` and
  `.code`; hosted web search reads `RetryError.isInstance`, `lastError`, and
  `statusCode`; the Codex and Messages sanitizers keep `statusCode`; abort
  settlement passes the signal's reason, which may be a string.
- Title generation logs `error.message` and `error.stack`
  (`apps/api/src/titles/title.service.ts`).

## Goals / Non-Goals

**Goals:**

- One set, derived once, consumed by bash and by every model client.
- One redaction routine for every consumer.
- Redaction at one boundary per consumer, so a new wire or call site inherits
  it.

**Non-Goals:**

- New configuration, a registry, or per-tool opt-in.

## Decisions

### D1. The loader collects members while resolving

`loadInstanceConfig` collects members as it resolves each field, rather than
re-deriving them afterwards: whole values for credential fields; the
`substituted` values from `interpolateStringWithSubstitutions` for provider
headers and `baseUrl`, the remote MCP `url`, and stdio `env`; the string leaves
of a selected JSON document from the interpolation package's document read;
and `POSTGRES_URL` with its parsed password. The result is normalized and
frozen on the loaded configuration and excluded from every serialized
projection.

- Alternative: every interpolation. Rejected: see proposal D1.
- Alternative: whole provider header values, as remote MCP does. Rejected for
  provider headers: their literal parts (the `Bearer` prefix) are not secret and would
  be redacted wherever they appear. Remote MCP header values stay whole to
  match `mcp-tools`.

### D2. Bash redacts through runtime-safety before the bound

`bash.ts` passes the set as `protectedValues`. The executor captures up to
`bound + longest member − 1` characters per stream, redacts with
`redactProtectedString`, and only then applies the bound and truncation
metadata, so a member crossing the bound is redacted whole. Its own
split/join is replaced by the shared routine.

### D3. Model failures keep their identity

`createModelClient` wraps the client it builds:

- An error whose message, stack, cause chain, and string own properties
  contain no member passes through as the same object.
- Otherwise those strings are redacted in place on the original object, so
  `instanceof`, the AI SDK's symbol-marked `isInstance`, `statusCode`,
  `lastError`, and `code` are untouched.
- A non-`Error` value passes through unless it is a string containing a
  member, which is redacted.
- The wrapper always installs an `onError`; when the caller supplied none, it
  logs the redacted error through llame's logger instead of letting the SDK
  log the raw object.
- Title generation logs through the redacted error.

Per-wire sanitizers run first and are unchanged.

- Alternative: replace the error with a new `Error`. Rejected: it breaks the
  classification consumers above.
- Alternative: redact where `RunExecutionService` records the failure.
  Rejected: it misses title generation, compaction, hosted search, and callers
  with no handler.

### D4. Overlapping members merge into one marker

`redactProtectedString` is extended to replace the union of every member's
match intervals, merging overlapping or adjacent intervals into one
`[REDACTED]`, so two members that overlap without containment leave no tail.
MCP inherits the fix.

## Risks / Trade-offs

- [A short or common member matches unrelated text] → Credentials are long in
  practice; a selected document's short leaves (a timestamp, a boolean
  spelling) can over-redact. Accepted and documented in the operator pages.
- [Encoded forms and other tools] → See the proposal's threat model.
- [A consumer reads an error property the wrapper did not consider] → D3
  mutates only string values in place; task 2.1 lists every consumer that
  branches on a failure and proves each still classifies it.
- [Two in-flight changes modify the same requirement] →
  `reconcile-opencode-go-route-failure-wording` also modifies
  "Upstream failures are mirrored under the existing contract"; whichever
  syncs second rebuilds its delta from the new canonical text.
