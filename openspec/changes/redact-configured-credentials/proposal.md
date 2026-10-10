## Why

Two shipped contracts promise that credentials never reach a model or an
owner, and the code keeps neither:

- `bash-execution` says "Values the host knows to be secret SHALL be redacted
  before the result leaves the executor", and the executor supports a
  protected-value list, but no caller passes one
  ([#1065](https://github.com/leon0399/llame/issues/1065)). Host bash runs as
  the llame user with a minimal environment, so `env` shows nothing, but
  `cat /run/secrets/codex-auth.json`, `cat apps/api/.env.local`, or reading the
  API process's `/proc/<pid>/environ` returns provider keys, a Codex refresh
  token, or the `POSTGRES_URL` password verbatim.
- `provider-api-selection` says no Chat Completions failure SHALL expose the
  credential, yet a gateway that echoes a request credential in its error text
  is passed through unchanged; the Responses wire has no sanitizer, and title
  generation logs the raw error
  ([#1098](https://github.com/leon0399/llame/issues/1098)).

Both gaps need the same missing piece: a defined set of the values the API
process knows to be credentials. MCP already builds such a set per server;
nothing builds one for the instance.

## What Changes

- The API process derives one in-memory set of configured credentials at
  startup. Membership is listed in the `instance-config` requirements:
  credential fields whole; the credential-shaped leaves of a JSON document a
  member substitution selects from; `POSTGRES_URL`, its password, and
  `PGPASSWORD`; interpolated substitutions in provider and MCP headers and
  stdio MCP `command`, `args`, and `env` values; the userinfo and
  credential-shaped query values of provider and remote MCP URLs, however
  written; and literal header values under a credential-shaped name. An
  8-character floor applies only to the database password, `PGPASSWORD`, and
  a URL userinfo username; every other member counts at any nonblank length.
- Every host `bash` result replaces each member with `[REDACTED]`. The output
  bound is applied on raw positions without splitting a member, so a
  credential crossing the bound is redacted whole. This needs an executor
  change.
- No language-model failure, on any wire or request kind, carries a member;
  where a wire forwards upstream text, the member is replaced with
  `[REDACTED]`. Failure classification is unchanged.
- Three shipped requirements that currently permit an echoed credential are
  reworded to defer to the new one.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `instance-config`: seven new requirements defining the set.
- `bash-execution`: "Command results are bounded and explicit" names the set
  and the raw-position cut that never splits a member.
- `provider-api-selection`: a new requirement for failures on every wire, and
  "Chat Completions failures reach the run as bounded messages" qualified with
  redaction.
- `opencode-go-provider`: the "MAY name request values the gateway chose to
  echo" sentence excepts a configured credential.
- `provider-request-headers`: the "outside this guarantee" sentence for an
  echoed header becomes redaction.

## Impact

- `apps/api/src/instance-config` and `packages/config-interpolation` (building
  the set from one read of each selected document), `apps/api/src/tools/bash.ts`
  and `packages/bash-executor` (cutting on raw positions),
  `packages/runtime-safety` (one redaction routine),
  `apps/api/src/models/model-client-factory.ts` (wrapping every client's
  failures), and the title path's logging.
- Operator docs for bash and providers; `CHANGELOG.md`.
- No API, schema, or configuration change; nothing new is configurable.

## Acceptance

- A canary credential of each member kind appears as `[REDACTED]` in a bash
  result that prints it, including one that crosses the output bound.
- A stubbed upstream that echoes a canary credential produces no failure
  message, run event, or log line containing it on any provider type, with
  `[REDACTED]` where the wire forwards upstream text, and the title-path log
  is likewise clean.
- A non-credential interpolation (for example `knowledge.root` or
  `{env:PORT}`) is never redacted, and failure classification is unchanged.

## Threat model

Redaction stops accidental verbatim echo of a credential into model context,
owner output, and logs. It does not stop a model that intends to exfiltrate:
bash can print an encoded or split form (`base64`, `cut`), and other tools
that read files are not covered (Non-goals). The controls for that are the
permission policy and a future Sandbox.

## Assumptions

- Redaction is exact substring replacement through one routine; encoded forms
  are not matched.
- Resolved values are fixed at boot, so the set is built once.

## Decisions for approval

- **A1 Membership by field.** Redacting every interpolation would corrupt
  ordinary output (`knowledge.root`, ports, home paths). Membership is an
  explicit list of credential fields, the documents they select from,
  `POSTGRES_URL`, substitutions in credential-bearing values, and URL
  credentials. Stdio MCP `command` and `args` substitutions are members:
  `mcp-tools` already treats every such interpolation as a declared secret,
  and bash can read a live child's argv from `/proc/<pid>/cmdline`. The cost
  is that an interpolated path such as `{env:HOME}` is redacted from bash
  output too; writing it literally is the remedy `mcp-tools` already
  documents. URL credentials are taken from the resolved userinfo and
  credential-shaped query values, not only from substitutions inside them, so
  a whole-URL substitution or a literal URL credential is covered; other query
  values and the endpoint stay unredacted.
- **A2 Bash covers instance credentials only.** A bound Workspace's own
  `.mcp.json` secrets are not added.
- **A3 Selected JSON documents contribute their credential-shaped leaves.** A
  Codex auth file's refresh token is more valuable than the access token it
  sits beside; its timestamps and modes are not added.
- **A4 An 8-character floor for inferred values only, and one
  credential-shaped name rule.** _Revised after review:_ the floor now
  follows how a value became a member, not which field holds it. A value is
  a credential by construction when it sits in a credential field, is an
  interpolation in a credential-bearing value (a provider or MCP header, a
  stdio `command`, `args`, or `env` value, a URL's userinfo password or
  query), is a URL userinfo password, or sits under a credential-shaped name
  (a literal header, a query value, a document leaf); such a value counts at
  any nonblank length, because a valid short token would otherwise be printed
  verbatim. The floor stays only where membership is inferred and short
  non-secret values are common: the database password and `PGPASSWORD`
  (the shipped development password `app` would otherwise turn `apps/api`
  into `[REDACTED]s/api`) and a URL userinfo username (`svc`). Accepted
  leak: such a value under 8 characters printed on its own is not redacted;
  the database password is redacted only inside the whole `POSTGRES_URL`.
  Accepted cost: a short or common value in any other position, including a
  non-secret interpolated into stdio `command` or `args`, over-redacts; as
  `mcp-tools` already says, the remedy is to write a non-secret literally,
  and a keyless provider omits its key. The name rule (`authorization`,
  `cookie`, `credential`, `token`, `key`, `secret`, `passw`, `signature`)
  decides which literal header values, URL query values, and document leaves
  are members, so `X-Region: eu-west-1` stays out.

## Non-goals

- Redacting native `read`/`grep`, MCP tool results beyond each server's own
  set, or web reads with this set.
- Redacting a Workspace's own `.mcp.json` secrets.
- Picking up a credential file rotated after startup; the set is built at boot.
- Redacting encoded forms of a credential, or a partial value a command
  printed itself before exiting.
- Preventing bash from reading credential files.
