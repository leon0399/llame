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
import { type Run } from '../../db/schema';
import { InstanceConfigService } from '../../instance-config/instance-config.service';
import {
  ModelsService,
  resolveSendSettings,
} from '../../models/models.service';
import { type SendableDeliveryMode } from '../dto/chat-deliveries.dto';
import { planOwnerCompaction } from '../../compaction/owner-compaction-plan';
import { RunDispatchService } from '../../runs/run-dispatch.service';
import { claimActiveRunSlot } from '../chat-admission';
import { ChatsRepository, MessagesRepository } from '../chats-repository';
import { createCompactionRun } from '../run-creation';
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

type CompactSendSettings = ReturnType<typeof resolveSendSettings>;

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
  modelId: string;
  effort?: string;
  permissionMode?: PermissionMode;
};

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
  settings: CompactSendSettings,
): Promise<QueuedCompactResult> {
  if (input.delivery === undefined) {
    throw new ConflictException('Wait for the current Run to finish.');
  }

  // A send never reuses the id of a stored message, as the plain send path
  // checks too.
  if (await items.messageIdTaken(input.messageId, input.userId)) {
    throw new ConflictException('Message id already exists');
  }

  const item = await items.insertPending({
    id: input.messageId,
    chatId: input.chatId,
    ownerUserId: input.userId,
    mode: 'queue',
    parts: [{ type: 'text', text: input.rawText }],
    settings: {
      modelId: input.modelId,
      ...(settings.effort !== undefined && { effort: settings.effort }),
      permissionMode: settings.permissionMode,
    },
  });

  if (!item) throw new ConflictException('Message id already exists');

  return { type: 'delivery', delivery: { item, job: null } };
}

async function createIdleCompactRun(
  tx: Db,
  input: CompactCommandInput,
  settings: CompactSendSettings,
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
    modelId: input.modelId,
    effort: settings.effort,
    permissionMode: settings.permissionMode,
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
  ) {}

  async execute(input: {
    chatId: string;
    userId: string;
    command: ChatCommand;
    parts: ReadonlyArray<{ type: 'text' | 'file' }>;
    messageId: string;
    rawText: string;
    delivery?: SendableDeliveryMode;
    modelId: string;
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

    const settings = resolveSendSettings(
      this.models,
      this.instanceConfig.config.tools.permissionModes,
      input,
    );

    const slot = await claimActiveRunSlot({
      tx,
      chatId: input.chatId,
      userId: input.userId,
      dispatch: this.dispatch,
      instanceConfig: this.instanceConfig,
    });

    if (slot.state === 'blocked') {
      return queueCompactItem(items, input, settings);
    }

    return createIdleCompactRun(tx, input, settings, focus);
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
