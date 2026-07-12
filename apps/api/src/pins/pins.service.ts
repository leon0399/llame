import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { type PinItemType } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { PinsRepository, type PinnedRow } from './pins-repository';

@Injectable()
export class PinsService {
  constructor(private readonly tenantDb: TenantDbService) {}

  /** The caller's pinned items, most-recently-pinned first, hydrated. */
  async listPins(userId: string): Promise<PinnedRow[]> {
    return this.tenantDb.runAs(userId, (tx) =>
      new PinsRepository(tx).listWithCards(userId),
    );
  }

  /**
   * Pin an item (idempotent). Pinning an item the caller cannot access is
   * denied by the `pins_owner_insert` WITH CHECK — surfaced as 42501 (RLS) on a
   * genuine insert, or as a non-hydratable row on a re-pin of a now-inaccessible
   * item; both map to a clean 404, no existence oracle (mirrors the chat filing
   * gate, chats.service.ts). Never a 500.
   */
  async pin(
    userId: string,
    itemType: PinItemType,
    itemId: string,
  ): Promise<PinnedRow> {
    let row: PinnedRow | undefined;
    try {
      row = await this.tenantDb.runAs(userId, (tx) =>
        new PinsRepository(tx).pin(userId, itemType, itemId),
      );
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const code = pgErrorCode(err);
      // 42501 = RLS WITH CHECK denial (inaccessible item); 23503 = FK (defensive:
      // item_id has no FK, only the server-derived user_id does).
      if (code === '42501' || code === '23503') {
        throw new NotFoundException(notFoundMessage(itemType));
      }
      throw err;
    }
    if (!row) throw new NotFoundException(notFoundMessage(itemType));
    return row;
  }

  /** Unpin (idempotent): unpinning a not-pinned item still succeeds. */
  async unpin(
    userId: string,
    itemType: PinItemType,
    itemId: string,
  ): Promise<void> {
    await this.tenantDb.runAs(userId, (tx) =>
      new PinsRepository(tx).unpin(userId, itemType, itemId),
    );
  }
}

function notFoundMessage(itemType: PinItemType): string {
  return itemType === 'chat' ? 'Chat not found' : 'Project not found';
}

// Postgres driver surfaces the SQLSTATE on `.code` (sometimes nested on
// `.cause.code`) — same extraction as ChatsService.
function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}
