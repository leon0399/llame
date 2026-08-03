/**
 * PersonalizationRepository — owner-scoped database access.
 *
 * Every query filters by the owner's user id as defense-in-depth. RLS
 * (`personalization_owner_*`, FORCE) is the primary isolation guarantee; this
 * filter is the seatbelt — mirrors ChatsRepository's own documented rationale.
 */

import { eq } from 'drizzle-orm';
import { type Personalization, personalization, users } from '../db/schema';
import { type Db } from '../db/tenant-db.service';

/** The account fields that per-user prompt context can render. */
export type AccountIdentity = {
  name: string | null;
  email: string | null;
};

export type PersonalizationUpdate = {
  preferredName?: string | null;
  about?: string | null;
  responsePreferences?: string | null;
  enabled?: boolean;
  shareAccountIdentity?: boolean;
};

export class PersonalizationRepository {
  constructor(private readonly db: Db) {}

  /** The owner's profile, or undefined when they have never written one. */
  async findForOwner(
    ownerUserId: string,
  ): Promise<Personalization | undefined> {
    const [row] = await this.db
      .select()
      .from(personalization)
      .where(eq(personalization.userId, ownerUserId))
      .limit(1);
    return row;
  }

  /**
   * Account display name and email for prompt context.
   *
   * The `eq(users.id, ownerUserId)` filter is NOT redundant here, unlike the
   * seatbelt filters elsewhere in this file: `users` carries no row-level
   * security at all, so there is no datastore backstop behind it. An unfiltered
   * read would return every account on the instance. This filter is the only
   * thing scoping it, which is why the spec requires it to be stated here.
   *
   * Only `name` and `email` are selected — never the row. `users` has a
   * `password` column, and a row passed as render context would put a
   * credential hash into a system prompt, an immutable snapshot, and the
   * owner-visible receipt.
   */
  async findAccountIdentity(
    ownerUserId: string,
  ): Promise<AccountIdentity | undefined> {
    const [row] = await this.db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, ownerUserId))
      .limit(1);
    return row;
  }

  /**
   * Create or update the owner's single profile.
   *
   * Upsert on the primary key, because `user_id` IS the key: a user has exactly
   * one profile, so there is no "which row" to resolve. Only the keys present
   * in `update` are written, keeping PATCH semantics — an omitted field is
   * untouched, while an explicit `null` clears it.
   */
  async upsertForOwner(
    ownerUserId: string,
    update: PersonalizationUpdate,
  ): Promise<Personalization> {
    const [row] = await this.db
      .insert(personalization)
      .values({ userId: ownerUserId, ...update })
      .onConflictDoUpdate({
        target: personalization.userId,
        set: { ...update, updatedAt: new Date() },
      })
      .returning();
    return row;
  }
}
