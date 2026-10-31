Run a shell command as the host user via `bash -c`.

<instruction>
`command`: shell text, required; `cwd`: a literal existing directory; an omitted `cwd` uses the Workspace root while one is entered and the host default otherwise; a relative `cwd` resolves from the Workspace root without confinement (`..` may leave it), or from the host default with no Workspace; no `~`/`$` expansion; `env`: variables added to the fixed managed base, whose keys cannot be replaced; no shell state persists between calls; output returns as produced, cut at the bound; a timeout with a proven stop reports `timed_out` plus partial output. A `machine://<name><absolute path>` `cwd` runs the command on that Machine there, with the same bounds and managed base; while the Workspace is on a Machine, an omitted or relative `cwd` resolves on it and a bare absolute `cwd` is that Machine's path. Set the directory of a command with `cwd`, not with a `cd` in `command`: in an entered Workspace give no `cwd` or one relative to its root, and with no Workspace give an absolute `cwd`. An `ssh://[user@]host[:port]/<absolute path>` `cwd` runs the command with `bash` on that host as the remote login user, when the operator enables ssh locators, under the same bounds and output cut, with only its `env` entries exported; its `env` keys are identifiers (`[A-Za-z_][A-Za-z0-9_]*`), its values are data, and a connection that ends before the end of the command reports `outcome_unknown` and is never replayed.
</instruction>

<output>
- A result is plain text, not JSON: one status header `exit <code>`, continued with `, <seconds> s` (one decimal) when the producer measured the command's wall time, then stdout verbatim, then `[stderr]` and the stderr when it is non-empty; `(no output)` when both streams are empty.
- `[output cut at the bound]` marks output the executor bound cut, and a bracketed cap notice can end the text. A result stored before this shape renders `exit <code>` with no time.
- A failed command's `command_failed` result carries this same text in its message, with the non-zero exit code; a `timed_out` message starts with `timed out` and names the measured elapsed time in seconds, and names no exit code because the command never exited.
- Text is neutralized for reserved delimiters: a tag-shaped token naming `system-reminder`, `tool-call`, `tool-result`, `user_chat_history`, `user_personalization`, `skill`, or `available_skills` is angle-escaped (`&lt;tool-result&gt;`); every other character is the output as produced, `</div>` included.
</output>

<critical>
Alpha host authority, not tenant isolation. A Machine command runs as that Machine's OS user with no sandbox: its registered roots bound addressing only and can be changed by that user, and a Machine shared between users gives no isolation between them. An `ssh://` command runs on the remote host as its login user, through the SSH identity of the instance, and every llame user whose permissions allow it has the same remote authority: no function isolates llame users on that host.
{{#if tools.edit}}Prefer native edit for small exact replacements.{{/if}}
</critical>
