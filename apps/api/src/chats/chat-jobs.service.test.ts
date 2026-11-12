import { ConflictException, NotFoundException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Chat, type ChatJob } from '../db/schema';
import { type TenantRunner } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { ChatJobsService } from './chat-jobs.service';
import { ChatsRepository } from './chats-repository';

const CHAT = 'chat-1';
const USER = 'owner-1';
const DEAD_AFTER = BUILT_IN_DEFAULTS.runs.heartbeatSeconds * 4;

function job(overrides: Partial<ChatJob>): ChatJob {
  return {
    id: 'j',
    chatId: CHAT,
    ownerUserId: USER,
    executor: 'bash',
    seq: 1,
    state: 'running',
    stoppedBy: null,
    runId: 'r1',
    toolCallId: 't1',
    workerInstanceId: 'w1',
    pid: null,
    startedAt: new Date('2026-11-11T10:00:00.000Z'),
    settledAt: null,
    deadlineAt: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    result: null,
    outputs: [],
    artifactId: null,
    artifactReadable: true,
    settings: { modelId: 'm', permissionMode: 'default' },
    ...overrides,
  };
}

const OWNED_CHAT: Chat = {
  id: CHAT,
  ownerUserId: USER,
  title: 'Chat',
  visibility: 'private',
  createdAt: new Date('2026-06-29T00:00:00.000Z'),
  updatedAt: new Date('2026-06-29T00:00:00.000Z'),
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
  artifactSeq: 0,
  workspaceTold: null,
  workspaceToldFrom: null,
  workspaceToldAvailable: null,
  workspaceDetachReason: null,
};

function makeService() {
  const db = drizzle.mock({ schema });

  vi.spyOn(db, 'execute').mockResolvedValue(
    Object.assign([], {
      columns: [],
      count: 0,
      command: 'SELECT',
      statement: { name: '', string: '', types: [], columns: [] },
      state: { status: 'I', pid: 0, secret: 0 },
    }),
  );

  const runAs: TenantRunner['runAs'] = (_user, fn) => fn(db);

  return new ChatJobsService(
    { runAs },
    { config: BUILT_IN_DEFAULTS },
    { wakeForChatInTransaction: vi.fn().mockResolvedValue(false) },
  );
}

function script() {
  return {
    chat: vi
      .spyOn(ChatsRepository.prototype, 'findById')
      .mockResolvedValue(OWNED_CHAT),
    settle: vi
      .spyOn(ChatJobsRepository.prototype, 'settleOnDeadWorkers')
      .mockResolvedValue([]),
    list: vi.spyOn(ChatJobsRepository.prototype, 'listByChat'),
    request: vi.spyOn(ChatJobsRepository.prototype, 'requestStop'),
    find: vi.spyOn(ChatJobsRepository.prototype, 'findById'),
    count: vi.spyOn(ChatJobsRepository.prototype, 'countRunning'),
  };
}

describe('ChatJobsService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists the live jobs first, then the settled ones, each oldest first', async () => {
    const s = script();

    s.list.mockResolvedValue([
      job({ id: 'a', state: 'succeeded' }),
      job({ id: 'b', state: 'running' }),
      job({ id: 'c', state: 'failed' }),
      job({ id: 'd', state: 'running' }),
    ]);

    const rows = await makeService().list(CHAT, USER);

    expect(rows.map((row) => row.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(s.settle).toHaveBeenCalledWith(CHAT, USER, DEAD_AFTER);
  });

  it('answers not found for a Chat that the owner does not hold, and touches nothing', async () => {
    const s = script();

    s.chat.mockResolvedValue(undefined);

    await expect(makeService().list(CHAT, USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(makeService().stop(CHAT, 'j', USER)).rejects.toThrow(
      `Chat ${CHAT} not found`,
    );
    expect(s.settle).not.toHaveBeenCalled();
  });

  it('records an owner stop request on a running job', async () => {
    const s = script();
    const running = job({ stopRequestedBy: 'owner' });

    s.request.mockResolvedValue(running);

    await expect(makeService().stop(CHAT, 'j', USER)).resolves.toBe(running);
    expect(s.request).toHaveBeenCalledWith(CHAT, USER, 'j', 'owner');
    expect(s.find).not.toHaveBeenCalled();
  });

  it('answers 200 for a repeat on a job that the owner stopped', async () => {
    const s = script();
    const stopped = job({ state: 'cancelled', stoppedBy: 'owner' });

    s.request.mockResolvedValue(undefined);
    s.find.mockResolvedValue(stopped);

    await expect(makeService().stop(CHAT, 'j', USER)).resolves.toBe(stopped);
  });

  it.each([
    ['succeeded', null],
    ['cancelled', 'assistant'],
    ['lost', null],
  ] as const)('answers 409 for a %s job stopped by %s', async (state, by) => {
    const s = script();

    s.request.mockResolvedValue(undefined);
    s.find.mockResolvedValue(job({ state, stoppedBy: by }));

    await expect(makeService().stop(CHAT, 'j', USER)).rejects.toThrow(
      ConflictException,
    );
  });

  it('answers 409 for an owner-stopped state that is not cancelled', async () => {
    const s = script();

    s.request.mockResolvedValue(undefined);
    s.find.mockResolvedValue(job({ state: 'failed', stoppedBy: 'owner' }));

    await expect(makeService().stop(CHAT, 'j', USER)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('answers not found for an unknown job', async () => {
    const s = script();

    s.request.mockResolvedValue(undefined);
    s.find.mockResolvedValue(undefined);

    await expect(makeService().stop(CHAT, 'j', USER)).rejects.toThrow(
      'Job j not found',
    );
  });

  it('counts the running jobs against the dead-worker window', async () => {
    const s = script();
    const counts = new Map([[CHAT, 2]]);

    s.count.mockResolvedValue(counts);

    await expect(makeService().runningCounts(USER)).resolves.toBe(counts);
    expect(s.count).toHaveBeenCalledWith(USER, DEAD_AFTER);
  });
});
