{{#if machine}}
The Workspace was detached before this turn because Machine `{{machine}}` is no longer configured on this instance.
The Workspace is not active; enter a Workspace again to restore it.
{{else}}
The Workspace was detached before this turn because its binding check failed: `{{reason}}`.
The Workspace is not active; enter a Workspace again to restore it.
{{/if}}
