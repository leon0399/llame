## Context

See `proposal.md`. Native file edits are live and shared. Submit is the separate
durability boundary. Existing Knowledge provisioning creates a stable-ID child
directory but explicitly does not initialize Git; this change revises that one
behavior for newly created Spaces.

VISION and the retained product-vision research make Git the Knowledge history
substrate while keeping Chats and Runs database-native. The first alpha slice is
local and simple: the Space's active branch is the accepted local branch, and a
submit commits explicitly selected files. Forge review and candidate/accepted
ref separation come later.

## Goals / Non-Goals

**Goals:**

- Initialize new Spaces with an empty `main` repository.
- Commit explicitly selected complete files on the active branch.
- Keep all unselected worktree changes untouched.
- Return deterministic commit identity and safe outcome details.
- Leave a clean seam for later candidate branches and provider review.

**Non-Goals:**

- Jujutsu, line-level staging, isolated revision workspaces, or per-agent change IDs.
- Automatic migration of existing Spaces.
- Remote pushes, PRs, merge requests, protected refs, or provider credentials.
- Commit trailers in this slice.
- Bash, Sandbox execution, Markdown processing, or permission policy.

## Decisions

### D1: Initialize Git during new Space provisioning

Provisioning generates the stable Space ID, creates the child directory, runs a
trusted `git init -b main`, validates the repository, and only then inserts the
owner row in the same transactional provisioning flow. The initial repository
has an unborn `main` branch and no content commit. No files are staged.

If Git initialization or validation fails, provisioning returns the existing safe
unavailable result and commits no authority row. If the database transaction fails
after directory/repository creation, the unauthoritative directory and repository
may remain and must not be deleted or claimed by a later request. A later create
request allocates a new stable ID.

Existing Spaces are not migrated, scanned, or automatically repaired. The alpha
operator prepares existing local Spaces as Git repositories before enabling
submit. A missing or invalid repository makes submit unavailable while live reads
and native edits remain possible.

### D2: Submit explicit paths on the active branch

`knowledge_submit` accepts a strict object containing the Knowledge Space binding,
an explicit non-empty array of Knowledge-relative paths, and a bounded commit
message. Trusted code resolves the owner and configured root; model input never
selects a host root, repository, branch, author, or Git configuration.

The first implementation stages exactly the named files and commits the complete
current contents of each selected file. It does not run `git add -A`, stage
unselected files, or infer scope from the whole dirty worktree. If another agent's
changes are present in a selected file, they are included; the result does not
claim per-line authorship. Line-level staging requires a later revision service.

An empty path list, missing path, non-Markdown path, path outside the Space, or
unavailable repository fails before commit. Existing unselected dirty and
untracked files remain untouched and unstaged.

### D3: Commit directly to the active branch

The local alpha adapter commits on the repository's current active branch. It does
not create a candidate branch or move the active branch implicitly. If the repo
has no active branch, submit returns a safe repository-unavailable outcome; the
operator must repair it locally. New Spaces are created with `main`, so normal
new-Space submit uses `main`.

The commit message is model-supplied bounded prose after control-character
validation. Git author identity and environment are harness-owned. This iteration
adds no trailers. Chat provenance is retained in the submit record and can be
used by a later PR workflow without rewriting local history.

### D4: Keep Git execution narrow and inspectable

The publisher uses a bounded Git adapter with an explicit working directory and
minimal environment. It disables hooks, external helpers, prompts, and inherited
configuration paths. Git failures return bounded safe errors and do not expose
host paths, credentials, or raw diagnostics. The implementation must prove that
only selected paths entered the index before committing.

The submit result includes logical Space ID, selected Knowledge-relative paths,
active branch, commit OID, and status. It does not expose resolved host roots.

The tagged success shape is:

```json
{
  "status": "accepted",
  "knowledgeSpaceId": "<uuid>",
  "paths": ["research/note.md"],
  "branch": "main",
  "commitOid": "<sha1-or-sha256>",
  "chatId": "<trusted-local-chat-id>"
}
```

Failure uses `{ "status": "error", "type": <closed-code>, "message":
<safe-text> }`; initial codes are `repository_unavailable`, `invalid_selection`,
`nothing_to_commit`, `commit_failed`, `native_executor_unavailable`, and
`outcome_unknown`. The submit adapter durably records a pre-commit attempt before
staging. A retry that observes an open attempt does not run Git again; it returns
`outcome_unknown` or reconciles an already-known commit OID.

### D5: Leave provider review as a later adapter

The first local commit is the accepted local branch state. A later provider-aware
adapter may create a candidate branch, push it, attach Chat provenance through a
safe review identity, and observe acceptance. That later state machine must not
be retrofitted into this local submit operation or assumed by its result.

### D6: Coordinate submit with native command execution

Submit is serialized with native file mutations for the selected Space. A submit
waits for an in-flight native file operation to settle before staging. If a bash
executor later owns the same workspace, submit waits for a known command result;
an active or unknown command fences submit and returns `outcome_unknown` or an
executor-unavailable result. Submit never stages a workspace while an untrusted
process may still be mutating it. This coordination is host runtime state, not a
model-visible protocol.

## Risks / Trade-offs

- [Provisioning now depends on Git] -> use a strict spec delta, preserve
  unauthoritative artifacts after failure, and avoid existing-data migration.
- [Whole-file selection can include another actor's same-file changes] -> state
  the limitation, return selected paths and OID, and defer line-level attribution.
- [A dirty active branch can contain unrelated files] -> explicit path staging and
  index inspection exclude unselected files.
- [Git hooks or environment can execute arbitrary code] -> use a narrow adapter,
  minimal environment, hooks disabled, and bounded subprocess execution.
- [No trailer means remote auditability is deferred] -> retain Chat provenance in
  the submit record and add trailer/review routing in a later proposal.

## Migration Plan

1. Apply the `knowledge-spaces` provisioning delta for new Spaces only.
2. Keep existing Spaces unchanged and document the operator-local Git preparation
   needed for alpha submit.
3. Add the local submit adapter and explicit-path tests.
4. Add remote review and Chat provenance only in a later proposal.

## Revision history

- **v2 (2026-09-06):** Added dependency gating on native-file-tools, durable
  pre-commit retry fencing, explicit submit result/error shapes, and coordination
  with native command execution.
