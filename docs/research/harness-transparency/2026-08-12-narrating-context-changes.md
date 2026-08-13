# Narrating context changes to the assistant: what llame does, and who else does it

Surveyed 2026-08-12. Noncanonical — evidence and positioning, not a decision.

Prompted by the observation that llame continuously tells the assistant when its own world
changes — model, tools, history, standing context — and that this may be a differentiator.

## Verdict

**The mechanism is prior art. The pairing is not.**

Telling a model that its context was mutated is shipped by at least two Anthropic products and is
being standardised into the Claude API. llame did not invent it and should not claim to. What is
hard to find anywhere else is the **second half**: the same event, rendered for the assistant
in-band _and_ recoverable by the owner from an immutable per-Run receipt, so that "what did the
assistant actually see on turn 40, three weeks ago" has an exact answer.

That recoverability is **snapshot-backed content only**, and the distinction matters. The Run
receipt returns the effective system prompt, the tool declarations, the availability manifest and
their hashes — it does not enumerate reminder parts on the message rail. A mutation delivered as a
rail reminder (a recency-digest append, for instance) is disclosed by living in the owner's own
messages, not by the receipt. So the claim is that every mutation is disclosable to the owner, not
that every mutation is reachable from the receipt; §"What llame does not do" below states the gap
rather than glossing it.

Most systems do one or the other. Observability platforms log for _developers_; agent harnesses
narrate to the _model_. llame's receipt is owner-facing tenant data bound to the execution record,
which is a different artifact from a trace in an APM tool — and it is the part worth defending.

## 1. What llame does today, and what this change adds

Three shipped mutations and one proposed, each narrated, all through the same rail — a server-authored typed part,
strictly validated on write, rendered by a server-owned renderer, framed as data rather than
instruction:

| Mutation                | Narration                             | Where                             |
| ----------------------- | ------------------------------------- | --------------------------------- |
| Active model changed    | `renderModelSwitchReminder`           | `chats/model-context-part.ts`     |
| Tool availability moved | `renderToolAvailabilityReminder`      | `chats/tool-availability-part.ts` |
| History compacted       | `conversation-checkpoint`             | `chats/context-builder.ts`        |
| Standing context reset  | digest supersession marker (proposed) | `add-chat-recency-digest`         |

And the owner-facing half: every Run binds an immutable, content-hashed effective-context snapshot
(prompt + advertised tool contract + availability manifest), retrievable on demand, with host paths
and provider internals stripped. **This snapshot is deliberately partial**: it does not enumerate the
injected reminder parts, which are disclosed only incidentally by living in the owner's own message
rows. Closing that is the open gap in §5.

Two properties fall out that are rare in combination:

- **Persisted, not ephemeral.** Reminders are message parts on durable rows, and the snapshot is
  content-addressed and immutable. The narration is auditable long after the turn.
- **Typed, not prose.** `isModelSwitchPart` does exact-shape validation and authoring is
  server-only. Most systems inject strings.

## 2. Who else narrates to the model

**Anthropic's Claude API — context editing.** `clear_tool_uses_20250919` and
`clear_thinking_20251015` drop old tool results and thinking blocks server-side. Only the first
**replaces what it cleared with placeholder text so the model knows something was removed**; the
thinking strategy is documented as retaining a configured number of recent thinking turns and says
nothing about marking the ones it drops, so the narration claim here covers tool results and not
thinking blocks. `compact_20260112` goes further
and replaces earlier history with a model-generated summary. This is the same principle as llame's
compaction checkpoint, standardised at the API layer, and Anthropic now recommends the server-side
form over client-side compaction.

**Claude Code — `<system-reminder>`.** The most detailed instance in this survey. Reverse-engineering work
documents reminders for file modification (including the "modified by the user or by a linter"
notice), agent-roster changes, todo state after every tool call, empty-file flags, and
post-compaction restoration of recently-read files and active skills. The stated rationale is
twofold: keep the system prompt stable for caching by putting volatile content late, and counter
"context rot" by refreshing state via recency. (Community write-ups commonly cite ~80k tokens as
the point where adherence degrades; that figure is not established by the reverse-engineering
sources cited here, so treat it as folklore rather than a measurement.)
That is llame's placement argument, arrived at independently.

**Letta / MemGPT.** The agent edits its own memory blocks through tools, so it knows what changed
because it performed the change. Agent-initiated, not harness-narrated — a different shape, and it
does not cover mutations the harness performs on the agent's behalf.

## 3. Where the gap actually is

**MCP notifies the client, not the model.** The protocol defines
`notifications/tools/list_changed`, `resources/list_changed`, and `prompts/list_changed`, gated
behind a declared `listChanged` capability. The contract ends at the client: it should re-issue
`tools/list`. Whether the _model_ is told its capabilities moved mid-conversation is left entirely
to the client, and client adoption is acknowledged to be uneven. llame's tool-availability reminder
is precisely the client-side completion of that protocol signal, and the protocol does not require
it of anyone.

**OpenAI's `truncation: "auto"` is the counter-example.** It drops input items to fit the window
with no marker to the model. The Responses API reference states which items go — `auto` truncates
"by dropping input items in the middle of the conversation" — so the position is documented even
though the drop is not narrated, and it is the narration, not the position, that is missing.
Developers report it as a documented-behaviour gap — "silent removal of earlier context can cause
critical loss of information", exact drop-priority unspecified, and a compliance concern in
regulated workflows.
An assistant that has silently lost the middle of its own conversation, and does not know it, is
the failure mode the narration principle exists to prevent.

**Evaluations under-test it.** Frontier-model situational-awareness suites include a `disabled_tool`
challenge, but an external review of one such safety case notes the suites are _mostly
single-session_, and therefore miss awareness arising through prompt/context assembly, retrieval,
memory, or accumulated interaction. "Does the model notice its tools changed mid-conversation" is a
recognised but sparsely measured question.

**Academic framing exists and matches llame's posture.** _From Prompts to Contracts: Harness
Engineering for Auditable Enterprise LLM Agents_ argues that relocating behaviour from prompts to
inspectable contracts is what makes a system auditable rather than merely plausible — "prompts are
not guardrails." Separately, work on delegated-execution observability argues that glassbox
introspection of static prompts and outputs gives limited insight into decision provenance once
tool chaining and memory operations are involved.

## 4. What is actually distinctive

Ranked by how defensible each is:

1. **One event, two audiences, one artifact.** The assistant is told in-band; the owner can retrieve
   the exact bound context for that Run. Observability tools serve developers, not the end user
   whose data it is; agent harnesses narrate to the model without an owner-facing record. The
   combination is the differentiator.
2. **The record is immutable and content-addressed.** Not a log that can be rotated or a trace in a
   third-party APM, but tenant data bound to the execution record under the same isolation as
   everything else.
3. **Narration is typed and server-owned**, so an operator cannot edit away the framing that marks
   injected context as data rather than instruction.
4. **It generalises by construction.** The rail already carries three unrelated mutation kinds, and
   the digest adds a proposed fourth. Skills,
   agent profiles, knowledge changes, worker enrolment, and configuration edits are the same shape.

What is _not_ distinctive, and should not be claimed: narrating context mutation to a model, keeping
volatile content late for cache stability, or framing recalled content as data. All three are prior
art.

## 5. Implications

- **VISION.md** has no principle covering this. Transparency currently appears only as a property of
  knowledge changes ("visible, attributable, and recoverable") and implicitly under harness
  ownership. The disclosure rule is cross-cutting and load-bearing enough to state directly.
- The rule has teeth as a **constraint on future work**: any surface that injects, withdraws,
  summarizes, or reorders context must be able to say so, and must appear in the receipt. The
  recency digest was designed under that constraint and it is what forced the supersession marker.
- Extending the receipt beyond prompt and tool contract — to enumerate injected parts — is the
  obvious next gap, and was already flagged in
  [2026-07-27-user-context-injection.md](../long-term-memory/2026-07-27-user-context-injection.md) §9.3.

## Sources

- [Context editing — Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- [Anthropic Claude tool use — Amazon Bedrock docs](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages-tool-use.html)
- [Tools — Model Context Protocol specification](https://modelcontextprotocol.io/specification/2024-11-05/server/tools)
- [Using `notifications/tools/list_changed` — MCP discussion #76](https://github.com/orgs/modelcontextprotocol/discussions/76)
- [Conversation state — OpenAI API docs](https://developers.openai.com/api/docs/guides/conversation-state)
- [Detailed guide on truncation option in ModelSettings — openai-agents-python #1494](https://github.com/openai/openai-agents-python/issues/1494)
- [claude-code-reverse — visualizing Claude Code's LLM interactions](https://github.com/Yuyz0112/claude-code-reverse)
- ["System reminder" content injection consuming excessive context tokens — claude-code #4464](https://github.com/anthropics/claude-code/issues/4464)
- [What I Found Interesting in Claude Code's Source — Shlok Khemani](https://www.shloked.com/writing/claude-code-source-patterns)
- [Memory blocks (core memory) — Letta Docs](https://docs.letta.com/guides/core-concepts/memory/memory-blocks)
- [From Prompts to Contracts: Harness Engineering for Auditable Enterprise LLM Agents (arXiv 2607.08028)](https://arxiv.org/pdf/2607.08028)
- [Observability for Delegated Execution in Agentic AI Systems (arXiv 2606.09692)](https://arxiv.org/pdf/2606.09692)
- [Evaluating Frontier Models for Stealth and Situational Awareness (arXiv 2505.01420)](https://arxiv.org/pdf/2505.01420)
- [Lessons from External Review of DeepMind's Scheming Inability Safety Case (arXiv 2604.21964)](https://arxiv.org/pdf/2604.21964)
