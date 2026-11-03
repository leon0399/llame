---
type: Reference
title: "AionUi"
description: "Apache-2.0 Electron desktop. A built-in agent plus detected CLIs, a README team mode over ACP, and cron ids on team conversations."
resource: "https://github.com/iOfficeAI/AionUi/tree/11cd2a9a20d1e033157636efc570b41384c66d85"
tags: [harness, desktop, peer-executor, acp, routines]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "11cd2a9a20d1e033157636efc570b41384c66d85"
sources:
  - id: aionui-pkg
    resource: "https://github.com/iOfficeAI/AionUi/blob/11cd2a9a20d1e033157636efc570b41384c66d85/package.json#L1-L21"
    title: "Apache-2.0 Electron app, package version 2.2.2, with webui scripts"
  - id: aionui-readme
    resource: "https://github.com/iOfficeAI/AionUi/blob/11cd2a9a20d1e033157636efc570b41384c66d85/readme.md#L162-L188"
    title: "Detected CLIs, YOLO mode, and a leader that delegates through Team MCP"
  - id: aionui-binary
    resource: "https://github.com/iOfficeAI/AionUi/blob/11cd2a9a20d1e033157636efc570b41384c66d85/packages/desktop/src/process/backend/binaryResolver.ts#L1-L14"
    title: "The desktop looks up an aioncore binary that is not source in this tree"
  - id: aionui-resolve
    resource: "https://github.com/iOfficeAI/AionUi/blob/11cd2a9a20d1e033157636efc570b41384c66d85/packages/desktop/src/process/backend/binaryResolver.ts#L71"
    title: "resolveBinaryPath is the lookup"
  - id: aionui-cron
    resource: "https://github.com/iOfficeAI/AionUi/blob/11cd2a9a20d1e033157636efc570b41384c66d85/tests/unit/renderer/team/removeTeamAssistantWithCronCleanup.test.ts#L10-L31"
    title: "Removing a team member removes its cron job first"
  - id: aionui-nocron
    resource: "https://github.com/iOfficeAI/AionUi/blob/11cd2a9a20d1e033157636efc570b41384c66d85/tests/unit/renderer/team/removeTeamAssistantWithCronCleanup.test.ts#L34-L48"
    title: "A member with no cron id is removed without removeCronJob"
---

# AionUi

- **Stack:** Electron (electron-vite), Apache-2.0, package version 2.2.2 at this commit. A `webui` script can run remote.[^aionui-pkg] The [tierroom board](https://my-tierroom.party/agents/aionui) and [aionui.com](https://www.aionui.com/en/) are live pages and are not pinned.

AionUi is a desktop workspace around a built-in agent and whatever coding CLIs it detects. The desktop entry starts an external `aioncore` binary; this checkout has no Rust sources for that process.[^aionui-binary] Source inspection of the README section, the package manifest, the binary resolver, and one team-cron test. The Team MCP server and the permission-mode implementation were not in the TypeScript that was opened, and nothing was run.

**Study**

1. **Peer CLIs sit next to a built-in engine that is not in this tree.** The README says the built-in agent uses an embedded `aionrs` engine and lists many external CLIs, including Claude Code, Codex, and OpenCode. Sessions are described as parallel and independent. MCP is "injected or synced" per agent.[^aionui-readme] `resolveBinaryPath` looks for an `aioncore` executable.[^aionui-binary][^aionui-resolve] The startup path that requires it was named in the desktop entry and was not line-read. The run loop, if it has an event log, is in that binary. This repo is the Electron shell, SQLite schema, and UI. llame keeps [Chat and Run identity](../../../VISION.md#runs-are-the-unit-of-execution) in the API. AionUi's comparable log was not available to read.
2. **Team mode is a leader and a mailbox, in the README.** A leader splits work and delegates through a built-in Team MCP server. Teammates run in parallel, share an async mailbox, and write a task board. External agents connect through ACP. The same folder is shared, and each agent has its own permission dialog.[^aionui-readme] The shared folder is the placement fact to weigh against [a Sandbox that does not receive the whole Home](../../../VISION.md#portable-data-isolated-execution). This pass did not read the MCP server.
3. **A team member can own a cron job.** The unit test stubs a conversation whose `extra.cron_job_id` is `cron-1` and expects `removeCronJob('cron-1')` before the member is removed.[^aionui-cron] A conversation with no cron id is removed without calling `removeCronJob`.[^aionui-nocron] The host must be the process that fires that job. The board says scheduled tasks need the host awake. The scheduler loop was not opened.
4. **Unattended mode is per agent.** The README says supported agents can expose YOLO or full-auto, and that the modes depend on the selected agent.[^aionui-readme] The board's terms excerpt says unattended execution can change or delete files. The terms page was not re-read here.

**llame fit**

- Moderate: item 1 as a catalog of peer CLIs behind one desktop. The event model is the missing piece for a comparison with [SSE replay](../../../SPEC.md#94-run-events).
- Low: item 2 until the Team MCP server is read. Child-agent orchestration is [not the current llame cut](../../../VISION.md#runs-are-the-unit-of-execution).
- Low: item 3 as evidence that a schedule is a row on the conversation, cleaned up with the member.
- Avoid: item 4 as a default. A mode that skips per-step confirmation is the peer CLI's policy, and llame's [harness still owns execution](../../../VISION.md#the-harness-owns-execution).

**Caution:** Office-file workflows are the board's product distinction and were not traced. Phone access on the board is WebUI and messaging, not a native app this pass verified. `readme.md` is the filename in the tree; the board links `README` on GitHub, which resolves for that host.

[^aionui-pkg]: [Apache-2.0 Electron app, package version 2.2.2, with a webui script](https://github.com/iOfficeAI/AionUi/blob/11cd2a9a20d1e033157636efc570b41384c66d85/package.json#L1-L21)

[^aionui-readme]: [Detected CLIs, YOLO mode, and a leader that delegates through Team MCP](https://github.com/iOfficeAI/AionUi/blob/11cd2a9a20d1e033157636efc570b41384c66d85/readme.md#L162-L188)

[^aionui-binary]: [The desktop looks up an aioncore binary that is not source in this tree](https://github.com/iOfficeAI/AionUi/blob/11cd2a9a20d1e033157636efc570b41384c66d85/packages/desktop/src/process/backend/binaryResolver.ts#L1-L14)

[^aionui-resolve]: [resolveBinaryPath is the lookup](https://github.com/iOfficeAI/AionUi/blob/11cd2a9a20d1e033157636efc570b41384c66d85/packages/desktop/src/process/backend/binaryResolver.ts#L71)

[^aionui-cron]: [Removing a team member removes its cron job first](https://github.com/iOfficeAI/AionUi/blob/11cd2a9a20d1e033157636efc570b41384c66d85/tests/unit/renderer/team/removeTeamAssistantWithCronCleanup.test.ts#L10-L31)

[^aionui-nocron]: [A member with no cron id is removed without removeCronJob](https://github.com/iOfficeAI/AionUi/blob/11cd2a9a20d1e033157636efc570b41384c66d85/tests/unit/renderer/team/removeTeamAssistantWithCronCleanup.test.ts#L34-L48)
