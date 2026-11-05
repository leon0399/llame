# Design

## Context

- Host bash bounds each stream at `tools.artifacts.maxBytes` UTF-8 bytes
  (`bash-limits.ts`). The executor (`packages/bash-executor`) decodes with a
  streaming decoder, keeps exactly the bound while capturing (`watch.ts`
  `appendBound`), then `sanitize.ts` `sanitizeStream` redacts a
  `protectedValues` list with a sequential split/join and clips the redacted
  text at the bound a second time, so a credential crossing the bound leaves
  its prefix. `apps/api/src/tools/bash.ts` passes no list.
- An `ssh://` command's stdout arrives bounded at the byte bound plus
  `SSH_READ_NOISE_BYTES` (64 KiB) before decoding; its stderr is an 8 KiB
  head plus a tail of the bound, joined with a gap when the tail dropped
  bytes; `ssh-bash.ts` then calls `sanitizeKnownResult` with no list.
- A Machine command runs in the daemon (`apps/machine/src/proc.ts`) under the
  protocol's 32,000-unit bound with no lookahead, and the hub
  (`bash.ts` `runMachineBash`) applies no sanitizer before `spillBashResult`.
- Every placement then goes through `spillBashResult`, which writes each
  executor-bounded stream as an artifact part (a part over
  `tools.artifacts.maxBytes` is rejected) and records the previewed result as
  `native.result`, which replay returns verbatim.
- On timeout, `settleDeadline` kills the process group and drains output for
  at most 50 ms; a stream that ends within the drain settles unmarked, so a
  value the kill cut short reaches the result as printed.
- `@workspace/runtime-safety` `redactProtectedString` redacts with one
  leftmost-longest scan and does not merge overlapping matches, and
  `normalizeProtectedValues` dedupes, drops empties, and sorts. MCP uses them;
  `bash-executor` already depends on the package.
- MCP protects per server: every remote header substitution, the whole value
  of an `authorization`, `proxy-authorization`, or `cookie` header, and every
  stdio `command`/`args`/`env` substitution (`config-loader.ts`
  `resolveStdioServer`). Provider headers are split on `{session:id}` and each
  part resolved through `resolveInterpolatedString`, which does not report
  substitutions; nothing protects them.
- `interpolateStringWithSubstitutions` reports substituted values only, with
  no position or fallback flag, and a `{path:…|json:…}` read returns only the
  selected string.
- `POSTGRES_URL` is read from the environment outside the loader, and
  `PGPASSWORD` by no application code. The loaded configuration is
  `LlameConfig`, compared by deep equality in many tests.
- Every language-model client is built by `createModelClient`
  (`apps/api/src/models/model-client-factory.ts`), reached only through
  `ModelsService.createClient`. Failures leave a client through the stream's
  `onError`, the stream result's rejected promises (`text`, `consumeStream`,
  `sources`, `toolCalls`, `usage`, `finishReason`), and a rejected
  `generateObject`. When a caller supplies no `onError`, the Responses and
  Messages clients pass none and the AI SDK's default handler logs the raw
  error object. Chat Completions' `generateObject` has no sanitizer.
- Consumers classify failures by identity and properties:
  `run-execution.service.ts` reads `instanceof ModelStreamIdleError` and
  `.code`, logs the stack through `loggableError`, and sends the error to
  Sentry; hosted web search reads `RetryError.isInstance`, `lastError`, and
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
remote MCP headers (each `{session:id}`-separated part of a provider header
is its own resolved string) and stdio `command`, `args`, and `env`,
excluding `:-` fallback text; for provider base URLs and the remote MCP
`url`, substitutions whose resolved span lies in the userinfo password or
query spans computed on that raw string, not on a re-serialized `URL`, and,
from the same raw spans, the userinfo password and username and each query
value under a credential-shaped name, as written and percent-decoded, so a
credential written literally or inside a whole-URL substitution is still a
member; literal header values under a credential-shaped name; and, from the
`env` the loader was given, `POSTGRES_URL`, its parsed password in both
percent-encoded and decoded spellings, and `PGPASSWORD`. A
`{path:…|json:…}` substitution that is a member also contributes the
credential-shaped string leaves of its document, together with each leaf's
JSON-escaped spelling when that differs. `@workspace/config-interpolation`
reports those leaves from the same single read that selects the value, so
the set never mixes two versions of a file. The result is normalized, drops
blank values, and applies the 8-character floor only to the database
password, `PGPASSWORD`, and a URL userinfo username (proposal A4).

The loader records the frozen set in a module-level `WeakMap` keyed by the
configuration object it returns, read through one exported accessor. The set
is therefore no property of `LlameConfig`: no serializer, spread, or
deep-equality comparison sees it, and a configuration the loader did not
build has an empty set. `ModelsService` and the run's tool context read it
through that accessor.

- Alternative: every interpolation. Rejected: see proposal A1.
- Alternative: whole provider header values. Rejected: their literal parts
  (the `Bearer` prefix) are not secret. Remote MCP keeps its own per-server
  set, as `mcp-tools` requires; only this instance set uses substitutions and
  credential-shaped literals.
- Alternative: every leaf of a selected document. Rejected: a Codex auth file
  holds timestamps and modes that would be redacted everywhere.
- Alternative: a field on `LlameConfig` or the config service. Rejected: the
  configuration is serialized and deep-compared, and a field invites a
  projection to carry it.

### D2. One bash routine redacts on raw positions, at the API

`sanitizeKnownResult` in `packages/bash-executor` is the only redaction
routine. On the llame host `bash.ts` passes the set as `protectedValues` to
the executor; the `ssh://` path passes it to the `sanitizeKnownResult` call it
already makes, and the Machine path calls it in the hub on the daemon's
answer before `spillBashResult`. The set never leaves the API process, so a
remote host or a Machine never holds it. The routine works on raw positions
in the bound's unit, UTF-8 bytes on the host and for `ssh://` and code units
for a Machine:

1. When llame ended the capture, because a capture or transport limit cut it
   or the command timed out, drop the longest trailing suffix that is a
   proper prefix of a member: llame cut that value, not the command. Where a
   transport kept two parts of a stream with a gap between them (an `ssh://`
   stderr head and tail after the tail dropped bytes), drop the longest
   suffix of the first part that is a proper prefix of a member and the
   longest prefix of the second that is a proper suffix of one. A command
   that exits on its own within its capture keeps its tail, since a partial
   value it printed itself is out of scope (proposal Non-goals).
2. Find every member occurrence in what remains, once, merged (D4).
3. Cut at the bound.
4. Replace each merged interval that intersects the kept range, clipped to
   it, with `[REDACTED]`, without re-scanning.
5. If markers made the stream longer than the bound, cut it at the bound,
   before any marker the cut would split, so an artifact part never exceeds
   `tools.artifacts.maxBytes`.

Any member occurrence the capture holds is an interval, so step 4 replaces
its kept part; any occurrence the capture cut short lies within the step 1
drop; step 5 only removes text. The host capture keeps a lookahead of the
longest member's length past the bound, so a member that starts before the
bound is found whole and leaves a marker; `ssh://` stdout already has 64 KiB
of lookahead. A Machine capture has none, so a member its bound cuts is
dropped without a marker. A throwaway fuzz of steps 1-4 (100k trials of 1-3
members of 2-6 characters over a two-letter alphabet, bounds 1-20, with and
without lookahead, natural exit and timeout with continued output) emitted no
character of any member occurrence the command printed. D2 replaces
`sanitizeStream`'s split/join redaction and its second clip of unredacted
text; step 5 clips only redacted text.

### D3. Model failures keep their identity

`ModelsService.createClient` passes the set (D1 accessor) to
`createModelClient`, which wraps the client it builds in a `Proxy` that
intercepts `streamText` and `generateObject` only, so `'generateObject' in
client` and the metadata fields are unchanged. `streamText` installs its own
`onError` and wraps the result's promise channels (`text`, `consumeStream`,
`sources`, `toolCalls`, `usage`, `finishReason`, and the rest the result
exposes) with the existing `wrapStreamTextResult`; `generateObject` redacts
its rejection. For every failure value:

- An error whose redactable strings contain no member passes through as the
  same object.
- Otherwise, in place on the original object, it redacts `message`, `stack`,
  and every other string own property except `name` and `code`, recursing into
  `cause`, `lastError`, and `errors[]`, through a guarded `defineProperty`
  that never throws. The walk enumerates own property keys with
  `Reflect.ownKeys`, so symbol-keyed properties are visited, and it rewrites
  only values whose `typeof` is `"string"`, so the AI SDK's boolean
  `Symbol.for("vercel.ai.error.…")` marker is never touched. `instanceof`,
  `isInstance`, `name`, `code`, `statusCode`, and `lastError` identity are
  untouched.
- If any of those strings cannot be redefined (a non-writable,
  non-configurable property, or a frozen error), the original object is never
  forwarded: the wrapper builds a replacement with
  `Object.create(Object.getPrototypeOf(original))` and copies every own
  property onto it, symbol keys included, redacting string values and
  substituting the redacted `cause`, `lastError`, and `errors[]`. The
  replacement keeps the prototype chain, so `instanceof` holds, and the copied
  marker, so `isInstance` holds; classification is unchanged. The wrapper logs
  that it substituted, without values. No shipped SDK produces such an error,
  so this path is exercised only by a synthetic test double.
- A non-`Error` value passes through unless it is a string containing a
  member, which is redacted.
- The wrapper always installs an `onError`; when the caller supplied none, it
  logs the redacted error through a Nest `Logger` instead of letting the SDK
  log the raw object.
- Title generation logs through the redacted error.

Per-wire sanitizers run first and are unchanged; the wrapper also covers
Chat Completions' structured generation, which has none. The AI SDK creates a
new error per attempt, so in-place redaction affects no other request. An
empty set makes the wrapper pass every value through untouched.

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
