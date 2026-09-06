## Purpose

Defines owner-authorized, single-file Knowledge publication with recoverable Git
history and explicit outcomes across retries, conflicts, and worker failure.

## ADDED Requirements

### Requirement: Managed publication is explicitly enabled by the owner

Publication SHALL require explicit owner enablement for the selected Knowledge
Space and current operator eligibility. Existing Spaces SHALL start disabled and
remain readable from their live files. Enablement SHALL accept no host path,
owner override, Git ref, or external repository selector. It SHALL preserve all
existing files, initialize no content commit, and recover concurrent/interrupted
first use. Existing external Git repositories SHALL be refused unchanged in
this cut. Disabling SHALL stop new intents and resolve existing intents before
reporting completion; it SHALL NOT delete files, history, or provenance.

The managed writer contract SHALL disclose that canonical writes must use the
Node publisher and that concurrent direct host mutation is outside its guarantee.
The system SHALL NOT silently enroll existing Spaces or claim arbitrary host
editors are coordinated by an application lock.

#### Scenario: Enable an existing plain directory

- **WHEN** the owner enables a Space containing uncommitted Markdown and unrelated files
- **THEN** those live bytes remain unchanged and visible, with no content commit or staging of unrelated files
- **AND** later publication becomes eligible only after recoverable initialization completes

#### Scenario: Concurrent first enablement

- **WHEN** two processes enable the same Space and one stops during initialization
- **THEN** recovery produces one managed repository or a closed unavailable outcome
- **AND** neither process deletes or claims ambiguous existing metadata

#### Scenario: External repository or other owner

- **WHEN** enablement targets an externally initialized repository or a foreign Space
- **THEN** it is refused without modifying files or Git metadata
- **AND** the foreign selector reveals no existence or ownership information

### Requirement: One bounded Markdown change is published from the active view

The first generic `read` targeting one advertised Knowledge path in a Run
without a view SHALL request trusted admission of that currently owned,
publication-enabled Space. Its result SHALL disclose snapshot semantics. Later
file tools SHALL remain bound to that one view; a second writable Space SHALL
be refused. `write`, `edit`, and `publish` without a view SHALL fail closed.
Existing `knowledge_read` SHALL remain live and SHALL NOT open an editing view.

`publish` SHALL accept only a nonempty commit message of at most 200 Unicode code
points without control characters and SHALL resolve its view, Run, owner, and
Space from trusted context. It SHALL publish exactly one created or replaced
regular UTF-8 Markdown file of at most 1 MiB using the existing Knowledge path
admission rules, additionally refusing hardlinks. Zero changes SHALL return
`unchanged` without a commit. Multiple paths, deletion, rename, symlinks, special
files, invalid content, or oversized output SHALL fail before canonical mutation.

The publisher SHALL reauthorize current owner access and managed enablement,
compare the live target with its observed base, and refuse stale or independently
dirty published target content. A first publication of an untracked existing
target SHALL preserve its preimage without committing unrelated content. All
unrelated live files and index entries SHALL remain untouched and excluded from
the agent commit. Trusted Run provenance SHALL be inspectable in the change.

#### Scenario: First file read admits the selected Space

- **WHEN** an authorized Run first calls generic `read` on an advertised path in its enabled Space
- **THEN** trusted code opens the bounded view and the result identifies the snapshot being read
- **AND** no model argument can choose a host directory, owner, or native placement

#### Scenario: Research creates one note

- **WHEN** an authorized Run publishes a view containing one newly created sourced note
- **THEN** one recoverable Git commit and one live Markdown file are published
- **AND** the result identifies the logical Space, path, and commit without host paths or credentials

#### Scenario: Stale correction changes nothing

- **WHEN** the target differs from the view's observed base or its prior published state
- **THEN** publication reports a conflict before committing or replacing the target
- **AND** the current target, unrelated dirty files, and draft remain preserved

#### Scenario: Invalid or bulk change is refused

- **WHEN** a draft contains two changed paths, an oversized file, or a link escape
- **THEN** publication refuses the entire candidate before canonical mutation
- **AND** it does not publish the first valid subset

### Requirement: Each Run has at most one canonical publication intent

The system SHALL allocate at most one prepared publication intent per Run across
all attempts and tool-call identities. Draft edits SHALL NOT consume that slot.
An unchanged publication SHALL NOT consume it. The intent SHALL retain bounded
base and desired bytes, trusted provenance, and enough information to reproduce
the same commit. Identical retries SHALL reconcile the recorded intent; a second
distinct publication SHALL return `publication_already_attempted` without change.
Conflict SHALL NOT reset the slot within that Run.

#### Scenario: Worker dies after the commit

- **WHEN** the worker dies after creating the intended commit but before returning its result
- **THEN** a retry identifies and reconciles that same commit and intent
- **AND** no duplicate commit or regenerated canonical mutation is created

#### Scenario: Model regenerates a different tool-call ID

- **WHEN** a retry requests publication with a new provider tool-call identifier
- **THEN** the Run's existing slot still governs the effect
- **AND** identical intent returns its reconciled outcome while distinct intent is refused

### Requirement: Publication outcomes distinguish live installation from preparation

Publication SHALL coordinate cooperating writers across processes and durably
record intent before canonical mutation. Unsupported coordination or persistence
semantics SHALL make writes unavailable without disabling ordinary live reads.
Public outcomes SHALL distinguish `accepted`, `candidate_pending`, `unchanged`, `conflicted`, and
`recovery_pending`. A Git commit without reconciled live installation SHALL NOT
be reported as accepted. Candidate submission SHALL remain distinct from authority-side acceptance. The
first local-only adapter SHALL validate and fence the accepted-ref update against
the exact accepted parent; an unborn ref is permitted only for first publication.
A submitted or preserved candidate SHALL retain its base and SHALL NOT imply
acceptance merely because a commit or branch exists. Live Knowledge readers SHALL continue reading actual
live bytes; a named editing view SHALL read its own draft bytes.

Recovery SHALL preserve an unexpected third version of the target and refuse
unknown Git history rather than resetting or overwriting it. No new installation
SHALL occur without current authorization. Once a publication is installed,
later revocation SHALL NOT rewrite that historical outcome. Cancellation after
preparation SHALL NOT falsely promise rollback of an installed change.

Durable reconciliation evidence SHALL distinguish candidate-object creation,
accepted-ref advancement, live-target installation, and receipt settlement.
Recovery SHALL compare the exact candidate identity, expected accepted parent,
observed ref, and recorded target bytes rather than inferring success from a
commit's existence. It SHALL settle a proven already-installed effect after
revocation without treating that inspection as authority for a new installation.

#### Scenario: Pending commit remains distinct from live content

- **WHEN** a commit is prepared but the live target has not been installed
- **THEN** ordinary Knowledge reads return the existing live target
- **AND** publication reports recovery pending rather than successful retention

#### Scenario: External change appears during recovery

- **WHEN** recovery finds live bytes different from both the recorded base and desired bytes
- **THEN** it preserves those bytes and reports a conflict
- **AND** it retains the original intent for inspection without resetting history

#### Scenario: Accepted ref advances before installation

- **WHEN** the worker stops after advancing the accepted ref to the recorded candidate but before installing the target
- **THEN** recovery identifies that exact ref transition and does not create another commit
- **AND** it installs only the recorded target after current authorization and base checks, or preserves a conflict or recovery-pending outcome

#### Scenario: Installation succeeds before crash and revocation

- **WHEN** live installation succeeds, the worker dies before receipt settlement, and access is then revoked
- **THEN** trusted owner-scoped recovery may inspect the recorded ref and exact target bytes to settle that already-installed outcome
- **AND** it neither repeats installation nor grants new access, recreates a deleted Run, or discloses the receipt to another owner

#### Scenario: Access is revoked before installation

- **WHEN** an owner loses current access after preparation but before installation authorization
- **THEN** the publisher performs no new live-file installation
- **AND** retained candidate state grants no future access or execution authority

### Requirement: Publication data stays owner scoped and survives source Chat deletion

Hosted publication and enablement records SHALL enforce enabled and forced RLS
and explicit owner predicates; missing trusted identity SHALL fail closed.
Personal records SHALL remain in the Node's private single-owner store.
Publication history and bounded recovery preimages SHALL follow the Knowledge
resource's retention, independently of deleting its originating Chat. A retained
Run reference SHALL be provenance only, never permission to recreate a Run.
Results and logs SHALL exclude credentials, host paths, and raw Git diagnostics.

#### Scenario: Another owner probes a publication

- **WHEN** a second owner supplies an observed or guessed publication or Space identifier
- **THEN** no content, state, Git metadata, or existence signal is disclosed
- **AND** a query without tenant identity cannot read or mutate the journal

#### Scenario: Source Chat is deleted

- **WHEN** the owner deletes the Chat that originated an already prepared or published Knowledge change
- **THEN** Knowledge history and necessary recovery data remain retained
- **AND** recovery cannot recreate the deleted Chat or authorize a new effect

### Requirement: Published Knowledge completes the combined product loop

The release SHALL demonstrate remote research producing one sourced note,
publication surviving refresh/reopen, a new Chat reading the live note, and a
later Chat deliberately recalling the originating conversation under existing
episodic consent. The same scenario SHALL deny a second owner access to the
first owner's notes and history. Missing Git SHALL block publication only.

#### Scenario: Later Chat reads the retained note

- **WHEN** Chat A publishes researched Knowledge and Chat B retrieves it later
- **THEN** Chat B reads the published live bytes through existing Knowledge tools
- **AND** a later authorized recall can inspect Chat A without making the Chat the note's source of truth

#### Scenario: Personal publication works without a Sandbox

- **WHEN** the standalone personal owner enables publication, approves a FileView edit and publication, and the local worker restarts after candidate creation
- **THEN** the local adapter recovers the same intent, reports explicit acceptance only after live installation, and a new Chat reads those bytes through `knowledge_read`
- **AND** this path requires no C3 Sandbox, remote service, or account; hosted execution of the same contract separately proves second-owner denial
