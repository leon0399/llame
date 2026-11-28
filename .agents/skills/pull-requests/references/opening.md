# Opening a pull request

## One PR or a stack

Decide from the change:

|One PR against `master` when…|A `$gh-stack` stack when…|
|---|---|
|the change is one reviewable concern|it splits into dependent, separately reviewable layers|
|a fix, chore, dependency bump, or tooling change fits one PR|feature delivery: proposal → implementation → finalize|
|nothing else builds on it before it merges|later work must build on it before it merges|

Prefer layers that merge independently and safe intermediate merge points.
Split a concern when the split improves review or creates a safe merge point.

## Before publishing

- Work in a worktree or branch of your own; changes already in the tree belong
  to someone else. Commit only owned paths: `git commit -- <paths>`.
- Confirm the base is current:
  `git fetch origin && git merge-base --is-ancestor origin/<base> HEAD`.
  Rebase a layer that conflicts with its parent. GitHub also judges a stack
  layer against `master` and skips its CI while it conflicts
  ([stacks.md](stacks.md#conflicts-with-master)).
- Size the layer against its parent: authored added plus deleted lines, with
  generated churn counted separately
  ([review budget](../../../../CONTRIBUTING.md#review-budget)).
- Add or amend the PR's `.changeset/` entry when it ships work
  ([CONTRIBUTING.md](../../../../CONTRIBUTING.md#changesets)).
- Run the narrow evidence for the touched surface
  ([verification table](../../../../CONTRIBUTING.md#verification)) and keep the
  exact commands and results for the body.

## Publish the draft

Write the body first ([drafting.md](drafting.md)), then:

```bash
git push -u origin <branch>
gh pr create --repo leon0399/llame --draft --base <base> --head <branch> \
  --title "<conventional commit title>" --body-file /tmp/pr-<branch>.md
```

A stack layer publishes with `gh stack push` instead.

## Project item

Add the PR to the delivery Project with Status, Priority, Workstream, and Next
action, then read the fields back
([Project tracking](../../../../docs/development/project-tracking.md) maps PR
states to Status). A draft implementation or chore PR is `In progress`; a draft
proposal is `Design`. Repeat the update and read-back at every later GitHub
transition: ready, merged, or closed.

```bash
gh project field-list 2 --owner leon0399 --format json   # field and option ids
gh project item-add 2 --owner leon0399 --url <pr-url> --format json   # idempotent; returns the item id
gh project item-edit --id <item> --project-id <project> --field-id <field> --single-select-option-id <option>
gh project item-edit --id <item> --project-id <project> --field-id <next-action-field> --text "<next step>"
```

Read back through `gh api graphql` on the item's `fieldValues`. GitHub's
secondary rate limit trips after a handful of rapid Project calls: update
several items in one pass, pause between items, and read back once.
