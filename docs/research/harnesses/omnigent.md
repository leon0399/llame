---
type: Reference
title: "Omnigent"
description: "Python open-source meta-harness that orchestrates Claude Code, Codex, Cursor and custom YAML agents under declarative policies, sandboxes and a shared session server."
tags: [harness, meta-harness, peer-executor, policies, sandbox, acp]
status: draft
resource: "https://github.com/omnigent-ai/omnigent/tree/90a9bed9a5e25b1cab8d06a7e361c86cd5460918"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "90a9bed9a5e25b1cab8d06a7e361c86cd5460918"
sources:
  - id: readme-l1-l59
    resource: "https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/README.md#L1-L59"
    title: "Meta-harness claim: multi-agent, policies, cloud sandboxes"
  - id: license-l1-l10
    resource: "https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/LICENSE#L1-L10"
    title: "Apache License 2.0 header"
  - id: policies-l1-l21
    resource: "https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/docs/POLICIES.md#L1-L21"
    title: "ALLOW DENY ASK verdicts and session/spec/server order"
  - id: capabilities-l24-l51
    resource: "https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/omnigent/harness_capabilities.py#L24-L51"
    title: "IntegrationMode Elicitation Resume enums"
  - id: capabilities-l106-l162
    resource: "https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/omnigent/harness_capabilities.py#L106-L162"
    title: "HarnessCapabilities fields including steer live_queue interrupt"
  - id: plugin-l1-l33
    resource: "https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/designs/harness-plugin-interface.md#L1-L33"
    title: "Entry-point harness plugins; core vs optional packages"
  - id: queue-steer-l1-l54
    resource: "https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/docs/QUEUE_STEER_DESIGN.md#L1-L54"
    title: "Client-side queue edit delete steer before POST"
  - id: agentspec-l1-l72
    resource: "https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/omnigent/spec/AGENTSPEC.md#L1-L72"
    title: "Portable agent image directory and config.yaml"
  - id: data-dir-l1-l41
    resource: "https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/docs/DATA_DIR_LAYOUT.md#L1-L41"
    title: "~/.omnigent chat.db and OMNIGENT_DATA_DIR isolation"
  - id: readme-l44-l53
    resource: "https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/README.md#L44-L53"
    title: "Cloud sandbox providers: Modal, Daytona, E2B, K8s and peers"
---

# Omnigent

- **Stack:** Python 3.12+ package (`omnigent` server, runner, harness plugins),
  web UI, optional desktop; SQLite `chat.db` under `~/.omnigent` by
  default.[^data-dir-l1-l41] Site: [omnigent.ai](https://omnigent.ai).
  **License:** Apache-2.0.[^license-l1-l10] Status badge on the README:
  alpha.[^readme-l1-l59]

**Status:** Source and documentation inspection only; nothing was run. Self-
described open-source **meta-harness**: common orchestration over Claude Code,
Codex, Cursor, OpenCode, Hermes, Pi and YAML-defined agents, with policies,
sandboxes and multi-device session
sync.[^readme-l1-l59] Closest naming and layering analogue to llame in this
bundle alongside [Zeron](./zeron.md). High confidence on the capability model
and policy verdicts (code and docs agree); moderate confidence on cloud sandbox
providers, which are listed in the README but not exercised here.

**Study**

1. **Declared harness capabilities.** `HarnessCapabilities` records
   `integration_mode` (sdk-in-process, cli-subprocess, acp-subprocess,
   native-tui, native-server), elicitation path, resume kind, auth model,
   plus interrupt, streaming, optional steering, live_queue and
   compaction.[^capabilities-l24-l51][^capabilities-l106-l162] Interrupt and
   streaming are declared claims verified by a harness bench. This is the
   strongest published peer-adapter checklist next to Zeron's `Harness` trait.
2. **Policy engine with ASK.** Policies return ALLOW, DENY or ASK; DENY
   short-circuits; evaluation order is session, then agent spec, then
   server-wide.[^policies-l1-l21] Maps to llame approval surfaces: keep ASK as
   a suspended Run outcome, never as peer-minted authority.
3. **Plugin harness registry.** Optional packages register via
   `omnigent.community.harness` entry points so `pip install omnigent-kimi`
   extends the same CLI/server without bloating core.[^plugin-l1-l33] Pattern
   for llame ACP/A2A adapters as packages rather than core forks.
4. **Steer vs queue is harness-dependent.** The queue/steer design holds
   follow-ups client-side until flush or steer; mid-turn steer is deterministic
   only for live-queue SDKs and otherwise becomes next-turn
   delivery.[^queue-steer-l1-l54] Same trap Zeron documented: silence or a
   shared timeout is not completion, and steer must be capability-gated.
5. **Portable agent images.** An agent directory (`config.yaml`, optional
   `AGENTS.md`, skills, tools, nested `agents/`) is the unit of identity and
   tool allowlisting.[^agentspec-l1-l72] Useful for future llame child-agent
   packages; not a substitute for Chat/Run identity.
6. **Local data dir is machine-global.** Default `~/.omnigent/chat.db` is shared
   across worktrees unless `OMNIGENT_DATA_DIR` isolates
   them.[^data-dir-l1-l41] Opposite of llame's owner-scoped Postgres RLS;
   adopt the env isolation idea, not the default shared DB.
7. **Cloud sandbox placement matrix.** Sessions can run in disposable Modal,
   Daytona, Blaxel, Boxlite, Islo, E2B, OpenShell, CoreWeave, Kubernetes,
   microsandbox or Databricks sandboxes without a laptop host.[^readme-l44-l53]
   Multi-container / managed-host placement; still not llame RLS tenancy.

**llame fit**

- High: items 1, 2 and 4 as the executor capability and approval checklist.
- Moderate: items 3 and 7 for packaging peer adapters and cloud sandbox
  placement vocabulary.
- Low: item 5 as product agent packaging; llame already owns Chat/Run.
- Avoid: importing Omnigent's session DB or sharing mode as tenancy. llame keeps
  authenticated RLS isolation.

**Caution:** Alpha software; Windows is degraded (no bwrap/seatbelt native
wrappers). Sharing settings and public sessions are server-configurable and are
not a fail-closed tenant model.[^data-dir-l1-l41][^readme-l1-l59]

[^readme-l1-l59]: [Meta-harness claim: multi-agent, policies, cloud sandboxes](https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/README.md#L1-L59)

[^readme-l44-l53]: [Cloud sandbox providers: Modal, Daytona, E2B, K8s and peers](https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/README.md#L44-L53)

[^license-l1-l10]: [Apache License 2.0 header](https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/LICENSE#L1-L10)

[^policies-l1-l21]: [ALLOW DENY ASK verdicts and session/spec/server order](https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/docs/POLICIES.md#L1-L21)

[^capabilities-l24-l51]: [IntegrationMode Elicitation Resume enums](https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/omnigent/harness_capabilities.py#L24-L51)

[^capabilities-l106-l162]: [HarnessCapabilities fields including steer live_queue interrupt](https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/omnigent/harness_capabilities.py#L106-L162)

[^plugin-l1-l33]: [Entry-point harness plugins; core vs optional packages](https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/designs/harness-plugin-interface.md#L1-L33)

[^queue-steer-l1-l54]: [Client-side queue edit delete steer before POST](https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/docs/QUEUE_STEER_DESIGN.md#L1-L54)

[^agentspec-l1-l72]: [Portable agent image directory and config.yaml](https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/omnigent/spec/AGENTSPEC.md#L1-L72)

[^data-dir-l1-l41]: [~/.omnigent chat.db and OMNIGENT_DATA_DIR isolation](https://github.com/omnigent-ai/omnigent/blob/90a9bed9a5e25b1cab8d06a7e361c86cd5460918/docs/DATA_DIR_LAYOUT.md#L1-L41)
