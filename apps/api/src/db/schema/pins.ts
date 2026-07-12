import { InferSelectModel, sql } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';

// DB-enforced set of pinnable item types (rework-item-pinning). Two values
// only — deliberately NOT over-provisioned like `run_status`: the pinnable-type
// set is an open product question, and adding a type is never enum-only (it also
// needs a new RLS accessibility branch below + a per-type card), so a future
// `ALTER TYPE ... ADD VALUE` rides along at zero marginal migration cost.
export const pinItemType = pgEnum('pin_item_type', ['chat', 'project']);

// A per-user pin: a reference from a user to a pinnable item, owned by the
// pinning user. Pin state is a property of the (user, item) pair — never of the
// item row — so two users hold independent pins for the same item, and true
// multi-user chats need no pin-model change (only the chat accessibility branch
// in the INSERT WITH CHECK widens). `item_id` is polymorphic (no cross-type FK);
// referential validity is enforced at write by the accessibility gate and
// dangling rows are filtered at read (a deleted/inaccessible item simply fails
// to hydrate). text `user_id` — FK to users.id which is text (NextAuth).
//
// NOTE: `.enableRLS()` only emits ENABLE. The migration ALSO issues
// `FORCE ROW LEVEL SECURITY` (Drizzle cannot express it) — same as chats/0004,
// runs/0011, org-units/0018. Re-add FORCE if this migration is regenerated.
export const pins = pgTable(
  'pins',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemType: pinItemType('item_type').notNull(),
    itemId: uuid('item_id').notNull(),
    pinnedAt: timestamp('pinned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.itemType, t.itemId] }),
    // The rail's primary read: WHERE user_id=? ORDER BY pinned_at DESC, item_id.
    // item_id is the tiebreaker so equal pinned_at values order deterministically.
    index('pins_user_pinned_idx').on(t.userId, t.pinnedAt.desc(), t.itemId),
    // A pin is private to its owner. Under runAsPublic (current_user = '') this
    // matches nothing, so pins are never exposed on the no-identity path.
    pgPolicy('pins_owner_select', {
      for: 'select',
      using: sql`user_id = current_setting('app.current_user_id', true)`,
    }),
    pgPolicy('pins_owner_delete', {
      for: 'delete',
      using: sql`user_id = current_setting('app.current_user_id', true)`,
    }),
    // Write gate: a user may pin only an item they can currently access. The
    // per-type subqueries run under the referenced table's own RLS, so
    // "accessible" is exactly "the caller can see it" (owned, for this slice).
    // No recursion — chats/projects never scan pins. This is the seam multi-user
    // chats later widen (owner → owner-or-participant), mirroring chats.ts:85.
    pgPolicy('pins_owner_insert', {
      for: 'insert',
      withCheck: sql`user_id = current_setting('app.current_user_id', true) AND (
        (item_type = 'chat' AND item_id IN (SELECT id FROM chats WHERE owner_user_id = current_setting('app.current_user_id', true)))
        OR (item_type = 'project' AND item_id IN (SELECT id FROM projects WHERE owner_user_id = current_setting('app.current_user_id', true)))
      )`,
    }),
  ],
).enableRLS();

export type Pin = InferSelectModel<typeof pins>;
export type PinItemType = (typeof pinItemType.enumValues)[number];
