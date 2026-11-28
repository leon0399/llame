---
"web": minor
"@workspace/ui": patch
---

- The composer's toolbar holds `+` (attach files), the model and its effort,
  and Send, all at one height; a long model name is cut, never pushed out of
  the card. The row under the composer is the chat's environment: the
  project, the folder, the Machine when there is a choice of one, the mode
  (the checkout, or a new worktree), and the permission mode at its end. It
  stays one line at every width, so no name or choice moves the input.
- Project and Folder are search lists whose search filters only their own
  items, with "No project" / "No folder" as the first option. The same
  project list (with "New project") files a chat from its row menu, and a
  project created from the composer becomes its choice.
- A problem with the start location is shown on the control it concerns: an
  unusable Machine on the Machine control and at the top of its menu, a
  folder that could not be prepared on the Folder control, and a location
  that could not be resolved as a Retry button.
- `PopoverContent` and `DropdownMenuSubContent` take `flush`, for a child
  that fills the popup edge to edge.
