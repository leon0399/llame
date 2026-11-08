# Proposal

## Why

An agent in a Workspace starts blind to the repository it is about to change.
In llame's own Runs, `git status` is the most common first `bash` command, 13
of 19 Runs that entered a Workspace and continued ran git as the very next
call, and Runs in chats that already had a bound Workspace repeat the same
orientation (40 of 105 within the first 5 calls). Peer sessions show the same
pattern: 56-61% run git within their first 5 calls. Session details shows a
branch that was stored once at registration and goes stale after a switch
([#1417](https://github.com/leon0399/llame/issues/1417)).

The design review on the tracker
[#1614](https://github.com/leon0399/llame/issues/1614) settled the goal as
correct orientation: every Run in a Workspace starts with accurate, labelled
git state, and the owner sees the same state live. Feature issue:
[#1615](https://github.com/leon0399/llame/issues/1615).

## What Changes

- A new rail context producer `git` with form `snapshot` tells the model the
  git state of the Workspace repository at entry and at each accepted turn,
  only when the rendered text differs from what the chat was last told, and
  again after each compaction checkpoint.
- A successful `enter_workspace` result carries the same rendered text in a
  new `git` field, including a same-root re-entry.
- The snapshot holds the branch or a detached HEAD, HEAD, the upstream with
  ahead and behind dated by the upstream ref's last local update, an
  in-progress operation, change counts, up to 20 root-relative paths with the
  root's paths first, five recent commits, every remote normalized without
  credentials, and a fixed statement for each omission. llame never fetches.
- Every git process of an observation is pinned to the admitted git entry, so
  git never discovers another repository.
- llame reads git state only when the `read` permission group admits the
  repository's git entry. Listed paths are not filtered through `read`.
- "not a git repository" and "git state unavailable:" with a closed reason are
  told explicitly. Entry never fails because of git.
- **BREAKING** for Machine operators: two new typed executor methods,
  `git.locate` and `git.state`, replace `git.status`. The worktree-removal
  guard moves onto `git.state`. A daemon that does not list a called method
  fails that call as `machine_update_required`, so worktree removal on a
  Machine needs an updated daemon.
- A new owner-only route `GET /api/v1/chats/:id/git-state` returns the
  live state for the chat's Workspace. Session details shows it as a
  Repository block in Environment instead of the stored checkout branch.
- The compaction summary instruction excludes `git` snapshot content and the
  `git` field of `enter_workspace` results, because the producer tells the
  state again after each checkpoint.
- The worktree-removal guard fails closed on a gone upstream and keeps
  counting changes inside submodules.

## Assumptions, confirmed with Leo

Grilling decisions D1-D25 and assumptions A1-A4 on
[#1614](https://github.com/leon0399/llame/issues/1614) are the settled
record. The ones that shape the deltas:

- grilling D3, D6, D7: state at entry and at each Run start, told by a
  separate `git` producer only when the rendered text changed.
- grilling D11, D12, D18, D19, D21: the `read` group must admit the git entry;
  presence is never filtered; no `bash` admission; a linked worktree needs only
  its own `.git` entry; the entry is checked as `read` checks a path.
- grilling D13-D17, D22: content, bounds, remotes, staleness, a timeout, and
  no observation stamp.
- grilling D8, D20, D23: Session details reads live state, gated by owner
  identity and the binding, not by tool permissions; #1356 stays out.
- grilling D9: a new typed method replaces `git.status`.
- A1-A4: only bound Runs get git state; exit and detach clear the told state;
  a Machine repository must lie inside a registered root; `bypass` admits the
  check.

Assumptions that follow from those decisions but were not asked:

- The `read` evaluation of the git entry records no decision of its own, like
  the silent pre-evaluation of an instruction import. The model sees the
  outcome as the "not permitted" line.
- `read` must be in `tools.allowed`, as for instruction loading.
- A mid-Run `enter_workspace` does not advance the told state, so the next
  accepted turn tells the snapshot again once. The `workspace` producer
  already behaves this way.
- The Session details route uses the same 20-path bound as the model.
- A configured clean filter, such as Git LFS, can run during `git status`,
  also in `read-only` mode. The removal guard has the same exposure today.

## Deviations from the grilling record

Please confirm each:

- V1, grilling D9: one new method became two. Discovery must happen before any
  git process reads `.git`, otherwise llame reads it before the `read` group
  admits it (D11). `git.locate` is a filesystem walk that starts no git
  process; `git.state` then runs pinned to the admitted entry.
- V2, grilling D17: ahead and behind are dated by the reflog of the upstream
  ref, not by `FETCH_HEAD`. `FETCH_HEAD` is per worktree, so every
  llame-created worktree would say "never fetched" while its upstream refs are
  fresh. With no reflog the snapshot says "update time unknown".
- V3, grilling D17: git stops after 3 s on the executor, and the whole
  observation stops after 5 s, so a Machine round trip and session setup are
  bounded too.
- V4, A3: a Machine search that reaches the registered root says "git state
  unavailable: no repository inside the registered root"; a git directory,
  common directory, or alternate outside the roots says "git state
  unavailable: repository outside the registered root".
- V5, grilling D25: `Closes #1615` moves from the producer layer to the
  Session details layer, because #1615's acceptance includes Session details.
  The producer layer splits in two (`producer`, `entry-result`) to stay within
  the review budget, and the protocol types ship with the executor layer
  because `git-executor` re-exports them.

## Capabilities

### New Capabilities

- `workspace-git-state`: observation of a Workspace repository's git state,
  its admission, content, bounds, and absence lines; the `git` context
  producer and its told state; the `enter_workspace` result field; and the
  owner route for Session details.

### Modified Capabilities

- `context-injection`: "Co-occurring items have a total author-time order"
  adds `git` after `workspace`.
- `remote-machines`: "Machine daemons answer typed git methods" replaces
  `git.status` with `git.locate` and `git.state`; "Git methods are additive to
  the Machine protocol" gates each method by the handshake list. ADDED: "Machine
  git discovery stays inside the registered root" and "Machine git state reads
  only inside the registered roots".
- `repositories`: "Executors expose typed git operations" replaces
  `git.status` with `git.locate` and `git.state`. ADDED: "Worktree removal
  reads a complete worktree state" fails closed on a gone upstream or an
  unreadable state and counts submodule changes.
- `tool-call-permissions`: two ADDED requirements define the git entry check as
  the seventh named exception and state its mode and reject rules.

Deliberately unchanged, with the reading under which each holds:

- `repositories` "Worktree removal is owner-initiated and guarded": its "fail
  closed when the upstream is unknown" covers a gone upstream; the ADDED
  requirement states that reading and the submodule rule beside it.
- `model-system-prompts` "Compaction publishes a summary-only checkpoint
  before the Run's first model step": it requires the instruction to name the
  standing-context delimiters and the `recency-digest` producer; naming the
  `git` sources as well does not contradict it.
- `workspace-entry` "Workspace entry validates and authorizes both submitted
  and canonical paths": the result "SHALL include" the listed fields; an added
  `git` field does not contradict an inclusive list.
- `workspace-entry` "In-Run Workspace transitions are narrated by tool
  results": the `git` field narrates repository state, not Workspace state,
  and nothing enters the system prompt.
- `tool-call-permissions` "Match submitted string values without
  serialization artifacts": its exceptions are those "defined below" in the
  capability; the ADDED requirement is one more named exception.
- `tool-call-permissions` "Safe decision provenance and non-fatal
  rejection": it governs "every newly evaluated call"; the git entry
  evaluation is not a tool call.
- `context-injection` "Workspace binding changes are rail-resident context
  items": the `workspace` producer and its told columns do not change.
- `context-injection` "Compaction is the rail's re-baseline boundary": the
  `git` producer inherits it.
- `repositories` "Worktree checkouts are children of a main checkout": the
  stored `branch` stays intent; only the Session details display moves to the
  live route.

## Impact

- `packages/git-executor`: `locate` and `state` operations with fixture tests;
  `status` deleted.
- `packages/machine-protocol`, `apps/machine`: the two methods, the handshake
  list, registered-root confinement.
- `apps/api`: hub dispatch and result parsing, the removal guard, the
  snapshot service, the `git` producer with a migration for its told state,
  the `enter_workspace` result, the compaction instruction, the new route,
  OpenAPI.
- `apps/web`: the Repository block in Session details.
- Docs: `docs/product/operator/machines.md`, `repositories.md`,
  `docs/product/reference/tools/enter-workspace.md`, a new reference page for
  the git snapshot, `CHANGELOG.md`.

## Non-Goals

- No commit, push, merge, or PR tools; no fetch; no background sweep.
- No refresh after the agent's own commands inside a Run.
- No base-branch relation, no submodule state
  ([#1617](https://github.com/leon0399/llame/issues/1617)), no Jujutsu
  support ([#1616](https://github.com/leon0399/llame/issues/1616)), no git
  status in `read` listings
  ([#1618](https://github.com/leon0399/llame/issues/1618)), no chat
  attribution of changes
  ([#1356](https://github.com/leon0399/llame/issues/1356)).
- No built-in git workflow instructions (grilling D5).

## Acceptance

- On fixture repositories, every snapshot field matches
  `git status --porcelain=v2 --branch --ignore-submodules=all` and `git log`
  taken at the same time.
- An unchanged repository adds no item on a later accepted turn; a change adds
  exactly one; a checkpoint re-tells it once.
- A git entry that `read` rejects yields "git state unavailable: not
  permitted", and no git process starts.
- A non-git folder, a timeout, an offline Machine, and a daemon without the
  method each give their stated line, and entry still succeeds.
- Session details shows the live branch after a switch outside llame, and
  another owner's request for the route answers 404.
