Run a shell command as the host user via `bash -c` in a fresh process.

<instruction>
- Set `cwd` instead of `cd`; use `env: { NAME: "…" }` for multiline/quote-heavy values.
- An omitted `cwd` uses the Workspace root while one is entered and the host default otherwise; a relative `cwd` resolves from the Workspace root without confinement (`..` may leave it), or from the host default with no Workspace.
- Order-dependent commands use `&&` in one call; no shell state (working directory, variables, functions) persists between calls.
- Independent calls may run concurrently using parallel tool calling function.
{{! - `pty: true` only for terminal interaction (`sudo`, `ssh`). }}
{{! - `async: true` defers a finite command's result; it does not extend `timeout`. }}
</instruction>

## Parameters

- `command` - Shell text, required (e.g. `git status --porcelain`).
- `cwd` - A literal existing directory resolved against the default directory; no `~` or `$` expansion (e.g. `apps/api`, `/srv/project`).
- `env` - Variables added to the fixed managed base; base keys cannot be replaced (e.g. `{"MESSAGE": "line one\nline two"}`).
{{! - `timeout` - seconds; 0 disables the job deadline. }}

## Output

- Output returns as produced, cut at the bound.
- A timeout with a proven stop reports `timed_out` plus partial output.
{{! - Long output is linked as `artifact://<id>`; re-slice it instead of re-running the command. }}

{{! - Services, watchers, debuggers, and REPLs MUST use `hub` (`op:"start"`). }}
<critical>
- Alpha host authority, not tenant isolation.
{{#if tools.edit}}- Prefer native edit for small exact replacements.
{{/if}}</critical>
