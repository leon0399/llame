/**
 * PinsRepository — per-user pin access, owner-scoped (defense-in-depth on top
 * of the `pins_owner_*` RLS policies, FORCE). A pin references a chat or project
 * by (item_type, item_id); the referenced item is polymorphic (no cross-type FK),
 * so hydration reads the item's card under RLS and DROPS any pin whose item no
 * longer exists or is not accessible to the caller (the only cleanup that works
 * under multi-user — see design D4).
 *
 * `position` is the owner's cross-type rank: list/order by ascending position;
 * new pins land at COALESCE(MIN(position), 0)-1 without shifting siblings.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  chats,
  pins,
  projects,
  type Pin,
  type PinItemType,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
export { type Db } from '../db/tenant-db.service';

// A hydrated pin: the pin metadata plus the item's per-type reference card.
// Discriminated on itemType so the card's fields are exactly the type's own.
export type PinnedRow =
  | {
      itemType: 'chat';
      itemId: string;
      pinnedAt: Date;
      title: string | null;
      archivedAt: Date | null;
    }
  | {
      itemType: 'project';
      itemId: string;
      pinnedAt: Date;
      name: string;
      archivedAt: Date | null;
    };

export type PinOrderItem = { itemType: PinItemType; itemId: string };
type PositionedPinOrderItem = PinOrderItem & { position: number };

/** Thrown when reorder body is not exactly the caller's current pin set. */
export class PinReorderMismatchError extends Error {
  constructor(message = "Reorder must list exactly the caller's current pins") {
    super(message);
    this.name = 'PinReorderMismatchError';
  }
}

function pinKey(itemType: PinItemType, itemId: string): string {
  return `${itemType}:${itemId}`;
}

/** Validate a full-set reorder and plan collision-free temporary/final writes. */
export function planPinReorder(
  existing: ReadonlyArray<PositionedPinOrderItem>,
  ordered: ReadonlyArray<PinOrderItem>,
): Array<PositionedPinOrderItem> {
  if (ordered.length !== existing.length) {
    throw new PinReorderMismatchError();
  }

  const existingKeys = new Set(
    existing.map((row) => pinKey(row.itemType, row.itemId)),
  );
  const seen = new Set<string>();
  for (const item of ordered) {
    const key = pinKey(item.itemType, item.itemId);
    if (!existingKeys.has(key) || seen.has(key)) {
      throw new PinReorderMismatchError();
    }
    seen.add(key);
  }

  const temporaryStart =
    existing.reduce((minimum, { position }) => Math.min(minimum, position), 0) -
    ordered.length;
  return [
    ...ordered.map((item, index) => ({
      ...item,
      position: temporaryStart - index,
    })),
    ...ordered.map((item, position) => ({ ...item, position })),
  ];
}

export class PinsRepository {
  constructor(private readonly db: Db) {}

  /**
   * The caller's pins in owner rank order (position ASC; item_id breaks ties),
   * each hydrated with its item's card. A pin whose item does not hydrate under
   * RLS (deleted / inaccessible) is omitted.
   */
  async listWithCards(userId: string): Promise<Array<PinnedRow>> {
    const rows = await this.db
      .select()
      .from(pins)
      .where(eq(pins.userId, userId))
      .orderBy(asc(pins.position), pins.itemId);

    if (rows.length === 0) return [];

    // Batched, RLS-scoped card reads: 2 queries regardless of pin count.
    const chatCardById = await this.chatCardsById(
      rows.filter((r) => r.itemType === 'chat').map((r) => r.itemId),
    );
    const projectCardById = await this.projectCardsById(
      rows.filter((r) => r.itemType === 'project').map((r) => r.itemId),
    );

    return rows
      .map((row) => this.hydratePinRow(row, chatCardById, projectCardById))
      .filter((row) => row !== undefined);
  }

  /** Hydrates one pin row with its item's card. undefined when the item does
   * not hydrate under RLS (dropped, not merely omitted from the result). */
  private hydratePinRow(
    row: Pick<Pin, 'itemType' | 'itemId' | 'pinnedAt'>,
    chatCardById: Awaited<ReturnType<PinsRepository['chatCardsById']>>,
    projectCardById: Awaited<ReturnType<PinsRepository['projectCardsById']>>,
  ): PinnedRow | undefined {
    switch (row.itemType) {
      case 'chat': {
        const card = chatCardById.get(row.itemId);
        return (
          card && {
            itemType: 'chat',
            itemId: row.itemId,
            pinnedAt: row.pinnedAt,
            ...card,
          }
        );
      }
      case 'project': {
        const card = projectCardById.get(row.itemId);
        return (
          card && {
            itemType: 'project',
            itemId: row.itemId,
            pinnedAt: row.pinnedAt,
            ...card,
          }
        );
      }
      default: {
        // Exhaustiveness guard: a new PinItemType forces a compile error
        // until its hydration branch is added.
        const _exhaustive: never = row.itemType;
        throw new Error(`Unhandled pin item type: ${String(_exhaustive)}`);
      }
    }
  }

  /** Chat cards for `ids`, keyed by chat id. */
  private async chatCardsById(
    ids: ReadonlyArray<string>,
  ): Promise<Map<string, { title: string | null; archivedAt: Date | null }>> {
    if (ids.length === 0) return new Map();
    const cards = await this.db
      .select({
        id: chats.id,
        title: chats.title,
        archivedAt: chats.archivedAt,
      })
      .from(chats)
      .where(inArray(chats.id, ids));
    return new Map(
      cards.map((c) => [c.id, { title: c.title, archivedAt: c.archivedAt }]),
    );
  }

  /** Project cards for `ids`, keyed by project id. */
  private async projectCardsById(
    ids: ReadonlyArray<string>,
  ): Promise<Map<string, { name: string; archivedAt: Date | null }>> {
    if (ids.length === 0) return new Map();
    const cards = await this.db
      .select({
        id: projects.id,
        name: projects.name,
        archivedAt: projects.archivedAt,
      })
      .from(projects)
      .where(inArray(projects.id, ids));
    return new Map(
      cards.map((p) => [p.id, { name: p.name, archivedAt: p.archivedAt }]),
    );
  }

  /**
   * Pin an item (idempotent). Net-new pins land at the head
   * (`COALESCE(MIN(position), 0)-1`). Re-pin leaves position unchanged
   * (`ON CONFLICT DO NOTHING`). The `pins_owner_insert` WITH CHECK
   * gates accessibility; see PinsService for 42501 → 404 mapping.
   */
  async pin(
    userId: string,
    itemType: PinItemType,
    itemId: string,
  ): Promise<PinnedRow | undefined> {
    await this.db
      .insert(pins)
      .values({
        userId,
        itemType,
        itemId,
        position: sql<number>`coalesce((
          select min(${pins.position})
          from ${pins}
          where ${pins.userId} = ${userId}
        ), 0) - 1`,
      })
      .onConflictDoNothing({
        // Only suppress idempotent re-pins on the primary key. Untargeted
        // DO NOTHING also swallows `pins_user_position_unique` races, which
        // would turn a concurrent head-position collision into a silent miss
        // (hydrate → undefined → 404) and skip the service's 23505 retry.
        target: [pins.userId, pins.itemType, pins.itemId],
      });

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

  /**
   * Rewrite the caller's pin positions to match `ordered` (0..n-1). The body
   * MUST be exactly the caller's **hydratable** pin set (same multiset as
   * `GET /pins`); otherwise throws PinReorderMismatchError. Orphan rows whose
   * item no longer hydrates under RLS are deleted first so densified ranks
   * cannot collide with invisible leftovers.
   */
  async reorder(
    userId: string,
    ordered: ReadonlyArray<PinOrderItem>,
  ): Promise<Array<PinnedRow>> {
    const existing = await this.db
      .select({
        itemType: pins.itemType,
        itemId: pins.itemId,
        position: pins.position,
      })
      .from(pins)
      .where(eq(pins.userId, userId));

    const hydratableKeys = await this.hydratablePinKeys(existing);
    const orphans = existing.filter(
      (row) => !hydratableKeys.has(pinKey(row.itemType, row.itemId)),
    );
    for (const orphan of orphans) {
      await this.unpin(userId, orphan.itemType, orphan.itemId);
    }

    const visible = existing.filter((row) =>
      hydratableKeys.has(pinKey(row.itemType, row.itemId)),
    );
    const assignments = planPinReorder(visible, ordered);
    for (const item of assignments) {
      await this.db
        .update(pins)
        .set({ position: item.position })
        .where(
          and(
            eq(pins.userId, userId),
            eq(pins.itemType, item.itemType),
            eq(pins.itemId, item.itemId),
          ),
        );
    }

    return this.listWithCards(userId);
  }

  /**
   * Keys of pins whose referenced item is still readable under the current
   * RLS session — the same drop rule as `listWithCards`.
   */
  private async hydratablePinKeys(
    rows: ReadonlyArray<PinOrderItem>,
  ): Promise<Set<string>> {
    if (rows.length === 0) return new Set();

    const chatIds = rows
      .filter((r) => r.itemType === 'chat')
      .map((r) => r.itemId);
    const projectIds = rows
      .filter((r) => r.itemType === 'project')
      .map((r) => r.itemId);

    const chatCards = chatIds.length
      ? await this.db
          .select({ id: chats.id })
          .from(chats)
          .where(inArray(chats.id, chatIds))
      : [];
    const projectCards = projectIds.length
      ? await this.db
          .select({ id: projects.id })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : [];

    const keys = new Set<string>();
    for (const { id } of chatCards) keys.add(pinKey('chat', id));
    for (const { id } of projectCards) keys.add(pinKey('project', id));
    return keys;
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
        const card = (await this.chatCardsById([itemId])).get(itemId);
        if (!card) return undefined;
        return { itemType, itemId, pinnedAt: pin.pinnedAt, ...card };
      }
      case 'project': {
        const card = (await this.projectCardsById([itemId])).get(itemId);
        if (!card) return undefined;
        return { itemType, itemId, pinnedAt: pin.pinnedAt, ...card };
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
