## Purpose

Defines local Git initialization for new Knowledge Spaces and explicit-path
submission of live Knowledge changes on the active branch, with safe bounded
outcomes and no implicit whole-worktree staging.

## ADDED Requirements

### Requirement: New Knowledge Spaces initialize an empty main repository

New Knowledge Space provisioning SHALL create and validate an empty Git repository
with active branch `main` before its owner row becomes authoritative. The
repository SHALL contain no content commit and SHALL stage no existing files.
Git initialization or validation failure SHALL return the existing safe
unavailable outcome and SHALL commit no owner row. A database failure after
filesystem/repository creation MAY leave an unauthoritative directory and SHALL
not delete or repurpose it. Existing Spaces SHALL NOT be migrated by this
capability.

#### Scenario: New Space has an empty main repository

- **WHEN** an owner creates a new Space beneath the valid configured root
- **THEN** its stable child contains a validated Git repository with active `main`
- **AND** no content commit or file is staged before the owner row commits

#### Scenario: Git initialization failure is closed

- **WHEN** Git initialization or validation fails during provisioning
- **THEN** the API returns the safe unavailable result
- **AND** no owner row authorizes the child directory

#### Scenario: Existing Space is not migrated

- **WHEN** an existing Space lacks a valid repository
- **THEN** submit reports repository unavailable
- **AND** provisioning does not scan, initialize, or rewrite that existing Space

### Requirement: Submit commits only explicitly selected paths

`knowledge_submit` SHALL require a trusted owner/Space binding, a non-empty
explicit list of Knowledge-relative regular-file paths, and a bounded commit
message. It SHALL stage exactly those paths and commit their complete current
contents on the repository's active branch. It SHALL NOT stage all dirty files,
infer scope from the worktree, stage line ranges, or create a branch implicitly.
Unselected dirty and untracked files SHALL remain untouched and unstaged.

#### Scenario: Selected file is committed on the active branch

- **WHEN** submit names one changed Knowledge-relative file in a prepared repository
- **THEN** one commit is created on the active branch containing that complete file
- **AND** the result returns the Space, selected path, branch, and commit OID

#### Scenario: Unselected worktree changes remain untouched

- **WHEN** another file has dirty or untracked changes while submit names one file
- **THEN** the commit excludes the other file
- **AND** the other file remains unchanged and unstaged

#### Scenario: Existing selected-file changes are accepted as whole-file scope

- **WHEN** a selected file contains changes from more than one local actor
- **THEN** submit commits the complete selected file
- **AND** the result makes no per-line authorship claim

#### Scenario: Invalid selection fails before commit

- **WHEN** submit receives an empty list, unsafe path, missing file, directory, or file outside the bound Space
- **THEN** submit returns a closed validation error
- **AND** it creates no commit and stages no path

### Requirement: Submit uses the active branch and no trailer in the alpha slice

Submit SHALL commit on the repository's current active branch. A repository with
no active branch SHALL return a safe unavailable result. The commit message SHALL
be bounded and validated. Git author identity SHALL come from trusted host
configuration. This capability SHALL add no Chat or Run trailer; Chat provenance
SHALL remain in the local submit record for a later review/publication capability.

#### Scenario: New Space submit uses main

- **WHEN** submit runs against a newly provisioned Space without a branch change
- **THEN** the commit lands on `main`
- **AND** the result identifies `main` and the new commit OID

#### Scenario: Commit failure is safe

- **WHEN** Git refuses the commit or the repository is unavailable
- **THEN** submit returns a bounded safe failure
- **AND** it does not claim a commit or expose raw Git diagnostics

### Requirement: Submit is not remote review

The local submit result SHALL mean that the selected files were committed to the
active local branch. It SHALL NOT claim that a remote branch, pull request,
merge request, protected ref, or external authority accepted the change. Remote
publication and Chat-attributed review routing SHALL require a later capability.

#### Scenario: Local commit does not claim PR acceptance

- **WHEN** a local submit completes successfully
- **THEN** the result identifies only the local branch and commit
- **AND** no remote publication or review state is implied
