---
type: Research
title: "Provider prompt caching, explicit cache boundaries, and llame's dynamic context"
description: "How provider KV/prefix caches decide what is reusable, where llame's per-turn and per-chat context sits in the request, and whether it prevents cache sharing between conversations."
tags:
  [
    prompt-caching,
    kv-cache,
    providers,
    anthropic,
    openai,
    system-prompt,
    context-injection,
  ]
status: draft
generated: { by: omp/claude-opus-5-5, at: 2026-09-26T00:00:00Z }
sources:
  - id: anthropic-prompt-caching
    resource: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching"
    title: "Anthropic prompt caching"
  - id: openai-prompt-caching
    resource: "https://developers.openai.com/api/docs/guides/prompt-caching"
    title: "OpenAI prompt caching"
  - id: deepseek-kv-cache
    resource: "https://api-docs.deepseek.com/guides/kv_cache"
    title: "DeepSeek context caching"
  - id: gemini-caching
    resource: "https://ai.google.dev/gemini-api/docs/caching"
    title: "Gemini context caching"
  - id: vllm-prefix-caching
    resource: "https://docs.vllm.ai/en/latest/design/prefix_caching.html"
    title: "vLLM automatic prefix caching"
  - id: omp-apply-head-caching
    resource: "https://github.com/can1357/oh-my-pi/blob/6ee309d18ba627291b8a099b6b276de071abb7ca/packages/ai/src/providers/anthropic.ts#L4054-L4126"
    title: "OMP applyHeadCaching"
  - id: omp-cache-scope
    resource: "https://github.com/can1357/oh-my-pi/blob/6ee309d18ba627291b8a099b6b276de071abb7ca/packages/ai/src/providers/anthropic-wire.ts#L22-L28"
    title: "OMP cache_control scope field"
  - id: openclaw-cache-boundary
    resource: "https://github.com/openclaw/openclaw/blob/533664f8825e81439e3aac28bab594aba34a4111/packages/ai/src/utils/system-prompt-cache-boundary.ts"
    title: "OpenClaw system prompt cache boundary"
  - id: codex-prompt-cache-key
    resource: "https://github.com/openai/codex/blob/c8c1ee5da8af5c79ec8433ee88d3d4ebdcfd80fd/codex-rs/core/tests/suite/prompt_cache_key.rs"
    title: "Codex CLI prompt_cache_key tests"
---

# Provider prompt caching and llame's dynamic context

Short answer: the per-turn reminders (current time, digest deltas, tool
availability, model switch) do not hurt caching, within or across
conversations. They ride the newest user message and are persisted in place.
What limits cross-conversation sharing is two other things: per-chat values
inside the system prompt (the chat's temporal anchor and the frozen digest
baseline), and, on Anthropic and current OpenAI models, the absence of any
cache write at the end of the shared head. On those two wires placement alone
changes nothing. A chat can only read another chat's cached head if some
request wrote an entry ending exactly at that head, and llame never asks for
one.

Evidence below is source and documentation reading on 2026-09-26 at master
`f689ad1e`. No cache-hit rates were measured.

## How provider caches decide what is reusable

All of them cache the KV state of a token prefix. Each block's hash chains over
every token before it, so one changed byte invalidates everything after
it[^vllm-prefix-caching]. The providers differ on three points: where an entry
is written, which positions a later request checks, and who shares the cache.

| Provider                    | Render order                                                  | Where entries are written                                                                                                      | Lookup                                                                                              | Min / lifetime                                          | Sharing scope                                                                                                 |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Anthropic                   | `tools` → `system` → `messages`                               | Only at breakpoints: explicit `cache_control` blocks (max 4) or the automatic top-level breakpoint on the last cacheable block | Each breakpoint plus 20 earlier block positions, for entries already written                        | 512 tokens on Opus 5.x; 5 min or 1 h, refreshed on read | Workspace (Claude API); organization on Bedrock/Vertex[^anthropic-prompt-caching]                             |
| OpenAI, GPT-5.6+            | Tools and schemas, then developer messages, then conversation | Implicit mode: end of the latest eligible message. Explicit `prompt_cache_breakpoint` on content blocks, up to 4 writes        | Explicit breakpoints, the implicit one, 20 earlier message ends, end of the initial developer block | 1,024 tokens; at least 30 min                           | Organization and region; `prompt_cache_key` optionally separates groups[^openai-prompt-caching]               |
| OpenAI, GPT-5.5 and earlier | Same                                                          | Implicit breakpoints at fixed intervals (2,048 tokens on 5.5)                                                                  | Fixed-interval boundaries                                                                           | Varies; `in_memory` 5–10 min or `24h`                   | Organization; a stable `prompt_cache_key` routes related requests to the same machine[^openai-prompt-caching] |
| DeepSeek                    | Chat template                                                 | End of user input, end of output, fixed intervals, and common prefixes detected across requests                                | Full match of a persisted unit                                                                      | Hours to days, best effort                              | Account[^deepseek-kv-cache]                                                                                   |
| Gemini                      | —                                                             | Implicit                                                                                                                       | Prefix                                                                                              | 4,096 tokens on 3.x                                     | —[^gemini-caching]                                                                                            |

Two rules determine the answer for llame:

1. **Writes happen only at breakpoints on Anthropic and in GPT-5.6+ implicit
   mode.** Anthropic says so directly: "The lookback does not find stable
   content behind your breakpoint and cache it. It finds entries that prior
   requests already wrote, and writes happen only at
   breakpoints"[^anthropic-prompt-caching]. OpenAI lists it as a gotcha: "A
   shared prefix is not always a cached prefix." A static developer message
   followed by a dynamic user message writes through the dynamic content, so
   the static part is reusable only if an explicit breakpoint sits after
   it[^openai-prompt-caching].
2. **Where sharing is automatic** (fixed-interval breakpoints on older OpenAI
   models, DeepSeek's common-prefix detection, vLLM/SGLang-style block
   caches), any two requests share everything up to their first differing
   token. There, placement is the only lever.

## What llame sends

Every wire gets the same logical layout. The volatility tier of each segment is
in brackets.

```text
tools        sorted by id, admitted set only          [instance + owner]
system       chat-default.md L1-26 static text        [instance, per model id]
             L27 "Context as of <anchor>"             [per chat, per compaction]
             L29-59 personalization                   [per owner]
             L61-88 recency digest baseline           [per chat, frozen until compaction]
             L89-107 skill catalog                    [instance, frozen per chat]
             L109-119 reminders + transparency rules  [static]
messages     history, replayed byte-identically       [per chat, append-only]
             newest user message:
               <system-reminder> items (time, digest delta,
               tool availability, model switch)       [per turn]
               user text
```

- The anchor is the chat's (or latest compaction's) creation instant, not the
  current time
  ([run-execution.service.ts L2670-L2673](../../../apps/api/src/runs/run-execution.service.ts#L2670-L2673),
  [chat-default.md L27](../../../apps/api/src/prompts/chat-default.md#L27)).
- The per-turn clock is a staged context item built with `new Date()`
  ([L3019-L3025](../../../apps/api/src/runs/run-execution.service.ts#L3019-L3025)).
  It is prepended to the triggering user message
  ([L3042-L3071](../../../apps/api/src/runs/run-execution.service.ts#L3042-L3071))
  and, on a completed run, persisted ahead of that message's parts in the same
  order ([L2271](../../../apps/api/src/runs/run-execution.service.ts#L2271)).
- The tool declarations are sorted by id, and unavailable tools are left out
  ([turn-tool-catalog.ts L492-L506](../../../apps/api/src/tools/turn-tool-catalog.ts#L492-L506)).
  `knowledge_search` depends on the owner's Knowledge Spaces
  ([run-execution.service.ts L2835-L2839](../../../apps/api/src/runs/run-execution.service.ts#L2835-L2839)).
- The Anthropic client sends only the top-level automatic breakpoint
  ([anthropic-model-client.ts L69-L71](../../../apps/api/src/models/anthropic-model-client.ts#L69-L71)),
  as its spec requires
  ([anthropic-messages-provider](../../../openspec/specs/anthropic-messages-provider/spec.md)).
  The Responses and Codex clients send no `prompt_cache_key` and no
  breakpoint. The system prompt reaches every SDK call as one string.

Size estimate at chars ÷ 4, with no tokenizer run: the default tool
descriptions are about 16.3k characters (≈4.1k tokens) before JSON schemas and
MCP tools. The static system text before the anchor is about 3.5k characters
(≈0.9k tokens). The static tail after the dynamic blocks is about 1.5k
characters (≈0.4k tokens).

## Findings

**F1: Per-turn reminders do not hurt caching.** They sit after all history, in
the only message that is new anyway. The existing specs already require this
placement: a per-turn value must not sit in the system prompt
([temporal-anchor spec](../../../openspec/specs/temporal-anchor/spec.md)),
and frequently changing state goes into rail deltas
([context-injection spec](../../../openspec/specs/context-injection/spec.md)).
OpenAI's guidance says the same: put timestamps and user-specific content at
the end or in later messages[^openai-prompt-caching]. They are persisted in
the order they were sent, so the next turn's replay matches byte for byte. One
exception: a run that does not complete does not persist its reminders, so the
next request's replay of that user message differs from what was sent. This
costs one prefix miss from that message on (high confidence from the code at
L2257-L2271).

**F2: The shared head ends at the anchor.** Each templated item in the system
prompt and in the tool descriptions, in request order:

| Item                                      | Varies by                                             | Changes when                         | Size (chars ÷ 4)                            | Effect on sharing between chats                                                                                             |
| ----------------------------------------- | ----------------------------------------------------- | ------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `{{#if tools.*}}` in tool descriptions    | Admitted tool set; `tools.knowledge_search` per owner | Owner's Knowledge or MCP set changes | —                                           | Owners with and without Knowledge diverge inside `edit.md` L4, the third tool. Same tool set: identical                     |
| `{{model.id}}`, L3                        | llame catalog entry                                   | Model switch                         | ~10                                         | Two catalog entries for one upstream model diverge here; the tools still match                                              |
| Anchor, L27                               | Chat (`createdAt` at minute precision)                | Compaction                           | ~40                                         | **First per-chat byte. Caps the shared head at tools + L1-26 (≈0.9k)**                                                      |
| Personalization, L29-59                   | Owner; resolved live on every attempt                 | Owner edits settings                 | 0 to owner-authored length                  | Could be shared across one owner's chats, but sits after the anchor. An edit re-prefills every open chat of that owner once |
| Digest baseline, L61-88                   | Chat; frozen at first turn                            | Compaction                           | ≤20 entries × ≤200-char excerpt, about 1-2k | Unique per chat by design                                                                                                   |
| Skill catalog, L89-107                    | Instance; frozen per chat                             | Compaction, if the catalog changed   | Instance-dependent                          | Identical across most chats, but sits after the anchor and the digest                                                       |
| Reminder and transparency rules, L109-119 | Nothing                                               | Never                                | ~0.4k                                       | Static, but lost because it sits last                                                                                       |

Between compactions, only the personalization block changes inside a
conversation. The anchor, digest and skills change only at compaction, which
replaces the history anyway, so they cost nothing extra there. Between
conversations, the current order leaves about 0.4k static tokens plus the
skill catalog outside the shareable head. For one owner's chats, it also
leaves out the personalization. No spec fixes the order within the template:
the temporal-anchor spec requires only that the anchor be deterministic
between compactions and that no per-request clock precede the cached prefix.

**F3: On Anthropic and GPT-5.6+, cross-conversation reuse is likely zero with
any ordering.** Automatic caching writes at the last block of each request.
GPT-5.6+ implicit mode writes at the end of the latest user or tool message. No
request writes an entry that ends at the tools/system boundary, so a new chat
has nothing to read there. The docs describe this failure case
explicitly[^anthropic-prompt-caching][^openai-prompt-caching]. OpenAI's
lookup set includes "the endpoint of the initial consecutive block of
developer messages". An entry there can only exist if something wrote it. The
docs describe writes only at the implicit and explicit breakpoints (moderate
confidence; hit rates not measured).

**F4: Where sharing is automatic, the anchor sets the limit today.** On GPT-5.5
and earlier, implicit breakpoints fall at fixed intervals, so chats of the same
model already share the head, rounded down to the last interval before the
anchor[^openai-prompt-caching]. DeepSeek persists detected common prefixes the
same way[^deepseek-kv-cache]. On these backends, moving per-chat content later
in the template extends the shared head with no other change.

**F5: Tool-set changes hurt more than the reminders.** A tool that becomes
unavailable (MCP server down, Knowledge Space unmounted) is removed from
`tools`. On Anthropic, that invalidates the tools, system, and message caches:
the whole conversation is re-prefilled[^anthropic-prompt-caching]. OpenAI
treats tool changes the same way and recommends keeping definitions fixed and
narrowing with `allowed_tools` or `tool_choice`[^openai-prompt-caching].
Owner-dependent admission (`knowledge_search`) also splits the shared head by
owner partway through the tools block. How often availability changes is
unmeasured.

**F6: The Responses and Codex clients send no `prompt_cache_key`.** Codex CLI
sends its session id as `prompt_cache_key`, and a forked thread keeps its
parent's key[^codex-prompt-cache-key]. For models before GPT-5.6, OpenAI routes
by the hash of the initial tokens (tools come first) plus the key. Without a
key, all llame chats of one model land in one routing group. That is harmless
below about 15 requests per minute and overflows above it. Whether the ChatGPT
Codex backend routes the same way is undocumented (low confidence).

**F7: The money at stake is small per chat opening.** Head sharing saves about
0.9 × (tools + static system) input tokens, roughly 5k, on three kinds of
request: the first request of a chat, the first request after compaction (the
anchor and history both change), and the first request after the cache
expires. At Opus 5.5 input pricing ($4/MTok) that is about $0.02 per
qualifying request. The bigger loss is the history re-prefill after a 5-minute
TTL lapse, which head sharing cannot recover. For personal chat usage, TTL
lapse is probably the main cause of misses (inference, not measured).

**F8: Cross-owner probing is already blocked by the layout.** Caches are shared
at the provider organization or workspace level, so every llame owner shares
the operator's cache. Owners see `cachedInputTokens` in the usage panel.
Probing another owner's history would require reproducing that owner's anchor
minute, personalization and digest, all of which precede the history. OpenAI
recommends per-customer `prompt_cache_key` values against probing, but on
GPT-5.6+ a key also separates reuse, which would give up instance-wide head
sharing[^openai-prompt-caching]. Any reordering must keep owner-specific
blocks ahead of owner content.

**F9: Smaller sources of prefix change.**

- Line 3 renders llame's catalog `model.id`, so two catalog entries for the
  same upstream model stop sharing about 30 tokens into the system prompt.
  Tools stay shared because they come first.
- A mid-chat effort change invalidates Anthropic's message cache, and OpenAI's
  entire prefix through the hidden system content. OpenAI's
  `configuration_update` item avoids this on GPT-6 models[^openai-prompt-caching].

## Prior art

- **OMP** sets a breakpoint on the last non-deferred tool and on the last
  stable system block. Volatile `<memories>` blocks go after it, and the
  remaining breakpoints go to the message tail. The inline comment states the
  reason: without the head breakpoints, "tail churn re-writes the whole head
  uncached"[^omp-apply-head-caching]. Its Claude Code OAuth path also sends a
  `scope: "global"` field under the `prompt-caching-scope-2026-01-05`
  beta, described as sharing the breakpoint across
  sessions[^omp-cache-scope]. The public caching page does not document it,
  and it is not available to llame's API-key wire (inference).
- **OpenClaw** splits the system prompt at a literal
  `<!-- OPENCLAW_CACHE_BOUNDARY -->` marker into `stablePrefix` and
  `dynamicSuffix`. It appends a boundary when an override has none, so hook
  additions land in the uncached suffix[^openclaw-cache-boundary].
- **OpenAI's own example** for GPT-5.6 has the same shape: stable developer
  text carrying an explicit breakpoint, then a separate developer message with
  user-specific content and timestamps[^openai-prompt-caching].

## Options

- **O1: Measure first.** Group recorded `cachedInputTokens / inputTokens` by
  request class: first turn of a chat, first turn after compaction, first turn
  after a gap longer than the TTL, and the rest. If the gap class dominates,
  the lever is TTL (Anthropic 1 h at 2× write; OpenAI `24h` retention on older
  models), not layout.
- **O2: Order the default template by volatility.** Static sections first
  (L1-26, reminders, transparency), then the instance skill catalog, then
  per-owner personalization, then the per-chat anchor and digest. This is a
  template-only change. It extends the shared head immediately on
  automatic-sharing backends (F4) and is required before O3 can help. Risk:
  untrusted data blocks move to the end of the system prompt, where they may
  carry more weight. Their framing text moves with them, but instruction
  following needs an eval, not an assumption. Operator override templates keep
  their own order.
- **O3: Explicit head breakpoints.** Send the system prompt as two
  `SystemModelMessage`s (AI SDK 6 accepts an array). The static and instance
  head gets `providerOptions.anthropic.cacheControl`, and the last tool gets
  the same. That uses 2 of Anthropic's 4 slots, with automatic caching keeping
  the tail. On OpenAI GPT-5.6+, `providerOptions.openai.promptCacheBreakpoint`
  goes on the head message; installed `@ai-sdk/openai` 3.0.97 maps it onto
  system and developer messages. Every request from any chat then refreshes the
  shared head, so it stays warm while any chat on the instance is active. This
  changes the Anthropic spec's "no block-level breakpoints" requirement, so it
  needs an OpenSpec change. Unverified: whether the extra write is charged when
  the tail write misses as well.
- **O4: Keep tool declarations fixed across availability changes.** Declare
  temporarily unavailable tools and restrict them with `allowed_tools` or
  `tool_choice`, or fail the call with the availability reason. This touches
  the tool-availability contract. Pursue it only if O1 shows availability
  changes are frequent.
- **O5: Leave it.** The in-conversation design is already correct. The
  cross-conversation gain is about 5k tokens per chat opening.
- **O6: Move the per-chat items out of the system prompt.** The anchor and
  the digest baseline are the only items that differ between any two chats
  without an owner or operator action. Every user turn already carries a
  persisted temporal receipt, so in an uncompacted chat the anchor repeats
  the first message's receipt. Its one unique job is dating the compaction
  summary, which a receipt at the head of the replacement history can do.
  The digest baseline can become a persisted context item on the first user
  message of each context window: the chat's first turn, and the first turn
  after a compaction re-bake. Its deltas already ride the rail. The system
  prompt then becomes identical across an owner's chats, and
  conversation-derived text leaves the system role. This conflicts with
  context-injection residency rule 3, which requires a prefix-resident
  baseline, and with the temporal-anchor spec, so it needs an OpenSpec change.
  Like O2, it pays on Anthropic and GPT-5.6+ only together with O3.

Recommended order: O1, then O6 with O3 if openings and compactions are a
material share of input cost. O6 supersedes O2. Leave O4 unless O1's data
calls for it.

[^anthropic-prompt-caching]: [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

[^openai-prompt-caching]: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)

[^deepseek-kv-cache]: [DeepSeek context caching](https://api-docs.deepseek.com/guides/kv_cache)

[^gemini-caching]: [Gemini context caching](https://ai.google.dev/gemini-api/docs/caching)

[^vllm-prefix-caching]: [vLLM automatic prefix caching](https://docs.vllm.ai/en/latest/design/prefix_caching.html)

[^omp-apply-head-caching]: [OMP applyHeadCaching](https://github.com/can1357/oh-my-pi/blob/6ee309d18ba627291b8a099b6b276de071abb7ca/packages/ai/src/providers/anthropic.ts#L4054-L4126)

[^omp-cache-scope]: [OMP cache_control scope field](https://github.com/can1357/oh-my-pi/blob/6ee309d18ba627291b8a099b6b276de071abb7ca/packages/ai/src/providers/anthropic-wire.ts#L22-L28)

[^openclaw-cache-boundary]: [OpenClaw system prompt cache boundary](https://github.com/openclaw/openclaw/blob/533664f8825e81439e3aac28bab594aba34a4111/packages/ai/src/utils/system-prompt-cache-boundary.ts)

[^codex-prompt-cache-key]: [Codex CLI prompt_cache_key tests](https://github.com/openai/codex/blob/c8c1ee5da8af5c79ec8433ee88d3d4ebdcfd80fd/codex-rs/core/tests/suite/prompt_cache_key.rs)
