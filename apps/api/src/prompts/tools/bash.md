Run a shell command as the host user via `bash -c`.

<instruction>
|Field|Required|Meaning|
|---|---|---|
|`command`|yes|the shell text `bash -c` runs|
|`cwd`|no|a literal existing directory, resolved against the default directory; `~` and `$` expansion are not applied|
|`env`|no|variables added to the fixed managed base; it cannot replace the base's keys|

- Each call is a fresh process with no persisted shell state.
- Example: `command="pwd && ls"`.
</instruction>

<output>
- Output is returned as produced and cut at the bound.
- A timeout with a proven stop reports `timed_out` with partial output.
</output>

<critical>
- Alpha host authority — not tenant isolation.
{{#if tools.edit}}- Prefer native edit for small exact replacements.
{{/if}}</critical>
