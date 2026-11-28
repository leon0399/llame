---
"web": minor
---

- The new-chat page is `/` itself: the draft's id stays out of the URL until
  the first send, so refreshing an empty new chat no longer resolves an id
  nothing stored. The composer sits centred under a time-of-day greeting
  that uses the owner's preferred name. Session details no longer open for
  an unsent draft, and a failed jobs read is a quiet retry row.
