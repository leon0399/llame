import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { assertNotArchived } from '../../db/assert-not-archived';
import { TenantDbService, type Db } from '../../db/tenant-db.service';
import { type Chat, type Run } from '../../db/schema';
import { InstanceConfigService } from '../../instance-config/instance-config.service';
import {
  ModelsService,
  resolveSendSettings,
  type ResolvedSendSettings,
} from '../../models/models.service';
import { type SendableDeliveryMode } from '../dto/chat-deliveries.dto';
import { planOwnerCompaction } from '../../compaction/owner-compaction-plan';
import { RunDispatchService } from '../../runs/run-dispatch.service';
import { notifyLiveRunSteering, claimActiveRunSlot } from '../chat-admission';
import { RunWaitService } from '../../runs/run-wait.service';
import { ChatsRepository, MessagesRepository } from '../chats-repository';
import { createCompactionRun, runSelectionFields } from '../run-creation';
import { storeOwnerSelection } from '../owner-selection';
import { retryRunTransaction } from '../../runs/run-transaction';
import { TitleService } from '../../titles/title.service';
import type { PermissionMode } from '../../tools/permissions/permission-mode';
import type { ChatCommandResultResponse } from './chat-command-result.dto';
import {
  type ChatCommand,
  parseChatCommand,
  validateCompactCommand,
} from './parse-chat-command';

import {
  ChatDeliveriesRepository,
  type ChatDeliveryView,
} from '../chat-deliveries.repository';

type QueuedCompactResult = { type: 'delivery'; delivery: ChatDeliveryView };

export type ChatCommandExecutionResult =
  | ChatCommandResultResponse
  | QueuedCompactResult;

type CompactCommandInput = {
  chatId: string;
  userId: string;
  command: Extract<ChatCommand, { name: 'compact' }>;
  parts: ReadonlyArray<unknown>;
  messageId: string;
  rawText: string;
  delivery?: SendableDeliveryMode;
  /** The selector the request named; absent uses the Chat's stored selection. */
  selector?: string;
  /** The effort the request named; absent follows the spec's effort order. */
  effort?: string;
  permissionMode?: PermissionMode;
};

/** What a queued `/compact` item must still store resolved: the accepted mode. */
type QueuedCompactSettings = { permissionMode: PermissionMode };

async function pendingCompactRetry(
  items: ChatDeliveriesRepository,
  input: CompactCommandInput,
): Promise<QueuedCompactResult | undefined> {
  const existing = await items.findById(input.messageId, input.userId);

  if (!existing) return undefined;

  if (
    existing.chatId !== input.chatId ||
    existing.producer !== 'owner' ||
    existing.state !== 'pending' ||
    parseChatCommand(existing.parts)?.name !== 'compact'
  ) {
    throw new ConflictException('Message id already exists');
  }

  return { type: 'delivery', delivery: { item: existing, job: null } };
}

async function queueCompactItem(
  items: ChatDeliveriesRepository,
  input: CompactCommandInput,
  settings: QueuedCompactSettings,
  mode: 'queue' | 'steer' | 'interrupt',
): Promise<QueuedCompactResult> {
  // A send never reuses the id of a stored message, as the plain send path
  // checks too.
  if (await items.messageIdTaken(input.messageId, input.userId)) {
    throw new ConflictException('Message id already exists');
  }

  const item = await items.insertPending({
    id: input.messageId,
    chatId: input.chatId,
    ownerUserId: input.userId,
    mode,
    parts: [{ type: 'text', text: input.rawText }],
    // An owner item stores only what its request named; its Run resolves the
    // selector and the effort against the Chat's selection when it starts.
    settings: {
      ...(input.selector !== undefined && { selector: input.selector }),
      ...(input.effort !== undefined && { effort: input.effort }),
      permissionMode: settings.permissionMode,
    },
  });

  if (!item) throw new ConflictException('Message id already exists');

  return { type: 'delivery', delivery: { item, job: null } };
}

async function queueBlockedCompactItem(input: {
  tx: Db;
  items: ChatDeliveriesRepository;
  command: CompactCommandInput;
  settings: QueuedCompactSettings;
  kind: 'turn' | 'compaction';
  runWait: Pick<RunWaitService, 'wakeForChatInTransaction'>;
}): Promise<QueuedCompactResult> {
  const { tx, items, command, settings, kind, runWait } = input;

  if (command.delivery === undefined) {
    throw new ConflictException('Wait for the current Run to finish.');
  }

  const mode = kind === 'compaction' ? 'queue' : command.delivery;
  const queued = await queueCompactItem(items, command, settings, mode);

  if (mode === 'steer' || mode === 'interrupt') {
    await notifyLiveRunSteering(
      tx,
      { chatId: command.chatId, userId: command.userId },
      mode,
      runWait,
    );
  }

  return queued;
}

async function createIdleCompactRun(
  tx: Db,
  input: CompactCommandInput,
  resolved: ResolvedSendSettings,
  focus: string | null,
): Promise<Run> {
  const { plan } = await planOwnerCompaction(
    new MessagesRepository(tx),
    input.chatId,
    input.userId,
  );

  if (plan === null) throw new ConflictException('Nothing to compact.');

  return createCompactionRun(tx, {
    id: randomUUID(),
    chatId: input.chatId,
    userId: input.userId,
    ...runSelectionFields(resolved),
    focus,
  });
}

@Injectable()
export class ChatCommandsService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantDbService,
    @Inject(TitleService)
    private readonly titles: Pick<TitleService, 'regenerate'>,
    @Inject(ModelsService)
    private readonly models: ModelsService,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigService,
    @Inject(RunDispatchService)
    private readonly dispatch: Pick<
      RunDispatchService,
      'dispatch' | 'jobState'
    >,
    @Inject(RunWaitService)
    private readonly runWait: Pick<RunWaitService, 'wakeForChatInTransaction'>,
  ) {}

  async execute(input: {
    chatId: string;
    userId: string;
    command: ChatCommand;
    parts: ReadonlyArray<{ type: 'text' | 'file' }>;
    messageId: string;
    rawText: string;
    delivery?: SendableDeliveryMode;
    selector?: string;
    effort?: string;
    permissionMode?: PermissionMode;
  }): Promise<ChatCommandExecutionResult | undefined> {
    const { command } = input;

    if (command.name === 'compact') {
      return this.compact({ ...input, command });
    }

    const chat = await this.findChat(input.chatId, input.userId);

    if (!chat) return undefined;

    if (input.parts.some((part) => part.type === 'file')) {
      throw new BadRequestException('A command cannot include an attachment.');
    }

    if (input.command.argument.length > 0) {
      return this.rename(input.chatId, input.userId, input.command.argument);
    }

    return this.regenerate(input.chatId, input.userId);
  }

  private async compact(
    input: CompactCommandInput,
  ): Promise<ChatCommandExecutionResult | undefined> {
    const result = await retryRunTransaction(() =>
      this.tenantDb.runAs(input.userId, (tx) =>
        this.admitCompactRun(tx, input),
      ),
    );

    if (!result || 'type' in result) return result;

    await this.dispatch.dispatch({
      runId: result.id,
      chatId: input.chatId,
      userId: input.userId,
      modelId: result.modelId,
    });

    return { type: 'command', command: 'compact', runId: result.id };
  }

  private async admitCompactRun(
    tx: Db,
    input: CompactCommandInput,
  ): Promise<Run | QueuedCompactResult | undefined> {
    const chat = await new ChatsRepository(tx).lock(input.chatId, input.userId);

    if (!chat) return undefined;

    assertNotArchived(chat);

    const focus = validateCompactCommand(input.parts, input.command.argument);
    const items = new ChatDeliveriesRepository(tx);
    const retry = await pendingCompactRetry(items, input);

    if (retry) return retry;

    const resolved = await this.storeCompactSelection(tx, chat, input);

    const blocked = await this.queueBlockedCompact(tx, input, resolved);

    if (blocked !== undefined) return blocked;

    return createIdleCompactRun(tx, input, resolved, focus);
  }

  /**
   * Design D3's `/compact` order: the Chat row is locked (caller), the
   * selector and the effort answer 422 next, and the single-flight slot
   * answers 409 last. A 422 rolls back this transaction, so a refused
   * `/compact` stores no selection and no item.
   */
  private async storeCompactSelection(
    tx: Db,
    chat: Chat,
    input: CompactCommandInput,
  ): Promise<ResolvedSendSettings> {
    const resolved = resolveSendSettings(
      this.models,
      this.instanceConfig.config.tools.permissionModes,
      {
        stored: chat.modelSelection ?? null,
        request: { selector: input.selector, effort: input.effort },
        writer: 'owner',
        permissionMode: input.permissionMode,
      },
    );

    await storeOwnerSelection(new ChatsRepository(tx), chat, resolved);

    return resolved;
  }

  /** A held slot queues the item instead; an idle one starts the Run. */
  private async queueBlockedCompact(
    tx: Db,
    input: CompactCommandInput,
    resolved: ResolvedSendSettings,
  ): Promise<QueuedCompactResult | undefined> {
    const slot = await claimActiveRunSlot({
      tx,
      chatId: input.chatId,
      userId: input.userId,
      dispatch: this.dispatch,
      instanceConfig: this.instanceConfig,
    });

    if (slot.state !== 'blocked') return undefined;

    return queueBlockedCompactItem({
      tx,
      items: new ChatDeliveriesRepository(tx),
      command: input,
      settings: { permissionMode: resolved.permissionMode },
      kind: slot.kind,
      runWait: this.runWait,
    });
  }

  private async findChat(chatId: string, userId: string): Promise<boolean> {
    return this.tenantDb.runAs(userId, async (tx) => {
      const current = await new ChatsRepository(tx).findById(chatId, userId);

      if (current) assertNotArchived(current);

      return current !== undefined;
    });
  }

  private async rename(
    chatId: string,
    userId: string,
    argument: string,
  ): Promise<ChatCommandResultResponse> {
    const title = argument;

    // Code points, as the PATCH validator counts them.
    if (Array.from(title).length > 200) {
      throw new BadRequestException(
        'A title must be between 1 and 200 characters.',
      );
    }

    const updated = await this.tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).update(chatId, userId, { title }),
    );

    if (!updated) throw new NotFoundException('Chat not found.');

    return {
      type: 'command',
      command: 'rename',
      title: updated.title ?? title,
    };
  }

  private async regenerate(
    chatId: string,
    userId: string,
  ): Promise<ChatCommandResultResponse> {
    const result = await this.titles.regenerate({ chatId, userId });

    if (result.ok) {
      return { type: 'command', command: 'rename', title: result.title };
    }

    if (result.reason === 'not_configured') {
      throw new UnprocessableEntityException(
        'Title generation is not configured.',
      );
    }

    if (result.reason === 'empty') {
      throw new ConflictException('Nothing to name.');
    }

    throw new BadGatewayException('Title generation failed.');
  }
}
