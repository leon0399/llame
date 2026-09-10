---
type: Reference
title: "OpenCode"
description: "TypeScript coding harness; provider, session, and permission boundaries"
resource: "https://github.com/anomalyco/opencode/tree/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b"
observed:
  date: "2026-09-10"
  revision: "b3f1a96c6dd7adeb28b36dd11add1998fc84d67b"
sources:
  - id: packages-core-src-session-sql-ts-l22-l176
    resource: "https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/session/sql.ts#L22-L176"
    title: "Session, message, part, sequence, and context tables"
  - id: packages-core-src-session-history-ts-l13-l99
    resource: "https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/session/history.ts#L13-L99"
    title: "baseline-aware history loading"
  - id: packages-core-src-permission-ts-l76-l85
    resource: "https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/permission.ts#L76-L85"
    title: "Wildcard evaluation and default ask behavior"
  - id: packages-core-src-permission-ts-l190-l283
    resource: "https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/permission.ts#L190-L283"
    title: "pending approvals with saved rules"
---

# OpenCode

- **Stack:** Bun/TypeScript, Effect, Drizzle/SQLite, AI SDK, Solid; MIT

A TypeScript AI SDK harness with session projections and suspendable approvals.
High confidence for comparing replay and permission UX; moderate for direct reuse
because it is a local SQLite coding client.

**Study**

1. **Session history.** Session, message, part, sequence, and context tables[^packages-core-src-session-sql-ts-l22-l176] plus baseline-aware history loading[^packages-core-src-session-history-ts-l13-l99] are useful comparators for llame's replay and compaction projection.
2. **Approval policy.** Wildcard evaluation and default ask behavior[^packages-core-src-permission-ts-l76-l85] and pending approvals with saved rules[^packages-core-src-permission-ts-l190-l283] show a compact permission-to-suspension seam.

**Caution:** The cited local SQLite implementation does not demonstrate llame's datastore isolation requirements. Validate schema and migration assumptions separately before adapting its session model.

[^packages-core-src-session-sql-ts-l22-l176]: [Session, message, part, sequence, and context tables](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/session/sql.ts#L22-L176)

[^packages-core-src-session-history-ts-l13-l99]: [baseline-aware history loading](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/session/history.ts#L13-L99)

[^packages-core-src-permission-ts-l76-l85]: [Wildcard evaluation and default ask behavior](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/permission.ts#L76-L85)

[^packages-core-src-permission-ts-l190-l283]: [pending approvals with saved rules](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/permission.ts#L190-L283)
