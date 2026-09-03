import { InferSelectModel, sql } from 'drizzle-orm';
import { boolean, pgPolicy, pgTable, text } from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';
import { users } from './auth';

// One owner-authored personalization profile per user (add-user-personalization).
// `user_id` is the primary key, not a surrogate: a user has exactly one profile,
// which makes "no row" the natural default and the write a plain upsert on the
// key. text `user_id` — FK to users.id which is text (NextAuth).
//
// A separate table rather than columns on `users` (design D9): `users` follows
// the NextAuth-shaped adapter contract, and product fields on it invite adapter
// friction. It also keeps this RLS policy narrow and gives a future
// file-sourced variant somewhere to record provenance per slot.
//
// Field caps are enforced at the DTO (see personalization.constants.ts), not in
// the column type — same as `messages.parts` content, whose 20000-char bound is
// a DTO concern. Columns stay `text` so a cap change is not a migration.
//
// The two toggles are deliberately asymmetric in default (design D4a):
// `enabled` gates only what the owner authored, so defaulting it TRUE costs
// nothing — an owner who wrote nothing renders nothing, and their text works the
// moment they write it. `share_account_identity` gates account-derived identity,
// where defaulting it true would let an operator referencing `user.email` move
// every existing user's address to the configured provider retroactively.
//
// NOTE: `.enableRLS()` only emits ENABLE. The migration ALSO issues
// `FORCE ROW LEVEL SECURITY` (Drizzle cannot express it) — same as chats/0004,
// runs/0011, org-units/0018, pins/0023. Re-add FORCE if this is regenerated.
export const personalization = pgTable(
  'personalization',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    preferredName: text('preferred_name'),
    about: text('about'),
    responsePreferences: text('response_preferences'),
    enabled: boolean('enabled').notNull().default(true),
    shareAccountIdentity: boolean('share_account_identity')
      .notNull()
      .default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  // The callback takes no parameter: this table needs no index (the primary key
  // IS the only access path), so nothing here references a column builder —
  // every policy below is raw SQL over `user_id`.
  () => [
    // Private to its owner, with NO public-read branch: unlike chats, this is
    // never reachable through the shared-chat path. Under runAsPublic
    // (current_user = '') every policy below matches nothing, so an
    // unauthenticated reader of a public chat cannot reach its owner's profile.
    pgPolicy('personalization_owner_select', {
      for: 'select',
      using: sql`user_id = current_setting('app.current_user_id', true)`,
    }),
    pgPolicy('personalization_owner_insert', {
      for: 'insert',
      withCheck: sql`user_id = current_setting('app.current_user_id', true)`,
    }),
    // USING selects the rows that may be updated; WITH CHECK constrains the
    // result, so a caller cannot rewrite user_id to hand their row to someone
    // else (or claim another's).
    pgPolicy('personalization_owner_update', {
      for: 'update',
      using: sql`user_id = current_setting('app.current_user_id', true)`,
      withCheck: sql`user_id = current_setting('app.current_user_id', true)`,
    }),
    pgPolicy('personalization_owner_delete', {
      for: 'delete',
      using: sql`user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type Personalization = InferSelectModel<typeof personalization>;
