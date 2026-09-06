## Delivery stack

Use `$gh-stack` and `$openspec-apply-change` after proposal approval. The
connected delivery order is:

```text
master
  <- native-file-tools/proposal
  <- native-file-tools/reader-core
  <- native-file-tools/edit-write
  <- native-file-tools/knowledge-adapter
  <- native-file-tools/acceptance
  <- native-file-tools/finalize
```

`knowledge-submit` depends on `native-file-tools/acceptance`. `bash-executor`
depends on the native-file-tools contract but is a separate proposal and stack.
No implementation task changes permissions, initializes Git, runs bash, parses
Markdown, or adds URL loading.

## 1. reader-core

- [ ] 1.1 Create `packages/native-file-tools` with zero application-framework dependencies; verify package build, lint, typecheck, and focused tests run independently.
- [ ] 1.2 Implement absolute-path resolution, regular-file checks, literal-path precedence, and selector parsing for `:N-M`, `:N+K`, and `:raw`; verify one-based selectors, malformed selectors, missing paths, directories, special files, and literal colon-suffixed filenames.
- [ ] 1.3 Reuse or extract the current logical-line parser with LF/CRLF/lone-CR handling, terminal-delimiter behavior, bounded UTF-8 reads, and whole-line output limits; verify against the existing Knowledge filesystem tests.
- [ ] 1.4 Implement one-line preceding/following context expansion and details for requested range, shown range, representation, absolute path, and truncation; verify start-of-file, EOF, selector continuation, raw mode, and cap behavior.
- [ ] 1.5 Implement the OMP-inspired result envelope with one content block and path-specific details; verify generated line prefixes are presentation metadata and raw content remains verbatim.
- [ ] 1.6 Keep all mutations disabled in the reader layer; verify no Git, URL, Markdown, directory, SQLite, or permission dependency enters the package.

## 2. edit-write

- [ ] 2.1 Implement per-path sequential mutation execution without model-visible coordination; verify two same-path exact edits execute in order and the second cannot overwrite the first.
- [ ] 2.2 Implement exact unique `oldText` replacement with empty `newText` deletion, atomic temporary-file replacement, line-ending preservation, bounded diff, and post-edit one-line context; verify missing, ambiguous, no-op, multiline, CRLF, and EOF cases.
- [ ] 2.3 Implement creation-only `write`; verify absent targets are created and existing targets return `file_exists` without touching content.
- [ ] 2.4 Integrate alpha native host authority, trusted executor identity, and explicit disclosure; verify the model can use absolute paths only on the admitting host and no permission policy or remote-path fallback is silently implied.
- [ ] 2.5 Add the durable native mutation attempt marker and retry fence before edit/write bytes change; verify known results settle before model continuation, open attempts become `outcome_unknown`, and queue retries never replay an unsettled mutation.

## 3. knowledge-adapter

- [ ] 3.1 Adapt the existing Knowledge filesystem reader to the shared line/range/context/result primitives without changing its trusted owner and Space resolver.
- [ ] 3.2 Mark `knowledge_read` deprecated in the model declaration and operator documentation; verify existing callers and historical result shapes remain executable.
- [ ] 3.3 Add a tracked deletion task/issue reference with explicit parity evidence; verify this proposal does not delete `knowledge_read` or change its authorization boundary.

## 4. acceptance

- [ ] 4.1 Add unit and integration coverage for every `native-file-tools` requirement, including absolute paths, selectors, context, raw mode, truncation, exact edit, sequential same-path calls, create-only write, and deprecated Knowledge delegation.
- [ ] 4.2 Add a local alpha model-loop smoke test that reads, edits, rereads, and creates a file through the same native host; verify edit output prefixes are treated as metadata rather than source bytes.
- [ ] 4.3 Run affected package/API lint, typecheck, tests, build, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; verify no Git, bash, Markdown, URL, or permission work is claimed.

## 5. finalize

- [ ] 5.1 Sync the `native-file-tools` capability spec and update current Knowledge documentation with the deprecation marker; verify strict OpenSpec validation preserves existing Knowledge requirements.
- [ ] 5.2 Archive only after every native-file-tools task is checked and the deletion follow-up is recorded; verify strict specs/all validation and final formatting gates.
