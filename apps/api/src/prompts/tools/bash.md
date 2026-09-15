Run a shell command as the host user via `bash -c`.

<instruction>
`command`: shell text, required; `cwd`: a literal existing directory resolved against the default directory, without `~`/`$` expansion; `env`: variables added to the fixed managed base, whose keys cannot be replaced; no shell state persists between calls; output returns as produced, cut at the bound; a timeout with a proven stop reports `timed_out` plus partial output.
</instruction>

<critical>
Alpha host authority, not tenant isolation.
{{#if tools.edit}}Prefer native edit for small exact replacements.{{/if}}
</critical>
