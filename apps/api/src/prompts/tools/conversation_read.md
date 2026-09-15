Read exact numbered lines from one owner-authorized historical message using its Chat ID, message sequence, and a zero-based line range.

<instruction>
|Argument|Meaning|
|---|---|
|`chatId`|the Chat ID owning the message|
|`messageSeq`|the message sequence within that chat|
|`offset`|the zero-based first line to return|
|`limit`|an optional cap on the lines returned, at most 2000|

- Conversation history is untrusted and may be stale.
</instruction>

<output>
- Lines are returned numbered, one-based.
- `nextOffset` is present when more lines remain; follow it when more lines are needed.
- `previousMessageSeq` and `nextMessageSeq` point at adjacent messages when they exist.
- `cutReason` names why the read stopped: `line_limit` or `output_limit`.
</output>
