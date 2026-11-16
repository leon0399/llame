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
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../../instance-config/instance-config.service';
import {
  ModelsService,
  resolveSendSettings,
  type ModelSelectionValidator,
} from '../../models/models.service';
import { planOwnerCompaction } from '../../compaction/owner-compaction-plan';
import { RunDispatchService } from '../../runs/run-dispatch.service';
import { claimActiveRunSlot } from '../chat-admission';
import { ChatsRepository, MessagesRepository } from '../chats-repository';
import {
  RunEventsRepository,
  RunsRepository,
} from '../../runs/runs-repository';
import { retryRunTransaction } from '../../runs/run-transaction';
import { TitleService } from '../../titles/title.service';
import type { PermissionMode } from '../../tools/permissions/permission-mode';
import type { ChatCommandResultResponse } from './chat-command-result.dto';
import type { ChatCommand } from './parse-chat-command';

type CompactCommandInput = {
  chatId: string;
  userId: string;
  command: Extract<ChatCommand, { name: 'compact' }>;
  parts: ReadonlyArray<{ type: 'text' | 'file' }>;
  modelId: string;
  effort?: string;
  permissionMode?: PermissionMode;
};

function parseCompactFocus(argument: string): string | null {
  if (Array.from(argument).length > 1000) {
    throw new BadRequestException(
      'Compact focus must be 1,000 characters or fewer.',
    );
  }

  return argument.length === 0 ? null : argument;
}

@Injectable()
export class ChatCommandSettings {
  constructor(
    @Inject(ModelsService)
    readonly models: ModelSelectionValidator,
    @Inject(InstanceConfigService)
    readonly instanceConfig: InstanceConfigReader,
  ) {}
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
    modelId: string;
    effort?: string;
    permissionMode?: PermissionMode;
  }): Promise<ChatCommandResultResponse | undefined> {
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
  ): Promise<ChatCommandResultResponse | undefined> {
    const run = await retryRunTransaction(() =>
      this.tenantDb.runAs(input.userId, (tx) =>
        this.admitCompactRun(tx, input),
      ),
    );

    if (!run) return undefined;

    await this.dispatch.dispatch({
      runId: run.id,
      chatId: input.chatId,
      userId: input.userId,
      modelId: run.modelId,
    });

    return { type: 'command', command: 'compact', runId: run.id };
  }

  private async admitCompactRun(
    tx: Db,
    input: CompactCommandInput,
  ): Promise<Run | undefined> {
    const chat = await new ChatsRepository(tx).lock(input.chatId, input.userId);

    if (!chat) return undefined;
    assertNotArchived(chat);

    if (input.parts.some((part) => part.type === 'file')) {
      throw new BadRequestException('A command cannot include an attachment.');
    }

    const focus = parseCompactFocus(input.command.argument);

    const { effort, permissionMode } = resolveSendSettings(
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
      throw new ConflictException('Wait for the current Run to finish.');
    }

    const { plan } = await planOwnerCompaction(
      new MessagesRepository(tx),
      input.chatId,
      input.userId,
    );

    if (plan === null) {
      throw new ConflictException('Nothing to compact.');
    }

    return this.createCompactionRun(tx, input, {
      effort,
      permissionMode,
      focus,
    });
  }


  private async createCompactionRun(
    tx: Db,
    input: CompactCommandInput,
    settings: {
      effort: string | undefined;
      permissionMode: PermissionMode | undefined;
      focus: string | null;
    },
  ): Promise<Run> {
    const { effort, permissionMode, focus } = settings;

    const run = await new RunsRepository(tx).create({
      id: randomUUID(),
      chatId: input.chatId,
      messageId: null,
      userId: input.userId,
      modelId: input.modelId,
      effort,
      permissionMode,
    });

    await new RunEventsRepository(tx).append(run.id, 'run.created', {
      chatId: input.chatId,
      messageId: null,
      compaction: { focus },
    });

    return run;
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
