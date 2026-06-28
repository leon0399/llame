# Self-Hosted Multi-User Personal AI Assistant — Feature Specification

**Status:** Draft v0.1  
**Generated:** 2026-06-28  
**Audience:** Product, engineering, architecture, security, and platform teams  
**Primary objective:** Define a next-generation, self-hosted AI assistant platform that combines multi-user governance, personal knowledge systems, project workspaces, durable agent execution, rich artifacts, BYOK model access, MCP/connectors, skills, slash commands, and third-party messaging channels.

---

## 1. Executive Summary

This product is a **self-hosted, multi-user AI operating layer** rather than a simple chat UI. It should support individuals, families, small organizations, and enterprise teams from the same core architecture. The assistant must treat **groups, projects, goals, todos, skills, commands, connectors, model credentials, memories, artifacts, and knowledge bases** as first-class durable entities.

The most important architectural decision is to make the system **multi-tenant and policy-aware from day one**. All resources must have explicit ownership, scope, permissions, audit events, and effective configuration snapshots. The system should allow global defaults, nested group configuration, project configuration, user-owned credentials, per-chat overrides, and per-run temporary overrides while enforcing deny-overrides-allow policy resolution.

The second major decision is to make every assistant response a **durable worker run**. The web request should not do the work directly. A user message should create a message record, enqueue a run, stream progress events, persist intermediate todo/artifact/tool state, and allow the UI or messaging channel to reconnect after refresh without losing progress.

The third major decision is to make the assistant **wiki-centric**. Chat is the interface, but a user's or organization's knowledge base should be the long-term memory substrate. Obsidian-like local Markdown vaults, Notion workspaces, Logseq-like graphs, local folders, Git repositories, document stores, and future enterprise knowledge systems should be normalized through a common **Knowledge Space** abstraction.

The fourth major decision is to support **interactive artifacts as executable, shareable, versioned work products**. Claude-style artifacts are a useful baseline, but this product should extend them with project association, GitHub linkage, sandbox execution, versioning, export formats, public/private sharing, provenance, and optional cloud/local runners.

---

## 2. Research Baseline and Product Lessons

### 2.1 Current systems and lessons

**OpenClaw-inspired personal agents.** Current public descriptions of OpenClaw position it as a self-hosted/local autonomous assistant accessed mainly through messaging channels, with local history, external LLMs, skills, and real-world actions through tools and integrations. The strongest product lessons are: messaging-first agents feel natural; skills unlock extensibility; local deployment is attractive; but broad device, file, browser, shell, and credential access creates major security risks if not governed by policy, sandboxing, and approvals. Public reporting and research around OpenClaw-style skill ecosystems show why untrusted skills must be signed, scanned, capability-declared, sandboxed, and auditable. See source notes [S4], [S13], [S14], [S15].

**Claude Code.** Claude Code's current docs expose useful primitives: slash commands, skills loaded lazily from `SKILL.md`, nested/project/personal/enterprise skill locations, hooks, subagents, MCP, background tasks, worktrees, and shareable artifacts. Important lessons: commands should be first-class; skills should be packaged and lazily loaded; long-running tasks need visible state; artifacts should be versioned and shareable; permission rules and organization controls matter. See [S2], [S3], [S16].

**OpenAI Codex.** Codex docs show a modern coding-agent surface spanning CLI, app, IDE, web, GitHub/Slack/Linear integrations, MCP, permissions, hooks, AGENTS.md, sandboxing, workflows, skills, subagents, and app-server style session continuity. Important lessons: one agent backend should support multiple clients; local and remote execution modes should share the same session model; command-driven workflows are valuable for power users; sandboxes and approvals are mandatory for write/execute operations. See [S5], [S6].

**MCP.** MCP is now a central integration standard for connecting AI apps to external data, tools, prompts, and workflows. Its model of hosts, clients, servers, tools, resources, prompts, capability negotiation, progress, cancellation, and security/consent principles should be adopted directly. This product should be an MCP host and also expose selected project/assistant capabilities as MCP servers where useful. See [S1], [S17].

**Open WebUI.** Open WebUI provides a strong self-hosted model-agnostic baseline: Ollama and OpenAI-compatible providers, Docker deployment, plugins, tool calling, RAG, terminal/computer integrations, knowledge sync, and MCP-to-OpenAPI proxy tooling. Lessons: provider-agnostic architecture, local/offline operation, and Docker-first setup are table stakes. See [S7].

**LibreChat.** LibreChat is a self-hosted chat platform with MCP, agents, code interpreter, artifacts, custom endpoints, Docker, and flexible configuration. Lessons: compatibility with multiple provider APIs and the familiar ChatGPT-like UI lowers adoption friction; adding MCP and artifacts to chat UIs is increasingly expected. See [S8].

**AnythingLLM.** AnythingLLM emphasizes workspaces, multiple vector database backends, model routers, agents, custom skills, scheduled jobs, RAG, document agents, Gmail/Calendar/Outlook agents, Telegram channel support, and self-hosted/desktop/cloud options. Lessons: workspaces map well to projects/groups; model routing and vector backend abstraction should be first-class; scheduled jobs and channel integrations are valuable beyond chat. See [S9].

**Dify.** Dify's self-hosted Docker Compose deployment includes separate API, worker, worker beat, web, plugin daemon, vector DB, PostgreSQL, Redis, nginx, SSRF proxy, and sandbox containers. Dify's Knowledge model also provides a useful RAG baseline with knowledge bases, retrieval testing, metadata filtering, embedding configuration, and external knowledge sources. Lessons: split API and worker early; include plugin isolation; include sandbox and SSRF controls in the default deployment; make RAG testable, inspectable, and tunable. See [S10], [S11].

**LobeHub.** LobeHub's current docs emphasize agents as units of work, agent groups, projects, workspaces, personal memory, command menu, artifacts, messaging channels, many model providers, and MCP-compatible skills. Lessons: users increasingly expect agent teams, project/resource libraries, memory transparency, and model/provider freedom. See [S12].

**Khoj.** Khoj is a useful reference for a personal AI "second brain": it can chat over user files, search notes/documents using natural language, understand Markdown/PDF/plaintext/org-mode/Notion, integrate with Obsidian and Emacs, and self-host on consumer hardware. Lessons: a personal assistant should treat personal notes and documents as the core knowledge base, not as optional uploads. See [S18].

**Notion.** Notion's API model distinguishes internal connections, OAuth public connections, and personal access tokens, each with different permission and content-access semantics. Lessons: connector credentials must support team-owned automation credentials, OAuth app installs, and user-owned tokens; content access must be explicit and inspectable. See [S19], [S20].

**n8n.** n8n is not primarily a chat assistant, but it is a strong reference for workflow execution, credentials, projects, sharing, user access, RBAC, SAML/OIDC, executions, and debugging. Lessons: agentic automation should borrow workflow-platform governance, not just chatbot UX. See [S21].

### 2.2 Unverified named systems

The names **Hercules** and **Odysseus** were searched as current/public personal AI assistants or agent platforms, but reliable public technical docs were not found under those exact names during this pass. They should be treated as **unverified placeholders** until specific repositories, docs, or vendor pages are provided. Do not infer architecture or capabilities for them without source material.

---

## 3. Product Goals

The product must enable:

1. **Self-hosted deployment** through Docker Compose with sane defaults, health checks, migrations, backups, and safe upgrades.
2. **Multi-user operation from the ground up** for individuals, households, teams, organizations, and enterprises.
3. **Nested groups** such as `enterprise -> product -> team`, with inherited settings, policies, connectors, skills, and RAG sources.
4. **Project-centric collaboration** with shareable workspaces, per-project connectors, MCP servers, knowledge sources, artifacts, GitHub repositories, sandboxes, and roles.
5. **Personal wiki-centric knowledge** via a provider-neutral abstraction for Obsidian, Notion, Logseq, local folders, Git repos, and future systems.
6. **Integrated chat/project/wiki/artifact search** using metadata, summaries, full text, embeddings, graph links, and optional reranking.
7. **Durable async runs** where every user message is processed by a worker, not by the HTTP request thread.
8. **Refresh-safe progress** where the UI can reconnect to an event stream and restore the current run state.
9. **Claude-style artifacts on steroids** with interactivity, versioning, execution, GitHub linkage, sharing, and sandboxing.
10. **BYOK and OAuth credentials** for LLM providers and external services, with no requirement for an instance-wide model provider.
11. **MCP-first integrations** with per-scope capability governance.
12. **Third-party messaging interfaces** such as Telegram, Discord, Slack, Matrix, Signal/WhatsApp where feasible, and email.
13. **Slash commands, goals, todos, and skills** as durable agent-control primitives.
14. **Transparent memory and auditability** so users can inspect what the assistant knows, why it did something, and which tools/data were used.
15. **Extensible microservice-ready architecture** that starts simple but can split cleanly as usage grows.

---

## 4. Non-Goals

The MVP should not try to:

- Train a proprietary foundation model.
- Build a public marketplace for untrusted executable skills before the security model is mature.
- Offer arbitrary unaudited shell access from chat.
- Implement every third-party connector directly; MCP and connector adapters should cover most integrations.
- Become a full replacement for GitHub, Notion, Obsidian, Slack, Google Drive, or n8n.
- Support enterprise compliance certifications on day one, though the data model should not block them.
- Support distributed multi-region active-active operation in the first release.

---

## 5. Core Product Principles

**Durable state over transient prompt tricks.** Todos, goals, memories, summaries, artifacts, project configs, skills, command invocations, tool calls, and approvals must be stored as structured data, not just hidden in chat text.

**Policy before capability.** A connector, MCP tool, skill, model, or sandbox capability must not be available merely because it is installed. It must be allowed by effective policy for the current user, group, project, chat, and run.

**Deny overrides allow.** When global or parent-group policy denies an action, lower scopes cannot re-enable it.

**Config is inherited, resolved, and snapshotted.** Every run should store the effective configuration snapshot used to execute it. This supports debugging, auditing, and reproducibility.

**BYOK means truly user-owned.** The instance should work even when the admin configures no LLM provider. Users, groups, or projects can supply credentials if policy allows.

**Wiki is memory, not a side upload.** Personal and group knowledge systems should become continuously indexed knowledge spaces with graph links, permissions, summaries, and retrieval.

**Artifacts are work products.** Artifacts should be versioned, linked to chats/projects/runs, searchable, exportable, shareable, and optionally executable.

**Every long-running operation is resumable.** The frontend and messaging channels must be clients of an event log, not holders of fragile in-memory state.

---

## 6. Core Domain Model

### 6.1 Ownership hierarchy

```text
Instance
└── Root organization / household
    └── Nested group
        └── Nested subgroup
            └── Project
                └── Chat
                    └── Message
                        └── Run
```

A real enterprise example:

```text
Acme Corp
└── Product
    └── Platform
        └── AI Infrastructure
            └── Project: Internal AI Assistant
                └── Chat: RAG Indexing Architecture
```

A family example:

```text
Smith Household
└── Parents
└── Kids
└── Shared Home Projects
    └── Project: Summer Trip Planning
```

### 6.2 Scope types

The platform should support these scopes:

```text
global
org_unit
group
project
user
chat
message
run
artifact
knowledge_space
connector
skill
command
```

A setting may exist at multiple scopes. The effective value is computed by the Config Resolver.

### 6.3 Config inheritance order

```text
global defaults
→ root org settings
→ parent group settings, in path order
→ current group settings
→ project settings
→ user settings
→ chat settings
→ command/message/run overrides
→ policy removal of denied capabilities
```

For array-like settings such as enabled MCP servers, the merge strategy must be explicit:

```yaml
merge_strategy:
  providers: override_by_id
  mcp_servers: additive_with_deny
  skills: additive_with_deny
  rag_sources: additive_with_deny
  commands: additive_with_override
  model_policy: most_restrictive
  network_policy: most_restrictive
```

### 6.4 Effective configuration snapshot

Every run must store:

```text
run_config_snapshot
- run_id
- user_id
- group_path
- project_id
- chat_id
- selected_model
- available_models
- provider_credential_refs
- enabled_connectors
- enabled_mcp_servers
- enabled_skills
- enabled_commands
- rag_sources
- artifact_policy
- sandbox_policy
- network_policy
- approval_policy
- retention_policy
- computed_at
- config_version_ids
- policy_version_ids
```

This snapshot is essential for auditing questions like "Why was this tool available?" or "Which knowledge sources were used?"

---

## 7. Identity, Groups, Roles, and Policies

### 7.1 Users

Users can be local accounts, SSO accounts, OAuth-linked accounts, or invited guests.

Required features:

- Local login for self-hosted setups.
- Optional OIDC/SAML for organizations.
- Multiple linked external identities per user.
- User-owned provider credentials.
- User-owned personal wiki sources.
- User-visible memory and profile settings.
- Per-user model preferences where policy permits.
- User data export.

### 7.2 Nested org units

`org_units` represent organizations, families, divisions, teams, departments, or arbitrary groups.

Required features:

- Arbitrary parent-child nesting.
- Path materialization for fast permission checks.
- Settings at each node.
- Memberships at any node.
- Inherited memberships and explicit local memberships.
- Owners/admins at each node.
- Group-scoped connectors, skills, RAG sources, model policies, budgets, retention, and audit settings.

### 7.3 Roles

MVP roles:

```text
owner
admin
maintainer
member
viewer
guest
service_account
```

Role examples:

- **Owner:** can manage billing/license, root settings, all policies, and destructive operations.
- **Admin:** can manage groups, users, connectors, skills, and projects within scope.
- **Maintainer:** can configure project resources and project-specific connectors.
- **Member:** can use projects/chats and create artifacts subject to policy.
- **Viewer:** can read shared chats/artifacts but cannot run tools.
- **Guest:** limited project-specific collaborator.
- **Service account:** used by connectors and automations, never interactive by default.

### 7.4 Policy model

Use a combined RBAC/ABAC model:

```yaml
effect: allow | deny
action: "connector.invoke" | "artifact.publish" | "sandbox.execute" | "model.use"
resource_type: "mcp_server" | "provider" | "skill" | "artifact" | "project"
resource_id: optional
conditions:
  project_id: optional
  user_role_in_project: optional
  network_zone: optional
  max_cost_usd: optional
  requires_approval: true
```

Rules:

- Denies override allows.
- More specific policies override less specific policies only when they do not conflict with deny.
- Policies are versioned.
- Policy decisions are logged.
- High-risk actions require explicit approval even if generally allowed.

### 7.5 Approval policies

Actions requiring approvals may include:

- Shell execution.
- Browser/computer-use automation.
- Sending emails/messages.
- Mutating calendars.
- Writing to Notion/Obsidian/GitHub.
- Accessing sensitive files.
- Publishing artifacts externally.
- Using expensive models above budget.
- Invoking untrusted skills.
- Calling MCP tools marked destructive.
- Exfiltrating retrieved data to a remote provider.

Approval types:

```text
never_allowed
always_ask
ask_once_per_run
ask_once_per_chat
ask_once_per_project
auto_allow_readonly
auto_allow_low_risk
admin_only
```

---

## 8. Projects

### 8.1 Project concept

A **Project** is a shared workspace that contains:

- Chats.
- Goals and todos.
- Artifacts.
- Project documents.
- Knowledge sources.
- GitHub repositories.
- MCP servers.
- Skills and slash commands.
- Project memory.
- Members and roles.
- Secrets and credentials.
- Sandboxes.
- Run history.
- Audit events.
- Search indexes.

Projects can be private to a user, shared with a group, or shared with explicit users.

### 8.2 Project types

MVP should support:

```text
personal
shared
team
organization
public_readonly
template
archived
```

### 8.3 Project configuration

Example:

```yaml
project:
  name: "Internal AI Assistant"
  default_model: "user-preferred"
  allowed_model_classes:
    - fast
    - reasoning
    - local
  rag:
    enabled_sources:
      - project_docs
      - linked_chats
      - linked_wiki_spaces
      - github_repo_docs
    retrieval_profile: "balanced"
  connectors:
    github:
      enabled: true
      credential_policy: "project_or_user"
    notion:
      enabled: true
      mode: "read_only"
  mcp_servers:
    - github
    - filesystem_project_readonly
    - postgres_readonly
  skills:
    - spec-writer
    - pr-reviewer
    - release-notes
  artifacts:
    allow_interactive: true
    allow_public_share: false
    allow_sandbox_execution: true
  sandbox:
    runner: docker
    network: restricted
    max_cpu: 2
    max_memory_mb: 2048
    max_duration_seconds: 600
```

### 8.4 Project sharing

Capabilities:

- Invite users.
- Share with nested group.
- Public read-only artifact/chats if enabled.
- Per-project guest access.
- Project templates.
- Fork project with optional knowledge/artifact copy.
- Export project bundle.

### 8.5 Project lifecycle

```text
draft
active
paused
archived
deleted_pending_retention
purged
```

Archive should freeze new runs but preserve search and artifacts.

---

## 9. Chats, Messages, Runs, and Resumable Progress

### 9.1 Chat model

A chat belongs to a user or project and may be shared. It has:

- Title.
- Participants.
- Project linkage.
- Active goal.
- Chat summary.
- Linked knowledge sources.
- Linked artifacts.
- Linked todos.
- Retrieval profile.
- Model/provider preference.
- Privacy/retention policy.

### 9.2 Message model

Messages include:

```text
message_id
chat_id
sender_type: user | assistant | system | tool | channel | automation
sender_id
content_blocks
attachments
command_invocation_id
created_at
edited_at
deleted_at
visibility
```

Content blocks should support:

```text
text
markdown
image
audio
file
artifact_reference
todo_reference
tool_call_summary
approval_request
citation
code
structured_json
```

### 9.3 Run model

Each user message creates a run unless it is a purely local UI action. Runs are processed by workers.

Run statuses:

```text
queued
resolving_config
retrieving_context
planning
waiting_for_approval
running_model
running_tool
running_sandbox
updating_artifact
summarizing
completed
failed
cancelled
expired
```

### 9.4 Run event stream

A run event stream should be append-only and replayable:

```text
run_events
- run_id
- sequence
- event_type
- payload_json
- created_at
```

Event types:

```text
run.created
run.started
config.resolved
retrieval.started
retrieval.hit
retrieval.completed
model.requested
model.delta
model.completed
tool.requested
tool.approval_required
tool.started
tool.stdout
tool.stderr
tool.completed
todo.created
todo.updated
artifact.created
artifact.updated
artifact.version_published
sandbox.started
sandbox.completed
summary.updated
run.completed
run.failed
```

The UI subscribes by cursor:

```http
GET /api/runs/{run_id}/events?after_sequence=123
Accept: text/event-stream
```

If the page refreshes, it reads the latest run state and resumes from the last event sequence.

### 9.5 Worker isolation

The API thread must only:

1. Validate the request.
2. Store the message.
3. Create the run.
4. Enqueue the run.
5. Return the run ID.

Workers perform:

- Config resolution.
- Retrieval.
- Prompt/context assembly.
- Model calls.
- Tool loops.
- Todo updates.
- Artifact generation.
- Summarization.
- Index updates.
- Final message creation.

### 9.6 Queue requirements

MVP can use Redis/Valkey-backed queue. The queue abstraction should allow migration to NATS JetStream, RabbitMQ, Kafka, or Temporal later.

Required queue features:

- At-least-once processing.
- Idempotency keys.
- Retry with exponential backoff.
- Dead-letter queue.
- Per-user/project concurrency limits.
- Priority lanes.
- Cancellation.
- Run timeout.
- Worker heartbeat.

---

## 10. Goals and ToDo Items

### 10.1 Goals

A **goal** is a durable objective for a chat or project.

```text
goals
- id
- scope_type: chat | project
- scope_id
- title
- description
- status: active | paused | completed | cancelled
- created_from_message_id
- active_run_id
- linked_todo_ids
- linked_artifact_ids
- created_by
- created_at
- updated_at
```

The `/goal` command should create or update the active goal. It can optionally generate initial todos.

Example:

```text
/goal Write the self-hosted AI assistant specification and turn it into a Markdown artifact.
```

Expected behavior:

1. Store the goal.
2. Generate or update todos.
3. Update chat/project summary.
4. Start or modify the current run.
5. Show the active goal in the chat header.

### 10.2 Todo items

Todos are durable work-state objects, not prompt-only checklists.

```text
todo_items
- id
- scope_type: chat | project | user | group
- scope_id
- title
- description
- status: todo | in_progress | blocked | done | cancelled
- priority
- owner_type: user | assistant | agent | group
- assignee_user_id
- source_message_id
- parent_todo_id
- dependency_ids
- acceptance_criteria
- linked_artifact_ids
- linked_run_ids
- linked_github_issue_id
- created_by
- updated_by
- created_at
- updated_at
```

Todo events:

```text
todo_events
- todo_id
- event_type: created | updated | started | blocked | completed | reopened | linked_artifact | linked_commit
- actor_type
- actor_id
- message_id
- run_id
- payload_json
- created_at
```

### 10.3 Todo UX

The chat view should show:

- Active goal.
- Current run progress.
- Todo board or compact todo list.
- Which todo the assistant is working on.
- Blocked items and reasons.
- Linked artifacts and source messages.

The assistant can update todos during long work, but user-visible changes should be stored and reviewable.

---

## 11. Slash Commands

### 11.1 Command system

Slash commands are parsed before the model call. Commands can be handled by:

```text
internal handler
skill handler
MCP prompt/tool
workflow handler
project script
connector action
agent/subagent template
```

Command objects:

```text
commands
- id
- name
- description
- scope_type
- scope_id
- manifest_json
- handler_type
- handler_ref
- required_permissions
- enabled
- created_at
- updated_at
```

Invocation log:

```text
command_invocations
- id
- command_id
- user_id
- chat_id
- project_id
- message_id
- run_id
- args_json
- result_json
- created_at
```

### 11.2 Built-in commands

MVP built-ins:

```text
/goal       Set or update active chat/project goal.
/todo       Create, list, update, complete, or block todos.
/search     Search chats, messages, summaries, wiki, project docs, and artifacts.
/wiki       Query, mount, sync, or inspect knowledge spaces.
/project    Switch, inspect, configure, share, or archive project.
/connect    Connect provider, MCP server, OAuth integration, or local source.
/model      Select model, provider, effort profile, or routing mode.
/skill      Install, enable, disable, inspect, or run skills.
/artifact   Create, open, fork, export, publish, or execute artifacts.
/run        Start, inspect, cancel, retry, or resume a run.
/memory     Save, forget, inspect, or scope memory.
/summarize  Summarize chat, project, artifact, source, or timeframe.
/export     Export chat/project/artifacts/memory.
/policy     Explain allowed/denied capability decisions.
/debug      Show run trace, config snapshot, retrieval hits, and tool calls.
```

### 11.3 Command manifest

```yaml
name: goal
description: Set the active goal for this chat or project.
scope:
  - chat
  - project
args_schema:
  type: object
  properties:
    text:
      type: string
    mode:
      type: string
      enum: [replace, append, refine]
permissions:
  - goals.write
handler:
  type: internal
  ref: goal.set
autocomplete:
  argument_hint: "<goal>"
```

### 11.4 Command resolution

Command precedence:

```text
global built-ins
→ org/group commands
→ project commands
→ user commands
→ chat temporary commands
→ skill-provided commands
```

Name collisions must be explicit. Recommended syntax for namespacing:

```text
/skill-name
/plugin-name:command
/project-path:command
```

---

## 12. Skills Platform

### 12.1 Skill definition

A skill is a versioned package that extends assistant behavior. It can contain instructions, supporting files, tool adapters, slash commands, schemas, RAG material, artifact templates, hooks, and evals.

Recommended package structure:

```text
my-skill/
├── SKILL.md
├── skill.yaml
├── prompts/
├── tools/
├── rag/
├── schemas/
├── commands/
├── artifacts/
├── evals/
├── policies/
├── ui/
└── README.md
```

### 12.2 `SKILL.md`

`SKILL.md` should contain concise human-readable instructions. It should not be the only security boundary.

Example:

```markdown
---
name: pr-reviewer
description: Reviews GitHub pull requests for correctness, security, and maintainability.
when_to_use: Use when a user asks to review a PR, inspect a diff, or prepare merge feedback.
disable_model_invocation: false
---

Use the GitHub connector to read the PR diff.
Summarize high-risk issues first.
Never push commits unless the user explicitly approves write access.
```

### 12.3 `skill.yaml`

Example:

```yaml
name: github-pr-review
version: 1.2.0
description: Reviews GitHub pull requests.
permissions:
  github:
    pull_requests: read
    contents: read
  network:
    outbound:
      - api.github.com
  filesystem:
    mode: none
models:
  required_capabilities:
    - code_reasoning
commands:
  - /review-pr
mcp_servers:
  - github
sandbox:
  required: true
  network: restricted
provenance:
  source: github
  signed: true
trust:
  minimum_level: admin_approved
```

### 12.4 Skill scopes

```text
builtin
instance-installed
group-installed
project-installed
user-installed
chat-installed
temporary-run
```

### 12.5 Trust levels

```text
builtin
verified
admin-approved
user-installed
local-dev
untrusted
blocked
```

MVP should allow builtin and admin-approved skills. User-installed executable skills should be post-MVP unless sandboxing and review are mature.

### 12.6 Lazy loading

Skills should not be blindly injected into every prompt. Use a Skill Router:

```text
message
→ command parser
→ intent classifier
→ candidate skill search
→ policy check
→ capability check
→ minimal skill context injection
→ run
```

The model should receive only:

- Skill name.
- Short description.
- Invocation conditions.
- Relevant instructions.
- Required capabilities.
- Referenced supporting files only when needed.

### 12.7 Skill security

Required:

- Signed packages for non-local skills.
- Hash pinning.
- Provenance metadata.
- Static scanning.
- Secret scanning.
- Capability declarations.
- Network allowlists.
- Filesystem allowlists.
- Admin review workflow.
- Runtime sandboxing.
- Audit logs for every skill invocation.
- Prompt-injection-aware guidance provenance.
- A kill switch for compromised skills.

---

## 13. MCP and Connector Architecture

### 13.1 MCP host responsibilities

The assistant acts as an MCP host. It manages MCP clients connected to MCP servers.

It should support:

```text
stdio MCP servers
HTTP/SSE MCP servers
streamable HTTP MCP servers
remote OAuth MCP servers
containerized MCP servers
MCP-to-OpenAPI proxy mode
```

### 13.2 MCP server scopes

MCP servers can be configured at:

```text
global
org/group
project
user
chat
temporary run
```

Each MCP server declaration includes:

```yaml
id: github-project
transport: streamable_http
url: "https://..."
scope: project
credential_ref: "project:github-installation"
capabilities:
  tools:
    - pull_requests.read
    - issues.write
  resources:
    - repo.contents
policy:
  require_approval_for:
    - pull_requests.write
    - issues.write
  deny:
    - repo.admin
```

### 13.3 Connector abstraction

Not every integration will be MCP-native. Use a Connector Service that exposes a normalized internal interface:

```text
Connector
- provider type: github | notion | google_drive | slack | telegram | local_fs | custom
- auth mode: oauth | api_key | pat | instance_secret | service_account | local
- capabilities
- resources
- actions
- webhooks
- sync jobs
- rate limits
- audit behavior
```

Each connector can optionally expose:

- MCP server.
- REST adapter.
- Webhook receiver.
- Sync indexer.
- OAuth app.
- UI settings panel.

### 13.4 Credential resolution

Credential precedence must be explicit:

```text
message/run explicit credential
→ chat credential
→ project credential
→ user credential
→ group credential
→ instance credential
```

Policy can restrict whether user credentials may be used in a project or whether project credentials may be used by a user.

### 13.5 Tool safety

Every tool should be classified:

```text
read_only
write_low_risk
write_high_risk
execute_code
external_send
financial_or_sensitive
admin
```

The runtime should use this classification to trigger approvals and sandbox restrictions.

---

## 14. BYOK and Model Provider System

### 14.1 Provider abstraction

Providers should be normalized as:

```text
provider_accounts
- id
- owner_scope_type
- owner_scope_id
- provider_type
- display_name
- auth_mode
- base_url
- models_cache
- enabled
- created_at
```

Provider types:

```text
openai_compatible
openai
anthropic
google_gemini
openrouter
azure_openai
aws_bedrock
mistral
groq
together
ollama
lm_studio
vllm
llama_cpp
custom_http
```

### 14.2 Credentials

Credentials are encrypted and scoped:

```text
credentials
- id
- owner_scope_type
- owner_scope_id
- provider_account_id
- secret_type: api_key | oauth_token | pat | service_account | local_socket
- encrypted_payload
- key_version
- expires_at
- rotation_state
- created_by
- last_used_at
```

### 14.3 No instance provider required

The instance should boot with no model provider. Users can add their own provider credentials if policy allows. For a family or organization, admins can configure group-level or project-level providers.

### 14.4 Model router

The Model Router selects a model based on:

- User preference.
- Project policy.
- Required modality.
- Required tool support.
- Reasoning level.
- Context length.
- Cost budget.
- Latency target.
- Data locality requirement.
- Provider health.
- Fallback policy.

Example routing profile:

```yaml
profile: balanced
rules:
  - when: { task: "simple_chat" }
    prefer: ["local.fast", "cloud.fast"]
  - when: { task: "code_reasoning" }
    prefer: ["cloud.reasoning", "local.code"]
  - when: { data_classification: "sensitive" }
    require: ["local_or_approved_private_provider"]
  - when: { monthly_budget_remaining_usd_lt: 5 }
    prefer: ["local"]
```

### 14.5 Cost and quota

Track:

- Tokens in/out.
- Embedding tokens.
- Tool cost.
- Sandbox runtime cost.
- Provider cost.
- User/project/group monthly budgets.
- Warnings and hard caps.

---

## 15. Personal Wiki-Centric Knowledge Architecture

### 15.1 Knowledge Spaces

A **Knowledge Space** is a mounted source of truth.

Supported MVP sources:

```text
local_folder_markdown
obsidian_vault
notion_workspace
notion_page_tree
git_repository_docs
uploaded_project_documents
chat_history
artifact_library
```

Post-MVP sources:

```text
logseq_graph
google_drive
confluence
slack_history
email_archive
linear_jira
readwise
browser_bookmarks
rss_feeds
```

### 15.2 Knowledge Space schema

```text
knowledge_spaces
- id
- owner_scope_type
- owner_scope_id
- source_type
- display_name
- connector_id
- root_ref
- sync_mode: manual | scheduled | webhook | file_watch
- write_policy: read_only | append_only | bidirectional | disabled
- indexing_policy
- permissions_policy
- created_at
- updated_at
```

### 15.3 Canonical document model

Normalize each source into:

```text
documents
- id
- knowledge_space_id
- external_id
- canonical_uri
- title
- document_type
- mime_type
- content_hash
- metadata_json
- graph_json
- permission_fingerprint
- last_source_updated_at
- last_indexed_at
```

Chunks:

```text
document_chunks
- id
- document_id
- chunk_index
- heading_path
- content_text
- content_tokens
- metadata_json
- embedding_id
- content_hash
```

Graph relations:

```text
knowledge_edges
- from_document_id
- to_document_id
- relation_type: backlink | wikilink | tag | parent | child | citation | attachment | alias
- metadata_json
```

### 15.4 Obsidian adapter

The Obsidian-style adapter should support:

- Local filesystem vault.
- Markdown files.
- YAML frontmatter.
- Wikilinks `[[Page]]`.
- Tags.
- Attachments.
- Daily notes.
- Canvas files where possible.
- Git-backed sync if the vault is in a repository.
- Read-only MVP; append/update post-MVP.

### 15.5 Notion adapter

The Notion adapter should support:

- OAuth public connections for multi-user installs.
- Internal connections for team-owned automations.
- Personal access tokens for user-owned scripts.
- Page and database reads.
- Page tree traversal.
- Comments where permitted.
- Webhook subscriptions where configured.
- Explicit content access checks.

### 15.6 Wiki as memory

The assistant should not store all memories only in a hidden memory database. Instead, it should support memory destinations:

```text
assistant_private_memory
user_visible_memory
project_memory
wiki_append_note
daily_note_append
notion_page_append
```

A user can configure:

```yaml
memory_policy:
  default_destination: user_visible_memory
  allow_wiki_writes: true
  wiki_write_requires_approval: true
  daily_note_target: "Obsidian/Daily Notes/{date}.md"
```

### 15.7 Wiki retrieval

Retrieval should account for:

- Full-text chunk match.
- Vector semantic match.
- Title and alias match.
- Tags.
- Frontmatter metadata.
- Backlink graph proximity.
- Recency.
- User/project permissions.
- Pinned sources.
- Manual user selections.

---

## 16. Chat History, Project, Artifact, and Wiki Search

### 16.1 Search goals

Users should be able to ask:

- "Find the chat where we discussed the worker architecture."
- "What did we decide about using pgvector vs Qdrant?"
- "Search my Obsidian vault for notes related to the MCP security model."
- "Find artifacts created for the AI assistant project."
- "Use past chats and project docs to answer this."

### 16.2 Indexed sources

Index:

```text
chat titles
chat summaries
message content
message attachments
run traces, selectively
tool call summaries
todos and goals
artifact titles and content
artifact versions
project docs
wiki documents
GitHub issue/PR summaries
connector-synced documents
```

### 16.3 Summary layers

Use multiple summary layers:

```text
message-level extracted facts
rolling chat summary
topic summary
goal summary
project summary
artifact summary
knowledge-space summary
user memory summary
```

Each summary should be timestamped, versioned, and linked to source messages/documents.

### 16.4 Multi-stage search pipeline

Recommended pipeline:

```text
1. Permission filter
2. Scope filter
3. Query understanding
4. Exact/fuzzy title search
5. Metadata search
6. Full-text lexical search
7. Vector search over chunks/summaries/artifacts/wiki
8. Graph expansion
9. Reranking
10. Diversity filtering
11. Citation/source assembly
12. Answer synthesis or result display
```

### 16.5 Search backends

MVP:

- PostgreSQL for metadata.
- PostgreSQL full-text search or Meilisearch/Typesense for lexical.
- pgvector for embeddings.

Scale path:

- Qdrant, Weaviate, or Milvus for vector search.
- OpenSearch for large full-text.
- Dedicated re-ranker service.
- Hybrid search service.

### 16.6 RAG response requirements

Every RAG answer should expose:

- Sources used.
- Source scope.
- Retrieval query.
- Retrieval profile.
- Confidence/coverage.
- Date indexed.
- Permission boundary.
- Option to open the original message/document/artifact.

### 16.7 RAG poisoning defense

For untrusted retrieved content:

- Mark content as untrusted.
- Strip or isolate instructions embedded in retrieved documents.
- Never allow retrieved content to override system/developer/user instructions.
- Quote sources as data, not commands.
- Require approval before tool actions suggested by retrieved content.
- Log retrieval-to-action chains.

---

## 17. Artifacts

### 17.1 Artifact model

Artifacts are durable, versioned work products.

```text
artifacts
- id
- project_id
- chat_id
- owner_user_id
- title
- artifact_type
- current_version_id
- visibility
- execution_policy
- source_run_id
- source_message_id
- github_repo_id
- created_at
- updated_at
```

Versions:

```text
artifact_versions
- id
- artifact_id
- version_number
- content_ref
- content_hash
- metadata_json
- created_by
- source_run_id
- created_at
```

### 17.2 Artifact types

MVP:

```text
markdown_document
html_page
mermaid_diagram
code_snippet
react_component
json_schema
api_spec
checklist
```

Near-term:

```text
docx_document
pdf_export
spreadsheet
notebook
dashboard
interactive_form
canvas
whiteboard
diagram_pack
test_report
release_notes
```

Later:

```text
full_stack_app
hosted_microapp
data_app
simulation
workflow
agent_team
```

### 17.3 Interactive artifact requirements

Interactive artifacts should support:

- Preview in chat side panel.
- Full-screen view.
- Version history.
- Diff between versions.
- Forking.
- Export.
- Copy as prompt.
- Linking to todos/goals.
- Linking to GitHub commits/PRs.
- Optional sandbox execution.
- Share links with policy controls.
- Public sharing only if enabled by policy.

### 17.4 Artifact execution modes

```text
static_preview
browser_sandbox
docker_sandbox
local_runner
cloud_runner
kubernetes_runner
firecracker_microvm
```

MVP: static preview plus Docker sandbox for project-trusted code.

Sandbox requirements:

- Resource limits.
- Network policy.
- Filesystem policy.
- Secret injection only by explicit permission.
- No default access to host Docker socket.
- Logs captured as run events.
- Artifact provenance preserved.
- Rebuild from versioned source.

### 17.5 GitHub linkage

Artifacts can be associated with a GitHub repository:

- Artifact source stored in repo.
- Artifact generated from branch/worktree.
- Artifact linked to issue/PR.
- Artifact changes committed by assistant with approval.
- Artifact preview posted to PR.
- Artifact version maps to commit SHA.
- Project can define repo-level artifact directories.

Example:

```yaml
artifact:
  id: arch-spec
  repo: acme/assistant
  branch: feature/spec-artifact
  path: docs/assistant-feature-spec.md
  linked_pr: 123
  publish_policy: org_only
```

---

## 18. GitHub and Software Project Integration

### 18.1 Repository linkage

Projects can link one or more repositories:

```text
repositories
- id
- provider: github | gitlab | gitea
- owner
- name
- default_branch
- installation_id
- credential_policy
- project_id
```

### 18.2 Git features

MVP:

- Read repo files.
- Search code.
- Read issues/PRs.
- Read diffs.
- Link chats/artifacts to issues/PRs.
- Create branches.
- Propose patches.
- Open PR with approval.

Post-MVP:

- Worktree-based parallel agents.
- CI-aware repair loops.
- Code review comments.
- Security scanning integration.
- Release automation.
- Multi-repo dependency graph.
- Local devcontainer integration.

### 18.3 Approval defaults

Read operations can be auto-approved when project policy allows. Write operations require explicit approval unless an admin configures a trusted automation.

---

## 19. Messaging Channel Interfaces

### 19.1 Channel Gateway

The Channel Gateway normalizes external messages into internal chat messages.

Supported MVP channels:

```text
web app
telegram
discord
slack
email inbound
```

Future channels:

```text
matrix
signal
whatsapp
sms
imessage bridge
teams
mattermost
zulip
```

### 19.2 Channel identity linking

A user must explicitly link external channel identities.

```text
channel_accounts
- id
- user_id
- channel_type
- external_user_id
- external_username
- verified_at
- created_at
```

### 19.3 Channel routing

Messages route to:

- A personal default chat.
- A project chat by command.
- A channel-specific project.
- A thread-mapped chat.
- A bot DM chat.
- A group chat with shared participants.

Example:

```text
Telegram DM → user's personal assistant
Discord server channel #ai-assistant → project chat
Slack thread → mapped chat thread
Email subject thread → project inbox chat
```

### 19.4 Channel UX

Channels should support:

- Streaming or periodic progress updates.
- Compact todo updates.
- Approval buttons where supported.
- Artifact links.
- File attachments.
- Voice note transcription where supported.
- `/project`, `/goal`, `/todo`, `/search`, `/run cancel`.

### 19.5 Channel safety

- Do not expose admin commands in untrusted channels.
- Require identity linking.
- Per-channel rate limits.
- Per-channel capability policy.
- Optional "read-only channel mode."
- Avoid leaking private project names across channels.
- Validate webhooks.
- Store channel message IDs for audit and replies.

---

## 20. Memory and Personalization

### 20.1 Memory types

```text
profile_memory
preference_memory
project_memory
relationship_memory
task_memory
decision_memory
wiki_memory
ephemeral_chat_memory
```

### 20.2 Memory visibility

Every durable memory should be inspectable unless explicitly system-internal.

Memory controls:

- Save memory.
- Edit memory.
- Forget memory.
- Move memory to wiki.
- Scope memory to project/group/user.
- Disable memory for chat.
- Expire memory after duration.
- Show memory used in response.

### 20.3 Memory write policy

The assistant should not silently store sensitive or high-impact memories. Use configurable thresholds:

```yaml
memory_write_policy:
  low_risk_preferences: auto_save_with_notification
  project_decisions: ask
  personal_sensitive: ask
  credentials: never
  third_party_personal_info: ask_or_never
```

### 20.4 Memory retrieval

Memory retrieval should be included in the same multi-stage retrieval pipeline, but marked separately from document/chat sources.

---

## 21. Architecture

### 21.1 High-level architecture

```mermaid
flowchart TD
    Web[Web App / PWA] --> API[API Gateway]
    Mobile[Mobile / Desktop Shell] --> API
    Channels[Telegram / Discord / Slack / Email] --> ChannelGateway[Channel Gateway]
    ChannelGateway --> API

    API --> Auth[Identity & Auth Service]
    API --> Policy[Policy Service]
    API --> Config[Config Resolver]
    API --> Chat[Chat & Project Service]
    API --> Queue[Run Queue]

    Queue --> Workers[Assistant Workers]
    Workers --> Config
    Workers --> Policy
    Workers --> Retrieval[Search & RAG Service]
    Workers --> Model[Model Gateway / Router]
    Workers --> MCP[MCP & Connector Manager]
    Workers --> Skills[Skill Registry & Runtime]
    Workers --> Artifacts[Artifact Service]
    Workers --> Sandbox[Sandbox Runner]
    Workers --> Events[Run Event Store]

    Retrieval --> Pg[(PostgreSQL)]
    Retrieval --> Vector[(pgvector / Qdrant)]
    Retrieval --> Lexical[(FTS / Meilisearch)]
    Artifacts --> ObjectStore[(MinIO / S3)]
    Chat --> Pg
    Events --> Pg
    Config --> Pg
    Policy --> Pg
    MCP --> Vault[Credential Vault]
    Model --> Vault
    Sandbox --> ObjectStore

    API --> Events
    Web --> Events
```

### 21.2 Run lifecycle

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Web/Channel UI
    participant API as API Gateway
    participant Q as Queue
    participant W as Worker
    participant C as Config Resolver
    participant R as Retrieval
    participant M as Model Gateway
    participant T as MCP/Tools
    participant E as Event Store

    U->>UI: Send message
    UI->>API: POST message
    API->>E: Store message + run.created
    API->>Q: Enqueue run
    API-->>UI: run_id
    UI->>E: Subscribe run events

    Q->>W: Start run
    W->>E: run.started
    W->>C: Resolve effective config
    C-->>W: Config snapshot
    W->>E: config.resolved
    W->>R: Retrieve chat/project/wiki/artifact context
    R-->>W: Ranked sources
    W->>M: Model request
    M-->>W: Tool call or text
    W->>T: Invoke approved tool
    T-->>W: Tool result
    W->>M: Continue model loop
    W->>E: model deltas / todo updates / artifact updates
    W->>E: run.completed
    UI-->>U: Replayed + live progress
```

### 21.3 Config resolution

```mermaid
flowchart LR
    Global[Global Config] --> Resolver
    Org[Org/Group Ancestors] --> Resolver
    Project[Project Config] --> Resolver
    User[User Config] --> Resolver
    Chat[Chat Config] --> Resolver
    Runtime[Run Overrides] --> Resolver
    Policies[Allow/Deny Policies] --> Resolver
    Resolver --> Snapshot[Effective Config Snapshot]
```

### 21.4 Knowledge indexing pipeline

```mermaid
flowchart TD
    Sources[Wiki / Notion / Docs / Chats / Artifacts / GitHub] --> Sync[Sync Workers]
    Sync --> Normalize[Normalize Documents]
    Normalize --> Permissions[Permission Fingerprint]
    Normalize --> Chunk[Chunk + Extract Metadata]
    Chunk --> Summaries[Summarize]
    Chunk --> Embed[Generate Embeddings]
    Chunk --> TextIndex[Lexical Index]
    Embed --> VectorIndex[Vector Index]
    Summaries --> VectorIndex
    Permissions --> Search[Search Service]
    TextIndex --> Search
    VectorIndex --> Search
```

### 21.5 Artifact execution

```mermaid
flowchart TD
    Run[Assistant Run] --> Artifact[Artifact Service]
    Artifact --> Version[Create Version]
    Version --> Store[Object Store]
    Artifact --> Policy[Execution Policy Check]
    Policy --> Sandbox[Sandbox Runner]
    Sandbox --> Logs[Run Events]
    Sandbox --> Preview[Preview URL]
    Version --> Git[Optional Git Commit / PR]
```

---

## 22. Service Boundaries

### 22.1 Web App

Responsibilities:

- Chat UI.
- Project UI.
- Admin/group UI.
- Artifact viewer/editor.
- Search UI.
- Todo/goal panel.
- Command palette.
- OAuth/connectors UI.
- Run progress streaming.
- Approval prompts.

Suggested stack:

- Next.js or React SPA.
- TanStack Query or equivalent.
- SSE/WebSocket client.
- Monaco editor for code artifacts.
- Markdown/Mermaid rendering.
- Sandboxed iframe for artifacts.

### 22.2 API Gateway

Responsibilities:

- Authenticated REST/GraphQL API.
- Request validation.
- Message creation.
- Run enqueue.
- Event stream endpoints.
- Admin APIs.
- Webhook ingress routing.
- Rate limiting.

### 22.3 Identity Service

Responsibilities:

- Users.
- Sessions.
- OAuth/OIDC/SAML.
- Group tree.
- Memberships.
- Invitations.
- Service accounts.

### 22.4 Policy Service

Responsibilities:

- RBAC/ABAC decisions.
- Capability checks.
- Approval requirements.
- Deny override enforcement.
- Policy versioning.
- Policy explanation.

### 22.5 Config Resolver

Responsibilities:

- Merge configuration across scopes.
- Resolve credentials by policy.
- Resolve model/provider.
- Resolve enabled skills/connectors/RAG.
- Store run config snapshots.
- Explain effective configuration.

### 22.6 Credential Vault

Responsibilities:

- Encrypt secrets.
- Rotate keys.
- Store OAuth tokens.
- Refresh OAuth tokens.
- Scope credentials.
- Audit secret access.
- Optional integration with HashiCorp Vault, cloud KMS, or age/sops.

### 22.7 Chat and Project Service

Responsibilities:

- Projects.
- Chats.
- Messages.
- Attachments.
- Goals/todos.
- Sharing.
- Summaries.
- Retention.

### 22.8 Worker Orchestrator

Responsibilities:

- Run queue.
- Worker scheduling.
- Idempotency.
- Cancellation.
- Retry.
- Tool loop.
- Model loop.
- Progress events.
- Run finalization.

### 22.9 Model Gateway

Responsibilities:

- Provider abstraction.
- Model routing.
- Streaming.
- Token/cost accounting.
- Retry/fallback.
- Local model support.
- Safety/policy filtering.
- Structured output validation.

### 22.10 MCP and Connector Manager

Responsibilities:

- MCP client lifecycle.
- MCP server registry.
- Connector adapters.
- Webhook handling.
- Sync jobs.
- Tool capability metadata.
- Tool invocation auditing.
- Connector rate limits.

### 22.11 Search and RAG Service

Responsibilities:

- Ingestion.
- Chunking.
- Embeddings.
- Lexical indexing.
- Vector indexing.
- Hybrid retrieval.
- Reranking.
- Citations.
- Retrieval evals.
- Permission filtering.

### 22.12 Skill Registry and Runtime

Responsibilities:

- Skill packages.
- Installations.
- Versions.
- Signatures.
- Trust levels.
- Lazy skill selection.
- Skill-provided commands.
- Skill-scoped policies.
- Skill audit logs.

### 22.13 Artifact Service

Responsibilities:

- Artifact metadata.
- Versioning.
- Object storage.
- Preview rendering.
- Sharing.
- Exports.
- GitHub linkage.
- Artifact search indexing.

### 22.14 Sandbox Runner

Responsibilities:

- Execute artifacts/tools safely.
- Docker-based MVP.
- Resource limits.
- Filesystem mounts.
- Network policy.
- Secret injection.
- Log capture.
- Cleanup.

### 22.15 Notification Service

Responsibilities:

- Channel updates.
- Email notifications.
- Web push.
- Run completion notifications.
- Approval reminders.
- Scheduled task triggers.

### 22.16 Audit and Observability Service

Responsibilities:

- Audit events.
- Run traces.
- Tool traces.
- Retrieval traces.
- Cost metrics.
- Error reporting.
- Admin dashboards.
- Exportable logs.

---

## 23. Recommended Technical Stack

### 23.1 MVP stack

A pragmatic self-hosted stack:

```text
Frontend: Next.js / React / TypeScript
API: Go or TypeScript service
Workers: Go or TypeScript, with isolated Python sidecar for document parsing if needed
Database: PostgreSQL
Vector: pgvector initially
Queue: Redis or Valkey
Object storage: MinIO/S3-compatible
Search: PostgreSQL FTS initially; Meilisearch/Typesense optional
Reverse proxy: Caddy or nginx
Sandbox: Docker containers with restricted profiles
Observability: OpenTelemetry + Prometheus + Grafana + Loki optional
Deployment: Docker Compose
```

### 23.2 Scale stack

When needed:

```text
Queue/workflows: Temporal, NATS JetStream, or Kafka
Vector: Qdrant / Weaviate / Milvus
Search: OpenSearch
Sandbox: Firecracker / Kata Containers / Kubernetes jobs
Secrets: HashiCorp Vault / cloud KMS
Object storage: S3 / R2 / MinIO cluster
Database: Postgres HA
Service mesh: optional
```

### 23.3 Language recommendation

Keep the core platform simple:

- **TypeScript** is useful for frontend, provider adapters, MCP clients, and plugin ecosystems.
- **Go** is strong for API, workers, concurrency, queues, and self-hosted binaries.
- **Rust** is useful for sandboxing, high-performance indexing components, and security-sensitive utilities later.
- **Python** can remain isolated to ML/document parsing workers if necessary.

Avoid forcing every plugin/skill author to use the same runtime. Skills should support declarative prompt-only packages first, then controlled script execution.

---

## 24. Storage Architecture

### 24.1 PostgreSQL

Use PostgreSQL for:

- Users.
- Groups.
- Memberships.
- Policies.
- Config.
- Projects.
- Chats.
- Messages.
- Runs.
- Run events.
- Todos.
- Artifacts metadata.
- Knowledge metadata.
- Credential metadata.
- Audit events.

Use Row Level Security where practical, but do not rely on it as the only authorization layer.

### 24.2 Object storage

Use MinIO/S3 for:

- Uploaded files.
- Artifact content.
- Export bundles.
- Parsed document representations.
- Large run logs.
- Sandbox outputs.
- Backups.

### 24.3 Vector storage

MVP with pgvector:

- Simple self-hosting.
- Consistent backup with Postgres.
- Good enough for moderate scale.

Scale path to Qdrant/Weaviate/Milvus if:

- Embeddings exceed comfortable Postgres size.
- Low-latency high-volume vector retrieval is needed.
- Multi-tenant vector isolation becomes complex.
- Advanced hybrid/reranking features are needed.

### 24.4 Lexical search

MVP:

- PostgreSQL FTS.

Better search UX:

- Meilisearch or Typesense.

Enterprise scale:

- OpenSearch.

### 24.5 Cache

Use Redis/Valkey for:

- Queue.
- Rate limits.
- Short-lived locks.
- Session cache.
- Model/provider health cache.
- Webhook deduplication.
- Temporary stream state.

Do not store authoritative run state only in Redis.

---

## 25. Data Model Sketch

### 25.1 Identity and orgs

```sql
users(id, email, display_name, avatar_url, status, created_at, updated_at)
external_identities(id, user_id, provider, external_subject, metadata_json, created_at)
org_units(id, parent_id, type, name, path, settings_json, created_at, updated_at)
memberships(id, user_id, org_unit_id, role, inherited_from_id, created_at)
roles(id, scope_type, scope_id, name, permissions_json)
policies(id, scope_type, scope_id, effect, action, resource_type, resource_id, conditions_json, version, created_at)
```

### 25.2 Config and credentials

```sql
configs(id, scope_type, scope_id, config_json, version, created_by, created_at)
provider_accounts(id, owner_scope_type, owner_scope_id, provider_type, display_name, base_url, enabled, metadata_json)
credentials(id, owner_scope_type, owner_scope_id, provider_account_id, secret_type, encrypted_payload, key_version, expires_at)
run_config_snapshots(id, run_id, snapshot_json, created_at)
```

### 25.3 Projects and chats

```sql
projects(id, owner_scope_type, owner_scope_id, name, description, visibility, settings_json, created_at, updated_at)
project_members(id, project_id, user_id, role, created_at)
chats(id, project_id, owner_user_id, title, summary, settings_json, visibility, created_at, updated_at)
messages(id, chat_id, sender_type, sender_id, content_json, source_channel_id, created_at, edited_at)
runs(id, chat_id, message_id, user_id, status, worker_id, started_at, completed_at, error_json)
run_events(run_id, sequence, event_type, payload_json, created_at)
```

### 25.4 Goals and todos

```sql
goals(id, scope_type, scope_id, title, description, status, source_message_id, active_run_id, created_by, created_at, updated_at)
todo_items(id, scope_type, scope_id, title, description, status, priority, owner_type, assignee_user_id, parent_todo_id, created_by, updated_by, created_at, updated_at)
todo_dependencies(todo_id, depends_on_todo_id)
todo_events(id, todo_id, event_type, actor_type, actor_id, message_id, run_id, payload_json, created_at)
```

### 25.5 Commands and skills

```sql
commands(id, name, description, scope_type, scope_id, manifest_json, handler_type, handler_ref, required_permissions_json, enabled)
command_invocations(id, command_id, user_id, chat_id, project_id, message_id, run_id, args_json, result_json, created_at)
skills(id, name, version, package_uri, manifest_json, signature, trust_level, created_at)
skill_installations(id, skill_id, scope_type, scope_id, enabled, config_json, installed_by, installed_at)
skill_invocations(id, skill_id, run_id, user_id, status, capability_snapshot_json, created_at)
```

### 25.6 Connectors and MCP

```sql
connectors(id, provider_type, owner_scope_type, owner_scope_id, auth_mode, capabilities_json, settings_json, enabled)
mcp_servers(id, owner_scope_type, owner_scope_id, name, transport, endpoint, command_json, capabilities_json, policy_json, enabled)
tool_invocations(id, run_id, tool_name, connector_id, mcp_server_id, input_json, output_json, risk_level, approval_id, status, created_at)
approvals(id, run_id, user_id, action_type, resource_type, resource_id, prompt, status, decided_by, decided_at)
```

### 25.7 Knowledge and search

```sql
knowledge_spaces(id, owner_scope_type, owner_scope_id, source_type, display_name, connector_id, root_ref, sync_mode, write_policy, indexing_policy_json)
documents(id, knowledge_space_id, external_id, canonical_uri, title, document_type, mime_type, content_hash, metadata_json, permission_fingerprint, last_source_updated_at, last_indexed_at)
document_chunks(id, document_id, chunk_index, heading_path, content_text, content_hash, metadata_json, embedding_id)
knowledge_edges(id, from_document_id, to_document_id, relation_type, metadata_json)
embeddings(id, owner_scope_type, owner_scope_id, model, vector, metadata_json, created_at)
```

### 25.8 Artifacts

```sql
artifacts(id, project_id, chat_id, owner_user_id, title, artifact_type, current_version_id, visibility, execution_policy_json, source_run_id, source_message_id, github_repo_id, created_at, updated_at)
artifact_versions(id, artifact_id, version_number, content_ref, content_hash, metadata_json, created_by, source_run_id, created_at)
artifact_permissions(id, artifact_id, subject_type, subject_id, permission, created_at)
artifact_executions(id, artifact_id, version_id, run_id, sandbox_id, status, logs_ref, output_ref, created_at)
```

### 25.9 Audit

```sql
audit_events(id, actor_type, actor_id, action, resource_type, resource_id, scope_type, scope_id, payload_json, created_at)
```

---

## 26. API Design

### 26.1 Public API style

Use REST for core CRUD and SSE/WebSockets for streams. Optionally add GraphQL later for complex admin screens.

### 26.2 Core endpoints

```http
POST   /api/messages
GET    /api/chats
POST   /api/chats
GET    /api/chats/{chat_id}
GET    /api/chats/{chat_id}/messages
POST   /api/chats/{chat_id}/messages
GET    /api/runs/{run_id}
GET    /api/runs/{run_id}/events
POST   /api/runs/{run_id}/cancel
POST   /api/runs/{run_id}/retry
```

### 26.3 Project endpoints

```http
GET    /api/projects
POST   /api/projects
GET    /api/projects/{project_id}
PATCH  /api/projects/{project_id}
POST   /api/projects/{project_id}/members
DELETE /api/projects/{project_id}/members/{user_id}
GET    /api/projects/{project_id}/artifacts
GET    /api/projects/{project_id}/todos
GET    /api/projects/{project_id}/search
```

### 26.4 Command endpoints

```http
GET    /api/commands?scope=chat:{id}
POST   /api/commands/execute
GET    /api/command-invocations/{id}
```

### 26.5 Search endpoints

```http
POST   /api/search
POST   /api/retrieval/preview
GET    /api/search/sources/{source_id}
```

Example search request:

```json
{
  "query": "worker progress restore after page refresh",
  "scopes": ["project:assistant"],
  "sources": ["chats", "artifacts", "wiki", "project_docs"],
  "mode": "hybrid",
  "include_citations": true
}
```

### 26.6 Connector endpoints

```http
GET    /api/connectors
POST   /api/connectors
POST   /api/connectors/{id}/oauth/start
GET    /api/connectors/{id}/oauth/callback
POST   /api/connectors/{id}/sync
GET    /api/connectors/{id}/resources
```

### 26.7 Artifact endpoints

```http
POST   /api/artifacts
GET    /api/artifacts/{artifact_id}
GET    /api/artifacts/{artifact_id}/versions
POST   /api/artifacts/{artifact_id}/versions
POST   /api/artifacts/{artifact_id}/execute
POST   /api/artifacts/{artifact_id}/share
POST   /api/artifacts/{artifact_id}/export
```

### 26.8 Admin endpoints

```http
GET    /api/admin/org-units
POST   /api/admin/org-units
PATCH  /api/admin/org-units/{id}
GET    /api/admin/policies
POST   /api/admin/policies
GET    /api/admin/audit-events
GET    /api/admin/run-traces
GET    /api/admin/costs
```

---

## 27. Deployment and Operations

### 27.1 Docker Compose profiles

Default services:

```text
web
api
worker
scheduler
postgres
redis
minio
sandbox-runner
nginx-or-caddy
```

Optional profiles:

```text
vector-qdrant
search-meilisearch
channels
observability
local-llm-ollama
mcp-gateway
browser-computer-use
```

### 27.2 Compose design

Core compose should include:

- Named volumes.
- Health checks.
- Dependency health gates.
- Non-root containers.
- Read-only filesystems where possible.
- Secrets through env files or mounted secret files.
- Backup container/profile.
- Migration job.
- Versioned image tags.
- `.env.example`.
- `docker compose pull && docker compose up -d` upgrade path.

### 27.3 Safe upgrades

Required:

- Semantic versioning.
- Database migrations with rollback guidance.
- Config schema versioning.
- Pre-upgrade backup command.
- Migration dry-run option.
- Health check after migration.
- Release notes with breaking changes.
- Automatic detection of incompatible plugins/skills.
- Option to disable untrusted skills after upgrade.

### 27.4 Backup and restore

Backup:

- PostgreSQL dump or physical backup.
- Object storage snapshot.
- Config export.
- Encryption key backup warning.
- Optional vector/search rebuild from source data.

Restore:

- Restore DB.
- Restore object storage.
- Restore keys.
- Re-run indexers.
- Verify admin login.
- Verify run/artifact references.

### 27.5 Local-only mode

Local-only mode disables:

- External model providers unless user configures.
- External telemetry.
- Public artifact sharing.
- Remote MCP servers by default.
- External network access from sandboxes.
- Marketplace downloads.

---

## 28. Security Requirements

### 28.1 Secure defaults

- No public unauthenticated access.
- First admin setup token displayed once in logs or generated file.
- Strong session cookies.
- CSRF protection.
- CORS locked down.
- Rate limits.
- Audit logging enabled.
- All secret payloads encrypted.
- Tool approvals enabled by default.
- Shell/sandbox disabled until configured.
- Public sharing disabled by default.

### 28.2 Prompt-injection defense

- Treat retrieved content, webpages, emails, documents, and tool outputs as untrusted data.
- Separate system/user instructions from retrieved data.
- Warn when retrieved data asks the agent to ignore instructions or exfiltrate data.
- Require explicit approval before actions based on untrusted content.
- Track source-to-action provenance.
- Use tool-specific allowlists.
- Make the model explain tool actions before execution when risk is high.

### 28.3 Skill and plugin defense

- Signed packages for marketplace/distributed skills.
- Admin approval for executable skills.
- Static and dynamic scanning.
- Capability manifests.
- Sandboxed execution.
- Network egress restrictions.
- Secret access restrictions.
- Skill version pinning.
- Fast revocation/disable.
- Trust badges in UI.

### 28.4 MCP security

Adopt MCP security principles:

- User consent and control.
- Explicit data sharing permissions.
- Tool behavior descriptions are untrusted unless server is trusted.
- Tool calls require appropriate user consent.
- LLM sampling requests from MCP servers must be approved and bounded.
- Remote MCP servers cannot receive arbitrary prompt/context unless permitted.

### 28.5 Multi-tenant isolation

- All queries enforce project/group/user access.
- Search indexes include permission fingerprints.
- Artifact URLs require auth unless explicitly public.
- Shared projects do not leak private user memories.
- User credentials are not visible to project admins unless explicitly shared.
- Project credentials are not usable outside project scope.

### 28.6 Sandbox security

- No host Docker socket.
- No privileged containers.
- CPU/memory/process limits.
- Ephemeral filesystems.
- Explicit mounts.
- Network deny by default.
- Egress allowlists.
- Secret injection only per approved run.
- Cleanup after execution.
- Logs retained by policy.

---

## 29. Observability, Audit, and Debugging

### 29.1 Run trace

Every run should expose a debug view with:

- User message.
- Effective config snapshot.
- Selected model/provider.
- Retrieved sources.
- Prompt/context outline, redacted as needed.
- Tool calls.
- Approvals.
- Skill activations.
- Todo updates.
- Artifact versions.
- Token/cost metrics.
- Errors and retries.

### 29.2 Audit events

Audit:

- Login/logout.
- Credential created/used/rotated/deleted.
- Connector added/removed.
- MCP server invoked.
- Skill installed/enabled/invoked.
- Tool approval requested/approved/denied.
- Artifact shared/published/deleted.
- Project shared.
- Policy changed.
- Admin action.
- Data export.
- Public link created.

### 29.3 Metrics

Track:

- Run latency.
- Queue depth.
- Worker utilization.
- Model latency.
- Tool latency.
- Retrieval latency.
- Embedding throughput.
- Sandbox failures.
- Token/cost usage.
- Error rates.
- Approval rates.
- Search success signals.
- Artifact generation success.

---

## 30. User Interface Requirements

### 30.1 Main navigation

- Inbox / Recent chats.
- Projects.
- Search.
- Wiki / Knowledge Spaces.
- Artifacts.
- Goals & Todos.
- Connectors.
- Skills.
- Admin.

### 30.2 Chat UI

Must include:

- Message stream.
- Active goal.
- Todo/progress panel.
- Artifact side panel.
- Source citations panel.
- Command autocomplete.
- Model selector, if allowed.
- Connector status.
- Approval prompts.
- Run status and event log.
- Resume/retry/cancel controls.

### 30.3 Project UI

Must include:

- Project overview.
- Members.
- Chats.
- Artifacts.
- Todos.
- Knowledge sources.
- Connectors/MCP.
- Skills/commands.
- GitHub repositories.
- Runs.
- Settings.
- Audit.

### 30.4 Admin UI

Must include:

- Users.
- Nested groups.
- Memberships.
- Provider accounts.
- Credential policy.
- Connectors.
- MCP servers.
- Skills.
- Model policies.
- Budgets.
- Audit logs.
- System health.
- Backups/upgrades.

### 30.5 Search UI

Search should support:

- Global search.
- Project search.
- Chat history search.
- Wiki search.
- Artifact search.
- Filters by source, date, author, project, tag, type.
- Result preview.
- Open source.
- Use selected results as context.

---

## 31. MVP Scope

### 31.1 MVP must-have

1. Multi-user accounts.
2. Nested groups and memberships.
3. Project creation and sharing.
4. Global/group/project/user/chat config model.
5. Config Resolver with run snapshots.
6. Basic RBAC and deny policies.
7. BYOK provider credentials at user and instance scope.
8. OpenAI-compatible, Anthropic, Ollama/local provider support.
9. Chat UI with async worker runs.
10. Run event stream with refresh recovery.
11. Basic slash command registry.
12. `/goal`, `/todo`, `/search`, `/project`, `/model`, `/connect`, `/artifact`.
13. Durable goals and todos.
14. Chat summaries.
15. Chat/project/artifact full-text search.
16. pgvector embeddings for chats, summaries, docs, and artifacts.
17. Project documents and artifact storage.
18. Markdown and HTML artifacts with version history.
19. Docker sandbox for explicitly approved artifact/code execution.
20. MCP server registry with stdio and HTTP support.
21. Connector framework with GitHub, local filesystem read-only, Notion read-only, and Telegram or Discord.
22. Admin-installed skills with `SKILL.md` and `skill.yaml`.
23. Skill capability declarations and audit logs.
24. Obsidian/local Markdown Knowledge Space read-only indexing.
25. Notion Knowledge Space read-only indexing through OAuth or token.
26. Docker Compose deployment.
27. Backup/restore script.
28. Audit logs.
29. Basic observability.

### 31.2 MVP nice-to-have

- Slack channel.
- MinIO object store by default.
- Meilisearch profile.
- Qdrant profile.
- Web push notifications.
- Artifact export to PDF/DOCX.
- GitHub PR creation.
- Simple scheduled runs.

---

## 32. Post-MVP Roadmap

### 32.1 Version 0.2

- Advanced artifact editor.
- GitHub branch/worktree integration.
- Slack and email channels.
- More connector OAuth flows.
- RAG retrieval evaluation UI.
- Project templates.
- Better admin policy UI.
- Skill signing for internal packages.
- Background scheduled tasks.
- Webhook-triggered runs.

### 32.2 Version 0.3

- Agent teams/subagents.
- Parallel work units.
- Workflow builder.
- Visual run graph.
- Fine-grained artifact permissions.
- Bidirectional wiki writes with approval.
- Mobile app/PWA offline cache.
- Local browser/computer-use sandbox.
- Enterprise SSO/OIDC/SAML.
- Per-project cost budgets.

### 32.3 Version 1.0

- Stable plugin/skill SDK.
- Public API.
- MCP server mode exposing assistant/project resources.
- Advanced compliance export.
- Multi-node deployment.
- HA-ready Postgres/Object storage docs.
- Trust center/security hardening guide.
- Signed skill marketplace for trusted/private registries.
- Full disaster recovery guide.

---

## 33. Open Questions

1. Should the primary backend be Go or TypeScript?
2. Should pgvector be the only MVP vector store or should Qdrant be available from day one?
3. Should artifact execution be enabled in MVP or hidden behind an advanced profile?
4. Should personal wiki writes be supported in MVP or read-only only?
5. Should the first messaging channel be Telegram, Discord, or Slack?
6. Should the system provide its own MCP servers for projects/artifacts/search from MVP?
7. Should user-owned BYOK credentials be allowed inside shared projects by default?
8. How much run trace should be visible to normal users versus admins?
9. What is the minimum skill signing model for private self-hosted deployments?
10. Should there be family-specific controls distinct from enterprise controls?

---

## 34. Acceptance Criteria

The MVP is acceptable when:

- A fresh user can deploy with Docker Compose, create an admin account, connect a model provider, and chat.
- A user message creates a durable run processed by a worker.
- Refreshing the page during a run restores progress from persisted events.
- An admin can create nested groups and assign users.
- A project can be shared with a group.
- A project can have its own settings, knowledge sources, MCP servers, skills, and artifacts.
- A user can add their own model API key without instance-level provider configuration.
- A chat can use project docs, chat history, and wiki content through hybrid search.
- Search can find relevant chats by title, message content, summary, and embeddings.
- The assistant can create and update todos during a long task.
- `/goal` and `/todo` work as durable commands.
- An admin can install a skill and see audit logs when it runs.
- The assistant can create a versioned Markdown/HTML artifact.
- A basic GitHub connector can read repository context.
- A Telegram or Discord bot can send a message into the same run system.
- Tool calls and sensitive actions require approval according to policy.
- Audit logs can answer who did what, when, and through which connector/tool.

---

## 35. Potential Future Features and Follow-ups

Potential future features/follow-ups: realtime voice and meeting assistant support for calls and transcripts; browser/computer-use automation with stronger sandboxes; visual workflow builder for scheduled and event-driven automations; agent teams and debate/review modes for complex work; private skill marketplace with signing, reputation, and vulnerability feeds; cross-instance project federation for families or partner organizations; encrypted local-first mobile sync; advanced compliance packs for regulated teams; model-evaluation loops that learn from user corrections without leaking private data; and richer artifact hosting for full internal tools with backends, databases, and deployment pipelines.

---

## 36. Source Notes

[S1] Model Context Protocol introduction and specification: https://modelcontextprotocol.io/docs/getting-started/intro and https://modelcontextprotocol.io/specification/2025-06-18  
[S2] Claude Code skills docs: https://code.claude.com/docs/en/slash-commands  
[S3] Claude Code command reference: https://code.claude.com/docs/en/commands  
[S4] Claude Code artifacts docs: https://code.claude.com/docs/en/artifacts  
[S5] OpenAI Codex CLI docs: https://developers.openai.com/codex/cli  
[S6] OpenAI Codex slash commands / app commands docs: https://developers.openai.com/codex/cli/slash-commands and https://developers.openai.com/codex/app/commands  
[S7] Open WebUI docs: https://docs.openwebui.com/  
[S8] LibreChat docs: https://www.librechat.ai/docs/  
[S9] AnythingLLM docs: https://docs.anythingllm.com/  
[S10] Dify Docker Compose self-hosting docs: https://docs.dify.ai/en/self-host/deploy/quick-start/docker-compose  
[S11] Dify Knowledge/RAG docs: https://docs.dify.ai/en/cloud/use-dify/knowledge/readme  
[S12] LobeHub docs: https://lobehub.com/docs/usage/start  
[S13] Public OpenClaw overview and ecosystem notes from current search results: https://en.wikipedia.org/wiki/OpenClaw  
[S14] OpenClaw security reporting example: https://www.theverge.com/news/874011/openclaw-ai-skill-clawhub-extensions-security-nightmare  
[S15] OpenClaw safety/deployment reporting example: https://www.techradar.com/pro/how-to-safely-experiment-with-openclaw  
[S16] Claude Code MCP docs: https://code.claude.com/docs/en/mcp  
[S17] MCP GitHub organization: https://github.com/modelcontextprotocol  
[S18] Khoj docs: https://docs.khoj.dev/  
[S19] Notion API overview: https://developers.notion.com/guides/get-started/overview  
[S20] Notion authorization docs: https://developers.notion.com/guides/get-started/authorization  
[S21] n8n advanced AI and platform docs: https://docs.n8n.io/advanced-ai/  

