{{#if hasWorkspace}}
The active Workspace working root is `{{root}}`, on Machine `{{machine}}`.
Tools resolve bare and relative paths and `file:` locators there.

Machine operations run as that Machine's own OS user without sandboxing; the Machine's registered roots bound addressing only, and that user can change them. Every hub user bound to the same Machine shares that one OS user, so the Machine itself provides no isolation between them.
{{else}}
No Workspace is entered. Tools resolve bare and relative paths and `file:` locators on the current Machine, `{{machine}}`. Use `machine://<name>/...` to reach another Machine.
{{/if}}
