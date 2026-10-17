---
type: Reference
title: "OpenCodex"
description: "MIT Bun-native local provider proxy that translates Codex Responses (and inbound Chat/Anthropic shapes) to many LLM backends, with ChatGPT account-pool affinity."
tags: [provider-proxy, codex, wire-translation, tool]
status: draft
resource: "https://github.com/lidge-jun/opencodex/tree/6936d9885d8a9bda9301737affcbaf1a4ff00e17"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "6936d9885d8a9bda9301737affcbaf1a4ff00e17"
sources:
  - id: ocx-readme-l83-l88
    resource: "https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/README.md#L83-L88"
    title: "Responses translation and ChatGPT account pool"
  - id: ocx-readme-l131-l139
    resource: "https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/README.md#L131-L139"
    title: "Quota routing, thread affinity, rebind cases"
  - id: ocx-agents-l5-l10
    resource: "https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/AGENTS.md#L5-L10"
    title: "Universal provider proxy; Bun TypeScript runtime"
  - id: ocx-overview-l15-l34
    resource: "https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/structure/overview.md#L15-L34"
    title: "Product boundary: local proxy, not binary patch"
  - id: ocx-overview-l60-l72
    resource: "https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/structure/overview.md#L60-L72"
    title: "~/.opencodex state; CODEX_HOME writes separate"
  - id: ocx-responses-l15-l17
    resource: "https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/structure/transports/responses.md#L15-L17"
    title: "/v1/responses parse, route, bridge stream"
  - id: ocx-catalog-l355-l392
    resource: "https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/structure/catalog.md#L355-L392"
    title: "Pool rotation sticky affinity and probe leases"
  - id: ocx-license-l1-l10
    resource: "https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/LICENSE#L1-L10"
    title: "MIT License"
---

# OpenCodex

- **Stack:** Bun-native TypeScript proxy (`ocx`) with React/Vite dashboard,
  optional Tauri desktop shell; no separate server compile
  step.[^ocx-agents-l5-l10] Site: [opencodex.me](https://opencodex.me). Package
  `@bitkyc08/opencodex`. **License:** MIT.[^ocx-license-l1-l10]

**Status:** Source and maintainer `structure/` docs inspection only; nothing was
run. This is a **provider proxy / wire translator**, not a Chat/Run host. Kept
under harnesses because it changes how peer coding agents obtain models; as a
llame research category it fits
[tools](../tools/index.md) better than meta-harness peers. High confidence on
product boundary from `structure/overview.md`; moderate on ToS and provider
compatibility risk.

**Study**

1. **Local proxy, not a patched CLI.** opencodex does not patch Codex binaries.
   It writes local Codex routing keys and a model catalog, then serves the
   Responses data plane at `http://127.0.0.1:<port>/v1/responses`.[^ocx-overview-l15-l34]
2. **Responses is the primary surface.** Ingress parses Responses input, routes
   to a provider adapter, and bridges adapter events back to Responses-compatible
   streaming. The same listener also answers Anthropic `/v1/messages` and OpenAI
   `/v1/chat/completions` as inbound translations onto that bridge (plus a native
   Anthropic passthrough branch).[^ocx-overview-l15-l34][^ocx-responses-l15-l17]
3. **Account pool with sticky affinity.** Pool mode routes across main plus added
   ChatGPT/Codex credentials. A conversation stays on its selected account while
   usable; failure can move it, success does not. Transient holds use half-open
   probes with generation-scoped leases rather than opening all at
   once.[^ocx-catalog-l355-l392][^ocx-readme-l131-l139] Useful vocabulary for
   credential rotation; not a substitute for llame Run identity.
4. **State roots are split.** Default `~/.opencodex/` (overridable by
   `OPENCODEX_HOME`) holds proxy config, auth and usage logs; `$CODEX_HOME` is a
   separate root that opencodex also edits. Deleting the opencodex root does not
   undo Codex-home writes — restore/eject owns that.[^ocx-overview-l60-l72]
5. **UI stays stock; model traffic swaps.** README demos show stock Codex /
   Claude Code / Claude Desktop / Grok Build clients with routed
   backends.[^ocx-readme-l83-l88] No session board, worktree isolation or PR
   lifecycle — those stay with the wrapped CLIs or a separate ADE.

**llame fit**

- Moderate: items 2 and 3 only if llame ever needs multi-provider wire
  translation or credential-pool semantics for a peer that hard-codes one vendor
  API.
- Low: as a meta-harness, Chat authority or Workspace host.
- Avoid: recommending ToS-sensitive proxying as a first-class llame feature;
  treating opencodex conversation affinity as Run identity.

**Caution:** Auth tokens and account pools are the real risk surface. Prefer
first-party multi-protocol peers ([OpenCode](./opencode.md), [Qwen Code](./qwen-code.md),
ACP adapters) when the goal is peer execution. Optional Compatibility Lab must
stay off the core request path per project invariants (documented in
`AGENTS.md`); this entry does not certify that boundary beyond source reading.

[^ocx-readme-l83-l88]: [Responses translation and ChatGPT account pool](https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/README.md#L83-L88)

[^ocx-readme-l131-l139]: [Quota routing, thread affinity, rebind cases](https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/README.md#L131-L139)

[^ocx-agents-l5-l10]: [Universal provider proxy; Bun TypeScript runtime](https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/AGENTS.md#L5-L10)

[^ocx-overview-l15-l34]: [Product boundary: local proxy, not binary patch](https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/structure/overview.md#L15-L34)

[^ocx-overview-l60-l72]: [~/.opencodex state; CODEX_HOME writes separate](https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/structure/overview.md#L60-L72)

[^ocx-responses-l15-l17]: [/v1/responses parse, route, bridge stream](https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/structure/transports/responses.md#L15-L17)

[^ocx-catalog-l355-l392]: [Pool rotation sticky affinity and probe leases](https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/structure/catalog.md#L355-L392)

[^ocx-license-l1-l10]: [MIT License](https://github.com/lidge-jun/opencodex/blob/6936d9885d8a9bda9301737affcbaf1a4ff00e17/LICENSE#L1-L10)
