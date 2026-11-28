# Worktree includes

## Purpose

Define the local environment files that a new Worktree receives from its source
Checkout, with explicit selection, copy authority, and failure boundaries.

## ADDED Requirements

### Requirement: The selected source Checkout supplies the manifest

Each llame-created Worktree creation MUST read `.worktreeinclude` from the root
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

#### Scenario: An empty copy source is refused

- **WHEN** a creation request carries an empty `copy_source`
- **THEN** the daemon fails with the typed `INVALID_INPUT` failure before the root guard resolves it
- **AND** it does not default the source to `repository`
- **AND** a `copy_source` that starts with `-` fails the same way

#### Scenario: A copy source in another repository is refused

- **WHEN** the resolved `copy_source` has a canonical common directory that differs from that of `repository`
- **THEN** creation fails with typed `INVALID_INPUT` before any manifest read and before Worktree add
- **AND** every `copy_failed` therefore occurs after the Worktree exists

#### Scenario: A copy source whose gitfile leaves the roots is refused

- **WHEN** the `copy_source` gitfile points at a repository outside the registered roots
- **THEN** creation fails before any manifest read, through the existing git-directory guard

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

#### Scenario: Global excludes follow the daemon's retained environment

- **WHEN** a file is ignored only through `core.excludesFile` or `$HOME/.config/git/ignore`
- **THEN** it qualifies, because the daemon's environment keeps `HOME`
- **AND** a file ignored only through a non-default `XDG_CONFIG_HOME` or through `GIT_CONFIG_GLOBAL` does not qualify, because the daemon forwards neither

### Requirement: Selection evaluates ignored ancestors before the candidate

The matcher MUST evaluate each candidate top-down. For each ancestor directory of
the relative candidate, from the root down, it MUST evaluate that directory. The
first ancestor that the manifest ignores MUST select the candidate, and a later
negation MUST NOT re-include it. Otherwise the candidate's own match MUST decide:
an ignore result selects it, and a whitelist or no result does not. The system
MUST NOT use a match that returns a leaf negation under an ignored ancestor.

#### Scenario: A negation under an ignored ancestor does not re-include

- **WHEN** the manifest contains `secrets/` followed by `!secrets/private.json`
- **AND** Git ignores `secrets/private.json`
- **THEN** the ignored ancestor `secrets` selects the file and the negation does not remove it

#### Scenario: A negation of a leaf excludes it when no ancestor is ignored

- **WHEN** the manifest contains `secrets/**` followed by `!secrets/private.json`
- **THEN** no ancestor `secrets` is ignored and the candidate's own whitelist result excludes it

#### Scenario: The recorded probes run as Rust tests

- **WHEN** the implementation ships
- **THEN** Rust tests repeat the three recorded matcher probes: `**/config.json` selecting `vendor/pkg/config.json`, the `secrets/**` negation, and the `secrets/` negation

### Requirement: Unsafe manifest patterns are refused before parsing

Before parsing, the system MUST refuse a manifest line whose pattern, after
stripping a leading `!` and a leading `/`, contains a path segment equal to `..`
or `.git`, or contains NUL or invalid UTF-8. The refusal MUST fail creation
with `copy_failed`. The system MUST NOT refuse a wildcard that could match under
`.git`, because Git output never contains such paths. Blank lines and comments
MUST NOT be refused.

#### Scenario: A traversal or administrative segment is refused

- **WHEN** a manifest line is `../secret`, `/.git/config`, or `!a/.git/b`
- **THEN** creation fails with `copy_failed` and reads no target contents

#### Scenario: A wildcard is not refused on its own

- **WHEN** a manifest line is `*`
- **THEN** the system parses it and no file under `.git` is ever a candidate

### Requirement: Git lists the candidates and nested repositories are skipped

The only source of candidates MUST be Git's ignored, untracked listing of the
copy source, run without collapsing ignored directories. Git MUST list the
descendants of an ignored directory individually. The copy MUST apply manifest
patterns to those entries, and a `**/` pattern MUST NOT require its next name to
occur in the ignored parent path. An entry that ends in `/` is a nested
repository or Worktree, including a destination that lies under the source. The
copy MUST NOT walk or copy it and MUST skip it silently even when a pattern
matches it. A pattern with no matches MUST succeed without a copy.

#### Scenario: A generic pattern reaches a wholly ignored directory

- **WHEN** Git ignores `vendor/` and the manifest contains `**/config.json`
- **THEN** `vendor/pkg/config.json` qualifies if it exists as a regular file

#### Scenario: A missing local input is harmless

- **WHEN** the manifest selects `.env.local` and that file does not exist
- **THEN** creation succeeds without that file

#### Scenario: A nested repository is skipped

- **WHEN** the source contains an ignored nested repository `nested/` and a linked Worktree `wt/x/` under it, and the manifest is `*`
- **THEN** Git reports `nested/` and `wt/x/` as entries ending in `/`
- **AND** the copy neither enters nor copies them and reports no error

#### Scenario: A large ignored listing still seeds the environment

- **WHEN** the source has more than 1 MiB of ignored paths and a manifest that selects `.env`
- **THEN** creation copies `.env`
- **AND** no output-size refusal occurs

### Requirement: Eligibility enumeration streams under the shared deadline

Enumeration MUST read Git's NUL-terminated records as a stream, match each record
as it arrives, and hold only selected paths. It MUST NOT apply a stdout volume
cap, and the shared deadline MUST bound it. It MUST run with the hardening of
the pinned Git invocation: a cleared environment, the existing configuration
overrides, a process group killed at the deadline, and pinned discovery. The
system MUST NOT add a weaker invocation path.

#### Scenario: The deadline bounds enumeration

- **WHEN** enumeration reaches the shared deadline
- **THEN** the Git process group is killed
- **AND** creation fails with `TIMED_OUT` and retains the Worktree

### Requirement: Copy inputs stay inside the source Checkout

The system MUST reject a selected symlink or special file, including one
inside a selected directory, with `copy_failed`. It MUST NOT traverse
a symlink directory. The manifest MUST be a regular file, not a symlink. Every
source and destination operation MUST be relative to a directory handle that is
opened component by component without following links, and the copy MUST fail
with `copy_failed` where the platform cannot provide that. Git output never holds
`.git` paths, and the copy MUST NOT copy `.git` metadata or read file contents
outside the source Checkout. A hard link in the source is out of scope: the copy
is not a Sandbox against the same OS user.

#### Scenario: A selected symlink fails without disclosure

- **WHEN** Git ignores `.env`, the manifest selects it, and `.env` links to an external secret
- **THEN** creation fails without a read of the target's contents
- **AND** the error contains no target contents

#### Scenario: A link inside a selected directory fails the copy

- **WHEN** the manifest selects `node_modules/` and an ignored file `node_modules/.bin/tool` is a symlink
- **THEN** creation fails with `copy_failed` naming a bounded relative path
- **AND** copies completed before the failure remain

#### Scenario: A symlink directory is not traversed

- **WHEN** an ignored directory link points outside the source Checkout
- **AND** a recursive manifest pattern matches potential files beneath it
- **THEN** the copy does not enter the linked directory
- **AND** direct selection of that link fails

#### Scenario: A symlinked manifest is refused

- **WHEN** `.worktreeinclude` is a symlink
- **THEN** creation fails with `copy_failed` and reads no target contents

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

### Requirement: The destination root is bound before any copy

After Worktree add and before any copy, the daemon MUST open the new Worktree
root without following links and confirm that its real path equals the literal
request `path` field, which is the hub's decided canonical path, not the daemon's
re-resolved directory. On a mismatch the daemon MUST copy nothing, and the
existing mismatch handling MUST stay unchanged.

#### Scenario: A real-path mismatch copies nothing

- **WHEN** the new Worktree root resolves to a path other than the requested canonical path
- **THEN** the daemon copies no file
- **AND** the existing mismatch handling applies unchanged

### Requirement: A failed copy preserves the partial Worktree without a binding

A manifest read error, manifest refusal, invalid entry, copy error, or timeout
MUST fail creation. A copy, manifest, or entry failure MUST use the typed reason
`copy_failed`, and a timeout MUST use `TIMED_OUT`. The failure `message` MUST be a
fixed reason phrase plus at most one bounded relative path. It MUST NOT contain
standard error, OS error text, manifest lines, or file bytes. The system MUST
retain any new Worktree and partial files, except where the existing mismatch
handling removes a Worktree that received no copy. It MUST report the leftover
directory when known. Because the API cannot tell an add timeout from a copy
timeout, every `worktreeAdd` `timed_out` MUST carry the plan directory as a
possible leftover. It MUST NOT bind the destination, record a
successful Checkout or lease, or automatically remove the new branch. It MUST
remove its temporary file on every failure, including the deadline.

#### Scenario: An unreadable manifest does not become an empty manifest

- **WHEN** `.worktreeinclude` exists but the Machine cannot read it
- **THEN** creation fails instead of a success without environment files

#### Scenario: A later copy fails

- **WHEN** three files copy and a fourth copy fails
- **THEN** creation fails and retains the directory and those three files
- **AND** no successful Checkout, lease, or new bound root exists

#### Scenario: A failure message holds no diagnostics

- **WHEN** a copy fails because an OS error occurs on `config/secret.env`
- **THEN** the `copy_failed` message is a fixed phrase plus `config/secret.env`
- **AND** it contains no OS error text, standard error, manifest line, or file bytes

#### Scenario: A timeout names the plan directory

- **WHEN** `worktreeAdd` times out
- **THEN** the failure carries the plan directory as a possible `leftDirectory`

#### Scenario: The deadline leaves no temporary file

- **WHEN** the deadline expires while a selected file is copying
- **THEN** the daemon stops writing and removes the temporary file
- **AND** a later non-force removal is not blocked by a temporary file

### Requirement: The complete creation shares one operation deadline

Git checkout, manifest selection, eligibility enumeration, and file copy MUST
share the Worktree creation deadline. The system MUST NOT propagate gRPC
cancellation to them: the shared deadline bounds the operation, and the process
group kill applies at that deadline. The copy MUST NOT impose a new byte or
file-count cap. Large explicit selections MUST NOT receive a silent truncation.
A timeout MUST NOT permit further copy writes after the operation stops. The
daemon deadline MUST expire before the hub stops waiting, so a typed `TIMED_OUT`
normally arrives, and a lost link MUST be `outcome_unknown`.

#### Scenario: An explicit dependency directory has no special exclusion

- **WHEN** the manifest selects an ignored `node_modules/` of regular files
- **AND** the operation completes within its deadline
- **THEN** all selected files copy without an extra size or count refusal

#### Scenario: A dropped call does not stop the operation

- **WHEN** the caller drops the RPC while the copy runs
- **THEN** the operation continues to its result or the shared deadline

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
