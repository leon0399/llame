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
  async listPins(userId: string): Promise<Array<PinnedRow>> {
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
    ordered: ReadonlyArray<PinOrderItem>,
  ): Promise<Array<PinnedRow>> {
    try {
      return await this.tenantDb.runAs(userId, (tx) =>
        new PinsRepository(tx).reorder(userId, ordered),
      );
    } catch (error) {
      if (error instanceof PinReorderMismatchError) {
        throw new BadRequestException(error.message);
      }
      throw error;
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
    try {
      return await this.attemptPin(userId, itemType, itemId);
    } catch (error) {
      if (!this.isRetryablePinRace(error, itemType)) throw error;
      // A concurrent net-new pin raced on `pins_user_position_unique`
      // (23505) — retry once; the peer has committed by now.
    }
    try {
      return await this.attemptPin(userId, itemType, itemId);
    } catch (error) {
      this.isRetryablePinRace(error, itemType); // maps 42501/23503, else falls through
      throw error;
    }
  }

  /** One insert attempt, hydrated. Throws the pin write's public 404 for a
   * non-hydratable row (re-pin of a now-inaccessible item). */
  private async attemptPin(
    userId: string,
    itemType: PinItemType,
    itemId: string,
  ): Promise<PinnedRow> {
    const row = await this.insertPin(userId, itemType, itemId);
    if (!row) throw new NotFoundException(notFoundMessage(itemType));
    return row;
  }

  /**
   * Maps an `attemptPin` failure to the pin write's public error contract:
   * an `HttpException` passes through, 42501 (RLS WITH CHECK denial) and
   * 23503 (FK; defensive, item_id has no FK of its own) become a clean 404.
   * Returns `true` only for the one recoverable race (23505); the caller
   * decides whether to retry, and anything else is rethrown unchanged.
   */
  private isRetryablePinRace(err: unknown, itemType: PinItemType): boolean {
    if (err instanceof HttpException) throw err;
    const code = pgErrorCode(err);
    if (code === '42501' || code === '23503') {
      throw new NotFoundException(notFoundMessage(itemType));
    }
    return code === '23505';
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
