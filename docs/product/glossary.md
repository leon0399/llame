---
summary: "The domain terms llame uses for Chats, Runs, tools, permissions, context, and models, with the words to avoid"
read_when:
  - you need the precise meaning of a llame term such as Run, Segment, Selector, or Workspace
  - you are naming a new concept and need to check it does not collide with an existing term
---

# llame glossary

The domain language of llame. Terms here are definitions, not behavior:
OpenSpec owns what each one does and wins any disagreement. Capitalized terms
are llame concepts; write them capitalized. Terms that are only planned are
left out until they ship.

## People and organization

**Owner**:
The user who owns a Chat, Project, Knowledge Space, Repository, or other item.
_Avoid_: user (when ownership is meant), account

**Operator**:
The party who installs and configures a llame Installation: its providers,
models, tools, permissions, and Machines.
_Avoid_: admin

**Org unit**:
A node of the nested organization tree: an organization, group, team, or
department. Membership in one grants no access to Chats or Projects.

**Membership**:
A user's role on one Org unit, inherited down the tree. Its `owner` role is an
organization role, not the Owner of an item.

**External identity**:
The link from one account on an outside identity provider to exactly one llame
user.

## Conversation

**Chat**:
An Owner's durable conversation: its messages, its Context items, and its
Workspace binding. The unit that is shared, forked, pinned, and archived.
_Avoid_: conversation, thread, session

**Turn**:
One user message, or one Host trigger, together with the assistant output that
answers it.
_Avoid_: exchange, round

**Reply**:
The assistant message that one Segment produces.
_Avoid_: response, answer

**Message sequence**:
A message's immutable position number within its Chat, used to address it.
_Avoid_: message index

**Host message**:
A message in a Chat authored by llame itself rather than by the Owner or the
assistant.
_Avoid_: system message

**Host trigger**:
The Host message that starts a Run with no Owner message, such as one for a
Background job's result.

**Project**:
An Owner's named group of Chats, which may link Repositories. It is not a
Workspace, a Knowledge Space, or a security boundary.
_Avoid_: folder

**Pin**:
A user's ranked marker that keeps a Chat or Project at the head of their list.

**Archive**:
The reversible, Owner-set state that removes a Chat or Project from the working
list and blocks changes to it. It is neither deletion nor unsharing.

**Public share**:
The public, read-only view of a Chat. It shows text only and omits the Owner's
private parts.
_Avoid_: shared Chat, share link, public chat

**Owner fork**:
A new Chat made by the Owner from a prefix of their own Chat, keeping its
context and Workspace binding.

**Shared fork**:
A new Chat made by another user from a Public share. It receives only what the
Public share shows.
_Avoid_: public fork

## Execution

**Installation**:
One deployed llame: its web, API, and Worker processes over one database.
_Avoid_: instance, node

**Worker**:
A process of the Installation that claims and executes Runs.
_Avoid_: node, runner

**Run**:
One durable execution of a Chat's assistant, from admission to a terminal
state. A Chat has at most one Run that is not terminal, and a Run may produce
several Replies.
_Avoid_: job, request, task

**Run status**:
Where a Run is in its life: active (`queued`, `running_model`), waiting
(`awaiting_jobs`), or terminal (`completed`, `failed`, `cancelled`, `expired`).
A terminal status never changes.

**Single-flight**:
The rule that a Chat has at most one Run that is not terminal.
_Avoid_: lock

**Stuck Run**:
A Run that is not terminal although nothing is executing it any more. The next
message to its Chat expires it.
_Avoid_: zombie, orphan

**Execution ceiling**:
The hard limit on how long one Run may execute, after which it expires.

**Segment**:
The part of a Run that produces one Reply, served by one model. A Segment
starts when the Run starts or at a Segment boundary: a steer or interrupt
Delivery or, once model failover ships, a model switch.
_Avoid_: step, turn

**Attempt**:
One try at executing a Run: a Worker's claim of it, or a Segment started
within that claim. A retried Run, or one with several Segments, has several.
_Avoid_: retry (for the try itself)

**Step**:
One model request together with the tool calls it made and their results.
Steps are counted per Segment.
_Avoid_: turn, iteration

**Step boundary**:
The point after a Step's tool results and before the next model request.

**Run event**:
One entry in a Run's append-only event stream, which clients replay to follow
or reconnect to the Run.

**Delivery**:
An Owner message sent to a Chat whose Run is live, in one of three modes:
steer, interrupt, or queue.
_Avoid_: injection, follow-up

**Steer**:
The Delivery mode that hands the message to the live Run at its next Step
boundary.

**Interrupt**:
The Delivery mode that cuts the live Run's current work and hands it the
message at once.

**Queue**:
The Delivery mode that holds the message until the live Run ends, then starts
a new Run for it.

**Pending item**:
A Delivery or job notice stored for a Chat that has not yet reached a Run. The
Owner can withdraw it or change its mode.
_Avoid_: queued message

**Follow-up Run**:
A Continue or a Regenerate.

**Continue**:
A Follow-up Run that resumes the latest Turn's unfinished Reply from its
completed parts.
_Avoid_: resume, retry

**Regenerate**:
A Follow-up Run that replaces the latest Turn's Reply with a new one from the
same message.
_Avoid_: retry, reroll

**Cancellation**:
The Owner's recorded request to stop a Run.
_Avoid_: abort

**Background job**:
Work started by a tool call that outlives that call, owned by its Chat and
addressed by a `job://` Locator.
_Avoid_: job (unqualified, where a queue job could be meant), task, process

**Job state**:
Where a Background job is: `running`, or settled as `succeeded`, `failed`,
`cancelled`, `timed_out`, or `lost`. A settled job never changes.

**Job notice**:
The record a Background job's settlement creates for its Chat, delivered to
the live Run or to a new one.

**Backgrounding**:
Moving a running host `bash` command into a Background job, on request or
automatically.
_Avoid_: detaching

**Native attempt**:
The durable record of a file or shell change, written before the change and
settled after it, so the change never runs twice.
_Avoid_: lock, transaction

**Outcome unknown**:
The failure of a Run redelivered after a Native attempt or MCP call whose
result was never recorded. llame never repeats that call.

## Tools

**Tool catalog**:
The tools one Attempt offers the model, each with its declaration.
_Avoid_: tool list, registry

**Tool allowlist**:
The Operator's list of tools an Installation offers at all.
_Avoid_: whitelist, enabled tools

**Tool classification**:
The effect class every tool declares, such as read-only, low-risk write,
high-risk write, or code execution. MCP tools are unverified.
_Avoid_: risk level

**Tool observation**:
The recorded result of one tool call, as the model receives it in history.
_Avoid_: tool output

**Locator**:
The URI-like name a tool's path argument accepts: a host path, or a scheme
such as `machine://`, `ssh://`, `kb://`, `skill://`, `media://`, `job://`,
`artifact://`, or an `http(s)://` URL.
_Avoid_: address

**Selector**:
The suffix on a `read` Locator that picks which lines of the result are
returned, such as `:N-M`, or which representation, such as `:raw` or
`:outline`.
_Avoid_: range argument, offset

**Listing**:
What `read` returns for a Locator that names a collection rather than one
file, such as a directory or a Knowledge Space root.

**Outline**:
The `:outline` representation of a Markdown file: its headings, frontmatter
keys, and table excerpts.

**Result bound**:
The limit on how many lines and characters one tool result shows inline.

**Cap notice**:
The last line of a bounded tool result that names how to read the rest.
_Avoid_: truncation message

**Tool artifact**:
The complete result of a tool call that exceeded its Result bound, read
through `artifact://`.
_Avoid_: spill file

**Scope**:
One target of a content search: a path, a glob, a Knowledge Space, or a
Skill.

**Objective**:
The optional statement in a search call of what the search is for, used only
to order its results.
_Avoid_: intent

**Passage**:
One result of a Knowledge or conversation search: an excerpt with its source
and a Locator that `read` accepts.
_Avoid_: snippet, hit

**Recall**:
The assistant's search and reading of the Owner's own earlier Chats.
_Avoid_: memory

**MCP server**:
An external tool server, configured by the Operator or declared by a
Workspace, whose tools join the Tool catalog under the server's name.
_Avoid_: plugin, connector

**Workspace MCP server**:
An MCP server a Workspace declares, owned by the Chat bound to that Workspace.

**Web adapter**:
An Operator-configured reader that renders a known site through that site's
own interface instead of its web page.

**Derived locator**:
A Locator a web read reaches without the model naming it, such as a redirect
or an announced alternate. Each one is admitted on its own.

**Web search engine**:
One configured search backend that `web_search` can query.
_Avoid_: provider

**Engine chain**:
The ordered list of Web search engines tried until one returns results.

**Aggregate engine**:
A Web search engine that queries several others and merges their results.

## Permissions

**Permission mode**:
The mode the Owner picks per send for one Run: `default`, `read-only`, or
`bypass`. It is never shown to the model.
_Avoid_: access mode

**Permission group**:
The Operator's allow and reject rules for one exact tool id, applied to each
call.
_Avoid_: policy group

**Permission clause**:
One literal or pattern match on one argument of a call, inside a Permission
group. A reject clause outranks every allow clause.

**Permission decision**:
The recorded allow or reject for one call or Derived locator, with its reason.
_Avoid_: audit event

**Eligibility**:
Whether a tool is offered to the model at all, set by the Tool allowlist.
Distinct from authorization, which a Permission group decides per call.

## Location

**Host**:
The llame Installation's own machine and filesystem, where native tools run
as the Worker's user.
_Avoid_: local, server

**Executor**:
The place a file or shell tool runs: the Host or one Machine.
_Avoid_: runner, node

**Machine**:
An Operator-configured remote computer running the llame machine daemon,
reached from the Installation.
_Avoid_: node, server

**Machine root**:
A directory a Machine declares addressable. It bounds addressing, not
authority.

**SSH host**:
A remote computer reached directly through an `ssh://` Locator. It is not a
Machine.

**Workspace**:
The binding of a Chat to one directory tree on one Executor, where relative
paths resolve and file and shell tools work by default. It is not confinement.
_Avoid_: project, folder

**Workspace generation**:
The counter that changes each time a Chat enters, switches, or leaves a
Workspace.

**Repository**:
An Owner's record of one git repository, identified by its remote.
_Avoid_: repo, project

**Checkout**:
One place a Repository exists on one Executor: a main clone or a Worktree.
_Avoid_: clone, copy

**Worktree**:
A git worktree Checkout made for one Chat on its own branch. Only the Owner
removes it.
_Avoid_: branch checkout

**Worktree lease**:
The record of which Chat created a Worktree. It locks nothing.

**Isolation policy**:
A Project's choice, per linked Repository, of whether new Chats get their own
Worktree.

**Start location**:
The Project, Repository, Checkout, and Executor a new Chat begins in.

## Context

**Context item**:
A piece of context llame itself adds to a Chat's model input, stored with the
Chat and replayed until a Compaction checkpoint absorbs it.
_Avoid_: injection

**Context rail**:
The single channel that carries Context items, each in its own
`system-reminder` block.
_Avoid_: rail (unqualified; the web UI has a navigation rail)

**Producer**:
The part of llame that authored a Context item, such as compaction, jobs, or
the Workspace.

**Form**:
The kind of a Context item: a notice of one event, a snapshot that replaces
the previous one, or a checkpoint that replaces earlier history.

**Frozen baseline**:
Context resolved once into the system prompt and changed only by later Context
items until the next compaction.

**Compaction**:
Replacing an older stretch of a Chat's history with a summary so the Chat fits
its model.
_Avoid_: truncation

**Compaction checkpoint**:
The Context item that holds a Compaction's summary.
_Avoid_: summary message

**Compaction epoch**:
The stretch of a Chat after its latest Compaction checkpoint. Several limits
and baselines reset at each one.
_Avoid_: context epoch, session

**Temporal anchor**:
The fixed date and time from which a Chat's current context is read, refreshed
only at compaction.

**Prompt receipt**:
The Owner-visible record of the system prompt one Attempt sent.
_Avoid_: prompt log

**Model switch**:
A change of the serving model, between Turns or within a Run, after which
reasoning from the previous model is not replayed.

**Recency digest**:
The bounded list of an Owner's other Chats' titles and opening excerpts,
frozen into a Chat's system prompt when the Owner opts in.

**Personalization**:
The profile the Owner writes for the assistant: name, about text, and response
preferences. It is never inferred.
_Avoid_: memory

**Episodic memory**:
The durable record of an Owner's Chats, Runs, and messages that Recall
searches.

**Instruction file**:
A per-directory `LLAME.md`, `AGENTS.md`, or `CLAUDE.md` file, or one of its
override and local variants, whose content llame adds to the model's context.
_Avoid_: project instructions

**Instruction chain**:
The Instruction files loaded from a root down to the directory being worked
in.

**Import marker**:
A reference in Markdown, such as `@path`, that pulls another file's content
into context beside the text that names it.

**Prompt import**:
The content an Import marker in an Owner's message brings in before the first
model request.
_Avoid_: attachment, mention

**Skill**:
A package of instructions, provided by the Operator or a Workspace, that the
assistant loads by name or on its own judgment.

**Skill catalog**:
The names and descriptions of the Skills the model may load on its own,
frozen into the system prompt.

**Skill activation**:
Loading a Skill because a message names it as `$name`.
_Avoid_: invoke, mention

**Untrusted-content notice**:
The fixed framing that marks Knowledge, recalled, web, or file content as data
that cannot instruct the assistant.

**Git state**:
The Context item that reports the bound Workspace repository's branch,
changes, recent commits, and remotes.

## Media

**Media object**:
An Owner-uploaded image or PDF, stored once and addressed by `media://`.
_Avoid_: attachment, upload

**Model variant**:
The resized form of an image that a model receives.

**Retained media**:
Image or PDF content returned by a read or Prompt import, kept with the
message instead of as a Media object.

**Media window**:
The limit on how many images and PDFs one request carries within a Compaction
epoch.

## Models and usage

**Provider entry**:
One configured account with a model vendor or gateway: its credentials,
destination, and headers.
_Avoid_: provider (for the entry)

**Model entry**:
One configured model: the Provider entry it uses, the Wire it speaks, and its
declared capabilities.
_Avoid_: catalog model

**Model id**:
llame's own opaque name for a Model entry, distinct from the provider's model
name.

**Wire**:
The protocol a Model entry is called through, such as Responses, Chat
Completions, or Anthropic Messages.
_Avoid_: API, transport

**Effort**:
The reasoning level a Run asks a model for, chosen from the levels that model
declares.
_Avoid_: thinking level

**Input modalities**:
The kinds of input a Model entry accepts: text, images, PDFs.

**Reasoning part**:
The stored record of a model's reasoning in a Reply.
_Avoid_: thoughts

**Usage**:
The provider-reported tokens and cost of one Reply, with its Billing mode and
whether it is complete.

**Billing mode**:
Whether a model's usage is billed per token or covered by a subscription.

**Side call**:
A model request made for housekeeping or a tool, such as a title or a ranking,
rather than as a Step. Its usage is kept apart from the Run's.

**Rank model**:
A Decision model or a Rerank model used to order a tool's results.

**Decision model**:
A model that answers yes-or-no questions about candidate results with
calibrated probabilities.
_Avoid_: classifier

**Rerank model**:
A model that orders candidate results by relevance to a query.
_Avoid_: reranker (for the configured entry)

**Card**:
One bounded candidate result sent to a Rank model.

**Embedding model**:
A model that turns Chat text into vectors for optional semantic search.
