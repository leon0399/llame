Run a shell command as the host user via `bash -c`.

<instruction>
`command`: shell text, required; `cwd`: a literal existing directory; an omitted `cwd` uses the Workspace root while one is entered and the host default otherwise; a relative `cwd` resolves from the Workspace root without confinement (`..` may leave it), or from the host default with no Workspace; no `~`/`$` expansion; `env`: variables added to the fixed managed base, whose keys cannot be replaced; no shell state persists between calls; output returns as produced, cut at the bound; a timeout with a proven stop reports `timed_out` plus partial output. A `machine://<name><absolute path>` `cwd` runs the command on that Machine there, with the same bounds and managed base; while the Workspace is on a Machine, an omitted or relative `cwd` resolves on it and a bare absolute `cwd` is that Machine's path.
</instruction>

<critical>
Alpha host authority, not tenant isolation. A Machine command runs as that Machine's OS user with no sandbox: its registered roots bound addressing only and can be changed by that user, and a Machine shared between users gives no isolation between them.
{{#if tools.edit}}Prefer native edit for small exact replacements.{{/if}}
</critical>
