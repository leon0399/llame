---
summary: "The domain terms llame uses for Chats, Runs, context, tools, and models, with the words to avoid"
read_when:
  - you need the precise meaning of a llame term such as Run, Segment, Reply, or Workspace
  - you are naming a new concept and need to check it does not collide with an existing term
---

# llame glossary

The domain language of llame. Terms here are definitions, not behavior:
OpenSpec owns what each one does and wins any disagreement. Capitalized terms
are proper llame concepts; write them capitalized.

## People

**Owner**:
The user who owns a Chat, Project, Knowledge Space, or other item.
_Avoid_: user (when ownership is meant), account

**Operator**:
The party who installs and configures a llame instance and its providers,
models, tools, and policy.
_Avoid_: admin

## Conversation

**Chat**:
An owner's durable conversation: its messages, its context items, and its
Workspace binding. The unit that is shared, forked, pinned, and archived.
_Avoid_: conversation, thread, session

**Turn**:
One user message together with the assistant output that answers it.
_Avoid_: exchange, round

**Reply**:
The assistant message that one Segment produces.
_Avoid_: response, answer

**Host message**:
A message in a Chat authored by llame itself, neither the owner nor the
assistant, such as one that carries a background job's result.
_Avoid_: system message

**Project**:
An owner's named group of Chats. It is not a Workspace, a Knowledge Space, or a
security boundary.
_Avoid_: folder

**Pin**:
A user's own marker that keeps a Chat or Project at the top of their list.

**Archive**:
The reversible state that removes a Chat or Project from the working list. It
is neither deletion nor unsharing.

**Public share**:
The public, read-only view of a Chat. It shows text only and omits the owner's
private parts.
_Avoid_: shared Chat, share link, public chat

**Owner fork**:
A new Chat made by the owner from a prefix of their own Chat, keeping its
context and Workspace binding.

**Shared fork**:
A new Chat made by another user from a Public share. It receives only what the
Public share shows.
_Avoid_: public fork

## Execution

**Run**:
One durable execution of a Chat's assistant, from admission to a terminal
state. A Chat has at most one Run that is not terminal, and a Run may produce
several Replies.
_Avoid_: job, request, task

**Segment**:
The part of a Run that produces one Reply, served by one model. A Segment
starts when the Run starts or at a Segment boundary: a Delivery into the Run
or, once model failover ships, a model switch.
_Avoid_: step, turn

**Attempt**:
One try at executing a Run, from a worker's claim until that worker stops. A
retried Run has several.
_Avoid_: retry (for the try itself)

**Delivery**:
An owner message sent into a Chat while its Run is live, in one of three modes:
steer, interrupt, or queue.
_Avoid_: injection, follow-up

**Continue**:
A Run that resumes the latest Turn's unfinished Reply from its completed parts.
_Avoid_: resume, retry

**Regenerate**:
A Run that replaces the latest Turn's Reply with a new one from the same user
message.
_Avoid_: retry, reroll

**Cancellation**:
The owner's recorded request to stop a Run.
_Avoid_: abort

**Background job**:
Work started by a tool call that outlives that call, owned by the Chat and
addressed by a `job://` locator.
_Avoid_: job (unqualified), task, process

**Permission mode**:
The mode a Run executes under: `default`, `read-only`, or `bypass`.
_Avoid_: access mode

**Permission group**:
An operator rule set that decides whether calls of one tool family are
allowed.
_Avoid_: policy group

## Location

**Workspace**:
The binding of a Chat to one directory tree on the host or on a Machine, where
its file and shell tools run.
_Avoid_: project, folder

**Machine**:
An operator-configured remote host that llame reaches over SSH.
_Avoid_: node, server

**Knowledge Space**:
An owner's personal Markdown collection, addressed by `kb://`.
_Avoid_: knowledge base, vault

**Locator**:
The URI-like name a tool's `path` argument accepts, such as a host path,
`kb://`, `skill://`, `job://`, or `artifact://`.
_Avoid_: URL, address

## Context

**Context item**:
A piece of context llame itself places in a Chat's model input, such as a
compaction checkpoint or a recency digest.
_Avoid_: injection, system reminder

**Compaction checkpoint**:
The Context item that replaces an older stretch of a Chat's history with a
summary.
_Avoid_: summary message

**Prompt receipt**:
The owner-visible record of the system prompt one Run sent.
_Avoid_: prompt log

**Recency digest**:
The bounded list of an owner's other Chats' titles and opening excerpts, frozen
into a Chat's system prompt when the owner opts in.

**Instruction file**:
A per-directory `LLAME.md`, `AGENTS.md`, or `CLAUDE.md` file whose content
llame adds to the model's context.
_Avoid_: project instructions

**Skill**:
An operator-provided package of instructions the assistant can load by name or
on its own judgment.

**Tool artifact**:
The complete result of a tool call that was too large to show inline, read
through `artifact://`.
_Avoid_: spill file

## Models

**Provider entry**:
One configured account with a model vendor or gateway: its credentials,
destination, and headers.
_Avoid_: provider account, provider (for the entry)

**Model entry**:
One configured model: the provider entry it uses, the wire it speaks, and its
declared capabilities.
_Avoid_: catalog model

**Wire**:
The protocol a model entry is called through, such as Responses, Chat
Completions, or Anthropic Messages.
_Avoid_: API, transport

**Effort**:
The reasoning-effort level a Run asks a model for, chosen from the levels that
model declares.
_Avoid_: thinking level

**Decision model**:
A model that answers a tool's yes-or-no questions about candidate results with
calibrated probabilities.
_Avoid_: judge, classifier

**Rerank model**:
A model that orders a tool's candidate results by relevance to a query.
_Avoid_: reranker (for the configured entry)
