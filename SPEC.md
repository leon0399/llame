# llame current architecture

**Status:** Current cross-cutting contract. Updated 2026-07-15.

This file records system boundaries and invariants that span capabilities. It is not a future feature inventory, release plan, API catalogue, schema sketch, or research report.

## 0. Document authority

| Question                        | Source of truth                                               |
| ------------------------------- | ------------------------------------------------------------- |
| What llame is and what runs now | [README.md](README.md)                                        |
| Product direction and deferrals | [VISION.md](VISION.md)                                        |
| Sequenced unshipped work        | [ROADMAP.md](ROADMAP.md) and linked GitHub issues             |
| Shipped history                 | [CHANGELOG.md](CHANGELOG.md)                                  |
| Cross-cutting architecture      | This file                                                     |
| Shipped capability behavior     | [`openspec/specs`](openspec/specs)                            |
| Proposed capability changes     | [`openspec/changes`](openspec/changes)                        |
| Database shape                  | [`apps/api/src/db`](apps/api/src/db) and generated migrations |
| API contract                    | Code-first OpenAPI served by `apps/api`                       |
| Research and alternatives       | [`docs/research`](docs/research)                              |
| Contributor rules               | [AGENTS.md](AGENTS.md) and child `AGENTS.md` files            |

When prose conflicts with code or a capability spec, treat the prose as stale and repair it with the behavior change.

## 1. Product boundary

llame currently provides authenticated multi-user chat, durable agentic Runs, operator-configured models, owner-only Projects, hybrid chat search, and a bounded read-only tool loop.

A Project currently groups one owner's Chats. It does not grant shared membership, own knowledge, attach tools, or provide a filesystem workspace. See [`openspec/specs/projects`](openspec/specs/projects/spec.md).

Future behavior belongs in [VISION.md](VISION.md) until sequenced in the roadmap and specified through an OpenSpec change.

## 2. Conversation continuity

### 2.1 Compaction and provenance lineage

Context compaction stores an RLS-scoped summary with an `upto_seq` boundary and `parent_id` lineage. Source messages remain unchanged; context becomes the latest summary plus later messages. See [`apps/api/src/compaction`](apps/api/src/compaction), [`chats.ts`](apps/api/src/db/schema/chats.ts), and [`available-models`](openspec/specs/available-models/spec.md).

## 6. Identity and ownership

Authenticated identity comes from the server-validated opaque session. Client input and model arguments never select the acting user or tenant scope.

### 6.1 Organizational units

Nested organizational units, memberships, inherited roles, and external identities ship as identity foundations. See [`org-units`](openspec/specs/org-units/spec.md), [`org-memberships`](openspec/specs/org-memberships/spec.md), and [`external-identities`](openspec/specs/external-identities/spec.md).

## 7. Authorization and roles

Authorization fails closed. Tenant-owned tables use PostgreSQL RLS with `ENABLE` and `FORCE`; queries run with a transaction-local trusted user id.

### 7.1 External identities

External identity mappings bind a provider subject to one llame user. They are an identity primitive, not a channel permission grant.

### 7.2 Organizational access

Org-unit access and inheritance follow OpenSpec. They do not imply shared access to Projects, Chats, tools, or future knowledge.

Org-unit records also store and return opaque node-scoped `settings`; interpretation and inheritance are deferred to #46. See [`org-units`](openspec/specs/org-units/spec.md).

### 7.3 Roles

Current roles are `owner`, `admin`, `maintainer`, `member`, `viewer`, `guest`, and `service_account`. Capability authorization remains explicit.

### 7.5 Approvals

No general approval workflow or per-tool allow/ask/deny policy ships. Authentication, RLS, tool classification, and the static `tools.allowed` gate remain mandatory.

## 9. Chats and durable Runs

A Chat is the persistent conversation container. A Run is one queued agentic turn for a user message.

### 9.3 Run state

The current runtime uses only active states `queued` and `running_model` and terminal states `completed`, `failed`, `cancelled`, and `expired`. The database enum retains additional reserved states for migration compatibility; they are not current runtime behavior. Terminal state is immutable, and per-chat single-flight permits at most one non-terminal Run. See [`durable-runs`](openspec/specs/durable-runs/spec.md).

### 9.4 Run events

Run progress is an append-only event stream. Clients subscribe, reconnect, and replay; they do not own execution state. Tool activity and outcomes persist for history reconstruction.

Persisted event families currently cover Run lifecycle (`run.created`, `run.started`, terminal `run.*`), model activity (`model.requested`, `model.delta`, `model.completed`), `reasoning.delta`, tool activity (`tool.requested`, `tool.started`, `tool.completed`), and `run.step_cap_reached`.

### 9.5 Execution boundary

Every chat message executes through pg-boss and `RunExecutionService`; there is no inline request-thread mode. A no-HTTP worker entrypoint ships, and worker profiles support co-located consumers. See [`durable-runs`](openspec/specs/durable-runs/spec.md), [`job-queue`](openspec/specs/job-queue/spec.md), and [docs/scaling.md](docs/scaling.md).

### 9.6 Queue delivery and recovery

Infrastructure failures retry under bounded queue policy; exhausted jobs dead-letter. Native queue heartbeat recovers dead workers, terminal Run writes are first-writer-wins, and failed enqueue cannot leave a Chat permanently blocked. See [`job-queue`](openspec/specs/job-queue/spec.md) and [`durable-runs`](openspec/specs/durable-runs/spec.md).

## 13. Tools and integrations

The current Run loop interleaves model output with tool calls within an operator step cap. The only native tool is `search_conversations`. Remote MCP and dynamic discovery do not ship.

### 13.5 Tool safety classification

Every tool declares one classification: `read_only`, `write_low_risk`, `write_high_risk`, `execute_code`, `external_send`, `financial_or_sensitive`, or `admin`. The current runtime executes only operator-allowlisted `read_only` tools. See [`tool-calling`](openspec/specs/tool-calling/spec.md).

## 14. Provider and model configuration

Operators configure providers, models, defaults, and secret references in `llame.config.json`. The API exposes executable model metadata and routes opaque model ids. User BYOK does not ship. See [`instance-config`](openspec/specs/instance-config/spec.md) and [`available-models`](openspec/specs/available-models/spec.md).

## 15. Knowledge

No Markdown vault, Knowledge Space, knowledge index, or agent knowledge-write path ships. Chat search is not a knowledge base. See [ROADMAP.md](ROADMAP.md) for the next boundary.

## 19. Channels

No external messaging channel ships.

### 19.2 External identity mapping

The §7.1 mapping is reusable by future channels, but it does not authorize delivery or resource access.

## 20. Memory and search

Chats, Runs, messages, and events form the episodic record. Hybrid chat search is a rebuildable projection used by the web UI and `search_conversations`. Semantic facts and automatic injection do not ship. See [`chat-search`](openspec/specs/chat-search/spec.md) and [`search-projection`](openspec/specs/search-projection/spec.md).

## 22. Service ownership

### 22.0 Web and API boundary

`apps/api` owns HTTP APIs, authentication, execution services, and all PostgreSQL access. It is authoritative for opaque session authentication accepted through an HttpOnly cookie or bearer token. Proxy trust is disabled unless the operator opts in through `http.trustProxy`.

`apps/web` is a thin Next.js client. It has no database, chat backend, or BFF-owned domain state; it consumes `apps/api` over HTTP and streaming contracts.

The code-first OpenAPI document generated by `apps/api` owns the endpoint contract. Web API clients are currently handwritten; client or SDK code generation does not ship.

## 23. Technology constraints

### 23.1 Runtime stack

The product is TypeScript on Node.js: Next.js, NestJS, Drizzle, and pg-boss. A second backend language or parallel execution path requires an explicit architecture decision.

## 24. Storage and coordination

### 24.0.1 PostgreSQL coordination

PostgreSQL is the system of record for operational state and coordinates transactions, RLS, queues, locks, sessions, events, and lexical search. Search projections are rebuildable; identity and Run state are not.

Other storage must preserve the ownership and isolation boundaries in this file.

## 28. Model-input trust boundary

### 28.2 User and retrieved content

User messages, compaction summaries, and tool or retrieval results are model input, not trusted authority. They cannot select tenant identity, tool availability, or access scope. Stored system-role rows and persisted display-only reasoning/tool parts are excluded from replayed context. See [`context-builder.ts`](apps/api/src/chats/context-builder.ts) and [`tool-calling`](openspec/specs/tool-calling/spec.md).
