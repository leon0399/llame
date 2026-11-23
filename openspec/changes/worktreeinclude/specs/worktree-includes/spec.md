# Worktree includes

## Purpose

Define the local environment files that a new Worktree receives from its source
Checkout, with explicit selection, copy authority, and failure boundaries.

## ADDED Requirements

### Requirement: The selected source Checkout supplies the manifest

Each Stead-managed Worktree creation MUST read `.worktreeinclude` from the root
of its selected source Checkout. The manifest need not be committed. The copy
MUST NOT substitute the main Checkout for a linked source Checkout. A source
subdirectory MUST resolve to its Checkout root. Git base-ref and parent rules
MUST remain unchanged.

#### Scenario: A linked source supplies its own environment

- **WHEN** main and a linked source have different manifests and `.env` files
- **AND** `enter_workspace` creates a Worktree from the linked source
- **THEN** the new Worktree receives the linked source's selected `.env`
- **AND** main remains the parent Checkout

#### Scenario: A subdirectory uses its Checkout root

- **WHEN** the selected path is `apps/api` inside a Checkout
- **THEN** the copy uses that Checkout's root manifest and relative paths
- **AND** the system admits that derived root before the copy accesses it

### Requirement: No manifest means no environment copy

An absent or empty `.worktreeinclude` MUST select no files. The system MUST NOT
apply an implicit `.env*` default or a secondary pattern source. A manifest with
only blank lines or comments MUST select no files.

#### Scenario: An absent manifest preserves a plain checkout

- **WHEN** the source holds `.env` but no `.worktreeinclude`
- **THEN** Worktree creation succeeds without a copy of `.env`

### Requirement: Manifest patterns select Git-ignored untracked entries

The manifest MUST use gitignore-style patterns with comments, escapes, root
anchors, directory patterns, ordered negation, and `**`. Git MUST determine which
source entries are ignored and untracked. Tracked files and untracked files that
Git does not ignore MUST NOT qualify. Patterns MUST select relative paths only.

#### Scenario: Tracked and ordinary untracked files do not qualify

- **WHEN** `*` matches a tracked file, an ordinary untracked file, and an ignored untracked regular file
- **THEN** only the ignored untracked regular file qualifies for the copy

#### Scenario: Ordered negation excludes a subset

- **WHEN** the manifest contains `secrets/**` followed by `!secrets/private.json`
- **AND** Git ignores both `secrets/public.json` and `secrets/private.json`
- **THEN** the copy includes `secrets/public.json` and excludes `secrets/private.json`

#### Scenario: A directory pattern prevents child negation

- **WHEN** the manifest contains `secrets/` followed by `!secrets/private.json`
- **AND** Git ignores the regular file `secrets/private.json`
- **THEN** the directory pattern keeps that file selected despite the child negation

#### Scenario: Global and nested Git ignore rules determine eligibility

- **WHEN** Git ignores source files through nested `.gitignore`, `.git/info/exclude`, or its configured global excludes
- **AND** the manifest selects those files
- **THEN** those files qualify without a root `.gitignore` match

### Requirement: Wholly ignored directories do not restrict double-star matches

The copy MUST apply manifest patterns to eligible entries inside wholly ignored
directories. A `**/` pattern MUST NOT require its next name to occur in the
ignored parent path. A pattern with no matches MUST succeed without a copy.

#### Scenario: A generic pattern reaches a wholly ignored directory

- **WHEN** Git ignores `vendor/` and the manifest contains `**/config.json`
- **THEN** `vendor/pkg/config.json` qualifies if it exists as a regular file

#### Scenario: A missing local input is harmless

- **WHEN** the manifest selects `.env.local` and that file does not exist
- **THEN** creation succeeds without that file

### Requirement: Copy inputs stay inside the source Checkout

The system MUST reject a selected symlink or special file. It MUST NOT traverse
a symlink directory. The manifest MUST be a regular file, not a symlink. The
copy MUST reject parent traversal and access to Git administrative entries. It
MUST NOT read file contents outside the source Checkout or copy `.git` metadata.

#### Scenario: A selected symlink fails without disclosure

- **WHEN** Git ignores `.env`, the manifest selects it, and `.env` links to an external secret
- **THEN** creation fails without a read of the target's contents
- **AND** the error contains no target contents

#### Scenario: A symlink directory is not traversed

- **WHEN** an ignored directory link points outside the source Checkout
- **AND** a recursive manifest pattern matches potential files beneath it
- **THEN** the copy does not enter the linked directory
- **AND** direct selection of that link fails

#### Scenario: An administrative manifest entry is refused

- **WHEN** a manifest entry targets `.git/config` or `../secret`
- **THEN** creation fails without access to that target's contents

### Requirement: Regular source files overwrite regular destination files

The copy MUST preserve each selected file's bytes and ordinary permission bits.
It MUST create parent directories as needed. It MUST overwrite a regular
destination file, even when the target base ref tracks that file. The system
MUST NOT add the copied file to Git's index or change the source file.

#### Scenario: Source environment replaces a tracked target

- **WHEN** `.env` is ignored and untracked in the source but tracked on the target base ref
- **AND** the manifest selects `.env` with different bytes
- **THEN** the new Worktree receives the source bytes
- **AND** Git reports `.env` as modified without a staged change

#### Scenario: Identical bytes do not imply a dirty Worktree

- **WHEN** the selected source bytes and mode equal the tracked destination's bytes and mode
- **THEN** the copy does not cause a Git modification

### Requirement: Destination conflicts fail without recursive replacement

The copy MUST reject destination symlinks and symlink parents. A file/directory
conflict MUST fail. The copy MUST NOT delete a directory to install a file. All
writes MUST stay inside the new Worktree. Replacement of one path MUST NOT
modify other paths through a pre-existing hard link.

#### Scenario: A tracked destination symlink cannot redirect a write

- **WHEN** the target base ref supplies `.env` as a symlink to an external file
- **AND** the manifest selects the source's regular `.env`
- **THEN** creation fails and the external file remains unchanged

#### Scenario: A directory cannot be replaced by a file

- **WHEN** the destination path for a selected regular file is a directory
- **THEN** creation fails and the copy deletes no directory

### Requirement: A failed copy preserves the partial Worktree without a binding

A manifest read error, invalid entry, copy error, cancellation, or timeout MUST
fail creation. The system MUST retain any new Worktree and partial files. It
MUST report the leftover directory when known. It MUST NOT bind the destination,
record a successful Checkout or lease, or automatically remove the new branch.

#### Scenario: An unreadable manifest does not become an empty manifest

- **WHEN** `.worktreeinclude` exists but the Machine cannot read it
- **THEN** creation fails instead of a success without environment files

#### Scenario: A later copy fails

- **WHEN** three files copy and a fourth copy fails
- **THEN** creation fails and retains the directory and those three files
- **AND** no successful Checkout, lease, or new bound root exists

### Requirement: The complete creation shares one operation deadline

Git checkout, manifest selection, and file copy MUST share the Worktree creation
deadline and cancellation. The copy MUST NOT impose a new byte or file-count
cap. Large explicit selections MUST NOT receive a silent truncation. A timeout
or cancellation MUST NOT permit further copy writes after the operation stops.

#### Scenario: An explicit dependency directory has no special exclusion

- **WHEN** the manifest selects an ignored `node_modules/` of regular files
- **AND** the operation completes within its deadline
- **THEN** all selected files copy without an extra size or count refusal

#### Scenario: Copy exhausts the remaining deadline

- **WHEN** git checkout consumes most of the deadline and the copy exceeds the remaining time
- **THEN** creation fails without a fresh full copy deadline or silent truncation

### Requirement: Copy results disclose no file contents

The copy MUST run on the Machine that owns both Checkouts. File contents MUST
NOT cross the Machine protocol as results or diagnostics. Results, errors, logs,
and Run events MUST contain no copied contents or raw manifest lines. Any
reported candidate paths MUST be bounded relative paths. The leftover directory
MUST use the existing locator form. Later tools keep their own permission rules.

#### Scenario: A synthetic secret stays out of observations

- **WHEN** a selected file contains a unique synthetic secret marker
- **THEN** the destination contains that marker
- **AND** copy results, errors, logs, and Run events do not contain it

### Requirement: Copies are independent seeds with ordinary removal semantics

The system MUST copy only at creation. It MUST NOT synchronize later source
edits or store fingerprints for removal. Owner-initiated removal MUST keep its
existing Git-state guards. Ignored copies and their ignored edits MUST NOT
create an extra removal guard.

#### Scenario: A source edit does not propagate

- **WHEN** the source `.env` changes after successful creation
- **THEN** the existing Worktree's `.env` remains unchanged

#### Scenario: Ignored local edits do not prevent owner removal

- **WHEN** the owner removes an otherwise removable Worktree with an edited ignored copy
- **THEN** ordinary removal can delete the Worktree and that copy

#### Scenario: A tracked overwrite remains a dirty change

- **WHEN** the copy modifies a tracked destination and the owner requests removal
- **THEN** the existing dirty-Worktree guard refuses removal
