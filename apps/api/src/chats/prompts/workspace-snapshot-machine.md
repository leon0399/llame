The active Workspace working root is `{{root}}`, on Machine `{{machine}}`.
Machine operations run as that Machine's own OS user without sandboxing; the Machine's registered roots bound addressing only, and that user can change them. Every hub user bound to the same Machine shares that one OS user, so the Machine itself provides no isolation between them.
