## ADDED Requirements

### Requirement: The MCP usage rank is a frozen chat baseline with no rendered contribution

The MCP usage rank that `tool-calling` uses to choose declared MCP tools SHALL be frozen per
compaction epoch and stored on the chat. It SHALL have no rendered contribution and no rail
deltas: it changes which admitted tools a request declares, never the system prompt or any
context item. It SHALL be an ordered list of at most 256 MCP tool ids resolved
for the chat's owner from that owner's committed assistant message parts, under the owner's
authenticated identity and datastore isolation, and SHALL never read another owner's rows.

A use SHALL be a stored tool part whose tool id is an MCP id and whose structured outcome is
`success`; refused, unavailable, hallucinated, failed, and cancelled calls SHALL NOT count. The
resolution SHALL consider only assistant messages created within the 90 days before resolution
and at most the 2,000 most recent of them, across all of the owner's chats. Each assistant
message containing at least one use of a tool SHALL contribute `0.5^(age / 14 days)` to that
tool's score, where `age` is the time from the message's creation to resolution, so repeated uses
within one message count once and a use loses half its weight every 14 days. The list SHALL
contain every tool with at least one counted use, ordered by score descending, then by most
recent use descending, then by id.

Uses SHALL be counted by tool id regardless of whether an operator or a Workspace server served
them. The rank SHALL be persisted on the chat row under owner isolation together with the
compaction identity under which it was resolved. Attempt
preparation SHALL reuse the stored rank only when one is persisted and its recorded identity
equals the chat's latest compaction identity; otherwise, when the attempt's admitted catalog
contains an MCP tool, it SHALL resolve a new rank, and only the attempt that completes the Run
SHALL persist it, in its fenced terminal transaction. An attempt whose admitted catalog contains
no MCP tool SHALL neither resolve nor persist a rank. An owner fork SHALL copy the rank and remap
its compaction identity the way it remaps the skill-catalog marker. The rank SHALL NOT be
rendered into the system prompt or any context item.

#### Scenario: The rank is frozen within an epoch

- **WHEN** the owner uses an MCP tool in another chat between two user turns of this chat with no compaction between them
- **THEN** the second turn's attempt reuses the stored rank unchanged
- **AND** its declared MCP tools are the same as the first turn's for the same model and admitted catalog

#### Scenario: Compaction resolves a new rank

- **WHEN** a chat is compacted after the owner started using a new MCP tool
- **THEN** the next attempt that admits an MCP tool resolves a rank that includes that tool

#### Scenario: Only successful uses count

- **WHEN** an owner's history contains refused and failed calls to a tool and no successful call
- **THEN** that tool is absent from the rank

#### Scenario: A Run's repeated calls count once

- **WHEN** on the same day one completed Run called tool A thirty times and two other Runs each called tool B once
- **THEN** tool B ranks above tool A

#### Scenario: Recent use outweighs older use

- **WHEN** tool A was used in two Runs 28 days before resolution and tool B in one Run today
- **THEN** tool B ranks above tool A, because each of A's uses weighs one quarter of B's

#### Scenario: Uses beyond the horizon do not count

- **WHEN** an owner's only successful use of a tool is older than 90 days at resolution
- **THEN** that tool is absent from the new rank

#### Scenario: Another owner's usage never enters the rank

- **WHEN** owner B calls an operator MCP tool that owner A has never used
- **THEN** owner A's resolved rank does not contain that tool
- **AND** supplying owner B's identifier to the resolution does not authorize reading owner B's messages

#### Scenario: A fork keeps its source's rank

- **WHEN** an owner forks a chat with a stored rank
- **THEN** the fork's rank equals the source's and its compaction identity names the copied checkpoint

#### Scenario: A failed attempt does not freeze its rank

- **WHEN** an attempt resolves a rank and then fails, and a retry attempt completes the Run
- **THEN** the persisted rank is the one the completing attempt resolved

#### Scenario: A Workspace tool's uses rank by id

- **WHEN** the owner's successful uses of `mcp__playwright__browser_click` were served by a Workspace server in another chat
- **THEN** the id appears in this chat's rank
- **AND** it is declared here only when this attempt admits that id
