import { drizzle } from 'drizzle-orm/postgres-js';

import type {
  Chat,
  Compaction,
  Message,
  ModelContextSnapshot,
  Run,
} from '../db/schema';
import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { createFakeModelClient } from '../models/fake-model-client';
import type { ModelClient } from '../models/model-client';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from '../chats/chats-repository';
import { ModelContextSnapshotsRepository } from '../runs/model-context-snapshots.repository';
import { RunsRepository } from '../runs/runs-repository';
import type { MemorySettingsBindingResolver } from '../memory/memory.service';
import type {
  RecencyDigestResolution,
  RecencyDigestResolver,
} from '../chats/recency-digest.service';
import {
  CompactionService,
  toStoredMessages,
  TransitionCompactionError,
} from './compaction.service';

const chatId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerId = 'owner-1';
const now = new Date('2026-09-01T00:00:00.000Z');

const chat: Chat = {
  id: chatId,
  ownerUserId: ownerId,
  title: null,
  visibility: 'private',
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  projectId: null,
  recencyDigestBaseline: null,
  recencyDigestTold: null,
  recencyDigestRebakedFrom: null,
};

function message(seq: number, role: Message['role'] = 'user'): Message {
  return {
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${seq.toString().padStart(12, '0')}`,
    chatId,
    seq,
    role,
    senderUserId: role === 'user' ? ownerId : null,
    parts: [{ type: 'text', text: `message ${seq}` }],
    attachments: [],
    usage: null,
    inReplyTo: null,
    createdAt: now,
  };
}

const history = Array.from({ length: 9 }, (_, index) => message(index + 1));
const compaction: Compaction = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  chatId,
  uptoSeq: 1,
  parentId: null,
  summary: 'Objective\nKeep the work moving.',
  replacementHistory: [
    { role: 'user', parts: [{ type: 'text', text: 'previous' }] },
  ],
  usage: null,
  createdAt: now,
};

const sourceRun: Run = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  chatId,
  messageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  userId: ownerId,
  modelId: 'model-1',
  modelContextSnapshotId: '11111111-1111-4111-8111-111111111111',
  status: 'completed',
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  contextItems: null,
  createdAt: now,
  startedAt: now,
  finishedAt: now,
  effort: null,
};

const sourceSnapshot: ModelContextSnapshot = {
  id: sourceRun.modelContextSnapshotId!,
  ownerUserId: ownerId,
  contentHash: 'source-content-hash',
  availabilityHash: 'source-availability-hash',
  promptHash: 'source-prompt-hash',
  toolHash: 'source-tool-hash',
  source: 'project_default',
  systemPrompt: 'system',
  toolAvailabilityManifest: { version: 1, entries: [] },
  toolDeclarations: [],
  createdAt: now,
};

const digest: RecencyDigestResolution = {
  baseline: {
    pinned: [],
    recent: [],
    pinnedShown: 0,
    pinnedTotal: 0,
    recentShown: 0,
    recentTotal: 0,
    compiledOn: '2026-09-01',
  },
  told: [],
  candidates: [],
};

function makeService(client: ModelClient = createFakeModelClient(['summary'])) {
  const db: Db = drizzle.mock({ schema });
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });
  const runAs = vi
    .spyOn(tenantDb, 'runAs')
    .mockImplementation(
      async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    );
  const models = {
    createClient: vi.fn(() => client),
  };
  const memory: MemorySettingsBindingResolver = {
    getForOwnerForBinding: vi
      .fn()
      .mockResolvedValue({ shareRecentChats: false }),
  };
  const recencyDigest: RecencyDigestResolver = {
    resolveCandidate: vi.fn().mockResolvedValue(digest),
  };
  return {
    service: new CompactionService(tenantDb, models, memory, recencyDigest),
    runAs,
    models,
    memory,
    recencyDigest,
    client,
  };
}

function mockLiveWindow(previous?: Compaction) {
  vi.spyOn(
    CompactionsRepository.prototype,
    'findLatestByChatId',
  ).mockResolvedValue(previous);
  vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue(
    history,
  );
}

describe('CompactionService pure message boundary', () => {
  it('copies stored messages and rejects malformed JSON parts', () => {
    expect(toStoredMessages([message(1)])).toEqual([message(1)]);
    expect(() => toStoredMessages([{ ...message(1), parts: [null] }])).toThrow(
      /Malformed message part/,
    );
  });
});

describe('CompactionService maybeCompact', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns before database work when measured usage is below the model threshold', async () => {
    const { service, runAs } = makeService();

    await expect(
      service.maybeCompact({
        chatId,
        userId: ownerId,
        client: createFakeModelClient(['unused']),
        system: 'system',
        toolDeclarations: [],
        lastTurnTotalTokens: 1,
      }),
    ).resolves.toBeUndefined();
    expect(runAs).not.toHaveBeenCalled();
  });

  it('compacts a live window, records telemetry, and skips a stale checkpoint', async () => {
    const client = createFakeModelClient(['summary text']);
    Object.assign(client, { compactionThresholdTokens: 10 });
    const { service, runAs, memory, recencyDigest } = makeService(client);
    mockLiveWindow();
    const create = vi
      .spyOn(CompactionsRepository.prototype, 'create')
      .mockResolvedValue(compaction);
    vi.spyOn(ChatsRepository.prototype, 'touch').mockResolvedValue(chat);

    await expect(
      service.maybeCompact({
        chatId,
        userId: ownerId,
        client,
        system: 'system',
        toolDeclarations: [],
        effort: 'high',
        lastTurnTotalTokens: 100,
      }),
    ).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId,
        uptoSeq: 1,
        summary: 'summary text',
        parentId: null,
      }),
    );
    expect(memory.getForOwnerForBinding).toHaveBeenCalled();
    expect(recencyDigest.resolveCandidate).toHaveBeenCalledWith(
      ownerId,
      chatId,
    );
    expect(runAs).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
    const stale = makeService(createFakeModelClient(['summary text']));
    mockLiveWindow();
    vi.spyOn(CompactionsRepository.prototype, 'findLatestByChatId')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        ...compaction,
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      });
    const staleCreate = vi
      .spyOn(CompactionsRepository.prototype, 'create')
      .mockResolvedValue(compaction);
    vi.spyOn(ChatsRepository.prototype, 'touch').mockResolvedValue(chat);
    await stale.service.maybeCompact({
      chatId,
      userId: ownerId,
      client: stale.client,
      system: 'system',
      toolDeclarations: [],
      lastTurnTotalTokens: 100,
    });
    expect(staleCreate).not.toHaveBeenCalled();
  });

  it('does not write an empty summary and survives digest resolution failure', async () => {
    const emptyClient = createFakeModelClient(['']);
    Object.assign(emptyClient, { compactionThresholdTokens: 10 });
    const empty = makeService(emptyClient);
    mockLiveWindow();
    const emptyCreate = vi
      .spyOn(CompactionsRepository.prototype, 'create')
      .mockResolvedValue(compaction);
    await empty.service.maybeCompact({
      chatId,
      userId: ownerId,
      client: empty.client,
      system: 'system',
      toolDeclarations: [],
      lastTurnTotalTokens: 100,
    });
    expect(emptyCreate).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    const digestClient = createFakeModelClient(['summary text']);
    Object.assign(digestClient, { compactionThresholdTokens: 10 });
    const digestFailure = makeService(digestClient);
    mockLiveWindow();
    vi.spyOn(digestFailure.recencyDigest, 'resolveCandidate').mockRejectedValue(
      new Error('digest unavailable'),
    );
    const create = vi
      .spyOn(CompactionsRepository.prototype, 'create')
      .mockResolvedValue(compaction);
    vi.spyOn(ChatsRepository.prototype, 'touch').mockResolvedValue(chat);
    await digestFailure.service.maybeCompact({
      chatId,
      userId: ownerId,
      client: digestFailure.client,
      system: 'system',
      toolDeclarations: [],
      lastTurnTotalTokens: 100,
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it('updates the recency baseline only when the locked chat and consent require it', async () => {
    const currentChat = { ...chat, recencyDigestBaseline: digest.baseline };
    const client = createFakeModelClient(['summary text']);
    Object.assign(client, { compactionThresholdTokens: 10 });
    const setup = makeService(client);
    mockLiveWindow();
    setup.memory.getForOwnerForBinding = vi
      .fn()
      .mockResolvedValue({ shareRecentChats: true });
    vi.spyOn(CompactionsRepository.prototype, 'create').mockResolvedValue(
      compaction,
    );
    const setRecencyDigest = vi
      .spyOn(ChatsRepository.prototype, 'setRecencyDigest')
      .mockResolvedValue(undefined);
    vi.spyOn(ChatsRepository.prototype, 'touch').mockResolvedValue(currentChat);
    await setup.service.maybeCompact({
      chatId,
      userId: ownerId,
      client: setup.client,
      system: 'system',
      toolDeclarations: [],
      lastTurnTotalTokens: 100,
    });
    expect(setRecencyDigest).toHaveBeenCalledWith(
      expect.objectContaining({ chatId, ownerUserId: ownerId }),
    );
  });
});

describe('CompactionService compactForTransition', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when no completed source prefix or source model is available', async () => {
    const noPlan = makeService();
    vi.spyOn(
      CompactionsRepository.prototype,
      'findLatestByChatId',
    ).mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
      message(1),
    ]);
    vi.spyOn(
      RunsRepository.prototype,
      'findMostRecentByChatMessageSequence',
    ).mockResolvedValue(undefined);
    await expect(
      noPlan.service.compactForTransition({
        chatId,
        userId: ownerId,
        triggeringUserSeq: 2,
        reservedOutputTokens: 10,
      }),
    ).rejects.toBeInstanceOf(TransitionCompactionError);

    vi.restoreAllMocks();
    const noSource = makeService();
    vi.spyOn(
      CompactionsRepository.prototype,
      'findLatestByChatId',
    ).mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
      message(1, 'assistant'),
    ]);
    vi.spyOn(
      RunsRepository.prototype,
      'findMostRecentByChatMessageSequence',
    ).mockResolvedValue(undefined);
    await expect(
      noSource.service.compactForTransition({
        chatId,
        userId: ownerId,
        triggeringUserSeq: 2,
        reservedOutputTokens: 10,
      }),
    ).rejects.toBeInstanceOf(TransitionCompactionError);
  });

  it('maps source-model failures, invalid summaries, and superseded commits', async () => {
    vi.spyOn(
      CompactionsRepository.prototype,
      'findLatestByChatId',
    ).mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
      message(1, 'assistant'),
    ]);
    vi.spyOn(
      RunsRepository.prototype,
      'findMostRecentByChatMessageSequence',
    ).mockResolvedValue(sourceRun);
    vi.spyOn(
      ModelContextSnapshotsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue(sourceSnapshot);
    const failingModels = makeService();
    failingModels.models.createClient.mockImplementation(() => {
      throw new Error('model unavailable');
    });
    await expect(
      failingModels.service.compactForTransition({
        chatId,
        userId: ownerId,
        triggeringUserSeq: 2,
        reservedOutputTokens: 10,
      }),
    ).rejects.toBeInstanceOf(TransitionCompactionError);

    vi.restoreAllMocks();
    const emptyClient = createFakeModelClient(['']);
    const empty = makeService(emptyClient);
    vi.spyOn(
      CompactionsRepository.prototype,
      'findLatestByChatId',
    ).mockResolvedValue(undefined);
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
      message(1, 'assistant'),
    ]);
    vi.spyOn(
      RunsRepository.prototype,
      'findMostRecentByChatMessageSequence',
    ).mockResolvedValue(sourceRun);
    vi.spyOn(
      ModelContextSnapshotsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue(sourceSnapshot);
    await expect(
      empty.service.compactForTransition({
        chatId,
        userId: ownerId,
        triggeringUserSeq: 2,
        reservedOutputTokens: 10,
      }),
    ).rejects.toBeInstanceOf(TransitionCompactionError);

    vi.restoreAllMocks();
    const superseded = makeService(createFakeModelClient(['summary']));
    vi.spyOn(CompactionsRepository.prototype, 'findLatestByChatId')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ...compaction, uptoSeq: 10 });
    vi.spyOn(MessagesRepository.prototype, 'findByChatId').mockResolvedValue([
      message(1, 'assistant'),
    ]);
    vi.spyOn(
      RunsRepository.prototype,
      'findMostRecentByChatMessageSequence',
    ).mockResolvedValue(sourceRun);
    vi.spyOn(
      ModelContextSnapshotsRepository.prototype,
      'findByOwnedRun',
    ).mockResolvedValue(sourceSnapshot);
    await expect(
      superseded.service.compactForTransition({
        chatId,
        userId: ownerId,
        triggeringUserSeq: 2,
        reservedOutputTokens: 10,
      }),
    ).resolves.toBe('superseded');
  });
});
