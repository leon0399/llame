## Context

See [proposal.md](proposal.md) for scope and the decisions agreed with Leo.

The current path renders the system prompt in
`apps/api/src/chats/turn-context.ts`, then calls
`apps/api/src/runs/effective-context-resolver.ts` to admit and hash tool
declarations. `apps/api/src/tools/turn-tool-catalog.ts` includes description text
in both the declaration hash and the availability manifest. Workers compare
live and stored descriptions in
`apps/api/src/runs/snapshot-tool-execution.ts`. Merely rendering a new description
at acceptance would therefore make a matching executor appear incompatible.

The existing `apps/api/src/instance-config/prompt-loader.ts` already owns
Handlebars validation, compilation caching, owner-text neutralization, and
explicit context construction. Personalization toggles control the projection;
the toggles themselves are not template variables. Reuse that projection for
both surfaces, including the existing frozen digest and temporal anchor.

OMP was inspected at `f97fa5c95010b62ac34c7357f9a1cae6975e12d6` on 2026-09-12.
Its [Bash description getter](https://github.com/can1357/oh-my-pi/blob/f97fa5c95010b62ac34c7357f9a1cae6975e12d6/packages/coding-agent/src/tools/bash.ts#L688-L704)
renders a bundled Markdown file with settings-derived values and active-tool
predicates. Its [shared renderer](https://github.com/can1357/oh-my-pi/blob/f97fa5c95010b62ac34c7357f9a1cae6975e12d6/packages/utils/src/prompt.ts#L529-L546)
caches compiled templates, and its
[system context](https://github.com/can1357/oh-my-pi/blob/f97fa5c95010b62ac34c7357f9a1cae6975e12d6/packages/coding-agent/src/system-prompt.ts#L918-L937)
contains active names. OMP's tool contexts are assembled individually and the
built-in description files have no runtime override loader. llame adopts the
file/rendering pattern with its own configuration and immutable Run contract.

## Goals / Non-Goals

The implementation must produce one traceable acceptance path from admitted
candidates and owner context to the exact provider declarations and receipt.
Schemas, classification, and invocation authorization remain independently
verified. A change to rendered prose must not mutate a process-global registry
or another owner's description.

This proposal does not template MCP descriptions, parameter schemas, tool
results, or context-rail producers. It introduces no new settings namespace
containing raw configuration, partials, helper language, file watcher, or template
editor. `grep` is an illustrative future tool, not a new executor in this change.

## Decisions

### D1. Complete packaged descriptions

Package `apps/api/src/prompts/tools/<tool-id>.md` for each of the seven current
registry entries: `read`, `edit`, `write`, `bash`, `search_conversations`,
`conversation_read`, and `knowledge_search`. Load these through the API's existing
prompt-asset mechanism and include them in the production build.

Keep input schemas and their property descriptions in code. Keep the registry's
source declaration independent of operator overrides; rendered descriptions are
per-Run values. Prefer the existing loader/compiler functions over a second
templating service or a runtime plugin registry.

### D2. Per-tool file selection

For a selected model and tool, choose its entry in `models[].toolPromptFiles`,
then `tools.promptFiles`, then its packaged default. Missing keys fall through
independently; an empty map does not erase instance defaults. A selected file
replaces the entire description. There is no composition across levels.

Map keys must identify a registered llame-owned tool. Reject unknown ids, MCP
ids, and wildcard keys at boot. Resolve paths against the active config file,
normalize contents like `systemPromptFile`, and validate every configured file,
including shadowed entries and entries for currently disabled tools. An invalid
explicit override is a configuration error, never a fallback trigger. The
existing config rule treating explicit null as absence also applies here.

Reuse file-read and compiled-template caches; only immutable source/compiled
templates are process-cached. Never cache rendered text without all of its
owner, chat, model, temporal, and catalog inputs.

### D3. One context and conditional tool membership

Both template kinds use all currently allowed paths, omission rules, bounded
collections, sanitizers, and `if`/`unless`/`each` restrictions. Extend the shared
validator with `tools.<exact-id>` only as an `if`/`unless` subject. Reject direct
value output, iteration, a bare `tools` gate, deeper access, parent traversal,
and prototype traversal. Validate parsed path segments, not a joined string.

A code-owned predicate must name a registered id. An MCP predicate must name a
canonical exact id belonging to a configured server; the server need not be
online and the id need not be currently discovered. This preserves fail-loud
native typos while allowing templates for disconnected dynamic tools. Wildcards
are configuration patterns, never template identities. A valid predicate is
false when its id has no admitted declaration. Build an own-property-only
boolean projection; no registry, source record, or permission object is exposed.

`tools.<id>` says only that the accepted catalog admitted the tool. Permission
rules can reject any subsequent invocation, and an MCP disconnect can make a
bound tool unavailable later. Neither changes that Run's frozen predicate.

Boot retains the existing owner/digest empty-render probes and checks tool
predicates with none and all referenced tools present. For a description's
probes, its own tool is always present because only admitted tools are rendered.
These probes are diagnostics, not proof over every possible catalog. Actual
Run acceptance must reject any empty system prompt or admitted description
before persistence/provider I/O; it must not drop the tool and silently choose
a different branch. This avoids an exponential boot probe or a rendering loop.

### D4. Acceptance ordering

1. Resolve the already-frozen owner, digest, model, and temporal inputs and take
   the existing process-local dynamic-candidate snapshot.
2. Apply existing exact identity, allowlist, classification, native-capability,
   collision, timeout, and input-schema admission checks. This determines the
   tool-membership set independently of rendered text.
3. Build one safe template context with that membership. Render the complete
   system prompt and each admitted llame-owned description once. MCP descriptions
   remain opaque admitted server text, even if they contain Handlebars syntax.
4. Validate final strings and construct the exact model-facing declarations.
   Recompute declaration hashes and available-entry hashes from those final
   descriptions; never retain hashes of the provisional source descriptions.
5. Compute snapshot hashes and commit the user message, reminders, snapshot
   binding, and Run in the existing owner transaction.

An unavailable or invalid source remains governed by existing admission rules.
A failure rendering an admitted template rejects acceptance with a safe error;
the entire candidate set is discarded. There is no render/remove/rerender cycle
that could make earlier cross-tool guidance false. No network discovery or
prompt-file read occurs inside the transaction.

### D5. Source contract and rendered declaration

Add a private, canonical `toolSourceDeclarationHashes` map to new snapshots.
Its keys are exactly the admitted code-owned ids. For each, hash the canonical
source declaration consisting of its id, normalized packaged description
template, and canonical input schema. Use the existing declaration hash
algorithm over that source declaration. Model and instance overrides, owner
values, and rendering results never enter the source declaration.

The worker resolves the exact registry id, retains existing classification,
schema-dialect, native-capability, and permission checks, and compares its source
declaration hash with the stored one. It also requires the stored model-facing
id and input schema to equal that source declaration's id/schema. The provider
receives the stored rendered description. No worker rebuilds it from its own
settings or replaces its schema. Missing, malformed, incomplete, or extra source
bindings fail before a provider request.

MCP bindings continue to compare the complete admitted declaration hash,
including the server's description. A description change on an MCP server still
selects the existing unavailable-executor behavior.

`toolHash` covers exact rendered declarations. `availabilityHash` covers the
final manifest, whose available entries hash those same declarations.
`contentHash` additionally covers the source-binding map, and snapshot equality
checks it, so identical rendered text from different source contracts cannot
reuse an incompatible snapshot. The map remains private and is not appended to
provider schemas or public catalog/receipt DTOs. The receipt continues to show
the exact prompt and descriptions through existing fields.

This deliberately preserves failure on packaged template/source-schema drift,
including a changed conditional branch that happens to render identically.
Operator template edits affect newly accepted Runs after reload and cannot
invalidate old source bindings. Simply ignoring description equality would
discard the current packaged-contract drift check; re-rendering in the worker
would violate the accepted Run's identity. A generic executor-version system is
unnecessary for this change.

### D6. Guidance and pending work

Use `tools.edit` around Bash's recommendation to prefer native edit, and
`tools.conversation_read` around search's recommendation to call that reader.
When a reader is absent, retain the statement that search excerpts are bounded
and untrusted; do not imply that absent context was verified. Apply the same
rule to other existing description recommendations identified during migration.
Execution-result notices retain their own existing contracts.

The active `tool-search` proposal will later distinguish admitted from initially
declared tools. Its deferred tools would remain members of the accepted catalog;
loading is a different concern. This proposal supplies no per-step flag. If
tool-search lands first, reconcile its admission/budget partition with D4 before
implementation: a description-sized budget and tool-dependent descriptions can
otherwise form a cycle. Do not silently redefine this predicate as a permission
or step-activation test. System-provided skills similarly remain a separate
context producer; this change exposes no new skills collection.

## Risks / Trade-offs

- R1: Shared mutable rendering could leak owner text. Construct a per-Run context,
  preserve RLS, and test two concurrent owners using the same model/templates.
- R2: A source-binding omission could weaken executor checks. Reject malformed
  maps and schema drift, and test native and MCP mismatches independently.
- R3: Boot probes cannot cover every conditional combination. Reject empty real
  renders atomically and test a mixed-tool combination that passes boot probes.
- R4: Operators can repeat large digest or personalization text across many
  descriptions. Document the token cost; packaged descriptions reference only
  the values their guidance needs.
- R5: Tool-description hashes can change with catalog or owner context. Preserve
  the existing rule that declaration-only drift changes hashes without emitting
  an availability transition. Editing operator prompt files requires restart.

## Migration Plan

Add the private map as a nullable snapshot column for historical rows; all new
Run snapshots require a map, including `{}` when no code-owned tool is admitted.
Do not fabricate historical source hashes. Historical receipts remain readable;
new workers refuse execution from a snapshot lacking the required binding data.

Quiesce Run acceptance, drain queued and active Runs, apply the generated
migration, deploy matching API/worker artifacts with the packaged files, then
resume. An unexpected pre-change queued Run fails closed. Rollback first drains
new Runs and restores matching binaries; the additive historical column can
remain. Do not reset Leo's database or delete chats.

## Revision history

- v1 (2026-09-12): Initial draft after the three scope decisions; separated
  packaged source compatibility from rendered descriptions and fixed acceptance
  ordering around a shared catalog projection.
