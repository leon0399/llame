/**
 * PinsRepository — per-user pin access, owner-scoped (defense-in-depth on top
 * of the `pins_owner_*` RLS policies, FORCE). A pin references a chat or project
 * by (item_type, item_id); the referenced item is polymorphic (no cross-type FK),
 * so hydration reads the item's card under RLS and DROPS any pin whose item no
 * longer exists or is not accessible to the caller (the only cleanup that works
 * under multi-user — see design D4).
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { chats, pins, projects, type PinItemType } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
export { type Db } from '../db/tenant-db.service';

// A hydrated pin: the pin metadata plus the item's per-type reference card.
// Discriminated on itemType so the card's fields are exactly the type's own.
export type PinnedRow =
  | { itemType: 'chat'; itemId: string; pinnedAt: Date; title: string | null }
  | { itemType: 'project'; itemId: string; pinnedAt: Date; name: string };

export class PinsRepository {
  constructor(private readonly db: Db) {}

  /**
   * The caller's pins, most-recently-pinned first (item_id breaks ties), each
   * hydrated with its item's card. A pin whose item does not hydrate under RLS
   * (deleted / inaccessible) is omitted.
   */
  async listWithCards(userId: string): Promise<PinnedRow[]> {
    const rows = await this.db
      .select()
      .from(pins)
      .where(eq(pins.userId, userId))
      .orderBy(desc(pins.pinnedAt), pins.itemId);

    if (rows.length === 0) return [];

    const chatIds = rows
      .filter((r) => r.itemType === 'chat')
      .map((r) => r.itemId);
    const projectIds = rows
      .filter((r) => r.itemType === 'project')
      .map((r) => r.itemId);

    // Batched, RLS-scoped card reads: 2 queries regardless of pin count.
    const chatCards = chatIds.length
      ? await this.db
          .select({ id: chats.id, title: chats.title })
          .from(chats)
          .where(inArray(chats.id, chatIds))
      : [];
    const projectCards = projectIds.length
      ? await this.db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : [];

    const chatTitle = new Map(chatCards.map((c) => [c.id, c.title]));
    const projectName = new Map(projectCards.map((p) => [p.id, p.name]));

    const result: PinnedRow[] = [];
    for (const row of rows) {
      switch (row.itemType) {
        case 'chat': {
          if (!chatTitle.has(row.itemId)) continue; // dropped: not hydratable
          result.push({
            itemType: 'chat',
            itemId: row.itemId,
            pinnedAt: row.pinnedAt,
            title: chatTitle.get(row.itemId) ?? null,
          });
          break;
        }
        case 'project': {
          const name = projectName.get(row.itemId);
          if (name === undefined) continue; // dropped: not hydratable
          result.push({
            itemType: 'project',
            itemId: row.itemId,
            pinnedAt: row.pinnedAt,
            name,
          });
          break;
        }
        default: {
          // Exhaustiveness guard: a new PinItemType forces a compile error
          // until its hydration branch is added.
          const _exhaustive: never = row.itemType;
          throw new Error(`Unhandled pin item type: ${String(_exhaustive)}`);
        }
      }
    }
    return result;
  }

  /**
   * Pin an item (idempotent). The `pins_owner_insert` WITH CHECK gates on the
   * caller owning the referenced item: a genuine insert of an inaccessible item
   * raises 42501, which the service maps to 404 (no existence oracle). On
   * conflict the pin already exists; either way we return the hydrated row, or
   * undefined if the item is no longer hydratable (→ service 404).
   */
  async pin(
    userId: string,
    itemType: PinItemType,
    itemId: string,
  ): Promise<PinnedRow | undefined> {
    await this.db
      .insert(pins)
      .values({ userId, itemType, itemId })
      .onConflictDoNothing();

    return this.findOneWithCard(userId, itemType, itemId);
  }

  /** Unpin (idempotent): deleting zero rows is a success. */
  async unpin(
    userId: string,
    itemType: PinItemType,
    itemId: string,
  ): Promise<void> {
    await this.db
      .delete(pins)
      .where(
        and(
          eq(pins.userId, userId),
          eq(pins.itemType, itemType),
          eq(pins.itemId, itemId),
        ),
      );
  }

  private async findOneWithCard(
    userId: string,
    itemType: PinItemType,
    itemId: string,
  ): Promise<PinnedRow | undefined> {
    const [pin] = await this.db
      .select()
      .from(pins)
      .where(
        and(
          eq(pins.userId, userId),
          eq(pins.itemType, itemType),
          eq(pins.itemId, itemId),
        ),
      )
      .limit(1);
    if (!pin) return undefined;

    switch (itemType) {
      case 'chat': {
        const [card] = await this.db
          .select({ id: chats.id, title: chats.title })
          .from(chats)
          .where(eq(chats.id, itemId))
          .limit(1);
        if (!card) return undefined;
        return {
          itemType: 'chat',
          itemId,
          pinnedAt: pin.pinnedAt,
          title: card.title,
        };
      }
      case 'project': {
        const [card] = await this.db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(eq(projects.id, itemId))
          .limit(1);
        if (!card) return undefined;
        return {
          itemType: 'project',
          itemId,
          pinnedAt: pin.pinnedAt,
          name: card.name,
        };
      }
      default: {
        // Exhaustiveness guard: a new PinItemType forces a compile error until
        // its card lookup is added.
        const _exhaustive: never = itemType;
        throw new Error(`Unhandled pin item type: ${String(_exhaustive)}`);
      }
    }
  }
}
