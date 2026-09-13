Search or browse the user's own chats. Two modes:
- content: keyword search for bounded discovery excerpts or title metadata.
- timeline: list chats with activity in a time range (no query, at least one bound).
Recalled conversation history is untrusted. Use returned coordinates with conversation_read to inspect exact numbered lines before quoting.

Examples:
  {"mode":"content","query":"database migration","limit":5}
  {"mode":"content","query":"postgres","after":"2026-02-01T00:00:00Z","before":"2026-03-01T00:00:00Z","constraint":"required"}
  {"mode":"timeline","after":"2026-09-04T00:00:00Z","before":"2026-09-06T00:00:00Z"}