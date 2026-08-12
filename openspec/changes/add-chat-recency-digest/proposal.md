## Why

Retrieval-only recall systematically under-fires. `search_conversations` requires the model to _decide_ to call it, and a model that does not know a relevant chat exists has no reason to look. That is the honest weakness of the shipped `chat-search` design, and it cannot be fixed inside the tool — the tool is never invoked.

A bounded, owner-scoped digest of the owner's recent and pinned chats, rendered into the system prompt on a chat's first run and frozen for that chat, restores the missing signal: the assistant knows what the owner has been working on and can decide, unprompted, that a prior chat is worth retrieving. Every comparable product injects something equivalent; the prior art and the argument for each design choice are recorded in [`docs/research/long-term-memory/2026-08-12-recency-digest-prior-art.md`](../../../docs/research/long-term-memory/2026-08-12-recency-digest-prior-art.md).

The cost this design refuses to pay is the one ChatGPT pays: re-rendering a ~40-conversation dump on every turn, unframed, in a position that forfeits prefix caching for the whole history and mints a full prompt copy per turn in an append-only table. Freezing the digest per chat removes all three costs — the prompt stays byte-identical across a chat's turns, one snapshot row is minted per chat, and the only cache boundary is the first turn of each new chat.

## What Changes

- **A new owner-scoped recency digest** is rendered into the system prompt: up to 10 pinned and 10 recent chats, each as title, last-activity date, message count, and a **200-character excerpt of that chat's first user message**. Chat identifiers are deliberately omitted: no shipped tool consumes one, so ~18-20 tokens per entry would be frozen into every prompt for nothing. Pinned renders above recent; the two sets are disjoint, and recent backfills so it always carries 10 distinct unpinned chats when the owner has them. The block states two ratios — pinned shown/total pinned and recent shown/total eligible — so the model can tell a near-complete digest from a thin slice of a deep corpus.
- **The digest is resolved once on the chat's first run and frozen** as a stored baseline on the chat, re-rendered byte-identically on every subsequent run. It is **re-resolved only at compaction**. A model switch re-renders the same frozen baseline through the new model's template; it does not refresh the chat list.
- **Changes after the baseline arrive as appended `<system-reminder>` deltas** on the message rail, derived by diffing a per-chat **told-set** against the owner's currently eligible chats. There is one event — a chat entered the told-set, or its pin state changed — and the diff is asymmetric, so departures produce nothing and displacement, archival, and deletion need no rule of their own. Timestamps cannot be used: nothing records when a title landed, and unpinning is a hard row delete.
- **A new `memory` settings surface** at `/api/v1/me/memory` carries a `shareRecentChats` toggle, **defaulting to false**. It is a separate axis from `personalization`: `personalization.enabled` means "use my authored profile", and withdrawing chat-history features because an owner cleared their bio would be an invisible capability regression.
- **Prompt templates gain bounded iteration.** `model-system-prompts` currently permits only `if`/`unless` over scalar leaves. The digest requires an `each` block over an allowlisted collection with allowlisted per-item fields. This is the deny-by-default validator's first collection, and it is scoped so partials, helpers, and arbitrary paths remain rejected.
- **Digest context is a new top-level `chats` namespace**, not `user.chats`. Nesting under `user` would make `{{#if user}}` truthy for an owner with chats but no personalization, which breaks a shipped `personalization` scenario (_"Owner has no per-user context"_) by rendering that block's framing prose around nothing.
- **The compaction summarization exclusion is extended to the digest's delimiter.** `model-system-prompts` already requires the summarization instruction to name the personalization block's delimiter and forbid carrying its content into the checkpoint; the digest gets the same treatment via the same mechanism.
- **Three disclosures become normative**: enabling the toggle is retroactive over the whole existing corpus, turning it off is not retroactive, and deleting a chat does not remove its title or excerpt from other chats' already-bound prompts and histories.

## Capabilities

### New Capabilities

- `chat-recency-digest`: the digest itself — what it contains, its caps and exclusions, the frozen-baseline lifecycle and its compaction re-bake, the appended delta event log, the framing and escaping contract, owner scoping and public-path absence, and the three consent disclosures — retroactive enablement, non-retroactive disablement, and non-erasing deletion.
- `memory`: the owner-scoped assistant-memory settings surface — the `shareRecentChats` toggle, its datastore-enforced owner isolation, its `/api/v1/me/memory` API contract, and its deliberate separation from `personalization`. Scoped to one setting; the master history-sharing gate (#326) and the `recent_chats` tool gate (#327) extend this capability later.

### Modified Capabilities

- `model-system-prompts`: adds bounded `each` iteration and the top-level `chats` render context to the prompt-template contract; extends the compaction summarization exclusion to name the digest delimiter; states that a run's rendered prompt may now derive from stored per-chat state rather than only from per-run owner state.

`personalization` is deliberately **not** modified. The digest's context lives outside `user`, and its toggle lives on a separate settings surface, so every existing personalization requirement and scenario holds unchanged.

## Impact

**Schema** — two new per-chat state fields on `chats` (the frozen rendered baseline, and the growing told-set of announced chat ids with their last-told pin state); a new owner-scoped settings table (or new columns on the existing per-user settings row) for `shareRecentChats`, with RLS `ENABLE`d **and** `FORCE`d and an owner policy, plus cross-tenant and public-identity negative tests.

**API** — `apps/api/src/instance-config/prompt-loader.ts` (`PROMPT_CONTEXT_PATHS`, `ALLOWED_BLOCK_HELPERS`, `assertPath`, `assertStatements`, the render context projection); `apps/api/src/prompts/chat-default.md`; `apps/api/src/chats/chat-loop.service.ts` (baseline resolve on first run, delta authoring); a new server-owned renderer beside `chats/model-context-part.ts`; `apps/api/src/chats/context-builder.ts` (delta rendering in the existing reminder slot); `apps/api/src/compaction/compaction.ts` (instruction exclusion) and `compaction.service.ts` (baseline re-resolve); a new `memory` module with DTO, response type, and OpenAPI entry.

**Reads** — `ChatsRepository.findByOwner` supplies both lists through its existing `pinned: 'only' | 'exclude'` modes, which are already disjoint and ordered `updated_at DESC`; no parallel query path is introduced. It gains a limit.

**Web** — none required by this change. The settings toggle ships as a **deliberate stacked follow-up** after implementation, not as an omission: until it lands the capability is reachable only by calling the API directly, which is accepted because the setting defaults off and no owner's behavior changes on merge.

**Docs** — `apps/api/AGENTS.md` (prompt-template contract, the new context namespace, the digest lifecycle), `README.md`, `CHANGELOG.md`, and `ROADMAP.md`.

**Related issues** — #331 (chat-scoped search) is where chat identifiers become useful and is the reason they are omitted here; #332 explores slugs that would make an identifier affordable; #333 (projects inside chats) is why project names are not annotated yet; #334 (temporal anchor) supersedes the interim compilation-date line this change ships. Implements #307 (whose Scope, Boundaries, and Acceptance sections contradict this design and must be rewritten: the system-prompt rail, message excerpts, and the eval gate are all reversed). #326 adds the master gate above `shareRecentChats`; #327 adds the `recent_chats` tool behind both; #328 will replace the pinned list's `updated_at DESC` ordering with the owner's explicit order.

**Deliberately out of scope** — no eval gate, no embeddings or semantic ranking, no inferred memory, no assistant-response content in the digest, no change to `search_conversations`, and no operator-facing customization surface beyond the ordinary prompt-file template.
