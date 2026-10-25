import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { assertNotArchived } from '../db/assert-not-archived';
import {
  type Chat,
  type Checkout,
  type Project,
  type Repository,
} from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { MachinesService } from '../machines/machines.service';
import { ProjectLinksRepository } from '../projects/project-links.repository';
import { ProjectsRepository } from '../projects/projects-repository';
import { ProjectsService } from '../projects/projects.service';
import {
  resolveStartLocation,
  type StartLocation,
} from '../projects/start-location';
import { RepositoriesRepository } from '../repositories/repositories.repository';
import {
  readWorktreeRequest,
  type WorktreeRequest,
} from '../tools/workspace-worktree';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import {
  type ChatCreationRecordResponse,
  type CreateChatRequest,
  type CreateChatResponse,
  toWorkspaceResponse,
} from './dto/chat-creation.dto';
import { toChatResponse } from './dto/chats.dto';
import {
  creationLocationSource,
  executorOnline,
  executorTarget,
  isConfiguredExecutor,
} from './chat-creation-executors';
import {
  type AdmitContext,
  type AdmittedChat,
  type CreationLease,
} from './chat-creation-admission';
import { recordCreationDefault } from './chat-creation-defaults';
import {
  recordedWorktreeUnknown,
  storedBinding,
  worktreeOf,
} from './chat-creation-outcomes';
import { ChatCreationLock } from './chat-creation-lock';
import { ChatCreationRecordRepository } from './chat-creation-record.repository';
import {
  ChatCreationWorkspace,
  type CreationWorkspaceResult,
} from './chat-creation-workspace';
import { ChatLoopService, type ValidatedChatTurn } from './chat-loop.service';
import { WorkspaceBindingRepository } from './workspace-binding.repository';

/*
 * `POST /api/v1/chats` (openspec `chat-start-location`, design D9): one request
 * that files a chat, resolves its location, authorizes the Workspace, creates
 * the requested worktree, stores the first message, and starts its Run — in
 * that order, with each failure answering the status it caused.
 *
 * The session lock spans the whole request; every step keeps its own
 * transaction, so a step that fails leaves the previous ones committed and the
 * chat filed and unbound.
 */

@Injectable()
export class ChatCreationService {
  private readonly logger = new Logger(ChatCreationService.name);

  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(InstanceConfigService)
    private readonly config: Pick<InstanceConfigService, 'config'>,
    private readonly machines: MachinesService,
    private readonly projects: ProjectsService,
    private readonly locks: ChatCreationLock,
    private readonly workspace: ChatCreationWorkspace,
    @Inject(ChatLoopService)
    private readonly chatLoop: Pick<
      ChatLoopService,
      'validateTurn' | 'startFirstRun'
    >,
  ) {}

  async create(
    userId: string,
    input: CreateChatRequest,
  ): Promise<CreateChatResponse> {
    // Presence decides, not the fields: an omitted `worktree` reuses the
    // checkout, and an empty one asks for a generated worktree.
    const worktree =
      input.worktree === undefined
        ? undefined
        : readWorktreeRequest(input.worktree);
    if (worktree !== undefined && 'message' in worktree) {
      throw new UnprocessableEntityException(worktree.message);
    }
    if (
      input.executorId !== undefined &&
      !isConfiguredExecutor(input.executorId, this.config.config)
    ) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: `Executor ${input.executorId} is not configured.`,
        code: 'executor_unknown',
      });
    }
    // Every message check runs before any write, and before the lock: a bad
    // model, effort, mode, part, or foreign media stores nothing.
    const turn =
      input.message === undefined
        ? undefined
        : await this.chatLoop.validateTurn({
            userId,
            modelId: input.message.modelId,
            ...(input.message.effort !== undefined && {
              effort: input.message.effort,
            }),
            ...(input.message.permissionMode !== undefined && {
              permissionMode: input.message.permissionMode,
            }),
            message: { id: input.message.id, parts: input.message.parts },
          });

    return this.locks.runExclusively(input.id, () =>
      this.createLocked(userId, input, worktree, turn),
    );
  }

  /** The owner's creation record: one entry per attempt, newest last. */
  async getCreationRecord(
    userId: string,
    chatId: string,
  ): Promise<ChatCreationRecordResponse> {
    return this.tenantDb.runAs(userId, async (tx) => {
      const chat = await new ChatsRepository(tx).findById(chatId, userId);
      if (chat === undefined) {
        throw new NotFoundException(`Chat ${chatId} not found`);
      }
      const attempts = await new ChatCreationRecordRepository(tx).findAttempts(
        userId,
        chatId,
      );
      return {
        chatId,
        attempts: attempts.map((attempt) => ({
          createdAt: attempt.createdAt,
          decisions: attempt.decisions.map(({ path, decision }) => ({
            path,
            policyId: decision.policyId,
            decision: decision.decision,
            reason: decision.reason,
            reference: decision.reference,
          })),
        })),
      };
    });
  }

  /**
   * The whole request under the Chat's creation lock: admit the Chat and its
   * location, run the Workspace step, store the message, and record the
   * default. A failure answers the status it caused and stores no message.
   */
  private async createLocked(
    userId: string,
    input: CreateChatRequest,
    worktree: WorktreeRequest | undefined,
    turn: ValidatedChatTurn | undefined,
  ): Promise<CreateChatResponse> {
    const admitted = await this.admitChat(userId, input);
    const workspace = await this.enterWorkspace(
      userId,
      admitted,
      worktree,
      turn,
    );

    if (workspace.status === 'conflict') {
      throw new ConflictException(
        'The Chat already holds a message, a Run, or another bound root.',
      );
    }
    if (workspace.status === 'bound') {
      await this.writeBackDefault(userId, admitted);
    }
    // Only a bound or an unresolved start accepts the message: every failure
    // keeps the chat filed and unbound, stores no message, and starts no Run.
    if (
      turn !== undefined &&
      (workspace.status === 'bound' || workspace.status === 'unbound')
    ) {
      await this.chatLoop.startFirstRun({ chatId: input.id, userId, turn });
    }

    const chat = await this.readChat(userId, input.id);
    return {
      chat: toChatResponse(chat),
      workspace: toWorkspaceResponse(workspace),
    };
  }

  /** The link default of a successful start, written back after the commit. */
  private async writeBackDefault(
    userId: string,
    admitted: AdmittedChat,
  ): Promise<void> {
    await recordCreationDefault(
      { logger: this.logger, tenantDb: this.tenantDb, projects: this.projects },
      {
        ownerUserId: userId,
        chatId: admitted.chat.id,
        project: admitted.project,
        location: admitted.location,
      },
    );
  }

  /**
   * Read or insert the Chat and resolve its location in ONE transaction: the
   * project, repository, and checkout the request names are validated under
   * owner RLS before the insert, and an archived project refuses the Chat.
   */
  private async admitChat(
    userId: string,
    input: CreateChatRequest,
  ): Promise<AdmittedChat> {
    const machines = await this.machines.list(userId);
    const online = (executorId: string): boolean =>
      executorOnline(executorId, { config: this.config.config, machines });
    return this.tenantDb.runAs(userId, (tx) =>
      this.admitIn({ tx, userId, input, online }),
    );
  }

  private async admitIn(context: AdmitContext): Promise<AdmittedChat> {
    const chatsRepo = new ChatsRepository(context.tx);
    const stored = await chatsRepo.findById(context.input.id, context.userId);
    if (stored === undefined) return this.admitNew(context);
    await this.assertResend(context.input, stored, context.tx);
    return this.admitStored(context, stored);
  }

  private async admitStored(
    context: AdmitContext,
    stored: Chat,
  ): Promise<AdmittedChat> {
    const project = await this.readProject(
      context.tx,
      context.userId,
      stored.projectId ?? undefined,
    );
    const lease =
      (await new RepositoriesRepository(context.tx).findChatWorktree(
        context.userId,
        stored.id,
      )) ?? null;
    if (stored.workspaceRoot !== null || lease !== null) {
      return {
        chat: stored,
        project,
        location: null,
        lease,
        recordedWorktree: null,
        online: context.online,
      };
    }
    // Nothing committed: an earlier attempt may still have added a worktree
    // before its transaction rolled back.
    const recordedWorktree =
      (await new ChatCreationRecordRepository(
        context.tx,
      ).findRecordedWorktreeDirectory(context.userId, stored.id)) ?? null;
    return {
      chat: stored,
      project,
      location:
        recordedWorktree === null
          ? await this.resolveLocation(context, project)
          : null,
      lease: null,
      recordedWorktree,
      online: context.online,
    };
  }

  private async admitNew(context: AdmitContext): Promise<AdmittedChat> {
    const project = await this.readProject(
      context.tx,
      context.userId,
      context.input.projectId,
    );
    const location = await this.resolveLocation(context, project);
    const chatsRepo = new ChatsRepository(context.tx);
    const chat = await chatsRepo.createIfAbsent({
      id: context.input.id,
      ownerUserId: context.userId,
      ...(project !== null && { projectId: project.id }),
    });
    if (chat !== undefined) {
      return {
        chat,
        project,
        location,
        lease: null,
        recordedWorktree: null,
        online: context.online,
      };
    }

    // The id is taken: by our own concurrent row (re-read it) or by another
    // owner, whose row stays invisible and answers 404 without disclosure.
    const concurrent = await chatsRepo.findById(
      context.input.id,
      context.userId,
    );
    if (concurrent === undefined) {
      throw new NotFoundException(`Chat ${context.input.id} not found`);
    }
    await this.assertResend(context.input, concurrent, context.tx);
    return {
      chat: concurrent,
      project,
      location,
      lease: null,
      recordedWorktree: null,
      online: context.online,
    };
  }

  /** The rules one create request must meet against an already-stored Chat. */
  private async assertResend(
    input: CreateChatRequest,
    stored: Chat,
    tx: Db,
  ): Promise<void> {
    if (stored.archivedAt !== null) {
      throw new ConflictException('The Chat is archived; unarchive it first.');
    }
    if (input.projectId !== undefined && stored.projectId !== input.projectId) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'The stored Chat belongs to another project.',
        code: 'project_mismatch',
      });
    }
    if (await new MessagesRepository(tx).hasMessage(stored.id)) {
      throw new ConflictException(
        'The Chat already holds a message; send the draft through the message route.',
      );
    }
  }

  /** The Chat's project, asserting it is the owner's and not archived. */
  private async readProject(
    tx: Db,
    userId: string,
    projectId: string | undefined,
  ): Promise<Project | null> {
    if (projectId === undefined) return null;
    const project = await new ProjectsRepository(tx).findById(
      projectId,
      userId,
    );
    if (project === undefined) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    assertNotArchived(project);
    return project;
  }

  /**
   * The one start-location resolver, with the create route's configuration
   * checks: an offline project default is dropped from its step rather than
   * answered as unavailable, and an implicit executor step sees only online
   * executors. The location is opt-in: a request that names no repository,
   * executor, or checkout starts unbound, whatever the project defaults, and a
   * worktree needs a named source.
   */
  private async resolveLocation(
    context: AdmitContext,
    project: Project | null,
  ): Promise<StartLocation | null> {
    const { input } = context;
    if (
      input.repositoryId === undefined &&
      input.executorId === undefined &&
      input.checkoutId === undefined
    ) {
      if (input.worktree !== undefined) {
        throw new UnprocessableEntityException(
          'A worktree needs a repository, executor, or checkout to start from.',
        );
      }
      return null;
    }
    const offlineDefault =
      project?.defaultExecutorId !== null &&
      project?.defaultExecutorId !== undefined &&
      !context.online(project.defaultExecutorId);
    return resolveStartLocation(
      creationLocationSource(context.tx, context.online),
      context.userId,
      offlineDefault ? { ...project, defaultExecutorId: null } : project,
      {
        ...(context.input.repositoryId !== undefined && {
          repositoryId: context.input.repositoryId,
        }),
        ...(context.input.executorId !== undefined && {
          executorId: context.input.executorId,
        }),
        ...(context.input.checkoutId !== undefined && {
          checkoutId: context.input.checkoutId,
        }),
      },
    );
  }

  /** The Workspace step of one request, in the response's closed status set. */
  private async enterWorkspace(
    userId: string,
    admitted: AdmittedChat,
    worktree: WorktreeRequest | undefined,
    turn: ValidatedChatTurn | undefined,
  ): Promise<CreationWorkspaceResult> {
    const { chat, lease } = admitted;
    if (chat.workspaceRoot !== null) {
      return storedBinding(chat.workspaceRoot, chat.workspaceExecutorId, lease);
    }
    if (lease !== null) return this.rebindLease(userId, chat, lease);
    if (admitted.recordedWorktree !== null) {
      return recordedWorktreeUnknown(admitted.recordedWorktree);
    }
    return this.enterLocated(userId, admitted, worktree, turn);
  }

  /** The bind or worktree the resolved location decides, on an online executor. */
  private async enterLocated(
    userId: string,
    admitted: AdmittedChat,
    worktree: WorktreeRequest | undefined,
    turn: ValidatedChatTurn | undefined,
  ): Promise<CreationWorkspaceResult> {
    const located = await this.readLocated(userId, admitted.location);
    if (located === null) return { status: 'unbound' };
    // An implicit step never reaches an offline executor (the resolver saw only
    // online ones), so this is an explicit, named, or remembered executor.
    if (!admitted.online(located.executorId)) {
      return {
        status: 'machine_unavailable',
        message: `The executor ${located.executorId} is offline.`,
      };
    }

    const target = executorTarget(located.executorId, located.checkout.path);
    if (target === undefined) {
      return {
        status: 'bind_failed',
        code: 'not_found',
        message: 'The resolved checkout does not belong to its executor.',
      };
    }
    return this.workspace.enter({
      ownerUserId: userId,
      chatId: admitted.chat.id,
      permissionMode: turn?.permissionMode ?? 'default',
      target,
      checkout: located.checkout,
      repository: located.repository,
      worktree,
    });
  }

  /**
   * The resolved checkout and repository rows, or null when no location
   * resolved. A `main` row is the only source a start may bind.
   */
  private async readLocated(
    userId: string,
    location: StartLocation | null,
  ): Promise<{
    readonly checkout: Checkout;
    readonly repository: Repository;
    readonly executorId: string;
  } | null> {
    const executorId = location?.executorId ?? null;
    const checkoutId = location?.checkoutId ?? null;
    const repositoryId = location?.repositoryId ?? null;
    if (executorId === null || checkoutId === null) return null;

    const located = await this.readCheckoutAndRepository(
      userId,
      checkoutId,
      repositoryId,
    );
    if (located.checkout === undefined || located.repository === undefined) {
      throw new NotFoundException(
        'The resolved checkout or repository no longer exists.',
      );
    }
    if (located.checkout.kind !== 'main') {
      throw new UnprocessableEntityException(
        'A worktree checkout cannot start a chat; name its main checkout.',
      );
    }
    return {
      checkout: located.checkout,
      repository: located.repository,
      executorId,
    };
  }

  /** The two rows a resolved location names, read in one transaction. */
  private async readCheckoutAndRepository(
    userId: string,
    checkoutId: string,
    repositoryId: string | null,
  ): Promise<{ checkout?: Checkout; repository?: Repository }> {
    return this.tenantDb.runAs(userId, async (tx) => {
      const links = new ProjectLinksRepository(tx);
      return {
        checkout: await links.findCheckout(userId, checkoutId),
        repository:
          repositoryId === null
            ? undefined
            : await links.findRepository(userId, repositoryId),
      };
    });
  }

  /** A resend with a creation lease reuses that worktree and root. */
  private async rebindLease(
    userId: string,
    chat: Chat,
    lease: CreationLease,
  ): Promise<CreationWorkspaceResult> {
    const result = await this.tenantDb.runAs(userId, (tx) =>
      new WorkspaceBindingRepository(tx).bindAtCreation({
        chatId: chat.id,
        ownerUserId: userId,
        executorId: lease.checkout.executorId,
        root: lease.checkout.path,
      }),
    );
    if (result.status === 'conflict') return { status: 'conflict' };
    if (result.status === 'not_found') {
      throw new NotFoundException(`Chat ${chat.id} not found`);
    }
    return {
      status: 'bound',
      root: lease.checkout.path,
      executorId: lease.checkout.executorId,
      worktree: worktreeOf(lease),
    };
  }

  private async readChat(userId: string, chatId: string): Promise<Chat> {
    const chat = await this.tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).findById(chatId, userId),
    );
    if (chat === undefined) {
      throw new NotFoundException(`Chat ${chatId} not found`);
    }
    return chat;
  }
}
