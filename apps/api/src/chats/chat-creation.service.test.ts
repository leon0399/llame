/* eslint-disable typescript/no-unsafe-assignment -- a spied repository's mock call tuple and an `expect.any` matcher are `any`; every read is asserted through the typed spy signature. */
import { NotFoundException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { MockInstance } from 'vitest';

import * as schema from '../db/schema';
import {
  type Chat,
  type Checkout,
  type Project,
  type ProjectRepository,
  type ProjectRepositoryDefault,
  type Repository,
  type WorktreeLease,
} from '../db/schema';
import { type Db, TenantDbService } from '../db/tenant-db.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import { type MachinesService } from '../machines/machines.service';
import { type MachineStatusView } from '../machines/machines-status';
import { ProjectLinksRepository } from '../projects/project-links.repository';
import { ProjectsRepository } from '../projects/projects-repository';
import { ProjectsService } from '../projects/projects.service';
import { RepositoriesRepository } from '../repositories/repositories.repository';
import { asDouble } from '../testing/support';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { ChatCreationLock } from './chat-creation-lock';
import { ChatCreationRecordRepository } from './chat-creation-record.repository';
import { ChatCreationService } from './chat-creation.service';
import { ChatCreationWorkspace } from './chat-creation-workspace';
import {
  type ChatLoopService,
  type ValidatedChatTurn,
} from './chat-loop.service';
import { type CreateChatRequest } from './dto/chat-creation.dto';
import { WorkspaceBindingRepository } from './workspace-binding.repository';

/*
 * `POST /api/v1/chats` orchestration (openspec `chat-start-location`, design
 * D9): what the route validates before any write, what it locks, the closed set
 * of Workspace outcomes it projects, when it records the link default, and when
 * it stores the first message and starts its Run.
 *
 * Every repository is spied at its own seam and the three collaborators the
 * route only calls — the lock, the Workspace step, and the chat loop — are
 * doubles; the database behavior each of them owns is proved by
 * `chat-creation.integration.test.ts` and the two unit suites beside this file.
 */

const CREATED_AT = new Date('2026-10-24T00:00:00.000Z');
const OWNER = 'owner-1';
const CHAT_ID = '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const REPOSITORY_ID = '22222222-2222-4222-8222-222222222222';
const CHECKOUT_ID = '55555555-5555-4555-8555-555555555555';
const LINK_ID = '44444444-4444-4444-8444-444444444444';
const ROOT = '/srv/llame';

function configWith(tools: Partial<LlameConfig['tools']> = {}): LlameConfig {
  return {
    ...BUILT_IN_DEFAULTS,
    tools: {
      ...BUILT_IN_DEFAULTS.tools,
      allowed: ['enter_workspace'],
      nativeExecutorId: 'host',
      ...tools,
    },
  };
}

const chat: Chat = {
  id: CHAT_ID,
  ownerUserId: OWNER,
  title: null,
  visibility: 'private',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  archivedAt: null,
  projectId: null,
  recencyDigestBaseline: null,
  recencyDigestTold: null,
  recencyDigestRebakedFrom: null,
  skillCatalogBaseline: null,
  skillCatalogRebakedFrom: null,
  skillCatalogTold: null,
  workspaceRoot: null,
  workspaceExecutorId: null,
  workspaceGeneration: 0,
  workspaceTold: null,
  workspaceToldFrom: null,
  workspaceToldAvailable: null,
  workspaceDetachReason: null,
};

function projectRow(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    ownerUserId: OWNER,
    name: 'llame',
    description: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    archivedAt: null,
    defaultExecutorId: null,
    ...overrides,
  };
}

function linkRow(
  overrides: Partial<ProjectRepository> = {},
): ProjectRepository {
  return {
    id: LINK_ID,
    ownerUserId: OWNER,
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    alias: 'llame',
    isPrimary: false,
    isolation: 'inherit',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function repositoryRow(overrides: Partial<Repository> = {}): Repository {
  return {
    id: REPOSITORY_ID,
    ownerUserId: OWNER,
    displayName: 'llame',
    canonicalRemote: 'github.com/leon0399/llame',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function checkoutRow(overrides: Partial<Checkout> = {}): Checkout {
  return {
    id: CHECKOUT_ID,
    ownerUserId: OWNER,
    repositoryId: REPOSITORY_ID,
    executorId: 'host',
    path: ROOT,
    kind: 'main',
    parentCheckoutId: null,
    branch: 'main',
    origin: 'registered',
    worktreeBase: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function leaseRow(overrides: Partial<WorktreeLease> = {}): WorktreeLease {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    ownerUserId: OWNER,
    chatId: CHAT_ID,
    checkoutId: '88888888-8888-4888-8888-888888888888',
    baseRef: 'main',
    baseCommit: 'a'.repeat(40),
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function defaultRow(): ProjectRepositoryDefault {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    ownerUserId: OWNER,
    projectRepositoryId: LINK_ID,
    executorId: 'host',
    checkoutId: CHECKOUT_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function turn(mode: ValidatedChatTurn['permissionMode'] = 'default') {
  return {
    modelId: 'system:openai:gpt-5.4',
    effort: undefined,
    permissionMode: mode,
    message: {
      id: '65f0f6e8-d5ce-4791-a222-e7a0df638810',
      parts: [{ type: 'text' as const, text: 'Start here.' }],
    },
    parts: [{ type: 'text' as const, text: 'Start here.' }],
  } satisfies ValidatedChatTurn;
}

function machineView(
  name: string,
  status: MachineStatusView['status'],
): MachineStatusView {
  return {
    name,
    status,
    lastSeenAt: null,
    failureReason: null,
    hubProtocolVersion: 1,
    daemonProtocolVersion: null,
    daemonVersion: null,
    roots: [],
  };
}

/**
 * Every repository read the route makes, at an empty catalog by default. One
 * seam, so each branch is reachable without Postgres.
 */
type RepositoryStubs = {
  readonly findChatById: MockInstance<ChatsRepository['findById']>;
  readonly createIfAbsent: MockInstance<ChatsRepository['createIfAbsent']>;
  readonly hasMessage: MockInstance<MessagesRepository['hasMessage']>;
  readonly findProject: MockInstance<ProjectsRepository['findById']>;
  readonly findChatWorktree: MockInstance<
    RepositoriesRepository['findChatWorktree']
  >;
  readonly listLinks: MockInstance<ProjectLinksRepository['listLinks']>;
  readonly findRepository: MockInstance<
    ProjectLinksRepository['findRepository']
  >;
  readonly findCheckout: MockInstance<ProjectLinksRepository['findCheckout']>;
  readonly findDefault: MockInstance<ProjectLinksRepository['findDefault']>;
  readonly findLatestDefault: MockInstance<
    ProjectLinksRepository['findLatestDefault']
  >;
  readonly listMainCheckouts: MockInstance<
    ProjectLinksRepository['listMainCheckouts']
  >;
  readonly countOpenChatsBoundTo: MockInstance<
    ProjectLinksRepository['countOpenChatsBoundTo']
  >;
  readonly findLinkByRepository: MockInstance<
    ProjectLinksRepository['findLinkByRepository']
  >;
  readonly bindAtCreation: MockInstance<
    WorkspaceBindingRepository['bindAtCreation']
  >;
  readonly findAttempts: MockInstance<
    ChatCreationRecordRepository['findAttempts']
  >;
};

function stubRepositories(): RepositoryStubs {
  const stubs: RepositoryStubs = {
    findChatById: vi
      .spyOn(ChatsRepository.prototype, 'findById')
      .mockResolvedValue(undefined),
    // A created row is readable afterwards through the same spy, which is what
    // the route's closing read does.
    createIfAbsent: vi
      .spyOn(ChatsRepository.prototype, 'createIfAbsent')
      .mockImplementation((input) => {
        const created: Chat = {
          ...chat,
          id: input.id,
          projectId: input.projectId ?? null,
        };
        stubs.findChatById.mockResolvedValue(created);
        return Promise.resolve(created);
      }),
    hasMessage: vi
      .spyOn(MessagesRepository.prototype, 'hasMessage')
      .mockResolvedValue(false),
    findProject: vi
      .spyOn(ProjectsRepository.prototype, 'findById')
      .mockResolvedValue(undefined),
    findChatWorktree: vi
      .spyOn(RepositoriesRepository.prototype, 'findChatWorktree')
      .mockResolvedValue(undefined),
    listLinks: vi
      .spyOn(ProjectLinksRepository.prototype, 'listLinks')
      .mockResolvedValue([]),
    findRepository: vi
      .spyOn(ProjectLinksRepository.prototype, 'findRepository')
      .mockResolvedValue(undefined),
    findCheckout: vi
      .spyOn(ProjectLinksRepository.prototype, 'findCheckout')
      .mockResolvedValue(undefined),
    findDefault: vi
      .spyOn(ProjectLinksRepository.prototype, 'findDefault')
      .mockResolvedValue(undefined),
    findLatestDefault: vi
      .spyOn(ProjectLinksRepository.prototype, 'findLatestDefault')
      .mockResolvedValue(undefined),
    listMainCheckouts: vi
      .spyOn(ProjectLinksRepository.prototype, 'listMainCheckouts')
      .mockResolvedValue([]),
    countOpenChatsBoundTo: vi
      .spyOn(ProjectLinksRepository.prototype, 'countOpenChatsBoundTo')
      .mockResolvedValue(0),
    findLinkByRepository: vi
      .spyOn(ProjectLinksRepository.prototype, 'findLinkByRepository')
      .mockResolvedValue(undefined),
    bindAtCreation: vi
      .spyOn(WorkspaceBindingRepository.prototype, 'bindAtCreation')
      .mockResolvedValue({ status: 'bound', generation: 1 }),
    findAttempts: vi
      .spyOn(ChatCreationRecordRepository.prototype, 'findAttempts')
      .mockResolvedValue([]),
  };
  return stubs;
}

/** A project whose single link resolves its only main checkout. */
function resolvableCatalog(stubs: RepositoryStubs) {
  stubs.findProject.mockResolvedValue(projectRow());
  stubs.listLinks.mockResolvedValue([linkRow()]);
  stubs.listMainCheckouts.mockResolvedValue([checkoutRow()]);
  stubs.findCheckout.mockResolvedValue(checkoutRow());
  stubs.findRepository.mockResolvedValue(repositoryRow());
  stubs.findLinkByRepository.mockResolvedValue(linkRow());
}

function makeService(options: {
  readonly stubs: RepositoryStubs;
  readonly machines?: ReadonlyArray<MachineStatusView>;
  readonly config?: LlameConfig;
}) {
  // Every repository the route touches is spied at its prototype, so the
  // transaction handle is never dereferenced.
  const tx = asDouble<Db>(drizzle.mock({ schema }));
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (inner: Db) => Promise<T>) => callback(tx),
  });
  vi.spyOn(tenantDb, 'runAs').mockImplementation(
    async <T>(_userId: string, callback: (scoped: Db) => Promise<T>) =>
      callback(tx),
  );
  const config = options.config ?? configWith();
  const recordProjectDefault = vi
    .spyOn(ProjectsService.prototype, 'recordProjectDefault')
    .mockResolvedValue(defaultRow());
  const listMachines = vi.fn(() => Promise.resolve(options.machines ?? []));
  const machines = asDouble<MachinesService>({ list: listMachines });
  const runExclusively = vi.fn(
    <T>(_chatId: string, run: () => Promise<T>): Promise<T> => run(),
  );
  const locks = asDouble<ChatCreationLock>({ runExclusively });
  const enter = vi.fn<ChatCreationWorkspace['enter']>(() =>
    Promise.resolve({ status: 'unbound' }),
  );
  const workspace = asDouble<ChatCreationWorkspace>({ enter });
  const validateTurn = vi.fn<ChatLoopService['validateTurn']>();
  const startFirstRun = vi.fn<ChatLoopService['startFirstRun']>(() =>
    Promise.resolve({ runId: 'run-1' }),
  );
  const chatLoop = {
    validateTurn,
    startFirstRun,
  } satisfies Pick<ChatLoopService, 'validateTurn' | 'startFirstRun'>;

  const projects = new ProjectsService(tenantDb);
  return {
    service: new ChatCreationService(
      tenantDb,
      { config },
      machines,
      projects,
      locks,
      workspace,
      chatLoop,
    ),
    runExclusively,
    enter,
    validateTurn,
    startFirstRun,
    recordProjectDefault,
    listMachines,
  };
}

function request(
  overrides: Partial<CreateChatRequest> = {},
): CreateChatRequest {
  return { id: CHAT_ID, ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatCreationService validation before any write', () => {
  it('refuses an invalid worktree argument before validating a turn or locking', async () => {
    const stubs = stubRepositories();
    const service = makeService({ stubs });

    await expect(
      service.service.create(OWNER, request({ worktree: { name: '-bad' } })),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.service.create(
        OWNER,
        request({ worktree: { baseRef: '--force' } }),
      ),
    ).rejects.toMatchObject({ status: 422 });

    expect(service.validateTurn).not.toHaveBeenCalled();
    expect(service.runExclusively).not.toHaveBeenCalled();
    expect(stubs.createIfAbsent).not.toHaveBeenCalled();
  });

  it('refuses an executor the configuration does not provide, before any turn', async () => {
    const stubs = stubRepositories();
    const service = makeService({ stubs });

    await expect(
      service.service.create(
        OWNER,
        request({ executorId: 'machine:basement' }),
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Executor machine:basement is not configured.',
        code: 'executor_unknown',
      },
    });
    expect(service.validateTurn).not.toHaveBeenCalled();
    expect(service.runExclusively).not.toHaveBeenCalled();
  });

  it('answers a rejected turn exactly as the message route does', async () => {
    const stubs = stubRepositories();
    const service = makeService({ stubs });
    service.validateTurn.mockRejectedValue(
      new NotFoundException('Model is not available'),
    );

    await expect(
      service.service.create(
        OWNER,
        request({
          message: {
            id: '65f0f6e8-d5ce-4791-a222-e7a0df638810',
            modelId: 'missing',
            parts: [{ type: 'text', text: 'hi' }],
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(service.runExclusively).not.toHaveBeenCalled();
    expect(stubs.createIfAbsent).not.toHaveBeenCalled();
  });

  it('forwards an optional effort and permission mode and omits absent ones', async () => {
    const stubs = stubRepositories();
    resolvableCatalog(stubs);
    const service = makeService({ stubs });
    service.validateTurn.mockImplementation(() => Promise.resolve(turn()));

    await service.service.create(
      OWNER,
      request({
        message: {
          id: '65f0f6e8-d5ce-4791-a222-e7a0df638810',
          modelId: 'system:openai:gpt-5.4',
          parts: [{ type: 'text', text: 'hi' }],
        },
      }),
    );
    await service.service.create(
      OWNER,
      request({
        message: {
          id: 'cc5ce18b-2f3a-4f6b-8c95-f9c6240a8f02',
          modelId: 'system:openai:gpt-5.4',
          effort: 'high',
          permissionMode: 'bypass',
          parts: [{ type: 'text', text: 'hi' }],
        },
      }),
    );

    // Strict: an absent effort and mode are omitted from the turn, not sent as
    // `undefined` keys the chat loop would have to interpret.
    expect(service.validateTurn.mock.calls[0]?.[0]).toStrictEqual({
      userId: OWNER,
      modelId: 'system:openai:gpt-5.4',
      message: {
        id: '65f0f6e8-d5ce-4791-a222-e7a0df638810',
        parts: [{ type: 'text', text: 'hi' }],
      },
    });
    expect(service.validateTurn.mock.calls[1]?.[0]).toMatchObject({
      effort: 'high',
      permissionMode: 'bypass',
    });
  });
});

describe('ChatCreationService Workspace outcomes', () => {
  it('binds the checkout, records the default, and starts the first Run', async () => {
    const stubs = stubRepositories();
    resolvableCatalog(stubs);
    const service = makeService({ stubs });
    service.validateTurn.mockResolvedValue(turn());
    service.enter.mockResolvedValue({
      status: 'bound',
      root: ROOT,
      executorId: 'host',
    });

    const response = await service.service.create(
      OWNER,
      request({
        projectId: PROJECT_ID,
        message: {
          id: '65f0f6e8-d5ce-4791-a222-e7a0df638810',
          modelId: 'system:openai:gpt-5.4',
          permissionMode: 'default',
          parts: [{ type: 'text', text: 'hi' }],
        },
      }),
    );

    expect(response).toEqual({
      chat: expect.objectContaining({ id: CHAT_ID }),
      workspace: { status: 'bound', root: ROOT, executorId: 'host' },
    });
    expect(stubs.createIfAbsent).toHaveBeenCalledWith({
      id: CHAT_ID,
      ownerUserId: OWNER,
      projectId: PROJECT_ID,
    });
    expect(service.enter).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      chatId: CHAT_ID,
      permissionMode: 'default',
      target: { executorId: 'host', machine: undefined, path: ROOT },
      checkout: checkoutRow(),
      repository: repositoryRow(),
      worktree: {},
    });
    expect(service.recordProjectDefault).toHaveBeenCalledWith(
      OWNER,
      LINK_ID,
      'host',
      CHECKOUT_ID,
    );
    expect(service.startFirstRun).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      userId: OWNER,
      turn: expect.objectContaining({ permissionMode: 'default' }),
    });
    expect(stubs.bindAtCreation).not.toHaveBeenCalled();
  });

  it('uses `default` for an omitted mode and starts no Run without a message', async () => {
    const stubs = stubRepositories();
    resolvableCatalog(stubs);
    const service = makeService({ stubs });
    service.enter.mockResolvedValue({ status: 'bound', root: ROOT });

    await service.service.create(OWNER, request({ projectId: PROJECT_ID }));

    expect(service.enter).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: 'default' }),
    );
    expect(service.startFirstRun).not.toHaveBeenCalled();
  });

  it('stores the message on an unbound start and starts its Run', async () => {
    const stubs = stubRepositories();
    const service = makeService({ stubs });
    service.validateTurn.mockResolvedValue(turn());
    service.enter.mockResolvedValue({ status: 'unbound' });

    const response = await service.service.create(
      OWNER,
      request({
        message: {
          id: '65f0f6e8-d5ce-4791-a222-e7a0df638810',
          modelId: 'system:openai:gpt-5.4',
          parts: [{ type: 'text', text: 'hi' }],
        },
      }),
    );

    expect(response.workspace).toEqual({ status: 'unbound' });
    expect(service.startFirstRun).toHaveBeenCalledTimes(1);
    expect(service.recordProjectDefault).not.toHaveBeenCalled();
    // No location resolved, so the Workspace step never ran.
    expect(service.enter).not.toHaveBeenCalled();
  });

  it('stores no message and starts no Run on a failed Workspace', async () => {
    const stubs = stubRepositories();
    resolvableCatalog(stubs);
    const service = makeService({ stubs });
    service.validateTurn.mockResolvedValue(turn());
    service.enter.mockResolvedValue({
      status: 'bind_failed',
      code: 'permission_denied',
      message: 'The path is not admitted.',
    });

    const response = await service.service.create(
      OWNER,
      request({
        projectId: PROJECT_ID,
        message: {
          id: '65f0f6e8-d5ce-4791-a222-e7a0df638810',
          modelId: 'system:openai:gpt-5.4',
          parts: [{ type: 'text', text: 'hi' }],
        },
      }),
    );

    expect(response.workspace).toEqual({
      status: 'bind_failed',
      code: 'permission_denied',
      message: 'The path is not admitted.',
    });
    expect(service.startFirstRun).not.toHaveBeenCalled();
    expect(service.recordProjectDefault).not.toHaveBeenCalled();
  });

  it('answers 409 when the Chat gained a message under the lock', async () => {
    const stubs = stubRepositories();
    resolvableCatalog(stubs);
    const service = makeService({ stubs });
    service.validateTurn.mockResolvedValue(turn());
    service.enter.mockResolvedValue({ status: 'conflict' });

    await expect(
      service.service.create(
        OWNER,
        request({
          projectId: PROJECT_ID,
          message: {
            id: '65f0f6e8-d5ce-4791-a222-e7a0df638810',
            modelId: 'system:openai:gpt-5.4',
            parts: [{ type: 'text', text: 'hi' }],
          },
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        statusCode: 409,
        error: 'Conflict',
        message:
          'The Chat already holds a message, a Run, or another bound root.',
      },
    });
    expect(service.startFirstRun).not.toHaveBeenCalled();
    expect(service.recordProjectDefault).not.toHaveBeenCalled();
  });

  it('leaves a failed enqueue to fail the request after the rows commit', async () => {
    const stubs = stubRepositories();
    resolvableCatalog(stubs);
    const service = makeService({ stubs });
    service.validateTurn.mockResolvedValue(turn());
    service.enter.mockResolvedValue({ status: 'bound', root: ROOT });
    service.startFirstRun.mockRejectedValue(new Error('queue unavailable'));

    await expect(
      service.service.create(
        OWNER,
        request({
          projectId: PROJECT_ID,
          message: {
            id: '65f0f6e8-d5ce-4791-a222-e7a0df638810',
            modelId: 'system:openai:gpt-5.4',
            parts: [{ type: 'text', text: 'hi' }],
          },
        }),
      ),
    ).rejects.toThrow('queue unavailable');
    // The default was already recorded for the bound start.
    expect(service.recordProjectDefault).toHaveBeenCalledTimes(1);
  });
});

describe('ChatCreationService owner isolation', () => {
  it('answers 404 for a project the owner does not have and stores no chat', async () => {
    const stubs = stubRepositories();
    const service = makeService({ stubs });

    await expect(
      service.service.create(OWNER, request({ projectId: PROJECT_ID })),
    ).rejects.toMatchObject({
      status: 404,
      response: { message: `Project ${PROJECT_ID} not found` },
    });
    expect(stubs.createIfAbsent).not.toHaveBeenCalled();
  });

  it('answers 409 for an archived project and stores no chat', async () => {
    const stubs = stubRepositories();
    stubs.findProject.mockResolvedValue(projectRow({ archivedAt: CREATED_AT }));
    const service = makeService({ stubs });

    await expect(
      service.service.create(OWNER, request({ projectId: PROJECT_ID })),
    ).rejects.toMatchObject({ status: 409 });
    expect(stubs.createIfAbsent).not.toHaveBeenCalled();
  });

  it('answers 404 for a chat id that resolves to no owner row', async () => {
    const stubs = stubRepositories();
    stubs.createIfAbsent.mockResolvedValue(undefined);
    const service = makeService({ stubs });

    await expect(
      service.service.create(OWNER, request()),
    ).rejects.toMatchObject({
      status: 404,
      response: { message: `Chat ${CHAT_ID} not found` },
    });
  });
});

describe('ChatCreationService resend rules', () => {
  it('refuses a stored chat that already holds a message', async () => {
    const stubs = stubRepositories();
    stubs.findChatById.mockResolvedValue({ ...chat });
    stubs.hasMessage.mockResolvedValue(true);
    const service = makeService({ stubs });

    await expect(
      service.service.create(OWNER, request()),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        statusCode: 409,
        error: 'Conflict',
        message:
          'The Chat already holds a message; send the draft through the message route.',
      },
    });
    expect(stubs.createIfAbsent).not.toHaveBeenCalled();
  });

  it('refuses an archived stored chat', async () => {
    const stubs = stubRepositories();
    stubs.findChatById.mockResolvedValue({ ...chat, archivedAt: CREATED_AT });
    const service = makeService({ stubs });

    await expect(
      service.service.create(OWNER, request()),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        statusCode: 409,
        error: 'Conflict',
        message: 'The Chat is archived; unarchive it first.',
      },
    });
  });

  it('names a project mismatch with its body code', async () => {
    const stubs = stubRepositories();
    stubs.findChatById.mockResolvedValue({ ...chat, projectId: PROJECT_ID });
    const service = makeService({ stubs });

    await expect(
      service.service.create(
        OWNER,
        request({
          projectId: '99999999-9999-4999-8999-999999999999',
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        statusCode: 409,
        error: 'Conflict',
        message: 'The stored Chat belongs to another project.',
        code: 'project_mismatch',
      },
    });
  });

  it('keeps a stored bound root and runs the remaining steps', async () => {
    const stubs = stubRepositories();
    stubs.findChatById.mockResolvedValue({
      ...chat,
      workspaceRoot: ROOT,
      workspaceExecutorId: 'host',
      workspaceGeneration: 1,
    });
    const service = makeService({ stubs });
    service.validateTurn.mockResolvedValue(turn());

    const response = await service.service.create(
      OWNER,
      request({
        message: {
          id: '65f0f6e8-d5ce-4791-a222-e7a0df638810',
          modelId: 'system:openai:gpt-5.4',
          parts: [{ type: 'text', text: 'hi' }],
        },
      }),
    );

    expect(response.workspace).toEqual({
      status: 'bound',
      root: ROOT,
      executorId: 'host',
    });
    expect(service.enter).not.toHaveBeenCalled();
    expect(stubs.createIfAbsent).not.toHaveBeenCalled();
    expect(stubs.bindAtCreation).not.toHaveBeenCalled();
    expect(service.startFirstRun).toHaveBeenCalledTimes(1);
  });

  it('reports the worktree only for the root its own lease names', async () => {
    const worktreeRow = checkoutRow({
      id: '88888888-8888-4888-8888-888888888888',
      kind: 'worktree',
      path: '/srv/.llame-worktrees/llame/one',
      branch: 'llame/one',
      origin: 'created',
    });
    const stubs = stubRepositories();
    stubs.findChatWorktree.mockResolvedValue({
      lease: leaseRow(),
      checkout: worktreeRow,
    });
    stubs.findChatById.mockResolvedValue({
      ...chat,
      workspaceRoot: worktreeRow.path,
      workspaceExecutorId: 'host',
    });
    const bound = makeService({ stubs });

    await expect(bound.service.create(OWNER, request())).resolves.toMatchObject(
      {
        workspace: {
          status: 'bound',
          root: worktreeRow.path,
          worktree: { path: worktreeRow.path, branch: 'llame/one' },
        },
      },
    );

    // A stored root the lease does not name is reported bare: the worktree it
    // would print belongs to another root.
    stubs.findChatById.mockResolvedValue({
      ...chat,
      workspaceRoot: ROOT,
      workspaceExecutorId: 'host',
    });
    const bare = makeService({ stubs });

    const bareResponse = await bare.service.create(OWNER, request());

    expect(bareResponse.workspace).toStrictEqual({
      status: 'bound',
      root: ROOT,
      executorId: 'host',
    });
  });

  it('rebinds a creation lease and reports its worktree', async () => {
    const stubs = stubRepositories();
    const worktreeRow = checkoutRow({
      id: '88888888-8888-4888-8888-888888888888',
      kind: 'worktree',
      path: '/srv/.llame-worktrees/llame/one',
      branch: 'llame/one',
      parentCheckoutId: CHECKOUT_ID,
      origin: 'created',
    });
    stubs.findChatById.mockResolvedValue({ ...chat });
    stubs.findChatWorktree.mockResolvedValue({
      lease: leaseRow(),
      checkout: worktreeRow,
    });
    const service = makeService({ stubs });

    const response = await service.service.create(OWNER, request());

    expect(response.workspace).toEqual({
      status: 'bound',
      root: worktreeRow.path,
      executorId: 'host',
      worktree: {
        path: worktreeRow.path,
        branch: 'llame/one',
        baseCommit: 'a'.repeat(40),
      },
    });
    expect(stubs.bindAtCreation).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      ownerUserId: OWNER,
      executorId: 'host',
      root: worktreeRow.path,
    });
    expect(service.enter).not.toHaveBeenCalled();
  });

  it('answers 404 when the lease bind finds no Chat row', async () => {
    const stubs = stubRepositories();
    stubs.findChatById.mockResolvedValue({ ...chat });
    stubs.findChatWorktree.mockResolvedValue({
      lease: leaseRow(),
      checkout: checkoutRow({ kind: 'worktree' }),
    });
    stubs.bindAtCreation.mockResolvedValue({ status: 'not_found' });
    const service = makeService({ stubs });

    await expect(
      service.service.create(OWNER, request()),
    ).rejects.toMatchObject({
      status: 404,
      response: { message: `Chat ${CHAT_ID} not found` },
    });
  });

  it('answers 409 when the lease rebind finds a message', async () => {
    const stubs = stubRepositories();
    stubs.findChatById.mockResolvedValue({ ...chat });
    stubs.findChatWorktree.mockResolvedValue({
      lease: leaseRow(),
      checkout: checkoutRow({ kind: 'worktree' }),
    });
    stubs.bindAtCreation.mockResolvedValue({ status: 'conflict' });
    const service = makeService({ stubs });

    await expect(
      service.service.create(OWNER, request()),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('ChatCreationService getCreationRecord', () => {
  it('projects every recorded decision with its provenance', async () => {
    const stubs = stubRepositories();
    stubs.findChatById.mockResolvedValue({ ...chat });
    stubs.findAttempts.mockResolvedValue([
      {
        createdAt: '2026-10-24T00:00:00.000Z',
        decisions: [
          {
            path: ROOT,
            decision: {
              policyId: 'policy-1',
              decision: 'allow',
              reason: 'matched_allow',
              reference: {
                groupId: 'enter_workspace',
                list: 'allow',
                clauseIndex: 0,
              },
            },
          },
        ],
      },
    ]);
    const service = makeService({ stubs });

    await expect(
      service.service.getCreationRecord(OWNER, CHAT_ID),
    ).resolves.toEqual({
      chatId: CHAT_ID,
      attempts: [
        {
          createdAt: '2026-10-24T00:00:00.000Z',
          decisions: [
            {
              path: ROOT,
              policyId: 'policy-1',
              decision: 'allow',
              reason: 'matched_allow',
              reference: {
                groupId: 'enter_workspace',
                list: 'allow',
                clauseIndex: 0,
              },
            },
          ],
        },
      ],
    });
  });

  it('answers 404 for a chat the caller does not own, disclosing nothing', async () => {
    const stubs = stubRepositories();
    const service = makeService({ stubs });

    await expect(
      service.service.getCreationRecord(OWNER, CHAT_ID),
    ).rejects.toMatchObject({
      status: 404,
      response: { message: `Chat ${CHAT_ID} not found` },
    });
    expect(stubs.findAttempts).not.toHaveBeenCalled();
  });
});

describe('ChatCreationService offline executors', () => {
  it('answers machine_unavailable for an explicit offline Machine', async () => {
    const stubs = stubRepositories();
    resolvableCatalog(stubs);
    stubs.findCheckout.mockResolvedValue(
      checkoutRow({ executorId: 'machine:nas' }),
    );
    stubs.listMainCheckouts.mockResolvedValue([
      checkoutRow({ executorId: 'machine:nas' }),
    ]);
    const service = makeService({
      stubs,
      machines: [machineView('nas', 'offline')],
      config: {
        ...configWith(),
        machines: {
          ssh: { knownHostsFile: '/dev/null' },
          hosts: { nas: { destination: 'nas.example' } },
        },
      },
    });

    const response = await service.service.create(
      OWNER,
      request({ projectId: PROJECT_ID, executorId: 'machine:nas' }),
    );

    expect(response.workspace).toMatchObject({
      status: 'machine_unavailable',
      message: expect.stringContaining('machine:nas'),
    });
    expect(service.enter).not.toHaveBeenCalled();
  });

  it('refuses a worktree checkout as the start of a chat', async () => {
    const stubs = stubRepositories();
    resolvableCatalog(stubs);
    stubs.findCheckout.mockResolvedValue(checkoutRow({ kind: 'worktree' }));
    const service = makeService({ stubs });

    await expect(
      service.service.create(OWNER, request({ projectId: PROJECT_ID })),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        statusCode: 422,
        error: 'Unprocessable Entity',
        message:
          'A worktree checkout cannot start a chat; name its main checkout.',
      },
    });
    expect(service.enter).not.toHaveBeenCalled();
  });

  it('drops an offline project default so the implicit step skips it', async () => {
    const stubs = stubRepositories();
    stubs.findProject.mockResolvedValue(
      projectRow({ defaultExecutorId: 'machine:nas' }),
    );
    stubs.listLinks.mockResolvedValue([linkRow()]);
    stubs.listMainCheckouts.mockResolvedValue([
      checkoutRow({ executorId: 'machine:nas' }),
      checkoutRow({ id: 'other-checkout', executorId: 'host' }),
    ]);
    stubs.findCheckout.mockImplementation((_owner, checkoutId) =>
      Promise.resolve(
        checkoutId === 'other-checkout'
          ? checkoutRow({ id: 'other-checkout' })
          : undefined,
      ),
    );
    stubs.findRepository.mockResolvedValue(repositoryRow());
    const service = makeService({
      stubs,
      machines: [machineView('nas', 'offline')],
      config: {
        ...configWith(),
        machines: {
          ssh: { knownHostsFile: '/dev/null' },
          hosts: { nas: { destination: 'nas.example' } },
        },
      },
    });
    service.enter.mockResolvedValue({ status: 'bound', root: ROOT });

    await service.service.create(OWNER, request({ projectId: PROJECT_ID }));

    // The create's own source drops the offline Machine before the resolver
    // sorts, so the local executor wins the implicit step.
    expect(service.enter).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { executorId: 'host', machine: undefined, path: ROOT },
      }),
    );
  });
});
