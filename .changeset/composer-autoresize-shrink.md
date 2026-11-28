---
"@workspace/ui": patch
"web": patch
---

- The composer shrinks back to one line after a long message is sent. The
  auto-resize hook now re-measures when the controlled value changes, not
  only on typing.
