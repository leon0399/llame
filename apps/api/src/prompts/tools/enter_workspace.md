Enter a Workspace: a directory on the native host, or on an operator-configured remote Machine.

<instruction>
`path`: required. Either an absolute directory path on the native host, or a `machine://<name><absolute path>` locator naming a directory inside one of that Machine's registered roots (list Machines with `read machine://` and a Machine's roots with `read machine://<name>`). The path is checked by the operator's `enter_workspace` permission group before it is probed and checked again after canonicalization. Relative paths and paths containing NUL bytes are invalid. The canonical root becomes the working root for relative native file paths and Bash `cwd` values beginning with the next model step; in a Machine Workspace, relative paths and bare absolute paths address that Machine, and `bash` runs there. `..` may leave the root and Workspace entry does not confine host operations. The result lists bounded, proactively eligible skills discovered beneath the Workspace's `.claude/skills`, `.agents/skills`, and `.llame/skills` sources; read their instructions with `skill://<name>` on the next model step.

</instruction>

<critical>
Workspace selects a working root but is not filesystem confinement; host operations retain the host user's authority. Entering a Workspace can start host processes with that authority. A Machine Workspace runs as that Machine's OS user with no sandbox: its registered roots bound addressing only and can be changed by that user, and a Machine shared between users gives no isolation between them.
</critical>
