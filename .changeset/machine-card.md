---
"web": patch
---

- Machines are rows in one list. Each row has the state dot and name, with
  its actions at the end: Update for a daemon older than the hub's, and a
  switch to stop using a shared Machine (both coming soon). Under them: last
  contact, system and daemon version ("outdated" when older), then CPU,
  memory and disk meters with their capacity, which fill once Machines
  report live usage, and details (roots, protocol versions) that open under
  the row. The Machines settings page separates the operator's shared
  Machines from the owner's own, which are coming soon, and says so when an
  instance has none.
- In the status bar, hovering a Machine shows its state and meters, and a
  Machine with an older daemon is named there.
