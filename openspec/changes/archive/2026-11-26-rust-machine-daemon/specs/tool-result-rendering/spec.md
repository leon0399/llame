## MODIFIED Requirements

### Requirement: A left-out line counts what no artifact holds

When a result does not fit, no artifact stores it, and it carries no
omitted-range line, the text MUST end with one `[left out: <count> <noun>;
full result not stored]` line. `<noun>` is
`lines`, `files`, or `results`. An omitted-range line without an artifact MUST
read `[lines <a>-<b> omitted; full result not stored]`.
A failed durable daemon-job artifact write MUST instead leave settlement
uncommitted under `tool-artifacts` "Artifact failure preserves daemon
reconciliation"; this fallback MUST NOT replace that retained output.

#### Scenario: A failed write keeps the bash tail inline

- **WHEN** a standalone `ssh://` `bash` stdout of 5,000 lines does not fit and its artifact write fails
- **THEN** the text holds its head, `[lines 41-4880 omitted; full result not stored]`, and its tail

#### Scenario: A grep result without a reader counts its files

- **WHEN** a `grep` result leaves 140 files out and the Run cannot read artifacts
- **THEN** the text ends with `[left out: 140 files; full result not stored]`
