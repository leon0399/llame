# Proposal

Issue: [#1381](https://github.com/leon0399/llame/issues/1381).

## Why

The assistant has no bounded content search over the trees that the native
`read` tool serves. `knowledge_search` is a literal passage scanner by spec. A
Workspace search must go through `bash`, and `bash` cannot reach `kb://`,
`skill://`, or a `machine://` root. A `grep` tool closes that gap with zero
model calls, and every hit is a locator that `read` accepts.

## What Changes

### Tool contract

- Add a code-owned `grep` tool with the `read_only` classification. The tool
  searches file contents with RE2 patterns over scoped locators. It returns
  line-ranged locators.
- Input is one strict object: `patterns` (array, OR), optional `scopes`
  (array), optional `literal`, `ignoreCase`, `limit`, and `cursor`. A scope
  carries its own glob in its path part. There is no separate `include`
  parameter.

### Scopes

- Scope backends: host paths under the native executor gate, `machine://`
  through a new `fs.grep` daemon method, `kb://`, and `skill://`. The tool
  refuses a `media://` or `http(s)://` scope.
- In an entered Workspace, an omitted `scopes` searches the Workspace root.
  Without a Workspace, an omitted `scopes` is `invalid_input`.

### Admission and engine

- The tool admits the call once per scope against the
  `tools.permissions.grep` group on the literal prefix of that scope. The
  tool also evaluates every candidate file against the `read` group. A hit
  never names content that `read` refuses.
- The pattern engine is RE2 syntax through the installed `re2js` package. A
  pattern that RE2 rejects fails the call with the parser message. No engine
  that backtracks runs.

### Walk and output

- Host and Machine walks honor `.gitignore` files, never enter `.git`, include
  hidden entries, never follow symbolic links, and skip binary and oversized
  files. Knowledge and skill walks keep their current rules.
- Output: content mode only, grouped by file, numbered lines, one context line
  before and after each match, bounded files per page and passages per file,
  and an opaque keyset `cursor`.
- The tool is advertised when at least one backend can serve: accepted native
  host authority, a configured Knowledge root, a configured skill source, or a
  configured Machine.
- The packaged description template `grep.md` joins the tool prompt ids.
  `tools.promptFiles.grep` becomes a valid override key. `tools.grep` becomes
  a registered predicate.

### Non-goals

- A `chats://` scope.
- Remote repositories: GitHub, Sourcegraph, grep.app.
- Multiline patterns, `files_only` and `count` modes, and a semantic `find`
  tool.
- Retirement of `knowledge_search`.
- Ignore rules for `read` directory listings
  ([#713](https://github.com/leon0399/llame/issues/713)).

## Capabilities

### New Capabilities

- `grep-tool`: the `grep` tool contract. Input, scope grammar, admission,
  walk policy, match rules, output, bounds, pagination, and failure results.

### Modified Capabilities

- `tool-calling`: the registry requirement names `grep` in the initial native
  set and gives the candidate resolver its admission rule.
- `instance-config`: the unknown-predicate scenario uses an unregistered id
  that is not `grep`, because `grep` becomes registered.
- `tool-prompt-templates`: the uninstalled-tool scenario uses an unregistered
  id that is not `grep`, for the same reason.

## Impact

### Code

- `apps/api/src/tools`: new `grep` module, registry entry, permission
  projection for scopes, candidate resolver branch, packaged `grep.md`.
- `packages/native-file-tools`: shared engine (pattern compile, line scan,
  passage windows, glob matcher, ignore rules, abstract walk port). New
  dependencies: `re2js` (moved from `apps/api`) and `ignore`.
- `apps/api/src/knowledge` and `apps/api/src/skills`: walk ports for `kb://`
  and `skill://`.
- `packages/machine-protocol` and `apps/machine`: new `fs.grep` method and
  its daemon handler.

### Documentation

- Operator docs: `docs/product/operator/native-files.md`, a
  `docs/product/reference` tool page, and `CHANGELOG.md`.

### Threats

- A scope admitted for `grep` while a file beneath it is refused for `read`.
  The per-hit `read` check closes it.
- A host path that leaves the Knowledge root through a symbolic link. The
  current Knowledge port closes it.
- A pathological pattern that blocks the worker. RE2 closes it.
- A Machine that returns a host path. The Machine locator rule closes it.
