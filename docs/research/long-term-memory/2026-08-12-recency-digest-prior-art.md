# Recency digest: how other systems actually do it

Surveyed 2026-08-12, for #307. Noncanonical — evidence and alternatives, not a decision.

Prior note [2026-07-27-user-context-injection.md](2026-07-27-user-context-injection.md) analyzed one
ChatGPT snapshot and reasoned from llame's own invariants. This note asks a narrower question:
**when other systems inject cross-conversation awareness, what rail, what content, what freshness,
and is the injection template-driven?** It exists because #307's design was derived from first
principles against a single observed product, and first-principles arguments deserve a check against
what shipped.

---

## 1. The landscape

| System             | Rail                                                                                                         | Content                                                                          | Freshness                                | Operator/user templating     |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------- |
| **ChatGPT**        | System prompt                                                                                                | ~40 conversations, **every user-typed message**, no assistant replies            | re-rendered                              | none exposed                 |
| **Claude.ai**      | **Tool call** (`recent_chats`, `conversation_search`)                                                        | on demand, visible in transcript                                                 | n/a                                      | n/a                          |
| **Claude Code**    | System prompt (`MEMORY.md` index, 200-line cap) **+** `<system-reminder>` deltas **+** on-demand topic files | curated summaries; overflow deliberately not loaded                              | frozen at session start, deltas appended | none                         |
| **Letta / MemGPT** | System prompt, memory blocks compiled in                                                                     | agent-curated blocks, per-block char cap                                         | recompiled every step                    | **Jinja, user-customizable** |
| **Gemini**         | `user_context`                                                                                               | compressed profile/summary, explicitly **not** raw transcripts                   | periodic regeneration                    | none                         |
| **Open WebUI**     | System prompt                                                                                                | scalar variables only (`{{USER_NAME}}`, `{{CURRENT_DATE}}`, `{{USER_LOCATION}}`) | per-request                              | `{{VAR}}` substitution       |

Three distinct strategies, not one consensus:

```text
   INJECT RAW BODIES          INJECT CURATED STATE           RETRIEVE ON DEMAND
   ─────────────────          ────────────────────           ──────────────────
        ChatGPT               Letta   (agent-curated)             Claude.ai
                              ClaudeCode (summarized)         (llame today, #198)
                              Gemini  (summarized)
        n = 1                       n = 3                          n = 1
   published exfil exploit
```

**Nobody but ChatGPT injects verbatim other-conversation message bodies, and ChatGPT is the one
with a published working exploit against that exact section.**

---

## 2. ChatGPT — exact observed format

Reverse-engineered by Rehberger (Embrace The Red), consistent across two accounts. Six sections, all
in the system prompt: `Model Set Context`, `Assistant Response Preferences`, `Notable Past
Conversation Topic Highlights`, `Helpful User Insights`, `Recent Conversation Content`, `User
Interaction Metadata`.

`Recent Conversation Content` entries, verbatim shape:

```text
RECENT CONVERSATION CONTENT
1. 0504T17:19 New Conversation:||||hello, a new conversation||||show me a high five emoji!
10. 0503T21 Seattle Weather:||||how's the weather in seattle?||||How about Portland?
```

- `N. <timestamp> <label>:||||<user msg>||||<user msg>…`
- ~40 conversations.
- **Only user-typed messages. No assistant replies.** Halves volume and removes model-generated text
  — which may itself carry laundered instructions from earlier tool output — from the system role.
- Delimiter is `||||`, chosen because it is vanishingly rare in prose rather than impossible — user
  content can contain it, so the choice reduces collision probability rather than eliminating it. llame already has
  a tag-balance sanitizer, so tags are the cheaper choice here.
- Top ~5 entries carry second precision; the rest are truncated to the hour.
- Other blocks carry explicit framing prose (`These notes reflect assumed user preferences based on
past conversations`, `Auto-generated from ChatGPT request activity… may be imprecise and not
user-provided`). `RECENT CONVERSATION CONTENT` is a bare header with **no framing**.

**The exploit.** Rehberger demonstrated that processing untrusted content (summarize a page, analyze
a PDF) lets the document author exfiltrate the entire `Recent Conversation Content` section to a
third-party domain via a `url_safe` rendering bypass. The user's whole recent chat history leaves
the system prompt in one shot.

Important qualification, because it cuts both ways: **exfiltration risk is rail-independent.**
Anything in the context window is exfiltratable, whether it sits in the system role or immediately
before the user turn. This exploit therefore argues about _what volume of sensitive content is in
context at all_, not about placement. The placement-dependent risk is a different one —
_escalation_, conversation-derived text acquiring system-role authority.

Corollary for #307: the content decision (titles vs. bodies) drives the exfiltration surface; the
rail decision drives the escalation surface. They are separable and should be decided separately.

---

## 3. Claude Code — the frozen-baseline-plus-deltas hybrid, shipped

Closest published analogue to the hybrid under discussion (frozen system-prompt baseline + appended
message-rail deltas), and it runs three rails deliberately:

1. `MEMORY.md` — an **index**, loaded into the system prompt at session start, **hard-capped at 200
   lines**. Not re-read mid-session.
2. Recalled memories delivered mid-session inside `<system-reminder>` blocks, explicitly framed as
   _background context, not user instructions_.
3. Topic files (`debugging.md`, `patterns.md`) **not** loaded at startup — read on demand with
   ordinary file tools.

Observed first-hand: this session's own system prompt carries the `MEMORY.md` index plus the
instruction that reminder-delivered memories are background context and may be stale — "if one names
a file, function, or flag, verify it still exists." Introspective evidence, flagged as such, but it
matches the public docs.

Three transferable properties:

- **Index in the prompt, content behind retrieval.** Same discipline as #307's "inject awareness,
  retrieve content" — reached independently and shipped.
- **A hard line cap, not a token budget.** Cheap to reason about, cheap to enforce.
- **Deltas are framed and explicitly marked stale-able.** The reminder tells the model the recalled
  content may no longer be true. A frozen digest needs the same sentence.

The "two rails for one concern is a cost" objection weakens against this: Claude Code runs three,
split by volatility and size, and the split is the design rather than an accident.

---

## 4. Letta / MemGPT — templated system-prompt injection of tenant state

Directly on point for the _unification and control_ argument. Letta compiles memory blocks into the
system prompt on every agent step; blocks render into XML-style tags replacing a placeholder in a
system-prompt template, and **the template is customizable with Jinja**. Blocks are char-capped per
block. Agents edit them through tools (`memory_insert` / `memory_replace`) — mutation is **rewrite,
not append-delta**.

So: templated injection of mutable per-user state into the system prompt is an established,
widely-cited pattern, not an aberration. Two caveats:

- Letta pays the full prefix-cache cost and this is publicly discussed as a known tension — dynamic
  recompilation into the system prompt conflicts with byte-identical-prefix caching, and every
  memory write invalidates the downstream cache. Letta accepts it. **A frozen-per-chat baseline is
  strictly better than Letta on this axis.**
- Letta's template is customized by the _deployer of the agent_, who is also typically the operator
  and the user. llame's operator and owner are different principals, so "who may edit the framing
  prose" is a question Letta never has to answer.

Open WebUI is the conservative end of the same idea: templating exists but only over scalar values
(`{{USER_NAME}}`, `{{CURRENT_DATE}}`) — no iteration, no collections. That is where llame's
`PROMPT_CONTEXT_PATHS` sits today.

---

## 5. Claude.ai and Gemini — the two counterexamples

**Claude.ai chose tools.** `recent_chats` and `conversation_search` are visible RAG tool calls, on by
default for paid plans, scoped to all-chats-outside-projects or within a single project, with
incognito chats excluded from search. Product framing is explicit: information is retrieved only
when needed rather than the assistant ambiently knowing everything.

Two consequences for #307:

- Its premise — retrieval-only recall systematically under-fires — is a bet **against** the design
  Anthropic shipped for the same problem.
- Anthropic ships `recent_chats` as a **separate tool from search**. That is a fourth option this
  discussion has not considered: a cheap enumeration tool (list recent titles + dates, no semantic
  search, no bodies) alongside `search_conversations`. It does not eliminate the decide-to-call
  problem, but it makes a speculative call nearly free, which is most of what the digest buys, at
  zero standing token cost and no _standing_ injection surface.

**Gemini chose summarization.** Personal context maintains a compressed profile the model sees as
`user_context`, generated by periodic summarization across prior conversations — explicitly _not_
raw transcripts, with token overflow and attention dilution given as the reasons. Retention is
user-configurable (3 / 18 / 36 months / never), which is a decay lever llame has no equivalent for.

---

## 6. What this does and does not settle for #307

**Supports the proposal under discussion:**

- Frozen-baseline-plus-deltas is shipped by Claude Code. Not novel, not exotic.
- Templated injection of per-user state into the system prompt is shipped by Letta with a
  user-editable Jinja template. The unification argument has precedent.
- A frozen baseline is strictly better than Letta's per-step recompilation on prefix caching.
- Multiple rails split by volatility is a deliberate pattern, not a smell.

**Does not support it:**

- Verbatim other-conversation bodies in the system prompt are an n=1 pattern, and that one instance
  has a published exfiltration exploit against exactly that section. The convergent pattern across
  Letta, Claude Code, and Gemini is **curated, capped, or summarized** — never verbatim.
- ChatGPT ships that section with **no framing prose**, while its neighbors have it. If bodies are
  taken, framing is the thing to copy from the neighbors, not from `RECENT CONVERSATION CONTENT`.
- Every system that injects bodies or profiles caps hard and visibly (200 lines; per-block chars;
  ~40 entries; retention windows). No cap is described as evidence-derived — they are all engineering
  judgment, which weakens "the eval must set the cap" as a merge gate but does not excuse an absent
  cap.

**Unresolved tension inside llame's own research.** The [memory landscape
work](2026-07-05-memory-landscape/) concluded verbatim beats extraction for memory representations
(cf. _Verbatim Chunks Beat Extracted Artifacts_, arXiv 2601.00821). That finding is about content
that **is the answer** — retrieved chunks the model reasons over. A digest entry is a **pointer**
whose job is to trigger retrieval. The finding does not obviously transfer, but it is the strongest
in-house argument for verbatim first messages and should be answered rather than ignored.

**Option surfaced that was not on the table:** a `recent_chats` enumeration tool, per Anthropic's
split. Cheapest possible intervention, zero standing cost, injection surface only on turns where it is actually called, and it composes with
a digest rather than competing with one.

---

## Sources

- [How ChatGPT Remembers You: chat history, memory, preferences — Embrace The Red](https://embracethered.com/blog/posts/2025/chatgpt-how-does-chat-history-memory-preferences-work/)
- [Exfiltrating Your ChatGPT Chat History and Memories With Prompt Injection — Embrace The Red](https://embracethered.com/blog/posts/2025/chatgpt-chat-history-data-exfiltration/)
- [Use Claude's chat search and memory to build on previous context — Claude Help Center](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context)
- [How Claude remembers your project — Claude Code Docs](https://code.claude.com/docs/en/memory)
- [Claude Code Session Memory: Automatic Cross-Session Context](https://claudefa.st/blog/guide/mechanics/session-memory)
- [Memory Blocks: The Key to Agentic Context Management — Letta](https://www.letta.com/blog/memory-blocks/)
- [Memory blocks (core memory) — Letta Docs](https://docs.letta.com/guides/core-concepts/memory/memory-blocks)
- [Agent Memory System — letta-ai/letta, DeepWiki](https://deepwiki.com/letta-ai/letta/2.3-agent-memory-system)
- [Gemini app personalizes responses based on past chats, plus new privacy controls — Google](https://blog.google/products-and-platforms/products/gemini/temporary-chats-privacy-controls/)
- [Inside Gemini's Memory: Context, User Profiles, and Personalization](https://medium.com/@rushikeshchavan_99600/inside-geminis-memory-context-user-profiles-and-personalization-87bc1ae4ba18)
- [Temporal Awareness — Open WebUI docs](https://docs.openwebui.com/features/chat-conversations/chat-features/temporal-awareness/)
- [Verbatim Chunks Beat Extracted Artifacts (arXiv 2601.00821)](https://arxiv.org/pdf/2601.00821)
