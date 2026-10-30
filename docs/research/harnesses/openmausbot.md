---
type: Reference
title: "OpenMausBot"
description: "Bounded MCP control and persona imports"
resource: "https://github.com/milind-soni/OpenMausBot"
tags: [harness, mcp, import]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-10-30"
observed:
  date: "2026-10-30"
  revision: "10af83e74dd7b5f7895fa498e0009c6ccc12a813"
sources:
  - id: server-harness-registry-ts-l146-l189
    resource: "https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/server/harness/registry.ts#L146-L189"
    title: "registry"
  - id: server-harness-bus-ts-l80-l91
    resource: "https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/server/harness/bus.ts#L80-L91"
    title: "event bus"
  - id: server-harness-bus-ts-l12-l13
    resource: "https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/server/harness/bus.ts#L12-L13"
    title: "incomplete log warning"
  - id: server-harness-bus-ts-l152-l161
    resource: "https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/server/harness/bus.ts#L152-L161"
    title: "redacted log line and live delivery"
  - id: server-harness-bus-ts-l267-l273
    resource: "https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/server/harness/bus.ts#L267-L273"
    title: "disk failure still delivers"
  - id: docs-mcp-server-md-l14-l15
    resource: "https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/docs/mcp-server.md#L14-L15"
    title: "MCP interface"
  - id: scripts-mcp-server-ts-l1058-l1088
    resource: "https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/scripts/mcp-server.ts#L1058-L1088"
    title: "implementation"
  - id: server-team-manifest-ts-l208-l228
    resource: "https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/server/team-manifest.ts#L208-L228"
    title: "Persona import"
  - id: shared-package-format-ts-l373-l377
    resource: "https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/shared/package-format.ts#L373-L377"
    title: "paused routines and preset allowlist"
  - id: shared-package-format-ts-l406-l417
    resource: "https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/shared/package-format.ts#L406-L417"
    title: "connection URLs"
  - id: shared-package-format-ts-l737-l748
    resource: "https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/shared/package-format.ts#L737-L748"
    title: "v1 upgrade keeps routines paused"
  - id: shared-package-format-ts-l753-l778
    resource: "https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/shared/package-format.ts#L753-L778"
    title: "A file import of a v2 object keeps enabledAfterInstall"
  - id: server-bot-package-ts-l43-l46
    resource: "https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/server/bot-package.ts#L43-L46"
    title: "package schema"
---

# OpenMausBot

- **Stack:** TypeScript local app/server; Apache-2.0 main tree, separately licensed enterprise directory

High-confidence reference for model-facing control and portable profile imports.
Study selected boundaries rather than importing its bots/rooms/runtime model.

**Study**

1. **F16: Preserve unavailable provider instances.** The registry[^server-harness-registry-ts-l146-l189]
   retains unknown or failed drivers as unavailable shadow entries with reasons. The
   event bus[^server-harness-bus-ts-l80-l91]
   drops cross-driver events and stamps provider-instance identity: adapter
   correlation and degradation behavior for future llame peer executors.
2. **F17: Small external control surface.** The MCP interface[^docs-mcp-server-md-l14-l15]
   excludes approval grants, permission memory, deletion, credentials, and computer/VM lifecycle. Its
   implementation[^scripts-mcp-server-ts-l1058-l1088]
   checks that a task belongs to the named bot or channel, and a cancellable wait
   returns `needs-user`, `timed-out`, `failed`, `stalled`, or `settled`.
   Relevant to future external Run control; task association
   checks do not replace authenticated owner authorization.
3. **F18: Import descriptions without privileges.** Persona import[^server-team-manifest-ts-l208-l228]
   constructs an explicit field allowlist. The caller must still force `composio: false`
   and `connectorTools: {}`, because absence means allowed. Preset bots[^shared-package-format-ts-l373-l377]
   carry no approval, computer, browser, MCP, app, or model fields. The routine field
   comment says file imports arrive paused, and a v1 upgrade[^shared-package-format-ts-l737-l748]
   forces every routine to `enabledAfterInstall: false`. Parsing a v2 object as a file
   import deletes `package.publisher` and otherwise keeps the document, so that object
   can still set `enabledAfterInstall: true`.[^shared-package-format-ts-l753-l778]
   Connection URLs[^shared-package-format-ts-l406-l417]
   must be `https`, or `http` on loopback. Parsing a package[^server-bot-package-ts-l43-l46]
   strips unknown fields, so ids, grants, credentials, paths, model selections, and
   runtime state do not cross the boundary.
   This directly informs future llame Profiles/Skills import: setup intent and
   human-readable instructions cannot carry an execution grant.

**Caution:** The event bus warns when it cannot write the canonical log and continues live
delivery.[^server-harness-bus-ts-l12-l13][^server-harness-bus-ts-l267-l273]
Its redaction applies to the persisted line; the bus delivers the original
event to live subscribers.[^server-harness-bus-ts-l152-l161]
Local JSON state and pairing/session checks do not
establish llame's PostgreSQL/RLS boundary. In persona import, the caller must also
force `composio: false`: omission alone enables that connector, as the import
function's contract explicitly warns.[^server-team-manifest-ts-l208-l228]

[^server-harness-registry-ts-l146-l189]: [registry](https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/server/harness/registry.ts#L146-L189)

[^server-harness-bus-ts-l80-l91]: [event bus](https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/server/harness/bus.ts#L80-L91)

[^server-harness-bus-ts-l12-l13]: [incomplete log warning](https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/server/harness/bus.ts#L12-L13)

[^server-harness-bus-ts-l152-l161]: [redacted log line and live delivery](https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/server/harness/bus.ts#L152-L161)

[^server-harness-bus-ts-l267-l273]: [disk failure still delivers](https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/server/harness/bus.ts#L267-L273)

[^docs-mcp-server-md-l14-l15]: [MCP interface](https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/docs/mcp-server.md#L14-L15)

[^scripts-mcp-server-ts-l1058-l1088]: [implementation](https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/scripts/mcp-server.ts#L1058-L1088)

[^server-team-manifest-ts-l208-l228]: [Persona import](https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/server/team-manifest.ts#L208-L228)

[^shared-package-format-ts-l373-l377]: [paused routines and preset allowlist](https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/shared/package-format.ts#L373-L377)

[^shared-package-format-ts-l406-l417]: [connection URLs](https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/shared/package-format.ts#L406-L417)

[^shared-package-format-ts-l737-l748]: [v1 upgrade keeps routines paused](https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/shared/package-format.ts#L737-L748)

[^shared-package-format-ts-l753-l778]: [A file import of a v2 object keeps enabledAfterInstall](https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/shared/package-format.ts#L753-L778)

[^server-bot-package-ts-l43-l46]: [package schema](https://github.com/milind-soni/OpenMausBot/blob/10af83e74dd7b5f7895fa498e0009c6ccc12a813/server/bot-package.ts#L43-L46)
