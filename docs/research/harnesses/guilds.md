---
type: Reference
title: "Guilds"
description: "AGPL orchestrator whose run transcript stays complete while the provider request stubs old tool results."
resource: "https://github.com/CigaleAI/guilds/tree/bb909023059a10bf6ba24ab3626b478c2404f76e"
tags: [harness, runs, transcript, routines, orchestration]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "bb909023059a10bf6ba24ab3626b478c2404f76e"
sources:
  - id: guilds-license
    resource: "https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/package.json#L1-L5"
    title: "Root package license AGPL-3.0-only"
  - id: guilds-runs
    resource: "https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/docs/concepts/runs.md#L1-L39"
    title: "A run is one agent's transcript and one of three kinds"
  - id: guilds-stub-doc
    resource: "https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/docs/concepts/runs.md#L103-L110"
    title: "Stubs replace old tool results in the model call only"
  - id: guilds-projection
    resource: "https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/apps/orchestrator/src/conversation/projection.ts#L4-L14"
    title: "The store stays exact; the provider request is a projection"
  - id: guilds-stub-fn
    resource: "https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/apps/orchestrator/src/conversation/projection.ts#L70-L95"
    title: "A stub records source seq, tool name, and hint, and old generations stub by size"
  - id: guilds-truncate
    resource: "https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/apps/orchestrator/src/toolbox/index.ts#L101-L104"
    title: "invokeTool stores a tool result already cut to TOOL_RESULT_MAX_BYTES"
  - id: guilds-truncate-default
    resource: "https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/apps/orchestrator/src/toolbox/index.ts#L179-L180"
    title: "The default cut is 65536 bytes"
  - id: guilds-chain
    resource: "https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/docs/concepts/runs.md#L112-L126"
    title: "A coding run hands off into a fresh run, at most five"
---

# Guilds

- **Stack:** TypeScript pnpm workspace. The root package is AGPL-3.0-only and targets Node 24. Apps include an orchestrator and a web UI.[^guilds-license] The [tierroom board](https://my-tierroom.party/agents/guilds) and [guilds.run](https://www.guilds.run/) are live pages and are not pinned.

Guilds is a self-hosted team of role agents with a browser UI. A run is the inspectable record of one agent session.[^guilds-runs] Source inspection of the run docs and the projection module; nothing was run. The board's hosted-pricing line was not checked against a price page.

**Study**

1. **Three run kinds share one transcript shape.** A direct run is a persistent chat. A group-chat run and a routine run are one-shot: one generation, then the run completes, and later messages wait until the operator resumes it into a conversation. An agent runs one thing at a time.[^guilds-runs] llame's [Run is one durable turn](../../../VISION.md#runs-are-the-unit-of-execution), and a Chat is where work continues. Guilds folds the continuing chat into the same run row and marks the one-shot kinds complete. The inspectable part is the shared idea: the operator can open the prompt, the messages, and each tool result.
2. **Stubbing is a projection.** The module comment says the store stays exact and only the provider request replaces large old tool bodies, and that the same rules can be replayed from stored rows.[^guilds-projection] `stubToolResultPayload` writes `stub`, `source_seq`, `tool_name`, and a hint. Results in generations older than the keep-floor are stubbed when they are at least `TOOL_RESULT_STUB_MIN_BYTES` (2048).[^guilds-stub-fn] The concept doc says the stored run keeps the full results, and the default keep is the current turn.[^guilds-stub-doc] `invokeTool` cuts the stored tool message to `TOOL_RESULT_MAX_BYTES` before that, default 65536, and records `truncated` on the metadata.[^guilds-truncate][^guilds-truncate-default] The projection does not rewrite an already-stored row. The row was already bounded. llame's compaction replaces an explicit prefix of the Chat; Guilds leaves the run body, after that cut, and changes the request.
3. **A long coding run continues as a new run.** The doc says a coding run that reaches 70% of the input limit asks for a summary and starts a fresh run from that summary. A chain holds at most five runs and keeps the kind, routine, or group delivery of the first.[^guilds-chain] An orchestrator restart marks unfinished tool calls interrupted so the transcript stays valid, and marks a one-shot run completed.[^guilds-runs]

**llame fit**

- High: item 2. A receipt of what the model saw can be a projection of an intact transcript. llame already requires [narrated context changes](../../../VISION.md#context-changes-are-narrated-not-silent) and an immutable attempt receipt. Guilds' stub is a concrete projection that still names `source_seq`.
- Moderate: item 1's direct versus one-shot split, if scheduled work should not leave a chat open. Routines are not a shipped llame feature.
- Moderate: item 3's bounded handoff chain. Five is their cap, not a llame number.
- Low: the guild and recipe product layer.

**Caution:** AGPL-3.0-only. The secrets doc, not re-quoted here, is the board's source for the claim that tool execution can see assigned secrets and that redaction is not an isolation boundary. This pass did not read that file. Hosted Guilds is described on the board as a proprietary layer; that split was not verified in this tree.

[^guilds-license]: [Root package license AGPL-3.0-only](https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/package.json#L1-L5)

[^guilds-runs]: [A run is one agent's transcript and one of three kinds](https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/docs/concepts/runs.md#L1-L39)

[^guilds-stub-doc]: [Stubs replace old tool results in the model call only](https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/docs/concepts/runs.md#L103-L110)

[^guilds-projection]: [The store stays exact; the provider request is a projection](https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/apps/orchestrator/src/conversation/projection.ts#L4-L14)

[^guilds-stub-fn]: [A stub records source seq, tool name, and hint, and old generations stub by size](https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/apps/orchestrator/src/conversation/projection.ts#L70-L95)

[^guilds-truncate]: [invokeTool stores a tool result already cut to TOOL_RESULT_MAX_BYTES](https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/apps/orchestrator/src/toolbox/index.ts#L101-L104)

[^guilds-truncate-default]: [The default cut is 65536 bytes](https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/apps/orchestrator/src/toolbox/index.ts#L179-L180)

[^guilds-chain]: [A coding run hands off into a fresh run, at most five](https://github.com/CigaleAI/guilds/blob/bb909023059a10bf6ba24ab3626b478c2404f76e/docs/concepts/runs.md#L112-L126)
