# Design

Inspected at `master` `c9c70488`, 2026-10-21. The reference harnesses were
inspected at their default branches on the same date.

## Context

### Current code

- `read` dispatches on the scheme prefix in `apps/api/src/tools/native-files.ts`.
  `kb://` resolves through `knowledge/knowledge-locator.ts`, `skill://`
  through `skills/skill-locator.ts`, `machine://` through
  `tools/machine-files.ts`, and a host path through the bound native executor.
- `tools/permissions/compile-permissions.ts` keys permission groups by exact
  tool id. A field clause selects only a top-level string property
  (`permissions/value-selection.ts:29-40`). An array value never matches a
  field clause. `permissions/locator-projection.ts` holds the locator
  projection for `read`, `edit`, and `write`.

### Knowledge search

- `knowledge_search` reads whole files through a Knowledge filesystem port
  with `O_NOFOLLOW` and a containment check
  (`knowledge/knowledge-filesystem.ts`). `knowledge/knowledge-filesystem-search.ts`
  holds its passage window, merge, and partition logic.

### Shared package and dependencies

- `packages/native-file-tools/src/source-lines.ts` and `path.ts` hold the
  native read line rules and the selector grammar. Both `apps/api` and
  `apps/machine` depend on that package.
- `re2js` 2.8.6 is installed in `apps/api` and compiles permission regexes
  (`permissions/matcher.ts`). It is a pure JavaScript RE2 port with
  linear-time matches.
- The Machine daemon (`apps/machine`) serves `fs.stat`, `fs.list`, `fs.read`,
  `fs.edit`, `fs.write`, and `fs.bytes` over `packages/machine-protocol`. No
  method searches content.
- No glob or ignore library is installed in the workspace.

### Prior art

- OMP `grep`: in-process Rust regex, 20 files per page, 512 bytes per line,
  50 KiB result.
- OpenCode and pi: `rg` binary, 100 matches.
- Gemini CLI: `rg`, then `git grep`, then `RegExp`.
- Hermes `search_files`: bundled `rg`, three output modes.
- Continue `grep_search`: `rg`, 7,500 characters.
- Codex, goose, and OpenClaw have no grep tool.
- Every reference tool that walks a repository honors `.gitignore` by default.

## Goals / Non-Goals

**Goals:**

- One tool, one output shape, four backends, one engine.
- Every hit is a `read` argument that the `read` group admits.
- No subprocess, no native addon, no engine that backtracks.

**Non-Goals:**

- See the proposal. Also: a per-call `.gitignore` opt-out, context-line
  configuration, match columns, and result ranks.

## Decisions

### D1. Shared engine in `packages/native-file-tools`, ports per backend

The matcher, line scanner, window and merge logic, glob matcher, ignore
rules, bounds, and cursor codec live in `packages/native-file-tools/src/grep/`.
The engine walks an abstract port:

```text
interface GrepWalkPort {
  list(dir): entries { name, kind: file|dir|link|other }
  read(file): bytes (bounded, O_NOFOLLOW where the port can)
  ignoreFile?(dir): text | undefined   // host and Machine only
}
```

`apps/api` supplies four ports: host (node `fs` through the bound executor),
Knowledge (the current Knowledge filesystem port), skill (the skill catalog
resolver), and Machine (the `fs.grep` client, which does not walk locally).
`apps/machine` supplies a host port and runs the same engine.

Rejected alternative: a second copy of the walker in `apps/machine`. The
engine must give identical results on both sides, so one package owns it.

### D2. `re2js` moves to `packages/native-file-tools`

`apps/api` already depends on `re2js` for permission regexes. The grep engine
needs it in the shared package. The dependency moves there, and `apps/api`
keeps it through the workspace link.

`literal: true` compiles
`RE2JS.quote(pattern)`. `ignoreCase: true` prefixes `(?i)`. The engine
compiles patterns once per call. A compile error returns `invalid_pattern`
with the engine message and the pattern index.

Rejected alternatives:

- The `re2` native addon: prebuilt binaries in the Docker image, and a second
  engine beside `re2js`.
- Node `RegExp` in a worker thread: new thread machinery, and a pattern can
  still burn 30 seconds.
- A ripgrep subprocess: the Knowledge port guarantees cannot survive a process
  that walks the real directory.

### D3. Glob matcher: `*`, `**`, `?` only

The engine recognizes glob operators in the submitted text before any
percent-decoding, so `%2A` stays a literal asterisk. Emitted `kb://` and
`skill://` locators encode `*` and `?`, so a hit returns as a scope without
a glob. A host file whose name holds `*` or `?` is reachable only through a
glob. That ceiling is recorded here.

The engine splits a scope into the literal prefix and the glob suffix at the
first segment that contains `*` or `?`. The prefix is the admitted identity.

The suffix compiles to one RE2 pattern over the path relative to the prefix.
`*` and `?` become `[^/]*` and `[^/]`. `**` becomes `.*` across segments.
The engine quotes every other character. A `{`, `}`, `[`, or `]` in the
suffix is `invalid_path` with the operator named.

The engine enters a directory only when the compiled suffix can still match
beneath it. It computes that with a prefix match on the segment pattern
list. A glob never forces a full walk of the prefix.

Rejected alternative: `picomatch`. Its negation and extglob operators
interact with the prefix rule and need their own scenarios. Add braces when a
transcript asks for them.

### D4. Ignore rules through the `ignore` package

`ignore` 7.0.13 (MIT, no dependencies, the parser that ESLint and Prettier
use) joins `packages/native-file-tools`. The walker keeps a stack of `ignore`
instances. Each instance belongs to one directory that holds a `.gitignore`.
The walker tests each relative path against the stack from the scope prefix
downward.

The walker prunes `.git` before any rule runs. Knowledge and skill
ports return no ignore file, so their walks are unchanged. A scope that names
one regular file skips the walker and the rules.

### D5. Admission: once per scope, then once per file

The runner gains a `grep` branch beside the native file branch:

```text
admit(call):
  for each scope in order:
    prefix = literalPrefix(normalize(projectScheme(scope)))
    args = { ...submitted, scopes: prefix }
    decision = evaluate(policy, toolId: grep, args, allFieldsExtra: prefixes)
    if reject: record(decision); return permission_denied
  record(allow)
  run engine with onCandidate(file):
    decision = evaluate(policy, toolId: read, args: { path: canonical(file) })
    if reject: refused += 1
    return decision is allow
  result.warnings += { kind: read_refused, count: refused }
```

The projection reuses `locator-projection.ts`. `grep` joins
`NATIVE_FILE_PERMISSION_TOOL_IDS` with a scope branch that removes the glob
suffix instead of a read selector. Host and Machine scopes are normalized
lexically first, so `..` cannot widen a substring allow. The per-file check
reuses the `read` projection unchanged. A `.env` reject written for `read`
hides the file from `grep` with no second rule.

Per-file decisions are counted, not recorded one by one. The derived
decision list is capped at 26 entries (`runs/assistant-transcript.ts`), and
a call can refuse thousands of files. The count reaches the completion
audit and the result.

Rejected alternatives:

- An array-aware field matcher in the evaluator. That changes the permission
  capability for every tool to serve one.
- One derived decision per file. The cap drops them silently.

### D6. Output shape

```json
{
  "results": [
    {
      "locator": "kb://<id>/notes/a.md:11-13",
      "content": "11: ...\n12: ...\n13: ...",
      "matches": [12]
    }
  ],
  "complete": false,
  "cursor": "<opaque>",
  "warnings": [{ "kind": "binary", "count": 2 }]
}
```

Passages of one file are adjacent in `results`. A file with more than 20
passages adds `truncated: true` on its twentieth passage. The page is
budgeted at 15,000 UTF-16 code units before the runner's 16,000-character
cap, so the cursor is never cut away.

The walk order is depth-first with byte-ordered names per directory. That
is the canonical order the cursor keys on. The cursor encodes
`{ scope index, canonical file locator, start line }` of the last emitted
passage and a SHA-256 of the resolved inputs (patterns, projected scopes,
`literal`, `ignoreCase`), as base64url. The projected scopes carry the
Workspace root, so a Workspace change invalidates the cursor.

On resume the walk lists but does not open entries before the cursor.

### D7. `fs.grep` on the Machine daemon

Request: `{ path, globSuffix, patterns, literal, ignoreCase, cursor, budget }`
where `budget` is `{ files, entries, bytes, deadlineMs }` remaining for the
call. Response: the D6 shape with paths relative to the display prefix of
the daemon, the `complete` flag, warnings, and the budget consumed. The
daemon resolves `path` through its root guard and returns
`path_not_registered` outside the roots. The daemon applies every D1 to D6
bound locally within the request budget.

The API renders each path through `formatMachineLocator`, so no host path
crosses. The API evaluates the `read` group per returned file before it
emits the passage. The daemon opened those files under the Machine's own
authority. That is the same authority `bash` on the Machine already holds.

The daemon returns at most one page per request. The API cursor wraps the
daemon cursor. A method-not-found error maps to the Machine unusable
result.

### D8. Advertisement

`knowledge-tool-candidate-resolver.ts` admits `grep` when any of the four
backends is configured. The packaged `prompts/tools/grep.md` joins
`TOOL_PROMPT_IDS`. The `read` description gains one line that names `grep`
under `{{#if tools.grep}}`.

### D9. Bounds are code-owned constants

| Bound               | Value             |
| ------------------- | ----------------- |
| Patterns            | 8, 512 bytes each |
| Scopes              | 16                |
| Files per page      | 20                |
| Passages per file   | 20                |
| Line cut            | 512 code units    |
| Window              | 1 line each side  |
| Passage             | 2,000 lines       |
| Files examined      | 5,000             |
| Bytes read per call | 32 MiB            |
| File size           | 1 MiB             |
| NUL probe           | 8 KiB             |
| Deadline            | 30 s              |

They are not operator knobs. The Knowledge values are reused where they
exist.

## Risks / Trade-offs

### Performance

- `re2js` is slower than native RE2. A 32 MiB scan of short lines costs
  seconds, not minutes. The deadline bounds the worst case. A bounded spike in
  the engine layer records the measured time for 32 MiB of Markdown.
- The per-file `read` evaluation runs once per candidate. The evaluator is
  in-memory and bounded by the selection budget. 5,000 evaluations cost
  milliseconds.

### Compatibility

- The `remote-machines` change is not archived. The Machine layer cites its
  canonical-locator and registered-root rules and must archive after it.
- `rg` honors ignore files only inside a Git repository. This design honors
  them everywhere. That is deterministic and simpler.
- A Machine daemon older than this change has no `fs.grep`. The API maps the
  method-not-found error to the Machine unusable result.
- Rollback: `tools.allowed` names the tool. Removal of the name removes the
  tool from every attempt. No durable data changes.
