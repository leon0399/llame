## ADDED Requirements

### Requirement: The tool is advertised whenever it is allowlisted

The candidate resolver MUST admit `grep` when `tools.allowed` names it. Startup MUST fail when `tools.allowed` names `grep` and `machines.default` is absent, so a Machine backend can always serve. The packaged description MUST be a complete template under the tool-prompt-templates rules. `tools.grep` MUST be a true predicate when the tool is admitted.

#### Scenario: An allowlisted grep is advertised

- **WHEN** `tools.allowed` names `grep` and `machines.default` is `devl`
- **THEN** `grep` is advertised

#### Scenario: Grep without a default Machine fails startup

- **WHEN** `tools.allowed` names `grep`, a Knowledge root is configured, and `machines.default` is absent
- **THEN** startup fails naming `machines.default`

## MODIFIED Requirements

### Requirement: Scope backends fail closed per scheme

A host scope MUST run on the current Machine through the `fs.grep` protocol method, as a `machine://` scope on that Machine. A `kb://` scope on a process without a configured Knowledge root MUST fail as `knowledge_space_unavailable`. A bare `kb://` scope for an owner with zero Spaces MUST fail as `knowledge_space_not_configured`. A bare `kb://` scope MUST check access to each Space again before the walk enters it.

A bare `skill://` scope on a Chat with no effective skill source names zero packages. The tool searches it, and it returns no passage and no failure. A `skill://<name>` scope there MUST fail as `not_found`, as `read` does. A `skill://` scope with no catalog snapshot MUST fail as `skill_catalog_unavailable`. A failure of one scope MUST fail the whole call. A partial result MUST NOT hide a scope that the tool did not search.

A `machine://` scope MUST run on the named Machine through the `fs.grep` protocol method. The daemon MUST resolve the prefix through its registered roots. It MUST return `path_not_registered` for a prefix outside them, as `read` does. The daemon MUST walk, match, and bound the search on its Machine under the rules of this capability.

The request carries the file, entry, byte, and file-size bounds that are left for the call. An unset bound MUST travel as `null`, and the daemon then MUST apply no such bound. The daemon MUST stay inside each bound that the request sets. The request also carries whether the call progressed. The response carries whether the daemon walk progressed, as "A stop inside a file before progress names that file" defines progress.

The request MUST give the daemon nine tenths of the time left to the call deadline. The daemon answer then arrives before the API stops the request. The API MUST stop the request at the call deadline.

The daemon MUST return passages, excluded directories, and an unfinished file as paths relative to its display prefix only. The request carries a page budget that fits one protocol message. The API MUST ask for the next response after the daemon position of the previous response. A page of refused passages thus still advances the walk. It MUST ask again until the scope ends, the call stops, or the artifact bound cuts a daemon page. The API MUST apply the `read` group to each path that the daemon returns before the result names it.

An unreachable or unknown Machine MUST fail the call with the Machine failure results that `read` uses. The API MUST NOT walk a host scope in process. A daemon without the method MUST fail the call as Machine unusable. A daemon that refuses the request parameters MUST also fail the call as Machine unusable.

#### Scenario: Host scope without an executor

- **WHEN** a scope is `/srv/data/**` and the current Machine `devl` is unreachable
- **THEN** the tool returns `machine_unavailable`
- **AND** no directory is walked in the worker process

#### Scenario: Knowledge scope without a root

- **WHEN** a scope is `kb://<id>/notes/**` and the worker has no configured Knowledge root
- **THEN** the tool returns `knowledge_space_unavailable`

#### Scenario: Skill scope without a source

- **WHEN** a scope is a bare `skill://` and the Chat has no effective skill source
- **THEN** the result holds no passage for that scope and `complete: true`

#### Scenario: Named skill scope without a source

- **WHEN** a scope is `skill://reviewer` and the Chat has no effective skill source
- **THEN** the tool returns `not_found`

#### Scenario: Named skill scope without a catalog snapshot

- **WHEN** a scope is `skill://reviewer` and the catalog snapshot of the Chat is not available
- **THEN** the tool returns `skill_catalog_unavailable`

#### Scenario: Machine search runs on the Machine

- **WHEN** a scope is `machine://build/srv/app/**/*.go`
- **THEN** the daemon on `build` does the walk and the match
- **AND** each hit locator starts with `machine://build/`

#### Scenario: Machine prefix outside the roots

- **WHEN** a scope is `machine://build/**` and `/` is not a registered root
- **THEN** the tool returns `path_not_registered`
- **AND** the daemon opens no file

#### Scenario: Unknown Machine fails the call

- **WHEN** a scope names a Machine that is not configured
- **THEN** the tool returns the Machine not-found result that `read` uses
- **AND** the tool searches no other scope of that call

#### Scenario: A dropped Machine passage never names the cursor

- **WHEN** the last passage of the daemon belongs to a file that the `read` group refuses
- **THEN** the next `fs.grep` request resumes after the daemon position of that response
- **AND** the refused path is not in the result

#### Scenario: Budgets span Machines

- **WHEN** `tools.grep.maxBytesRead` is 32 MiB, two Machine scopes are submitted, and the first consumed 30 MiB
- **THEN** the second request carries a 2 MiB byte bound

#### Scenario: An unset bound travels as null

- **WHEN** `tools.grep` sets no bound and a scope is `machine://build/srv/**`
- **THEN** the request carries `null` for the file, entry, byte, and file-size bounds
- **AND** the daemon applies no file, entry, byte, or file-size bound

#### Scenario: A daemon that refuses the request is unusable

- **WHEN** a daemon answers an `fs.grep` request with an invalid-parameters error
- **THEN** the tool returns the Machine unusable result, not `invalid_input`

#### Scenario: A host scope runs through the host Machine daemon

- **WHEN** the current Machine is the host Machine `devl` and a scope is `/srv/data/**`
- **THEN** the `devl` Machine daemon does the walk and the match
- **AND** each hit locator starts with `machine://devl/`

## REMOVED Requirements

### Requirement: The tool is advertised when a backend can serve

**Reason**: Startup now fails when a native tool is allowlisted without `machines.default`, so a Machine backend always exists when `grep` is allowlisted. The scenario "Knowledge root alone admits grep" can no longer occur.

**Migration**: Use "The tool is advertised whenever it is allowlisted". Set `machines.default` on a process that allowlists `grep`.
