# Export a chat as Markdown

## Objective

llame has no data-portability escape hatch: you can SHARE a chat (public link),
RENAME, DELETE, or FORK it, but you can't TAKE it with you. Export a chat as a
downloaded `.md` file — "own your data," a genuine self-hosted value, completing
the chat-management suite. Client-only, vitest-validatable, no backend/schema.

## Design

- Pure `lib/services/chat/chat-markdown.ts` (imports only `modelDisplayName`
  relatively + a type from `history` — so vitest loads it standalone):
  `chatToMarkdown(title, messages: ChatMessageResponse[]) → string`. Each
  user/assistant turn → a `**You**` / `**Assistant** · <ModelName>` heading + its
  concatenated text parts; a reasoning part → a `> _Reasoning:_ …` blockquote;
  SYSTEM and TOOL rows are skipped (not user-facing conversation). The model name
  comes from `usage.model` via `modelDisplayName`. Headings separated by `---`.
- `lib/services/chat/export.ts`: `exportChatAsMarkdown(chatId, title)` fetches the
  chat's FULL history (`GET /chats/:id/messages`, owner-scoped) and renders via
  `chatToMarkdown`, then downloads via `downloadTextFile` (`Blob` + a transient
  `<a download>`, `window`-guarded, object-URL revoked). Filename = slugified
  title + `.md`. IMPORTANT: the endpoint DEFAULTS to the latest 100 messages (caps
  at 200), so a no-limit fetch would silently truncate a long chat — the export
  PAGINATES with the `beforeSeq` cursor (page size 100, always ≤ the api max) and
  prepends older pages, so the whole conversation is captured.
- UI: an "Export as Markdown" `DropdownMenuItem` in the sidebar per-chat menu
  (`app-sidebar-chat-history.tsx`), alongside Share / Rename / Delete.

## Testability

- `chatToMarkdown` (unit): a user+assistant turn renders the two headings + text;
  the assistant heading includes the model name from `usage.model`; a reasoning
  part → a `> _Reasoning:_` blockquote; system/tool rows are skipped; an empty
  message list → just the `# title`.
- A pure `slugifyTitle(title)` → filename-safe slug (unit): spaces→`-`, strips
  unsafe chars, non-empty fallback.

## Non-goals (named)

- Exporting tool-call payloads / attachments — text + reasoning only (the readable
  conversation). Other formats (JSON, PDF) — Markdown first. Server-side or bulk
  (all-chats) export — client-side, per-chat. Exporting a chat you don't own (the
  history endpoint is owner-scoped → nothing to render).

## Revision history

- **v2 (2026-07-03):** Round-1 review (single reviewer, low-risk feature).
  Fixes: (P0) the history endpoint DEFAULTS to the latest 100 messages (the DTO
  `limit` default is applied by the transforming `ValidationPipe`), so the no-limit
  export silently truncated long chats — now PAGINATES via `beforeSeq` until the
  chat start; the earlier "history loads unbounded → export is complete" non-goal
  was factually wrong and is removed. (P1) multiple text parts in one turn (around
  a tool call) were joined with `""` → run-on prose; now `"\n\n"`. (P2) a newline
  in the title broke the `# ` heading; now collapsed.
- **v1 (2026-07-03):** Initial.
