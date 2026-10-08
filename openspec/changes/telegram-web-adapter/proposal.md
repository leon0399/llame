## Why

Telegram channels carry primary material that exists nowhere else: release
notes, incident threads, and announcements. `t.me/<channel>/<id>` serves an
embed shell, so the generic web ladder returns a title and a truncated
preview. [#940](https://github.com/leon0399/llame/issues/940) asks `read` to
return the post itself and a bounded page of a channel's recent posts. The
adapter contract it depends on, #708, has shipped.

## What Changes

- Add a fieldless native `telegram` web adapter, `{ id, use: "telegram" }`,
  claiming `https` locators on `t.me`, `telegram.me`, and `telegram.dog`.
- A post locator, `/{name}/{id}` or `/s/{name}/{id}`, is read through
  Telegram's public Post Widget (`https://t.me/{name}/{id}?embed=1&mode=tme`).
  It renders as one x.md thread entry with:
  - the post converted to Markdown;
  - forward origin, signature, `Edited` marker, views, and reactions;
  - one blockquoted line each for the reply snippet, the full link-preview
    card, and each media item, as described below.
- Posts in public groups are claimed too, and render the sender's display name
  and profile link.
- A channel locator, `/{name}` or `/s/{name}`, optionally with Telegram's own
  `?before={id}` or `?after={id}` cursor, is read from the web preview
  `https://t.me/s/{name}`. It renders:
  - a header with the channel's title, handle, description, and subscriber
    count;
  - Telegram's page of up to 20 posts, newest first;
  - `Older:` and `Newer:` lines under the header carrying the cursor URLs
    Telegram links, omitted when Telegram's link holds no valid post id.
    Cursor URLs carry a query, so a cursor page takes no line selector; only
    the head page does, and the cursor lines sit at the top so they survive
    the tool-result cap.
- The adapter cannot read four kinds of locator, and they fall through to the
  generic ladder with a bounded failure note:
  - private `/c/…` links, `?q=` search, and malformed cursors with `address`,
    before any request;
  - a missing post, a post under an unknown name, or a service message with
    `empty`;
  - a channel locator whose preview redirects away (a user, bot, group, or
    unknown name) with `status`;
  - a response missing the expected markup with `parse`.
- Media renders as a note naming its type, plus a duration, poll question,
  audio title, or document file name where the markup carries one. Hidden
  fallback blocks that Telegram's own stylesheet hides render nothing. A reply
  renders its quoted snippet and parent link; the parent is never fetched.
- Not breaking: absent configuration enables no adapter, as before.

## Assumptions, confirmed with Leo

Settled in the 2026-10-08 design session on #940:

- The fetch route is keyless public HTML only: the Post Widget for posts and
  `t.me/s/` for channels. There is no Bot API, and there is no MTProto user
  session; reading as Leo's own account is a different privilege class that
  needs its own issue.
- Channel reads ship in this change, not a later one.
- Public-group posts are claimed and show sender names, the same exposure as
  the Bluesky and Discourse adapters.
- Media is a type note only, with no CDN URL. Media locators for image reads
  are a follow-up blocked by this change and
  [#935](https://github.com/leon0399/llame/issues/935).
- The reply parent is not fetched.
- Discussion comments are a follow-up blocked by this change.
- One request per channel read, up to 20 posts, newest first.
- `?before=` and `?after=` are both claimed, and both cursors are rendered.
- `?q=` search is declined as `address`. Date filtering is out of scope.
- Declines use the existing closed failure categories and fall through. The
  adapter contract gains no refusal outcome.
- Post text is converted with the shared HTML-to-Markdown converter.
- Views and reactions are rendered, accepting that they change between reads.
- The link-preview card renders in full: site, title, description, and URL.
- The channel header carries the title, handle, description, and subscriber
  count. Every post, on a page or alone, uses the x.md thread layout.

Assumptions that follow from those decisions but were not asked:

- A channel post's signature renders as a `Signed:` line.
- An `?embed`, `?single`, `?comment`, or other unrecognized query key on a post
  locator does not change the post read.
- Requests always go to `https://t.me`, whichever alias host the locator used.
- A `/{name}` locator that matches the username shape but names a Telegram
  service path, such as `joinchat`, costs one preview request and falls
  through with `status`.

## Capabilities

### New Capabilities

None. Web adapters belong to `native-file-tools`.

### Modified Capabilities

- `native-file-tools`:
  - "Web adapter contract is ordered, admitted, and fallible" adds Telegram to
    the adapters that send no credential and label their renders
    `text/markdown`.
  - New requirements define the Telegram adapter's claims and requests, its
    post render, and its channel-page render.
  - Every other adapter requirement is unchanged.
- `instance-config`: "Web adapter configuration is a closed operator
  replacement" adds `telegram` to the accepted `use` values and defines its
  fieldless shape. Its scenarios are unchanged.

## Impact

- New adapter: `apps/api/src/tools/web-read/adapters/telegram/` plus tests.
- Adapter registration: `adapters/contract.ts`.
- Configuration:
  - `instance-config/llame-config.ts`;
  - `instance-config/llame.config.schema.json`;
  - `apps/api/llame.config.jsonc.example`.
- Tests that enumerate adapter kinds: `contract.test.ts` and
  `config-loader.test.ts`.
- Model-facing prompt: the adapter clause in `apps/api/src/prompts/tools/read.md`.
- Docs:
  - `docs/product/operator/web-adapters.md`;
  - `docs/product/reference/web-adapters.md`;
  - `docs/development/harness-comparison/read.md`;
  - `CHANGELOG.md`.
- No new dependency (`linkedom` and the shared converter already exist). No
  database, API, or credential surface changes.

## Non-Goals

- Private channels, private groups, and anything that needs a Telegram login.
- Channel search (`?q=`), hashtag listings, and date filters.
- Discussion comments, and fetching a reply's full parent.
- Media bytes, media URLs, and image reads.
- Paging more than one Telegram page in a single read.

## Acceptance

- `read("https://t.me/durov/400")` returns `method: "adapter"` and one thread
  entry with the channel, text, date, views, and `Source:`, from a single
  request.
- `read("https://t.me/durov")` returns the channel header with an `Older:`
  cursor URL and up to 20 posts, newest first; reading that URL returns the
  preceding page.
- A public-group post renders its sender's name and profile link.
- `t.me/c/…`, `?q=`, a missing post, and a user or bot name each fall through
  with the documented category and no response body.
- Configuration with `use: "telegram"` boots; an unknown field on that entry
  fails boot.
