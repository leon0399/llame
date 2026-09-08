## Why

The native `read`, `edit`, and `write` tools exist only on a process that has
accepted host OS authority, and Knowledge files are reachable only through the
deprecated `knowledge_read`, whose zero-based coordinates are the sole handoff
`knowledge_search` offers. A hosted worker with a Knowledge root and no native
host therefore has no `read` at all, and the model learns two file contracts for
the same bytes. Issue #702 reserves the `kb://` locator that `native-file-tools`
design D1 left open; #691 owns deleting `knowledge_read` once that locator
carries the owner and Space authorization. Both land here because the deletion
is only safe on the same diff as its replacement.

## What Changes

- `read`, `edit`, and `write` accept `kb://<space-id>/<path>[:selector]`. The
  scheme of the `path` argument selects the authority: absolute paths keep the
  alpha host authority; `kb://` resolves through the trusted Run owner's current
  Knowledge Space access on every call and never binds the Run to an executor.
- The three native tools are advertised when the process has accepted native
  host authority **or** has a configured Knowledge root. An absolute path on a
  process without `tools.nativeExecutorId` fails closed with
  `executor_unavailable`.
- `knowledge_search` passages carry a ready `locator`
  (`kb://<id>/<path>:N-M`, one-based) in place of zero-based `offset`/`limit`.
  The locator is directly a valid `read` argument; that is how the model learns
  the scheme.
- **BREAKING** `knowledge_read` is deleted outright: declaration, adapter,
  legacy envelope, Markdown-only suffix rule, and 1 MiB source policy. A
  `tools.allowed` entry naming it fails boot; a Run whose snapshot names it
  fails that call closed; historical observations render as recorded.
- `kb://` results carry the Knowledge Space identifier, display name, locator,
  and the closed untrusted-content `notice`; content is returned verbatim and
  is not neutralized, so `edit` `oldText` copies work.
- Scheme is parsed before the trailing selector; `:` is rejected inside a
  `kb://` path; an unimplemented `scheme://` prefix fails closed with
  `invalid_path` on every tool instead of becoming a literal filename.
- `write` creates missing intermediate directories on every scheme.
- `kb://` mutations reuse the durable pre-effect fence (`native.attempt` event
  and replay) without the executor bind.
- `kb://<id>/` lists the Space through the shipped directory listing; bare
  `kb://` is `invalid_path`. Space inventory disclosure stays with #550.
- Drive-by: the unstarted `knowledge-submit` change's design D2 drops its
  Markdown-only path rule, since `kb://` writes admit any regular file.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-file-tools`: per-scheme authority and advertisement, scheme-first
  selector parsing, unknown-scheme refusal, intermediate directory creation on
  write, fence without executor bind for `kb://`, the `kb://` locator
  requirement, and removal of the deprecated Knowledge read adapter requirement.
- `knowledge-tools`: `knowledge_search` becomes the only code-owned Knowledge
  tool, passages carry a `kb://` locator, attribution and trust framing cover
  `kb://` results, and the `knowledge_read` requirement is removed.
- `tool-calling`: native tool admission by native authority or Knowledge root,
  the Knowledge code-owned inventory shrinks to `knowledge_search`, and a bound
  Run that requests the removed reader fails closed.

## Impact

`packages/native-file-tools` gains scheme parsing and an intermediate-directory
write; it stays free of tenant authorization. `apps/api/src/tools/native-files.ts`
gains a resolver step that maps `kb://` to the owner-scoped Knowledge binding
(`knowledge-filesystem.ts` path validation and `KnowledgeSpaceLocalResolver`)
before the native package runs. `knowledge-tools.ts` loses `knowledgeReadTool`
and `knowledge-filesystem-read.ts` loses its legacy envelope; search emits
locators. `knowledge-tool-candidate-resolver.ts`, `registry.ts`, and the
`tool-observation-part.ts` renderer change. Prompts (`chat-default.md`, tool
descriptions), `docs/knowledge.md`, `docs/native-files.md`, README, SPEC, and
the e2e Knowledge scenario are updated; `docs/knowledge.md` points at the native
read surface. Issues: closes #702 and #691; #701 tracker updated; #703
(`chats://`) follows the same scheme seam.
