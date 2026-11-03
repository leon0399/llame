---
type: Reference
title: "Tobs"
description: "MIT Cordis plugin on DeepSeek Harness. Each bot's memory is a Git repository the plugin commits. A paired phone steers the host."
resource: "https://github.com/BotHarness/DeepSeekBot/tree/71acbd541947013b9b122d8ca122130c28ce9f0d"
tags: [harness, memory, plugin, mobile, peer-executor]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "71acbd541947013b9b122d8ca122130c28ce9f0d"
sources:
  - id: tobs-license
    resource: "https://github.com/BotHarness/DeepSeekBot/blob/71acbd541947013b9b122d8ca122130c28ce9f0d/LICENSE#L1-L3"
    title: "MIT License heading"
  - id: tobs-readme
    resource: "https://github.com/BotHarness/DeepSeekBot/blob/71acbd541947013b9b122d8ca122130c28ce9f0d/packages/tobs/README.md#L105"
    title: "Each bot memory is a Git repository the sidebar can edit"
  - id: tobs-git
    resource: "https://github.com/BotHarness/DeepSeekBot/blob/71acbd541947013b9b122d8ca122130c28ce9f0d/packages/core/src/memory/git.ts#L79-L112"
    title: "initializeMemoryGit commits the seed with a local identity"
  - id: tobs-plugin
    resource: "https://github.com/BotHarness/DeepSeekBot/blob/71acbd541947013b9b122d8ca122130c28ce9f0d/packages/core/src/plugin.ts#L1-L27"
    title: "The plugin entry imports bot creation, channels, and cloud work"
  - id: tobs-cordis
    resource: "https://github.com/BotHarness/DeepSeekBot/blob/71acbd541947013b9b122d8ca122130c28ce9f0d/packages/core/src/plugin.ts#L98"
    title: "plugin.ts imports the Cordis Context type"
  - id: tobs-pkg
    resource: "https://github.com/BotHarness/DeepSeekBot/blob/71acbd541947013b9b122d8ca122130c28ce9f0d/packages/tobs/package.json#L1-L6"
    title: "Package description says it is a DeepSeekBot entry point"
  - id: tobs-never
    resource: "https://github.com/BotHarness/DeepSeekBot/blob/71acbd541947013b9b122d8ca122130c28ce9f0d/packages/core/src/workspaces/grant-execution.ts#L27-L48"
    title: "An orchestrator subagent's approval policy is set to never"
---

# Tobs

- **Stack:** TypeScript plugin, package `@botharness/tobs`, MIT.[^tobs-license] It runs inside [DeepSeek Harness](./deepseek-harness.md). The package description calls it the compatible entry point for DeepSeekBot.[^tobs-pkg] The [tierroom board](https://my-tierroom.party/agents/tobs) and [tobs.app](https://tobs.app/en/) are live pages and are not pinned. The board cites `fb4086b0`; this clone is `71acbd54`.

Tobs adds named bots, shared tasks, and inspectable memory on top of the harness. The harness note owns the host's session projection and approvals. This note owns what the plugin adds. Source inspection of the memory git helper and the plugin entry; nothing was run.

**Study**

1. **Memory is a Git repository beside the bot.** The package README says each bot's memory is a plain Git repository, the sidebar shows which lines changed, and the person can edit them.[^tobs-readme] `initializeMemoryGit` runs `git init -b main` when `.git` is absent, sets a local `user.name` of `BotHarness` and `user.email` of `bot@botharness.local`, and turns signing off. `commitMemoryRepositorySeed` commits `Initialize memory repository` when there is a diff.[^tobs-git] That is an inspectable store with history. llame's [Knowledge is curated Markdown](../../../VISION.md#memory-has-distinct-stores), and episodic memory is the database. Tobs puts bot memory in Git, which is closer to Knowledge than to the run log. Pushing that repo to GitHub, which the README offers so the same bot can be used on several computers, publishes the memory. This pass did not read the push path.
2. **The plugin is not a second harness.** `plugin.ts` imports bot creation, channels, and cloud work, and imports the Cordis `Context` type in the same file.[^tobs-plugin][^tobs-cordis] Runs, tool approvals, and the session projection stay in DeepSeek Harness unless this plugin replaces them. That replacement was not found in the files read here. llame's rule is the same shape: peers are [executor adapters](../../../VISION.md#runs-are-the-unit-of-execution), and a product layer should not invent a second session system.
3. **The phone steers a machine that stays on.** The board says invitation-only iOS and Android builds control the same bots while the computer is awake, and that the npm release does not publish those apps. Pairing code was not read. A phone that does not execute matches a Surface. Live desktop streaming, which the board says needs Tailscale, was not read.

**llame fit**

- High: item 1's decision that memory the owner should audit is a file history, not a hidden table. The local git identity and the unsigned commit are implementation details.
- Moderate: item 2, read next to the DeepSeek Harness note. Do not import Tobs' session model twice.
- Low: item 3 until the pairing protocol is read. Routines and @mention tasks are board and site claims.

**Caution:** `git add -A` inside the memory root commits whatever is in that directory.[^tobs-git] A memory directory that can contain secrets would publish them into the git object store. This pass did not check what the writer is allowed to place there. `alignOrchestratorSubagentPermission` sets the orchestrator's subagent approval policy to `never` when the session provenance is `subagent` and the root role is `orchestrator`.[^tobs-never] Browser and computer access default off, per the board, and were not verified in source.

[^tobs-license]: [MIT License heading](https://github.com/BotHarness/DeepSeekBot/blob/71acbd541947013b9b122d8ca122130c28ce9f0d/LICENSE#L1-L3)

[^tobs-readme]: [Each bot memory is a Git repository the sidebar can edit](https://github.com/BotHarness/DeepSeekBot/blob/71acbd541947013b9b122d8ca122130c28ce9f0d/packages/tobs/README.md#L105)

[^tobs-git]: [initializeMemoryGit commits the seed with a local identity](https://github.com/BotHarness/DeepSeekBot/blob/71acbd541947013b9b122d8ca122130c28ce9f0d/packages/core/src/memory/git.ts#L79-L112)

[^tobs-plugin]: [The plugin entry imports bot creation, channels, and cloud work](https://github.com/BotHarness/DeepSeekBot/blob/71acbd541947013b9b122d8ca122130c28ce9f0d/packages/core/src/plugin.ts#L1-L27)

[^tobs-cordis]: [plugin.ts imports the Cordis Context type](https://github.com/BotHarness/DeepSeekBot/blob/71acbd541947013b9b122d8ca122130c28ce9f0d/packages/core/src/plugin.ts#L98)

[^tobs-pkg]: [Package description says it is a DeepSeekBot entry point](https://github.com/BotHarness/DeepSeekBot/blob/71acbd541947013b9b122d8ca122130c28ce9f0d/packages/tobs/package.json#L1-L6)

[^tobs-never]: [An orchestrator subagent's approval policy is set to never](https://github.com/BotHarness/DeepSeekBot/blob/71acbd541947013b9b122d8ca122130c28ce9f0d/packages/core/src/workspaces/grant-execution.ts#L27-L48)
