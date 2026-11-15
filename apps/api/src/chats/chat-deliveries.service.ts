import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { assertNotArchived } from '../db/assert-not-archived';
import {
  TenantDbService,
  type Db,
  type TenantRunner,
} from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import {
  ModelsService,
  resolveSendSettings,
  type ModelSelectionValidator,
} from '../models/models.service';
import { startItemRun } from '../runs/queue-promotion';
import {
  RunDispatchService,
  type RunDispatcher,
} from '../runs/run-dispatch.service';
import { claimActiveRunSlot, notifyLiveRunSteering } from './chat-admission';
import {
  ChatDeliveriesRepository,
  type ChatDeliveryView,
} from './chat-deliveries.repository';
import { ChatsRepository } from './chats-repository';
import { type ChangeableDeliveryMode } from './dto/chat-deliveries.dto';
import { RunWaitService } from '../runs/run-wait.service';
import { retryRunTransaction } from '../runs/run-transaction';

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
    @Inject(ModelsService)
    private readonly models: ModelSelectionValidator,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    @Inject(RunDispatchService)
    private readonly dispatch: RunDispatcher,
    @Inject(RunWaitService)
    private readonly runWait: Pick<RunWaitService, 'wakeForChatInTransaction'>,
  ) {}

  /** The pending items of the Chat, first to deliver first. */
  listPending(
    chatId: string,
    userId: string,
  ): Promise<Array<ChatDeliveryView>> {
    return this.tenantDb.runAs(userId, async (tx) => {
      await this.requireChat(new ChatsRepository(tx), chatId, userId);

      return new ChatDeliveriesRepository(tx).listPendingViews(chatId, userId);
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
  ): Promise<ChatDeliveryView> {
    return this.tenantDb.runAs(userId, async (tx) => {
      const items = new ChatDeliveriesRepository(tx);
      const withdrawn = await items.withdrawPending(chatId, deliveryId, userId);

      if (withdrawn) {
        if (withdrawn.producer === 'owner')
          return { item: withdrawn, job: null };
        const view = await items.findView(deliveryId, userId);

        if (view) return view;
        throw new NotFoundException(`Delivery ${deliveryId} not found`);
      }

      throw await this.missOf(items, chatId, deliveryId, userId);
    });
  }

  /**
   * Change the mode of one pending item (run-steering D2). The Chat row lock
   * comes first, as in admission, so the change and a Run that completes see
   * each other. With a live Run a `steer` waits for its next step boundary, and an
   * `interrupt` also sends the run-control pointer. An
   * idle Chat starts a Run for the item now, through the code a completion
   * uses; settings a send cannot use leave the item pending, as a send of
   * those settings fails.
   */
  async changeMode(
    chatId: string,
    deliveryId: string,
    mode: ChangeableDeliveryMode,
    userId: string,
  ): Promise<ChatDeliveryView> {
    const { item, job } = await retryRunTransaction(() =>
      this.tenantDb.runAs(userId, async (tx) => {
        const chat = await new ChatsRepository(tx).lock(chatId, userId);

        if (!chat) throw new NotFoundException(`Chat ${chatId} not found`);
        assertNotArchived(chat);
        const items = new ChatDeliveriesRepository(tx);
        await this.requireChangeableItem(items, chatId, deliveryId, userId);
        // The slot comes before the change: expiring a stuck Run pauses the
        // queue behind it, which would move the item changed here back to
        // `queue`.
        const slot = await this.claimSlot(tx, chatId, userId);

        const changed = await items.changePendingMode(
          chatId,
          deliveryId,
          userId,
          mode,
        );

        if (!changed)
          throw await this.missOf(items, chatId, deliveryId, userId);

        if (slot === 'blocked') {
          await notifyLiveRunSteering(
            tx,
            { chatId, userId },
            mode,
            this.runWait,
          );

          return { item: changed, job: undefined };
        }

        return this.startChangedItem(tx, changed);
      }),
    );

    if (job) await this.dispatch.dispatch(job);

    return { item, job: null };
  }

  private async requireChangeableItem(
    items: ChatDeliveriesRepository,
    chatId: string,
    deliveryId: string,
    userId: string,
  ): Promise<void> {
    const existing = await items.findById(deliveryId, userId);

    if (existing?.chatId !== chatId)
      throw new NotFoundException(`Delivery ${deliveryId} not found`);

    if (existing.producer === 'job')
      throw new BadRequestException('A job notice cannot change mode');
  }

  /** Validate owner-supplied settings before starting a changed pending item. */
  private async startChangedItem(tx: Db, changed: ChatDeliveryView['item']) {
    resolveSendSettings(
      this.models,
      this.instanceConfig.config.tools.permissionModes,
      changed.settings,
    );
    const started = await startItemRun(tx, changed);

    if (!started) throw new ConflictException('Message id already exists');

    return { item: started.delivered, job: started.job };
  }

  private claimSlot(tx: Db, chatId: string, userId: string) {
    return claimActiveRunSlot({
      tx,
      chatId,
      userId,
      dispatch: this.dispatch,
      instanceConfig: this.instanceConfig,
    });
  }

  /** 409 for an item that is no longer pending, else 404. */
  private async missOf(
    items: ChatDeliveriesRepository,
    chatId: string,
    deliveryId: string,
    userId: string,
  ): Promise<Error> {
    const existing = await items.findById(deliveryId, userId);

    return existing?.chatId === chatId
      ? new ConflictException('The item is no longer pending')
      : new NotFoundException(`Delivery ${deliveryId} not found`);
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
