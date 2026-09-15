---
type: Reference
title: "jcode"
description: "Host-detected gateway headers, per-instance session identity, and a bash-only risk gate"
resource: "https://github.com/1jehuang/jcode"
observed:
  date: "2026-09-15"
  revision: "752df77d3c13fa7a648eda257dbfcb8d3ea5974d"
sources:
  - id: crates-jcode-provider-openrouter-runtime-src-lib-rs-l433-l462
    resource: "https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-provider-openrouter-runtime/src/lib.rs#L433-L462"
    title: "is_opencode_api_base and apply_opencode_session_header"
  - id: crates-jcode-provider-openrouter-runtime-src-lib-rs-l928-l932
    resource: "https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-provider-openrouter-runtime/src/lib.rs#L928-L932"
    title: "conversation_id refreshed on fork"
  - id: crates-jcode-provider-core-src-lib-rs-l594-l595
    resource: "https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-provider-core/src/lib.rs#L594-L595"
    title: "JCODE_USER_AGENT"
  - id: changelog-v0-81-6-json-l1-l8
    resource: "https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/changelog/v0.81.6.json#L1-L8"
    title: "session-header fix entry"
  - id: crates-jcode-command-risk-src-lib-rs-l1-l33
    resource: "https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-command-risk/src/lib.rs#L1-L33"
    title: "command risk classifier rationale"
  - id: crates-jcode-app-core-src-tool-mod-rs-l799-l824
    resource: "https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-app-core/src/tool/mod.rs#L799-L824"
    title: "opt-in pre_tool hook"
  - id: crates-jcode-base-src-session-persistence-rs-l300-l396
    resource: "https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-base/src/session/persistence.rs#L300-L396"
    title: "snapshot plus journal persistence"
  - id: crates-jcode-base-src-mcp-protocol-rs-l189-l249
    resource: "https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-base/src/mcp/protocol.rs#L189-L249"
    title: "stdio-only MCP config"
  - id: src-main-rs-l1-l53
    resource: "https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/src/main.rs#L1-L53"
    title: "allocator tuning"
---

# jcode

- **Stack:** Rust workspace (about 90 crates), single binary per session; MIT

Single-user terminal agent advertising RAM efficiency. Listed by OpenCode Go
as a validated client from v0.81.6. Useful mainly as a compact example of
gateway-specific header injection and as a cautionary tool-gating model.

**Study**

1. **Host-detected gateway headers.** The OpenAI-compatible runtime sniffs
   `opencode.ai` hosts and injects
   `x-opencode-session`[^crates-jcode-provider-openrouter-runtime-src-lib-rs-l433-l462];
   the value is a UUID created per provider instance and refreshed on
   `fork()`[^crates-jcode-provider-openrouter-runtime-src-lib-rs-l928-l932],
   so a process restart changes it mid-conversation. The User-Agent is the
   crate-wide `jcode/<version>`[^crates-jcode-provider-core-src-lib-rs-l594-l595].
   The fix shipped against the gateway's 2026-09-05 enforcement
   date[^changelog-v0-81-6-json-l1-l8]. High confidence as a negative example
   for #809: llame should derive the session value from durable Chat
   identity, not from provider-instance lifetime.
2. **Snapshot plus journal persistence.** Each session writes a JSON snapshot
   and an append-only journal, with a startup-stub load that skips the
   transcript[^crates-jcode-base-src-session-persistence-rs-l300-l396].
   Low applicability; llame's Runs are Postgres rows, but the cheap partial
   reload is a pattern for list views.
3. **Allocator tuning.** jemalloc or glibc `mallopt` settings return freed
   pages quickly for a long-running process[^src-main-rs-l1-l53]. Moderate
   confidence that the same knobs apply to llame's long-lived API and worker
   processes; the PSS-sharing effect across per-session processes does not.

**Caution**

- Tool execution is fail-open by default. Only `bash` has a built-in risk
  gate, added because the tool otherwise ran with no gate of its
  own[^crates-jcode-command-risk-src-lib-rs-l1-l33]; every other tool relies
  on an off-by-default `pre_tool`
  hook[^crates-jcode-app-core-src-tool-mod-rs-l799-l824].
- MCP is stdio-only; HTTP and SSE entries parse and are silently
  skipped[^crates-jcode-base-src-mcp-protocol-rs-l189-l249], so valid-looking
  config can do nothing.
- Sessions and credentials are plain local files with no tenant model.

[^crates-jcode-provider-openrouter-runtime-src-lib-rs-l433-l462]: [`is_opencode_api_base` and `apply_opencode_session_header`](https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-provider-openrouter-runtime/src/lib.rs#L433-L462)

[^crates-jcode-provider-openrouter-runtime-src-lib-rs-l928-l932]: [`conversation_id` refreshed on fork](https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-provider-openrouter-runtime/src/lib.rs#L928-L932)

[^crates-jcode-provider-core-src-lib-rs-l594-l595]: [`JCODE_USER_AGENT`](https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-provider-core/src/lib.rs#L594-L595)

[^changelog-v0-81-6-json-l1-l8]: [session-header fix entry](https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/changelog/v0.81.6.json#L1-L8)

[^crates-jcode-command-risk-src-lib-rs-l1-l33]: [command risk classifier rationale](https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-command-risk/src/lib.rs#L1-L33)

[^crates-jcode-app-core-src-tool-mod-rs-l799-l824]: [opt-in `pre_tool` hook](https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-app-core/src/tool/mod.rs#L799-L824)

[^crates-jcode-base-src-session-persistence-rs-l300-l396]: [snapshot plus journal persistence](https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-base/src/session/persistence.rs#L300-L396)

[^crates-jcode-base-src-mcp-protocol-rs-l189-l249]: [stdio-only MCP config](https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-base/src/mcp/protocol.rs#L189-L249)

[^src-main-rs-l1-l53]: [allocator tuning](https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/src/main.rs#L1-L53)
