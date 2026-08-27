import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type PinItemType } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { pgErrorCode } from '../db/pg-error';
import {
  PinReorderMismatchError,
  PinsRepository,
  type PinOrderItem,
  type PinnedRow,
} from './pins-repository';

@Injectable()
export class PinsService {
  constructor(private readonly tenantDb: TenantDbService) {}

  /** The caller's pinned items in owner rank order, hydrated. */
  async listPins(userId: string): Promise<PinnedRow[]> {
    return this.tenantDb.runAs(userId, (tx) =>
      new PinsRepository(tx).listWithCards(userId),
    );
  }

  /**
   * Replace the caller's pin order with `ordered` (exact hydratable-set match,
   * same population as GET /pins). Identity is the session user only — never a
   * client-supplied owner.
   */
  async reorderPins(
    userId: string,
    ordered: readonly PinOrderItem[],
  ): Promise<PinnedRow[]> {
    try {
      return await this.tenantDb.runAs(userId, (tx) =>
        new PinsRepository(tx).reorder(userId, ordered),
      );
    } catch (err) {
      if (err instanceof PinReorderMismatchError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /**
   * Pin an item (idempotent). Pinning an item the caller cannot access is
   * denied by the `pins_owner_insert` WITH CHECK — surfaced as 42501 (RLS) on a
   * genuine insert, or as a non-hydratable row on a re-pin of a now-inaccessible
   * item; both map to a clean 404, no existence oracle (mirrors the chat filing
   * gate, chats.service.ts). Never a 500.
   *
   * Concurrent net-new pins can race on `pins_user_position_unique` (23505);
   * one cheap retry recomputes `MIN(position)-1` after the peer commits.
   */
  async pin(
    userId: string,
    itemType: PinItemType,
    itemId: string,
  ): Promise<PinnedRow> {
    let row: PinnedRow | undefined;
    try {
      row = await this.insertPin(userId, itemType, itemId);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const code = pgErrorCode(err);
      // 42501 = RLS WITH CHECK denial (inaccessible item); 23503 = FK (defensive:
      // item_id has no FK, only the server-derived user_id does).
      if (code === '42501' || code === '23503') {
        throw new NotFoundException(notFoundMessage(itemType));
      }
      if (code === '23505') {
        try {
          row = await this.insertPin(userId, itemType, itemId);
        } catch (retryErr) {
          if (retryErr instanceof HttpException) throw retryErr;
          const retryCode = pgErrorCode(retryErr);
          if (retryCode === '42501' || retryCode === '23503') {
            throw new NotFoundException(notFoundMessage(itemType));
          }
          throw retryErr;
        }
      } else {
        throw err;
      }
    }
    if (!row) throw new NotFoundException(notFoundMessage(itemType));
    return row;
  }

  private insertPin(
    userId: string,
    itemType: PinItemType,
    itemId: string,
  ): Promise<PinnedRow | undefined> {
    return this.tenantDb.runAs(userId, (tx) =>
      new PinsRepository(tx).pin(userId, itemType, itemId),
    );
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
