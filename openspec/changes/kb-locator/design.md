## Context

See `proposal.md` for motivation. Facts that shape the approach:

- `read`/`edit`/`write` are filtered out of candidates and advertisement unless
  `tools.nativeExecutorId` is set
  (`knowledge-tool-candidate-resolver.ts:54`, `registry.ts:130`), and
  `executeNativeBound` returns `executor_unavailable` without it.
- The mutation fence is a `native.attempt` Run event plus `priorOutcome` replay;
  the only executor-specific step is the `runs.workerId` bind
  (`native-files-repository.ts:11-40`). No table stores an executor.
- Native results skip `neutralizeToolResult` and carry no `notice`
  (`run-execution.service.ts:681`); `edit` needs verbatim bytes.
- `knowledge-filesystem.ts` already owns Knowledge path validation, symlink
  refusal, and the owner-scoped binding; `knowledge-filesystem-read.ts` is the
  legacy envelope over the shared reader.
- Selector parsing in `packages/native-file-tools/src/path.ts` splits on the
  trailing `:`; Knowledge path validation does not reject `:`.
- `native-read-directory-listing` is merged but not yet archived; its delta
  modifies the same two `native-file-tools` requirements this change modifies.
- `knowledge-submit` is proposed and unstarted; its design D2 rejects
  non-Markdown paths.

## Goals / Non-Goals

**Goals:**

- One `path` string, one result contract, authority chosen by scheme.
- `kb://` works on every runs worker with a Knowledge root, with no executor
  identity, and the deletion of `knowledge_read` lands on the same diff.
- The search result is the discovery mechanism for the scheme.

**Non-Goals:**

- Bare `kb://` inventory listing, Knowledge availability reminders (#550).
- `chats://` (#703), multi-range selectors (#705), read-snapshot verification
  for `edit` (#706), Git submission (#212), shared Spaces, slugs (#332).
- Search over non-Markdown files; search stays Markdown-only.
- Any change to what host-path results look like or how they are neutralized.
- Web changes: `kb://` results render through the generic tool UI.

## Decisions

### D1: Advertise by any authority; the scheme selects it at execution

Alternatives: require `tools.nativeExecutorId` everywhere; advertise always.
Requiring the id makes every hosted Knowledge deployment a native host with OS
file authority for absolute paths, a security downgrade taken to fix an
advertisement gate, and forces a per-host identity on deployments that are not
hosts. Advertising always exposes tools that can only fail on a process with
neither authority, which the `knowledge_space_unavailable` manifest state was
built to avoid. So: candidates admit the native tools when
`tools.nativeExecutorId` or `knowledge.root` is present; `native-files.ts`
dispatches on the parsed scheme before `executeNativeBound`; absolute paths keep
returning `executor_unavailable` without the id.

### D2: `kb://` resolution reuses the Knowledge binding, not a second walker

The `kb://` branch parses `<space-id>` and `<path>`, resolves the binding through
`KnowledgeToolResolver.resolveBindingForOwnerById` under `runAs`, validates the
path with the existing Knowledge rules (plus the new `:` rejection), refuses
symlinks component by component with `lstat`, and then calls the native package
on the resolved host path with a `followSymlinks: false` option, under which the
package opens with `O_NOFOLLOW` and treats a symbolic link at the target as
`not_found`. Absolute paths keep following links as today. The native package
never sees a tenant. Alternative rejected: routing `kb://` reads through the
Knowledge filesystem's own open primitives via the D6 `{lstat, opendir}` port,
which would keep two readers alive; the `O_NOFOLLOW` option closes the same
window with one. Errors from the binding layer map to
`knowledge_space_not_found` / `knowledge_space_unavailable`; everything after
resolution uses the native `FileFailure` vocabulary. Alternative rejected: a
Knowledge-specific reader adapter, which is the layer being deleted.

### D3: Fence without bind

`NativeFilesRepository.begin` takes an optional executor; `kb://` calls skip the
`runs.workerId` bind and keep the attempt event, `priorOutcome` replay, and the
`outcome_unknown` Run stop. The attempt records the locator, not the host path.
Alternative rejected: binding `kb://` mutations to a worker, which contradicts
the `knowledge-spaces` rule that every runs worker resolves every owner child
and would turn a pg-boss retry on another worker into `executor_unavailable`.

### D4: Notice, no neutralization

`kb://` reads and listings add `notice` to the native envelope and return
content verbatim. Neutralizing would rewrite angle-bracket text and break
`edit` `oldText` matches on ordinary Markdown. This is a deliberate weakening
versus `knowledge_read`, recorded in the `knowledge-tools` delta; framing is
recall-time and instruction-carried, as in OMP and Hermes. Absolute-path results
are untouched.

### D5: Search emits a locator and nothing else for coordinates

Each passage's `offset`/`limit` become one `locator` string. Two coordinate
systems on one result is the shape models transcribe wrongly, and a locator
that is literally a valid `read` argument needs no prompt lesson. The `read`
description gains one sentence naming `kb://`; `chat-default.md` gains one line.
`knowledgeSpaceId` on `knowledge_search` stays a UUID argument.

### D6: Scheme before selector; `:` banned in Knowledge paths

`resolveReadTarget` recognizes `scheme://` first, then splits the trailing
selector. OMP's "existing literal path wins" fallback needs a probe the model
cannot make, so `kb://` paths reject `:` outright and the split is unambiguous.
An unimplemented `scheme://` prefix fails `invalid_path` on all three tools, the
OMP `write` rule, so a typo never creates a file named `vault:`.

### D7: Native semantics under `kb://`

No Markdown-only suffix rule and no 1 MiB rule on `kb://` read, edit, or write;
the Space is a directory of files the owner will fill with images, tables, and
recordings. `knowledge_search` keeps its Markdown-only corpus and its existing
per-space warning for an oversized or invalid-UTF-8 `.md`, which `write` can
now create; that behavior is unchanged here.

### D8: `write` creates intermediates on every scheme

One `write` contract. A scheme-dependent difference in parent-directory
behavior is the kind of thing a model cannot predict, and OMP creates parents.
The `native-file-tools` "Write creates only" requirement changes for absolute
paths too.

### D9: Listing shows every entry

`kb://<id>/` and subdirectories use the shipped two-level listing unfiltered
(`name@` for symlinks, unreadable on open). Consistent with D7; the walker is
reused through the resolved host path.

### D10: Deletion on the replacement layer

`knowledge_read` is removed in the same layer that ships `kb://` read, with the
Knowledge acceptance suite ported to `read(kb://...)`. A separate removal layer
would recreate the deprecation window the change exists to end. Boot validation
rejects an allowlisted `knowledge_read`; a bound Run's request for it fails
closed through the existing unavailable refusal; `tool-observation-part.ts`
keeps rendering historical `knowledge_read` parts.

### D11: Errors

Space segment: `knowledge_space_not_found` (absent, other-owner, malformed
identifier, all identical) and `knowledge_space_unavailable` (binding failure).
Path and file: native `FileFailure` types. One vocabulary per tool.

## Threats

- Cross-tenant read or write through a guessed or observed Space identifier →
  resolution runs under `runAs` with RLS and an explicit owner predicate on every
  call; absent and other-owner identifiers return one identical closed result;
  the locator layer ships a negative isolation test.
- Escape from the Space via `..`, absolute segments, or a symbolic link swapped
  in after validation → Knowledge path rules, per-component `lstat`, and
  `O_NOFOLLOW` at open time; a link at the target is `not_found`.
- Host path or owner identity leaking into results, attempt events, or errors →
  results carry the locator and Space identity only; the attempt event records
  the locator; binding errors map to the two closed Knowledge results.
- First model-driven mutation of owner data on hosted workers with no approval
  gate → `edit` is exact-match and `write` is create-only; the fence stops the
  Run on an unknown outcome; #133 owns a policy engine and is out of scope.
- Prompt injection from owner notes → recall-time notice on every `kb://` read
  and listing; content is not rewritten, as recorded in D4.

## Migration Plan

1. Land `native-read-directory-listing/finalize`, rebase this stack, re-diff the
   two shared `native-file-tools` MODIFIED blocks.
2. Before deploying the locator layer to Leo's instance, remove `knowledge_read`
   from `tools.allowed` in the live `llame.config.json`; boot rejects the id.
3. The `knowledge_search` schema and the native tool descriptions change, so the
   deploy follows the existing declaration cutover: quiesce Run acceptance,
   drain Runs bound to the prior declarations, deploy matching API and worker
   binaries, resume. Rollback drains Runs bound to the new declarations first.
4. No database migration. Existing `knowledge_read` observations stay as
   recorded.

## Risks / Trade-offs

- [Both this change and `native-read-directory-listing` modify the same two
  `native-file-tools` requirements] → this change's MODIFIED blocks are written
  on top of that change's delta text; `native-read-directory-listing/finalize`
  archives first, then this proposal is rebased and the blocks re-diffed
  against the main spec before implementation starts.
- [Verbatim `kb://` content weakens injection posture versus `knowledge_read`]
  → notice on every result, declarations restate the framing, spec records it.
- [A `kb://` write can create a non-Markdown or oversized file that search
  cannot see] → search already ignores non-Markdown and warns per space on an
  oversized `.md`; recorded as expected behavior, not a bug.
- [`tools.allowed` with `knowledge_read` breaks boot after deploy] → pre-launch
  rule; `docs/knowledge.md` and the changelog say to remove the entry.
- [`knowledge-submit` D2 contradicts D7] → its design is edited here; its spec
  delta already says "regular-file paths".
- [Locator UUIDs cost ~20 tokens each in search results] → accepted; #332 adds a
  slug alias through the same owner-scoped lookup later.
