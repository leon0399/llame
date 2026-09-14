---
type: Reference
title: "OpenClaw"
description: "Primary alpha implementation reference for capabilities and behavior"
resource: "https://github.com/openclaw/openclaw"
observed:
  date: "2026-09-14"
  revision: "e3db9654277ba8ac19a6cd6bccbda57d13931924"
sources:
  - id: docs-concepts-memory-md-l9-l62
    resource: "https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/memory.md#L9-L62"
    title: "Core/episodic files and bootstrap limits"
  - id: docs-concepts-memory-md-l64-l89
    resource: "https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/memory.md#L64-L89"
    title: "imports remain source-specific"
  - id: src-routing-resolve-route-ts-l592-l680
    resource: "https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/routing/resolve-route.ts#L592-L680"
    title: "resolveAgentRoute"
  - id: src-routing-resolve-route-ts-l725-l799
    resource: "https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/routing/resolve-route.ts#L725-L799"
    title: "Ordered binding tiers"
  - id: src-config-sessions-session-accessor-sqlite-transcript-store-ts-l76-l89
    resource: "https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/config/sessions/session-accessor.sqlite-transcript-store.ts#L76-L89"
    title: "Transcript events are inserted into SQLite"
  - id: docs-concepts-session-search-md-l43-l53
    resource: "https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/session-search.md#L43-L53"
    title: "search contract"
  - id: docs-concepts-session-search-md-l26-l38
    resource: "https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/session-search.md#L26-L38"
    title: "Default session visibility"
  - id: src-agents-code-mode-ts-l69-l133
    resource: "https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/src/agents/code-mode.ts#L69-L133"
    title: "bounded catalog index"
  - id: docs-tools-code-mode-internals-md
    resource: "https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/docs/tools/code-mode/internals.md"
    title: "Code Mode runtime and security boundary"
  - id: src-agents-code-mode-execution-ts-l598-l604
    resource: "https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/src/agents/code-mode-execution.ts#L598-L604"
    title: "resume ownership check"
---

# OpenClaw

- **Stack:** TypeScript; multi-channel gateway; Markdown memory; SQLite session/transcript state and search

Primary alpha reference for capability behavior, with concrete routing, memory, and transcript-search implementations. High confidence in the cited mechanisms; llame retains canonical Chat/Run identity and its own storage contracts.

For coding capabilities and tool behavior, [OMP (oh-my-pi)](./oh-my-pi.md) has
primary reference priority.

**Study**

1. **F28: Canonical files and explicit imports.** Core/episodic files and bootstrap limits[^docs-concepts-memory-md-l9-l62] distinguish curated root memory from daily notes; imports remain source-specific[^docs-concepts-memory-md-l64-l89]. High confidence applicability to llame's source/projection boundary and Knowledge imports.
2. **F29: Deterministic inbound routing.** `resolveAgentRoute`[^src-routing-resolve-route-ts-l592-l680] normalizes channel/account/peer inputs, derives a stable session key and last-route policy. Ordered binding tiers[^src-routing-resolve-route-ts-l725-l799] resolve peer, parent-peer, wildcard, guild/role, team, account, and channel matches. Moderate-confidence comparison for future llame inbound routing; OpenClaw's channel peers are not executor-adapter identities.

3. **F30: Transcript authority and search.** Transcript events are inserted into SQLite[^src-config-sessions-session-accessor-sqlite-transcript-store-ts-l76-l89]. The search contract[^docs-concepts-session-search-md-l43-l53] indexes new messages transactionally and reports incomplete reconciliation. Compare these source/projection boundaries with llame's canonical messages and search coverage.
4. **F31: Code Mode sandbox and bounded catalog index.** Opt-in `exec`/`wait` tools run model-authored JS/TS in a QuickJS-WASI guest inside a worker thread with no filesystem, network, imports, or environment; native tools are guest globals and MCP tools sit under `MCP.<server>.<tool>()` (runtime and security boundary[^docs-tools-code-mode-internals-md]). The `exec` description carries an index capped at 8000 chars that skips oversized entries rather than truncating and omits MCP prose so catalog text cannot steer the model[^src-agents-code-mode-ts-l69-l133]; `wait` refuses to resume a run from another session[^src-agents-code-mode-execution-ts-l598-l604]. High confidence for the catalog-index rule and ownership check; the no-imports guest conflicts with llame's dependency-import goal. See the [code-mode deep dive](../tool-harness/2026-09-14-code-mode-eval-tool.md).

**Caution:** Default session visibility[^docs-concepts-session-search-md-l26-l38] permits broad cross-agent access. Preserve llame's owner-scoped datastore authorization rather than copying those defaults. Code Mode caps (64 suspended runs, one worker pool) are per process, not per tenant.

[^docs-concepts-memory-md-l9-l62]: [Core/episodic files and bootstrap limits](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/memory.md#L9-L62)

[^docs-concepts-memory-md-l64-l89]: [imports remain source-specific](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/memory.md#L64-L89)

[^src-routing-resolve-route-ts-l592-l680]: [`resolveAgentRoute`](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/routing/resolve-route.ts#L592-L680)

[^src-routing-resolve-route-ts-l725-l799]: [Ordered binding tiers](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/routing/resolve-route.ts#L725-L799)

[^src-config-sessions-session-accessor-sqlite-transcript-store-ts-l76-l89]: [Transcript events are inserted into SQLite](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/config/sessions/session-accessor.sqlite-transcript-store.ts#L76-L89)

[^docs-concepts-session-search-md-l43-l53]: [search contract](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/session-search.md#L43-L53)

[^docs-concepts-session-search-md-l26-l38]: [Default session visibility](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/session-search.md#L26-L38)

[^src-agents-code-mode-ts-l69-l133]: [bounded catalog index](https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/src/agents/code-mode.ts#L69-L133)

[^docs-tools-code-mode-internals-md]: [Code Mode runtime and security boundary](https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/docs/tools/code-mode/internals.md)

[^src-agents-code-mode-execution-ts-l598-l604]: [resume ownership check](https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/src/agents/code-mode-execution.ts#L598-L604)
