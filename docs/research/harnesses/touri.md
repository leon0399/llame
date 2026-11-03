---
type: Reference
title: "Touri"
description: "Tauri desktop over Codex, Claude Code, and OpenCode, with group delegation enforced at depth 2 and six calls and optional container bot machines."
resource: "https://github.com/touri-ai/touri/tree/24c4a45299f59ed9da54e42c42465b42d54cc595"
tags: [harness, peer-executor, desktop, delegation, sandbox, routines]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "24c4a45299f59ed9da54e42c42465b42d54cc595"
sources:
  - id: touri-license
    resource: "https://github.com/touri-ai/touri/blob/24c4a45299f59ed9da54e42c42465b42d54cc595/LICENSE#L1-L3"
    title: "Apache License 2.0 heading"
  - id: touri-readme
    resource: "https://github.com/touri-ai/touri/blob/24c4a45299f59ed9da54e42c42465b42d54cc595/README.md#L7-L25"
    title: "Local Tauri app over installed CLIs, with optional bot machines"
  - id: touri-depth
    resource: "https://github.com/touri-ai/touri/blob/24c4a45299f59ed9da54e42c42465b42d54cc595/sidecar/src/groups/runtime.ts#L1251-L1253"
    title: "Depth at least 2 and a bot already on the stack fail the delegation"
  - id: touri-calls
    resource: "https://github.com/touri-ai/touri/blob/24c4a45299f59ed9da54e42c42465b42d54cc595/sidecar/src/groups/runtime.ts#L1274-L1277"
    title: "A group turn reserves at most six delegation calls"
  - id: touri-prompt
    resource: "https://github.com/touri-ai/touri/blob/24c4a45299f59ed9da54e42c42465b42d54cc595/sidecar/src/runtime/instructions.ts#L419"
    title: "The group prompt restates the same depth and call budget"
  - id: touri-session
    resource: "https://github.com/touri-ai/touri/blob/24c4a45299f59ed9da54e42c42465b42d54cc595/sidecar/src/groups/runtime.ts#L449"
    title: "Each native session keeps its own history"
---

# Touri

- **Stack:** Tauri v2 shell, Bun sidecar, React UI. Apache-2.0.[^touri-license] The [tierroom board](https://my-tierroom.party/agents/touri) and [touri.ai](https://touri.ai/) are live pages and are not pinned.

Touri runs persistent bots on Codex, Claude Code, or OpenCode CLIs that the person already installed. The README says conversations, memory, routines, and secrets stay on the machine unless a remote is configured, and that bot machines use Apple `container` on macOS and rootless Podman or Docker on Linux.[^touri-readme] Source inspection of the sidecar paths below; the container lifecycle was not re-read, and nothing was run.

**Study**

1. **Delegation limits are code, and the prompt repeats them.** `getTargetError` returns `DELEGATION_DEPTH` when `frame.depth >= 2`, and `DELEGATION_LOOP` when the target is already on the stack.[^touri-depth] `askAll` returns `DELEGATION_LIMIT` when `frame.turn.calls + targets.length > 6`, and it adds the whole batch to `calls` before any approval yields.[^touri-calls] The group instruction text tells the model the same ceiling.[^touri-prompt] A limit that exists only in the prompt would be advisory. Here the tool path rejects the call. Child agents in llame are [the same Run architecture, still unplanned](../../../VISION.md#runs-are-the-unit-of-execution); a hard depth and a reserved call budget are the shape to copy if that work starts.
2. **Each member keeps a provider session.** The runtime comment says each native session keeps its own history, and the shared context is explicit input bounded to 16k.[^touri-session] A group is not one merged transcript.
3. **The README's machine split is the placement claim.** Local bots are the default. Isolated machines are optional and host-specific.[^touri-readme] The board says a closed app does not run local routines, and that full-access Codex runs without the CLI sandbox while Touri's own tool policies still apply. Those two sentences were not re-checked in the scheduler or the Codex adapter in this pass. [Sandbox failure must not become native execution](../../../VISION.md#execution-follows-intent-and-capability) is the question those adapters have to answer.

**llame fit**

- High: item 1's enforced depth, cycle rejection, and reserved call count.
- Moderate: item 2. Separate peer sessions with an explicit shared packet match a meta-harness that does not merge executor histories.
- Low: item 3 until the machine and full-access paths are read line by line. Mobile clients are outside the board's reading of the v0.1 spec; this pass did not confirm a phone app in the tree.

**Caution:** The depth check is `>= 2` on the frame that is about to delegate, so the numeric meaning depends on whether the root frame starts at 0. The error string says the maximum depth is 2.[^touri-depth] Provider CLIs still receive the person's model traffic. Local-first in the README is not a claim that prompts stay on the machine.

[^touri-license]: [Apache License 2.0 heading](https://github.com/touri-ai/touri/blob/24c4a45299f59ed9da54e42c42465b42d54cc595/LICENSE#L1-L3)

[^touri-readme]: [Local Tauri app over installed CLIs, with optional bot machines](https://github.com/touri-ai/touri/blob/24c4a45299f59ed9da54e42c42465b42d54cc595/README.md#L7-L25)

[^touri-depth]: [Depth at least 2 and a bot already on the stack fail the delegation](https://github.com/touri-ai/touri/blob/24c4a45299f59ed9da54e42c42465b42d54cc595/sidecar/src/groups/runtime.ts#L1251-L1253)

[^touri-calls]: [A group turn reserves at most six delegation calls](https://github.com/touri-ai/touri/blob/24c4a45299f59ed9da54e42c42465b42d54cc595/sidecar/src/groups/runtime.ts#L1274-L1277)

[^touri-prompt]: [The group prompt restates the same depth and call budget](https://github.com/touri-ai/touri/blob/24c4a45299f59ed9da54e42c42465b42d54cc595/sidecar/src/runtime/instructions.ts#L419)

[^touri-session]: [Each native session keeps its own history](https://github.com/touri-ai/touri/blob/24c4a45299f59ed9da54e42c42465b42d54cc595/sidecar/src/groups/runtime.ts#L449)
