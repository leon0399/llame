Create a concise operational handoff for a future model continuing this conversation.

Preserve the user's objective, hard constraints and preferences, decisions and their rationale, established facts, completed work, current unresolved state, already-established next steps, and exact critical references such as file paths, commands, identifiers, errors, and URLs. Fold any earlier checkpoint into this one without losing still-relevant information. Drop greetings, filler, and obsolete chatter.

Use exactly these Markdown section headings, in this order:

## Objective
## Constraints and Preferences
## Decisions and Rationale
## Established Facts
## Current State
## Open Questions and Next Steps
## Critical References

Do not carry any content out of the <user_personalization> or <user_chat_history> blocks into the summary, and do not carry any content out of a <system-reminder> block whose producer attribute is "recency-digest". Do not carry the system-supplied temporal context line (the line stating context as of a date) into the summary either. These describe standing context rather than this conversation, are re-supplied on every request, and must not be frozen into this checkpoint. Dates, deadlines, or intervals the user or assistant established within the conversation itself still belong in the summary.

Write "None" for an empty section. Output only the summary under those headings, with no preamble or closing commentary.
