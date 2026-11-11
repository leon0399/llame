---
summary: "Enabling and restricting the host-backed native file tools, bash, Workspace entry, and permission modes"
read_when:
  - you are enabling or changing native file access, bash, or Workspace entry
  - you are deciding the Workspace entry or permission-mode policy of an instance
behavior:
  - ../reference/tools/read.md
  - ../reference/tools/edit.md
  - ../reference/tools/write.md
  - ../reference/tools/bash.md
  - ../reference/tools/enter-workspace.md
  - ../reference/tools/exit-workspace.md
  - ../reference/locators/index.md
  - ../reference/locators/artifact.md
  - ../reference/selectors.md
  - ../reference/instruction-files.md
  - ../reference/context-documents.md
  - ../reference/permission-modes.md
  - ../reference/mutation-recovery.md
---

# Native file tools

`read`, `edit`, and `write` select their authority from the scheme of their
`path` argument: an absolute path or a `file://` alias runs on the worker's
filesystem with its OS user's authority, and `kb://` resolves through the
trusted Run owner's current Knowledge Space access without binding the Run to an
executor. `bash` shares the absolute-path host gate.

This page covers enabling and policy only. What each tool does is documented in
[read](../reference/tools/read.md),
[edit](../reference/tools/edit.md),
[write](../reference/tools/write.md), and
[bash](../reference/tools/bash.md); the authority each locator scheme reaches
is summarized in [locators](../reference/locators/index.md), and line and
representation selectors in [selectors](../reference/selectors.md).

## Enabling

Absolute-path access and `bash` need a trusted host identity in the instance
configuration named in the [operator index](index.md#operator), then a restart
of the API and worker:

```json
{
  "tools": {
    "nativeExecutorId": "personal-host-a",
    "allowed": ["read", "edit", "write", "bash"]
  }
}
```

`kb://` locators need only a configured `knowledge.root`; `tools.allowed`
still gates each tool id. A process with `knowledge.root` and no
`nativeExecutorId` advertises `read`, `edit`, and `write`, all usable with a
locator — an absolute path argument on that process fails closed with
`executor_unavailable` instead of resolving through the Knowledge root.

`ssh://` locators replace only the executor prerequisite: they need the
top-level `ssh` section, described in [SSH locators](ssh.md), instead of
`tools.nativeExecutorId`, and a process with the section but no local executor
still serves them. `tools.allowed` and the `read` and `bash` permission groups
still decide every `ssh://` call. `read` accepts an `ssh://` path and `bash`
accepts one as its `cwd`, which runs the
command on that host; `edit` and `write` refuse it with
`unsupported_operation`, and `enter_workspace` refuses it with `invalid_path`.

Optional trusted bash cwd (defaults to the cwd of the process that executes the
Run, so a split web/worker deployment resolves it in the worker, and a bound
Workspace root overrides it):

```bash
BASH_WORKING_DIRECTORY=/absolute/project
```

Keep any other desired tool ids in `allowed`. Each distinct host filesystem
needs a distinct, stable `nativeExecutorId`. Co-located API and worker processes
that use the same native filesystem should use the same identity. Without it,
absolute-path native access and `bash` are unavailable even when allowlisted.

## Managed command capacity

`tools.bash.maxProcesses` bounds the managed commands of one worker process.
It defaults to 64 and accepts a safe integer of at least 1 or a whole-value
interpolation token that resolves to one. An empty or invalid resolved value
fails startup naming the field.

Foreground host commands and `ssh://` commands share this capacity. A call past
the bound returns `limit_reached` before recording an attempt or spawning a
process. A Machine daemon has its own bound of one and keeps its `unavailable`
refusal. See [bash bounds and errors](../reference/tools/bash.md#bounds).

## `grep`

`grep` searches file contents. It is read-only and records no native attempt.
It needs its own `tools.allowed` entry and at least one serving backend: a
`nativeExecutorId`, a `knowledge.root`, a skills directory, or a configured
Machine. Without a backend the tool is not advertised.

A host scope needs the same `nativeExecutorId` as `read`. A host scope on a
process without accepted native host authority returns
`executor_unavailable`.

`grep` adds one permission group, `tools.permissions.grep`. The shipped
example config does not include this group. An absent group rejects every
call.

The group runs once per scope, before any file is opened. A clause on `scopes`
sees the literal prefix of that scope. The prefix stops at the first segment
that holds a glob operator, so a clause never sees `*` or `?`. A relative
scope is first resolved from the Workspace root. An all-fields reject also
sees the submitted scope text, so it can reject a glob. One refused scope
rejects the whole call.

```json
{
  "tools": {
    "permissions": {
      "grep": {
        "allow": true,
        "reject": [{ "field": "scopes", "literal": "/srv/secrets/" }]
      }
    }
  }
}
```

`grep` walks without a file, entry, byte, or file-size bound unless the
operator sets one. The call deadline is its only default stop: the tool call
timeout (120 seconds unless `tools.callTimeoutSeconds` says otherwise), less
the larger of 5 seconds and a tenth of it, but at most half. A bound that
stops a walk returns `complete: false` with the warning that names it, never a
refused call, and each bound applies across every scope of the call.

```jsonc
{
  "tools": {
    "grep": {
      "maxFilesExamined": 5000,
      "maxEntriesListed": 20000,
      "maxBytesRead": 33554432,
      "maxFileBytes": null,
    },
  },
}
```

Each field takes a positive integer, `null`, or a whole-value
`{env:...}`/`{path:...}` token that resolves to one; `null` (or an absent
object) leaves that bound off. `maxBytesRead` counts the bytes of files the
walk takes plus what it read so far of the file it waits on. Zero, a negative
number, a fraction, and an unknown field fail startup naming the field. Every Machine `grep` call reaches a daemon through the `fs.grep`
`bounds` field, so the API and every Machine daemon must be the same build.

`grep` then runs the `read` group on every candidate file. It sets `path` to
the canonical locator of that file. A file that `read` refuses contributes no
hit. The result does not count the refused files. The completion audit does.

A host walk follows these rules:

- It includes hidden entries.
- It MUST NOT follow a symbolic link.
- It MUST NOT enter a directory named `.git`.
- It reads `.ignore` beside `.gitignore` in every directory of the walk, and
  `.ignore` outranks `.gitignore` in one directory.
- Above the scope prefix it reads `.ignore` files up to `/`. It reads
  `.gitignore` above the prefix only from the nearest repository directory
  down, where the repository directory is the nearest directory at or above
  the prefix that holds a `.git` entry or file.
- A rule decides an entry only when its own pattern matches that entry's
  path. In one file the last matching rule decides, a negation included, and
  a deeper file outranks a shallower one. The walk never applies a rule to the
  scope directory or a directory above it, so an explicit scope searches an
  ignored directory and a re-included directory keeps its other rules.
- It never searches `.ignore` or `.gitignore` as a candidate of a directory
  scope.
- It searches an exact file scope even when an ignore rule matches it.
- It reports excluded directories in `ignored`, up to 1,000 recorded per call,
  with the admitted count and first five locators. The `read` group decides
  each directory both as written and with a final `/`; a refused directory
  still takes a recorded slot but is neither counted nor named, and the
  decisions are not recorded one by one. The
  [grep reference](../reference/tools/grep.md) owns the report format.

### On a Machine

A `machine://` scope runs on the Machine. The `llame-machine` daemon performs
the walk, the match, and the bounds, through the `fs.grep` method. It resolves
the scope prefix through its registered roots first. Any other prefix returns
`path_not_registered`, and the daemon opens no file.

The daemon answers passages relative to the scope prefix. Every result is
therefore a `machine://` locator, and no host path reaches the model. Read one
locator, or submit it as a later scope.

One call shares its file, entry, byte, time, and page budget across every
scope. A second Machine scope receives what the first one left.

The daemon applies `.ignore` up to its registered root and reads `.gitignore`
above the prefix only inside the repository, as on the host. It answers its
excluded directories in `ignored`, relative to the prefix. The API merges the
lists in scope order, applies the same 1,000-directory cap, and spells each
admitted locator as a `machine://` scope.

The daemon opens each candidate under its own authority. The API then applies
the `read` group to every returned file. It drops the passages of a refused
file and counts them for the completion audit. A refused file never reaches
the result, and the walk keeps its own position past it.

A daemon without the `fs.grep` method fails the call as Machine unusable. An
unknown Machine returns `machine_not_found` and no other scope is searched.

## Permission modes

`tools.permissionModes` is an ordered list of per-Run modes. It defaults to
`["default"]` and must always include `default`, so a fresh install does not
offer `bypass` or `read-only`. Add them to make them selectable:

```json
{
  "tools": {
    "permissionModes": ["default", "read-only", "bypass"]
  }
}
```

The setting is instance-wide: enabling a mode enables it for every
authenticated user, with no per-user gate. Restart the API and every worker
after changing it so the enabled list is consistent. A Run accepted as
`read-only` stays `read-only` on every worker even after the mode is withdrawn,
because a downgrade would widen authority; the accepted mode never does.

`read-only` needs no further settings. It admits only the tools classified
`read_only` (reads, `grep`, the Knowledge and conversation tools, and
`web_search`), `exit_workspace`, and `enter_workspace` without a `worktree`
argument; every other call is refused before the operator policy is evaluated.
It starts no Workspace MCP server. It is not an egress or exfiltration control:
`read` and `web_search` still reach the network under the operator policy.

Treat `bypass` as a destructive operator choice. A fetched page can steer the
model into any tool call in the admitted catalog, including calls that the
normal `tools.permissions` policy rejects. Entering a Workspace whose path would
normally be rejected also starts its Workspace MCP servers; they run unsandboxed
as the `llame` user. Enabling `bypass` therefore exposes every authenticated
user to prompt-injection and Workspace MCP risks; keep it off unless that
instance-wide trust boundary is intended.

What an effective mode admits and records for one Run is documented in
[permission modes](../reference/permission-modes.md).

## Workspace entry

`enter_workspace` and `exit_workspace` are native host capability tools. Both
require a trusted host identity, their own `tools.allowed` entry, and their own
`tools.permissions` group.

The recommended policy in `apps/api/llame.config.jsonc.example` uses an
operator-edited `enter_workspace.path` field allow such as
`^/home/operator/projects/[^/]+/?$`, plus F1-F3 credential rejects and E1-E3
rejects for `node_modules`, temporary roots, and `Downloads`. Every directory
that this group admits is trusted to run code and read host secrets through
its Workspace MCP configuration. W1 and W2 reject case-insensitive text paths to
`.mcp.json` and `.llame`, `.agents`, or `.claude` trees for both `edit` and
`write`. These are text-only policy rejects: an in-repository alias such as a
symlink can bypass them, and there is no executor-level guard.

See [Workspace MCP](mcp-tools.md#workspace-mcp) for configuration
precedence, interpolation, client lifetime, and redaction limits.

Entry evaluates, binds, projects relative paths, and detaches on re-preparation
in [enter_workspace](../reference/tools/enter-workspace.md); releasing a binding
is [exit_workspace](../reference/tools/exit-workspace.md).

## `file://` permission clauses

Permission clauses on a `file://` alias match the decoded host path, not the URL
form, so prefer `^/path/` over `^file:///path/`; see
[tool-call permissions](tool-call-permissions.md).

## `artifact://` reads

A tool result too large for the model-facing bound is stored as a Chat
resource and read back with `artifact://<toolName>-<n>`; see
[artifact](../reference/locators/artifact.md). The store is Postgres, so the
scheme needs no `nativeExecutorId` and no `bash`: `read` serves it whenever it
is allowlisted and its `read` group admits the locator. With a whole-tool allow
on `read` that is every artifact read; a field-allow group must also name
`^artifact://`, as it must name `^media://`, or the read is rejected as
`no_allow` before any lookup. The canonical allowlist is in
[tool-call permissions](tool-call-permissions.md).

One byte bound applies to every stored part. It is a positive integer from
131,072 to 268,435,456 bytes, or a whole-value `{env:...}`/`{path:...}` token;
the built-in default is 8,388,608 (8 MiB), and a value outside the range, a
fraction, or an unknown key fails startup naming the path. The floor keeps a
Machine stream readable and the ceiling keeps a part small enough to read back.

```jsonc
{
  "tools": {
    "artifacts": {
      "maxBytes": 8388608,
    },
  },
}
```

The locator still resolves only inside the Chat that made it, under its
owner's row-level security, so the clause widens which locators the model may
try, never which rows it may see.

### Host files

When `bash` is in `tools.allowed` and the process has a `nativeExecutorId`,
each artifact part is also a file on the llame host, and the spilled result's
notice names the directory. The layout, the notice wording, and the refusal of
an unsafe directory are documented with the locator in the
[artifact reference](../reference/locators/artifact.md#host-files).

`$TMPDIR` is the worker process's temporary directory (`/tmp` unless the
environment sets another one). It is not shared between hosts, and a Run that
moves to another worker or host finds no file: at the start of each attempt the
system compares the Chat's files with their stored size and modification time
and writes back what is absent or changed, and it does the same before every
`bash` call. The files are a cache; Postgres holds every artifact, and a file
that a command changed is rewritten from the store, not edited.

Because `$TMPDIR` is shared, the worker creates `llame/` and `llame/chats/`
with mode `0700` and checks them, the Chat directory, and the artifact
directory on every use. A bad root (a symbolic link, another user's owner, or
any group or other permission) disables host files for that process and logs
one warning, without a path; an unsafe Chat or artifact directory refuses that
write or reconcile quietly, and the next one tries again. Each file is written
`0600` through a temporary name.

The files are not isolated per owner. `bash` runs as the worker's own OS user,
so any Run on that host can read or rewrite them, and a person with a shell on
the host can too. Treat them as working copies, not as a secret store: `read`
on an `artifact://` locator applies the `read` group, but a file opened through
`bash` does not.

At worker start and at each attempt start, the worker removes every Chat
directory on that host that no attempt reconciled for seven days. The
attempt-start sweep runs in the background, so it never delays the attempt.
That is how the directory of a deleted Chat goes away; a live Chat gets its
files back at its next reconcile. A worker that does not allowlist `bash`
never sweeps.

## Credential redaction in bash output

At API/worker startup the loader derives one in-memory set of configured
credentials from the instance configuration. These values are members:

- Each provider `key`, for every provider type. A provider without a key adds
  nothing.
- Each web search engine `key`.
- The `github` web adapter `token`.
- Each resolved `{env:}` or `{path:}` substitution in a provider or remote MCP
  `headers` value. Literal text around it and fallback text after `:-` are not
  members.
- Each such substitution in a stdio MCP `env` value, with the same two
  exclusions.
- The password in `POSTGRES_URL`, which the loader reads from the environment,
  and `PGPASSWORD`.

The set also contains the credential-shaped string leaves of a document that a
member substitution reads through `{path:…|json:…}`, from the same file read.
A property is credential-shaped when its name contains `authorization`,
`cookie`, `credential`, `token`, `key`, `secret`, `passw`, or `signature`,
regardless of case. An array element under such a name counts too.

A member must have at least 16 characters and at least 64 bits of estimated
entropy. The estimate is the value length multiplied by the Shannon entropy per
character of the value's own character distribution. A value below either
threshold is not a member. A command that prints such a value reveals it, and
llame accepts that leak.

The set is a boot snapshot and changes no configuration key. Restart API and Run
workers after you rotate a credential file, or the old value stays a member and
the new one does not. The set is not written anywhere: it is not part of
`LlameConfig`, no API response serializes it, and the loader reads a credential
file only to redact it.

These placements and forms are not members:

- Any part of a provider `baseUrl` or a remote MCP `url`, including URL userinfo
  and query values.
  To protect a key there, put it in a `headers` value through `{env:}` or
  `{path:}` instead.
- A stdio MCP `command` or `args` substitution.
- A literal header value, even under a credential-shaped name.
- The `openai-codex` `accountId`.
- The whole `POSTGRES_URL` string. Only its password is a member.
- A JSON-escaped form of a leaf value.

llame scans no key format. It does not detect a secret it was not configured
with. What the model and the stored result show is in the
[bash reference](../reference/tools/bash.md#credential-redaction).

Redaction also does not protect the credential files on disk: restrict their
ownership and mode as the provider pages describe.

## Instruction files

Per-directory project instruction files are loaded into the model's context by
directory chain and trigger; the contract is in
[instruction files](../reference/instruction-files.md).

Host instruction imports use the same `read` group and effective permission mode as
ordinary host reads. A denied target is audited through `read` without a filesystem
probe and reported as denied whether or not it exists. When an import's canonical
path differs from its resolved path (for example, a symlink), `read` also evaluates
the canonical (real) path on its first page and records a derived `canonical`
decision; a reject denies the import, while `bypass` admits and records it.

A `read` reject rule excludes a path from every load. Add the rule to the
existing `tools.permissions` map rather than replacing what is already
configured there:

```json
{
  "tools": {
    "permissions": {
      "read": {
        "allow": true,
        "reject": [
          {
            "field": "path",
            "regex": "^/home/operator/(LLAME|AGENTS|CLAUDE)(\\.override|\\.local)?\\.md($|:)"
          }
        ]
      }
    }
  }
}
```

That is a permission recipe rather than a chain rule; see
[tool-call permissions](tool-call-permissions.md) for clause matching.

## Mutation recovery

Native mutations are fenced before they change bytes, and a redelivered Run
never repeats an effect; the contract is in
[mutation recovery](../reference/mutation-recovery.md).
