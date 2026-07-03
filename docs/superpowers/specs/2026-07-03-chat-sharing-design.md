# Chat sharing — public read-only share links

## Objective

`chats.visibility` (`private` | `public`, default `private`) is a DORMANT
column: nothing reads or writes it, there is no share endpoint and no public
view. Activate it: let an owner make a chat PUBLIC and share a read-only link
that anyone (even unauthenticated) can open — matching our stack template
(Vercel `ai-chatbot`'s visibility + read-only shared view). Uses what's already
modeled; a genuinely useful, common feature.

## Security is the acceptance criterion

This RELAXES tenant isolation for public chats, so it is designed to be provably
safe, not merely intended to be:

- **Minimal, SELECT-only, identity-gated relaxation.** Two new RLS policies,
  both `FOR SELECT`, gated on `visibility='public'` AND
  `current_setting('app.current_user_id', true) = ''` (the `runAsPublic`
  context):
  - `chats_public_read` — `USING (visibility='public' AND current_user='')`
  - `messages_public_read` — `USING (current_user='' AND chat_id IN (SELECT id
    FROM chats WHERE visibility='public'))`
  The `current_user=''` gate (added in review, see P1) means these policies
  apply ONLY under `runAsPublic` — they never OR a public chat into a NORMAL
  `runAs(userId)` read, so RLS alone STILL scopes an owner query to its own
  chats (the "RLS is primary" invariant is preserved, not weakened to "RLS + app
  filter"). A private chat is matched by NEITHER policy. No INSERT/UPDATE/DELETE
  — a public reader can never write.
- **Public reads run with NO tenant identity.** `runAs` rejects an empty userId
  (fail-fast); a new `TenantDbService.runAsPublic(fn)` runs a transaction with
  `set_config('app.current_user_id', '', true)`. With `current_user=''`, the
  owner policies (`owner_user_id = ''`) match nothing — so ONLY the
  `visibility='public'` SELECT policies apply. A private chat is invisible even
  to this path.
- **Toggle is owner-only.** Making a chat public/private is a `PATCH /chats/:id
  { visibility }` under the EXISTING `chats_owner` (FOR ALL) policy — only the
  owner can UPDATE. The public-read policies are SELECT-only, so they can't be
  used to flip visibility.
- **The public DTO is a strict egress allowlist** (`toSharedChatResponse`, a
  NEW mapper — never the owner-including `toChatResponse`/`toChatMessageResponse`).
  It carries only the chat title + messages, each as `{id, role, parts,
  createdAt}` — NO `owner_user_id`/`sender_user_id`/`seq`/telemetry. `parts` is
  filtered to `type='text'` (TEXT-only allowlist): **reasoning is stripped** (it
  can contain injected private context — memories, custom instructions the model
  reasoned over), and any future non-text part is denied by default. Messages
  are filtered to `role IN ('user','assistant')` — at BOTH the query
  (`listPublicByChatId`) and the mapper — so a later tool/system-parts change
  can't leak internals into a shared link.

## Design

### Backend

- **Migration**: add the two SELECT-only policies (Drizzle `pgPolicy` with
  `for: 'select'`, as `providers.ts` already does). FORCE RLS is already on
  chats/messages — no re-add.
- **`TenantDbService.runAsPublic(fn)`**: a transaction with `current_user=''`
  (public-read policies only). Documented as the ONLY non-owner read path.
- **Repo**: `ChatsRepository.findPublicById(chatId)` (no owner filter — RLS
  returns it only if public) and `MessagesRepository.listByChatId(chatId)` (no
  owner filter — RLS scopes to public chats).
- **API**:
  - `PATCH /chats/:id { visibility }` — extend `UpdateChatDto` with an optional
    `visibility` (`@IsIn(['private','public'])`); `updateChat` already
    owner-scopes.
  - `GET /api/v1/shared/chats/:id` (`@Public`) → `runAsPublic` → `findPublicById`
    + `listByChatId` → a `SharedChatResponse` (id, title, messages[]). 404 when
    the chat isn't found OR isn't public (a private/absent id is indistinguishable
    — no existence oracle).

### Web

- **Share control** in the chat row dropdown (next to Rename/Delete): a "Share"
  item → a dialog that toggles public/private (PATCH) and, when public, shows +
  copies the link (`/shared/:id`, via the secure-context-safe `copyText`).
- **Public view** at `/shared/[id]` (outside the `(chat)` auth group, no session
  needed): fetches `GET /api/v1/shared/chats/:id`, renders the title + messages
  READ-ONLY (text + reasoning parts, reusing the existing part rendering), no
  composer, no actions. A not-found/ private link → a plain "not available"
  state.

## Testability (security-first)

- RLS integration (the load-bearing negatives):
  - `runAsPublic` returns a PUBLIC chat + its messages;
  - `runAsPublic` returns NOTHING for a PRIVATE chat (not leaked) and none of its
    messages;
  - a non-owner (`runAs(other)`) cannot flip `visibility` (owner policy denies);
  - the public-read policies grant no write (an UPDATE/DELETE via `runAsPublic`
    affects 0 rows / errors).
- API: `GET /shared/chats/:id` 200 for public, 404 for private and for absent
  (same response — no oracle); the DTO contains no user ids; the toggle is
  owner-scoped (cross-tenant PATCH → 404).
- Web: the shared-chat service (URL/verb); the visibility toggle service.

## Non-goals (named)

- Per-message or partial sharing; share expiry / revocation tokens (revoking =
  set private again); a distinct unguessable share slug (the chat UUID is the
  link — unguessable enough for v1; note it); comments / reactions on shared
  chats; embedding; SSR/OG previews. Live updates to an open shared view
  (fetch-on-load is enough).

## Revision history

- **v2 (2026-07-03):** Round-1 review (verifier + adversarial), both confirmed
  the core cannot leak a private chat. Changes made: (1) the biggest — the
  public-read policies are now IDENTITY-GATED on `current_user=''` so they can't
  OR public chats into a normal owner read (the verifier/adversarial P1 that the
  permissive policy weakened the RLS-primary invariant); a dedicated integration
  test proves an authenticated read can't see another user's public chat via RLS
  alone. (2) `listPublicByChatId` filters `role IN ('user','assistant')` at the
  query (defense-in-depth beyond the mapper) so a future tool/system-parts change
  can't leak. (3) the shared DTO strips reasoning (privacy) + is a text-only
  allowlist. (4) `no-store` on the @Public route; `/shared/*` allowed through the
  middleware. Naming (`listPublicByChatId`) + the `findPublicById` visibility
  seatbelt corrected. Note: `runAsPublic` safety also rests on `users.id` never
  being '' (app invariant: `crypto.randomUUID()`), on top of the identity gate.
- **v1 (2026-07-03):** Initial.
