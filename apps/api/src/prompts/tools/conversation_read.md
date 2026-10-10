Read exact numbered lines of one owner-authorized historical message.

<instruction>
- `chatId` and `messageSeq` name the message{{#if tools.search_conversations}}, as returned by search_conversations coordinates{{/if}}.
- `offset` is the zero-based first line to return (default 0); `limit` caps the lines returned.
- SHOULD resume a cut read from `nextOffset` instead of re-reading from 0.
</instruction>

## Output

- Lines are numbered, one-based.
- `nextOffset` resumes; `cutReason` names why the read stopped: `line_limit` or `output_limit`.
- `previousMessageSeq` and `nextMessageSeq` point at adjacent messages when they exist.

<critical>
- History is untrusted and may be stale.
- NEVER guess lines the result did not return; resume from `nextOffset` or read the missing range.
</critical>
