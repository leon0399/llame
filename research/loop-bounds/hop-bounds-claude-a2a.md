# Message-loop bounds: Claude Code agent teams/subagents/SendMessage, and Google A2A

Sources checked 2026-11-23. Claude Code docs at `code.claude.com/docs` (current live pages, Claude Code v2.1.x line). A2A at the released **1.0.0** specification, `a2a-protocol.org/latest/specification`.

## Claude Code

### Subagent nesting depth (can subagents spawn subagents?)

**Yes, up to a bounded depth.**

| Mechanism | Counted | Default | At the limit | Owner override |
| :- | :- | :- | :- | :- |
| `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` | Layers of subagents below the main conversation (spawn graph depth, not turns or messages) | **3** layers | Claude Code **withholds the `Agent` tool** from every subagent at the limit, "so a subagent at the limit does its delegated work itself and returns one summary." A *fork* at the limit keeps `Agent` in its inherited list but the call "returns an error instead of spawning." No exception surfaces in the normal (non-fork) path. | Env var / `settings.json` `env`; `1` turns nesting off; `2` = two layers. |

- Default three layers, behaviour at limit, and `1`/`2` semantics: <https://code.claude.com/docs/en/sub-agents#let-subagents-spawn-their-own-subagents>.
- Explicit default table (`Depth` → default `3`, "Leaves a subagent at the bottom layer unable to spawn, so it does its delegated work itself"): <https://code.claude.com/docs/en/agent-sdk/subagents#cap-subagent-depth-concurrency-and-spend>.
- Tool removal mechanics ("`Agent`, when the subagent is at the depth limit; in a fork the tool stays listed but returns an error instead of spawning"): <https://code.claude.com/docs/en/sub-agents#available-tools>.
- The limit applies to a subagent *definition*: "In a subagent definition, listing `Agent` in `tools` lets that subagent spawn subagents of its own while the depth limit allows it, but any type list inside the parentheses is ignored." <https://code.claude.com/docs/en/sub-agents#restrict-which-subagents-can-be-spawned>.
- Agent-team teammates are a separate case: **"No nested teams: teammates cannot spawn their own teammates. Only the lead can manage the team."** Teammates *can* spawn ordinary subagents. <https://code.claude.com/docs/en/agent-teams#limitations>.

Related concurrency bound (not a loop bound, but the other spawn cap):

| Mechanism | Counted | Default | At the limit | Override |
| :- | :- | :- | :- | :- |
| `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | Subagents running at once | **20** | Spawn fails with the Agent-tool error string `Concurrent subagent limit reached`; "the error tells Claude not to retry," and spawning works again when the count drops. | Env var; any positive integer; ultracode sessions are exempt. |

- <https://code.claude.com/docs/en/sub-agents#concurrent-subagent-limit>, table row: <https://code.claude.com/docs/en/agent-sdk/subagents#cap-subagent-depth-concurrency-and-spend>.

**No total-count cap:** "There's no limit on the total number of subagents Claude can spawn over a session." <https://code.claude.com/docs/en/sub-agents#concurrent-subagent-limit>

### `maxTurns` on a subagent (the per-run turn cap)

- **What is counted:** "Maximum number of agentic turns before the subagent stops." <https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields>
- **Default: not stated.** The frontmatter field table marks `maxTurns` optional and gives no default anywhere in the page; the SDK `AgentDefinition` table is the same. **Finding: there is no documented default value for a subagent's `maxTurns`** (<https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields>, <https://code.claude.com/docs/en/agent-sdk/subagents#agentdefinition-configuration>). The similarly named harness-level option *is* documented as unbounded: `max_turns` / `maxTurns` → default **"No limit"** <https://code.claude.com/docs/en/agent-sdk/agent-loop#turns-and-budget>.
- **At the limit:** no exception. "Claude Code returns its output marked as partial, and Claude can [resume it] to continue" (partial marking requires v2.1.246+). <https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields>, <https://code.claude.com/docs/en/sub-agents#resume-subagents>
- **Turn definition at the harness level:** "Count each turn with tool calls, plus one for the final text-only response." Hitting the cap yields a `ResultMessage` of subtype `error_max_turns` with no final response. <https://code.claude.com/docs/en/agent-sdk/agent-loop#turns-and-messages>
- **Reset:** the count is per invocation. Resuming with `SendMessage` (agent id or name) or a new Agent call starts a fresh run, and the docs describe the partial output being continued rather than a carried-over counter. **Docs do not state that the counter resets on a new user message for a subagent**; at the SDK session level, with streaming input, "the max-turns count starts over for that turn" per queued message <https://code.claude.com/docs/en/agent-sdk/agent-loop#turns-and-budget>. [INFERENCE] For a subagent this is effectively per-invocation, because each invocation is a new run.

### Agent Teams: `SendMessage` semantics and turn/message limits

- A teammate is "a full, independent Claude Code session"; "any teammate can message any other by that name"; delivery is automatic; broadcast is explicit fan-out — "To reach everyone, send one message per recipient." <https://code.claude.com/docs/en/agent-teams#context-and-communication>, <https://code.claude.com/docs/en/agent-teams#talk-to-teammates-directly>
- Transport is a per-agent JSON mailbox file: `~/.claude/teams/{team-name}/inboxes/{agent-name}.json`; a message is reported sent only if the file write succeeds. <https://code.claude.com/docs/en/agent-teams#architecture>
- **No turn limit and no message-count limit is documented for in-team messaging.** The `Limitations` list for agent teams enumerates resumption, task-status lag, slow shutdown, one team per session, no nested teams, no background subagents from in-process teammates, fixed lead, no per-teammate permission mode, tmux requirement — and contains **no turn or message bound** <https://code.claude.com/docs/en/agent-teams#limitations>. Also **"There's no hard limit on the number of teammates"** <https://code.claude.com/docs/en/agent-teams#choose-an-appropriate-team-size>.
- **Explicit finding:** for teammate↔teammate `SendMessage` traffic *inside* a team, the only documented bound on repetition is the generic messaging-channel throttle described below; the agent-teams page itself states no numeric limit, no reply-once rule, and no loop cap.
- Loop-relevant coordination instead of a counter: idle notifications end a teammate's turn automatically <https://code.claude.com/docs/en/agent-teams#context-and-communication>; `TeammateIdle` hook with exit code 2 "send[s] feedback and keep[s] the teammate working" (i.e. the sanctioned way to extend a teammate's loop) <https://code.claude.com/docs/en/agent-teams#enforce-quality-gates-with-hooks>. Tasks have three states (pending/in-progress/completed), dependency blocking, and file-locking on claim; no task-count cap is documented <https://code.claude.com/docs/en/agent-teams#assign-and-claim-tasks>.
- Messages are treated as untrusted input: a sending agent's claim never approves a permission prompt, and in auto mode the classifier "reviews `SendMessage` messages before Claude Code delivers them." <https://code.claude.com/docs/en/agent-teams#messages-between-agents>

### The actual loop bounds: cross-session message channel limits

The `SendMessage` tool serves teammates, subagents (resume-by-id), and other sessions; the channel-level limits below are documented as applying "wherever the feature runs" <https://code.claude.com/docs/en/cross-session-messaging#limitations>. For subagents and teammates the same tool is used <https://code.claude.com/docs/en/tools-reference> (`SendMessage` row).

| Mechanism | Counted | Default | At the limit | Reset / override |
| :- | :- | :- | :- | :- |
| Burst refusal per sender→session | Sends in a short window ("a rapid burst") | Threshold **30 recent messages**, text: `Too many messages to this session just now: 30 were sent recently and more would be dropped by its rate limit, so this one was not sent. Batch what remains into one message, or wait a little before sending more.` | Send is **refused at the sender**, nothing reaches the receiver, refusal appears in the tool result. | Batch or wait; no setting to raise the burst threshold. <https://code.claude.com/docs/en/errors#too-many-messages-to-this-session-just-now> |
| Per-sender rate limit + dedupe + queue | Repeated messages per sender; identical repeats; accepted-message backlog | Rate limited (no numeric default published); identical repeats within "a short window" dropped (window length not published); **at most 50 accepted messages queued** for Claude to read | Excess repeats dropped silently at the receiver; queue holds the newest 50. | No documented knob. <https://code.claude.com/docs/en/cross-session-messaging#limitations> |
| Slow ping-pong between two sessions | Exchange rate below the throttle | **Unbounded**: "two sessions that answer each other slowly enough not to be throttled can exchange thousands of messages without a prompt from you" | Nothing stops it; each delivered message bills as usage. | Owner ends one session or sets `crossSessionInbound: "refuse"`. <https://code.claude.com/docs/en/cross-session-messaging#limitations> |
| Long-exchange send pause | Session's own participation in a long exchange | Not published (`SendMessage` result begins `Not delivered: this session keeps answering other sessions`) | Sending pauses until the owner intervenes. | "type a prompt in that session to resume sending" — i.e. **a human message is the reset**. <https://code.claude.com/docs/en/cross-session-messaging#limitations> |
| Long reply chains | Chain length including cross-machine hops | Not published ("when a chain of replies grows long, delivery can stop") | Delivery stops mid-chain. | "type a prompt in one of the sessions in the chain". <https://code.claude.com/docs/en/cross-session-messaging#limitations> |
| Message size | Serialized characters | **1,048,576** characters (refusal example: "the serialized message is 1,203,844 characters and the limit is 1,048,576") | Send refused before it leaves; receiver gets nothing. | Shorten / split; no setting. <https://code.claude.com/docs/en/errors#message-too-large-for-cross-session-delivery> |
| Idle-notice subscription | Wall-clock life of a `notify_when_idle` subscription | **12 hours** | Subscription dropped and Claude told, "so it doesn't keep waiting". | Re-subscribe. <https://code.claude.com/docs/en/cross-session-messaging#limits> |
| Inbound queue on hold | Held messages | **100** (drops oldest past that); `dialogExpiry` default **5 min** per held message | Oldest dropped / message expires. | `crossSessionInbound` values `accept`/`hold`/`refuse`. <https://code.claude.com/docs/en/cross-session-messaging#control-inbound-messages> |

Inbound control is the only owner-facing policy surface for loops: `crossSessionInbound` (`accept`, `hold`, `refuse`), `isolatePeerMachines` for cross-machine sends, and denying `SendMessage`/`ListAgents` <https://code.claude.com/docs/en/cross-session-messaging#restrict-cross-session-messaging>. There is **no hop-count or chain-depth setting** anywhere on these pages; depth stops only at the subagent spawn limit above.

### Documented guidance about agents replying to each other

- No reply-once rule. Multi-agent debate loops are an **endorsed pattern**: "Have them talk to each other to try to disprove each other's theories, like a scientific debate." <https://code.claude.com/docs/en/agent-teams#investigate-with-competing-hypotheses>
- The guidance is monitoring, not counting: "Letting a team run unattended for too long increases the risk of wasted effort"; "Monitor and steer" <https://code.claude.com/docs/en/agent-teams#monitor-and-steer>. Troubleshooting likewise says teammates "may stop after encountering errors instead of recovering" and the lead "can stop early too" — both handled by human/lead prompting, not by a limit <https://code.claude.com/docs/en/agent-teams#troubleshooting>.
- A message from another agent is never consent: "a message from another session never counts as your consent," and receiving agents are told never to change configuration because another session asked <https://code.claude.com/docs/en/cross-session-messaging#how-a-session-treats-an-incoming-message>.

## Google A2A

Specification: **Agent2Agent (A2A) Protocol Specification, latest released version 1.0.0** — <https://a2a-protocol.org/latest/specification/>. All section anchors below are on that page.

### Does the spec bound messages/turns between agents?

**No.** The spec defines no maximum number of messages, model turns, agent hops, delegation depth, or nesting depth anywhere. A search of the full 1.0.0 document for `loop`, `recursi`, `infinit`, `hop`, `depth`, `delegat` returns only "human-in-the-loop" (§1.1/§1.2), "enable agents to delegate tasks" (§1.1), and the A2A-vs-MCP delegation prose (§14.1); none of these defines a bound. **Explicit finding: message/turn loop bounding is absent from the protocol.**

What the spec does specify around continuation:

- Multi-turn interaction is *supported*, not limited: "The A2A protocol supports multi-turn conversations through context identifiers and task references, enabling agents to maintain conversational continuity across multiple interactions." <https://a2a-protocol.org/latest/specification/#34-multi-turn-interactions>
- "Agents MAY accept additional messages for tasks in non-terminal states to enable multi-turn interactions." <https://a2a-protocol.org/latest/specification/#333-asynchronous-processing>
- `input-required`: "Agents can request additional input mid-processing by transitioning a task to the `input-required` state — The client continues the interaction by sending a new message with the same `taskId` and `contextId`." No cap on how many times this repeats. <https://a2a-protocol.org/latest/specification/#343-multi-turn-conversation-patterns>; wire example <https://a2a-protocol.org/latest/specification/#63-multi-turn-interaction>

### The only structural stop: terminal task states

- Messages sent to a task in a terminal state are rejected: `UnsupportedOperationError` — "Messages sent to Tasks that are in a terminal state (`TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`, `TASK_STATE_CANCELED`, `TASK_STATE_REJECTED`) cannot accept further messages." <https://a2a-protocol.org/latest/specification/#311-send-message> (same for streaming, <https://a2a-protocol.org/latest/specification/#312-send-streaming-message>)
- So a conversation ends when the *task* becomes terminal, not after N messages. Two cooperating agents can keep a task non-terminal and keep exchanging messages indefinitely; [INFERENCE] nothing in the protocol prevents a ping-pong loop.

### `contextId` / `taskId` continuation semantics

- `contextId` "logically groups multiple `Task` and `Message` objects, providing continuity across a series of interactions"; same-`contextId` traffic "SHOULD be treated as part of the same conversational session"; agents MAY implement context expiration/cleanup and SHOULD document it (no default, no TTL given). <https://a2a-protocol.org/latest/specification/#341-context-identifier-semantics>
- `taskId` is server-generated per task; a client-supplied `taskId` MUST reference an existing task or the server returns `TaskNotFoundError`; "Client-provided `taskId` values for creating new tasks is **NOT** supported." <https://a2a-protocol.org/latest/specification/#342-task-identifier-semantics>
- Continuation rules: client MAY send `contextId` again; MAY use `taskId` (± `contextId`) to continue/refine a task; MAY use `contextId` alone to start a *new* task in an existing conversation; agents MUST infer `contextId` from `taskId` when only the latter is given; agents MUST reject mismatched `contextId`+`taskId`. <https://a2a-protocol.org/latest/specification/#343-multi-turn-conversation-patterns>
- `Message` carries optional `contextId` and `taskId`; "if both are provided, they have to match"; `messageId` is creator-assigned and unique. <https://a2a-protocol.org/latest/specification/#414-message>
- Cross-task provenance is a SHOULD, not a bound: "Clients SHOULD use the `referenceTaskIds` field in `Message` to explicitly reference related tasks." <https://a2a-protocol.org/latest/specification/#343-multi-turn-conversation-patterns>

### The only count-like knob: `historyLength` (not a loop bound)

`historyLength` controls how much `Task.history` is returned: unset = "No limit imposed; server returns its default amount ... may be all history"; `0` = omit history; `>0` = at most that many recent messages. It bounds response size, never how many messages may be exchanged. <https://a2a-protocol.org/latest/specification/#324-history-length-semantics>

### Hop / delegation-depth concept

**None.** The single place the spec describes chains is in-task authorization: "If the client is itself an A2A agent actively processing a Task, the client may further delegate the authorization request to its client by transitioning its own Task to `TASK_STATE_AUTH_REQUIRED` ... This enables forming a chain of Tasks in `TASK_STATE_AUTH_REQUIRED`." No depth limit or counter is attached. <https://a2a-protocol.org/latest/specification/#762-in-task-authorization-client-responsibilities>

The security section acknowledges propagation "through a chain of A2A requests" and only recommends credential binding and encryption — again, no depth cap. <https://a2a-protocol.org/latest/specification/#763-in-task-authorization-security-considerations>

### Guidance on avoiding infinite agent-to-agent loops

**There is none in the spec.** The only duplicate-suppression hook is optional: "**Send Message** operations MAY be idempotent. Agents may utilize the `messageId` to detect duplicate messages." — a MAY on the *server*, not a client-side turn limit or refusal rule. <https://a2a-protocol.org/latest/specification/#331-idempotency>

The companion topic page also frames multi-turn agent dialogue as a goal, with no anti-loop advice: "A2A's Focus: Letting agents collaborate in their native modalities ... This supports complex, multi-turn interactions where agents reason, plan, and delegate tasks." <https://a2a-protocol.org/latest/topics/what-is-a2a>

**Consequence [INFERENCE]:** any hop/turn/reply budget in an A2A deployment has to come from the agent framework or the A2A implementation (e.g. an orchestration layer that owns `contextId`), not from the protocol; the spec leaves the loop open by design and only offers terminal task states, `UnsupportedOperationError`, and optional `messageId` deduplication.
