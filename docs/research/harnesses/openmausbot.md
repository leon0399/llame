---
type: Reference
title: "OpenMausBot"
description: "Bounded MCP control and persona imports"
resource: "https://github.com/milind-soni/OpenMausBot"
sources:
  - id: server-harness-registry-ts-l76-l124
    resource: "https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/server/harness/registry.ts#L76-L124"
    title: "registry"
  - id: server-harness-bus-ts-l27-l90
    resource: "https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/server/harness/bus.ts#L27-L90"
    title: "event bus"
  - id: docs-mcp-server-md
    resource: "https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/docs/mcp-server.md"
    title: "MCP interface"
  - id: scripts-mcp-server-ts
    resource: "https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/scripts/mcp-server.ts"
    title: "implementation"
  - id: server-team-manifest-ts-l210-l272
    resource: "https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/server/team-manifest.ts#L210-L272"
    title: "Persona import"
  - id: server-bot-package-ts
    resource: "https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/server/bot-package.ts"
    title: "package schema"
---

# OpenMausBot

- **Stack:** TypeScript local app/server; Apache-2.0 main tree, separately licensed enterprise directory
- **Observed:** 2026-09-10 @ `ca61118787f687749eb1251bc3007e4d7d7bdd93`

High-confidence reference for model-facing control and portable profile imports.
Study selected boundaries rather than importing its bots/rooms/runtime model.

**Study**

1. **F16: Preserve unavailable provider instances.** The registry[^server-harness-registry-ts-l76-l124]
   retains unknown or failed drivers as unavailable entries with reasons. The
   event bus[^server-harness-bus-ts-l27-l90]
   rejects cross-driver events and stamps provider-instance identity. Useful
   adapter correlation and degradation behavior for future llame peer executors.
2. **F17: Small external control surface.** The MCP interface[^docs-mcp-server-md]
   excludes approval grants, credentials, deletion, and VM lifecycle. Its
   implementation[^scripts-mcp-server-ts]
   validates bounded inputs, projects result fields, checks task-to-bot/channel
   association, and supports cancellable waits with distinct needs-user and
   timeout outcomes. Relevant to future external Run control; task association
   checks do not replace authenticated owner authorization.
3. **F18: Import descriptions without privileges.** Persona import[^server-team-manifest-ts-l210-l272]
   constructs an explicit field allowlist, excluding approval policy, connectors,
   computer access, and host paths. The package schema[^server-bot-package-ts]
   validates local references and requires imported routines to remain disabled.
   This directly informs future llame Profiles/Skills import: setup intent and
   human-readable instructions cannot carry an execution grant.

**Caution:** The event bus warns on NDJSON append failure and continues live
delivery, so its log is not sufficient for llame's authoritative durable Run
record. Its redaction applies to the persisted copy; the bus passes the original
event to live subscribers. Local JSON state and pairing/session checks do not
establish llame's PostgreSQL/RLS boundary. In persona import, the caller must
also force `composio: false`: omission alone enables that connector, as the
import function's contract explicitly warns.

[^server-harness-registry-ts-l76-l124]: [registry](https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/server/harness/registry.ts#L76-L124)

[^server-harness-bus-ts-l27-l90]: [event bus](https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/server/harness/bus.ts#L27-L90)

[^docs-mcp-server-md]: [MCP interface](https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/docs/mcp-server.md)

[^scripts-mcp-server-ts]: [implementation](https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/scripts/mcp-server.ts)

[^server-team-manifest-ts-l210-l272]: [Persona import](https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/server/team-manifest.ts#L210-L272)

[^server-bot-package-ts]: [package schema](https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/server/bot-package.ts)
