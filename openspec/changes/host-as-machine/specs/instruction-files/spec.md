## ADDED Requirements

### Requirement: A Machine-path trigger names one directory on its Machine

An entry trigger, and a native `read`, `edit`, or `write` whose `path` is on a Machine, MUST each name one directory `D` on that Machine. For an entry trigger, `D` MUST be the canonical Workspace root. For a file-tool trigger or an admitted import, `D` MUST be the projected path when it is an existing directory, or else its parent directory. A `kb://` trigger MUST follow the Knowledge-locator requirement.

#### Scenario: Reading a directory loads that directory's own chain

- **WHEN** the model reads the existing directory `apps/api` on a Chat bound to `machine://devl/home/u/repo`
- **THEN** `D` is `machine://devl/home/u/repo/apps/api`, so `/home/u/repo/apps/api/AGENTS.md` on `devl` is a candidate

#### Scenario: A prompt import of a directory loads that directory's own chain

- **WHEN** an admitted prompt import resolves to the existing directory `machine://devl/home/u/repo/apps/api` and `/home/u/repo/apps/api/AGENTS.md` exists on `devl`
- **THEN** the import names that directory itself as `D`

#### Scenario: Write into a directory that does not exist yet

- **WHEN** `write("/home/u/repo/apps/web/src/new.tsx")` on the current Machine `devl` targets a directory whose parent chain contains `/home/u/repo/apps/web/AGENTS.md`
- **THEN** that file is loaded from the next model step, whether or not the write succeeded, unless the call was denied

### Requirement: A Machine-path trigger loads the chain from the containing registered root

The load MUST consider each directory from the registered root that contains `D` down to `D`, in that order, on the Machine of `D`. It MUST include ancestors above a Workspace root or a repository boundary inside that registered root. It MUST NOT read above that registered root. The walk MUST NOT go into siblings or children of `D`.

#### Scenario: Entry loads the root and its ancestors

- **WHEN** `/home/u` is a registered root of `devl`, `enter_workspace("machine://devl/home/u/repo/apps/api")` succeeds, and `/home/u/repo/AGENTS.md` and `/home/u/repo/apps/api/AGENTS.md` exist on `devl`
- **THEN** one bundle carries `machine://devl/home/u/repo/AGENTS.md` then `machine://devl/home/u/repo/apps/api/AGENTS.md`

#### Scenario: File touch outside the Workspace still walks its ancestors

- **WHEN** a Chat bound to `machine://devl/home/u/repo` reads `/home/u/other/src/x.ts`, `/home/u` is a registered root, and `/home/u/other/AGENTS.md` exists
- **THEN** the bundle carries `machine://devl/home/u/other/AGENTS.md`
- **AND** that trigger does not load the files of the Workspace root again

#### Scenario: An import trigger walks from its resolved directory

- **WHEN** an admitted import resolves to `machine://devl/home/u/repo/apps/api/doc.md`, and `/home/u/repo/AGENTS.md` and `/home/u/repo/apps/api/AGENTS.md` exist
- **THEN** the import names `machine://devl/home/u/repo/apps/api` as `D` and loads the chain from the containing registered root down to `D`

#### Scenario: A host chain stops at the registered root

- **WHEN** the host Machine `devl` registers only `/home/u/repo`, `/home/u/AGENTS.md` exists, and the model enters `machine://devl/home/u/repo`
- **THEN** `/home/u/AGENTS.md` is not loaded

## REMOVED Requirements

### Requirement: A host-path trigger loads the chain from the filesystem root down to the touched directory

**Reason**: The host is a Machine, and every Machine reads only inside its registered roots. A host chain therefore starts at the registered root that contains the touched directory, not at the filesystem root.

**Migration**: Use "A Machine-path trigger names one directory on its Machine" and "A Machine-path trigger loads the chain from the containing registered root". An operator who wants the previous chain registers `/` on the host Machine.
