## Why

The native file tools make edits immediately visible in the shared workspace, but
they do not create durable, reviewable Knowledge history. A separate submit
operation is needed to record selected file changes in Git without making the
editing tool responsible for branches, commit policy, or future forge review.

## What Changes

- Initialize newly created Knowledge Space repositories with an empty `main`
  branch during provisioning.
- Treat existing local Knowledge Spaces as operator-prepared Git repositories in
  this alpha implementation; do not migrate them in-app.
- Add a local `knowledge_submit` operation that commits explicitly selected file
  paths on the active branch.
- Commit the whole selected file when that path is staged; do not claim line-level
  attribution in this iteration.
- Record commit OID, branch, selected paths, Chat provenance in the Run record,
  and safe Git outcome. Do not add commit trailers yet.
- Keep candidate/PR publication as a later provider adapter.

## Capabilities

### New Capabilities

- `knowledge-submit`: local Git repository initialization and explicit-path
  submission of live Knowledge changes.

### Modified Capabilities

- `knowledge-spaces`: new Spaces initialize an empty Git repository with `main`
  before their owner row becomes authoritative.
- `tool-calling`: admit `knowledge_submit` as an exact alpha-native write tool
  with a durable pre-effect retry fence.

## Impact

Depends on `native-file-tools` for the shared file contract but does not depend on
bash or a Sandbox. It changes hosted Knowledge provisioning and therefore needs a
delta against the current `knowledge-spaces` requirement that currently forbids
Git initialization. The local/alpha adapter owns Git execution; the existing
Knowledge reader continues to read live files.

This iteration uses the repository's active branch and plain Git. It does not
introduce Jujutsu, isolated revision workspaces, line-level staging, commit
trailers, GitHub PRs, remote push, multi-file atomic transactions, or a migration
for already-created Spaces.
