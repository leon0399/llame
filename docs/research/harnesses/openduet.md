---
type: Reference
title: "OpenDuet"
description: "Proactive agent on vendored CopilotKit OpenBot: per-bot computers, a deny-by-default action gateway, and credentials kept out of the transcript."
resource: "https://github.com/CopilotKit/OpenDuet"
tags: [harness, approvals, sandbox, credentials, memory, channels]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-10-30"
observed:
  date: "2026-10-30"
  revision: "677e0fcd148d80b99dd788c6d6f9c1c9f40a72db"
sources:
  - id: openduet-start-sh-l3-l12
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/scripts/start.sh#L3-L12"
    title: "Root start delegates to the vendored OpenBot tree"
  - id: openduet-license-l1-l5
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/LICENSE#L1-L5"
    title: "MIT license heading"
  - id: openduet-openbot-package-l2-l5
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/package.json#L2-L5"
    title: "Vendored OpenBot package is MIT"
  - id: openduet-config-tenant-l1410-l1411
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/config.ts#L1410-L1411"
    title: "Tenant package defaults to examples/openduet"
  - id: openduet-brand-yaml-l5-l7
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/examples/openduet/brand.yaml#L5-L7"
    title: "Tenant id and product name"
  - id: openduet-model-yaml-l1-l4
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/examples/openduet/model.yaml#L1-L4"
    title: "Default provider and model"
  - id: openduet-tenant-model-l625-l632
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/tenant-package.ts#L625-L632"
    title: "Boot reads provider, secret ref, and default model"
  - id: openduet-skills-yaml-l15-l18
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/examples/openduet/skills.yaml#L15-L18"
    title: "A skill names tools and grants none"
  - id: openduet-gateway-l1-l14
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/computer/gateway.ts#L1-L14"
    title: "The computer gateway resolves, decides, records, then acts"
  - id: openduet-run-command-l1182-l1199
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/computer/gateway.ts#L1182-L1199"
    title: "A shell command is judged on its text and then executed"
  - id: openduet-shell-l11-l13
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/agent-computer/src/shell.ts#L11-L13"
    title: "The computer shell does not decide whether a command may run"
  - id: openduet-passwords-l4-l7
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/passwords/types.ts#L4-L7"
    title: "A credential reaches the browser and nowhere the model can read"
  - id: openduet-safety-l75-l107
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/approvals/policy.ts#L75-L107"
    title: "Built-in safety hand-offs are not configurable"
  - id: openduet-review-l206-l208
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/approvals/policy.ts#L206-L208"
    title: "The reviewer fails closed"
  - id: openduet-private-share-l10-l14
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/proactive/private-share.ts#L10-L14"
    title: "Sharing with other people asks even when general approvals are off"
  - id: openduet-one-computer-l59
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/scripts/start.sh#L59"
    title: "One computer per Bot is the default"
  - id: openduet-workspace-l4-l19
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/agent-computer/src/workspace.ts#L4-L19"
    title: "Workspace confinement, and the computer process runs as root"
  - id: openduet-gvisor-l219-l220
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/docker-compose.yml#L219-L220"
    title: "gVisor is opt-in; the default computer shares the host kernel"
  - id: openduet-copilot-l80-l91
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/copilot.ts#L80-L91"
    title: "Intelligence owns durable threads; external Bots speak AG-UI"
  - id: openduet-intelligence-required-l992-l1010
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/config.ts#L992-L1010"
    title: "Boot throws when Intelligence settings are missing"
  - id: openduet-memory-grant-l27-l30
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/memory/intelligence.ts#L27-L30"
    title: "Memory reads are user-scoped and project scope is none"
  - id: openduet-approval-owner-l43-l44
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/approvals/store.ts#L43-L44"
    title: "An approval row is selected by owner user id"
  - id: openduet-channels-l1-l11
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/examples/openduet/channels.yaml#L1-L11"
    title: "Product channels, including an AG-UI agent the operator brings"
  - id: openduet-opentag-l1-l8
    resource: "https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/delivery/opentag.ts#L1-L8"
    title: "Slack and Teams bind to an owner; message text cannot choose one"
---

# OpenDuet

- **Stack:** TypeScript on Bun. The repository root is a thin wrapper; `scripts/start.sh` runs the vendored `openbot/` tree.[^openduet-start-sh-l3-l12] **License:** MIT for the root and for the vendored OpenBot package.[^openduet-license-l1-l5][^openduet-openbot-package-l2-l5]

This is [CopilotKit OpenDuet](https://github.com/CopilotKit/OpenDuet), a proactive-agent product whose platform is CopilotKit's OpenBot copied into `openbot/`. It is a different project from [nightly-labs OpenBot](./openbot.md). Source inspection only; nothing was run. The default tenant package is `openbot/examples/openduet`.[^openduet-config-tenant-l1410-l1411][^openduet-brand-yaml-l5-l7]

**Study**

1. **Declarations are not grants.** Skills name tool refs and state that naming one grants nothing: a run offers the intersection with the Bot's grants.[^openduet-skills-yaml-l15-l18] The tenant model record is a provider, a secret reference, and a default model (`openai` / `gpt-5.6-terra` in the shipped file).[^openduet-model-yaml-l1-l4][^openduet-tenant-model-l625-l632] A skill may name a connector this deployment has not installed; the call still needs the Bot's grant. Whether `gpt-5.6-terra` is a live provider model id was not checked.
2. **One gateway reaches the computer.** A click resolves a server-held element ref, asks policy (an absent or broken rule denies), writes the audit row, and only then acts.[^openduet-gateway-l1-l14] A shell command is judged on its text. The gateway's comment says a shell call names no element, and `runCommand` passes the command string into the same record-then-act path.[^openduet-run-command-l1182-l1199] The computer's shell module does not decide whether a command may run.[^openduet-shell-l11-l13] This matches [the harness owns execution](../../../VISION.md#the-harness-owns-execution): the model proposes, the host validates and records.
3. **Credentials stay off the transcript.** A sign-in secret goes from the person's form to the Bot's browser. It is excluded from tool arguments, tool results, transcript rows, AG-UI events, audit payloads, and logs. The model hears only whether sign-in worked.[^openduet-passwords-l4-l7]
4. **Approvals fail closed, and some actions always ask.** Built-in safety hand-offs for credentials, security settings, and payments ignore rules and reviewer verdicts.[^openduet-safety-l75-l107] A reviewer error, timeout, or undeclared answer becomes `needs_approval`.[^openduet-review-l206-l208] Sending private content to other people asks in the approvals ledger even when the general approvals switch is off; allow-once covers one send.[^openduet-private-share-l10-l14] llame's approval flows are later work in that same vision section; this is a concrete fail-closed shape, not a shipped llame design.
5. **Each Bot's computer is a container, with a shared-kernel default.** `OPENBOT_ONE_COMPUTER_EACH` defaults to true.[^openduet-one-computer-l59] The workspace volume is `/workspace`. The process runs as root inside the container, and path confinement refuses absolute paths, `..`, and symlink escape.[^openduet-workspace-l4-l19] `COMPUTER_RUNTIME=runsc` selects gVisor; unset, the container shares the host kernel.[^openduet-gvisor-l219-l220] Useful beside [local Sandbox execution](../../../ROADMAP.md#then-local-sandbox-execution): isolation is a runtime choice, and root-in-container plus path checks are the baseline.
6. **Threads and memory live in CopilotKit Intelligence.** The runtime has one mode. Intelligence owns durable threads, and boot throws if the API URL, gateway WebSocket URL, or API key is missing.[^openduet-copilot-l80-l91][^openduet-intelligence-required-l992-l1010] Memory calls ask for the person's user scope and set project scope to none, then filter results to `scope === "user"`, because project memory is shared inside the Intelligence project.[^openduet-memory-grant-l27-l30] External Bots are AG-UI `HttpAgent`s.[^openduet-copilot-l80-l91] The remote thread and memory bodies are outside this repository.
7. **Channels bind to an owner.** The tenant lists product channels, including one whose job is an agent the operator brings over AG-UI.[^openduet-channels-l1-l11] Slack and Microsoft Teams arrive through OpenTag. The shared secret is checked in constant time, and the message text cannot choose an owner.[^openduet-opentag-l1-l8] OpenTag is configuration, not something `scripts/start.sh` launches by itself.
8. **Owner checks are application predicates.** An approval lookup requires `ownerUserId`.[^openduet-approval-owner-l43-l44] A search of `openbot/server` found no `ROW LEVEL SECURITY` statements. That is application tenancy, the gap [Paperclip](./paperclip.md) also records, and it is weaker than llame's datastore RLS.

**llame fit**

- High: items 2, 3, and 4 for host-owned execution, credential exclusion, and fail-closed approval.
- Moderate: items 1, 5, and 7 for grant-versus-instruction imports, per-bot computers, and channel identity.
- Low: item 6 as a dependency. Durable history here is a required hosted Intelligence service.
- Avoid: treating Postgres rows as tenant isolation, or treating a skill file as an execution grant.

**Caution:** Default computers share the host kernel and run as root inside the container.[^openduet-workspace-l4-l19][^openduet-gvisor-l219-l220] Intelligence is required to boot, and its stored threads were not inspected.[^openduet-intelligence-required-l992-l1010] The README's "checks what leaves" is broader than the private-share gate, which is about audience, not a general health-data scanner.[^openduet-private-share-l10-l14] Docker and Helm docs in `openbot/docs` deploy plain OpenBot images; the README says they are not an OpenDuet image.

[^openduet-start-sh-l3-l12]: [Root start delegates to the vendored OpenBot tree](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/scripts/start.sh#L3-L12)

[^openduet-license-l1-l5]: [MIT license heading](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/LICENSE#L1-L5)

[^openduet-openbot-package-l2-l5]: [Vendored OpenBot package is MIT](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/package.json#L2-L5)

[^openduet-config-tenant-l1410-l1411]: [Tenant package defaults to examples/openduet](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/config.ts#L1410-L1411)

[^openduet-brand-yaml-l5-l7]: [Tenant id and product name](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/examples/openduet/brand.yaml#L5-L7)

[^openduet-model-yaml-l1-l4]: [Default provider and model](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/examples/openduet/model.yaml#L1-L4)

[^openduet-tenant-model-l625-l632]: [Boot reads provider, secret ref, and default model](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/tenant-package.ts#L625-L632)

[^openduet-skills-yaml-l15-l18]: [A skill names tools and grants none](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/examples/openduet/skills.yaml#L15-L18)

[^openduet-gateway-l1-l14]: [The computer gateway resolves, decides, records, then acts](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/computer/gateway.ts#L1-L14)

[^openduet-run-command-l1182-l1199]: [A shell command is judged on its text and then executed](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/computer/gateway.ts#L1182-L1199)

[^openduet-shell-l11-l13]: [The computer shell does not decide whether a command may run](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/agent-computer/src/shell.ts#L11-L13)

[^openduet-passwords-l4-l7]: [A credential reaches the browser and nowhere the model can read](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/passwords/types.ts#L4-L7)

[^openduet-safety-l75-l107]: [Built-in safety hand-offs are not configurable](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/approvals/policy.ts#L75-L107)

[^openduet-review-l206-l208]: [The reviewer fails closed](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/approvals/policy.ts#L206-L208)

[^openduet-private-share-l10-l14]: [Sharing with other people asks even when general approvals are off](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/proactive/private-share.ts#L10-L14)

[^openduet-one-computer-l59]: [One computer per Bot is the default](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/scripts/start.sh#L59)

[^openduet-workspace-l4-l19]: [Workspace confinement, and the computer process runs as root](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/agent-computer/src/workspace.ts#L4-L19)

[^openduet-gvisor-l219-l220]: [gVisor is opt-in; the default computer shares the host kernel](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/docker-compose.yml#L219-L220)

[^openduet-copilot-l80-l91]: [Intelligence owns durable threads; external Bots speak AG-UI](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/copilot.ts#L80-L91)

[^openduet-intelligence-required-l992-l1010]: [Boot throws when Intelligence settings are missing](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/config.ts#L992-L1010)

[^openduet-memory-grant-l27-l30]: [Memory reads are user-scoped and project scope is none](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/memory/intelligence.ts#L27-L30)

[^openduet-approval-owner-l43-l44]: [An approval row is selected by owner user id](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/approvals/store.ts#L43-L44)

[^openduet-channels-l1-l11]: [Product channels, including an AG-UI agent the operator brings](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/examples/openduet/channels.yaml#L1-L11)

[^openduet-opentag-l1-l8]: [Slack and Teams bind to an owner; message text cannot choose one](https://github.com/CopilotKit/OpenDuet/blob/677e0fcd148d80b99dd788c6d6f9c1c9f40a72db/openbot/server/src/delivery/opentag.ts#L1-L8)
