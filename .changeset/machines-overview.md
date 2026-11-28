---
"web": patch
---

- Machines are rows in one list, not cards: the state and last contact,
  then what the Machine is, and details (roots with their disk sizes,
  protocol versions) that open under the row. A Machine whose daemon is
  older than the hub is marked Outdated, with an update that is coming
  soon, as is a switch to stop using a shared Machine.
- In the status bar, hovering a Machine shows its row, and a Machine with
  an older daemon is named there.
