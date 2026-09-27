Exit the current Workspace on the native host.

<instruction>
This tool takes no arguments. It clears the current Workspace binding for later model steps and Runs. Exiting an unbound Chat is a harmless success.
</instruction>

<critical>
Workspace changes take effect from the next model step. Exiting changes the working root only; it does not revoke the host user's authority or provide filesystem confinement.
</critical>
