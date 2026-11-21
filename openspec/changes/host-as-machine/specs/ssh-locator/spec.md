## MODIFIED Requirements

### Requirement: ssh locators are prompt-import targets

If the configuration has the `ssh` section and `read` in `tools.allowed`, an `ssh://` marker in a user prompt MUST be a prompt-import target. Such a target needs no Machine and no Knowledge root. The hub MUST read it once through `read` with system origin `prompt-import`, as for a web target, with no probe and no separate pre-evaluation. The read MUST use the same admission as a model call, and it MUST count toward the read and output bounds of prompt imports.

#### Scenario: ssh marker is imported

- **WHEN** the user writes `` Explore @`ssh://box/etc/hostname` `` and a `read` allow applies to the resolved locator
- **THEN** the turn gets a `prompt-imports` item with the content of the file before the model request

#### Scenario: ssh marker needs no native executor

- **WHEN** the configuration has the `ssh` section and `read` in `tools.allowed`, the current Machine is unreachable, and the user writes an `ssh://` marker
- **THEN** the turn gets a `prompt-imports` item before the model request

#### Scenario: Denied ssh marker is not imported

- **WHEN** a `read` reject matches the resolved locator of an `ssh://` marker
- **THEN** the marker is named as not imported, and no SSH connection opens

#### Scenario: ssh marker without the section stays prose

- **WHEN** the configuration has no `ssh` section and the user writes an `ssh://` marker
- **THEN** the hub imports nothing for that marker

### Requirement: ssh locators extend local-only argument forms

The `native-file-tools`, `bash-execution`, `tool-call-permissions`, `workspace-entry`, `tool-calling`, and `prompt-imports` capabilities change as follows for `ssh://` locators. One of them can restrict an argument or root to a path on a Machine, or gate on the current Machine. This capability then replaces that rule. Where one of them forbids a model-selected Machine or remote authority, only that clause changes: it applies to Machines. Machine behavior and the other clauses MUST stay the same.

#### Scenario: Bash is offered without a local executor

- **WHEN** the configuration has the `ssh` section, the worker has no `machines.local`, `machines.default` is `devl` with a `destination`, and `bash` is in `tools.allowed`
- **THEN** `bash` is available to the model, and a command with an `ssh://` `cwd` runs on the remote host
- **AND** a bare `cwd` runs on `devl`

#### Scenario: Local behavior stays the same

- **WHEN** the configuration has the `ssh` section and the model reads an absolute path
- **THEN** the read operates on the current Machine, and the `ssh` section does not change it

### Requirement: Permission rules match the resolved ssh locator

The locator is the `read` path without its selector, or the `bash` `cwd`. The other arguments, such as `command` and `env`, stay as submitted. The hub MUST evaluate rejects on the submitted arguments before the resolution, and then with the resolved locator. A match in one of the two MUST refuse the call.

The hub MUST use the resolved text to evaluate the allow. All-fields rejects MUST also find the resolved text. The connection MUST use the resolved user, host, and port.

#### Scenario: Alias cannot go around an address reject

- **WHEN** a `read` reject matches `^ssh://[^/]*@10\.0\.0\.5:` and the included configuration maps the alias `prod` to `HostName 10.0.0.5`
- **AND** the model reads `ssh://prod/etc/hosts`
- **THEN** the hub refuses the call before a connection

#### Scenario: Submitted-text reject refuses before resolution

- **WHEN** a `bash` reject matches `^ssh://prod/` on `cwd` and the model calls `bash` with `cwd: "ssh://prod/srv"`
- **THEN** the hub refuses the call and does not resolve the destination

#### Scenario: Command reject sees the submitted command

- **WHEN** a `bash` reject matches `rm -rf` on `command` and the model calls `bash` with that command and `cwd: "ssh://box/tmp"`
- **THEN** the hub refuses the call and does not resolve the destination

#### Scenario: Allow applies only to the resolved host

- **WHEN** the only `read` allow is `^ssh://deploy@edge-1\.lan:22/var/log/` and the model reads `ssh://deploy@edge-2.lan/var/log/syslog`
- **THEN** the hub refuses the call because no allow applies

#### Scenario: Local rule does not permit a remote path

- **WHEN** the only `read` allow is `^machine://[^/]+/var/log/` and the model reads `ssh://box/var/log/syslog`
- **THEN** the hub refuses the call because no allow applies

#### Scenario: Encoded spelling cannot go around a reject

- **WHEN** a `read` reject matches `/\.ssh/` and the model reads `ssh://box/root/%2Essh/id_ed25519`
- **THEN** the hub refuses the call

#### Scenario: Dot segments stay as written

- **WHEN** the only `read` allow is `^ssh://box@box:22/var/log/` and the model reads `ssh://box/var/log/../../etc/shadow`
- **THEN** the resolved locator keeps the `..` segments, and the allow matches, as for Machine paths

#### Scenario: All-fields reject finds the resolved address

- **WHEN** an all-fields `read` reject matches `10\.0\.0\.5` and the alias `prod` resolves to `10.0.0.5`
- **THEN** the hub refuses a read of `ssh://prod/etc/hosts`
