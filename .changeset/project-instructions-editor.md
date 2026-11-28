---
"web": minor
"@workspace/ui": patch
---

- The Project page's Instructions section shows stored instructions as a card
  clamped to six lines, or a call to add them, and edits them in a dialog.
  Ctrl/⌘+Enter saves, the character count appears only from 14,000 of the
  16,000-character limit, and a failed save keeps the dialog open with the
  draft. An archived Project's instructions open read-only. The Edit details
  and New project dialogs are wider, their Description field is taller, and
  Ctrl/⌘+Enter saves from it. Text fields in dialogs no longer have a resize
  handle, which moved at half the cursor's speed in a centered dialog; they
  grow with their content. A keyboard shortcut inside a button takes the
  button's colors.
