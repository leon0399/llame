---
type: Reference
title: "gbrain"
description: "File-backed knowledge and provenance-aware recall"
resource: "https://github.com/garrytan/gbrain"
observed:
  date: "2026-09-10"
  revision: "43597b19e50a3abf56409337f248f7966860293c"
sources:
  - id: docs-architecture-system-of-record-md-l3-l18
    resource: "https://github.com/garrytan/gbrain/blob/43597b19e50a3abf56409337f248f7966860293c/docs/architecture/system-of-record.md#L3-L18"
    title: "The system-of-record contract"
  - id: docs-architecture-system-of-record-md-l125-l142
    resource: "https://github.com/garrytan/gbrain/blob/43597b19e50a3abf56409337f248f7966860293c/docs/architecture/system-of-record.md#L125-L142"
    title: "forget rewrites the canonical fence"
  - id: src-core-think-sanitize-ts-l54-l105
    resource: "https://github.com/garrytan/gbrain/blob/43597b19e50a3abf56409337f248f7966860293c/src/core/think/sanitize.ts#L54-L105"
    title: "sanitize.ts"
  - id: src-schema-sql-l1563-l1618
    resource: "https://github.com/garrytan/gbrain/blob/43597b19e50a3abf56409337f248f7966860293c/src/schema.sql#L1563-L1618"
    title: "RLS is enabled with no policies"
---

# gbrain

- **Stack:** TypeScript; Markdown repository; Postgres/PGLite retrieval projection

Personal knowledge brain whose Markdown files are the system of record and whose database supports retrieval and graph queries. It is a narrow, high-confidence reference for source-versus-projection boundaries and durable forget semantics. llame already treats Knowledge as owner-scoped Markdown; the useful comparison is write and rebuild discipline rather than gbrain's database or security posture.

**Study**

1. **Fence-first persistence.** The system-of-record contract[^docs-architecture-system-of-record-md-l3-l18] makes Postgres disposable and rebuildable from Markdown; forget rewrites the canonical fence[^docs-architecture-system-of-record-md-l125-l142], so deletion survives index reconstruction. High confidence applicability to llame's existing native Knowledge file operations, subject to its `kb://` locator and owner authorization.
2. **Layered untrusted-data framing.** `sanitize.ts`[^src-core-think-sanitize-ts-l54-l105] applies structural tags, pattern stripping, length limits, and tells the model that retrieved material is data rather than instructions. Moderate confidence for llame context assembly; it still requires llame's authorization and provenance checks.

**Caution:** RLS is enabled with no policies[^src-schema-sql-l1563-l1618], for deployments using a bypass role. This is not a per-tenant policy model to copy into llame. Deep dive: [2026-07-09-gbrain.md](../long-term-memory/2026-07-09-gbrain.md).

[^docs-architecture-system-of-record-md-l3-l18]: [The system-of-record contract](https://github.com/garrytan/gbrain/blob/43597b19e50a3abf56409337f248f7966860293c/docs/architecture/system-of-record.md#L3-L18)

[^docs-architecture-system-of-record-md-l125-l142]: [forget rewrites the canonical fence](https://github.com/garrytan/gbrain/blob/43597b19e50a3abf56409337f248f7966860293c/docs/architecture/system-of-record.md#L125-L142)

[^src-core-think-sanitize-ts-l54-l105]: [`sanitize.ts`](https://github.com/garrytan/gbrain/blob/43597b19e50a3abf56409337f248f7966860293c/src/core/think/sanitize.ts#L54-L105)

[^src-schema-sql-l1563-l1618]: [RLS is enabled with no policies](https://github.com/garrytan/gbrain/blob/43597b19e50a3abf56409337f248f7966860293c/src/schema.sql#L1563-L1618)
