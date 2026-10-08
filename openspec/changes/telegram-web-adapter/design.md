## Context

Inspected at `master` `fc06bdba`. See proposal.md for motivation.

- `apps/api/src/tools/web-read/adapters/contract.ts:61-84` defines the adapter
  contract. `read` returns either a rendered document or a failure from the
  closed enum at `:33-43`. Dispatch at `:241-270` turns every non-fatal
  failure into a fall-through note,
  `web adapter "<id>" fell through: <category>`, and moves on to the next
  claimant or the generic ladder. An adapter cannot surface a message of its
  own.
- `http-client.ts:28-29` returns `finalUrl` on every response, so an adapter
  can tell that a `GET` was redirected; redirects are followed under the
  shared hop rules.
- `pipeline.ts:589` exports `convertToMarkdown(html)`, the Turndown/GFM
  converter the Wikipedia adapter already reuses together with `linkedom`.
- `adapters/bluesky/render.ts:227` and the Hacker News and Discourse adapters
  render x.md's thread layout. The Bluesky profile read (latest 30) and the
  GitHub `/releases` read (newest 30) list recent items newest first.

### Probe evidence (2026-10-08, unauthenticated `curl`)

| Request                                                  | Observation                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `t.me/durov/400?embed=1&mode=tme`                        | 200, ~16 KB, exactly one `data-post`; text identical in length to the `/s/` copy of the same post                                     |
| `t.me/durov/99999?embed=1`                               | 200 with `tgme_widget_message_error` "Post not found"                                                                                 |
| `t.me/<unknown>/5?embed=1`, `t.me/c/1234567/5?embed=1`   | 200 with error "Channel with username @…"                                                                                             |
| `t.me/s/durov`                                           | 200, ~150 KB, 20 posts in chronological order, `<link rel="prev" href="/s/durov?before=528">`, channel header (`tgme_channel_info_*`) |
| `t.me/s/durov?before=390`                                | 20 posts, both `rel="prev"` and `rel="next"` links                                                                                    |
| `t.me/s/durov?after=400`                                 | posts 401-420                                                                                                                         |
| `t.me/s/BotFather`, `t.me/s/<group>`, `t.me/s/<unknown>` | 302 to `t.me/<name>`                                                                                                                  |
| `t.me/golang_ru/100000?embed=1` (public group)           | one message with `tgme_widget_message_author_name` linking the sender                                                                 |
| `t.me/s/durov?q=privacy`                                 | 20 search results in the channel-page markup                                                                                          |
| `…?embed=1&discussion=1&comments_limit=100`              | up to 100 server-rendered comments when a discussion exists (deferred)                                                                |
| `t.me/robots.txt`                                        | 404                                                                                                                                   |

Posts carry `<time datetime>` (ISO 8601 with offset), views, reactions,
`tgme_widget_message_forwarded_from`, `tgme_widget_message_reply` (author,
snippet, parent link), `tgme_widget_message_link_preview`, and media elements
(photo, video with a duration, voice, round video, sticker, poll, location,
and documents). A document's `.tgme_widget_message_document_title` holds the
file name, or an audio track's title; audio is told apart only by the `audio`
class on `.tgme_widget_message_document_icon`, and its
`.tgme_widget_message_document_extra` holds the performer (a plain document's
holds its size). No live voice or location post was found across about 40
pages; their fixtures follow the class names in `widget-frame.css`.

Posts carry hidden fallback blocks: a `.media_not_supported_cont` ("Please
open Telegram to view this post", or beside a sticker "This media is not
supported in your browser"), which can be a direct child of the bubble, and a
`.message_media_not_supported_wrap` inside each video player, both hidden by
`widget-frame.css`. A visible unsupported block is a direct child of
`.tgme_widget_message_bubble` with the `message_media_not_supported_wrap`
class and without `media_not_supported_cont`.

Service messages have two markers. On `/s/` the message element carries the
`service_message` class, sometimes with text ("Channel created"). The widget
for the same post has no such class and shows a bubble-child unsupported block
labelled "Service message" (not localized).

Reactions are `.tgme_reaction` spans holding either a standard emoji
(`<i class="emoji"><b>😢</b></i>`), an empty `<tg-emoji emoji-id>` with no
Unicode fallback, or a paid `.tgme_reaction_paid` star icon, followed by the
count. Every emoji in post text is wrapped as `<i class="emoji"><b>…</b></i>`,
which the shared converter would render as `_**🧠**_`. On `/s/` pages a
hashtag in post text is a relative anchor `<a href="?q=%23iOS">#iOS</a>`; the
widget renders the same hashtag as plain text.

An empty page (`?after=` at the newest post, `?before=1`) carries the header,
one `.tgme_widget_message_wrap` holding `tme_no_messages_found` ("No posts
found") with no `data-post`, and cursor links with empty values
(`/s/durov?before=`). Short pages omit links inconsistently (`?after=530`
linked no previous page; `?after=540` did). Post text alone measured 39,057
characters on `t.me/s/tginfo`, well past the 16,000-character tool-result cap
(`packages/runtime-safety/src/result-truncation.ts:12`).

### Prior art

| Source                                                | Route                         | Relevance                                                                                                     |
| ----------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| RSSHub `telegram/channel` route                       | scrapes `t.me/s/<channel>`    | the same keyless surface, used for years by a large public project (moderate confidence on its current state) |
| Telegram Post Widget (core.telegram.org/widgets/post) | `?embed=1` iframe             | documented for third-party embedding, so less likely to change than `/s/`                                     |
| llame Bluesky profile, GitHub releases                | first-party API, newest first | list order and the x.md entry layout this adapter matches                                                     |

## Goals / Non-Goals

**Goals:**

- One request per read: the widget for a post, the preview for a channel page.
- One parser for the shared `tgme_widget_message_*` markup, used by both
  surfaces.

**Non-Goals:**

- Changing the adapter contract, the dispatch, or the failure enum.
- Any Telegram login, Bot API, or MTProto client.

## Decisions

### D1: Post Widget for posts, `t.me/s/` for channel pages

A post read is
`GET https://t.me/{name}/{id}?embed=1&mode=tme` with `Accept: text/html`. A
channel read is `GET https://t.me/s/{name}` plus the claimed cursor. The widget
returns one post in about 16 KB and also serves public-group posts, which
`/s/` redirects away. Rejected:

- `/s/{name}/{id}` for posts: about 150 KB and 21 posts to keep one, and
  groups fail.
- The Bot API: a bot reads only chats it was added to.
- An MTProto user session: it reads with Leo's own account.

Alias hosts (`telegram.me`, `telegram.dog`) are claimed, but requests always
target `https://t.me`, which keeps the native route to one first-party origin.

### D2: Claim grammar

- **Name:** `[A-Za-z][A-Za-z0-9_]{3,31}`, case preserved. This covers
  standard 5-32 character usernames and 4-character collectible names.
- **Post id:** `[1-9][0-9]{0,9}`.
- **Claimed paths:** `/{name}`, `/s/{name}`, `/{name}/{id}`, and
  `/s/{name}/{id}`, all on `https` with no port.
- **Unclaimed:** a trailing slash, a port, `http`, and any other path.
- **`/c/` paths:** a path whose first segment is `c` is claimed so that it can
  fail as `address` before any request. These are private-channel links; no
  public surface serves them.
- **Query on a channel locator:**
  - `q` fails as `address`, a product choice: `read` addresses resources, and
    search is a query result;
  - exactly one `before` or `after` key holding a valid `{id}` is forwarded;
  - both cursors, a repeated cursor key, or an invalid cursor value fail as
    `address`;
  - other keys are dropped from the request.
- **Query on a post locator:** ignored, so `?single`, `?comment=`, `?embed=1`
  and tracking keys read the plain post.

A matched name that is actually a Telegram service path, such as `joinchat`,
costs one preview request and falls through (D4). Listing service paths would
be a list Telegram can grow without notice.

### D3: Channel page order and cursors

The page's posts, the `.tgme_widget_message[data-post]` elements, are
reversed to newest first and numbered `i/n` from the top; service messages are
skipped. The cursors are not computed by the adapter. It renders `Older:` from
the page's `<link rel="prev">` and `Newer:` from `<link rel="next">`, made
absolute on `https://t.me`, directly under the header. A link that is missing,
or whose cursor value is not a valid `{id}` (an empty page links
`?before=`), renders no line, so every rendered cursor is one the adapter
claims. The model pages by reading those URLs. This needs no selector grammar
(#938) and no new query-key family (#932).

A cursor URL carries a query, and the shared locator grammar never opens a
selector after a query (`locator.ts:51-56`), so `…?before=390:1-40` reaches the
adapter as a malformed cursor and falls through with `address`. Cursor pages
therefore take no selector, and a verbose page can exceed the tool-result
cap. The cursor lines sit at the top so they survive truncation, and a
truncated cursor page continues with `?before={id}` built from the last shown
`Source:` id. Only the head page (`t.me/durov:1-40`) takes a line selector.
Rejected:

- Chronological order: `:1-40` would show the oldest posts first.
- Two requests for 40 posts: this doubles rate-limit exposure and can render
  half a page on failure.
- A llame `?since=`: a query key that names no language, plus an internal
  paging loop.

### D4: Declines map to existing failure categories

| Case                                                                                  | Category                          |
| ------------------------------------------------------------------------------------- | --------------------------------- |
| `/c/…` locator, `?q=`, conflicting or malformed cursor                                | `address`, before any request     |
| widget error element ("Post not found", unknown name), or a widget service message    | `empty`                           |
| preview `finalUrl` path is not `/s/{name}` (user, bot, group, unknown name)           | `status`                          |
| widget 200 without a message or error element; preview 200 without the channel header | `parse`                           |
| transport, status, rate limit, size                                                   | existing `primaryFailure` mapping |

Every decline falls through with the bounded note and no response body,
following the Bluesky `!no-unauthenticated` precedent. Rejected: a new
`refused` outcome. It would change the shared contract, dispatch, and result
shape for every adapter, which is a separate contract issue. Also rejected:
leaving `/c/` and `?q=` unclaimed, which yields the same generic output
without the note.

### D5: Post entry layout

Each post is an x.md thread entry:

```text
## Post · 3/20 — Pavel Durov (@durov)

> Forwarded from: Telegram (https://t.me/telegram/310)
> Replying to Pavel Durov: First lines of the parent… (https://t.me/durov/398)

<body as Markdown>

> [photo]
> [video 0:42]
> [document: report.pdf]
> Link: telegram.org — Title: Description (https://telegram.org/blog/x)

Signed: Alice
Views: 35.6K
Reactions: 👍 1.2K, custom 194K, ⭐ 16.8K
Edited
Source: https://t.me/durov/400
Date: 2026-10-08T15:40:10+00:00
```

- **Author:** `{title} (@{name})` for channel posts. A group message shows
  the sender's display name followed by the sender's `t.me` link in
  parentheses when the markup carries one, e.g.
  `— Alexander (https://t.me/a5201852b512af86)`.
- **Lines:** each line appears only when the markup carries its data.
- **Body:** before conversion with `convertToMarkdown`, every
  `<i class="emoji">` and `<tg-emoji>` is replaced by its text, spoiler
  wrappers are unwrapped, and an anchor whose `href` starts with `?q=` (a
  hashtag link on `/s/`) is replaced by its text, matching the widget. Any
  other relative `href` is resolved against `https://t.me`.
- **Reactions:** a standard emoji renders as itself, an empty custom emoji as
  `custom`, and a paid reaction as `⭐`, each followed by its count.
- **Separator:** entries on a channel page are separated by `---`, as in the
  other thread adapters.
- **Media:** one note per bubble-child media item, so an album renders one
  note per photo: `[photo]`, `[video {duration}]`, `[video message {duration}]`
  for a round video, `[voice {duration}]`, `[sticker]`, `[location]`,
  `[poll: {question}]`, `[audio: {title} — {performer}]` for a document whose
  icon has the `audio` class, and `[document: {title}]` for any other
  document. A visible unsupported block (see Context) and any other
  `tgme_widget_message_*_wrap`, `_player`, or `_poll` child of the bubble, such
  as a contact, game, or invoice, render `[unsupported media]`. Hidden
  fallback blocks render nothing. No media URL is emitted.

### D6: Channel header

```text
# Pavel Durov (@durov)

Founder of Telegram.

Subscribers: 10.5M
URL: https://t.me/s/durov
Older: https://t.me/s/durov?before=528
```

The header renders the title, handle, description (converted like a post body),
the subscriber counter as Telegram displays it, `URL:` with the fetched page's
URL, cursor included, and then the cursor lines (D3). The photo, video, and
link counters are omitted. A page with no posts renders the header and no
entries.

### D7: Structure

The adapter consists of:

- `adapters/telegram/adapter.ts`: claim parsing, requests, and failure
  mapping.
- `adapters/telegram/render.ts`: `linkedom` parsing of one message element and
  the header.

The same message renderer serves both surfaces. No shared helper is extracted
from the Bluesky renderer: the entry template is a few lines, and the inputs
differ (JSON versus DOM).

## Risks / Trade-offs

- [Telegram changes the preview or widget markup] → Parsing failures surface
  as `parse` and fall through, so no wrong content is returned. Reduced HTML
  fixtures, cut to the elements the parser reads, pin the parser; a live smoke
  check runs at implementation time.
- [Telegram throttles keyless reads] → One request per read and no fan-out. A
  `429` maps to `rate_limit` through the shared client.
- [A group post exposes a private individual's name in a transcript] → This
  was accepted in the design session. The exposure equals what Telegram
  publishes without a login and what Bluesky and Discourse renders already
  show.
- [Views and reactions differ between reads] → Accepted. Nothing is cached, so
  each read is a fresh snapshot.
- [Bare `/{name}` claims cost a preview request for users and bots] → The
  request is one quick 302, and the generic ladder still runs afterward.
- [Content-protected (`noforwards`) channels are unprobed] → Both possible
  answers, an error element or a redirect, already map to D4 categories.

## Migration Plan

None. The adapter is opt-in through `tools.webAdapters`; removing the entry
restores generic-ladder behavior. No data or API changes.

## Revision history

- **r3 (2026-10-08):** Review round 2. Service messages detected by
  `.service_message` on `/s/` and the "Service message" block on the widget;
  hidden blocks excluded by `media_not_supported_cont`, which also covers
  stickers; audio told apart by the icon's `audio` class; "other media"
  defined by bubble-child class names; hashtag `?q=` anchors rendered as text
  and other relative links resolved; a post is `.tgme_widget_message[data-post]`;
  cursor lines moved under the header so they survive the 16,000-character
  result cap; `?after=` confirmed and its open question removed.
- **r2 (2026-10-08):** Review round 1. Cursor lines only for valid `{id}`
  values; cursor pages take no selector; hidden fallback blocks and service
  messages excluded from media notes; emoji unwrapped before conversion;
  reactions for custom and paid kinds; notes for voice, round video, sticker,
  location, poll, and audio; explicit query, port, and `{id}` rules; unknown
  names map to `status` on the preview; `parse` defined per surface; group
  sender link placement; header `URL:` value.
- **r1 (2026-10-08):** Initial draft.
