---
status: proposed
---

# Project context binds when a Run starts execution

A message can wait in the queue while its owner moves the Chat or edits its
Project instructions. We resolve Project context when the worker prepares the
Run, so the agent starts with the current Project state. After the first
dispatch, that selection stays fixed through steps, segments, recovery, and
compaction.

## Considered options

Capture the Project when the owner sends the message. This preserves send-time
intent, but a delayed Run can start with instructions that no longer describe
the Project.

Read current Project state at every model step or worker recovery. This keeps
the newest text, but one Run can perform its first edit under one policy and
finish the same work under another. The owner chose one selection per Run.

## Consequences

A later Run resolves current state again, including Continue and Regenerate.
An explicit Project detail read also returns current stored text. That read
does not replace the guidance already selected for the Run.

Compaction restores the selected guidance during a live Run. It must not adopt
an intervening Project edit. Earlier private context still records what the
model received, even after the owner clears instructions or deletes the Project.

The [Project discovery design](../../openspec/changes/project-discovery/design.md)
defines recovery and the proposed delivery boundary. The owner confirmed the
execution-time choice and the fixed-within-Run consequence on 2026-11-20.
