---
type: Reference
title: "WorkBuddy"
description: "Closed Tencent desktop office agent that hosts CodeBuddy Code, with a user-picked task directory and a client-global full-access switch."
resource: "https://www.workbuddy.ai"
tags: [harness, desktop, closed-source, workspace, permissions, office-agent]
status: draft
generated:
  by: "grok/grok-4.7"
  at: "2026-10-18"
observed:
  date: "2026-10-18"
  revision: "5fcc784577447f1c241564381c92e0dfeb888ff0"
sources:
  - id: product-page
    resource: "https://cloud.tencent.com/product/workbuddy"
    title: "China product page: local files, tools, and a cloud assistant"
  - id: home-os
    resource: "https://www.workbuddy.ai"
    title: "Home page operatingSystem lists Windows and macOS"
  - id: overview
    resource: "https://www.workbuddy.ai/docs/zh/workbuddy/Overview"
    title: "Docs intro: desktop workstation and local authorized files"
  - id: pricing
    resource: "https://www.workbuddy.cn/docs/workbuddy/Pricing"
    title: "Buddy AI family shares credits between WorkBuddy and CodeBuddy"
  - id: task-bar-cn
    resource: "https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Task-Bar"
    title: "China task bar: Agent, Plan, Ask, and two permission labels"
  - id: task-bar-intl
    resource: "https://intl.cloud.tencent.com/zh/document/product/1316/84504"
    title: "Intl task bar: office and coding modes, dated 2026-09-30"
  - id: project-docs
    resource: "https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project"
    title: "Projects inject instructions, a library, and personal memory"
  - id: sidecar-ready
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/cli/runtime-ready-reporter.d.ts#L58-L67"
    title: "CLI reports its HTTP port to a WorkBuddy sidecar"
  - id: acp-web-ui-client
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/acp/acp-web-ui-client.d.ts#L1-L36"
    title: "WorkBuddy is an ACP host distinct from the Web UI client"
  - id: usage-replay
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/acp/usage-update-builder.d.ts#L1-L8"
    title: "Desktop history uses CLI HTTP replay"
  - id: connector-uri
    resource: "https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/mcp/connector-resource-uri.d.ts#L1-L32"
    title: "Desktop connector-proxy aggregates MCP servers"
  - id: name-collision
    resource: "https://docs.work-buddy.ai/architecture/"
    title: "Unrelated work-buddy MCP gateway for Claude Code"
  - id: vision-workspace
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L188-L206"
    title: "Workspace entry is harness-authorized, and native execution is host authority"
  - id: vision-deferrals
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L331-L348"
    title: "Connectors, memory extraction, and multi-channel bots are deferred"
  - id: spec-execution
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/SPEC.md#L110"
    title: "No remote executor API ships"
  - id: roadmap-cli
    resource: "https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/ROADMAP.md#L171-L191"
    title: "External coding-harness adapters are outside the unselected CLI cut"
---

# WorkBuddy

- **Stack:** Closed Tencent desktop workstation for office, research, and coding tasks. The home page lists Windows and macOS.[^home-os] Product home: [workbuddy.ai](https://www.workbuddy.ai). China docs: [workbuddy.cn](https://www.workbuddy.cn/docs/workbuddy/Pricing). The agent runtime it hosts is the published [CodeBuddy Code](./codebuddy.md) CLI.
- **License / openness:** No public application repository was found. Desktop paths named in CLI comments (`apps/workbuddy-desktop`, `workbuddy-server`, `workbuddy-core`) are not in the `@tencent-ai/codebuddy-code@2.168.2` tarball. The CLI package's own license is recorded on the CodeBuddy note.

**Status:** Official pages, plus declaration comments in CodeBuddy Code `2.168.2`. The China docs HTML embeds build `5fcc784577447f1c241564381c92e0dfeb888ff0`. The page URLs stay live. The desktop app was not installed or run. Two official task-bar pages disagree, and this note leaves that disagreement in place. `docs.work-buddy.ai` is a different project: a local MCP gateway that extends Claude Code.[^name-collision]

The China product page describes WorkBuddy as an office workbench that plans a task, calls tools, and reads and writes local files. It also describes a cloud assistant that keeps running after the client closes.[^product-page] The docs intro says a task can be given in one sentence, and that the product can read an authorized folder on the computer.[^overview] Pricing calls WorkBuddy and CodeBuddy members of one "Buddy AI" family and says one account's credits are shared, with no separate subscription required.[^pricing] They are still different products. CodeBuddy Code is the published agent runtime. WorkBuddy is the desktop and cloud task host.

**Study**

1. **The desktop is a host of the CodeBuddy CLI, and the host source is closed.** `reportSidecarRuntimeReady` reports the CLI's HTTP port to a WorkBuddy backend sidecar only when that sidecar started the child with `--port 0` and injected a one-shot socket, token, and session id. The comment says the variables are removed before any later I/O so the credential does not reach MCP servers or tools, and that a normal CLI start is a no-op.[^sidecar-ready] The ACP comment names WorkBuddy as an `--acp` client that does not use the Web UI client name `codebuddy-web-ui`, and it says a reused session must clear the Web UI flag or WorkBuddy picks up Web-only goal behavior.[^acp-web-ui-client] History switches on the desktop use CLI HTTP replay, not ACP `loadSession()`.[^usage-replay] Those are comments in the published CLI types. The desktop process that spawns the sidecar was not in the tarball, and this note did not watch a session start. On a local task, file and shell tools are the CLI's, on the machine that holds the task directory. The product page's cloud assistant is a separate claim. llame has no remote executor API, and external coding-harness adapters sit outside the unselected CLI cut.[^spec-execution][^roadmap-cli]
2. **A task is one conversation plus one directory.** Both task-bar pages say each conversation keeps its own workspace and context, and that parallel tasks stay separate. Both say to set a directory first: files are read and saved there, and a task that does not name a path prefers that directory. If none was set, a new task creates one.[^task-bar-cn][^task-bar-intl] The international page, stamped 2026-09-30, calls that directory the permission system's bound for "out of bounds" and offers two work modes, office and coding.[^task-bar-intl] The China task bar instead offers three modes, default Agent, Plan, and Ask, and it says slash-command completion matches CodeBuddy Code, including `.codebuddy/commands/` in the project directory.[^task-bar-cn] The China model table names MiniMax, GLM, Kimi, DeepSeek, and Hunyuan, chosen by task type, and a mid-chat switch applies on the next turn.[^task-bar-cn] The international page recommends Auto and says that choice selects a model from the task type, then lists versioned ids.[^task-bar-intl] Treat the two pages as two live documents. A directory the host records is adjacent to llame's rule that Workspace entry is authorized by the harness. A CLI start may create a native-placement grant for that directory and does not cover a later model-selected Workspace.[^vision-workspace] WorkBuddy's automatic directory was not seen executed.
3. **Full access is a client-wide switch.** The China page names two labels: default asks on sensitive operations such as file changes or work outside the workspace, and full access applies to every task in the current client.[^task-bar-cn] The international page's table is narrower than a blanket sandbox. Default file access stays inside the sandbox and asks to go outside; deletes and modifications ask each time; only system-level commands ask; network access is controlled and sensitive actions ask. Full access may touch any path, run commands, install software, change system settings, and use the network and enabled connectors. The switch covers existing and later tasks on that client and does not apply on another device.[^task-bar-intl] The same page says a security center can set sandbox policy, delete protection, and audit logs. That page was not opened, and neither description was checked against a binary. llame requires native execution to be disclosed as host-user authority.[^vision-workspace] A global "allow" on one client is a different record from owner-scoped permission state.
4. **Project tasks inject cloud instructions, a library, and personal memory.** Creating a task inside a project pulls the project instruction into the model context, the project library in as references, and personal memory into the context.[^project-docs] The library is also described as RAG, with `read-file` as another way to read it. Handoff copies the original task's dialogue, call records, and intermediate files into a new session.[^project-docs] Coding work reads `.codebuddy/` the same way the page says CodeBuddy Code does: `rules/`, `agents/`, `skills/`, `commands/`, and `.codebuddy/CODEBUDDY.md`. The priority sentence covers agents, skills, and rules: project level ahead of user level, and the project copy wins when the name collides. `AGENTS.md` is described as compatible and able to sit beside user-level `~/.codebuddy/`.[^project-docs] CodeBuddy's own memory file rules are on the [CodeBuddy](./codebuddy.md) note. What "personal memory" contains, and whether it is the CLI's `MEMORY.md` or a separate cloud profile, is not stated on this page. llame defers automatic memory injection.[^vision-deferrals]
5. **Connectors split shared and personal credentials.** Project connectors are either a public authorization, one ticket for the whole project, or a personal authorization whose ticket stays on the member's machine and is not uploaded. Collaborative tasks disable every personal connector and keep the public ones. Project configuration itself is stored in the cloud and shared with members.[^project-docs] The CLI declaration for connector resource URIs says WorkBuddy Desktop's `connector-proxy` aggregates several backend MCP servers into one virtual server, prefixes tool names with the backend, and wraps resource URIs as `mcp+connector://`. The comment says the parser is duplicated from `apps/workbuddy-desktop` because the CLI and the desktop ship as separate packages.[^connector-uri] The desktop file was not in the published tarball, so the aggregation behavior is a CLI-side comment, not a read of the proxy. Managed OAuth connector onboarding is an explicit llame deferral.[^vision-deferrals]
6. **Experts, skills, and the cloud assistant are product surfaces.** Both task bars describe skills, including an OpenClaw community import.[^task-bar-cn][^task-bar-intl] The international page also describes experts and expert teams: a lead splits the task, runs agents in parallel, and merges the result.[^task-bar-intl] The China task-bar article does not. The project page says the web personal skill library and the client personal skill library are separate, while project skills are shared in the cloud, and a cloud task cannot see the client library.[^project-docs] The product page says a cloud assistant keeps running after the client closes and processes files in the cloud.[^product-page] Those sentences are marketing and docs. This note did not see a cloud worker, a skill package, or an expert process. Multi-channel bots and child-agent orchestration are outside llame's current sequence.[^vision-deferrals]

**llame fit**

- Study the user-picked directory as the permission root of a task, recorded by the host, and the sidecar pattern where a desktop injects a one-shot credential and then strips it before tools spawn.[^sidecar-ready][^vision-workspace]
- Keep CodeBuddy Code as the peer executor when the question is the agent loop. Drive it from llame only under a future adapter decision. The unselected CLI cut excludes that adapter.[^roadmap-cli]
- Leave full access, cloud transcript copy on handoff, and the cloud assistant as closed-product behavior. They are not substitutes for owner-scoped isolation.

**Caution**

- Name collision with [work-buddy](https://docs.work-buddy.ai/architecture/), which documents a Claude Code MCP gateway on `localhost:5126`.[^name-collision] Pin Tencent's product to workbuddy.ai, workbuddy.cn, or Tencent Cloud.
- The China and international task bars disagree on modes, models, and how much of the permission table they spell out.[^task-bar-cn][^task-bar-intl]
- Third-party writeups of `~/.workbuddy` were not used. This note does not claim a home-directory layout the official pages do not state.

[^product-page]: [China product page: local files, tools, and a cloud assistant](https://cloud.tencent.com/product/workbuddy)

[^home-os]: [Home page operatingSystem lists Windows and macOS](https://www.workbuddy.ai)

[^overview]: [Docs intro: desktop workstation and local authorized files](https://www.workbuddy.ai/docs/zh/workbuddy/Overview)

[^pricing]: [Buddy AI family shares credits between WorkBuddy and CodeBuddy](https://www.workbuddy.cn/docs/workbuddy/Pricing)

[^task-bar-cn]: [China task bar: Agent, Plan, Ask, and two permission labels](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Task-Bar)

[^task-bar-intl]: [Intl task bar: office and coding modes, dated 2026-09-30](https://intl.cloud.tencent.com/zh/document/product/1316/84504)

[^project-docs]: [Projects inject instructions, a library, and personal memory](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project)

[^sidecar-ready]: [CLI reports its HTTP port to a WorkBuddy sidecar](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/cli/runtime-ready-reporter.d.ts#L58-L67)

[^acp-web-ui-client]: [WorkBuddy is an ACP host distinct from the Web UI client](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/acp/acp-web-ui-client.d.ts#L1-L36)

[^usage-replay]: [Desktop history uses CLI HTTP replay](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/acp/usage-update-builder.d.ts#L1-L8)

[^connector-uri]: [Desktop connector-proxy aggregates MCP servers](https://unpkg.com/@tencent-ai/codebuddy-code@2.168.2/dist-server/types/node/mcp/connector-resource-uri.d.ts#L1-L32)

[^name-collision]: [Unrelated work-buddy MCP gateway for Claude Code](https://docs.work-buddy.ai/architecture/)

[^vision-workspace]: [Workspace entry is harness-authorized, and native execution is host authority](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L188-L206)

[^vision-deferrals]: [Connectors, memory extraction, and multi-channel bots are deferred](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/VISION.md#L331-L348)

[^spec-execution]: [No remote executor API ships](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/SPEC.md#L110)

[^roadmap-cli]: [External coding-harness adapters are outside the unselected CLI cut](https://github.com/leon0399/llame/blob/773ca773988d652b4b4a4b815b95470c059d74c8/ROADMAP.md#L171-L191)
