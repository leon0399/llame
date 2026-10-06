---
type: Reference
title: "Orca"
description: "Agent Development Environment with negotiated native adapters, PTY fallbacks, durable provider resume, and host-scoped local/remote/cloud workspaces"
resource: "https://github.com/stablyai/orca"
tags:
  - harness
  - multi-agent
  - native-adapters
  - pty
  - continuation
  - worktrees
  - remote-runtime
  - permissions
status: stable
generated:
  by: "human:leon0399"
  at: "2026-10-06"
observed:
  date: "2026-10-06"
  revision: "d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef"
sources:
  - id: website-home
    resource: "https://www.onorca.dev/"
    title: "Orca homepage positioning"
  - id: website-docs-what-is-orca
    resource: "https://www.onorca.dev/docs"
    title: "What is Orca?"
  - id: website-docs-ways-to-run
    resource: "https://www.onorca.dev/docs/ways-to-run"
    title: "Ways to run Orca"
  - id: website-docs-mobile
    resource: "https://www.onorca.dev/docs/mobile"
    title: "Mobile companion"
  - id: website-docs-usage-tracking
    resource: "https://www.onorca.dev/docs/agents/usage-tracking"
    title: "Usage and rate-limit tracking"
  - id: src-readme-l256-l277
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/README.md#L256-L277"
    title: "Orca development layout and license"
  - id: src-license-l1-l4
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/LICENSE#L1-L4"
    title: "Orca MIT license"
  - id: src-main-native-chat-agent-session-wire-structured-agent-session-adapter-ts-l248-l387
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/native-chat/agent-session-wire/structured-agent-session-adapter.ts#L248-L387"
    title: "Structured adapter lifecycle contract"
  - id: src-main-claude-claude-agent-sdk-process-spawn-ts-l37-l86
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/claude/claude-agent-sdk-process-spawn.ts#L37-L86"
    title: "Orca-owned Claude Agent SDK spawn"
  - id: src-main-codex-codex-app-server-connection-ts-l30-l245
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/codex/codex-app-server-connection.ts#L30-L245"
    title: "Persistent Codex app-server connection"
  - id: src-main-acp-acp-agent-connection-ts-l18-l149
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/acp/acp-agent-connection.ts#L18-L149"
    title: "ACP process ownership seam"
  - id: src-main-acp-acp-session-setup-ts-l23-l84
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/acp/acp-session-setup.ts#L23-L84"
    title: "ACP new/load/resume and authentication"
  - id: src-main-acp-acp-permission-requests-ts-l43-l143
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/acp/acp-permission-requests.ts#L43-L143"
    title: "ACP permission decoding and cancellation"
  - id: src-main-native-chat-agent-session-wire-structured-agent-registry-ts-l1-l68
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/native-chat/agent-session-wire/structured-agent-registry.ts#L1-L68"
    title: "Registered structured-agent capability checks"
  - id: src-main-runtime-rpc-methods-structured-agent-session-agents-ts-l1-l23
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/runtime/rpc/methods/structured-agent-session-agents.ts#L1-L23"
    title: "Negotiated agentSession.agents method"
  - id: src-shared-structured-native-chat-launch-route-ts-l93-l145
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/structured-native-chat-launch-route.ts#L93-L145"
    title: "Structured launch host and capability gates"
  - id: src-shared-agent-hook-types-ts-l6-l30
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/agent-hook-types.ts#L6-L30"
    title: "Agent hook target roster"
  - id: src-main-runtime-runtime-worktree-pty-agent-sources-ts-l20-l83
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/runtime/runtime-worktree-pty-agent-sources.ts#L20-L83"
    title: "PTY status evidence admission"
  - id: src-shared-agent-session-record-ts-l35-l150
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/agent-session-record.ts#L35-L150"
    title: "Durable session location, account home, and lease"
  - id: src-shared-agent-session-record-ts-l178-l229
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/agent-session-record.ts#L178-L229"
    title: "Host/workspace scope and process identity validation"
  - id: src-shared-agent-session-provider-handle-ts-l42-l107
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/agent-session-provider-handle.ts#L42-L107"
    title: "Opaque provider handle chain"
  - id: src-shared-agent-session-provider-handle-ts-l196-l270
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/agent-session-provider-handle.ts#L196-L270"
    title: "Provider handle chain append invariants"
  - id: src-shared-agent-resume-argv-ts-l6-l79
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/agent-resume-argv.ts#L6-L79"
    title: "Provider-specific CLI resume argv"
  - id: src-shared-agent-session-resume-ts-l126-l286
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/agent-session-resume.ts#L126-L286"
    title: "Hook-derived provider session metadata"
  - id: src-shared-execution-host-ts-l5-l69
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/execution-host.ts#L5-L69"
    title: "Local, SSH, and runtime execution-host ids"
  - id: src-shared-worktree-identity-ts-l3-l25
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/worktree/identity.ts#L3-L25"
    title: "Path-independent worktree identity"
  - id: src-shared-worktree-types-ts-l66-l183
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/worktree/types.ts#L66-L183"
    title: "Worktree host, runtime, and creator provenance"
  - id: src-shared-worktree-create-preparation-ts-l1-l42
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/worktree/create-preparation.ts#L1-L42"
    title: "Worktree preparation lock proof"
  - id: src-shared-mobile-relay-pairing-offer-ts-l9-l106
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/mobile-relay-pairing-offer.ts#L9-L106"
    title: "Versioned mobile and relay pairing offer"
  - id: src-main-runtime-rpc-mobile-e2ee-auth-validation-ts-l13-l59
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/runtime/rpc/mobile-e2ee-auth-validation.ts#L13-L59"
    title: "Transcript-bound mobile E2EE authentication"
  - id: src-main-runtime-rpc-mobile-e2ee-v2-key-schedule-ts-l6-l32
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/runtime/rpc/mobile-e2ee-v2-key-schedule.ts#L6-L32"
    title: "Mobile E2EE v2 key schedule"
  - id: src-shared-mobile-pairing-connection-mode-ts-l1-l40
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/mobile-pairing-connection-mode.ts#L1-L40"
    title: "Mobile relay versus local-only pairing mode"
  - id: src-cloud-readme-l1-l12
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/cloud/README.md#L1-L12"
    title: "Relay topology and license"
  - id: src-shared-ephemeral-vm-recipes-ts-l39-l132
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/ephemeral-vm-recipes.ts#L39-L132"
    title: "Ephemeral VM recipe connection/result schemas"
  - id: src-shared-ephemeral-vm-recipe-runner-ts-l108-l303
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/ephemeral-vm-recipe-runner.ts#L108-L303"
    title: "Ephemeral VM create/destroy/suspend/resume commands"
  - id: src-shared-tui-agent-permissions-ts-l6-l39
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/tui-agent-permissions.ts#L6-L39"
    title: "YOLO permission flag roster"
  - id: src-shared-tui-agent-launch-defaults-ts-l12-l20
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/tui-agent-launch-defaults.ts#L12-L20"
    title: "Bypass defaults"
  - id: src-shared-tui-agent-launch-defaults-ts-l128-l156
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/tui-agent-launch-defaults.ts#L128-L156"
    title: "Resolved permission-bypass posture"
  - id: src-main-claude-claude-structured-inbound-control-ts-l23-l85
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/claude/claude-structured-inbound-control.ts#L23-L85"
    title: "Claude deny-safe permission callback"
  - id: src-main-codex-codex-structured-permission-policy-ts-l4-l49
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/codex/codex-structured-permission-policy.ts#L4-L49"
    title: "Codex provider-enforced permission policy"
  - id: src-main-runtime-structured-agent-account-home-ts-l5-l55
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/runtime/structured-agent-account-home.ts#L5-L55"
    title: "Structured account-home resolution"
  - id: src-renderer-components-settings-provider-account-scope-ts-l15-l91
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/renderer/src/components/settings/provider-account-scope.ts#L15-L91"
    title: "Local versus remote provider account scope"
  - id: src-renderer-runtime-runtime-provider-accounts-client-ts-l70-l302
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/renderer/src/runtime/runtime-provider-accounts-client.ts#L70-L302"
    title: "Runtime-owned provider account synchronization"
  - id: src-main-rate-limits-opencode-go-usage-source-selection-ts-l91-l152
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/rate-limits/opencode-go-usage-source-selection.ts#L91-L152"
    title: "OpenCode Go API-key-first usage selection"
  - id: src-main-rate-limits-opencode-go-api-key-source-ts-l215-l269
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/rate-limits/opencode-go-api-key-source.ts#L215-L269"
    title: "OpenCode Go credential precedence"
  - id: src-main-rate-limits-opencode-go-usage-api-ts-l8-l68
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/rate-limits/opencode-go-usage-api.ts#L8-L68"
    title: "OpenCode Go bearer usage endpoint"
  - id: src-main-rate-limits-opencode-go-usage-fetcher-ts-l17-l130
    resource: "https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/rate-limits/opencode-go-usage-fetcher.ts#L17-L130"
    title: "OpenCode console-cookie fallback and cookie clearing"
---

# Orca

- **Stack:** Electron and TypeScript desktop with `src/`, `cloud/`, `mobile/`, and `native/` satellites; MIT (Lovecast Inc.)[^src-readme-l256-l277][^src-license-l1-l4]

The website positions Orca as an **Agent Development Environment (ADE)**: "Ship 100x," run Claude Code, Codex, or any coding agent in parallel, and keep terminals, diffs, browser, and CLI in one app[^website-home]. Its docs describe local desktop, SSH targets, self-hosted Orca servers, and per-workspace cloud VMs, while explicitly saying that machines, providers, and billing remain user-controlled[^website-docs-what-is-orca][^website-docs-ways-to-run]. Those are product-positioning claims; the source inspection below separates the shipped adapter, identity, and boundary mechanisms from the marketing surface.

Evidence is source inspection plus public website text. No Orca binary, provider CLI, mobile app, relay, or cloud recipe was executed.

**Study**

1. **Native adapters are negotiated; PTY remains the broad fallback.** The host contract covers acquisition, dispatch, per-turn cancel, prompt answering, compaction, rewind, provider-history reconciliation, and proven close/release, with explicit `unknown` outcomes rather than guessed delivery[^src-main-native-chat-agent-session-wire-structured-agent-session-adapter-ts-l248-l387]. Claude is launched through the Agent SDK, but Orca supplies and supervises the child so it retains pid and exit-proof ownership[^src-main-claude-claude-agent-sdk-process-spawn-ts-l37-l86]. Codex is a persistent `codex app-server` JSON-RPC child with an initialize handshake and per-request deadlines; the source explicitly rejects a request-scoped runner because approvals and streamed turns need a bidirectional long-lived connection[^src-main-codex-codex-app-server-connection-ts-l30-l245].

   Orca has a standalone ACP client seam: the execution host owns the child and protocol lifetime, ACP sessions can `new`, `load`, or `resume` and retry authentication, and malformed or unusable permission answers collapse to cancellation[^src-main-acp-acp-agent-connection-ts-l18-l149][^src-main-acp-acp-session-setup-ts-l23-l84][^src-main-acp-acp-permission-requests-ts-l43-l143]. The native router itself is registration-driven: a definition must have adapter methods for every declared capability, and `agentSession.agents` exposes additional host-registered definitions only behind a negotiated capability[^src-main-native-chat-agent-session-wire-structured-agent-registry-ts-l1-l68][^src-main-runtime-rpc-methods-structured-agent-session-agents-ts-l1-l23]. High confidence for #29: a uniform host interface can separate lifecycle/receipt semantics from provider transport; moderate confidence for #778: ACP's deny-safe request path is a useful pending-prompt shape. Do not infer that the ACP source seam makes every CLI a first-class native-chat adapter; the product's ordinary broad path is terminal/PTY.

2. **PTY status is evidence, not provider semantics.** The hook roster has 22 targets, including Claude, Codex, Gemini, and Cursor; it does not list OpenCode, Pi, or OMP[^src-shared-agent-hook-types-ts-l6-l30]. The runtime admits hook rows together with connected terminal/pane/handle evidence, drops restored-unconfirmed and provider-session-only rows, and explicitly skips the connected-process gate only for structured rows whose owning host supplies liveness[^src-main-runtime-runtime-worktree-pty-agent-sources-ts-l20-l83]. This is a useful host projection, but it is not a transcript or a provider receipt: a PTY peer's approval semantics, tool list, and exact model state remain outside Orca's protocol. Moderate confidence for #29 and #765: llame can expose a common status row with an evidence class, while reserving stronger receipts for peers that actually speak a bidirectional protocol.

3. **Durable identity separates location, account, process, and provider continuity.** `AgentSessionRecord` schema 2 stores an execution location (host id, optional WSL distro, workspace id/kind), provider name, an opaque provider-handle chain, the account home, options, launch args, and a fenced lease. Process identity includes host, pid, optional start time, and a spawn token; scope keys include host, distro, workspace, and kind so native, WSL, SSH, and runtime copies cannot adjudicate one another[^src-shared-agent-session-record-ts-l35-l150][^src-shared-agent-session-record-ts-l178-l229]. Provider handles keep the provider transport, agent, native conversation id, and adapter-owned resume cursor opaque to shared code. Links record `created`/`adopted`/`resumed`/`forked` origin and fence; append rejects provider mismatches, stale fences, and a resume that actually forked to another identity root[^src-shared-agent-session-provider-handle-ts-l42-l107][^src-shared-agent-session-provider-handle-ts-l196-l270].

   The non-structured path delegates resume to the peer: `getAgentResumeArgv` maps each supported CLI to its own flag or transcript locator, while hook metadata preserves authoritative transcript paths where ids do not name the file (Claude), where Pi-family identity is file-based, and where an OMP transcript is optional[^src-shared-agent-resume-argv-ts-l6-l79][^src-shared-agent-session-resume-ts-l126-l286]. High confidence for #756/#758: host/workspace/account/process identity should be separate records; moderate confidence for #1047 and #309: a provider-history window plus an opaque handle is a safer continuation boundary than replaying an assumed transcript. The record can outlive a process, but provider-native resume determines whether continuity exists.

4. **Worktree, device, and cloud boundaries are explicit—and not interchangeable.** Execution hosts are typed as `local`, `ssh:<target>`, or `runtime:<environment>`; worktree rows carry host ownership, runtime-owner projection, host setup, ephemeral-VM checkout mode, and creator provenance[^src-shared-execution-host-ts-l5-l69][^src-shared-worktree-types-ts-l66-l183]. A worktree's canonical identity excludes its mutable path and combines execution host with an instance id, while preparation cleanup trusts the Git lock reason rather than a path-shaped `.orca-preparing` directory[^src-shared-worktree-identity-ts-l3-l25][^src-shared-worktree-create-preparation-ts-l1-l42]. Native structured launch is allowed on the local/owning runtime host but is refused for an SSH execution host, floating workspace, WSL/project-runtime mismatch, or a client/host without the negotiated capability[^src-shared-structured-native-chat-launch-route-ts-l93-l145].

   Per-workspace cloud execution is a recipe boundary, not an Orca-hosted inference service: strict result schemas describe Orca-server or SSH connections, and create/destroy/suspend/resume invoke repository-defined commands with bounded captured output[^src-shared-ephemeral-vm-recipes-ts-l39-l132][^src-shared-ephemeral-vm-recipe-runner-ts-l108-l303]. Mobile pairing is separately scoped: v2 offers carry a device token, pinned desktop public key, optional `mobile`/`runtime` scope, and relay metadata; runtime-scope offers reject the mobile relay shape[^src-shared-mobile-relay-pairing-offer-ts-l9-l106]. E2EE v2 binds authentication to an exact transcript hash and derives directional keys/session id from the shared secret and both nonces[^src-main-runtime-rpc-mobile-e2ee-auth-validation-ts-l13-l59][^src-main-runtime-rpc-mobile-e2ee-v2-key-schedule-ts-l6-l32]. The public mobile docs describe this companion as a read-mostly view over the desktop session, not a separate cloud agent[^website-docs-mobile]. Automatic mobile pairing requires a signed-in desktop for Relay and otherwise becomes local-only; the relay workspace describes outbound phone/desktop WebSockets to relay cells[^src-shared-mobile-pairing-connection-mode-ts-l1-l40][^src-cloud-readme-l1-l12]. Moderate confidence for #758/#759/#972: make execution host, device authorization, and provider/cloud account separate llame scopes; do not treat a paired device, SSH target, or recipe result as proof of a shared tenant.

5. **Permission posture is bypass-first; structured providers make the selected policy explicit.** The default TUI argument table is a YOLO table covering most supported CLIs, and the resolved empty Arguments field falls back to that bypass flag until a user chooses otherwise[^src-shared-tui-agent-permissions-ts-l6-l39][^src-shared-tui-agent-launch-defaults-ts-l12-l20][^src-shared-tui-agent-launch-defaults-ts-l128-l156]. Claude's structured callback registers a durable prompt, denies malformed requests, and settles cancellation with `null` rather than authorizing a late answer[^src-main-claude-claude-structured-inbound-control-ts-l23-l85]. Codex's structured adapter converts the resolved setting to an explicit provider policy: bypass is `approvalPolicy: never` plus `danger-full-access`, while Manual is `on-request` plus `workspace-write`; it deliberately says a policy rather than inheriting an ambiguous config or resume state[^src-main-codex-codex-structured-permission-policy-ts-l4-l49]. High confidence for #763 and #778: llame should keep provider policy, host admission, and durable prompt settlement distinct; Orca's default is not a safe baseline to copy.

6. **Account and provider state follows the execution owner.** Structured launches resolve and pin the Claude config directory or Codex home once; the resolver is shared with record-less model reads so account selection cannot drift between the picker and the created session[^src-main-runtime-structured-agent-account-home-ts-l5-l55]. The accounts UI labels local credentials as desktop-owned and remote credentials as server-owned; local reads are one-shot, while a remote runtime uses an `accounts.subscribe` stream and routes account selection/removal to that active runtime instead of mutating local state[^src-renderer-components-settings-provider-account-scope-ts-l15-l91][^src-renderer-runtime-runtime-provider-accounts-client-ts-l70-l302].

   The OpenCode Go usage path tries a user override or provider-owned API key first and calls the bearer-authenticated `/zen/go/v1/usage` endpoint; when no key exists, or when a keyed request fails while a cookie is configured, it can fall back to the console-cookie path for legacy accounts. The keyed endpoint classifies unauthorized and no-subscription outcomes separately[^src-main-rate-limits-opencode-go-usage-source-selection-ts-l91-l152][^src-main-rate-limits-opencode-go-usage-api-ts-l8-l68]. Key precedence is explicit settings, OpenCode v2 credential database, v1 inline/auth-file stores, then `OPENCODE_API_KEY`, with an unreadable v2 database withholding the shared env key rather than risking a Zen/Go mix-up[^src-main-rate-limits-opencode-go-api-key-source-ts-l215-l269]. The cookie path filters to known auth cookies, uses an isolated Electron session, and clears its cookie jar after each request[^src-main-rate-limits-opencode-go-usage-fetcher-ts-l17-l130]. The usage documentation describes the full-cookie route[^website-docs-usage-tracking].

**Caution**

- **Native/structured support is not universal.** Claude and Codex remain the built-in structured definitions; additional definitions require host registration and capability negotiation. SSH worktrees and ordinary remote SSH targets can be fully useful while still using PTY, not the structured adapter.
- **Bypass is still the shipped default.** A structured callback can deny malformed or cancelled requests, but it does not turn a YOLO launch into a policy-enforced sandbox. Account homes and provider credentials remain execution-host concerns; a device token or runtime pairing is not a tenant or workspace authorization proof.
- **PTY provenance stops at what Orca can observe.** Hook rows and scrollback can show status, prompt text, or a last assistant message, but not the peer's hidden system prompt, complete tool policy, or a provider-confirmed delivery. An llame receipt must name this ceiling rather than imply semantic execution evidence.
- **Resume is provider-native and can fork or become unprovable.** Opaque handles, transcript paths, account-home pinning, fences, and process identity checks prevent several classes of drift, but they do not manufacture a provider session after the CLI has discarded it. An unknown transport outcome must not be silently retried.
- **Mobile is encrypted but bearer-authorized at the device boundary.** Current code validates the exact v2 transcript shape/hash and then resolves a presented device token; source inspection here does not establish per-workspace authorization at that function. Pairing scope and relay/local mode must therefore stay explicit in any llame remote-control design.
- **Cloud recipes are user-controlled command execution.** Orca validates and runs recipe-defined lifecycle commands and accepts a connection result; the website says provider accounts and billing remain yours. That is a useful boundary for llame's #756/#758 work, not evidence of a hosted sandbox or a secret-isolation guarantee.
- **Website and source can move at different speeds.** The public framing says any CLI, mobile steering, and cloud/remote modes; source inspection should be the authority for adapter support, account ownership, permission defaults, and protocol-level guarantees. No adoption is implied by this prior-art note.

[^website-home]: [Orca homepage positioning](https://www.onorca.dev/)

[^website-docs-what-is-orca]: [What is Orca?](https://www.onorca.dev/docs)

[^website-docs-ways-to-run]: [Ways to run Orca](https://www.onorca.dev/docs/ways-to-run)

[^website-docs-mobile]: [Mobile companion](https://www.onorca.dev/docs/mobile)

[^website-docs-usage-tracking]: [Usage and rate-limit tracking](https://www.onorca.dev/docs/agents/usage-tracking)

[^src-readme-l256-l277]: [Orca development layout and license](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/README.md#L256-L277)

[^src-license-l1-l4]: [Orca MIT license](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/LICENSE#L1-L4)

[^src-main-native-chat-agent-session-wire-structured-agent-session-adapter-ts-l248-l387]: [Structured adapter lifecycle contract](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/native-chat/agent-session-wire/structured-agent-session-adapter.ts#L248-L387)

[^src-main-claude-claude-agent-sdk-process-spawn-ts-l37-l86]: [Orca-owned Claude Agent SDK spawn](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/claude/claude-agent-sdk-process-spawn.ts#L37-L86)

[^src-main-codex-codex-app-server-connection-ts-l30-l245]: [Persistent Codex app-server connection](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/codex/codex-app-server-connection.ts#L30-L245)

[^src-main-acp-acp-agent-connection-ts-l18-l149]: [ACP process ownership seam](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/acp/acp-agent-connection.ts#L18-L149)

[^src-main-acp-acp-session-setup-ts-l23-l84]: [ACP new/load/resume and authentication](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/acp/acp-session-setup.ts#L23-L84)

[^src-main-acp-acp-permission-requests-ts-l43-l143]: [ACP permission decoding and cancellation](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/acp/acp-permission-requests.ts#L43-L143)

[^src-main-native-chat-agent-session-wire-structured-agent-registry-ts-l1-l68]: [Registered structured-agent capability checks](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/native-chat/agent-session-wire/structured-agent-registry.ts#L1-L68)

[^src-main-runtime-rpc-methods-structured-agent-session-agents-ts-l1-l23]: [Negotiated `agentSession.agents` method](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/runtime/rpc/methods/structured-agent-session-agents.ts#L1-L23)

[^src-shared-structured-native-chat-launch-route-ts-l93-l145]: [Structured launch host and capability gates](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/structured-native-chat-launch-route.ts#L93-L145)

[^src-shared-agent-hook-types-ts-l6-l30]: [Agent hook target roster](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/agent-hook-types.ts#L6-L30)

[^src-main-runtime-runtime-worktree-pty-agent-sources-ts-l20-l83]: [PTY status evidence admission](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/runtime/runtime-worktree-pty-agent-sources.ts#L20-L83)

[^src-shared-agent-session-record-ts-l35-l150]: [Durable session location, account home, and lease](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/agent-session-record.ts#L35-L150)

[^src-shared-agent-session-record-ts-l178-l229]: [Host/workspace scope and process identity validation](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/agent-session-record.ts#L178-L229)

[^src-shared-agent-session-provider-handle-ts-l42-l107]: [Opaque provider handle chain](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/agent-session-provider-handle.ts#L42-L107)

[^src-shared-agent-session-provider-handle-ts-l196-l270]: [Provider handle chain append invariants](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/agent-session-provider-handle.ts#L196-L270)

[^src-shared-agent-resume-argv-ts-l6-l79]: [Provider-specific CLI resume argv](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/agent-resume-argv.ts#L6-L79)

[^src-shared-agent-session-resume-ts-l126-l286]: [Hook-derived provider session metadata](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/agent-session-resume.ts#L126-L286)

[^src-shared-execution-host-ts-l5-l69]: [Local, SSH, and runtime execution-host ids](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/execution-host.ts#L5-L69)

[^src-shared-worktree-identity-ts-l3-l25]: [Path-independent worktree identity](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/worktree/identity.ts#L3-L25)

[^src-shared-worktree-types-ts-l66-l183]: [Worktree host, runtime, and creator provenance](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/worktree/types.ts#L66-L183)

[^src-shared-worktree-create-preparation-ts-l1-l42]: [Worktree preparation lock proof](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/worktree/create-preparation.ts#L1-L42)

[^src-shared-mobile-relay-pairing-offer-ts-l9-l106]: [Versioned mobile and relay pairing offer](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/mobile-relay-pairing-offer.ts#L9-L106)

[^src-main-runtime-rpc-mobile-e2ee-auth-validation-ts-l13-l59]: [Transcript-bound mobile E2EE authentication](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/runtime/rpc/mobile-e2ee-auth-validation.ts#L13-L59)

[^src-main-runtime-rpc-mobile-e2ee-v2-key-schedule-ts-l6-l32]: [Mobile E2EE v2 key schedule](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/runtime/rpc/mobile-e2ee-v2-key-schedule.ts#L6-L32)

[^src-shared-mobile-pairing-connection-mode-ts-l1-l40]: [Mobile relay versus local-only pairing mode](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/mobile-pairing-connection-mode.ts#L1-L40)

[^src-cloud-readme-l1-l12]: [Relay topology and license](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/cloud/README.md#L1-L12)

[^src-shared-ephemeral-vm-recipes-ts-l39-l132]: [Ephemeral VM recipe connection/result schemas](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/ephemeral-vm-recipes.ts#L39-L132)

[^src-shared-ephemeral-vm-recipe-runner-ts-l108-l303]: [Ephemeral VM create/destroy/suspend/resume commands](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/ephemeral-vm-recipe-runner.ts#L108-L303)

[^src-shared-tui-agent-permissions-ts-l6-l39]: [YOLO permission flag roster](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/tui-agent-permissions.ts#L6-L39)

[^src-shared-tui-agent-launch-defaults-ts-l12-l20]: [Bypass defaults](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/tui-agent-launch-defaults.ts#L12-L20)

[^src-shared-tui-agent-launch-defaults-ts-l128-l156]: [Resolved permission-bypass posture](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/shared/tui-agent-launch-defaults.ts#L128-L156)

[^src-main-claude-claude-structured-inbound-control-ts-l23-l85]: [Claude deny-safe permission callback](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/claude/claude-structured-inbound-control.ts#L23-L85)

[^src-main-codex-codex-structured-permission-policy-ts-l4-l49]: [Codex provider-enforced permission policy](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/codex/codex-structured-permission-policy.ts#L4-L49)

[^src-main-runtime-structured-agent-account-home-ts-l5-l55]: [Structured account-home resolution](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/runtime/structured-agent-account-home.ts#L5-L55)

[^src-renderer-components-settings-provider-account-scope-ts-l15-l91]: [Local versus remote provider account scope](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/renderer/src/components/settings/provider-account-scope.ts#L15-L91)

[^src-renderer-runtime-runtime-provider-accounts-client-ts-l70-l302]: [Runtime-owned provider account synchronization](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/renderer/src/runtime/runtime-provider-accounts-client.ts#L70-L302)

[^src-main-rate-limits-opencode-go-usage-source-selection-ts-l91-l152]: [OpenCode Go API-key-first usage selection](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/rate-limits/opencode-go-usage-source-selection.ts#L91-L152)

[^src-main-rate-limits-opencode-go-api-key-source-ts-l215-l269]: [OpenCode Go credential precedence](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/rate-limits/opencode-go-api-key-source.ts#L215-L269)

[^src-main-rate-limits-opencode-go-usage-api-ts-l8-l68]: [OpenCode Go bearer usage endpoint](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/rate-limits/opencode-go-usage-api.ts#L8-L68)

[^src-main-rate-limits-opencode-go-usage-fetcher-ts-l17-l130]: [OpenCode console-cookie fallback and cookie clearing](https://github.com/stablyai/orca/blob/d9cf07d3f4a3b2bc114a745ef39ff6a0585fcfef/src/main/rate-limits/opencode-go-usage-fetcher.ts#L17-L130)
