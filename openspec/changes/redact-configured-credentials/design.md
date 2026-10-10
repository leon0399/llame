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
`substituted` values from `interpolateStringWithSubstitutions` for provider and
remote MCP headers, provider and SearXNG base URLs, the remote MCP `url`, and
stdio `env`; literal header values under a credential-shaped name; and
`POSTGRES_URL`, its parsed password, and `PGPASSWORD`. A `{path:…|json:…}`
substitution that is a member also contributes the credential-shaped string
leaves of its document, together with each leaf's JSON-escaped spelling when
that differs. `@workspace/config-interpolation` reports those leaves from the
same single read that selects the value, so the set never mixes two versions
of a file. The result is normalized, filtered by the 8-character floor, frozen
on the loaded configuration, and excluded from every serialized projection.

- Alternative: every interpolation. Rejected: see proposal A1.
- Alternative: whole provider header values. Rejected: their literal parts
  (the `Bearer` prefix) are not secret. Remote MCP keeps whole values in its
  own per-server set, as `mcp-tools` requires; only this instance set uses
  substitutions and credential-shaped literals.
- Alternative: every leaf of a selected document. Rejected: a Codex auth file
  holds timestamps and modes that would be redacted everywhere.

### D2. Bash redacts on raw positions

`bash.ts` passes the set as `protectedValues`. The executor captures up to
`bound + longest member − 1` raw characters per stream, finds every member
match in that raw capture, and cuts at `bound` in raw positions, extending the
cut to the end of any match that starts before it. It then drops a trailing
fragment that is a proper prefix of a member, at the capture cap and at the
drain's forced close alike, and only then redacts with
`redactProtectedString` and sets truncation metadata. Cutting before
redacting means an earlier redaction can never shift later raw text inside
the bound. The executor's own split/join is replaced by the shared routine.

### D3. Model failures keep their identity

`createModelClient` wraps the client it builds:

- An error whose redactable strings contain no member passes through as the
  same object.
- Otherwise, in place on the original object, it redacts `message`, `stack`,
  and every other string own property except `name` and `code`, recursing into
  `cause`, `lastError`, and `errors[]`, through a guarded `defineProperty`
  that never throws. `instanceof`, the AI SDK's symbol-marked `isInstance`,
  `name`, `code`, `statusCode`, and `lastError` identity are untouched.
- A non-`Error` value passes through unless it is a string containing a
  member, which is redacted.
- The wrapper always installs an `onError`; when the caller supplied none, it
  logs the redacted error through llame's logger instead of letting the SDK
  log the raw object.
- Title generation logs through the redacted error.

Per-wire sanitizers run first and are unchanged. The AI SDK creates a new
error per attempt, so in-place redaction affects no other request.

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

- [A common member matches unrelated text] → The 8-character floor and the
  credential-shaped name rule keep passwords like `app`, content types, and
  timestamps out; a long common value an operator uses as a credential can
  still over-redact. Documented in the operator pages.
- [Encoded forms and other tools] → See the proposal's threat model.
- [A consumer reads an error property the wrapper did not consider] → D3
  mutates only string values in place; task 2.1 lists every consumer that
  branches on a failure and proves each still classifies it.
- [Two in-flight changes modify the same requirement] →
  `reconcile-opencode-go-route-failure-wording` (PR #1200) also modifies
  "Upstream failures are mirrored under the existing contract". Task 3.1
  handles both orders: if #1200 synced first this delta is rebuilt; if this
  change syncs first, #1200's delta must be rebuilt to keep the credential
  exception, which is recorded on #1200.
- [The set is a boot snapshot] → A credential file rotated after startup
  (a refreshed Codex token) is not a member until restart. Documented.
