---
type: Reference
title: "agent-memory"
description: "Derived memory indexes and federated retrieval"
resource: "https://github.com/xChuCx/agent-memory"
observed:
  date: "2026-09-10"
  revision: "e42f455865538a59110c6510ae8e340969feb810"
sources:
  - id: docs-eval-retrieval-md-l1-l13
    resource: "https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/docs/eval/retrieval.md#L1-L13"
    title: "deterministic retrieval regression evaluation"
  - id: eval-behavioural-readme-md-l11-l37
    resource: "https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/eval/behavioural/README.md#L11-L37"
    title: "behavioral evaluation is explicitly a scaffold with no published number"
  - id: internal-config-stores-lock-go-l12-l75
    resource: "https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/config/stores_lock.go#L12-L75"
    title: "stores.lock"
  - id: internal-memory-fetch-stores-go-l10-l25
    resource: "https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/memory/fetch_stores.go#L10-L25"
    title: "federation skips unrecorded material"
  - id: internal-memory-fetch-go-l540-l559
    resource: "https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/memory/fetch.go#L540-L559"
    title: "Rendered chunks carry origin and evidence framing"
  - id: internal-memory-update-go-l464-l492
    resource: "https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/memory/update.go#L464-L492"
    title: "secret/PII findings reject the final bytes"
  - id: internal-git-commit-go-l45-l86
    resource: "https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/git/commit.go#L45-L86"
    title: "Commit"
---

# agent-memory

- **Stack:** Go; Markdown stores; SQLite FTS5; git; MCP stdio server

Small, current reference for staged Markdown memory, imported-store pinning, inline provenance, and write-time secret/PII rejection. Its retrieval evaluation is a deterministic search regression fixture[^docs-eval-retrieval-md-l1-l13]; its behavioral evaluation is explicitly a scaffold with no published number[^eval-behavioural-readme-md-l11-l37]. Applicability is moderate for llame's owner-scoped Knowledge operations and any later imported-store capability.

**Study**

1. **Imported versus local pinning.** `stores.lock`[^internal-config-stores-lock-go-l12-l75] records resolved commits for imported stores and marks non-git local paths `Unlocked`; federation skips unrecorded material[^internal-memory-fetch-stores-go-l10-l25]. High confidence applicability to llame's Knowledge imports and explicit uncertainty.
2. **Provenance and write gates.** Rendered chunks carry origin and evidence framing[^internal-memory-fetch-go-l540-l559], while secret/PII findings reject the final bytes[^internal-memory-update-go-l464-l492] before staging. Moderate confidence for comparison with llame's native file operations; llame's owner and approval model remains separate.

**Caution:** local memory is not content-addressed: `Commit`[^internal-git-commit-go-l45-l86] returns an informational SHA and can swallow `rev-parse` failure. Do not treat it as a verified read snapshot.

[^docs-eval-retrieval-md-l1-l13]: [deterministic retrieval regression evaluation](https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/docs/eval/retrieval.md#L1-L13)

[^eval-behavioural-readme-md-l11-l37]: [behavioral evaluation is explicitly a scaffold with no published number](https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/eval/behavioural/README.md#L11-L37)

[^internal-config-stores-lock-go-l12-l75]: [`stores.lock`](https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/config/stores_lock.go#L12-L75)

[^internal-memory-fetch-stores-go-l10-l25]: [federation skips unrecorded material](https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/memory/fetch_stores.go#L10-L25)

[^internal-memory-fetch-go-l540-l559]: [Rendered chunks carry origin and evidence framing](https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/memory/fetch.go#L540-L559)

[^internal-memory-update-go-l464-l492]: [secret/PII findings reject the final bytes](https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/memory/update.go#L464-L492)

[^internal-git-commit-go-l45-l86]: [`Commit`](https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/git/commit.go#L45-L86)
