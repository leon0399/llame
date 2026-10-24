# `grep` compared

File-content search across llame and other agent harnesses. This comparison
covers dedicated grep tools, not shell-command timeouts, semantic search, or
web fetch. llame's [grep reference](../../product/reference/tools/grep.md)
owns its behavior.

## Evidence

Source inspection only. No upstream tools or cross-harness performance tests
ran. The revisions below identify the inspected trees, not a claim about the
latest upstream releases. Claude Code evidence comes from its public docs,
not implementation source. Its documentation URL is mutable.

| Harness     | Inspected revision and entry point                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| llame       | [`0e37f0c`](https://github.com/leon0399/llame/blob/0e37f0c078f05aab9eeff9668263ea1759424513/packages/native-file-tools/src/grep/limits.ts), plus the local grep reference |
| omp         | [`0b5c27a`](https://github.com/can1357/oh-my-pi/blob/0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0/packages/coding-agent/src/tools/grep.ts)                                    |
| OpenCode    | [`70a2469`](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/tool/plugin/grep.ts)                                    |
| Gemini CLI  | [`9b6e026`](https://github.com/google-gemini/gemini-cli/blob/9b6e0265d16bbd29ca51e33c9e0c01dc4cec5e83/packages/core/src/tools/ripGrep.ts), plus its fallback `grep.ts`    |
| pi          | [`8a9c051`](https://github.com/badlogic/pi-mono/blob/8a9c051f80090895abbc64262bc90d95b42103c4/packages/coding-agent/src/core/tools/grep.ts)                               |
| OpenClaw    | [`d9fc255`](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/src/agents/sessions/tools/grep.ts), session grep implementation            |
| Claude Code | [Grep tool behavior](https://code.claude.com/docs/en/tools-reference#grep-tool-behavior), public documentation inspected for this comparison                              |

`Not found` means no corresponding bound appeared in the inspected tool path.
It does not mean unlimited execution. Parent cancellation, runtime policy,
filesystem access, and backend constraints can still apply.

## Bounds

A scan budget limits work or coverage. A response budget limits what the
model receives. These are different contracts.

| Capability              | llame                                                       | omp                                                                                                           | OpenCode                                                       | Gemini CLI                                                                   | pi                                                             | OpenClaw                                                         | Claude Code                         |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------- |
| Search backend          | RE2 patterns over bounded file reads                        | Native Rust grep engine                                                                                       | ripgrep process                                                | ripgrep, plus fallback grep implementation                                   | ripgrep process                                                | ripgrep process in session tool                                  | ripgrep, per docs                   |
| Dedicated deadline      | 30 s per scan call                                          | 30 s per native invocation, not necessarily the whole tool call                                               | 30 s around the grep operation                                 | At least 30 s, or a larger internal `fileFiltering.searchTimeout`            | No tool-local timer found                                      | No tool-local timer found in session grep                        | Not documented in inspected section |
| Model can set timeout   | No                                                          | No                                                                                                            | No                                                             | No                                                                           | No                                                             | No                                                               | Not documented                      |
| Timeout override        | Code-owned constant                                         | Code-owned constant                                                                                           | Code-owned constant                                            | Core config accepts a larger timeout. User-settings exposure not established | No timer override found                                        | No timer override found                                          | Not documented                      |
| Default result count    | 20 files, up to 20 passages per file                        | 20 files, 20 matches per file. Single-file scope: 200 matches                                                 | 100 matching lines                                             | 100 total matches                                                            | 100 matches                                                    | 100 matches                                                      | Numeric default not documented      |
| Result-count control    | `limit`, maximum 20 files                                   | `skip` for file pages, fixed file window                                                                      | Per-call `limit`                                               | `total_max_matches`, optional `max_matches_per_file`                         | Per-call `limit`                                               | Per-call `limit`                                                 | `head_limit`, `offset`              |
| Response size           | 15,000 UTF-16 code units for serialized result              | 50 KiB content-output budget, less reserved notices                                                           | No tool-local byte cap found                                   | No fixed overall byte cap found in formatter                                 | 50 KiB formatted output                                        | 50 KiB formatted output                                          | Not documented                      |
| Line preview            | 512 code units                                              | 512-column native option                                                                                      | No numeric preview bound established here                      | 2,000 graphemes in formatted match lines                                     | 500 characters                                                 | 500 characters                                                   | Not documented                      |
| Additional scan budgets | 5,000 files, 20,000 directory entries, 32 MiB read per call | Normal native total-match cap 2,000. Range-filter paths can request a larger cap                              | No explicit file-count or total-read cap found in tool wrapper | No explicit file-count or total-read cap found in inspected tools            | No explicit file-count or total-read cap found in tool wrapper | 1 MiB maximum ripgrep JSON record. This is not a file-size limit | Not documented                      |
| Large-file coverage     | Files over 1 MiB skipped                                    | Explicit single-line file search streams the file. Multiline explicit file search covers only the first 4 MiB | No tool-specific maximum file size found                       | No tool-specific maximum file size found                                     | No tool-specific maximum file size found                       | No tool-specific maximum file size found                         | Not documented                      |

Sources for values outside the entry-point files:

- llame: [limits](https://github.com/leon0399/llame/blob/0e37f0c078f05aab9eeff9668263ea1759424513/packages/native-file-tools/src/grep/limits.ts)
  and [scan](https://github.com/leon0399/llame/blob/0e37f0c078f05aab9eeff9668263ea1759424513/packages/native-file-tools/src/grep/scan.ts).
- omp: [native grep](https://github.com/can1357/oh-my-pi/blob/0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0/crates/pi-natives/src/grep.rs),
  [output constants](https://github.com/can1357/oh-my-pi/blob/0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0/packages/tui/src/tools/streaming-output.ts),
  and [settings](https://github.com/can1357/oh-my-pi/blob/0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0/packages/coding-agent/src/tools/settings.ts).
- OpenCode: [filesystem constants and schema](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/filesystem.ts)
  and [ripgrep process and stream](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/ripgrep.ts).
- Gemini CLI: [search constants](https://github.com/google-gemini/gemini-cli/blob/9b6e0265d16bbd29ca51e33c9e0c01dc4cec5e83/packages/core/src/tools/constants.ts),
  [fallback grep](https://github.com/google-gemini/gemini-cli/blob/9b6e0265d16bbd29ca51e33c9e0c01dc4cec5e83/packages/core/src/tools/grep.ts),
  [formatter](https://github.com/google-gemini/gemini-cli/blob/9b6e0265d16bbd29ca51e33c9e0c01dc4cec5e83/packages/core/src/tools/grep-utils.ts),
  [line constant](https://github.com/google-gemini/gemini-cli/blob/9b6e0265d16bbd29ca51e33c9e0c01dc4cec5e83/packages/core/src/utils/constants.ts),
  and [core config](https://github.com/google-gemini/gemini-cli/blob/9b6e0265d16bbd29ca51e33c9e0c01dc4cec5e83/packages/core/src/config/config.ts).
- pi: [output constants](https://github.com/badlogic/pi-mono/blob/8a9c051f80090895abbc64262bc90d95b42103c4/packages/coding-agent/src/core/tools/truncate.ts).
- OpenClaw: [shared output constants](https://github.com/openclaw/openclaw/blob/d9fc2556e8f1aff06bbf6f65b2e8f933e8fda09f/packages/agent-core/src/harness/utils/truncate.ts).

## Search controls and incomplete results

| Capability               | llame                                                                   | omp                                                                                      | OpenCode                                                                   | Gemini CLI                                                                                                       | pi                                                       | OpenClaw                                                      | Claude Code                                                   |
| ------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| Scope controls           | Up to 16 file, directory, or glob scopes across supported locator types | Path expression, multiple targets, globs, line ranges, internal URLs and archive support | File/directory `path`, `include` glob                                      | Path or paths, include/exclude filters                                                                           | File/directory `path`, `glob`                            | File/directory `path`, `glob`                                 | `path`, `glob`, file `type`                                   |
| Case/literal controls    | `ignoreCase`, `literal`                                                 | `case`, regex pattern                                                                    | `caseSensitive`, `literal`                                                 | `case_sensitive`, `fixed_strings` on ripgrep path                                                                | `ignoreCase`, `literal`                                  | `ignoreCase`, `literal`                                       | Regex syntax documented                                       |
| Context                  | One line each side                                                      | Settings default to one before, three after                                              | No context argument in inspected schema                                    | `context`, `before`, `after` on ripgrep path                                                                     | `context`, default zero                                  | `context`                                                     | Match content mode documented                                 |
| Ignore behavior          | Skips `.git`, honors `.gitignore` on host walks                         | Hidden files included, gitignore defaults on, per-call override                          | Hidden files included, `.git` excluded, ripgrep ignore rules remain active | Gitignore policy, common excludes, `.geminiignore` and custom ignore files. `no_ignore` override on ripgrep path | Hidden files included, ripgrep ignore rules              | Hidden files included, ripgrep ignore rules                   | Honors `.gitignore`. Direct file path can search ignored file |
| Continuation             | Input-bound cursor for partial pages and bound stops                    | File-count `skip`, within native retrieval limits                                        | Refine scope/pattern or increase `limit`. No cursor                        | Refine scope/pattern or increase result count. No cursor found                                                   | Increase `limit` or refine. No cursor                    | Increase `limit` or refine. No cursor                         | `offset` with `head_limit`                                    |
| Deadline outcome         | Partial success with warning and cursor                                 | Timeout error advises narrower scope                                                     | Timeout failure advises narrower scope                                     | Timeout error advises narrower scope                                                                             | Caller abort cancels process. No dedicated timeout found | Caller abort kills process. No dedicated timeout found        | Not documented                                                |
| Other truncation signals | `complete`, cursor, warning counts, per-file truncation marker          | File-page notice, native cap and oversized-file notes                                    | `truncated` metadata and model-visible notice                              | Formatter marks limited results                                                                                  | Match/byte/line notices and details                      | Match/byte/line notices. Oversized JSON record produces error | Offset-past-end notice in content mode                        |

All cells derive from the entry points and supporting sources above. Arguments
can differ between a primary tool and its fallback. In particular, Gemini
CLI's ripgrep path exposes more controls than its fallback.

## Interpretation for llame

### A 30-second deadline is not unusual

omp, OpenCode, and Gemini CLI each use 30 seconds in the inspected search
paths. This evidence does not support a claim that other harnesses generally
allow much longer grep calls. pi and the inspected OpenClaw session tool lack
a local timer, but that does not establish an unlimited parent runtime.

Gemini CLI provides a useful distinction: core configuration can increase the
grep deadline above 30 seconds. The inspected code does not establish a
user-facing settings key for that override. Do not describe an internal
configuration field as a verified operator control.

### Execution strategy matters as much as the timeout

llame explicitly budgets file count, directory entries, total bytes, and file
size. The ripgrep wrappers generally stop at a result limit without those
same tool-level scan budgets. omp uses a native backend and limits both file
diversity and per-file results. These differences can affect coverage before
the same wall-time limit. Source inspection alone does not measure their
relative speed on a Windows-mounted filesystem.

The motivating llame search over `/mnt/d/Projects` returned dependency-cache
matches and a deadline warning without results from the expected project directories.
A directory name alone does not prove a content match. The reported partial
result does prove that the tool did not complete its scan in one call.

A useful evaluation for [issue #1397](https://github.com/leon0399/llame/issues/1397)
compares these outcomes on the same tree:

- Time to the first relevant project match, not only time to any match.
- Coverage with the same ignore rules and scope.
- Files, entries, and bytes processed before the stop.
- Progress across cursor calls, including work repeated before the resume point.
- Behavior for dependency caches, generated files, and large files.

These are proposed checks, not completed measurements. The two reported
llame calls do not constitute a cross-harness benchmark.

### Configuration and completeness are separate decisions

An operator timeout override can help slow mounts or large trees. It does not
remove the other scan budgets. A larger result limit does not necessarily
increase coverage either. Native caps, output truncation, and per-file limits
can still hide matches.

For llame, retain explicit partial-result signals and cursor continuation if
bounds become configurable. Evaluate the defaults against the actual workload
before selecting a replacement value. The inspected references support that
separation, not a specific new timeout.

## Limitations

- The comparison covers the inspected dedicated implementations, not every
  agent profile, plugin, or transport that can replace them.
- Claude Code docs currently state that `Grep` is absent by default on macOS,
  Linux, and WSL under the same conditions as `Glob`. This column describes
  its documented tool when available, not a universal default tool set.
- OpenClaw evidence covers its session grep implementation. Default exposure
  across all OpenClaw agents is outside this inspection.
- Generic tool-output budgets can impose additional limits after these tools
  return. This comparison does not enumerate every parent harness budget.
- The source evidence does not justify a general claim that another harness
  completes the motivating search, or that a larger default alone fixes it.
