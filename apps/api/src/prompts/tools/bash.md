Run a shell command as the host user via `bash -c`.

<instruction>
`command`: shell text, required; `cwd`: a literal existing directory; an omitted `cwd` uses the Workspace root while one is entered and the host default otherwise; a relative `cwd` resolves from the Workspace root without confinement (`..` may leave it), or from the host default with no Workspace; no `~`/`$` expansion; `env`: variables added to the fixed managed base, whose keys cannot be replaced; no shell state persists between calls; output returns as produced, cut at the bound; a timeout with a proven stop reports `timed_out` plus partial output.
</instruction>

<critical>
Alpha host authority, not tenant isolation.
{{#if tools.edit}}Prefer native edit for small exact replacements.{{/if}}
</critical>
