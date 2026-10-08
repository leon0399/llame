## MODIFIED Requirements

### Requirement: Web adapter contract is ordered, admitted, and fallible

The web adapter plane SHALL be a static, code-owned ordered list selected by
`tools.webAdapters`; an absent setting SHALL enable no adapter. Every entry
SHALL provide a pure synchronous `match` over the canonical source URL, a
stable `id`, and one route kind, `native` or `rewrite`. A native route SHALL
contact only fixed first-party origins; a rewrite route SHALL contact only its
operator-declared target origin. Matching SHALL occur only after the source
locator passes the submitted and normalized `read` permission checks and
SHALL precede the generic ladder. A URL an adapter's `match` accepts is
claimed by that adapter; a URL every `match` rejects is unclaimed and SHALL
reach the generic ladder with no adapter request and no note. `:raw` SHALL
bypass every adapter; `:outline` SHALL NOT, and is applied to the claiming
adapter's rendered document.

Every request an adapter derives SHALL pass the same `read`-group admission,
address resolution and pinning, 10-second header bound, 30-second call bound,
5 MiB per-response body bound, and redirect rules as the generic web path.
An adapter request is a `GET` unless the adapter supplies a body, for a GraphQL
or similar API; such a request SHALL be a `POST` of that body with its
`Content-Type`, admitted like any adapter request, and SHALL follow no
redirect: a 3xx answer SHALL fail it as `http_status`.
There SHALL be no adapter request-count cap; the rendered adapter document
SHALL be bounded at 5 MiB. The GitHub `token` SHALL be the only adapter
credential, and the Bluesky, npm, Hugging Face, arXiv, Stack Exchange,
crates.io, Hacker News, DOI, Discourse, dev.to, Substack, OSV, Wikipedia,
and Telegram adapters SHALL send none; the GitHub token SHALL be
sent only to `https://api.github.com` and SHALL be
removed before any cross-origin hop. An adapter SHALL never widen the source
permission or bypass address admission.

A claimed URL whose primary request is refused before I/O, answers a non-2xx
status, is rate-limited, cannot be parsed, or renders empty SHALL yield a
bounded note naming the adapter and one failure category — `permission`,
`address`, `status`, `rate_limit`, `transport`, `parse`, `empty`, `binary`,
`too_large`, or `content_type` — and SHALL fall through to the next claiming
adapter, then the generic ladder. A claimed URL whose primary request
succeeded and whose later request for the same document fails, or whose call
deadline or document bound is reached, SHALL render the content that arrived
and attach one note per missing section naming its category. A spent shared
call bound or caller abort before the primary request SHALL end the call
under the existing web contract. A native permission error on the submitted
source request chain SHALL end the call; a permission error on an adapter
chain SHALL disqualify only that adapter. Adapter failures SHALL NOT return a
response body to the model. A successful adapter SHALL use the result
provenance requirement, including the source URL as `finalUrl`. A rendered
adapter outcome SHALL declare the media type of its document so the
representation requirements can decide whether a member applies: the GitHub
adapter labels its issue, pull request, repository, and commit renders
`text/markdown` and a decoded blob by the same extension table the file
sources use; the Bluesky, npm, Hugging Face, Stack Exchange, crates.io,
Hacker News, DOI, Discourse, dev.to, Substack, OSV, Wikipedia, and Telegram
adapters label their renders `text/markdown` and the arXiv adapter forwards its converter's label; a rewrite
adapter forwards the media type its inner render
reports. The label is internal and SHALL NOT be returned as a result field. A successful
adapter MAY return a directory read instead of text; it SHALL be rendered
through the host directory-read path with the call's selector and result
budget, and whatever that path returns, including the host's
`directory_too_large` refusal, SHALL be the call's result with no adapter
note and no fall-through.

#### Scenario: Matching does no network work

- **WHEN** a canonical `github.com` issue URL is passed to the adapter list
- **THEN** the GitHub adapter claims it from URL shape alone
- **AND** no request occurs before the derived API locator is admitted

#### Scenario: An unclaimed URL is untouched

- **WHEN** no configured adapter's `match` accepts the admitted source URL
- **THEN** the generic ladder runs exactly as it does without adapters
- **AND** the result carries no adapter note and no `adapter` object

#### Scenario: A rejected adapter request falls through

- **WHEN** a claimed adapter derives `https://api.github.com/repos/o/r/issues/1`
- **AND** the `read` group rejects that API origin
- **THEN** no request is issued to `api.github.com`
- **AND** a note names the adapter and `permission`, after which the generic ladder may run

#### Scenario: A status or parse failure falls through without its body

- **WHEN** a claimed adapter's primary request answers a non-2xx status, a recognized rate limit, malformed data, or an empty render
- **THEN** the response body is not returned to the model
- **AND** the adapter records a bounded failure note and the next candidate may render the source

#### Scenario: A secondary request failure renders partial content with a note

- **WHEN** an adapter's primary request succeeded and a later request for the same document fails or the call deadline is reached
- **THEN** the content that arrived is rendered
- **AND** each missing section carries one omission note naming its category

#### Scenario: Raw mode skips all adapters

- **WHEN** a source URL is claimed by a configured adapter and the selector is `:raw`
- **THEN** no adapter request is issued
- **AND** the final response body follows the generic raw contract

#### Scenario: A directory result follows the host directory path

- **WHEN** an adapter succeeds with a directory read whose requested level
  exceeds the host per-directory entry budget
- **THEN** the call returns the host's `directory_too_large` refusal
- **AND** no adapter note is added and the generic ladder does not run

#### Scenario: A rewrite result identifies its origin

- **WHEN** a rewrite adapter succeeds through its declared origin
- **THEN** the result preserves the source URL as `finalUrl`
- **AND** `method: "adapter"`, an adapter object with route `rewrite` and that origin, and a provenance note identify it

#### Scenario: An adapter document carries its media type

- **WHEN** the GitHub adapter renders `https://github.com/o/r/issues/1`
- **THEN** its document is labeled `text/markdown` and `:outline` applies to that rendered document with `method: "adapter"` and the `adapter` object retained
- **AND** a decoded `data.json` blob is labeled by its extension, so `:outline` on it fails with `invalid_selector` naming the member's accepted media types

## ADDED Requirements

### Requirement: Telegram native adapter claims public post and channel locators

A configured `telegram` adapter SHALL claim only `https` locators without a
port on `t.me`, `telegram.me`, or `telegram.dog` whose path is `/{name}`,
`/s/{name}`, `/{name}/{id}`, `/s/{name}/{id}`, or starts with `/c/`, where
`{name}` matches `[A-Za-z][A-Za-z0-9_]{3,31}` and `{id}` matches
`[1-9][0-9]{0,9}`. It SHALL issue at most one unauthenticated `GET` per read,
always to `https://t.me`. A query SHALL NOT change a post read.

#### Scenario: A post is read through the Post Widget

- **WHEN** the model reads `https://telegram.me/durov/400?single`
- **THEN** the adapter requests only `https://t.me/durov/400?embed=1&mode=tme` with `Accept: text/html`
- **AND** a query key on a post locator does not change the request

#### Scenario: A channel is read through the web preview with Telegram's cursor

- **WHEN** the model reads `https://t.me/durov`, `https://t.me/s/durov?utm_source=x`, or `https://t.me/s/durov?before=390`
- **THEN** the adapter requests only `https://t.me/s/durov`, or `https://t.me/s/durov?before=390` for the cursor locator
- **AND** exactly one `before` or `after` key holding a valid `{id}` is forwarded and every other key except `q` is dropped from the request

#### Scenario: Private links, search, and malformed cursors are declined before I/O

- **WHEN** the model reads `https://t.me/c/1234567/5`, `https://t.me/s/durov?q=privacy`, `https://t.me/s/durov?before=1&after=2`, `https://t.me/s/durov?before=1&before=2`, `https://t.me/s/durov?before=0`, or `https://t.me/s/durov?before=390:1-40`
- **THEN** the adapter issues no request
- **AND** it falls through with `address`

#### Scenario: A missing post falls through as empty

- **WHEN** the Post Widget answers with its error element, such as "Post not found" or an unknown name, or with a service message
- **THEN** the adapter falls through with `empty` and returns no response body

#### Scenario: A name without a public channel preview falls through as status

- **WHEN** the model reads `https://t.me/BotFather`, a public group, or an unknown name, and the preview request is redirected to a URL whose path is not `/s/{name}`
- **THEN** the adapter falls through with `status`
- **AND** the generic ladder may render the source

#### Scenario: A response without the expected markup falls through as parse

- **WHEN** the Post Widget answers 200 with neither a message nor an error element, or the preview answers 200 at `/s/{name}` without the channel header
- **THEN** the adapter falls through with `parse`

#### Scenario: Other shapes are unclaimed

- **WHEN** the model reads `http://t.me/durov/400`, `https://t.me:8443/durov`, `https://t.me/durov/400/`, `https://t.me/joinchat/AbCdEf`, or `https://t.me/durov/0400`
- **THEN** the adapter does not claim it and issues no request

### Requirement: Telegram native adapter renders a post as a thread entry

Each post SHALL render as one x.md entry headed `## Post · {i}/{n} — {author}`,
with lines only for data the markup carries: `Forwarded from:` and the reply
snippet with its parent link, the text as Markdown, one blockquoted note per
visible media item naming its type with no media URL, the full link-preview
card, then `Signed:`, `Views:`, `Reactions:`, `Edited`, `Source:` with the
post's `https://t.me` URL, and `Date:`. A reply's parent SHALL NOT be fetched.

#### Scenario: A channel post renders with its metadata

- **WHEN** the model reads a channel post that has views, reactions, and a photo
- **THEN** the text is one `## Post · 1/1 — {title} (@{name})` entry with a `> [photo]` note and no `telesco.pe` URL
- **AND** it ends with `Views:`, `Reactions:`, `Source: https://t.me/{name}/{id}`, and `Date:` in ISO 8601

#### Scenario: Emoji and reactions render as text

- **WHEN** the post text wraps emoji in Telegram's emoji elements and the post has standard, custom-emoji, and paid reactions
- **THEN** each emoji in the text renders bare, without Markdown emphasis
- **AND** the `Reactions:` line renders the standard emoji, `custom`, and `⭐`, each followed by its count

#### Scenario: A forwarded reply renders its origin and snippet

- **WHEN** the post is a forward that also replies to another post
- **THEN** the entry carries `> Forwarded from:` with the origin's name and link and `> Replying to {author}:` with the snippet and parent URL
- **AND** only the Post Widget request is issued

#### Scenario: A public-group post names its sender

- **WHEN** the model reads a message in a public group whose sender has a `t.me` link
- **THEN** the entry heading is `## Post · 1/1 — {display name} ({sender t.me URL})`

#### Scenario: Media notes name type and detail

- **WHEN** the post carries an album of two photos, a video, a round video, a voice message, a sticker, a location, a poll, an audio file, a document, and a visible unsupported-media block
- **THEN** the entry has two `> [photo]` notes, `> [video {duration}]`, `> [video message {duration}]`, `> [voice {duration}]`, `> [sticker]`, `> [location]`, `> [poll: {question}]`, `> [audio: {title} — {performer}]`, `> [document: {file name}]`, and `> [unsupported media]`

#### Scenario: Hidden fallback blocks render nothing

- **WHEN** a supported post carries Telegram's hidden "Please open Telegram to view this post" block and a video player's hidden unsupported-media block
- **THEN** the entry has no `[unsupported media]` note

#### Scenario: A link preview card renders in full

- **WHEN** the post carries a link-preview card
- **THEN** the entry has one `> Link:` line with the card's site name, title, description, and URL

### Requirement: Telegram native adapter renders a channel page newest first

A channel locator SHALL render `# {title} (@{name})`, the description,
`Subscribers:`, and `URL:` with the fetched page URL, then that page's posts
newest first as thread entries separated by `---`, skipping service messages,
then `Older:` and `Newer:` lines with the absolute `https://t.me/s/...` URLs
of Telegram's previous and next page links, each only when its cursor value is
a valid `{id}`. A read SHALL fetch one page.

#### Scenario: The newest page lists recent posts first with an older cursor

- **WHEN** the model reads `https://t.me/durov` and Telegram serves 20 posts with a previous-page link only
- **THEN** the text starts with the channel header, `## Post · 1/20` is the newest post, and `## Post · 20/20` the oldest
- **AND** it ends with `Older: https://t.me/s/durov?before={id}` and has no `Newer:` line

#### Scenario: Reading the older cursor returns the preceding page

- **WHEN** the model reads the `Older:` URL from a previous result
- **THEN** the adapter requests that page only and renders it with both `Older:` and `Newer:` lines when Telegram links both

#### Scenario: An empty page renders the header without dead cursors

- **WHEN** the preview serves the channel header, no posts, and a page link whose cursor value is empty, such as `/s/durov?before=`
- **THEN** the text is the header with no entries and no cursor line
