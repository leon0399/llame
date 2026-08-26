## MODIFIED Requirements

### Requirement: The digest carries four bounded fields per chat and no identifier

The digest SHALL contain, for each listed chat, at most four fields and no others: its **title**, its **last-activity date**, its **message count**, and an **excerpt** of that chat's first user message truncated to a documented maximum of **200 Unicode code points**, cut on a code-point boundary. The unit SHALL be code points rather than UTF-16 units or bytes, so the cap does not vary by script and cannot split a character. Only the excerpt is omissible, and only in the case named below; the other three SHALL always render. The excerpt SHALL be taken from the earliest stored user message by insertion order, independent of whether that chat has since been compacted, so an entry's content is immutable once resolved. Assistant replies, tool output, reasoning, and any message after the first SHALL NOT appear.

The digest SHALL NOT carry chat identifiers. No shipped tool accepts a chat id, so an identifier would be inert while costing roughly eighteen to twenty tokens per entry — several hundred tokens of unusable text frozen into every chat's prompt. Identifiers belong on transient, requested surfaces that are paid for only when called, not in a standing prompt. Adding one later is a template edit rather than a migration, so the omission SHALL be revisited when a tool consumes one.

The last-activity date SHALL be rendered as an **absolute calendar date** and SHALL be labelled as last activity, so it is not mistaken for the date of the excerpt it sits beside — the excerpt is the chat's opening message and the date is its most recent, and a long-running chat legitimately shows a wide gap between them. Relative expressions ("three days ago") SHALL NOT be used: a frozen baseline renders the same text indefinitely, so a relative date decays into a confident falsehood.

The message count SHALL be the count of stored messages at the moment the entry was resolved, and SHALL be understood as frozen alongside the rest of the entry rather than tracking the chat.

The 200-code-point cap SHALL be documented as an **injection and disclosure control rather than a token-budget control**: a first user message frequently contains bulk pasted material, and the cap exists to retain the owner's own leading prose while truncating that payload. Raising it for perceived answer quality is therefore a security decision, not a tuning decision. A chat whose first user message has no text content SHALL render with **no excerpt field at all** rather than an empty one, and SHALL still render its title. Omission rather than an empty value is required, not cosmetic: rendered values are `SafeString`s, and a `SafeString` wrapping `""` is still a truthy object, so an empty-valued excerpt would satisfy the template's own presence check and emit a bare label with nothing after it.

The digest SHALL list at most **10 pinned chats** and at most **10 recent chats**. Pinned chats beyond the cap SHALL be absent from **both** lists, since the recent list is drawn from chats that are not pinned. This is accepted rather than worked around: the stated pinned ratio tells the model that more pinned chats exist, and the cut is a decision the owner made via pin rank rather than an arbitrary activity boundary. The two lists SHALL be **disjoint**: a chat that is both pinned and recent SHALL appear only under pinned, and the recent list SHALL backfill from the next-most-recent unpinned chats so that it carries a full 10 whenever the owner has that many. Pinned SHALL render before recent. The **pinned** list SHALL be ordered by the owner's pin rank (the same order as `GET /pins` / `GET /chats?pinned=only`, restricted to eligible chats). The **recent** list SHALL be ordered by last activity, most recent first.

The rendered digest SHALL state, for each list, **how many entries it shows out of how many exist** — the pinned list against the owner's total **eligible pinned** chats, and the recent list against the owner's total eligible **unpinned** chats. "Eligible" carries the same meaning in both denominators as it does for list selection: the chat being rendered, archived chats, chats with no title or a whitespace-only title, and pins whose item is not a chat SHALL NOT be counted. A pinned chat that is excluded from the list for any of those reasons SHALL likewise be absent from `pinnedTotal`, so the ratio never claims a pinned chat the digest could not have shown. The recent list is drawn from eligible chats that are not pinned, so counting all eligible chats would describe a population the list is not selected from — with 30 pinned inside 247 eligible, the recent denominator is 217. Each denominator SHALL be the **exact** population its list is drawn from, so the two ratios describe the lists rather than approximating them. A capped read cannot yield an exact total, so the read path SHALL return the count independently of the capped rows — a cap that also truncates the denominator would report `10 of 10` for an owner with 247 chats, inverting the signal the ratio exists to give.

Bare prose that entries were omitted is insufficient. A ratio is what tells the model whether the digest is nearly complete or a thin slice of a deep corpus, which is precisely the judgment that should decide whether it retrieves: `10 of 12` and `10 of 247` warrant opposite behavior and identical prose. The counts SHALL be presented as a statement about the owner's corpus, not as usage statistics about the owner, and no derived behavioral measure — message frequency, session depth, activity streaks, model-usage breakdowns — SHALL be included.

The counts SHALL be resolved with the baseline and frozen alongside it; appends SHALL NOT update them. Their staleness is bounded by the same re-resolution boundary as every other entry and is covered by the stated compilation date.

The rendered digest SHALL NOT name a retrieval tool that is not advertised for that turn.

The rendered digest SHALL additionally state the **absolute date on which the list itself was compiled**, and that the list may be older than the current conversation. Without that anchor the per-entry dates are close to decorative: llame injects no current date anywhere, so a model reading `2026-07-20` cannot place it relative to now. A stated compilation date gives every entry a reference point and makes the list's frozen nature legible instead of hidden.

The framing SHALL further state that **every entry is a point-in-time record rather than an authoritative description of the chat as it stands now**, naming renaming specifically. That case has a functional consequence rather than a cosmetic one: retrieval matches titles live, so a title renamed after the list was compiled can match nothing, and the model needs to read a miss as staleness rather than as the chat not existing. The entry's excerpt is verbatim message content and remains reachable, so a content-derived query still recovers the chat.

#### Scenario: Digest lists a chat with a long first message

- **WHEN** an eligible chat's first user message exceeds the documented excerpt maximum
- **THEN** the rendered entry contains only the first 200 Unicode code points of that message
- **AND** no later message from that chat appears in the digest

#### Scenario: Digest contains no assistant or tool content

- **WHEN** the digest is rendered for an owner whose chats contain assistant replies, tool results, and reasoning
- **THEN** the rendered output contains none of that content
- **AND** only titles, last-activity dates, message counts, and first-user-message excerpts are present

#### Scenario: Digest carries no chat identifiers

- **WHEN** the digest is rendered for any owner
- **THEN** no chat identifier appears in the rendered output
- **AND** no entry offers the model a handle it could pass to a tool

#### Scenario: The list states when it was compiled and how far to trust it

- **WHEN** the digest is rendered
- **THEN** it states the absolute date the list was compiled, that it may be older than the current conversation, and that entries are point-in-time records whose titles may since have been renamed
- **AND** every entry's date is interpretable relative to that stated point

#### Scenario: A listed chat is renamed after the baseline is resolved

- **WHEN** the owner renames a chat that the baseline lists
- **THEN** the digest continues to show the title as it stood when the list was compiled
- **AND** no append corrects it, the framing having already stated that titles are not authoritative

#### Scenario: A long-running chat shows a recent date beside an old excerpt

- **WHEN** a listed chat was started weeks before its most recent activity
- **THEN** its date is labelled as last activity rather than presented as the excerpt's date
- **AND** the date is absolute rather than expressed relative to the present

#### Scenario: A pinned chat is also among the most recent

- **WHEN** an owner's most recently updated chat is also pinned
- **THEN** it appears once, under pinned, and not under recent
- **AND** the recent list backfills with the next-most-recent unpinned chat so it still carries 10 entries

#### Scenario: Digest states how much it is showing

- **WHEN** an owner with 247 eligible chats, 30 of them eligible and pinned, has a digest resolved
- **THEN** the rendered block states that it shows 10 of 30 pinned and 10 of 217 recent — the recent denominator excluding the 30 pinned, since the recent list is not drawn from them
- **AND** it carries no message-frequency, session-depth, streak, or model-usage measure

#### Scenario: Owner has fewer chats than the caps

- **WHEN** an owner has three eligible chats and none pinned
- **THEN** the pinned list is omitted entirely and the recent list contains those three
- **AND** no placeholder or padding entry is rendered

#### Scenario: A chat's first message carries no text

- **WHEN** an eligible chat's first user message contains only non-text parts
- **THEN** its entry renders its title, date, and message count with no excerpt
- **AND** the entry is not dropped from the digest

#### Scenario: Pinned digest follows owner pin rank

- **WHEN** an owner has reordered pinned chats so eligible chat A ranks above eligible chat B while B was updated more recently
- **THEN** the digest's pinned list lists A before B
