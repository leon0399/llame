---
type: Reference
title: "Kandev"
description: "AGPL Go control plane for parallel agent tasks: agentctl + ACP peers, multi-executor runtimes, review-first kanban, and application-level private executor ownership."
tags: [harness, peer-executor, acp, control-plane, executors, agpl, self-host]
status: draft
resource: "https://github.com/kdlbs/kandev/tree/b35ac5170fb57d8a27864ca5d09c04271bf0fb94"
observed:
  date: "2026-10-17"
  revision: "b35ac5170fb57d8a27864ca5d09c04271bf0fb94"
sources:
  - id: kandev-readme-l16-l22
    resource: "https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/README.md#L16-L22"
    title: "review-first parallel tasks; self-host; no telemetry"
  - id: kandev-readme-l114
    resource: "https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/README.md#L114"
    title: "most structured integrations speak ACP"
  - id: kandev-arch-l6-l58
    resource: "https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/docs/ARCHITECTURE.md#L6-L58"
    title: "Go control plane; agentctl owns agent subprocess and ACP"
  - id: kandev-arch-l87-l104
    resource: "https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/docs/ARCHITECTURE.md#L87-L104"
    title: "executor profiles; control plane separate from agent host"
  - id: kandev-arch-l110-l120
    resource: "https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/docs/ARCHITECTURE.md#L110-L120"
    title: "credential delivery boundary to executors"
  - id: kandev-public-arch-l67-l75
    resource: "https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/docs/public/architecture.md#L67-L75"
    title: "agentctl ACP adapter; worktree is not process isolation"
  - id: kandev-public-arch-l95-l105
    resource: "https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/docs/public/architecture.md#L95-L105"
    title: "trust boundaries; server-side identity checks"
  - id: kandev-executors-l111-l141
    resource: "https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/docs/public/executors.md#L111-L141"
    title: "private executor ownership is application access, not OS isolation"
  - id: kandev-license-l1-l10
    resource: "https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/LICENSE#L1-L10"
    title: "GNU Affero General Public License v3"
---

# Kandev

- **Stack:** Single native Go binary with embedded web SPA; Tauri desktop shell;
  `agentctl` sidecar in local/worktree/Docker/K8s/SSH/Sprites
  environments.[^kandev-arch-l6-l58][^kandev-readme-l16-l22] **License:** GNU
  Affero GPL v3 (AGPL-3.0). Network use triggers source-offer
  obligations.[^kandev-license-l1-l10] Site: [kandev.ai](https://kandev.ai).

**Status:** Source and documentation inspection only; nothing was run. A
self-hosted control plane for parallel coding-agent tasks: kanban/workflows,
review workspace, multi-provider agents (mostly ACP), and pluggable
executors.[^kandev-readme-l16-l22][^kandev-readme-l114] Neighbours:
[Paperclip](./paperclip.md), [Baro](./baro.md), [Zeron](./zeron.md). High
confidence peers are executors under a host task registry — closer to a company
board than to llame's owner Chat. Keep Chat/Run + RLS in llame; study ACP
lifecycle and executor trust language.

**Study**

1. **Control plane vs agentctl.** The Go backend owns durable state, HTTP/WS and
   launch; `agentctl` owns the agent subprocess and adapts ACP (and other
   protocols). The browser never drives the agent wire
   directly.[^kandev-arch-l6-l58][^kandev-public-arch-l67-l75] Clean peer-adapter
   boundary for llame.
2. **ACP-default agent matrix.** Most structured integrations communicate via
   ACP; Codex app-server is a separate experimental native path; CLI passthrough
   keeps raw TUIs under task tracking.[^kandev-readme-l114] Same "ACP first,
   special-case second" stance as Zeron/Paperclip.
3. **Executor placement is a first-class profile.** Local, worktree, Docker,
   remote Docker, Kubernetes, SSH, Sprites (and plugin remotes): the control
   plane can sit apart from the machine that runs the
   agent.[^kandev-arch-l87-l104] Useful for future Workspace/remote Run placement;
   identity still must stay in llame.
4. **Worktree ≠ isolation.** A worktree isolates concurrent Git state; it does
   not isolate processes, the host filesystem, or credentials. Containers/remote
   hosts add stronger runtime boundaries; credentials delivered to an environment
   remain available there.[^kandev-public-arch-l67-l75][^kandev-arch-l110-l120]
   State this explicitly in any llame worktree story.
5. **Private executor ownership is application ACL.** With auth enabled, private
   profiles/executors filter catalogues and block start/resume/prompt/shell for
   non-owners; sharing a workspace does not grant private compute. Documented as
   an application access boundary — Local/Worktree still use the server's OS
   account and on-disk credentials.[^kandev-executors-l111-l141] Not a substitute
   for Postgres RLS.
6. **Trust checklist.** Browser↔backend, backend↔providers, backend↔agentctl,
   agentctl↔agent/MCP, host↔infra: validate scope and identity server-side; never
   rely on frontend-only permission checks.[^kandev-public-arch-l95-l105]
7. **Events are not the durability log.** In-memory or NATS bus for live fan-out;
   consumers recover durable state from SQLite/Postgres because the bus does not
   replay.[^kandev-arch-l6-l58] Aligns with llame's persisted Run events + pg-boss.

**llame fit**

- High: items 1, 2, 4 and 6 for adapter boundary, ACP default, isolation honesty,
  trust checklist.
- Moderate: items 3 and 7 for placement profiles and bus-vs-store.
- Low: item 5 as a tenancy model; useful negative example vs RLS.
- Avoid: adopting Kandev's task/kanban identity as Chat/Run, or AGPL code into a
  non-AGPL product without a license decision.

**Caution:** AGPL-3.0 applies to network service distribution.[^kandev-license-l1-l10]
External MCP routes remain open while authentication is disabled (called out in
public architecture). Office-mode autonomy under `internal/office/` is
feature-flagged and not a supported extension API.

[^kandev-readme-l16-l22]: [review-first parallel tasks; self-host; no telemetry](https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/README.md#L16-L22)

[^kandev-readme-l114]: [most structured integrations speak ACP](https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/README.md#L114)

[^kandev-arch-l6-l58]: [Go control plane; agentctl owns agent subprocess and ACP](https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/docs/ARCHITECTURE.md#L6-L58)

[^kandev-arch-l87-l104]: [executor profiles; control plane separate from agent host](https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/docs/ARCHITECTURE.md#L87-L104)

[^kandev-arch-l110-l120]: [credential delivery boundary to executors](https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/docs/ARCHITECTURE.md#L110-L120)

[^kandev-public-arch-l67-l75]: [agentctl ACP adapter; worktree is not process isolation](https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/docs/public/architecture.md#L67-L75)

[^kandev-public-arch-l95-l105]: [trust boundaries; server-side identity checks](https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/docs/public/architecture.md#L95-L105)

[^kandev-executors-l111-l141]: [private executor ownership is application access, not OS isolation](https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/docs/public/executors.md#L111-L141)

[^kandev-license-l1-l10]: [GNU Affero General Public License v3](https://github.com/kdlbs/kandev/blob/b35ac5170fb57d8a27864ca5d09c04271bf0fb94/LICENSE#L1-L10)
