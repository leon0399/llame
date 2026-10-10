## Why

Two shipped contracts promise that credentials never reach a model or an
owner, and the code keeps neither promise:

- `bash-execution` says "Values the host knows to be secret SHALL be redacted
  before the result leaves the executor", and the executor supports a
  protected-value list, but no caller passes one
  ([#1065](https://github.com/leon0399/llame/issues/1065)). Host bash runs as
  the llame user with a minimal environment, so `env` shows nothing, but
  `cat /run/secrets/openai_key`, `cat apps/api/.env.local`, or reading the API
  process's `/proc/<pid>/environ` returns a resolved provider key verbatim to
  the model.
- `provider-api-selection` says no Chat Completions failure SHALL expose the
  credential, and a gateway that echoes a request credential in its error
  text ("invalid header Authorization: Bearer sk-…") is passed through
  unchanged. The Responses wire has no sanitizer, and title generation logs
  the raw error
  ([#1098](https://github.com/leon0399/llame/issues/1098)).

Both gaps need the same missing piece: a defined set of the values the
instance knows to be credentials. MCP already builds such a set per server;
nothing builds one for the instance.

## What Changes

- The instance configuration exposes one boot-time set of configured
  credentials: the resolved value of every credential-typed field, plus every
  `{env:…}` / `{path:…}` substitution inside a credential-bearing map
  (provider and MCP headers, MCP stdio command, arguments, and environment).
  Other interpolated settings are not in the set (see Decisions).
- Every host `bash` result redacts those values in stdout and stderr before
  the result leaves the executor, as the executor already does for any list it
  is given.
- Every language-model failure, on every provider wire and every request kind
  (streaming, structured, title, compaction), has those values redacted from
  its message before the run records, streams, or logs it.
- The redaction marker is the executor's existing `[REDACTED]`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `instance-config`: a new requirement defining the configured credential set.
- `bash-execution`: a new requirement naming that set as the values bash
  results redact.
- `provider-api-selection`: a new requirement covering failure text on every
  wire.

## Impact

- `apps/api/src/instance-config` (building the set), `apps/api/src/tools/bash.ts`
  (passing it), `apps/api/src/models/model-client-factory.ts` (wrapping every
  client's failures), and the title path's logging.
- Operator docs for bash and providers; `CHANGELOG.md`.
- No API, schema, or configuration change; nothing new is configurable.

## Acceptance

- A canary credential configured as a provider `key`, a provider header
  substitution, a web-search key, the GitHub adapter token, and an MCP header
  each appears as `[REDACTED]` in a bash result that prints it.
- A stubbed upstream that echoes a canary credential in its failure text
  yields `[REDACTED]` in the run's failure, its terminal stream event, and
  its failure log line, for every provider type, and in the title-path log.
- A non-credential interpolation (for example `knowledge.root` or
  `{env:PORT}`) is never redacted.

## Assumptions

- Redaction is exact substring replacement, longest value first, as the
  executor and MCP already do. It does not catch encodings of a credential
  (base64, URL-encoded); that limit is accepted and documented.
- Resolved values are fixed at boot, so the set is built once.

## Decisions for approval

- **D1 Membership: credential fields, not every interpolation.** The
  instance-config contract already says interpolated values are never
  exposed, but redacting every interpolation would corrupt ordinary output: a
  `knowledge.root` of `/srv/kb` or a `{env:PORT}` of `3000` would be replaced
  wherever it appears. The set takes credential-typed fields whole (provider
  `key` and `accountId`, web-search engine `key`, the GitHub adapter `token`),
  even when written literally, and only the interpolated substitutions of the
  credential-bearing maps, as MCP does today.
- **D2 Scope of bash redaction: instance credentials only.** Workspace MCP
  configurations resolve their own secrets per attempt; those are not added in
  this change (Non-goals).

## Non-goals

- Redacting a Workspace's own `.mcp.json` secrets from bash output.
- Redacting encoded or partial forms of a credential.
- Preventing bash from reading credential files; that is the permission
  policy's and a future Sandbox's job (ROADMAP local Sandbox execution).
