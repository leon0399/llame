## Why

Owner forks currently copy message rows but lose compaction state and the context baselines and receipt links that make those messages a continuation. [#154](https://github.com/leon0399/llame/issues/154) should preserve the owner's selected history without rebuilding checkpoints, changing its model-facing prefix, or depending on the source chat's continued existence.

## What Changes

- D1: Copy the selected message prefix, applicable compaction lineage and exact replacement history, historical execution evidence, and the continuation state needed by ordinary next-turn preparation.
- D2: Create an independent private Chat whose inherited evidence remains inspectable after source deletion; distinguish inherited usage from execution performed in the fork.
- D3: Preserve model/tool comparison baselines and frozen context baselines. Fork creation emits no model-facing notice and creates no fresh disclosure epoch.
- D4: Require the same inherited model-facing prefix as ordinary continuation at the selected boundary under identical continuation inputs and runtime versions. Do not change reasoning replay, provider serialization, or provider cache configuration.
- D5: Keep forks user-managed and idle until a future user action. Retain inclusive historical anchors on user and assistant messages; no subagent role, task assignment, or automatic inference is introduced.
- D6: **BREAKING:** Whole-chat forks stop at the last completed turn, excluding the unfinished Run's input and output. Explicit anchors on unfinished Runs return a conflict instead of copying partial execution or silently moving the anchor.
- D7: Keep the separate `compactions` table. Shared/public forks remain text-only and receive no private compaction, continuation, or receipt state.

The unified-compaction-history evaluation is deferred to [#806](https://github.com/leon0399/llame/issues/806), not a prerequisite. General assistant replay research [#599](https://github.com/leon0399/llame/issues/599) and message-revision/branching design [#611](https://github.com/leon0399/llame/issues/611) remain separate.

## Capabilities

### New Capabilities

- `owner-chat-forks`: Atomic owner-only prefix selection, complete inherited state, independent historical inspection, continuation fidelity, and unchanged shared-fork disclosure.

### Modified Capabilities

- `temporal-anchor`: Preserve the inherited context origin independently of the newly created Chat's timestamp.
- `chat-recency-digest`: Preserve boundary-specific baseline, told-set, and re-bake state without treating a fork as a first disclosure.
- `durable-runs`: Distinguish copied historical user messages from new execution submissions; a fork creates no executable Run.

## Impact

API Chat/message copying, compaction persistence, accepted-turn context preparation, previous-turn resolution, owner receipt lookup, and owner transcript metadata/actions. Persistence changes require generated migrations and API/worker revision coordination; API changes require regenerated OpenAPI and web client artifacts. Existing search reindex and embedding dispatch remain post-commit projections rather than sources of fork history.

Threats are cross-owner reads or references, copying private evidence through a public route, admitting state from beyond the selected boundary, and treating inherited receipts or native-effect records as executable authority. Forced RLS, owner-constrained references, explicit response allowlists, and negative datastore/API tests are required. No production chat reset, guessed historical backfill, or new dependency is authorized.
