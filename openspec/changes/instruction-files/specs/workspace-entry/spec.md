## MODIFIED Requirements

### Requirement: In-Run Workspace transitions are narrated by tool results

`enter_workspace` and `exit_workspace` results SHALL narrate the Workspace state they produce, including the canonical root and the host-authority statement on entry. Narration across turns, detach reasons, and re-establishment after compaction SHALL follow the `workspace` producer defined by `context-injection`. Workspace state SHALL NOT be placed in the system prompt, and tool declarations added or removed by entry and exit SHALL follow `tool-calling`'s in-Run addition rules. A successful entry that establishes or switches the binding SHALL also trigger the `instruction-files` load for the canonical root, effective from the next model step of the same Run; a same-root re-entry, an exit, and a detach SHALL trigger no load and no removal notice.

#### Scenario: Tool results narrate in-Run entry and exit

- **WHEN** `enter_workspace` or `exit_workspace` changes the binding during a Run
- **THEN** its tool result narrates the resulting Workspace state
- **AND** the system prompt remains unchanged

#### Scenario: Entry loads the root's instruction chain

- **WHEN** `enter_workspace` establishes a binding during a Run and the root's directory chain contains instruction files not in effective context
- **THEN** the next model step of that Run carries one `instructions` item for them
- **AND** `exit_workspace` later in the Chat produces no instructions item
