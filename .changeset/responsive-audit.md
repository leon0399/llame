---
"web": patch
"@workspace/ui": minor
---

- Projects are reachable on a phone: the rail's Projects entry is enabled,
  and `/projects` lists the owner's projects with New project where the
  desktop shows its projects rail.
- Below 1280px, session details start closed and open as a sheet over the
  chat, so on a tablet the chat is never squeezed between the chats rail
  and the details. The saved desktop preference is untouched.
- Administration opens on a phone: the rail entry is enabled and its pages
  switch sections from the breadcrumb. Keyboard hints in the rail are
  hidden on touch screens.
- On a phone, finished jobs open in a full-width bottom drawer that swipes
  down to close, so their logs get the screen's width; below 1280px they
  open in a wider side sheet of their own. Project, Organizations and the
  Settings and Administration pages use the new-chat page's side padding.
