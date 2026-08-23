## Context

The shipped capability resolves one owner row to one trusted `knowledge.root/<stable-id>` child and reads live Markdown, including uncommitted changes. PostgreSQL stores authority and tool observations, not Knowledge content. Multiple vaults require multiple logical identities, but they do not require Chat-specific bindings or frozen Run membership: the content is already intentionally live, and current authorization must win for long-running Runs.

Issue #542 is the immediate multi-space layer under tracker #39. It depends on shipped #213 and blocks replica/import work in #547. User-facing population, agent writes, indexing, semantic search, removal lifecycle, and availability reminders remain separate work.

## Goals / Non-Goals

**Goals:**

- Let one owner hold any number of independently identified, non-uniquely named Knowledge Spaces.
- Expose a small breaking REST API for create, paginated list, retrieve, and rename.
- Resolve current owner access at each search/read call so additions appear and revocations take effect without Run state.
- Search one current space or all current spaces under the existing global safety budgets.
- Preserve useful matches when independent spaces fail while marking the call incomplete.
- Require reads to select one stable ID and persist exact response-time attribution.
- Preserve existing stable IDs and filesystem children during migration and future personal-node movement.

**Non-Goals:**

- Chat bindings, owner defaults, ordered selections, or Run-level Knowledge snapshots/receipts.
- Web management, upload, file browsing/editing, user-selected host directories, or import.
- Space archive, deletion, file deletion, orphan cleanup, or other lifecycle management.
- Indexed, trigram, normalized, embedding, or semantic retrieval.
- Shared ownership, public access, synchronization, replica conflict resolution, or automatic mounting.
- A generic cursor framework or a generic third tool-result status.

## Decisions

### D1: Stable IDs are authority; duplicate names are labels

`knowledge_spaces` loses owner uniqueness and gains `name`, `created_at`, and `updated_at`. There is no per-owner count cap. Trusted code generates each UUID. Names are trimmed, contain 1-100 Unicode code points, reject control, format, line-separator, and paragraph-separator characters, and may collide. The migrated singleton keeps its ID and child and receives `Personal`.

IDs alone drive ownership checks, filesystem children, tool selectors, cursors, and portable references. Names are untrusted response-time metadata.

### D2: Replace the singleton endpoint with minimal REST resources

The old bodyless `PUT /api/v1/me/knowledge-space` is removed. The replacement is:

- `POST /api/v1/knowledge-spaces` with `{name}` -> `201` plus `Location`;
- `GET /api/v1/knowledge-spaces?limit=&after=` -> `{items,nextCursor}`;
- `GET /api/v1/knowledge-spaces/:id`;
- `PATCH /api/v1/knowledge-spaces/:id` with `{name}`.

There is no `PUT` or `DELETE`. Authentication supplies owner identity. Missing and other-owner item IDs produce the same `404`. Resource representations contain only `{id,name,createdAt,updatedAt}`.

The list uses deterministic `(created_at, knowledge_space_id)` keyset ordering. `after` is a validated base64url encoding of those two values; it is not signed, encrypted, version-framework-backed, or shared outside this capability. `limit` defaults to 50 and accepts 1-100. RLS plus an explicit owner predicate is the data boundary. Malformed cursors and out-of-range limits return `400`. Page size is bounded, but total inventory is not.

### D3: Filesystem first, authority row second

Creation resolves the configured root, generates a UUID, and creates the exact stable-ID child before inserting the owner row in a PostgreSQL transaction. A committed row therefore begins with a usable child. If database insertion or commit fails, the empty unlinked directory may remain. It grants no authority and error recovery never deletes it.

Root or child failures map to the existing safe `503 knowledge_space_unavailable` API response. Database insertion or commit failures use the API's existing safe internal-error response. Neither path exposes filesystem or database diagnostics. Validation remains `400`, missing/other-owner items remain the same `404`, and missing authentication remains `401`.

`POST` remains non-idempotent. A lost success followed by retry may create another distinct space; idempotency-key infrastructure and cleanup belong to later work.

### D4: Tool eligibility is independent from resource availability

Allowlisting and process configuration decide whether `knowledge_search` and `knowledge_read` are advertised. Owner inventory does not. With a configured root and permitted declarations, an owner with zero spaces still receives callable tools; an unscoped search returns `knowledge_space_not_configured`, while an explicit guessed selector remains `knowledge_space_not_found`.

This removes the owner-row lookup from accepted-turn candidate resolution. A missing `knowledge.root` still makes the tools unavailable because no worker-local binding can execute safely.

### D5: Every tool call resolves current authorization

There are no Chat or Run Knowledge bindings. At each invocation, trusted context supplies the authenticated owner. Search without a selector iterates current owner rows in bounded keyset pages rather than materializing the uncapped inventory; explicit search/read validates the supplied stable ID under current RLS ownership. Inventory paging has no separate total-space cap but remains subject to the operation timeout and cancellation signal. An added space can appear in a later call within the same Run. Removed access rejects the next call even when an earlier call succeeded.

Authorization is checked immediately before opening each targeted space. Revocation after that check does not cancel an already-open filesystem operation; the next target or call observes it. Guessed, absent, removed, and other-owner explicit IDs share `knowledge_space_not_found`.

### D6: Search fans out under one budget; read is always explicit

`knowledge_search` adds optional `knowledgeSpaceId`. Omission searches current owner spaces in `(created_at,id)` order, with relative paths ordered inside each space. Entry, file, byte, timeout, result, path, and output limits are shared across the whole call; space boundaries never reset them.

Failures scoped to one space—unavailable binding, unsafe path/symlink, or invalid content—allow other spaces to finish. The result remains `status: success` but carries `complete:false`, top-level per-space warning objects, and `warningCount`. Warnings are diagnostics for the call, never properties of valid matches. The warning array is bounded; `warningCount > warnings.length` discloses omitted warning detail. If every space fails, or a global limit, timeout, or cancellation occurs, the call returns a top-level error and no partial matches.

The closed per-space warning types are `knowledge_space_unavailable`, `knowledge_path_invalid`, and `knowledge_content_invalid`. They preserve the existing safe error vocabulary without carrying raw filesystem diagnostics.

`knowledge_read` requires both `knowledgeSpaceId` and one admitted relative Markdown path even when the owner has one space. It never probes multiple spaces to resolve ambiguity.

### D7: Attribution is live and history is immutable

Search matches and reads include call-time space ID/name, exact relative path, and SHA-256 hash of the exact bytes used. Empty search need not enumerate an uncapped inventory. Later rename, file changes, or ownership changes never rewrite persisted tool results.

The model discovers IDs through search results in this iteration. A later context-reminder issue will disclose bounded inventory changes; #542 adds no list tool or prompt inventory.

### D8: Preserve incomplete honesty with one compacted marker

The global tool execution union stays `success | error`; #542 does not introduce `status: partial`. A successful search with `complete:false` is immediately usable and persists its bounded warnings normally. Whenever later model projection clears payload detail—during ordinary bounded next-turn projection or compaction—its projected outcome is `incomplete`, not `success`, so replay cannot silently upgrade degraded work. A follow-up issue will standardize incomplete tool results across execution, replay, truncation, and UI.

### D9: Ship as four implementation layers plus a finalization PR

The stack is:

`master <- multiple-kb/proposal <- multiple-kb/storage <- multiple-kb/tools <- multiple-kb/replay <- multiple-kb/acceptance <- multiple-kb/finalize`

Storage owns schema, migration, directory-first creation, REST resources, and the local cursor. Tools owns availability cleanup, live resolution, multi-space search/read, warnings, and persisted response-time attribution. Replay owns only the generic run/observation mapping that preserves incomplete Knowledge results through compaction and replay. Acceptance owns generated clients, end-to-end API/tool coverage, documentation, roadmap, and changelog. There is no web product layer.

Finalization is its own reviewable PR after acceptance. It applies the verified delta to canonical specs with `openspec-sync-specs`, marks completed tasks from implementation evidence, then moves the change to the dated archive with `openspec-archive-change`. It owns no implementation behavior.

## Risks / Trade-offs

- **Dynamic membership weakens retry determinism:** retries can see different spaces, just as existing live reads can see different bytes. Response-time attribution remains honest.
- **No count cap permits large inventories:** REST pagination and keyset-paged tool enumeration bound memory while the global timeout and cancellation bound each search call. Capacity quotas require operational evidence before becoming product contract.
- **One broken space yields incomplete success:** `complete:false`, bounded warnings, and the compacted `incomplete` outcome prevent false completeness.
- **Directory-first creation leaves orphans:** unlinked random-ID empty directories are inert. Automatic deletion is more dangerous than bounded operational cleanup.
- **POST retries can duplicate resources:** accepted for this API-only iteration; removal/idempotency belong to later lifecycle/platform work.
- **Search-only model discovery is weak:** direct reads require an ID learned from prior search. The agreed context-reminder follow-up owns better discovery.
- **Trusted-writer filesystem assumption remains:** tenant-writable or synchronization-managed mounts still require descriptor-relative containment before support.

## Migration Plan

1. Add labels/timestamps, remove owner uniqueness, and backfill existing rows as `Personal` without changing IDs or directories.
2. Deploy the breaking REST collection and remove the singleton route/client operation.
3. Change candidate resolution so configured/allowlisted Knowledge tools remain advertised without owner rows.
4. Deploy current-owner runtime resolution, multi-space search/read, bounded incomplete results, and the compacted marker together.
5. Verify duplicate names, pagination, cross-tenant denial, directory/DB failure residues, live addition/revocation, partial search, explicit reads, and historical attribution.
6. In the separate `multiple-kb/finalize` PR, sync the verified delta into canonical specs and archive the completed change.
7. Roll back application code only with additive schema left in place. Never restore owner uniqueness after multiple rows exist, remap stable IDs, or delete stable-ID children during rollback.

## Revision History

- **2026-08-23 — contract tightening:** Fixed the Knowledge-local cursor shape from optional to required base64url `(createdAt,id)` encoding, added malformed-cursor failure coverage, and clarified that `knowledge_space_not_configured` survives only as a tool-call result while manifest unavailability stays `knowledge_space_unavailable`.
- **2026-08-23 — review round 1:** Split generic incomplete-result replay from Knowledge execution, closed the per-space warning vocabulary, aligned name validation, and added the separate finalization PR.
- **2026-08-23 — grilled rewrite:** Removed the count cap, Chat bindings, Run resource snapshots, compatibility reads, generic cursor layer, web UI, and lifecycle work. Adopted current-access-per-call resolution, explicit reads, all-current search with bounded incomplete results, and three implementation layers above the proposal.
- **2026-08-23 — initial proposal:** Explored bounded multi-space inventory, Chat selection, and immutable Run membership; superseded by the simpler live-access contract above.
