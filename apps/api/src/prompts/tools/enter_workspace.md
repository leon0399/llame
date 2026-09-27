Enter a Workspace on the native host by canonicalizing an absolute directory path.

<instruction>
`path`: required absolute directory path. The path is checked by the operator's `enter_workspace` permission group before it is probed and checked again after canonicalization. Relative paths and paths containing NUL bytes are invalid. The canonical root becomes the working root for relative native file paths and Bash `cwd` values beginning with the next model step; `..` may leave the root and Workspace entry does not confine host operations. The result lists bounded, proactively eligible skills discovered beneath the Workspace's `.claude/skills`, `.agents/skills`, and `.llame/skills` sources; read their instructions with `skill://<name>` on the next model step.

</instruction>

<critical>
Workspace selects a working root but is not filesystem confinement; host operations retain the host user's authority. Entering a Workspace can start host processes with that authority.
</critical>
