import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { type ChatDelivery } from '../db/schema';
import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import { ChatDeliveriesRepository } from './chat-deliveries.repository';
import { ChatsRepository } from './chats-repository';

/**
 * The owner's view of the pending items of a Chat (run-steering). Every read
 * and write runs in the owner's tenant scope, so a Chat or an item of another
 * owner is not found.
 */
@Injectable()
export class ChatDeliveriesService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
  ) {}

  /** The pending items of the Chat, first to deliver first. */
  listPending(chatId: string, userId: string): Promise<Array<ChatDelivery>> {
    return this.tenantDb.runAs(userId, async (tx) => {
      await this.requireChat(new ChatsRepository(tx), chatId, userId);
      return new ChatDeliveriesRepository(tx).listPending(chatId, userId);
    });
  }

  /**
   * Withdraw one pending item and return it with its parts, so the client can
   * put the text back for an edit. One conditional update decides the race
   * with a delivery: an item that is no longer `pending` gets 409, and one
   * that is not an item of the owner's Chat gets 404.
   */
  withdraw(
    chatId: string,
    deliveryId: string,
    userId: string,
  ): Promise<ChatDelivery> {
    return this.tenantDb.runAs(userId, async (tx) => {
      const items = new ChatDeliveriesRepository(tx);
      const withdrawn = await items.withdrawPending(chatId, deliveryId, userId);
      if (withdrawn) return withdrawn;
      const existing = await items.findById(deliveryId, userId);
      if (existing?.chatId === chatId) {
        throw new ConflictException('The item is no longer pending');
      }
      throw new NotFoundException(`Delivery ${deliveryId} not found`);
    });
  }

  private async requireChat(
    chats: ChatsRepository,
    chatId: string,
    userId: string,
  ): Promise<void> {
    if (!(await chats.findById(chatId, userId))) {
      throw new NotFoundException(`Chat ${chatId} not found`);
    }
  }
}
