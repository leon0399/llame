## Why

llame has no reusable operator-provided workflow catalog. Issue [#770](https://github.com/leon0399/llame/issues/770) adds standard skill packages so agents can select relevant procedures proactively or users can request several explicitly, without loading every instruction into context.

## What Changes

Delivered as five implementation layers, each independently reviewable and each leaving the product working end to end:

- catalog: Configure directories containing skill directories; later sources override earlier sources by name. Only operator-managed sources participate. Validate packages, resolve invocation controls, and expose the catalog to authenticated owners through `GET /api/v1/skills`. No model-facing behavior yet.
- read: Load current instructions and references through read-only `skill://` locators in the native `read` tool. Expose real package/file paths so existing Bash can run bundled scripts without URI rewriting or implicit working-directory changes.
- prompt: Advertise proactively eligible skills through a `skills` Handlebars namespace: `{{#if skills}}` gates the section and `{{#each skills.entries}}` lists name and description. The packaged default prompt carries the block; an operator template opts in by referencing the namespace. The advertised set is a frozen per-epoch baseline stored on the chat, re-resolved at the next accepted turn after compaction, bounded, with omitted entries counted.
- activation: Recognize `$skill-name` mentions in user text, load each selected skill before the first model request through the common read admission path, and persist one `skill-activation` context item per selection carrying the skill directory, resolved file, relative-path guidance, and the current instructions. Manual-only skills load only this way.
- notices: On each later user turn, compare the current proactively eligible set with the set the chat was last told and append one `skill-catalog` notice listing added entries with descriptions and removed names. An overflowing delta is replaced by a bounded snapshot that supersedes earlier notices. Compaction starts a fresh baseline.

Across every layer: check current availability at each read; preserve historical observations without pinning future reads. Removal prevents new skill loads, not ordinary permitted access to surviving files.

Deferred to a follow-up change: notices for a changed description or changed instruction content of an entry that stays advertised, and for a change in the omitted count while the advertised set is unchanged. Reads are live, so the next load returns current content; only the reminder to reload, or to consult `skill://` for newly omitted entries, is missing. MCP-provided skills (#772), personal/workspace discovery, marketplaces, script runtimes, and active-Run model steering (#782) are outside this change.

## Capabilities

### New Capabilities

- `agent-skills`: Operator catalog discovery, invocation controls, explicit activation, script addressing, live reads, and provenance.

### Modified Capabilities

- `instance-config`: Operator skill source directories with an empty default.
- `native-file-tools`: Read-only skill locators and model-visible package paths.
- `model-system-prompts`: The `skills` prompt projection namespace (gate, bounded collection, scalar metadata, boot probe), and explicitly permitted published skill paths in owner receipts.
- `context-injection`: `skill-activation` and `skill-catalog` producers, ordered on the existing rail, with the frozen catalog baseline classified as prefix-resident state.

## Impact

API instance configuration, native read dispatch/classification, prompt template validation and projection, user-turn preparation, chat-row baseline columns, context receipts, and owner-visible context/tool results. Reuse the current Bash executor and permission admission contract; coordinate with #763 without editing its implementation in this proposal.

Global skill packages are operator-trusted and intentionally publish their paths and content to authenticated owners. Knowledge backing paths and owner data remain protected. Scripts retain the executor's ordinary authority; skills do not create an isolation boundary or automatic tool grants.
