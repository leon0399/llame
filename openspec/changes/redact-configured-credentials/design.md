# Design

## Context

- The bash executor redacts a `protectedValues` list in `sanitize.ts` with its
  own sequential split/join, but only after `watch.ts` `appendBound` has
  already clipped each raw stream at the output bound while capturing, so a
  credential crossing the bound leaves its prefix. `sanitizeStream` then clips
  the redacted text at the bound a second time. `apps/api/src/tools/bash.ts`
  passes no list.
- On timeout, `settleDeadline` kills the process group and drains output;
  a stream that ends within the 50 ms drain settles unforced, unmarked, and
  not destroyed, so a value the kill cut short reaches the result as printed.
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
re-deriving them afterwards: whole values for provider, engine, and adapter
credential fields at any nonblank length; the substitutions
`interpolateStringWithSubstitutions`
reports, extended to give each substitution's start and end in the raw
resolved string and whether its `:-` fallback applied, for provider and
remote MCP headers and stdio `command`, `args`, and `env`, excluding `:-`
fallback text; for provider base URLs and the remote MCP `url`, substitutions
whose resolved span lies in the userinfo password or query spans computed on
that raw string, not on a re-serialized `URL`, and, from the same raw spans,
the userinfo password and username and each query value under a credential-shaped
name, as written and percent-decoded, so a credential written literally or
inside a whole-URL substitution is still a member; literal header values
under a credential-shaped name; and `POSTGRES_URL`, its parsed password in both
percent-encoded and decoded spellings, and `PGPASSWORD`. A `{path:…|json:…}`
substitution that is a member also contributes the credential-shaped string
leaves of its document, together with each leaf's JSON-escaped spelling when
that differs. `@workspace/config-interpolation` reports those leaves from the
same single read that selects the value, so the set never mixes two versions
of a file. The result is normalized, drops blank values, applies the
8-character floor only to the database password, `PGPASSWORD`, and a URL
userinfo username (proposal A4), is frozen on the loaded
configuration, and excluded from every serialized projection.

- Alternative: every interpolation. Rejected: see proposal A1.
- Alternative: whole provider header values. Rejected: their literal parts
  (the `Bearer` prefix) are not secret. Remote MCP keeps whole values in its
  own per-server set, as `mcp-tools` requires; only this instance set uses
  substitutions and credential-shaped literals.
- Alternative: every leaf of a selected document. Rejected: a Codex auth file
  holds timestamps and modes that would be redacted everywhere.

### D2. Bash redacts on raw positions

`bash.ts` passes the set as `protectedValues`. The executor decodes each
stream with a streaming UTF-8 decoder, so a multibyte character split across
pipe chunks still matches, and captures up to `bound + longest member − 1`
raw characters. It then works on raw positions only:

1. Find every member occurrence in the raw capture once.
2. Cut at `bound`, extending once to the end of any occurrence that starts
   before it.
3. When timeout settlement ended the stream, whether the 50 ms drain saw it
   end or destroyed it, drop the longest trailing suffix of the kept text that
   is a proper prefix of a member: llame cut that value, not the command. A
   command that exits on its own keeps its tail, since a partial value it
   printed itself is out of scope (proposal Non-goals). At the capture cap no
   drop is needed: the lookahead already holds any member that starts before
   the bound.
4. Replace each merged occurrence interval (D4) that intersects the kept
   range, clipped to it, with `[REDACTED]`, without re-scanning.

No step re-scans altered text, and step 4 clips every interval found in step
1, so a drop or cut through an occurrence still leaves a marker for its kept
part. A throwaway fuzz of exactly these steps (200k trials of 1-4 members of
8-200 characters with shared prefixes, suffixes, and containment, bounds
20-300, natural exit, capture cap, and a close with the step 3 drop) emitted
no member character. Output can exceed the raw bound by the extended match
and marker growth; the truncation metadata still reports the cut. D2 replaces
`sanitizeStream`'s split/join redaction and its second clip at the bound, so
no later step re-cuts or re-scans the result.

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

`@workspace/runtime-safety` exports `protectedValueIntervals`, which returns
the merged union of every member's raw match intervals, overlapping or
adjacent intervals joined, and `redactProtectedString` is rebuilt on it, so
two members that overlap without containment leave no tail. Bash uses the
intervals directly (D2 step 4); MCP inherits the fix through
`redactProtectedString`.

## Risks / Trade-offs

- [A common member matches unrelated text] → The 8-character floor on the
  database password, `PGPASSWORD`, and a URL username, and the
  credential-shaped name rule, keep values like `app`, `svc`, content types,
  and timestamps out; a short or common value in any other member position,
  such as a credential field or a non-secret interpolated into stdio
  `command` or `args`, still over-redacts. Documented in the operator pages.
- [A short inferred credential is not redacted] → A database password,
  `PGPASSWORD`, or URL username under 8 characters printed on its own reaches
  the bash result; the database password is redacted only inside the whole
  `POSTGRES_URL` (proposal A4). Documented in the operator pages.
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
