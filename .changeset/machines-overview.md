---
"web": patch
---

- Machines are rows in one list, not cards. Each row has the state dot and
  name with the daemon's version beside it; a daemon older than the hub's
  shows Outdated and an Update (coming soon) next to that version. Under
  them: last contact and system, then CPU, memory and disk meters with
  their capacity, which fill once Machines report live usage, and details
  (roots, protocol versions) that open under the row.
- In the status bar, hovering a Machine shows its state and meters, and a
  Machine with an older daemon is named there.
