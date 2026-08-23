## Context

The shipped capability gives each authenticated owner one stable Knowledge Space whose live Markdown files are read from a trusted stable-ID child below `knowledge.root`. Tools resolve that sole row from trusted Run-owner context; PostgreSQL stores ownership and receipts but not Knowledge content. This is safe and useful, but one implicit space cannot preserve deliberate boundaries between vaults, cannot represent same-named resources independently, and is the wrong shape for future personal-node synchronization.

Issue #542 is the immediate multi-space layer under tracker #39. It depends on the shipped filesystem capability from #213 and blocks later import/synchronization work in #547. Indexing, embeddings, and semantic search are separate later capabilities. The local filesystem remains live and authoritative, including uncommitted edits.

The critical tension is between user control and deterministic execution. Resolving “all spaces I own now” at tool execution would silently widen an accepted Run whenever inventory changes. Freezing access forever at acceptance would ignore later detachment or revocation. The design therefore treats the accepted snapshot as an immutable upper bound and reapplies current authorization before each operation.

## Goals / Non-Goals

**Goals:**

- Give each owner a bounded inventory of independently identified, non-uniquely named Knowledge Spaces.
- Let an owner explicitly select an ordered set for each Chat, including an intentional empty set.
- Persist a deterministic Knowledge binding upper bound with every accepted Run and expose a safe owner/model receipt.
- Keep runtime access fail-closed when a selected space is detached or no longer owned.
- Search one selected space or the complete Run-bound set under one global budget, and make reads unambiguous.
- Preserve the existing stable identifier and filesystem child for every migrated owner.
- Provide the minimum web management and per-Chat selection surface required for ordinary use.
- Preserve the personal-node boundary: portable logical IDs, authority-local ownership and mounts.

**Non-Goals:**

- File browsing, upload, editing, deletion, import, synchronization, or conflict resolution.
- Space sharing, group ownership, public access, or cross-owner selection.
- Indexed, trigram, normalized, embedding, or semantic retrieval.
- User- or model-controlled host paths, mount roots, source keys, or filesystem discovery.
- A permanent content snapshot or guarantee that a live path/hash remains stable.
- Knowledge Space deletion; detachment is reversible, while canonical-file deletion needs a separate recovery contract.

## Decisions

### D1: Stable UUID identity, untrusted non-unique names, and a hard inventory cap

Each owner may hold at most 32 spaces. IDs remain trusted-code-generated UUIDs and are the only identity used by authorization, persistence, mounts, and tool selection. Names are trimmed 1-100-code-point labels, may collide, and reject invisible/control classes that would make model-visible or UI-visible disambiguation unsafe. Concurrent creation serializes on owner state before enforcing the cap.

The fixed cap bounds Chat settings, Run receipts, relational snapshots, prompt disclosure, and all-space search fan-out. Treating names as unique would create false identity and make local-node imports silently merge distinct resources.

### D2: Add collection APIs and retain the singular endpoint as compatibility

The owner API adds list, create, rename, and idempotent ensure operations. Creation accepts only a name and allocates an ID in trusted code. Ensure accepts an existing owned ID only to repair its derived child; absent and other-owner IDs are indistinguishable. The old bodyless singular `PUT` returns/ensures the oldest owner space and creates `Personal` only when inventory is empty.

The database row is the recovery anchor. If derived-child creation fails after row commit, the row remains visible and a later ensure repairs the exact same child. Compensating deletion would destroy stable identity and make retry races worse.

### D3: Chat binding is an ordered, revisioned set—not dynamic all

`PATCH /api/v1/chats/:id` accepts an optional `knowledgeSpaceIds` replacement with at most 32 unique IDs. Replacement validates every ID under one owner-scoped transaction and is all-or-nothing. The Chat stores an explicit monotonically increasing binding revision so zero rows can mean either uninitialized or intentionally empty.

At the first accepted Run for an uninitialized Chat, the transaction binds all then-current owner spaces in creation order if inventory is non-empty. Once initialized, new spaces are not auto-attached. This gives existing Chats a usable default without allowing later inventory changes to widen them silently. Chat forks copy the ordered set into their own binding state; later edits are independent.

### D4: Accepted Runs persist an immutable relational upper bound

The accepted-turn transaction persists the Chat revision plus ordered `(knowledge_space_id, display_name)` rows with the user message, context snapshot, Run, and `run.created`. Empty snapshots retain their revision on the Run. Owner-scoped keys, composite ownership constraints, RLS, and FORCE RLS protect Chat and Run binding tables; application queries keep explicit owner predicates.

The accepted snapshot is immutable but not an irrevocable grant. Runtime access is:

`run snapshot ∩ current Chat binding ∩ current active owner inventory`

Later attachments cannot widen an old Run. Detachment or loss of ownership revokes access before the next filesystem operation, including retry and handoff. Acceptance-time names remain in the receipt and tool attribution so later renames do not rewrite history. A trusted Run identifier is added to tool execution context; model arguments never carry authority.

### D5: Search can fan out; read must resolve one space

`knowledge_search` adds an optional `knowledgeSpaceId`. When omitted, it traverses the complete current authorized intersection in persisted Chat order, then relative-path order. All existing entry, file, byte, timeout, result, path, and output limits are shared across the whole call. Any inaccessible target or exceeded bound fails the entire call without partial matches.

`knowledge_read` also adds an optional selector. Omission remains compatible only when exactly one space is currently authorized; multiple spaces return `knowledge_space_selection_required` without probing a file. Guessed, detached, absent, and other-owner IDs share `knowledge_space_not_found` to prevent an existence oracle.

Tool successes and empty searches include stable IDs and acceptance-time names. The browser renders both name and ID with the relative path because names may collide. No content index is introduced; every call reads the live filesystem and hashes the exact bytes observed.

### D6: Minimal web UX ships with the capability

The web app provides authenticated inventory list/create/rename controls and a current-Chat multi-select. It uses the generated API client and exposes no root or directory input. Selection is explicit save/replace, shows duplicate names with stable-ID disambiguation, and permits an intentional empty set. It does not become a file manager.

An API-only implementation would satisfy storage mechanics but fail the product intent: ordinary users could neither create a second logical space nor control which context a Chat receives without browser-console calls.

### D7: Filesystem binding stays authority-local and unchanged

Every space maps to the direct `knowledge.root/<stable-id>` child. Names never affect paths. All API and worker processes serving the same queue still require a compatible view of the configured root. Personal nodes may use different local ownership rows and mount roots while retaining the same logical IDs. Synchronization and cross-authority collisions remain #547 work.

### D8: Implementation is a linear, independently green PR stack

The proposal is the first layer. Implementation then follows this `gh-stack` topology:

`master <- multiple-kb/proposal <- multiple-kb/storage <- multiple-kb/bindings <- multiple-kb/tools <- multiple-kb/product`

The storage layer owns inventory schema, migration, provisioning, and owner APIs. The bindings layer owns Chat selection, Run snapshots, transactional acceptance, and trusted runtime context. The tools layer owns multi-space resolution, search/read contracts, and persisted attribution. The product layer owns generated-client consumption, ordinary-user management/selection UI, browser acceptance, documentation, roadmap, and changelog. Each layer SHALL pass its affected checks before `gh stack submit`; fixes land in the owning layer followed by `gh stack rebase --upstack`, never as unrelated repairs at the tip.

## Risks / Trade-offs

- **Revocation weakens byte-for-byte retry determinism:** an accepted Run may lose access before retry. This is intentional; current authorization outranks replaying a stale grant. The immutable receipt still records the original upper bound and the closed outcome.
- **All-space scan cost scales with selected spaces:** the fixed inventory cap and single global operation budget prevent per-space multiplication. Large corpora still need the later indexed-KB tracker.
- **Row/filesystem creation is not atomic:** retaining the row creates a visible temporarily unavailable space. An idempotent ensure path makes repair explicit without minting identity.
- **Same-name UI ambiguity:** every selection and citation pairs the label with a stable-ID discriminator. Enforcing unique names would merely push collision handling into import/synchronization.
- **Chat detachment is not space deletion:** files and inventory rows remain. This avoids irreversible canonical-content semantics in a selection feature but leaves lifecycle cleanup for a separate proposal.
- **Trusted-writer filesystem assumption remains:** stable-ID containment and final-file no-follow defenses do not support tenant-writable or synchronization-managed mounts with hostile concurrent writers. That threat-model expansion still requires descriptor-relative containment.

## Migration Plan

1. Add display name and creation ordering to `knowledge_spaces`; backfill every existing row as `Personal`; remove the one-owner unique constraint while retaining its identifier and child directory.
2. Add owner-scoped Chat binding state, Run binding state, composite constraints, RLS/FORCE-RLS policies, and negative integration tests before exposing writers.
3. Deploy additive inventory and Chat APIs plus the generated client. Keep the singular compatibility endpoint operational throughout.
4. Cut accepted-turn authoring over to atomic Chat initialization and Run snapshots only after compatible workers can consume the new trusted context. Quiesce old API writers and drain accepted Runs at the coordinated schema/writer boundary described by the repository rollout contract.
5. Deploy multi-space tools and web controls, then verify migration, concurrent caps, duplicate names, cross-tenant denial, explicit-empty Chats, retry/handoff, late attach, live detach, and browser citations.
6. Roll back application code only while preserving additive columns/tables and migrated identifiers. Do not restore the one-owner unique constraint after multiple rows exist. A forward repair may disable new selection while retaining data; it must never remap stable IDs or delete filesystem children.
