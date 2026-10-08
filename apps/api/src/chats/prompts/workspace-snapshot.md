{{#if hasWorkspace}}
The active Workspace working root is `{{root}}`.
The Workspace selects a working root for relative paths but does not confine host authority; host operations retain the host user's authority.
{{else}}
No Workspace is entered.
{{/if}}
