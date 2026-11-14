## MODIFIED Requirements

### Requirement: Remote bash uses the local bounds

The output, input, and process bounds MUST be the same as for a local call. The time bound MUST
be the deadline that `bash-execution` defines for a command on an `ssh://` directory. A remote
command MUST NOT move to the background. The input bound MUST apply to the text of the model, as
for a local call. That text is `command`, `cwd`, and `env`, and not the generated script. The
process slot MUST be the one that local `bash` uses.

#### Scenario: Command text above the input bound is refused before a process

- **WHEN** the model gives an `ssh://` `bash` command longer than the local input bound
- **THEN** the tool refuses the call as a local call does
- **AND** no SSH process starts

#### Scenario: A remote command still ends at its deadline

- **WHEN** an `ssh://` `bash` command runs longer than `tools.callTimeoutSeconds`
- **THEN** the local SSH process stops, and the call does not return `backgrounded`
