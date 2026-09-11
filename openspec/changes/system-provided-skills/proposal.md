## Why

llame has no reusable operator-provided workflow catalog. Issue [#770](https://github.com/leon0399/llame/issues/770) adds standard skill packages so agents can select relevant procedures proactively or users can request several explicitly, without loading every instruction into context.

## What Changes

- D1: Configure directories containing skill directories; later sources override earlier sources by name. Only operator-managed sources participate.
- D2: Advertise bounded skill metadata in a frozen system-prompt baseline. Announce catalog changes on the next user turn through existing system reminders; refresh the baseline while preparing the next user turn after compaction, leaving an already-bound Run unchanged.
- D3: Load current instructions and references through read-only `skill://` locators. Expose real package/file paths so existing Bash can run bundled scripts without URI rewriting or implicit working-directory changes.
- D4: Support explicit `$skill-name` references and proactive multi-skill use. Honor existing manual-only invocation controls without granting permissions.
- D5: Check current availability at invocation; preserve historical observations without pinning future reads. Removal prevents new skill loads, not ordinary permitted access to surviving files.

MCP-provided skills (#772), personal/workspace discovery, marketplaces, script runtimes, and active-Run model steering (#782) are outside this change.

## Capabilities

### New Capabilities

- `agent-skills`: Operator catalog discovery, invocation controls, explicit activation, script addressing, live reads, and provenance.

### Modified Capabilities

- `instance-config`: Operator skill source directories with an empty default.
- `native-file-tools`: Read-only skill locators and model-visible package paths.
- `context-injection`: Skill catalog and explicit-activation producers, ordered on the existing rail.
- `model-system-prompts`: Explicitly permit published skill paths in owner receipts while preserving private configuration boundaries.

## Impact

API instance configuration, native read dispatch/classification, user-turn preparation, prompt composition, context receipts, and owner-visible context/tool results. Reuse the current Bash executor and permission admission contract; coordinate with #763 without editing its implementation in this proposal.

Global skill packages are operator-trusted and intentionally publish their paths and content to authenticated owners. Knowledge backing paths and owner data remain protected. Scripts retain the executor's ordinary authority; skills do not create an isolation boundary or automatic tool grants.
