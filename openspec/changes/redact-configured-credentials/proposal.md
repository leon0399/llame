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
  startup. Membership is listed in the `instance-config` requirements: each
  provider `key` (every type; a keyless provider gives nothing), each web
  search engine `key`, the `github` web adapter `token`, the credential-shaped
  leaves of a document that a member `{path:…|json:…}` substitution selects,
  the `POSTGRES_URL` password and `PGPASSWORD`, and each resolved `{env:}`
  or `{path:}` substitution in provider and remote MCP `headers` values and in
  stdio MCP `env` values. A member must have at least 16 characters and an
  estimated entropy of at least 64 bits.
- Every host `bash` result replaces each member with `[REDACTED]`, and so does
  every `ssh://` and Machine result, redacted in the API so the set never
  leaves it. The output bound is applied on raw positions, and a value llame
  cut at a capture limit or a timeout leaves no fragment, so a credential
  crossing the bound is never partly shown. This needs an executor change.
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

- `apps/api/src/instance-config` and `packages/config-interpolation` (reporting
  each substitution's value, whether its `:-` fallback applied, and the
  selected document's leaves from one read), `packages/bash-executor` (cutting
  on raw positions), `apps/api/src/tools/bash.ts`, `ssh-bash.ts`, and the
  Machine bash path (passing the set), the run's tool context,
  `packages/runtime-safety` (one redaction routine),
  `apps/api/src/models/model-client-factory.ts` and `models.service.ts`
  (wrapping every client's failures), and the title path's logging.
- Operator docs for bash and providers; `CHANGELOG.md`.
- No API, schema, protocol, or configuration change; nothing new is
  configurable.

## Acceptance

- A canary credential of each member kind (a provider key, an engine key, the
  adapter token, a document leaf, the database password, and a header or stdio
  `env` substitution) appears as `[REDACTED]` in a bash result that prints it,
  including one that crosses the output bound.
- A stubbed upstream that echoes a canary credential produces no failure
  message, run event, or log line containing it on any provider type, with
  `[REDACTED]` where the wire forwards upstream text, and the title-path log
  is likewise clean.
- A non-credential interpolation (for example `knowledge.root` or
  `{env:PORT}`) is never redacted, and failure classification is unchanged.
- A credential under 16 characters, or under 64 estimated bits, is not a
  member; the operator pages state that leak.

## Threat model

Redaction stops accidental verbatim echo of a credential into model context,
owner output, and logs. It does not stop a model that intends to exfiltrate:
bash can print an encoded or split form (`base64`, `cut`), and other tools
that read files are not covered (Non-goals). It does not detect a secret that
llame was not configured with. It does not redact a credential in a position
that the named list leaves out: URL userinfo or query values, a literal header
value, a stdio `command` or `args` substitution, or the `openai-codex`
`accountId`. It does not redact a value that fails the entropy gate. The
controls for that are the permission policy and a future Sandbox.

## Assumptions

- Redaction is exact substring replacement through one routine; encoded forms
  are not matched.
- Resolved values are fixed at boot, so the set is built once.

## Decisions for approval

- **A1 Membership by an explicit short field list.** Redacting every
  interpolation would corrupt ordinary output (`knowledge.root`, ports, home
  paths). Membership is a short, explicit list: each provider `key`, each web
  search engine `key`, the `github` web adapter `token`, the credential-shaped
  leaves of a selected document, the `POSTGRES_URL` password and `PGPASSWORD`,
  and each resolved substitution in provider and remote MCP `headers` and in
  stdio MCP `env`. Every other position stays out: provider and remote MCP
  URLs and their parts, stdio MCP `command` and `args`, literal header values,
  the `openai-codex` `accountId`, and a resolved session value. The cost is an
  accepted leak: such a credential is not redacted (A4 and Non-goals).
- **A2 Bash covers instance credentials only.** A bound Workspace's own
  `.mcp.json` secrets are not added.
- **A3 Selected JSON documents contribute their credential-shaped leaves.** A
  Codex auth file's refresh token is more valuable than the access token it
  sits beside; its timestamps and modes are not added. Only a name that
  contains `authorization`, `cookie`, `credential`, `token`, `key`, `secret`,
  `passw`, or `signature` contributes a leaf. The loader reads the leaves in
  the same file read that selects the value.
- **A4 An entropy gate, not a length floor.** _Revised on Leo's decision,
  2026-11-06; this narrows the membership that the earlier review approved._
  A member must have at least 16 characters and at least 64 bits of estimated
  entropy, where the estimate is the length times the Shannon entropy per
  character distribution. Generated 32-character keys and long passphrases
  pass (`9f2c7b1e4d8a6350c9e2b7f4a1d8635e`, `correct horse battery staple`).
  A short or simple value (`app`, `postgres`, a timestamp) fails. A random
  16-character hex key, estimated at about 62 bits, also fails. False positives
  come only from a low-entropy member that matches unrelated text, so the gate
  removes them without a format rule.
  Accepted leak: a credential that fails the gate is never redacted, so an
  operator must use a generated value. A long passphrase that matches ordinary
  prose can over-redact; the remedy is a generated credential.

## Non-goals

- Redacting native `read`/`grep`, MCP tool results beyond each server's own
  set, or web reads with this set.
- Redacting a Workspace's own `.mcp.json` secrets.
- Picking up a credential file rotated after startup; the set is built at boot.
- Redacting encoded forms of a credential, a JSON-escaped spelling, or a
  partial value a command printed itself before exiting.
- Preventing bash from reading credential files.
- Redacting a credential that llame is not configured with. This rule covers a
  credential in a provider `baseUrl` or a remote MCP `url`, or in its userinfo
  or query; a literal header value; a substitution in a stdio `command` or
  `args`; and the `openai-codex` `accountId`.
- Redacting a value that fails the entropy gate, including the whole
  `POSTGRES_URL`, a value under 16 characters, and a value under 64 estimated
  bits.
- Detecting a credential by its format, such as an `sk-` prefix or a JWT
  shape.
