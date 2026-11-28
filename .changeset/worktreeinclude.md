---
"api": minor
"machine": minor
---

- A worktree that `enter_workspace` or Chat creation makes now receives the ignored files that the source checkout's `.worktreeinclude` file selects, such as `.env`. The Machine daemon copies them once during creation, and a failed copy keeps the directory and binds nothing. The Machine protocol version increases, so release the hub and the daemon together.
