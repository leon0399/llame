## MODIFIED Requirements

### Requirement: Relative filesystem paths share one Workspace projection rule

While a Chat is bound, a relative filesystem path SHALL mean a value that does not start with `/` and does not have a `scheme:` prefix recognized by the shared locator parser, with recognized `scheme://` prefixes compared case-insensitively. Such a path SHALL resolve lexically from the canonical Workspace root like POSIX `path.posix.resolve`, preserving a submitted trailing separator. Projection SHALL not perform `realpath`; the executor SHALL receive exactly the resulting projected absolute string, and symlinks inside that projected path SHALL be followed by the operating system as for any absolute path. `..` MAY resolve outside the root, because Workspace is not a confinement boundary. The resulting absolute path SHALL be used for both execution and permission evaluation, and permission evaluation SHALL NOT match the submitted relative spelling. During an attempt, the working root SHALL live in one mutable attempt-scoped cell read by the runner and permission evaluator at dispatch; per-call copies of tool context SHALL NOT become independent sources of truth. An omitted bash working directory SHALL use the root as its effective directory for execution and permission evaluation. Absolute paths and recognized non-filesystem locators, including `kb://`, `skill://`, `media://`, and web locators, SHALL retain their existing interpretation. Unknown schemes SHALL remain `invalid_path`. Without a binding, relative native-file paths SHALL remain `invalid_path` and bash SHALL retain its existing default working directory. The bash command text SHALL retain its existing text-only permission matching and SHALL NOT be rewritten as a filesystem path. The `bash-execution` and `native-file-tools` requirements define the tool-specific argument and result behavior.

#### Scenario: Relative native path projects from the Workspace root

- **WHEN** a bound Chat calls a native file tool with a relative filesystem path
- **THEN** the path is resolved lexically from the canonical Workspace root and the resulting absolute path is used for execution and permission evaluation
- **AND** permission evaluation does not match the submitted relative spelling

#### Scenario: Parent segments are not confined

- **WHEN** a bound Chat supplies a relative path containing parent segments that resolves outside the Workspace root
- **THEN** projection produces the resulting absolute path outside that root
- **AND** the Workspace binding does not itself confine the host operation to the root

#### Scenario: Omitted bash directory uses the Workspace root

- **WHEN** a bound Chat calls bash without a `cwd`
- **THEN** the command executes with the Workspace root as its effective working directory
- **AND** permission evaluation sees that same absolute directory

#### Scenario: No binding preserves existing relative-path behavior

- **WHEN** a Chat without a Workspace binding supplies a relative native-file path or omits bash `cwd`
- **THEN** the relative native-file path returns `invalid_path` and bash uses its existing default working directory
- **AND** no Workspace root is inferred

#### Scenario: Non-filesystem locators are unchanged

- **WHEN** a bound Chat uses an absolute path or a `kb://`, `skill://`, or web locator
- **THEN** Workspace projection does not reinterpret the locator
- **AND** its existing locator-specific behavior remains in effect

#### Scenario: Unknown schemes remain invalid paths

- **WHEN** a bound Chat supplies a locator with an unknown `scheme://` prefix to a native file tool
- **THEN** Workspace projection does not treat it as a relative filesystem path
- **AND** the tool returns `invalid_path`

#### Scenario: Trailing separator is preserved

- **WHEN** a bound Chat calls `read("app.ts/")` for a file under the Workspace root
- **THEN** the projected absolute path retains the trailing separator and the executor receives that exact string
- **AND** the result is `not_found` or invalid in the same way as the equivalent absolute path with a trailing separator

#### Scenario: Same-step read uses the prior root

- **WHEN** one model step issues `enter_workspace` or `exit_workspace` together with `read("f")`
- **THEN** the read is projected from the root committed before that step began
- **AND** a binding change takes effect for projection only from the next model step

#### Scenario: A media locator is not a relative path

- **WHEN** a Chat bound to `/work/project` calls `read` with `media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f`
- **THEN** Workspace projection leaves the locator unchanged and permission evaluation sees
  `media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f`
- **AND** the read resolves the Run owner's media object rather than a path under `/work/project`
